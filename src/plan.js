// Planning helpers. Pure: no Electron imports.

// The time a task is pinned to: its planned start, else its "by" goal.
function timeOf(meta, id) {
  const m = meta['g:' + id];
  if (!m) return null;
  if (m.plan) return Date.parse(m.plan.start);
  if (m.goal) return Date.parse(m.goal);
  return null;
}

// Tasks with a time come first, earliest first; the rest keep list order.
function orderTasks(open, meta) {
  const timed = open.filter((t) => timeOf(meta, t.id) != null).sort((a, b) => timeOf(meta, a.id) - timeOf(meta, b.id));
  const untimed = open.filter((t) => timeOf(meta, t.id) == null);
  return [...timed, ...untimed];
}

const dayStr = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Next date for a repeating task, after `from` ("YYYY-MM-DD").
function nextDate(from, freq) {
  const [y, m, d] = from.split('-').map(Number);
  const dt = new Date(y, m - 1, d, 12);
  if (freq === 'weekly') dt.setDate(dt.getDate() + 7);
  else {
    dt.setDate(dt.getDate() + 1);
    if (freq === 'weekdays') while (dt.getDay() === 0 || dt.getDay() === 6) dt.setDate(dt.getDate() + 1);
  }
  return dayStr(dt);
}

// Does a repeating task land on this date (for faint previews in Setup)?
function repeatsOn(fromDate, freq, date) {
  if (date <= fromDate) return false;
  const [y, m, d] = date.split('-').map(Number);
  const day = new Date(y, m - 1, d, 12).getDay();
  if (freq === 'daily') return true;
  if (freq === 'weekdays') return day !== 0 && day !== 6;
  if (freq === 'weekly') {
    const [y0, m0, d0] = fromDate.split('-').map(Number);
    return day === new Date(y0, m0 - 1, d0, 12).getDay();
  }
  return false;
}

module.exports = { timeOf, orderTasks, nextDate, repeatsOn, dayStr };
