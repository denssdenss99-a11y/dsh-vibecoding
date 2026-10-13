// lib/worktree.js — Git Worktree lifecycle manager for isolated AI subagents
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve, join } from 'node:path';
import { existsSync } from 'node:fs';

const exec = promisify(execFile);

/**
 * Sanitizes task name for use as branch name and folder.
 * @param {string} task
 * @returns {string}
 */
export function sanitizeTaskName(task) {
  return task
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'subtask';
}

/**
 * Creates an isolated git worktree for a subagent task.
 * @param {string} repoRoot - Project root directory
 * @param {string} taskName - Subtask identifier
 * @param {string} [baseBranch='HEAD'] - Base commit/branch
 * @returns {Promise<{ path: string, branch: string }>}
 */
export async function createWorktree(repoRoot, taskName, baseBranch = 'HEAD') {
  const safeName = sanitizeTaskName(taskName);
  const branchName = `vibe/${safeName}`;
  const worktreePath = resolve(repoRoot, '.worktrees', safeName);

  if (existsSync(worktreePath)) {
    return { path: worktreePath, branch: branchName, existed: true };
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
 * Safely removes a worktree and prunes git records.
 * @param {string} repoRoot
 * @param {string} taskName
 * @param {boolean} [deleteBranch=false]
 */
export async function removeWorktree(repoRoot, taskName, deleteBranch = false) {
  const safeName = sanitizeTaskName(taskName);
  const worktreePath = resolve(repoRoot, '.worktrees', safeName);
  const branchName = `vibe/${safeName}`;

  if (existsSync(worktreePath)) {
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
