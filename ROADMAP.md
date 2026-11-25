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

## v0.26 — Tidy, off-hours marks
- [x] Tidy (Planner header): blocks not started yet keep their order and pack back to back inside the work windows of the Day structure, around started/done work and never before now. Today tab: today; Week tab: the next 7 days. Undo for 12 seconds.
- [x] Blocks planned outside your work hours (or on a day off) are hatched and say "off hours".
- [x] Ctrl+Alt+S opens Settings. Started tasks can be re-planned; a drag never opens the new-task field.

## v0.27 — Back to Now, Done/Hold in the Planner, Tidy for started work
- [x] One Focus returns to the time screen after 2 minutes untouched on another tab (Features → Back to Now).
- [x] Planner header shows the running task with Done and Hold (recent reasons + type one); on Hold, Back.
- [x] Tidy also moves what's left of started-and-paused tasks; the work so far stays as a record. With no Day structure, today packs from now.

## v0.28 — Tidy that actually fills the day, auto-open that fires
- [x] Tidy fills each block into the earliest gap that fits (shorter tasks can use earlier gaps), around the stretches really worked, never before now. The running task now holds only the rest of its time from now (it used to block everything up to its planned end).
- [x] Started tasks draw one card per stretch of work instead of one card from first start to last stop.
- [x] Auto-open: the day start opens the Planner the first time you're at the computer before day end; other slots hold until the next one. Also checked right after unlock or wake.
- [x] Planner nudges "Set day start & end" until a Day structure exists ("×" hides it for the day).
- [x] Tiny previews beside Reminder style, corners, where Settings/Planner open, and Goal progress.

## v0.29 — Fit
- [x] Tidy renamed Fit. It never changes the order and never moves anything later: each block moves up into the earliest free gap after the block before it (work windows, real work, now). No earlier gap: it stays.
- [x] Task details → Fit: "Moves up" or "Stays put" (pinned tasks are left alone, and nothing jumps over them).

## v0.30 — More time on purpose, idle fix, custom shortcuts
- [x] Idle counted nothing on days off (or before day start) once a Day structure was set; now idle counts from the moment you start anything that day.
- [x] More time on the running task (Planner strip "+", or the over-time popup): its plan grows and the rest of today moves down by the same amount; pinned tasks stay.
- [x] Good-enough nudge: after +30m (or half the original plan) the prompts lead with "10m to wrap up" and ask for the good-enough version; more time is still there, quieter.
- [x] Shortcuts: pick the modifier pair (Ctrl+Alt, Ctrl+Shift, Alt+Shift) and the letter for Today, Week and Settings; shortcuts another app owns are flagged.

## v0.31 — Day summary, start early, Done & start, counts up
- [x] Each day column's header: "7h 30m planned · ends 6:27 PM".
- [x] Starting a task planned for later today moves its whole plan to now (same length).
- [x] Same-name tasks count up (1/7, 2/7…) with today's finished ones first; finished ones no longer show 0/n.
- [x] A planned block arriving mid-task: the popup offers "Done & start" (finish this, start that) or "Start" (switch).
- [x] Repeats: re-ticking a finished repeating task no longer adds a second next copy; deleting a task drops its plan and repeat; the details panel explains that repeats live in One Focus (Google Tasks' own repeat can't be read or changed through its API).

## v0.32 — Planner · Tasks
- [x] Third Planner tab, Tasks: the whole list, plain. Tick to finish, click for details, "+ Add a task" at the end (no date), when it's planned or due on the right, finished today faded at the bottom.
- [x] Escape in the Planner window closes the details panel, then Settings, then the window (it used to blank the window).
- [x] Shift + an F-key as a shortcut option; open-at-login re-registered on every launch.

## v0.33 — View
- [x] One Focus's Today tab is now View: the time and date large at the top, every task below (tick to finish, Start on hover, when it's planned or due). It never drifts back to Now, so it can be left up.
- [x] Shortcuts and corners bring the Planner (or One Focus) in front even while you're in another app (Windows blocks background apps from taking focus; the window is pinned on top for a moment).

## v0.34 — Rename and clear in View
- [x] View: click a task's name to rename it (Enter saves, Escape cancels).
- [x] Finished tasks: a "Done · n" heading with Clear all, × on each row; they also clear by themselves 24 hours after being done. Clearing only hides them here: they stay completed in Google Tasks and in the log.
- [x] View tweaks: twice-size clock, centred, hairline divider, menu hides like Now, second in the menu.

## v0.35 — Quick bar, repeating changes, late starts
- [x] Quick bar: start typing anywhere (or Ctrl+K) in One Focus or the Planner. Enter adds a task for today; ↑↓ picks a match and Enter switches to it; Shift+Enter adds and starts; Ctrl+Enter opens details (Planner).
- [x] Changing a repeating task's time, length or name asks "This one" or "This and following" (like Google Calendar). "This one" keeps the pattern future copies and previews follow.
- [x] Starting a planned task late (its slot passed, no work on it yet today) moves its plan to now, so "over" counts from when you began. Over only counts a plan for today.
- [x] Today tab: no unplanned-cards row (Week keeps it).

## v0.36 — Settings search
- [x] Search in the Settings header (or just type, or Ctrl+F): unrelated cards hide, matching settings highlighted with the words marked; Escape clears.

## v0.36.x — Notes
- [x] Settings → Notes: jot changes as they come up; Copy & clear puts them on the clipboard for a prompt, clears the box and keeps a dated copy ("Copied before", last 30).
- [x] View: bigger tick circles; no Done heading; clear-all icon by the gear; add field on hover.

## v0.37 — Planner and lists
- [x] View and Planner Tasks: drag a task by a hover grip to reorder (saved to Google).
- [x] Planner: "Remove gap" on a block that runs into a break or the gap between work blocks: it keeps the part before, a same-name copy (1/2, 2/2) takes the rest after.
- [x] Day headers show just the name (planned total on hover). Shortcuts retry if Windows refused one.

## v0.38 — Backlog mode (View)
For running several things at once (AI workflows side by side) without losing One Focus: of everything in flight, the oldest request is the one thing to do now.
- [x] Bottom-left corner of View (on hover): Backlog on/off, and Manual / Auto.
- [x] Active: limited by open slots (+ / − on hover). Each is "Running" (it's working, you wait) or "Your turn" (a request: it needs you, with a short line saying what). Requests lead; the first has a soft fill. Live timers. Click the state to flip it.
- [x] Queued: in order, with when it was queued ("3h ago"). Start fills a free slot.
- [x] Evergreen: standing tasks; ticking records "done 2h ago" and it stays. Comes forward ("while you wait") when every slot is busy and nothing needs you.
- [x] Auto: finishing an active task, or adding a slot, pulls in the top of the queue.
- [x] Drag rows between lanes (a full Active lane refuses). Links per task (e.g. the chat it runs in). Web view shows what's in flight.

## v0.39 — Claude writes to the backlog
- [x] Settings → Claude: a local MCP server (127.0.0.1, random token; web pages and other hosts refused). Tools: read the backlog, add a task (running / needs you / queued / evergreen, request, link), update one (request, running, done, link, rename).
- [x] "Add to Claude Desktop" writes it into claude_desktop_config.json (keeps the rest, makes a .bak); it runs through mcp-bridge.js, the app's own exe in node mode, and still starts while the app is closed. "Copy for Claude Code" copies a `claude mcp add` command.
- [x] Instructions tell Claude to add long work as running, ask for things as requests, set running again, then done.
- [ ] Cloud sessions and claude.ai in a browser can't reach 127.0.0.1: would need a relay (e.g. Google Tasks notes or a Gist inbox).

## v0.40 — Groups and Claude sessions
- [x] Settings → Groups: Active splits into groups, each with its own slots and words that sort tasks into it.
- [x] A group can start a Claude session when a slot opens: Claude Code (a PowerShell window in its folder running `claude "<message>"`) or a claude.ai chat, for the task that takes the slot ({task}, {group}, {id}), or with a standing message when nothing is queued. The started session's slot is held until Claude adds its task (15 min at most); a standing session isn't restarted until the group changes; a per-hour cap per group; failed starts give their slot back.
- [x] Tasks Claude adds never start a session for themselves; an active task's group is fixed when it takes the slot.
- [x] Reviewed by two independent checks (code and hands-on UI); everything they found was fixed.
- [x] No helper text in the UI (standing rule).

## v0.41 — Projects, triggers, details
- [x] View backlog: one section per group (project): its active cards, slots, queue and an "Add to <group>" line; tasks belong to the section they're added or dragged to (no picker).
- [x] Auto mode no longer pulls queued tasks in by itself. A task moves in by hand, or by its own trigger: when a slot opens, when its group is empty, after another task is done, or at a time. A task can hold a prompt that a new Claude session gets when it starts.
- [x] Deadlines per task. Details as a two-line card (Titles / Details switch in the corner). One ⋯ menu per row.
- [x] Tidy (corner): a Claude Code session cleans up titles and details through the one_focus tools. Claude can now read/write details, prompts and triggers.
- [x] Tasks show the moment they're added; Google syncs after. Active cards stand out more.

## v0.42 — Days
- [x] A work day per task (separate from the deadline): Day in the ⋯ menu (Today / Tomorrow / a date / No day). Days that pass roll to today, so nothing is ever behind; "→ Tomorrow" on the Today tab moves today's on.
- [x] Day tabs (All · Today · Tomorrow · Later) filter each group's queue; quiet until hovered.
- [x] Right-click a task for its menu. "New group" line at the end of View. Claude can set work_day.

## v0.43 — Light settings in View
- [x] A sliders button in View's corner opens the backlog settings right there: Manual/Auto, Titles/Details, the Claude connection, and groups (name, slots, what a free slot starts, add, remove). The corner is now Backlog · settings · Tidy.

## Parked
- [x] ~~Full-screen announcements~~ → became the v0.7 blur for "Still on this?" and end of day

## Next
- [x] Test sign-in and sync against a real Google account on Windows

## Later
- [ ] Microsoft To Do (needs an Entra directory and app registration)
- [ ] App icon and bundled Inter font
- [ ] Mac and Linux builds through the GitHub Actions workflow
