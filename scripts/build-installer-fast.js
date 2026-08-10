/**
 * Fast Setup rebuild for local iteration.
 * Reuses an existing app payload; skips helper publish, main app pack, and portable compression.
 *
 * Prerequisite: run `npm run installer` (or `npm run pack`) at least once so
 * installer/payload or dist/win-unpacked exists.
 *
 * Output: dist-installer/win-unpacked/CullSpaceSetup.exe (run this to test Setup)
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const unpacked = path.join(root, 'dist', 'win-unpacked');
const payload = path.join(root, 'installer', 'payload');
const installerDist = path.join(root, 'dist-installer');
const installerDir = path.join(root, 'installer');

function run(command, args, cwd = root) {
  console.log(`\n> ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: {
      ...process.env,
      CSC_IDENTITY_AUTO_DISCOVERY: 'false',
      PATH: `${path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'dotnet')};${process.env.PATH || ''}`,
      DOTNET_ROOT: path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'dotnet'),
    },
  });
  if (result.status !== 0) process.exit(result.status || 1);
}

function rmrf(target) {
  fs.rmSync(target, { recursive: true, force: true });
}

function copyRecursive(src, dest) {
  const stats = fs.statSync(src);
  if (stats.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src)) {
      copyRecursive(path.join(src, entry), path.join(dest, entry));
    }
    return;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function payloadLooksValid(dir) {
  return fs.existsSync(path.join(dir, 'CullSpace.exe'));
}

console.log('Fast installer build (reuses payload; no portable packaging)…');

fs.mkdirSync(path.join(root, 'installer', 'assets'), { recursive: true });
fs.copyFileSync(path.join(root, 'assets', 'icon.png'), path.join(root, 'installer', 'assets', 'icon.png'));
fs.copyFileSync(
  path.join(root, 'assets', 'cullspace.ico'),
  path.join(root, 'installer', 'assets', 'cullspace.ico')
);

if (!payloadLooksValid(payload)) {
  if (!payloadLooksValid(unpacked)) {
    console.error(`
No reusable app payload found.
Run a full build once first:

  npm run installer

Or pack the app, then retry:

  npm run pack
  npm run installer:fast
`);
    process.exit(1);
  }
  console.log('Staging installer payload from dist/win-unpacked…');
  rmrf(payload);
  copyRecursive(unpacked, payload);
  fs.copyFileSync(
    path.join(root, 'assets', 'cullspace.ico'),
    path.join(payload, 'resources', 'cullspace.ico')
  );
} else {
  console.log('Reusing existing installer/payload…');
}

const electronExe = path.join(installerDir, 'node_modules', 'electron', 'dist', 'electron.exe');
if (!fs.existsSync(electronExe)) {
  console.log('Installing Setup build deps (first fast-run only)…');
  run('npm', ['install', '--no-fund', '--no-audit'], installerDir);
  const electronInstall = path.join(installerDir, 'node_modules', 'electron', 'install.js');
  if (fs.existsSync(electronInstall)) {
    run('node', ['node_modules/electron/install.js'], installerDir);
  }
} else {
  console.log('Reusing installer/node_modules…');
}

console.log('Building Setup (dir target, signing off)…');
rmrf(installerDist);
run(
  'npx',
  [
    'electron-builder',
    '--config',
    'electron-builder.yml',
    '--win',
    'dir',
    '--config.win.signAndEditExecutable=false',
  ],
  installerDir
);

const setupExe = path.join(installerDist, 'win-unpacked', 'CullSpaceSetup.exe');
if (!fs.existsSync(setupExe)) {
  console.error('Expected Setup at', setupExe);
  process.exit(1);
}

console.log('\nFast Setup ready:', setupExe);
console.log('Run that exe to test the installer UI.');
console.log('For a shippable portable Setup.exe, use: npm run installer');
console.log('\nDone.');
