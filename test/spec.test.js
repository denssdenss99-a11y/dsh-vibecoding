import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';

import {
  parseScope,
  validateScopeGate,
  advanceScopeStep,
  initScopeTemplate
} from '../lib/spec.js';

function createTempDir() {
  return realpathSync(mkdtempSync(join(tmpdir(), 'dsh-spec-test-')));
}

test('Spec Gatekeeper & Brownfield Scope Enforcement', async (t) => {
  const dir = createTempDir();

  t.after(() => {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {}
  });

  // 1. When scope.md does NOT exist: code editing is locked by Spec Gate
  const gateCheckInitial = await validateScopeGate(dir, 'src/main.js');
  assert.equal(gateCheckInitial.allowed, false);
  assert.match(gateCheckInitial.reason, /SPEC GATE LOCK/);

  // System files like scope.md or memory.md are always allowed
  const systemCheck = await validateScopeGate(dir, 'scope.md');
  assert.equal(systemCheck.allowed, true);

  const memCheck = await validateScopeGate(dir, '.dsh/memory/memory.md');
  assert.equal(memCheck.allowed, true);

  // 2. Initialize scope.md
  await initScopeTemplate(dir, 'User Auth & Billing', [
    { title: 'Auth API contracts', targetFiles: ['src/auth.js', 'test/auth.test.js'] },
    { title: 'Stripe webhook listener', targetFiles: ['src/billing.js'] }
  ]);

  const parsed = await parseScope(dir);
  assert.equal(parsed.exists, true);
  assert.equal(parsed.totalSteps, 2);
  assert.equal(parsed.completedSteps, 0);
  assert.equal(parsed.activeStep.index, 1);
  assert.deepEqual(parsed.activeStep.targetFiles, ['src/auth.js', 'test/auth.test.js']);

  // 3. Brownfield Target File Whitelist validation:
  // Target file allowed:
  const allowedTarget = await validateScopeGate(dir, 'src/auth.js');
  assert.equal(allowedTarget.allowed, true);

  // File outside whitelist BLOCKED:
  const blockedAdjacent = await validateScopeGate(dir, 'src/other.js');
  assert.equal(blockedAdjacent.allowed, false);
  assert.match(blockedAdjacent.reason, /BROWNFIELD SCOPE LOCK/);

  // 4. Advance Step 1 -> Step 2
  const advRes = await advanceScopeStep(dir);
  assert.equal(advRes.success, true);
  assert.equal(advRes.completedStep.title.includes('Auth API'), true);
  assert.equal(advRes.nextStep.index, 2);

  // Now src/billing.js is allowed, but src/auth.js is outside Step 2
  const billingAllowed = await validateScopeGate(dir, 'src/billing.js');
  assert.equal(billingAllowed.allowed, true);

  // 5. Advance Step 2 -> All Complete
  const advRes2 = await advanceScopeStep(dir);
  assert.equal(advRes2.success, true);
  assert.equal(advRes2.isAllComplete, true);

  const finalGate = await validateScopeGate(dir, 'src/billing.js');
  assert.equal(finalGate.allowed, false);
  assert.match(finalGate.reason, /SCOPE COMPLETED/);
});
