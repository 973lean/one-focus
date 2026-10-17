# One Focus — notes for Claude

Small Electron app for a secondary monitor: time, date, one task at a time from a single Google Tasks list, plus a light time log. Keep everything minimal; read `DESIGN_SYSTEM.md` before touching UI and `ROADMAP.md` for scope.

- `src/main.js` main process (window, sync, IPC), `src/tracker.js` time log (pure, tested), `src/google.js` OAuth + Tasks API (tested with a fake), `src/store.js` local JSON state.
- `npm test`, `npm run dev`, `npm run dist`. Windows portable exe is pushed to the `builds` branch (not `main`).
- The user tests on Windows; this repo is usually edited from a Linux cloud session.

## Remind the user at the start of the next session

- **Parked idea: full-screen announcements.** Blur every monitor and show one small, clear modal on the primary monitor with an announcement to keep the user on track. Must stay minimal. Ask whether they want to pick it up (see ROADMAP "Parked").
