const test = require('node:test');
const assert = require('node:assert');
const { buildView, publish } = require('../src/web');

test('buildView: today, blocks, upcoming, nothing private beyond titles/times', () => {
  const now = new Date('2026-11-04T15:00:00');
  const v = buildView({
    now,
    current: { key: 'g:a', title: 'Brief', since: '2026-11-04T14:00:00.000Z' },
    open: [
      { id: 'a', title: 'Brief', due: '2026-11-04' },
      { id: 'b', title: 'Old', due: '2026-11-01' },
      { id: 'c', title: 'Later', due: '2026-11-06' },
      { id: 'd', title: 'Undated', due: null },
    ],
    done: [{ id: 'x', title: 'Inbox' }],
    sessions: [
      { key: 'g:a', title: 'Brief', start: new Date('2026-11-04T09:00:00').toISOString(), end: new Date('2026-11-04T10:00:00').toISOString() },
      { key: 'idle', title: 'Idle', start: new Date('2026-11-04T10:00:00').toISOString(), end: new Date('2026-11-04T10:30:00').toISOString() },
    ],
    live: null,
    taskMeta: { 'g:a': { goal: '2026-11-04T16:00:00.000Z', rating: 4 } },
  });
  assert.equal(v.date, '2026-11-04');
  assert.deepEqual(v.today.map((t) => t.title), ['Brief', 'Old', 'Inbox']);
  assert.equal(v.today[1].overdue, true);
  assert.equal(v.blocks.length, 1); // idle left out
  assert.equal(v.focusedMs, 3600e3);
  assert.deepEqual(v.upcoming, [{ date: '2026-11-06', tasks: ['Later'] }]);
  assert.equal(JSON.stringify(v).includes('rating'), false);
});

test('publish creates a secret gist, then patches it', async () => {
  const calls = [];
  global.fetch = async (url, o) => {
    calls.push(o.method + ' ' + url.replace('https://api.github.com', ''));
    if (o.method === 'POST') assert.equal(JSON.parse(o.body).public, false);
    return { ok: true, status: 200, json: async () => ({ id: 'G1' }) };
  };
  assert.equal(await publish('t', null, { v: 1 }), 'G1');
  assert.equal(await publish('t', 'G1', { v: 1 }), 'G1');
  assert.deepEqual(calls, ['POST /gists', 'PATCH /gists/G1']);
});
