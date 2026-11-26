const { app, BrowserWindow, ipcMain, screen, powerMonitor, shell, desktopCapturer, globalShortcut, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const store = require('./store');
const Tracker = require('./tracker');
const google = require('./google');
const web = require('./web');
const planning = require('./plan');
const Backlog = require('./backlog');
const Claude = require('./claude');
const http = require('http');
const crypto = require('crypto');

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
    notes: state.notes || '',
    backlog: backlogSnap(),
    claude: { on: !!(state.claude && state.claude.on), port: claudePort, error: claudeError, desktop: claudeDesktopOn },
    launches: launchLog,
    notesArchive: state.notesArchive || [],
    shortcutTaken,
    itemMins: Object.fromEntries(Object.entries(state.taskMeta).filter(([k, m]) => k.startsWith('i:') && m.mins).map(([k, m]) => [k.slice(2), m.mins])),
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
    if (m && (m.plan || m.repeat || m.mins || m.pinned))
      out['g:' + t.id] = { plan: m.plan || null, repeat: m.repeat || null, mins: m.mins || null, pinned: !!m.pinned, added: m.added || 0, base: m.base || null };
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
      backlog: state.backlog && state.backlog.on ? Backlog.lanes(state.backlog, today.open) : null,
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
// No idle before the workday starts (or on a day off) — unless you've already
// started something today: then you're working, and idle counts from there.
function beforeWorkday(d = new Date()) {
  const ds = state.settings.dayStructure;
  if (!ds) return false;
  if (state.current) state.workedOn = localDate(d);
  if (state.workedOn === localDate(d)) return false;
  const weekend = d.getDay() === 0 || d.getDay() === 6;
  if (weekend && !ds.weekends) return true;
  const [h, m] = ds.start.split(':').map(Number);
  return d.getHours() * 60 + d.getMinutes() < h * 60 + m;
}

function checkDue() {
  const cur = state.current;
  if (check || !cur || isHold(cur) || tracker.away || tracker.pauses.size) return;
  const eod = feat('endOfDay') && state.settings.endOfDay;
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
  if (n && feat('check') && Date.now() - from >= n * 60e3) openCheck('still');
}

// ---------- Google sync ----------

const startOfDay = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};
// Google stores a task's date as midnight UTC of that day: keep "YYYY-MM-DD".
const pick = (t) => ({ id: t.id, title: t.title.trim(), notes: t.notes || '', completed: t.completed || null, due: t.due ? t.due.slice(0, 10) : null, updated: t.updated || null });
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
    const fetchedAt = Date.now(); // tasks added after this aren't in this list yet
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
        if (m && m.repeat && m.spawned && m.spawned !== t.completed) {
          // Re-ticked after being un-ticked: the next one already exists.
          m.spawned = t.completed;
          continue;
        }
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
      // The next copy follows the pattern (m.base) if one was kept by a
      // "this one only" change; otherwise it copies this task.
      const b = m.base || {};
      const created = await client.insert(listId, { title: (b.title || t.title).trim(), notes: t.notes || undefined, due: next + 'T00:00:00.000Z' });
      const meta = { repeat: m.repeat };
      if (m.mins) meta.mins = m.mins;
      if (m.plan) {
        const old = new Date(m.plan.start);
        const [hh, mm] = b.at ? b.at.split(':').map(Number) : [old.getHours(), old.getMinutes()];
        const mins = b.mins || m.plan.mins;
        const [y, mo, d] = next.split('-').map(Number);
        const start = new Date(y, mo - 1, d, hh, mm);
        meta.plan = { start: start.toISOString(), mins };
        meta.goal = new Date(start.getTime() + mins * 60e3).toISOString();
      }
      state.taskMeta['g:' + created.id] = meta;
    }
    if (spawn.length) {
      store.save(state);
      setTimeout(() => resync(), 500);
    }

    const withItems = (t) => ({ ...pick(t), items: itemsOf[t.id] || [] });
    // Finished in the last 24 hours and not cleared: the lists show these and
    // they clear by themselves a day after they were done (Google keeps them).
    const cleared = (state.clearedDone = state.clearedDone || {});
    const dayAgo = Date.now() - 86400e3;
    for (const [id, at] of Object.entries(cleared)) if (Date.parse(at) < dayAgo - 86400e3) delete cleared[id];
    const recent = all
      .filter((t) => t.status === 'completed' && t.completed && Date.parse(t.completed) >= dayAgo && !cleared[t.id])
      .sort((a, b) => b.completed.localeCompare(a.completed));
    today = { open: open.map(withItems), done: done.map(withItems), recent: recent.map(withItems), syncedAt: new Date().toISOString(), error: null };
    // Backlog mode: new tasks join the queue, finished ones leave, auto fills slots.
    if (state.backlog && state.backlog.on) {
      state.backlog = Backlog.reconcile(state.backlog, today.open, new Date(), { since: fetchedAt });
      runLaunches();
    }

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
      : b.height - ry < 72 && rx < 260
      ? 'corner'
      : null;
    if (z !== zone) {
      zone = z;
      win.webContents.send('window:zone', zone);
    }
  }, 100);

  // Dev mode: reload the window whenever a renderer file changes.
  if (process.argv.includes('--dev')) {
    let timer;
    fs.watch(__dirname, { recursive: true }, (_event, file) => {
      if (!file || !/\.(html|css)$|^ui[\\/].+\.js$/.test(file)) return;
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
// Features you can switch off one by one (Settings → Features). On unless set false.
const FEATURES = ['planner', 'log', 'hold', 'goals', 'items', 'reminders', 'behind', 'clickCreate', 'fit', 'offHours', 'autoNow', 'jolt', 'check', 'endOfDay', 'idleClaim', 'hopOff'];
const feat = (k) => !(state.settings.features && state.settings.features[k] === false);
let quitting = false;

// Windows paints a new or re-shown window for a frame before its content:
// that's the white blink. Show it fully transparent, then fade it in.
// Windows won't let a background app take focus (a shortcut pressed while
// you're in another app would open the window behind it). Pinning it on top
// for a moment brings it in front; then it settles back.
function bringToFront(w) {
  if (!w || w.isDestroyed()) return;
  const pinned = w.isAlwaysOnTop();
  if (!pinned) w.setAlwaysOnTop(true, 'pop-up-menu');
  w.show();
  w.moveTop();
  w.focus();
  if (!pinned) setTimeout(() => !w.isDestroyed() && w.setAlwaysOnTop(false), 400);
}

function fadeIn(w, focus) {
  if (!w || w.isDestroyed()) return;
  w.setOpacity(0);
  if (focus) bringToFront(w);
  else w.showInactive();
  let o = 0;
  const step = () => {
    if (w.isDestroyed()) return;
    o = Math.min(1, o + 0.25);
    w.setOpacity(o);
    if (o < 1) setTimeout(step, 16);
  };
  setTimeout(step, 50);
}

// While the Planner is open, a backdrop sits behind it on every monitor: the
// click that closes the Planner lands on it and goes no further. Barely
// visible; a light dim on the main monitor.
let backdrops = [];
function showBackdrop() {
  if (backdrops.length || state.settings.plannerBlurClose === false) return;
  const primary = screen.getPrimaryDisplay().id;
  for (const d of screen.getAllDisplays()) {
    const b = new BrowserWindow({
      ...d.workArea,
      frame: false,
      show: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      skipTaskbar: true,
      focusable: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      webPreferences: { contextIsolation: true, nodeIntegration: false },
    });
    const tint = d.id === primary ? 'rgba(0,0,0,0.22)' : 'rgba(0,0,0,0.012)';
    const html = `<!doctype html><html><head><style>html,body{margin:0;height:100%;background:transparent}body{background:${tint};animation:a 220ms cubic-bezier(.2,0,0,1)}@keyframes a{from{opacity:0}}</style></head><body><script>addEventListener('mousedown',(e)=>{e.preventDefault();document.title='close'});addEventListener('contextmenu',(e)=>e.preventDefault())</script></body></html>`;
    b.on('page-title-updated', (e, t) => {
      e.preventDefault();
      if (t === 'close' && setupWin && !setupWin.isDestroyed()) setupWin.hide();
    });
    b.once('ready-to-show', () => {
      if (b.isDestroyed()) return;
      b.showInactive();
      if (setupWin && !setupWin.isDestroyed() && setupWin.isVisible()) setupWin.moveTop();
    });
    b.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    backdrops.push(b);
  }
}
function hideBackdrop() {
  for (const b of backdrops) if (!b.isDestroyed()) b.destroy();
  backdrops = [];
}
// Centred on the main monitor every time it opens. Set twice: Windows can
// rescale a window's position when monitors use different scaling.
function centerPlanner() {
  if (!setupWin || setupWin.isDestroyed()) return;
  const wa = screen.getPrimaryDisplay().workArea;
  const width = Math.round(Math.min(wa.width * 0.88, 1560));
  const height = Math.round(Math.min(wa.height * 0.88, 1000));
  setupWin.setBounds({ x: wa.x + Math.round((wa.width - width) / 2), y: wa.y + Math.round((wa.height - height) / 2), width, height });
}
function showPlanner() {
  centerPlanner();
  showBackdrop();
  fadeIn(setupWin, true);
  setTimeout(centerPlanner, 0);
}

function openSetupWindow(tab = 'week') {
  if ((light() || !feat('planner')) && tab !== 'settings') return;
  const inline = tab === 'settings' ? state.settings.settingsMode !== 'modal' : state.settings.setupMode === 'inline';
  if (inline) {
    bringToFront(win);
    win.webContents.send('planner:tab', tab);
    return;
  }
  if (setupWin && !setupWin.isDestroyed()) {
    setupWin.webContents.send('planner:tab', tab);
    // Kept alive while hidden, so it comes back instantly on the right tab.
    if (!setupWin.isVisible()) setTimeout(showPlanner, 30);
    else bringToFront(setupWin);
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
  setTimeout(() => setupWin && !setupWin.isDestroyed() && !setupWin.isVisible() && showPlanner(), 2500);
  // Closing only hides it (until the app quits): reopening is instant, no reload.
  setupWin.on('hide', hideBackdrop);
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
  setupWin.on('closed', () => ((setupWin = null), hideBackdrop()));
}
// Done from the Planner runs on the One Focus window, so its after-Done
// questions show where they always do.
ipcMain.on('now:action', (_e, a) => {
  if (a === 'done' && win && !win.isDestroyed()) win.webContents.send('now:action', 'done');
});
ipcMain.handle('setup:open', (_e, tab) => openSetupWindow(['today', 'tasks', 'settings'].includes(tab) ? tab : 'week'));

// A page has drawn its first frame: show its window now (no white blink).
ipcMain.on('ui:ready', (e) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  if (w && !w.isVisible()) w === setupWin ? showPlanner() : fadeIn(w, false);
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

// Global shortcuts: a modifier pair you pick plus one letter each (Settings →
// Planner). Electron can't do two-key sequences, so it's always mod + key.
// Shift alone only goes with F-keys (Shift+letter would fire whenever you type a capital).
const SHORTCUT_MODS = { ctrlAlt: 'CommandOrControl+Alt', ctrlShift: 'CommandOrControl+Shift', altShift: 'Alt+Shift', shift: 'Shift' };
const F_DEFAULT = { today: 'F8', week: 'F9', settings: 'F10' };
let shortcutTaken = []; // accelerators another app already owns
// A key that couldn't be registered (another app had it, or Windows wasn't
// ready at login) is tried again a few times, then on every unlock/resume.
let shortcutRetry = null;
let shortcutTries = 0;
function retryShortcuts() {
  clearTimeout(shortcutRetry);
  if (!shortcutTaken.length || shortcutTries >= 6) return;
  shortcutRetry = setTimeout(() => {
    shortcutTries++;
    applyShortcuts(true);
  }, [3, 10, 30, 60, 300, 900][shortcutTries] * 1000);
}
function applyShortcuts(retrying) {
  if (!retrying) shortcutTries = 0;
  globalShortcut.unregisterAll();
  shortcutTaken = [];
  if (state.settings.shortcuts === false) return;
  const mod = SHORTCUT_MODS[state.settings.shortcutMod] || SHORTCUT_MODS.ctrlAlt;
  const keys = state.settings.shortcutMod === 'shift' ? { ...F_DEFAULT, ...(state.settings.shortcutFKeys || {}) } : { today: 'T', week: 'W', settings: 'S', ...(state.settings.shortcutKeys || {}) };
  const reg = (k, fn) => {
    const acc = `${mod}+${k}`;
    try {
      if (!globalShortcut.register(acc, fn)) shortcutTaken.push(acc);
    } catch {
      shortcutTaken.push(acc);
    }
  };
  // Settings: here or on the main monitor, as set in Settings → Mode.
  reg(keys.settings, () => openSetupWindow('settings'));
  if (!light()) {
    reg(keys.today, () => openSetupWindow('today'));
    reg(keys.week, () => openSetupWindow('week'));
  }
  if (shortcutTaken.length) retryShortcuts();
  if (retrying) push();
}

// ---------- the Planner opens itself at chosen times ----------

function autoPlanSlots(d = new Date()) {
  const ap = state.settings.autoPlan;
  if (light() || !ap || ap.mode === 'off') return [];
  const ds = state.settings.dayStructure || { start: '09:00', end: '17:30', weekends: false };
  if ((d.getDay() === 0 || d.getDay() === 6) && !ds.weekends) return [];
  const hhmm = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
  const toMin = (v) => +v.slice(0, 2) * 60 + +v.slice(3, 5);
  // Each slot has a window it can still fire in: you might sit down at 9:40
  // for a 9:00 start, or unlock after lunch. The day start holds all day.
  if (ap.mode === 'startEnd') return [{ at: ds.start, tab: 'today', until: toMin(ds.end) }, { at: ds.end, tab: 'week', until: toMin(ds.end) + 120 }];
  const withUntil = (list) => list.map((x, i) => ({ ...x, until: i + 1 < list.length ? toMin(list[i + 1].at) : toMin(x.at) + 90 }));
  if (ap.mode === 'every') {
    const out = [];
    for (let m = toMin(ds.start); m < toMin(ds.end); m += (ap.every || 3) * 60) out.push({ at: hhmm(m), tab: 'today' });
    return withUntil(out);
  }
  return withUntil([...(ap.times || [])].sort().map((at) => ({ at, tab: 'today' })));
}
function checkAutoPlan() {
  if (tracker.away || tracker.pauses.size || check || !feat('planner')) return;
  const d = new Date();
  const day = localDate(d);
  if (state.autoPlanFired.date !== day) state.autoPlanFired = { date: day, at: [] };
  const nowMin = d.getHours() * 60 + d.getMinutes();
  for (const s of autoPlanSlots(d)) {
    const m = +s.at.slice(0, 2) * 60 + +s.at.slice(3, 5);
    if (nowMin >= m && nowMin < Math.max(s.until, m + 30) && !state.autoPlanFired.at.includes(s.at)) {
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
  const style = state.settings.popupStyle || 'corner';
  const [W, H] = style === 'bar' ? [620, 52] : style === 'center' ? [440, 150] : [380, 118];
  const x = style === 'corner' ? wa.x + wa.width - W - 16 : wa.x + Math.round((wa.width - W) / 2);
  const y = style === 'corner' ? wa.y + wa.height - H - 16 : style === 'bar' ? wa.y + 14 : wa.y + Math.round((wa.height - H) / 2.4);
  const bounds = { x, y, width: W, height: H };
  r = { ...r, style };
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
      transparent: true, // rounded / pill shapes without square corners
      hasShadow: false,
      backgroundColor: '#00000000',
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
  if (light() || !feat('reminders') || reminder || check || tracker.away || tracker.pauses.size) return;
  const now = Date.now();
  const cur = state.current && !isHold(state.current) ? state.current : null;
  const cm = cur && state.taskMeta[cur.key];
  if (state.settings.remindOver !== false && cm && cm.goal && now >= Date.parse(cm.goal)) {
    const slot = Math.floor((now - Date.parse(cm.goal)) / (15 * 60e3)); // again every 15 minutes
    const id = `over:${cur.key}:${cm.goal}:${slot}`;
    if (!remindFired(id)) return setReminder({ id, kind: 'over', taskId: cur.googleId, title: cur.title, goal: cm.goal, overMs: now - Date.parse(cm.goal), added: cm.added || 0, planMins: cm.plan ? cm.plan.mins : 0 });
  }
  if (state.settings.remindBlocks !== false)
    for (const t of today.open) {
      const p = state.taskMeta['g:' + t.id] && state.taskMeta['g:' + t.id].plan;
      if (!p || (cur && cur.googleId === t.id)) continue;
      const start = Date.parse(p.start);
      const id = `block:${t.id}:${p.start}`;
      if (now >= start && now - start < 10 * 60e3 && !remindFired(id)) return setReminder({ id, kind: 'block', taskId: t.id, title: t.title, curTitle: cur && cur.googleId ? cur.title : null });
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
  else if ((action === 'start' || action === 'doneStart') && client) {
    // Done & start: the task you were on is finished, then the planned one begins.
    const prev = state.current;
    if (action === 'doneStart' && prev && prev.googleId && !isHold(prev) && state.google.listId)
      await client.patch(state.google.listId, prev.googleId, { status: 'completed' }).catch(() => {});
    const t = today.open.find((x) => x.id === r.taskId);
    if (t) tracker.setCurrent({ key: 'g:' + t.id, title: t.title, googleId: t.id });
    if (action === 'doneStart') await resync();
  } else if (action === 'done' && client && state.google.listId) {
    await client.patch(state.google.listId, r.taskId, { status: 'completed' }).catch(() => {});
    await resync();
  } else if (action === 'extend') extendCurrent(15);
  else if (action === 'extend30') extendCurrent(30);
  else if (action === 'wrap') extendCurrent(10);
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
    else if (action === 'mins') {
      // A time for this item: local only (Google subtasks have no duration).
      const n = Math.round(+value);
      if (n > 0 && n <= 480) state.taskMeta['i:' + itemId] = { mins: n };
      else delete state.taskMeta['i:' + itemId];
      store.save(state);
      push();
      return snapshot();
    }
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
// A repeating task changed: "one" keeps the pattern future copies are made
// from (saving it first if needed); "all" makes this task the new pattern.
ipcMain.handle('task:repeatScope', (_e, id, scope) => {
  const m = state.taskMeta['g:' + id];
  if (!m || !m.repeat) return snapshot();
  if (scope === 'all') delete m.base;
  else if (scope === 'one' && !m.base) {
    const t = today.open.find((x) => x.id === id);
    const st = m.plan ? new Date(m.plan.start) : null;
    m.base = {
      title: t ? t.title : undefined,
      at: st ? `${String(st.getHours()).padStart(2, '0')}:${String(st.getMinutes()).padStart(2, '0')}` : undefined,
      mins: m.plan ? m.plan.mins : m.mins,
    };
  }
  store.save(state);
  push();
  return snapshot();
});

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

// Split a planned task around a gap (a break, or between work blocks): it
// keeps the part before `cut`, and a same-name copy (so it counts 1/2, 2/2)
// takes the rest from `resume`. Both can then be edited on their own.
ipcMain.handle('task:split', async (_e, id, cutIso, resumeIso) => {
  const t = today.open.find((x) => x.id === id);
  const m = state.taskMeta['g:' + id];
  if (!t || !m || !m.plan || !client || !state.google.listId) return { error: 'Task not found.' };
  const start = Date.parse(m.plan.start);
  const cut = Date.parse(cutIso);
  const resume = Date.parse(resumeIso);
  const first = Math.round((cut - start) / 60e3);
  const rest = m.plan.mins - first;
  if (Number.isNaN(cut) || Number.isNaN(resume) || resume < cut || first < 5 || rest < 5) return { error: 'Nothing to split.' };
  try {
    const day = localDate(new Date(resume));
    const c = await client.insert(state.google.listId, { title: t.title, notes: t.notes || undefined, due: day + 'T00:00:00.000Z' }, id);
    const copy = { plan: { start: new Date(resume).toISOString(), mins: rest }, goal: new Date(resume + rest * 60e3).toISOString(), mins: rest };
    if (m.category) copy.category = m.category;
    state.taskMeta['g:' + c.id] = copy;
    m.plan = { ...m.plan, mins: first };
    m.goal = new Date(cut).toISOString();
    if (m.mins) m.mins = first;
    store.save(state);
    await resync();
    return { ok: true };
  } catch (e) {
    return { error: e.message };
  }
});

// ---------- Backlog mode (View): active / queued / evergreen ----------
// For the page: the backlog plus each task's group and each group's holds.
function backlogSnap() {
  const b = Backlog.normalize(state.backlog);
  const v = Backlog.lanes(b, today.open);
  const groupOf = {};
  for (const r of [...v.active, ...v.queued, ...v.evergreen]) groupOf[r.task.id] = r.group;
  return { ...b, groupOf, groupInfo: v.groups };
}
// settings: { on, auto, slots }. item: { lane, index } moves it; { turn }
// says whose turn; { ask, link, didIt } edit it. Every change re-runs the
// auto fill and goes out to the page and the web view.
function backlogChanged() {
  runLaunches();
  store.save(state);
  push(); // also schedules the web view
  return snapshot();
}
ipcMain.handle('backlog:settings', (_e, patch = {}) => {
  let b = Backlog.normalize(state.backlog);
  if ('on' in patch) b.on = !!patch.on;
  if ('auto' in patch) b.auto = !!patch.auto;
  if ('show' in patch) b.show = patch.show === 'details' ? 'details' : 'titles';
  if ('dayTab' in patch) b.dayTab = ['today', 'tomorrow', 'later'].includes(patch.dayTab) ? patch.dayTab : 'all';
  if (typeof patch.projectTab === 'string') b.projectTab = patch.projectTab.slice(0, 40);
  if (typeof patch.pushTo === 'string') b = Backlog.pushDays(b, patch.pushTo, new Date(), patch.group || null);
  if (b.on && today.syncedAt) b = Backlog.reconcile(b, today.open, new Date(), { prune: false });
  if (Array.isArray(patch.groups)) b = Backlog.setGroups(b, patch.groups);
  if ('slots' in patch) b = Backlog.setSlots(b, patch.slots, new Date(), patch.group || null);
  state.backlog = b;
  return backlogChanged();
});
ipcMain.handle('backlog:item', (_e, id, patch = {}) => {
  let b = Backlog.normalize(state.backlog);
  if (typeof patch.lane === 'string') b = Backlog.move(b, id, patch.lane, Number.isInteger(patch.index) ? patch.index : null, new Date(), typeof patch.group === 'string' ? patch.group : null);
  if (typeof patch.turn === 'string') b = Backlog.setTurn(b, id, patch.turn);
  if ('ask' in patch || 'link' in patch || 'deadline' in patch || 'day' in patch || 'prompt' in patch || 'when' in patch || patch.didIt) b = Backlog.patchItem(b, id, patch);
  if (b.auto) b = Backlog.fill(b); // a trigger may already hold
  state.backlog = b;
  return backlogChanged();
});
// A new task shows right away; the full sync with Google follows on its own.
function showAdded(t) {
  if (!t || today.open.some((x) => x.id === t.id)) return;
  today.open = [...today.open, { ...pick(t), items: [] }];
  if (state.backlog && state.backlog.on) state.backlog = Backlog.ensure(state.backlog, t);
  push();
}
// View: a task added inside a group's section belongs to that group (no picker).
ipcMain.handle('backlog:add', async (_e, title, group) => {
  const t0 = String(title || '').trim().slice(0, 1024);
  if (!t0 || !client || !state.google.listId) return { error: 'Connect Google Tasks in Settings first.' };
  try {
    const last = today.open[today.open.length - 1];
    const t = await client.insert(state.google.listId, { title: t0 }, last && last.id);
    let b = Backlog.ensure(Backlog.normalize(state.backlog), { id: t.id, title: t.title });
    b = Backlog.move(b, t.id, 'queued', null, new Date(), typeof group === 'string' ? group : null);
    state.backlog = b;
    showAdded(t);
    backlogChanged();
    resync(); // in its own time
    return snapshot();
  } catch (e) {
    return { error: e.message };
  }
});
ipcMain.handle('link:open', (_e, u) => {
  if (typeof u === 'string' && /^https?:\/\/\S+$/i.test(u)) shell.openExternal(u);
});

// ---------- Claude: an MCP server on 127.0.0.1 (src/claude.js) ----------
// Claude Desktop starts mcp-bridge.js (this exe in node mode) which forwards
// to here; Claude Code connects over HTTP. A random token guards it, and
// requests from web pages (an Origin header) or other hosts are refused.
let claudeServer = null;
let claudePort = null;
let claudeError = null;
let claudeDesktopOn = false; // One Focus is in a Claude Desktop config (checked on start and after adding)
const claudeDir = () => path.join(app.getPath('userData'), 'claude');
const claudeApiFile = () => path.join(claudeDir(), 'api.json');

function claudeView() {
  const b = Backlog.normalize(state.backlog);
  return { on: b.on, auto: b.auto, ...Backlog.lanes(b, today.open), open: today.open };
}

// Put a task in the lane/turn Claude asked for. Active only if a slot is free.
// claim(): a task from Claude never starts a session for itself, and takes a
// slot held for a session started for its group.
function claudeApply(id, { status, request, link, group, top, due, day, prompt, when, added = false }) {
  let b = Backlog.normalize(state.backlog);
  if (!b.items[id]) return;
  const now = new Date();
  const g = typeof group === 'string' && group.trim() ? b.groups.find((x) => x.name.toLowerCase() === group.trim().toLowerCase() || x.id === group.trim()) : null;
  const gid = g ? g.id : null;
  const wasActive = b.items[id].lane === 'active';
  if (gid) b = Backlog.move(b, id, b.items[id].lane, null, now, gid); // regroup (an active one only if the group has room)
  if (added) b = Backlog.claim(b, id, now);
  const lane = b.items[id].lane;
  const wantActive = status === 'running' || status === 'needs_you' || (request && status !== 'queued' && status !== 'evergreen') || (wasActive && !status);
  if (wantActive && lane !== 'active') b = Backlog.move(b, id, 'active', null, now);
  else if ((status === 'queued' || status === 'evergreen') && lane !== status) b = Backlog.move(b, id, status, status === 'queued' && top ? 0 : null, now);
  else if (top && lane === 'queued') b = Backlog.move(b, id, 'queued', 0, now);
  if (b.items[id] && b.items[id].lane === 'active') {
    if (status === 'running') b = Backlog.setTurn(b, id, 'agent', now);
    if (status === 'needs_you' && !request) b = Backlog.setTurn(b, id, 'you', now);
  }
  if (typeof request === 'string') b = Backlog.patchItem(b, id, { ask: request }, now);
  if (typeof link === 'string') b = Backlog.patchItem(b, id, { link }, now);
  if (typeof due === 'string') b = Backlog.patchItem(b, id, { deadline: due }, now);
  if (typeof day === 'string') b = Backlog.patchItem(b, id, { day }, now);
  if (typeof prompt === 'string') b = Backlog.patchItem(b, id, { prompt }, now);
  if (typeof when === 'string') b = Backlog.patchItem(b, id, { when }, now);
  b = Backlog.patchItem(b, id, { noLaunch: true }, now); // Claude is already on it
  state.backlog = b;
}

const claudeDeps = () => ({
  version: app.getVersion(),
  view: claudeView,
  add: async ({ title, status, request, link, top, group, due, day, details, prompt, when }) => {
    if (!client || !state.google.listId) throw new Error('Google Tasks is not connected in One Focus.');
    // While the insert is out, a sync may see the new task first: no session
    // starts until it's marked as Claude's (claim), so it never gets its own.
    claudeAdding++;
    let t;
    try {
      const last = today.open[today.open.length - 1];
      t = await client.insert(state.google.listId, { title, ...(details ? { notes: String(details).slice(0, 8000) } : {}) }, last && last.id);
      showAdded(t);
      state.backlog = Backlog.ensure({ ...Backlog.normalize(state.backlog), on: true }, { id: t.id, title: t.title });
      claudeApply(t.id, { status, request, link, group, top, due, day, prompt, when, added: true });
    } finally {
      claudeAdding--;
    }
    runLaunches();
    store.save(state);
    push();
    await resync(); // so the reply (and one_focus_backlog) shows it
    return { id: t.id, title: t.title };
  },
  update: async (t, { status, request, link, title, group, due, day, details, prompt, when }) => {
    if (!client || !state.google.listId) throw new Error('Google Tasks is not connected in One Focus.');
    const body = {};
    if (typeof title === 'string' && title.trim()) body.title = title.trim().slice(0, 1024);
    if (typeof details === 'string') body.notes = details.slice(0, 8000);
    if (Object.keys(body).length) {
      await client.patch(state.google.listId, t.id, body);
      today.open = today.open.map((x) => (x.id === t.id ? { ...x, ...(body.title ? { title: body.title } : {}), ...('notes' in body ? { notes: body.notes } : {}) } : x));
    }
    if (status === 'done') {
      await client.patch(state.google.listId, t.id, { status: 'completed' });
      return resync();
    }
    if (!state.backlog || !state.backlog.on) state.backlog = { ...Backlog.normalize(state.backlog), on: true };
    if (today.syncedAt) state.backlog = Backlog.reconcile(state.backlog, today.open, new Date(), { prune: false });
    claudeApply(t.id, { status, request, link, group, due, day, prompt, when });
    store.save(state);
    push();
    if (title || typeof details === 'string') resync();
  },
});

function startClaude() {
  stopClaude();
  claudeDesktopOn = claudeDesktopPaths().some(hasOurServer);
  const c = (state.claude = { port: 47815, ...(state.claude || {}), on: true });
  if (!c.token) c.token = crypto.randomBytes(24).toString('hex');
  claudeError = null;
  // The bridge (and the tool list it gives while the app is closed) must sit
  // outside the asar: copy both next to api.json.
  try {
    fs.mkdirSync(claudeDir(), { recursive: true });
    for (const f of ['mcp-bridge.js', 'claude.js']) fs.writeFileSync(path.join(claudeDir(), f), fs.readFileSync(path.join(__dirname, f)));
  } catch (e) {
    claudeError = 'Could not write the Claude bridge: ' + e.message;
  }
  const server = http.createServer((req, res) => {
    const send = (code, body) => {
      res.writeHead(code, body ? { 'Content-Type': 'application/json' } : {});
      res.end(body ? JSON.stringify(body) : undefined);
    };
    const host = String(req.headers.host || '');
    if (req.url.split('?')[0] !== '/mcp') return send(404);
    if (req.headers.origin || !/^(127\.0\.0\.1|localhost):\d+$/.test(host)) return send(403); // never from a web page
    const auth = Buffer.from(String(req.headers.authorization || ''));
    const want = Buffer.from('Bearer ' + c.token);
    if (auth.length !== want.length || !crypto.timingSafeEqual(auth, want)) return send(401);
    if (req.method !== 'POST') return send(405);
    let raw = '';
    req.on('data', (d) => {
      raw += d;
      if (raw.length > 1e6) req.destroy();
    });
    req.on('end', async () => {
      try {
        let msg;
        try {
          msg = JSON.parse(raw);
        } catch {
          return send(400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
        }
        const deps = claudeDeps();
        const replies = (await Promise.all((Array.isArray(msg) ? msg : [msg]).map((m) => Claude.handle(m, deps)))).filter(Boolean);
        if (!replies.length) return send(202);
        send(200, Array.isArray(msg) ? replies : replies[0]);
      } catch (e) {
        if (!res.headersSent) send(500, { jsonrpc: '2.0', id: null, error: { code: -32603, message: e.message } });
      }
    });
  });
  claudeServer = server; // set now, so turning it off before it's listening still closes it
  // Taken port: try the next ones for now, but keep the saved one, so the
  // Claude Code command (which has it) works again next time.
  let tries = 0;
  let port = c.port;
  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE' && tries++ < 10) return server.listen(++port, '127.0.0.1');
    claudeError = 'Could not start: ' + e.message;
    push();
  });
  server.listen(port, '127.0.0.1', () => {
    if (claudeServer !== server) return server.close();
    claudePort = port;
    try {
      fs.writeFileSync(claudeApiFile(), JSON.stringify({ port, token: c.token }));
    } catch (e) {
      claudeError = 'Could not write api.json: ' + e.message;
    }
    store.save(state);
    push();
  });
}
function stopClaude() {
  if (claudeServer) claudeServer.close();
  claudeServer = null;
  claudePort = null;
}

// Claude Desktop keeps its MCP servers in claude_desktop_config.json (the
// Store version keeps it under its package folder).
function claudeDesktopPaths() {
  if (process.platform !== 'win32') return [path.join(app.getPath('appData'), 'Claude', 'claude_desktop_config.json')];
  const out = [path.join(app.getPath('appData'), 'Claude', 'claude_desktop_config.json')];
  const pk = path.join(process.env.LOCALAPPDATA || '', 'Packages');
  try {
    for (const d of fs.readdirSync(pk)) if (/^Claude_/i.test(d)) out.push(path.join(pk, d, 'LocalCache', 'Roaming', 'Claude', 'claude_desktop_config.json'));
  } catch {}
  return out;
}
function hasOurServer(file) {
  try {
    return !!JSON.parse(fs.readFileSync(file, 'utf8')).mcpServers['one-focus'];
  } catch {
    return false;
  }
}
const claudeDesktopEntry = () => ({ command: process.execPath, args: [path.join(claudeDir(), 'mcp-bridge.js'), claudeApiFile()], env: { ELECTRON_RUN_AS_NODE: '1' } });

ipcMain.handle('claude:set', (_e, on) => {
  if (on) startClaude();
  else {
    stopClaude();
    state.claude = { ...(state.claude || {}), on: false };
    store.save(state);
  }
  push();
  return snapshot();
});
// Add One Focus to Claude Desktop (every config found; the usual one if none).
ipcMain.handle('claude:desktop', () => {
  const found = claudeDesktopPaths().filter((f) => fs.existsSync(path.dirname(f)));
  const targets = found.length ? found : [claudeDesktopPaths()[0]];
  try {
    for (const f of targets) {
      let cfg = {};
      try {
        cfg = JSON.parse(fs.readFileSync(f, 'utf8'));
      } catch (e) {
        if (fs.existsSync(f) && fs.readFileSync(f, 'utf8').trim()) throw new Error(`${f} isn't valid JSON, so it was left alone.`);
      }
      cfg.mcpServers = { ...(cfg.mcpServers || {}), 'one-focus': claudeDesktopEntry() };
      fs.mkdirSync(path.dirname(f), { recursive: true });
      if (fs.existsSync(f)) fs.copyFileSync(f, f + '.bak');
      fs.writeFileSync(f, JSON.stringify(cfg, null, 2));
    }
    claudeDesktopOn = true;
    return { ok: true, snap: snapshot() };
  } catch (e) {
    return { error: e.message };
  }
});
// Claude Code: one command to paste in a terminal (copied for you).
ipcMain.handle('claude:code', () => {
  const c = state.claude || {};
  if (!claudePort || !c.token) return { error: 'Turn on the Claude connection first.' };
  const cmd = `claude mcp add --scope user --transport http one-focus http://127.0.0.1:${claudePort}/mcp --header "Authorization: Bearer ${c.token}"`;
  clipboard.writeText(cmd);
  return { ok: true };
});

// ---------- Starting Claude sessions when a slot opens (Backlog.launches) ----------
// Claude Code: a PowerShell window in the group's folder running
// `claude "<message>"` (the message goes through a file, so no quoting
// trouble). Claude chat: claude.ai/new with the message filled in.
let launchLog = []; // the last few, for Settings: { at, group, kind, title, error }
const mcpOn = () => !!(state.claude && state.claude.on && claudePort);
let claudeAdding = 0; // Claude adds in flight
function runLaunches() {
  if (!state.backlog || !state.backlog.on || claudeAdding > 0) return;
  const { backlog, todo } = Backlog.launches(state.backlog, new Date(), { mcp: mcpOn() });
  state.backlog = backlog;
  if (!todo.length) return;
  store.save(state);
  for (const l of todo) startSession(l);
}
// A start that fails gives back its held slot and its place in the cap.
function startSession(l, { test = false } = {}) {
  const msg = Backlog.message(l, !test && mcpOn());
  const entry = { at: nowIso(), group: l.group.name, kind: l.kind, how: l.how || l.group.launch, title: l.title || '' };
  const failed = (e) => {
    entry.error = e.message;
    if (l.at) state.backlog = Backlog.release(state.backlog, l.group.id, l.at, l.kind === 'task' ? l.id : null);
    store.save(state);
    push();
  };
  try {
    const how = l.how || l.group.launch;
    if (how === 'chat') shell.openExternal('https://claude.ai/new?q=' + encodeURIComponent(msg)).catch(failed);
    else if (how === 'code') startClaudeCode(l.group.dir, msg, l.kind === 'task' ? l.title : l.group.name, failed);
  } catch (e) {
    failed(e);
  }
  launchLog = [entry, ...launchLog].slice(0, 10);
  push();
}
function startClaudeCode(dirRaw, msg, label, failed) {
  const dir = dirRaw && fs.existsSync(dirRaw) ? dirRaw : null;
  if (dirRaw && !dir) throw new Error(`Folder not found: ${dirRaw}`);
  const cwd = dir || app.getPath('home');
  if (process.platform !== 'win32') throw new Error('Starting Claude Code works on Windows for now.');
  const dirP = path.join(claudeDir(), 'prompts');
  fs.mkdirSync(dirP, { recursive: true });
  for (const f of fs.readdirSync(dirP)) if (Date.now() - fs.statSync(path.join(dirP, f)).mtimeMs > 86400e3) fs.rmSync(path.join(dirP, f), { force: true });
  const file = path.join(dirP, Date.now().toString(36) + '.txt');
  // Windows PowerShell 5 drops double quotes inside arguments: use curly ones.
  fs.writeFileSync(file, msg.replace(/"([^"]*)"/g, '“$1”').replace(/"/g, '”'), 'utf8');
  const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
  const script = `$Host.UI.RawUI.WindowTitle = ${q('One Focus · ' + label)}; Set-Location -LiteralPath ${q(cwd)}; claude (Get-Content -Raw -Encoding UTF8 -LiteralPath ${q(file)})`;
  // `start` gives PowerShell its own real console (keyboard and all); the
  // script goes base64 (UTF-16LE), so paths and messages need no quoting.
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const { spawn } = require('child_process');
  const p = spawn('cmd.exe', ['/d /c start "" powershell.exe -NoExit -NoProfile -ExecutionPolicy Bypass -EncodedCommand ' + encoded], {
    cwd,
    windowsVerbatimArguments: true,
    windowsHide: true,
    stdio: 'ignore',
  });
  p.on('error', (e) => failed && failed(e));
  p.on('exit', (code) => code && failed && failed(new Error('Couldn’t open a terminal (exit ' + code + ').')));
}
// Each minute: holds that ran out give their slot back (auto fill), then any starts due.
setInterval(() => {
  if (!state || !state.backlog || !state.backlog.on) return;
  if (state.backlog.auto) state.backlog = Backlog.fill(state.backlog);
  runLaunches();
  push();
}, 60e3);

// View corner → Tidy: a Claude Code session that cleans up titles and details.
const TIDY = `Tidy up my One Focus backlog using the one_focus tools.
1. Call one_focus_backlog to see every task.
2. For each task: make the title short and specific, starting with its project ("Roblox: jump animation pass"); fix typos; keep details to at most two short lines (cut filler, keep only what's needed to act); merge nothing and delete nothing.
3. Don't change status, deadlines, groups, triggers or order.
4. Apply each change with one_focus_update_task (title, details), then list what you changed in a few lines.`;
ipcMain.handle('backlog:tidy', () => {
  if (!mcpOn()) return { error: 'Turn on Settings → Claude first.' };
  const b = Backlog.normalize(state.backlog);
  const g = b.groups.find((x) => x.launch === 'code' && x.dir) || {};
  startSession({ kind: 'empty', group: { id: 'tidy', name: 'Tidy', launch: 'code', dir: g.dir || '', emptyMsg: TIDY } }, { test: true });
  return { ok: true, last: launchLog[0] };
});

// Settings → Groups: start one now, to check the folder and the message.
ipcMain.handle('backlog:test', (_e, gid) => {
  const b = Backlog.normalize(state.backlog);
  const g = b.groups.find((x) => x.id === gid);
  if (!g) return { error: 'No such group.' };
  if (g.launch === 'off') return { error: 'Pick Claude Code or Claude chat first.' };
  const top = Backlog.lanes(b, today.open).queued.find((r) => r.group === g.id);
  if (g.emptyMsg.trim() && !top) startSession({ kind: 'empty', group: g });
  else if (top) startSession({ kind: 'task', group: g, id: top.task.id, title: top.task.title });
  else startSession({ kind: 'task', group: g, id: '', title: 'Test task from One Focus' }, { test: true });
  return { ok: true, last: launchLog[0] };
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
// More time on the running task, on purpose: its plan grows and the rest of
// today's blocks move down by the same amount (pinned ones stay). How much was
// added is kept, so the app can ask "good enough?" before it becomes a habit.
function extendCurrent(rawMins) {
  const mins = Math.min(Math.max(Math.round(+rawMins) || 0, 5), 120);
  const cur = state.current && !isHold(state.current) ? state.current : null;
  if (!cur || !cur.googleId) return;
  const m = (state.taskMeta[cur.key] = { ...(state.taskMeta[cur.key] || {}) });
  const now = Date.now();
  const oldEnd = m.goal ? Date.parse(m.goal) : now;
  const newEnd = Math.max(oldEnd, now) + mins * 60e3;
  const shift = newEnd - oldEnd;
  m.goal = new Date(newEnd).toISOString();
  if (m.plan) m.plan.mins = Math.min(12 * 60, Math.round((newEnd - Date.parse(m.plan.start)) / 60e3));
  m.added = (m.added || 0) + mins;
  const day = localDate();
  for (const t of today.open) {
    if (t.id === cur.googleId) continue;
    const tm = state.taskMeta['g:' + t.id];
    if (!tm || !tm.plan || tm.pinned) continue;
    const st = Date.parse(tm.plan.start);
    if (localDate(new Date(st)) !== day || st < oldEnd - 60e3) continue;
    tm.plan.start = new Date(st + shift).toISOString();
    tm.goal = new Date(st + shift + tm.plan.mins * 60e3).toISOString();
  }
  store.save(state);
  push();
}
// Clear finished tasks from the lists (one, or all of them). Only hides them
// here; they stay completed in Google Tasks and in the time log.
ipcMain.handle('done:clear', (_e, ids) => {
  const cleared = (state.clearedDone = state.clearedDone || {});
  const list = ids === 'all' ? (today.recent || []).map((t) => t.id) : [].concat(ids || []);
  for (const id of list) {
    const t = (today.recent || []).find((x) => x.id === id);
    cleared[id] = (t && t.completed) || new Date().toISOString();
  }
  today.recent = (today.recent || []).filter((t) => !cleared[t.id]);
  store.save(state);
  push();
  return snapshot();
});

// Notes (Settings): ideas for changes. Copy & clear puts them on the
// clipboard and keeps a dated copy in a light archive (last 30).
ipcMain.handle('notes:set', (_e, text) => {
  state.notes = String(text || '').slice(0, 20000);
  store.save(state);
  return true;
});
ipcMain.handle('notes:cut', () => {
  const text = (state.notes || '').trim();
  if (!text) return snapshot();
  clipboard.writeText(text);
  state.notesArchive = [{ at: new Date().toISOString(), text }, ...(state.notesArchive || [])].slice(0, 30);
  state.notes = '';
  store.save(state);
  push();
  return snapshot();
});

ipcMain.handle('current:extend', (_e, mins) => (extendCurrent(mins), snapshot()));

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
// Starting a task planned for later today: its whole plan moves to now (same
// length), so the Planner shows it where you are and you can push from there.
// Starting it late, before any work on it today (its slot has passed): same
// thing, so the "over" count runs from when you really began, not the old slot.
function pullPlanToNow(id) {
  const m = state.taskMeta['g:' + id];
  if (!m || !m.plan) return;
  const st = Date.parse(m.plan.start);
  if (localDate(new Date(st)) !== localDate()) return;
  const early = st > Date.now() + 5 * 60e3;
  const sod = new Date().setHours(0, 0, 0, 0);
  const workedToday = state.sessions.some((x) => x.key === 'g:' + id && Date.parse(x.end) > sod);
  const late = st < Date.now() - 5 * 60e3 && !workedToday;
  if (!early && !late) return;
  const n = new Date();
  n.setSeconds(0, 0);
  m.plan.start = n.toISOString();
  m.goal = new Date(n.getTime() + m.plan.mins * 60e3).toISOString();
  store.save(state);
}

ipcMain.handle('current:start', async (_e, id) => {
  if (!client) return { error: 'Connect Google Tasks in Settings first.' };
  const t = id ? today.open.find((x) => x.id === id) : snapshot().next;
  if (!t) return { error: 'Nothing in the list to start.' };
  pullPlanToNow(t.id);
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
      const t = await client.insert(listId, { title, ...(id === 'today' ? { due: todayDue() } : {}) }, last && last.id);
      showAdded(t);
    } else if (action === 'schedule') await client.patch(listId, id, { due: todayDue() });
    else if (action === 'unschedule') {
      // Later: off today. Clears its date and any planned time.
      await client.clearDue(listId, id);
      const m = state.taskMeta['g:' + id];
      if (m) delete m.plan, delete m.goal;
      store.save(state);
    } else if (action === 'delete') {
      await client.remove(listId, id);
      delete state.taskMeta['g:' + id]; // its plan and repeat go with it
      store.save(state);
    }
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
  // Pinned: Fit leaves this task where it is.
  if ('pinned' in patch) {
    if (patch.pinned) meta.pinned = true;
    else delete meta.pinned;
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
  if (patch.features && typeof patch.features === 'object') {
    const f = { ...(state.settings.features || {}) };
    for (const [k, v] of Object.entries(patch.features)) if (FEATURES.includes(k)) f[k] = !!v;
    state.settings.features = f;
  }
  if ('popupStyle' in patch) state.settings.popupStyle = ['corner', 'bar', 'center'].includes(patch.popupStyle) ? patch.popupStyle : 'corner';
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
  if ('shortcutMod' in patch && SHORTCUT_MODS[patch.shortcutMod]) state.settings.shortcutMod = patch.shortcutMod;
  if (patch.shortcutFKeys && typeof patch.shortcutFKeys === 'object') {
    const k = { ...F_DEFAULT, ...(state.settings.shortcutFKeys || {}) };
    for (const [name, v] of Object.entries(patch.shortcutFKeys)) {
      const key = String(v || '').trim().toUpperCase().replace(/^(\d+)$/, 'F$1');
      if (['today', 'week', 'settings'].includes(name) && /^F([1-9]|1[0-2])$/.test(key)) k[name] = key;
    }
    state.settings.shortcutFKeys = k;
  }
  if (patch.shortcutKeys && typeof patch.shortcutKeys === 'object') {
    const k = { today: 'T', week: 'W', settings: 'S', ...(state.settings.shortcutKeys || {}) };
    for (const [name, v] of Object.entries(patch.shortcutKeys)) {
      const key = String(v || '').trim().toUpperCase();
      if (['today', 'week', 'settings'].includes(name) && /^[A-Z0-9]$/.test(key)) k[name] = key;
    }
    state.settings.shortcutKeys = k;
  }
  if ('appMode' in patch || 'shortcuts' in patch || 'shortcutMod' in patch || 'shortcutKeys' in patch || 'shortcutFKeys' in patch) applyShortcuts();
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
  if (state.settings.launchAtLogin !== prev.launchAtLogin) applyLoginItem();
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

// Open at login: written to Windows' startup list on every launch (not only
// when the switch is flipped), so an update or a reinstall can't quietly drop
// it. Only for the installed app, never for a dev run.
function applyLoginItem() {
  if (!app.isPackaged) return;
  try {
    app.setLoginItemSettings({ openAtLogin: !!state.settings.launchAtLogin, path: process.execPath, args: [] });
  } catch {}
}

// One copy at a time (a login start plus a manual one would sync and start
// Claude sessions twice). A second start just brings this one forward.
if (!app.requestSingleInstanceLock()) app.quit();
else app.on('second-instance', () => win && !win.isDestroyed() && bringToFront(win));

app.whenReady().then(() => {
  if (!app.hasSingleInstanceLock()) return;
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
  if (state.claude && state.claude.on) startClaude();
  applyLoginItem();
  app.on('will-quit', () => globalShortcut.unregisterAll());

  setInterval(sync, SYNC_MS);

  // Heartbeat keeps crash recovery accurate. After N minutes (Settings) with no
  // input you're "away": task time stops and idle time runs instead,
  // back-dated to when input stopped.
  setInterval(() => {
    const idle = powerMonitor.getSystemIdleTime();
    const awayAfter = (state.settings.awayMinutes || 10) * 60;
    // A Hold is time away from the keyboard on purpose (a break, a call): it
    // keeps counting while you're idle.
    const holding = isHold(state.current);
    if (idle >= awayAfter && !tracker.away && !holding) tracker.setAway(true, new Date(Date.now() - idle * 1000).toISOString());
    else if (idle < awayAfter && tracker.away) tracker.setAway(false);
    tracker.setIdleOff(beforeWorkday());
    tracker.heartbeat();
    if (tracker.away && update.status === 'ready' && !check) installUpdate();
    checkDue();
    checkReminders();
    checkAutoPlan();
    push();
  }, HEARTBEAT_MS);

  // Locking the screen for a break doesn't stop a Hold (sleep still does).
  powerMonitor.on('lock-screen', () => (isHold(state.current) || tracker.pause('lock'), push()));
  powerMonitor.on('unlock-screen', () => (tracker.resume('lock'), sync(), setTimeout(checkAutoPlan, 4000), shortcutTaken.length && applyShortcuts()));
  powerMonitor.on('suspend', () => (tracker.pause('sleep'), push()));
  powerMonitor.on('resume', () => (tracker.resume('sleep'), sync(), setTimeout(checkAutoPlan, 4000), shortcutTaken.length && applyShortcuts()));

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => ((quitting = true), tracker && tracker.pause('quit')));

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
