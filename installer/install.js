const path = require('path');
const os = require('os');
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

function isBusyError(err) {
  const code = err?.code || '';
  const msg = err?.message || String(err);
  return code === 'EBUSY' || code === 'EPERM' || /EBUSY|EPERM|resource busy|locked/i.test(msg);
}

function waitForPid(pid, timeoutMs = 5 * 60 * 1000) {
  const n = Number(pid);
  if (!Number.isFinite(n) || n <= 0) {
    return Promise.resolve({ exited: true, skipped: true });
  }
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      try {
        process.kill(n, 0);
      } catch {
        resolve({ exited: true });
        return;
      }
      if (Date.now() - started >= timeoutMs) {
        reject(new Error(`Timed out waiting for pid ${n} to exit`));
        return;
      }
      setTimeout(tick, 400);
    };
    tick();
  });
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

async function createAppShortcuts({ installDir, exePath, icon }) {
  const desktop = path.join(process.env.USERPROFILE || '', 'Desktop', 'CullSpace.lnk');
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

  const { uninstallCmd } = writeUninstaller(installDir, path.basename(exePath));
  const uninstallShortcut = path.join(startMenuDir, 'Uninstall CullSpace.lnk');
  await createShortcut({
    target: uninstallCmd,
    args: '',
    workDir: installDir,
    icon,
    shortcutPath: uninstallShortcut,
    description: 'Uninstall CullSpace',
  });

  return { desktop, startMenu, uninstallShortcut };
}

function resolveInstalledExe(installDir) {
  const exeName = fs.existsSync(path.join(installDir, 'CullSpace.exe'))
    ? 'CullSpace.exe'
    : fs.readdirSync(installDir).find((f) => f.toLowerCase().endsWith('.exe'));
  if (!exeName) throw new Error('Installed payload has no CullSpace.exe');
  return { exeName, exePath: path.join(installDir, exeName) };
}

function resolveIcon(installDir, resourcesPath, exePath) {
  const altIcons = [
    path.join(installDir, 'resources', 'cullspace.ico'),
    path.join(resourcesPath, 'app-payload', 'resources', 'cullspace.ico'),
    exePath,
  ];
  for (const candidate of altIcons) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return exePath;
}

function cleanupStaleUpdateDirs(installDir) {
  const parent = path.dirname(installDir);
  const prefix = `${path.basename(installDir)}.update-`;
  try {
    for (const entry of fs.readdirSync(parent)) {
      if (!entry.startsWith(prefix)) continue;
      try {
        rmrf(path.join(parent, entry));
      } catch {
        // ignore locked leftovers
      }
    }
  } catch {
    // ignore
  }
}

function auditDeferred(message) {
  try {
    const dir = path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'CullSpace', 'logs');
    fs.mkdirSync(dir, { recursive: true });
    const logPath = path.join(dir, `setup-${new Date().toISOString().slice(0, 10)}.log`);
    fs.appendFileSync(logPath, `${new Date().toISOString()} ${message}\n`, 'utf8');
  } catch {
    // best-effort
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function replaceInstallDir(stagingDir, installDir, attempts = 60) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      if (fs.existsSync(installDir)) rmrf(installDir);
      fs.renameSync(stagingDir, installDir);
      return;
    } catch (err) {
      if (i === attempts - 1) throw err;
      await sleep(500);
    }
  }
}

/**
 * Waits for the live app to exit, then swaps staging → installDir and finalizes.
 */
async function runDeferredApply({ stagingDir, installDir, launch, waitPid }) {
  auditDeferred(`deferred apply start → ${installDir}`);
  if (!stagingDir || !installDir) {
    throw new Error('Deferred apply requires stagingDir and installDir');
  }
  if (waitPid) {
    auditDeferred(`deferred waiting for pid ${waitPid}`);
    await waitForPid(waitPid);
  }
  // Brief grace so helper handles release after the UI process exits.
  await sleep(750);

  if (!fs.existsSync(stagingDir)) {
    throw new Error(`Deferred staging missing at ${stagingDir}`);
  }

  await replaceInstallDir(stagingDir, installDir);
  auditDeferred(`deferred apply swapped → ${installDir}`);

  const { exePath } = resolveInstalledExe(installDir);
  const icon = resolveIcon(installDir, '', exePath);
  await createAppShortcuts({ installDir, exePath, icon });

  if (launch) {
    launchApp(exePath);
    auditDeferred(`deferred launch → ${exePath}`);
  }
  auditDeferred('deferred apply ok');
  return { installDir, exePath };
}

/**
 * Stage a new install beside the live folder, then swap after CullSpace exits.
 * Required for silent updates: Setup cannot rmdir the running app's install dir.
 */
function scheduleDeferredReplace({ stagingDir, installDir, launch, waitPid }) {
  const args = [
    '--apply-update',
    `--staging-dir=${stagingDir}`,
    `--install-dir=${installDir}`,
  ];
  if (launch) args.push('--launch');
  if (waitPid) args.push(`--wait-pid=${waitPid}`);

  let command = process.execPath;
  let spawnArgs = args;

  // Under plain Node (smokes / direct require), relaunch apply-update.js.
  // Under Electron Setup, relaunch this same executable with --apply-update.
  if (!process.versions.electron) {
    spawnArgs = [path.join(__dirname, 'apply-update.js'), ...args];
  }

  const child = spawn(command, spawnArgs, {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env: process.env,
  });
  child.unref();
  return { deferred: true, applyPid: child.pid || null };
}

async function installApp({ resourcesPath, installDir, onProgress, skipShortcuts = false }) {
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

  const { exeName, exePath } = resolveInstalledExe(installDir);
  const icon = resolveIcon(installDir, resourcesPath, exePath);

  // Persist install marker before shortcuts so a deferred swap still has metadata.
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
  writeUninstaller(installDir, exeName);

  let desktop = null;
  let startMenu = null;
  if (!skipShortcuts) {
    onProgress?.({ phase: 'shortcuts', percent: 94, message: 'Creating shortcuts…' });
    ({ desktop, startMenu } = await createAppShortcuts({ installDir, exePath, icon }));
  }

  onProgress?.({ phase: 'done', percent: 100, message: 'Installation complete' });
  return { installDir, exePath, desktop, startMenu, icon };
}

async function installAppDeferred({ resourcesPath, installDir, onProgress, launch, waitPid }) {
  cleanupStaleUpdateDirs(installDir);
  const stagingDir = `${installDir}.update-${process.pid}`;
  if (fs.existsSync(stagingDir)) rmrf(stagingDir);

  const staged = await installApp({
    resourcesPath,
    installDir: stagingDir,
    onProgress,
    skipShortcuts: true,
  });

  const scheduled = scheduleDeferredReplace({
    stagingDir,
    installDir,
    launch: Boolean(launch),
    waitPid,
  });

  onProgress?.({
    phase: 'deferred',
    percent: 100,
    message: 'Update staged — applying after CullSpace exits…',
  });

  return {
    installDir,
    stagingDir,
    exePath: path.join(installDir, path.basename(staged.exePath)),
    deferred: true,
    ...scheduled,
  };
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
  installAppDeferred,
  runDeferredApply,
  launchApp,
  waitForPid,
  isBusyError,
};
