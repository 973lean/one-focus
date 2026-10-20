const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('oneFocus', {
  getState: () => ipcRenderer.invoke('state:get'),
  onState: (cb) => ipcRenderer.on('state', (_e, s) => cb(s)),
  getLog: () => ipcRenderer.invoke('log:get'),
  manualSet: (text) => ipcRenderer.invoke('manual:set', text),
  start: (id) => ipcRenderer.invoke('current:start', id),
  stop: () => ipcRenderer.invoke('current:stop'),
  setMeta: (key, patch) => ipcRenderer.invoke('task:meta', key, patch),
  task: (action, id, value) => ipcRenderer.invoke('task:action', action, id, value),
  updateSettings: (patch) => ipcRenderer.invoke('settings:update', patch),
  hold: (name) => ipcRenderer.invoke('hold:start', name),
  endHold: () => ipcRenderer.invoke('hold:end'),
  answerCheck: (answer) => ipcRenderer.invoke('check:answer', answer),
  editSession: (op, id, payload) => ipcRenderer.invoke('session:edit', op, id, payload),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  connect: () => ipcRenderer.invoke('google:connect'),
  disconnect: () => ipcRenderer.invoke('google:disconnect'),
  setView: (name) => ipcRenderer.send('view:set', name),
  windowAction: (action) => ipcRenderer.send('window:action', action),
  onHover: (cb) => ipcRenderer.on('window:hover', (_e, inside) => cb(inside)),
  onZone: (cb) => ipcRenderer.on('window:zone', (_e, zone) => cb(zone)),
});
