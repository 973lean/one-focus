const api = window.oneFocus;
const $ = (id) => document.getElementById(id);
const appEl = $('app');

let S = null; // latest state from the main process
let view = 'now';
let logRange = 'today';
let logData = null;

// ---------- formatting ----------

const timeFmt = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
const dateFmt = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
const dayFmt = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
const hm = (iso) => timeFmt.format(new Date(iso));

function dur(ms) {
  const m = Math.max(0, Math.floor(ms / 60000));
  if (m < 60) return m + 'm';
  return Math.floor(m / 60) + 'h ' + String(m % 60).padStart(2, '0') + 'm';
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

// ---------- views ----------

function setView(name) {
  view = name;
  appEl.dataset.view = name;
  for (const id of ['now', 'log', 'today', 'settings']) $('view-' + id).hidden = id !== name;
  document.querySelectorAll('.menu__item').forEach((b) => b.setAttribute('aria-current', String(b.dataset.view === name)));
  api.setView(name);
  if (name === 'log') loadLog();
  render();
}

document.querySelectorAll('button[data-view]').forEach((b) =>
  b.addEventListener('click', () => setView(view === b.dataset.view && b.dataset.view !== 'now' ? 'now' : b.dataset.view))
);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && view !== 'now' && !e.target.matches('input')) setView('now');
});

// Window controls and hover state.
api.onHover((inside) => document.body.classList.toggle('is-hover', inside));
document.querySelectorAll('.controls__btn').forEach((btn) =>
  btn.addEventListener('click', () => api.windowAction(btn.dataset.action))
);

// ---------- Now ----------

const clockEl = $('clock');
const taskEl = $('task');
const inputEl = $('task-input');
const metaEl = $('meta');
const doneEl = $('done');
let editing = false;

function tick() {
  const now = new Date();
  const parts = timeFmt.formatToParts(now);
  const period = parts.find((x) => x.type === 'dayPeriod');
  clockEl.textContent = parts.filter((x) => x.type !== 'dayPeriod').map((x) => x.value).join('').trim();
  if (period) clockEl.append(el('span', 'clock__period', period.value));
  clockEl.dateTime = now.toISOString();
  $('date').textContent = dateFmt.format(now);
  renderMeta();
}

function renderMeta() {
  const cur = S && S.current;
  if (!cur) return (metaEl.textContent = '');
  const parts = [];
  if (S.settings.showSince) parts.push(hm(cur.since));
  if (S.settings.showElapsed) parts.push(dur(S.tracked + (S.open ? Date.now() - Date.parse(S.open.start) : 0)));
  metaEl.textContent = parts.join(' · ');
}

function renderNow() {
  if (editing || !S) return;
  const cur = S.current;
  if (cur) {
    taskEl.textContent = cur.title;
    taskEl.classList.remove('is-empty');
  } else {
    taskEl.textContent = S.connected ? (S.today.error ? 'Can’t reach Google Tasks' : 'Your list is empty') : 'What are you doing?';
    taskEl.classList.add('is-empty');
  }
  taskEl.title = S.connected ? 'Open today’s list' : 'Click to set your focus';
  doneEl.hidden = !(S.connected && cur && cur.googleId);
  renderMeta();
}

function startEditing() {
  editing = true;
  inputEl.value = S && S.current ? S.current.title : '';
  taskEl.hidden = metaEl.hidden = doneEl.hidden = true;
  inputEl.hidden = false;
  inputEl.focus();
  inputEl.select();
}

function stopEditing() {
  editing = false;
  inputEl.hidden = true;
  taskEl.hidden = metaEl.hidden = false;
  renderNow();
}

taskEl.addEventListener('click', () => (S && S.connected ? setView('today') : startEditing()));
taskEl.addEventListener('keydown', (e) => e.key === 'Enter' && taskEl.click());
inputEl.addEventListener('keydown', async (e) => {
  if (e.key === 'Escape') return stopEditing();
  if (e.key !== 'Enter') return;
  const text = inputEl.value.trim();
  if (text && (!S.current || text !== S.current.title)) S = await api.manualSet(text);
  stopEditing();
});
inputEl.addEventListener('blur', () => editing && stopEditing());

doneEl.addEventListener('click', async () => {
  if (!S.current || !S.current.googleId) return;
  doneEl.disabled = true;
  await api.task('complete', S.current.googleId);
  doneEl.disabled = false;
});

// ---------- Log ----------

function rangeStart(range) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  if (range === 'week') d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // Monday
  else if (range === 'month') d.setDate(1);
  else if (range === 'all') return 0;
  return d.getTime();
}

async function loadLog() {
  logData = await api.getLog();
  renderLog();
}

function renderLog() {
  if (!logData) return;
  const from = rangeStart(logRange);
  const now = Date.now();
  const all = logData.sessions.slice();
  if (logData.open) all.push({ ...logData.open, end: null });

  const sessions = [];
  for (const s of all) {
    const a = Math.max(Date.parse(s.start), from);
    const b = s.end ? Date.parse(s.end) : now;
    if (b > a) sessions.push({ ...s, a, b, ms: b - a, live: !s.end });
  }
  const total = sessions.reduce((n, s) => n + s.ms, 0);
  const done = logData.completions.filter((c) => Date.parse(c.at) >= from).length;

  document.querySelectorAll('.tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.range === logRange)));
  $('log-total').textContent = dur(total);
  const n = sessions.length;
  $('log-meta').textContent = `${done} done · ${n} session${n === 1 ? '' : 's'}`;

  // Sessions, newest first, grouped by day.
  const list = $('log-sessions');
  list.replaceChildren();
  if (!sessions.length) list.append(el('div', 'empty', 'No sessions in this period.'));
  // Time tracked per day, shown on the right of each date.
  const perDay = new Map();
  for (const s of sessions) {
    const day = dayFmt.format(new Date(s.a));
    perDay.set(day, (perDay.get(day) || 0) + s.ms);
  }
  let lastDay = '';
  for (const s of sessions.sort((x, y) => y.a - x.a).slice(0, 300)) {
    const day = dayFmt.format(new Date(s.a));
    if (day !== lastDay) {
      const head = el('div', 'day');
      head.append(el('span', null, day), el('span', 'day__total', dur(perDay.get(day))));
      list.append(head);
    }
    lastDay = day;
    const row = el('div', 'sess' + (s.live ? ' is-live' : ''));
    row.append(
      el('span', 'w', `${hm(s.a)}–${s.live ? 'now' : hm(s.b)}`),
      el('span', 't', s.title),
      el('span', 'd', dur(s.ms))
    );
    list.append(row);
  }
}

document.querySelectorAll('.tab').forEach((t) =>
  t.addEventListener('click', () => {
    logRange = t.dataset.range;
    renderLog();
  })
);

// ---------- Today ----------

let renaming = false;

function taskRow(t, { current, done }) {
  const li = el('li', 'row' + (current ? ' is-current' : '') + (done ? ' is-done' : ''));
  const check = el('button', 'check');
  check.setAttribute('aria-label', done ? 'Mark not done' : 'Mark done');
  const title = el('span', 't', t.title);
  title.tabIndex = 0;
  li.append(check, title);
  if (current) li.append(el('span', 'tag', 'NOW'));

  const run = async (action, value) => {
    li.classList.add('is-busy');
    const r = await api.task(action, t.id, value);
    li.classList.remove('is-busy');
    if (r && r.error) $('today-status').textContent = r.error;
  };
  check.addEventListener('click', () => run(done ? 'reopen' : 'complete'));

  if (!done) {
    const acts = el('div', 'acts');
    if (!current) {
      const focus = el('button', 'act', 'Focus');
      focus.title = 'Move to the top so it becomes the current task';
      focus.addEventListener('click', () => run('focus'));
      acts.append(focus);
    }
    const del = el('button', 'act', 'Delete');
    del.addEventListener('click', () => run('delete'));
    acts.append(del);
    li.append(acts);

    const rename = () => {
      renaming = true;
      const input = el('input', 'edit');
      input.type = 'text';
      input.value = t.title;
      title.replaceWith(input);
      input.focus();
      input.select();
      const finish = async (save) => {
        if (!renaming) return;
        renaming = false;
        const v = input.value.trim();
        input.replaceWith(title);
        if (save && v && v !== t.title) {
          title.textContent = v;
          await run('rename', v);
        }
      };
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') finish(true);
        if (e.key === 'Escape') finish(false);
      });
      input.addEventListener('blur', () => finish(true));
    };
    title.addEventListener('click', rename);
    title.addEventListener('keydown', (e) => e.key === 'Enter' && rename());
  }
  return li;
}

function renderToday() {
  if (!S || renaming) return;
  $('today-off').hidden = S.connected;
  $('today-on').hidden = !S.connected;
  if (!S.connected) return;
  const { open, done, syncedAt, error } = S.today;

  const openEl = $('today-open');
  openEl.replaceChildren(...open.map((t, i) => taskRow(t, { current: i === 0 })));
  if (!open.length) openEl.append(el('li', 'empty', 'Nothing left. Add a task below.'));
  $('today-open-title').textContent = `Up next · ${open.length}`;

  const doneEl2 = $('today-done');
  doneEl2.replaceChildren(...done.map((t) => taskRow(t, { done: true })));
  $('today-done-title').hidden = !done.length;

  $('today-status').textContent = error || (syncedAt ? `List “${S.settings.listName}” · synced ${hm(syncedAt)}` : 'Syncing…');
}

$('today-add').addEventListener('keydown', async (e) => {
  if (e.key !== 'Enter') return;
  const input = e.target;
  const v = input.value.trim();
  if (!v) return;
  input.disabled = true;
  const r = await api.task('add', null, v);
  input.disabled = false;
  if (r && r.error) $('today-status').textContent = r.error;
  else input.value = '';
  input.focus();
});

// ---------- Settings ----------

const fields = { 's-client-id': 'clientId', 's-client-secret': 'clientSecret', 's-list': 'listName' };
const toggles = { 's-since': 'showSince', 's-elapsed': 'showElapsed', 's-top': 'alwaysOnTop' };

for (const [id, key] of Object.entries(fields))
  $(id).addEventListener('change', async (e) => (S = await api.updateSettings({ [key]: e.target.value })) && render());
for (const [id, key] of Object.entries(toggles))
  $(id).addEventListener('change', async (e) => (S = await api.updateSettings({ [key]: e.target.checked })) && render());

$('g-connect').addEventListener('click', async () => {
  // Make sure typed-but-not-blurred values are saved first.
  const patch = {};
  for (const [id, key] of Object.entries(fields)) patch[key] = $(id).value;
  S = await api.updateSettings(patch);
  $('g-connect').disabled = true;
  $('g-msg').textContent = 'Finish signing in in your browser…';
  const r = await api.connect();
  $('g-connect').disabled = false;
  $('g-msg').textContent = r.error || 'Connected.';
});

$('g-disconnect').addEventListener('click', async () => {
  S = await api.disconnect();
  $('g-msg').textContent = 'Disconnected.';
  render();
});

function renderSettings() {
  if (!S) return;
  const s = S.settings;
  for (const [id, key] of Object.entries(fields)) if (document.activeElement !== $(id)) $(id).value = s[key] || '';
  for (const [id, key] of Object.entries(toggles)) $(id).checked = !!s[key];
  $('g-setup').hidden = S.connected;
  $('g-connect').hidden = S.connected;
  $('g-disconnect').hidden = !S.connected;
  $('g-status').textContent = S.connected
    ? S.today.error || `Connected. One Focus shows the first unfinished task in “${s.listName}”.`
    : 'Not connected. One Focus will use one Google Tasks list and create it if it doesn’t exist.';
}

// ---------- boot ----------

function render() {
  renderNow();
  if (view === 'today') renderToday();
  if (view === 'settings') renderSettings();
}

api.onState((s) => {
  S = s;
  render();
  if (view === 'log') loadLog();
});

api.getState().then((s) => {
  S = s;
  setView('now');
  tick();
  setInterval(tick, 1000);
  setInterval(() => view === 'log' && renderLog(), 30e3);
});
