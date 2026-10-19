import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ServerDaemon, probePort } from '../lib/server.js';

function createTempDir() {
  return realpathSync(mkdtempSync(join(tmpdir(), 'dsh-srv-test-')));
}

test('Live Server Daemon & Log Ring Buffer', async (t) => {
  const dir = createTempDir();
  const daemon = new ServerDaemon();

  t.after(async () => {
    try {
      await daemon.stopServer(dir);
      rmSync(dir, { recursive: true, force: true });
    } catch {}
  });

  // 1. Start a simple node HTTP echo server in background
  const srvCmd = `node -e "const http = require('http'); const s = http.createServer((q, r) => r.end('OK')); s.listen(34981, () => console.log('SERVER_READY'));"`;

  const startRes = await daemon.startServer(dir, {
    command: srvCmd,
    port: 34981
  });

  assert.equal(startRes.success, true);
  assert.equal(typeof startRes.pid, 'number');

  // Check logs
  const logsRes = daemon.getLogs(dir, 10);
  assert.equal(logsRes.running, true);
  assert.equal(logsRes.logs.includes('SERVER_READY'), true);

  // Check port probe
  const isListening = await probePort(34981, 1000);
  assert.equal(isListening, true);

  // Check status
  const status = daemon.getStatus(dir);
  assert.equal(status.running, true);
  assert.equal(status.port, 34981);

  // Stop server
  const stopRes = await daemon.stopServer(dir);
  assert.equal(stopRes.stopped, true);

  // Ensure port freed
  const isClosed = await probePort(34981, 500);
  assert.equal(isClosed, false);
});
