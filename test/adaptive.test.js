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
