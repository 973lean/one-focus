const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('oneFocus', {
  getState: () => ipcRenderer.invoke('state:get'),
  onState: (cb) => ipcRenderer.on('state', (_e, s) => cb(s)),
  getLog: () => ipcRenderer.invoke('log:get'),
  manualSet: (text) => ipcRenderer.invoke('manual:set', text),
  task: (action, id, value) => ipcRenderer.invoke('task:action', action, id, value),
  updateSettings: (patch) => ipcRenderer.invoke('settings:update', patch),
  connect: () => ipcRenderer.invoke('google:connect'),
  disconnect: () => ipcRenderer.invoke('google:disconnect'),
  setView: (name) => ipcRenderer.send('view:set', name),
  windowAction: (action) => ipcRenderer.send('window:action', action),
  onHover: (cb) => ipcRenderer.on('window:hover', (_e, inside) => cb(inside)),
});
