// Backlog mode (View tab): every open task sits in one lane.
//   active    — in flight now (often an AI workflow running). Limited by slots.
//               turn 'you' = a request: it needs you (ask says what, e.g.
//               "review the latest batch"); 'agent' = running, you wait.
//               One Focus still holds: of everything in flight, the oldest
//               request is the one thing to do now.
//   queued    — waiting for a free slot, in order.
//   evergreen — standing tasks to do while every slot is busy. Ticking one
//               only records when you last did it; it stays.
// Groups split Active: each has its own slots and words that sort tasks into
// it ("roblox, rbx"). A group can start a Claude session when a slot opens:
// for the task that just took the slot (taskMsg), or, with nothing queued,
// with a standing message (emptyMsg) so Claude finds the next thing itself.
// A session started that way holds its slot ("pending") until Claude adds its
// task, or for 15 minutes. perHour caps launches per group.
// Auto mode fills free slots from the top of the queue. Pure: no Electron.

const LANES = ['active', 'queued', 'evergreen'];
const MAX_SLOTS = 9;
const LAUNCH = ['off', 'code', 'chat'];
const PENDING_MS = 15 * 60e3;

function blank() {
  return { on: false, auto: true, slots: 3, items: {}, groups: null, pending: [], launched: [] };
}

const clamp = (n, a, z, d) => Math.min(Math.max(Math.round(+n) || d, a), z);

function normGroup(g = {}, i = 0) {
  return {
    id: String(g.id || 'g' + (i + 1)).replace(/[^\w-]/g, '').slice(0, 40) || 'g' + (i + 1),
    name: String(g.name || '').trim().slice(0, 40) || (i ? 'Group ' + (i + 1) : 'Active'),
    slots: clamp(g.slots, 1, MAX_SLOTS, 3),
    match: String(g.match || '').slice(0, 200),
    launch: LAUNCH.includes(g.launch) ? g.launch : 'off',
    dir: String(g.dir || '').slice(0, 500),
    taskMsg: g.taskMsg == null ? '{task}' : String(g.taskMsg).slice(0, 4000),
    emptyMsg: String(g.emptyMsg || '').slice(0, 4000),
    perHour: clamp(g.perHour, 1, 30, 6),
  };
}

function normalize(bl) {
  const b = { ...blank(), ...(bl || {}) };
  b.items = { ...(b.items || {}) };
  const seen = new Set();
  b.groups = (Array.isArray(b.groups) && b.groups.length ? b.groups : [{ id: 'main', name: 'Active', slots: b.slots }])
    .slice(0, 8)
    .map(normGroup)
    .map((g, i) => (seen.has(g.id) ? { ...g, id: g.id + i } : (seen.add(g.id), g)));
  b.slots = b.groups.reduce((n, g) => n + g.slots, 0);
  b.pending = (Array.isArray(b.pending) ? b.pending : []).filter((p) => p && b.groups.some((g) => g.id === p.group));
  b.launched = Array.isArray(b.launched) ? b.launched : [];
  return b;
}

const nextRank = (b, lane) => Object.values(b.items).filter((x) => x.lane === lane).reduce((n, x) => Math.max(n, x.rank || 0), 0) + 1;
const inLane = (b, lane) => Object.entries(b.items).filter(([, x]) => x.lane === lane);
const byRank = (x, y) => (x[1].rank || 0) - (y[1].rank || 0);

// Which group a task is in: chosen by hand, else the first whose words are in
// the title, else the first group.
function groupOf(b, id) {
  const it = b.items[id] || {};
  if (it.group && b.groups.some((g) => g.id === it.group)) return it.group;
  const title = String(it.title || '').toLowerCase();
  for (const g of b.groups) {
    const words = g.match.split(',').map((w) => w.trim().toLowerCase()).filter(Boolean);
    if (words.some((w) => title.includes(w))) return g.id;
  }
  return b.groups[0].id;
}
const groupById = (b, gid) => b.groups.find((g) => g.id === gid) || b.groups[0];
const activeIn = (b, gid) => inLane(b, 'active').filter(([id]) => groupOf(b, id) === gid).length;
const livePending = (b, now) => b.pending.filter((p) => Date.parse(p.until) > now.getTime());
const pendingIn = (b, gid, now) => livePending(b, now).filter((p) => p.group === gid).length;
const freeIn = (b, gid, now) => groupById(b, gid).slots - activeIn(b, gid) - pendingIn(b, gid, now);

// Tasks seen for the first time join the end of the queue; tasks no longer
// open (finished or deleted) leave. Titles are kept for the group words.
function reconcile(bl, open, now = new Date()) {
  const b = normalize(bl);
  const ids = new Set(open.map((t) => t.id));
  for (const id of Object.keys(b.items)) if (!ids.has(id)) delete b.items[id];
  for (const t of open) {
    if (b.items[t.id]) {
      if (b.items[t.id].title !== t.title) b.items[t.id] = { ...b.items[t.id], title: t.title };
      continue;
    }
    const at = t.updated && Date.parse(t.updated) < now.getTime() ? new Date(t.updated).toISOString() : now.toISOString();
    b.items[t.id] = { lane: 'queued', rank: nextRank(b, 'queued'), queuedAt: at, title: t.title };
  }
  return b.auto ? fill(b, now) : b;
}

// Each group's free slots take its queued tasks, top first.
function fill(bl, now = new Date()) {
  const b = normalize(bl);
  b.pending = livePending(b, now);
  for (const g of b.groups) {
    let free = freeIn(b, g.id, now);
    for (const [id] of inLane(b, 'queued').filter(([x]) => groupOf(b, x) === g.id).sort(byRank)) {
      if (free <= 0) break;
      b.items[id] = activate(b, b.items[id], g, now);
      free--;
    }
  }
  return b;
}

// A task taking a slot in a group that starts sessions is due one.
function activate(b, it, g, now) {
  const next = { ...it, lane: 'active', activeAt: now.toISOString(), since: now.toISOString(), turn: 'you' };
  if (g.launch !== 'off' && g.taskMsg.trim()) next.launchDue = true;
  else delete next.launchDue;
  return next;
}

// Put a task in a lane (and optionally a group) at a position (null = the
// end). Into a full group it's refused — unless a session started for that
// group is waiting: then this is its task, and takes the held slot.
function move(bl, id, lane, index = null, now = new Date(), group = null) {
  let b = normalize(bl);
  const it = b.items[id];
  if (!it || !LANES.includes(lane)) return b;
  const gid = group && b.groups.some((g) => g.id === group) ? group : groupOf(b, id);
  const changesGroup = gid !== groupOf(b, id);
  if (lane === 'active' && (it.lane !== 'active' || changesGroup) && freeIn(b, gid, now) <= 0) {
    const p = livePending(b, now).find((x) => x.group === gid);
    if (!p) return b;
    b.pending = b.pending.filter((x) => x !== p);
  }
  let next = { ...it };
  if (group && b.groups.some((g) => g.id === group)) next.group = group;
  if (lane !== it.lane) {
    if (lane === 'active') next = activate(b, next, groupById(b, gid), now);
    else {
      next = { ...next, lane };
      for (const k of ['since', 'turn', 'activeAt', 'launchDue']) delete next[k];
      if (lane === 'queued') next.queuedAt = now.toISOString();
    }
  }
  const order = inLane(b, lane)
    .filter(([x]) => x !== id)
    .sort(byRank)
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
  if (patch.noLaunch) delete next.launchDue;
  b.items[id] = next;
  return b;
}

// A group's slots (the first group when none is named). Never fewer than
// what's active in it.
function setSlots(bl, n, now = new Date(), group = null) {
  const b = normalize(bl);
  const g = groupById(b, group);
  g.slots = Math.min(Math.max(Math.round(+n) || 1, 1, activeIn(b, g.id)), MAX_SLOTS);
  b.slots = b.groups.reduce((s, x) => s + x.slots, 0);
  return b.auto ? fill(b, now) : b;
}

// Replace the groups (from Settings). Tasks whose group is gone fall back to
// the words / the first group.
function setGroups(bl, groups, now = new Date()) {
  const b = normalize({ ...normalize(bl), groups: Array.isArray(groups) && groups.length ? groups : null });
  return b.auto ? fill(b, now) : b;
}

// Sessions to start now. Tasks that just took a slot in a launching group,
// then — auto mode, nothing queued in the group, a slot free — one standing
// launch per group, which holds the slot. Each group starts at most perHour
// an hour. Returns the backlog (flags cleared, holds added) and the list.
function launches(bl, now = new Date()) {
  const b = normalize(bl);
  const hourAgo = now.getTime() - 3600e3;
  b.launched = b.launched.filter((l) => Date.parse(l.at) > hourAgo);
  b.pending = livePending(b, now);
  const used = (gid) => b.launched.filter((l) => l.group === gid).length;
  const todo = [];
  for (const [id, it] of inLane(b, 'active').filter(([, x]) => x.launchDue)) {
    const g = groupById(b, groupOf(b, id));
    const next = { ...it };
    delete next.launchDue;
    b.items[id] = next;
    if (g.launch === 'off' || used(g.id) >= g.perHour) continue;
    b.items[id] = { ...next, turn: 'agent', since: now.toISOString() }; // Claude is on it
    b.launched.push({ group: g.id, at: now.toISOString() });
    todo.push({ kind: 'task', group: g, id, title: it.title || '' });
  }
  if (b.on && b.auto)
    for (const g of b.groups) {
      if (g.launch === 'off' || !g.emptyMsg.trim() || used(g.id) >= g.perHour) continue;
      if (freeIn(b, g.id, now) <= 0) continue;
      if (inLane(b, 'queued').some(([x]) => groupOf(b, x) === g.id)) continue;
      b.pending.push({ group: g.id, at: now.toISOString(), until: new Date(now.getTime() + PENDING_MS).toISOString() });
      b.launched.push({ group: g.id, at: now.toISOString() });
      todo.push({ kind: 'empty', group: g });
    }
  return { backlog: b, todo };
}

// The message a session starts with. {task}, {group} and {id} are filled in;
// with the Claude connection on, a note says how to report back.
function message(l, mcp) {
  const tpl = l.kind === 'task' ? l.group.taskMsg : l.group.emptyMsg;
  let m = tpl.replace(/\{task\}/g, l.title || '').replace(/\{group\}/g, l.group.name).replace(/\{id\}/g, l.id || '').trim();
  if (mcp)
    m +=
      l.kind === 'task'
        ? `\n\n(One Focus task ${l.id}: use the one_focus tools — set it running while you work, send me a request when you need something from me, and set it done when finished.)`
        : `\n\n(One Focus: when you pick what to work on, add it with one_focus_add_task, status "running", group "${l.group.name}". Send me a request when you need something, and set it done when finished.)`;
  return m;
}

// What to show, in order. Active: your turn first (longest waiting first),
// then running (longest running first). Rows carry their group.
function lanes(bl, open, now = new Date()) {
  const b = normalize(bl);
  const byId = new Map(open.map((t) => [t.id, t]));
  const rows = (lane) =>
    inLane(b, lane)
      .filter(([id]) => byId.has(id))
      .map(([id, it]) => ({ ...it, task: byId.get(id), group: groupOf(b, id) }));
  const rank = (x, y) => (x.rank || 0) - (y.rank || 0);
  const active = rows('active').sort((x, y) => (x.turn === y.turn ? Date.parse(x.since) - Date.parse(y.since) : x.turn === 'you' ? -1 : 1));
  const groups = b.groups.map((g) => ({ ...g, active: active.filter((r) => r.group === g.id).length, pending: livePending(b, now).filter((p) => p.group === g.id) }));
  return { active, queued: rows('queued').sort(rank), evergreen: rows('evergreen').sort(rank), slots: b.slots, groups };
}

module.exports = { blank, normalize, reconcile, fill, move, setTurn, patchItem, setSlots, setGroups, launches, message, lanes, groupOf, LANES, MAX_SLOTS, PENDING_MS };
