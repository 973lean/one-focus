const test = require('node:test');
const assert = require('node:assert');
const { Client } = require('../src/google');

// Minimal fake of the Google token + Tasks endpoints.
function fakeGoogle() {
  const lists = [{ id: 'L0', title: 'Other' }];
  const tasks = { };
  const calls = [];
  global.fetch = async (url, opts = {}) => {
    const u = new URL(url);
    const method = opts.method || 'GET';
    calls.push(`${method} ${u.pathname}${u.search}`);
    const json = (status, body) => ({ ok: status < 300, status, json: async () => body });
    if (u.host === 'oauth2.googleapis.com') return json(200, { access_token: 'AT', expires_in: 3600 });
    const p = u.pathname.replace('/tasks/v1', '');
    if (p === '/users/@me/lists' && method === 'GET') return json(200, { items: lists });
    if (p === '/users/@me/lists' && method === 'POST') {
      const l = { id: 'L' + lists.length, ...JSON.parse(opts.body) };
      lists.push(l);
      tasks[l.id] = [];
      return json(200, l);
    }
    let m = p.match(/^\/lists\/([^/]+)\/tasks$/);
    if (m && method === 'GET') return json(200, { items: tasks[m[1]] });
    if (m && method === 'POST') {
      const t = { id: 'T' + Math.random().toString(36).slice(2, 7), status: 'needsAction', position: String(tasks[m[1]].length).padStart(5, '0'), ...JSON.parse(opts.body) };
      tasks[m[1]].push(t);
      return json(200, t);
    }
    m = p.match(/^\/lists\/([^/]+)\/tasks\/([^/]+)$/);
    if (m && method === 'PATCH') {
      const t = tasks[m[1]].find((x) => x.id === m[2]);
      Object.assign(t, JSON.parse(opts.body));
      if (t.status === 'completed') t.completed = new Date().toISOString();
      return json(200, t);
    }
    if (m && method === 'DELETE') {
      tasks[m[1]] = tasks[m[1]].filter((x) => x.id !== m[2]);
      return { ok: true, status: 204, json: async () => null };
    }
    return json(404, { error: { message: 'not found' } });
  };
  return { lists, tasks, calls };
}

test('ensureList creates the One Focus list once, then reuses it', async () => {
  const g = fakeGoogle();
  const c = new Client({ clientId: 'id', clientSecret: 's', refreshToken: 'r' });
  const id = await c.ensureList('One Focus');
  assert.equal(g.lists.length, 2);
  assert.equal(await c.ensureList('One Focus'), id);
  assert.equal(g.lists.length, 2);
});

test('insert, complete, rename, delete round-trip', async () => {
  const g = fakeGoogle();
  const c = new Client({ clientId: 'id', clientSecret: 's', refreshToken: 'r' });
  const list = await c.ensureList('One Focus');
  const a = await c.insert(list, { title: 'A' });
  const b = await c.insert(list, { title: 'B' }, a.id);
  assert.ok(g.calls.some((x) => x.includes(`previous=${a.id}`)));
  await c.patch(list, a.id, { status: 'completed' });
  await c.patch(list, b.id, { title: 'B2' });
  let all = await c.listTasks(list);
  assert.equal(all.find((t) => t.id === a.id).status, 'completed');
  assert.equal(all.find((t) => t.id === b.id).title, 'B2');
  await c.remove(list, a.id);
  all = await c.listTasks(list);
  assert.equal(all.length, 1);
  // Token fetched once and reused.
  assert.equal(g.calls.filter((x) => x.startsWith('POST /token')).length, 1);
});
