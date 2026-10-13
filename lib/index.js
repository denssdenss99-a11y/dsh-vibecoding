// lib/index.js — Host backend for dsh-vibecoding
// Implements the 5-step TDD & Multi-Agent orchestration workflow for DeepSeek Harness (DSH).

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
export const inject = ['commands', 'tools', 'systemPrompt'];

export function apply(ctx) {
  const logger = ctx.logger || console;
  logger.info('[dsh-vibecoding] Initializing 5-Step TDD & Multi-Agent Orchestrator');

  const rootDir = () => ctx.workspace?.root || process.cwd();

  // -------------------------------------------------------------
  // 1. System Prompt Guardrails (Anchors & Rules)
  // -------------------------------------------------------------
  if (ctx.systemPrompt?.addSection) {
    ctx.systemPrompt.addSection({
      id: 'vibecoding-tdd-guard',
      render: () => `
# STRICT 5-PHASE AI WORKFLOW (Vibecoding Contract):
When developing features or solving non-trivial tasks, follow these 5 mandatory phases:

1. **Clarification (Опрос)**:
   - NEVER start generating implementation code immediately.
   - If requirements, edge cases, tech stack, or data formats are not 100% specified, ask 2-4 concrete clarifying questions.
   
2. **Specification & Plan (Спецификация как якорь контекста)**:
   - Before coding, write or update the specification file in \`docs/specs/<feature-name>.md\`.
   - Specify: Acceptance Criteria (DoD), contracts, schema, and subtask breakdown.
   
3. **TDD Contract (Тесты до кода - Red -> Green Loop)**:
   - Write automated tests BEFORE writing implementation code.
   - Run tests using \`run_tdd_cycle\`. They MUST fail first (RED).
   - Write the minimal code to satisfy the tests.
   - Re-run \`run_tdd_cycle\` in a self-healing loop until status is GREEN. Never claim "done" without green tests.
   
4. **Isolated Git Worktrees (Изоляция веток)**:
   - For parallel or risky tasks, create an isolated worktree via \`worktree_create\`.
   - Work strictly within \`.worktrees/<task-name>\` so the main branch stays clean.
   
5. **Orchestration (Оркестратор + Воркеры)**:
   - Orchestrator models coordinate the high-level plan and DoD.
   - Delegate subtasks to fast worker subagents in isolated worktrees.
`
    });
  }

  // -------------------------------------------------------------
  // 2. Slash Command /vibe <task>
  // -------------------------------------------------------------
  if (ctx.commands?.register) {
    ctx.commands.register({
      name: 'vibe',
      description: 'Start structured 5-Phase TDD & Multi-Agent workflow',
      handler: async ({ rawInput }) => {
        const task = rawInput.trim();
        if (!task) {
          return {
            content: `🎯 **TDD Vibecoding Pipeline**\n\nUsage: \`/vibe <description of task>\`\n\nPhases:\n1. ❓ Clarifying Questions\n2. 📄 Specification & Plan (docs/specs/)\n3. 🔴 TDD Red -> 🟢 Green Loop\n4. 🌿 Git Worktree Isolation\n5. 🤖 Subagent Orchestration`
          };
        }

        return {
          content: `🚀 **TDD Vibecoding Pipeline Activated for:** "${task}"\n\n` +
            `👉 **Phase 1 (Clarification):** Please analyze the requirements and ask the user 2-4 clarifying questions regarding edge cases, dependencies, and expected contracts before writing any code.`
        };
      }
    });
  }

  // -------------------------------------------------------------
  // 3. Tool: run_tdd_cycle (Test runner with Red/Green detection)
  // -------------------------------------------------------------
  if (ctx.tools?.register) {
    ctx.tools.register(
      defineTool({
        name: 'run_tdd_cycle',
        description: 'Runs project test suite to verify TDD Red (failing) or Green (passing) status. Used in the self-healing loop.',
        parameters: {
          testCommand: {
            type: 'string',
            required: true,
            description: 'Test command to run (e.g. "npm test", "pytest", "cargo test", "go test ./...")'
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
                description: 'GREEN if tests passed (exit 0), RED if failed'
              },
              message: { type: 'string', required: true },
              output: { type: 'string', required: true },
              exitCode: { type: 'integer', required: true }
            }
          },
          render: (_args, value) => [
            {
              type: 'text',
              text: `[TDD ${value.status}] ${value.message}\nExit code: ${value.exitCode}\n\n${value.output}`
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
              message: '✅ Tests passed! Contract verified.',
              output: stdout || stderr || '(No output)',
              exitCode: 0
            };
          } catch (err) {
            const output = [err.stdout, err.stderr, err.message].filter(Boolean).join('\n');
            return {
              status: 'RED',
              message: '🔴 Tests failed. If in Red phase: contract confirmed. If in Green phase: inspect errors and fix.',
              output: output.slice(-4000), // last 4000 chars of traceback
              exitCode: err.code || 1
            };
          }
        }
      })
    );

    // -----------------------------------------------------------
    // 4. Tool: worktree_create
    // -----------------------------------------------------------
    ctx.tools.register(
      defineTool({
        name: 'worktree_create',
        description: 'Creates an isolated Git worktree for parallel AI subagent development.',
        parameters: {
          taskName: {
            type: 'string',
            required: true,
            description: 'Short task identifier in kebab-case (e.g. "auth-jwt", "redis-cache")'
          },
          baseBranch: {
            type: 'string',
            description: 'Optional base commit or branch to branch off (defaults to HEAD)'
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

    // -----------------------------------------------------------
    // 5. Tool: worktree_remove
    // -----------------------------------------------------------
    ctx.tools.register(
      defineTool({
        name: 'worktree_remove',
        description: 'Cleans up an isolated Git worktree after merging or finishing work.',
        parameters: {
          taskName: {
            type: 'string',
            required: true,
            description: 'Task name whose worktree to remove'
          },
          deleteBranch: {
            type: 'boolean',
            description: 'Whether to also delete the git branch (default: false)'
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

    // -----------------------------------------------------------
    // 6. Tool: worktree_list
    // -----------------------------------------------------------
    ctx.tools.register(
      defineTool({
        name: 'worktree_list',
        description: 'Lists all currently active Git worktrees in the project.',
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
