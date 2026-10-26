const { app, BrowserWindow, ipcMain, screen, powerMonitor, shell, desktopCapturer } = require('electron');
const path = require('path');
const fs = require('fs');
const store = require('./store');
const Tracker = require('./tracker');
const google = require('./google');

const SYNC_MS = 60e3;
const HEARTBEAT_MS = 30e3;
const PANEL_MIN = { width: 440, height: 480 };

let win = null;
let state;
let tracker;
let client = null;
let today = { open: [], done: [], syncedAt: null, error: null };
let restoreBounds = null;
let updater = null;
let update = { status: 'idle', version: null }; // idle | checking | current | downloading | ready | error | dev
let check = null; // null | 'still' | 'eod': the blur is up and waiting for you
let overlays = [];

const isHold = (t) => !!(t && t.key.startsWith('hold:'));
const localDate = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const isScheduled = (t) => !!(t.due && t.due <= localDate()); // today or overdue
const todayDue = () => localDate() + 'T00:00:00.000Z';
const nowIso = () => new Date().toISOString();
const DEFAULT_HOLDS = ['Meeting', 'Call', 'Break'];

// ---------- state shared with the page ----------

function makeClient() {
  const refreshToken = store.getRefreshToken(state);
  const { clientId, clientSecret } = state.settings;
  client = refreshToken && clientId ? new google.Client({ clientId, clientSecret, refreshToken }) : null;
}

function snapshot() {
  const cur = state.current;
  const held = state.held;
  // Only tasks scheduled for today (or overdue) queue up on Now.
  const next = today.open.find((t) => isScheduled(t) && (!cur || t.id !== cur.googleId) && (!held || t.id !== held.googleId)) || null;
  return {
    settings: state.settings,
    connected: !!client,
    current: cur, // the started task, or null when idle
    next, // first unfinished task that isn't running: waits for Start
    open: state.open,
    tracked: cur ? tracker.trackedSince(cur) : 0,
    today,
    todayDate: localDate(),
    goals: goalsFor([cur, held, next && { key: 'g:' + next.id }]),
    categories: recentCategories(),
    holdNames: recentHolds(),
    held,
    check,
    app: { version: app.getVersion(), update },
  };
}

function goalsFor(tasks) {
  const out = {};
  for (const t of tasks) if (t && state.taskMeta[t.key] && state.taskMeta[t.key].goal) out[t.key] = state.taskMeta[t.key].goal;
  return out;
}

function recentHolds() {
  const used = [...state.holdNames].sort((a, b) => b.lastUsed.localeCompare(a.lastUsed)).map((h) => h.name);
  return [...used, ...DEFAULT_HOLDS.filter((d) => !used.some((u) => u.toLowerCase() === d.toLowerCase()))];
}

function recentCategories() {
  return [...state.categories].sort((a, b) => b.lastUsed.localeCompare(a.lastUsed)).map((c) => c.name);
}

// Usable saved bounds: still on a connected screen.
function savedBounds() {
  const w = state.window;
  if (!w) return null;
  const visible = screen.getAllDisplays().some(({ workArea: a }) =>
    w.x < a.x + a.width && w.x + w.width > a.x && w.y < a.y + a.height && w.y + w.height > a.y
  );
  return visible ? w : null;
}

function push() {
  // The blur only makes sense while a real task runs.
  if (check && (!state.current || isHold(state.current))) closeCheck();
  if (win && !win.isDestroyed()) win.webContents.send('state', snapshot());
}

// ---------- "Still on this?" and end of day: blur every screen ----------
// Each monitor gets a window that blurs (Windows 11 acrylic) or dims what's
// behind it. One Focus sits above them, sharp, until you answer.

// Works on any Windows version: snapshot each monitor, show the snapshot
// blurred in a borderless window that exactly covers that monitor (whatever
// its size, position or orientation), then raise One Focus above them all.
async function openCheck(kind) {
  if (check) return;
  check = kind;
  const displays = screen.getAllDisplays();
  let shots = [];
  try {
    const maxW = Math.max(...displays.map((d) => d.size.width));
    const maxH = Math.max(...displays.map((d) => d.size.height));
    shots = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: maxW, height: maxH } });
  } catch {
    shots = []; // no snapshot: falls back to a dark tint
  }
  if (check !== kind) return; // answered while we were capturing
  const shown = displays.map((d, i) => {
    const shot = shots.find((x) => x.display_id === String(d.id)) || (shots.length === displays.length ? shots[i] : null);
    const o = new BrowserWindow({
      x: d.bounds.x,
      y: d.bounds.y,
      width: d.bounds.width,
      height: d.bounds.height,
      frame: false,
      show: false,
      backgroundColor: '#0B0B0C',
      skipTaskbar: true,
      focusable: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      hasShadow: false,
      thickFrame: false,
      roundedCorners: false,
      enableLargerThanScreen: true,
      webPreferences: { contextIsolation: true, nodeIntegration: false },
    });
    // Set bounds again after creation: Windows can shrink a new window to the
    // work area or rescale it on mixed-DPI setups.
    o.setBounds(d.bounds);
    o.setAlwaysOnTop(true, 'screen-saver');
    overlays.push(o);
    return new Promise((resolve) => {
      o.webContents.once('did-finish-load', async () => {
        if (shot && !shot.thumbnail.isEmpty()) {
          const url = 'data:image/jpeg;base64,' + shot.thumbnail.toJPEG(75).toString('base64');
          await o.webContents.executeJavaScript(`window.setShot(${JSON.stringify(url)})`).catch(() => {});
        }
        if (!o.isDestroyed()) {
          o.setBounds(d.bounds);
          o.showInactive();
        }
        resolve();
      });
      o.loadFile(path.join(__dirname, 'overlay.html'));
    });
  });
  await Promise.all(shown);
  if (check !== kind) return;
  win.setAlwaysOnTop(true, 'screen-saver', 1);
  win.show();
  win.moveTop();
  win.focus();
  push();
}

function closeCheck() {
  if (!check) return;
  check = null;
  for (const o of overlays) if (!o.isDestroyed()) o.destroy();
  overlays = [];
  win.setAlwaysOnTop(!!state.settings.alwaysOnTop);
}

function checkDue() {
  const cur = state.current;
  if (check || !cur || isHold(cur) || tracker.away || tracker.pauses.size) return;
  const eod = state.settings.endOfDay;
  if (eod) {
    const [h, m] = eod.split(':').map(Number);
    const at = new Date();
    at.setHours(h, m, 0, 0);
    const day = new Date().toDateString();
    if (Date.now() >= at.getTime() && state.eodDate !== day) {
      state.eodDate = day;
      store.save(state);
      return openCheck('eod');
    }
  }
  const n = state.settings.checkMinutes;
  const from = Math.max(Date.parse(cur.since), Date.parse(state.checkFrom || 0) || 0);
  if (n && Date.now() - from >= n * 60e3) openCheck('still');
}

// ---------- Google sync ----------

const startOfDay = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};
// Google stores a task's date as midnight UTC of that day: keep "YYYY-MM-DD".
const pick = (t) => ({ id: t.id, title: t.title.trim(), completed: t.completed || null, due: t.due ? t.due.slice(0, 10) : null });
const byPosition = (a, b) => (a.position < b.position ? -1 : a.position > b.position ? 1 : 0);

let syncing = null;
function sync() {
  if (!syncing) syncing = doSync().finally(() => (syncing = null));
  return syncing;
}
// Wait for any sync in flight, then run a fresh one (used after edits).
async function resync() {
  if (syncing) await syncing;
  return sync();
}

async function doSync() {
  if (!client) return push();
  try {
    const listId = await client.ensureList(state.settings.listName, state.google.listId);
    if (listId !== state.google.listId) {
      state.google.listId = listId;
      store.save(state);
    }
    const all = (await client.listTasks(listId)).filter((t) => !t.parent && (t.title || '').trim());
    const open = all.filter((t) => t.status !== 'completed').sort(byPosition);
    const sod = startOfDay();
    const done = all
      .filter((t) => t.status === 'completed' && t.completed && new Date(t.completed) >= sod)
      .sort((a, b) => b.completed.localeCompare(a.completed));

    // Log completions (Google's timestamp is the source of truth), but never
    // back-fill tasks finished before One Focus was connected.
    const since = state.google.connectedAt;
    for (const t of all)
      if (t.status === 'completed' && t.completed && since && t.completed >= since)
        tracker.recordCompletion({ key: 'g:' + t.id, title: t.title.trim(), googleId: t.id }, t.completed);

    today = { open: open.map(pick), done: done.map(pick), syncedAt: new Date().toISOString(), error: null };

    // Tasks never start on their own. If the running task was finished or
    // deleted (here or in Google Tasks), stop it and go idle.
    const cur = state.current;
    if (cur && cur.googleId && !isHold(cur)) {
      const live = today.open.find((t) => t.id === cur.googleId);
      tracker.setCurrent(live ? { key: cur.key, title: live.title, googleId: live.id } : null);
    }
  } catch (e) {
    today = {
      ...today,
      error: e.auth ? 'Google sign-in expired. Reconnect in Settings.' : `Can’t reach Google Tasks. ${e.message}`,
    };
  }
  push();
}

// ---------- window ----------

function createWindow() {
  const saved = savedBounds();
  win = new BrowserWindow({
    ...(saved || { width: 420, height: 300 }),
    minWidth: 280,
    minHeight: 220,
    backgroundColor: '#0B0B0C',
    title: 'One Focus',
    frame: false, // no OS title bar; controls are drawn in the page and appear on hover
    autoHideMenuBar: true,
    alwaysOnTop: !!state.settings.alwaysOnTop,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, 'index.html'));
  win.on('focus', () => sync());

  // Remember where the window lives (not the temporary panel size).
  let saveTimer;
  const remember = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (win.isDestroyed() || restoreBounds || win.isMaximized() || win.isMinimized()) return;
      state.window = win.getBounds();
      store.save(state);
    }, 400);
  };
  win.on('moved', remember);
  win.on('resized', remember);

  // Tell the page when the pointer is over the window. Polling the cursor
  // is more reliable than CSS :hover, which drag regions can swallow.
  // Also report which top corner the pointer is near, so the menu (left)
  // and window controls (right) only appear when you reach for them.
  const NEAR_TOP = 64;
  let inside = false;
  let zone = null;
  const hoverTimer = setInterval(() => {
    if (win.isDestroyed()) return clearInterval(hoverTimer);
    const p = screen.getCursorScreenPoint();
    const b = win.getBounds();
    const now = p.x >= b.x && p.x < b.x + b.width && p.y >= b.y && p.y < b.y + b.height;
    if (now !== inside) {
      inside = now;
      win.webContents.send('window:hover', inside);
    }
    const z = now && p.y - b.y < NEAR_TOP ? (p.x - b.x < b.width / 2 ? 'menu' : 'controls') : null;
    if (z !== zone) {
      zone = z;
      win.webContents.send('window:zone', zone);
    }
  }, 100);

  // Dev mode: reload the window whenever a renderer file changes.
  if (process.argv.includes('--dev')) {
    let timer;
    fs.watch(__dirname, (_event, file) => {
      if (!file || !/\.(html|css)$|renderer\.js$/.test(file)) return;
      clearTimeout(timer);
      timer = setTimeout(() => win.webContents.reloadIgnoringCache(), 80);
    });
  }
}

// Panels (Log, Today, Settings) need more room than the clock. Grow the
// window while one is open, staying on the same screen, and restore after.
function setView(name) {
  if (!win) return;
  if (name === 'now') {
    if (restoreBounds) win.setBounds(restoreBounds, true);
    restoreBounds = null;
    return;
  }
  if (restoreBounds) return;
  const b = win.getBounds();
  if (b.width >= PANEL_MIN.width && b.height >= PANEL_MIN.height) return;
  restoreBounds = b;
  const wa = screen.getDisplayMatching(b).workArea;
  const width = Math.min(Math.max(b.width, PANEL_MIN.width), wa.width);
  const height = Math.min(Math.max(b.height, PANEL_MIN.height), wa.height);
  const x = Math.max(wa.x, Math.min(b.x, wa.x + wa.width - width));
  const y = Math.max(wa.y, Math.min(b.y, wa.y + wa.height - height));
  win.setBounds({ x, y, width, height }, true);
}

// ---------- IPC ----------

ipcMain.on('window:action', (e, action) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  if (!w) return;
  if (action === 'minimize') w.minimize();
  else if (action === 'maximize') w.isMaximized() ? w.unmaximize() : w.maximize();
  else if (action === 'close') w.close();
});

ipcMain.on('view:set', (_e, name) => setView(name));

ipcMain.handle('state:get', () => snapshot());
ipcMain.handle('update:install', () => installUpdate());

// Done for the day: open the review link set in Settings.
ipcMain.handle('review:open', () => {
  const u = state.settings.reviewUrl;
  if (u && /^https?:\/\//i.test(u)) shell.openExternal(u);
  return !!u;
});

// Running over: push the current goal and every goal planned after it.
ipcMain.handle('goals:shift', (_e, raw) => {
  const ms = Number(raw);
  if (!ms || Math.abs(ms) > 12 * 3600e3) return snapshot();
  const cur = state.current && !isHold(state.current) ? state.current : null;
  const curGoal = cur && state.taskMeta[cur.key] && state.taskMeta[cur.key].goal;
  const base = curGoal ? Date.parse(curGoal) : Date.now();
  const keys = new Set(today.open.map((t) => 'g:' + t.id));
  if (cur) keys.add(cur.key);
  for (const k of keys) {
    const m = state.taskMeta[k];
    if (m && m.goal && Date.parse(m.goal) >= base) m.goal = new Date(Date.parse(m.goal) + ms).toISOString();
  }
  store.save(state);
  push();
  return snapshot();
});
ipcMain.handle('update:check', () => updater && update.status !== 'ready' && updater.checkForUpdates().catch(() => {}));

// ---------- auto-update ----------
// Installed builds check the `builds` branch on GitHub every 30 minutes,
// download new versions in the background, and install them on restart,
// or by themselves once you've been away for 10 minutes.

function setUpdate(patch) {
  update = { ...update, ...patch };
  push();
}

function setupUpdates() {
  if (!app.isPackaged) return setUpdate({ status: 'dev' });
  const { autoUpdater } = require('electron-updater');
  updater = autoUpdater;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('checking-for-update', () => update.status !== 'ready' && setUpdate({ status: 'checking' }));
  autoUpdater.on('update-not-available', () => setUpdate({ status: 'current' }));
  autoUpdater.on('update-available', (i) => setUpdate({ status: 'downloading', version: i.version }));
  autoUpdater.on('update-downloaded', (i) => setUpdate({ status: 'ready', version: i.version }));
  autoUpdater.on('error', () => update.status !== 'ready' && setUpdate({ status: 'error' }));
  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  check();
  setInterval(check, 30 * 60e3);
}

function installUpdate() {
  if (!updater || update.status !== 'ready') return;
  tracker.pause('quit');
  updater.quitAndInstall(true, true); // silent install, then reopen
}

ipcMain.handle('log:get', () => ({
  taskMeta: state.taskMeta,
  sessions: state.sessions,
  open: state.open,
  completions: state.completions,
}));

ipcMain.handle('manual:set', (_e, text) => {
  const title = String(text || '').trim().slice(0, 200);
  if (client || !title) return snapshot();
  tracker.setCurrent({ key: 'm:' + title, title, googleId: null });
  push();
  return snapshot();
});

// Start a task: the given one, or the first in the queue. Starting a task
// that isn't first moves it to the top in Google so the order matches.
ipcMain.handle('current:start', async (_e, id) => {
  if (!client) return { error: 'Connect Google Tasks in Settings first.' };
  const t = id ? today.open.find((x) => x.id === id) : snapshot().next;
  if (!t) return { error: 'Nothing in the list to start.' };
  tracker.setCurrent({ key: 'g:' + t.id, title: t.title, googleId: t.id });
  push();
  try {
    if (today.open[0] && today.open[0].id !== t.id) await client.move(state.google.listId, t.id);
    await resync();
  } catch (e) {
    return { error: e.message };
  }
  return { ok: true };
});

// Hold: pause the running task for a meeting, call, break… and come back.
ipcMain.handle('hold:start', (_e, raw) => {
  const name = String(raw || '').trim().slice(0, 40);
  if (!name) return snapshot();
  const hit = state.holdNames.find((h) => h.name.toLowerCase() === name.toLowerCase());
  if (hit) hit.lastUsed = nowIso();
  else state.holdNames.push({ name, lastUsed: nowIso() });
  if (!isHold(state.current)) state.held = state.current;
  tracker.setCurrent({ key: 'hold:' + (hit ? hit.name : name), title: hit ? hit.name : name, googleId: null });
  store.save(state);
  push();
  return snapshot();
});

ipcMain.handle('hold:end', () => {
  const held = state.held;
  state.held = null;
  let back = null;
  if (held && held.googleId) {
    const live = today.open.find((t) => t.id === held.googleId);
    if (live) back = { key: held.key, title: live.title, googleId: live.id };
  } else if (held) back = { key: held.key, title: held.title, googleId: null };
  tracker.setCurrent(back);
  if (back) state.current.since = held.since; // time on task continues from before the hold
  state.checkFrom = nowIso();
  store.save(state);
  push();
  return snapshot();
});

ipcMain.handle('check:answer', async (_e, answer) => {
  if (answer === 'confirm') state.checkFrom = nowIso();
  if (answer === 'tomorrow') tracker.setCurrent(null); // stays first in the queue
  if (answer === 'done' && state.current && state.current.googleId) {
    await client.patch(state.google.listId, state.current.googleId, { status: 'completed' }).catch(() => {});
    await resync();
  }
  store.save(state);
  closeCheck();
  push();
  return snapshot();
});

ipcMain.handle('session:edit', (_e, op, id, payload = {}) => {
  let ok = false;
  if (op === 'edit') ok = tracker.editSession(id, payload);
  else if (op === 'split') ok = tracker.splitSession(id, payload.at, String(payload.name || '').trim().slice(0, 40));
  else if (op === 'delete') ok = tracker.deleteSession(id);
  push();
  return { ok };
});

ipcMain.handle('current:stop', () => {
  tracker.setCurrent(null);
  push();
  return snapshot();
});

ipcMain.handle('task:action', async (_e, action, id, value) => {
  if (!client || !state.google.listId) return { error: 'Connect Google Tasks in Settings first.' };
  const listId = state.google.listId;
  const title = typeof value === 'string' ? value.trim().slice(0, 1024) : '';
  try {
    if (action === 'complete') await client.patch(listId, id, { status: 'completed' });
    else if (action === 'reopen') {
      await client.patch(listId, id, { status: 'needsAction', completed: null });
      tracker.removeCompletion('g:' + id);
    } else if (action === 'rename' && title) await client.patch(listId, id, { title });
    else if (action === 'add' && title) {
      // Added from the Today tab: scheduled for today. From All: no date.
      const last = today.open[today.open.length - 1];
      await client.insert(listId, { title, ...(id === 'today' ? { due: todayDue() } : {}) }, last && last.id);
    } else if (action === 'schedule') await client.patch(listId, id, { due: todayDue() });
    else if (action === 'unschedule') {
      await client.patch(listId, id, { due: null });
    } else if (action === 'delete') await client.remove(listId, id);
    else if (action === 'focus') await client.move(listId, id);
    else if (action === 'move') await client.move(listId, id, value || undefined);
    else if (action === 'addStart' && title) {
      // Switch to something unplanned: add it to the top and start it now.
      const t = await client.insert(listId, { title, due: todayDue() });
      if (isHold(state.current)) state.held = null;
      tracker.setCurrent({ key: 'g:' + t.id, title: t.title.trim(), googleId: t.id });
    }
    await resync();
    return { ok: true };
  } catch (e) {
    return { error: e.message };
  }
});

// Category and/or rating for a finished task. A new category name is added.
ipcMain.handle('task:meta', (_e, key, patch) => {
  if (!key) return snapshot();
  const meta = (state.taskMeta[key] = { ...(state.taskMeta[key] || {}) });
  if (typeof patch.category === 'string' && patch.category.trim()) {
    const name = patch.category.trim().slice(0, 40);
    const hit = state.categories.find((c) => c.name.toLowerCase() === name.toLowerCase());
    if (hit) hit.lastUsed = new Date().toISOString();
    else state.categories.push({ name, lastUsed: new Date().toISOString() });
    meta.category = hit ? hit.name : name;
  }
  if (Number.isInteger(patch.rating) && patch.rating >= 1 && patch.rating <= 5) meta.rating = patch.rating;
  // Goal: the time you want this task finished by (ISO), or null to clear.
  if ('goal' in patch) {
    if (patch.goal && !Number.isNaN(Date.parse(patch.goal))) meta.goal = new Date(patch.goal).toISOString();
    else delete meta.goal;
  }
  store.save(state);
  push();
  return snapshot();
});

ipcMain.handle('settings:update', async (_e, patch) => {
  const allowed = ['showSince', 'showElapsed', 'alwaysOnTop', 'listName', 'clientId', 'clientSecret', 'askCategory', 'askRating', 'launchAtLogin'];
  const prev = { ...state.settings };
  for (const k of allowed) if (k in patch) state.settings[k] = typeof patch[k] === 'string' ? patch[k].trim() : !!patch[k];
  if ('logView' in patch) state.settings.logView = patch.logView === 'sessions' ? 'sessions' : 'summary';
  if ('mapGoals' in patch) state.settings.mapGoals = !!patch.mapGoals;
  if ('reviewUrl' in patch) {
    const u = String(patch.reviewUrl || '').trim();
    state.settings.reviewUrl = /^https?:\/\/\S+$/i.test(u) ? u : '';
  }
  if ('goalDisplay' in patch) state.settings.goalDisplay = ['ring', 'ringPct', 'text'].includes(patch.goalDisplay) ? patch.goalDisplay : 'ring';
  if ('joltMinutes' in patch) state.settings.joltMinutes = [0, 30, 60, 90, 120].includes(+patch.joltMinutes) ? +patch.joltMinutes : 0;
  if ('checkMinutes' in patch) state.settings.checkMinutes = [0, 60, 120, 180].includes(+patch.checkMinutes) ? +patch.checkMinutes : 120;
  if ('awayMinutes' in patch) state.settings.awayMinutes = [5, 10, 20, 30].includes(+patch.awayMinutes) ? +patch.awayMinutes : 10;
  if ('endOfDay' in patch) state.settings.endOfDay = /^\d{2}:\d{2}$/.test(patch.endOfDay) ? patch.endOfDay : '';
  if (state.settings.launchAtLogin !== prev.launchAtLogin) app.setLoginItemSettings({ openAtLogin: state.settings.launchAtLogin });
  if (!state.settings.listName) state.settings.listName = 'One Focus';
  if (state.settings.alwaysOnTop !== prev.alwaysOnTop) win.setAlwaysOnTop(state.settings.alwaysOnTop);
  const listChanged = state.settings.listName !== prev.listName;
  if (listChanged) state.google.listId = null;
  if (state.settings.clientId !== prev.clientId || state.settings.clientSecret !== prev.clientSecret) makeClient();
  store.save(state);
  if (listChanged) await resync();
  push();
  return snapshot();
});

ipcMain.handle('google:connect', async () => {
  const { clientId, clientSecret } = state.settings;
  if (!clientId || !clientSecret) return { error: 'Add your Client ID and Client secret first.' };
  try {
    const tokens = await google.signIn({ clientId, clientSecret, openExternal: (u) => shell.openExternal(u) });
    if (!tokens.refresh_token) return { error: 'Google didn’t return a sign-in token. Try connecting again.' };
    store.setRefreshToken(state, tokens.refresh_token);
    state.google.connectedAt = new Date().toISOString();
    state.google.listId = null;
    store.save(state);
    makeClient();
    client.setAccess(tokens);
    await resync();
    return { ok: true };
  } catch (e) {
    return { error: e.message };
  }
});

ipcMain.handle('google:disconnect', () => {
  const token = store.getRefreshToken(state);
  if (token) google.revoke(token);
  store.setRefreshToken(state, null);
  state.google.listId = null;
  client = null;
  today = { open: [], done: [], syncedAt: null, error: null };
  tracker.setCurrent(null);
  store.save(state);
  push();
  return snapshot();
});

// ---------- lifecycle ----------

app.whenReady().then(() => {
  state = store.load();
  tracker = new Tracker(state, () => store.save(state));
  tracker.recover();
  makeClient();
  createWindow();
  sync();
  setupUpdates();

  setInterval(sync, SYNC_MS);

  // Heartbeat keeps crash recovery accurate. After N minutes (Settings) with no
  // input you're "away": task time stops and idle time runs instead,
  // back-dated to when input stopped.
  setInterval(() => {
    const idle = powerMonitor.getSystemIdleTime();
    const awayAfter = (state.settings.awayMinutes || 10) * 60;
    if (idle >= awayAfter && !tracker.away) tracker.setAway(true, new Date(Date.now() - idle * 1000).toISOString());
    else if (idle < awayAfter && tracker.away) tracker.setAway(false);
    tracker.heartbeat();
    if (tracker.away && update.status === 'ready' && !check) installUpdate();
    checkDue();
    push();
  }, HEARTBEAT_MS);

  powerMonitor.on('lock-screen', () => (tracker.pause('lock'), push()));
  powerMonitor.on('unlock-screen', () => (tracker.resume('lock'), sync()));
  powerMonitor.on('suspend', () => (tracker.pause('sleep'), push()));
  powerMonitor.on('resume', () => (tracker.resume('sleep'), sync()));

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => tracker && tracker.pause('quit'));

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
