# Roadmap

**Goal:** a small always-on window that shows the time and the one task you're on, pulled from a single Google Tasks list, and logs how long you actually spend on each task.

## Done

### v0.1–0.2
- [x] Time and date, centred, time most prominent
- [x] Manual current task with start time, saved locally
- [x] Frameless window; minimize / maximize / close fade in on hover
- [x] `npm run dev` with auto-reload, `npm run dist` for executables
- [x] Design system (`DESIGN_SYSTEM.md`)

## v0.3 — Google Tasks + time log (in progress)

### Principles
- **One list.** One Focus uses a single Google Tasks list (default name "One Focus", created automatically). Everything else in Google Tasks is ignored.
- **One task at a time.** The current task is the first unfinished task in that list. Finish it and the next one appears.
- **Honest time.** Time is logged only while a task is current and you're at the computer.

### Main screen
- [ ] Time (most prominent) and date
- [ ] Current task, with optional start time and optional time elapsed (both toggled in Settings)
- [ ] "Done" appears on hover: completes the task in Google Tasks and moves to the next
- [ ] Without Google connected, falls back to typing a task manually

### Google Tasks connection
- [ ] Sign in once through the browser (OAuth loopback + PKCE), using your own Google Cloud Desktop client ID
- [ ] Find or create the One Focus list automatically
- [ ] Sync every minute, after every edit, and on wake/unlock
- [ ] Sign-in token stored with OS encryption (Electron `safeStorage`)

### Task log
- [ ] A session is logged each time a task is current: start, end, task
- [ ] Sessions pause on screen lock, sleep, quit, and after 10 minutes idle
- [ ] Crash-safe: an unfinished session is closed at the last heartbeat on next launch
- [ ] Imports the v0.1 manual task history

### Menu (top left, appears on hover)
1. **Log** — time tracked, tasks done and sessions for Today / Week / Month / All, top tasks by time, session list
2. **Today** — all open tasks in the list plus tasks done today; add, rename, complete / reopen, delete, and "Focus" (move to top) — all sent back to Google Tasks
3. **Settings** — Google connection (client ID, secret, list name), show start time, show elapsed, always on top

## Later
- [ ] Microsoft To Do (needs an Entra directory and app registration)
- [ ] App icon and bundled Inter font
- [ ] Mac and Linux builds through the GitHub Actions workflow
