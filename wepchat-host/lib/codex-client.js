'use strict';

const { EventEmitter } = require('events');
const readline = require('readline');
const { spawn } = require('child_process');

class CodexClient extends EventEmitter {
  constructor(options) {
    super();
    this.command = options.command || 'codex';
    this.version = options.version || '0.1.0';
    this.proc = null;
    this.nextId = 1;
    this.pending = new Map();
    this.ready = false;
  }

  async start() {
    if (this.proc) return;
    this.proc = spawnCodexAppServer(this.command);

    this.proc.on('exit', (code, signal) => {
      this.ready = false;
      const err = new Error(`codex app-server exited (${signal || code})`);
      for (const item of this.pending.values()) item.reject(err);
      this.pending.clear();
      this.emit('exit', { code, signal });
    });
    this.proc.on('error', err => this.emit('error', err));

    const rl = readline.createInterface({ input: this.proc.stdout });
    rl.on('line', line => this._handleLine(line));

    const errRl = readline.createInterface({ input: this.proc.stderr });
    errRl.on('line', line => this.emit('stderr', line));

    await this.request('initialize', {
      clientInfo: {
        name: 'wepchat_host',
        title: 'WepChat Host',
        version: this.version
      },
      capabilities: {
        experimentalApi: true,
        requestAttestation: false
      }
    });
    this.notify('initialized');
    this.ready = true;
  }

  stop() {
    if (!this.proc) return;
    try { this.proc.kill(); } catch (err) {}
    this.proc = null;
    this.ready = false;
  }

  request(method, params) {
    if (!this.proc || !this.proc.stdin.writable) {
      return Promise.reject(new Error('Codex app-server is not running'));
    }
    const id = this.nextId++;
    const msg = { method, id, params };
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      this.proc.stdin.write(JSON.stringify(msg) + '\n');
    });
  }

  notify(method, params) {
    if (!this.proc || !this.proc.stdin.writable) return;
    const msg = params === undefined ? { method } : { method, params };
    this.proc.stdin.write(JSON.stringify(msg) + '\n');
  }

  respond(id, result) {
    if (!this.proc || !this.proc.stdin.writable) return;
    this.proc.stdin.write(JSON.stringify({ id, result }) + '\n');
  }

  respondError(id, code, message) {
    if (!this.proc || !this.proc.stdin.writable) return;
    this.proc.stdin.write(JSON.stringify({ id, error: { code, message } }) + '\n');
  }

  _handleLine(line) {
    let msg;
    try {
      msg = JSON.parse(line);
    } catch (err) {
      this.emit('stderr', `Non-JSON app-server output: ${line}`);
      return;
    }

    if (msg.id != null && (Object.prototype.hasOwnProperty.call(msg, 'result') || msg.error)) {
      const pending = this.pending.get(msg.id);
      if (!pending) return;
      this.pending.delete(msg.id);
      if (msg.error) pending.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
      else pending.resolve(msg.result);
      return;
    }

    if (msg.method && msg.id != null) {
      this.emit('serverRequest', msg);
      return;
    }

    if (msg.method) {
      this.emit('notification', msg);
    }
  }
}

function spawnCodexAppServer(command) {
  const args = ['app-server', '--stdio'];
  if (process.platform !== 'win32') {
    return spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
  }
  const commandLine = [command].concat(args).map(quoteWindowsShellArg).join(' ');
  return spawn(commandLine, {
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: true,
    windowsHide: true
  });
}

function quoteWindowsShellArg(value) {
  const s = String(value);
  if (!/[ \t"&|<>^]/.test(s)) return s;
  return '"' + s.replace(/"/g, '\\"') + '"';
}

module.exports = { CodexClient };
