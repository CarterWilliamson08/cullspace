const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cullspace', {
  call: (command, payload) => ipcRenderer.invoke('helper:call', command, payload),
  beginElevated: () => ipcRenderer.invoke('helper:begin-elevated'),
  endElevated: () => ipcRenderer.invoke('helper:end-elevated'),
  waitForPid: (pid, timeoutMs) => ipcRenderer.invoke('app:wait-for-pid', pid, timeoutMs),
  openLogs: () => ipcRenderer.invoke('app:open-logs'),
  getVersion: () => ipcRenderer.invoke('app:get-version'),
  pickFolder: () => ipcRenderer.invoke('app:pick-folder'),
  onScanProgress: (cb) => {
    const handler = (_e, payload) => cb(payload?.message || '');
    ipcRenderer.on('helper:progress', handler);
    return () => ipcRenderer.removeListener('helper:progress', handler);
  },
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
