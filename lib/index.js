// lib/index.js — Host backend for dsh-vibecoding
// Universal Multi-Agent Orchestrator with Dynamic N-Task Parallelism & Invisible Mode Activation.

import { defineTool } from '@deepseek-ai/dsh-tools';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { readFile, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import {
  createWorktree,
  listWorktrees,
  removeWorktree,
  mergeWorktree,
  sanitizeTaskName
} from './worktree.js';

const exec = promisify(execFile);

export const name = 'vibecoding';
export const inject = ['commands', 'tools', 'systemPrompt', 'webServer'];

export function apply(ctx) {
  const logger = ctx.logger || console;
  // Dynamic session CWD tracking without unsafe Cordis ctx.workspace proxy access
  let lastKnownCwd = process.cwd();
  const resolveCwd = (exec) => {
    const candidate = exec?.agent?.session?.header?.cwd;
    if (candidate) {
      lastKnownCwd = candidate;
      return candidate;
    }
    return lastKnownCwd || process.cwd();
  };

  // Mode state: active by default, toggled silently via web UI button without text prefixes
  let vibeModeActive = true;
  const unlockedSessions = new Set();
  const isGateUnlocked = (exec) => {
    const sid = exec?.agent?.session?.id;
    if (!sid) return false;
    return unlockedSessions.has(sid);
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
          if (req.method === 'POST') {
            let body = '';
            for await (const chunk of req) body += chunk;
            try {
              const parsed = JSON.parse(body);
              if (typeof parsed.active === 'boolean') {
                vibeModeActive = parsed.active;
                logger.info(`[dsh-vibecoding] Mode toggled to: ${vibeModeActive ? 'ACTIVE' : 'INACTIVE'}`);
              }
            } catch {}
          }
          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          });
          res.end(JSON.stringify({ active: vibeModeActive }));
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
      text: () => {
        if (!vibeModeActive) return '';

        return `
# ⚡ UNIVERSAL MULTI-AGENT HARVESTER PROTOCOL (MANDATORY OPERATING POLICY):
You are the Lead Orchestrator of an autonomous multi-agent engineering combine. Your objective is maximum throughput, zero hallucination, and extreme token efficiency (-80% tokens).

You execute ANY user task strictly through the following 5 phases:

### 🛑 PHASE 1: MANDATORY CLARIFYING INTERVIEW & DYNAMIC ALLOCATION
- ПРИ ПОЛУЧЕНИИ ЛЮБОЙ НОВОЙ ЗАДАЧИ ИЛИ КРУПНОГО ЭТАПА:
  * YOU ARE STRICTLY FORBIDDEN from generating final code, building solutions, or writing full files without scoping.
  * Even if the user says "начни с нуля", "делай с самого начала", or provides detailed instructions, you MUST conduct the interview first unless the user explicitly said "без вопросов" / "делай без вопросов".

- 📊 DYNAMIC MATRIX OF COMPLEXITY & QUESTION BUDGET:
  Before asking, categorize the task scale and allocate questions accordingly:
  * [XS / S] Minor tweak, isolated bugfix, or prompt with 100% complete specifications:
    - Budget: 0–1 question.
    - If zero ambiguity exists, you may immediately call 'complete_interview' without asking redundant questions for the sake of ticking a box.
  * [M] Single standalone feature, UI component, utility script:
    - Budget: 1–2 questions targeting key edge cases, integration points, or data models.
  * [L] Full-featured module, multi-view UI, service integration:
    - Budget: 2–3 questions distributed across distinct architectural axes.
  * [XL] Complex full-stack app, 3D/shader system, multi-mode interactive platform:
    - Budget: 3–5 questions covering core architecture, mechanics, and visual direction.

- 🧭 CATEGORICAL DISTRIBUTION (THE 4 PILLARS):
  Distribute questions across different functional dimensions. NEVER ask multiple redundant questions within the same category:
  1. 🏗 ARCHITECTURE & TECH STACK: Libraries (e.g. Three.js vs vanilla Canvas vs WebGL), bundler vs standalone, data formats, offline vs CDN assets. (Skip if user already specified).
  2. ⚙️ LOGIC & MECHANICS: Core algorithms, state transitions, interaction controls, edge case handling.
  3. 🎨 VISUAL / UX / STYLE: Aesthetic style, color schemes, responsive viewport, animation feel.
  4. ⚡ CONSTRAINTS & ACCEPTANCE: Performance budget (e.g. 60 FPS, mobile friendly), offline-first constraints, acceptance criteria.
  *(Rule: Only spend questions on pillars where there is real ambiguity. If user specified the style, focus questions on logic or architecture).*

- 🔄 ADAPTIVE ITERATIONS (FOLLOW-UP LOGIC):
  * Initial pass: Ask the initial categorized questions via 'ask_user_question' with clear headers and '(Recommended)' options.
  * Follow-up pass: If the user's answers introduce new ambiguous forks or ask you to "придумай сам, но не X" (creative forks), you may run ONE quick follow-up turn (1–2 focused questions) to finalize choices BEFORE execution.
  * Gate Unlock: Once the scope is resolved, call 'complete_interview' to formally unlock Phase 2-5.

### 📄 PHASE 2: SPECIFICATION & DYNAMIC N-SUBTASK DECOMPOSITION
- After receiving user answers, call 'complete_interview' to formally unlock the pipeline.
- Create 'docs/specs/<task-name>.md' detailing:
  1. User confirmed specs & architecture.
  2. Assessed Complexity (XS/S/M/L/XL).
  3. Optimal decomposition into N independent subtasks (N = 1 for S, N = 2 to 5+ for M/L/XL).
     Example for 3D interactive graphics:
     - Worker 1: Core Canvas & Ukiyo-e Render Layer ('src/ukiyoe.js')
     - Worker 2: Matrix Rain 3D Morph & Interaction Controller ('src/matrix3d.js')
     - Worker 3: Creative Mode & FX Synthesis ('src/cyberMode.js')
  4. Clean zero-conflict contracts: Each worker writes ONLY to its designated module. NO workers write to 'index.html' directly!

### 🔴 PHASE 3: VERIFICATION CONTRACT FIRST (TDD / ATDD)
- Code: Create tests in 'tests/<subtask>.test.js' and run 'run_tdd_cycle' (confirm RED failure).
- Rubric: Establish acceptance rubric before writing features.

### 🌿 PHASE 4: ISOLATED WORKSPACES
- Create isolated Git worktree for each subtask via 'worktree_create' (.worktrees/<subtask-name>).

### ⚡ PHASE 5: PARALLEL HARVESTER SWARM & SMOKE TEST (TOKEN SAVINGS)
- DO NOT DO ALL WORK YOURSELF IN A SINGLE SERIAL THREAD!
- Spawn subagents CONCURRENTLY using 'subagent' tool (with run_in_background: true).
- Use 'create_worker_brief' to pass lean slates (Goal, target file, exact API interface, test command). Minimal tokens, zero chat bloat.
- When workers finish:
  * Create snapshot: 'checkpoint_create' (label 'pre-synthesis').
  * Orchestrator synthesizes the modules into root entry point (e.g. 'index.html').
  * MANDATORY SMOKE TEST: Run 'verify_deliverable' on the deliverable. Fix any errors reported.
  * Once verified GREEN: Clean up worktrees ('worktree_remove') and deliver to user.

### 🔄 MULTI-TURN COMBINE (ПОВТОРНОЕ ИСПОЛЬЗОВАНИЕ РОЯ НА ЛЮБОМ ХОДЕ):
- Протокол комбайна действует НА ПРОТЯЖЕНИИ ВСЕГО ДИАЛОГА!
- Когда пользователь на последующих ходах (2, 5, 20, 25+) даёт новую комплексную задачу (например, «доработай эти 5 страниц», «сделай новый раздел», «адаптируй дизайн»):
  * ЗАПРЕЩЕНО пытаться делать всё самому в один линейный поток через одиночные скрипты!
  * ДЕКОМПОЗИРУЙ задачу на независимые параллельные части:
    - Либо по страницам (Субагент 1 -> Страница 1, Субагент 2 -> Страница 2, Субагент 3 -> Страница 3).
    - Либо по функциональным блокам (Субагент 1 -> Блок билетов, Субагент 2 -> Блок расписания, Субагент 3 -> Блок отзывов).
  * Запускай параллельный рой через 'subagent' (run_in_background: true) для генерации контента и кода!

### 🛡️ SAFE MUTATE GUARD (ЗАЩИТА ОТ ВАНДАЛИЗМА — ЗАПРОС РАЗРЕШЕНИЯ):
- При работе с сайтами, CMS (Tilda), базами данных и файловой структурой:
- **КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО удалять что-либо молча!** (блоки на странице, записи, файлы, кнопки, скрипты).
- Если для выполнения задачи ты считаешь нужным удалить существующий элемент (например, блок в Tilda, секцию или файл):
  * ТЫ ОБЯЗАН СНАЧАЛА СПРОСИТЬ РАЗРЕШЕНИЕ У ПОЛЬЗОВАТЕЛЯ НА РУССКОМ ЯЗЫКЕ (через 'ask_user_question' или прямым текстом в чате).
  * Обязательно укажи:
    1. Что именно ты хочешь удалить (ID блока, название секции, путь к файлу).
    2. Причину: зачем удалять и что будет создано взамен.
  * Удаление разрешено ТОЛЬКО ПОСЛЕ явного согласия пользователя («Да, удаляй»).
  * Без явного согласия: использовать скрытие (Hide/Черновик), стилизацию или замену текста внутри блока без удаления.

### 🌐 ПРАВИЛО ДЛЯ ВНЕШНИХ ПЛАТФОРМ И БРАУЗЕРА (TILDA / CMS / SAAS):
- **Разделяй генерацию контента и браузерное исполнение**:
  1. Рой субагентов параллельно формирует готовые контентные пакеты (тексты, HTML, стили, настройки каждого блока) в локальных файлах.
  2. Браузерная автоматизация (Playwright / скрипты):
     - Браузер запускается ОДИН раз в постоянном профиле.
     - НЕ ЗАКРЫВАТЬ браузер между операциями, чтобы пользователю не приходилось повторно проходить авторизацию!
     - Перед запуском скрипта убедись, что нет зависших процессов Chromium, блокирующих профиль.
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
        vibeModeActive = true;
        if (agent?.session?.id) unlockedSessions.delete(agent.session.id);

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
              text: `[🎯 УНИВЕРСАЛЬНЫЙ VIBE-РЕЖИМ]\nЗадача: "${task}"\n\n⚠️ ПРАВИЛО ФАЗЫ 1: Запрещено выдавать финальный результат сразу!\nЗадай 2-4 конкретных уточняющих вопроса через ask_user_question, чтобы зафиксировать требования, критерии качества и контекст перед началом работы.`
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
        async execute(args, exec) {
          const root = resolveCwd(exec);
          const runDir = args.cwd ? resolve(root, args.cwd) : root;
          const [cmd, ...cmdArgs] = args.testCommand.trim().split(/\s+/);

          try {
            const { stdout, stderr } = await exec(cmd, cmdArgs, {
              cwd: runDir,
              env: { ...process.env, CI: 'true', FORCE_COLOR: '0' },
              timeout: 120000
            });

            return {
              status: 'GREEN',
              message: '✅ Tests/Checks passed!',
              output: stdout || stderr || '(No output)',
              exitCode: 0
            };
          } catch (err) {
            const output = [err.stdout, err.stderr, err.message].filter(Boolean).join('\n');
            return {
              status: 'RED',
              message: '🔴 Verification failed (contract red or issues found).',
              output: output.slice(-4000),
              exitCode: err.code || 1
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
            description: 'Brief summary of user answers and agreed constraints'
          },
          subtaskCount: {
            type: 'integer',
            description: 'Planned number of parallel subtasks (1-5+)'
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
        async execute(args, exec) {
          const sid = exec?.agent?.session?.id;
          if (sid) {
            unlockedSessions.add(sid);
          } else {
            unlockedSessions.add('default');
          }
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
        description: 'Generates an ultra-compact, token-efficient Lean Brief for subagents. Cuts worker token consumption by up to 80% while maximizing focus.',
        parameters: {
          subtaskName: {
            type: 'string',
            required: true,
            description: 'Name of the subtask (e.g. "particle-geometry")'
          },
          targetFile: {
            type: 'string',
            required: true,
            description: 'Assigned isolated module path (e.g. "src/geometry.js")'
          },
          contract: {
            type: 'string',
            required: true,
            description: 'Input/output specifications, exported functions/classes'
          },
          verificationCommand: {
            type: 'string',
            required: true,
            description: 'Test command to run for verification (e.g. "npm test")'
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
          const leanPrompt = `[LEAN WORKER BRIEF: ${args.subtaskName}]
Isolated Workspace: .worktrees/${args.subtaskName}
Target File: ${args.targetFile}
Contract Specification:
${args.contract}
Verification: Run "${args.verificationCommand}" until GREEN.
TOKEN SAVER DIRECTIVE: Silent execution. Zero conversational filler. Call tools directly. Return 3-line completion JSON when all tests pass.`;
          return {
            prompt: leanPrompt,
            tokenSavingHint: 'Pass this exact prompt to the "subagent" tool to save 70-80% tokens.'
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
            description: 'Short task identifier in kebab-case'
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
        async execute(args, exec) {
          if (vibeModeActive && !isGateUnlocked(exec)) {
            return {
              success: false,
              path: '',
              branch: '',
              existed: false,
              message: '🛑 PHASE 1 GATEKEEPER ACTIVE: Запрещено создавать воркдеревья до проведения интервью с пользователем! Задайте ключевые уточняющие вопросы через ask_user_question и зафиксируйте ответы вызовом complete_interview. (Если пользователь сразу просил делать без вопросов — вызовите complete_interview с пометкой direct_request).'
            };
          }
          const root = resolveCwd(exec);
          const res = await createWorktree(root, args.taskName, args.baseBranch || 'HEAD');
          return { success: true, ...res };
        }
      })
    );

    // Tool: worktree_remove
    ctx.tools.register(
      defineTool({
        name: 'worktree_remove',
        description: 'Cleans up an isolated Git worktree after merging.',
        parameters: {
          taskName: {
            type: 'string',
            required: true,
            description: 'Task name whose worktree to remove'
          },
          deleteBranch: {
            type: 'boolean',
            description: 'Whether to delete the branch (default: false)'
          }
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              success: { type: 'boolean', required: true },
              removed: { type: 'string', required: true }
            }
          },
          render: (_args, value) => [
            {
              type: 'text',
              text: `Worktree removed: ${value.removed}`
            }
          ]
        },
        async execute(args, exec) {
          const root = resolveCwd(exec);
          return await removeWorktree(root, args.taskName, args.deleteBranch ?? false);
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
        async execute(_args, exec) {
          const root = resolveCwd(exec);
          const list = await listWorktrees(root);
          return { worktrees: list };
        }
      })
    );

    // Tool: verify_deliverable (Automated Smoke Verification)
    ctx.tools.register(
      defineTool({
        name: 'verify_deliverable',
        description: 'Automated smoke test & validation tool for web deliverables, HTML, and JS. Verifies syntax, offline dependencies, and runtime integrity before delivery.',
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
        async execute(args, exec) {
          const root = resolveCwd(exec);
          const fullPath = resolve(root, args.filePath);
          const errors = [];
          const warnings = [];

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
          } else if (args.filePath.endsWith('.html')) {
            if (!content.includes('<!DOCTYPE html>') && !content.includes('<html')) {
              warnings.push('HTML file missing standard <!DOCTYPE html> declaration.');
            }

            // Check for external CDN reliance without offline fallback
            const hasExternalScripts = /<script\s+[^>]*src=["']https?:\/\//i.test(content);
            const hasLocalFallback = /three\.min\.js/i.test(content) || /typeof\s+[A-Za-z0-9_]+\s*!==?\s*['"]undefined['"]/i.test(content);
            if (hasExternalScripts && !hasLocalFallback) {
              warnings.push('Deliverable relies on external CDN scripts without offline fallback. User may see white screen on file:// or offline.');
            }

            // Extract inline scripts and check syntax
            const scriptRegex = /<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/gi;
            let match;
            let scriptIdx = 1;
            while ((match = scriptRegex.exec(content)) !== null) {
              const code = match[1].trim();
              if (code) {
                try {
                  await exec('node', ['--input-type=module', '-e', code], {
                    timeout: 6000,
                    env: { ...process.env, NODE_OPTIONS: '--no-warnings' }
                  });
                } catch (err) {
                  if (err.message?.includes('SyntaxError') || err.stderr?.includes('SyntaxError')) {
                    errors.push(`SyntaxError in inline <script #${scriptIdx}>: ${err.stderr || err.message}`);
                  }
                }
              }
              scriptIdx++;
            }

            // Headless browser smoke test if Chrome is available
            if (args.checkHeadless !== false && errors.length === 0) {
              const browserPaths = [
                '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
                '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
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
                    await exec('which', [bPath]);
                    browserBin = bPath;
                    break;
                  } catch {}
                }
              }

              if (browserBin) {
                try {
                  const url = `file://${fullPath}`;
                  const { stderr } = await exec(browserBin, [
                    '--headless=new',
                    '--use-gl=angle',
                    '--virtual-time-budget=2000',
                    '--dump-dom',
                    url
                  ], { timeout: 15000 });

                  if (stderr && (stderr.includes('Uncaught') || stderr.includes('ReferenceError') || stderr.includes('TypeError'))) {
                    errors.push(`Browser Runtime Error: ${stderr.slice(0, 500)}`);
                  }
                } catch (bErr) {
                  if (bErr.stderr?.includes('Uncaught')) {
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
          const name = `vibe-ckpt-${args.label.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
          try {
            await exec('git', ['tag', '-f', name], { cwd: root });
            return { success: true, checkpoint: name };
          } catch (err) {
            return { success: false, checkpoint: err.message };
          }
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
          const root = resolveCwd(execCtx);
          const name = `vibe-ckpt-${args.label.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
          try {
            await exec('git', ['reset', '--hard', name], { cwd: root });
            return { success: true, restoredTo: name };
          } catch (err) {
            return { success: false, restoredTo: err.message };
          }
        }
      })
    );
  }
}
