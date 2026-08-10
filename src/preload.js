const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cullspace', {
  call: (command, payload) => ipcRenderer.invoke('helper:call', command, payload),
  openLogs: () => ipcRenderer.invoke('app:open-logs'),
  onOpenSettings: (cb) => {
    const handler = () => cb();
    ipcRenderer.on('menu:settings', handler);
    return () => ipcRenderer.removeListener('menu:settings', handler);
  },
});
