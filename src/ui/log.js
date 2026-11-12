// Log: where the time went, the day Map, and fixing a session.
// The ui/*.js files share one global scope (plain scripts, loaded in order by index.html).

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
