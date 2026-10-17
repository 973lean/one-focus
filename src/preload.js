const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('oneFocus', {
  current: () => ipcRenderer.invoke('tasks:current'),
  set: (text) => ipcRenderer.invoke('tasks:set', text),
  windowAction: (action) => ipcRenderer.send('window:action', action),
  onHover: (cb) => ipcRenderer.on('window:hover', (_e, inside) => cb(inside)),
});
