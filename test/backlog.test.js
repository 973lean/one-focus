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
