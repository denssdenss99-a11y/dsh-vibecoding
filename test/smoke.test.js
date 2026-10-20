import test from 'node:test';
import assert from 'node:assert/strict';
import { runBrowserSmoke, getAvailablePort, findBrowserBinary } from '../lib/smoke.js';

test('Smoke Verifier: finds browser binary and port', async () => {
  const port = await getAvailablePort();
  assert.ok(port > 1024, 'Port must be a valid non-privileged port');

  const bin = await findBrowserBinary();
  assert.ok(bin, 'Must detect a browser binary on macOS/Linux/Windows');
});

test('Smoke Verifier: detects zero errors on clean page and catches errors on broken page', async (t) => {
  // 1. Clean HTML page
  const cleanUrl = 'data:text/html,<!DOCTYPE html><html><head><title>Clean Page</title></head><body><h1>Hello</h1><script>console.log("running");</script></body></html>';
  const cleanRes = await runBrowserSmoke(cleanUrl, { timeoutMs: 1500 });
  assert.equal(cleanRes.ok, true, 'Clean page must pass smoke verification');
  assert.equal(cleanRes.errors.length, 0, 'Clean page must have zero errors');

  // 2. Broken HTML page with runtime TypeError
  const brokenUrl = 'data:text/html,<!DOCTYPE html><html><body><script>const obj = undefined; obj.doSomething();</script></body></html>';
  const brokenRes = await runBrowserSmoke(brokenUrl, { timeoutMs: 1500 });
  assert.equal(brokenRes.ok, false, 'Broken page must fail smoke verification');
  assert.ok(brokenRes.errors.length > 0, 'Must capture TypeError exception');
  assert.ok(brokenRes.errors[0].includes('TypeError') || brokenRes.errors[0].includes('Cannot read properties'), 'Error message must match TypeError');
});
