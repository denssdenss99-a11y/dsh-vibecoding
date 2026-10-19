// lib/server.js — Live Background Server Daemon ("Listen to the Server")
// Manages long-running development servers (Next.js, FastAPI, Vite, Express), captures real-time logs in a ring buffer,
// and catches crashes before the agent declares victory to the user.

import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { createConnection } from 'node:net';

class CircularLogBuffer {
  constructor(maxLines = 250) {
    this.maxLines = maxLines;
    this.buffer = [];
  }

  push(line) {
    if (!line) return;
    const clean = line.replace(/[\r\n]+$/, '');
    if (!clean) return;
    this.buffer.push({
      time: new Date().toISOString().slice(11, 19),
      text: clean
    });
    if (this.buffer.length > this.maxLines) {
      this.buffer.shift();
    }
  }

  getRecent(count = 50) {
    const slice = this.buffer.slice(-count);
    return slice.map(item => `[${item.time}] ${item.text}`).join('\n');
  }

  clear() {
    this.buffer = [];
  }
}

/**
 * Checks if a TCP port is currently open and accepting connections on localhost.
 * @param {number} port
 * @param {number} timeoutMs
 * @returns {Promise<boolean>}
 */
export function probePort(port, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host: '127.0.0.1' });
    let resolved = false;

    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        socket.destroy();
        resolve(false);
      }
    }, timeoutMs);

    socket.on('connect', () => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        socket.destroy();
        resolve(true);
      }
    });

    socket.on('error', () => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        resolve(false);
      }
    });
  });
}

export class ServerDaemon {
  constructor() {
    this.servers = new Map(); // Map<repoRoot, { child, pid, port, command, logBuffer, startTime, exitCode }>
  }

  /**
   * Starts a background development server.
   * @param {string} repoRoot
   * @param {{ command: string, port?: number, cwd?: string, env?: object }} options
   * @returns {Promise<{ success: boolean, pid?: number, port?: number, message: string, initialLogs?: string }>}
   */
  async startServer(repoRoot, options) {
    const root = resolve(repoRoot);
    const existing = this.servers.get(root);

    // Stop existing instance if already running in this repo
    if (existing && !existing.child.killed && existing.exitCode === null) {
      await this.stopServer(root);
    }

    const runDir = options.cwd ? resolve(root, options.cwd) : root;
    const rawCmd = options.command.trim();

    // Parse command safely
    const parts = rawCmd.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
    if (parts.length === 0) {
      return { success: false, message: 'Empty server command provided.' };
    }

    const bin = parts[0];
    const args = parts.slice(1).map(arg => {
      if ((arg.startsWith('"') && arg.endsWith('"')) || (arg.startsWith("'") && arg.endsWith("'"))) {
        return arg.slice(1, -1);
      }
      return arg;
    });

    const logBuffer = new CircularLogBuffer(300);
    logBuffer.push(`=== Starting server: ${rawCmd} (cwd: ${runDir}) ===`);

    try {
      const child = spawn(bin, args, {
        cwd: runDir,
        env: { ...process.env, ...options.env, FORCE_COLOR: '0', CI: 'true' },
        detached: false,
        shell: process.platform === 'win32'
      });

      const serverInfo = {
        child,
        pid: child.pid,
        port: options.port || null,
        command: rawCmd,
        logBuffer,
        startTime: Date.now(),
        exitCode: null,
        lastError: null
      };

      this.servers.set(root, serverInfo);

      child.stdout?.on('data', (data) => {
        const text = data.toString('utf8');
        for (const line of text.split(/\r?\n/)) {
          logBuffer.push(line);
        }
      });

      child.stderr?.on('data', (data) => {
        const text = data.toString('utf8');
        for (const line of text.split(/\r?\n/)) {
          logBuffer.push(`[STDERR] ${line}`);
        }
        if (/EADDRINUSE|Uncaught|Error:|Traceback/i.test(text)) {
          serverInfo.lastError = text.slice(0, 500);
        }
      });

      child.on('exit', (code, signal) => {
        serverInfo.exitCode = code;
        logBuffer.push(`=== Server process exited with code ${code} (${signal || 'clean'}) ===`);
      });

      child.on('error', (err) => {
        serverInfo.exitCode = 1;
        serverInfo.lastError = err.message;
        logBuffer.push(`[CRASH] Failed to spawn server process: ${err.message}`);
      });

      // Wait 1.2s to verify server did not immediately crash on startup
      await new Promise(r => setTimeout(r, 1200));

      if (serverInfo.exitCode !== null) {
        return {
          success: false,
          message: `🔴 Server failed to start (exited with code ${serverInfo.exitCode}).\nRecent logs:\n${logBuffer.getRecent(15)}`,
          initialLogs: logBuffer.getRecent(20)
        };
      }

      // If port was specified, probe its availability
      let portListening = false;
      if (options.port) {
        portListening = await probePort(options.port, 1500);
      }

      return {
        success: true,
        pid: child.pid,
        port: options.port,
        portListening,
        message: `✅ Background server running [PID: ${child.pid}]` +
          (options.port ? ` on port ${options.port} (${portListening ? 'LISTENING' : 'WARMING UP'})` : ''),
        initialLogs: logBuffer.getRecent(10)
      };
    } catch (err) {
      return {
        success: false,
        message: `Failed to spawn background server: ${err.message}`
      };
    }
  }

  /**
   * Retrieves recent server logs from the circular buffer.
   * @param {string} repoRoot
   * @param {number} [lines=50]
   * @returns {{ running: boolean, pid?: number, port?: number, logs: string, lastError?: string }}
   */
  getLogs(repoRoot, lines = 50) {
    const root = resolve(repoRoot);
    const server = this.servers.get(root);
    if (!server) {
      return { running: false, logs: '(No server running for this repository)' };
    }

    const isRunning = server.exitCode === null && !server.child.killed;
    return {
      running: isRunning,
      pid: server.pid,
      port: server.port,
      exitCode: server.exitCode,
      lastError: server.lastError,
      logs: server.logBuffer.getRecent(lines)
    };
  }

  /**
   * Stops a running background server for this repo.
   * @param {string} repoRoot
   * @returns {Promise<{ stopped: boolean, pid?: number, message: string }>}
   */
  async stopServer(repoRoot) {
    const root = resolve(repoRoot);
    const server = this.servers.get(root);
    if (!server || server.exitCode !== null || server.child.killed) {
      return { stopped: false, message: 'No active server process found.' };
    }

    const pid = server.pid;
    try {
      server.child.kill('SIGTERM');

      // Wait up to 1.5s for graceful shutdown
      await new Promise(r => setTimeout(r, 800));

      if (server.exitCode === null && !server.child.killed) {
        server.child.kill('SIGKILL');
      }

      this.servers.delete(root);
      return { stopped: true, pid, message: `Server [PID: ${pid}] stopped successfully.` };
    } catch (err) {
      return { stopped: false, pid, message: `Error stopping server: ${err.message}` };
    }
  }

  /**
   * Returns current server status.
   * @param {string} repoRoot
   */
  getStatus(repoRoot) {
    const root = resolve(repoRoot);
    const server = this.servers.get(root);
    if (!server) return { running: false };

    return {
      running: server.exitCode === null && !server.child.killed,
      pid: server.pid,
      port: server.port,
      command: server.command,
      uptimeSeconds: Math.floor((Date.now() - server.startTime) / 1000)
    };
  }
}

export const globalServerDaemon = new ServerDaemon();
