const test = require('node:test');
const assert = require('node:assert');
const { orderTasks, nextDate, repeatsOn } = require('../src/plan');

test('timed tasks first, earliest first; untimed keep list order', () => {
  const open = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
  const meta = {
    'g:a': { plan: { start: '2026-11-11T17:00:00.000Z', mins: 30 } },
    'g:c': { plan: { start: '2026-11-11T09:05:00.000Z', mins: 30 } },
    'g:d': { goal: '2026-11-11T12:00:00.000Z' },
  };
  assert.deepEqual(orderTasks(open, meta).map((t) => t.id), ['c', 'd', 'a', 'b']);
});

test('nextDate: daily, weekdays skip the weekend, weekly', () => {
  assert.equal(nextDate('2026-11-11', 'daily'), '2026-11-12');
  assert.equal(nextDate('2026-11-13', 'weekdays'), '2026-11-16'); // Fri -> Mon
  assert.equal(nextDate('2026-11-11', 'weekly'), '2026-11-18');
});

test('repeatsOn for previews', () => {
  assert.equal(repeatsOn('2026-11-11', 'daily', '2026-11-12'), true);
  assert.equal(repeatsOn('2026-11-11', 'weekdays', '2026-11-14'), false); // Sat
  assert.equal(repeatsOn('2026-11-11', 'weekly', '2026-11-18'), true);
  assert.equal(repeatsOn('2026-11-11', 'weekly', '2026-11-17'), false);
  assert.equal(repeatsOn('2026-11-11', 'daily', '2026-11-11'), false);
});

const { describe: label } = require('../src/plan');

test('custom repeats: every 2 days, every 2 weeks on Mon+Thu, monthly', () => {
  assert.equal(nextDate('2026-11-11', { every: 2, unit: 'day' }), '2026-11-13');
  const r = { every: 2, unit: 'week', days: [1, 4] }; // Mon, Thu
  assert.equal(nextDate('2026-11-11', r), '2026-11-12'); // Wed -> Thu same week
  assert.equal(nextDate('2026-11-12', r), '2026-11-23'); // Thu -> Mon two weeks on
  assert.equal(nextDate('2026-01-31', { every: 1, unit: 'month' }), '2026-02-28'); // clamps
  assert.equal(repeatsOn('2026-11-11', r, '2026-11-16'), false);
  assert.equal(repeatsOn('2026-11-11', r, '2026-11-23'), true);
  assert.equal(label(r), 'Every 2 weeks · Mon, Thu');
  assert.equal(label({ every: 1, unit: 'month' }), 'Monthly');
});
