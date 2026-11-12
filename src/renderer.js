const api = window.oneFocus;
const $ = (id) => document.getElementById(id);
const appEl = $('app');

let S = null; // latest state from the main process
let view = 'now';
let logRange = 'today';
let logData = null;
let logSig = '';

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

// Tasks that share a name count up in list order: "2/5". Display only.
function seriesOf(t) {
  if (!S || !S.today) return null;
  const same = S.today.open.filter((x) => x.title.trim().toLowerCase() === t.title.trim().toLowerCase());
  if (same.length < 2) return null;
  return `${same.findIndex((x) => x.id === t.id) + 1}/${same.length}`;
}
function titleWithSeries(node, t) {
  const n = t && t.id && seriesOf(t);
  if (n) node.append(el('span', 'series', n));
  return node;
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

// ---------- views ----------

// The Setup window (on the main monitor) loads this page with ?mode=setup.
const setupMode = new URLSearchParams(location.search).get('mode') === 'setup';
if (setupMode) document.body.classList.add('mode-setup');

function setView(name) {
  view = name;
  appEl.dataset.view = name;
  for (const id of ['now', 'log', 'today', 'setup', 'settings']) $('view-' + id).hidden = id !== name;
  document.querySelectorAll('.menu__item').forEach((b) => b.setAttribute('aria-current', String(b.dataset.view === name)));
  if (!setupMode) api.setView(name);
  if (name === 'log') loadLog();
  render();
  if (name === 'setup') setTimeout(scrollSetupToNow, 350);
}

document.querySelectorAll('button[data-view]').forEach((b) =>
  b.addEventListener('click', () => {
    // Setup opens as its own window on the main monitor unless set to inline.
    if (b.dataset.view === 'setup' && S && S.settings.setupMode !== 'inline') return api.openSetup('week');
    if (b.dataset.view === 'settings' && S && !setupMode && S.settings.settingsMode === 'modal') return api.openSetup('settings');
    if (b.dataset.view === 'settings' && setupMode) return setView(view === 'settings' ? 'setup' : 'settings');
    if (b.dataset.view === 'setup') planTab = 'week';
    setView(view === b.dataset.view && b.dataset.view !== 'now' ? 'now' : b.dataset.view);
  })
);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && view !== 'now' && !e.target.matches('input')) setView('now');
});

// Window controls and hover state.
api.onHover((inside) => document.body.classList.toggle('is-hover', inside));
api.onZone((zone) => {
  document.body.classList.toggle('near-menu', zone === 'menu');
  document.body.classList.toggle('near-controls', zone === 'controls');
  document.body.classList.toggle('near-gear', zone === 'gear');
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
const hopEl = $('hop');
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
  if (S && S.reminder && !$('remind').hidden) remindText();
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
    if (S.connected && !S.next && S.today.done.length && !S.today.open.some(scheduled))
      return (metaText.textContent = `${S.today.done.length} done today`);
    const g = S.next && goalOf('g:' + S.next.id);
    metaText.textContent = [S.open && S.open.key === 'idle' ? 'Idle ' + dur(live()) : '', g ? 'by ' + hm(g) : ''].filter(Boolean).join(' · ');
    return;
  }
  const parts = [];
  if (S.settings.showSince) parts.push(hm(cur.since));
  if (S.settings.showElapsed) parts.push(dur(S.tracked + (S.open && S.open.key === cur.key ? live() : 0)));
  const ot = cur.googleId && S.today.open.find((x) => x.id === cur.googleId);
  if (ot && ot.items && ot.items.length && S.settings.appMode !== 'light') parts.push(`${ot.items.filter((x) => x.done).length}/${ot.items.length} items`);
  const g = goalOf(cur.key);
  const mode = S.settings.goalDisplay || 'ring';
  const left = g ? Date.parse(g) - Date.now() : 0;
  if (g && mode === 'text') parts.push(left >= 0 ? dur(left) + ' left' : dur(Math.max(60e3, Math.ceil(-left / 60e3) * 60e3)) + ' over');
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
  for (const p of [startEl, doneEl, holdEl, goalEl, backEl, confirmEl, eodDoneEl, eodTomorrowEl, hopEl]) p.hidden = true;
  // Everything scheduled for today is done: time to hop off.
  const allDone = S.connected && !cur && !next && S.today.done.length > 0 && !S.today.open.some(scheduled) && !wrap;
  taskEl.classList.toggle('is-finished', !!wrap);
  taskEl.classList.toggle('is-hold', hold);
  if (wrap) {
    taskEl.textContent = wrap.title;
    taskEl.classList.remove('is-queued', 'is-empty');
    return renderMeta();
  }
  taskEl.classList.toggle('is-queued', !cur && !!next);
  taskEl.classList.toggle('is-empty', !cur && !next && !allDone);
  if (hold) taskEl.textContent = 'Hold: ' + cur.title;
  else if (cur) {
    taskEl.textContent = cur.title;
    titleWithSeries(taskEl, S.today.open.find((x) => x.id === cur.googleId));
  } else if (next) titleWithSeries((taskEl.textContent = next.title, taskEl), next);
  else if (allDone) taskEl.textContent = 'All done for today';
  else
    taskEl.textContent = !S.connected
      ? 'What are you doing?'
      : S.today.error
      ? 'Can’t reach Google Tasks'
      : S.today.open.length
      ? 'Nothing scheduled today'
      : 'Your list is empty';
  taskEl.title = S.connected ? 'Open today’s list' : 'Click to type what you’re doing';
  // Reminder (block starting / running over) takes the buttons' place.
  renderReminder();
  if (holdpick || picking || claim || (S.reminder && S.settings.appMode !== 'light')) return renderMeta();
  if (S.check === 'still') confirmEl.hidden = false;
  else if (S.check === 'eod') {
    eodDoneEl.hidden = !(cur && cur.googleId);
    eodTomorrowEl.hidden = false;
  } else if (hold) {
    backEl.hidden = false;
    backEl.textContent = S.held ? 'Back to: ' + S.held.title : 'End hold';
    backEl.title = backEl.textContent;
    backEl.classList.add('is-back');
  } else if (allDone) {
    hopEl.hidden = false;
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
startEl.addEventListener('click', () => busy(startEl, () => startWithClaim()));

// ---------- Forgot to press Start? Offer to count the idle stretch. ----------

let claim = null; // { timer }
async function startWithClaim(id) {
  const idleMs = S.open && S.open.key === 'idle' ? live() : 0;
  const r = await api.start(id);
  if (r && r.error) return r;
  if (idleMs >= 5 * 60e3) {
    clearTimeout(claim && claim.timer);
    claim = { timer: setTimeout(endClaim, 20000) };
    $('claim-text').textContent = `Idle ${dur(idleMs)} before this. Count it as this task?`;
    $('claim').hidden = false;
    renderNow();
  }
  return r;
}
function endClaim() {
  if (!claim) return;
  clearTimeout(claim.timer);
  claim = null;
  $('claim').hidden = true;
  renderNow();
}
$('claim-yes').addEventListener('click', async () => {
  S = await api.claimIdle();
  endClaim();
  if (view === 'log' || view === 'today') loadLog();
});
$('claim-no').addEventListener('click', endClaim);
// Hop off: open your review link (if set), then the side borders close in
// and One Focus quits.
hopEl.addEventListener('click', async () => {
  if (S.settings.reviewUrl) api.openReview();
  document.body.classList.add('closing');
  setTimeout(() => api.windowAction('quit'), 760);
});
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
  if (view === 'today' && todayTab === 'map') renderMap();
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

  // Summary (default): per day, time focused, sessions and the breaks between them.
  const mode = S.settings.logView || 'summary';
  document.querySelectorAll('#log-mode .tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.mode === mode)));
  $('log-summary').hidden = mode !== 'summary';
  $('log-sessions').hidden = $('log-sessions-title').hidden = mode !== 'sessions';
  if (mode === 'summary') renderSummary(sessions);

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
  const idleRows = idle.filter((s) => !s.live && s.ms >= 5 * 60e3);
  for (const s of [...sessions, ...holds, ...idleRows].sort((x, y) => y.a - x.a).slice(0, 300)) {
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
    const hold = s.key.startsWith('hold:') || s.key === 'idle';
    const row = el('div', 'sess' + (s.live ? ' is-live' : '') + (hold ? ' is-hold' : ''));
    row.append(
      el('span', 'w', `${hm(s.a)}–${s.live ? 'now' : hm(s.b)}`),
      el('span', 't', s.key === 'idle' ? 'Idle' : hold ? 'Hold: ' + s.title : s.title),
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

// Goals set for a given day, and whether each was finished in time.
function goalsOnDay(dayLabel) {
  const meta = (logData && logData.taskMeta) || {};
  const out = [];
  for (const [key, m] of Object.entries(meta)) {
    if (!m.goal || dayFmt.format(new Date(m.goal)) !== dayLabel) continue;
    const doneAt = logData.completions.filter((c) => c.key === key).map((c) => Date.parse(c.at)).sort()[0];
    const at = Date.parse(m.goal);
    out.push({ key, hit: doneAt != null && doneAt <= at, missed: (doneAt == null && at < Date.now()) || (doneAt != null && doneAt > at) });
  }
  return out;
}

function renderSummary(sessions) {
  const days = new Map();
  for (const s of sessions) {
    const day = dayFmt.format(new Date(s.a));
    if (!days.has(day)) days.set(day, []);
    days.get(day).push(s);
  }
  const out = $('log-summary');
  out.replaceChildren();
  if (!days.size) out.append(el('div', 'empty', 'Nothing logged in this period.'));
  const ordered = [...days].sort((x, y) => y[1][0].a - x[1][0].a);
  for (const [day, list] of ordered) {
    // Stretches with less than 2 minutes between them count as one session.
    const parts = [];
    for (const s of list.sort((x, y) => x.a - y.a)) {
      const last = parts[parts.length - 1];
      if (last && s.a - last.b < 2 * 60e3) last.b = Math.max(last.b, s.b), (last.ms += s.ms);
      else parts.push({ a: s.a, b: s.b, ms: s.ms });
    }
    const total = parts.reduce((n, p) => n + p.ms, 0);
    const gaps = [];
    for (let i = 1; i < parts.length; i++) {
      const g = parts[i].a - parts[i - 1].b;
      if (g >= 5 * 60e3) gaps.push(g);
    }
    const longest = Math.max(...parts.map((p) => p.ms));
    const first = parts[0].a;
    const last = parts[parts.length - 1].b;
    const spanMs = last - first;
    // Line 1: when the day ran and how much of it was focused. Line 2: rhythm and outcomes.
    const line1 = [`${hm(first)}–${hm(last)}`, spanMs > 0 ? `${Math.round((total / spanMs) * 100)}% focused` : null, `${parts.length} session${parts.length === 1 ? '' : 's'}`, `avg ${dur(total / parts.length)}`];
    const line2 = [`longest ${dur(longest)}`];
    if (gaps.length) line2.push(`${gaps.length} break${gaps.length === 1 ? '' : 's'} · ${dur(gaps.reduce((a, b) => a + b, 0))}`);
    const doneCount = logData.completions.filter((c) => dayFmt.format(new Date(c.at)) === day).length;
    if (doneCount) line2.push(`${doneCount} done`);
    const goals = goalsOnDay(day);
    if (goals.length) line2.push(`goals ${goals.filter((g) => g.hit).length}/${goals.length}`);
    const row = el('div', 'daysum');
    row.append(el('span', 'd', day), el('span', 't', dur(total)), el('span', 'm', line1.filter(Boolean).join(' · ')), el('span', 'm', line2.join(' · ')));
    out.append(row);
  }
}

document.querySelectorAll('#log-mode .tab').forEach((t) =>
  t.addEventListener('click', async () => {
    S = await api.updateSettings({ logView: t.dataset.mode });
    renderLog();
  })
);

// ---------- Map: the day as one line ----------

const mapBar = $('map-bar');
const mapTip = $('map-tip');
const hourFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric' });
let mapRange = null;
let mapBlocks = [];
let mapIdle = [];
let pickAt = null;

function renderMap() {
  if (!logData || !S) return;
  const now = Date.now();
  const H = 3600e3;
  const sod = new Date();
  sod.setHours(0, 0, 0, 0);
  const day0 = sod.getTime();

  const live = logData.open && logData.open.key !== 'idle' ? [{ ...logData.open, end: null }] : [];
  mapIdle = logData.sessions
    .filter((s) => s.key === 'idle' && Date.parse(s.end) > day0)
    .map((s) => ({ ...s, a: Math.max(Date.parse(s.start), day0), b: Date.parse(s.end) }));
  mapBlocks = [...logData.sessions, ...live]
    .filter((s) => s.key !== 'idle' && (s.end ? Date.parse(s.end) : now) > day0)
    .map((s) => ({ ...s, a: Math.max(Date.parse(s.start), day0), b: s.end ? Date.parse(s.end) : now, live: !s.end }));

  // Goals set for today.
  const meta = logData.taskMeta || {};
  const titles = new Map();
  for (const t of [...S.today.open, ...S.today.done]) titles.set('g:' + t.id, t.title);
  for (const b of mapBlocks) if (!titles.has(b.key)) titles.set(b.key, b.title);
  const doneKeys = new Set(S.today.done.map((t) => 'g:' + t.id));
  const goals = Object.entries(meta)
    .filter(([, m]) => m.goal && Date.parse(m.goal) >= day0 && Date.parse(m.goal) < day0 + 30 * H)
    .map(([k, m]) => ({ key: k, at: Date.parse(m.goal), title: titles.get(k) || 'Task', done: doneKeys.has(k) }));

  // Range: from your first block (or 2h ago) to a few hours ahead, whole hours.
  let from = Math.min(now - 2 * H, ...mapBlocks.map((b) => b.a));
  from = Math.max(day0, Math.floor(from / H) * H);
  let to = Math.max(now + 3 * H, ...goals.map((g) => g.at + H / 2));
  to = Math.ceil(to / H) * H;
  mapRange = { from, to };
  const pct = (t) => ((t - from) / (to - from)) * 100;

  mapBar.replaceChildren();
  const fut = el('div', 'map__future');
  fut.style.left = pct(now) + '%';
  mapBar.append(fut);
  for (const b of mapBlocks.sort((x, y) => x.a - y.a)) {
    const d = el('div', 'map__block' + (b.key.startsWith('hold:') ? ' is-hold' : '') + (b.live ? ' is-live' : ''), b.title);
    d.style.left = pct(Math.max(b.a, from)) + '%';
    d.style.width = Math.max(pct(b.b) - pct(Math.max(b.a, from)), 0.3) + '%';
    mapBar.append(d);
  }
  const nowEl = el('div', 'map__now');
  nowEl.style.left = pct(now) + '%';
  mapBar.append(nowEl);

  // Hour labels, every 1–3 hours depending on how long the line is.
  const hours = $('map-hours');
  hours.replaceChildren();
  const span = (to - from) / H;
  const every = span > 16 ? 3 : span > 9 ? 2 : 1;
  for (let t = from; t <= to; t += every * H) {
    const s = el('span', null, hourFmt.format(new Date(t)).replace(' ', '').toLowerCase());
    s.style.left = pct(t) + '%';
    hours.append(s);
  }

  // Goal markers above the line.
  const gEl = $('map-goals');
  gEl.replaceChildren();
  $('map-goals-on').checked = S.settings.mapGoals !== false;
  if (S.settings.mapGoals !== false) {
    // Two label rows; a goal too close to both shows just its tick.
    const width = mapBar.clientWidth || 1;
    const lastX = [-1e9, -1e9];
    for (const g of goals.sort((a, b) => a.at - b.at)) {
      const x = (pct(g.at) / 100) * width;
      const lane = x - lastX[0] > 96 ? 0 : x - lastX[1] > 96 ? 1 : -1;
      const m = el('div', 'map__goal' + (g.done ? ' is-done' : '') + (lane === 1 ? ' is-up' : ''));
      if (lane >= 0) {
        m.append(el('span', null, g.title));
        lastX[lane] = x;
      }
      m.style.left = pct(g.at) + '%';
      m.title = `${g.title} · by ${hm(g.at)} · click to edit`;
      m.addEventListener('click', () => showGoalPop(g));
      gEl.append(m);
    }
  }

  renderTray(goals);

  // Today at a glance.
  const focused = mapBlocks.filter((b) => !b.key.startsWith('hold:')).reduce((n, b) => n + (b.b - b.a), 0);
  $('map-sub').textContent = `${dur(focused)} focused today` + (goals.length ? ` · ${goals.length} goal${goals.length === 1 ? '' : 's'}` : '');

  // Running over a goal (or goals ahead): offer to push the plan.
  const cur = S.current && !isHold(S.current) ? S.current : null;
  const curGoal = cur && goalOf(cur.key);
  const over = curGoal ? now - Date.parse(curGoal) : 0;
  const ahead = goals.some((g) => !g.done && g.at > now);
  $('map-push').hidden = !(over > 0 || ahead);
  $('map-push-label').textContent = over > 0 ? `${dur(over)} over on “${cur.title}” · push plan` : 'Push plan';
}

const mapTimeAt = (clientX) => {
  const r = mapBar.getBoundingClientRect();
  const f = Math.min(Math.max((clientX - r.left) / r.width, 0), 1);
  return mapRange.from + f * (mapRange.to - mapRange.from);
};

mapBar.addEventListener('mousemove', (e) => {
  if (!mapRange) return;
  const t = mapTimeAt(e.clientX);
  const hit = mapBlocks.find((b) => t >= b.a && t <= b.b);
  const now = Date.now();
  let text;
  if (hit) text = `${hit.key.startsWith('hold:') ? 'Hold: ' : ''}${hit.title} · ${hm(hit.a)}–${hit.live ? 'now' : hm(hit.b)} · ${dur(hit.b - hit.a)}`;
  else {
    const snapped = Math.round(t / (15 * 60e3)) * 15 * 60e3;
    text = t > now ? `${hm(snapped)} · in ${dur(snapped - now)}` : `${hm(t)} · ${dur(now - t)} ago`;
  }
  mapTip.textContent = text;
  mapTip.hidden = false;
  const r = mapBar.getBoundingClientRect();
  const x = e.clientX - r.left;
  mapTip.style.left = Math.min(Math.max(x, mapTip.offsetWidth / 2), r.width - mapTip.offsetWidth / 2) + 'px';
  let c = mapBar.querySelector('.map__cursor');
  if (!c) mapBar.append((c = el('div', 'map__cursor')));
  c.style.left = x + 'px';
});
mapBar.addEventListener('mouseleave', () => {
  mapTip.hidden = true;
  const c = mapBar.querySelector('.map__cursor');
  if (c) c.remove();
});

// Click a later point: pick a task to be done by then.
mapBar.addEventListener('click', (e) => {
  const t = mapTimeAt(e.clientX);
  if (t <= Date.now()) {
    // An idle gap in the past: say what it was.
    const gap = mapIdle.find((s) => t >= s.a && t <= s.b);
    if (gap) showIdlePop(gap);
    return;
  }
  if (!S.connected) return;
  pickAt = Math.round(t / (15 * 60e3)) * 15 * 60e3;
  $('map-pick-at').textContent = `Done by ${hm(pickAt)} (in ${dur(pickAt - Date.now())}):`;
  $('map-search').value = '';
  renderMapChips();
  $('map-pick').hidden = false;
  $('map-search').focus();
});
function renderMapChips() {
  const q = $('map-search').value.trim().toLowerCase();
  const pool = S.today.open.filter(scheduled).length ? S.today.open.filter(scheduled) : S.today.open;
  const list = (q ? S.today.open.filter((t) => t.title.toLowerCase().includes(q)) : pool).slice(0, 3);
  $('map-chips').replaceChildren(
    ...list.map((t) => {
      const b = el('button', 'chip', t.title);
      b.title = t.title;
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', () => setGoalFromMap(t));
      return b;
    })
  );
}
async function setGoalFromMap(t) {
  $('map-pick').hidden = true;
  S = await api.setMeta('g:' + t.id, { goal: new Date(pickAt).toISOString() });
  await loadLog();
}
$('map-search').addEventListener('input', renderMapChips);
$('map-search').addEventListener('keydown', (e) => {
  if (e.key === 'Escape') $('map-pick').hidden = true;
  if (e.key !== 'Enter') return;
  const q = $('map-search').value.trim().toLowerCase();
  const t = q && S.today.open.find((x) => x.title.toLowerCase().includes(q));
  if (t) setGoalFromMap(t);
});
$('map-search').addEventListener('blur', () => ($('map-pick').hidden = true));
$('map-goals-on').addEventListener('change', async (e) => {
  S = await api.updateSettings({ mapGoals: e.target.checked });
  renderMap();
});
document.querySelectorAll('#map-push .act').forEach((b) =>
  b.addEventListener('click', async () => {
    S = await api.shiftGoals(+b.dataset.min * 60e3);
    await loadLog();
  })
);

// Tasks you might mean: the running one, today's blocks (latest first), today's list.
function recentTasks() {
  const out = [];
  const seen = new Set();
  const add = (t) => t && t.key && !t.key.startsWith('hold:') && t.key !== 'idle' && !seen.has(t.key) && (seen.add(t.key), out.push({ key: t.key, title: t.title, googleId: t.googleId || null }));
  add(S.current);
  for (const s of [...((logData && logData.sessions) || [])].reverse()) add(s);
  for (const t of S.today.open) add({ key: 'g:' + t.id, title: t.title, googleId: t.id });
  return out;
}

// Three chips + search, like categories and holds.
function taskPicker(onPick) {
  const wrapEl = el('span', 'picker');
  const chips = el('span', 'chips');
  const search = el('input', 'wrap__search');
  search.type = 'text';
  search.placeholder = 'Search';
  const paint = () => {
    const q = search.value.trim().toLowerCase();
    const all = recentTasks();
    chips.replaceChildren(
      ...(q ? all.filter((t) => t.title.toLowerCase().includes(q)) : all).slice(0, 3).map((t) => {
        const b = el('button', 'chip', t.title);
        b.title = t.title;
        b.addEventListener('click', () => onPick(t));
        return b;
      })
    );
  };
  search.addEventListener('input', paint);
  search.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const q = search.value.trim().toLowerCase();
    const t = q && recentTasks().find((x) => x.title.toLowerCase().includes(q));
    if (t) onPick(t);
  });
  paint();
  wrapEl.append(chips, search);
  return wrapEl;
}

const mapPop = $('map-pop');
function showGoalPop(g) {
  mapPop.replaceChildren(el('span', null, `${g.title} · by ${hm(g.at)}`));
  const remove = el('button', 'act', 'Remove');
  remove.addEventListener('click', async () => {
    mapPop.hidden = true;
    S = await api.setMeta(g.key, { goal: null });
    await loadLog();
  });
  const close = el('button', 'act', 'Close');
  close.addEventListener('click', () => (mapPop.hidden = true));
  mapPop.append(remove, close);
  mapPop.hidden = false;
}
function showIdlePop(gap) {
  mapPop.replaceChildren(el('span', null, `Idle ${hm(gap.a)}–${hm(gap.b)} · ${dur(gap.b - gap.a)} · This was`));
  mapPop.append(
    taskPicker(async (task) => {
      mapPop.hidden = true;
      await api.editSession('convert', { key: gap.key, start: gap.start }, task);
      await loadLog();
    })
  );
  const close = el('button', 'act', 'Close');
  close.addEventListener('click', () => (mapPop.hidden = true));
  mapPop.append(close);
  mapPop.hidden = false;
}

// Ez fill: drag a task chip onto the line to plan it there.
function renderTray(goals) {
  const tray = $('map-tray');
  tray.replaceChildren();
  if (!S.connected) return;
  const planned = new Set(goals.filter((g) => !g.done).map((g) => g.key));
  const todays = S.today.open.filter((t) => scheduled(t) && !planned.has('g:' + t.id));
  const others = S.today.open.filter((t) => !scheduled(t) && !planned.has('g:' + t.id));
  for (const t of [...todays, ...others].slice(0, 10)) {
    const c = el('span', 'chip' + (scheduled(t) ? '' : ' is-other'), t.title);
    c.title = scheduled(t) ? t.title : t.title + ' (not today yet)';
    c.draggable = true;
    c.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/one-focus-task', t.id);
      e.dataTransfer.effectAllowed = 'copy';
    });
    tray.append(c);
  }
}
mapBar.addEventListener('dragover', (e) => {
  if (!e.dataTransfer.types.includes('text/one-focus-task') || !mapRange) return;
  const t = mapTimeAt(e.clientX);
  if (t <= Date.now()) return mapBar.classList.remove('is-drop');
  e.preventDefault();
  mapBar.classList.add('is-drop');
  const snapped = Math.round(t / (15 * 60e3)) * 15 * 60e3;
  mapTip.textContent = `${hm(snapped)} · in ${dur(snapped - Date.now())}`;
  mapTip.hidden = false;
  const r = mapBar.getBoundingClientRect();
  mapTip.style.left = Math.min(Math.max(e.clientX - r.left, mapTip.offsetWidth / 2), r.width - mapTip.offsetWidth / 2) + 'px';
});
mapBar.addEventListener('dragleave', () => {
  mapBar.classList.remove('is-drop');
  mapTip.hidden = true;
});
mapBar.addEventListener('drop', async (e) => {
  e.preventDefault();
  mapBar.classList.remove('is-drop');
  mapTip.hidden = true;
  const id = e.dataTransfer.getData('text/one-focus-task');
  const t = S.today.open.find((x) => x.id === id);
  const at = Math.round(mapTimeAt(e.clientX) / (15 * 60e3)) * 15 * 60e3;
  if (!t || at <= Date.now()) return;
  if (!scheduled(t)) await api.task('schedule', t.id);
  S = await api.setMeta('g:' + t.id, { goal: new Date(at).toISOString() });
  await loadLog();
});

// Today rows: set a goal on an inline day timeline.
function dayPicker(currentGoal, onPick, onClear) {
  const box = el('div', 'timeline timeline--inline');
  const tip = el('div', 'timeline__tip');
  tip.hidden = true;
  const bar = el('div', 'timeline__bar');
  const hover = el('div', 'timeline__mark is-hover');
  hover.hidden = true;
  const ends = el('div', 'timeline__ends');
  const from = Math.floor(Date.now() / STEP) * STEP;
  const midnight = new Date();
  midnight.setHours(24, 0, 0, 0);
  const to = Math.max(midnight.getTime(), from + 4 * 3600e3);
  const at = (x) => {
    const w = bar.clientWidth || 1;
    const t = from + (Math.min(Math.max(x, 0), w) / w) * (to - from);
    return Math.max(Math.round(t / STEP) * STEP, from + STEP);
  };
  const xOf = (t) => ((t - from) / (to - from)) * 100;
  bar.append(hover);
  if (currentGoal && Date.parse(currentGoal) > from && Date.parse(currentGoal) < to) {
    const m = el('div', 'timeline__mark');
    m.style.left = xOf(Date.parse(currentGoal)) + '%';
    bar.append(m);
  }
  bar.addEventListener('mousemove', (e) => {
    const t = at(e.clientX - bar.getBoundingClientRect().left);
    hover.hidden = tip.hidden = false;
    hover.style.left = tip.style.left = xOf(t) + '%';
    tip.textContent = `${hm(t)} · in ${dur(t - Date.now())}`;
  });
  bar.addEventListener('mouseleave', () => (hover.hidden = tip.hidden = true));
  bar.addEventListener('click', (e) => onPick(at(e.clientX - bar.getBoundingClientRect().left)));
  ends.append(el('span', null, 'now'));
  if (currentGoal) {
    const clear = el('button', 'act', 'Clear goal');
    clear.addEventListener('click', onClear);
    ends.append(clear);
  }
  ends.append(el('span', null, hm(to)));
  box.append(tip, bar, ends);
  return box;
}
function toggleRowGoal(li, t) {
  const open = li.nextSibling && li.nextSibling.classList && li.nextSibling.classList.contains('row-goal');
  document.querySelectorAll('.row-goal').forEach((x) => x.remove());
  if (open) return (renaming = false);
  renaming = true; // pause list re-renders while picking
  const holder = el('li', 'row-goal');
  const done = async (patch) => {
    renaming = false;
    S = await api.setMeta('g:' + t.id, patch);
    render();
  };
  holder.append(
    dayPicker(goalOf('g:' + t.id), (at) => done({ goal: new Date(at).toISOString() }), () => done({ goal: null }))
  );
  li.after(holder);
}

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
  if (s.key === 'idle' || s.key.startsWith('hold:')) {
    box.append(el('span', 'gap'), el('span', null, 'This was'), taskPicker(async (task) => after(await api.editSession('convert', id, task))));
  }
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
  const title = titleWithSeries(el('span', 't', t.title), t);
  title.tabIndex = 0;
  li.append(check, title);
  if (current) li.append(el('span', 'tag', 'NOW'));
  else if (next) li.append(el('span', 'tag', 'NEXT'));
  else if (!done && t.due && t.due < S.todayDate) li.append(el('span', 'tag', 'OVERDUE'));
  else if (allView && scheduled(t)) li.append(el('span', 'tag', 'TODAY'));
  const g = !done && goalOf('g:' + t.id);
  if (g) li.append(el('span', 'goaltag', 'by ' + hm(g)));

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
        const r = await startWithClaim(t.id);
        li.classList.remove('is-busy');
        if (r && r.error) $('today-status').textContent = r.error;
      });
      acts.append(start);
    }
    const goalBtn = el('button', 'act', 'Goal');
    goalBtn.title = 'Set when this should be done by';
    goalBtn.addEventListener('click', () => toggleRowGoal(li, t));
    acts.append(goalBtn);
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
  document.querySelectorAll('#today-tabs .tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.list === todayTab)));
  const mapTab = todayTab === 'map'; // Map is hidden for now; its code stays
  $('today-map').hidden = !mapTab;
  if (mapTab) {
    $('today-off').hidden = $('today-on').hidden = true;
    return;
  }
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
    if (todayTab === 'map') loadLog();
  })
);

// ---------- Setup: plan the week. Cards up top, seven day columns below. ----------
// Drag a card onto a day; drag a block to move it, its bottom edge to resize,
// back up to the header to unplan. Click a card or block for its details.

const HOUR = 48; // px per hour
const SNAP = 15; // minutes
let suDrag = null;
let suSheet = null; // { type: 'task', id } | { type: 'break', id } | { type: 'structure' }

const ld = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const metaOf = (key) => (S.plans && S.plans[key]) || {};
const planOf = (key) => metaOf(key).plan || null;
const shortDay = new Intl.DateTimeFormat('en-US', { weekday: 'short', day: 'numeric' });
const rangeFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });
// Repeat rules come from plan.js (shared with the main process).
const repeatLabel = (rule, fromKey) => window.Plan.describe(rule, fromKey);
const SETUP_AHEAD = 30; // days you can plan ahead
const toMin = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};
// Card lengths read the same everywhere: 0h 45m, 2h 15m.
const hLen = (mins) => `${Math.floor(Math.round(mins) / 60)}h ${String(Math.round(mins) % 60).padStart(2, '0')}m`;
const lenLabel = (m) => (m % 60 ? (m > 60 ? Math.floor(m / 60) + 'h ' + (m % 60) + 'm' : m + 'm') : m / 60 + 'h');
const dateAt = (dayKey, minutes) => {
  const [y, mo, d] = dayKey.split('-').map(Number);
  return new Date(y, mo - 1, d, 0, minutes);
};
// Does a repeating task land on this day (faint preview)?

// Hours shown: the workday (or 7am–11pm), widened to fit anything planned.
function suHours() {
  const ds = S.settings.dayStructure;
  let h0 = ds ? Math.max(0, Math.floor(toMin(ds.start) / 60) - 1) : 7;
  let h1 = ds ? Math.min(24, Math.ceil(toMin(ds.end) / 60) + 1) : 23;
  const items = [
    ...S.today.open.map((t) => planOf('g:' + t.id)).filter(Boolean),
    ...(S.breaks || []),
  ];
  for (const p of items) {
    const s = new Date(p.start);
    h0 = Math.min(h0, s.getHours());
    h1 = Math.max(h1, Math.min(24, Math.ceil(s.getHours() + (s.getMinutes() + p.mins) / 60)));
  }
  return [h0, h1];
}

function card(cls, title, meta) {
  const c = el('div', 'su-card' + (cls ? ' ' + cls : ''));
  c.append(el('span', 't', title));
  if (meta) c.append(el('span', 'm', meta));
  c.title = title;
  return c;
}

// Planner tab: 'week' (plan the coming days) or 'today' (one big day + how it's going).
let planTab = new URLSearchParams(location.search).get('tab') === 'today' ? 'today' : 'week';
let logFetched = 0;

// Logged time today on a task (finished sessions + the running one).
function trackedOn(key) {
  if (!logData) return 0;
  const sod = new Date();
  sod.setHours(0, 0, 0, 0);
  let ms = 0;
  for (const s of logData.sessions) if (s.key === key && Date.parse(s.end) > sod.getTime()) ms += Date.parse(s.end) - Math.max(Date.parse(s.start), sod.getTime());
  if (logData.open && logData.open.key === key) ms += Date.now() - Date.parse(logData.open.start);
  return ms;
}


// First start to last stop of a task's sessions on a day (live = still running).
function actualSpan(key, day) {
  if (!logData) return null;
  const a0 = new Date(day).setHours(0, 0, 0, 0);
  const a1 = a0 + 86400e3;
  let start = Infinity;
  let end = -Infinity;
  let live = false;
  const all = [...logData.sessions, ...(logData.open && logData.open.key === key ? [{ ...logData.open, end: null }] : [])];
  for (const s of all) {
    if (s.key !== key) continue;
    const st = Date.parse(s.start);
    const en = s.end ? Date.parse(s.end) : Date.now();
    if (en <= a0 || st >= a1) continue;
    start = Math.min(start, Math.max(st, a0));
    end = Math.max(end, Math.min(en, a1));
    if (!s.end) live = true;
  }
  return start < end ? { start, end, live } : null;
}

// Behind plan today: blocks whose start has passed without being started, or
// that the running task has already pushed past. Returns ids and how far behind.
function behindToday() {
  const now = Date.now();
  const ids = new Set();
  let from = null;
  let by = 0;
  const cur = S.current && S.current.googleId;
  const curPlan = cur && planOf('g:' + cur);
  const curEnd = curPlan ? Date.parse(curPlan.start) + curPlan.mins * 60e3 : null;
  for (const t of S.today.open) {
    const p = planOf('g:' + t.id);
    if (!p || ld(new Date(p.start)) !== S.todayDate || t.id === cur) continue;
    const st = Date.parse(p.start);
    if (st + 5 * 60e3 > now) continue; // not due yet (5 min grace)
    if (actualSpan('g:' + t.id, new Date())) continue; // you did work on it
    ids.add(t.id);
    if (from === null || st < from) from = st;
  }
  if (from !== null) by = now - from;
  if (curEnd && now > curEnd) {
    by = Math.max(by, now - curEnd);
    if (from === null) from = curEnd;
  }
  return { ids, from, by };
}

// Missed blocks go back to back from now (after the running task's planned
// end, if later); later blocks keep their time unless they'd now overlap.
function replanFromNow(b) {
  const step = 5 * 60e3;
  const cur = S.current && S.current.googleId;
  const curPlan = cur && planOf('g:' + cur);
  let cursor = Math.ceil(Date.now() / step) * step;
  if (curPlan) cursor = Math.max(cursor, Math.ceil((Date.now() + 0) / step) * step);
  const todays = S.today.open
    .filter((t) => t.id !== cur)
    .map((t) => ({ t, p: planOf('g:' + t.id) }))
    .filter((x) => x.p && ld(new Date(x.p.start)) === S.todayDate)
    .sort((x, y) => Date.parse(x.p.start) - Date.parse(y.p.start));
  const out = [];
  const missed = todays.filter((x) => b.ids.has(x.t.id));
  const later = todays.filter((x) => !b.ids.has(x.t.id) && Date.parse(x.p.start) >= Date.now());
  for (const x of missed) {
    out.push({ id: x.t.id, start: new Date(cursor).toISOString(), mins: x.p.mins });
    cursor += x.p.mins * 60e3;
  }
  for (const x of later) {
    const st = Math.max(Date.parse(x.p.start), cursor);
    if (st !== Date.parse(x.p.start)) out.push({ id: x.t.id, start: new Date(st).toISOString(), mins: x.p.mins });
    cursor = st + x.p.mins * 60e3;
  }
  return out;
}

function renderSetup() {
  if (!S || suDrag) return;
  const behindNow = behindToday();
  $('su-behind').hidden = !(behindNow.ids.size || behindNow.by > 10 * 60e3) || S.settings.appMode === 'light';
  if (!$('su-behind').hidden)
    $('su-behind').textContent = behindNow.ids.size ? `⚠️ ${behindNow.ids.size} behind` : `⚠️ ${dur(Math.ceil(behindNow.by / (5 * 60e3)) * 5 * 60e3)} over`;
  const now = new Date();
  $('su-structure').setAttribute('aria-pressed', String(!!(suSheet && suSheet.type === 'structure')));
  $('view-setup').classList.toggle('is-modal', setupMode);
  $('view-setup').dataset.tab = planTab;
  document.querySelectorAll('.su-tab').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === planTab)));
  const workSig = (S.current ? S.current.key + S.current.since : '') + '|' + S.today.done.length;
  if (Date.now() - logFetched > 30e3 || workSig !== logSig) {
    logFetched = Date.now();
    logSig = workSig;
    api.getLog().then((d) => ((logData = d), renderSetup()));
  }

  // Header cards: a Break to drag in, then every task not yet on the calendar.
  const tray = $('su-tray');
  tray.replaceChildren();
  const br = card('is-break', 'Break', '15m · drag onto a day');
  br.addEventListener('pointerdown', (e) => beginDrag(e, { kind: 'break', mode: 'new', mins: 15 }));
  tray.append(br);
  if (!S.connected) tray.append(el('span', 'su-note', 'Connect Google Tasks in Settings to plan your tasks here.'));
  else {
    const unplanned = S.today.open.filter((t) => !planOf('g:' + t.id));
    for (const t of unplanned) {
      const m = metaOf('g:' + t.id);
      const tag = t.due ? (t.due === S.todayDate ? 'today' : t.due < S.todayDate ? 'overdue' : shortDay.format(new Date(t.due + 'T12:00:00'))) : null;
      const items = t.items && t.items.length ? `${t.items.filter((x) => x.done).length}/${t.items.length} items` : null;
      const bits = [hLen(m.mins || 30), m.repeat ? '↻ ' + repeatLabel(m.repeat, t.due || S.todayDate) : null, items, tag].filter(Boolean);
      const c = card('', t.title, bits.join(' · '));
      titleWithSeries(c.querySelector('.t'), t);
      c.addEventListener('pointerdown', (e) => beginDrag(e, { kind: 'task', task: t, mode: 'new', mins: m.mins || 30 }));
      tray.append(c);
    }
    if (!unplanned.length) tray.append(el('span', 'su-note', 'Everything is planned. Add a task above.'));
  }

  const [h0, h1] = suHours();
  const days = $('su-days');
  const keep = [days.scrollLeft, days.scrollTop];
  days.replaceChildren();
  if (planTab === 'today') {
    days.append(dayCard(0, now, h0, h1, { wide: true }), todaySummary());
  } else {
    // From Monday of this week (earlier days are view-only) to a month ahead.
    const back = (now.getDay() + 6) % 7;
    for (let i = -back; i <= SETUP_AHEAD; i++) days.append(dayCard(i, now, h0, h1, {}));
  }
  days.scrollLeft = keep[0];
  days.scrollTop = keep[1];
  updateSetupRange();
  renderSheet();
}

// One day column: structure bands, hours, now line, repeat previews, breaks,
// planned tasks (and, on Today, what you actually did beside them).
function dayCard(i, now, h0, h1, { wide }) {
  const ds = S.settings.dayStructure;
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + i);
  const key = ld(d);
  const px = (min) => (min - h0 * 60) * (HOUR / 60);
  const span = (cls, fromMin, toMinute, label) => {
    const b = el('div', cls);
    b.style.top = px(Math.max(fromMin, h0 * 60)) + 'px';
    b.style.height = Math.max(0, px(Math.min(toMinute, h1 * 60)) - px(Math.max(fromMin, h0 * 60))) + 'px';
    if (label) b.append(el('span', null, label));
    return b;
  };
  const col = el('div', 'su-col');
  col.dataset.day = key;
  col.dataset.h0 = h0;
  col.style.height = (h1 - h0) * HOUR + 'px';

  if (ds) {
    const weekend = d.getDay() === 0 || d.getDay() === 6;
    if (weekend && !ds.weekends) col.append(span('su-off', h0 * 60, h1 * 60));
    else {
      col.append(span('su-off', h0 * 60, toMin(ds.start)), span('su-off', toMin(ds.end), h1 * 60));
      for (const [a, b] of ds.work) col.append(span('su-work', toMin(a), toMin(b)));
      for (const [a, b] of ds.breaks) col.append(span('su-sbreak', toMin(a), toMin(b), 'break'));
    }
  }
  for (let h = h0; h <= h1; h++) {
    const line = el('div', 'su-hour');
    line.style.top = (h - h0) * HOUR + 'px';
    if (h > h0 && h < h1) line.append(el('span', null, hourFmt.format(new Date(2000, 0, 1, h)).replace(' ', '').toLowerCase()));
    col.append(line);
  }
  if (i === 0 && now.getHours() >= h0 && now.getHours() < h1) {
    const n = el('div', 'su-now');
    n.style.top = px(now.getHours() * 60 + now.getMinutes()) + 'px';
    col.append(n);
  }

  // Today (wide): what you actually did, as a slim lane on the right.
  if (wide && logData) {
    const sod = d.getTime();
    const plannedKeys = new Set([...S.today.open, ...S.today.done].filter((t) => { const p = planOf('g:' + t.id); return p && ld(new Date(p.start)) === key; }).map((t) => 'g:' + t.id));
    const lane = [...logData.sessions, ...(logData.open ? [{ ...logData.open, end: new Date().toISOString() }] : [])].filter(
      (s) => s.key !== 'idle' && !plannedKeys.has(s.key) && Date.parse(s.end) > sod && Date.parse(s.start) < sod + 86400e3
    );
    for (const s of lane) {
      const a = new Date(Math.max(Date.parse(s.start), sod));
      const mins = (Date.parse(s.end) - a.getTime()) / 60e3;
      if (mins < 1) continue;
      const b = el('div', 'su-actual' + (s.key.startsWith('hold:') ? ' is-hold' : ''));
      b.style.top = px(a.getHours() * 60 + a.getMinutes()) + 'px';
      b.style.height = Math.max(mins * (HOUR / 60), 2) + 'px';
      b.title = `${s.key.startsWith('hold:') ? 'Hold: ' : ''}${s.title} · ${hm(a)}–${hm(s.end)} · ${dur(mins * 60e3)}`;
      col.append(b);
    }
  }

  let total = 0;
  for (const t of S.today.open) {
    const m = metaOf('g:' + t.id);
    if (!m.repeat || !m.plan) continue;
    const s = new Date(m.plan.start);
    if (!window.Plan.repeatsOn(ld(s), m.repeat, key)) continue;
    const g = el('div', 'su-block is-ghost');
    g.style.top = px(s.getHours() * 60 + s.getMinutes()) + 'px';
    g.style.height = Math.max(m.plan.mins * (HOUR / 60) - 2, 16) + 'px';
    g.append(el('span', 't', t.title), el('span', 'w', '↻ ' + repeatLabel(m.repeat, ld(s))));
    col.append(g);
  }
  for (const b of (S.breaks || []).filter((x) => ld(new Date(x.start)) === key)) {
    const s = new Date(b.start);
    const blk = el('div', 'su-block is-break' + (b.mins <= 20 ? ' is-short' : ''));
    blk.style.top = px(s.getHours() * 60 + s.getMinutes()) + 'px';
    blk.style.height = Math.max(b.mins * (HOUR / 60) - 2, 16) + 'px';
    blk.append(el('span', 't', 'Break'), el('span', 'w', b.mins <= 20 ? hm(s) : `${hm(s)}–${hm(s.getTime() + b.mins * 60e3)}`), el('span', 'h'));
    blk.addEventListener('pointerdown', (e) =>
      beginDrag(e, { kind: 'break', id: b.id, mode: e.target.classList.contains('h') ? 'resize' : 'move', mins: b.mins, start: b.start, block: blk })
    );
    col.append(blk);
  }
  // Planned tasks: the plan is a soft outline; what really happened is a more
  // solid layer on top that grows past the plan when you run over.
  const behind = i === 0 ? behindToday() : { ids: new Set() };
  for (const t of [...S.today.open, ...S.today.done.map((x) => ({ ...x, done: true }))]) {
    const p = planOf('g:' + t.id);
    if (!p || ld(new Date(p.start)) !== key) continue;
    total += p.mins;
    const s = new Date(p.start);
    const pEnd = s.getTime() + p.mins * 60e3;
    const m = metaOf('g:' + t.id);
    const real = actualSpan('g:' + t.id, d);
    const isBehind = behind.ids.has(t.id);
    const cls = 'su-block is-plan' + (S.current && S.current.googleId === t.id ? ' is-running' : '') + (p.mins <= 20 ? ' is-short' : '') + (t.done ? ' is-done' : '') + (isBehind ? ' is-behind' : '');
    const blk = el('div', cls);
    blk.style.top = px(s.getHours() * 60 + s.getMinutes()) + 'px';
    blk.style.height = Math.max(p.mins * (HOUR / 60) - 2, 16) + 'px';
    blk.append(titleWithSeries(el('span', 't', t.title), t), el('span', 'w', (p.mins <= 20 ? hm(s) : `${hm(s)}–${hm(pEnd)}`) + ` · ${hLen(p.mins)}` + (m.repeat ? ' · ↻' : '')));
    blk.title = t.title;
    if (!t.done) {
      blk.append(el('span', 'h'));
      blk.addEventListener('pointerdown', (e) => {
        if (e.target.classList.contains('su-warnmark')) return;
        beginDrag(e, { kind: 'task', task: t, mode: e.target.classList.contains('h') ? 'resize' : 'move', mins: p.mins, start: p.start, block: blk });
      });
    }
    if (isBehind) {
      const w = el('span', 'su-warnmark', '⚠️');
      w.title = 'Behind plan';
      w.addEventListener('click', (e) => {
        e.stopPropagation();
        suSheet = { type: 'behind', id: t.id };
        renderSetup();
      });
      blk.append(w);
    }
    col.append(blk);

    if (real) {
      const r = el('div', 'su-real' + (real.live ? ' is-live' : ''));
      const a = new Date(real.start);
      r.style.top = px(a.getHours() * 60 + a.getMinutes()) + 'px';
      r.style.height = Math.max(((real.end - real.start) / 60e3) * (HOUR / 60) - 2, 4) + 'px';
      const took = real.end - real.start;
      if (S.settings.colorTime) {
        if (real.end > pEnd) {
          // Neutral until the planned end, then a fade into red.
          const from = Math.max(0, Math.min(100, ((pEnd - real.start) / took) * 100));
          r.style.background = `linear-gradient(to bottom, rgba(245,245,244,0.2) 0%, rgba(245,245,244,0.2) ${from}%, rgba(228,104,96,0.5) 100%)`;
        } else if (t.done && took < p.mins * 60e3 * 0.8) r.classList.add('is-under');
      }
      if (took >= 15 * 60e3) r.append(el('span', null, (real.live ? 'so far ' : 'took ') + hLen(took / 60e3)));
      r.title = `${hm(real.start)}–${real.live ? 'now' : hm(real.end)} · ${hLen(took / 60e3)}`;
      col.append(r);
    }
  }

  const card = el('section', 'su-day' + (i === 0 ? ' is-today' : '') + (i < 0 ? ' is-past' : '') + (wide ? ' is-wide' : ''));
  card.dataset.day = key;
  const head = el('div', 'su-day__head');
  const name = i === 0 ? (wide ? `Today · ${shortDay.format(d)}` : 'Today') : i === 1 ? 'Tomorrow' : i === -1 ? 'Yesterday' : shortDay.format(d);
  head.append(el('span', 'su-day__name', name), el('span', 'su-day__total', wide ? 'plan · done' : total ? dur(total * 60e3) : ''));
  card.append(head, col);
  return card;
}

// Today tab: how the day's time has gone so far, and what's left.
function todaySummary() {
  const box = el('aside', 'su-summary');
  const sod = new Date();
  sod.setHours(0, 0, 0, 0);
  const sessions = logData
    ? [...logData.sessions, ...(logData.open ? [{ ...logData.open, end: new Date().toISOString() }] : [])]
        .filter((s) => Date.parse(s.end) > sod.getTime())
        .map((s) => ({ ...s, ms: Date.parse(s.end) - Math.max(Date.parse(s.start), sod.getTime()) }))
    : [];
  const sum = (f) => sessions.filter(f).reduce((n, s) => n + s.ms, 0);
  const focused = sum((s) => s.key !== 'idle' && !s.key.startsWith('hold:'));
  const idle = sum((s) => s.key === 'idle');
  const hold = sum((s) => s.key.startsWith('hold:'));
  const planned = [...S.today.open, ...S.today.done].filter((t) => {
    const p = planOf('g:' + t.id);
    return p && ld(new Date(p.start)) === S.todayDate;
  });
  const plannedDone = planned.filter((t) => S.today.done.some((x) => x.id === t.id)).length;

  box.append(el('span', 'label', 'So far'), el('div', 'su-big', dur(focused) + ' focused'));
  const stats = el('div', 'su-stats');
  for (const [k, v] of [
    ['Idle', dur(idle)],
    ['Hold', dur(hold)],
    ['Done', String(S.today.done.length)],
    ['Planned', planned.length ? `${plannedDone}/${planned.length}` : '—'],
  ]) {
    const s = el('div', 'su-stat');
    s.append(el('span', 'v', v), el('span', 'k', k));
    stats.append(s);
  }
  box.append(stats);

  // Where the time went: focused + hold + idle as one bar, then by task.
  const total = focused + hold + idle || 1;
  const bar = el('div', 'su-split');
  for (const [cls, ms] of [['f', focused], ['h', hold], ['i', idle]]) {
    const seg = el('span', cls);
    seg.style.width = (ms / total) * 100 + '%';
    bar.append(seg);
  }
  box.append(bar);
  const byTask = new Map();
  for (const s of sessions.filter((x) => x.key !== 'idle')) byTask.set(s.key, { title: s.title, ms: ((byTask.get(s.key) || {}).ms || 0) + s.ms, hold: s.key.startsWith('hold:') });
  const top = [...byTask.values()].sort((a, b) => b.ms - a.ms).slice(0, 6);
  if (top.length) {
    const list = el('ul', 'su-by');
    for (const g of top) {
      const li = el('li');
      li.append(el('span', 't', (g.hold ? 'Hold: ' : '') + g.title), el('span', 'd', dur(g.ms)));
      list.append(li);
    }
    box.append(el('span', 'label', 'By task'), list);
  }

  // What's left today, in order.
  const left = S.today.open.filter((t) => scheduled(t));
  box.append(el('span', 'label', left.length ? `Left today · ${left.length}` : 'Left today'));
  if (!left.length) box.append(el('p', 'hint', 'Nothing left for today.'));
  const ul = el('ul', 'su-left');
  for (const t of left.slice(0, 8)) {
    const li = el('li');
    const p = planOf('g:' + t.id);
    const g = goalOf('g:' + t.id);
    li.append(titleWithSeries(el('span', 't', t.title), t), el('span', 'd', p ? hm(p.start) : g ? 'by ' + hm(g) : ''));
    li.addEventListener('click', () => ((suSheet = { type: 'task', id: t.id }), renderSetup()));
    ul.append(li);
  }
  box.append(ul);
  return box;
}

// Header date range follows what's on screen.
function updateSetupRange() {
  if (planTab === 'today') return ($('su-range').textContent = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date()));
  const days = $('su-days');
  const cards = [...days.querySelectorAll('.su-day')];
  const r = days.getBoundingClientRect();
  const seen = cards.filter((c) => {
    const b = c.getBoundingClientRect();
    return b.right > r.left + 20 && b.left < r.right - 20;
  });
  if (!seen.length) return;
  const a = dateAt(seen[0].dataset.day, 12 * 60);
  const z = dateAt(seen[seen.length - 1].dataset.day, 12 * 60);
  $('su-range').textContent = `${rangeFmt.format(a)} – ${rangeFmt.format(z)}`;
}
$('su-days').addEventListener('scroll', () => requestAnimationFrame(updateSetupRange));

// Week arrows and Today: scroll the day columns.
function scrollDays(to) {
  const days = $('su-days');
  const cards = [...days.querySelectorAll('.su-day')];
  const w = cards[1] ? cards[1].offsetLeft - cards[0].offsetLeft : 212;
  if (to === 'today') {
    const t = days.querySelector('.su-day.is-today');
    if (t) days.scrollTo({ left: t.offsetLeft - cards[0].offsetLeft, behavior: 'smooth' });
  } else days.scrollBy({ left: to * 7 * w, behavior: 'smooth' });
}
$('su-prev').addEventListener('click', () => scrollDays(-1));
$('su-next').addEventListener('click', () => scrollDays(1));
$('su-today').addEventListener('click', () => scrollDays('today'));

function scrollSetupToNow() {
  const col = document.querySelector('.su-col');
  if (!col) return;
  const days = $('su-days');
  days.scrollTop = Math.max(0, (new Date().getHours() - +col.dataset.h0 - 1) * HOUR);
  const t = days.querySelector('.su-day.is-today');
  const firstCard = days.querySelector('.su-day');
  if (t && firstCard) days.scrollLeft = t.offsetLeft - firstCard.offsetLeft;
  updateSetupRange();
}

// Minutes since midnight at a pointer y inside a day column, snapped.
function colMinutes(col, clientY) {
  const r = col.getBoundingClientRect();
  const m = +col.dataset.h0 * 60 + ((clientY - r.top) / HOUR) * 60;
  return Math.max(0, Math.min(24 * 60 - SNAP, Math.round(m / SNAP) * SNAP));
}

function beginDrag(e, d) {
  if (e.button !== 0) return;
  e.preventDefault();
  suDrag = { ...d, x0: e.clientX, y0: e.clientY, moved: false };
  if (d.mode === 'resize') suDrag.h0 = d.block.offsetHeight;
  document.addEventListener('pointermove', onDragMove);
  document.addEventListener('pointerup', onDragEnd, { once: true });
}

function targetAt(x, y) {
  const hit = document.elementFromPoint(x, y);
  return { col: hit && hit.closest('.su-col'), head: hit && hit.closest('.su-head') };
}

function onDragMove(e) {
  const d = suDrag;
  if (!d) return;
  if (!d.moved && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 4) return;
  d.moved = true;
  if (d.mode === 'resize') {
    const h = Math.max(HOUR / 4, d.h0 + (e.clientY - d.y0));
    d.mins = Math.max(SNAP, Math.round(h / (HOUR / 60) / SNAP) * SNAP);
    d.block.style.height = d.mins * (HOUR / 60) - 2 + 'px';
    const s = new Date(d.start);
    d.block.querySelector('.w').textContent = `${hm(s)}–${hm(s.getTime() + d.mins * 60e3)}`;
    return;
  }
  if (d.block) d.block.classList.add('is-dragging');
  if (!d.ghost) {
    d.ghost = el('div', 'su-ghost', d.kind === 'break' ? 'Break' : d.task.title);
    document.body.append(d.ghost);
  }
  d.ghost.style.left = e.clientX + 'px';
  d.ghost.style.top = e.clientY + 'px';
  document.querySelectorAll('.su-preview').forEach((p) => p.remove());
  $('su-tray').classList.remove('is-drop');
  const t = targetAt(e.clientX, e.clientY);
  if (t.col) {
    const m = colMinutes(t.col, e.clientY);
    const p = el('div', 'su-preview');
    p.style.top = (m - +t.col.dataset.h0 * 60) * (HOUR / 60) + 'px';
    p.style.height = d.mins * (HOUR / 60) - 2 + 'px';
    p.append(el('span', null, `${hm(new Date(2000, 0, 1, 0, m))} · ${lenLabel(d.mins)}`));
    t.col.append(p);
  } else if (t.head && d.mode === 'move') $('su-tray').classList.add('is-drop');
}

async function onDragEnd(e) {
  const d = suDrag;
  document.removeEventListener('pointermove', onDragMove);
  document.querySelectorAll('.su-preview').forEach((p) => p.remove());
  $('su-tray').classList.remove('is-drop');
  if (d && d.ghost) d.ghost.remove();
  suDrag = null;
  if (!d) return;
  if (!d.moved) {
    // A click, not a drag: open details.
    if (d.kind === 'task') suSheet = { type: 'task', id: d.task.id };
    else if (d.id) suSheet = { type: 'break', id: d.id };
    return renderSetup();
  }
  const save = (start, mins) => (d.kind === 'break' ? api.setBreak(d.id || null, start ? { start, mins } : null) : api.plan(d.task.id, start ? { start, mins } : null));
  if (d.mode === 'resize') S = await save(d.start, d.mins);
  else {
    const t = targetAt(e.clientX, e.clientY);
    // Past days are view-only.
    if (t.col && t.col.dataset.day >= S.todayDate) S = await save(dateAt(t.col.dataset.day, colMinutes(t.col, e.clientY)).toISOString(), d.mins);
    else if (t.head && d.mode === 'move') S = await save(null);
  }
  render();
}

// ---------- Setup side sheet: task details, a break, or the day structure ----------

function tabsRow(options, current, onPick) {
  const row = el('div', 'tabs');
  for (const [value, label] of options) {
    const b = el('button', 'tab', label);
    b.setAttribute('aria-selected', String(value === current));
    b.addEventListener('click', () => onPick(value));
    row.append(b);
  }
  return row;
}

function sheetTop(titleNode) {
  const top = el('div', 'su-sheet__top');
  const close = el('button', 'su-tool su-close');
  close.innerHTML = '<svg viewBox="0 0 10 10"><path d="M1.5 1.5l7 7M8.5 1.5l-7 7"/></svg>';
  close.setAttribute('aria-label', 'Close');
  close.addEventListener('click', () => ((suSheet = null), renderSetup()));
  top.append(titleNode, close);
  return top;
}

const LENGTHS = [15, 30, 45, 60, 90, 120, 180].map((m) => [m, lenLabel(m)]);

function renderSheet() {
  const sheet = $('su-sheet');
  // Don't rebuild while you're typing in it; tab clicks still refresh it.
  const typing = document.activeElement && sheet.contains(document.activeElement) && document.activeElement.matches('input, textarea');
  if (!suSheet || (typing && sheet.dataset.for === JSON.stringify(suSheet))) {
    sheet.hidden = !suSheet;
    return;
  }
  sheet.dataset.for = JSON.stringify(suSheet);
  sheet.replaceChildren();
  sheet.hidden = false;

  if (suSheet.type === 'task') {
    const t = S.today.open.find((x) => x.id === suSheet.id);
    if (!t) return ((suSheet = null), (sheet.hidden = true));
    const m = metaOf('g:' + t.id);
    const p = m.plan;
    const name = el('input', 'su-sheet__name');
    name.type = 'text';
    name.value = t.title;
    name.addEventListener('change', async () => name.value.trim() && (S = await api.taskDetail(t.id, { title: name.value.trim() })));
    const notes = el('textarea');
    notes.placeholder = 'Notes';
    notes.value = t.notes || '';
    notes.addEventListener('change', async () => (S = await api.taskDetail(t.id, { notes: notes.value })));
    const when = el(
      'p',
      'when',
      p ? `${shortDay.format(new Date(p.start))} · ${hm(p.start)}–${hm(Date.parse(p.start) + p.mins * 60e3)}` : 'Not on the calendar yet. Drag it onto a day.'
    );
    const length = tabsRow(LENGTHS, (p && p.mins) || m.mins || 30, async (v) => ((S = await api.taskDetail(t.id, { mins: v })), render()));
    // Repeat: presets, or Custom (every N days/weeks/months, chosen weekdays).
    const isCustom = m.repeat && typeof m.repeat === 'object';
    const setRepeat = async (v) => ((S = await api.taskDetail(t.id, { repeat: v })), render());
    const repeat = tabsRow(
      [[null, 'Never'], ['daily', 'Daily'], ['weekdays', 'Weekdays'], ['weekly', 'Weekly'], ['custom', 'Custom']],
      isCustom ? 'custom' : m.repeat || null,
      (v) => setRepeat(v === 'custom' ? { every: 1, unit: 'week', days: [dateAt(t.due || S.todayDate, 12 * 60).getDay()] } : v)
    );
    const custom = el('div', 'su-custom');
    if (isCustom) {
      const r = m.repeat;
      const row = el('div', 'su-custom__row');
      const minus = el('button', 'su-step', '−');
      const plus = el('button', 'su-step', '+');
      minus.addEventListener('click', () => r.every > 1 && setRepeat({ ...r, every: r.every - 1 }));
      plus.addEventListener('click', () => setRepeat({ ...r, every: r.every + 1 }));
      row.append(el('span', null, 'Every'), minus, el('span', 'su-every', String(r.every)), plus);
      row.append(tabsRow([['day', r.every > 1 ? 'days' : 'day'], ['week', r.every > 1 ? 'weeks' : 'week'], ['month', r.every > 1 ? 'months' : 'month']], r.unit, (u) => setRepeat({ ...r, unit: u })));
      custom.append(row);
      if (r.unit === 'week') {
        const dow = el('div', 'su-dow');
        // Monday first, like the rest of the week.
        for (const d of [1, 2, 3, 4, 5, 6, 0]) {
          const b = el('button', 'su-dow__d', 'SMTWTFS'[d]);
          b.title = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d];
          b.setAttribute('aria-pressed', String(r.days.includes(d)));
          b.addEventListener('click', () => {
            const days = r.days.includes(d) ? r.days.filter((x) => x !== d) : [...r.days, d];
            if (days.length) setRepeat({ ...r, days });
          });
          dow.append(b);
        }
        custom.append(dow);
      }
      custom.append(el('p', 'hint', repeatLabel(r, t.due || S.todayDate)));
    }
    const acts = el('div', 'acts-row');
    if (p) {
      const un = el('button', 'act', 'Take off calendar');
      un.addEventListener('click', async () => ((S = await api.plan(t.id, null)), render()));
      acts.append(un);
    }
    const dup = el('button', 'act', 'Duplicate');
    dup.addEventListener('click', () => openDuplicate(t));
    acts.append(dup);
    const del = el('button', 'act', 'Delete task');
    del.addEventListener('click', async () => {
      suSheet = null;
      await api.task('delete', t.id);
    });
    acts.append(del);
    sheet.append(sheetTop(name), notes, el('span', 'label', 'When'), when, el('span', 'label', 'Length'), length, el('span', 'label', 'Repeat'), repeat);
    if (isCustom) sheet.append(custom);
    // Items: Google subtasks, as a checklist.
    const items = el('ul', 'su-items');
    for (const it of t.items || []) {
      const li = el('li', it.done ? 'is-done' : '');
      const check = el('button', 'check');
      check.setAttribute('aria-label', it.done ? 'Mark not done' : 'Mark done');
      check.addEventListener('click', async () => ((S = await api.item(t.id, 'toggle', it.id)), render()));
      const x = el('button', 'act x', '×');
      x.title = 'Remove item';
      x.addEventListener('click', async () => ((S = await api.item(t.id, 'delete', it.id)), render()));
      li.append(check, el('span', 't', it.title), x);
      items.append(li);
    }
    const addItem = el('input');
    addItem.type = 'text';
    addItem.placeholder = 'Add an item';
    addItem.addEventListener('keydown', async (e) => {
      if (e.key !== 'Enter' || !addItem.value.trim()) return;
      const v = addItem.value.trim();
      addItem.value = '';
      S = await api.item(t.id, 'add', null, v);
      render();
      setTimeout(() => {
        const again = document.querySelector('#su-sheet input[placeholder="Add an item"]');
        if (again) again.focus();
      }, 50);
    });
    const doneItems = (t.items || []).filter((x) => x.done).length;
    sheet.append(el('span', 'label', t.items && t.items.length ? `Items · ${doneItems}/${t.items.length}` : 'Items'), items, addItem);
    if (m.repeat) sheet.append(el('p', 'hint', 'When you finish it, the next one is added with the same time of day.'));
    sheet.append(acts);
    return;
  }

  if (suSheet.type === 'behind') {
    const b = behindToday();
    const t = suSheet.id && S.today.open.find((x) => x.id === suSheet.id);
    const byMs = Math.max(Math.ceil(b.by / (5 * 60e3)) * 5 * 60e3, 5 * 60e3);
    const choice = (title, desc, fn) => {
      const c = el('button', 'choice');
      c.append(el('b', null, title), el('span', null, desc));
      c.addEventListener('click', async () => {
        suSheet = null;
        await fn();
        render();
      });
      return c;
    };
    const items = [];
    if (b.from !== null) {
      items.push(choice('Re-plan from now', 'Missed blocks line up back to back from now; anything later only moves if it would overlap.', async () => (S = await api.planMany(replanFromNow(b)))));
      if (byMs <= 3 * 3600e3)
        items.push(choice(`Push the rest of today ${dur(byMs)}`, 'Everything from the first slip onwards moves later by the same amount.', async () => (S = await api.shiftPlan(new Date(b.from).toISOString(), byMs))));
    }
    if (t) {
      const p = planOf('g:' + t.id);
      items.push(
        choice('Start it now', `Move "${t.title}" to now and start it.`, async () => {
          S = await api.plan(t.id, { start: new Date(Math.ceil(Date.now() / (5 * 60e3)) * 5 * 60e3).toISOString(), mins: p.mins });
          await startWithClaim(t.id);
        }),
        choice('Move to tomorrow', 'Same time, tomorrow.', async () => (S = await api.plan(t.id, { start: new Date(Date.parse(p.start) + 86400e3).toISOString(), mins: p.mins }))),
        choice('Take it off the plan', 'Keeps the task, removes the block.', async () => (S = await api.plan(t.id, null))),
        choice('Delete the task', 'Gone from Google Tasks too.', async () => api.task('delete', t.id))
      );
    }
    sheet.append(sheetTop(el('span', 'su-sheet__name', '⚠️ Behind plan')), el('p', 'when', t ? t.title : `About ${dur(byMs)} behind.`), ...items);
    return;
  }

  if (suSheet.type === 'break') {
    const b = (S.breaks || []).find((x) => x.id === suSheet.id);
    if (!b) return ((suSheet = null), (sheet.hidden = true));
    const length = tabsRow(LENGTHS.slice(0, 5), b.mins, async (v) => ((S = await api.setBreak(b.id, { start: b.start, mins: v })), render()));
    const acts = el('div', 'acts-row');
    const del = el('button', 'act', 'Remove break');
    del.addEventListener('click', async () => {
      suSheet = null;
      S = await api.setBreak(b.id, null);
      render();
    });
    acts.append(del);
    sheet.append(sheetTop(el('span', 'su-sheet__name', 'Break')), el('p', 'when', `${shortDay.format(new Date(b.start))} · ${hm(b.start)}–${hm(Date.parse(b.start) + b.mins * 60e3)}`), el('span', 'label', 'Length'), length, acts);
    return;
  }

  // Day structure: workday, work blocks, breaks. Shown as faint bands.
  const ds = S.settings.dayStructure || { start: '09:00', end: '17:30', work: [['09:00', '12:00'], ['13:00', '17:30']], breaks: [['12:00', '13:00']], weekends: false };
  const save = async (next) => ((S = await api.updateSettings({ dayStructure: next })), render());
  if (!S.settings.dayStructure) save(ds);
  const timeIn = (v, onChange) => {
    const i = el('input');
    i.type = 'time';
    i.value = v;
    i.addEventListener('change', () => i.value && onChange(i.value));
    return i;
  };
  const rangeRow = (pair, onChange, onRemove) => {
    const r = el('div', 'su-range-row');
    const rm = el('button', 'act', '×');
    rm.title = 'Remove';
    rm.addEventListener('click', onRemove);
    r.append(timeIn(pair[0], (v) => onChange([v, pair[1]])), el('span', null, '–'), timeIn(pair[1], (v) => onChange([pair[0], v])), rm);
    return r;
  };
  const list = (field, label, fallback) => {
    const wrapEl = el('div', 'su-list');
    wrapEl.append(el('span', 'label', label));
    ds[field].forEach((pair, i) =>
      wrapEl.append(
        rangeRow(
          pair,
          (np) => save({ ...ds, [field]: ds[field].map((x, j) => (j === i ? np : x)) }),
          () => save({ ...ds, [field]: ds[field].filter((_, j) => j !== i) })
        )
      )
    );
    const add = el('button', 'act', '+ Add');
    add.addEventListener('click', () => save({ ...ds, [field]: [...ds[field], fallback] }));
    wrapEl.append(add);
    return wrapEl;
  };
  const day = el('div', 'su-range-row');
  day.append(timeIn(ds.start, (v) => save({ ...ds, start: v })), el('span', null, '–'), timeIn(ds.end, (v) => save({ ...ds, end: v })));
  const wk = el('label', 'toggle');
  const box = el('input');
  box.type = 'checkbox';
  box.checked = !!ds.weekends;
  box.addEventListener('change', () => save({ ...ds, weekends: box.checked }));
  wk.append(box, el('span', null, 'Weekends are workdays'));
  const acts = el('div', 'acts-row');
  const clear = el('button', 'act', 'Clear day structure');
  clear.addEventListener('click', async () => {
    suSheet = null;
    S = await api.updateSettings({ dayStructure: null });
    render();
  });
  acts.append(clear);
  sheet.append(
    sheetTop(el('span', 'su-sheet__name', 'Day structure')),
    el('p', 'hint', 'A light guide for your days. Work blocks and breaks show as faint bands; you can still plan anything anywhere.'),
    el('span', 'label', 'Workday'),
    day,
    list('work', 'Work blocks', ['14:00', '16:00']),
    list('breaks', 'Breaks', ['15:00', '15:15']),
    wk,
    acts
  );
}

// Duplicate: a small window asking how many copies.
function openDuplicate(t) {
  document.querySelectorAll('.su-modal').forEach((m) => m.remove());
  let n = 1;
  const back = el('div', 'su-modal');
  const box = el('div', 'su-modal__box');
  const count = el('span', 'su-every', '1');
  const minus = el('button', 'su-step', '−');
  const plus = el('button', 'su-step', '+');
  const paint = () => {
    count.textContent = String(n);
    go.textContent = n === 1 ? 'Duplicate once' : `Make ${n} copies`;
  };
  minus.addEventListener('click', () => n > 1 && (n--, paint()));
  plus.addEventListener('click', () => n < 20 && (n++, paint()));
  const row = el('div', 'su-custom__row');
  row.append(el('span', null, 'Copies'), minus, count, plus);
  const acts = el('div', 'su-modal__acts');
  const cancel = el('button', 'btn btn--quiet', 'Cancel');
  const go = el('button', 'btn', 'Duplicate once');
  const close = () => back.remove();
  cancel.addEventListener('click', close);
  back.addEventListener('pointerdown', (e) => e.target === back && close());
  go.addEventListener('click', async () => {
    go.disabled = true;
    go.textContent = 'Duplicating…';
    const r = await api.duplicate(t.id, n);
    if (r && r.error) return (go.textContent = r.error);
    close();
  });
  acts.append(cancel, go);
  box.append(el('span', 'su-sheet__name', 'Duplicate'), el('p', 'when', t.title), row, el('p', 'hint', 'Copies keep the length, repeat and day, and wait in the header to be planned.'), acts);
  back.append(box);
  $('view-setup').append(back);
  back.addEventListener('keydown', (e) => e.key === 'Escape' && close());
  go.focus();
}

$('su-behind').addEventListener('click', () => {
  suSheet = { type: 'behind', id: null };
  renderSetup();
});
$('su-structure').addEventListener('click', () => {
  suSheet = suSheet && suSheet.type === 'structure' ? null : { type: 'structure' };
  renderSetup();
});
$('su-close').addEventListener('click', () => (setupMode ? api.windowAction('close') : setView('now')));
$('su-add').addEventListener('keydown', async (e) => {
  if (e.key !== 'Enter' || !e.target.value.trim()) return;
  const title = e.target.value.trim();
  e.target.value = '';
  await api.task('add', null, title);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && view === 'setup' && suSheet && !e.target.matches('input, textarea')) {
    suSheet = null;
    renderSetup();
  }
});

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

const fields = { 's-client-id': 'clientId', 's-client-secret': 'clientSecret', 's-list': 'listName', 's-review': 'reviewUrl' };
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
document.querySelectorAll('#s-app-mode .tab').forEach((t) =>
  t.addEventListener('click', async () => (S = await api.updateSettings({ appMode: t.dataset.v })) && render())
);
for (const [id, key] of [['s-blur-close', 'plannerBlurClose'], ['s-shortcuts', 'shortcuts'], ['s-remind-blocks', 'remindBlocks'], ['s-remind-over', 'remindOver'], ['s-color-time', 'colorTime']])
  $(id).addEventListener('change', async (e) => (S = await api.updateSettings({ [key]: e.target.checked })) && render());
const CORNERS = [['off', 'Off'], ['tl', 'Top left'], ['tr', 'Top right'], ['bl', 'Bottom left'], ['br', 'Bottom right']];
for (const [id, key] of [['s-corner-today', 'cornerToday'], ['s-corner-week', 'cornerWeek']])
  $(id).append(
    ...CORNERS.map(([v, label]) => {
      const b = el('button', 'tab', label);
      b.dataset.v = v;
      b.addEventListener('click', async () => (S = await api.updateSettings({ [key]: v })) && render());
      return b;
    })
  );
const autoSave = async (patch) => (S = await api.updateSettings({ autoPlan: { ...S.settings.autoPlan, ...patch } })) && render();
$('s-autoplan').append(
  ...[['off', 'Off'], ['startEnd', 'Start & end of day'], ['every', 'Every few hours'], ['times', 'At set times']].map(([v, label]) => {
    const b = el('button', 'tab', label);
    b.dataset.v = v;
    b.addEventListener('click', () => autoSave({ mode: v }));
    return b;
  })
);
$('s-autoplan-every').append(
  ...[2, 3, 4].map((h) => {
    const b = el('button', 'tab', `every ${h}h`);
    b.dataset.v = h;
    b.addEventListener('click', () => autoSave({ every: h }));
    return b;
  })
);
document.querySelectorAll('#s-setup-mode .tab').forEach((t) =>
  t.addEventListener('click', async () => (S = await api.updateSettings({ setupMode: t.dataset.v })) && render())
);
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
$('web-on').addEventListener('click', async () => {
  $('web-on').disabled = true;
  $('web-status').textContent = 'Publishing…';
  const r = await api.webSetup($('s-web-token').value);
  $('web-on').disabled = false;
  $('s-web-token').value = '';
  S = await api.getState();
  renderSettings();
  if (r.error) $('web-status').textContent = r.error;
});
$('web-open').addEventListener('click', () => api.webOpen());
$('web-copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(S.web.url);
    $('web-copy').textContent = 'Copied';
    setTimeout(() => ($('web-copy').textContent = 'Copy link'), 1500);
  } catch {}
});
$('web-off').addEventListener('click', async () => {
  S = await api.webOff();
  renderSettings();
});
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
  document.querySelectorAll('#s-setup-mode .tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.v === (s.setupMode || 'modal'))));
  document.querySelectorAll('#s-app-mode .tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.v === (s.appMode || 'full'))));
  document.querySelectorAll('#s-settings-mode .tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.v === (s.settingsMode || 'inline'))));
  $('s-blur-close').checked = s.plannerBlurClose !== false;
  $('s-shortcuts').checked = s.shortcuts !== false;
  $('s-remind-blocks').checked = s.remindBlocks !== false;
  $('s-remind-over').checked = s.remindOver !== false;
  $('s-color-time').checked = !!s.colorTime;
  for (const [id, key] of [['s-corner-today', 'cornerToday'], ['s-corner-week', 'cornerWeek']])
    document.querySelectorAll('#' + id + ' .tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.v === (s[key] || 'off'))));
  const ap = s.autoPlan || { mode: 'startEnd', every: 3, times: [] };
  document.querySelectorAll('#s-autoplan .tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.v === ap.mode)));
  $('s-autoplan-every').hidden = ap.mode !== 'every';
  document.querySelectorAll('#s-autoplan-every .tab').forEach((t) => t.setAttribute('aria-selected', String(+t.dataset.v === ap.every)));
  const times = $('s-autoplan-times');
  times.hidden = ap.mode !== 'times';
  if (ap.mode === 'times' && !times.contains(document.activeElement)) {
    times.replaceChildren();
    (ap.times || []).forEach((v, i) => {
      const inp = el('input');
      inp.type = 'time';
      inp.value = v;
      inp.addEventListener('change', () => inp.value && autoSave({ times: ap.times.map((x, j) => (j === i ? inp.value : x)) }));
      const rm = el('button', 'act', '×');
      rm.addEventListener('click', () => autoSave({ times: ap.times.filter((_, j) => j !== i) }));
      times.append(inp, rm);
    });
    const add = el('button', 'act', '+ Add time');
    add.addEventListener('click', () => autoSave({ times: [...(ap.times || []), '13:00'] }));
    times.append(add);
  }
  const ds = s.dayStructure;
  $('s-autoplan-hint').textContent =
    ap.mode === 'startEnd' ? `Today at ${ds ? ds.start : '09:00'}, Week at ${ds ? ds.end : '17:30'} (from your day structure).` : ap.mode === 'every' ? 'Today, during your workday.' : ap.mode === 'times' ? 'Today, at these times.' : '';
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
  const w = S.web || {};
  $('web-setup').hidden = w.on;
  $('web-on').hidden = w.on;
  $('web-open').hidden = $('web-copy').hidden = $('web-off').hidden = !(w.on && w.url);
  if (document.activeElement !== $('web-on'))
    $('web-status').textContent = w.error
      ? w.error
      : w.on && w.url
      ? `Live at ${w.url.replace('https://', '')} · updated ${w.publishedAt ? hm(w.publishedAt) : '—'}`
      : 'Off. See today and the coming days in any browser at a private link.';
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
  if (view === 'setup') renderSetup();
  renderNow();
  if (view === 'today') renderToday();
  if (view === 'settings') renderSettings();
}

// Planner tabs (Today / Week), also switched by shortcuts, corners and auto-open.
document.querySelectorAll('.su-tab').forEach((b) =>
  b.addEventListener('click', () => {
    planTab = b.dataset.tab;
    renderSetup();
    setTimeout(scrollSetupToNow, 50);
  })
);
api.onPlannerTab((tab) => {
  if (tab === 'settings') return setView('settings');
  planTab = tab === 'today' ? 'today' : 'week';
  if (view !== 'setup') setView('setup');
  else renderSetup();
  setTimeout(scrollSetupToNow, 120);
});
$('st-close').addEventListener('click', () => setView(setupMode ? 'setup' : 'now'));
document.querySelectorAll('#s-settings-mode .tab').forEach((t) =>
  t.addEventListener('click', async () => (S = await api.updateSettings({ settingsMode: t.dataset.v })) && render())
);
// In the Planner window the gear appears only near the bottom-right corner.
if (setupMode) {
  appEl.classList.add('is-planner-win');
  document.addEventListener('mousemove', (e) => {
    const r = appEl.getBoundingClientRect();
    const dx = r.right - e.clientX;
    const dy = r.bottom - e.clientY;
    document.body.classList.toggle('near-gear', dx >= 0 && dy >= 0 && dx < 96 && dy < 72);
  });
}

// ---------- Reminders on Now: a planned block starts / running over ----------
let shownReminder = null;
// Over-time text counts up live from the goal, rounded up so it never says 0m.
function remindText() {
  const r = S && S.reminder;
  if (!r) return;
  const over = r.goal ? Date.now() - Date.parse(r.goal) : r.overMs;
  $('remind-text').textContent = r.kind === 'block' ? `Planned now · ${r.title}` : over < 60e3 ? `Planned time’s up · ${r.title}` : `${dur(Math.ceil(over / 60e3) * 60e3)} over · ${r.title}`;
}
function renderReminder() {
  const r = S.settings.appMode !== 'light' && S.reminder;
  $('remind').hidden = !r || view !== 'now';
  if (!r) return (shownReminder = null);
  if (shownReminder === r.id) return;
  shownReminder = r.id;
  jolt();
  remindText();
  const acts = $('remind-acts');
  acts.replaceChildren();
  const btn = (label, action, main) => {
    const b = el('button', 'act' + (main ? ' is-main' : ''), label);
    b.addEventListener('click', async () => ((S = await api.reminderAct(action)), render()));
    acts.append(b);
  };
  if (r.kind === 'block') btn('Start', 'start', true);
  else {
    btn('Done', 'done', true);
    btn('+15m', 'extend');
  }
  btn('Plan', 'plan');
  btn('×', 'dismiss');
}

api.onState((s) => {
  S = s;
  document.body.classList.toggle('is-light', s.settings.appMode === 'light');
  render();
  if (view === 'log' || (view === 'today' && todayTab === 'map')) loadLog();
});

api.getState().then((s) => {
  S = s;
  document.body.classList.toggle('is-light', s.settings.appMode === 'light');
  const bootTab = new URLSearchParams(location.search).get('tab');
  setView(setupMode ? (bootTab === 'settings' ? 'settings' : 'setup') : 'now');
  // Show the window only once this first frame has painted: no blink.
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      api.ready();
      setTimeout(() => document.body.classList.remove('booting'), 60);
    })
  );
  tick();
  setInterval(tick, 1000);
  setInterval(() => view === 'log' && renderLog(), 30e3);
});
