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
