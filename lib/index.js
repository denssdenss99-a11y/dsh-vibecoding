// lib/index.js — Host backend for dsh-vibecoding
// Universal Multi-Agent Orchestrator with Dynamic N-Task Parallelism & Invisible Mode Activation.

import { defineTool } from '@deepseek-ai/dsh-tools';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
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
# UNIVERSAL MULTI-AGENT ORCHESTRATION PROTOCOL (FOR ANY TASK):
You are the Lead Orchestrator operating under strict Quality Guardrails. You handle ANY task (coding, research, business analysis, drafting, review) through this rigorous 5-phase pipeline:

### 🛑 PHASE 1: MANDATORY CLARIFYING QUESTIONS (STOP & ASK!)
- On receiving ANY new task or request:
- YOU ARE STRICTLY FORBIDDEN from generating final deliverables, writing implementation code, or creating full documents on your first turn.
- Before starting work, you MUST ask the user 2-4 concrete, numbered clarifying questions using the 'ask_user_question' tool (or in your response).
- Clarify:
  * Goal, target audience, format, key constraints.
  * Preferred tools/stack (if coding) or scope/sources/depth (if analytical/document task).
  * Definition of Done (acceptance criteria).
- YOU MUST WAIT FOR THE USER'S ANSWERS. Do not guess or answer for the user!

### 📄 PHASE 2: SPECIFICATION & DYNAMIC N-SUBTASK DECOMPOSITION
- After the user answers, create 'docs/specs/<task-name>.md'.
- DYNAMIC DECOMPOSITION (Amdahl's Law for Agents):
  * Analyze task complexity and parallelizability.
  * Determine the OPTIMAL number of independent subtasks (N = 1 to 5+). Do NOT artificially restrict to 2.
  * If a task has 4 independent modules/research areas, split into 4 parallel subtasks.
  * If a task is atomic and cannot be meaningfully parallelized, keep N=1 without unnecessary overhead.
- For each subtask, define explicit input/output contracts and verification criteria.

### 🔴 PHASE 3: VERIFICATION CONTRACT BEFORE EXECUTION
- Determine the task type:
  * A) CODE TASKS (TDD): Write automated tests FIRST. Run 'run_tdd_cycle'. Verify they fail (RED).
  * B) NON-CODE TASKS (ATDD / RUBRIC): In 'docs/specs/<task-name>.md', create an explicit Evaluation Rubric & Checklist (facts needed, sections, validation criteria) BEFORE writing the body. The baseline is considered UNMET (RED) until audited.

### 🌿 PHASE 4: ISOLATED WORKSPACES PER SUBTASK
- For CODE tasks: Create isolated Git worktrees via 'worktree_create' for each subtask (.worktrees/<subtask-name>).
- For NON-CODE tasks: Create isolated draft files in 'docs/drafts/<subtask-name>.md' so workers do not overwrite each other.

### 🤖 PHASE 5: PARALLEL WORKER SWARM & FINAL SYNTHESIS
- DO NOT DO ALL WORK YOURSELF IN A SINGLE THREAD!
- Orchestrator spawns worker subagents using the 'subagent' tool CONCURRENTLY in the same assistant turn (run_in_background: true) for all independent subtasks.
- Assign each worker:
  1. Its isolated workspace (.worktrees/ or docs/drafts/).
  2. The exact subtask contract and acceptance rubric from Phase 2.
  3. Iteration instruction: "Work until 100% of the verification criteria/tests pass (GREEN)."
- Once all workers settle:
  * Merge branches (git merge) or synthesize draft chapters into the final document.
  * Clean up temporary workspaces ('worktree_remove').
  * Perform a final quality check against the Phase 2 specification and deliver the result to the user.
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
              existed: { type: 'boolean', required: true }
            }
          },
          render: (_args, value) => [
            {
              type: 'text',
              text: `Worktree ${value.existed ? 'already exists' : 'created'} at ${value.path} (branch: ${value.branch})`
            }
          ]
        },
        async execute(args) {
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
  }
}
