# One Focus

A small, quiet window for a secondary monitor that keeps you on one thing at a time.

## What it does (v0.1)

1. **Time and date** — the time, large; the date beneath it.
2. **Current task** — click the line under the clock, type what you're doing, press Enter. It shows the task and, fainter, the time you started it.

Every task you set is saved with its start and end time to `tasks.json` in the app's user-data folder.

## Run it

```bash
npm install
npm start
```

To build an executable: `npm run dist` builds for the OS you run it on. Windows gives a single portable `.exe` (no install), macOS a `.dmg`, Linux an AppImage. Output goes to `dist/`.

For live editing, run `npm run dev`: the window reloads whenever you save `index.html`, `styles.css` or `renderer.js`. Changes to `main.js` or `preload.js` need a restart.

## Roadmap

See [ROADMAP.md](ROADMAP.md).

## Design

See [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md).
