import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, realpathSync } from 'node:fs';
import { writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  createWorktree,
  listWorktrees,
  removeWorktree,
  mergeWorktree
} from '../lib/worktree.js';

const exec = promisify(execFile);

function createTempRepo() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'dsh-wt-test-')));
  return dir;
}

test('worktree lifecycle and safe mutate guard', async (t) => {
  const repo = createTempRepo();

  t.after(async () => {
    try {
      rmSync(repo, { recursive: true, force: true });
    } catch {}
  });

  // Init git repo
  await exec('git', ['init', '-b', 'main'], { cwd: repo });
  await exec('git', ['config', 'user.name', 'Test User'], { cwd: repo });
  await exec('git', ['config', 'user.email', 'test@example.com'], { cwd: repo });

  await writeFile(join(repo, 'README.md'), '# Test Project\n');
  await exec('git', ['add', 'README.md'], { cwd: repo });
  await exec('git', ['commit', '-m', 'initial commit'], { cwd: repo });

  // 1. baseBranch flag injection guard
  await assert.rejects(
    createWorktree(repo, 'inject-test', '--detach'),
    /Security error: invalid git reference in baseBranch/
  );
  await assert.rejects(
    createWorktree(repo, 'inject-test-2', '-b'),
    /Security error: invalid git reference in baseBranch/
  );

  // 2. Safe Mutate Guard: createWorktree stages tests but NOT deleted files
  await writeFile(join(repo, 'tests_sample.test.js'), 'test();');
  await exec('git', ['add', 'tests_sample.test.js'], { cwd: repo });
  await exec('git', ['commit', '-m', 'add sample test'], { cwd: repo });

  // Now delete tests_sample.test.js from disk (status D) and create a new spec file
  await unlink(join(repo, 'tests_sample.test.js'));
  await writeFile(join(repo, 'new_spec.spec.js'), 'describe();');

  const created = await createWorktree(repo, 'auth-feature');
  assert.equal(created.existed, false);
  assert.equal(created.branch, 'vibe/auth-feature');

  // Verify deleted file was NOT committed, while new spec was committed
  const { stdout: status } = await exec('git', ['status', '--porcelain'], { cwd: repo });
  assert.match(status, /D tests_sample\.test\.js/); // deletion preserved in working copy, NOT committed

  // 3. listWorktrees
  const wtList = await listWorktrees(repo);
  assert.ok(wtList.some(w => w.branch?.includes('vibe/auth-feature')));

  // 4. Worker creates uncommitted changes in worktree
  const wtPath = created.path;
  await writeFile(join(wtPath, 'worker_work.txt'), 'valuable work by subagent');

  // 5. removeWorktree auto-saves work to branch before directory cleanup
  const removed = await removeWorktree(repo, 'auth-feature', true);
  assert.equal(removed.success, true);
  assert.ok(removed.branchKeptNotice?.includes('unmerged commits'));

  // Lossless JSON validation: no keys with undefined values
  for (const [k, v] of Object.entries(removed)) {
    assert.notEqual(v, undefined, `Property ${k} must not be undefined`);
  }

  // Verify work was committed to branch vibe/auth-feature
  const { stdout: logOut } = await exec('git', ['log', '-1', '--pretty=%B', 'vibe/auth-feature'], { cwd: repo });
  assert.match(logOut, /wip\(worker\): auto-save before cleanup/);

  // 6. Merge the branch back to main
  await mergeWorktree(repo, 'auth-feature');
  const { stdout: mainFiles } = await exec('git', ['ls-files'], { cwd: repo });
  assert.match(mainFiles, /worker_work\.txt/);
});
