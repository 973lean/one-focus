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

function backlogList() {
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

  const row = (r, lane, i) => {
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

    // Quiet actions on hover.
    const acts = el('span', 'bl-acts');
    const below = () => {
      const slot = el('span', 'bl-ask');
      main.append(slot);
      return slot;
    };
    const editLink = act('Link', r.link ? 'Change the link (empty removes it)' : 'Add a link', () =>
      inlineEdit(below(), r.link || '', 2000, (v) => blItem(t.id, { link: v && !/^https?:\/\//i.test(v) && /^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(v) ? 'https://' + v : v }), 'Link')
    );
    editLink.classList.add('bl-act--link');
    if (lane === 'active') {
      acts.append(
        act(you ? 'Edit request' : 'Needs me', 'What it needs from you (makes it your turn)', () =>
          inlineEdit(main.querySelector('.bl-ask') || below(), r.ask || '', 200, (v) => blItem(t.id, { ask: v }), 'Request')
        ),
        editLink,
        act('Queue', 'Back to the queue (frees the slot)', () => blItem(t.id, { lane: 'queued', index: 0 }))
      );
    } else if (lane === 'queued') {
      if (freeIn(r.group) > 0) acts.append(act('Start', 'Make it active', () => blItem(t.id, { lane: 'active' })));
      acts.append(editLink, act('Evergreen', 'Keep it as a standing task', () => blItem(t.id, { lane: 'evergreen' })));
    } else acts.append(editLink, act('Queue', 'Move it to the queue', () => blItem(t.id, { lane: 'queued' })));

    // Right side: whose turn (click to flip), queued time, or last done.
    let side;
    if (lane === 'active') {
      side = el('button', 'bl-state' + (you ? ' is-you' : ''));
      side.title = you ? 'Hand it back: mark it running' : 'Mark it as needing you';
      side.append(el('i'), timeNode('bl-time', you ? 'you' : 'run', r.since));
      side.addEventListener('click', (e) => (e.stopPropagation(), blItem(t.id, { turn: you ? 'agent' : 'you' })));
    } else side = timeNode('d', lane === 'queued' ? 'ago' : 'done', lane === 'queued' ? r.queuedAt : r.lastDone);
    li.append(grip, check, main, acts);
    const grp = L.groups.find((g) => g.id === r.group);
    if (lane === 'queued' && L.groups.length > 1 && grp && !t.title.toLowerCase().includes(grp.name.toLowerCase())) li.append(el('span', 'bl-tag', grp.name));
    li.append(side);
    return li;
  };

  const head = (label, count, extra) => {
    const h = el('div', 'bl-head');
    h.append(el('span', 'bl-head__name', label));
    if (count) h.append(el('span', 'bl-head__count', count));
    if (extra) h.append(extra);
    return h;
  };
  const list = (lane, rows) => {
    const ul = el('ul', 'su-tasks__list bl-list');
    ul.dataset.lane = lane;
    rows.forEach((r, i) => ul.append(row(r, lane, i)));
    return ul;
  };

  // Active: one section per group (just "Active" with one group). Requests
  // first, then running, then held slots ("Starting Claude…") and open ones.
  const many = L.groups.length > 1;
  for (const g of L.groups) {
    const rows = L.active.filter((r) => r.group === g.id);
    const holds = g.pending || [];
    const slotBtns = el('span', 'bl-slots');
    const setSlots = (n) => api.backlog({ slots: n, group: g.id }).then((r) => ((S = r), render()));
    const minus = act('−', 'Remove an open slot', () => setSlots(g.slots - 1));
    const plus = act('+', 'Add a slot', () => setSlots(g.slots + 1));
    minus.disabled = g.slots <= Math.max(1, rows.length);
    plus.disabled = g.slots >= 9;
    slotBtns.append(minus, plus);
    const ul = list('active', rows);
    ul.dataset.group = g.id;
    for (const p of holds) {
      const h = el('li', 'bl-slot is-starting');
      const t = el('span', 'bl-slot__time', ago(p.at));
      Object.assign(t.dataset, { kind: 'ago', at: p.at });
      h.append(el('i'), el('span', null, 'Starting Claude ·'), t);
      h.title = 'A Claude session was started for this group; the slot is held until it adds its task (up to 15 minutes).';
      ul.append(h);
    }
    for (let i = rows.length + holds.length; i < g.slots; i++)
      ul.append(el('li', 'bl-slot', 'Open slot'));
    const hd = head(many ? g.name : 'Active', `${rows.length + holds.length}/${g.slots}`, slotBtns);
    if (many) hd.classList.add('is-group');
    box.append(hd, ul);
  }

  // Evergreen comes forward (above the queue, brighter) when every slot is
  // busy and nothing needs you: it's what to do while you wait.
  const waiting = full && !needsYou && L.active.length > 0;
  const eg = head('Evergreen', '');
  const egList = list('evergreen', L.evergreen);
  const q = [head('Queued', L.queued.length ? String(L.queued.length) : ''), list('queued', L.queued)];
  if (waiting) {
    eg.classList.add('is-now');
    egList.classList.add('is-now');
    box.append(eg, egList, ...q);
  } else box.append(...q, eg, egList);

  // Add a task: it joins the queue.
  const addWrap = el('div', 'su-tasks__addwrap');
  const add = el('input', 'su-tasks__add');
  add.type = 'text';
  add.maxLength = 300;
  add.placeholder = 'Add a task to the queue';
  add.addEventListener('keydown', async (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') return add.blur();
    if (e.key !== 'Enter' || !add.value.trim()) return;
    const title = add.value.trim();
    add.value = '';
    await api.task('add', null, title);
    setTimeout(() => { const again = document.querySelector('#vw-list .su-tasks__add'); if (again) again.focus(); }, 60);
  });
  addWrap.append(add);
  box.append(addWrap);
  return box;
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
      const top = (ul.previousElementSibling || ul).getBoundingClientRect().top;
      const bottom = ul.getBoundingClientRect().bottom;
      const d = ev.clientY < top ? top - ev.clientY : ev.clientY > bottom ? ev.clientY - bottom : 0;
      if (!best || d < best.d) best = { ul, d };
    }
    const ul = best.ul;
    const lane = ul.dataset.lane;
    for (const x of lists) x.previousElementSibling.classList.remove('is-full');
    const g = lane === 'active' ? groupInfo.find((x) => x.id === ul.dataset.group) : null;
    const used = g ? ul.querySelectorAll('.bl-row:not(.is-placeholder)').length : 0;
    if (g && li.parentElement !== ul && used + (g.pending || []).length >= g.slots) {
      ul.previousElementSibling.classList.add('is-full');
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
    target = { lane, index, group: g ? g.id : undefined };
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
    for (const x of lists) x.previousElementSibling.classList.remove('is-full');
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

// View's bottom-left corner: Backlog on/off and, when on, Manual / Auto.
function paintBacklogCorner() {
  const c = $('bl-corner');
  if (!c || !S) return;
  c.hidden = setupMode || view !== 'view';
  if (c.hidden) return;
  const on = backlogOn();
  $('bl-toggle').setAttribute('aria-pressed', String(on));
  $('bl-mode').hidden = !on;
  c.classList.toggle('is-on', on);
  document.querySelectorAll('#bl-mode .bl-seg').forEach((b) => b.setAttribute('aria-selected', String((b.dataset.v === 'auto') === !!(S.backlog && S.backlog.auto))));
}
$('bl-toggle').addEventListener('click', async () => {
  S = await api.backlog({ on: !backlogOn() });
  render();
});
document.querySelectorAll('#bl-mode .bl-seg').forEach((b) =>
  b.addEventListener('click', async () => {
    S = await api.backlog({ auto: b.dataset.v === 'auto' });
    render();
  })
);
