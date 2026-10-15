import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, realpathSync, existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

function createTempRepo() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'dsh-ckpt-test-')));
  return dir;
}

test('checkpoint creation on clean tree and rollback without over-shooting', async (t) => {
  const repo = createTempRepo();

  t.after(async () => {
    try {
      rmSync(repo, { recursive: true, force: true });
    } catch {}
  });

  await exec('git', ['init', '-b', 'main'], { cwd: repo });
  await exec('git', ['config', 'user.name', 'Test User'], { cwd: repo });
  await exec('git', ['config', 'user.email', 'test@example.com'], { cwd: repo });

  // Commit 1
  await writeFile(join(repo, 'file1.txt'), 'version 1');
  await exec('git', ['add', 'file1.txt'], { cwd: repo });
  await exec('git', ['commit', '-m', 'Commit 1'], { cwd: repo });
  const { stdout: commit1Sha } = await exec('git', ['rev-parse', 'HEAD'], { cwd: repo });

  // Commit 2
  await writeFile(join(repo, 'file2.txt'), 'version 2');
  await exec('git', ['add', 'file2.txt'], { cwd: repo });
  await exec('git', ['commit', '-m', 'Commit 2'], { cwd: repo });
  const { stdout: commit2Sha } = await exec('git', ['rev-parse', 'HEAD'], { cwd: repo });

  // Working tree is completely CLEAN.
  // Create checkpoint using synthetic commit-tree
  const safeLabel = 'pre_merge';
  const name = `vibe-ckpt-${safeLabel}`;
  const tempIndex = join(repo, '.git', `vibe_ckpt_test_${Date.now()}`);

  await exec('git', ['add', '-A'], { cwd: repo, env: { ...process.env, GIT_INDEX_FILE: tempIndex } });
  const { stdout: treeSha } = await exec('git', ['write-tree'], { cwd: repo, env: { ...process.env, GIT_INDEX_FILE: tempIndex } });
  const { stdout: headSha } = await exec('git', ['rev-parse', 'HEAD'], { cwd: repo });

  // Synthetic commit-tree always parented to HEAD
  const commitArgs = ['commit-tree', treeSha.trim(), '-p', headSha.trim(), '-m', `vibe-checkpoint: ${safeLabel}`];
  const { stdout: commitSha } = await exec('git', commitArgs, { cwd: repo });
  await exec('git', ['tag', '-f', name, commitSha.trim()], { cwd: repo });

  // Verify that ${name}^1 points directly to Commit 2!
  const { stdout: parentSha } = await exec('git', ['rev-parse', `${name}^1`], { cwd: repo });
  assert.equal(parentSha.trim(), commit2Sha.trim(), 'Checkpoint parent must match commit 2 exactly');

  // Now advance HEAD with a subsequent merge / commit
  await writeFile(join(repo, 'file3.txt'), 'version 3 (breaking merge)');
  await exec('git', ['add', 'file3.txt'], { cwd: repo });
  await exec('git', ['commit', '-m', 'Commit 3 (Merge)'], { cwd: repo });

  // Rollback to checkpoint
  await exec('git', ['read-tree', '--reset', '-u', name], { cwd: repo });
  const { stdout: pSha } = await exec('git', ['rev-parse', `${name}^1`], { cwd: repo });
  await exec('git', ['reset', pSha.trim()], { cwd: repo });

  // Verify HEAD is now Commit 2 (Commit 2 was NOT lost, and we did NOT overshoot to Commit 1!)
  const { stdout: currentHead } = await exec('git', ['rev-parse', 'HEAD'], { cwd: repo });
  assert.equal(currentHead.trim(), commit2Sha.trim(), 'HEAD must be restored to Commit 2, not overshot to Commit 1');
  assert.equal(existsSync(join(repo, 'file3.txt')), false, 'file3 should have been reverted');
  assert.equal(existsSync(join(repo, 'file2.txt')), true, 'file2 must exist');
});
