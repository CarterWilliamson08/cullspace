/**
 * Smoke: launch Electron briefly and ensure process stays up.
 */
const { spawn } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');
const electron = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');

const child = spawn(electron, ['.'], {
  cwd: root,
  windowsHide: false,
  env: {
    ...process.env,
    PATH: `${path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'dotnet')};${process.env.PATH || ''}`,
    DOTNET_ROOT: path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'dotnet'),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let booted = false;
const timer = setTimeout(() => {
  if (!booted) {
    console.error('SMOKE FAIL: electron exited early or did not stay up');
    try {
      child.kill();
    } catch {}
    process.exit(1);
  }
  console.log('SMOKE OK: electron window launched');
  try {
    child.kill();
  } catch {}
  process.exit(0);
}, 8000);

child.on('exit', (code) => {
  if (!booted) {
    clearTimeout(timer);
    console.error('SMOKE FAIL: electron exited with', code);
    process.exit(1);
  }
});

child.stderr.on('data', (b) => {
  const t = b.toString();
  if (t.toLowerCase().includes('error') && t.toLowerCase().includes('helper')) {
    console.error(t);
  }
});

setTimeout(() => {
  booted = true;
}, 3000);
