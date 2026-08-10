const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('setup', {
  defaults: () => ipcRenderer.invoke('installer:defaults'),
  browse: (current) => ipcRenderer.invoke('installer:browse', current),
  install: (opts) => ipcRenderer.invoke('installer:install', opts),
  launch: (exePath) => ipcRenderer.invoke('installer:launch', exePath),
  openFolder: (folder) => ipcRenderer.invoke('installer:open-folder', folder),
  quit: () => ipcRenderer.invoke('installer:quit'),
  onProgress: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on('installer:progress', handler);
    return () => ipcRenderer.removeListener('installer:progress', handler);
  },
});
