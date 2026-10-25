# One Focus

A small, quiet window for a secondary monitor that keeps you on one thing at a time.

## What it does (v0.3)

- **Now:** the time, large, with the date above. Under it is your task. Nothing starts on its own: the next task waits (dimmed) with an idle counter until you hover and click **Start**. While it runs you see when it started and time on task, underneath, and **Done** on hover. To switch tasks, start another one from Today.
- **Google Tasks:** One Focus uses one list (default name "One Focus", created for you). The first unfinished task is next up. Finish it and the next one waits for you to start it.
- **Menu** (top left, on hover):
  - **Log:** time tracked, idle time, tasks done and sessions for Today / Week / Month / All, and every session grouped by day with each day's task and idle totals.
  - **Today:** tasks scheduled for today (Google Tasks date = today, plus overdue) and tasks done today. Only these queue up on Now. Switch to **All** to see the whole list and click **Today** on any task to schedule it. **Later** takes a task off today. Add, rename (click the title), complete, reopen, delete, or **Start** any task. Changes go straight back to Google Tasks.
  - **Settings:** Google connection, show start time, show time on task, always on top.
- **Time log:** time counts either toward the running task or as idle. After 10 minutes with no input, task time stops and that time (from your last input) counts as idle; it switches back when you return. Nothing counts while the screen is locked, the computer sleeps, or the app is closed.

- **After Done:** pick a category (3 recent, or search; Enter creates a new one) and rate focus and vibe 1–5. Both optional and can be turned off. The Log shows time per category with the average rating.
- **Goal time:** hover, click the clock button, and a bar of the rest of your day appears. Hover it to see the time and how far away it is ("2:30 PM · in 4h 25m"); click to set it. The time line then shows "2h 10m left" (or "15m over"), and the time and task jolt once when you hit it. Works on the running task or the one queued next. Click the clock again to change or clear it.
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

## Run it

```bash
npm install
npm start        # run
npm run dev      # run with auto-reload on HTML/CSS/renderer changes
npm test         # tests
npm run dist     # build an executable for this OS into dist/
```

**Install on Windows:** download the setup file from the [`builds` branch](https://github.com/973lean/one-focus/tree/builds) and run it once. After that One Focus updates itself: every push to `main` builds a new version on GitHub (see `.github/workflows/publish.yml`), and the app downloads it in the background and installs it on restart, or by itself once you've been away for 10 minutes. Settings → App shows the version and a **Restart to update** button when one is ready.

Data lives in `state.json` in the app's user-data folder (e.g. `%APPDATA%/One Focus` on Windows). The Google token is encrypted with the OS keychain.

## More

- [ROADMAP.md](ROADMAP.md)
- [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md)
