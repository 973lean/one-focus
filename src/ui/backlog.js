// Backlog mode on View: Active (with open slots), Queued, Evergreen.
// Many things can be in flight (AI workflows running side by side); One Focus
// still holds: the oldest request (an active task waiting on you) is the one
// thing to do now, and it leads the list. With nothing needing you and every
// slot busy, Evergreen is what to do while you wait. Auto mode fills free
// slots from the top of the queue. The switches sit in View's bottom-left
// corner and only show when the pointer is near. Logic lives in src/backlog.js
// (main process); this file draws it.
// The ui/*.js files share one global scope (plain scripts, loaded in order by index.html).

const backlogOn = () => !!(S && S.backlog && S.backlog.on);

// Lanes as the main process orders them (see Backlog.lanes).
function backlogLanes() {
  const b = S.backlog;
  const byId = new Map(S.today.open.map((t) => [t.id, t]));
  const rows = (lane) =>
    Object.entries(b.items)
      .filter(([id, it]) => it.lane === lane && byId.has(id))
      .map(([id, it]) => ({ ...it, task: byId.get(id), group: (b.groupOf || {})[id] || (b.groups && b.groups[0] ? b.groups[0].id : 'main') }));
  const rank = (x, y) => (x.rank || 0) - (y.rank || 0);
  const active = rows('active').sort((x, y) => (x.turn === y.turn ? Date.parse(x.since) - Date.parse(y.since) : x.turn === 'you' ? -1 : 1));
  const groups = b.groupInfo || [{ id: 'main', name: 'Active', slots: b.slots, active: active.length, pending: [] }];
  return { active, queued: rows('queued').sort(rank), evergreen: rows('evergreen').sort(rank), slots: b.slots, groups };
}

// "just now", "12m ago", "3h ago", "yesterday", "Mon", "Nov 3".
const weekdayFmt = new Intl.DateTimeFormat('en-US', { weekday: 'short' });
const monthDayFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });
function ago(iso) {
  const t = Date.parse(iso);
  if (!t) return '';
  const m = Math.floor((Date.now() - t) / 60e3);
  if (m < 1) return 'just now';
  if (m < 60) return m + 'm ago';
  const d0 = new Date();
  d0.setHours(0, 0, 0, 0);
  if (t >= d0.getTime()) return Math.floor(m / 60) + 'h ago';
  if (t >= d0.getTime() - 86400e3) return 'yesterday';
  if (t >= d0.getTime() - 6 * 86400e3) return weekdayFmt.format(new Date(t));
  return monthDayFmt.format(new Date(t));
}
// Live labels: refreshed every tick without re-rendering the list.
function timeLabel(kind, iso) {
  const ms = Date.now() - Date.parse(iso);
  if (kind === 'you') return ms < 60e3 ? 'Your turn' : 'Your turn · ' + dur(ms);
  if (kind === 'run') return ms < 60e3 ? 'Running' : 'Running ' + dur(ms);
  if (kind === 'done') return iso ? 'done ' + ago(iso) : '';
  return ago(iso);
}
function paintBacklogTimes() {
  if (view !== 'view' || !backlogOn()) return;
  for (const n of document.querySelectorAll('#vw-list [data-at]')) n.textContent = timeLabel(n.dataset.kind, n.dataset.at);
}

async function blItem(id, patch) {
  const r = await api.backlogItem(id, patch);
  if (r && r.backlog) S = r;
  render();
}

// Deadlines: "today", "tomorrow", "overdue", "Fri", "Nov 28".
function dueLabel(d) {
  const day = new Date(d + 'T12:00:00');
  const t0 = new Date();
  t0.setHours(12, 0, 0, 0);
  const days = Math.round((day - t0) / 86400e3);
  if (days < 0) return 'overdue';
  if (days === 0) return 'due today';
  if (days === 1) return 'due tomorrow';
  if (days < 7) return 'due ' + weekdayFmt.format(day);
  return 'due ' + monthDayFmt.format(day);
}
// Work days: "today", "tomorrow", "Fri", "Nov 28".
const localDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const todayKey = () => localDay(new Date());
const tomorrowKey = () => localDay(new Date(Date.now() + 86400e3));
function dayLabel(d) {
  if (d <= todayKey()) return 'today';
  if (d === tomorrowKey()) return 'tomorrow';
  const day = new Date(d + 'T12:00:00');
  return day - Date.now() < 6 * 86400e3 ? weekdayFmt.format(day) : monthDayFmt.format(day);
}
const inDayTab = (r, tab) =>
  tab === 'today' ? !!r.day && r.day <= todayKey() : tab === 'tomorrow' ? r.day === tomorrowKey() : tab === 'later' ? !r.day || r.day > tomorrowKey() : true;
const dueSoon = (d) => d && new Date(d + 'T23:59:59') - Date.now() < 86400e3;

// One small ⋯ menu per row instead of a row of actions (only one open).
let blMenu = null;
function closeBlMenu() {
  if (!blMenu) return;
  blMenu.remove();
  blMenu = null;
  document.removeEventListener('pointerdown', blMenuAway, true);
  document.removeEventListener('keydown', blMenuKey, true);
}
const blMenuAway = (e) => blMenu && !blMenu.contains(e.target) && !e.target.closest('.bl-more') && closeBlMenu();
const blMenuKey = (e) => e.key === 'Escape' && (e.stopPropagation(), closeBlMenu());
function openBlMenu(btn, items, at = null) {
  const had = !at && blMenu && blMenu.parentElement === btn.parentElement;
  closeBlMenu();
  if (had) return;
  const m = el('div', 'bl-menu');
  if (at) {
    // Right-click: at the pointer (kept inside the row's width).
    const r = btn.parentElement.getBoundingClientRect();
    Object.assign(m.style, { left: Math.max(6, Math.min(at.x - r.left, r.width - 160)) + 'px', right: 'auto', top: at.y - r.top + 4 + 'px' });
  }
  for (const [label, fn] of items) {
    const b = el('button', null, label);
    b.addEventListener('click', (e) => (e.stopPropagation(), closeBlMenu(), fn()));
    m.append(b);
  }
  btn.parentElement.append(m);
  blMenu = m;
  document.addEventListener('pointerdown', blMenuAway, true);
  document.addEventListener('keydown', blMenuKey, true);
}

function backlogList() {
  closeBlMenu();
  const L = backlogLanes();
  const box = el('div', 'su-tasks bl');
  const full = L.groups.every((g) => L.active.filter((r) => r.group === g.id).length + (g.pending || []).length >= g.slots);
  const needsYou = L.active.some((r) => r.turn === 'you');
  const focusId = (L.active.find((r) => r.turn === 'you') || {}).task?.id; // the oldest request anywhere
  const freeIn = (gid) => {
    const g = L.groups.find((x) => x.id === gid) || L.groups[0];
    return g.slots - L.active.filter((r) => r.group === g.id).length - (g.pending || []).length;
  };
  const act = (label, title, fn) => {
    const b = el('button', 'bl-act', label);
    b.title = title;
    b.addEventListener('click', (e) => (e.stopPropagation(), fn(e)));
    return b;
  };
  const timeNode = (cls, kind, at) => {
    const n = el('span', cls, timeLabel(kind, at));
    if (at) Object.assign(n.dataset, { kind, at });
    return n;
  };

  const row = (r, lane) => {
    const t = r.task;
    const you = lane === 'active' && r.turn === 'you';
    const running = S.current && S.current.googleId === t.id;
    const li = el('li', 'bl-row' + (lane === 'active' ? (you ? ' is-you' : ' is-agent') : '') + (you && t.id === focusId ? ' is-focus' : '') + (running ? ' is-running' : ''));
    li.dataset.id = t.id;
    li.dataset.lane = lane;

    const grip = el('span', 'su-tasks__grip');
    grip.title = 'Drag to move';
    grip.innerHTML = '<svg viewBox="0 0 6 10"><circle cx="1.2" cy="1.2" r="1"/><circle cx="4.8" cy="1.2" r="1"/><circle cx="1.2" cy="5" r="1"/><circle cx="4.8" cy="5" r="1"/><circle cx="1.2" cy="8.8" r="1"/><circle cx="4.8" cy="8.8" r="1"/></svg>';
    grip.addEventListener('pointerdown', (e) => beginLaneDrag(e, li, box));

    // Evergreen: the circle records "did it" and the task stays.
    const check = el('button', 'check');
    check.setAttribute('aria-label', lane === 'evergreen' ? 'Did it (it stays)' : 'Done');
    check.title = lane === 'evergreen' ? 'Did it (it stays)' : 'Done';
    check.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (lane === 'evergreen') {
        li.classList.add('is-flash');
        return blItem(t.id, { didIt: true });
      }
      li.classList.add('is-busy');
      await api.task('complete', t.id);
    });

    const main = el('div', 'bl-main');
    const name = titleWithSeries(el('span', 't', t.title), t);
    renameOnClick(name, t);
    const line = el('div', 'bl-line');
    line.append(name);
    main.append(line);
    if (r.link) {
      const go = el('button', 'bl-link');
      go.title = 'Open ' + r.link;
      go.setAttribute('aria-label', 'Open link');
      go.innerHTML = '<svg viewBox="0 0 10 10"><path d="M4 2H2v6h6V6M6 1.5h2.5V4M8.5 1.5 4.5 5.5"/></svg>';
      go.addEventListener('click', (e) => (e.stopPropagation(), api.openLink(r.link)));
      line.append(go);
    }
    if (you && r.ask) main.append(el('span', 'bl-ask', r.ask));
    if (S.backlog.show === 'details' && (t.notes || '').trim()) {
      const card = el('div', 'bl-notes');
      card.append(el('span', null, t.notes.trim())); // the clamp sits inside the padding
      card.title = t.notes.trim();
      main.append(card);
    }

    // Editors open on a line under the title, so the title stays in view.
    const below = () => {
      const slot = el('span', 'bl-ask');
      main.append(slot);
      return slot;
    };
    const editLink = () =>
      inlineEdit(below(), r.link || '', 2000, (v) => blItem(t.id, { link: v && !/^https?:\/\//i.test(v) && /^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(v) ? 'https://' + v : v }), 'Link');
    const editDue = () => {
      const input = el('input', 'bl-date');
      input.type = 'date';
      input.value = r.deadline || '';
      let done = false;
      const finish = (save) => {
        if (done) return;
        done = true;
        rowEdit = false;
        input.remove();
        if (save && input.value !== (r.deadline || '')) blItem(t.id, { deadline: input.value });
        else render();
      };
      input.addEventListener('change', () => finish(true));
      input.addEventListener('blur', () => finish(true));
      input.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') finish(true);
        if (e.key === 'Escape') finish(false);
        if ((e.key === 'Backspace' || e.key === 'Delete') && !input.value) finish(true);
      });
      input.addEventListener('click', (e) => e.stopPropagation());
      rowEdit = true;
      main.append(input);
      input.focus();
      try {
        input.showPicker();
      } catch {}
    };
    const editNotes = () => {
      const old = (t.notes || '').trim();
      inlineEdit(main.querySelector('.bl-notes') || below(), old, 8000, async (v) => {
        if (v === old) return;
        t.notes = v;
        await api.taskDetail(t.id, { notes: v });
      }, 'Details');
    };
    const editPrompt = () => openPromptEditor(main, r, L);
    // Day: when you'll work on it. A row of quick picks under the title.
    const editDay = () => {
      rowEdit = true;
      const card = el('div', 'bl-daypick');
      const done = (day) => {
        rowEdit = false;
        card.remove();
        if (day === undefined) return render();
        blItem(t.id, { day });
      };
      const pick = (label, day) => {
        const b = el('button', 'bl-chip' + ((r.day || '') === day ? ' is-on' : ''), label);
        b.addEventListener('click', (e) => (e.stopPropagation(), done(day)));
        return b;
      };
      const date = el('input', 'bl-date');
      date.type = 'date';
      date.min = todayKey();
      date.value = r.day && r.day > tomorrowKey() ? r.day : '';
      date.addEventListener('change', () => date.value && done(date.value));
      date.addEventListener('click', (e) => e.stopPropagation());
      card.append(pick('Today', todayKey()), pick('Tomorrow', tomorrowKey()), date);
      if (r.day) card.append(pick('No day', ''));
      card.addEventListener('keydown', (e) => (e.stopPropagation(), e.key === 'Escape' && done(undefined)));
      card.addEventListener('focusout', (e) => !card.contains(e.relatedTarget) && setTimeout(() => card.isConnected && done(undefined), 150));
      main.append(card);
      card.querySelector('button').focus();
    };
    const items = [];
    if (lane === 'active') {
      items.push([you && r.ask ? 'Edit request' : 'Needs me', () => inlineEdit(main.querySelector('.bl-ask') || below(), r.ask || '', 200, (v) => blItem(t.id, { ask: v }), 'Request')]);
      items.push(['Details', editNotes], [r.deadline ? 'Deadline · ' + r.deadline : 'Deadline', editDue], [r.link ? 'Change link' : 'Link', editLink], ['Back to queue', () => blItem(t.id, { lane: 'queued', index: 0 })]);
    } else if (lane === 'queued') {
      if (freeIn(r.group) > 0) items.push(['Start', () => blItem(t.id, { lane: 'active' })]);
      items.push([r.day ? 'Day · ' + dayLabel(r.day) : 'Day', editDay], [r.prompt || r.when ? 'Edit prompt & trigger' : 'Prompt & trigger', editPrompt], ['Details', editNotes], [r.deadline ? 'Deadline · ' + r.deadline : 'Deadline', editDue], [r.link ? 'Change link' : 'Link', editLink], ['Evergreen', () => blItem(t.id, { lane: 'evergreen' })]);
    } else items.push(['Details', editNotes], [r.link ? 'Change link' : 'Link', editLink], ['Queue', () => blItem(t.id, { lane: 'queued' })]);
    const more = el('button', 'bl-more', '⋯');
    more.title = 'More';
    more.setAttribute('aria-label', 'More');
    more.addEventListener('click', (e) => (e.stopPropagation(), openBlMenu(more, items)));
    li.addEventListener('contextmenu', (e) => {
      if (e.target.closest('input, textarea, select')) return;
      e.preventDefault();
      openBlMenu(more, items, { x: e.clientX, y: e.clientY });
    });

    // Right side: whose turn (click to flip), the deadline or queued time, or last done.
    const side = el('span', 'bl-side');
    if (r.deadline && lane !== 'evergreen') side.append(el('span', 'bl-due' + (dueSoon(r.deadline) ? ' is-soon' : ''), lane === 'active' ? dueLabel(r.deadline).replace(/^due /, '') : dueLabel(r.deadline)));
    if (lane === 'active') {
      const st = el('button', 'bl-state' + (you ? ' is-you' : ''));
      st.title = you ? 'Hand it back: mark it running' : 'Mark it as needing you';
      st.append(el('i'), timeNode('bl-time', you ? 'you' : 'run', r.since));
      st.addEventListener('click', (e) => (e.stopPropagation(), blItem(t.id, { turn: you ? 'agent' : 'you' })));
      side.append(st);
    } else if (lane === 'queued') {
      if (r.when || r.prompt) {
        const m = el('span', 'bl-trigger', '⏵');
        m.title = (r.prompt ? 'Prompt: ' + r.prompt.slice(0, 200) + '\n' : '') + 'Starts ' + whenLabel(r.when, L);
        side.append(m);
      }
      if (r.day) side.append(el('span', 'bl-day' + (r.day <= todayKey() ? ' is-today' : ''), dayLabel(r.day)));
      else if (!r.deadline) side.append(timeNode('d', 'ago', r.queuedAt));
    } else side.append(timeNode('d', 'done', r.lastDone));
    li.append(grip, check, main, more, side);
    return li;
  };

  const head = (label, count, extra) => {
    const h = el('div', 'bl-head');
    h.append(el('span', 'bl-head__name', label));
    if (count) h.append(el('span', 'bl-head__count', count));
    if (extra) h.append(extra);
    return h;
  };
  const list = (lane, rows, gid) => {
    const ul = el('ul', 'su-tasks__list bl-list');
    ul.dataset.lane = lane;
    if (gid) ul.dataset.group = gid;
    rows.forEach((r) => ul.append(row(r, lane)));
    return ul;
  };
  const addField = (g) => {
    const wrap = el('div', 'su-tasks__addwrap bl-add');
    const add = el('input', 'su-tasks__add');
    add.type = 'text';
    add.maxLength = 300;
    add.placeholder = L.groups.length > 1 ? 'Add to ' + g.name : 'Add a task';
    add.addEventListener('keydown', async (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') return add.blur();
      if (e.key !== 'Enter' || !add.value.trim()) return;
      const title = add.value.trim();
      add.value = '';
      // Shown at once; Google catches up in its own time.
      const tmp = 'tmp-' + Date.now().toString(36);
      S = {
        ...S,
        today: { ...S.today, open: [...S.today.open, { id: tmp, title, notes: '', items: [] }] },
        backlog: { ...S.backlog, items: { ...S.backlog.items, [tmp]: { lane: 'queued', rank: 1e9, queuedAt: new Date().toISOString(), title, group: g.id } }, groupOf: { ...(S.backlog.groupOf || {}), [tmp]: g.id } },
      };
      render();
      const r = await api.backlogAdd(title, g.id);
      if (r && r.backlog) S = r;
      render();
      setTimeout(() => {
        const again = document.querySelector(`#vw-list .bl-group[data-group="${CSS.escape(g.id)}"] .su-tasks__add`);
        if (again) again.focus();
      }, 60);
    });
    wrap.append(add);
    return wrap;
  };

  // Day tabs (quiet, on hover; they stay while one is picked): which part of
  // each queue to show. On Today, → Tomorrow moves today's to tomorrow.
  const tab = S.backlog.dayTab || 'all';
  const tabs = el('div', 'bl-days' + (tab !== 'all' ? ' is-set' : ''));
  for (const [k, label] of [['all', 'All'], ['today', 'Today'], ['tomorrow', 'Tomorrow'], ['later', 'Later']]) {
    const b = el('button', 'bl-days__tab', label);
    b.setAttribute('aria-selected', String(tab === k));
    b.addEventListener('click', async () => ((S = await api.backlog({ dayTab: k })), render()));
    tabs.append(b);
  }
  if (tab === 'today' && L.queued.some((r) => inDayTab(r, 'today'))) {
    const push = el('button', 'bl-days__push', '→ Tomorrow');
    push.title = 'Move everything planned for today to tomorrow';
    push.addEventListener('click', async () => ((S = await api.backlog({ pushTo: tomorrowKey() })), render()));
    tabs.append(push);
  }
  box.append(tabs);

  // One section per group (a project): what's in flight, its slots, then its
  // queue (quieter), then a field to add to it on hover.
  const many = L.groups.length > 1;
  for (const g of L.groups) {
    const sec = el('section', 'bl-group');
    sec.dataset.group = g.id;
    const rows = L.active.filter((r) => r.group === g.id);
    const holds = g.pending || [];
    const slotBtns = el('span', 'bl-slots');
    const setSlots = (n) => api.backlog({ slots: n, group: g.id }).then((r) => ((S = r), render()));
    const minus = act('−', 'Remove an open slot', () => setSlots(g.slots - 1));
    const plus = act('+', 'Add a slot', () => setSlots(g.slots + 1));
    minus.disabled = g.slots <= Math.max(1, rows.length);
    plus.disabled = g.slots >= 9;
    slotBtns.append(minus, plus);
    const ul = list('active', rows, g.id);
    for (const p of holds) {
      const h = el('li', 'bl-slot is-starting');
      const tm = el('span', 'bl-slot__time', ago(p.at));
      Object.assign(tm.dataset, { kind: 'ago', at: p.at });
      h.append(el('i'), el('span', null, 'Starting Claude ·'), tm);
      h.title = 'A Claude session was started for this group; the slot is held until it adds its task (up to 15 minutes).';
      ul.append(h);
    }
    for (let i = rows.length + holds.length; i < g.slots; i++) ul.append(el('li', 'bl-slot', 'Open slot'));
    const hd = head(many ? g.name : 'Active', `${rows.length + holds.length}/${g.slots}`, slotBtns);
    if (many) hd.classList.add('is-group');
    const queue = list('queued', L.queued.filter((r) => r.group === g.id && inDayTab(r, tab)), g.id);
    queue.classList.add('bl-queue');
    sec.append(hd, ul, queue, addField(g));
    box.append(sec);
  }

  // A new group: a slim line on hover after the last one.
  const ng = el('div', 'su-tasks__addwrap bl-add bl-newgroup');
  const ngIn = el('input', 'su-tasks__add');
  ngIn.type = 'text';
  ngIn.maxLength = 40;
  ngIn.placeholder = 'New group';
  ngIn.addEventListener('keydown', async (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') return ngIn.blur();
    if (e.key !== 'Enter' || !ngIn.value.trim()) return;
    const name = ngIn.value.trim();
    ngIn.value = '';
    ngIn.blur();
    const groups = (S.backlog.groups || []).map((g) => ({ ...g }));
    S = await api.backlog({ groups: [...groups, { id: 'g' + Date.now().toString(36), name, slots: 1, match: '', launch: 'off' }] });
    render();
  });
  ng.append(ngIn);

  // Evergreen: standing tasks. Brighter when every slot is busy and nothing
  // needs you: it's what to do while you wait.
  const waiting = full && !needsYou && L.active.length > 0;
  const eg = el('section', 'bl-group bl-evergreen');
  const egList = list('evergreen', L.evergreen);
  if (waiting) eg.classList.add('is-now'), egList.classList.add('is-now');
  eg.append(head('Evergreen', ''), egList);
  box.append(eg);
  if ((S.backlog.groups || []).length < 8) box.append(ng); // at the very end, so it never opens a gap
  return box;
}
let rowEdit = false; // a deadline picker or the prompt editor is open

function whenLabel(w, L) {
  w = String(w || '');
  if (w === 'slot') return 'when a slot opens';
  if (w === 'empty') return 'when its group is empty';
  if (w.startsWith('after:')) {
    const t = S.today.open.find((x) => x.id === w.slice(6));
    return 'after ' + (t ? '“' + t.title + '”' : 'a task') + ' is done';
  }
  if (w.startsWith('at:')) return 'at ' + new Date(w.slice(3)).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' });
  return 'by hand';
}

// A queued task's prompt (sent to a new Claude session when it starts) and
// its trigger (when it starts by itself, in auto mode). A mini card under
// the title; Save or Escape.
function openPromptEditor(main, r, L) {
  rowEdit = true;
  const card = el('div', 'bl-prompt');
  const text = el('textarea', 'bl-prompt__text');
  text.rows = 2;
  text.maxLength = 4000;
  text.placeholder = 'Prompt';
  text.value = r.prompt || '';
  const sel = el('select', 'bl-prompt__when');
  const opt = (v, label) => {
    const o = el('option', null, label);
    o.value = v;
    sel.append(o);
  };
  opt('', 'By hand');
  opt('slot', 'When a slot opens');
  opt('empty', 'When the group is empty');
  for (const x of [...L.active, ...L.queued].filter((y) => y.group === r.group && y.task.id !== r.task.id)) opt('after:' + x.task.id, 'After “' + (x.task.title.length > 40 ? x.task.title.slice(0, 39) + '…' : x.task.title) + '”');
  opt('at', 'At a time');
  const at = el('input', 'bl-prompt__at');
  at.type = 'datetime-local';
  const w = String(r.when || '');
  sel.value = w.startsWith('at:') ? 'at' : w;
  if (w.startsWith('at:')) {
    const d = new Date(w.slice(3));
    at.value = new Date(d.getTime() - d.getTimezoneOffset() * 60e3).toISOString().slice(0, 16);
  }
  at.hidden = sel.value !== 'at';
  sel.addEventListener('change', () => (at.hidden = sel.value !== 'at'));
  const save = el('button', 'bl-act', 'Save');
  const close = (ok) => {
    rowEdit = false;
    card.remove();
    if (!ok) return render();
    const when = sel.value === 'at' ? (at.value ? 'at:' + new Date(at.value).toISOString() : '') : sel.value;
    blItem(r.task.id, { prompt: text.value, when });
  };
  save.addEventListener('click', (e) => (e.stopPropagation(), close(true)));
  card.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') close(false);
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) close(true);
  });
  card.addEventListener('click', (e) => e.stopPropagation());
  const foot = el('div', 'bl-prompt__foot');
  foot.append(sel, at, save);
  card.append(text, foot);
  main.append(card);
  text.focus();
}

// Drag a row by its grip to another place or lane. A copy follows the
// pointer; a line shows where it lands. A full Active lane won't take more.
function beginLaneDrag(e, li, box) {
  if (e.button !== 0 || rowDrag) return;
  e.preventDefault();
  e.stopPropagation();
  const grip = e.currentTarget;
  grip.setPointerCapture(e.pointerId);
  const from = li.dataset.lane;
  const r0 = li.getBoundingClientRect();
  closeBlMenu();
  const ghost = li.cloneNode(true);
  ghost.classList.add('bl-ghost');
  Object.assign(ghost.style, { left: r0.left + 'px', top: r0.top + 'px', width: r0.width + 'px', height: r0.height + 'px' });
  document.body.append(ghost);
  li.classList.add('is-placeholder');
  const line = el('div', 'bl-dropline');
  box.append(line);
  const lists = [...box.querySelectorAll('.bl-list')];
  const groupInfo = backlogLanes().groups;
  let target = null;
  rowDrag = { y: e.clientY };
  box.classList.add('is-dragging');

  const move = (ev) => {
    ghost.style.transform = `translateY(${ev.clientY - rowDrag.y}px)`;
    // The lane under the pointer (its heading counts), else the nearest.
    let best = null;
    for (const ul of lists) {
      const top = ul.getBoundingClientRect().top - (ul.dataset.lane === 'queued' ? 0 : 24);
      const bottom = ul.getBoundingClientRect().bottom;
      const d = ev.clientY < top ? top - ev.clientY : ev.clientY > bottom ? ev.clientY - bottom : 0;
      if (!best || d < best.d) best = { ul, d };
    }
    const ul = best.ul;
    const lane = ul.dataset.lane;
    const headOf = (x) => x.closest('.bl-group').querySelector('.bl-head');
    for (const x of lists) headOf(x).classList.remove('is-full');
    const g = lane === 'active' ? groupInfo.find((x) => x.id === ul.dataset.group) : null;
    const used = g ? ul.querySelectorAll('.bl-row:not(.is-placeholder)').length : 0;
    if (g && li.parentElement !== ul && used + (g.pending || []).length >= g.slots) {
      headOf(ul).classList.add('is-full');
      line.hidden = true;
      target = null;
      return;
    }
    const rows = [...ul.querySelectorAll('.bl-row')].filter((x) => x !== li);
    let index = rows.findIndex((x) => { const b = x.getBoundingClientRect(); return ev.clientY < b.top + b.height / 2; });
    if (index < 0) index = rows.length;
    const boxTop = box.getBoundingClientRect().top;
    let y;
    if (rows.length === 0) y = ul.getBoundingClientRect().top;
    else if (index < rows.length) y = rows[index].getBoundingClientRect().top;
    else y = rows[rows.length - 1].getBoundingClientRect().bottom;
    line.hidden = false;
    line.style.top = y - boxTop - 1 + 'px';
    target = { lane, index, group: ul.dataset.group || undefined };
  };
  const end = (commit) => {
    grip.removeEventListener('pointermove', move);
    grip.removeEventListener('pointerup', up);
    grip.removeEventListener('pointercancel', cancel);
    document.removeEventListener('keydown', esc, true);
    ghost.remove();
    line.remove();
    li.classList.remove('is-placeholder');
    box.classList.remove('is-dragging');
    for (const x of lists) x.closest('.bl-group').querySelector('.bl-head').classList.remove('is-full');
    rowDrag = null;
    const t = target;
    if (commit && t) {
      // Same lane: the index counts rows without this one, as the main process expects.
      blItem(li.dataset.id, { lane: t.lane, index: t.index, ...(t.group ? { group: t.group } : {}) });
    } else render();
  };
  const up = () => end(true);
  const cancel = () => end(false);
  const esc = (ev) => ev.key === 'Escape' && (ev.stopPropagation(), end(false));
  grip.addEventListener('pointermove', move);
  grip.addEventListener('pointerup', up);
  grip.addEventListener('pointercancel', cancel);
  document.addEventListener('keydown', esc, true);
}

// View's bottom-left corner: Backlog on/off, then (when on) the light
// settings and Tidy.
function paintBacklogCorner() {
  const c = $('bl-corner');
  if (!c || !S) return;
  c.hidden = setupMode || view !== 'view';
  if (c.hidden) return closeMini();
  const on = backlogOn();
  $('bl-toggle').setAttribute('aria-pressed', String(on));
  $('bl-opts').hidden = $('bl-tidy').hidden = !on;
  $('bl-opts').setAttribute('aria-pressed', String(!!mini));
  c.classList.toggle('is-on', on);
  c.classList.toggle('is-open', !!mini);
  if (mini) paintMini();
}
$('bl-toggle').addEventListener('click', async () => {
  S = await api.backlog({ on: !backlogOn() });
  if (!backlogOn()) closeMini();
  render();
});

// Light settings for backlog mode, in View: mode, cards, the Claude
// connection, and the groups (name, slots, what a free slot starts).
// Folders, words and messages stay in Settings → Groups.
let mini = null;
function closeMini() {
  if (!mini) return;
  mini.remove();
  mini = null;
  document.removeEventListener('pointerdown', miniAway, true);
  document.removeEventListener('keydown', miniKey, true);
  const c = $('bl-corner');
  if (c) c.classList.remove('is-open');
}
const miniAway = (e) => mini && !mini.contains(e.target) && !e.target.closest('#bl-opts') && closeMini();
const miniKey = (e) => e.key === 'Escape' && (e.stopPropagation(), closeMini());
$('bl-opts').addEventListener('click', () => {
  if (mini) return closeMini();
  mini = el('div', 'bl-mini');
  mini.addEventListener('keydown', (e) => e.key !== 'Escape' && e.stopPropagation());
  $('bl-corner').append(mini);
  document.addEventListener('pointerdown', miniAway, true);
  document.addEventListener('keydown', miniKey, true);
  paintMini(true);
  $('bl-corner').classList.add('is-open');
});
function paintMini(force) {
  if (!mini || !S || !S.backlog) return;
  if (!force && mini.contains(document.activeElement) && document.activeElement.matches('input')) return; // not while typing
  const b = S.backlog;
  const seg = (opts, cur, set) => {
    const w = el('div', 'tabs st-seg');
    for (const [v, label] of opts) {
      const x = el('button', 'tab', label);
      x.setAttribute('aria-selected', String(cur === v));
      x.addEventListener('click', async () => ((S = await set(v)), render()));
      w.append(x);
    }
    return w;
  };
  const row = (label, ctl) => {
    const r = el('div', 'bl-mini__row');
    r.append(el('span', 'bl-mini__label', label), ctl);
    return r;
  };
  mini.replaceChildren();
  mini.append(
    row('Mode', seg([['manual', 'Manual'], ['auto', 'Auto']], b.auto ? 'auto' : 'manual', (v) => api.backlog({ auto: v === 'auto' }))),
    row('Cards', seg([['titles', 'Titles'], ['details', 'Details']], b.show === 'details' ? 'details' : 'titles', (v) => api.backlog({ show: v })))
  );
  // Claude: on/off; when on, add to Desktop / copy for Code.
  const cl = S.claude || {};
  const clBox = el('div', 'bl-mini__btns');
  clBox.append(seg([['off', 'Off'], ['on', 'On']], cl.on ? 'on' : 'off', (v) => api.claudeSet(v === 'on')));
  if (cl.on) {
    const d = el('button', 'bl-act', cl.desktop ? 'Desktop ✓' : 'Add to Desktop');
    d.title = 'Add One Focus to Claude Desktop (then restart it)';
    d.addEventListener('click', async () => {
      const r = await api.claudeDesktop();
      d.textContent = r.error ? 'Couldn’t add' : 'Added · restart Claude';
      if (r.error) d.title = r.error;
    });
    const c = el('button', 'bl-act', 'Copy for Code');
    c.title = 'Copy the command that adds One Focus to Claude Code';
    c.addEventListener('click', async () => {
      const r = await api.claudeCode();
      c.textContent = r.error ? 'Couldn’t copy' : 'Copied';
      setTimeout(() => c.isConnected && (c.textContent = 'Copy for Code'), 2000);
    });
    clBox.append(d, c);
  }
  mini.append(row('Claude', clBox));
  // Groups: name, slots, what a free slot starts.
  const head = el('div', 'bl-mini__head');
  head.append(el('span', 'bl-mini__label', 'Groups'));
  const more = el('button', 'bl-act', 'All settings');
  more.title = 'Folders, words and messages: Settings → Groups';
  more.addEventListener('click', () => {
    closeMini();
    setView('settings');
    setTimeout(() => $('grp-card') && $('grp-card').scrollIntoView({ block: 'start' }), 60);
  });
  head.append(more);
  mini.append(head);
  const groups = (b.groups || []).map((g) => ({ ...g }));
  const save = async () => ((S = await api.backlog({ groups })), render());
  for (const g of groups) {
    const r = el('div', 'bl-mini__grp');
    const name = el('input', 'bl-mini__name');
    Object.assign(name, { type: 'text', value: g.name, maxLength: 40, spellcheck: false });
    name.addEventListener('change', () => ((g.name = name.value.trim() || g.name), save()));
    name.addEventListener('keydown', (e) => e.key === 'Enter' && name.blur());
    const slots = el('span', 'bl-mini__slots');
    const minus = el('button', 'bl-act', '−');
    const n = el('span', null, String(g.slots));
    const plus = el('button', 'bl-act', '+');
    minus.disabled = g.slots <= 1;
    plus.disabled = g.slots >= 9;
    minus.title = 'One slot fewer';
    plus.title = 'One slot more';
    minus.addEventListener('click', () => ((g.slots -= 1), save()));
    plus.addEventListener('click', () => ((g.slots += 1), save()));
    slots.append(minus, n, plus);
    const starts = el('select', 'bl-mini__starts');
    for (const [v, label] of [['off', 'Starts nothing'], ['code', 'Claude Code'], ['chat', 'Claude chat']]) {
      const o = el('option', null, label);
      o.value = v;
      starts.append(o);
    }
    starts.value = g.launch;
    starts.title = 'What a free slot starts';
    starts.addEventListener('change', () => ((g.launch = starts.value), save()));
    r.append(name, slots, starts);
    if (groups.length > 1) {
      const del = el('button', 'bl-act bl-mini__del', '×');
      del.title = 'Remove group';
      del.addEventListener('click', () => {
        groups.splice(groups.indexOf(g), 1);
        save();
      });
      r.append(del);
    }
    mini.append(r);
  }
  if (groups.length < 8) {
    const add = el('input', 'bl-mini__name bl-mini__add');
    Object.assign(add, { type: 'text', maxLength: 40, placeholder: 'New group', spellcheck: false });
    add.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || !add.value.trim()) return;
      groups.push({ id: 'g' + Date.now().toString(36), name: add.value.trim(), slots: 1, match: '', launch: 'off' });
      add.value = '';
      add.blur();
      save();
    });
    mini.append(add);
  }
}
$('bl-tidy').addEventListener('click', async () => {
  const b = $('bl-tidy');
  const r = await api.backlogTidy();
  b.textContent = r.error ? 'Claude is off' : r.last && r.last.error ? 'Couldn’t start' : 'Tidying…';
  b.title = r.error || (r.last && r.last.error) || 'A Claude Code session is tidying titles and details';
  setTimeout(() => ((b.textContent = 'Tidy'), (b.title = 'Claude tidies titles and details')), 4000);
});
