// lib/spec.js — Spec Gatekeeper & Brownfield Scope Enforcement
// Enforces Stage 0: Spec-Driven Development, 90% Certainty Rule, and Atomic Target File Whitelisting.

import { resolve, relative, normalize } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

/**
 * Parses scope.md and extracts active steps, checklist items, and target files.
 * @param {string} repoRoot
 * @returns {Promise<{
 *   exists: boolean,
 *   rawContent: string,
 *   taskName: string,
 *   totalSteps: number,
 *   completedSteps: number,
 *   activeStep: { index: number, title: string, targetFiles: string[] } | null,
 *   isComplete: boolean,
 *   steps: Array<{ index: number, title: string, completed: boolean, targetFiles: string[] }>
 * }>}
 */
export async function parseScope(repoRoot) {
  const scopePath = resolve(repoRoot, 'scope.md');
  if (!existsSync(scopePath)) {
    return {
      exists: false,
      rawContent: '',
      taskName: '',
      totalSteps: 0,
      completedSteps: 0,
      activeStep: null,
      isComplete: false,
      steps: []
    };
  }

  const rawContent = await readFile(scopePath, 'utf8');
  const lines = rawContent.split(/\r?\n/);

  let taskName = '';
  const titleMatch = rawContent.match(/^#\s+(?:SCOPE:\s*)?(.+)$/m);
  if (titleMatch) {
    taskName = titleMatch[1].trim();
  }

  const steps = [];
  const checklistRegex = /^(\s*)-\s*\[([ xX])\]\s*(.+)$/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(checklistRegex);
    if (match) {
      const isCompleted = match[2].toLowerCase() === 'x';
      const fullText = match[3].trim();

      // Extract target files if declared inline: e.g. [files: src/a.js, src/b.js] or (files: ...)
      let targetFiles = [];
      const inlineMatch = fullText.match(/[\[(](?:target\s*)?files?:\s*([^\])]+)[\])]/i);
      if (inlineMatch) {
        targetFiles = inlineMatch[1]
          .split(/[,;\s]+/)
          .map(f => f.trim().replace(/^['"]|['"]$/g, ''))
          .filter(Boolean);
      }

      // Check subsequent indented lines for "Target Files:" block
      let j = i + 1;
      while (j < lines.length && /^\s{2,}/.test(lines[j])) {
        const subLine = lines[j].trim();
        const subMatch = subLine.match(/^(?:target\s*files?|targets?):\s*(.+)$/i);
        if (subMatch) {
          const files = subMatch[1]
            .split(/[,;\s]+/)
            .map(f => f.trim().replace(/^['"\[\]]|['"\[\]]$/g, ''))
            .filter(Boolean);
          targetFiles.push(...files);
        }
        j++;
      }

      steps.push({
        index: steps.length + 1,
        title: fullText,
        completed: isCompleted,
        targetFiles: Array.from(new Set(targetFiles.map(f => normalize(f))))
      });
    }
  }

  const completedSteps = steps.filter(s => s.completed).length;
  const activeStep = steps.find(s => !s.completed) || null;
  const isComplete = steps.length > 0 && completedSteps === steps.length;

  return {
    exists: true,
    rawContent,
    taskName,
    totalSteps: steps.length,
    completedSteps,
    activeStep,
    isComplete,
    steps
  };
}

/**
 * Checks whether a requested file modification is allowed by the Spec Gate and Brownfield Whitelist.
 * Always allows editing documentation, specs, and config files.
 * @param {string} repoRoot
 * @param {string} targetFilePath
 * @param {'write' | 'edit' | 'delete'} [action='write']
 * @returns {Promise<{ allowed: boolean, reason?: string, activeStep?: object }>}
 */
export async function validateScopeGate(repoRoot, targetFilePath, action = 'write') {
  const normTarget = normalize(targetFilePath);
  const relPath = relative(repoRoot, resolve(repoRoot, normTarget)).replace(/\\/g, '/');

  // Whitelist: System & documentation files are ALWAYS allowed to be written
  const SYSTEM_EXEMPTIONS = [
    'scope.md',
    'memory.md',
    '.dsh/memory/memory.md',
    'rules.md',
    'claude.md',
    '.cursorrules',
    '.gitignore',
    'package.json',
    'package-lock.json',
    'cordis.patch.yml'
  ];

  if (SYSTEM_EXEMPTIONS.includes(relPath.toLowerCase()) || relPath.startsWith('.dsh/')) {
    return { allowed: true };
  }

  const scope = await parseScope(repoRoot);

  // Rule 1: Spec Gatekeeper — scope.md MUST exist before modifying project code
  if (!scope.exists) {
    return {
      allowed: false,
      reason: `🛑 SPEC GATE LOCK: Direct code modification for "${relPath}" is blocked.
In accordance with Stage 0 (Spec-Driven Dev & 90% Certainty Rule), you MUST first initialize and approve "scope.md".
Call "scope_manage" { action: "init", taskName: ... } to define atomic steps and target files.`
    };
  }

  // Rule 2: Active Step & Brownfield Target File Whitelist
  if (!scope.activeStep) {
    if (scope.isComplete) {
      return {
        allowed: false,
        reason: `🛑 SCOPE COMPLETED: All ${scope.totalSteps} steps in scope.md are marked completed.
To modify "${relPath}", add a new step to scope.md or start a new cycle.`
      };
    }
    return {
      allowed: false,
      reason: `🛑 NO ACTIVE STEP: scope.md contains no pending milestones (- [ ]). Add active steps before writing code.`
    };
  }

  // Rule 3: If active step specifies target files, enforce Brownfield Blast Radius isolation
  const activeTargets = scope.activeStep.targetFiles;
  if (activeTargets && activeTargets.length > 0) {
    const isTarget = activeTargets.some(target => {
      const normT = normalize(target).replace(/\\/g, '/');
      return relPath === normT || relPath.endsWith(normT) || normT.endsWith(relPath);
    });

    if (!isTarget) {
      return {
        allowed: false,
        activeStep: scope.activeStep,
        reason: `🛑 BROWNFIELD SCOPE LOCK: File "${relPath}" is outside the Target Files whitelist for active step #${scope.activeStep.index} ("${scope.activeStep.title}").
Allowed files: [${activeTargets.join(', ')}].
Brownfield Rule: You are forbidden from modifying adjacent modules. Complete the current step or update scope.md target files first.`
      };
    }
  }

  return { allowed: true, activeStep: scope.activeStep };
}

/**
 * Advances scope.md by marking the current active step as completed [x].
 * @param {string} repoRoot
 * @returns {Promise<{ success: boolean, completedStep?: object, nextStep?: object, isAllComplete: boolean }>}
 */
export async function advanceScopeStep(repoRoot) {
  const scopePath = resolve(repoRoot, 'scope.md');
  if (!existsSync(scopePath)) {
    return { success: false, isAllComplete: false };
  }

  const content = await readFile(scopePath, 'utf8');
  let marked = false;
  let completedStepTitle = '';

  const updated = content.replace(/^(\s*-\s*)\[ \](\s*.+)$/m, (_match, prefix, rest) => {
    marked = true;
    completedStepTitle = rest.trim();
    return `${prefix}[x]${rest}`;
  });

  if (marked) {
    await writeFile(scopePath, updated, 'utf8');
    const newScope = await parseScope(repoRoot);
    return {
      success: true,
      completedStep: { title: completedStepTitle },
      nextStep: newScope.activeStep,
      isAllComplete: newScope.isComplete
    };
  }

  return { success: false, isAllComplete: true };
}

/**
 * Initializes a new scope.md template with 90% certainty contract and milestone checklist.
 * @param {string} repoRoot
 * @param {string} taskName
 * @param {Array<{ title: string, targetFiles?: string[] }>} milestones
 * @returns {Promise<string>}
 */
export async function initScopeTemplate(repoRoot, taskName, milestones = []) {
  const scopePath = resolve(repoRoot, 'scope.md');

  const defaultSteps = milestones.length > 0 ? milestones : [
    { title: 'Project skeleton, contracts & environment setup', targetFiles: ['package.json'] },
    { title: 'Core business logic & domain model implementation', targetFiles: ['src/index.js'] },
    { title: 'Verification tests & deliverable smoke check', targetFiles: ['test/index.test.js'] }
  ];

  const stepsMarkdown = defaultSteps.map((m, idx) => {
    const filesStr = m.targetFiles?.length ? ` [files: ${m.targetFiles.join(', ')}]` : '';
    return `- [ ] Step ${idx + 1}: ${m.title}${filesStr}`;
  }).join('\n');

  const template = `# SCOPE: ${taskName}

## 1. Architectural Contract & 90% Certainty Rule
- **90% Rule Mandate:** If certainty on DB schemas, API contracts, or entity IDs is under 90%, coding is strictly forbidden until clarified with user.
- **Persistent Entity Invariant:** Payments and sessions MUST be indexed by persistent \`user_id\` (anti-MenuGen email mismatch protection).
- **KISS Directive:** Zero unnecessary abstractions or bloatware.

## 2. Milestone Execution Checklist
${stepsMarkdown}

## 3. Notes & Technical Debt
- Keep all modifications strictly scoped to active step target files.
`;

  await writeFile(scopePath, template, 'utf8');
  return scopePath;
}
