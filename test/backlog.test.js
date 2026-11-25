const test = require('node:test');
const assert = require('node:assert');
const B = require('../src/backlog');

const T0 = new Date('2026-11-25T10:00:00Z');
const later = (min) => new Date(T0.getTime() + min * 60e3);
const open = (...ids) => ids.map((id) => ({ id, title: id }));
const laneOf = (b, id) => b.items[id] && b.items[id].lane;
// Old-style filling for tests about slots: every queued task gets the
// 'when a slot opens' trigger (plain queued tasks no longer move by themselves).
const pull = (b, now) => B.fill(Object.keys(b.items).reduce((x, id) => (x.items[id].lane === 'queued' && !x.items[id].when ? B.patchItem(x, id, { when: 'slot' }) : x), b), now);
const R = (b, open, now, o) => { const r = B.reconcile(b, open, now, o); return r.auto ? pull(r, now) : r; };


test('new tasks queue up; auto fills the free slots from the top', () => {
  let b = { ...B.blank(), slots: 2 };
  b = R(b, open('a', 'b', 'c'), T0);
  assert.deepEqual(['a', 'b', 'c'].map((x) => laneOf(b, x)), ['active', 'active', 'queued']);
  assert.equal(b.items.a.turn, 'you');
});

test('manual mode leaves everything queued', () => {
  const b = B.reconcile({ ...B.blank(), auto: false }, open('a', 'b'), T0);
  assert.deepEqual(['a', 'b'].map((x) => laneOf(b, x)), ['queued', 'queued']);
});

test('finishing an active task pulls the next queued one in (auto)', () => {
  let b = R({ ...B.blank(), slots: 1 }, open('a', 'b', 'c'), T0);
  b = R(b, open('b', 'c'), later(5));
  assert.equal(laneOf(b, 'a'), undefined);
  assert.equal(laneOf(b, 'b'), 'active');
  assert.equal(b.items.b.since, later(5).toISOString());
  assert.equal(laneOf(b, 'c'), 'queued');
});

test('a full Active lane refuses more; slots never drop below what is active', () => {
  let b = B.reconcile({ ...B.blank(), slots: 1, auto: false }, open('a', 'b'), T0);
  b = B.move(b, 'a', 'active', null, T0);
  const before = JSON.stringify(b);
  b = B.move(b, 'b', 'active', null, T0);
  assert.equal(JSON.stringify(b), before);
  b = B.move(b, 'b', 'evergreen', null, T0);
  b = B.setSlots(b, 0, T0);
  assert.equal(b.slots, 1);
});

test('move reorders within a lane and back to the queue resets queuedAt', () => {
  let b = B.reconcile({ ...B.blank(), auto: false }, open('a', 'b', 'c'), T0);
  b = B.move(b, 'c', 'queued', 0, T0);
  assert.deepEqual(B.lanes(b, open('a', 'b', 'c')).queued.map((r) => r.task.id), ['c', 'a', 'b']);
  b = B.move(b, 'a', 'active', null, later(1));
  b = B.move(b, 'a', 'queued', null, later(9));
  assert.equal(b.items.a.queuedAt, later(9).toISOString());
  assert.equal(b.items.a.turn, undefined);
});

test('your turn sorts first, then the longest running', () => {
  let b = R({ ...B.blank(), slots: 3 }, open('a', 'b', 'c'), T0);
  b = B.setTurn(b, 'a', 'agent', later(1));
  b = B.setTurn(b, 'b', 'agent', later(2));
  b = B.setTurn(b, 'c', 'you', later(3));
  assert.deepEqual(B.lanes(b, open('a', 'b', 'c')).active.map((r) => r.task.id), ['c', 'a', 'b']);
});

test('evergreen: ticking records the time; links must be http(s)', () => {
  let b = B.reconcile({ ...B.blank(), auto: false }, open('a'), T0);
  b = B.move(b, 'a', 'evergreen', null, T0);
  b = B.patchItem(b, 'a', { didIt: true, link: 'javascript:alert(1)' }, later(4));
  assert.equal(b.items.a.lastDone, later(4).toISOString());
  assert.equal(b.items.a.link, undefined);
  b = B.patchItem(b, 'a', { link: 'https://claude.ai/chat/123' }, later(5));
  assert.equal(b.items.a.link, 'https://claude.ai/chat/123');
});

test('first seen uses the task\'s own updated time when it is earlier', () => {
  const b = B.reconcile({ ...B.blank(), auto: false }, [{ id: 'a', updated: '2026-11-24T08:00:00.000Z' }], T0);
  assert.equal(b.items.a.queuedAt, '2026-11-24T08:00:00.000Z');
});

test('a request (ask) makes it your turn; handing back clears it', () => {
  let b = R({ ...B.blank(), slots: 1 }, open('a'), T0);
  b = B.setTurn(b, 'a', 'agent', later(1));
  b = B.patchItem(b, 'a', { ask: 'Send a reference video of the jump' }, later(2));
  assert.equal(b.items.a.turn, 'you');
  assert.equal(b.items.a.since, later(2).toISOString());
  b = B.setTurn(b, 'a', 'agent', later(3));
  assert.equal(b.items.a.ask, undefined);
});

// ---------- groups and starting sessions ----------
const G = (over = {}) => [
  { id: 'rbx', name: 'Roblox', slots: 1, match: 'roblox, rbx', launch: 'code', dir: 'C:/rbx', taskMsg: 'Work on {task} ({group})', ...over.rbx },
  { id: 'copy', name: 'Copy', slots: 1, match: 'copy', launch: 'off', ...over.copy },
];
const titled = (...xs) => xs.map(([id, title]) => ({ id, title }));

test('groups: tasks sort by words; each group fills its own slots', () => {
  let b = B.setGroups({ ...B.blank(), on: true }, G(), T0);
  b = R(b, titled(['a', 'Roblox: jump'], ['b', 'Copy: hooks'], ['c', 'RBX: map'], ['d', 'Inbox']), T0);
  assert.equal(B.groupOf(b, 'a'), 'rbx');
  assert.equal(B.groupOf(b, 'd'), 'rbx'); // no words match: the first group
  assert.deepEqual(['a', 'b', 'c', 'd'].map((x) => laneOf(b, x)), ['active', 'active', 'queued', 'queued']);
  // dragging into the full Copy group is refused; into it by hand when free works
  b = B.move(b, 'c', 'active', null, T0, 'copy');
  assert.equal(laneOf(b, 'c'), 'queued');
});

test('a task taking a slot in a launching group is started once, with its message', () => {
  let b = B.setGroups({ ...B.blank(), on: true }, G(), T0);
  b = R(b, titled(['a', 'Roblox: jump'], ['b', 'Copy: hooks']), T0);
  let r = B.launches(b, T0);
  assert.deepEqual(r.todo.map((l) => [l.kind, l.id]), [['task', 'a']]); // Copy doesn't launch
  assert.equal(B.message(r.todo[0], false), 'Work on Roblox: jump (Roblox)');
  assert.match(B.message(r.todo[0], true), /One Focus task a: use the one_focus tools/);
  r = B.launches(r.backlog, later(1));
  assert.equal(r.todo.length, 0); // not again
});

test('empty group: one standing launch holds the slot until Claude adds its task', () => {
  let b = B.setGroups({ ...B.blank(), on: true }, G({ rbx: { emptyMsg: 'Pick the next Roblox task' } }), T0);
  b = B.reconcile(b, [], T0);
  let r = B.launches(b, T0);
  assert.deepEqual(r.todo.map((l) => l.kind), ['empty']);
  b = r.backlog;
  assert.equal(B.launches(b, later(1)).todo.length, 0); // the slot is held
  // a hand-dragged task can't take the held slot
  b = B.reconcile(b, titled(['u', 'Roblox: mine']), later(1));
  b = B.move(b, 'u', 'evergreen', null, later(1));
  b = B.move(b, 'u', 'active', null, later(1));
  assert.equal(laneOf(b, 'u'), 'evergreen');
  // Claude adds its task: claim frees the hold and the task takes the slot (no session for it)
  b = B.ensure(b, { id: 'x', title: 'Roblox: lobby UI' }, later(2));
  b = B.claim(b, 'x', later(2));
  b = B.move(b, 'x', 'active', null, later(2));
  assert.equal(laneOf(b, 'x'), 'active');
  assert.equal(b.pending.length, 0);
  assert.equal(B.launches(b, later(3)).todo.length, 0);
});

test('a hold that runs out is not restarted until the group changes', () => {
  let b = B.launches(B.reconcile(B.setGroups({ ...B.blank(), on: true }, G({ rbx: { emptyMsg: 'Go' } }), T0), [], T0), T0).backlog;
  let n = 0;
  for (let m = 1; m <= 600; m += 1) {
    const r = B.launches(b, later(m));
    n += r.todo.length;
    b = r.backlog;
  }
  assert.equal(n, 0); // 10 hours unattended: no stack of sessions
  // Claude's task arrives and finishes: the slot opened again, so one more start
  b = B.claim(B.ensure(b, { id: 'x', title: 'Roblox: x' }, later(601)), 'x', later(601));
  b = B.move(b, 'x', 'active', null, later(601));
  b = B.reconcile(b, [], later(602));
  assert.equal(B.launches(b, later(603)).todo.length, 1);
});

test('no standing launch without the Claude connection (it could never report back)', () => {
  const b = B.reconcile(B.setGroups({ ...B.blank(), on: true }, G({ rbx: { emptyMsg: 'Go' } }), T0), [], T0);
  assert.equal(B.launches(b, T0, { mcp: false }).todo.length, 0);
});

test('perHour caps launches for a group; capped task launches wait, not vanish', () => {
  let b = B.setGroups({ ...B.blank(), on: true }, G({ rbx: { perHour: 1, slots: 2 } }), T0);
  b = R(b, titled(['a', 'Roblox: a'], ['c', 'Roblox: c']), T0);
  let r = B.launches(b, T0);
  assert.deepEqual(r.todo.map((l) => l.id), ['a']);
  r = B.launches(r.backlog, later(30));
  assert.equal(r.todo.length, 0);
  r = B.launches(r.backlog, later(61));
  assert.deepEqual(r.todo.map((l) => l.id), ['c']);
});

test('a failed start gives back its hold and its place in the cap', () => {
  let b = B.reconcile(B.setGroups({ ...B.blank(), on: true }, G({ rbx: { emptyMsg: 'Go', perHour: 1 } }), T0), [], T0);
  const r = B.launches(b, T0);
  b = B.release(r.backlog, 'rbx', r.todo[0].at);
  assert.equal(b.pending.length, 0);
  assert.equal(b.launched.length, 0);
});

test('a sync with an older list keeps tasks added since; Claude tasks never launch', () => {
  let b = B.setGroups({ ...B.blank(), on: true }, G(), T0);
  b = R(b, titled(['a', 'Roblox: a']), T0);
  b = B.launches(b, T0).backlog;
  b = R(b, [], later(1)); // a finishes
  const fetchedAt = later(2).getTime();
  b = B.claim(B.ensure(b, { id: 'n', title: 'Roblox: new' }, later(3)), 'n', later(3));
  b = R(b, [], later(4), { since: fetchedAt }); // the older list doesn't have n yet
  assert.ok(b.items.n);
  assert.equal(laneOf(b, 'n'), 'active');
  assert.equal(B.launches(b, later(5)).todo.length, 0);
});

test('renaming an active task does not move it to another group', () => {
  let b = B.setGroups({ ...B.blank(), auto: true }, G(), T0);
  b = R(b, titled(['a', 'Copy: write']), T0);
  assert.equal(B.groupOf(b, 'a'), 'copy');
  b = R(b, titled(['a', 'Roblox copy']), later(1));
  assert.equal(B.groupOf(b, 'a'), 'copy');
});

test('message: titles with $ and braces come through as written', () => {
  const g = { name: 'Ops $&', taskMsg: 'Do: {task} in {group}', emptyMsg: '' };
  assert.equal(B.message({ kind: 'task', group: g, id: 'x', title: "Pay $' now $$ {group} $&" }, false), "Do: Pay $' now $$ {group} $& in Ops $&");
});

test('groups: duplicate ids are made unique; slots never below what is active', () => {
  const b = B.normalize({ groups: [{ id: 'a' }, { id: 'a' }, { id: 'a1' }] });
  assert.equal(new Set(b.groups.map((g) => g.id)).size, 3);
  let c = R({ ...B.blank(), slots: 3 }, titled(['x', 'x'], ['y', 'y'], ['z', 'z']), T0);
  c = B.setGroups(c, [{ id: 'main', name: 'Active', slots: 1 }], T0);
  assert.equal(c.groups[0].slots, 3);
});

test('slots per group; without groups the old single lane still works', () => {
  let b = B.setGroups({ ...B.blank() }, G(), T0);
  b = B.setSlots(b, 4, T0, 'copy');
  assert.equal(b.groups.find((g) => g.id === 'copy').slots, 4);
  assert.equal(b.slots, 5);
  const old = B.normalize({ on: true, slots: 2, items: {} });
  assert.equal(old.groups.length, 1);
  assert.equal(old.groups[0].slots, 2);
});

test("Claude's task takes its held slot, not an older queued task", () => {
  let b = B.setGroups({ ...B.blank(), on: true }, G({ rbx: { emptyMsg: 'Go' } }), T0);
  b = B.launches(B.reconcile(b, [], T0), T0).backlog; // hold
  b = B.reconcile(b, titled(['u', 'Roblox: mine']), later(1)); // queued while held
  assert.equal(laneOf(b, 'u'), 'queued');
  b = B.claim(B.ensure(b, { id: 'c', title: 'Roblox: claude' }, later(2)), 'c', later(2));
  assert.equal(laneOf(b, 'c'), 'active');
  assert.equal(laneOf(b, 'u'), 'queued');
  assert.equal(B.launches(b, later(3)).todo.length, 0);
});

test('a failed task start puts the task back to "your turn"', () => {
  let b = B.setGroups({ ...B.blank(), on: true }, G(), T0);
  b = R(b, titled(['a', 'Roblox: a']), T0);
  const r = B.launches(b, T0);
  assert.equal(r.backlog.items.a.turn, 'agent');
  b = B.release(r.backlog, 'rbx', r.todo[0].at, 'a', later(1));
  assert.equal(b.items.a.turn, 'you');
});

test('only a fresh sync prunes (prune: false keeps tasks not in the list)', () => {
  let b = B.reconcile({ ...B.blank(), auto: false }, titled(['a', 'a'], ['b', 'b']), T0);
  b = B.reconcile(b, titled(['a', 'a']), later(1), { prune: false });
  assert.ok(b.items.b);
});

test('queue positions count within the group; deadlines set and clear', () => {
  let b = B.setGroups({ ...B.blank(), auto: false }, G(), T0);
  b = B.reconcile(b, titled(['r1', 'Roblox 1'], ['c1', 'Copy 1'], ['r2', 'Roblox 2'], ['c2', 'Copy 2']), T0);
  b = B.move(b, 'r2', 'queued', 0, T0); // top of Roblox's queue
  const q = B.lanes(b, titled(['r1', 'Roblox 1'], ['c1', 'Copy 1'], ['r2', 'Roblox 2'], ['c2', 'Copy 2'])).queued;
  assert.deepEqual(q.filter((r) => r.group === 'rbx').map((r) => r.task.id), ['r2', 'r1']);
  assert.deepEqual(q.filter((r) => r.group === 'copy').map((r) => r.task.id), ['c1', 'c2']);
  b = B.move(b, 'c2', 'queued', 0, T0, 'rbx'); // dragged into Roblox's queue, at its top
  assert.equal(B.groupOf(b, 'c2'), 'rbx');
  b = B.patchItem(b, 'r1', { deadline: '2026-11-28' });
  assert.equal(b.items.r1.deadline, '2026-11-28');
  b = B.patchItem(b, 'r1', { deadline: '' });
  assert.equal(b.items.r1.deadline, undefined);
});

test('auto mode: a plain queued task waits; a trigger moves it in once', () => {
  let b = B.reconcile({ ...B.blank(), slots: 2 }, open('a', 'b', 'c'), T0);
  assert.deepEqual(['a', 'b', 'c'].map((x) => laneOf(b, x)), ['queued', 'queued', 'queued']);
  b = B.patchItem(b, 'b', { when: 'slot' });
  b = B.patchItem(b, 'c', { when: 'after:a' });
  b = B.fill(b, T0);
  assert.equal(laneOf(b, 'b'), 'active');
  assert.equal(b.items.b.when, undefined);
  assert.equal(laneOf(b, 'c'), 'queued');
  b = B.reconcile(b, open('b', 'c'), later(1)); // a done
  assert.equal(laneOf(b, 'c'), 'active');
});

test('triggers: empty group, a time; a task prompt starts its own session', () => {
  let b = B.setGroups({ ...B.blank(), on: true }, G({ rbx: { slots: 2, launch: 'off' } }), T0);
  b = B.reconcile(b, titled(['a', 'Roblox: a'], ['p', 'Roblox: p'], ['t', 'Roblox: t']), T0);
  b = B.move(b, 'a', 'active', null, T0);
  b = B.launches(b, T0).backlog;
  b = B.patchItem(b, 'p', { when: 'empty', prompt: 'Polish {task} for the trailer' });
  b = B.patchItem(b, 't', { when: 'at:' + later(30).toISOString() });
  b = B.fill(b, later(1));
  assert.equal(laneOf(b, 'p'), 'queued'); // a is active
  b = B.reconcile(b, titled(['p', 'Roblox: p'], ['t', 'Roblox: t']), later(2)); // a done -> empty
  assert.equal(laneOf(b, 'p'), 'active');
  const r = B.launches(b, later(2));
  assert.deepEqual(r.todo.map((l) => [l.id, l.how]), [['p', 'code']]);
  assert.equal(B.message(r.todo[0], false), 'Polish Roblox: p for the trailer');
  b = B.fill(r.backlog, later(31)); // time came, a slot is free (2 slots)
  assert.equal(laneOf(b, 't'), 'active');
});
