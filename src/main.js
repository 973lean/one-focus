const { app, BrowserWindow, ipcMain, screen, powerMonitor, shell, desktopCapturer, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');
const store = require('./store');
const Tracker = require('./tracker');
const google = require('./google');
const web = require('./web');
const planning = require('./plan');

const VIEW_BASE = 'https://973lean.github.io/one-focus/';

const SYNC_MS = 60e3;
const HEARTBEAT_MS = 30e3;
const PANEL_MIN = { width: 440, height: 480 };
const SETUP_MIN = { width: 980, height: 660 }; // the week planner needs room

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
    goals: goalsFor([cur, held, ...today.open.map((t) => ({ key: 'g:' + t.id }))]),
    plans: plansFor([...today.open, ...today.done]),
    breaks: state.breaks,
    web: {
      on: !!state.web.token,
      url: state.web.gistId ? VIEW_BASE + '#' + state.web.gistId : null,
      publishedAt: state.web.publishedAt,
      error: state.web.error,
    },
    categories: recentCategories(),
    holdNames: recentHolds(),
    held,
    check,
    reminder,
    app: { version: app.getVersion(), update },
  };
}

// Setup: planned start + length and group (category) for each open task.
function plansFor(open) {
  const out = {};
  for (const t of open) {
    const m = state.taskMeta['g:' + t.id];
    if (m && (m.plan || m.repeat || m.mins))
      out['g:' + t.id] = { plan: m.plan || null, repeat: m.repeat || null, mins: m.mins || null };
  }
  return out;
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

// ---------- private web view ----------
// Publishes at most every 2 minutes while something changes.
let webTimer = null;
let webBusy = false;
let webLast = 0;
function scheduleWeb() {
  if (!state.web.token || webTimer) return;
  const wait = Math.max(15e3, 120e3 - (Date.now() - webLast));
  webTimer = setTimeout(() => {
    webTimer = null;
    publishWeb();
  }, wait);
}
async function publishWeb() {
  const token = store.getSecret(state.web.token);
  if (!token || webBusy) return;
  webBusy = true;
  webLast = Date.now();
  try {
    const view = web.buildView({
      current: state.current,
      open: today.open,
      done: today.done,
      sessions: state.sessions,
      live: state.open,
      taskMeta: state.taskMeta,
    });
    state.web.gistId = await web.publish(token, state.web.gistId, view);
    state.web.publishedAt = nowIso();
    state.web.error = null;
  } catch (e) {
    state.web.error = e.message;
  } finally {
    webBusy = false;
    store.save(state);
    if (win && !win.isDestroyed()) win.webContents.send('state', snapshot());
  }
}

function push() {
  scheduleWeb();
  // The blur only makes sense while a real task runs.
  if (check && (!state.current || isHold(state.current))) closeCheck();
  const snap = snapshot();
  if (win && !win.isDestroyed()) win.webContents.send('state', snap);
  if (setupWin && !setupWin.isDestroyed()) setupWin.webContents.send('state', snap);
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
  if (reminder) answerReminder('dismiss');
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

// With a day structure: is it before today's start (or a day off)?
function beforeWorkday(d = new Date()) {
  const ds = state.settings.dayStructure;
  if (!ds) return false;
  const weekend = d.getDay() === 0 || d.getDay() === 6;
  if (weekend && !ds.weekends) return true;
  const [h, m] = ds.start.split(':').map(Number);
  return d.getHours() * 60 + d.getMinutes() < h * 60 + m;
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
const pick = (t) => ({ id: t.id, title: t.title.trim(), notes: t.notes || '', completed: t.completed || null, due: t.due ? t.due.slice(0, 10) : null });
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
    const raw = await client.listTasks(listId);
    const all = raw.filter((t) => !t.parent && (t.title || '').trim());
    // Subtasks are a task's "items" (a checklist), in list order.
    const itemsOf = {};
    for (const c of raw.filter((x) => x.parent && (x.title || '').trim()).sort(byPosition))
      (itemsOf[c.parent] = itemsOf[c.parent] || []).push({ id: c.id, title: c.title.trim(), done: c.status === 'completed' });
    // List order, then anything with a planned or "by" time pulled to the
    // front in time order, so the next task is always the earliest one.
    const open = planning.orderTasks(all.filter((t) => t.status !== 'completed').sort(byPosition), state.taskMeta);
    const sod = startOfDay();
    const done = all
      .filter((t) => t.status === 'completed' && t.completed && new Date(t.completed) >= sod)
      .sort((a, b) => b.completed.localeCompare(a.completed));

    // Log completions (Google's timestamp is the source of truth), but never
    // back-fill tasks finished before One Focus was connected.
    const since = state.google.connectedAt;
    const spawn = [];
    for (const t of all)
      if (t.status === 'completed' && t.completed && since && t.completed >= since) {
        tracker.recordCompletion({ key: 'g:' + t.id, title: t.title.trim(), googleId: t.id }, t.completed);
        const m = state.taskMeta['g:' + t.id];
        if (m && m.repeat && m.spawned !== t.completed) {
          m.spawned = t.completed; // once per completion
          spawn.push({ t, m });
        }
      }
    // Repeating tasks: finishing one creates the next, same time of day.
    for (const { t, m } of spawn) {
      const doneDay = localDate(new Date(t.completed));
      const from = t.due && t.due.slice(0, 10) > doneDay ? t.due.slice(0, 10) : doneDay;
      const next = planning.nextDate(from, m.repeat);
      const created = await client.insert(listId, { title: t.title.trim(), notes: t.notes || undefined, due: next + 'T00:00:00.000Z' });
      const meta = { repeat: m.repeat };
      if (m.mins) meta.mins = m.mins;
      if (m.plan) {
        const old = new Date(m.plan.start);
        const [y, mo, d] = next.split('-').map(Number);
        const start = new Date(y, mo - 1, d, old.getHours(), old.getMinutes());
        meta.plan = { start: start.toISOString(), mins: m.plan.mins };
        meta.goal = new Date(start.getTime() + m.plan.mins * 60e3).toISOString();
      }
      state.taskMeta['g:' + created.id] = meta;
    }
    if (spawn.length) {
      store.save(state);
      setTimeout(() => resync(), 500);
    }

    const withItems = (t) => ({ ...pick(t), items: itemsOf[t.id] || [] });
    today = { open: open.map(withItems), done: done.map(withItems), syncedAt: new Date().toISOString(), error: null };

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
    show: false, // shown once the page has drawn (no blink): see ui:ready
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
  // The Planner and the popup stay alive hidden; closing One Focus itself quits.
  win.on('closed', () => app.quit());
  setTimeout(() => win && !win.isDestroyed() && !win.isVisible() && win.show(), 2500); // fallback
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
    // Top strip: menu (left) / window controls (right). Bottom-right corner: settings gear.
    const rx = p.x - b.x;
    const ry = p.y - b.y;
    const z = !now
      ? null
      : ry < NEAR_TOP
      ? rx < b.width / 2 ? 'menu' : 'controls'
      : b.height - ry < 72 && b.width - rx < 96
      ? 'gear'
      : null;
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
  const min = name === 'setup' ? SETUP_MIN : PANEL_MIN;
  const b = win.getBounds();
  if (b.width >= min.width && b.height >= min.height) return;
  if (!restoreBounds) restoreBounds = b; // remember the clock-sized window, once
  const PANEL = min;
  const wa = screen.getDisplayMatching(b).workArea;
  const width = Math.min(Math.max(b.width, PANEL.width), wa.width);
  const height = Math.min(Math.max(b.height, PANEL.height), wa.height);
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
  else if (action === 'quit') app.quit(); // Hop off
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

// ---------- Setup window (a large window on the main monitor) ----------

// The Planner: one window, two tabs (Today, Week). Opens on the main monitor;
// clicking anywhere outside it closes it (setting).
let setupWin = null;
const light = () => state.settings.appMode === 'light';
let quitting = false;

// Windows paints a new or re-shown window for a frame before its content:
// that's the white blink. Show it fully transparent, then fade it in.
function fadeIn(w, focus) {
  if (!w || w.isDestroyed()) return;
  w.setOpacity(0);
  if (focus) {
    w.show();
    w.focus();
  } else w.showInactive();
  let o = 0;
  const step = () => {
    if (w.isDestroyed()) return;
    o = Math.min(1, o + 0.25);
    w.setOpacity(o);
    if (o < 1) setTimeout(step, 16);
  };
  setTimeout(step, 50);
}

function openSetupWindow(tab = 'week') {
  if (light() && tab !== 'settings') return;
  const inline = tab === 'settings' ? state.settings.settingsMode !== 'modal' : state.settings.setupMode === 'inline';
  if (inline) {
    win.show();
    win.focus();
    win.webContents.send('planner:tab', tab);
    return;
  }
  if (setupWin && !setupWin.isDestroyed()) {
    setupWin.webContents.send('planner:tab', tab);
    // Kept alive while hidden, so it comes back instantly on the right tab.
    if (!setupWin.isVisible()) setTimeout(() => fadeIn(setupWin, true), 30);
    else setupWin.focus();
    return;
  }
  const wa = screen.getPrimaryDisplay().workArea;
  const width = Math.round(Math.min(wa.width * 0.88, 1560));
  const height = Math.round(Math.min(wa.height * 0.88, 1000));
  setupWin = new BrowserWindow({
    x: wa.x + Math.round((wa.width - width) / 2),
    y: wa.y + Math.round((wa.height - height) / 2),
    width,
    height,
    minWidth: 760,
    minHeight: 520,
    frame: false,
    show: false,
    backgroundColor: '#0B0B0C',
    title: 'One Focus · Set up',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  setupWin.loadFile(path.join(__dirname, 'index.html'), { query: { mode: 'setup', tab } });
  // Shown when the page says it has drawn (ui:ready), so it appears all at once.
  setTimeout(() => setupWin && !setupWin.isDestroyed() && !setupWin.isVisible() && fadeIn(setupWin, true), 2500);
  // Closing only hides it (until the app quits): reopening is instant, no reload.
  setupWin.on('close', (e) => {
    if (quitting) return;
    e.preventDefault();
    setupWin.hide();
  });
  setupWin.on('blur', () =>
    setTimeout(() => {
      if (setupWin && !setupWin.isDestroyed() && !setupWin.isFocused() && setupWin.isVisible() && state.settings.plannerBlurClose !== false) setupWin.hide();
    }, 200)
  );
  setupWin.on('closed', () => (setupWin = null));
}
ipcMain.handle('setup:open', (_e, tab) => openSetupWindow(['today', 'settings'].includes(tab) ? tab : 'week'));

// A page has drawn its first frame: show its window now (no white blink).
ipcMain.on('ui:ready', (e) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  if (w && !w.isVisible()) fadeIn(w, w === setupWin);
});

// Re-plan several blocks at once ([{ id, start, mins }]); dates follow in the background.
ipcMain.handle('plan:many', async (_e, list) => {
  const moved = [];
  for (const it of Array.isArray(list) ? list.slice(0, 60) : []) {
    if (!it || Number.isNaN(Date.parse(it.start))) continue;
    const key = 'g:' + it.id;
    const meta = (state.taskMeta[key] = { ...(state.taskMeta[key] || {}) });
    const mins = Math.min(Math.max(Math.round(+it.mins / 15) * 15 || 30, 15), 12 * 60);
    meta.plan = { start: new Date(it.start).toISOString(), mins };
    meta.goal = new Date(Date.parse(it.start) + mins * 60e3).toISOString();
    moved.push({ id: it.id, day: localDate(new Date(it.start)) });
  }
  store.save(state);
  push();
  if (client && state.google.listId)
    for (const m of moved) await client.patch(state.google.listId, m.id, { due: m.day + 'T00:00:00.000Z' }).catch(() => {});
  await resync();
  return snapshot();
});

// Behind plan: push today's remaining planned blocks (and breaks) from a time.
ipcMain.handle('plan:shift', (_e, fromIso, raw) => {
  const ms = Math.round(+raw / (5 * 60e3)) * 5 * 60e3;
  const from = Date.parse(fromIso);
  if (!ms || Number.isNaN(from) || Math.abs(ms) > 12 * 3600e3) return snapshot();
  const day = localDate(new Date(from));
  for (const t of today.open) {
    const m = state.taskMeta['g:' + t.id];
    if (!m || !m.plan) continue;
    const s = Date.parse(m.plan.start);
    if (s < from || localDate(new Date(s)) !== day) continue;
    m.plan.start = new Date(s + ms).toISOString();
    m.goal = new Date(s + ms + m.plan.mins * 60e3).toISOString();
  }
  for (const b of state.breaks) {
    const s = Date.parse(b.start);
    if (s >= from && localDate(new Date(s)) === day) b.start = new Date(s + ms).toISOString();
  }
  store.save(state);
  push();
  return snapshot();
});

// ---------- ways in: screen corners (triple bump) and keyboard shortcuts ----------

function cornerAt(p) {
  const b = screen.getPrimaryDisplay().bounds;
  const e = 4;
  const L = p.x <= b.x + e;
  const R = p.x >= b.x + b.width - 1 - e;
  const T = p.y <= b.y + e;
  const B = p.y >= b.y + b.height - 1 - e;
  return T && L ? 'tl' : T && R ? 'tr' : B && L ? 'bl' : B && R ? 'br' : null;
}
// Push the pointer into a corner 3 times within 1.5s.
function watchCorners() {
  let inside = null;
  let hits = [];
  setInterval(() => {
    if (light()) return;
    const c = cornerAt(screen.getCursorScreenPoint());
    if (c === inside) return;
    inside = c;
    if (!c) return;
    const now = Date.now();
    hits = hits.filter((h) => h.c === c && now - h.t < 1500);
    hits.push({ c, t: now });
    if (hits.length < 3) return;
    hits = [];
    if (state.settings.cornerToday === c) openSetupWindow('today');
    else if (state.settings.cornerWeek === c) openSetupWindow('week');
  }, 40);
}

function applyShortcuts() {
  globalShortcut.unregisterAll();
  if (light() || state.settings.shortcuts === false) return;
  globalShortcut.register('CommandOrControl+Alt+T', () => openSetupWindow('today'));
  globalShortcut.register('CommandOrControl+Alt+W', () => openSetupWindow('week'));
}

// ---------- the Planner opens itself at chosen times ----------

function autoPlanSlots(d = new Date()) {
  const ap = state.settings.autoPlan;
  if (light() || !ap || ap.mode === 'off') return [];
  const ds = state.settings.dayStructure || { start: '09:00', end: '17:30', weekends: false };
  if ((d.getDay() === 0 || d.getDay() === 6) && !ds.weekends) return [];
  const hhmm = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
  const toMin = (v) => +v.slice(0, 2) * 60 + +v.slice(3, 5);
  if (ap.mode === 'startEnd') return [{ at: ds.start, tab: 'today' }, { at: ds.end, tab: 'week' }];
  if (ap.mode === 'every') {
    const out = [];
    for (let m = toMin(ds.start); m < toMin(ds.end); m += (ap.every || 3) * 60) out.push({ at: hhmm(m), tab: 'today' });
    return out;
  }
  return (ap.times || []).map((at) => ({ at, tab: 'today' }));
}
function checkAutoPlan() {
  if (tracker.away || tracker.pauses.size || check) return;
  const d = new Date();
  const day = localDate(d);
  if (state.autoPlanFired.date !== day) state.autoPlanFired = { date: day, at: [] };
  const nowMin = d.getHours() * 60 + d.getMinutes();
  for (const s of autoPlanSlots(d)) {
    const m = +s.at.slice(0, 2) * 60 + +s.at.slice(3, 5);
    if (nowMin >= m && nowMin < m + 30 && !state.autoPlanFired.at.includes(s.at)) {
      state.autoPlanFired.at.push(s.at);
      store.save(state);
      openSetupWindow(s.tab);
      return;
    }
  }
}

// ---------- reminders: a planned block starts / the running task runs over ----------

let reminder = null; // { id, kind: 'block' | 'over', taskId, title, goal, overMs }
let toastWin = null;

// The reminder shows as a small popup in the bottom-right of the main monitor.
// It never takes focus; it closes when answered, or by itself after 3 minutes.
let toastTimer = null;
function setReminder(r) {
  reminder = r;
  const wa = screen.getPrimaryDisplay().workArea;
  const W = 380;
  const H = 118;
  const bounds = { x: wa.x + wa.width - W - 16, y: wa.y + wa.height - H - 16, width: W, height: H };
  const send = () => {
    if (!toastWin || toastWin.isDestroyed()) return;
    toastWin.webContents.send('toast', r);
    if (!toastWin.isVisible()) setTimeout(() => fadeIn(toastWin, false), 30);
  };
  if (toastWin && !toastWin.isDestroyed()) {
    toastWin.setBounds(bounds);
    send();
  } else {
    toastWin = new BrowserWindow({
      ...bounds,
      frame: false,
      show: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      backgroundColor: '#0B0B0C',
      webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
    });
    toastWin.setAlwaysOnTop(true, 'pop-up-menu');
    toastWin.on('closed', () => (toastWin = null));
    toastWin.webContents.once('did-finish-load', send);
    toastWin.loadFile(path.join(__dirname, 'toast.html'));
  }
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => reminder && reminder.id === r.id && answerReminder('dismiss'), 3 * 60e3);
  return r;
}
function closeToast() {
  clearTimeout(toastTimer);
  if (toastWin && !toastWin.isDestroyed()) toastWin.hide();
}
function remindFired(id) {
  const day = localDate();
  if (state.remindFired.date !== day) state.remindFired = { date: day, ids: [] };
  return state.remindFired.ids.includes(id);
}
function checkReminders() {
  if (light() || reminder || check || tracker.away || tracker.pauses.size) return;
  const now = Date.now();
  const cur = state.current && !isHold(state.current) ? state.current : null;
  const cm = cur && state.taskMeta[cur.key];
  if (state.settings.remindOver !== false && cm && cm.goal && now >= Date.parse(cm.goal)) {
    const slot = Math.floor((now - Date.parse(cm.goal)) / (15 * 60e3)); // again every 15 minutes
    const id = `over:${cur.key}:${cm.goal}:${slot}`;
    if (!remindFired(id)) return setReminder({ id, kind: 'over', taskId: cur.googleId, title: cur.title, goal: cm.goal, overMs: now - Date.parse(cm.goal) });
  }
  if (state.settings.remindBlocks !== false)
    for (const t of today.open) {
      const p = state.taskMeta['g:' + t.id] && state.taskMeta['g:' + t.id].plan;
      if (!p || (cur && cur.googleId === t.id)) continue;
      const start = Date.parse(p.start);
      const id = `block:${t.id}:${p.start}`;
      if (now >= start && now - start < 10 * 60e3 && !remindFired(id)) return setReminder({ id, kind: 'block', taskId: t.id, title: t.title });
    }
}

ipcMain.handle('reminder:act', (_e, action) => answerReminder(action));
async function answerReminder(action) {
  const r = reminder;
  reminder = null;
  closeToast();
  if (!r) return snapshot();
  remindFired(r.id);
  state.remindFired.ids.push(r.id);
  store.save(state);
  if (action === 'plan') openSetupWindow('today');
  else if (action === 'start' && client) {
    const t = today.open.find((x) => x.id === r.taskId);
    if (t) tracker.setCurrent({ key: 'g:' + t.id, title: t.title, googleId: t.id });
  } else if (action === 'done' && client && state.google.listId) {
    await client.patch(state.google.listId, r.taskId, { status: 'completed' }).catch(() => {});
    await resync();
  } else if (action === 'extend') {
    const m = state.taskMeta['g:' + r.taskId];
    if (m && m.goal) {
      m.goal = new Date(Math.max(Date.parse(m.goal), Date.now()) + 15 * 60e3).toISOString();
      if (m.plan) m.plan.mins = Math.round((Date.parse(m.goal) - Date.parse(m.plan.start)) / 60e3);
      store.save(state);
    }
  }
  push();
  return snapshot();
}

// Items (Google subtasks) on a task: add, tick, rename, delete.
ipcMain.handle('item:action', async (_e, parentId, action, itemId, value) => {
  if (!client || !state.google.listId) return snapshot();
  const listId = state.google.listId;
  const t = today.open.find((x) => x.id === parentId) || today.done.find((x) => x.id === parentId);
  try {
    if (action === 'add' && String(value || '').trim()) {
      const last = t && t.items.length ? t.items[t.items.length - 1].id : undefined;
      await client.insert(listId, { title: String(value).trim().slice(0, 1024) }, last, parentId);
    } else if (action === 'toggle') {
      const it = t && t.items.find((x) => x.id === itemId);
      await client.patch(listId, itemId, it && it.done ? { status: 'needsAction', completed: null } : { status: 'completed' });
    } else if (action === 'rename' && String(value || '').trim()) await client.patch(listId, itemId, { title: String(value).trim() });
    else if (action === 'delete') await client.remove(listId, itemId);
  } catch {}
  await resync();
  return snapshot();
});

// Day structure: times as "HH:MM", ranges kept only if they make sense.
function cleanStructure(d) {
  if (!d) return null;
  const hm = (v) => (/^\d{2}:\d{2}$/.test(v) ? v : null);
  const ranges = (list) =>
    (Array.isArray(list) ? list : []).map(([a, b]) => [hm(a), hm(b)]).filter(([a, b]) => a && b && a < b).slice(0, 8);
  const start = hm(d.start) || '09:00';
  const end = hm(d.end) || '17:30';
  return { start, end: end > start ? end : '17:30', work: ranges(d.work), breaks: ranges(d.breaks), weekends: !!d.weekends };
}

// Task details from Setup: title and notes go to Google; length and repeat stay here.
ipcMain.handle('task:detail', async (_e, id, patch) => {
  const key = 'g:' + id;
  const meta = (state.taskMeta[key] = { ...(state.taskMeta[key] || {}) });
  if ('repeat' in patch) {
    if (['daily', 'weekdays', 'weekly'].includes(patch.repeat)) meta.repeat = patch.repeat;
    else if (patch.repeat && typeof patch.repeat === 'object') meta.repeat = planning.normalize(patch.repeat, localDate());
    else delete meta.repeat;
  }
  if ('mins' in patch) {
    const mins = Math.min(Math.max(Math.round(+patch.mins / 15) * 15 || 30, 15), 12 * 60);
    meta.mins = mins;
    if (meta.plan) {
      meta.plan.mins = mins;
      meta.goal = new Date(Date.parse(meta.plan.start) + mins * 60e3).toISOString();
    }
  }
  store.save(state);
  const body = {};
  if (typeof patch.title === 'string' && patch.title.trim()) body.title = patch.title.trim().slice(0, 1024);
  if (typeof patch.notes === 'string') body.notes = patch.notes.slice(0, 8000);
  if (Object.keys(body).length && client && state.google.listId) await client.patch(state.google.listId, id, body).catch(() => {});
  await resync();
  return snapshot();
});

// Duplicate a task n times (same title, notes, date, length and repeat; not
// placed on the calendar). Copies go right after the original.
ipcMain.handle('task:duplicate', async (_e, id, raw) => {
  const n = Math.min(Math.max(Math.round(+raw) || 1, 1), 20);
  const t = today.open.find((x) => x.id === id);
  if (!t || !client || !state.google.listId) return { error: 'Task not found.' };
  const m = state.taskMeta['g:' + id] || {};
  let previous = id;
  try {
    for (let i = 0; i < n; i++) {
      const c = await client.insert(state.google.listId, { title: t.title, notes: t.notes || undefined, due: t.due ? t.due + 'T00:00:00.000Z' : undefined }, previous);
      previous = c.id;
      const meta = {};
      if (m.mins) meta.mins = m.mins;
      if (m.repeat) meta.repeat = m.repeat;
      if (Object.keys(meta).length) state.taskMeta['g:' + c.id] = meta;
    }
    store.save(state);
    await resync();
    return { ok: true };
  } catch (e) {
    return { error: e.message };
  }
});

// One-off breaks placed in Setup. plan null = remove.
ipcMain.handle('break:set', (_e, id, plan) => {
  const keep = Date.now() - 14 * 86400e3;
  state.breaks = state.breaks.filter((b) => Date.parse(b.start) > keep && b.id !== id);
  if (plan && !Number.isNaN(Date.parse(plan.start))) {
    const mins = Math.min(Math.max(Math.round(+plan.mins / 15) * 15 || 15, 15), 4 * 60);
    state.breaks.push({ id: id || 'b' + Date.now().toString(36), start: new Date(plan.start).toISOString(), mins });
  }
  store.save(state);
  push();
  return snapshot();
});

// Setup: place a task at a time on a day for a number of minutes. Its
// Google date becomes that day and its goal the planned end, so Now, Map
// and the web view all follow the plan. null = take it off the calendar.
ipcMain.handle('plan:set', async (_e, id, plan) => {
  const key = 'g:' + id;
  const meta = (state.taskMeta[key] = { ...(state.taskMeta[key] || {}) });
  if (plan && !Number.isNaN(Date.parse(plan.start))) {
    const start = new Date(plan.start);
    const mins = Math.min(Math.max(Math.round(+plan.mins / 15) * 15 || 30, 15), 12 * 60);
    meta.plan = { start: start.toISOString(), mins };
    meta.goal = new Date(start.getTime() + mins * 60e3).toISOString();
    store.save(state);
    push();
    if (client && state.google.listId)
      await client.patch(state.google.listId, id, { due: localDate(start) + 'T00:00:00.000Z' }).catch(() => {});
  } else {
    delete meta.plan;
    delete meta.goal;
    store.save(state);
  }
  await resync();
  return snapshot();
});

// Click on an empty spot in the Planner: a new task, already planned there.
ipcMain.handle('plan:add', async (_e, rawTitle, plan) => {
  const title = String(rawTitle || '').trim().slice(0, 1024);
  if (!title || !plan || Number.isNaN(Date.parse(plan.start)) || !client || !state.google.listId) return snapshot();
  const start = new Date(plan.start);
  const mins = Math.min(Math.max(Math.round(+plan.mins / 15) * 15 || 30, 15), 12 * 60);
  try {
    const last = today.open[today.open.length - 1];
    const t = await client.insert(state.google.listId, { title, due: localDate(start) + 'T00:00:00.000Z' }, last && last.id);
    state.taskMeta['g:' + t.id] = { plan: { start: start.toISOString(), mins }, goal: new Date(start.getTime() + mins * 60e3).toISOString() };
    store.save(state);
  } catch {}
  await resync();
  return snapshot();
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
    if (m && m.goal && Date.parse(m.goal) >= base) {
      m.goal = new Date(Date.parse(m.goal) + ms).toISOString();
      if (m.plan) m.plan.start = new Date(Date.parse(m.plan.start) + ms).toISOString(); // planned blocks move too
    }
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

// Forgot to press Start: count the idle stretch just before it as this task.
ipcMain.handle('idle:claim', () => {
  const cur = state.current;
  if (!cur || isHold(cur)) return snapshot();
  const since = Date.parse(cur.since);
  const idle = [...state.sessions].reverse().find((s) => s.key === 'idle' && Math.abs(Date.parse(s.end) - since) < 5000);
  if (idle && tracker.convertSession(idle, cur)) state.current.since = idle.start;
  store.save(state);
  push();
  return snapshot();
});

ipcMain.handle('web:setup', async (_e, raw) => {
  const token = String(raw || '').trim();
  if (token) state.web.token = store.makeSecret(token);
  if (!state.web.token) return { error: 'Paste a GitHub token first.' };
  await publishWeb();
  return state.web.error ? { error: state.web.error } : { ok: true, url: VIEW_BASE + '#' + state.web.gistId };
});

ipcMain.handle('web:off', () => {
  state.web = { token: null, gistId: null, publishedAt: null, error: null };
  store.save(state);
  push();
  return snapshot();
});

ipcMain.handle('web:open', () => state.web.gistId && shell.openExternal(VIEW_BASE + '#' + state.web.gistId));

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
  else if (op === 'convert' && payload.key) ok = tracker.convertSession(id, payload);
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
      // Later: off today. Clears its date and any planned time.
      await client.clearDue(listId, id);
      const m = state.taskMeta['g:' + id];
      if (m) delete m.plan, delete m.goal;
      store.save(state);
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
  for (const k of ['plannerBlurClose', 'shortcuts', 'remindBlocks', 'remindOver', 'colorTime'])
    if (k in patch) state.settings[k] = !!patch[k];
  if ('settingsMode' in patch) state.settings.settingsMode = patch.settingsMode === 'modal' ? 'modal' : 'inline';
  if ('appMode' in patch) state.settings.appMode = patch.appMode === 'light' ? 'light' : 'full';
  for (const k of ['cornerToday', 'cornerWeek'])
    if (k in patch) state.settings[k] = ['tl', 'tr', 'bl', 'br'].includes(patch[k]) ? patch[k] : 'off';
  if ('autoPlan' in patch) {
    const a = patch.autoPlan || {};
    state.settings.autoPlan = {
      mode: ['off', 'startEnd', 'every', 'times'].includes(a.mode) ? a.mode : 'startEnd',
      every: [2, 3, 4].includes(+a.every) ? +a.every : 3,
      times: (Array.isArray(a.times) ? a.times : []).filter((x) => /^\d{2}:\d{2}$/.test(x)).slice(0, 6),
    };
  }
  if ('appMode' in patch || 'shortcuts' in patch) applyShortcuts();
  if ('setupMode' in patch) state.settings.setupMode = patch.setupMode === 'inline' ? 'inline' : 'modal';
  if ('dayStructure' in patch) state.settings.dayStructure = cleanStructure(patch.dayStructure);
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
  tracker.idleOff = beforeWorkday(); // set before recover opens a session
  tracker.recover();
  makeClient();
  createWindow();
  sync();
  setupUpdates();
  watchCorners();
  applyShortcuts();
  app.on('will-quit', () => globalShortcut.unregisterAll());

  setInterval(sync, SYNC_MS);

  // Heartbeat keeps crash recovery accurate. After N minutes (Settings) with no
  // input you're "away": task time stops and idle time runs instead,
  // back-dated to when input stopped.
  setInterval(() => {
    const idle = powerMonitor.getSystemIdleTime();
    const awayAfter = (state.settings.awayMinutes || 10) * 60;
    if (idle >= awayAfter && !tracker.away) tracker.setAway(true, new Date(Date.now() - idle * 1000).toISOString());
    else if (idle < awayAfter && tracker.away) tracker.setAway(false);
    tracker.setIdleOff(beforeWorkday());
    tracker.heartbeat();
    if (tracker.away && update.status === 'ready' && !check) installUpdate();
    checkDue();
    checkReminders();
    checkAutoPlan();
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

app.on('before-quit', () => ((quitting = true), tracker && tracker.pause('quit')));

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
