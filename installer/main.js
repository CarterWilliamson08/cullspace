const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const {
  defaultInstallDir,
  installApp,
  installAppDeferred,
  runDeferredApply,
  launchApp,
  waitForPid,
  isBusyError,
} = require('./install');

let mainWindow = null;

function parseSetupArgs(argv) {
  const args = {
    silent: false,
    launch: false,
    installDir: null,
    waitPid: null,
    applyUpdate: false,
    stagingDir: null,
  };
  for (const raw of argv.slice(1)) {
    if (raw === '--silent') args.silent = true;
    else if (raw === '--launch') args.launch = true;
    else if (raw === '--apply-update') args.applyUpdate = true;
    else if (raw.startsWith('--install-dir=')) {
      args.installDir = raw.slice('--install-dir='.length).trim() || null;
    } else if (raw.startsWith('--staging-dir=')) {
      args.stagingDir = raw.slice('--staging-dir='.length).trim() || null;
    } else if (raw.startsWith('--wait-pid=')) {
      const n = Number(raw.slice('--wait-pid='.length).trim());
      args.waitPid = Number.isFinite(n) && n > 0 ? n : null;
    }
  }
  return args;
}

function auditSilent(message) {
  try {
    const dir = path.join(process.env.LOCALAPPDATA || '', 'CullSpace', 'logs');
    fs.mkdirSync(dir, { recursive: true });
    const logPath = path.join(dir, `setup-${new Date().toISOString().slice(0, 10)}.log`);
    fs.appendFileSync(logPath, `${new Date().toISOString()} ${message}\n`, 'utf8');
  } catch {
    // best-effort
  }
}

async function runSilentInstall(opts) {
  const installDir = opts.installDir || defaultInstallDir();
  auditSilent(`silent install start → ${installDir}`);

  const onProgress = (progress) => {
    if (progress?.message) {
      process.stdout.write(`[setup] ${progress.percent || 0}% ${progress.message}\n`);
    }
  };

  // Updating an existing install cannot delete the live folder while CullSpace
  // (or an older updater waiting on Setup) still holds locks — stage + swap.
  // Do not wait for --wait-pid in-process here: the running app may be blocked
  // on Setup's exit code. The deferred apply script waits after we exit 0.
  if (fs.existsSync(installDir)) {
    const result = await installAppDeferred({
      resourcesPath: process.resourcesPath,
      installDir,
      onProgress,
      launch: opts.launch,
      waitPid: opts.waitPid,
    });
    auditSilent(`silent install deferred → ${result.stagingDir}`);
    return result;
  }

  if (opts.waitPid) {
    auditSilent(`waiting for pid ${opts.waitPid}`);
    await waitForPid(opts.waitPid);
  }

  try {
    const result = await installApp({
      resourcesPath: process.resourcesPath,
      installDir,
      onProgress,
    });
    auditSilent(`silent install ok → ${result.exePath}`);
    if (opts.launch) {
      launchApp(result.exePath);
      auditSilent(`silent launch → ${result.exePath}`);
    }
    return result;
  } catch (err) {
    if (!isBusyError(err)) throw err;
    auditSilent(`silent install busy → falling back to deferred (${err.message || err})`);
    return installAppDeferred({
      resourcesPath: process.resourcesPath,
      installDir,
      onProgress,
      launch: opts.launch,
      waitPid: opts.waitPid,
    });
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 540,
    height: 460,
    minWidth: 520,
    minHeight: 420,
    resizable: false,
    title: 'CullSpace Setup',
    backgroundColor: '#1c1f24',
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'assets', 'cullspace.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(async () => {
  const opts = parseSetupArgs(process.argv);

  if (opts.applyUpdate) {
    try {
      await runDeferredApply({
        stagingDir: opts.stagingDir,
        installDir: opts.installDir || defaultInstallDir(),
        launch: opts.launch,
        waitPid: opts.waitPid,
      });
      app.exit(0);
    } catch (err) {
      const msg = err?.message || String(err);
      console.error('Deferred apply failed:', msg);
      auditSilent(`deferred apply FAIL → ${msg}`);
      app.exit(1);
    }
    return;
  }

  if (opts.silent) {
    try {
      await runSilentInstall(opts);
      app.exit(0);
    } catch (err) {
      const msg = err?.message || String(err);
      console.error('Silent install failed:', msg);
      auditSilent(`silent install FAIL → ${msg}`);
      app.exit(1);
    }
    return;
  }

  createWindow();
});

app.on('window-all-closed', () => {
  app.quit();
});

ipcMain.handle('installer:defaults', async () => ({
  installDir: defaultInstallDir(),
  version: app.getVersion(),
  productName: 'CullSpace',
}));

ipcMain.handle('installer:browse', async (_evt, current) => {
  const { dialog } = require('electron');
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose install location',
    defaultPath: current || defaultInstallDir(),
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled || !result.filePaths[0]) return current || defaultInstallDir();
  return path.join(result.filePaths[0], 'CullSpace');
});

ipcMain.handle('installer:install', async (_evt, { installDir }) => {
  const target = installDir || defaultInstallDir();
  const result = await installApp({
    resourcesPath: process.resourcesPath,
    installDir: target,
    onProgress: (progress) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('installer:progress', progress);
      }
    },
  });
  return result;
});

ipcMain.handle('installer:launch', async (_evt, exePath) => {
  launchApp(exePath);
  return true;
});

ipcMain.handle('installer:open-folder', async (_evt, folder) => {
  await shell.openPath(folder);
  return true;
});

ipcMain.handle('installer:quit', async () => {
  app.quit();
});
