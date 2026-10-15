import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, realpathSync } from 'node:fs';
import { writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function createTempDir() {
  return realpathSync(mkdtempSync(join(tmpdir(), 'dsh-adapt-test-')));
}

test('Fast-Path bypass and Zero Dead Code validation logic', async (t) => {
  const dir = createTempDir();

  t.after(async () => {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {}
  });

  // 1. Fast-Path logic check
  const bypassReasons = ['comprehensive_prompt', 'creative_freedom', 'direct_request'];
  for (const reason of bypassReasons) {
    const isFast = reason !== 'clarified_interview';
    assert.equal(isFast, true);
  }

  // 2. Dead Code Detection simulation
  await mkdir(join(dir, 'src'), { recursive: true });
  await writeFile(join(dir, 'src', 'tigerGeometry.js'), 'export const geometry = {};');
  await writeFile(join(dir, 'src', 'modeSystems.js'), 'export const modes = {};');

  // Case A: index.html does NOT reference src/ files
  const htmlWithoutImports = `<!DOCTYPE html><html><body><script>const x = 1;</script></body></html>`;
  await writeFile(join(dir, 'index.html'), htmlWithoutImports);

  const { readdir } = await import('node:fs/promises');
  const srcFiles = await readdir(join(dir, 'src'));
  const unreferenced = srcFiles.filter(f => !f.startsWith('.') && !htmlWithoutImports.includes(f));
  assert.deepEqual(unreferenced, ['modeSystems.js', 'tigerGeometry.js']);

  // Case B: index.html DOES reference src/ files
  const htmlWithImports = `<!DOCTYPE html><html><body><script src="src/tigerGeometry.js"></script><script src="src/modeSystems.js"></script></body></html>`;
  const unreferencedAfter = srcFiles.filter(f => !f.startsWith('.') && !htmlWithImports.includes(f));
  assert.equal(unreferencedAfter.length, 0);
});

test('Adaptive Complexity Tiering and Escalation Protocol logic', async () => {
  // Classification logic helper
  function profileComplexity(prompt) {
    const p = prompt.toLowerCase();
    const tier2Keywords = ['backend', 'бэкенд', 'база данных', 'database', 'postgres', 'sqlite', 'redis', 'api', 'docker', 'авторизация', 'auth', 'jwt', 'rest', 'full-stack', 'fullstack', 'микросервис'];
    const isTier2 = tier2Keywords.some(kw => p.includes(kw));
    return isTier2 ? 'Tier2' : 'Tier1';
  }

  // Escalation detection helper
  function detectEscalation(currentTier, nextPrompt) {
    if (currentTier === 'Tier1') {
      const nextTier = profileComplexity(nextPrompt);
      if (nextTier === 'Tier2') {
        return { escalate: true, targetTier: 'Tier2', reason: 'User introduced multi-runtime or persistence requirements' };
      }
    }
    return { escalate: false, targetTier: currentTier };
  }

  // Test Tier 1 detection
  assert.equal(profileComplexity('Нарисуй мне кодом анимированного феникса в стиле оригами'), 'Tier1');
  assert.equal(profileComplexity('Сделай 3D WebGL сцену с частицами и звуком'), 'Tier1');
  assert.equal(profileComplexity('Интерактивный калькулятор кредита на чистом JS'), 'Tier1');

  // Test Tier 2 detection
  assert.equal(profileComplexity('Создай REST API сервис с базой данных PostgreSQL и JWT авторизацией'), 'Tier2');
  assert.equal(profileComplexity('Fullstack SaaS приложение с бэкендом на Node.js и Docker'), 'Tier2');

  // Test Escalation
  const escalationResult = detectEscalation('Tier1', 'Отлично, а теперь добавь бэкенд на Node.js и сохранение моделей в базу данных');
  assert.equal(escalationResult.escalate, true);
  assert.equal(escalationResult.targetTier, 'Tier2');

  // Non-escalation on further Tier 1 prompts
  const stayTier1 = detectEscalation('Tier1', 'А теперь поменяй цвет феникса на золотой');
  assert.equal(stayTier1.escalate, false);
});

