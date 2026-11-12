# One Focus — notes for Claude

Small Electron app for a secondary monitor: time, date, one task at a time from a single Google Tasks list, plus a light time log. Keep everything minimal; read `DESIGN_SYSTEM.md` before touching UI and `ROADMAP.md` for scope.

- `src/ui/*.js` the page, split by area (core, now, log, today, planner, settings, reminders, boot); plain scripts sharing one global scope, loaded in that order by `index.html`. `src/toast.*` is the reminder popup.
- `src/main.js` main process (window, sync, IPC), `src/tracker.js` time log (pure, tested), `src/google.js` OAuth + Tasks API (tested with a fake), `src/store.js` local JSON state, `src/plan.js` time ordering + repeat dates (pure, tested).
- `npm test`, `npm run dev`, `npm run dist`.
- Releases are automatic: pushing app changes to `main` runs `.github/workflows/publish.yml`, which builds the Windows installer and force-replaces the `builds` branch. Installed apps auto-update from there (electron-updater, generic provider on raw.githubusercontent). Don't push builds by hand. Bump the minor version in package.json for notable releases; the patch number is the workflow run number.
- `docs/index.html` is the web view (GitHub Pages, reads a secret Gist the app updates via `src/web.js`).
- The user tests on Windows; this repo is usually edited from a Linux cloud session.
