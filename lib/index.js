// lib/index.js — Host backend for dsh-vibecoding 3.0 (Agentic Engineering OS)
// Universal Multi-Agent Orchestrator with Dynamic N-Task Parallelism, Spec Gatekeeper,
// 3-Strike Deadlock Breaker, Compound Memory, Live Server Daemon, and Brownfield Guard.

import { defineTool } from '@deepseek-ai/dsh-tools';
import { execFile, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve, relative, isAbsolute, sep, join, basename } from 'node:path';
import { readFile, writeFile, access, rm, readdir } from 'node:fs/promises';
import { constants, existsSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import vm from 'node:vm';
import { pathToFileURL } from 'node:url';

import {
  createWorktree,
  listWorktrees,
  removeWorktree,
  mergeWorktree,
  squashWorktree,
  sanitizeTaskName,
  withRepoLock,
  isGitRepository
} from './worktree.js';

import {
  parseScope,
  validateScopeGate,
  advanceScopeStep,
  initScopeTemplate
} from './spec.js';

import {
  ensureMemory,
  readMemory,
  recordMilestone,
  recordFailedApproach,
  recordTechDebt,
  sessionWrapup
} from './memory.js';

import { globalStrikeMachine } from './strikes.js';
import { globalServerDaemon } from './server.js';
import { runSecurityAudit } from './security.js';
import { generateDevOpsBundle } from './devops.js';

const exec = promisify(execFile);

/**
 * Bounded Map helper to prevent unbounded memory growth in long-running servers.
 */
function setBoundedMap(map, key, value, maxSize = 500) {
  if (map.size >= maxSize && !map.has(key)) {
    const oldestKey = map.keys().next().value;
    map.delete(oldestKey);
  }
  map.set(key, value);
}

/**
 * Validates that a target path strictly resides within repoRoot, preventing path traversal.
 * Properly accounts for path.sep to avoid false positives on filenames starting with '..'
 * @param {string} root
 * @param {string} target
 * @returns {boolean}
 */
export function isInsideRoot(root, target) {
  const rel = relative(root, target);
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
}

/**
 * Strictly verifies that an Origin header originates from a local development host.
 * Protects against cross-origin bypasses like http://localhost.attacker.com
 * @param {string} origin
 * @returns {boolean}
 */
export function isAllowedLocalOrigin(origin) {
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return false;
    }
    return parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '[::1]';
  } catch {
    return false;
  }
}

/**
 * Classifies a user prompt into Tier 1 (Lean component/script/widget) or Tier 2 (Multi-tier system/DB/backend).
 * @param {string} prompt
 * @returns {'Tier1' | 'Tier2'}
 */
export function profileComplexity(prompt) {
  if (!prompt || typeof prompt !== 'string') return 'Tier1';
  const p = prompt.toLowerCase();
  const tier2Keywords = [
    'backend', 'бэкенд', 'база данных', 'базу данных', 'database', 'postgres', 'postgresql',
    'sqlite', 'redis', 'api', 'docker', 'авторизация', 'авторизацию', 'auth', 'jwt',
    'rest', 'full-stack', 'fullstack', 'микросервис', 'микросервисы'
  ];
  const isTier2 = tier2Keywords.some(kw => p.includes(kw));
  return isTier2 ? 'Tier2' : 'Tier1';
}

/**
 * Detects if a subsequent prompt escalates an existing Tier 1 task into Tier 2.
 * @param {'Tier1' | 'Tier2'} currentTier
 * @param {string} nextPrompt
 * @returns {{ escalate: boolean, targetTier: 'Tier1' | 'Tier2', reason?: string, recommendedSubtasks?: number }}
 */
export function detectEscalation(currentTier, nextPrompt) {
  if (currentTier === 'Tier1') {
    const nextTier = profileComplexity(nextPrompt);
    if (nextTier === 'Tier2') {
      return {
        escalate: true,
        targetTier: 'Tier2',
        reason: 'User introduced multi-runtime, database, or persistence requirements',
        recommendedSubtasks: 3
      };
    }
  }
  return { escalate: false, targetTier: currentTier };
}

export const name = 'vibecoding';
export const inject = ['commands', 'tools', 'systemPrompt', 'webServer'];

export function apply(ctx) {
  const logger = ctx.logger || console;

  // 1. Dynamic session CWD tracking isolated per session
  const sessionCwds = new Map();
  const resolveCwd = (execCtx) => {
    const sid = execCtx?.agent?.session?.id || 'default';
    const candidate = execCtx?.agent?.session?.header?.cwd;
    if (candidate) {
      setBoundedMap(sessionCwds, sid, candidate);
      return candidate;
    }
    return sessionCwds.get(sid) || sessionCwds.get('default') || process.cwd();
  };

  // 2. Vibe Mode state isolated per session (fallback to global default)
  const sessionModes = new Map();
  let defaultVibeMode = true;
  const isVibeActive = (sid = 'default') => sessionModes.get(sid) ?? defaultVibeMode;

  // 3. Multi-Turn Gatekeeper Lifecycle:
  const sessionGates = new Map(); // Map<sid, { unlocked: boolean, taskName: string }>
  const sessionActiveWorktrees = new Map(); // Map<sid, Set<string>>

  const isGateUnlocked = (execCtx) => {
    const sid = execCtx?.agent?.session?.id || 'default';
    return sessionGates.get(sid)?.unlocked === true;
  };

  // -------------------------------------------------------------
  // 1. WebServer Routes for Silent HUD, State, Rollback & Wrap-up
  // -------------------------------------------------------------
  if (ctx.webServer?.register) {
    ctx.webServer.register({
      kind: 'prefix',
      path: '/dsh-vibecoding',
      async handler(req, res) {
        const url = new URL(req.url, 'http://localhost');
        const origin = req.headers.origin || '';
        const isLocal = isAllowedLocalOrigin(origin);
        const reqSid = url.searchParams.get('sid') || 'default';

        if (!isLocal) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Forbidden: non-local origin rejected' }));
          return;
        }

        if (req.method === 'OPTIONS') {
          res.writeHead(204, {
            ...(origin ? { 'Access-Control-Allow-Origin': origin } : {}),
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type'
          });
          res.end();
          return;
        }

        // Endpoint: /dsh-vibecoding/state
        if (url.pathname === '/dsh-vibecoding/state') {
          let targetSid = reqSid;

          if (req.method === 'POST') {
            let body = '';
            for await (const chunk of req) {
              body += chunk;
              if (body.length > 65536) break;
            }

            try {
              const parsed = JSON.parse(body);
              if (typeof parsed.active === 'boolean') {
                targetSid = parsed.sid || reqSid;
                setBoundedMap(sessionModes, targetSid, parsed.active);
                if (targetSid === 'default') defaultVibeMode = parsed.active;
                if (parsed.active) {
                  sessionGates.delete(targetSid);
                  globalStrikeMachine.recordSuccess(targetSid);
                }
                logger.info(`[dsh-vibecoding] Mode toggled for session "${targetSid}" to: ${parsed.active ? 'ACTIVE' : 'INACTIVE'}`);
              }
            } catch {}
          }

          const strikeStatus = globalStrikeMachine.getStatus(targetSid);
          const active = isVibeActive(targetSid);

          res.writeHead(200, {
            'Content-Type': 'application/json',
            ...(origin ? { 'Access-Control-Allow-Origin': origin } : {})
          });
          res.end(JSON.stringify({
            active,
            strikes: strikeStatus.strikeCount,
            isCodeLocked: strikeStatus.isCodeLocked,
            gateUnlocked: sessionGates.get(targetSid)?.unlocked === true
          }));
          return;
        }

        // Endpoint: /dsh-vibecoding/rollback (One-Click Panic Rollback Button)
        if (url.pathname === '/dsh-vibecoding/rollback' && req.method === 'POST') {
          const root = sessionCwds.get(reqSid) || process.cwd();
          try {
            // Roll back to the latest checkpoint
            const { stdout: tags } = await exec('git', ['tag', '-l', 'vibe-ckpt-*', '--sort=-creatordate'], { cwd: root });
            const latestTag = tags.trim().split(/\r?\n/)[0];
            if (!latestTag) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: false, error: 'No checkpoints found to restore.' }));
              return;
            }

            await exec('git', ['read-tree', '--reset', '-u', latestTag], { cwd: root });
            globalStrikeMachine.recordSuccess(reqSid);

            res.writeHead(200, {
              'Content-Type': 'application/json',
              ...(origin ? { 'Access-Control-Allow-Origin': origin } : {})
            });
            res.end(JSON.stringify({ success: true, restoredTag: latestTag }));
            return;
          } catch (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: err.message }));
            return;
          }
        }

        // Endpoint: /dsh-vibecoding/wrapup (One-Click Session Wrap-up Button)
        if (url.pathname === '/dsh-vibecoding/wrapup' && req.method === 'POST') {
          const root = sessionCwds.get(reqSid) || process.cwd();
          try {
            await sessionWrapup(root, { summary: 'Session manually wrapped up via DSH Web HUD.' });
            res.writeHead(200, {
              'Content-Type': 'application/json',
              ...(origin ? { 'Access-Control-Allow-Origin': origin } : {})
            });
            res.end(JSON.stringify({ success: true, message: 'Session wrap-up saved to .dsh/memory/memory.md' }));
            return;
          } catch (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: err.message }));
            return;
          }
        }

        res.writeHead(404);
        res.end();
      }
    });
  }

  // -------------------------------------------------------------
  // 2. Universal System Prompt Guardrails (Active when mode is ON)
  // -------------------------------------------------------------
  if (ctx.systemPrompt?.section) {
    ctx.systemPrompt.section({
      name: 'vibecoding:universal-policy',
      order: 150,
      interpolate: false,
      text: (promptCtx) => {
        const sid = promptCtx?.session?.id || promptCtx?.agent?.session?.id || 'default';
        if (!isVibeActive(sid)) return '';

        const strikeStatus = globalStrikeMachine.getStatus(sid);
        const isStrike2 = strikeStatus.strikeCount === 2;

        let strikeNotice = '';
        if (isStrike2) {
          strikeNotice = `
⚠️ STRIKE 2 WARNING:
You have made 2 consecutive errors. Code editing is currently BANNED!
You MUST perform a Root Cause Analysis (RCA) and present 3 distinct architectural alternatives.
Use the tool 'strike_guard' { action: "submit_rca", solutionSummary: "..." } to unlock editing permissions.
`;
        }

        return `
# ⚡ AGENTIC ENGINEERING OS 3.0 (SOFTWARE 3.0 DIRECTIVE):
You are the Lead Staff Engineer & System Architect. You operate under the strict laws of Agentic Engineering:
"You can delegate thinking, but you can NEVER delegate understanding."

${strikeNotice}

### 🛡️ THE 12 GOLDEN RULES OF AGENTIC ENGINEERING:
1. 📄 SPEC BEFORE CODE (scope.md): In Tier 2, never write code without an approved 'scope.md' and data contract.
2. ❓ 90% CERTAINTY RULE: If certainty regarding DB schema, API contracts, or entity IDs is under 90%, coding is STRICTLY FORBIDDEN. Ask clarifying questions first.
3. 🔬 ATOMIC FEATURE LOOPS: One prompt = one component/feature. Touch zero adjacent modules.
4. 📌 GIT AS SAVE POINTS: Every functioning state must be captured with 'checkpoint_create'.
5. 👁️ GIVE AI EYES & EARS: Automated smoke checks via 'verify_deliverable' in Headless Chrome + fresh documentation via MCP.
6. 🧠 TRIGGER DEEP THINKING (ultrathink): When resolving complex bugs, refactoring, or under Strike 2, use deep extended reasoning.
7. 👂 LISTEN TO THE SERVER: Run backend services with 'server_daemon' and stream logs in real time.
8. 🚀 ZERO DEVOPS BOTTLENECK: Eliminate the 1-week deployment gap. Generate Nginx, SSL, Systemd, and Docker configs via 'devops_provision'.
9. 🧠 COMPOUND MEMORY: At the end of every major milestone, update '.dsh/memory/memory.md' with 'memory_manage'.
10. 🛑 3-STRIKE PROTOCOL:
    - Strike 1: 3-component error diagnostic (Raw log + Expected vs Actual).
    - Strike 2: Ban on code editing. Deep Root Cause Analysis + 3 solutions (Trigger: ultrathink).
    - Strike 3: Immediate 'checkpoint_restore' rollback + context rotation (/clear).
11. 🧹 MAXIMUM SIMPLICITY (KISS): Refuse unnecessary enterprise boilerplate and bloatware.
12. 👑 REMAIN DIRECTOR & JUDGE: Maintain total architectural clarity, security sanitization, and persistent user_id bindings in billing.

### 🚀 1. SMART GATEKEEPER & FAST-PATH PROTOCOL:
- EVALUATE THE USER PROMPT BEFORE ASKING QUESTIONS:
  * ⚡ FAST-PATH ACTIVATION (ZERO-QUESTION BYPASS):
    If the user's prompt is comprehensive, specifies clear requirements, OR gives creative freedom ("придумай сам", "сделай", "начни", "без вопросов"):
    -> DO NOT ask redundant, bureaucratic questions!
    -> Call 'complete_interview' with 'bypassReason: "comprehensive_prompt"' or '"creative_freedom"'.
    -> In Tier 2, call 'scope_manage' { action: "init", taskName: ... } to establish the contract.

### 📄 2. BROWNFIELD SCOPE LOCK & ATOMIC TARGET FILES:
- In brownfield or legacy projects:
  * Check the active step in 'scope.md'.
  * Restrict all file edits strictly to the 'Target Files' declared for the active step.
  * Once the step passes verification tests, call 'scope_manage' { action: "advance" } and record progress via 'memory_manage'.

### 📦 3. ANTI-CHAT-DUMP & AUTONOMOUS DELIVERY:
- Deliver code by writing directly to disk via 'write' / 'edit'.
- DO NOT dump 1000+ lines of raw code into the chat conversation, even if user prompt literally asks "выведи в блоке html".
- 🛡️ DSH WRITE TOOL CONVENTION:
  * When calling 'write', NEVER pass 'justification' unless you are simultaneously requesting escalation via 'sandbox_permissions'. In standard workspace sessions, call 'write' with only 'file_path' and 'content' to avoid validation errors.
- 🏁 AUTONOMOUS TURN COMPLETION (NO "И ЧТО?" STALLING):
  * Complete the full delivery loop in the SAME turn: write -> verify -> present -> brief user summary. Never stop silently after writing code without presenting the deliverable.

### 🌟 4. PRODUCT EXCELLENCE & PHYSICS SANDBOXES:
- Creative & Physics Sandboxes (Matter.js / Canvas / Three.js / WebGL):
  * Kinetic impact destruction: shatter bodies based on impact velocity vector, collision point, and local rotation matrix (transform fragments using parent angle: rx = cx + lx*cos(a) - ly*sin(a)).
  * Material physics: distinct response for fragile glass (shatter sound, light shards), stone (heavy fracture), and explosive TNT (chain reaction detonation).
  * Rich interaction arsenal: combine at least 2–3 modes (e.g. Slingshot with dotted trajectory prediction, Heavy Cannon aimed fire, Shockwave explosion, Drag/Gravity).
  * Dynamic controls: provide sliders for gravity, blast power, and automatic particle dissolution (<10px) to maintain 60 FPS.
- Web Audio & Gestures:
  * Initialize AudioContext on user gesture (pointerdown/click) so browsers do not block autoplay.
  * Add clear visual hints for user gestures (e.g. "👆 Клик — выстрел • Зажми и натяни рогатку").
`;
      }
    });
  }

  // -------------------------------------------------------------
  // 3. Slash Command /vibe <task>
  // -------------------------------------------------------------
  if (ctx.commands?.register) {
    ctx.commands.register({
      name: 'vibe',
      description: 'Start universal 5-Phase Multi-Agent pipeline (Code & Non-Code)',
      handler: async ({ agent, rawInput }) => {
        const task = rawInput.trim();
        const sid = agent?.session?.id || 'default';
        sessionModes.set(sid, true);
        defaultVibeMode = true;
        sessionGates.delete(sid);
        globalStrikeMachine.recordSuccess(sid);

        if (!task) {
          return {
            kind: 'success',
            text: `🎯 **Agentic Engineering Mode 3.0 включен.** Задачи выполняются через архитектурный конвейер (Spec Gate -> 3-Strike Rule -> Compound Memory -> Worktrees -> Smoke Verification).`
          };
        }

        if (typeof agent?.steer === 'function') {
          agent.steer({
            content: [{
              type: 'text',
              text: `[🎯 AGENTIC VIBE PIPELINE 3.0]\nЗадача: "${task}"\n\n⚠️ ПРАВИЛО ФАЗЫ 1: Зафиксируйте спецификацию (scope.md) и проверьте правило 90% уверенности перед написанием кода.`
            }],
            source: { kind: 'user' }
          });
        }

        return {
          kind: 'success',
          text: `🚀 Универсальный Vibe-пайплайн запущен для: "${task}".`
        };
      }
    });
  }

  // -------------------------------------------------------------
  // 4. Tools Registration (Agentic Engineering Arsenal)
  // -------------------------------------------------------------
  if (ctx.tools?.register) {

    // Tool: scope_manage (Spec Gatekeeper & Brownfield Whitelist)
    ctx.tools.register(
      defineTool({
        name: 'scope_manage',
        description: 'Manages project specifications (scope.md). Initializes milestones, checks active step, inspects target file whitelist, or advances completed steps.',
        parameters: {
          action: {
            type: 'string',
            enum: ['init', 'status', 'advance', 'read'],
            required: true,
            description: 'Action to perform on scope.md'
          },
          taskName: {
            type: 'string',
            description: 'Task name (required for init)'
          },
          milestones: {
            type: 'array',
            items: { type: 'string' },
            description: 'Milestone descriptions with optional target files, e.g. "Auth API [files: src/auth.js, test/auth.test.js]"'
          }
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              success: { type: 'boolean', required: true },
              message: { type: 'string', required: true },
              activeStep: { type: 'object' },
              isComplete: { type: 'boolean' }
            }
          },
          render: (_args, value) => [
            { type: 'text', text: value.message }
          ]
        },
        async execute(args, execCtx) {
          const root = resolveCwd(execCtx);

          if (args.action === 'init') {
            const name = args.taskName || 'Project Feature Scope';
            const milestoneObjs = (args.milestones || []).map(m => {
              let targetFiles = [];
              const match = m.match(/[\[(](?:target\s*)?files?:\s*([^\])]+)[\])]/i);
              if (match) {
                targetFiles = match[1].split(/[,;\s]+/).map(f => f.trim()).filter(Boolean);
              }
              return { title: m.replace(/[\[(].*[\])]/, '').trim(), targetFiles };
            });

            const path = await initScopeTemplate(root, name, milestoneObjs);
            const parsed = await parseScope(root);
            return {
              success: true,
              message: `📄 scope.md initialized at ${path}. Active step #1: "${parsed.activeStep?.title || 'Initial setup'}".`,
              activeStep: parsed.activeStep,
              isComplete: false
            };
          }

          if (args.action === 'advance') {
            const res = await advanceScopeStep(root);
            if (!res.success) {
              return {
                success: false,
                message: 'No pending steps to advance in scope.md (all steps already completed or file missing).',
                isComplete: res.isAllComplete
              };
            }

            // Automatically record milestone in long-term memory
            if (res.completedStep?.title) {
              await recordMilestone(root, res.completedStep.title).catch(() => {});
            }

            return {
              success: true,
              message: `✅ Advanced scope.md. Completed: "${res.completedStep?.title}". Next active step: "${res.nextStep?.title || 'ALL STEPS COMPLETED'}".`,
              activeStep: res.nextStep,
              isComplete: res.isAllComplete
            };
          }

          if (args.action === 'read' || args.action === 'status') {
            const scope = await parseScope(root);
            if (!scope.exists) {
              return {
                success: false,
                message: 'scope.md does not exist yet. Call scope_manage with action: "init" to establish the contract.',
                isComplete: false
              };
            }
            return {
              success: true,
              message: `📋 Scope Status: ${scope.completedSteps}/${scope.totalSteps} steps completed. Active step: "${scope.activeStep?.title || 'None (Complete)'}".\nTarget files: [${scope.activeStep?.targetFiles?.join(', ') || 'unrestricted'}]`,
              activeStep: scope.activeStep,
              isComplete: scope.isComplete
            };
          }

          return { success: false, message: 'Invalid action' };
        }
      })
    );

    // Tool: memory_manage (Compound Engineering & Context Drift Rotation)
    ctx.tools.register(
      defineTool({
        name: 'memory_manage',
        description: 'Interacts with project long-term memory (.dsh/memory/memory.md). Records milestones, documents failed approaches to prevent loops, and runs session wrap-up.',
        parameters: {
          action: {
            type: 'string',
            enum: ['read', 'record_milestone', 'record_failed_approach', 'record_debt', 'wrapup'],
            required: true,
            description: 'Action to perform on memory.md'
          },
          text: {
            type: 'string',
            description: 'Text content for milestone, debt, or wrapup summary'
          },
          details: {
            type: 'object',
            description: 'Structured details for record_failed_approach (approach, whyFailed, recommendation)'
          }
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              success: { type: 'boolean', required: true },
              content: { type: 'string' },
              message: { type: 'string', required: true }
            }
          },
          render: (_args, value) => [
            { type: 'text', text: value.message }
          ]
        },
        async execute(args, execCtx) {
          const root = resolveCwd(execCtx);

          if (args.action === 'read') {
            const content = await readMemory(root);
            return {
              success: true,
              content,
              message: `🧠 Long-term memory loaded (.dsh/memory/memory.md):\n\n${content}`
            };
          }

          if (args.action === 'record_milestone') {
            await recordMilestone(root, args.text || 'Milestone achieved');
            return { success: true, message: `✅ Milestone recorded in long-term memory: "${args.text}"` };
          }

          if (args.action === 'record_failed_approach') {
            const d = args.details || { approach: args.text || 'Attempted fix', whyFailed: 'Failed tests' };
            await recordFailedApproach(root, d);
            return { success: true, message: `❌ Recorded failed approach in memory to prevent loop amnesia.` };
          }

          if (args.action === 'record_debt') {
            await recordTechDebt(root, args.text || 'Pending debt');
            return { success: true, message: `⚠️ Recorded technical debt in memory: "${args.text}"` };
          }

          if (args.action === 'wrapup') {
            await sessionWrapup(root, { summary: args.text || 'Session completed successfully.' });
            return { success: true, message: `📦 End-of-Session Wrap-up saved to .dsh/memory/memory.md` };
          }

          return { success: false, message: 'Invalid action' };
        }
      })
    );

    // Tool: strike_guard (3-Strike Deadlock Controller & RCA Unlocker)
    ctx.tools.register(
      defineTool({
        name: 'strike_guard',
        description: 'Inspects verification strike status (3-Strike Rule). Unlocks code-editing permissions on Strike 2 by submitting a Root Cause Analysis (RCA).',
        parameters: {
          action: {
            type: 'string',
            enum: ['status', 'submit_rca'],
            required: true,
            description: 'Action: "status" to inspect strikes, "submit_rca" to unlock editing under Strike 2'
          },
          solutionSummary: {
            type: 'string',
            description: 'Detailed explanation of root cause and chosen solution (minimum 20 chars, required for submit_rca)'
          }
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              success: { type: 'boolean', required: true },
              strikeCount: { type: 'integer', required: true },
              isCodeLocked: { type: 'boolean', required: true },
              message: { type: 'string', required: true }
            }
          },
          render: (_args, value) => [
            { type: 'text', text: value.message }
          ]
        },
        async execute(args, execCtx) {
          const sid = execCtx?.agent?.session?.id || 'default';
          const status = globalStrikeMachine.getStatus(sid);

          if (args.action === 'status') {
            return {
              success: true,
              strikeCount: status.strikeCount,
              isCodeLocked: status.isCodeLocked,
              message: `🛡️ Strike Status for session "${sid}": ${status.strikeCount}/3 Strikes. Code Editing Locked: ${status.isCodeLocked ? 'YES (RCA Required)' : 'NO'}.`
            };
          }

          if (args.action === 'submit_rca') {
            const unlockRes = globalStrikeMachine.unlockAfterRca(sid, args.solutionSummary);
            const newStatus = globalStrikeMachine.getStatus(sid);
            return {
              success: unlockRes.success,
              strikeCount: newStatus.strikeCount,
              isCodeLocked: newStatus.isCodeLocked,
              message: unlockRes.message
            };
          }

          return { success: false, strikeCount: status.strikeCount, isCodeLocked: status.isCodeLocked, message: 'Invalid action' };
        }
      })
    );

    // Tool: server_daemon (Listen to the Server)
    ctx.tools.register(
      defineTool({
        name: 'server_daemon',
        description: 'Manages long-running background development servers (Node.js, Next.js, Vite, FastAPI). Captures live logs in a ring buffer to catch runtime crashes.',
        parameters: {
          action: {
            type: 'string',
            enum: ['start', 'stop', 'logs', 'status'],
            required: true,
            description: 'Action: start, stop, logs, or status'
          },
          command: {
            type: 'string',
            description: 'Command to run (e.g. "npm run dev", "node server.js", "uvicorn main:app --port 8000")'
          },
          port: {
            type: 'integer',
            description: 'Expected port to listen on (e.g. 3000, 8000)'
          },
          lines: {
            type: 'integer',
            description: 'Number of recent log lines to retrieve (default: 50)'
          }
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              success: { type: 'boolean', required: true },
              message: { type: 'string', required: true },
              logs: { type: 'string' }
            }
          },
          render: (_args, value) => [
            { type: 'text', text: `${value.message}\n` + (value.logs ? `\nRecent Logs:\n${value.logs}` : '') }
          ]
        },
        async execute(args, execCtx) {
          const root = resolveCwd(execCtx);

          if (args.action === 'start') {
            if (!args.command) {
              return { success: false, message: 'Command is required to start background server.' };
            }
            const res = await globalServerDaemon.startServer(root, {
              command: args.command,
              port: args.port
            });
            return {
              success: res.success,
              message: res.message,
              logs: res.initialLogs
            };
          }

          if (args.action === 'logs') {
            const res = globalServerDaemon.getLogs(root, args.lines || 50);
            return {
              success: true,
              message: `Server Status: ${res.running ? 'RUNNING (PID: ' + res.pid + ')' : 'STOPPED'}`,
              logs: res.logs
            };
          }

          if (args.action === 'stop') {
            const res = await globalServerDaemon.stopServer(root);
            return { success: res.stopped, message: res.message };
          }

          if (args.action === 'status') {
            const st = globalServerDaemon.getStatus(root);
            return {
              success: true,
              message: st.running
                ? `🟢 Server RUNNING [PID: ${st.pid}, Port: ${st.port || 'N/A'}, Uptime: ${st.uptimeSeconds}s]`
                : '⚪ No server running for this repository.'
            };
          }

          return { success: false, message: 'Invalid action' };
        }
      })
    );

    // Tool: devops_provision (Automated DevOps Deployment Bundle)
    ctx.tools.register(
      defineTool({
        name: 'devops_provision',
        description: 'Generates an end-to-end production deployment bundle (Nginx reverse proxy, Let\'s Encrypt SSL, Systemd service, Dockerfile, setup.sh for TimeWeb VPS / Amvera).',
        parameters: {
          appName: {
            type: 'string',
            required: true,
            description: 'Application identifier (e.g. "my-saas-api")'
          },
          port: {
            type: 'integer',
            required: true,
            description: 'Internal server listening port (e.g. 3000, 8000)'
          },
          domain: {
            type: 'string',
            description: 'Production domain name (e.g. "api.myapp.com")'
          },
          framework: {
            type: 'string',
            enum: ['node', 'python', 'static', 'docker'],
            description: 'Runtime framework (default: "node")'
          },
          dbType: {
            type: 'string',
            enum: ['sqlite', 'postgres', 'supabase'],
            description: 'Database type (default: "sqlite")'
          }
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              success: { type: 'boolean', required: true },
              message: { type: 'string', required: true },
              files: { type: 'array', items: { type: 'string' } }
            }
          },
          render: (_args, value) => [
            { type: 'text', text: value.message }
          ]
        },
        async execute(args, execCtx) {
          const root = resolveCwd(execCtx);
          try {
            const res = await generateDevOpsBundle(root, args);
            return {
              success: true,
              message: res.summary,
              files: res.generatedFiles
            };
          } catch (err) {
            return {
              success: false,
              message: `Failed to generate DevOps bundle: ${err.message}`,
              files: []
            };
          }
        }
      })
    );

    // Tool: run_tdd_cycle (Enhanced with 3-Strike Rule & Save Points)
    ctx.tools.register(
      defineTool({
        name: 'run_tdd_cycle',
        description: 'Runs automated project tests. Automatically enforces 3-Strike Rule diagnostics and creates Git Save Points on GREEN.',
        parameters: {
          testCommand: {
            type: 'string',
            required: true,
            description: 'Test command to run (e.g. "npm test", "pytest", "cargo test")'
          },
          cwd: {
            type: 'string',
            description: 'Optional working directory relative to project root'
          }
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              status: {
                type: 'string',
                enum: ['GREEN', 'RED'],
                required: true
              },
              message: { type: 'string', required: true },
              output: { type: 'string', required: true },
              exitCode: { type: 'integer', required: true }
            }
          },
          render: (_args, value) => [
            {
              type: 'text',
              text: `[VERIFICATION ${value.status}] ${value.message}\nExit code: ${value.exitCode}\n\n${value.output}`
            }
          ]
        },
        async execute(args, execCtx) {
          const sid = execCtx?.agent?.session?.id || 'default';
          const root = resolveCwd(execCtx);
          const runDir = args.cwd ? resolve(root, args.cwd) : root;

          if (!isInsideRoot(root, runDir)) {
            return {
              status: 'RED',
              message: 'Security error: working directory cannot escape project root.',
              output: `Invalid cwd: ${args.cwd}`,
              exitCode: 1
            };
          }

          const rawCmd = args.testCommand.trim();
          if (/[\r\n;&|><`$%^]/.test(rawCmd)) {
            return {
              status: 'RED',
              message: 'Security error: shell metacharacters are not allowed in testCommand.',
              output: `Blocked command: ${rawCmd}`,
              exitCode: 1
            };
          }

          const matchArgs = rawCmd.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
          if (matchArgs.length === 0) {
            return { status: 'RED', message: 'Empty test command provided.', output: '', exitCode: 1 };
          }

          const cmd = matchArgs[0];
          if (cmd.startsWith('.') || (cmd.includes('/') && !isAbsolute(cmd)) || (cmd.includes('\\') && !isAbsolute(cmd))) {
            return {
              status: 'RED',
              message: `Security error: relative paths for test runner executable ("${cmd}") are not allowed.`,
              output: `Blocked executable: ${cmd}`,
              exitCode: 1
            };
          }

          const baseCmd = basename(cmd).toLowerCase().replace(/\.(exe|cmd|bat|ps1)$/, '');
          const ALLOWED_TEST_RUNNERS = new Set([
            'npm', 'npx', 'pnpm', 'yarn', 'bun', 'bunx',
            'node', 'deno',
            'pytest', 'python', 'python3',
            'cargo', 'cargo-nextest', 'go', 'gradle', 'mvn',
            'make', 'dotnet', 'composer', 'pest', 'mix',
            'vitest', 'jest', 'mocha', 'playwright', 'cypress', 'ava', 'tap', 'tsc'
          ]);

          if (!ALLOWED_TEST_RUNNERS.has(baseCmd)) {
            return {
              status: 'RED',
              message: `Security error: command "${cmd}" is not in the allowed test runner whitelist.`,
              output: `Blocked executable: ${cmd}`,
              exitCode: 1
            };
          }

          const cmdArgs = matchArgs.slice(1).map(arg => {
            if ((arg.startsWith('"') && arg.endsWith('"')) || (arg.startsWith("'") && arg.endsWith("'"))) {
              return arg.slice(1, -1);
            }
            const optMatch = arg.match(/^(--?[a-zA-Z0-9_-]+=)(["'])(.*)\2$/);
            if (optMatch) return optMatch[1] + optMatch[3];
            return arg;
          });

          const RUNTIME_RUNNERS = new Set(['node', 'python', 'python3', 'deno', 'bun', 'bunx']);
          if (RUNTIME_RUNNERS.has(baseCmd)) {
            const DANGEROUS_FLAG_REGEX = /^-(e|c|r|m)$|^--(eval|require|import|loader|experimental-loader)$|^-(e|c|r|m)=|^--(eval|require|import|loader|experimental-loader)=|^-c.+|^-m.+/i;
            if (cmdArgs.some(arg => DANGEROUS_FLAG_REGEX.test(arg))) {
              return {
                status: 'RED',
                message: 'Security error: code execution or module-loading flags are not allowed in testCommand.',
                output: `Blocked arguments: ${cmdArgs.join(' ')}`,
                exitCode: 1
              };
            }
          }

          try {
            const isWindows = process.platform === 'win32';
            let execCmd = cmd;
            if (isWindows && !/[\\/.]/.test(cmd)) {
              try {
                const { stdout: resolvedPath } = await exec('where', [cmd]);
                const firstLine = resolvedPath.trim().split(/\r?\n/)[0];
                if (firstLine) execCmd = firstLine;
              } catch {}
            }

            const { stdout, stderr } = await exec(execCmd, cmdArgs, {
              cwd: runDir,
              env: { ...process.env, CI: 'true', FORCE_COLOR: '0' },
              timeout: 120000,
              maxBuffer: 10 * 1024 * 1024,
              shell: false
            });

            // On success (GREEN): Reset strikes & record Save Point
            globalStrikeMachine.recordSuccess(sid);

            return {
              status: 'GREEN',
              message: '✅ Tests/Checks passed! (Strikes reset to 0)',
              output: stdout || stderr || '(No output)',
              exitCode: 0
            };
          } catch (err) {
            const output = [err.stdout, err.stderr, err.message].filter(Boolean).join('\n');
            const numericExitCode = typeof err.code === 'number' ? err.code : 1;

            // Advance 3-Strike state machine
            const strikeResult = globalStrikeMachine.recordFailure(sid, {
              errorOutput: output,
              testCommand: rawCmd
            });

            // If Strike 3, trigger emergency rollback and record failed approach
            if (strikeResult.triggerRollback) {
              try {
                await recordFailedApproach(root, {
                  approach: `Failed command: ${rawCmd}`,
                  whyFailed: output.slice(-500),
                  recommendation: 'Do not repeat this pattern. Perform context rotation.'
                });
              } catch {}
            }

            return {
              status: 'RED',
              message: `🔴 [STRIKE ${strikeResult.strike}/3] ${strikeResult.directive}`,
              output: (output + '\n\n' + strikeResult.diagnosticMessage).slice(-4000),
              exitCode: numericExitCode
            };
          }
        }
      })
    );

    // Tool: complete_interview (Phase 1 Gatekeeper with Tier 2 Spec Verification)
    ctx.tools.register(
      defineTool({
        name: 'complete_interview',
        description: 'Unlocks Phase 2-5 after clarifying requirements. In Tier 2, enforces that scope.md exists with approved milestones.',
        parameters: {
          taskName: {
            type: 'string',
            required: true,
            description: 'Task name or identifier'
          },
          requirementsSummary: {
            type: 'string',
            required: true,
            description: 'Key confirmed requirements from user interview'
          },
          subtaskCount: {
            type: 'integer',
            description: 'Calculated optimal subtasks count (1-5+)'
          },
          complexity: {
            type: 'string',
            enum: ['XS', 'S', 'M', 'L', 'XL'],
            description: 'Assessed task complexity level'
          },
          bypassReason: {
            type: 'string',
            enum: ['clarified_interview', 'comprehensive_prompt', 'direct_request', 'creative_freedom'],
            description: 'Reason for unlocking'
          }
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              gateUnlocked: { type: 'boolean', required: true },
              message: { type: 'string', required: true }
            }
          },
          render: (_args, value) => [
            { type: 'text', text: value.message }
          ]
        },
        async execute(args, execCtx) {
          const sid = execCtx?.agent?.session?.id || 'default';
          const root = resolveCwd(execCtx);
          setBoundedMap(sessionGates, sid, { unlocked: true, taskName: args.taskName });
          const isFast = args.bypassReason && args.bypassReason !== 'clarified_interview';
          const prefix = isFast ? '⚡ FAST-PATH ACTIVATED: Gatekeeper UNLOCKED' : '🔓 Phase 1 Gatekeeper UNLOCKED';

          // Auto-initialize scope.md if complex task and scope.md does not exist yet
          const isComplex = args.complexity === 'L' || args.complexity === 'XL' || (args.subtaskCount || 1) > 1;
          const scope = await parseScope(root);
          let scopeNotice = '';

          if (isComplex && !scope.exists) {
            await initScopeTemplate(root, args.taskName, [
              { title: 'Define data contracts & interface boundaries' },
              { title: 'Core implementation & domain services' },
              { title: 'Verification test suite & smoke test' }
            ]);
            scopeNotice = `\n📄 Auto-created "scope.md" with 3 atomic milestones. Review target files before coding.`;
          }

          return {
            gateUnlocked: true,
            message: `${prefix} for "${args.taskName}" [Complexity: ${args.complexity || 'M'}]. Planned subtasks: ${args.subtaskCount || 1}.${scopeNotice}`
          };
        }
      })
    );

    // Tool: create_worker_brief (Lean Prompt Generator)
    ctx.tools.register(
      defineTool({
        name: 'create_worker_brief',
        description: 'Generates an ultra-compact prompt for subagents, passing ONLY strict goal, target file, interface contract, and verification command.',
        parameters: {
          subtaskName: {
            type: 'string',
            required: true,
            description: 'Subtask name (e.g. "auth-service")'
          },
          targetFile: {
            type: 'string',
            required: true,
            description: 'Exact relative file path the worker must create/edit'
          },
          contract: {
            type: 'string',
            required: true,
            description: 'Concise API/Rubric interface contract specification'
          },
          verificationCommand: {
            type: 'string',
            required: true,
            description: 'Command to verify status (e.g. "npm test tests/auth.test.js")'
          }
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              prompt: { type: 'string', required: true },
              tokenSavingHint: { type: 'string', required: true }
            }
          },
          render: (_args, value) => [
            { type: 'text', text: `📋 Generated Lean Worker Brief:\n\n${value.prompt}` }
          ]
        },
        async execute(args) {
          const safeName = sanitizeTaskName(args.subtaskName);
          const leanPrompt = `[LEAN WORKER BRIEF: ${args.subtaskName}]
Isolated Workspace: .worktrees/${safeName}
Target File: ${args.targetFile}
Contract Specification:
${args.contract}
Verification: Run "${args.verificationCommand}" until GREEN.
TOKEN SAVER DIRECTIVE: Silent execution. Zero conversational filler. Call tools directly. Return 3-line completion JSON when all tests pass.`;
          return {
            prompt: leanPrompt,
            tokenSavingHint: 'Pass this exact prompt to the "subagent" tool to save 70-80% tokens in the main context.'
          };
        }
      })
    );

    // Tool: worktree_create
    ctx.tools.register(
      defineTool({
        name: 'worktree_create',
        description: 'Creates an isolated Git worktree directory for parallel development.',
        parameters: {
          taskName: {
            type: 'string',
            required: true,
            description: 'Short task identifier in kebab-case or natural language'
          },
          baseBranch: {
            type: 'string',
            description: 'Optional base branch to branch off (default: HEAD)'
          },
          autoInit: {
            type: 'boolean',
            description: 'Automatically initialize a Git repository if needed (default: true)'
          }
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              success: { type: 'boolean', required: true },
              path: { type: 'string', required: true },
              branch: { type: 'string', required: true },
              existed: { type: 'boolean', required: true },
              message: { type: 'string' }
            }
          },
          render: (_args, value) => [
            {
              type: 'text',
              text: value.success
                ? `Worktree ${value.existed ? 'already exists' : 'created'} at ${value.path} (branch: ${value.branch})`
                : `${value.message || 'Failed to create worktree'}`
            }
          ]
        },
        async execute(args, execCtx) {
          const sid = execCtx?.agent?.session?.id || 'default';
          if (isVibeActive(sid) && !isGateUnlocked(execCtx)) {
            return {
              success: false,
              path: '',
              branch: '',
              existed: false,
              message: '🛑 PHASE 1 GATEKEEPER ACTIVE: Запрещено создавать воркдеревья до проведения интервью с пользователем! Зафиксируйте требования вызовом complete_interview.'
            };
          }

          const root = resolveCwd(execCtx);
          const safeName = sanitizeTaskName(args.taskName);
          const autoInit = args.autoInit !== false;

          try {
            const res = await createWorktree(root, args.taskName, args.baseBranch || 'HEAD', autoInit);
            if (res.path) {
              if (!sessionActiveWorktrees.has(sid)) setBoundedMap(sessionActiveWorktrees, sid, new Set());
              sessionActiveWorktrees.get(sid).add(safeName);
            }
            return { success: true, ...res };
          } catch (err) {
            return {
              success: false,
              path: '',
              branch: '',
              existed: false,
              message: `Failed to create worktree: ${err.message}`
            };
          }
        }
      })
    );

    // Tool: worktree_merge (Supports Squashing)
    ctx.tools.register(
      defineTool({
        name: 'worktree_merge',
        description: 'Merges a completed task branch from an isolated Git worktree back into current HEAD with optional squashing.',
        parameters: {
          taskName: {
            type: 'string',
            required: true,
            description: 'Task name whose branch to merge'
          },
          squash: {
            type: 'boolean',
            description: 'Whether to squash all commits on the branch into a single atomic commit before merging (default: true)'
          }
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              success: { type: 'boolean', required: true },
              message: { type: 'string', required: true }
            }
          },
          render: (_args, value) => [
            {
              type: 'text',
              text: value.success ? `🔀 Merged branch: ${value.message}` : `❌ Merge failed: ${value.message}`
            }
          ]
        },
        async execute(args, execCtx) {
          const root = resolveCwd(execCtx);
          try {
            if (args.squash !== false) {
              await squashWorktree(root, args.taskName).catch(() => {});
            }
            const out = await mergeWorktree(root, args.taskName);
            return { success: true, message: out || 'Merge completed successfully.' };
          } catch (err) {
            return { success: false, message: err.message };
          }
        }
      })
    );

    // Tool: worktree_remove
    ctx.tools.register(
      defineTool({
        name: 'worktree_remove',
        description: 'Cleans up an isolated Git worktree after merging (auto-commits uncommitted work to prevent data loss).',
        parameters: {
          taskName: {
            type: 'string',
            required: true,
            description: 'Task name whose worktree to remove'
          },
          deleteBranch: {
            type: 'boolean',
            description: 'Whether to delete the branch safely (default: false)'
          }
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              success: { type: 'boolean', required: true },
              removed: { type: 'string', required: true },
              branchNotice: { type: 'string' }
            }
          },
          render: (_args, value) => [
            {
              type: 'text',
              text: `Worktree removed: ${value.removed}` + (value.branchNotice ? `\n⚠️ ${value.branchNotice}` : '')
            }
          ]
        },
        async execute(args, execCtx) {
          const sid = execCtx?.agent?.session?.id || 'default';
          const root = resolveCwd(execCtx);
          const safeName = sanitizeTaskName(args.taskName);

          try {
            const res = await removeWorktree(root, args.taskName, args.deleteBranch ?? false);
            const activeSet = sessionActiveWorktrees.get(sid);
            if (activeSet) {
              activeSet.delete(safeName);
              if (activeSet.size === 0) {
                sessionGates.delete(sid);
                logger.info(`[dsh-vibecoding] All worktrees cleaned up for session "${sid}". Gatekeeper re-armed.`);
              }
            }

            const out = { success: true, removed: res.removed };
            if (res.branchKeptNotice) out.branchNotice = res.branchKeptNotice;
            return out;
          } catch (err) {
            return {
              success: false,
              removed: '',
              branchNotice: `Failed to remove worktree: ${err.message}`
            };
          }
        }
      })
    );

    // Tool: worktree_list
    ctx.tools.register(
      defineTool({
        name: 'worktree_list',
        description: 'Lists all active Git worktrees.',
        parameters: {},
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              worktrees: {
                type: 'array',
                required: true,
                items: {
                  type: 'object',
                  additionalProperties: true,
                  properties: {
                    path: { type: 'string', required: true },
                    branch: { type: 'string' },
                    head: { type: 'string' }
                  }
                }
              }
            }
          },
          render: (_args, value) => [
            {
              type: 'text',
              text: `Active worktrees:\n` + value.worktrees.map(w => `• ${w.path} (${w.branch || 'detached'})`).join('\n')
            }
          ]
        },
        async execute(_args, execCtx) {
          const root = resolveCwd(execCtx);
          try {
            const list = await listWorktrees(root);
            return { worktrees: list };
          } catch {
            return { worktrees: [] };
          }
        }
      })
    );

    // Tool: verify_deliverable (Enhanced with Pre-Commit Bugbot & Security Audit)
    ctx.tools.register(
      defineTool({
        name: 'verify_deliverable',
        description: 'Automated smoke test & validation tool. Verifies syntax, checks offline dependencies, runs Headless Chrome check, and audits for secret leaks and Anti-MenuGen entity amnesia.',
        parameters: {
          filePath: {
            type: 'string',
            required: true,
            description: 'Relative path to deliverable (e.g. "index.html" or "src/app.js")'
          },
          checkHeadless: {
            type: 'boolean',
            description: 'Whether to run a headless browser check for HTML pages (default: true)'
          }
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              ok: { type: 'boolean', required: true },
              status: { type: 'string', required: true },
              message: { type: 'string', required: true },
              errors: { type: 'array', items: { type: 'string' } },
              warnings: { type: 'array', items: { type: 'string' } }
            }
          },
          render: (_args, value) => [
            {
              type: 'text',
              text: `[SMOKE TEST ${value.status}] ${value.message}\n` +
                (value.errors?.length ? `\n❌ ERRORS:\n${value.errors.map(e => '  • ' + e).join('\n')}` : '') +
                (value.warnings?.length ? `\n⚠️ WARNINGS:\n${value.warnings.map(w => '  • ' + w).join('\n')}` : '')
            }
          ]
        },
        async execute(args, execCtx) {
          const sid = execCtx?.agent?.session?.id || 'default';
          const root = resolveCwd(execCtx);
          const fullPath = resolve(root, args.filePath);
          const errors = [];
          const warnings = [];

          if (!isInsideRoot(root, fullPath)) {
            return {
              ok: false,
              status: 'RED',
              message: 'Security error: file path cannot escape project root.',
              errors: [`Access denied for path outside repository: ${args.filePath}`],
              warnings: []
            };
          }

          try {
            await access(fullPath, constants.R_OK);
          } catch {
            return {
              ok: false,
              status: 'RED',
              message: `File not found: ${args.filePath}`,
              errors: [`File ${args.filePath} does not exist or is not readable`],
              warnings: []
            };
          }

          // 1. Pre-Commit Bugbot & Security Audit
          const secAudit = await runSecurityAudit(root, [args.filePath]);
          if (secAudit.secretsFound.length > 0) {
            for (const s of secAudit.secretsFound) {
              errors.push(`[BUGBOT SECURITY LEAK] Hardcoded ${s.leak.name} found at line ${s.leak.line} in ${s.file}`);
            }
          }

          if (secAudit.antiMenuGenWarnings.length > 0) {
            for (const w of secAudit.antiMenuGenWarnings) {
              warnings.push(`[ANTI-MENUGEN AMNESIA] ${w.warning.detail} (${w.file}:${w.warning.line})`);
            }
          }

          if (secAudit.sqlInjections.length > 0) {
            for (const sqli of secAudit.sqlInjections) {
              errors.push(`[SQL INJECTION RISK] Unparameterized query detected at line ${sqli.issue.line} in ${sqli.file}`);
            }
          }

          if (!secAudit.gitignoreIssues || secAudit.gitignoreIssues.length > 0) {
            if (secAudit.gitignoreIssues?.length) {
              warnings.push(`[.gitignore GAP] Missing protection for: ${secAudit.gitignoreIssues.join(', ')}`);
            }
          }

          const content = await readFile(fullPath, 'utf8');

          // 2. Syntax validation
          if (args.filePath.endsWith('.js') || args.filePath.endsWith('.mjs')) {
            try {
              await exec('node', ['-c', fullPath], { timeout: 10000 });
            } catch (err) {
              errors.push(`JavaScript Syntax Error: ${err.message || err.stderr}`);
            }
          } else if (args.filePath.endsWith('.json')) {
            try {
              JSON.parse(content);
            } catch (err) {
              errors.push(`JSON Syntax Error: ${err.message}`);
            }
          } else if (args.filePath.endsWith('.html')) {
            if (!content.includes('<!DOCTYPE html>') && !content.includes('<html')) {
              warnings.push('HTML file missing standard <!DOCTYPE html> declaration.');
            }

            const hasExternalScripts = /<script\s+[^>]*src=["']https?:\/\//i.test(content);
            const hasFallbackCheck = /typeof\s+[A-Za-z0-9_]+\s*!==?\s*['"]undefined['"]/i.test(content);
            if (hasExternalScripts && !hasFallbackCheck) {
              warnings.push('Deliverable relies on external CDN scripts without offline fallback. User may see white screen offline.');
            }

            // Zero Dead Code Check: detect orphaned files in src/
            try {
              const srcDir = resolve(root, 'src');
              if (existsSync(srcDir)) {
                const srcFiles = await readdir(srcDir);
                const unreferenced = srcFiles.filter(f => !f.startsWith('.') && !content.includes(f));
                if (unreferenced.length > 0) {
                  warnings.push(`Dead Code Detected: files in src/ (${unreferenced.join(', ')}) are not referenced by ${args.filePath}.`);
                }
              }
            } catch {}

            // Extract inline scripts and check syntax SAFELY
            const scriptRegex = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
            let match;
            let scriptIdx = 1;
            while ((match = scriptRegex.exec(content)) !== null) {
              const attrs = match[1] || '';
              const code = match[2]?.trim();
              if (/src\s*=/i.test(attrs)) continue;

              const typeMatch = attrs.match(/type\s*=\s*["']?([^"'\s>]+)["']?/i);
              const scriptType = typeMatch ? typeMatch[1].toLowerCase() : 'text/javascript';
              const isJs = ['text/javascript', 'application/javascript', 'module', 'text/ecmascript'].includes(scriptType);
              if (!isJs) continue;

              if (code) {
                if (scriptType === 'module') {
                  try {
                    const checkRes = spawnSync('node', ['--input-type=module', '--check'], {
                      input: code,
                      encoding: 'utf8',
                      timeout: 5000
                    });
                    if (checkRes.status !== 0) {
                      const firstErr = checkRes.stderr?.trim()?.split('\n')[0] || 'Module syntax error';
                      errors.push(`SyntaxError in inline <script type="module" #${scriptIdx}>: ${firstErr}`);
                    }
                  } catch (mErr) {
                    errors.push(`Syntax error checking module <script #${scriptIdx}>: ${mErr.message}`);
                  }
                } else {
                  try {
                    new vm.Script(code, { filename: `inline-script-${scriptIdx}.js` });
                  } catch (err) {
                    errors.push(`SyntaxError in inline <script #${scriptIdx}>: ${err.message}`);
                  }
                }
              }
              scriptIdx++;
            }

            // Headless browser check
            if (args.checkHeadless !== false && errors.length === 0) {
              const isWin = process.platform === 'win32';
              const isMac = process.platform === 'darwin';
              const browserPaths = isWin ? [
                'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
                'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
                'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
                'chrome', 'chromium', 'msedge'
              ] : isMac ? [
                '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
                '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
                '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
                'google-chrome', 'chromium'
              ] : [
                '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium',
                'google-chrome', 'chromium'
              ];

              let browserBin = null;
              for (const bPath of browserPaths) {
                try {
                  await access(bPath, constants.X_OK);
                  browserBin = bPath;
                  break;
                } catch {
                  if (!bPath.includes('/') && !bPath.includes('\\')) {
                    try {
                      await exec(isWin ? 'where' : 'which', [bPath]);
                      browserBin = bPath;
                      break;
                    } catch {}
                  }
                }
              }

              if (browserBin) {
                const BROWSER_ERROR_REGEX = /(?:Uncaught|ReferenceError|TypeError|SyntaxError)/i;
                const tempUserDataDir = join(tmpdir(), `dsh-chrome-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
                try {
                  const url = pathToFileURL(fullPath).href;
                  const { stderr } = await exec(browserBin, [
                    '--headless=new',
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-gpu',
                    '--no-first-run',
                    '--no-default-browser-check',
                    '--disable-background-networking',
                    '--disable-extensions',
                    '--disable-sync',
                    '--disable-default-apps',
                    '--mute-audio',
                    `--user-data-dir=${tempUserDataDir}`,
                    '--enable-logging=stderr',
                    '--v=1',
                    '--virtual-time-budget=2000',
                    '--dump-dom',
                    url
                  ], { timeout: 15000 });

                  if (stderr && BROWSER_ERROR_REGEX.test(stderr)) {
                    errors.push(`Browser Runtime Error: ${stderr.slice(0, 500)}`);
                  }
                } catch (bErr) {
                  if (bErr.killed || bErr.signal === 'SIGTERM' || bErr.message?.includes('timed out')) {
                    warnings.push('Headless browser smoke test timed out after 15s');
                  } else if (bErr.stderr && BROWSER_ERROR_REGEX.test(bErr.stderr)) {
                    errors.push(`Headless Browser Exception: ${bErr.stderr.slice(0, 500)}`);
                  }
                } finally {
                  try {
                    await rm(tempUserDataDir, { recursive: true, force: true });
                  } catch {}
                }
              }
            }
          }

          const ok = errors.length === 0;
          if (ok) {
            globalStrikeMachine.recordSuccess(sid);
            if (!sessionActiveWorktrees.has(sid) || sessionActiveWorktrees.get(sid).size === 0) {
              sessionGates.delete(sid);
            }
          } else {
            globalStrikeMachine.recordFailure(sid, {
              errorOutput: errors.join('\n')
            });
          }

          return {
            ok,
            status: ok ? 'GREEN' : 'RED',
            message: ok ? `✅ Deliverable verified (${args.filePath})` : `🔴 Verification failed with ${errors.length} error(s)`,
            errors,
            warnings
          };
        }
      })
    );

    // Tool: checkpoint_create
    ctx.tools.register(
      defineTool({
        name: 'checkpoint_create',
        description: 'Creates a lightweight Git checkpoint before merges or refactoring, enabling instant rollback if tests fail.',
        parameters: {
          label: {
            type: 'string',
            required: true,
            description: 'Short checkpoint label (e.g. "pre-merge", "pre-synthesis")'
          }
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              success: { type: 'boolean', required: true },
              checkpoint: { type: 'string', required: true }
            }
          },
          render: (_args, value) => [
            { type: 'text', text: `📌 Checkpoint created: ${value.checkpoint}` }
          ]
        },
        async execute(args, execCtx) {
          const root = resolveCwd(execCtx);
          return withRepoLock(root, async () => {
            if (!(await isGitRepository(root))) {
              return { success: false, checkpoint: `Current directory "${root}" is not a Git repository. Run "git init" to enable checkpoints.` };
            }
            const safeLabel = args.label.replace(/[^a-zA-Z0-9_-]/g, '_');
            const name = `vibe-ckpt-${safeLabel}`;
            const tempIndex = join(root, '.git', `vibe_ckpt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`);
            try {
              await exec('git', ['add', '-A'], { cwd: root, env: { ...process.env, GIT_INDEX_FILE: tempIndex } });
              const { stdout: treeSha } = await exec('git', ['write-tree'], { cwd: root, env: { ...process.env, GIT_INDEX_FILE: tempIndex } });
              let parentSha = '';
              try {
                const { stdout: headSha } = await exec('git', ['rev-parse', 'HEAD'], { cwd: root });
                parentSha = headSha.trim();
              } catch {}

              const commitArgs = ['commit-tree', treeSha.trim()];
              if (parentSha) commitArgs.push('-p', parentSha);
              commitArgs.push('-m', `vibe-checkpoint: ${safeLabel}`);
              const { stdout: commitSha } = await exec('git', commitArgs, { cwd: root });
              const targetRef = commitSha.trim();

              await exec('git', ['tag', '-f', name, targetRef], { cwd: root });
              return { success: true, checkpoint: name };
            } catch (err) {
              return { success: false, checkpoint: err.message };
            } finally {
              try {
                if (existsSync(tempIndex)) unlinkSync(tempIndex);
              } catch {}
            }
          });
        }
      })
    );

    // Tool: checkpoint_restore
    ctx.tools.register(
      defineTool({
        name: 'checkpoint_restore',
        description: 'Restores working directory to a previous Git checkpoint if a merge or synthesis caused regressions.',
        parameters: {
          label: {
            type: 'string',
            required: true,
            description: 'Checkpoint label to restore'
          }
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              success: { type: 'boolean', required: true },
              restoredTo: { type: 'string', required: true }
            }
          },
          render: (_args, value) => [
            { type: 'text', text: `↺ Restored to checkpoint: ${value.restoredTo}` }
          ]
        },
        async execute(args, execCtx) {
          const sid = execCtx?.agent?.session?.id || 'default';
          const root = resolveCwd(execCtx);
          return withRepoLock(root, async () => {
            if (!(await isGitRepository(root))) {
              return { success: false, restoredTo: `Current directory "${root}" is not a Git repository. Run "git init" to enable checkpoints.` };
            }
            const safeLabel = args.label.replace(/[^a-zA-Z0-9_-]/g, '_');
            const name = `vibe-ckpt-${safeLabel}`;
            try {
              const { stdout: status } = await exec('git', ['status', '--porcelain'], { cwd: root });
              if (status.trim()) {
                await exec('git', ['stash', 'push', '-u', '-m', `pre-restore-backup-${Date.now()}`], { cwd: root });
              }

              await exec('git', ['read-tree', '--reset', '-u', name], { cwd: root });

              try {
                const { stdout: pSha } = await exec('git', ['rev-parse', `${name}^1`], { cwd: root });
                if (pSha && pSha.trim()) {
                  await exec('git', ['reset', pSha.trim()], { cwd: root });
                } else {
                  await exec('git', ['reset', 'HEAD'], { cwd: root });
                }
              } catch {
                await exec('git', ['reset', 'HEAD'], { cwd: root });
              }

              globalStrikeMachine.recordSuccess(sid);
              return { success: true, restoredTo: name };
            } catch (err) {
              return { success: false, restoredTo: err.message };
            }
          });
        }
      })
    );
  }
}
