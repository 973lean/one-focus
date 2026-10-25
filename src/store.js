// Local state: settings, the time log, and the Google sign-in token.
// Everything lives in one JSON file in the OS user-data folder.
const { app, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  settings: {
    showSince: true,
    showElapsed: true,
    alwaysOnTop: false,
    listName: 'One Focus',
    clientId: '',
    clientSecret: '',
    askCategory: true, // category chips after Done
    askRating: true, // 1–5 stars after Done
    joltMinutes: 60, // 0 = off
    goalDisplay: 'ring', // ring | ringPct | text
    checkMinutes: 120, // "Still on this?" after a task runs this long; 0 = off
    endOfDay: '', // "HH:MM" to check a still-running task; '' = off
    awayMinutes: 10, // no input this long = away (counts as idle)
    launchAtLogin: false,
  },
  google: { refreshToken: null, listId: null, connectedAt: null },
  current: null, // { key, title, googleId, since }
  open: null, // the session being timed right now: { key, title, googleId, start }
  sessions: [], // finished sessions: { key, title, googleId, start, end }
  completions: [], // { key, title, googleId, at }
  heartbeat: null,
  categories: [], // { name, lastUsed }
  taskMeta: {}, // task key -> { category, rating }
  window: null, // last window bounds { x, y, width, height }
  held: null, // the task paused by a Hold, restored by "Back to"
  holdNames: [], // { name, lastUsed }
  checkFrom: null, // last "Still on this?" confirm
  eodDate: null, // day the end-of-day check last ran
};

const dir = () => app.getPath('userData');
const file = () => path.join(dir(), 'state.json');

function load() {
  let saved = {};
  try {
    saved = JSON.parse(fs.readFileSync(file(), 'utf8'));
  } catch {
    saved = migrateV1();
  }
  const base = structuredClone(DEFAULTS);
  return {
    ...base,
    ...saved,
    settings: { ...base.settings, ...(saved.settings || {}) },
    google: { ...base.google, ...(saved.google || {}) },
  };
}

// v0.1 stored manual tasks in tasks.json; turn them into log sessions once.
function migrateV1() {
  try {
    const old = JSON.parse(fs.readFileSync(path.join(dir(), 'tasks.json'), 'utf8'));
    const sessions = old
      .filter((t) => t.text && t.startedAt && t.endedAt)
      .map((t) => ({ key: 'm:' + t.text, title: t.text, googleId: null, start: t.startedAt, end: t.endedAt }));
    return { sessions };
  } catch {
    return {};
  }
}

function save(state) {
  fs.mkdirSync(dir(), { recursive: true });
  const tmp = file() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state));
  fs.renameSync(tmp, file());
}

function getRefreshToken(state) {
  const t = state.google.refreshToken;
  if (!t) return null;
  if (t.startsWith('enc:')) {
    try {
      return safeStorage.decryptString(Buffer.from(t.slice(4), 'base64'));
    } catch {
      return null;
    }
  }
  return t.replace(/^plain:/, '');
}

function setRefreshToken(state, token) {
  if (!token) state.google.refreshToken = null;
  else if (safeStorage.isEncryptionAvailable())
    state.google.refreshToken = 'enc:' + safeStorage.encryptString(token).toString('base64');
  else state.google.refreshToken = 'plain:' + token;
}

module.exports = { load, save, getRefreshToken, setRefreshToken };
