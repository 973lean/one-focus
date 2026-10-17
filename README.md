# One Focus

A small, quiet window for a secondary monitor that keeps you on one thing at a time.

## What it does (v0.3)

- **Now:** the time, large, with the date above. Under it is your current task, plus (optionally) when it started and how long you've spent on it. Hover to show **Done**.
- **Google Tasks:** One Focus uses one list (default name "One Focus", created for you). The current task is the first unfinished task in that list. Finish it and the next appears.
- **Menu** (top left, on hover):
  - **Log:** time tracked, tasks done and sessions for Today / Week / Month / All, and every session grouped by day with each day's total.
  - **Today:** your list, plus tasks done today. Add, rename (click the title), complete, reopen, delete, or **Focus** a task to make it current. Changes go straight back to Google Tasks.
  - **Settings:** Google connection, show start time, show time on task, always on top.
- **Time log:** a session runs while a task is current and you're at the computer. It pauses on lock, sleep, quit and after 10 minutes idle.

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

Windows builds are a single portable `.exe` (no install). The latest one is on the `builds` branch.

Data lives in `state.json` in the app's user-data folder (e.g. `%APPDATA%/One Focus` on Windows). The Google token is encrypted with the OS keychain.

## More

- [ROADMAP.md](ROADMAP.md)
- [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md)
