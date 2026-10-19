import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';

import {
  scanSecrets,
  scanAntiMenuGen,
  scanSqlInjection,
  auditGitignore,
  runSecurityAudit
} from '../lib/security.js';

function createTempDir() {
  return realpathSync(mkdtempSync(join(tmpdir(), 'dsh-sec-bugbot-')));
}

test('Pre-Commit Bugbot, Secret Scanner & Anti-MenuGen Checks', async (t) => {
  const dir = createTempDir();

  t.after(() => {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {}
  });

  // 1. Secret Leak Detection
  const stripePrefix = ['sk', 'live'].join('_');
  const googlePrefix = ['AIza', 'Sy'].join('');
  const codeWithSecret = `
const apiKey = "${stripePrefix}_1234567890abcdef1234567890abcdef";
const gKey = "${googlePrefix}D-1234567890abcdefghijklmnopqrstu";
`;
  const leaks = scanSecrets(codeWithSecret);
  assert.equal(leaks.length, 2);
  assert.equal(leaks[0].name, 'Stripe Secret Key');
  assert.equal(leaks[1].name, 'Google API Key');

  // 2. Anti-MenuGen Entity Amnesia Detection
  const badBillingCode = `
// Stripe Webhook handler
app.post('/webhook', (req, res) => {
  const payment = req.body;
  const user = findUserByEmail(payment.customer.email);
  if (customer.email === user.email) {
    grantSubscription(user);
  }
});
`;
  const menuGenWarnings = scanAntiMenuGen(badBillingCode);
  assert.equal(menuGenWarnings.length >= 1, true);
  assert.equal(menuGenWarnings[0].type.includes('Anti-MenuGen'), true);

  // 3. SQL Injection Detection
  const sqliCode = `
const query = "SELECT * FROM users WHERE username = '" + userName + "'";
`;
  const sqlIssues = scanSqlInjection(sqliCode);
  assert.equal(sqlIssues.length, 1);

  // Safe parameterized query should NOT trigger
  const safeSql = `const q = "SELECT * FROM users WHERE id = $1";`;
  const safeIssues = scanSqlInjection(safeSql);
  assert.equal(safeIssues.length, 0);

  // 4. Gitignore Audit
  await writeFile(join(dir, '.gitignore'), '# Incomplete gitignore\nnode_modules\n');
  const gitAudit = await auditGitignore(dir);
  assert.equal(gitAudit.ok, false);
  assert.equal(gitAudit.missing.includes('.env'), true);

  // 5. Full runSecurityAudit
  await writeFile(join(dir, 'test_file.js'), codeWithSecret);
  const fullAudit = await runSecurityAudit(dir, ['test_file.js']);
  assert.equal(fullAudit.clean, false);
  assert.equal(fullAudit.secretsFound.length >= 1, true);
});
