// Today: the list for today (and All) on the main window.
// The ui/*.js files share one global scope (plain scripts, loaded in order by index.html).

// ---------- Today ----------

let renaming = false;

// Today = scheduled for today or overdue (Google's task date).
const scheduled = (t) => !!(t.due && S && t.due <= S.todayDate);
let todayTab = 'today';

function taskRow(t, { current, next, done, allView }) {
  const li = el('li', 'row' + (current ? ' is-current' : '') + (done ? ' is-done' : ''));
  const check = el('button', 'check');
  check.setAttribute('aria-label', done ? 'Mark not done' : 'Mark done');
  const title = titleWithSeries(el('span', 't', t.title), t);
  title.tabIndex = 0;
  li.append(check, title);
  if (current) li.append(el('span', 'tag', 'NOW'));
  else if (next) li.append(el('span', 'tag', 'NEXT'));
  else if (!done && t.due && t.due < S.todayDate) li.append(el('span', 'tag', 'OVERDUE'));
  else if (allView && scheduled(t)) li.append(el('span', 'tag', 'TODAY'));
  const g = !done && goalOf('g:' + t.id);
  if (g) li.append(el('span', 'goaltag', 'by ' + hm(g)));

  const run = async (action, value) => {
    li.classList.add('is-busy');
    const r = await api.task(action, t.id, value);
    li.classList.remove('is-busy');
    if (r && r.error) $('today-status').textContent = r.error;
  };
  check.addEventListener('click', () => run(done ? 'reopen' : 'complete'));

  if (!done) {
    const acts = el('div', 'acts');
    if (allView && !scheduled(t)) {
      const add = el('button', 'act', 'Today');
      add.title = 'Schedule for today';
      add.addEventListener('click', () => run('schedule'));
      acts.append(add);
    }
    if (!allView && !current) {
      const later = el('button', 'act', 'Later');
      later.title = 'Take off today (stays in All)';
      later.addEventListener('click', () => run('unschedule'));
      acts.append(later);
    }
    if (!current) {
      const start = el('button', 'act', 'Start');
      start.title = 'Start this task now';
      start.addEventListener('click', async () => {
        li.classList.add('is-busy');
        const r = await startWithClaim(t.id);
        li.classList.remove('is-busy');
        if (r && r.error) $('today-status').textContent = r.error;
      });
      acts.append(start);
    }
    const goalBtn = el('button', 'act', 'Goal');
    goalBtn.title = 'Set when this should be done by';
    goalBtn.addEventListener('click', () => toggleRowGoal(li, t));
    acts.append(goalBtn);
    const del = el('button', 'act', 'Delete');
    del.addEventListener('click', () => run('delete'));
    acts.append(del);
    li.append(acts);

    const rename = () => {
      renaming = true;
      const input = el('input', 'edit');
      input.type = 'text';
      input.value = t.title;
      title.replaceWith(input);
      input.focus();
      input.select();
      const finish = async (save) => {
        if (!renaming) return;
        renaming = false;
        const v = input.value.trim();
        input.replaceWith(title);
        if (save && v && v !== t.title) {
          title.textContent = v;
          await run('rename', v);
        }
      };
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') finish(true);
        if (e.key === 'Escape') finish(false);
      });
      input.addEventListener('blur', () => finish(true));
    };
    title.addEventListener('click', rename);
    title.addEventListener('keydown', (e) => e.key === 'Enter' && rename());
  }
  return li;
}

function renderToday() {
  if (!S || renaming) return;
  document.querySelectorAll('#today-tabs .tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.list === todayTab)));
  const mapTab = todayTab === 'map'; // Map is hidden for now; its code stays
  $('today-map').hidden = !mapTab;
  if (mapTab) {
    $('today-off').hidden = $('today-on').hidden = true;
    return;
  }
  $('today-off').hidden = S.connected;
  $('today-on').hidden = !S.connected;
  if (!S.connected) return;
  const { done, syncedAt, error } = S.today;
  const allView = todayTab === 'all';
  const open = allView ? S.today.open : S.today.open.filter(scheduled);
  document.querySelectorAll('#today-tabs .tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.list === todayTab)));

  const openEl = $('today-open');
  const runningId = S.current && S.current.googleId;
  const nextId = S.next && S.next.id;
  openEl.replaceChildren(...open.map((t) => taskRow(t, { current: t.id === runningId, next: t.id === nextId, allView })));
  if (!open.length)
    openEl.append(el('li', 'empty', allView ? 'Your list is empty. Add a task below.' : 'Nothing scheduled today. Add one below, or pick from All.'));
  enableDrag(openEl, open);
  $('today-open-title').textContent = allView ? `All tasks · ${open.length}` : `Up next · ${open.length}`;
  $('today-add').placeholder = allView ? 'Add to the list (not today) · Shift+Enter to start now' : 'Add a task for today · Shift+Enter to start now';

  const doneEl2 = $('today-done');
  doneEl2.replaceChildren(...done.map((t) => taskRow(t, { done: true })));
  $('today-done-title').hidden = doneEl2.hidden = allView || !done.length;

  $('today-status').textContent = error || (syncedAt ? `List “${S.settings.listName}” · synced ${hm(syncedAt)}` : 'Syncing…');
}

document.querySelectorAll('#today-tabs .tab').forEach((t) =>
  t.addEventListener('click', () => {
    todayTab = t.dataset.list;
    renderToday();
    if (todayTab === 'map') loadLog();
  })
);
