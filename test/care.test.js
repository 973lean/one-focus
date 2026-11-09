const test = require('node:test');
const assert = require('node:assert');
const { dueReminder, countByDay } = require('../src/care');

const t0 = Date.parse('2026-11-09T09:00:00Z');
const at = (min) => new Date(t0 + min * 60e3).toISOString();

test('water due after its interval, only when present', () => {
  const settings = { waterMinutes: 30, walkMinutes: 0 };
  const last = { water: at(0) };
  assert.equal(dueReminder({ now: t0 + 29 * 60e3, last, settings, present: true }), null);
  assert.equal(dueReminder({ now: t0 + 30 * 60e3, last, settings, present: true }), 'water');
  assert.equal(dueReminder({ now: t0 + 30 * 60e3, last, settings, present: false }), null);
});

test('off means never; walk after water when both due', () => {
  assert.equal(dueReminder({ now: t0 + 999 * 60e3, last: {}, settings: { waterMinutes: 0, walkMinutes: 0 }, present: true }), null);
  const last = { water: at(50), walk: at(0) };
  assert.equal(dueReminder({ now: t0 + 60 * 60e3, last, settings: { waterMinutes: 45, walkMinutes: 60 }, present: true }), 'walk');
});

test('countByDay groups water and walks', () => {
  const c = countByDay([{ kind: 'water', at: at(0) }, { kind: 'water', at: at(60) }, { kind: 'walk', at: at(90) }], () => 'Mon');
  assert.deepEqual(c, { Mon: { water: 2, walk: 1 } });
});
