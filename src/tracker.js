// Time tracking. While you're at the computer, exactly one session runs:
// a task session when a task is started, otherwise an idle session.
// Away (10 min no input) counts as idle, even mid-task.
// Locked, asleep or quit = nothing runs.
// Pure logic: no Electron imports.
const MIN_SESSION_MS = 5000;
const IDLE = { key: 'idle', title: 'Idle', googleId: null };
const iso = () => new Date().toISOString();

class Tracker {
  constructor(state, save) {
    this.s = state;
    this.save = save;
    this.pauses = new Set(); // reasons nothing is timed: lock, sleep, quit
    this.away = false; // no input for a while: time goes to idle
  }

  // On launch: close a session left open by a crash at the last heartbeat.
  recover() {
    const o = this.s.open;
    if (o) this._close(this.s.heartbeat && this.s.heartbeat > o.start ? this.s.heartbeat : o.start);
    this._open();
    this.save();
  }

  _open(at = iso()) {
    if (this.pauses.size || this.s.open) return;
    const { key, title, googleId } = (!this.away && this.s.current) || IDLE;
    this.s.open = { key, title, googleId, start: at };
  }

  _close(at = iso()) {
    const o = this.s.open;
    if (!o) return;
    this.s.open = null;
    if (Date.parse(at) - Date.parse(o.start) >= MIN_SESSION_MS) this.s.sessions.push({ ...o, end: at });
  }

  // Start a task ({ key, title, googleId }) or stop (null). Returns true when it changed.
  setCurrent(task) {
    const cur = this.s.current;
    if (cur && task && cur.key === task.key) {
      if (cur.title !== task.title) {
        cur.title = task.title;
        if (this.s.open) this.s.open.title = task.title;
        this.save();
      }
      return false;
    }
    if (!cur && !task) return false;
    this._close();
    this.s.current = task ? { ...task, since: iso() } : null;
    this._open();
    this.save();
    return true;
  }

  pause(reason, at) {
    this.pauses.add(reason);
    this._close(at);
    this.save();
  }

  resume(reason) {
    this.pauses.delete(reason);
    this._open();
    this.save();
  }

  // Away: end the task session at `at` (when input stopped) and count the
  // time since as idle. Coming back resumes the task.
  setAway(on, at) {
    if (on === this.away) return;
    this.away = on;
    if (!this.s.current) return; // already idle: nothing to split
    this._close(at);
    this._open(at);
    this.save();
  }

  isPaused(reason) {
    return this.pauses.has(reason);
  }

  recordCompletion(task, at) {
    if (this.s.completions.some((c) => c.key === task.key && c.at === at)) return;
    this.s.completions.push({ ...task, at });
    this.save();
  }

  removeCompletion(key) {
    for (let i = this.s.completions.length - 1; i >= 0; i--) {
      if (this.s.completions[i].key === key) {
        this.s.completions.splice(i, 1);
        this.save();
        return;
      }
    }
  }

  // Finished time on the current task since it became current.
  trackedSince(cur) {
    let ms = 0;
    for (const x of this.s.sessions)
      if (x.key === cur.key && x.start >= cur.since) ms += Date.parse(x.end) - Date.parse(x.start);
    return ms;
  }

  heartbeat() {
    this.s.heartbeat = iso();
    this.save();
  }
}

module.exports = Tracker;
