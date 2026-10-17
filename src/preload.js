const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('oneFocus', {
  current: () => ipcRenderer.invoke('tasks:current'),
  set: (text) => ipcRenderer.invoke('tasks:set', text),
});
