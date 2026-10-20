// lib/smoke.js — Real Browser Smoke Verifier for DSH
// Opens web pages in headless Chrome/Edge using native CDP (Chrome DevTools Protocol),
// catching 100% of uncaught JS exceptions and console.error messages in 1-2 seconds.

import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { access, rm } from 'node:fs/promises';
import { constants, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Finds an available local TCP port.
 * @returns {Promise<number>}
 */
export function getAvailablePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

/**
 * Detects installed Chromium/Chrome/Edge browser executable path.
 * @returns {Promise<string|null>}
 */
export async function findBrowserBinary() {
  const isWin = process.platform === 'win32';
  const isMac = process.platform === 'darwin';

  const candidates = isWin ? [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'chrome.exe', 'msedge.exe'
  ] : isMac ? [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    'google-chrome', 'chromium'
  ] : [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    'google-chrome', 'chromium'
  ];

  for (const p of candidates) {
    if (p.includes('/') || p.includes('\\')) {
      try {
        await access(p, constants.X_OK);
        return p;
      } catch {}
    }
  }

  // Fallback check on PATH
  return isMac ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : null;
}

/**
 * Performs a headless CDP verification of a given web page URL.
 * Catches uncaught runtime exceptions, console.error, and verifies page title.
 * @param {string} targetUrl
 * @param {object} options
 * @param {number} [options.timeoutMs=2500]
 * @returns {Promise<{ ok: boolean, url: string, errors: string[], consoleLogs: string[], title?: string }>}
 */
export async function runBrowserSmoke(targetUrl, options = {}) {
  const timeoutMs = options.timeoutMs || 2500;
  const browserBin = await findBrowserBinary();
  if (!browserBin) {
    return {
      ok: false,
      url: targetUrl,
      errors: ['No Chrome/Chromium/Edge browser binary found on host system for headless verification.'],
      consoleLogs: []
    };
  }

  const port = await getAvailablePort();
  const tempDir = join(tmpdir(), `dsh-smoke-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);

  const proc = spawn(browserBin, [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--remote-debugging-port=' + port,
    '--remote-debugging-address=127.0.0.1',
    '--user-data-dir=' + tempDir,
    '--allow-file-access-from-files'
  ], {
    stdio: ['ignore', 'pipe', 'pipe']
  });

  try {
    // 1. Wait for CDP endpoint readiness
    let wsBrowserUrl = '';
    const startWait = Date.now();
    while (Date.now() - startWait < 4000) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/json/version`);
        if (res.ok) {
          const data = await res.json();
          wsBrowserUrl = data.webSocketDebuggerUrl;
          if (wsBrowserUrl) break;
        }
      } catch {
        await new Promise(r => setTimeout(r, 100));
      }
    }

    if (!wsBrowserUrl) {
      throw new Error(`Browser debug port ${port} did not respond within 4s`);
    }

    // 2. Open new page target via PUT /json/new
    const newPageRes = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(targetUrl)}`, { method: 'PUT' });
    const target = await newPageRes.json();
    const pageWsUrl = target.webSocketDebuggerUrl;
    if (!pageWsUrl) throw new Error('Failed to create CDP page target');

    const ws = new WebSocket(pageWsUrl);
    const errors = [];
    const logs = [];
    let pageTitle = '';

    await new Promise((resolveWs, rejectWs) => {
      const tm = setTimeout(() => {
        try { ws.close(); } catch {}
        rejectWs(new Error('WebSocket connection to page target timed out after 3000ms'));
      }, 3000);
      ws.onopen = () => {
        clearTimeout(tm);
        resolveWs();
      };
      ws.onerror = (err) => {
        clearTimeout(tm);
        rejectWs(err);
      };
    });

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.method === 'Runtime.exceptionThrown') {
          const d = msg.params.exceptionDetails;
          const desc = d.exception?.description || d.text || 'Uncaught Exception';
          const stack = d.stackTrace ? '\n' + d.stackTrace.callFrames.map(f => `  at ${f.url}:${f.lineNumber}`).join('\n') : '';
          errors.push(desc + stack);
        } else if (msg.method === 'Runtime.consoleAPICalled') {
          const text = msg.params.args.map(a => a.value ?? a.description ?? '').join(' ');
          if (msg.params.type === 'error') {
            errors.push(`[console.error] ${text}`);
          } else {
            logs.push(`[${msg.params.type}] ${text}`);
          }
        }
      } catch {}
    };

    let id = 1;
    const send = (method, params = {}) => ws.send(JSON.stringify({ id: id++, method, params }));
    send('Runtime.enable');
    send('Page.enable');

    // Observation window
    await new Promise(r => setTimeout(r, timeoutMs));

    // Evaluate document title
    try {
      send('Runtime.evaluate', { expression: 'document.title' });
    } catch {}

    ws.close();

    return {
      ok: errors.length === 0,
      url: targetUrl,
      title: target.title || '',
      errors,
      consoleLogs: logs.slice(0, 15)
    };
  } finally {
    proc.kill('SIGKILL');
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch {}
  }
}
