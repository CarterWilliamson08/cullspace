const { spawn } = require('child_process');
const path = require('path');
const crypto = require('crypto');
const net = require('net');
const fs = require('fs');

const root = path.join(__dirname, '..');
const pipeName = `cullspace-smoke-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
const token = crypto.randomBytes(16).toString('hex');
const published = path.join(root, 'helper', 'publish', 'CullSpace.Helper.exe');
const dll = path.join(
  root,
  'helper',
  'CullSpace.Helper',
  'bin',
  'Release',
  'net8.0-windows',
  'CullSpace.Helper.dll'
);
const localDotnet = path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'dotnet', 'dotnet.exe');
const dotnetRoot = path.dirname(localDotnet);
const dotnet = fs.existsSync(localDotnet) ? localDotnet : 'dotnet';

let command;
let args;
if (fs.existsSync(published)) {
  command = published;
  args = ['--pipe', pipeName, '--secret', token];
} else {
  command = dotnet;
  args = [dll, '--pipe', pipeName, '--secret', token];
}

const child = spawn(command, args, {
  cwd: root,
  windowsHide: true,
  env: {
    ...process.env,
    DOTNET_ROOT: dotnetRoot,
    PATH: `${dotnetRoot};${process.env.PATH || ''}`,
  },
});

let ready = false;
let errLog = '';

child.stderr.on('data', (buf) => {
  const t = buf.toString();
  errLog += t;
  if (t.includes('READY')) ready = true;
});
child.stdout.on('data', (buf) => {
  const t = buf.toString();
  errLog += t;
  if (t.includes('READY')) ready = true;
});

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

(async () => {
  for (let i = 0; i < 80 && !ready; i += 1) await sleep(250);
  if (!ready) {
    console.error('SMOKE FAIL: helper never became READY');
    console.error(errLog);
    child.kill();
    process.exit(1);
  }

  await new Promise((resolve, reject) => {
    const socket = net.createConnection(`\\\\.\\pipe\\${pipeName}`);
    let buffer = '';
    socket.setEncoding('utf8');
    socket.on('connect', () => {
      socket.write(JSON.stringify({ id: '1', secret: token, command: 'ping', payload: {} }) + '\n');
    });
    socket.on('data', (chunk) => {
      buffer += chunk;
      if (!buffer.includes('\n')) return;
      const line = buffer.split('\n')[0];
      const msg = JSON.parse(line);
      if (msg.ok && msg.result && msg.result.pong) {
        console.log('SMOKE OK: ping', msg.result);
        socket.end();
        child.kill();
        resolve();
      } else {
        reject(new Error(JSON.stringify(msg)));
      }
    });
    socket.on('error', reject);
    setTimeout(() => reject(new Error('ping timeout')), 15000);
  });
})().catch((err) => {
  console.error('SMOKE FAIL:', err.message || err);
  child.kill();
  process.exit(1);
});
