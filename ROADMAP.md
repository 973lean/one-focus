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

## v0.6 — auto-update
- [x] Install once; every push to `main` is built on GitHub and installed apps update themselves
- [x] Settings → App: version, update status, Restart to update

## v0.7 — derailments, checks, corrections
- [x] **Hold:** pause the running task for a meeting, call, break, etc. (3 recent + search). Shows "Hold: Meeting · 12m" and **Back to: <task>**. Logged as its own time; the task isn't marked done
- [x] **Switch:** in Today, start any task, or type a new one and start it straight away (added to the top of the list)
- [x] **Still on this?** after a task runs 2h (on by default; Off / 1h / 2h / 3h): every monitor gets a soft blur with a slight dark tint, only One Focus stays sharp, Done becomes **Confirm**. Confirm clears it and restarts the 2h. Not during a Hold
- [x] **End of day** (off until you set a time): same blur if a task is still running, with **Done** / **Tomorrow**
- [x] **Edit sessions in the Log:** change start/end, split at a time into a Hold, or delete
- [x] **Away after** setting: 5 / 10 / 20 / 30 minutes
- [x] **Drag to reorder** tasks in Today (saved to Google)
- Blur: blurred snapshot of each monitor (v0.11)

## v0.8 — Today means today
- [x] Today shows only tasks scheduled for today (Google date) or overdue; only these queue on Now
- [x] All tab shows the whole list; **Today** schedules a task, **Later** unschedules it
- [x] Adding from Today schedules for today; from All it has no date

## v0.9 — goal time
- [x] Set a goal time for the running or next task by hovering/clicking a timeline of the rest of the day
- [x] "2h 10m left" / "15m over" on Now; one jolt at the goal

## v0.10 — cleaner goal progress, check for updates
- [x] Goal progress as a ring after the time on task (default), ring + %, or time left (Settings)
- [x] Refresh button in Settings → App to check for updates now

## v0.11 — Map, cleaner log, hop off, blur fix
- [x] Map: the day as one line with blocks of what you did, goal markers (toggle), set goals by clicking ahead, push plan when over
- [x] Log Summary view (default): per day time, sessions, average/longest, breaks; Sessions view keeps the detail
- [x] Hop off when today's tasks are done; opens a review link from Settings
- [x] Blur rebuilt: blurred snapshot per monitor, exact monitor bounds, works on Windows 10 and 11

## v0.12 — tidier navigation
- [x] Map moves into Today as a third tab (Today · All · Map)
- [x] Settings becomes a gear in the bottom-right corner, shown only when the pointer is near

## v0.13 — corrections, ez fill, web view
- [x] Count idle as the task when you forgot to press Start (on Start, and later via "This was…" on the Map and in the Log)
- [x] Goals from each Today row; remove goals from the Map
- [x] Day summary: work span, % focused, done count, goals hit
- [x] Ez fill: drag tasks onto the Map line to plan them
- [x] Private web view of today + coming days (secret Gist + GitHub Pages)

## v0.16 — Setup and a proper goodbye
- [x] Setup: week planner with a fat header (add, groups, unplanned tray) and draggable/resizable blocks on seven day cards
- [x] Planned tasks set their Google date and goal (planned end); Push plan moves planned blocks too
- [x] Hop off closes One Focus with the side borders closing in

## v0.17 — Setup grows up
- [x] Setup at the top level; opens as a window on the main monitor (setting: or inline)
- [x] Time order everywhere: planned/"by" times sort Today and All, so Start picks the earliest
- [x] Bigger header and cards; Break cards and blocks; groups and hint text removed
- [x] Task details: title, notes, length, repeat (daily / weekdays / weekly) with previews
- [x] Day structure: workday, work blocks, breaks as faint bands
- [x] Map hidden; Later fixed (dates are now cleared reliably)

## v0.18 — Setup range, custom repeat, duplicates
- [x] Setup shows this week (past days view-only) through a month ahead; week arrows + Today
- [x] Custom repeat: every N days/weeks/months, weekday circles
- [x] Duplicate with a copies count; same-name tasks count up (2/5)
- [x] No idle time before the workday starts (or on days off)

## v0.19 — Planner, items, reminders, Light mode
- [x] Setup + Today merged into one Planner window (Today / Week tabs); closes on outside click
- [x] Today tab: one big day with plan vs. what you did, time split, by task, what's left
- [x] Items = Google subtasks (checklist in details; "2/5 items" on Now)
- [x] Reminders: planned block starts; running over (repeats every 15m); with Start/Done/+15m/Plan
- [x] Planner opens itself: start & end of day (default), every few hours, or set times
- [x] Ways in: triple-bump a screen corner (per tab), Ctrl+Alt+T / Ctrl+Alt+W
- [x] Optional green/red colouring of finished blocks (±20%)
- [x] Light mode: the Google Tasks wrapper only

## v0.20 — Plan vs actual, behind plan, Settings
- [x] Planner shows the plan as a soft outline and what really happened as a more solid layer on top; overruns grow past the plan.
- [x] Colour: neutral until the planned end, then a gradient into red; done well under time stays green.
- [x] ⚠️ Behind plan: missed blocks get a mark and the header a chip; tap for Re-plan from now, Push the rest of today (up to 3h), Start it now, Move to tomorrow, Take it off the plan, Delete.
- [x] No blink at start: windows show only after the first frame paints.
- [x] Settings redesigned into roomy cards with switches; can open in the Planner window on the main monitor (gear in its bottom-right corner on hover).

## v0.21–0.22 — Fixes
- [x] Lengths on every card (Xh XXm); over-time counts up live.
- [x] Reminders are a popup in the bottom-right of the main monitor (never steals focus; closes when answered or after 3 minutes). The Now screen only jolts, so the idle "Count it" prompt is never covered.
- [x] The blur's Confirm / Done / Tomorrow can no longer be hidden by a reminder or prompt (screens could stay blurred).
- [x] Settings cards pack into columns: no gaps under short cards.

## v0.23 — Calendar-clean Planner
- [x] Click an empty spot in the Planner to create a task right there.
- [x] One card per task: dashed plan until started, then a solid card for the real time with the plan as a faint outline behind it; overlaps go side by side.
- [x] Windows on the main monitor fade in (no white blink) and hide instead of closing.

## v0.24 — Popup styles, no click-through
- [x] Reminder popup style: Corner (bottom right), Top bar (pill, top middle) or Centre.
- [x] Break card removed from the Planner (day-structure breaks stay).
- [x] Clicking outside the Planner only closes it: a backdrop behind it catches that click (light dim on the main monitor).

## v0.25 — Features list, subtask times
- [x] Settings → Features: every feature with its own switch (Planner, Click to create, Behind plan, Colour time, Reminder popups, Subtasks, Goal time, Hold, Log, Count idle time, Since/Elapsed, Jolt, Still on this?, End of day, Category/Rating after Done, Hop off).
- [x] Subtasks (Google subtasks) each get an optional time; the Planner sheet totals them and Now shows time left on the remaining ones.
- [x] Planner re-centres on the main monitor every time it opens.

## Parked
- [x] ~~Full-screen announcements~~ → became the v0.7 blur for "Still on this?" and end of day

## Next
- [x] Test sign-in and sync against a real Google account on Windows

## Later
- [ ] Microsoft To Do (needs an Entra directory and app registration)
- [ ] App icon and bundled Inter font
- [ ] Mac and Linux builds through the GitHub Actions workflow
