const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

// Task history lives in the OS user-data folder as plain JSON.
const dataFile = () => path.join(app.getPath('userData'), 'tasks.json');

function readTasks() {
  try {
    return JSON.parse(fs.readFileSync(dataFile(), 'utf8'));
  } catch {
    return [];
  }
}

function writeTasks(tasks) {
  fs.mkdirSync(path.dirname(dataFile()), { recursive: true });
  fs.writeFileSync(dataFile(), JSON.stringify(tasks, null, 2));
}

function createWindow() {
  const win = new BrowserWindow({
    width: 420,
    height: 260,
    minWidth: 280,
    minHeight: 180,
    backgroundColor: '#0B0B0C',
    title: 'One Focus',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, 'index.html'));
}

ipcMain.handle('tasks:current', () => {
  const tasks = readTasks();
  return tasks[tasks.length - 1] || null;
});

ipcMain.handle('tasks:set', (_e, text) => {
  const tasks = readTasks();
  const now = new Date().toISOString();
  const last = tasks[tasks.length - 1];
  if (last && !last.endedAt) last.endedAt = now;
  const task = { text, startedAt: now, endedAt: null };
  tasks.push(task);
  writeTasks(tasks);
  return task;
});

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
