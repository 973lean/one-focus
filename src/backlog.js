// Backlog mode (View tab): every open task sits in one lane.
//   active    — in flight now (often an AI workflow running). Limited by slots.
//               turn 'you' = a request: it needs you (ask says what, e.g.
//               "review the latest batch"); 'agent' = running, you wait.
//               One Focus still holds: of everything in flight, the oldest
//               request is the one thing to do now.
//   queued    — waiting for a free slot, in order.
//   evergreen — standing tasks to do while every slot is busy. Ticking one
//               only records when you last did it; it stays.
// Auto mode fills free slots from the top of the queue. Pure: no Electron.

const LANES = ['active', 'queued', 'evergreen'];
const MAX_SLOTS = 9;

function blank() {
  return { on: false, auto: true, slots: 3, items: {} };
}

function normalize(bl) {
  const b = { ...blank(), ...(bl || {}) };
  b.slots = Math.min(Math.max(Math.round(+b.slots) || 3, 1), MAX_SLOTS);
  b.items = { ...(b.items || {}) };
  return b;
}

const nextRank = (b, lane) => Object.values(b.items).filter((x) => x.lane === lane).reduce((n, x) => Math.max(n, x.rank || 0), 0) + 1;
const inLane = (b, lane) => Object.entries(b.items).filter(([, x]) => x.lane === lane);

// Tasks seen for the first time join the end of the queue; tasks no longer
// open (finished or deleted) leave. Then auto mode fills free slots.
function reconcile(bl, open, now = new Date()) {
  const b = normalize(bl);
  const ids = new Set(open.map((t) => t.id));
  for (const id of Object.keys(b.items)) if (!ids.has(id)) delete b.items[id];
  for (const t of open) {
    if (b.items[t.id]) continue;
    const at = t.updated && Date.parse(t.updated) < now.getTime() ? new Date(t.updated).toISOString() : now.toISOString();
    b.items[t.id] = { lane: 'queued', rank: nextRank(b, 'queued'), queuedAt: at };
  }
  return b.auto ? fill(b, now) : b;
}

// Move queued tasks (top first) into free slots.
function fill(bl, now = new Date()) {
  const b = normalize(bl);
  let free = b.slots - inLane(b, 'active').length;
  const queue = inLane(b, 'queued').sort((x, y) => (x[1].rank || 0) - (y[1].rank || 0));
  for (const [id] of queue) {
    if (free <= 0) break;
    b.items[id] = activate(b.items[id], now);
    free--;
  }
  return b;
}

const activate = (it, now) => ({ ...it, lane: 'active', activeAt: now.toISOString(), since: now.toISOString(), turn: 'you' });

// Put a task in a lane at a position (null = the end). Into a full Active
// lane it's refused (returns the backlog unchanged).
function move(bl, id, lane, index = null, now = new Date()) {
  const b = normalize(bl);
  const it = b.items[id];
  if (!it || !LANES.includes(lane)) return b;
  if (lane === 'active' && it.lane !== 'active' && inLane(b, 'active').length >= b.slots) return b;
  let next = { ...it };
  if (lane !== it.lane) {
    if (lane === 'active') next = activate(it, now);
    else {
      next = { ...it, lane };
      delete next.since;
      delete next.turn;
      delete next.activeAt;
      if (lane === 'queued') next.queuedAt = now.toISOString();
    }
  }
  // Re-rank the target lane with this task at its new place.
  const order = inLane(b, lane)
    .filter(([x]) => x !== id)
    .sort((x, y) => (x[1].rank || 0) - (y[1].rank || 0))
    .map(([x]) => x);
  const at = index == null ? order.length : Math.min(Math.max(index, 0), order.length);
  order.splice(at, 0, id);
  b.items[id] = next;
  order.forEach((x, i) => (b.items[x] = { ...b.items[x], rank: i + 1 }));
  return b.auto && lane !== 'active' ? fill(b, now) : b;
}

// Active: whose turn it is. Flipping restarts the clock for that state.
function setTurn(bl, id, turn, now = new Date()) {
  const b = normalize(bl);
  const it = b.items[id];
  if (!it || it.lane !== 'active' || !['you', 'agent'].includes(turn)) return b;
  b.items[id] = { ...it, turn, since: now.toISOString() };
  if (turn === 'agent') delete b.items[id].ask; // handed back: the request is answered
  return b;
}

function patchItem(bl, id, patch, now = new Date()) {
  const b = normalize(bl);
  const it = b.items[id];
  if (!it) return b;
  const next = { ...it };
  if ('link' in patch) {
    const u = String(patch.link || '').trim();
    if (/^https?:\/\/\S+$/i.test(u)) next.link = u.slice(0, 2000);
    else delete next.link;
  }
  if ('ask' in patch) {
    const a = String(patch.ask || '').trim().slice(0, 200);
    if (a && it.lane === 'active') Object.assign(next, { ask: a, turn: 'you', since: it.turn === 'you' ? it.since : now.toISOString() });
    else delete next.ask;
  }
  if (patch.didIt && it.lane === 'evergreen') next.lastDone = now.toISOString();
  b.items[id] = next;
  return b;
}

function setSlots(bl, n, now = new Date()) {
  const b = normalize(bl);
  // Never fewer slots than tasks already active.
  b.slots = Math.min(Math.max(Math.round(+n) || 1, 1, inLane(b, 'active').length), MAX_SLOTS);
  return b.auto ? fill(b, now) : b;
}

// What to show, in order. Active: your turn first (longest waiting first),
// then running (longest running first).
function lanes(bl, open) {
  const b = normalize(bl);
  const byId = new Map(open.map((t) => [t.id, t]));
  const rows = (lane) =>
    inLane(b, lane)
      .filter(([id]) => byId.has(id))
      .map(([id, it]) => ({ task: byId.get(id), ...it }));
  const rank = (x, y) => (x.rank || 0) - (y.rank || 0);
  const active = rows('active').sort((x, y) => (x.turn === y.turn ? Date.parse(x.since) - Date.parse(y.since) : x.turn === 'you' ? -1 : 1));
  return { active, queued: rows('queued').sort(rank), evergreen: rows('evergreen').sort(rank), slots: b.slots };
}

module.exports = { blank, normalize, reconcile, fill, move, setTurn, patchItem, setSlots, lanes, LANES, MAX_SLOTS };
