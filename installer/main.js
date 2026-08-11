const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { defaultInstallDir, installApp, launchApp } = require('./install');

let mainWindow = null;

function parseSetupArgs(argv) {
  const args = {
    silent: false,
    launch: false,
    installDir: null,
  };
  for (const raw of argv.slice(1)) {
    if (raw === '--silent') args.silent = true;
    else if (raw === '--launch') args.launch = true;
    else if (raw.startsWith('--install-dir=')) {
      args.installDir = raw.slice('--install-dir='.length).trim() || null;
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
  const result = await installApp({
    resourcesPath: process.resourcesPath,
    installDir,
    onProgress: (progress) => {
      if (progress?.message) {
        process.stdout.write(`[setup] ${progress.percent || 0}% ${progress.message}\n`);
      }
    },
  });
  auditSilent(`silent install ok → ${result.exePath}`);
  if (opts.launch) {
    launchApp(result.exePath);
    auditSilent(`silent launch → ${result.exePath}`);
  }
  return result;
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
      sandbox: true,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(async () => {
  const opts = parseSetupArgs(process.argv);
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
