import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, realpathSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';

import { generateDevOpsBundle } from '../lib/devops.js';

function createTempDir() {
  return realpathSync(mkdtempSync(join(tmpdir(), 'dsh-devops-test-')));
}

test('Automated DevOps & Remote Deployment Generator', async (t) => {
  const dir = createTempDir();

  t.after(() => {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {}
  });

  const res = await generateDevOpsBundle(dir, {
    appName: 'vibe-saas',
    port: 8080,
    domain: 'saas.vibe.io',
    framework: 'node',
    entryPoint: 'src/server.js'
  });

  assert.equal(res.generatedFiles.length >= 5, true);

  // Check Nginx Conf
  const nginxPath = join(dir, 'deploy', 'nginx.conf');
  assert.equal(existsSync(nginxPath), true);
  const nginxContent = await readFile(nginxPath, 'utf8');
  assert.equal(nginxContent.includes('proxy_pass http://127.0.0.1:8080;'), true);
  assert.equal(nginxContent.includes('server_name saas.vibe.io'), true);

  // Check Systemd Unit
  const systemdPath = join(dir, 'deploy', 'vibe-saas.service');
  assert.equal(existsSync(systemdPath), true);
  const systemdContent = await readFile(systemdPath, 'utf8');
  assert.equal(systemdContent.includes('ExecStart=/usr/bin/node src/server.js'), true);
  assert.equal(systemdContent.includes('Restart=always'), true);

  // Check Setup.sh
  const setupPath = join(dir, 'deploy', 'setup.sh');
  assert.equal(existsSync(setupPath), true);
  const setupContent = await readFile(setupPath, 'utf8');
  assert.equal(setupContent.includes('apt-get install -y curl ufw git nginx certbot'), true);

  // Check Dockerfile
  const dockerPath = join(dir, 'deploy', 'Dockerfile');
  assert.equal(existsSync(dockerPath), true);
});
