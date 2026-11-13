// Planner: Today/Week day columns, drag, click to create, side sheet.
// The ui/*.js files share one global scope (plain scripts, loaded in order by index.html).

// ---------- Setup: plan the week. Cards up top, seven day columns below. ----------
// Drag a card onto a day; drag a block to move it, its bottom edge to resize,
// back up to the header to unplan. Click a card or block for its details.

const HOUR = 48; // px per hour
const SNAP = 15; // minutes
let suDrag = null;
let suDraft = null; // an open "new task here" field: re-renders wait for it
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
// The real work sessions of a task on a day, merged when less than 10 minutes
// apart: [{ start, end, live }]. Separate stretches stay separate.
function actualSessions(key, day) {
  if (!logData) return [];
  const a0 = new Date(day).setHours(0, 0, 0, 0);
  const a1 = a0 + 86400e3;
  const all = [...logData.sessions, ...(logData.open && logData.open.key === key ? [{ ...logData.open, end: null }] : [])];
  const segs = [];
  for (const x of all) {
    if (x.key !== key) continue;
    const st = Math.max(Date.parse(x.start), a0);
    const en = Math.min(x.end ? Date.parse(x.end) : Date.now(), a1);
    if (en - st < 30e3) continue;
    segs.push({ start: st, end: en, live: !x.end });
  }
  segs.sort((x, y) => x.start - y.start);
  const out = [];
  for (const g of segs) {
    const last = out[out.length - 1];
    if (last && g.start - last.end < 10 * 60e3) {
      last.end = Math.max(last.end, g.end);
      last.live = last.live || g.live;
    } else out.push({ ...g });
  }
  return out;
}

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
  if (!feat('behind')) return { ids: new Set(), from: null, by: 0 };
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

// Work windows for a day in minutes ([[from, to]]), from the day structure.
// null = no structure set; [] = a day off.
function workWindows(d) {
  const ds = S.settings.dayStructure;
  if (!ds) return null;
  if ((d.getDay() === 0 || d.getDay() === 6) && !ds.weekends) return [];
  const w = ds.work && ds.work.length ? ds.work : [[ds.start, ds.end]];
  return w.map(([a, b]) => [toMin(a), toMin(b)]).filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
}
const outsideWork = (win, a, b) => feat('offHours') && !!win && !win.some(([x, y]) => a >= x && b <= y);

// Fit a day. The order of the blocks never changes and nothing moves later:
// each block not started yet (and not pinned) moves up into the earliest gap
// that fits, after the block before it, inside the work windows, around real
// work, and never before now. If there's no earlier gap, it stays put.
function fitDay(key) {
  const d = new Date(key + 'T00:00:00');
  const at = (ms) => Math.round((ms - d.getTime()) / 60e3);
  const isToday = key === S.todayDate;
  const nowM = isToday ? Math.ceil(at(Date.now()) / 5) * 5 : 0;
  const cur = S.current && S.current.googleId;
  const busy = [];
  const seq = []; // every planned block of the day, in its current order
  for (const t of [...S.today.open, ...S.today.done.map((x) => ({ ...x, done: true }))]) {
    const p = planOf('g:' + t.id);
    if (!p || ld(new Date(p.start)) !== key) continue;
    const a = at(Date.parse(p.start));
    const segs = actualSessions('g:' + t.id, d);
    const worked = segs.reduce((x, g) => x + (g.end - g.start), 0);
    // Only the stretches really worked are taken, not the gaps between them.
    for (const g of segs) busy.push([at(g.start), at(g.end)]);
    if (t.done || t.id === cur) {
      // Fixed. Done without tracked time keeps its slot; the running task
      // keeps the rest of its planned time from now.
      if (!segs.length) busy.push([a, a + p.mins]);
      if (t.id === cur) busy.push([nowM, nowM + Math.max(0, p.mins - Math.round(worked / 60e3))]);
      continue;
    }
    const pinned = !!metaOf('g:' + t.id).pinned;
    // Started earlier and paused: what's left is the block (its plan, as drawn).
    seq.push({ t, p, a, b: a + p.mins, fixed: pinned });
  }
  seq.sort((x, y) => x.a - y.a || x.b - y.b);
  for (const x of seq) if (x.fixed) busy.push([x.a, x.b]);
  if (!seq.some((x) => !x.fixed)) return [];
  let win = workWindows(d);
  if (!win || !win.length) win = [[0, 24 * 60]];
  const free = (t0, len) => !busy.some(([ba, bb]) => t0 < bb && t0 + len > ba);
  const out = [];
  let after = nowM; // the end of the block before, as placed
  for (const x of seq) {
    if (x.fixed) {
      after = Math.max(after, x.b);
      continue;
    }
    const len = x.p.mins;
    let placed = null;
    for (const [wa, wb] of win) {
      for (let t0 = Math.max(wa, after); t0 + len <= wb && t0 < x.a; t0 += 5) {
        if (free(t0, len)) {
          placed = t0;
          break;
        }
      }
      if (placed !== null) break;
    }
    if (placed === null) placed = x.a; // nothing earlier: stays where it is
    busy.push([placed, placed + len]);
    after = Math.max(after, placed + len);
    if (placed !== x.a) out.push({ id: x.t.id, start: new Date(d.getTime() + placed * 60e3).toISOString(), mins: len });
  }
  return out;
}

let fitUndo = null; // { list, timer }
async function fit() {
  const days = planTab === 'today' ? [S.todayDate] : Array.from({ length: 7 }, (_, i) => { const x = new Date(); x.setDate(x.getDate() + i); return ld(x); });
  const list = days.flatMap(fitDay);
  if (!list.length) return flashTool($('su-fit'), 'Nothing to move up');
  const before = list.map((x) => ({ id: x.id, ...planOf('g:' + x.id) }));
  S = await api.planMany(list);
  clearTimeout(fitUndo && fitUndo.timer);
  fitUndo = { list: before, timer: setTimeout(() => ((fitUndo = null), renderSetup()), 12000) };
  render();
}
function flashTool(b, text) {
  const was = b.textContent;
  b.textContent = text;
  setTimeout(() => (b.textContent = was), 1400);
}

function openDraft(col, day, min, px) {
  const start = new Date(day);
  start.setHours(0, min, 0, 0);
  const mins = 30;
  const box = el('div', 'su-draft');
  box.style.top = px(min) + 'px';
  box.style.height = mins * (HOUR / 60) - 2 + 'px';
  const input = el('input');
  input.type = 'text';
  input.maxLength = 300;
  input.placeholder = 'New task';
  box.append(input, el('span', 'w', `${hm(start)}–${hm(start.getTime() + mins * 60e3)} · ${hLen(mins)}`));
  col.append(box);
  suDraft = { box };
  const close = () => {
    if (!suDraft || suDraft.box !== box) return;
    suDraft = null;
    box.remove();
    renderSetup();
  };
  input.addEventListener('keydown', async (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') return close();
    if (e.key !== 'Enter' || !input.value.trim()) return;
    const title = input.value.trim();
    input.disabled = true;
    box.classList.add('is-saving');
    S = await api.addPlanned(title, { start: start.toISOString(), mins });
    close();
  });
  input.addEventListener('blur', () => !input.disabled && setTimeout(close, 120));
  requestAnimationFrame(() => input.focus());
}

// The running task, at the top of the Planner: Done or Hold without leaving.
let nowHoldOpen = false;
function renderNowStrip() {
  const box = $('su-live');
  const cur = S.current;
  box.hidden = !cur || S.settings.appMode === 'light';
  const typing = document.activeElement && document.activeElement.matches('input') && box.contains(document.activeElement);
  if (box.hidden || typing) return;
  box.replaceChildren();
  const hold = cur.key && cur.key.startsWith('hold:');
  const spent = S.tracked + (S.open && S.open.key === cur.key ? Date.now() - Date.parse(S.open.start) : 0);
  box.classList.toggle('is-hold', !!hold);
  box.append(el('span', 'dot'), el('span', 'su-live__t', (hold ? 'Hold: ' : '') + cur.title), el('span', 'su-live__d', hLen(spent / 60e3)));
  const btn = (label, title, fn, cls) => {
    const b = el('button', 'su-live__b' + (cls ? ' ' + cls : ''), label);
    b.title = title;
    b.addEventListener('click', fn);
    box.append(b);
    return b;
  };
  if (hold) {
    btn(S.held ? 'Back' : 'End hold', S.held ? 'Back to: ' + S.held.title : 'End hold', async () => ((S = await api.endHold()), render()), 'is-main');
    return;
  }
  if (cur.googleId) btn('Done', 'Done (the questions show on One Focus)', () => api.nowAction('done'), 'is-main');
  if (feat('hold')) btn('Hold', 'Pause this for something else', () => ((nowHoldOpen = !nowHoldOpen), renderNowStrip()));
  if (nowHoldOpen && feat('hold')) {
    const pick = el('div', 'su-live__pick');
    const go = async (name) => {
      nowHoldOpen = false;
      if (document.activeElement) document.activeElement.blur();
      S = await api.hold(name);
      render();
    };
    for (const n of (S.holdNames || []).slice(0, 3)) {
      const c = el('button', 'su-live__b', n);
      c.addEventListener('click', () => go(n));
      pick.append(c);
    }
    const input = el('input');
    input.placeholder = 'What pulled you away?';
    input.maxLength = 60;
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') return (nowHoldOpen = false), renderNowStrip();
      if (e.key === 'Enter' && input.value.trim()) go(input.value.trim());
    });
    pick.append(input);
    box.append(pick);
    setTimeout(() => input.focus(), 30);
  }
}

function renderSetup() {
  if (!S || suDrag || suDraft) return;
  const behindNow = behindToday();
  renderNowStrip();
  // Until a Day structure is set: a quiet nudge (Fit, off-hours marks and
  // opening by itself all lean on it). "Not now" hides it for the day.
  let dsLater = null;
  try { dsLater = localStorage.getItem('dsHintLater'); } catch {}
  $('su-dshint').hidden = !!S.settings.dayStructure || dsLater === S.todayDate || S.settings.appMode === 'light';
  $('su-fit-undo').hidden = !fitUndo;
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

  // Header cards: every task not yet on the calendar.
  const tray = $('su-tray');
  tray.replaceChildren();
  if (!S.connected) tray.append(el('span', 'su-note', 'Connect Google Tasks in Settings to plan your tasks here.'));
  else {
    const unplanned = S.today.open.filter((t) => !planOf('g:' + t.id));
    for (const t of unplanned) {
      const m = metaOf('g:' + t.id);
      const tag = t.due ? (t.due === S.todayDate ? 'today' : t.due < S.todayDate ? 'overdue' : shortDay.format(new Date(t.due + 'T12:00:00'))) : null;
      const items = feat('items') && t.items && t.items.length ? `${t.items.filter((x) => x.done).length}/${t.items.length} items` : null;
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
  // Click an empty spot: type a task right there (like a calendar).
  col.addEventListener('click', (e) => {
    if (suDraft || suDrag || Date.now() - suDragEnded < 500 || !feat('clickCreate') || e.target.closest('.su-block, .su-break, .su-actual, .su-draft, button')) return;
    if (S.settings.appMode === 'light' || !S.connected) return;
    const y = e.clientY - col.getBoundingClientRect().top;
    const min = Math.min(Math.max(h0 * 60 + Math.floor(((y / HOUR) * 60) / 15) * 15, h0 * 60), h1 * 60 - 15);
    openDraft(col, d, min, px);
  });

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
  // Planned tasks. Not started: the plan as a dashed outline you can drag.
  // Started: one solid card for when you really worked on it (title inside),
  // with the plan left behind as a faint dashed outline in the same lane.
  // Cards that overlap sit side by side, like a calendar.
  const behind = i === 0 ? behindToday() : { ids: new Set() };
  const dayWin = workWindows(d);
  const items = []; // { a, b (minutes), nodes }
  const at = (ms) => { const x = new Date(ms); return Math.round((x.getTime() - d.getTime()) / 60e3); };
  for (const t of [...S.today.open, ...S.today.done.map((x) => ({ ...x, done: true }))]) {
    const p = planOf('g:' + t.id);
    if (!p || ld(new Date(p.start)) !== key) continue;
    total += p.mins;
    const s = new Date(p.start);
    const pEnd = s.getTime() + p.mins * 60e3;
    const m = metaOf('g:' + t.id);
    const segs = actualSessions('g:' + t.id, d);
    const real = segs.length ? { start: segs[0].start, end: segs[segs.length - 1].end, live: segs.some((g) => g.live) } : null;
    const running = S.current && S.current.googleId === t.id;
    const pa = at(s.getTime());
    const pb = pa + p.mins;
    // Started, paused, and the rest planned for later: the work so far is a
    // plain record, and the rest is a normal dashed block you can move.
    const later = real && !t.done && !running && pa >= at(real.end) - 1;
    if (later) {
      for (const g of segs) {
        const ga = at(g.start);
        const len = g.end - g.start;
        const rec = el('div', 'su-block is-real' + (len <= 35 * 60e3 ? ' is-short' : ''));
        rec.style.top = px(ga) + 'px';
        rec.style.height = Math.max((len / 60e3) * (HOUR / 60) - 2, 14) + 'px';
        rec.append(titleWithSeries(el('span', 't', t.title), t), el('span', 'w', `${hm(g.start)}–${hm(g.end)} · ${hLen(len / 60e3)}`));
        rec.title = `${t.title}\nWorked ${hm(g.start)}–${hm(g.end)} · ${hLen(len / 60e3)}`;
        items.push({ a: ga, b: Math.max(at(g.end), ga + 1), nodes: [rec] });
      }
    }
    if (!real || later) {
      const isBehind = behind.ids.has(t.id);
      const offHours = !t.done && outsideWork(dayWin, pa, pb);
      const blk = el('div', 'su-block is-plan' + (running ? ' is-running' : '') + (p.mins <= 20 ? ' is-short' : '') + (t.done ? ' is-done' : '') + (isBehind ? ' is-behind' : '') + (offHours ? ' is-off' : ''));
      blk.style.top = px(pa) + 'px';
      blk.style.height = Math.max(p.mins * (HOUR / 60) - 2, 16) + 'px';
      blk.append(titleWithSeries(el('span', 't', t.title), t), el('span', 'w', (p.mins <= 20 ? hm(s) : `${hm(s)}–${hm(pEnd)}`) + ` · ${hLen(p.mins)}` + (m.repeat ? ' · ↻' : '') + (offHours ? ' · off hours' : '')));
      blk.title = t.title + (offHours ? '\nOutside your work hours (Day structure).' : '');
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
      items.push({ a: pa, b: pb, nodes: [blk] });
      continue;
    }
    // One solid card per stretch you really worked on it; the title and the
    // totals sit on the last one. Colour follows the running total: neutral
    // until the planned time is used up, then a fade into red.
    const worked = segs.reduce((x, g) => x + (g.end - g.start), 0);
    const planMs = p.mins * 60e3;
    const overMs = worked - planMs;
    const under = S.settings.colorTime && t.done && worked < planMs * 0.8;
    const tail = (real.live ? 'so far ' : '') + hLen(worked / 60e3) + (overMs > 60e3 ? ` · ${hLen(overMs / 60e3)} over` : ` of ${hLen(p.mins)}`);
    let before = 0;
    const cards = [];
    segs.forEach((g, gi) => {
      const len = g.end - g.start;
      const ga = at(g.start);
      const last = gi === segs.length - 1;
      const short = len <= 35 * 60e3;
      const blk = el('div', 'su-block is-real' + (g.live ? ' is-live' : '') + (running && g.live ? ' is-running' : '') + (short ? ' is-short' : '') + (t.done ? ' is-done' : '') + (under ? ' is-under' : ''));
      blk.style.top = px(ga) + 'px';
      blk.style.height = Math.max((len / 60e3) * (HOUR / 60) - 2, 14) + 'px';
      if (S.settings.colorTime && before + len > planMs + 60e3) {
        const from = Math.max(0, Math.min(100, ((planMs - before) / len) * 100));
        blk.style.background = `linear-gradient(to bottom, #2F2F2F 0%, #2F2F2F ${from}%, #592F2C 100%)`;
      }
      before += len;
      const span = `${hm(g.start)}–${g.live ? 'now' : hm(g.end)}`;
      blk.append(titleWithSeries(el('span', 't', t.title), t), el('span', 'w', last ? (short ? tail : `${span} · ${tail}`) : `${span} · ${hLen(len / 60e3)}`));
      blk.title = `${t.title}\nPlanned ${hm(s)}–${hm(pEnd)} · ${hLen(p.mins)}\nWorked ${segs.map((x) => `${hm(x.start)}–${x.live ? 'now' : hm(x.end)}`).join(', ')} · ${hLen(worked / 60e3)}`;
      if (!t.done) {
        // Not done: click for details (Length is there), drag to move the plan.
        blk.style.cursor = 'grab';
        blk.addEventListener('pointerdown', (e) => beginDrag(e, { kind: 'task', task: t, mode: 'move', mins: p.mins, start: p.start, block: blk }));
      }
      cards.push({ a: ga, b: Math.max(at(g.end), ga + 1), nodes: [blk] });
    });
    // The plan outline (unfinished tasks only) rides with the stretch it overlaps most.
    if (!t.done) {
      const ghost = el('div', 'su-planghost');
      ghost.style.top = px(pa) + 'px';
      ghost.style.height = Math.max(p.mins * (HOUR / 60) - 2, 6) + 'px';
      const ov = (c) => Math.max(0, Math.min(c.b, pb) - Math.max(c.a, pa));
      const host = cards.reduce((x, c) => (ov(c) > ov(x) ? c : x), cards[0]);
      host.nodes.unshift(ghost);
      host.a = Math.min(host.a, pa);
      host.b = Math.max(host.b, pb);
    }
    items.push(...cards);
  }
  for (const n of col.querySelectorAll('.su-block.is-break, .su-block.is-ghost')) {
    const a = h0 * 60 + parseFloat(n.style.top) / (HOUR / 60);
    items.push({ a, b: a + (parseFloat(n.style.height) + 2) / (HOUR / 60), nodes: [n], placed: true });
  }
  // Lanes: overlapping cards share the width.
  items.sort((x, y) => x.a - y.a || y.b - x.b);
  let group = [];
  let groupEnd = -1;
  const flush = () => {
    const lanes = [];
    for (const it of group) {
      let l = lanes.findIndex((end) => end <= it.a);
      if (l < 0) l = lanes.length;
      lanes[l] = it.b;
      it.lane = l;
    }
    const n = lanes.length;
    const gutter = wide ? 14 : 0;
    for (const it of group)
      for (const node of it.nodes) {
        if (n > 1) {
          node.style.left = `calc((100% - ${gutter}px) * ${it.lane / n})`;
          node.style.width = `calc((100% - ${gutter}px) / ${n} - 3px)`;
          node.style.right = 'auto';
        }
        if (!it.placed) col.append(node);
      }
    group = [];
  };
  for (const it of items) {
    if (group.length && it.a >= groupEnd) flush();
    group.push(it);
    groupEnd = Math.max(groupEnd, it.b);
  }
  if (group.length) flush();

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

let suDragEnded = 0;
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
  // The release after a drag also fires a click on the column: not a "new task here".
  if (d.moved) suDragEnded = Date.now();
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
    // Fit: by default a block moves up into free time; pinned ones stay put.
    if (feat('fit')) {
      const pin = tabsRow([[false, 'Moves up'], [true, 'Stays put']], !!m.pinned, async (v) => ((S = await api.setMeta('g:' + t.id, { pinned: v })), render()));
      sheet.append(el('span', 'label', 'Fit'), pin);
    }
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
      // A time for each item: tap to pick, tap the picked one again to clear.
      const im = (S.itemMins || {})[it.id];
      const time = el('button', 'act it-time' + (im ? ' is-set' : ''), im ? hLen(im) : '+ time');
      time.title = 'Time for this item';
      time.addEventListener('click', () => {
        const pick = el('span', 'it-pick');
        for (const n of [5, 10, 15, 20, 30, 45, 60, 90]) {
          const c = el('button', 'act' + (n === im ? ' is-on' : ''), n < 60 ? n + 'm' : n / 60 + 'h' + (n % 60 ? ' ' + (n % 60) + 'm' : ''));
          c.addEventListener('click', async () => ((S = await api.item(t.id, 'mins', it.id, n === im ? 0 : n)), render()));
          pick.append(c);
        }
        time.replaceWith(pick);
      });
      li.append(check, el('span', 't', it.title), time, x);
      items.append(li);
    }
    const addItem = el('input');
    addItem.type = 'text';
    addItem.placeholder = 'Add a subtask';
    addItem.addEventListener('keydown', async (e) => {
      if (e.key !== 'Enter' || !addItem.value.trim()) return;
      const v = addItem.value.trim();
      addItem.value = '';
      S = await api.item(t.id, 'add', null, v);
      render();
      setTimeout(() => {
        const again = document.querySelector('#su-sheet input[placeholder="Add a subtask"]');
        if (again) again.focus();
      }, 50);
    });
    const doneItems = (t.items || []).filter((x) => x.done).length;
    const itemsTime = (t.items || []).reduce((a, x) => a + ((S.itemMins || {})[x.id] || 0), 0);
    if (feat('items'))
      sheet.append(el('span', 'label', (t.items && t.items.length ? `Subtasks · ${doneItems}/${t.items.length}` : 'Subtasks') + (itemsTime ? ` · ${hLen(itemsTime)}` : '')), items, addItem);
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
$('su-fit').addEventListener('click', () => fit());
$('su-dshint-go').addEventListener('click', () => $('su-structure').click());
$('su-dshint-x').addEventListener('click', () => {
  try { localStorage.setItem('dsHintLater', S.todayDate); } catch {}
  renderSetup();
});
$('su-fit-undo').addEventListener('click', async () => {
  if (!fitUndo) return;
  const list = fitUndo.list.filter((x) => x.start);
  clearTimeout(fitUndo.timer);
  fitUndo = null;
  S = await api.planMany(list);
  render();
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
