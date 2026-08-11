const path = require('path');
const { spawn, execFile } = require('child_process');
const { promisify } = require('util');

// Electron patches `fs` so `.asar` archives look like directories. The installer
// must copy `app.asar` as an opaque file, so use the real filesystem APIs.
let fs;
try {
  fs = require('original-fs');
} catch {
  fs = require('fs');
}

const execFileAsync = promisify(execFile);

function defaultInstallDir() {
  return path.join(process.env.LOCALAPPDATA || '', 'Programs', 'CullSpace');
}

function payloadRoot(resourcesPath) {
  return path.join(resourcesPath, 'app-payload');
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function rmrf(target) {
  fs.rmSync(target, { recursive: true, force: true });
}

function isAsarArchive(filePath) {
  return filePath.toLowerCase().endsWith('.asar');
}

function copyRecursive(src, dest, onProgress) {
  const stats = fs.statSync(src);
  // Keep .asar opaque even if a patched fs claims it is a directory.
  if (stats.isDirectory() && !isAsarArchive(src)) {
    ensureDir(dest);
    const entries = fs.readdirSync(src);
    for (const entry of entries) {
      copyRecursive(path.join(src, entry), path.join(dest, entry), onProgress);
    }
    return;
  }
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
  if (onProgress) onProgress(src, stats.size);
}

function countFiles(dir) {
  let n = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && !isAsarArchive(full)) n += countFiles(full);
    else n += 1;
  }
  return n;
}

async function createShortcut({ target, args, workDir, icon, shortcutPath, description }) {
  const ps = `
$ErrorActionPreference = 'Stop'
$wsh = New-Object -ComObject WScript.Shell
$sc = $wsh.CreateShortcut('${shortcutPath.replace(/'/g, "''")}')
$sc.TargetPath = '${target.replace(/'/g, "''")}'
$sc.Arguments = '${(args || '').replace(/'/g, "''")}'
$sc.WorkingDirectory = '${workDir.replace(/'/g, "''")}'
$sc.IconLocation = '${icon.replace(/'/g, "''")},0'
$sc.Description = '${(description || 'CullSpace').replace(/'/g, "''")}'
$sc.Save()
`;
  const encoded = Buffer.from(ps, 'utf16le').toString('base64');
  await execFileAsync('powershell.exe', [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-EncodedCommand',
    encoded,
  ]);
}

function writeUninstaller(installDir, exeName) {
  const uninstallPs1 = path.join(installDir, 'Uninstall-CullSpace.ps1');
  const script = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms | Out-Null
$confirm = [System.Windows.Forms.MessageBox]::Show(
  'Uninstall CullSpace and remove its shortcuts from this PC?',
  'Uninstall CullSpace',
  [System.Windows.Forms.MessageBoxButtons]::YesNo,
  [System.Windows.Forms.MessageBoxIcon]::Warning
)
if ($confirm -ne [System.Windows.Forms.DialogResult]::Yes) {
  Write-Host 'Uninstall cancelled.'
  exit 0
}
$installDir = '${installDir.replace(/'/g, "''")}'
$desktop = [Environment]::GetFolderPath('Desktop')
$startMenu = Join-Path $env:APPDATA 'Microsoft\\Windows\\Start Menu\\Programs'
@(
  (Join-Path $desktop 'CullSpace.lnk'),
  (Join-Path $startMenu 'CullSpace.lnk'),
  (Join-Path $startMenu 'Uninstall CullSpace.lnk')
) | ForEach-Object { if (Test-Path $_) { Remove-Item $_ -Force } }
if (Test-Path $installDir) {
  Remove-Item -LiteralPath $installDir -Recurse -Force
}
Write-Host 'CullSpace has been uninstalled.'
`;
  fs.writeFileSync(uninstallPs1, script.trimStart(), 'utf8');

  const uninstallCmd = path.join(installDir, 'Uninstall CullSpace.cmd');
  fs.writeFileSync(
    uninstallCmd,
    `@echo off\r\npowershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Uninstall-CullSpace.ps1"\r\n`,
    'utf8'
  );

  return { uninstallPs1, uninstallCmd, exeName };
}

async function installApp({ resourcesPath, installDir, onProgress }) {
  const payload = payloadRoot(resourcesPath);
  if (!fs.existsSync(payload)) {
    throw new Error(`Install payload missing at ${payload}`);
  }
  if (!installDir || typeof installDir !== 'string') {
    throw new Error('Install directory is required');
  }

  const total = Math.max(1, countFiles(payload));
  let done = 0;

  if (fs.existsSync(installDir)) {
    // Keep a clean install folder
    rmrf(installDir);
  }
  ensureDir(installDir);

  copyRecursive(payload, installDir, () => {
    done += 1;
    onProgress?.({
      phase: 'copy',
      percent: Math.min(92, Math.round((done / total) * 92)),
      message: 'Copying application files…',
    });
  });

  const exeName = fs.existsSync(path.join(installDir, 'CullSpace.exe'))
    ? 'CullSpace.exe'
    : fs.readdirSync(installDir).find((f) => f.toLowerCase().endsWith('.exe'));
  if (!exeName) throw new Error('Installed payload has no CullSpace.exe');

  const exePath = path.join(installDir, exeName);
  const altIcons = [
    path.join(installDir, 'resources', 'cullspace.ico'),
    path.join(resourcesPath, 'app-payload', 'resources', 'cullspace.ico'),
    exePath,
  ];
  let icon = exePath;
  for (const candidate of altIcons) {
    if (fs.existsSync(candidate)) {
      icon = candidate;
      break;
    }
  }

  onProgress?.({ phase: 'shortcuts', percent: 94, message: 'Creating shortcuts…' });

  const desktop = path.join(
    process.env.USERPROFILE || '',
    'Desktop',
    'CullSpace.lnk'
  );
  const startMenuDir = path.join(
    process.env.APPDATA || '',
    'Microsoft',
    'Windows',
    'Start Menu',
    'Programs'
  );
  ensureDir(startMenuDir);
  const startMenu = path.join(startMenuDir, 'CullSpace.lnk');

  await createShortcut({
    target: exePath,
    args: '',
    workDir: installDir,
    icon,
    shortcutPath: desktop,
    description: 'CullSpace',
  });
  await createShortcut({
    target: exePath,
    args: '',
    workDir: installDir,
    icon,
    shortcutPath: startMenu,
    description: 'CullSpace',
  });

  const { uninstallCmd } = writeUninstaller(installDir, exeName);
  const uninstallShortcut = path.join(startMenuDir, 'Uninstall CullSpace.lnk');
  await createShortcut({
    target: uninstallCmd,
    args: '',
    workDir: installDir,
    icon,
    shortcutPath: uninstallShortcut,
    description: 'Uninstall CullSpace',
  });

  // Persist install marker
  fs.writeFileSync(
    path.join(installDir, 'install.json'),
    JSON.stringify(
      {
        installedAt: new Date().toISOString(),
        version: process.env.npm_package_version || '0.1.0',
        exe: exeName,
      },
      null,
      2
    ),
    'utf8'
  );

  onProgress?.({ phase: 'done', percent: 100, message: 'Installation complete' });
  return { installDir, exePath, desktop, startMenu };
}

function launchApp(exePath) {
  spawn(exePath, [], {
    detached: true,
    stdio: 'ignore',
    cwd: path.dirname(exePath),
  }).unref();
}

module.exports = {
  defaultInstallDir,
  payloadRoot,
  installApp,
  launchApp,
};
