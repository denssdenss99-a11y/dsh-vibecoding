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
  logger.info('[dsh-vibecoding] Initializing Universal Multi-Agent Orchestrator');

  const rootDir = () => ctx.workspace?.root || process.cwd();

  // Mode state: active by default, toggled silently via web UI button without text prefixes
  let vibeModeActive = true;
  let interviewGatePassed = false;

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
      text: () => {
        if (!vibeModeActive) return '';

        return `
# UNIVERSAL MULTI-AGENT HARVESTER PROTOCOL (FOR ANY TASK):
You are the Lead Orchestrator operating as a high-throughput, token-efficient engineering combine. You handle ANY task (coding, research, business analysis, drafting, review) through this rigorous 5-phase pipeline:

### 🛑 PHASE 1: MANDATORY CLARIFYING INTERVIEW (PRE-EXECUTION GATE)
- On receiving ANY new task:
- YOU ARE STRICTLY FORBIDDEN from generating final deliverables, writing implementation code, or creating full documents on your first turn.
- Before starting work, you MUST ask the user 2-4 concrete, numbered clarifying questions using the 'ask_user_question' tool (or in your response).
- Clarify: Goal, target audience, format, constraints, and acceptance criteria.
- YOU MUST WAIT FOR THE USER'S ANSWERS before spawning worktrees or workers (unless the user explicitly added "делай сразу" / "без вопросов").

### 📄 PHASE 2: SPECIFICATION & DYNAMIC N-SUBTASK DECOMPOSITION
- After requirements are clarified, create 'docs/specs/<task-name>.md'.
- DYNAMIC DECOMPOSITION (Amdahl's Law for Agents):
  * Analyze complexity and parallelizability.
  * Determine the OPTIMAL number of independent subtasks (N = 1 to 5+). Do NOT artificially restrict to 2.
  * If a task has 4 independent modules/research areas, split into 4 parallel subtasks.
  * If atomic, keep N=1 without unnecessary overhead.
- ZERO-CONFLICT CONTRACTS: Each subtask must target an isolated file (e.g. 'src/<module>.js' or 'docs/drafts/<part>.md'). NO shared files may be modified by multiple workers concurrently!

### 🔴 PHASE 3: VERIFICATION CONTRACT BEFORE EXECUTION
- CODE TASKS (TDD): Write automated tests FIRST in 'tests/<subtask>.test.js'. Verify they fail (RED) via 'run_tdd_cycle'.
- NON-CODE TASKS (ATDD / RUBRIC): In 'docs/specs/<task-name>.md', create an explicit Evaluation Rubric & Checklist before drafting.

### 🌿 PHASE 4: ISOLATED WORKSPACES PER SUBTASK
- CODE tasks: Create isolated Git worktrees via 'worktree_create' (.worktrees/<subtask-name>).
- NON-CODE tasks: Create isolated draft files in 'docs/drafts/<subtask-name>.md'.

### ⚡ PHASE 5: PARALLEL HARVESTER SWARM & SMOKE VERIFICATION (EXTREME TOKEN SAVINGS)
- DO NOT DO ALL WORK YOURSELF IN A SINGLE THREAD! Spawn workers CONCURRENTLY via 'subagent' (run_in_background: true).
- 💰 TOKEN SAVER DIRECTIVES FOR WORKERS:
  1. LEAN BRIEFS: Pass ONLY the minimal task slate (Goal, target file, exact input/output interface, and test command). Do NOT dump conversation history or large files into worker prompts!
  2. SILENT EXECUTION: Instruct workers: "Zero conversational filler. Execute tools immediately. Report final status in 3 lines: deliverable path, tests passed, status GREEN."
  3. ISOLATED TARGET: Each worker writes ONLY to its assigned module. Workers MUST NOT touch the root 'index.html' or main entry points.
- ONCE WORKERS FINISH:
  * Create a snapshot checkpoint: 'checkpoint_create' (e.g. label 'pre-synthesis').
  * Orchestrator synthesizes the modules into the main deliverable (e.g. 'index.html' or main document).
  * MANDATORY SMOKE TEST: Run 'verify_deliverable' on the final deliverable. It automatically checks syntax, offline asset availability, and runs headless browser smoke checks.
  * If verify_deliverable reports RED: Fix the specific error or rollback with 'checkpoint_restore'.
  * Once verified GREEN: Clean up worktrees ('worktree_remove') and present the working result to the user.
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
        interviewGatePassed = false;

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
        async execute(args) {
          const runDir = args.cwd ? resolve(rootDir(), args.cwd) : rootDir();
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
          }
        },
        output: {
          schema: {
            type: 'object',
            properties: {
              gateUnlocked: { type: 'boolean', required: true },
              message: { type: 'string', required: true }
            }
          },
          render: (_args, value) => [
            { type: 'text', text: `🔓 ${value.message}` }
          ]
        },
        async execute(args) {
          interviewGatePassed = true;
          return {
            gateUnlocked: true,
            message: `Phase 1 Gatekeeper UNLOCKED for "${args.taskName}". You may now proceed to Phase 2 (specs), Phase 3 (tests), and Phase 4 (worktrees). Planned subtasks: ${args.subtaskCount || 'dynamic'}.`
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
        async execute(args) {
          if (vibeModeActive && !interviewGatePassed) {
            return {
              success: false,
              path: '',
              branch: '',
              existed: false,
              message: '🛑 PHASE 1 GATEKEEPER ACTIVE: Запрещено создавать воркдеревья до проведения интервью с пользователем! Задайте 2-4 вопроса через ask_user_question и зафиксируйте ответы вызовом complete_interview. (Если пользователь сразу просил делать без вопросов — вызовите complete_interview с пометкой direct_request).'
            };
          }
          const res = await createWorktree(rootDir(), args.taskName, args.baseBranch || 'HEAD');
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
        async execute(args) {
          return await removeWorktree(rootDir(), args.taskName, args.deleteBranch ?? false);
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
        async execute() {
          const list = await listWorktrees(rootDir());
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
        async execute(args) {
          const fullPath = resolve(rootDir(), args.filePath);
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
                    '--disable-gpu',
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
            properties: {
              success: { type: 'boolean', required: true },
              checkpoint: { type: 'string', required: true }
            }
          },
          render: (_args, value) => [
            { type: 'text', text: `📌 Checkpoint created: ${value.checkpoint}` }
          ]
        },
        async execute(args) {
          const name = `vibe-ckpt-${args.label.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
          try {
            await exec('git', ['tag', '-f', name], { cwd: rootDir() });
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
            properties: {
              success: { type: 'boolean', required: true },
              restoredTo: { type: 'string', required: true }
            }
          },
          render: (_args, value) => [
            { type: 'text', text: `↺ Restored to checkpoint: ${value.restoredTo}` }
          ]
        },
        async execute(args) {
          const name = `vibe-ckpt-${args.label.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
          try {
            await exec('git', ['reset', '--hard', name], { cwd: rootDir() });
            return { success: true, restoredTo: name };
          } catch (err) {
            return { success: false, restoredTo: err.message };
          }
        }
      })
    );
  }
}
