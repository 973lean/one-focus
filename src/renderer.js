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
api.onZone((zone) => {
  document.body.classList.toggle('near-menu', zone === 'menu');
  document.body.classList.toggle('near-controls', zone === 'controls');
});
document.querySelectorAll('.controls__btn').forEach((btn) =>
  btn.addEventListener('click', () => api.windowAction(btn.dataset.action))
);

// ---------- Now ----------

const clockEl = $('clock');
const taskEl = $('task');
const inputEl = $('task-input');
const metaEl = $('meta');
const metaText = $('meta-text');
const ringEl = $('ring');
const startEl = $('start');
const doneEl = $('done');
const holdEl = $('hold');
const goalEl = $('goal');
const backEl = $('back');
const confirmEl = $('confirm');
const eodDoneEl = $('eod-done');
const eodTomorrowEl = $('eod-tomorrow');
const isHold = (t) => !!(t && t.key && t.key.startsWith('hold:'));
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
  maybeJolt();
  maybeGoalJolt();
}

const live = () => (S.open ? Date.now() - Date.parse(S.open.start) : 0);

// Running: start time · time on task. Idle: how long nothing has run.
function renderMeta() {
  if (!S) return;
  ringEl.hidden = true;
  $('ring-pct').textContent = '';
  metaEl.title = '';
  if (wrap) return (metaText.textContent = 'Done · ' + dur(wrap.ms));
  if (S.check && S.current) {
    const on = dur(Date.now() - Date.parse(S.current.since));
    return (metaText.textContent = S.check === 'eod' ? 'End of day · wrap up? ' + on : 'Still on this? ' + on);
  }
  if (isHold(S.current)) return (metaText.textContent = dur(S.open && S.open.key === S.current.key ? live() : 0));
  const cur = S.current;
  if (!cur) {
    const g = S.next && goalOf('g:' + S.next.id);
    metaText.textContent = [S.open && S.open.key === 'idle' ? 'Idle ' + dur(live()) : '', g ? 'by ' + hm(g) : ''].filter(Boolean).join(' · ');
    return;
  }
  const parts = [];
  if (S.settings.showSince) parts.push(hm(cur.since));
  if (S.settings.showElapsed) parts.push(dur(S.tracked + (S.open && S.open.key === cur.key ? live() : 0)));
  const g = goalOf(cur.key);
  const mode = S.settings.goalDisplay || 'ring';
  const left = g ? Date.parse(g) - Date.now() : 0;
  if (g && mode === 'text') parts.push(left >= 0 ? dur(left) + ' left' : dur(-left) + ' over');
  metaText.textContent = parts.join(' · ');
  if (g) metaEl.title = `Goal ${hm(g)} · ${left >= 0 ? dur(left) + ' left' : dur(-left) + ' over'}`;
  if (g && mode !== 'text') {
    // Share of the time from starting the task to its goal that has passed.
    const span = Date.parse(g) - Date.parse(cur.since);
    const pct = span > 0 ? Math.round(((Date.now() - Date.parse(cur.since)) / span) * 100) : 100;
    $('ring-fill').style.strokeDasharray = `${Math.min(Math.max(pct, 0), 100)} 100`;
    ringEl.classList.toggle('is-over', pct >= 100);
    $('ring-pct').textContent = mode === 'ringPct' ? `(${pct}%)` : '';
    ringEl.hidden = false;
  }
}

function renderNow() {
  if (editing || !S) return;
  const cur = S.current;
  const next = S.connected ? S.next : null;
  const hold = isHold(cur);
  for (const p of [startEl, doneEl, holdEl, goalEl, backEl, confirmEl, eodDoneEl, eodTomorrowEl]) p.hidden = true;
  taskEl.classList.toggle('is-finished', !!wrap);
  taskEl.classList.toggle('is-hold', hold);
  if (wrap) {
    taskEl.textContent = wrap.title;
    taskEl.classList.remove('is-queued', 'is-empty');
    return renderMeta();
  }
  taskEl.classList.toggle('is-queued', !cur && !!next);
  taskEl.classList.toggle('is-empty', !cur && !next);
  if (hold) taskEl.textContent = 'Hold: ' + cur.title;
  else if (cur) taskEl.textContent = cur.title;
  else if (next) taskEl.textContent = next.title;
  else
    taskEl.textContent = !S.connected
      ? 'What are you doing?'
      : S.today.error
      ? 'Can’t reach Google Tasks'
      : S.today.open.length
      ? 'Nothing scheduled today'
      : 'Your list is empty';
  taskEl.title = S.connected ? 'Open today’s list' : 'Click to type what you’re doing';
  if (holdpick || picking) return renderMeta();
  if (S.check === 'still') confirmEl.hidden = false;
  else if (S.check === 'eod') {
    eodDoneEl.hidden = !(cur && cur.googleId);
    eodTomorrowEl.hidden = false;
  } else if (hold) {
    backEl.hidden = false;
    backEl.textContent = S.held ? 'Back to: ' + S.held.title : 'End hold';
    backEl.title = backEl.textContent;
    backEl.classList.add('is-back');
  } else {
    startEl.hidden = !(!cur && next);
    doneEl.hidden = !(cur && cur.googleId);
    holdEl.hidden = !(cur || next);
    goalEl.hidden = !(cur || next);
    goalEl.classList.toggle('is-on', !!goalOf(goalKey()));
  }
  renderMeta();
}

function startEditing() {
  editing = true;
  inputEl.value = S && S.current ? S.current.title : '';
  taskEl.hidden = metaEl.hidden = startEl.hidden = doneEl.hidden = holdEl.hidden = goalEl.hidden = true;
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

async function busy(btn, fn) {
  btn.disabled = true;
  try {
    await fn();
  } finally {
    btn.disabled = false;
  }
}
startEl.addEventListener('click', () => busy(startEl, () => api.start()));
backEl.addEventListener('click', () => busy(backEl, async () => (S = await api.endHold()) && render()));
confirmEl.addEventListener('click', () => busy(confirmEl, async () => (S = await api.answerCheck('confirm')) && render()));
eodDoneEl.addEventListener('click', () => busy(eodDoneEl, async () => (S = await api.answerCheck('done')) && render()));
eodTomorrowEl.addEventListener('click', () => busy(eodTomorrowEl, async () => (S = await api.answerCheck('tomorrow')) && render()));

// ---------- Hold: pick what pulled you away (3 recent + search) ----------

const holdpickEl = $('holdpick');
const holdChipsEl = $('hold-chips');
const holdSearchEl = $('hold-search');
let holdpick = false;

function openHoldpick() {
  holdpick = true;
  holdSearchEl.value = '';
  renderHoldChips();
  holdpickEl.hidden = false;
  renderNow();
  holdSearchEl.focus();
}
function closeHoldpick() {
  holdpick = false;
  holdpickEl.hidden = true;
  renderNow();
}
function renderHoldChips() {
  const q = holdSearchEl.value.trim().toLowerCase();
  const all = S.holdNames || [];
  const list = (q ? all.filter((c) => c.toLowerCase().includes(q)) : all).slice(0, 3);
  holdChipsEl.replaceChildren(
    ...list.map((name) => {
      const b = el('button', 'chip', name);
      b.addEventListener('mousedown', (e) => e.preventDefault()); // keep focus so the picker stays open
      b.addEventListener('click', () => startHold(name));
      return b;
    })
  );
}
async function startHold(name) {
  closeHoldpick();
  S = await api.hold(name);
  render();
}
holdEl.addEventListener('click', openHoldpick);
holdSearchEl.addEventListener('input', renderHoldChips);
holdSearchEl.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') return closeHoldpick();
  if (e.key !== 'Enter') return;
  const q = holdSearchEl.value.trim();
  if (!q) return;
  const all = S.holdNames || [];
  startHold(all.find((c) => c.toLowerCase() === q.toLowerCase()) || all.find((c) => c.toLowerCase().includes(q.toLowerCase())) || q);
});
holdSearchEl.addEventListener('blur', () => holdpick && closeHoldpick());
doneEl.addEventListener('click', () =>
  busy(doneEl, async () => {
    const cur = S.current;
    if (!cur || !cur.googleId) return;
    const ms = S.tracked + (S.open && S.open.key === cur.key ? Date.now() - Date.parse(S.open.start) : 0);
    openWrap(cur, ms);
    await api.task('complete', cur.googleId);
  })
);

// ---------- After Done: category + rating (both optional) ----------

const wrapEl = $('wrap');
const chipsEl = $('wrap-chips');
const searchEl = $('wrap-search');
const starEls = [...document.querySelectorAll('#wrap-stars button')];
let wrap = null; // { key, title, ms, category, rating, timer }

function openWrap(task, ms) {
  const { askCategory, askRating } = S.settings;
  if (!askCategory && !askRating) return;
  wrap = { key: task.key, title: task.title, ms, category: null, rating: null, timer: null };
  $('wrap-cats').hidden = !askCategory;
  $('wrap-stars').hidden = !askRating;
  searchEl.value = '';
  renderChips();
  paintStars(0);
  wrapEl.hidden = false;
  touchWrap();
  renderNow();
}

function closeWrap() {
  if (!wrap) return;
  clearTimeout(wrap.timer);
  wrap = null;
  wrapEl.hidden = true;
  renderNow();
}

// Closes on its own after 20s without input, or once everything asked is answered.
function touchWrap() {
  clearTimeout(wrap.timer);
  const answered = (!S.settings.askCategory || wrap.category) && (!S.settings.askRating || wrap.rating);
  wrap.timer = setTimeout(closeWrap, answered ? 700 : 20000);
}

function renderChips() {
  const q = searchEl.value.trim().toLowerCase();
  const all = S.categories || [];
  const list = (q ? all.filter((c) => c.toLowerCase().includes(q)) : all).slice(0, 3);
  chipsEl.replaceChildren(
    ...list.map((name) => {
      const b = el('button', 'chip' + (wrap && wrap.category === name ? ' is-on' : ''), name);
      b.title = name;
      b.addEventListener('click', () => pickCategory(name));
      return b;
    })
  );
}

async function pickCategory(name) {
  if (!wrap || !name) return;
  wrap.category = name;
  S = await api.setMeta(wrap.key, { category: name });
  searchEl.value = '';
  renderChips();
  touchWrap();
}

searchEl.addEventListener('input', () => {
  renderChips();
  if (wrap) touchWrap();
});
searchEl.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') return closeWrap();
  if (e.key !== 'Enter') return;
  const q = searchEl.value.trim();
  if (!q) return;
  const hit = (S.categories || []).find((c) => c.toLowerCase() === q.toLowerCase())
    || (S.categories || []).find((c) => c.toLowerCase().includes(q.toLowerCase()));
  pickCategory(hit || q);
});

function paintStars(n) {
  starEls.forEach((b, i) => b.classList.toggle('is-on', i < n));
}
starEls.forEach((b, i) => {
  b.addEventListener('mouseenter', () => paintStars(i + 1));
  b.addEventListener('mouseleave', () => paintStars(wrap ? wrap.rating || 0 : 0));
  b.addEventListener('click', async () => {
    if (!wrap) return;
    wrap.rating = i + 1;
    paintStars(wrap.rating);
    S = await api.setMeta(wrap.key, { rating: wrap.rating });
    touchWrap();
  });
});
document.addEventListener('keydown', (e) => e.key === 'Escape' && wrap && view === 'now' && closeWrap());

// ---------- Goal: finish this task by a time, picked on a day timeline ----------

const goalOf = (key) => (S && S.goals && key && S.goals[key]) || null;
// The running task, or the queued one if nothing runs.
const goalKey = () => (S.current && !isHold(S.current) ? S.current.key : S.next ? 'g:' + S.next.id : null);

const tlEl = $('timeline');
const tlBar = $('tl-bar');
const tlTip = $('tl-tip');
const tlHover = $('tl-hover');
const tlGoal = $('tl-goal');
const STEP = 15 * 60e3;
let picking = false;
let range = null; // { from, to } in ms

// From now (rounded down to 15 min) to midnight, or at least 4 hours.
function tlRange() {
  const from = Math.floor(Date.now() / STEP) * STEP;
  const midnight = new Date();
  midnight.setHours(24, 0, 0, 0);
  return { from, to: Math.max(midnight.getTime(), from + 4 * 3600e3) };
}
const tlTimeAt = (x) => {
  const w = tlBar.clientWidth;
  const t = range.from + (Math.min(Math.max(x, 0), w) / w) * (range.to - range.from);
  return Math.max(Math.round(t / STEP) * STEP, range.from + STEP);
};
const tlX = (t) => ((t - range.from) / (range.to - range.from)) * tlBar.clientWidth;

function openTimeline() {
  if (!goalKey()) return;
  picking = true;
  range = tlRange();
  tlEl.hidden = false;
  // Faint tick at each hour.
  const ticks = $('tl-ticks');
  ticks.replaceChildren();
  const h = new Date(range.from);
  h.setMinutes(60, 0, 0);
  for (let t = h.getTime(); t < range.to; t += 3600e3) {
    const s = el('span');
    s.style.left = tlX(t) + 'px';
    ticks.append(s);
  }
  $('tl-end').textContent = hm(range.to);
  const g = goalOf(goalKey());
  tlGoal.hidden = !g || Date.parse(g) < range.from || Date.parse(g) > range.to;
  if (g) tlGoal.style.left = tlX(Date.parse(g)) + 'px';
  $('tl-clear').hidden = !g;
  renderNow();
}
function closeTimeline() {
  picking = false;
  tlEl.hidden = true;
  tlTip.hidden = tlHover.hidden = true;
  renderNow();
}

tlBar.addEventListener('mousemove', (e) => {
  const t = tlTimeAt(e.clientX - tlBar.getBoundingClientRect().left);
  const x = tlX(t);
  tlHover.hidden = tlTip.hidden = false;
  tlHover.style.left = x + 'px';
  tlTip.style.left = x + 'px';
  tlTip.textContent = `${hm(t)} · in ${dur(t - Date.now())}`;
});
tlBar.addEventListener('mouseleave', () => (tlHover.hidden = tlTip.hidden = true));
tlBar.addEventListener('click', async (e) => {
  const t = tlTimeAt(e.clientX - tlBar.getBoundingClientRect().left);
  const key = goalKey();
  closeTimeline();
  if (key) S = await api.setMeta(key, { goal: new Date(t).toISOString() });
  render();
});
$('tl-clear').addEventListener('click', async () => {
  const key = goalKey();
  closeTimeline();
  if (key) S = await api.setMeta(key, { goal: null });
  render();
});
goalEl.addEventListener('click', () => (picking ? closeTimeline() : openTimeline()));
document.addEventListener('keydown', (e) => e.key === 'Escape' && picking && closeTimeline());
document.addEventListener('mousedown', (e) => picking && !tlEl.contains(e.target) && e.target !== goalEl && !goalEl.contains(e.target) && closeTimeline());

// One jolt when the running task reaches its goal time.
let goalJolted = null;
function maybeGoalJolt() {
  const g = S && S.current && goalOf(S.current.key);
  if (!g || Date.now() < Date.parse(g)) return;
  const id = S.current.key + g;
  if (goalJolted === id) return;
  goalJolted = id;
  if (Date.now() - Date.parse(g) < 60e3) jolt();
}

// ---------- Jolt ----------

let lastJolt = Date.now();
let joltEvery = null;
function maybeJolt() {
  const min = S && S.settings.joltMinutes;
  if (min !== joltEvery) (joltEvery = min), (lastJolt = Date.now());
  if (!min || Date.now() - lastJolt < min * 60000) return;
  lastJolt = Date.now();
  jolt();
}
function jolt() {
  for (const e of [clockEl, taskEl]) e.classList.add('jolt');
  setTimeout(() => {
    for (const e of [clockEl, taskEl]) e.classList.remove('jolt');
  }, 300);
}

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

  const sessions = []; // task sessions (counted as tracked)
  const idle = [];
  const holds = [];
  for (const s of all) {
    const a = Math.max(Date.parse(s.start), from);
    const b = s.end ? Date.parse(s.end) : now;
    if (b <= a) continue;
    const x = { ...s, a, b, ms: b - a, live: !s.end };
    (s.key === 'idle' ? idle : s.key.startsWith('hold:') ? holds : sessions).push(x);
  }
  const total = sessions.reduce((n, s) => n + s.ms, 0);
  const holdTotal = holds.reduce((n, s) => n + s.ms, 0);

  // By category: time, and average rating of rated tasks in the period.
  const meta = logData.taskMeta || {};
  const cats = new Map();
  for (const s of sessions) {
    const c = meta[s.key] && meta[s.key].category;
    if (!c) continue;
    const g = cats.get(c) || { ms: 0, keys: new Set() };
    g.ms += s.ms;
    g.keys.add(s.key);
    cats.set(c, g);
  }
  const catEl = $('log-cats');
  catEl.replaceChildren();
  for (const [name, g] of [...cats].sort((a, b) => b[1].ms - a[1].ms)) {
    const rated = [...g.keys].map((k) => meta[k].rating).filter(Boolean);
    const avg = rated.length ? '★ ' + (rated.reduce((a, b) => a + b, 0) / rated.length).toFixed(1) : '';
    const li = el('li');
    li.append(el('span', 't', name), el('span', 'r', avg), el('span', 'd', dur(g.ms)));
    catEl.append(li);
  }
  $('log-cat-title').hidden = catEl.hidden = !cats.size;
  const idleTotal = idle.reduce((n, s) => n + s.ms, 0);
  const done = logData.completions.filter((c) => Date.parse(c.at) >= from).length;

  document.querySelectorAll('#log-tabs .tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.range === logRange)));
  $('log-total').textContent = dur(total);
  const n = sessions.length;
  $('log-meta').textContent = `idle ${dur(idleTotal)} · hold ${dur(holdTotal)} · ${done} done · ${n} session${n === 1 ? '' : 's'}`;

  // Sessions, newest first, grouped by day.
  const list = $('log-sessions');
  list.replaceChildren();
  if (!sessions.length && !holds.length) list.append(el('div', 'empty', 'No sessions in this period.'));
  // Time tracked per day, shown on the right of each date.
  const perDay = new Map();
  const idleDay = new Map();
  for (const s of sessions) {
    const day = dayFmt.format(new Date(s.a));
    perDay.set(day, (perDay.get(day) || 0) + s.ms);
  }
  for (const s of idle) {
    const day = dayFmt.format(new Date(s.a));
    idleDay.set(day, (idleDay.get(day) || 0) + s.ms);
  }
  const holdDay = new Map();
  for (const s of holds) {
    const day = dayFmt.format(new Date(s.a));
    holdDay.set(day, (holdDay.get(day) || 0) + s.ms);
  }
  let lastDay = '';
  for (const s of [...sessions, ...holds].sort((x, y) => y.a - x.a).slice(0, 300)) {
    const day = dayFmt.format(new Date(s.a));
    if (day !== lastDay) {
      const head = el('div', 'day');
      const right = el('span');
      if (idleDay.get(day)) right.append(el('span', 'day__idle', 'idle ' + dur(idleDay.get(day))));
      if (holdDay.get(day)) right.append(el('span', 'day__idle', 'hold ' + dur(holdDay.get(day))));
      right.append(el('span', 'day__total', dur(perDay.get(day) || 0)));
      head.append(el('span', null, day), right);
      list.append(head);
    }
    lastDay = day;
    const hold = s.key.startsWith('hold:');
    const row = el('div', 'sess' + (s.live ? ' is-live' : '') + (hold ? ' is-hold' : ''));
    row.append(
      el('span', 'w', `${hm(s.a)}–${s.live ? 'now' : hm(s.b)}`),
      el('span', 't', hold ? 'Hold: ' + s.title : s.title),
      el('span', 'd', dur(s.ms))
    );
    list.append(row);
    if (!s.live) row.addEventListener('click', () => toggleEditor(row, s));
  }
}

document.querySelectorAll('#log-tabs .tab').forEach((t) =>
  t.addEventListener('click', () => {
    logRange = t.dataset.range;
    renderLog();
  })
);

// ---------- Log: fix a session (times, split into a Hold, delete) ----------

let editorEl = null;
const hhmm = (iso) => {
  const d = new Date(iso);
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
};
// Same calendar day as `iso`, at time "HH:MM".
const atTime = (iso, t) => {
  const d = new Date(iso);
  const [h, m] = t.split(':').map(Number);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
};

function toggleEditor(row, s) {
  const wasThis = editorEl && editorEl.previousSibling === row;
  if (editorEl) editorEl.remove();
  editorEl = null;
  if (wasThis) return;
  const id = { key: s.key, start: s.start };
  const timeInput = (iso) => {
    const i = el('input');
    i.type = 'time';
    i.value = hhmm(iso);
    return i;
  };
  const start = timeInput(s.start);
  const end = timeInput(s.end);
  const splitAt = timeInput(new Date((Date.parse(s.start) + Date.parse(s.end)) / 2).toISOString());
  const splitName = el('input');
  splitName.type = 'text';
  splitName.placeholder = 'Meeting';
  const save = el('button', 'act', 'Save');
  const del = el('button', 'act', 'Delete');
  const split = el('button', 'act', 'Split');
  const msg = el('span', 'status');
  const after = async (r) => {
    if (r && r.ok) {
      editorEl = null;
      await loadLog();
    } else msg.textContent = 'Check the times.';
  };
  save.addEventListener('click', async () =>
    after(await api.editSession('edit', id, { start: atTime(s.start, start.value), end: atTime(s.end, end.value) }))
  );
  del.addEventListener('click', async () => after(await api.editSession('delete', id)));
  split.addEventListener('click', async () =>
    after(await api.editSession('split', id, { at: atTime(s.start, splitAt.value), name: splitName.value.trim() || 'Meeting' }))
  );
  const box = el('div', 'edit-sess');
  box.append(start, el('span', null, '–'), end, save, del, el('span', 'gap'), el('span', null, 'From'), splitAt, el('span', null, 'it was'), splitName, split, msg);
  row.after(box);
  editorEl = box;
}

// ---------- Today ----------

let renaming = false;

// Today = scheduled for today or overdue (Google's task date).
const scheduled = (t) => !!(t.due && S && t.due <= S.todayDate);
let todayTab = 'today';

function taskRow(t, { current, next, done, allView }) {
  const li = el('li', 'row' + (current ? ' is-current' : '') + (done ? ' is-done' : ''));
  const check = el('button', 'check');
  check.setAttribute('aria-label', done ? 'Mark not done' : 'Mark done');
  const title = el('span', 't', t.title);
  title.tabIndex = 0;
  li.append(check, title);
  if (current) li.append(el('span', 'tag', 'NOW'));
  else if (next) li.append(el('span', 'tag', 'NEXT'));
  else if (!done && t.due && t.due < S.todayDate) li.append(el('span', 'tag', 'OVERDUE'));
  else if (allView && scheduled(t)) li.append(el('span', 'tag', 'TODAY'));

  const run = async (action, value) => {
    li.classList.add('is-busy');
    const r = await api.task(action, t.id, value);
    li.classList.remove('is-busy');
    if (r && r.error) $('today-status').textContent = r.error;
  };
  check.addEventListener('click', () => run(done ? 'reopen' : 'complete'));

  if (!done) {
    const acts = el('div', 'acts');
    if (allView && !scheduled(t)) {
      const add = el('button', 'act', 'Today');
      add.title = 'Schedule for today';
      add.addEventListener('click', () => run('schedule'));
      acts.append(add);
    }
    if (!allView && !current) {
      const later = el('button', 'act', 'Later');
      later.title = 'Take off today (stays in All)';
      later.addEventListener('click', () => run('unschedule'));
      acts.append(later);
    }
    if (!current) {
      const start = el('button', 'act', 'Start');
      start.title = 'Start this task now';
      start.addEventListener('click', async () => {
        li.classList.add('is-busy');
        const r = await api.start(t.id);
        li.classList.remove('is-busy');
        if (r && r.error) $('today-status').textContent = r.error;
      });
      acts.append(start);
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
  const { done, syncedAt, error } = S.today;
  const allView = todayTab === 'all';
  const open = allView ? S.today.open : S.today.open.filter(scheduled);
  document.querySelectorAll('#today-tabs .tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.list === todayTab)));

  const openEl = $('today-open');
  const runningId = S.current && S.current.googleId;
  const nextId = S.next && S.next.id;
  openEl.replaceChildren(...open.map((t) => taskRow(t, { current: t.id === runningId, next: t.id === nextId, allView })));
  if (!open.length)
    openEl.append(el('li', 'empty', allView ? 'Your list is empty. Add a task below.' : 'Nothing scheduled today. Add one below, or pick from All.'));
  enableDrag(openEl, open);
  $('today-open-title').textContent = allView ? `All tasks · ${open.length}` : `Up next · ${open.length}`;
  $('today-add').placeholder = allView ? 'Add to the list (not today) · Shift+Enter to start now' : 'Add a task for today · Shift+Enter to start now';

  const doneEl2 = $('today-done');
  doneEl2.replaceChildren(...done.map((t) => taskRow(t, { done: true })));
  $('today-done-title').hidden = doneEl2.hidden = allView || !done.length;

  $('today-status').textContent = error || (syncedAt ? `List “${S.settings.listName}” · synced ${hm(syncedAt)}` : 'Syncing…');
}

document.querySelectorAll('#today-tabs .tab').forEach((t) =>
  t.addEventListener('click', () => {
    todayTab = t.dataset.list;
    renderToday();
  })
);

// Drag a row to reorder; the new order is saved to Google.
function enableDrag(listEl, open) {
  let dragId = null;
  const rows = [...listEl.querySelectorAll('.row')];
  rows.forEach((li, i) => {
    li.draggable = true;
    li.dataset.id = open[i].id;
    li.addEventListener('dragstart', (e) => {
      dragId = li.dataset.id;
      li.classList.add('is-dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    li.addEventListener('dragend', () => {
      dragId = null;
      li.classList.remove('is-dragging');
      rows.forEach((r) => r.classList.remove('drop-before', 'drop-after'));
    });
    li.addEventListener('dragover', (e) => {
      if (!dragId || dragId === li.dataset.id) return;
      e.preventDefault();
      const before = e.offsetY < li.offsetHeight / 2;
      li.classList.toggle('drop-before', before);
      li.classList.toggle('drop-after', !before);
    });
    li.addEventListener('dragleave', () => li.classList.remove('drop-before', 'drop-after'));
    li.addEventListener('drop', async (e) => {
      e.preventDefault();
      const before = li.classList.contains('drop-before');
      li.classList.remove('drop-before', 'drop-after');
      const moving = dragId;
      if (!moving || moving === li.dataset.id) return;
      // Google wants the task it should come after (none = top).
      const ids = open.map((t) => t.id).filter((x) => x !== moving);
      const at = ids.indexOf(li.dataset.id) + (before ? 0 : 1);
      const previous = at > 0 ? ids[at - 1] : null;
      $('today-status').textContent = 'Saving order…';
      const r = await api.task('move', moving, previous);
      if (r && r.error) $('today-status').textContent = r.error;
    });
  });
}

$('today-add').addEventListener('keydown', async (e) => {
  if (e.key !== 'Enter') return;
  const input = e.target;
  const v = input.value.trim();
  if (!v) return;
  input.disabled = true;
  const r = await api.task(e.shiftKey ? 'addStart' : 'add', todayTab === 'today' ? 'today' : null, v);
  input.disabled = false;
  if (r && r.error) $('today-status').textContent = r.error;
  else input.value = '';
  input.focus();
});

// ---------- Settings ----------

const fields = { 's-client-id': 'clientId', 's-client-secret': 'clientSecret', 's-list': 'listName' };
const toggles = {
  's-since': 'showSince',
  's-elapsed': 'showElapsed',
  's-ask-cat': 'askCategory',
  's-ask-rating': 'askRating',
  's-top': 'alwaysOnTop',
  's-login': 'launchAtLogin',
};
for (const [sel, key] of [['#s-check', 'checkMinutes'], ['#s-away', 'awayMinutes']])
  document.querySelectorAll(sel + ' .tab').forEach((t) =>
    t.addEventListener('click', async () => (S = await api.updateSettings({ [key]: +t.dataset.min })) && render())
  );
$('s-eod').addEventListener('change', async (e) => (S = await api.updateSettings({ endOfDay: e.target.value })) && render());
$('s-eod-off').addEventListener('click', async () => (S = await api.updateSettings({ endOfDay: '' })) && render());
document.querySelectorAll('#s-goal-display .tab').forEach((t) =>
  t.addEventListener('click', async () => (S = await api.updateSettings({ goalDisplay: t.dataset.v })) && render())
);
document.querySelectorAll('#s-jolt .tab').forEach((t) =>
  t.addEventListener('click', async () => (S = await api.updateSettings({ joltMinutes: +t.dataset.min })) && render())
);

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

$('app-update').addEventListener('click', () => api.installUpdate());
$('app-check').addEventListener('click', () => api.checkUpdate());

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
  document.querySelectorAll('#s-jolt .tab').forEach((t) => t.setAttribute('aria-selected', String(+t.dataset.min === (s.joltMinutes || 0))));
  document.querySelectorAll('#s-goal-display .tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.v === (s.goalDisplay || 'ring'))));
  document.querySelectorAll('#s-check .tab').forEach((t) => t.setAttribute('aria-selected', String(+t.dataset.min === (s.checkMinutes ?? 120))));
  document.querySelectorAll('#s-away .tab').forEach((t) => t.setAttribute('aria-selected', String(+t.dataset.min === (s.awayMinutes || 10))));
  if (document.activeElement !== $('s-eod')) $('s-eod').value = s.endOfDay || '';
  $('s-eod-off').hidden = !s.endOfDay;
  const u = (S.app && S.app.update) || {};
  const words = {
    dev: 'running from source',
    checking: 'checking for updates…',
    current: 'up to date',
    downloading: `downloading ${u.version || 'update'}…`,
    ready: `${u.version} ready, installs on restart`,
    error: 'couldn’t check for updates',
  };
  $('app-version').textContent = `Version ${S.app ? S.app.version : ''}${words[u.status] ? ' · ' + words[u.status] : ''}`;
  $('app-update').hidden = u.status !== 'ready';
  $('app-check').hidden = u.status === 'dev' || u.status === 'ready';
  $('app-check').classList.toggle('is-spinning', u.status === 'checking' || u.status === 'downloading');
  $('g-setup').hidden = S.connected;
  $('g-connect').hidden = S.connected;
  $('g-disconnect').hidden = !S.connected;
  $('g-status').textContent = S.connected
    ? S.today.error || `Connected. The first unfinished task in “${s.listName}” waits for you to start it.`
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
