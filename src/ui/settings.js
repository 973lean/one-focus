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
    const mods = { ctrlAlt: 'Ctrl+Alt', ctrlShift: 'Ctrl+Shift', altShift: 'Alt+Shift', shift: 'Shift' };
    const mod = mods[s.shortcutMod] || mods.ctrlAlt;
    const fk = s.shortcutMod === 'shift';
    const k = fk ? { today: 'F8', week: 'F9', settings: 'F10', ...(s.shortcutFKeys || {}) } : { today: 'T', week: 'W', settings: 'S', ...(s.shortcutKeys || {}) };
    const taken = (S.shortcutTaken || []).map((a) => a.replace('CommandOrControl', 'Ctrl'));
    $('s-shortcuts-desc').textContent = `${mod}+${k.today} Today, ${mod}+${k.week} Week, ${mod}+${k.settings} Settings.` + (taken.length ? ` ${taken.join(', ')} ${taken.length > 1 ? 'are' : 'is'} taken by another app: pick another letter.` : '');
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
  renderGroups();
  // Claude: on/off, then add to Claude Desktop / copy the Claude Code command.
  const cl = S.claude || {};
  $('cl-on').hidden = !!cl.on;
  $('cl-desktop').hidden = $('cl-code').hidden = $('cl-off').hidden = $('cl-hint').hidden = !cl.on;
  if (!$('cl-desktop').dataset.busy) $('cl-desktop').textContent = cl.desktop ? 'In Claude Desktop ✓' : 'Add to Claude Desktop';
  $('cl-status').textContent = cl.error
    ? cl.error
    : cl.on
    ? `On${cl.port ? '' : ' · starting…'}. Claude can add its work to your backlog, mark it running, ask you for things and finish it.`
    : 'Off. Let Claude put its work on your backlog: running tasks, requests for you, links back to the chat.';
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
    if (S.settings.shortcutMod === 'shift') {
      // F-keys: type 9 or F9 (wait for a second digit after 1, for F10–F12).
      const f = v.replace(/^F?/, '');
      if (!/^([2-9]|1[0-2]?)$/.test(f) || f === '1') return;
      input.value = 'F' + f;
      S = await api.updateSettings({ shortcutFKeys: { [n]: 'F' + f } });
    } else {
      if (!/^[A-Z0-9]$/.test(v)) return;
      input.value = v;
      S = await api.updateSettings({ shortcutKeys: { [n]: v } });
    }
    input.blur();
    render();
  });
  // F1: press Enter after typing 1 (it can't tell 1 from the start of 10–12).
  input.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter' || S.settings.shortcutMod !== 'shift') return;
    if (input.value.trim().toUpperCase().replace(/^F?/, '') === '1') {
      S = await api.updateSettings({ shortcutFKeys: { [n]: 'F1' } });
      input.blur();
      render();
    }
  });
}

// Search: cards without a match hide; inside the rest, matching settings get
// a light highlight and the matched words are marked. Escape clears.
function settingsFilter() {
  const input = $('st-search');
  const q = input.value.trim().toLowerCase();
  const cards = document.querySelectorAll('#view-settings .st-card');
  let shown = 0;
  const mark = (node, on) => {
    // Mark the match inside the setting's name (restored from the original text).
    if (!node) return;
    if (node.dataset.orig == null) node.dataset.orig = node.textContent;
    const text = node.dataset.orig;
    const i = on ? text.toLowerCase().indexOf(q) : -1;
    if (i < 0) return void (node.textContent = text);
    node.replaceChildren(text.slice(0, i), el('mark', null, text.slice(i, i + q.length)), text.slice(i + q.length));
  };
  for (const card of cards) {
    const head = card.querySelector('.st-h');
    const rows = [...card.querySelectorAll('.st-row, .field')];
    const titleHit = !!q && head && head.textContent.toLowerCase().includes(q);
    let hits = 0;
    for (const r of rows) {
      const hit = !!q && r.textContent.toLowerCase().includes(q);
      r.classList.toggle('is-hit', hit && !titleHit);
      mark(r.querySelector('.st-name, .field > span'), hit);
      if (hit) hits++;
    }
    mark(head, titleHit);
    // Only some rows match: show just those (a title match keeps the whole card).
    const only = !!q && !titleHit && hits > 0;
    for (const r of rows) r.classList.toggle('is-miss', only && !r.classList.contains('is-hit'));
    const sub = card.querySelector('.st-sub');
    if (sub) sub.classList.toggle('is-miss', only);
    const show = !q || titleHit || hits > 0;
    card.hidden = !show;
    if (show) shown++;
  }
  $('st-none').hidden = !q || shown > 0;
}
$('st-search').addEventListener('input', settingsFilter);
$('st-search').addEventListener('keydown', (e) => {
  e.stopPropagation();
  if (e.key === 'Escape') {
    if ($('st-search').value) ($('st-search').value = ''), settingsFilter();
    else $('st-search').blur();
  }
});
// Rows redrawn by renderSettings (Features) keep the current filter.
const _renderSettings = renderSettings;
renderSettings = function () {
  _renderSettings();
  if ($('st-search').value.trim()) settingsFilter();
};

// Notes: saved as you type (quietly); Copy & clear copies, clears and archives.
const notesEl = $('s-notes');
let notesTimer = null;
notesEl.addEventListener('input', () => {
  clearTimeout(notesTimer);
  notesTimer = setTimeout(() => api.setNotes(notesEl.value), 400);
});
notesEl.addEventListener('keydown', (e) => e.stopPropagation());
$('s-notes-cut').addEventListener('click', async () => {
  clearTimeout(notesTimer);
  await api.setNotes(notesEl.value);
  if (!notesEl.value.trim()) return;
  S = await api.cutNotes();
  notesEl.value = '';
  $('s-notes-msg').textContent = 'Copied. Paste it into your prompt.';
  setTimeout(() => ($('s-notes-msg').textContent = ''), 2600);
  renderNotes();
});
const notesFmt = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
function renderNotes() {
  if (!S) return;
  if (document.activeElement !== notesEl && notesEl.value !== (S.notes || '')) notesEl.value = S.notes || '';
  const arch = S.notesArchive || [];
  $('s-archive').hidden = !arch.length;
  $('s-archive-sum').textContent = `Copied before · ${arch.length}`;
  const list = $('s-archive-list');
  list.replaceChildren();
  for (const a of arch) {
    const li = el('li');
    const again = el('button', 'act', 'Copy');
    again.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(a.text); again.textContent = 'Copied'; } catch { again.textContent = 'Select it'; }
      setTimeout(() => (again.textContent = 'Copy'), 1500);
    });
    li.append(el('span', 'when', notesFmt.format(new Date(a.at))), again, el('p', 'txt', a.text));
    list.append(li);
  }
}
const _renderSettings2 = renderSettings;
renderSettings = function () {
  _renderSettings2();
  renderNotes();
};

// ---------- Claude ----------
$('cl-on').addEventListener('click', async () => ((S = await api.claudeSet(true)), renderSettings()));
$('cl-off').addEventListener('click', async () => ((S = await api.claudeSet(false)), renderSettings()));
$('cl-desktop').addEventListener('click', async () => {
  const b = $('cl-desktop');
  b.dataset.busy = '1';
  const r = await api.claudeDesktop();
  b.textContent = r.error ? 'Couldn’t add' : 'Added · restart Claude';
  if (r.error) $('cl-status').textContent = r.error;
  setTimeout(async () => {
    delete b.dataset.busy;
    S = await api.getState();
    renderSettings();
  }, 2500);
});
$('cl-code').addEventListener('click', async () => {
  const b = $('cl-code');
  const r = await api.claudeCode();
  b.textContent = r.error ? r.error : 'Copied · paste in a terminal';
  setTimeout(() => (b.textContent = 'Copy for Claude Code'), 2500);
});

// ---------- Groups (backlog Active split; optional Claude session per open slot) ----------
const LAUNCH_WORDS = { off: 'Nothing', code: 'Claude Code', chat: 'Claude chat' };
let grpOpen = null; // the group whose details are open
function readGroups() {
  return [...document.querySelectorAll('#grp-list .grp')].map((d) => {
    const v = (k) => d.querySelector(`[data-k="${k}"]`);
    return {
      id: d.dataset.id,
      name: v('name').value,
      slots: +v('slots').value,
      match: v('match').value,
      launch: d.dataset.launch,
      dir: v('dir').value,
      taskMsg: v('taskMsg').value,
      emptyMsg: v('emptyMsg').value,
      perHour: +v('perHour').value,
    };
  });
}
async function saveGroups(groups = readGroups()) {
  S = await api.backlog({ groups });
  renderGroups(true);
}
function renderGroups(force) {
  const list = $('grp-list');
  if (!list || !S || !S.backlog) return;
  if (!force && list.contains(document.activeElement)) return; // not while typing
  const groups = S.backlog.groups || [];
  list.replaceChildren();
  groups.forEach((g) => {
    const d = el('details', 'grp');
    d.dataset.id = g.id;
    d.dataset.launch = g.launch;
    d.open = grpOpen === g.id;
    d.addEventListener('toggle', () => (grpOpen = d.open ? g.id : grpOpen === g.id ? null : grpOpen));
    const sum = el('summary');
    sum.append(el('b', null, g.name), el('span', null, ` · ${g.slots} slot${g.slots > 1 ? 's' : ''}${g.match ? ' · ' + g.match : ''} · ${g.launch === 'off' ? 'no sessions' : 'starts ' + LAUNCH_WORDS[g.launch]}`));
    const body = el('div', 'grp__body');
    const field = (label, k, val, attrs = {}) => {
      const f = el('label', 'field');
      const input = el(attrs.area ? 'textarea' : 'input', attrs.area ? 'st-notes grp__msg' : '');
      if (!attrs.area) input.type = attrs.type || 'text';
      Object.assign(input, { value: val ?? '', placeholder: attrs.ph || '', spellcheck: false });
      if (attrs.min) Object.assign(input, { min: attrs.min, max: attrs.max });
      if (attrs.area) input.rows = 3;
      input.dataset.k = k;
      input.addEventListener('change', () => saveGroups());
      input.addEventListener('keydown', (e) => e.stopPropagation());
      f.append(el('span', null, label), input);
      if (attrs.hide) f.hidden = true;
      return f;
    };
    const row = el('div', 'grp__row');
    row.append(field('Name', 'name', g.name), field('Slots', 'slots', g.slots, { type: 'number', min: 1, max: 9 }), field('Max starts an hour', 'perHour', g.perHour, { type: 'number', min: 1, max: 30 }));
    const seg = el('div', 'tabs st-seg');
    for (const k of ['off', 'code', 'chat']) {
      const b = el('button', 'tab', LAUNCH_WORDS[k]);
      b.setAttribute('aria-selected', String(g.launch === k));
      b.addEventListener('click', () => {
        d.dataset.launch = k;
        saveGroups();
      });
      seg.append(b);
    }
    const when = el('div', 'field');
    when.append(el('span', null, 'When a slot opens, start'), seg);
    const off = g.launch === 'off';
    body.append(
      row,
      field('Words that put a task here (comma separated)', 'match', g.match, { ph: 'roblox, rbx' }),
      when,
      field('Folder for Claude Code', 'dir', g.dir, { ph: 'C:\\Users\\you\\Projects\\game', hide: g.launch !== 'code' }),
      field('Message for the task that takes the slot ({task}, {group}, {id})', 'taskMsg', g.taskMsg, { area: true, hide: off }),
      field('Message when nothing is queued (empty = don’t start one)', 'emptyMsg', g.emptyMsg, { area: true, hide: off, ph: 'e.g. Look at the Roblox backlog and start the most valuable next step.' })
    );
    const acts = el('div', 'actions');
    if (!off) {
      const test = el('button', 'btn btn--quiet', 'Start one now');
      test.addEventListener('click', async () => {
        const r = await api.backlogTest(g.id);
        test.textContent = r.error || (r.last && r.last.error) || 'Started';
        setTimeout(() => (test.textContent = 'Start one now'), 2500);
      });
      acts.append(test);
    }
    if (groups.length > 1) {
      const del = el('button', 'btn btn--quiet', 'Remove group');
      del.addEventListener('click', () => saveGroups(readGroups().filter((x) => x.id !== g.id)));
      acts.append(del);
    }
    if (acts.children.length) body.append(acts);
    d.append(sum, body);
    list.append(d);
  });
  const last = (S.launches || [])[0];
  $('grp-last').textContent = last ? `Last start: ${last.group} · ${LAUNCH_WORDS[last.how] || ''} · ${hm(last.at)}${last.title ? ' · ' + last.title : ''}${last.error ? ' · ' + last.error : ''}` : '';
  $('grp-add').hidden = groups.length >= 8;
}
$('grp-add').addEventListener('click', () => {
  const id = 'g' + Date.now().toString(36);
  grpOpen = id;
  saveGroups([...readGroups(), { id, name: 'Group ' + (readGroups().length + 1), slots: 1, launch: 'off' }]);
});
