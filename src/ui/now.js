// Now: the current task, Start/Done/Hold, idle claim, after-Done, goal, jolt.
// The ui/*.js files share one global scope (plain scripts, loaded in order by index.html).

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

// The Planner's clock (time + date), same format as Now.
const plannerDateFmt = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
function plannerClock(now) {
  const t = $('su-clock-t');
  if (!t) return;
  const parts = timeFmt.formatToParts(now);
  const period = parts.find((x) => x.type === 'dayPeriod');
  const text = parts.filter((x) => x.type !== 'dayPeriod').map((x) => x.value).join('').trim();
  if (t.dataset.v !== text + (period ? period.value : '')) {
    t.dataset.v = text + (period ? period.value : '');
    t.textContent = text;
    if (period) t.append(el('span', 'p', period.value));
    t.dateTime = now.toISOString();
  }
  $('su-clock-d').textContent = plannerDateFmt.format(now);
}

function tick() {
  const now = new Date();
  if (setupMode || view === 'setup') plannerClock(now);
  const parts = timeFmt.formatToParts(now);
  const period = parts.find((x) => x.type === 'dayPeriod');
  clockEl.textContent = parts.filter((x) => x.type !== 'dayPeriod').map((x) => x.value).join('').trim();
  if (period) clockEl.append(el('span', 'clock__period', period.value));
  clockEl.dateTime = now.toISOString();
  $('date').textContent = dateFmt.format(now);
  renderMeta();
  if (feat('jolt')) maybeJolt();
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
  if (ot && ot.items && ot.items.length && S.settings.appMode !== 'light' && feat('items')) {
    const left = ot.items.filter((x) => !x.done).reduce((a, x) => a + ((S.itemMins || {})[x.id] || 0), 0);
    parts.push(`${ot.items.filter((x) => x.done).length}/${ot.items.length} items` + (left ? ` · ${hLen(left)} left` : ''));
  }
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
  // Reminders pop up on the main monitor; here they only jolt.
  renderReminder();
  // The blur's answer always shows: nothing may hide it, or the screens stay blurred.
  if (S.check === 'still') {
    confirmEl.hidden = false;
    return renderMeta();
  }
  if (S.check === 'eod') {
    eodDoneEl.hidden = !(cur && cur.googleId);
    eodTomorrowEl.hidden = false;
    return renderMeta();
  }
  if (holdpick || picking || claim) return renderMeta();
  if (hold) {
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
  if (idleMs >= 5 * 60e3 && feat('idleClaim')) {
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

api.onNowAction((a) => {
  if (a !== 'done' || setupMode) return;
  if (view !== 'now') setView('now');
  if (!doneEl.hidden || (S.current && S.current.googleId)) doneEl.click();
});

// Back to Now: another tab left open and untouched for 2 minutes returns to
// the time screen (not while you're mid-typing).
if (!setupMode) {
  let touched = Date.now();
  for (const ev of ['pointermove', 'pointerdown', 'keydown', 'wheel']) document.addEventListener(ev, () => (touched = Date.now()), { passive: true });
  setInterval(() => {
    if (view === 'now' || !feat('autoNow') || Date.now() - touched < 120e3) return;
    const a = document.activeElement;
    if (a && a.matches('input, textarea') && a.value && a.value.trim()) return;
    setView('now');
  }, 5000);
}

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

const goalOf = (key) => (S && feat('goals') && S.goals && key && S.goals[key]) || null;
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
