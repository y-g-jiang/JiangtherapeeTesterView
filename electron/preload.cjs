const { contextBridge, ipcRenderer } = require('electron');

/**
 * The whole surface the window can reach. Everything that touches the disk or
 * the decoder stays in the main process.
 */
contextBridge.exposeInMainWorld('jptc', {
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
  scanFolder: (dir) => ipcRenderer.invoke('scan-folder', dir),
  runDark: (request) => ipcRenderer.invoke('run-dark', request),
  saveResults: (payload) => ipcRenderer.invoke('save-results', payload),
  reveal: (path) => ipcRenderer.invoke('reveal', path),
  systemInfo: () => ipcRenderer.invoke('system-info'),

  onScanProgress: (fn) => {
    const handler = (_e, payload) => fn(payload);
    ipcRenderer.on('scan-progress', handler);
    return () => ipcRenderer.removeListener('scan-progress', handler);
  },
  onRunProgress: (fn) => {
    const handler = (_e, payload) => fn(payload);
    ipcRenderer.on('run-progress', handler);
    return () => ipcRenderer.removeListener('run-progress', handler);
  },
});
