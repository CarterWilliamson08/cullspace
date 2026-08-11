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
const installerDist = path.join(root, 'dist-release');

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

/** Mirror src → dest. Prefer robocopy so a locked payload root still updates. */
function mirrorDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  if (process.platform === 'win32') {
    // Do not use shell:true — paths with spaces (e.g. "Cursor Projects") break.
    const result = spawnSync(
      'robocopy',
      [src, dest, '/MIR', '/R:2', '/W:1', '/NFL', '/NDL', '/NJH', '/NJS', '/NC', '/NS', '/NP'],
      { cwd: root, stdio: 'inherit', windowsHide: true }
    );
    // robocopy: 0–7 = success with varying copy counts
    const code = result.status == null ? 1 : result.status;
    if (code >= 8) {
      console.error('robocopy failed with code', code);
      process.exit(1);
    }
    return;
  }
  try {
    rmrf(dest);
  } catch {
    // fall through to overlay copy
  }
  copyRecursive(src, dest);
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
mirrorDir(unpacked, payload);
fs.mkdirSync(path.join(payload, 'resources'), { recursive: true });
fs.copyFileSync(
  path.join(root, 'assets', 'cullspace.ico'),
  path.join(payload, 'resources', 'cullspace.ico')
);

console.log('Installing Setup build deps…');
const installerDir = path.join(root, 'installer');
const rootPkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const installerPkgPath = path.join(installerDir, 'package.json');
const installerPkg = JSON.parse(fs.readFileSync(installerPkgPath, 'utf8'));
if (installerPkg.version !== rootPkg.version) {
  installerPkg.version = rootPkg.version;
  fs.writeFileSync(installerPkgPath, `${JSON.stringify(installerPkg, null, 2)}\n`, 'utf8');
  console.log(`Synced installer version to ${rootPkg.version}`);
}
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
