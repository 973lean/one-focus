// Settings: the Features list and every card.
// The ui/*.js files share one global scope (plain scripts, loaded in order by index.html).

// ---------- Settings ----------

const fields = { 's-client-id': 'clientId', 's-client-secret': 'clientSecret', 's-list': 'listName', 's-review': 'reviewUrl' };
const toggles = {
  's-since': 'showSince',
  's-elapsed': 'showElapsed',
  's-ask-cat': 'askCategory',
  's-ask-rating': 'askRating',
  's-top': 'alwaysOnTop',
  's-login': 'launchAtLogin',
};
for (const [sel, key] of [['#s-check', 'checkMinutes'], ['#s-away', 'awayMinutes']])
  document.querySelectorAll(sel + ' .tab').forEach((t) =>
    t.addEventListener('click', async () => (S = await api.updateSettings({ [key]: +t.dataset.min })) && render())
  );
$('s-eod').addEventListener('change', async (e) => (S = await api.updateSettings({ endOfDay: e.target.value })) && render());
$('s-eod-off').addEventListener('click', async () => (S = await api.updateSettings({ endOfDay: '' })) && render());
document.querySelectorAll('#s-app-mode .tab').forEach((t) =>
  t.addEventListener('click', async () => (S = await api.updateSettings({ appMode: t.dataset.v })) && render())
);
for (const [id, key] of [['s-blur-close', 'plannerBlurClose'], ['s-shortcuts', 'shortcuts'], ['s-remind-blocks', 'remindBlocks'], ['s-remind-over', 'remindOver'], ['s-color-time', 'colorTime']])
  $(id).addEventListener('change', async (e) => (S = await api.updateSettings({ [key]: e.target.checked })) && render());
const CORNERS = [['off', 'Off'], ['tl', 'Top left'], ['tr', 'Top right'], ['bl', 'Bottom left'], ['br', 'Bottom right']];
for (const [id, key] of [['s-corner-today', 'cornerToday'], ['s-corner-week', 'cornerWeek']])
  $(id).append(
    ...CORNERS.map(([v, label]) => {
      const b = el('button', 'tab', label);
      b.dataset.v = v;
      b.addEventListener('click', async () => (S = await api.updateSettings({ [key]: v })) && render());
      return b;
    })
  );
const autoSave = async (patch) => (S = await api.updateSettings({ autoPlan: { ...S.settings.autoPlan, ...patch } })) && render();
$('s-autoplan').append(
  ...[['off', 'Off'], ['startEnd', 'Start & end of day'], ['every', 'Every few hours'], ['times', 'At set times']].map(([v, label]) => {
    const b = el('button', 'tab', label);
    b.dataset.v = v;
    b.addEventListener('click', () => autoSave({ mode: v }));
    return b;
  })
);
$('s-autoplan-every').append(
  ...[2, 3, 4].map((h) => {
    const b = el('button', 'tab', `every ${h}h`);
    b.dataset.v = h;
    b.addEventListener('click', () => autoSave({ every: h }));
    return b;
  })
);
document.querySelectorAll('#s-setup-mode .tab').forEach((t) =>
  t.addEventListener('click', async () => (S = await api.updateSettings({ setupMode: t.dataset.v })) && render())
);
document.querySelectorAll('#s-goal-display .tab').forEach((t) =>
  t.addEventListener('click', async () => (S = await api.updateSettings({ goalDisplay: t.dataset.v })) && render())
);
document.querySelectorAll('#s-jolt .tab').forEach((t) =>
  t.addEventListener('click', async () => (S = await api.updateSettings({ joltMinutes: +t.dataset.min })) && render())
);

for (const [id, key] of Object.entries(fields))
  $(id).addEventListener('change', async (e) => (S = await api.updateSettings({ [key]: e.target.value })) && render());
for (const [id, key] of Object.entries(toggles))
  $(id).addEventListener('change', async (e) => (S = await api.updateSettings({ [key]: e.target.checked })) && render());

$('g-connect').addEventListener('click', async () => {
  // Make sure typed-but-not-blurred values are saved first.
  const patch = {};
  for (const [id, key] of Object.entries(fields)) patch[key] = $(id).value;
  S = await api.updateSettings(patch);
  $('g-connect').disabled = true;
  $('g-msg').textContent = 'Finish signing in in your browser…';
  const r = await api.connect();
  $('g-connect').disabled = false;
  $('g-msg').textContent = r.error || 'Connected.';
});

$('app-update').addEventListener('click', () => api.installUpdate());
$('web-on').addEventListener('click', async () => {
  $('web-on').disabled = true;
  $('web-status').textContent = 'Publishing…';
  const r = await api.webSetup($('s-web-token').value);
  $('web-on').disabled = false;
  $('s-web-token').value = '';
  S = await api.getState();
  renderSettings();
  if (r.error) $('web-status').textContent = r.error;
});
$('web-open').addEventListener('click', () => api.webOpen());
$('web-copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(S.web.url);
    $('web-copy').textContent = 'Copied';
    setTimeout(() => ($('web-copy').textContent = 'Copy link'), 1500);
  } catch {}
});
$('web-off').addEventListener('click', async () => {
  S = await api.webOff();
  renderSettings();
});
$('app-check').addEventListener('click', () => api.checkUpdate());

$('g-disconnect').addEventListener('click', async () => {
  S = await api.disconnect();
  $('g-msg').textContent = 'Disconnected.';
  render();
});

const FEATURE_LIST = [
  ['planner', 'Planner', 'Plan Today and Week on your main monitor.'],
  ['clickCreate', 'Click to create', 'Click an empty spot in the Planner to add a task there.'],
  ['behind', 'Behind plan', '⚠️ marks and re-plan when the day slips.'],
  ['fit', 'Fit', 'Moves blocks up into free time in your work hours, keeping their order. Pin a task to keep it in place.'],
  ['offHours', 'Off-hours marks', 'Blocks planned outside your work hours are marked.'],
  ['=colorTime', 'Colour time', 'Overrun fades to red; done under time stays green.'],
  ['reminders', 'Reminder popups', 'When a planned block starts or you run over.'],
  ['items', 'Subtasks', 'Checklist steps inside a task, each with its own time.'],
  ['goals', 'Goal time', 'A finish-by time with a ring.'],
  ['hold', 'Hold', 'Pause a task for a call or an interruption.'],
  ['log', 'Log', 'Where your time went.'],
  ['autoNow', 'Back to Now', 'One Focus returns to the time screen after 2 minutes untouched on another tab.'],
  ['idleClaim', 'Count idle time', 'Offer to add forgotten idle time to the task you start.'],
  ['=showSince', 'When the task started', 'Under the task on Now.'],
  ['=showElapsed', 'Time on task', 'Under the task on Now.'],
  ['jolt', 'Jolt', 'A blue flash every so often so your eye comes back.'],
  ['check', 'Still on this?', 'Screens blur after a long run until you confirm.'],
  ['endOfDay', 'End of day check', 'Done or Tomorrow for a task still running.'],
  ['=askCategory', 'Category after Done', 'Pick what kind of work it was.'],
  ['=askRating', 'Rating after Done', 'Focus and vibe, 1–5.'],
  ['hopOff', 'Hop off', 'A clean exit when the day’s tasks are done.'],
];
function renderFeatures() {
  const box = $('s-features');
  if (!box || box.contains(document.activeElement)) return;
  box.replaceChildren();
  for (const [k, name, desc] of FEATURE_LIST) {
    const own = k.startsWith('=');
    const key = own ? k.slice(1) : k;
    const row = el('label', 'st-row');
    const l = el('div', 'st-l');
    l.append(el('span', 'st-name', name), el('span', 'st-desc', desc));
    const input = el('input');
    input.type = 'checkbox';
    input.checked = own ? !!S.settings[key] : feat(key);
    input.addEventListener('change', async () => {
      S = await api.updateSettings(own ? { [key]: input.checked } : { features: { [key]: input.checked } });
      render();
    });
    row.append(l, input);
    box.append(row);
  }
}

// Tiny line drawings beside a few choices, so you can see what each one does.
// Added next to the existing controls; nothing else moves.
const MON = (inner) => `<svg viewBox="0 0 34 22" width="34" height="22" aria-hidden="true"><rect x="1" y="1" width="32" height="18" rx="2.5" fill="none" stroke="currentColor" stroke-opacity=".45"/>${inner}</svg>`;
function miniSvg(kind, v) {
  const f = 'fill="currentColor"';
  if (kind === 'popup')
    return MON(v === 'bar' ? `<rect x="10" y="3.5" width="14" height="2.6" rx="1.3" ${f}/>` : v === 'center' ? `<rect x="11" y="7" width="12" height="6" rx="1.2" ${f}/>` : `<rect x="22" y="12.5" width="9" height="4.5" rx="1" ${f}/>`);
  if (kind === 'corner') {
    if (v === 'off') return MON('');
    const x = v === 'tl' || v === 'bl' ? 4 : 30;
    const y = v === 'tl' || v === 'tr' ? 4 : 16;
    return MON(`<circle cx="${x}" cy="${y}" r="2" ${f}/>`);
  }
  if (kind === 'where') {
    // Two monitors: the main one on the left, One Focus's on the right.
    const main = v === 'modal';
    return `<svg viewBox="0 0 44 22" width="44" height="22" aria-hidden="true"><rect x="1" y="2" width="24" height="15" rx="2" fill="${main ? 'currentColor' : 'none'}" fill-opacity="${main ? '.35' : '0'}" stroke="currentColor" stroke-opacity=".45"/><rect x="29" y="5" width="14" height="10" rx="1.6" fill="${main ? 'none' : 'currentColor'}" fill-opacity="${main ? '0' : '.35'}" stroke="currentColor" stroke-opacity=".45"/></svg>`;
  }
  if (kind === 'goal') {
    const ring = '<circle cx="9" cy="11" r="6" fill="none" stroke="currentColor" stroke-opacity=".25" stroke-width="1.6"/><path d="M9 5a6 6 0 0 1 5.2 9" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>';
    if (v === 'text') return '<svg viewBox="0 0 44 22" width="44" height="22" aria-hidden="true"><text x="1" y="15" font-size="10" fill="currentColor">12m left</text></svg>';
    return `<svg viewBox="0 0 44 22" width="44" height="22" aria-hidden="true">${ring}${v === 'ringPct' ? '<text x="18" y="15" font-size="10" fill="currentColor">62%</text>' : ''}</svg>`;
  }
  return '';
}
function renderMinis() {
  const s = S.settings;
  const minis = [
    ['s-popup', 'popup', s.popupStyle || 'corner'],
    ['s-corner-today', 'corner', s.cornerToday || 'off'],
    ['s-corner-week', 'corner', s.cornerWeek || 'off'],
    ['s-settings-mode', 'where', s.settingsMode === 'modal' ? 'modal' : 'inline'],
    ['s-setup-mode', 'where', s.setupMode === 'inline' ? 'inline' : 'modal'],
    ['s-goal-display', 'goal', s.goalDisplay || 'ring'],
  ];
  for (const [id, kind, v] of minis) {
    const row = $(id) && $(id).closest('.st-row');
    const l = row && row.querySelector('.st-l');
    if (!l) continue;
    let m = l.querySelector('.st-mini');
    if (!m) l.append((m = el('span', 'st-mini')));
    if (m.dataset.v !== kind + v) {
      m.dataset.v = kind + v;
      m.innerHTML = miniSvg(kind, v);
    }
  }
}

function renderSettings() {
  renderFeatures();
  if (!S) return;
  renderMinis();
  const s = S.settings;
  for (const [id, key] of Object.entries(fields)) if (document.activeElement !== $(id)) $(id).value = s[key] || '';
  for (const [id, key] of Object.entries(toggles)) $(id).checked = !!s[key];
  document.querySelectorAll('#s-jolt .tab').forEach((t) => t.setAttribute('aria-selected', String(+t.dataset.min === (s.joltMinutes || 0))));
  document.querySelectorAll('#s-goal-display .tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.v === (s.goalDisplay || 'ring'))));
  document.querySelectorAll('#s-setup-mode .tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.v === (s.setupMode || 'modal'))));
  document.querySelectorAll('#s-app-mode .tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.v === (s.appMode || 'full'))));
  document.querySelectorAll('#s-settings-mode .tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.v === (s.settingsMode || 'inline'))));
  document.querySelectorAll('#s-popup .tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.v === (s.popupStyle || 'corner'))));
  $('s-blur-close').checked = s.plannerBlurClose !== false;
  $('s-shortcuts').checked = s.shortcuts !== false;
  {
    const mods = { ctrlAlt: 'Ctrl+Alt', ctrlShift: 'Ctrl+Shift', altShift: 'Alt+Shift' };
    const mod = mods[s.shortcutMod] || mods.ctrlAlt;
    const k = { today: 'T', week: 'W', settings: 'S', ...(s.shortcutKeys || {}) };
    const taken = (S.shortcutTaken || []).length;
    $('s-shortcuts-desc').textContent = `${mod}+${k.today} Today, ${mod}+${k.week} Week, ${mod}+${k.settings} Settings.` + (taken ? ` ${taken > 1 ? 'Some are' : 'One is'} taken by another app: pick another letter.` : '');
    $('s-keys-row').hidden = s.shortcuts === false;
    document.querySelectorAll('#s-shortcut-mod .tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.v === (s.shortcutMod || 'ctrlAlt'))));
    for (const n of ['today', 'week', 'settings']) if (document.activeElement !== $('s-key-' + n)) $('s-key-' + n).value = k[n];
  }
  $('s-remind-blocks').checked = s.remindBlocks !== false;
  $('s-remind-over').checked = s.remindOver !== false;
  $('s-color-time').checked = !!s.colorTime;
  for (const [id, key] of [['s-corner-today', 'cornerToday'], ['s-corner-week', 'cornerWeek']])
    document.querySelectorAll('#' + id + ' .tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.v === (s[key] || 'off'))));
  const ap = s.autoPlan || { mode: 'startEnd', every: 3, times: [] };
  document.querySelectorAll('#s-autoplan .tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.v === ap.mode)));
  $('s-autoplan-every').hidden = ap.mode !== 'every';
  document.querySelectorAll('#s-autoplan-every .tab').forEach((t) => t.setAttribute('aria-selected', String(+t.dataset.v === ap.every)));
  const times = $('s-autoplan-times');
  times.hidden = ap.mode !== 'times';
  if (ap.mode === 'times' && !times.contains(document.activeElement)) {
    times.replaceChildren();
    (ap.times || []).forEach((v, i) => {
      const inp = el('input');
      inp.type = 'time';
      inp.value = v;
      inp.addEventListener('change', () => inp.value && autoSave({ times: ap.times.map((x, j) => (j === i ? inp.value : x)) }));
      const rm = el('button', 'act', '×');
      rm.addEventListener('click', () => autoSave({ times: ap.times.filter((_, j) => j !== i) }));
      times.append(inp, rm);
    });
    const add = el('button', 'act', '+ Add time');
    add.addEventListener('click', () => autoSave({ times: [...(ap.times || []), '13:00'] }));
    times.append(add);
  }
  const ds = s.dayStructure;
  $('s-autoplan-hint').textContent =
    ap.mode === 'startEnd' ? `Today at ${ds ? ds.start : '09:00'}, Week at ${ds ? ds.end : '17:30'} (from your day structure).` : ap.mode === 'every' ? 'Today, during your workday.' : ap.mode === 'times' ? 'Today, at these times.' : '';
  document.querySelectorAll('#s-check .tab').forEach((t) => t.setAttribute('aria-selected', String(+t.dataset.min === (s.checkMinutes ?? 120))));
  document.querySelectorAll('#s-away .tab').forEach((t) => t.setAttribute('aria-selected', String(+t.dataset.min === (s.awayMinutes || 10))));
  if (document.activeElement !== $('s-eod')) $('s-eod').value = s.endOfDay || '';
  $('s-eod-off').hidden = !s.endOfDay;
  const u = (S.app && S.app.update) || {};
  const words = {
    dev: 'running from source',
    checking: 'checking for updates…',
    current: 'up to date',
    downloading: `downloading ${u.version || 'update'}…`,
    ready: `${u.version} ready, installs on restart`,
    error: 'couldn’t check for updates',
  };
  $('app-version').textContent = `Version ${S.app ? S.app.version : ''}${words[u.status] ? ' · ' + words[u.status] : ''}`;
  $('app-update').hidden = u.status !== 'ready';
  const w = S.web || {};
  $('web-setup').hidden = w.on;
  $('web-on').hidden = w.on;
  $('web-open').hidden = $('web-copy').hidden = $('web-off').hidden = !(w.on && w.url);
  if (document.activeElement !== $('web-on'))
    $('web-status').textContent = w.error
      ? w.error
      : w.on && w.url
      ? `Live at ${w.url.replace('https://', '')} · updated ${w.publishedAt ? hm(w.publishedAt) : '—'}`
      : 'Off. See today and the coming days in any browser at a private link.';
  $('app-check').hidden = u.status === 'dev' || u.status === 'ready';
  $('app-check').classList.toggle('is-spinning', u.status === 'checking' || u.status === 'downloading');
  $('g-setup').hidden = S.connected;
  $('g-connect').hidden = S.connected;
  $('g-disconnect').hidden = !S.connected;
  $('g-status').textContent = S.connected
    ? S.today.error || `Connected. The first unfinished task in “${s.listName}” waits for you to start it.`
    : 'Not connected. One Focus will use one Google Tasks list and create it if it doesn’t exist.';
}

// Shortcut keys: the modifier pair and one letter per action.
document.querySelectorAll('#s-shortcut-mod .tab').forEach((t) =>
  t.addEventListener('click', async () => (S = await api.updateSettings({ shortcutMod: t.dataset.v })) && render())
);
for (const n of ['today', 'week', 'settings']) {
  const input = $('s-key-' + n);
  input.addEventListener('focus', () => input.select());
  input.addEventListener('input', async () => {
    const v = input.value.trim().toUpperCase();
    if (!/^[A-Z0-9]$/.test(v)) return;
    input.value = v;
    S = await api.updateSettings({ shortcutKeys: { [n]: v } });
    input.blur();
    render();
  });
}
