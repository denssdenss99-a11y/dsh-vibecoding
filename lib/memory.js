// lib/memory.js — Compound Engineering & Long-term Memory Engine
// Implements 3-tier context persistence, Session Wrap-up rule, and Failed Approaches tracking to eliminate loop amnesia.

import { resolve, join } from 'node:path';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const INITIAL_MEMORY_TEMPLATE = `# PROJECT LONG-TERM MEMORY (.dsh/memory/memory.md)

## 1. Executive Summary & Architecture
- **Goal:** [Project core functionality & target deliverables]
- **Entry Points:** [index.html / src/index.js / main.py]
- **Current Architecture State:** Initialized

## 2. Tech Stack & Engineering Guardrails
- **KISS Invariant:** Minimal viable abstractions.
- **Zero Dead Code:** Every file in src/ must be actively imported in entry points.
- **Anti-MenuGen Rule:** All user data and payments bound by persistent user_id.

## 3. Completed Milestones
- [${new Date().toISOString().split('T')[0]}] Project initialized under dsh-vibecoding 3.0.

## 4. Failed Approaches & Dead Ends (Loop Prevention)
<!-- Record all failed attempts, syntax traps, and architectural regressions here so agents NEVER repeat them across turns! -->

## 5. Active Technical Debt & Pending Refactors
<!-- Record deferred optimizations here -->
`;

/**
 * Returns the resolved path to memory.md, creating directory if necessary.
 * @param {string} repoRoot
 * @returns {Promise<string>}
 */
export async function ensureMemory(repoRoot) {
  const dir = resolve(repoRoot, '.dsh', 'memory');
  const file = resolve(dir, 'memory.md');

  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }

  if (!existsSync(file)) {
    // If a legacy root memory.md exists, migrate it
    const legacyRootFile = resolve(repoRoot, 'memory.md');
    if (existsSync(legacyRootFile)) {
      const content = await readFile(legacyRootFile, 'utf8');
      await writeFile(file, content, 'utf8');
    } else {
      await writeFile(file, INITIAL_MEMORY_TEMPLATE, 'utf8');
    }
  }

  return file;
}

/**
 * Reads project long-term memory.
 * @param {string} repoRoot
 * @returns {Promise<string>}
 */
export async function readMemory(repoRoot) {
  const file = await ensureMemory(repoRoot);
  return readFile(file, 'utf8');
}

/**
 * Records a completed milestone with date stamp into section 3.
 * @param {string} repoRoot
 * @param {string} milestoneText
 */
export async function recordMilestone(repoRoot, milestoneText) {
  const file = await ensureMemory(repoRoot);
  let content = await readFile(file, 'utf8');
  const dateStr = new Date().toISOString().split('T')[0];
  const entry = `- [${dateStr}] ${milestoneText.trim()}`;

  const targetHeader = '## 3. Completed Milestones';
  if (content.includes(targetHeader)) {
    content = content.replace(targetHeader, `${targetHeader}\n${entry}`);
  } else {
    content += `\n\n${targetHeader}\n${entry}`;
  }

  await writeFile(file, content, 'utf8');
  return true;
}

/**
 * Records a failed approach into Section 4 to prevent looping across context rotations.
 * @param {string} repoRoot
 * @param {{ error?: string, approach: string, whyFailed: string, recommendation?: string }} details
 */
export async function recordFailedApproach(repoRoot, details) {
  const file = await ensureMemory(repoRoot);
  let content = await readFile(file, 'utf8');
  const dateStr = new Date().toISOString().replace('T', ' ').slice(0, 16);

  const entry = `
### ❌ Failed Attempt [${dateStr}]
- **Attempted Approach:** ${details.approach}
- **Why It Failed:** ${details.whyFailed}
${details.error ? `- **Error Signature:** \`${details.error.slice(0, 300).replace(/\r?\n/g, ' ')}\`` : ''}
${details.recommendation ? `- **Forbidden Direction / Alternative:** ${details.recommendation}` : ''}
`;

  const targetHeader = '## 4. Failed Approaches & Dead Ends (Loop Prevention)';
  if (content.includes(targetHeader)) {
    content = content.replace(targetHeader, `${targetHeader}${entry}`);
  } else {
    content += `\n\n${targetHeader}${entry}`;
  }

  await writeFile(file, content, 'utf8');
  return true;
}

/**
 * Records pending technical debt or known issues into Section 5.
 * @param {string} repoRoot
 * @param {string} debtDescription
 */
export async function recordTechDebt(repoRoot, debtDescription) {
  const file = await ensureMemory(repoRoot);
  let content = await readFile(file, 'utf8');
  const entry = `- [DEBT] ${debtDescription.trim()}`;

  const targetHeader = '## 5. Active Technical Debt & Pending Refactors';
  if (content.includes(targetHeader)) {
    content = content.replace(targetHeader, `${targetHeader}\n${entry}`);
  } else {
    content += `\n\n${targetHeader}\n${entry}`;
  }

  await writeFile(file, content, 'utf8');
  return true;
}

/**
 * Executes the End-of-Session Wrap-up rule.
 * Summarizes session progress, updates milestones, and records pending tech debt.
 * @param {string} repoRoot
 * @param {{ summary: string, completedMilestones?: string[], newTechDebt?: string[] }} data
 */
export async function sessionWrapup(repoRoot, data) {
  const file = await ensureMemory(repoRoot);
  let content = await readFile(file, 'utf8');
  const dateStr = new Date().toISOString().split('T')[0];

  // Update executive state
  const stateRegex = /(-\s*\*\*Current Architecture State:\*\*).*/;
  if (stateRegex.test(content)) {
    content = content.replace(stateRegex, `$1 [Updated ${dateStr}] ${data.summary}`);
  }

  await writeFile(file, content, 'utf8');

  if (data.completedMilestones?.length) {
    for (const m of data.completedMilestones) {
      await recordMilestone(repoRoot, m);
    }
  }

  if (data.newTechDebt?.length) {
    for (const d of data.newTechDebt) {
      await recordTechDebt(repoRoot, d);
    }
  }

  return true;
}
