// Google Tasks: browser sign-in (OAuth loopback + PKCE) and a small API client.
const http = require('http');
const crypto = require('crypto');

const SCOPE = 'https://www.googleapis.com/auth/tasks';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const API = 'https://tasks.googleapis.com/tasks/v1';
const enc = encodeURIComponent;

class AuthError extends Error {
  constructor(message) {
    super(message);
    this.auth = true;
  }
}

const page = (msg) =>
  `<!doctype html><meta charset="utf-8"><title>One Focus</title>` +
  `<body style="background:#0B0B0C;color:#F5F5F4;font:16px system-ui;display:grid;place-items:center;height:100vh;margin:0">${msg}</body>`;

// Opens the browser, waits for Google to redirect back, returns the token response.
async function signIn({ clientId, clientSecret, openExternal }) {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const state = crypto.randomBytes(16).toString('base64url');
  let redirectUri;

  const code = await new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const u = new URL(req.url, 'http://127.0.0.1');
      if (u.pathname !== '/') {
        res.writeHead(404);
        return res.end();
      }
      const got = u.searchParams.get('code');
      const ok = got && u.searchParams.get('state') === state;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(page(ok ? 'One Focus is connected. You can close this tab.' : 'Sign-in didn’t finish. Close this tab and try again.'));
      clearTimeout(timer);
      server.close();
      if (ok) resolve(got);
      else reject(new Error(u.searchParams.get('error') === 'access_denied' ? 'Sign-in was cancelled.' : 'Sign-in failed.'));
    });
    const timer = setTimeout(() => {
      server.close();
      reject(new Error('Sign-in timed out after 5 minutes.'));
    }, 5 * 60e3);
    server.listen(0, '127.0.0.1', () => {
      redirectUri = `http://127.0.0.1:${server.address().port}`;
      const url = new URL(AUTH_URL);
      url.search = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: SCOPE,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        access_type: 'offline',
        prompt: 'consent',
        state,
      });
      openExternal(url.toString());
    });
  });

  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      code_verifier: verifier,
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error_description || j.error || `Google returned ${r.status}`);
  return j;
}

function revoke(token) {
  return fetch(`${REVOKE_URL}?token=${enc(token)}`, { method: 'POST' }).catch(() => {});
}

class Client {
  constructor({ clientId, clientSecret, refreshToken }) {
    Object.assign(this, { clientId, clientSecret, refreshToken });
    this.access = null;
    this.expires = 0;
  }

  setAccess(t) {
    this.access = t.access_token;
    this.expires = Date.now() + (t.expires_in || 0) * 1000;
  }

  async token() {
    if (this.access && Date.now() < this.expires - 60e3) return this.access;
    const r = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        refresh_token: this.refreshToken,
        grant_type: 'refresh_token',
      }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      if (j.error === 'invalid_grant' || j.error === 'invalid_client') throw new AuthError('Google sign-in expired.');
      throw new Error(j.error_description || j.error || `Google returned ${r.status}`);
    }
    this.setAccess(j);
    return this.access;
  }

  async api(method, p, body, retried = false) {
    const r = await fetch(API + p, {
      method,
      headers: {
        Authorization: 'Bearer ' + (await this.token()),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (r.status === 401 && !retried) {
      this.access = null;
      return this.api(method, p, body, true);
    }
    if (r.status === 401) throw new AuthError('Google sign-in expired.');
    if (r.status === 204) return null;
    const j = await r.json().catch(() => null);
    if (!r.ok) throw new Error(j?.error?.message || `Google returned ${r.status}`);
    return j;
  }

  // Returns the id of the list called `name`, creating it if needed.
  async ensureList(name, knownId) {
    if (knownId) {
      try {
        const l = await this.api('GET', `/users/@me/lists/${enc(knownId)}`);
        if (l.title === name) return l.id;
      } catch (e) {
        if (e.auth) throw e;
      }
    }
    let pageToken;
    do {
      const j = await this.api('GET', `/users/@me/lists?maxResults=100${pageToken ? '&pageToken=' + enc(pageToken) : ''}`);
      const hit = (j.items || []).find((l) => l.title === name);
      if (hit) return hit.id;
      pageToken = j.nextPageToken;
    } while (pageToken);
    return (await this.api('POST', '/users/@me/lists', { title: name })).id;
  }

  async listTasks(listId) {
    const out = [];
    let pageToken;
    do {
      const q = new URLSearchParams({ maxResults: '100', showCompleted: 'true', showHidden: 'true' });
      if (pageToken) q.set('pageToken', pageToken);
      const j = await this.api('GET', `/lists/${enc(listId)}/tasks?${q}`);
      out.push(...(j.items || []));
      pageToken = j.nextPageToken;
    } while (pageToken);
    return out;
  }

  patch(listId, id, body) {
    return this.api('PATCH', `/lists/${enc(listId)}/tasks/${enc(id)}`, body);
  }

  insert(listId, body, previous) {
    return this.api('POST', `/lists/${enc(listId)}/tasks${previous ? '?previous=' + enc(previous) : ''}`, body);
  }

  remove(listId, id) {
    return this.api('DELETE', `/lists/${enc(listId)}/tasks/${enc(id)}`);
  }

  // No `previous` = move to the top of the list.
  move(listId, id) {
    return this.api('POST', `/lists/${enc(listId)}/tasks/${enc(id)}/move`);
  }
}

module.exports = { signIn, revoke, Client, AuthError };
