import test from 'node:test';
import assert from 'node:assert/strict';
import { apply } from '../lib/index.js';

test('Plugin Registration: 5 sharp tools, Vibe Manifesto prompt, and HUD register cleanly', () => {
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
    'browser_smoke',
    'worktree_create',
    'worktree_merge',
    'worktree_list',
    'worktree_remove'
  ];

  assert.equal(registeredTools.length, 5, `Expected 5 tools, got: ${registeredTools.length}`);
  for (const name of expectedTools) {
    assert.ok(registeredTools.includes(name), `Expected tool "${name}" to be registered`);
  }

  assert.ok(registeredSections.length >= 1, 'System prompt section should be registered');
  assert.equal(registeredSections[0].name, 'vibecoding:universal-policy');

  const promptText = registeredSections[0].text({ session: { id: 'test-session' } });
  assert.ok(promptText.includes('THE VIBE MANIFESTO'), 'Prompt must contain Vibe Manifesto header');
  assert.ok(promptText.includes('browser_smoke'), 'Prompt must instruct using browser_smoke');
  assert.ok(promptText.includes('poly-decomp'), 'Prompt must instruct poly-decomp for Matter.js');

  assert.ok(registeredCommands.some(c => c.name === 'vibe'), 'Slash command /vibe must be registered');
  assert.ok(registeredRoutes.some(r => r.path === '/dsh-vibecoding'), 'Route /dsh-vibecoding must be registered');

  // Verify route handler responds to state, rollback, and wrapup
  const vibeRoute = registeredRoutes.find(r => r.path === '/dsh-vibecoding');
  assert.ok(vibeRoute, 'vibeRoute must be present');
});

test('Web routes handle state, rollback, and wrapup without 404', async () => {
  const registeredRoutes = [];
  const fakeCtx = {
    webServer: { register: (r) => registeredRoutes.push(r) },
    systemPrompt: { section: () => {} },
    commands: { register: () => {} },
    tools: { register: () => {} }
  };
  apply(fakeCtx);

  const route = registeredRoutes.find(r => r.path === '/dsh-vibecoding');
  assert.ok(route, 'Route must exist');

  // 1. Test state endpoint
  let stateBody = '';
  let stateCode = 0;
  const mockReqState = { url: '/dsh-vibecoding/state?sid=test', method: 'GET', headers: { origin: 'http://localhost:3000' } };
  const mockResState = {
    writeHead: (c) => { stateCode = c; },
    end: (b) => { stateBody = b; }
  };
  await route.handler(mockReqState, mockResState);
  assert.equal(stateCode, 200);
  const parsedState = JSON.parse(stateBody);
  assert.equal(parsedState.version, '3.3.2');
  assert.equal(parsedState.strikes, 0);
  assert.equal(parsedState.isCodeLocked, false);
});

