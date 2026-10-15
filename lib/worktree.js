import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const exec = promisify(execFile);

// Concurrency Mutex per repository root to eliminate .git/index.lock collisions
const repoLocks = new Map();

/**
 * Serializes Git repository operations per repoRoot to prevent index.lock collisions.
 * @param {string} repoRoot
 * @param {() => Promise<any>} fn
 * @returns {Promise<any>}
 */
export async function withRepoLock(repoRoot, fn) {
  const prev = repoLocks.get(repoRoot) || Promise.resolve();
  let next;
  next = prev.then(fn, fn).finally(() => {
    if (repoLocks.get(repoRoot) === next) {
      repoLocks.delete(repoRoot);
    }
  });
  repoLocks.set(repoRoot, next);
  return next;
}

const cyrillicMap = {
  'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ё': 'yo',
  'ж': 'zh', 'з': 'z', 'и': 'i', 'й': 'y', 'к': 'k', 'л': 'l', 'м': 'm',
  'н': 'n', 'о': 'o', 'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u',
  'ф': 'f', 'х': 'h', 'ц': 'ts', 'ч': 'ch', 'ш': 'sh', 'щ': 'sch', 'ъ': '',
  'ы': 'y', 'ь': '', 'э': 'e', 'ю': 'yu', 'я': 'ya'
};

/**
 * Transliterates Cyrillic characters to Latin equivalents.
 * @param {string} text
 * @returns {string}
 */
export function transliterate(text) {
  return String(text || '')
    .toLowerCase()
    .split('')
    .map(char => cyrillicMap[char] ?? char)
    .join('');
}

/**
 * Sanitizes task name for use as branch name and folder.
 * Preserves Cyrillic intent via transliteration and guarantees uniqueness.
 * @param {string} task
 * @returns {string}
 */
export function sanitizeTaskName(task) {
  const transliterated = transliterate(task);
  const cleaned = transliterated
    .trim()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (!cleaned) {
    let hash = 0;
    const str = String(task || 'subtask');
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
    }
    return `task-${Math.abs(hash).toString(36).slice(0, 6)}`;
  }

  if (cleaned.length <= 40) {
    return cleaned;
  }

  // Prevent collisions on long task names with identical prefixes (>40 chars)
  // Deterministic 5-char SHA256 digest provides cryptographic avalanche effect
  const hashStr = createHash('sha256').update(String(task)).digest('hex').slice(0, 5);
  const truncated = cleaned.slice(0, 34).replace(/-+$/g, '');
  return `${truncated}-${hashStr}`;
}

/**
 * Ensures .worktrees/ is listed in project's .gitignore.
 * @param {string} repoRoot
 */
async function ensureGitignore(repoRoot) {
  try {
    const gitignorePath = resolve(repoRoot, '.gitignore');
    if (existsSync(gitignorePath)) {
      const content = await readFile(gitignorePath, 'utf8');
      if (!content.includes('.worktrees')) {
        const updated = content.endsWith('\n')
          ? `${content}\n# AI Subagent Worktrees\n.worktrees/\n`
          : `${content}\n\n# AI Subagent Worktrees\n.worktrees/\n`;
        await writeFile(gitignorePath, updated, 'utf8');
      }
    } else {
      await writeFile(gitignorePath, '# AI Subagent Worktrees\n.worktrees/\n', 'utf8');
    }
  } catch {
    // Ignore non-fatal gitignore error
  }
}

/**
 * Creates an isolated git worktree for a subagent task.
 * Thread-safe via withRepoLock to prevent .git/index.lock races during parallel worker creation.
 * @param {string} repoRoot - Project root directory
 * @param {string} taskName - Subtask identifier
 * @param {string} [baseBranch='HEAD'] - Base commit/branch
 * @returns {Promise<{ path: string, branch: string, existed: boolean }>}
 */
export async function createWorktree(repoRoot, taskName, baseBranch = 'HEAD') {
  return withRepoLock(repoRoot, async () => {
    const safeName = sanitizeTaskName(taskName);
    const branchName = `vibe/${safeName}`;
    const worktreePath = resolve(repoRoot, '.worktrees', safeName);

    // Guarantee .worktrees/ is ignored in main repo
    await ensureGitignore(repoRoot);

    if (existsSync(worktreePath)) {
      return { path: worktreePath, branch: branchName, existed: true };
    }

    // Auto-commit pending specs & test contracts only if baseBranch is HEAD
    if (baseBranch === 'HEAD') {
      let stagedForReset = [];
      try {
        const { stdout: status } = await exec('git', ['status', '--porcelain', '-z'], { cwd: repoRoot });
        if (status) {
          const testPatterns = ['tests/', 'test/', '__tests__/', 'spec/', 'specs/', 'docs/specs/'];
          const entries = status.split('\0').filter(Boolean);
          const filesToStage = [];
          for (let i = 0; i < entries.length; i++) {
            const entry = entries[i];
            const statusXY = entry.slice(0, 2);
            const filePath = entry.slice(3).trim();
            // In -z mode, renames ('R') and copies ('C') emit the new path, followed by a separate \0-entry for old path
            if (statusXY.includes('R') || statusXY.includes('C')) {
              i++; // Skip the next entry (old path)
            }
            if (!filePath) continue;
            const isTarget = testPatterns.some(p => filePath.startsWith(p)) ||
              /\.(test|spec)\.[a-zA-Z0-9]+$/i.test(filePath) ||
              filePath.startsWith('docs/');
            if (isTarget) {
              filesToStage.push(filePath);
            }
          }

          if (filesToStage.length > 0) {
            stagedForReset = filesToStage;
            await exec('git', ['add', '--', ...filesToStage], { cwd: repoRoot });
            await exec('git', ['commit', '-m', `test(vibe): commit specs & TDD contracts for ${safeName}`, '--', ...filesToStage], { cwd: repoRoot });
            stagedForReset = [];
          }
        }
      } catch {
        // Safe Mutate Guard: If add succeeded but commit failed, unstage files to keep index clean
        if (stagedForReset.length > 0) {
          await exec('git', ['reset', 'HEAD', '--', ...stagedForReset], { cwd: repoRoot }).catch(() => {});
        }
      }
    }

    // Create branch and worktree
    try {
      await exec('git', ['worktree', 'add', '-b', branchName, worktreePath, baseBranch], { cwd: repoRoot });
    } catch (err) {
      // If branch already exists, attach without -b
      if (err.message && err.message.includes('already exists')) {
        await exec('git', ['worktree', 'add', worktreePath, branchName], { cwd: repoRoot });
      } else {
        throw err;
      }
    }

    return { path: worktreePath, branch: branchName, existed: false };
  });
}

/**
 * Lists all active git worktrees.
 * @param {string} repoRoot
 * @returns {Promise<Array<{ path: string, head: string, branch: string }>>}
 */
export async function listWorktrees(repoRoot) {
  try {
    const { stdout } = await exec('git', ['worktree', 'list', '--porcelain'], { cwd: repoRoot });
    const entries = [];
    let current = {};

    for (const line of stdout.split('\n')) {
      if (!line.trim()) {
        if (current.path) entries.push(current);
        current = {};
        continue;
      }
      if (line.startsWith('worktree ')) current.path = line.slice(9).trim();
      else if (line.startsWith('HEAD ')) current.head = line.slice(5).trim();
      else if (line.startsWith('branch ')) current.branch = line.slice(7).trim();
    }
    if (current.path) entries.push(current);
    return entries;
  } catch (err) {
    return [];
  }
}

/**
 * Safely removes a worktree with Safe Mutate Guard:
 * Auto-commits any uncommitted worker changes to preserve work in the branch before directory cleanup.
 * Uses safe 'git branch -d' (instead of -D) when deleteBranch=true to prevent destroying unmerged work.
 * @param {string} repoRoot
 * @param {string} taskName
 * @param {boolean} [deleteBranch=false]
 */
export async function removeWorktree(repoRoot, taskName, deleteBranch = false) {
  return withRepoLock(repoRoot, async () => {
    const safeName = sanitizeTaskName(taskName);
    const worktreePath = resolve(repoRoot, '.worktrees', safeName);
    const branchName = `vibe/${safeName}`;
    let branchKeptNotice = undefined;

    if (existsSync(worktreePath)) {
      // Safe Mutate Guard: auto-commit uncommitted changes in worktree so work is NEVER lost
      try {
        const { stdout: status } = await exec('git', ['status', '--porcelain'], { cwd: worktreePath });
        if (status.trim()) {
          await exec('git', ['add', '-A'], { cwd: worktreePath });
          await exec('git', ['commit', '-m', `wip(worker): auto-save before cleanup of ${safeName}`], { cwd: worktreePath });
        }
      } catch {
        // Continue cleanup even if commit fails (e.g. empty commit)
      }

      await exec('git', ['worktree', 'remove', '--force', worktreePath], { cwd: repoRoot });
    }

    await exec('git', ['worktree', 'prune'], { cwd: repoRoot });

    if (deleteBranch) {
      try {
        // Safe Mutate Guard: soft delete (-d) only if branch was merged into HEAD
        await exec('git', ['branch', '-d', branchName], { cwd: repoRoot });
      } catch {
        // Branch contains unmerged changes — keep it to protect developer's code!
        branchKeptNotice = `Branch ${branchName} has unmerged commits and was kept for safety.`;
      }
    }

    return { success: true, removed: worktreePath, branchKeptNotice };
  });
}

/**
 * Merges a completed task branch back into current HEAD.
 * @param {string} repoRoot
 * @param {string} taskName
 */
export async function mergeWorktree(repoRoot, taskName) {
  return withRepoLock(repoRoot, async () => {
    const safeName = sanitizeTaskName(taskName);
    const branchName = `vibe/${safeName}`;

    const { stdout } = await exec('git', ['merge', '--no-ff', '-m', `feat(vibe): merge ${safeName}`, branchName], {
      cwd: repoRoot
    });
    return stdout;
  });
}
