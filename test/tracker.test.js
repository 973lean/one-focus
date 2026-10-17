const test = require('node:test');
const assert = require('node:assert');
const Tracker = require('../src/tracker');

const fresh = () => ({ current: null, open: null, sessions: [], completions: [], heartbeat: null });
const ago = (ms) => new Date(Date.now() - ms).toISOString();

test('switching tasks closes the previous session', () => {
  const s = fresh();
  const t = new Tracker(s, () => {});
  t.setCurrent({ key: 'g:1', title: 'A', googleId: '1' });
  s.open.start = ago(60e3);
  t.setCurrent({ key: 'g:2', title: 'B', googleId: '2' });
  assert.equal(s.sessions.length, 1);
  assert.equal(s.sessions[0].key, 'g:1');
  assert.equal(s.open.key, 'g:2');
});

test('same task does not restart; title updates', () => {
  const s = fresh();
  const t = new Tracker(s, () => {});
  t.setCurrent({ key: 'g:1', title: 'A', googleId: '1' });
  const start = s.open.start;
  assert.equal(t.setCurrent({ key: 'g:1', title: 'A2', googleId: '1' }), false);
  assert.equal(s.open.start, start);
  assert.equal(s.current.title, 'A2');
});

test('pauses stack; resume only when all reasons clear', () => {
  const s = fresh();
  const t = new Tracker(s, () => {});
  t.setCurrent({ key: 'm:x', title: 'x', googleId: null });
  s.open.start = ago(120e3);
  t.pause('lock');
  t.pause('idle');
  assert.equal(s.open, null);
  assert.equal(s.sessions.length, 1);
  t.resume('lock');
  assert.equal(s.open, null);
  t.resume('idle');
  assert.ok(s.open);
});

test('very short sessions are dropped', () => {
  const s = fresh();
  const t = new Tracker(s, () => {});
  t.setCurrent({ key: 'm:a', title: 'a', googleId: null });
  t.setCurrent({ key: 'm:b', title: 'b', googleId: null });
  assert.equal(s.sessions.length, 0);
});

test('recover closes a crashed session at the last heartbeat', () => {
  const s = fresh();
  s.current = { key: 'm:a', title: 'a', googleId: null, since: ago(3600e3) };
  s.open = { key: 'm:a', title: 'a', googleId: null, start: ago(3600e3) };
  s.heartbeat = ago(1800e3);
  new Tracker(s, () => {}).recover();
  assert.equal(s.sessions.length, 1);
  assert.equal(s.sessions[0].end, s.heartbeat);
  assert.ok(s.open && s.open.start > s.heartbeat);
});

test('completions dedupe and trackedSince sums current task', () => {
  const s = fresh();
  const t = new Tracker(s, () => {});
  const task = { key: 'g:1', title: 'A', googleId: '1' };
  t.recordCompletion(task, '2026-10-17T10:00:00.000Z');
  t.recordCompletion(task, '2026-10-17T10:00:00.000Z');
  assert.equal(s.completions.length, 1);
  t.removeCompletion('g:1');
  assert.equal(s.completions.length, 0);

  t.setCurrent(task);
  s.current.since = ago(600e3);
  s.sessions.push({ ...task, start: ago(500e3), end: ago(200e3) });
  s.sessions.push({ ...task, start: ago(900e3), end: ago(700e3) }); // before since: ignored
  assert.equal(Math.round(t.trackedSince(s.current) / 1000), 300);
});
