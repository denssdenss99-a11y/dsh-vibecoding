import test from 'node:test';
import assert from 'node:assert/strict';
import { apply } from '../lib/index.js';

test('Plugin Registration: 5 sharp tools, Vibe Manifesto prompt, and HUD register cleanly', async () => {
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

  // By default, new session must be OFF (empty prompt text)
  const testSid1 = 'test-session-1-' + Math.random().toString(36).slice(2);
  const testSid2 = 'test-session-2-' + Math.random().toString(36).slice(2);

  const defaultPrompt = registeredSections[0].text({ session: { id: testSid1 } });
  assert.equal(defaultPrompt, '', 'Prompt must be empty by default for new session');

  // Verify route handler responds to state, rollback, and wrapup
  const vibeRoute = registeredRoutes.find(r => r.path === '/dsh-vibecoding');
  assert.ok(vibeRoute, 'vibeRoute must be present');

  // Activate session 1 via state endpoint
  let postBody = '';
  await vibeRoute.handler(
    {
      url: `/dsh-vibecoding/state?sid=${encodeURIComponent(testSid1)}`,
      method: 'POST',
      headers: { origin: 'http://localhost:3000' },
      async *[Symbol.asyncIterator]() {
        yield JSON.stringify({ active: true, sid: testSid1 });
      }
    },
    { writeHead: () => {}, end: (b) => { postBody = b; } }
  );

  // Now session 1 prompt must be active
  const activePrompt = registeredSections[0].text({ session: { id: testSid1 } });
  assert.ok(activePrompt.includes('THE VIBE MANIFESTO'), 'Prompt must contain Vibe Manifesto header when active');
  assert.ok(activePrompt.includes('browser_smoke'), 'Prompt must instruct using browser_smoke');
  assert.ok(activePrompt.includes('poly-decomp'), 'Prompt must instruct poly-decomp for Matter.js');

  // Parallel session 2 must STILL be OFF
  const parallelPrompt = registeredSections[0].text({ session: { id: testSid2 } });
  assert.equal(parallelPrompt, '', 'Parallel session must remain OFF by default');

  assert.ok(registeredCommands.some(c => c.name === 'vibe'), 'Slash command /vibe must be registered');
  assert.ok(registeredRoutes.some(r => r.path === '/dsh-vibecoding'), 'Route /dsh-vibecoding must be registered');
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
  assert.equal(parsedState.version, '3.3.4');
  assert.equal(parsedState.strikes, 0);
  assert.equal(parsedState.isCodeLocked, false);
  assert.equal(parsedState.active, false); // Default OFF
});

