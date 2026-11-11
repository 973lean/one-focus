# One Focus

A small, quiet window for a secondary monitor that keeps you on one thing at a time.

## What it does (v0.3)

- **Now:** the time, large, with the date above. Under it is your task. Nothing starts on its own: the next task waits (dimmed) with an idle counter until you hover and click **Start**. While it runs you see when it started and time on task, underneath, and **Done** on hover. To switch tasks, start another one from Today.
- **Google Tasks:** One Focus uses one list (default name "One Focus", created for you). The first unfinished task is next up. Finish it and the next one waits for you to start it.
- **Menu** (top left, on hover; Settings is the gear that appears in the bottom-right corner):
  - **Log:** time tracked, idle and hold time, and tasks done for Today / Week / Month / All. **Summary** (default) gives one line per day: time focused, sessions, average and longest session, and breaks between them. **Sessions** lists every session (click one to fix it).
  - **Today:** tasks scheduled for today (Google Tasks date = today, plus overdue) and tasks done today. Only these queue up on Now, in time order: anything with a planned or "by" time comes first, earliest first, then the rest in list order. Switch to **All** to see the whole list and click **Today** on any task to schedule it. **Later** takes a task off today. Add, rename (click the title), complete, reopen, delete, or **Start** any task. Changes go straight back to Google Tasks.
  - **Settings:** Google connection, show start time, show time on task, always on top.
- **Time log:** time counts either toward the running task or as idle. After 10 minutes with no input, task time stops and that time (from your last input) counts as idle; it switches back when you return. Nothing counts while the screen is locked, the computer sleeps, or the app is closed.

- **After Done:** pick a category (3 recent, or search; Enter creates a new one) and rate focus and vibe 1–5. Both optional and can be turned off. The Log shows time per category with the average rating.
- **Goal time:** hover, click the clock button, and a bar of the rest of your day appears. Hover it to see the time and how far away it is ("2:30 PM · in 4h 25m"); click to set it. The time line then shows a small progress ring after your time on task (or ring + %, or "2h 10m left" — Settings → Goal progress), and the time and task jolt once when you hit it. Works on the running task or the one queued next. Click the clock again to change or clear it.
- **Map** (hidden for now): your day as one line. Past = blocks of what you worked on (holds lighter), a line for now, and (toggle **Goals**) markers for the goal times you set. Hover anything for times and durations. Click a later point and pick a task to set when it should be done by. Running over? **Push plan +15m / +30m / +1h** moves your current goal and everything planned after it.
- **Hop off:** when everything scheduled for today is done, Now says "All done for today" with **Hop off**. It opens your review link (if set in Settings → Done for the day), then the window's side borders close in and One Focus quits.
- **Forgot to press Start?** Starting after 5+ minutes idle offers "Count it as this task?". Idle gaps on the Map and in Log → Sessions can be turned into time on a task afterwards ("This was…").
- **Goals from Today:** each task row has **Goal**, which opens the same day timeline; the goal shows on the row.
- **Web view:** today and the coming days at a private link in any browser (see below).
- **Setup** (menu → Setup): plan the week. Opens as a large window on your main monitor (or inside One Focus: Settings → Setup). A header to add tasks, with big cards for every unplanned task and a **Break** card; below, seven day columns with hours. Drag a card onto a time; drag a block to move it or its bottom edge to resize; drop it back on the header to unplan. Click any card or block for details: title, notes, length, and **Repeat** (daily, weekdays, weekly — finishing one adds the next at the same time of day). **Day structure** sets your workday, work blocks and breaks as faint bands on every day; before your workday starts (and on days off), idle time isn't counted. Setup spans from Monday of this week (past days view-only) to a month ahead, with week arrows and **Today**. Repeat can also be **Custom**: every N days, weeks (on chosen weekdays, Google-style circles) or months. **Duplicate** makes 1–20 copies; tasks that share a name show a quiet count ("2/5") everywhere. Planned tasks get that day in Google Tasks and their planned end as their goal.
- **Hold:** pulled into a meeting or call? Hover, click **Hold**, pick Meeting / Call / Break (or search). The task pauses without being finished; **Back to: <task>** resumes it. Hold time is logged separately.
- **Still on this?** After a task runs 2 hours (change or turn off in Settings), every screen softly blurs and only One Focus stays sharp until you click **Confirm**.
- **End of day:** set a time in Settings; if a task is still running then, the same blur asks **Done** or **Tomorrow**.
- **Fix the log:** click any session in the Log to change its times, split part of it off as a Hold ("from 10:40 it was a Meeting"), or delete it.
- **Reorder:** drag tasks in Today. **Shift+Enter** in "Add a task" adds it to the top and starts it straight away.
- **Jolt:** every 30 / 60 / 90 / 120 minutes the time and task flash blue for a moment. Off by choice in Settings.
- Remembers where you put the window, and can open when you log in.

Without Google connected, click the task line to type what you're doing.

## Connect Google Tasks (one time, ~5 minutes)

You create your own Google sign-in key, so your tasks only go between your computer and Google.

1. Go to https://console.cloud.google.com and create a project (e.g. "One Focus").
2. **APIs & Services → Library**, search **Google Tasks API**, click **Enable**.
3. **Google Auth Platform** (OAuth consent screen): choose **External**, enter an app name and your email.
   - Under **Audience**, set publishing status to **In production**. In "Testing", Google signs you out every 7 days.
   - When you sign in, Google will warn that the app isn't verified. Click **Advanced → Go to One Focus**. That's expected for a personal app.
4. **Credentials → Create credentials → OAuth client ID → Desktop app**. Copy the **Client ID** and **Client secret**.
5. In One Focus, open **Settings**, paste both, and click **Connect**. Your browser opens once to sign in.

## Web view (one time)

1. GitHub → this repo → **Settings → Pages** → Source: **Deploy from a branch** → `main` / `/docs` → **Save**.
2. github.com/settings/tokens → **Fine-grained token** → Account permissions → **Gists: Read and write** → generate and copy it.
3. One Focus → gear → **Web view** → paste the token → **Create link**. Open or copy the link from there.

Your day is stored in a secret Gist and updated about every 2 minutes. The page only knows the Gist id from the part of the link after `#`; anyone with the full link can see it.

## Run it

```bash
npm install
npm start        # run
npm run dev      # run with auto-reload on HTML/CSS/renderer changes
npm test         # tests
npm run dist     # build an executable for this OS into dist/
```

**Install on Windows:** download the setup file from the [`builds` branch](https://github.com/973lean/one-focus/tree/builds) and run it once. After that One Focus updates itself: every push to `main` builds a new version on GitHub (see `.github/workflows/publish.yml`), and the app downloads it in the background and installs it on restart, or by itself once you've been away for 10 minutes. Settings → App shows the version, a refresh button to check for updates now, and **Restart to update** when one is ready.

Data lives in `state.json` in the app's user-data folder (e.g. `%APPDATA%/One Focus` on Windows). The Google token is encrypted with the OS keychain.

## More

- [ROADMAP.md](ROADMAP.md)
- [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md)
