// The reminder popup on the main monitor: a planned block starts, or the
// running task goes past its planned time. Answering closes it.
const api = window.oneFocus;
let r = null;

function dur(ms) {
  const m = Math.max(1, Math.ceil(ms / 60000));
  return m < 60 ? m + 'm' : Math.floor(m / 60) + 'h ' + String(m % 60).padStart(2, '0') + 'm';
}

// Added a lot of time already? Then ask for the good-enough version.
const nudged = (x) => !!x && x.kind === 'over' && x.added > 0 && (x.added >= 30 || (x.planMins > 0 && x.added >= (x.planMins - x.added) * 0.5));
function kindText() {
  if (!r) return '';
  if (r.kind === 'block') return 'Planned to start now';
  if (nudged(r)) return `+${dur(r.added * 60e3)} added already · good enough to ship?`;
  const over = Date.now() - Date.parse(r.goal);
  return over < 60e3 ? 'Planned time’s up' : `${dur(over)} over the plan`;
}

function show(next) {
  r = next;
  document.getElementById('kind').textContent = kindText();
  document.getElementById('title').textContent = r.title;
  const acts = document.getElementById('acts');
  acts.replaceChildren();
  const btn = (label, action, cls) => {
    const b = document.createElement('button');
    b.textContent = label;
    if (cls) b.className = cls;
    b.addEventListener('click', () => api.reminderAct(action));
    acts.append(b);
  };
  if (r.kind === 'block') btn('Start', 'start', 'main');
  else if (nudged(r)) {
    btn('Done', 'done', 'main');
    btn('10m to wrap up', 'wrap');
    btn('+15m', 'extend', 'quiet');
  } else {
    btn('Done', 'done', 'main');
    btn('+15m', 'extend');
    btn('+30m', 'extend30');
  }
  btn('Open Today', 'plan');
  btn('×', 'dismiss', 'x');
  document.body.className = 'is-' + (r.style || 'corner');
  void document.body.offsetWidth;
  document.body.classList.add('in');
}

api.onToast(show);
setInterval(() => r && (document.getElementById('kind').textContent = kindText()), 1000);
