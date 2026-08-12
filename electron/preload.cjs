const { contextBridge, ipcRenderer } = require('electron');

/**
 * The whole surface the window can reach. Everything that touches the disk or
 * the decoder stays in the main process.
 */
contextBridge.exposeInMainWorld('jptc', {
  pickFiles: () => ipcRenderer.invoke('pick-files'),
  scanFiles: (paths, entry) => ipcRenderer.invoke('scan-files', paths, entry),
  runEntry: (request) => ipcRenderer.invoke('run-entry', request),
  saveResults: (payload) => ipcRenderer.invoke('save-results', payload),
  blackLevels: (camera) => ipcRenderer.invoke('black-levels', camera),
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
