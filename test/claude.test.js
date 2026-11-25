const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const Claude = require('../src/claude');
const B = require('../src/backlog');

// A tiny One Focus: open tasks + a backlog, with the same moves main.js makes.
function fakeApp() {
  const app = { open: [], bl: { ...B.blank(), on: true, slots: 2 }, n: 0 };
  const view = () => ({ on: app.bl.on, auto: app.bl.auto, ...B.lanes(app.bl, app.open), open: app.open });
  const apply = (id, { status, request, link }) => {
    const it = app.bl.items[id];
    const wantActive = status === 'running' || status === 'needs_you' || (request && status !== 'queued' && status !== 'evergreen');
    if (wantActive && it.lane !== 'active') app.bl = B.move(app.bl, id, 'active');
    else if ((status === 'queued' || status === 'evergreen') && it.lane !== status) app.bl = B.move(app.bl, id, status);
    if (app.bl.items[id].lane === 'active') {
      if (status === 'running') app.bl = B.setTurn(app.bl, id, 'agent');
      if (status === 'needs_you' && !request) app.bl = B.setTurn(app.bl, id, 'you');
    }
    if (typeof request === 'string') app.bl = B.patchItem(app.bl, id, { ask: request });
    if (typeof link === 'string') app.bl = B.patchItem(app.bl, id, { link });
  };
  app.deps = {
    version: 'test',
    view,
    add: async ({ title, status, request, link }) => {
      const t = { id: 't' + ++app.n, title };
      app.open.push(t);
      app.bl = B.reconcile(app.bl, app.open);
      apply(t.id, { status, request, link });
      return t;
    },
    update: async (t, p) => {
      if (p.status === 'done') {
        app.open = app.open.filter((x) => x !== t);
        app.bl = B.reconcile(app.bl, app.open);
        return;
      }
      apply(t.id, p);
    },
  };
  return app;
}
const call = (app, name, args, id = 1) => Claude.handle({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }, app.deps);
const textOf = (r) => r.result.content[0].text;

test('initialize, tools/list, notifications and unknown methods', async () => {
  const app = fakeApp();
  const init = await Claude.handle({ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2025-03-26' } }, app.deps);
  assert.equal(init.result.protocolVersion, '2025-03-26');
  assert.ok(init.result.capabilities.tools);
  assert.match(init.result.instructions, /oldest request/);
  assert.equal(await Claude.handle({ jsonrpc: '2.0', method: 'notifications/initialized' }, app.deps), null);
  const list = await Claude.handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, app.deps);
  assert.deepEqual(list.result.tools.map((t) => t.name), ['one_focus_backlog', 'one_focus_add_task', 'one_focus_update_task']);
  const bad = await Claude.handle({ jsonrpc: '2.0', id: 3, method: 'resources/list' }, app.deps);
  assert.equal(bad.error.code, -32601);
});

test('Claude adds running work, asks for something, works again, finishes', async () => {
  const app = fakeApp();
  let r = await call(app, 'one_focus_add_task', { title: 'Roblox: jump animation pass', status: 'running', link: 'https://claude.ai/chat/1' });
  assert.match(textOf(r), /active, running/);
  const id = app.open[0].id;
  assert.equal(app.bl.items[id].link, 'https://claude.ai/chat/1');

  r = await call(app, 'one_focus_update_task', { task: 'jump animation', request: 'Send a reference video of the double jump' });
  assert.match(textOf(r), /needs the user: Send a reference video/);
  assert.equal(app.bl.items[id].turn, 'you');

  r = await call(app, 'one_focus_backlog', {});
  assert.match(textOf(r), /The one thing for the user now: Roblox: jump animation pass — Send a reference video/);

  r = await call(app, 'one_focus_update_task', { task: id, status: 'running' });
  assert.match(textOf(r), /is now running/);
  assert.equal(app.bl.items[id].ask, undefined);

  r = await call(app, 'one_focus_update_task', { task: id, status: 'done' });
  assert.match(textOf(r), /Finished/);
  assert.equal(app.open.length, 0);
});

test('a full Active lane queues the new work and says so', async () => {
  const app = fakeApp();
  await call(app, 'one_focus_add_task', { title: 'A', status: 'running' });
  await call(app, 'one_focus_add_task', { title: 'B', status: 'running' });
  const r = await call(app, 'one_focus_add_task', { title: 'C', request: 'Pick a colour' });
  assert.match(textOf(r), /queued\. Every active slot is busy/);
});

test('unknown task and missing title come back as tool errors', async () => {
  const app = fakeApp();
  let r = await call(app, 'one_focus_update_task', { task: 'nothing like this', status: 'running' });
  assert.equal(r.result.isError, true);
  r = await call(app, 'one_focus_add_task', { title: '  ' });
  assert.equal(r.result.isError, true);
});

test('findTask: id, exact title, unique partial; ambiguous is null', () => {
  const open = [{ id: '1', title: 'Copy: hooks batch 4' }, { id: '2', title: 'Copy: hooks batch 5' }, { id: '3', title: 'Roblox jump' }];
  assert.equal(Claude.findTask(open, '3').id, '3');
  assert.equal(Claude.findTask(open, 'copy: hooks batch 5').id, '2');
  assert.equal(Claude.findTask(open, 'jump').id, '3');
  assert.equal(Claude.findTask(open, 'hooks'), null);
});

// The bridge Claude Desktop runs: stdio lines in, the app's answers out.
function runBridge(apiFile, lines) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'mcp-bridge.js'), apiFile]);
    const got = [];
    let buf = '';
    p.stdout.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        got.push(JSON.parse(buf.slice(0, i)));
        buf = buf.slice(i + 1);
      }
      if (got.length >= lines.filter((l) => l.id !== undefined).length) (p.kill(), resolve(got));
    });
    for (const l of lines) p.stdin.write(JSON.stringify(l) + '\n');
    setTimeout(() => (p.kill(), resolve(got)), 5000);
  });
}

test('bridge forwards to the app with the token; without the app it still starts', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'of-claude-'));
  const apiFile = path.join(dir, 'api.json');
  const app = fakeApp();
  let seenAuth = null;
  const server = http.createServer((req, res) => {
    seenAuth = req.headers.authorization;
    let raw = '';
    req.on('data', (d) => (raw += d));
    req.on('end', async () => {
      const r = await Claude.handle(JSON.parse(raw), app.deps);
      if (!r) return res.writeHead(202).end();
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(r));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  fs.writeFileSync(apiFile, JSON.stringify({ port: server.address().port, token: 'secret' }));
  const out = await runBridge(apiFile, [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'one_focus_add_task', arguments: { title: 'Copy: batch 4', status: 'running' } } },
  ]);
  server.close();
  assert.equal(seenAuth, 'Bearer secret');
  assert.equal(out[0].result.serverInfo.name, 'one-focus');
  assert.match(out[1].result.content[0].text, /Added "Copy: batch 4"/);

  // App closed: start-up and the tool list still answer (claude.js beside the bridge), calls say why.
  fs.copyFileSync(path.join(__dirname, '..', 'src', 'mcp-bridge.js'), path.join(dir, 'mcp-bridge.js'));
  fs.copyFileSync(path.join(__dirname, '..', 'src', 'claude.js'), path.join(dir, 'claude.js'));
  const closed = await new Promise((resolve) => {
    const p = spawn(process.execPath, [path.join(dir, 'mcp-bridge.js'), apiFile]);
    const got = [];
    p.stdout.on('data', (d) => {
      for (const l of String(d).split('\n').filter(Boolean)) got.push(JSON.parse(l));
      if (got.length >= 3) (p.kill(), resolve(got));
    });
    p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }) + '\n');
    p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) + '\n');
    p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'one_focus_backlog', arguments: {} } }) + '\n');
    setTimeout(() => (p.kill(), resolve(got)), 5000);
  });
  const byId = Object.fromEntries(closed.map((m) => [m.id, m]));
  assert.equal(byId[1].result.serverInfo.name, 'one-focus');
  assert.equal(byId[2].result.tools.length, 3);
  assert.equal(byId[3].result.isError, true);
  assert.match(byId[3].result.content[0].text, /not running/);
});
