# One Focus — notes for Claude

Small Electron app for a secondary monitor: time, date, one task at a time from a single Google Tasks list, plus a light time log. Keep everything minimal; read `DESIGN_SYSTEM.md` before touching UI and `ROADMAP.md` for scope.

- `src/ui/*.js` the page, split by area (core, now, log, today, planner, backlog, settings, reminders, quick, boot); plain scripts sharing one global scope, loaded in that order by `index.html`. `src/toast.*` is the reminder popup.
- `src/main.js` main process (window, sync, IPC), `src/tracker.js` time log (pure, tested), `src/google.js` OAuth + Tasks API (tested with a fake), `src/store.js` local JSON state, `src/plan.js` time ordering + repeat dates (pure, tested), `src/backlog.js` View's backlog mode lanes/slots/auto fill (pure, tested). `src/claude.js` the MCP tools Claude uses to write to the backlog (pure, tested); `src/mcp-bridge.js` the stdio bridge Claude Desktop runs; the HTTP server is in main.js.
- `npm test`, `npm run dev`, `npm run dist`.
- **Always push finished work straight to `main`** (the user's standing instruction, 2026-11-23): commit, then merge into `main` and push it so the installed app updates. Don't leave work only on a side branch.
- Releases are automatic: pushing app changes to `main` runs `.github/workflows/publish.yml`, which builds the Windows installer and force-replaces the `builds` branch. Installed apps auto-update from there (electron-updater, generic provider on raw.githubusercontent). Don't push builds by hand. Bump the minor version in package.json for notable releases; the patch number is the workflow run number.
- `docs/index.html` is the web view (GitHub Pages, reads a secret Gist the app updates via `src/web.js`).
- The user tests on Windows; this repo is usually edited from a Linux cloud session.
- **No helper text in the UI** (the user's standing rule, 2026-11-25): no explanatory subtext, empty-state sentences or hints like "Standing tasks for while things run…" or "Open slot · queue is empty". Labels and data only; explanations go in tooltips at most.
- Before calling any visible change done, run the `self-check` skill (`.claude/skills/self-check`): render, drive, score, fix, repeat.
