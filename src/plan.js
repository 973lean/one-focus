// Planning helpers. Pure: no Electron imports.
// Wrapped so its names don't leak into the page's global scope.
(function (root) {

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

  // Repeat rules. Presets are strings; custom is { every, unit, days }:
  // every N days / weeks (on some weekdays, 0 = Sun) / months.
  function normalize(rule, fromDate) {
    if (!rule) return null;
    if (rule === 'daily') return { every: 1, unit: 'day' };
    if (rule === 'weekdays') return { every: 1, unit: 'week', days: [1, 2, 3, 4, 5] };
    const base = fromDate ? parse(fromDate).getDay() : 1;
    if (rule === 'weekly') return { every: 1, unit: 'week', days: [base] };
    if (typeof rule !== 'object') return null;
    const every = Math.min(Math.max(Math.round(+rule.every) || 1, 1), 99);
    const unit = ['day', 'week', 'month'].includes(rule.unit) ? rule.unit : 'day';
    const days = unit === 'week' ? [...new Set((rule.days || []).filter((d) => d >= 0 && d <= 6))].sort() : undefined;
    return unit === 'week' ? { every, unit, days: days.length ? days : [base] } : { every, unit };
  }

  function parse(key) {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d, 12);
  }
  const mondayOf = (dt) => {
    const m = new Date(dt);
    m.setDate(m.getDate() - ((m.getDay() + 6) % 7));
    return m;
  };

  // Next date for a repeating task, after `from` ("YYYY-MM-DD").
  function nextDate(from, ruleIn) {
    const rule = normalize(ruleIn, from);
    const dt = parse(from);
    if (!rule) return null;
    if (rule.unit === 'day') {
      dt.setDate(dt.getDate() + rule.every);
      return dayStr(dt);
    }
    if (rule.unit === 'month') {
      const day = dt.getDate();
      const n = new Date(dt.getFullYear(), dt.getMonth() + rule.every, 1, 12);
      n.setDate(Math.min(day, new Date(n.getFullYear(), n.getMonth() + 1, 0).getDate()));
      return dayStr(n);
    }
    // Weeks: the next chosen weekday, in a week that's a multiple of `every` away.
    const anchor = mondayOf(dt);
    for (let i = 1; i <= 7 * rule.every + 7; i++) {
      const c = new Date(dt);
      c.setDate(c.getDate() + i);
      const weeks = Math.round((mondayOf(c) - anchor) / (7 * 86400e3));
      if (rule.days.includes(c.getDay()) && weeks % rule.every === 0) return dayStr(c);
    }
    return null;
  }

  // Does a repeating task land on this date (for faint previews in Setup)?
  function repeatsOn(fromDate, rule, date) {
    let d = fromDate;
    for (let i = 0; i < 400 && d && d < date; i++) d = nextDate(d, rule);
    return d === date && date !== fromDate;
  }

  // Short label: "Daily", "Every 2 weeks · Mon, Thu", "Monthly".
  const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  function describe(ruleIn, fromDate) {
    if (ruleIn === 'daily') return 'Daily';
    if (ruleIn === 'weekdays') return 'Weekdays';
    if (ruleIn === 'weekly') return 'Weekly';
    const r = normalize(ruleIn, fromDate);
    if (!r) return '';
    const unit = r.every === 1 ? { day: 'Daily', week: 'Weekly', month: 'Monthly' }[r.unit] : `Every ${r.every} ${r.unit}s`;
    return r.unit === 'week' ? `${unit} · ${r.days.map((d) => DAY[d]).join(', ')}` : unit;
  }

  const api = { timeOf, orderTasks, nextDate, repeatsOn, describe, normalize, dayStr };
  // Node (main process, tests) and the page (window.Plan) share this file.
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Plan = api;
})(typeof window !== 'undefined' ? window : globalThis);
