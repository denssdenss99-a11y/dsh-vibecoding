// lib/index.js — Host backend for dsh-vibecoding
// Universal Multi-Agent Orchestrator with Dynamic N-Task Parallelism & Invisible Mode Activation.

import { defineTool } from '@deepseek-ai/dsh-tools';
import { execFile, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve, relative, isAbsolute, sep, join, basename } from 'node:path';
import { readFile, access } from 'node:fs/promises';
import { constants, existsSync, unlinkSync } from 'node:fs';
import vm from 'node:vm';
import { pathToFileURL } from 'node:url';
import {
  createWorktree,
  listWorktrees,
  removeWorktree,
  mergeWorktree,
  sanitizeTaskName,
  withRepoLock
} from './worktree.js';

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
    return parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
  } catch {
    return false;
  }
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
  // Tracks active tasks and open worktrees per session.
  // When all worktrees for a cycle are removed, the gatekeeper automatically re-arms
  // so the agent does not skip the interview on future turns!
  const sessionGates = new Map(); // Map<sid, { unlocked: boolean, taskName: string }>
  const sessionActiveWorktrees = new Map(); // Map<sid, Set<string>>

  const isGateUnlocked = (execCtx) => {
    const sid = execCtx?.agent?.session?.id || 'default';
    return sessionGates.get(sid)?.unlocked === true;
  };

  // -------------------------------------------------------------
  // 1. WebServer Route for Silent Mode Toggle
  // -------------------------------------------------------------
  if (ctx.webServer?.register) {
    ctx.webServer.register({
      kind: 'prefix',
      path: '/dsh-vibecoding',
      async handler(req, res) {
        const url = new URL(req.url, 'http://localhost');
        if (url.pathname === '/dsh-vibecoding/state') {
          // Strict local origin validation (CSRF Guard)
          const origin = req.headers.origin || '';
          const isLocal = isAllowedLocalOrigin(origin);
          const reqSid = url.searchParams.get('sid') || 'default';

          if (!isLocal) {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Forbidden: non-local origin rejected' }));
            return;
          }

          // Handle CORS preflight OPTIONS request
          if (req.method === 'OPTIONS') {
            res.writeHead(204, {
              ...(origin ? { 'Access-Control-Allow-Origin': origin } : {}),
              'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
              'Access-Control-Allow-Headers': 'Content-Type'
            });
            res.end();
            return;
          }

          if (req.method === 'POST') {
            // Read body with 64KB size limit to prevent memory exhaustion
            let body = '';
            let tooLarge = false;
            for await (const chunk of req) {
              body += chunk;
              if (body.length > 65536) {
                tooLarge = true;
                break;
              }
            }

            if (tooLarge) {
              res.writeHead(413, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Payload too large' }));
              return;
            }

            let targetSid = reqSid;
            try {
              const parsed = JSON.parse(body);
              if (typeof parsed.active === 'boolean') {
                targetSid = parsed.sid || reqSid;
                setBoundedMap(sessionModes, targetSid, parsed.active);
                if (targetSid === 'default') {
                  defaultVibeMode = parsed.active;
                }
                if (parsed.active) {
                  // Re-arm gatekeeper when mode is enabled
                  sessionGates.delete(targetSid);
                }
                logger.info(`[dsh-vibecoding] Mode toggled for session "${targetSid}" to: ${parsed.active ? 'ACTIVE' : 'INACTIVE'}`);
              }
            } catch {}
          }

          res.writeHead(200, {
            'Content-Type': 'application/json',
            ...(origin ? { 'Access-Control-Allow-Origin': origin } : {}),
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type'
          });
          res.end(JSON.stringify({ active: isVibeActive(targetSid || reqSid) }));
          return;
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

        return `
# ⚡ UNIVERSAL MULTI-AGENT HARVESTER PROTOCOL (MANDATORY OPERATING POLICY):
You are the Lead Orchestrator of an autonomous multi-agent engineering combine. Your objective is maximum throughput, zero hallucination, and extreme token efficiency in the main orchestrator context.

You execute ANY non-trivial user task strictly through the following 5 phases:

### 🛑 PHASE 1: MANDATORY CLARIFYING INTERVIEW & DYNAMIC ALLOCATION
- ПРИ ПОЛУЧЕНИИ ЛЮБОЙ НОВОЙ ЗАДАЧИ ИЛИ КРУПНОГО ЭТАПА:
  * YOU ARE STRICTLY FORBIDDEN from generating final code, building solutions, or writing full files without scoping.
  * Even if the user says "начни с нуля", "делай с самого начала", or provides instructions, conduct scoping first unless the user explicitly said "без вопросов" / "делай без вопросов".

- 📊 DYNAMIC MATRIX OF COMPLEXITY & QUESTION BUDGET:
  Before asking, categorize the task scale and allocate questions accordingly:
  * [XS / S] Minor tweak, isolated bugfix, or prompt with 100% complete specifications:
    - Budget: 0–1 question.
    - If zero ambiguity exists, immediately call 'complete_interview' without asking redundant questions.
  * [M] Single standalone feature, UI component, utility script:
    - Budget: 1–2 questions targeting key edge cases, integration points, or data models.
  * [L] Full-featured module, multi-view UI, service integration:
    - Budget: 2–3 questions distributed across distinct architectural axes.
  * [XL] Complex full-stack app, multi-tier system, interactive platform:
    - Budget: 3–5 questions covering core architecture, mechanics, and design direction.

- 🧭 CATEGORICAL DISTRIBUTION (THE 4 PILLARS):
  Distribute questions across different functional dimensions. NEVER ask redundant questions within the same category:
  1. 🏗 ARCHITECTURE & TECH STACK: Libraries, data formats, delivery format (standalone vs modular), offline vs external assets.
  2. ⚙️ LOGIC & MECHANICS: Core algorithms, state transitions, interaction controls, edge case handling.
  3. 🎨 VISUAL / UX / STYLE: Aesthetic style, color schemes, responsive viewport, animation feel.
  4. ⚡ CONSTRAINTS & ACCEPTANCE: Performance budget, offline-first constraints, acceptance criteria.
  *(Rule: Only spend questions on pillars where there is real ambiguity. Skip axes already specified by the user).*

- 🔄 ADAPTIVE ITERATIONS (FOLLOW-UP LOGIC):
  * Initial pass: Ask the initial categorized questions via 'ask_user_question' with clear options.
  * Follow-up pass: If the user's answers introduce new ambiguous forks, you may run ONE quick follow-up turn (1–2 focused questions) to finalize choices BEFORE execution.
  * Gate Unlock: Once the scope is resolved, call 'complete_interview' to formally unlock Phase 2-5.

### 📄 PHASE 2: SPECIFICATION & DYNAMIC N-SUBTASK DECOMPOSITION
- Call 'complete_interview' to formally unlock the pipeline.
- Create 'docs/specs/<task-name>.md' detailing:
  1. User confirmed specs & architecture.
  2. Assessed Complexity (XS/S/M/L/XL).
  3. Optimal decomposition into N independent subtasks (N = 1 for S, N = 2 to 5+ for M/L/XL):
     - Worker 1: Core Data Models & Validation Logic
     - Worker 2: Service Layer & Business Workflows
     - Worker 3: User Interface & Presentation Components
  4. Clean zero-conflict contracts: Each worker writes ONLY to its designated module or branch.

### 🔴 PHASE 3: VERIFICATION CONTRACT FIRST (TDD / ATDD)
- Code: Create tests in 'tests/<subtask>.test.js'. Run 'run_tdd_cycle' and confirm RED failure.
- Auto-Commit: Ensure test contracts in 'tests/' or specs in 'docs/specs/' are saved before Phase 4 so isolated worktrees inherit them.
- Non-code tasks: Establish acceptance rubric before writing deliverables.

### 🌿 PHASE 4: ISOLATED WORKSPACES
- Create isolated Git worktree for each subtask via 'worktree_create' (.worktrees/<subtask-name>).

### ⚡ PHASE 5: PARALLEL HARVESTER SWARM & SMOKE TEST
- DO NOT DO ALL WORK YOURSELF IN A SINGLE SERIAL THREAD!
- Spawn subagents CONCURRENTLY using 'subagent' tool (with run_in_background: true).
- Use 'create_worker_brief' to pass lean slates (Goal, target file, exact API interface, test command). Minimal tokens, zero chat bloat.
- When workers finish:
  * Create snapshot: 'checkpoint_create' (label 'pre-synthesis').
  * Merge worker branches via 'worktree_merge' or synthesize modules into entry points.
  * MANDATORY SMOKE TEST: Run 'verify_deliverable' on deliverables. Fix any errors reported.
  * Once verified GREEN: Clean up worktrees ('worktree_remove') and deliver to user.

### 🔄 MULTI-TURN COMBINE (ПОВТОРНОЕ ИСПОЛЬЗОВАНИЕ РОЯ НА ЛЮБОМ ХОДЕ):
- Протокол комбайна действует НА ПРОТЯЖЕНИИ ВСЕГО ДИАЛОГА!
- Когда пользователь на последующих ходах (2, 5, 20+) даёт новую комплексную задачу:
  * ЗАПРЕЩЕНО делать всё в один линейный поток через одиночные скрипты!
  * ДЕКОМПОЗИРУЙ задачу на независимые параллельные части и запускай рой через 'subagent' (run_in_background: true).
  * После завершения цикла и удаления всех worktrees гейткипер автоматически взводится снова для следующей задачи!

### 🛡️ SAFE MUTATE GUARD (ЗАЩИТА ОТ ВАНДАЛИЗМА — ЗАПРОС РАЗРЕШЕНИЯ):
- **КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО удалять что-либо молча!** (файлы, секции, компоненты, страницы, записи в БД).
- Если для выполнения задачи требуется удалить существующий элемент:
  * ТЫ ОБЯЗАН СНАЧАЛА СПРОСИТЬ РАЗРЕШЕНИЕ У ПОЛЬЗОВАТЕЛЯ НА РУССКОМ ЯЗЫКЕ (через 'ask_user_question' или прямым текстом в чате).
  * Укажи: что именно удаляется, причину и что появится взамен.
  * Удаление разрешено ТОЛЬКО после явного согласия пользователя. Без согласия — скрытие (Hide/Черновик), стилизация или замена текста.

### 🌐 ПРАВИЛО ДЛЯ ВНЕШНИХ ПЛАТФОРМ И БРАУЗЕРА (CMS / SAAS / WEB):
- **Разделяй генерацию контента и браузерное исполнение**:
  1. Рой субагентов параллельно формирует готовые контентные пакеты локально на диске.
  2. Браузерная автоматизация (Playwright / скрипты):
     - Браузер запускается ОДИН раз в постоянном профиле.
     - НЕ ЗАКРЫВАТЬ браузер между операциями, чтобы не сбрасывать авторизацию.
     - После входа пользователя скрипт накатывает готовые пакеты последовательно и аккуратно.
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
        sessionGates.delete(sid); // Re-arm gatekeeper for new scope

        if (!task) {
          return {
            kind: 'success',
            text: `🎯 **Universal Vibe Mode включен.** Любая задача будет выполняться через 5-этапный оркестратор (опрос → спека на N задач → контракт → изоляция → параллельные воркеры).`
          };
        }

        if (typeof agent?.steer === 'function') {
          agent.steer({
            content: [{
              type: 'text',
              text: `[🎯 УНИВЕРСАЛЬНЫЙ VIBE-РЕЖИМ]\nЗадача: "${task}"\n\n⚠️ ПРАВИЛО ФАЗЫ 1: Запрещено выдавать финальный результат сразу!\nЗадай 1-3 конкретных уточняющих вопроса через ask_user_question, чтобы зафиксировать требования перед началом работы.`
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
  // 4. Tools for Verification & Worktrees
  // -------------------------------------------------------------
  if (ctx.tools?.register) {
    // Tool: run_tdd_cycle
    ctx.tools.register(
      defineTool({
        name: 'run_tdd_cycle',
        description: 'Runs automated project tests to verify RED (failing contract) or GREEN (passing) status.',
        parameters: {
          testCommand: {
            type: 'string',
            required: true,
            description: 'Test command to run (e.g. "npm test", "pytest", "cargo test")'
          },
          cwd: {
            type: 'string',
            description: 'Optional working directory relative to project root (e.g. ".worktrees/task-1")'
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
                required: true,
                description: 'GREEN if passed, RED if failed'
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
          const root = resolveCwd(execCtx);
          const runDir = args.cwd ? resolve(root, args.cwd) : root;

          // Security: Directory traversal guard using isInsideRoot
          if (!isInsideRoot(root, runDir)) {
            return {
              status: 'RED',
              message: 'Security error: working directory cannot escape project root.',
              output: `Invalid cwd: ${args.cwd}`,
              exitCode: 1
            };
          }

          // Security: Block shell metacharacters across all platforms
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
            return {
              status: 'RED',
              message: 'Empty test command provided.',
              output: '',
              exitCode: 1
            };
          }

          const cmd = matchArgs[0];
          const baseCmd = basename(cmd).toLowerCase().replace(/\.(exe|cmd|bat|ps1)$/, '');

          const ALLOWED_TEST_RUNNERS = new Set([
            'npm', 'npx', 'pnpm', 'yarn', 'bun', 'bunx',
            'node', 'deno',
            'pytest', 'python', 'python3',
            'cargo', 'go', 'gradle', 'mvn',
            'vitest', 'jest', 'mocha', 'playwright', 'cypress', 'ava', 'tap', 'tsc'
          ]);

          if (!ALLOWED_TEST_RUNNERS.has(baseCmd)) {
            return {
              status: 'RED',
              message: `Security error: command "${cmd}" is not in the allowed test runner whitelist (${Array.from(ALLOWED_TEST_RUNNERS).join(', ')}).`,
              output: `Blocked executable: ${cmd}`,
              exitCode: 1
            };
          }

          const cmdArgs = matchArgs.slice(1).map(arg => {
            // Strip outer quotes from argument: "value" or 'value'
            if ((arg.startsWith('"') && arg.endsWith('"')) || (arg.startsWith("'") && arg.endsWith("'"))) {
              return arg.slice(1, -1);
            }
            // Strip quotes from option arguments: --grep="my test" -> --grep=my test
            const optMatch = arg.match(/^(--?[a-zA-Z0-9_-]+=)(["'])(.*)\2$/);
            if (optMatch) {
              return optMatch[1] + optMatch[3];
            }
            return arg;
          });

          // Block direct code execution flags for language runtimes
          if (['node', 'python', 'python3', 'deno'].includes(baseCmd)) {
            const hasEvalFlag = cmdArgs.some(arg =>
              arg === '-e' || arg === '--eval' || arg === '-c' ||
              arg.startsWith('-c=') || arg.startsWith('--eval=')
            );
            if (hasEvalFlag) {
              return {
                status: 'RED',
                message: 'Security error: direct code execution flags (-e, --eval, -c) are not allowed in testCommand.',
                output: `Blocked arguments: ${cmdArgs.join(' ')}`,
                exitCode: 1
              };
            }
          }

          try {
            const isWindows = process.platform === 'win32';
            const { stdout, stderr } = await exec(cmd, cmdArgs, {
              cwd: runDir,
              env: { ...process.env, CI: 'true', FORCE_COLOR: '0' },
              timeout: 120000,
              maxBuffer: 10 * 1024 * 1024,
              shell: isWindows
            });

            return {
              status: 'GREEN',
              message: '✅ Tests/Checks passed!',
              output: stdout || stderr || '(No output)',
              exitCode: 0
            };
          } catch (err) {
            const output = [err.stdout, err.stderr, err.message].filter(Boolean).join('\n');
            const numericExitCode = typeof err.code === 'number' ? err.code : 1;
            const isNotFound = err.code === 'ENOENT';
            return {
              status: 'RED',
              message: isNotFound ? `🔴 Command not found: "${cmd}"` : '🔴 Verification failed (contract red or issues found).',
              output: output.slice(-4000),
              exitCode: numericExitCode
            };
          }
        }
      })
    );

    // Tool: complete_interview (Phase 1 Gatekeeper Unlock)
    ctx.tools.register(
      defineTool({
        name: 'complete_interview',
        description: 'Unlocks Phase 2-5 after clarifying requirements with the user. Enforces Phase 1 Gatekeeper so worktrees cannot be created prematurely.',
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
            description: 'Assessed task complexity level (XS, S, M, L, XL)'
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
            { type: 'text', text: `🔓 ${value.message}` }
          ]
        },
        async execute(args, execCtx) {
          const sid = execCtx?.agent?.session?.id || 'default';
          setBoundedMap(sessionGates, sid, { unlocked: true, taskName: args.taskName });
          return {
            gateUnlocked: true,
            message: `Phase 1 Gatekeeper UNLOCKED for "${args.taskName}" [Complexity: ${args.complexity || 'M'}]. You may now proceed to Phase 2 (specs), Phase 3 (tests), and Phase 4 (worktrees). Planned subtasks: ${args.subtaskCount || 'dynamic'}.`
          };
        }
      })
    );

    // Tool: create_worker_brief (Token-Saving Lean Brief Generator)
    ctx.tools.register(
      defineTool({
        name: 'create_worker_brief',
        description: 'Generates an ultra-compact, token-efficient prompt for subagents. Strips chat bloat, passing ONLY strict goal, target file, interface contract, and verification command.',
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
              message: '🛑 PHASE 1 GATEKEEPER ACTIVE: Запрещено создавать воркдеревья до проведения интервью с пользователем! Задайте ключевые уточняющие вопросы через ask_user_question и зафиксируйте ответы вызовом complete_interview. (Если пользователь сразу просил делать без вопросов — вызовите complete_interview с пометкой direct_request).'
            };
          }

          const root = resolveCwd(execCtx);
          const safeName = sanitizeTaskName(args.taskName);

          try {
            const res = await createWorktree(root, args.taskName, args.baseBranch || 'HEAD');

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

    // Tool: worktree_merge
    ctx.tools.register(
      defineTool({
        name: 'worktree_merge',
        description: 'Merges a completed task branch from an isolated Git worktree back into current HEAD.',
        parameters: {
          taskName: {
            type: 'string',
            required: true,
            description: 'Task name whose branch to merge'
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

            // Multi-turn Gatekeeper Lifecycle:
            // When all worktrees for this cycle are cleaned up, automatically re-arm gatekeeper!
            const activeSet = sessionActiveWorktrees.get(sid);
            if (activeSet) {
              activeSet.delete(safeName);
              if (activeSet.size === 0) {
                sessionGates.delete(sid);
                logger.info(`[dsh-vibecoding] All worktrees cleaned up for session "${sid}". Gatekeeper re-armed for next turn.`);
              }
            }

            return { success: true, removed: res.removed, branchNotice: res.branchKeptNotice };
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
          } catch (err) {
            return { worktrees: [] };
          }
        }
      })
    );

    // Tool: verify_deliverable (Automated Smoke Verification)
    ctx.tools.register(
      defineTool({
        name: 'verify_deliverable',
        description: 'Automated smoke test & validation tool for web deliverables, HTML, and JS. Verifies syntax without executing code, checks offline dependencies, and runtime integrity before delivery.',
        parameters: {
          filePath: {
            type: 'string',
            required: true,
            description: 'Relative path to deliverable (e.g. "index.html" or "src/app.js")'
          },
          checkHeadless: {
            type: 'boolean',
            description: 'Whether to run a headless browser check for HTML pages if a browser is available (default: true)'
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
          const root = resolveCwd(execCtx);
          const fullPath = resolve(root, args.filePath);
          const errors = [];
          const warnings = [];

          // Security: Directory traversal guard using isInsideRoot
          if (!isInsideRoot(root, fullPath)) {
            return {
              ok: false,
              status: 'RED',
              message: 'Security error: file path cannot escape project root.',
              errors: [`Access denied for path outside repository: ${args.filePath}`],
              warnings: []
            };
          }

          // 1. File existence
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

            // Check for external CDN reliance without offline fallback
            const hasExternalScripts = /<script\s+[^>]*src=["']https?:\/\//i.test(content);
            const hasFallbackCheck = /typeof\s+[A-Za-z0-9_]+\s*!==?\s*['"]undefined['"]/i.test(content);
            if (hasExternalScripts && !hasFallbackCheck) {
              warnings.push('Deliverable relies on external CDN scripts without offline fallback. User may see white screen offline.');
            }

            // Extract inline scripts and check syntax SAFELY without executing code
            const scriptRegex = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
            let match;
            let scriptIdx = 1;
            while ((match = scriptRegex.exec(content)) !== null) {
              const attrs = match[1] || '';
              const code = match[2]?.trim();

              // Skip external scripts
              if (/src\s*=/i.test(attrs)) continue;

              // Check script type (skip shaders, json, templates, importmaps)
              const typeMatch = attrs.match(/type\s*=\s*["']?([^"'\s>]+)["']?/i);
              const scriptType = typeMatch ? typeMatch[1].toLowerCase() : 'text/javascript';
              const isJs = ['text/javascript', 'application/javascript', 'module', 'text/ecmascript'].includes(scriptType);
              if (!isJs) continue;

              if (code) {
                if (scriptType === 'module') {
                  // Validate ES modules using node --check without executing
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
                    // Safe syntax compilation with vm.Script without running
                    new vm.Script(code, { filename: `inline-script-${scriptIdx}.js` });
                  } catch (err) {
                    errors.push(`SyntaxError in inline <script #${scriptIdx}>: ${err.message}`);
                  }
                }
              }
              scriptIdx++;
            }

            // Headless browser smoke test if Chrome/Edge/Brave is available
            if (args.checkHeadless !== false && errors.length === 0) {
              const isWin = process.platform === 'win32';
              const isMac = process.platform === 'darwin';
              const browserPaths = isWin ? [
                'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
                'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
                'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
                'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
                'chrome',
                'chromium',
                'msedge'
              ] : isMac ? [
                '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
                '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
                '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
                'google-chrome',
                'chromium'
              ] : [
                '/usr/bin/google-chrome',
                '/usr/bin/google-chrome-stable',
                '/usr/bin/chromium',
                '/usr/bin/chromium-browser',
                '/snap/bin/chromium',
                'google-chrome',
                'chromium'
              ];

              let browserBin = null;
              for (const bPath of browserPaths) {
                try {
                  await access(bPath, constants.X_OK);
                  browserBin = bPath;
                  break;
                } catch {
                  try {
                    await exec(isWin ? 'where' : 'which', [bPath]);
                    browserBin = bPath;
                    break;
                  } catch {}
                }
              }

              if (browserBin) {
                const BROWSER_ERROR_REGEX = /(?:Uncaught|ReferenceError|TypeError|SyntaxError)/i;
                try {
                  const url = pathToFileURL(fullPath).href;
                  const { stderr } = await exec(browserBin, [
                    '--headless=new',
                    '--disable-gpu',
                    '--no-first-run',
                    '--no-default-browser-check',
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
                }
              }
            }
          }

          const ok = errors.length === 0;
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
            const safeLabel = args.label.replace(/[^a-zA-Z0-9_-]/g, '_');
            const name = `vibe-ckpt-${safeLabel}`;
            const tempIndex = join(root, '.git', `vibe_ckpt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`);
            try {
              const { stdout: status } = await exec('git', ['status', '--porcelain'], { cwd: root });
              let targetRef = 'HEAD';
              if (status.trim()) {
                // Isolated index captures tracked & untracked files with zero flicker and no stash pollution
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
                if (commitSha && commitSha.trim()) {
                  targetRef = commitSha.trim();
                }
              }
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
        description: 'Restores working directory to a previous Git checkpoint if a merge or synthesis caused regressions (safely backs up uncommitted files to stash first).',
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
          const root = resolveCwd(execCtx);
          return withRepoLock(root, async () => {
            const safeLabel = args.label.replace(/[^a-zA-Z0-9_-]/g, '_');
            const name = `vibe-ckpt-${safeLabel}`;
            try {
              // Safe Mutate Guard: Backup dirty files to stash before restore
              const { stdout: status } = await exec('git', ['status', '--porcelain'], { cwd: root });
              if (status.trim()) {
                await exec('git', ['stash', 'push', '-u', '-m', `pre-restore-backup-${Date.now()}`], { cwd: root });
              }

              // Restore tree state from checkpoint tag atomically (removes deleted files and syncs worktree)
              await exec('git', ['read-tree', '--reset', '-u', name], { cwd: root });

              // Determine whether to reset to parent or HEAD:
              // If tag points to a distinct checkpoint commit-tree, reset index to parent commit
              // If tag was placed directly on clean HEAD, reset index to HEAD
              const { stdout: headSha } = await exec('git', ['rev-parse', 'HEAD'], { cwd: root });
              const { stdout: tagSha } = await exec('git', ['rev-parse', `${name}^{commit}`], { cwd: root });

              if (headSha.trim() !== tagSha.trim()) {
                try {
                  const { stdout: pSha } = await exec('git', ['rev-parse', `${name}^1`], { cwd: root });
                  if (pSha && pSha.trim()) {
                    await exec('git', ['reset', pSha.trim()], { cwd: root });
                  }
                } catch {}
              } else {
                await exec('git', ['reset', 'HEAD'], { cwd: root });
              }

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
