const { app, BrowserWindow, ipcMain, shell, Menu } = require('electron');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const net = require('net');
const fs = require('fs');
const { checkForUpdates, downloadAndPrepareInstall } = require('./updater');

let mainWindow = null;
let helperProcess = null;
let pipeName = null;
let sessionSecret = null;
let helperReady = null;
let helperSocket = null;
let pending = new Map();
let receiveBuffer = '';

function packagedHelperPath() {
  return path.join(process.resourcesPath || '', 'helper', 'CullSpace.Helper.exe');
}

function helperLaunch() {
  if (app.isPackaged) {
    const resource = packagedHelperPath();
    if (!fs.existsSync(resource)) {
      throw new Error(`Packaged helper missing: ${resource}`);
    }
    return { command: resource, args: ['--pipe', pipeName, '--secret', sessionSecret] };
  }

  const published = path.join(__dirname, '..', 'helper', 'publish', 'CullSpace.Helper.exe');
  if (fs.existsSync(published)) {
    return { command: published, args: ['--pipe', pipeName, '--secret', sessionSecret] };
  }

  const resource = packagedHelperPath();
  if (fs.existsSync(resource)) {
    return { command: resource, args: ['--pipe', pipeName, '--secret', sessionSecret] };
  }

  const dll = path.join(
    __dirname,
    '..',
    'helper',
    'CullSpace.Helper',
    'bin',
    'Release',
    'net8.0-windows',
    'CullSpace.Helper.dll'
  );
  const localDotnet = path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'dotnet', 'dotnet.exe');
  const dotnet = fs.existsSync(localDotnet) ? localDotnet : 'dotnet';
  if (fs.existsSync(dll)) {
    return { command: dotnet, args: [dll, '--pipe', pipeName, '--secret', sessionSecret] };
  }

  return {
    command: dotnet,
    args: [
      'run',
      '--project',
      path.join(__dirname, '..', 'helper', 'CullSpace.Helper', 'CullSpace.Helper.csproj'),
      '-c',
      'Release',
      '--',
      '--pipe',
      pipeName,
      '--secret',
      sessionSecret,
    ],
  };
}

function helperCwd() {
  if (app.isPackaged) return process.resourcesPath || app.getPath('userData');
  return path.join(__dirname, '..');
}

function startHelper() {
  pipeName = `cullspace-${process.pid}-${crypto.randomBytes(8).toString('hex')}`;
  sessionSecret = crypto.randomBytes(32).toString('hex');
  pending = new Map();
  receiveBuffer = '';

  const { command, args } = helperLaunch();
  const dotnetRoot = path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'dotnet');

  helperReady = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Helper startup timed out')), 30000);

    helperProcess = spawn(command, args, {
      cwd: helperCwd(),
      windowsHide: true,
      env: {
        ...process.env,
        DOTNET_ROOT: dotnetRoot,
        PATH: `${dotnetRoot};${process.env.PATH || ''}`,
      },
    });

    const onChunk = (buf) => {
      const text = buf.toString();
      if (text.includes('READY')) {
        connectPipe()
          .then(() => {
            clearTimeout(timeout);
            resolve(true);
          })
          .catch((err) => {
            clearTimeout(timeout);
            reject(err);
          });
      }
    };

    helperProcess.stderr.on('data', onChunk);
    helperProcess.stdout.on('data', onChunk);

    helperProcess.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    helperProcess.on('exit', (code) => {
      helperSocket = null;
      for (const [, p] of pending) p.reject(new Error(`Helper exited (${code})`));
      pending.clear();
    });
  });

  return helperReady;
}

function connectPipe() {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(`\\\\.\\pipe\\${pipeName}`);
    socket.setEncoding('utf8');
    socket.on('connect', () => {
      helperSocket = socket;
      resolve();
    });
    socket.on('data', onSocketData);
    socket.on('error', reject);
    socket.on('close', () => {
      helperSocket = null;
    });
  });
}

function onSocketData(chunk) {
  receiveBuffer += chunk;
  let idx;
  while ((idx = receiveBuffer.indexOf('\n')) >= 0) {
    const line = receiveBuffer.slice(0, idx).trim();
    receiveBuffer = receiveBuffer.slice(idx + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    const waiter = pending.get(msg.id);
    if (!waiter) continue;
    pending.delete(msg.id);
    if (msg.ok) waiter.resolve(msg.result);
    else waiter.reject(new Error(msg.error || 'Helper error'));
  }
}

function callHelper(command, payload = {}) {
  return helperReady.then(
    () =>
      new Promise((resolve, reject) => {
        if (!helperSocket) {
          reject(new Error('Helper not connected'));
          return;
        }
        const id = crypto.randomBytes(8).toString('hex');
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`Timeout: ${command}`));
        }, 120000);
        pending.set(id, {
          resolve: (v) => {
            clearTimeout(timer);
            resolve(v);
          },
          reject: (e) => {
            clearTimeout(timer);
            reject(e);
          },
        });
        const req = JSON.stringify({ id, secret: sessionSecret, command, payload }) + '\n';
        helperSocket.write(req);
      })
  );
}

function callOnSocket(socket, secret, command, payload = {}, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const id = crypto.randomBytes(8).toString('hex');
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timeout: ${command}`));
    }, timeoutMs);

    const onData = (chunk) => {
      buffer += chunk;
      let idx;
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line) continue;
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        if (msg.id !== id) continue;
        cleanup();
        if (msg.ok) resolve(msg.result);
        else reject(new Error(msg.error || 'Helper error'));
        return;
      }
    };

    const onErr = (err) => {
      cleanup();
      reject(err);
    };

    function cleanup() {
      clearTimeout(timer);
      socket.off('data', onData);
      socket.off('error', onErr);
    }

    socket.on('data', onData);
    socket.on('error', onErr);
    socket.write(JSON.stringify({ id, secret, command, payload }) + '\n');
  });
}

function helperExeForElevation() {
  if (app.isPackaged) {
    const resource = packagedHelperPath();
    if (fs.existsSync(resource)) return resource;
    throw new Error(`Packaged helper missing for elevation: ${resource}`);
  }
  const published = path.join(__dirname, '..', 'helper', 'publish', 'CullSpace.Helper.exe');
  if (fs.existsSync(published)) return published;
  const resource = packagedHelperPath();
  if (fs.existsSync(resource)) return resource;
  throw new Error('Self-contained helper not found for elevation. Run: npm run helper:publish');
}

async function callElevatedHelper(command, payload = {}) {
  const elevPipe = `cullspace-elev-${process.pid}-${crypto.randomBytes(6).toString('hex')}`;
  const elevSecret = crypto.randomBytes(32).toString('hex');
  const exe = helperExeForElevation();

  // Triggers Windows UAC. User must approve.
  const ps = spawn(
    'powershell.exe',
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      `Start-Process -FilePath '${exe.replace(/'/g, "''")}' -ArgumentList @('--pipe','${elevPipe}','--secret','${elevSecret}','--elevated') -Verb RunAs`,
    ],
    { windowsHide: true }
  );

  await new Promise((resolve, reject) => {
    ps.on('error', reject);
    ps.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error('UAC elevation was cancelled or failed to start.'));
    });
  });

  // Poll named pipe until elevated helper is listening.
  let socket = null;
  const started = Date.now();
  while (!socket && Date.now() - started < 60000) {
    try {
      socket = await new Promise((resolve, reject) => {
        const s = net.createConnection(`\\\\.\\pipe\\${elevPipe}`);
        s.setEncoding('utf8');
        s.once('connect', () => resolve(s));
        s.once('error', reject);
      });
    } catch {
      await new Promise((r) => setTimeout(r, 400));
    }
  }

  if (!socket) throw new Error('Timed out waiting for elevated helper (UAC may have been denied).');

  try {
    const result = await callOnSocket(socket, elevSecret, command, payload, 180000);
    // Ask helper to exit cleanly if connected for one shot.
    try {
      socket.end();
    } catch {
      // ignore
    }
    return result;
  } finally {
    socket.destroy();
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 860,
    minHeight: 560,
    title: 'CullSpace',
    backgroundColor: '#202020',
    autoHideMenuBar: true,
    icon: path.join(__dirname, '..', 'assets', 'cullspace.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Force Windows to pick up the latest icon even if Explorer cached an older one.
  try {
    mainWindow.setIcon(path.join(__dirname, '..', 'assets', 'cullspace.ico'));
  } catch {
    // ignore
  }

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

function installAppMenu() {
  // In-app toolbar owns Settings / Help; hide the native menu bar.
  Menu.setApplicationMenu(null);
}

async function runAutoUpdateCheck() {
  try {
    const info = await checkForUpdates();
    if (!info.updateAvailable || !mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send('update:available', info);
  } catch (err) {
    console.error('Update check failed', err);
  }
}

app.whenReady().then(async () => {
  installAppMenu();
  createWindow();
  try {
    await startHelper();
  } catch (err) {
    console.error('Helper failed to start', err);
  }

  // Non-blocking update check after startup settles.
  setTimeout(() => {
    runAutoUpdateCheck();
  }, 2500);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (helperProcess && !helperProcess.killed) helperProcess.kill();
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('helper:call', async (_evt, command, payload) => {
  const allowed = new Set([
    'ping',
    'list_drives',
    'scan_files',
    'scan_folder_files',
    'scan_largest_folders',
    'list_apps',
    'related_files',
    'related_app',
    'delete_paths',
    'uninstall_app',
    'is_admin',
  ]);
  if (!allowed.has(command)) throw new Error('Command not allowed');

  const privileged = command === 'delete_paths' || command === 'uninstall_app';
  if (privileged) {
    return callElevatedHelper(command, payload || {});
  }
  return callHelper(command, payload || {});
});

ipcMain.handle('app:open-logs', async () => {
  const logs = path.join(app.getPath('userData'), '..', 'CullSpace', 'logs');
  const local = path.join(process.env.LOCALAPPDATA || '', 'CullSpace', 'logs');
  const target = fs.existsSync(local) ? local : logs;
  await shell.openPath(target);
  return target;
});

ipcMain.handle('app:get-version', async () => app.getVersion());

ipcMain.handle('app:pick-folder', async () => {
  const { dialog } = require('electron');
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose a folder to scan',
    properties: ['openDirectory'],
  });
  if (result.canceled || !result.filePaths[0]) return null;
  return result.filePaths[0];
});

ipcMain.handle('update:check', async () => checkForUpdates());

ipcMain.handle('update:download-and-install', async (_evt, updateInfo) => {
  const setupPath = await downloadAndPrepareInstall(updateInfo, (progress) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update:progress', progress);
    }
  });

  spawn(setupPath, [], {
    detached: true,
    stdio: 'ignore',
    cwd: path.dirname(setupPath),
  }).unref();

  setTimeout(() => {
    app.quit();
  }, 400);

  return { setupPath };
});
