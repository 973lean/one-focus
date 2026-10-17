# Roadmap

**Goal:** a small always-on window that shows the time, the date, and the task you're on right now, pulled from Google Tasks.

**Status:** parked. v0.1 is done. Pick this up at Phase 1.

## Done (v0.1)

- [x] Time and date, centred, time most prominent
- [x] Manual current task with start time, saved locally to `tasks.json`
- [x] Hover menu (top left) listing task sources
- [x] `npm run dev` with auto-reload
- [x] Design system (`DESIGN_SYSTEM.md`)

## Phase 1: Google setup (needs you, ~5 min)

- [ ] Create a Google Cloud project
- [ ] Enable the Google Tasks API
- [ ] Configure the OAuth consent screen (External, add your own Google account as a test user)
- [ ] Create an OAuth client ID of type **Desktop app** and note the client ID
- [ ] Decide which Google account and which task list to use

## Phase 2: Connect

- [ ] Sign in with Google from the app (browser opens once, loopback redirect with PKCE)
- [ ] Request read-only access (`tasks.readonly`)
- [ ] Store the refresh token with Electron `safeStorage`, never in plain text
- [ ] "Sign out" option in the hover menu

## Phase 3: Show the current task

- [ ] Fetch the chosen list from the Tasks API (`tasks.googleapis.com`)
- [ ] Current task = first incomplete task in list order
- [ ] Show its title and the time it became current, same layout as today
- [ ] Refresh about once a minute and when the window regains focus
- [ ] Offline or signed-out state falls back to the manual task

## Phase 4: Make it feel right

- [ ] Hover menu becomes a real source switcher (Manual / Google Tasks)
- [ ] Optional: mark the current task done from the window (needs write access)
- [ ] Optional: always-on-top and remember window size and position
- [ ] Optional: bundle Inter so the font is identical on every machine

## Later

- [ ] Microsoft To Do (needs an Entra directory and app registration)
- [ ] Show what's next when the current task is done
