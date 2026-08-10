const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const { defaultInstallDir, installApp, launchApp } = require('./install');

let mainWindow = null;

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

app.whenReady().then(() => {
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
