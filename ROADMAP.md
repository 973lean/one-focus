# Roadmap

**Goal:** a small always-on window that shows the time and the one task you're on, pulled from a single Google Tasks list, and logs how long you actually spend on each task.

## Done

### v0.1–0.2
- [x] Time and date, centred, time most prominent
- [x] Manual current task with start time, saved locally
- [x] Frameless window; minimize / maximize / close fade in on hover
- [x] `npm run dev` with auto-reload, `npm run dist` for executables
- [x] Design system (`DESIGN_SYSTEM.md`)

## v0.3 — Google Tasks + time log (built, needs a real-account test)

### Principles
- **One list.** One Focus uses a single Google Tasks list (default name "One Focus", created automatically). Everything else in Google Tasks is ignored.
- **One task at a time.** The current task is the first unfinished task in that list. Finish it and the next one appears.
- **Honest time.** Time is logged only while a task is current and you're at the computer.

### Main screen
- [x] Time (most prominent) and date
- [x] Current task, with optional start time and optional time elapsed (both toggled in Settings)
- [x] "Done" appears on hover: completes the task in Google Tasks and moves to the next
- [x] Without Google connected, falls back to typing a task manually

### Google Tasks connection
- [x] Sign in once through the browser (OAuth loopback + PKCE), using your own Google Cloud Desktop client ID
- [x] Find or create the One Focus list automatically
- [x] Sync every minute, after every edit, and on wake/unlock
- [x] Sign-in token stored with OS encryption (Electron `safeStorage`)

### Task log
- [x] A session is logged each time a task is current: start, end, task
- [x] Sessions pause on screen lock, sleep, quit, and after 10 minutes idle
- [x] Crash-safe: an unfinished session is closed at the last heartbeat on next launch
- [x] Imports the v0.1 manual task history

### Menu (top left, appears on hover)
1. **Log** — time tracked, tasks done and sessions for Today / Week / Month / All; session list grouped by day with each day's total
2. **Today** — all open tasks in the list plus tasks done today; add, rename, complete / reopen, delete, and "Focus" (move to top) — all sent back to Google Tasks
3. **Settings** — Google connection (client ID, secret, list name), show start time, show elapsed, always on top

## v0.4 — queue and idle time
- [x] Tasks wait in a queue; nothing starts until you click Start (Now screen or Today)
- [x] No Stop: a task ends with Done, or by starting another from Today
- [x] Start time and time on task sit on their own line under the task
- [x] Idle time: time at the computer with no task running, shown on Now and in the Log (per period and per day)
- [x] Current task line and its start time / time on task about 20% larger

## v0.5 — after Done, jolts, polish
- [x] After Done: pick a category (3 recent chips + search) and rate focus and vibe (1–5 stars). Both optional, both can be turned off
- [x] Log: time per category with average rating
- [x] Jolt: time and task flash blue for 0.3s every Off / 30 / 60 / 90 / 120 minutes
- [x] App icon, remembers window position and size, open at login (Settings)

## Parked
- [ ] Full-screen announcements: blur all monitors, one small clear modal on the primary monitor with a message to keep you on track. Minimal.

## Next
- [x] Test sign-in and sync against a real Google account on Windows

## Later
- [ ] Microsoft To Do (needs an Entra directory and app registration)
- [ ] App icon and bundled Inter font
- [ ] Mac and Linux builds through the GitHub Actions workflow
