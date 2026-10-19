import test from 'node:test';
import assert from 'node:assert/strict';
import { StrikeMachine } from '../lib/strikes.js';

test('3-Strike Rule Deadlock Machine & Code Editing Lock', () => {
  const sm = new StrikeMachine();
  const sid = 'test-session-1';

  // 1. Initial State
  assert.equal(sm.getStrike(sid), 0);
  assert.equal(sm.isCodeEditingLocked(sid), false);

  // 2. Strike 1: Failure 1
  const fail1 = sm.recordFailure(sid, {
    errorOutput: 'SyntaxError: Unexpected token in auth.js line 42',
    expected: 'Server runs without syntax error',
    actual: 'SyntaxError on line 42'
  });

  assert.equal(fail1.strike, 1);
  assert.equal(fail1.isCodeLocked, false);
  assert.equal(fail1.triggerRollback, false);
  assert.equal(fail1.diagnosticMessage.includes('[3-COMPONENT DIAGNOSTIC (STRIKE 1/3)]'), true);
  assert.equal(sm.isCodeEditingLocked(sid), false);

  // 3. Strike 2: Failure 2 (Locks code editing, requires Root Cause Analysis)
  const fail2 = sm.recordFailure(sid, {
    errorOutput: 'TypeError: Cannot read properties of undefined (reading "user_id")'
  });

  assert.equal(fail2.strike, 2);
  assert.equal(fail2.isCodeLocked, true);
  assert.equal(fail2.triggerRollback, false);
  assert.equal(fail2.directive.includes('STRIKE 2 ACTIVE'), true);
  assert.equal(fail2.directive.includes('ultrathink'), true);
  assert.equal(sm.isCodeEditingLocked(sid), true);

  // 4. Attempt unlock with too short RCA
  const shortRca = sm.unlockAfterRca(sid, 'bad fix');
  assert.equal(shortRca.success, false);
  assert.equal(sm.isCodeEditingLocked(sid), true);

  // Valid RCA unlocks code editing
  const goodRca = sm.unlockAfterRca(sid, 'Root cause: session middleware was loaded after auth router. Solution: reorder Express middleware pipeline.');
  assert.equal(goodRca.success, true);
  assert.equal(sm.isCodeEditingLocked(sid), false);

  // 5. Strike 3: Failure 3 (Deadlock limit, triggers emergency rollback)
  const fail3 = sm.recordFailure(sid, {
    errorOutput: 'Fatal crash: Circular dependency loop'
  });

  assert.equal(fail3.strike, 3);
  assert.equal(fail3.isCodeLocked, true);
  assert.equal(fail3.triggerRollback, true);
  assert.equal(fail3.directive.includes('STRIKE 3/3: CRITICAL LOOP DEADLOCK'), true);

  // 6. Record Success (GREEN): Resets all strikes to 0
  sm.recordSuccess(sid);
  assert.equal(sm.getStrike(sid), 0);
  assert.equal(sm.isCodeEditingLocked(sid), false);
});
