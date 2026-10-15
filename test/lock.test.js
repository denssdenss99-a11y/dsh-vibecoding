import test from 'node:test';
import assert from 'node:assert/strict';
import { withRepoLock } from '../lib/worktree.js';

test('withRepoLock serializes concurrent operations for the same repo', async () => {
  const repo = '/mock/repo/path';
  const order = [];

  const task1 = withRepoLock(repo, async () => {
    await new Promise(r => setTimeout(r, 40));
    order.push('task1');
    return 1;
  });

  const task2 = withRepoLock(repo, async () => {
    await new Promise(r => setTimeout(r, 10));
    order.push('task2');
    return 2;
  });

  const [res1, res2] = await Promise.all([task1, task2]);
  assert.equal(res1, 1);
  assert.equal(res2, 2);
  assert.deepEqual(order, ['task1', 'task2']);
});

test('withRepoLock recovers gracefully after an error', async () => {
  const repo = '/mock/repo/path2';

  await assert.rejects(
    withRepoLock(repo, async () => {
      throw new Error('Lock failure simulation');
    }),
    /Lock failure simulation/
  );

  // Subsequent call should succeed without deadlock
  const nextRes = await withRepoLock(repo, async () => {
    return 'recovered';
  });
  assert.equal(nextRes, 'recovered');
});
