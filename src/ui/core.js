// Shared state, formatting helpers and view switching. Loaded first.
// The ui/*.js files share one global scope (plain scripts, loaded in order by index.html).

const api = window.oneFocus;
const $ = (id) => document.getElementById(id);
const appEl = $('app');

let S = null; // latest state from the main process
let view = 'now';
let logRange = 'today';
let logData = null;
// Features switched off in Settings → Features (on unless set false).
const feat = (k) => !(S && S.settings.features && S.settings.features[k] === false);
let logSig = '';

// ---------- formatting ----------

const timeFmt = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
const dateFmt = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
const dayFmt = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
const hm = (iso) => timeFmt.format(new Date(iso));

function dur(ms) {
  const m = Math.max(0, Math.floor(ms / 60000));
  if (m < 60) return m + 'm';
  return Math.floor(m / 60) + 'h ' + String(m % 60).padStart(2, '0') + 'm';
}

// Tasks that share a name count up in list order: "2/5". Display only.
function seriesOf(t) {
  if (!S || !S.today) return null;
  const same = S.today.open.filter((x) => x.title.trim().toLowerCase() === t.title.trim().toLowerCase());
  if (same.length < 2) return null;
  return `${same.findIndex((x) => x.id === t.id) + 1}/${same.length}`;
}
function titleWithSeries(node, t) {
  const n = t && t.id && seriesOf(t);
  if (n) node.append(el('span', 'series', n));
  return node;
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

// ---------- views ----------

// The Setup window (on the main monitor) loads this page with ?mode=setup.
const setupMode = new URLSearchParams(location.search).get('mode') === 'setup';
if (setupMode) document.body.classList.add('mode-setup');

function setView(name) {
  view = name;
  appEl.dataset.view = name;
  for (const id of ['now', 'log', 'today', 'setup', 'settings']) $('view-' + id).hidden = id !== name;
  document.querySelectorAll('.menu__item').forEach((b) => b.setAttribute('aria-current', String(b.dataset.view === name)));
  if (!setupMode) api.setView(name);
  if (name === 'log') loadLog();
  render();
  if (name === 'setup') setTimeout(scrollSetupToNow, 350);
}

document.querySelectorAll('button[data-view]').forEach((b) =>
  b.addEventListener('click', () => {
    // Setup opens as its own window on the main monitor unless set to inline.
    if (b.dataset.view === 'setup' && S && S.settings.setupMode !== 'inline') return api.openSetup('week');
    if (b.dataset.view === 'settings' && S && !setupMode && S.settings.settingsMode === 'modal') return api.openSetup('settings');
    if (b.dataset.view === 'settings' && setupMode) return setView(view === 'settings' ? 'setup' : 'settings');
    if (b.dataset.view === 'setup') planTab = 'week';
    setView(view === b.dataset.view && b.dataset.view !== 'now' ? 'now' : b.dataset.view);
  })
);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && view !== 'now' && !e.target.matches('input')) setView('now');
});

// Window controls and hover state.
api.onHover((inside) => document.body.classList.toggle('is-hover', inside));
api.onZone((zone) => {
  document.body.classList.toggle('near-menu', zone === 'menu');
  document.body.classList.toggle('near-controls', zone === 'controls');
  document.body.classList.toggle('near-gear', zone === 'gear');
});
document.querySelectorAll('.controls__btn').forEach((btn) =>
  btn.addEventListener('click', () => api.windowAction(btn.dataset.action))
);
