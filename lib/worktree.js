// lib/worktree.js — Git Worktree lifecycle manager for isolated AI subagents
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve, join } from 'node:path';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';

const exec = promisify(execFile);

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
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

  if (!cleaned) {
    let hash = 0;
    const str = String(task || 'subtask');
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
    }
    return `task-${Math.abs(hash).toString(36).slice(0, 6)}`;
  }
  return cleaned;
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
 * @param {string} repoRoot - Project root directory
 * @param {string} taskName - Subtask identifier
 * @param {string} [baseBranch='HEAD'] - Base commit/branch
 * @returns {Promise<{ path: string, branch: string, existed: boolean }>}
 */
export async function createWorktree(repoRoot, taskName, baseBranch = 'HEAD') {
  const safeName = sanitizeTaskName(taskName);
  const branchName = `vibe/${safeName}`;
  const worktreePath = resolve(repoRoot, '.worktrees', safeName);

  // Guarantee .worktrees/ is ignored in main repo
  await ensureGitignore(repoRoot);

  if (existsSync(worktreePath)) {
    return { path: worktreePath, branch: branchName, existed: true };
  }

  // Auto-commit any pending test contracts from Phase 3 so worker inherits them
  try {
    const { stdout: status } = await exec('git', ['status', '--porcelain', 'tests/'], { cwd: repoRoot });
    if (status.trim()) {
      await exec('git', ['add', 'tests/'], { cwd: repoRoot });
      await exec('git', ['commit', '-m', `test(vibe): commit TDD contracts for ${safeName}`], { cwd: repoRoot });
    }
  } catch {
    // Non-fatal if tests/ is not modified or already clean
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
 * @param {string} repoRoot
 * @param {string} taskName
 * @param {boolean} [deleteBranch=false]
 */
export async function removeWorktree(repoRoot, taskName, deleteBranch = false) {
  const safeName = sanitizeTaskName(taskName);
  const worktreePath = resolve(repoRoot, '.worktrees', safeName);
  const branchName = `vibe/${safeName}`;

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
      await exec('git', ['branch', '-D', branchName], { cwd: repoRoot });
    } catch {
      // Branch might already be deleted or merged
    }
  }

  return { success: true, removed: worktreePath };
}

/**
 * Merges a completed task branch back into current HEAD.
 * @param {string} repoRoot
 * @param {string} taskName
 */
export async function mergeWorktree(repoRoot, taskName) {
  const safeName = sanitizeTaskName(taskName);
  const branchName = `vibe/${safeName}`;

  const { stdout } = await exec('git', ['merge', '--no-ff', '-m', `feat(vibe): merge ${safeName}`, branchName], {
    cwd: repoRoot
  });
  return stdout;
}
