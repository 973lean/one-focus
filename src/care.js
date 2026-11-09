// Water and walk reminders. Pure timing logic, no Electron imports.
// A reminder is due when its interval has passed since the last one was
// answered (or since the app started), and you're actually at the computer.
const INTERVALS = [0, 15, 20, 30, 45, 60, 90, 120]; // minutes; 0 = off
const KINDS = ['water', 'walk'];

// last: { water: iso, walk: iso }; settings: { waterMinutes, walkMinutes }
// present: at the computer and not paused/away/on hold/in a check.
function dueReminder({ now = Date.now(), last, settings, present }) {
  if (!present) return null;
  for (const kind of KINDS) {
    const min = settings[kind + 'Minutes'];
    if (!min) continue;
    const since = Date.parse(last[kind] || 0) || 0;
    if (now - since >= min * 60e3) return kind;
  }
  return null;
}

// Counts per local day label, e.g. { "Mon, Nov 9": { water: 5, walk: 2 } }.
function countByDay(log, label) {
  const out = {};
  for (const e of log) {
    const d = label(new Date(e.at));
    out[d] = out[d] || { water: 0, walk: 0 };
    out[d][e.kind] = (out[d][e.kind] || 0) + 1;
  }
  return out;
}

module.exports = { INTERVALS, KINDS, dueReminder, countByDay };
