const { app, BrowserWindow, ipcMain, screen } = require('electron');
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
    frame: false, // no OS title bar; controls are drawn in the page and appear on hover
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, 'index.html'));

  // Tell the page when the pointer is over the window. Polling the cursor
  // is more reliable than CSS :hover, which drag regions can swallow.
  let inside = false;
  const hoverTimer = setInterval(() => {
    if (win.isDestroyed()) return clearInterval(hoverTimer);
    const p = screen.getCursorScreenPoint();
    const b = win.getBounds();
    const now = p.x >= b.x && p.x < b.x + b.width && p.y >= b.y && p.y < b.y + b.height;
    if (now !== inside) {
      inside = now;
      win.webContents.send('window:hover', inside);
    }
  }, 100);

  // Dev mode: reload the window whenever a renderer file changes.
  if (process.argv.includes('--dev')) {
    let timer;
    fs.watch(__dirname, (_event, file) => {
      if (!file || file === 'main.js' || file === 'preload.js') return;
      clearTimeout(timer);
      timer = setTimeout(() => win.webContents.reloadIgnoringCache(), 80);
    });
  }
}

ipcMain.on('window:action', (e, action) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (!win) return;
  if (action === 'minimize') win.minimize();
  else if (action === 'maximize') win.isMaximized() ? win.unmaximize() : win.maximize();
  else if (action === 'close') win.close();
});

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
