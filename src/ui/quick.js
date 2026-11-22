// Quick bar: start typing anywhere (or Ctrl+K) instead of hunting for a field.
// Enter adds what you typed as a task for today; ↑/↓ picks a matching task and
// Enter switches to it; Shift+Enter adds and starts; Ctrl+Enter (Planner) opens
// a picked task's details; Escape closes.
// The ui/*.js files share one global scope (plain scripts, loaded in order by index.html).

let quick = null; // { box, input, list, sel }

function quickMatches(q) {
  if (!S || !S.today) return [];
  const s = q.trim().toLowerCase();
  if (!s) return [];
  return S.today.open.filter((t) => t.title.toLowerCase().includes(s)).slice(0, 6);
}

function closeQuick() {
  if (!quick) return;
  quick.box.remove();
  quick = null;
}

function paintQuick() {
  const { input, list } = quick;
  const found = quickMatches(input.value);
  if (quick.sel >= found.length) quick.sel = found.length - 1;
  list.replaceChildren();
  found.forEach((t, i) => {
    const li = el('li', i === quick.sel ? 'is-sel' : '');
    const running = S.current && S.current.googleId === t.id;
    li.append(titleWithSeries(el('span', 't', t.title), t), el('span', 'k', running ? 'running' : i === quick.sel ? 'Enter to start' : ''));
    li.addEventListener('mousedown', (e) => {
      e.preventDefault();
      quick.sel = i;
      runQuick({});
    });
    list.append(li);
  });
  quick.found = found;
}

async function runQuick(mods) {
  if (!quick) return;
  const text = quick.input.value.trim();
  const picked = quick.sel >= 0 ? quick.found[quick.sel] : null;
  closeQuick();
  if (picked) {
    if (mods.ctrl && setupMode) {
      if (view !== 'setup') setView('setup');
      suSheet = { type: 'task', id: picked.id };
      return renderSetup();
    }
    if (!(S.current && S.current.googleId === picked.id)) await startWithClaim(picked.id);
    return render();
  }
  if (!text || !S.connected) return;
  if (mods.shift) await api.task('addStart', null, text);
  else await api.task('add', 'today', text);
}

function openQuick(seed) {
  if (quick || !S || S.settings.appMode === 'light' && !S.connected) return;
  const box = el('div', 'quick');
  const input = el('input', 'quick__in');
  input.type = 'text';
  input.maxLength = 300;
  input.placeholder = 'Add a task, or find one to start';
  const list = el('ul', 'quick__list');
  const hint = el('p', 'quick__hint', `Enter adds for today · ↑↓ pick one to start · Shift+Enter add & start${setupMode ? ' · Ctrl+Enter details' : ''} · Esc`);
  box.append(input, list, hint);
  appEl.append(box);
  quick = { box, input, list, sel: -1, found: [] };
  input.value = seed || '';
  input.addEventListener('input', () => ((quick.sel = -1), paintQuick()));
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') return closeQuick();
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = quick.found.length;
      if (!n) return;
      quick.sel = e.key === 'ArrowDown' ? (quick.sel + 1) % n : quick.sel <= 0 ? n - 1 : quick.sel - 1;
      return paintQuick();
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      runQuick({ shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey });
    }
  });
  input.addEventListener('blur', () => setTimeout(closeQuick, 120));
  paintQuick();
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
}

document.addEventListener('keydown', (e) => {
  if (quick || e.defaultPrevented) return;
  const t = e.target;
  if (t && t.matches && t.matches('input, textarea, select, [contenteditable]')) return;
  if (document.querySelector('.su-modal')) return;
  if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    return openQuick('');
  }
  // Just start typing: a printable key with no Ctrl/Alt/Win opens it with that letter.
  if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey && /\S/.test(e.key)) {
    e.preventDefault();
    openQuick(e.key);
  }
});
