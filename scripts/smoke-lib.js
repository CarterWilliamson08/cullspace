/**
 * Shared helper client for smoke scripts (one persistent pipe connection).
 */
const { spawn } = require('child_process');
const path = require('path');
const crypto = require('crypto');
const net = require('net');
const fs = require('fs');

const root = path.join(__dirname, '..');

function createClient() {
  const pipeName = `cullspace-smoke-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  const token = crypto.randomBytes(16).toString('hex');
  const published = path.join(root, 'helper', 'publish', 'CullSpace.Helper.exe');
  const localDotnet = path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'dotnet', 'dotnet.exe');
  const dotnetRoot = path.dirname(localDotnet);

  if (!fs.existsSync(published)) {
    throw new Error('Missing helper/publish/CullSpace.Helper.exe');
  }

  const child = spawn(published, ['--pipe', pipeName, '--secret', token], {
    cwd: root,
    windowsHide: true,
    env: { ...process.env, DOTNET_ROOT: dotnetRoot, PATH: `${dotnetRoot};${process.env.PATH || ''}` },
  });

  let ready = false;
  let errLog = '';
  let socket = null;
  let buffer = '';
  const pending = new Map();
  let lastProgress = null;

  child.stderr.on('data', (b) => {
    const t = b.toString();
    errLog += t;
    if (t.includes('READY')) ready = true;
  });
  child.stdout.on('data', (b) => {
    const t = b.toString();
    errLog += t;
    if (t.includes('READY')) ready = true;
  });

  async function waitReady() {
    for (let i = 0; i < 80 && !ready; i += 1) await new Promise((r) => setTimeout(r, 250));
    if (!ready) throw new Error(`helper not READY\n${errLog}`);
  }

  async function connect() {
    await waitReady();
    if (socket) return;
    socket = await new Promise((resolve, reject) => {
      const s = net.createConnection(`\\\\.\\pipe\\${pipeName}`);
      s.setEncoding('utf8');
      s.once('connect', () => resolve(s));
      s.once('error', reject);
    });
    socket.on('data', (chunk) => {
      buffer += chunk;
      let idx;
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line) continue;
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        const waiter = pending.get(msg.id);
        if (!waiter) continue;
        if (msg.progress) {
          lastProgress = msg.progress;
          continue;
        }
        pending.delete(msg.id);
        if (msg.ok) waiter.resolve(msg.result);
        else waiter.reject(new Error(msg.error || 'fail'));
      }
    });
  }

  async function call(commandName, payload = {}) {
    await connect();
    return new Promise((resolve, reject) => {
      const id = crypto.randomBytes(4).toString('hex');
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error('timeout'));
      }, 180000);
      pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      socket.write(JSON.stringify({ id, secret: token, command: commandName, payload }) + '\n');
    });
  }

  function close() {
    try {
      if (socket) socket.end();
    } catch {
      // ignore
    }
    try {
      child.kill();
    } catch {
      // ignore
    }
  }

  return { call, close, pipeName, get lastProgress() { return lastProgress; } };
}

module.exports = { createClient, root };
