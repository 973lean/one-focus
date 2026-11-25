// Claude Desktop runs this (One Focus.exe with ELECTRON_RUN_AS_NODE=1) as a
// stdio MCP server. Each JSON-RPC line from Claude goes to the running app's
// local endpoint; the answer comes back on stdout. argv[2] = the api.json the
// app writes ({ port, token }), read fresh each time so a new port is picked up.
// Main copies this file and claude.js into its data folder so they run
// outside the asar. With the app closed, start-up and the tool list are
// answered here and tool calls say "open One Focus".
const fs = require('fs');
const http = require('http');
const readline = require('readline');
const path = require('path');
let offline = null;
try {
  offline = require(path.join(__dirname, 'claude.js'));
} catch {}

const apiFile = process.argv[2];
const out = (m) => process.stdout.write(JSON.stringify(m) + '\n');

function post(body) {
  return new Promise((resolve, reject) => {
    let api;
    try {
      api = JSON.parse(fs.readFileSync(apiFile, 'utf8'));
    } catch {
      return reject(new Error('One Focus is not set up for Claude yet (Settings → Claude).'));
    }
    const req = http.request(
      { host: '127.0.0.1', port: api.port, path: '/mcp', method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: 'Bearer ' + api.token } },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          if (res.statusCode === 202 || !data) return resolve(null);
          try {
            resolve(JSON.parse(data));
          } catch {
            reject(new Error('One Focus sent something unexpected (' + res.statusCode + ').'));
          }
        });
      }
    );
    req.on('error', () => reject(new Error('One Focus is not running. Open it and try again.')));
    req.setTimeout(20000, () => req.destroy(new Error('One Focus did not answer in time.')));
    req.end(body);
  });
}

readline.createInterface({ input: process.stdin }).on('line', async (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return out({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
  }
  try {
    const r = await post(line);
    if (r) out(r);
  } catch (e) {
    if (msg.id === undefined || msg.id === null) return;
    if (offline && msg.method !== 'tools/call') {
      const r = await offline.handle(msg, { version: 'offline' });
      if (r) return out(r);
    }
    // Keep Claude working when the app is closed: say so as a tool result.
    if (msg.method === 'tools/call') out({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: e.message }], isError: true } });
    else out({ jsonrpc: '2.0', id: msg.id, error: { code: -32000, message: e.message } });
  }
});
