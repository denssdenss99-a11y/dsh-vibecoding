// lib/strikes.js — The 3-Strike Rule Deadlock Breaker & State Machine
// Prevents infinite "fix the fix" agent loops by programmatically locking code edits on Strike 2 and triggering auto-rollback on Strike 3.

export class StrikeMachine {
  constructor() {
    this.strikeCounts = new Map(); // Map<sid, number>
    this.isLocked = new Map(); // Map<sid, boolean>
    this.failureHistory = new Map(); // Map<sid, Array<{ error: string, timestamp: number }>>
    this.rcaState = new Map(); // Map<sid, { rcaText: string, unlockedAt: number }>
  }

  /**
   * Returns current strike count for session.
   * @param {string} sid
   * @returns {number}
   */
  getStrike(sid = 'default') {
    return this.strikeCounts.get(sid) || 0;
  }

  /**
   * Checks if code editing is currently locked for this session.
   * @param {string} sid
   * @returns {boolean}
   */
  isCodeEditingLocked(sid = 'default') {
    return this.isLocked.get(sid) === true;
  }

  /**
   * Resets strike counter upon successful test run (GREEN) or deliverable smoke check pass.
   * @param {string} sid
   */
  recordSuccess(sid = 'default') {
    this.strikeCounts.set(sid, 0);
    this.isLocked.set(sid, false);
    this.failureHistory.delete(sid);
    this.rcaState.delete(sid);
  }

  /**
   * Records a test or build failure, advancing the 3-Strike state machine.
   * @param {string} sid
   * @param {{ errorOutput: string, testCommand?: string, expected?: string, actual?: string }} details
   * @returns {{
   *   strike: number,
   *   isCodeLocked: boolean,
   *   triggerRollback: boolean,
   *   diagnosticMessage: string,
   *   directive: string
   * }}
   */
  recordFailure(sid = 'default', details) {
    const current = (this.strikeCounts.get(sid) || 0) + 1;
    this.strikeCounts.set(sid, current);

    if (!this.failureHistory.has(sid)) {
      this.failureHistory.set(sid, []);
    }
    const history = this.failureHistory.get(sid);
    history.push({
      error: details.errorOutput || 'Unknown failure',
      timestamp: Date.now()
    });

    const rawError = (details.errorOutput || '').slice(-3000);
    const expected = details.expected || 'Tests pass GREEN with zero exit code';
    const actual = details.actual || 'Command failed with nonzero exit code';

    if (current === 1) {
      this.isLocked.set(sid, false);
      const diagnostic = `
[3-COMPONENT DIAGNOSTIC (STRIKE 1/3)]
1. RAW CONSOLE / TERMINAL LOG:
${rawError}

2. EXPECTED VS ACTUAL BEHAVIOR:
- Expected: ${expected}
- Actual: ${actual}

3. ATOMIC ACTION DIRECTIVE:
Make ONE single, targeted code correction. Do not refactor adjacent files. Rerun verification.`;

      return {
        strike: 1,
        isCodeLocked: false,
        triggerRollback: false,
        diagnosticMessage: diagnostic,
        directive: 'Strike 1: Review 3-component diagnostic and perform targeted atomic fix.'
      };
    }

    if (current === 2) {
      // Strike 2: Physical lock on file editing!
      this.isLocked.set(sid, true);
      const rcaDirective = `
🛑 STRIKE 2 ACTIVE: CODE-EDITING PROGRAMMATICALLY LOCKED!
Agent loop detected (2 consecutive failed attempts).
In accordance with Rule 10 (3-Strike Protocol), you are CATEGORICALLY FORBIDDEN from modifying code files.

REQUIRED ACTION (ROOT CAUSE ANALYSIS):
ultrathink: Analyze the fundamental root cause of why the previous fix failed.
1. Formulate the exact physical mechanism of the bug.
2. Present 3 distinct, viable architectural solutions.
3. Call "strike_guard" { action: "submit_rca", solutionSummary: "...", chosenIndex: 1 } to unlock editing.`;

      return {
        strike: 2,
        isCodeLocked: true,
        triggerRollback: false,
        diagnosticMessage: `[STRIKE 2/3 RCA MANDATE]\n${rawError}`,
        directive: rcaDirective
      };
    }

    // Strike 3: Deadlock limit reached. Force emergency rollback!
    this.isLocked.set(sid, true);
    const rollbackDirective = `
🚨 STRIKE 3/3: CRITICAL LOOP DEADLOCK!
3 consecutive verification failures have occurred. Automatic emergency rollback triggered!
- The system will restore the repository to the last stable checkpoint tag.
- The failed attempt will be recorded in .dsh/memory/memory.md under "Failed Approaches".
- MANDATORY: Clear the polluted context window (/clear) and escalate to a reasoning model (GPT-5.1 High / Gemini 3.1 Pro High / Claude Opus).`;

    return {
      strike: 3,
      isCodeLocked: true,
      triggerRollback: true,
      diagnosticMessage: `[STRIKE 3/3 DEADLOCK]\n${rawError}`,
      directive: rollbackDirective
    };
  }

  /**
   * Unlocks code editing after an agent submits a valid Root Cause Analysis during Strike 2.
   * @param {string} sid
   * @param {string} solutionSummary
   * @returns {{ success: boolean, message: string }}
   */
  unlockAfterRca(sid = 'default', solutionSummary) {
    if (!solutionSummary || solutionSummary.trim().length < 20) {
      return {
        success: false,
        message: 'RCA submission rejected: Please provide a thorough explanation of the root cause and selected solution (minimum 20 characters).'
      };
    }

    this.isLocked.set(sid, false);
    this.rcaState.set(sid, {
      rcaText: solutionSummary.trim(),
      unlockedAt: Date.now()
    });

    return {
      success: true,
      message: `🔓 Root Cause Analysis accepted. Code editing permissions RESTORED for session "${sid}". Proceed with implementing the chosen approach.`
    };
  }

  /**
   * Returns current strike status summary.
   * @param {string} sid
   */
  getStatus(sid = 'default') {
    return {
      strikeCount: this.getStrike(sid),
      isCodeLocked: this.isCodeEditingLocked(sid),
      hasRca: this.rcaState.has(sid)
    };
  }
}

// Global default singleton instance
export const globalStrikeMachine = new StrikeMachine();
