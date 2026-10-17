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

For live editing, run `npm run dev`: the window reloads whenever you save `index.html`, `styles.css` or `renderer.js`. Changes to `main.js` or `preload.js` need a restart.

## Roadmap

- [x] Clock and date
- [x] Manual current task with start time, saved locally
- [ ] Connect Microsoft To Do and/or Google Tasks so the current task comes from your real list
- [ ] Guide the day: show what's next when the current task is done

## Design

See [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md).
