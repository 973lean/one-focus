// Reminders on Now (the popup itself lives in toast.js).
// The ui/*.js files share one global scope (plain scripts, loaded in order by index.html).

// ---------- Reminders on Now: a planned block starts / running over ----------
let shownReminder = null;
function renderReminder() {
  const r = S.settings.appMode !== 'light' && S.reminder;
  $('remind').hidden = true;
  if (!r) return (shownReminder = null);
  if (shownReminder === r.id) return;
  shownReminder = r.id;
  jolt();
}
