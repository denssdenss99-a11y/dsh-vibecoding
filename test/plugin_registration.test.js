import test from 'node:test';
import assert from 'node:assert/strict';
import { apply } from '../lib/index.js';

test('Plugin Registration: All 15 tools, system prompt, commands and webserver register cleanly', (t) => {
  const registeredTools = [];
  const registeredSections = [];
  const registeredCommands = [];
  const registeredRoutes = [];

  const fakeCtx = {
    webServer: {
      register: (route) => registeredRoutes.push(route)
    },
    systemPrompt: {
      section: (sec) => registeredSections.push(sec)
    },
    commands: {
      register: (cmd) => registeredCommands.push(cmd)
    },
    tools: {
      register: (tool) => registeredTools.push(tool.name)
    }
  };

  assert.doesNotThrow(() => {
    apply(fakeCtx);
  });

  const expectedTools = [
    'scope_manage',
    'memory_manage',
    'strike_guard',
    'server_daemon',
    'devops_provision',
    'run_tdd_cycle',
    'complete_interview',
    'create_worker_brief',
    'worktree_create',
    'worktree_merge',
    'worktree_remove',
    'worktree_list',
    'verify_deliverable',
    'checkpoint_create',
    'checkpoint_restore'
  ];

  assert.equal(registeredTools.length, 15, `Expected 15 tools, got: ${registeredTools.length}`);
  for (const name of expectedTools) {
    assert.ok(registeredTools.includes(name), `Expected tool "${name}" to be registered`);
  }

  assert.ok(registeredSections.length >= 1, 'System prompt section should be registered');
  assert.equal(registeredSections[0].name, 'vibecoding:universal-policy');

  const promptText = registeredSections[0].text({ session: { id: 'test-session' } });
  assert.ok(promptText.includes('AGENTIC ENGINEERING OS 3.0'), 'Prompt must contain Agentic Engineering header');

  assert.ok(registeredCommands.some(c => c.name === 'vibe'), 'Slash command /vibe must be registered');
  assert.ok(registeredRoutes.some(r => r.path === '/dsh-vibecoding'), 'Route /dsh-vibecoding must be registered');
});
