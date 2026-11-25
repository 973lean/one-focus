const test = require('node:test');
const assert = require('node:assert');
const B = require('../src/backlog');

const T0 = new Date('2026-11-25T10:00:00Z');
const later = (min) => new Date(T0.getTime() + min * 60e3);
const open = (...ids) => ids.map((id) => ({ id, title: id }));
const laneOf = (b, id) => b.items[id] && b.items[id].lane;

test('new tasks queue up; auto fills the free slots from the top', () => {
  let b = { ...B.blank(), slots: 2 };
  b = B.reconcile(b, open('a', 'b', 'c'), T0);
  assert.deepEqual(['a', 'b', 'c'].map((x) => laneOf(b, x)), ['active', 'active', 'queued']);
  assert.equal(b.items.a.turn, 'you');
});

test('manual mode leaves everything queued', () => {
  const b = B.reconcile({ ...B.blank(), auto: false }, open('a', 'b'), T0);
  assert.deepEqual(['a', 'b'].map((x) => laneOf(b, x)), ['queued', 'queued']);
});

test('finishing an active task pulls the next queued one in (auto)', () => {
  let b = B.reconcile({ ...B.blank(), slots: 1 }, open('a', 'b', 'c'), T0);
  b = B.reconcile(b, open('b', 'c'), later(5));
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
  let b = B.reconcile({ ...B.blank(), slots: 3 }, open('a', 'b', 'c'), T0);
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
  let b = B.reconcile({ ...B.blank(), slots: 1 }, open('a'), T0);
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
  b = B.reconcile(b, titled(['a', 'Roblox: jump'], ['b', 'Copy: hooks'], ['c', 'RBX: map'], ['d', 'Inbox']), T0);
  assert.equal(B.groupOf(b, 'a'), 'rbx');
  assert.equal(B.groupOf(b, 'd'), 'rbx'); // no words match: the first group
  assert.deepEqual(['a', 'b', 'c', 'd'].map((x) => laneOf(b, x)), ['active', 'active', 'queued', 'queued']);
  // dragging into the full Copy group is refused; into it by hand when free works
  b = B.move(b, 'c', 'active', null, T0, 'copy');
  assert.equal(laneOf(b, 'c'), 'queued');
});

test('a task taking a slot in a launching group is started once, with its message', () => {
  let b = B.setGroups({ ...B.blank(), on: true }, G(), T0);
  b = B.reconcile(b, titled(['a', 'Roblox: jump'], ['b', 'Copy: hooks']), T0);
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
  // Claude adds its task: it takes the held slot even though the group is "full"
  b = B.reconcile(b, titled(['x', 'Roblox: lobby UI']), later(2));
  b = B.move(b, 'x', 'active', null, later(2), 'rbx');
  b = B.patchItem(b, 'x', { noLaunch: true });
  assert.equal(laneOf(b, 'x'), 'active');
  assert.equal(b.pending.length, 0);
  assert.equal(B.launches(b, later(3)).todo.length, 0);
  // the hold runs out after 15 minutes if nothing comes
  let c = B.launches(B.reconcile(B.setGroups({ ...B.blank(), on: true }, G({ rbx: { emptyMsg: 'Go' } }), T0), [], T0), T0).backlog;
  assert.equal(B.launches(c, later(16)).todo.length, 1);
});

test('perHour caps launches for a group', () => {
  let b = B.setGroups({ ...B.blank(), on: true }, G({ rbx: { emptyMsg: 'Go', perHour: 2, slots: 3 } }), T0);
  b = B.reconcile(b, [], T0);
  let n = 0;
  for (let i = 0; i < 5; i++) {
    const r = B.launches(b, later(i));
    n += r.todo.length;
    b = r.backlog;
  }
  assert.equal(n, 2);
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
