const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cullspace', {
  call: (command, payload) => ipcRenderer.invoke('helper:call', command, payload),
  openLogs: () => ipcRenderer.invoke('app:open-logs'),
  getVersion: () => ipcRenderer.invoke('app:get-version'),
  onOpenSettings: (cb) => {
    const handler = () => cb();
    ipcRenderer.on('menu:settings', handler);
    return () => ipcRenderer.removeListener('menu:settings', handler);
  },
  updates: {
    check: () => ipcRenderer.invoke('update:check'),
    install: (info) => ipcRenderer.invoke('update:download-and-install', info),
    onAvailable: (cb) => {
      const handler = (_e, info) => cb(info);
      ipcRenderer.on('update:available', handler);
      return () => ipcRenderer.removeListener('update:available', handler);
    },
    onProgress: (cb) => {
      const handler = (_e, progress) => cb(progress);
      ipcRenderer.on('update:progress', handler);
      return () => ipcRenderer.removeListener('update:progress', handler);
    },
    onStatus: (cb) => {
      const handler = (_e, payload) => cb(payload);
      ipcRenderer.on('update:status', handler);
      return () => ipcRenderer.removeListener('update:status', handler);
    },
  },
});
