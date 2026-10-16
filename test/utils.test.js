import test from 'node:test';
import assert from 'node:assert/strict';
import { isInsideRoot, isAllowedLocalOrigin } from '../lib/index.js';
import { transliterate, sanitizeTaskName } from '../lib/worktree.js';
import { resolve } from 'node:path';

test('isInsideRoot guards against path traversal', () => {
  const root = '/repo/project';

  assert.equal(isInsideRoot(root, '/repo/project'), true);
  assert.equal(isInsideRoot(root, '/repo/project/src/index.js'), true);
  assert.equal(isInsideRoot(root, '/repo/project/.worktrees/task-1'), true);

  // Directory traversal attacks
  assert.equal(isInsideRoot(root, '/repo/project/../outside'), false);
  assert.equal(isInsideRoot(root, '/etc/passwd'), false);
  assert.equal(isInsideRoot(root, '/repo/project-evil'), false);
  assert.equal(isInsideRoot(root, '/repo/projectevil/file'), false);
});

test('isAllowedLocalOrigin permits only loopback origins', () => {
  assert.equal(isAllowedLocalOrigin('http://localhost'), true);
  assert.equal(isAllowedLocalOrigin('http://localhost:3080'), true);
  assert.equal(isAllowedLocalOrigin('http://127.0.0.1:3080'), true);
  assert.equal(isAllowedLocalOrigin('http://[::1]:3080'), true);
  assert.equal(isAllowedLocalOrigin('http://[::1]'), true);
  assert.equal(isAllowedLocalOrigin(''), true);
  assert.equal(isAllowedLocalOrigin(undefined), true);
  assert.equal(isAllowedLocalOrigin(null), true);

  // Disallowed origins
  assert.equal(isAllowedLocalOrigin('http://evil.com'), false);
  assert.equal(isAllowedLocalOrigin('http://localhost.evil.com'), false);
  assert.equal(isAllowedLocalOrigin('http://127.0.0.1.nip.io'), false);
  assert.equal(isAllowedLocalOrigin('https://example.com:3080'), false);
  assert.equal(isAllowedLocalOrigin('not-a-valid-url'), false);
  // Non-http(s) protocols must be rejected even with localhost host
  assert.equal(isAllowedLocalOrigin('ftp://localhost'), false);
  assert.equal(isAllowedLocalOrigin('file://localhost'), false);
  assert.equal(isAllowedLocalOrigin('ws://localhost'), false);
  assert.equal(isAllowedLocalOrigin('gopher://localhost'), false);
});

test('transliterate and sanitizeTaskName handle Russian & special characters', () => {
  assert.equal(transliterate('Привет Мир'), 'privet mir');
  assert.equal(sanitizeTaskName('Привет Мир!'), 'privet-mir');
  assert.equal(sanitizeTaskName('task_123--auth'), 'task_123--auth');
  assert.equal(sanitizeTaskName('  --subtask--  '), 'subtask');

  // Empty or non-alphanumeric string generates deterministic hash
  const emptySanitized = sanitizeTaskName('!!!@@@###');
  assert.match(emptySanitized, /^task-[a-z0-9]+$/);

  // Tasks longer than 40 characters are truncated with sha256 suffix
  const longName = 'this-is-a-very-long-task-name-exceeding-forty-characters-limit';
  const sanitizedLong = sanitizeTaskName(longName);
  assert.ok(sanitizedLong.length <= 40);
  assert.match(sanitizedLong, /-[a-f0-9]{5}$/);
});
