const clockEl = document.getElementById('clock');
const dateEl = document.getElementById('date');
const taskEl = document.getElementById('task');
const inputEl = document.getElementById('task-input');
const sinceEl = document.getElementById('since');

const timeFmt = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
const dateFmt = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

// Feature 1: time and date.
function tick() {
  const now = new Date();
  // Big digits, with any AM/PM shown as a small suffix so it never wraps.
  const parts = timeFmt.formatToParts(now);
  const period = parts.find((x) => x.type === 'dayPeriod');
  clockEl.textContent = parts.filter((x) => x.type !== 'dayPeriod').map((x) => x.value).join('').trim();
  if (period) {
    const span = document.createElement('span');
    span.className = 'clock__period';
    span.textContent = period.value;
    clockEl.append(span);
  }
  clockEl.dateTime = now.toISOString();
  dateEl.textContent = dateFmt.format(now);
}
tick();
setInterval(tick, 1000);

// Feature 2: current task and when it was set.
function showTask(task) {
  if (task && task.text) {
    taskEl.textContent = task.text;
    taskEl.classList.remove('is-empty');
    sinceEl.textContent = timeFmt.format(new Date(task.startedAt));
  } else {
    taskEl.textContent = 'What are you doing?';
    taskEl.classList.add('is-empty');
    sinceEl.textContent = '';
  }
}

function startEditing() {
  inputEl.value = taskEl.classList.contains('is-empty') ? '' : taskEl.textContent;
  taskEl.hidden = true;
  sinceEl.hidden = true;
  inputEl.hidden = false;
  inputEl.focus();
  inputEl.select();
}

function stopEditing() {
  inputEl.hidden = true;
  taskEl.hidden = false;
  sinceEl.hidden = false;
}

taskEl.addEventListener('click', startEditing);
taskEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') startEditing();
});

inputEl.addEventListener('keydown', async (e) => {
  if (e.key === 'Escape') return stopEditing();
  if (e.key !== 'Enter') return;
  const text = inputEl.value.trim();
  if (text && text !== taskEl.textContent) showTask(await window.oneFocus.set(text));
  stopEditing();
});
inputEl.addEventListener('blur', stopEditing);

window.oneFocus.current().then(showTask);

// Window controls: shown only while the pointer is over the window.
window.oneFocus.onHover((inside) => document.body.classList.toggle('is-hover', inside));
document.querySelectorAll('.bar__btn').forEach((btn) =>
  btn.addEventListener('click', () => window.oneFocus.windowAction(btn.dataset.action))
);
