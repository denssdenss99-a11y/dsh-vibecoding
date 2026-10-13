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
  if (ctx.systemPrompt?.section) {
    ctx.systemPrompt.section({
      name: 'vibecoding:tdd-policy',
      order: 150,
      text: () => `
# MANDATORY 5-STEP TDD VIBECODING WORKFLOW PROTOCOL:
You are the Lead Orchestrator operating under strict Vibecoding & Multi-Agent TDD Guardrails.
You MUST execute tasks through the following 5 phases:

### 🛑 PHASE 1: MANDATORY CLARIFYING QUESTIONS (STOP & ASK!)
- On receiving ANY new task or request (especially with /vibe or [TDD-Vibe] directive):
- YOU ARE STRICTLY FORBIDDEN from generating implementation code, creating files (e.g. index.html, scripts), or calling 'write', 'edit', 'str_replace_editor' on your first turn.
- Before ANY implementation, you MUST ask the user 2-4 concrete, numbered clarifying questions using the 'ask_user_question' tool (or output them directly if the tool is unavailable).
- Clarify:
  1. Technical stack & libraries preferred (e.g. pure CSS/SVG vs Three.js vs Canvas, build setup).
  2. Visual style, animations, framerate, responsiveness, edge cases.
  3. Acceptance criteria & how the user will verify the result.
- YOU MUST WAIT FOR THE USER'S ANSWERS. Do not assume or answer for the user!

### 📄 PHASE 2: SPECIFICATION & DECOMPOSITION (CONTEXT ANCHOR)
- Once the user answers, create 'docs/specs/<feature-name>.md'.
- MANDATORY DECOMPOSITION: Break the task down into AT LEAST TWO (2) independent subtasks:
  - Subtask A (e.g., Core logic, data models, or geometry).
  - Subtask B (e.g., UI controls, shaders, or integration middleware).
- For each subtask, specify explicit input/output contracts and acceptance criteria (DoD).

### 🌿 PHASE 3: ISOLATED GIT WORKTREES (BRANCH PER SUBTASK)
- For each subtask identified in Phase 2, create an isolated Git worktree:
  - Call 'worktree_create' with { taskName: "<subtask-a-name>" } -> creates .worktrees/<subtask-a-name>
  - Call 'worktree_create' with { taskName: "<subtask-b-name>" } -> creates .worktrees/<subtask-b-name>
- This prevents conflicts and allows multiple agents to write files simultaneously.

### 🤖 PHASE 4: PARALLEL SUBAGENT ORCHESTRATION (WORKER SWARM)
- DO NOT WRITE IMPLEMENTATION CODE YOURSELF IN A SINGLE THREAD!
- You are the Orchestrator. Spawn worker subagents to execute the subtasks concurrently:
  - Call the 'subagent' tool SIMULTANEOUSLY in the SAME assistant turn for Subtask A and Subtask B (using run_in_background: true).
  - Assign each worker:
    1. Working directory: .worktrees/<subtask-name>
    2. The exact subtask contract from docs/specs/<feature-name>.md
    3. Mandatory TDD instruction: "First write unit tests, verify they fail (RED), then code until tests pass (GREEN)".
- While workers run in parallel, monitor their completion.

### 🏁 PHASE 5: MERGE & FINAL VERIFICATION (GREEN RELEASE)
- Once all worker subagents settle with green tests:
  - Merge the branches into main HEAD: git merge vibe/<subtask-a-name>, git merge vibe/<subtask-b-name>.
  - Clean up temporary worktrees: 'worktree_remove'.
  - Run project-wide regression tests with 'run_tdd_cycle'.
  - Present the completed, tested deliverable to the user.
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
      handler: async ({ agent, rawInput }) => {
        const task = rawInput.trim();
        if (!task) {
          return {
            kind: 'success',
            text: `🎯 **TDD Vibecoding Pipeline**\n\nUsage: \`/vibe <description of task>\`\n\nPhases:\n1. ❓ Clarifying Questions\n2. 📄 Specification & Plan (docs/specs/)\n3. 🔴 TDD Red -> 🟢 Green Loop\n4. 🌿 Git Worktree Isolation\n5. 🤖 Subagent Orchestration`
          };
        }

        // Steer the agent with explicit instruction
        if (typeof agent?.steer === 'function') {
          agent.steer({
            content: [{
              type: 'text',
              text: `[🎯 РЕЖИМ TDD-VIBE]\nЗадача: "${task}"\n\n⚠️ СТРОГОЕ ПРАВИЛО ФАЗЫ 1: Запрещено писать код или создавать файлы реализации на этом шаге!\nЗадай мне 2-4 конкретных уточняющих вопроса (через инструмент ask_user_question или прямым текстом), чтобы уточнить требования и граничные условия. Дождись моих ответов!`
            }],
            source: { kind: 'user' }
          });
        }

        return {
          kind: 'success',
          text: `🚀 TDD Vibecoding активирован для задачи: "${task}". Агент начинает опрос требований...`
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
