/**
 * 1) Publish helper + pack main CullSpace app (electron-builder --win dir)
 * 2) Copy unpacked app into installer/payload
 * 3) Build branded portable Setup exe
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const dist = path.join(root, 'dist');
const unpacked = path.join(dist, 'win-unpacked');
const payload = path.join(root, 'installer', 'payload');
const installerDist = path.join(root, 'dist-installer');

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

// Sync icons into installer assets
fs.mkdirSync(path.join(root, 'installer', 'assets'), { recursive: true });
fs.copyFileSync(path.join(root, 'assets', 'icon.png'), path.join(root, 'installer', 'assets', 'icon.png'));
fs.copyFileSync(
  path.join(root, 'assets', 'cullspace.ico'),
  path.join(root, 'installer', 'assets', 'cullspace.ico')
);

console.log('Preparing update-config.json…');
run('node', ['scripts/ensure-update-config.js']);

console.log('Publishing .NET helper…');
run('npm', ['run', 'helper:publish']);

console.log('Packing CullSpace app…');
rmrf(unpacked);
run('npx', ['electron-builder', '--win', 'dir']);

if (!fs.existsSync(unpacked)) {
  console.error('Expected unpacked app at', unpacked);
  process.exit(1);
}

console.log('Staging installer payload…');
rmrf(payload);
copyRecursive(unpacked, payload);
fs.copyFileSync(
  path.join(root, 'assets', 'cullspace.ico'),
  path.join(payload, 'resources', 'cullspace.ico')
);

console.log('Installing Setup build deps…');
const installerDir = path.join(root, 'installer');
run('npm', ['install', '--no-fund', '--no-audit'], installerDir);
// Ensure electron binary is present even if install scripts are gated.
const electronInstall = path.join(installerDir, 'node_modules', 'electron', 'install.js');
if (fs.existsSync(electronInstall)) {
  run('node', ['node_modules/electron/install.js'], installerDir);
}

console.log('Building branded Setup exe…');
rmrf(installerDist);
run('npx', ['electron-builder', '--config', 'electron-builder.yml'], installerDir);

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = pkg.version || '0.0.0';
const setupName = `CullSpace-Setup-${version}-x64.exe`;
const setupExe = path.join(installerDist, setupName);
fs.mkdirSync(dist, { recursive: true });
if (!fs.existsSync(setupExe)) {
  const found = fs
    .readdirSync(installerDist)
    .filter((f) => f.toLowerCase().endsWith('.exe'));
  console.log('Installer output dir:', installerDist, found);
  if (!found.length) process.exit(1);
  const src = path.join(installerDist, found[0]);
  const dest = path.join(dist, setupName);
  fs.copyFileSync(src, dest);
  console.log('Setup ready:', dest);
} else {
  const dest = path.join(dist, setupName);
  fs.copyFileSync(setupExe, dest);
  console.log('Setup ready:', dest);
}

console.log('\nDone.');
