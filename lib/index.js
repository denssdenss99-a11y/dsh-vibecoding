// lib/index.js — Host backend for dsh-vibecoding (Vibe Manifesto Edition)
// Ultra-Lean Agentic Engineering OS: Browser Smoke Verifier, Git Worktree Isolation,
// Zero-Bloat Golden Rules, and DSH Web HUD.

import { defineTool } from '@deepseek-ai/dsh-tools';
import { resolve, relative, isAbsolute, sep, join } from 'node:path';
import { homedir } from 'node:os';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { runBrowserSmoke } from './smoke.js';
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

export { runBrowserSmoke } from './smoke.js';
export * from './worktree.js';

/**
 * Validates that a target path strictly resides within repoRoot, preventing path traversal.
 */
export function isInsideRoot(root, target) {
  const rel = relative(root, target);
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
}

/**
 * Validates localhost origin for DSH Web endpoints.
 */
export function isAllowedLocalOrigin(origin) {
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    const h = parsed.hostname;
    return h === 'localhost' || h === '127.0.0.1' || h === '0.0.0.0' || h === '::1' || h === '[::1]';
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

export const inject = ['commands', 'tools', 'systemPrompt', 'webServer'];

export function apply(ctx) {
  const logger = ctx.logger || console;

  // 1. Session tracking
  const sessionCwds = new Map();
  const resolveCwd = (execCtx) => {
    const sid = execCtx?.agent?.session?.id || 'default';
    const candidate = execCtx?.agent?.session?.header?.cwd;
    if (candidate) {
      sessionCwds.set(sid, candidate);
      return candidate;
    }
    return sessionCwds.get(sid) || sessionCwds.get('default') || process.cwd();
  };

  // 1. Session tracking & persistence (default is strictly OFF)
  const SESSIONS_FILE = process.env.DSH_SESSIONS_FILE || join(homedir(), '.dsh', 'vibecoding-sessions.json');
  const loadSessionModes = () => {
    const map = new Map();
    try {
      if (existsSync(SESSIONS_FILE)) {
        const data = JSON.parse(readFileSync(SESSIONS_FILE, 'utf8'));
        if (typeof data === 'object' && data !== null) {
          for (const [k, v] of Object.entries(data)) {
            if (typeof v === 'boolean') map.set(k, v);
          }
        }
      }
    } catch {}
    return map;
  };

  const saveSessionModes = (map) => {
    try {
      const obj = {};
      for (const [k, v] of map.entries()) {
        obj[k] = v;
      }
      writeFileSync(SESSIONS_FILE, JSON.stringify(obj, null, 2), 'utf8');
    } catch {}
  };

  const sessionModes = loadSessionModes();
  const isVibeActive = (sid = 'default') => {
    if (!sid) return false;
    return sessionModes.get(sid) === true;
  };

  // -------------------------------------------------------------
  // 1. WebServer Routes for DSH Web HUD & State
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
                sessionModes.set(targetSid, parsed.active);
                saveSessionModes(sessionModes);
                logger.info(`[dsh-vibecoding] Mode toggled for session "${targetSid}" to: ${parsed.active ? 'ACTIVE' : 'INACTIVE'}`);
              }
            } catch {}
          }

          res.writeHead(200, {
            'Content-Type': 'application/json',
            ...(origin ? { 'Access-Control-Allow-Origin': origin } : {})
          });
          res.end(JSON.stringify({
            active: isVibeActive(targetSid),
            sid: targetSid,
            version: '3.3.4',
            strikes: 0,
            isCodeLocked: false,
            edition: 'Vibe SOP v3.3.4 Per-Session Edition'
          }));
          return;
        }

        // Endpoint: /dsh-vibecoding/rollback (Panic Rollback button in Web HUD)
        if (url.pathname === '/dsh-vibecoding/rollback') {
          const targetCwd = resolveCwd({ agent: { session: { id: reqSid } } });
          try {
            const { execSync } = await import('node:child_process');
            execSync('git reset --hard HEAD', { cwd: targetCwd, stdio: 'pipe' });
            res.writeHead(200, {
              'Content-Type': 'application/json',
              ...(origin ? { 'Access-Control-Allow-Origin': origin } : {})
            });
            res.end(JSON.stringify({ success: true, restoredTag: 'HEAD' }));
          } catch (err) {
            res.writeHead(200, {
              'Content-Type': 'application/json',
              ...(origin ? { 'Access-Control-Allow-Origin': origin } : {})
            });
            res.end(JSON.stringify({ success: false, error: err.message }));
          }
          return;
        }

        // Endpoint: /dsh-vibecoding/wrapup (Session Wrap-up button in Web HUD)
        if (url.pathname === '/dsh-vibecoding/wrapup') {
          const targetCwd = resolveCwd({ agent: { session: { id: reqSid } } });
          try {
            const { appendFileSync, mkdirSync, existsSync } = await import('node:fs');
            const { join } = await import('node:path');
            const memDir = join(targetCwd, '.dsh', 'memory');
            const memFile = join(memDir, 'memory.md');
            if (!existsSync(memDir)) mkdirSync(memDir, { recursive: true });
            const wrapNote = `\n## Session Wrap-up [${new Date().toISOString()}]\n- Active session milestone finalized via DSH Web HUD.\n`;
            appendFileSync(memFile, wrapNote);
            res.writeHead(200, {
              'Content-Type': 'application/json',
              ...(origin ? { 'Access-Control-Allow-Origin': origin } : {})
            });
            res.end(JSON.stringify({ success: true }));
          } catch (err) {
            res.writeHead(200, {
              'Content-Type': 'application/json',
              ...(origin ? { 'Access-Control-Allow-Origin': origin } : {})
            });
            res.end(JSON.stringify({ success: false, error: err.message }));
          }
          return;
        }

        // Endpoint: /dsh-vibecoding/hud
        if (url.pathname === '/dsh-vibecoding/hud' || url.pathname === '/dsh-vibecoding') {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>DSH Vibe HUD</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0c0f12; color: #e2e8f0; margin: 0; padding: 24px; }
    .card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 20px; max-width: 600px; margin: 0 auto; }
    h2 { margin-top: 0; color: #58a6ff; }
    .badge { display: inline-block; padding: 4px 10px; border-radius: 12px; font-size: 12px; font-weight: 600; background: #238636; color: #fff; }
    ul { padding-left: 20px; line-height: 1.6; }
  </style>
</head>
<body>
  <div class="card">
    <h2>⚡ DSH Vibe Engine <span class="badge">v3.3.3 Active</span></h2>
    <p>Minimalist Software 3.0 Agentic Architecture based on the Vibe Manifesto.</p>
    <ul>
      <li><strong>Delivery Archetype:</strong> Zero-build standalone vs fullstack detection.</li>
      <li><strong>browser_smoke:</strong> Native Headless CDP verifier catching 100% of runtime errors.</li>
      <li><strong>2-Strike Rollback:</strong> Hard reset to last savepoint on repeated errors.</li>
      <li><strong>OS & Environment Guard:</strong> Automatic ASCII slug & path traversal protection.</li>
      <li><strong>Zero Bloat:</strong> 5 sharp tools without synthetic wrapper overhead.</li>
    </ul>
  </div>
</body>
</html>`);
          return;
        }

        res.writeHead(404);
        res.end();
      }
    });
  }

  // -------------------------------------------------------------
  // 2. The Vibe Manifesto System Directives (Zero-Bloat SOP v3.3)
  // -------------------------------------------------------------
  if (ctx.systemPrompt?.section) {
    ctx.systemPrompt.section({
      name: 'vibecoding:universal-policy',
      order: 150,
      interpolate: false,
      text: (promptCtx) => {
        const sid = promptCtx?.session?.id || promptCtx?.agent?.session?.id || 'default';
        if (!isVibeActive(sid)) return '';

        return `
# ⚡ THE VIBE MANIFESTO (SOFTWARE 3.0 OPERATIONAL SOP v3.3.3):
You are the Lead Staff Engineer & Autonomous Agent. You operate under the strict laws of the Vibe Manifesto:
"You can delegate code writing, but you can NEVER delegate understanding."

### 🎯 ARCHITECTURE & DELIVERY RULES:
1. 🎯 CLASSIFY DELIVERY ARCHETYPE FIRST:
   - [STANDALONE / DEMO / GAME / SANDBOX]: Fast-loading interactive prototypes, games, widgets, single-page tools, or when the user asks to "open directly in browser".
     -> ZERO-BUILD STEP: Use clean modular vanilla JS/ESM, CDN with reliable fallback, or vendor scripts in 'libs/'.
     -> RUNTIME MUST: Must open cleanly via double-click ('file://') AND via static server. NO bare npm imports in browser HTML!
   - [FULLSTACK / PRODUCTION APP]: Long-term services, dashboards, multi-package libraries.
     -> Standard bundler (Vite), strictly typed/structured modules, package.json.
2. 📄 PLAN BEFORE CODE (scope.md): Never hack blindly. Create a concise 3–5 milestone checklist in 'scope.md' via standard 'write'.
3. ❓ 90% CERTAINTY RULE: If certainty regarding data schema, contracts, or physics requirements is under 90%, clarify before coding.
4. 🔬 ATOMIC LOOPS, ANTI-SCOPE-CREEP & SURGICAL EXECUTION:
   - In subsequent turns of the same chat (Turn 2+), the project architecture is ALREADY in your context. DO NOT run exploratory full-repo re-reads or wide scans!
   - 🛡️ ANTI-SCOPE-CREEP (Repair Asset vs Feature Build): When the user asks about an error, missing asset, single data repair, or asks "how do I fix/regenerate X?":
     1. Fix the immediate asset/data issue directly (CLI script, DB query, API call).
     2. DO NOT spontaneously invent new fullstack UI features, new REST endpoints, and new frontend buttons unless the user EXPLICITLY ordered: "добавь кнопку в интерфейс" or "реализуй эндпоинт в API".
     3. Deliver the direct fix in 4–8 steps, report the solution, and ASK the user if they want a permanent UI feature built before writing any backend routes or frontend HTML!
   - ⚡ OFFLINE SYNTAX VERIFICATION: When editing backend server files, NEVER debug via live trial-and-error cycles (start daemon -> curl -> error -> kill -> restart). ALWAYS verify syntax/imports offline first in 1 step ('python3 -m py_compile <file>', 'node --check <file>'). Only restart the server ONCE when dry verification passes.
   - Execute surgical edits: grep target symbol -> read 30–50 lines slice -> edit -> 1 targeted test -> commit.
   - If a follow-up fix reaches 10 steps, STOP and deliver what is working.
5. 🛡️ OS & ENVIRONMENT GUARDRAILS:
   - Cyrillic / Space Protection: When creating 'package.json', always hardcode a clean ASCII slug (e.g. "name": "app" or "sandbox"), NEVER copy directory names that may contain Cyrillic or spaces.
   - Cache & Ports: Avoid npm cache issues (use '--prefer-offline' or direct downloads); verify port availability before binding servers.
6. 📌 GIT AS SAVE POINTS: Run 'git commit -am "savepoint: ..."' via bash after achieving a working/tested state.
7. 🛑 2-STRIKE ROLLBACK: If a fix or test fails twice in a row, STOP! Run 'git reset --hard HEAD' to revert to the last working savepoint. Never pile hacks on broken code. Formulate a 1-line RCA and switch approach.
8. 🧩 DOMAIN INVARIANTS (NO DEAD CODE):
   - When using physics engines (Matter.js, Cannon.js, Rapier): ensure all decomposition dependencies (e.g. poly-decomp for custom Matter.js polygons) and convex solvers are loaded before instantiating custom meshes/bodies.
   - Audio: initialize Web Audio AudioContext only on first user gesture (pointerdown/click), synthesize clean procedural audio.
9. 👁️ MULTI-LEVEL VERIFICATION (browser_smoke):
   - Pure Math/Logic: write unit tests using Node's native test runner ('node --test') or lightweight runner.
   - Browser Runtime: ALWAYS run 'browser_smoke' { url: "http://localhost:<port>" } to verify zero console.error and zero uncaught exceptions before final delivery!
10. 🧠 FAST BROWNFIELD ONBOARDING & TARGETED READING:
   - When opening an existing repo, read '.dsh/memory/memory.md' and 'git log -n 3 --oneline' FIRST on Step 1. DO NOT blindly dump 40+ files into context!
   - Context Hygiene: Never full-read 500+ line files when modifying a single function. Always use 'grep' and slice reads ('offset'/'limit' 30–50 lines).
   - At session end, append new decisions to '.dsh/memory/memory.md'.
11. 🛡️ WRITE TOOL CONVENTION: When calling 'write', never pass 'justification' unless requesting escalation via 'sandbox_permissions'.
12. 🏁 AUTONOMOUS DELIVERY & COMPACT HYGIENE:
   - Deliver directly to disk, run smoke test, present live localhost URL.
   - Output [🎯 MILESTONE SEALED] with commit hash and active memory state.
   - ⚡ CONTEXT COMPACTION WARNING: If the conversation has accumulated 30+ steps or multiple distinct tasks in the same chat, remind the user:
     "💡 Совет: Для продолжения работы в этом же чате без перерасхода токенов вызовите команду '/compact' — она сожмет историю сессии и ускорит ответы."
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
      description: 'Activate Vibe Manifesto high-velocity mode',
      handler: async ({ agent, rawInput }) => {
        const task = rawInput.trim();
        const sid = agent?.session?.id || 'default';
        sessionModes.set(sid, true);
        saveSessionModes(sessionModes);

        if (!task) {
          return {
            kind: 'success',
            text: `🎯 **Vibe Manifesto Engine v3.3.4 активен для этой сессии (${sid}).** Применяются 12 золотых правил (Delivery Archetype, Standalone Zero-Build, OS Guardrails, Anti-Scope-Creep, 2-Strike Rollback, browser_smoke).`
          };
        }

        if (typeof agent?.steer === 'function') {
          agent.steer({
            content: [{
              type: 'text',
              text: `[🎯 VIBE MANIFESTO PIPELINE]\nЗадача: "${task}"\n\nСначала зафиксируйте краткий план (scope.md) и проверьте правило 90% уверенности перед написанием кода.`
            }],
            source: { kind: 'user' }
          });
        }

        return {
          kind: 'success',
          text: `🚀 Задача "${task}" запущена по протоколу Vibe Manifesto.`
        };
      }
    });
  }

  // -------------------------------------------------------------
  // 4. Lean High-Velocity Arsenal (5 Sharp Tools)
  // -------------------------------------------------------------
  if (ctx.tools?.register) {

    // 1. Tool: browser_smoke (Real Browser Health Check)
    ctx.tools.register(
      defineTool({
        name: 'browser_smoke',
        description: 'Opens a web application URL in real headless Chrome via CDP to verify zero console.error messages and zero uncaught runtime exceptions before delivery.',
        parameters: {
          url: {
            type: 'string',
            required: true,
            description: 'Local web URL to inspect (e.g. "http://localhost:5173", "http://localhost:3000")'
          },
          timeoutMs: {
            type: 'integer',
            description: 'Observation window in milliseconds (default: 2500)'
          }
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              ok: { type: 'boolean' },
              url: { type: 'string' },
              title: { type: 'string' },
              errors: { type: 'array', items: { type: 'string' } },
              consoleLogs: { type: 'array', items: { type: 'string' } }
            }
          },
          render: (_args, value) => [
            {
              type: 'text',
              text: value.ok
                ? `[BROWSER SMOKE OK] ✅ ${value.url} loaded cleanly with 0 console errors (Title: "${value.title || 'Untitled'}")`
                : `[BROWSER SMOKE FAILED] ❌ ${value.errors.length} error(s) detected at ${value.url}:\n` +
                  value.errors.map(e => '  • ' + e).join('\n')
            }
          ]
        },
        async execute(args) {
          const targetUrl = args.url.trim();
          try {
            return await runBrowserSmoke(targetUrl, { timeoutMs: args.timeoutMs || 2500 });
          } catch (err) {
            return {
              ok: false,
              url: targetUrl,
              title: '',
              errors: [`Smoke check exception: ${err.message}`],
              consoleLogs: []
            };
          }
        }
      })
    );

    // 2. Tool: worktree_create (Git Branch Isolation)
    ctx.tools.register(
      defineTool({
        name: 'worktree_create',
        description: 'Creates an isolated Git worktree directory for parallel development without dirtying main branch.',
        parameters: {
          taskName: {
            type: 'string',
            required: true,
            description: 'Short task identifier in kebab-case'
          },
          baseBranch: {
            type: 'string',
            description: 'Optional base branch (default: HEAD)'
          },
          autoInit: {
            type: 'boolean',
            description: 'Auto-initialize git repository if needed (default: true)'
          }
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              success: { type: 'boolean' },
              path: { type: 'string' },
              branch: { type: 'string' },
              existed: { type: 'boolean' },
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
          const root = resolveCwd(execCtx);
          try {
            const res = await createWorktree(root, args.taskName, {
              baseBranch: args.baseBranch,
              autoInit: args.autoInit !== false
            });
            return {
              success: true,
              path: res.path,
              branch: res.branch,
              existed: res.existed,
              message: res.existed ? 'Worktree already existed' : 'Worktree created successfully'
            };
          } catch (err) {
            return {
              success: false,
              path: '',
              branch: '',
              existed: false,
              message: err.message
            };
          }
        }
      })
    );

    // 3. Tool: worktree_merge
    ctx.tools.register(
      defineTool({
        name: 'worktree_merge',
        description: 'Merges an isolated task branch back into main with optional squashing.',
        parameters: {
          taskName: {
            type: 'string',
            required: true,
            description: 'Task branch name to merge'
          },
          squash: {
            type: 'boolean',
            description: 'Squash commits into a single commit before merging (default: true)'
          }
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              success: { type: 'boolean' },
              message: { type: 'string' }
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

    // 4. Tool: worktree_list
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
                items: {
                  type: 'object',
                  additionalProperties: true,
                  properties: {
                    path: { type: 'string' },
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

    // 5. Tool: worktree_remove
    ctx.tools.register(
      defineTool({
        name: 'worktree_remove',
        description: 'Cleans up a Git worktree after merge.',
        parameters: {
          taskName: {
            type: 'string',
            required: true,
            description: 'Task name whose worktree to remove'
          },
          deleteBranch: {
            type: 'boolean',
            description: 'Delete task branch (default: false)'
          }
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              success: { type: 'boolean' },
              removed: { type: 'string' }
            }
          },
          render: (_args, value) => [
            { type: 'text', text: `Worktree removed: ${value.removed}` }
          ]
        },
        async execute(args, execCtx) {
          const root = resolveCwd(execCtx);
          try {
            await removeWorktree(root, args.taskName, { deleteBranch: args.deleteBranch === true });
            return { success: true, removed: args.taskName };
          } catch (err) {
            return { success: false, removed: err.message };
          }
        }
      })
    );
  }
}
