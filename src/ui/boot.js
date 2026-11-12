// Boot: first state, first view, show the window. Loaded last.
// The ui/*.js files share one global scope (plain scripts, loaded in order by index.html).

// ---------- boot ----------

function render() {
  if (view === 'setup') renderSetup();
  renderNow();
  if (view === 'today') renderToday();
  if (view === 'settings') renderSettings();
}

// Planner tabs (Today / Week), also switched by shortcuts, corners and auto-open.
document.querySelectorAll('.su-tab').forEach((b) =>
  b.addEventListener('click', () => {
    planTab = b.dataset.tab;
    renderSetup();
    setTimeout(scrollSetupToNow, 50);
  })
);
api.onPlannerTab((tab) => {
  if (tab === 'settings') return setView('settings');
  planTab = tab === 'today' ? 'today' : 'week';
  if (view !== 'setup') setView('setup');
  else renderSetup();
  setTimeout(scrollSetupToNow, 120);
});
$('st-close').addEventListener('click', () => setView(setupMode ? 'setup' : 'now'));
document.querySelectorAll('#s-settings-mode .tab').forEach((t) =>
  t.addEventListener('click', async () => (S = await api.updateSettings({ settingsMode: t.dataset.v })) && render())
);
document.querySelectorAll('#s-popup .tab').forEach((t) =>
  t.addEventListener('click', async () => (S = await api.updateSettings({ popupStyle: t.dataset.v })) && render())
);
// In the Planner window the gear appears only near the bottom-right corner.
if (setupMode) {
  appEl.classList.add('is-planner-win');
  document.addEventListener('mousemove', (e) => {
    const r = appEl.getBoundingClientRect();
    const dx = r.right - e.clientX;
    const dy = r.bottom - e.clientY;
    document.body.classList.toggle('near-gear', dx >= 0 && dy >= 0 && dx < 96 && dy < 72);
  });
}

// State arrives from here on. Kept last: with separate script files the first
// reply could otherwise land before later files have defined render().
function featureClasses() {
  for (const [k] of FEATURE_LIST) if (!k.startsWith('=')) document.body.classList.toggle('no-' + k, !feat(k));
}
api.onState((s) => {
  S = s;
  featureClasses();
  document.body.classList.toggle('is-light', s.settings.appMode === 'light');
  render();
  if (view === 'log' || (view === 'today' && todayTab === 'map')) loadLog();
});

api.getState().then((s) => {
  S = s;
  featureClasses();
  document.body.classList.toggle('is-light', s.settings.appMode === 'light');
  const bootTab = new URLSearchParams(location.search).get('tab');
  setView(setupMode ? (bootTab === 'settings' ? 'settings' : 'setup') : 'now');
  // Show the window only once this first frame has painted: no blink.
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      api.ready();
      setTimeout(() => document.body.classList.remove('booting'), 60);
    })
  );
  tick();
  setInterval(tick, 1000);
  setInterval(() => view === 'log' && renderLog(), 30e3);
});
