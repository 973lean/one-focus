// Private web view: a snapshot of today and the coming days, kept in a
// secret GitHub Gist and shown by docs/index.html (GitHub Pages) at
// https://<user>.github.io/one-focus/#<gist id>. Anyone with the link can see it.
const FILE = 'one-focus.json';
const API = 'https://api.github.com';

const dayKey = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Everything the page shows, nothing more: titles, times, totals.
function buildView({ now = new Date(), current, open, done, sessions, live, taskMeta }) {
  const today = dayKey(now);
  const sod = new Date(now);
  sod.setHours(0, 0, 0, 0);
  const goalOf = (id) => (taskMeta['g:' + id] && taskMeta['g:' + id].goal) || null;
  const blocks = [...sessions, ...(live ? [{ ...live, end: now.toISOString() }] : [])]
    .filter((s) => s.key !== 'idle' && Date.parse(s.end) > sod.getTime())
    .map((s) => ({ title: s.title, start: s.start < sod.toISOString() ? sod.toISOString() : s.start, end: s.end, hold: s.key.startsWith('hold:') }));
  const focused = blocks.filter((b) => !b.hold).reduce((n, b) => n + Date.parse(b.end) - Date.parse(b.start), 0);
  const upcoming = {};
  for (const t of open) if (t.due && t.due > today) (upcoming[t.due] = upcoming[t.due] || []).push(t.title);
  return {
    v: 1,
    updated: now.toISOString(),
    date: today,
    current: current && !current.key.startsWith('hold:') ? { title: current.title, since: current.since, goal: (taskMeta[current.key] || {}).goal || null } : current ? { title: current.title, since: current.since, hold: true } : null,
    today: [
      ...open.filter((t) => t.due && t.due <= today).map((t) => ({ title: t.title, goal: goalOf(t.id), overdue: t.due < today })),
      ...done.map((t) => ({ title: t.title, done: true })),
    ],
    blocks,
    focusedMs: focused,
    upcoming: Object.keys(upcoming)
      .sort()
      .slice(0, 7)
      .map((date) => ({ date, tasks: upcoming[date] })),
  };
}

async function gh(token, method, path, body) {
  const r = await fetch(API + path, {
    method,
    headers: {
      Authorization: 'Bearer ' + token,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': 'one-focus',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(r.status === 401 ? 'GitHub token was rejected.' : j.message || `GitHub returned ${r.status}`);
  return j;
}

// Creates the secret Gist on first publish, then updates it. Returns its id.
async function publish(token, gistId, view) {
  const files = { [FILE]: { content: JSON.stringify(view) } };
  if (gistId) {
    try {
      await gh(token, 'PATCH', `/gists/${gistId}`, { files });
      return gistId;
    } catch (e) {
      if (!/Not Found/i.test(e.message)) throw e; // deleted on GitHub: make a new one
    }
  }
  const g = await gh(token, 'POST', '/gists', { description: 'One Focus — private day view', public: false, files });
  return g.id;
}

module.exports = { buildView, publish, FILE };
