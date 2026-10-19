import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  ensureMemory,
  readMemory,
  recordMilestone,
  recordFailedApproach,
  recordTechDebt,
  sessionWrapup
} from '../lib/memory.js';

function createTempDir() {
  return realpathSync(mkdtempSync(join(tmpdir(), 'dsh-mem-test-')));
}

test('Compound Engineering & Long-term Memory Lifecycle', async (t) => {
  const dir = createTempDir();

  t.after(() => {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {}
  });

  // 1. Initial memory creation
  const memPath = await ensureMemory(dir);
  assert.equal(memPath.endsWith('.dsh/memory/memory.md') || memPath.endsWith('.dsh\\memory\\memory.md'), true);

  const initialContent = await readMemory(dir);
  assert.equal(initialContent.includes('## 1. Executive Summary & Architecture'), true);
  assert.equal(initialContent.includes('## 4. Failed Approaches & Dead Ends'), true);

  // 2. Record Milestone
  await recordMilestone(dir, 'JWT Token Refresh Endpoint Implemented');
  const afterMilestone = await readMemory(dir);
  assert.equal(afterMilestone.includes('JWT Token Refresh Endpoint Implemented'), true);

  // 3. Record Failed Approach (Loop Prevention)
  await recordFailedApproach(dir, {
    approach: 'Direct string email matching in Stripe callback',
    whyFailed: 'Emails in Stripe and Google differ, losing payments',
    recommendation: 'Use persistent user_id in payment metadata'
  });

  const afterFailed = await readMemory(dir);
  assert.equal(afterFailed.includes('Failed Attempt'), true);
  assert.equal(afterFailed.includes('Direct string email matching in Stripe callback'), true);
  assert.equal(afterFailed.includes('Use persistent user_id in payment metadata'), true);

  // 4. Record Tech Debt
  await recordTechDebt(dir, 'Add Redis cache layer for heavy reporting queries');
  const afterDebt = await readMemory(dir);
  assert.equal(afterDebt.includes('[DEBT] Add Redis cache layer for heavy reporting queries'), true);

  // 5. Session Wrap-up
  await sessionWrapup(dir, {
    summary: 'Auth & Billing Phase Completed',
    completedMilestones: ['All unit tests green'],
    newTechDebt: ['Migrate from SQLite to PostgreSQL in production']
  });

  const afterWrapup = await readMemory(dir);
  assert.equal(afterWrapup.includes('Auth & Billing Phase Completed'), true);
  assert.equal(afterWrapup.includes('All unit tests green'), true);
  assert.equal(afterWrapup.includes('Migrate from SQLite to PostgreSQL'), true);
});
