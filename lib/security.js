// lib/security.js — Pre-Commit Bugbot, Secret Leak Scanner & Anti-MenuGen Invariant Checker
// Audits code before commits to prevent security leaks, SQL injections, and billing entity amnesia.

import { resolve, relative, basename } from 'node:path';
import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const SECRET_PATTERNS = [
  { name: 'Stripe Secret Key', regex: /sk_live_[0-9a-zA-Z]{24,}/ },
  { name: 'OpenAI API Key', regex: /sk-[a-zA-Z0-9]{32,}/ },
  { name: 'Google API Key', regex: /AIzaSy[0-9a-zA-Z_-]{33}/ },
  { name: 'GitHub Personal Access Token', regex: /gh[pousr]_[0-9a-zA-Z]{36,}/ },
  { name: 'Private Cryptographic Key', regex: /-----BEGIN\s+[A-Z\s]+PRIVATE\s+KEY-----/ },
  { name: 'Hardcoded Bearer JWT', regex: /Bearer\s+eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}/ }
];

/**
 * Scans code content for hardcoded API keys and secrets.
 * @param {string} content
 * @param {string} filename
 * @returns {Array<{ name: string, line: number, snippet: string }>}
 */
export function scanSecrets(content, filename = '') {
  const leaks = [];
  const lines = content.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Skip comments that describe keys
    if (/^\s*(?:\/\/|#|\*|\/\*)\s*(?:e\.g\.|example|sample|regex)/i.test(line)) continue;

    for (const pat of SECRET_PATTERNS) {
      if (pat.regex.test(line)) {
        leaks.push({
          name: pat.name,
          line: i + 1,
          snippet: line.trim().slice(0, 80)
        });
      }
    }
  }

  return leaks;
}

/**
 * Checks for Anti-MenuGen entity amnesia:
 * Detects Stripe / billing webhook logic that queries or links users strictly by transient email string
 * without verifying persistent user_id or customer_id.
 * @param {string} content
 * @returns {Array<{ type: string, line: number, detail: string }>}
 */
export function scanAntiMenuGen(content) {
  const warnings = [];
  const lines = content.split(/\r?\n/);

  const isBillingFile = /stripe|payment|checkout|webhook|subscription|bill/i.test(content);
  if (!isBillingFile) return warnings;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Anti-pattern 1: Finding user by email in payment callback instead of user_id
    if (/(?:findUserByEmail|where:\s*\{\s*email|User\.findOne\(\{\s*email)/i.test(line) &&
        /(?:session|webhook|customer|payment|stripe)/i.test(line)) {
      warnings.push({
        type: 'Anti-MenuGen Amnesia',
        line: i + 1,
        detail: 'Payment handler binds user by transient "email" string instead of persistent "user_id". If user changes email or uses a different email in Stripe, payment will be lost.'
      });
    }

    // Anti-pattern 2: Direct string email equality match on payment webhook
    if (/(?:session\.customer_details\.email|customer\.email)\s*===\s*(?:user\.email|account\.email)/i.test(line)) {
      warnings.push({
        type: 'Anti-MenuGen String Match',
        line: i + 1,
        detail: 'Direct string equality check on billing email detected. Always bind through persistent metadata.user_id or stripe_customer_id.'
      });
    }
  }

  return warnings;
}

/**
 * Verifies .gitignore contains all critical database, environment, and dependency paths.
 * @param {string} repoRoot
 * @returns {Promise<{ ok: boolean, missing: string[] }>}
 */
export async function auditGitignore(repoRoot) {
  const gitignorePath = resolve(repoRoot, '.gitignore');
  if (!existsSync(gitignorePath)) {
    return { ok: false, missing: ['.gitignore is missing entirely'] };
  }

  const content = await readFile(gitignorePath, 'utf8');
  const requiredPatterns = ['.env', 'node_modules', '*.sqlite', '*.db'];
  const missing = [];

  for (const pat of requiredPatterns) {
    if (!content.includes(pat)) {
      missing.push(pat);
    }
  }

  return { ok: missing.length === 0, missing };
}

/**
 * Scans a file or project files for raw unparameterized SQL injections.
 * @param {string} content
 * @returns {Array<{ line: number, snippet: string }>}
 */
export function scanSqlInjection(content) {
  const issues = [];
  const lines = content.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Detects string concatenations inside SQL queries: SELECT ... + var or `SELECT ... ${var}`
    if (/(?:SELECT|INSERT|UPDATE|DELETE)\s+[^;]+(?:\+\s*[a-zA-Z0-9_]+|\$\{[a-zA-Z0-9_]+\})/i.test(line)) {
      // Ignore parameterized query placeholders like $1, ?, :id
      if (!/(\$\d+|\?|:[a-zA-Z0-9_]+)/.test(line)) {
        issues.push({
          line: i + 1,
          snippet: line.trim().slice(0, 80)
        });
      }
    }
  }

  return issues;
}

/**
 * Performs a comprehensive pre-commit security & code health audit across target files.
 * @param {string} repoRoot
 * @param {string[]} filePaths
 * @returns {Promise<{
 *   clean: boolean,
 *   secretsFound: Array<{ file: string, leak: object }>,
 *   antiMenuGenWarnings: Array<{ file: string, warning: object }>,
 *   sqlInjections: Array<{ file: string, issue: object }>,
 *   gitignoreIssues: string[]
 * }>}
 */
export async function runSecurityAudit(repoRoot, filePaths = []) {
  const secretsFound = [];
  const antiMenuGenWarnings = [];
  const sqlInjections = [];

  for (const fp of filePaths) {
    const absPath = resolve(repoRoot, fp);
    if (!existsSync(absPath)) continue;

    try {
      const content = await readFile(absPath, 'utf8');
      const rel = relative(repoRoot, absPath);

      const leaks = scanSecrets(content, rel);
      for (const l of leaks) secretsFound.push({ file: rel, leak: l });

      const menuGen = scanAntiMenuGen(content);
      for (const m of menuGen) antiMenuGenWarnings.push({ file: rel, warning: m });

      const sqli = scanSqlInjection(content);
      for (const s of sqli) sqlInjections.push({ file: rel, issue: s });
    } catch {}
  }

  const gitignoreRes = await auditGitignore(repoRoot);

  const clean = secretsFound.length === 0 &&
                antiMenuGenWarnings.length === 0 &&
                sqlInjections.length === 0 &&
                gitignoreRes.ok;

  return {
    clean,
    secretsFound,
    antiMenuGenWarnings,
    sqlInjections,
    gitignoreIssues: gitignoreRes.missing
  };
}
