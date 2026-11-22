---
name: self-check
description: Screenshot-loop self-review for any UI change in the user's productivity and e-commerce software (One Focus, posture reminders, WPM calculators, Creative Playground, interactive swipe files, and similar Electron/web/desktop tools). Use it every time you build or change something the user will see — before committing, before saying it's done — to render it, drive it, score it against a rubric, fix what scores low and loop until it passes.
---

# Self-check: screenshot, drive, score, fix, repeat

The user tests on their own machine and notices every rough edge. Don't hand
over UI you haven't looked at. Run this loop on every visible change.

## 1. Render it for real

- Web/Electron renderer: open the real page in headless Chromium with
  Playwright (`require('playwright')`, `chromium.launch()`). If the page needs
  a backend (Electron IPC, an API), use the project's preview stub or write a
  small fake with realistic sample data — long titles, many items, an empty
  state, a busy state.
- Pin time with `page.clock.install({ time: ... })` when the UI depends on the
  clock, so screenshots are repeatable.
- For Electron, also load the real `index.html` in Electron under `xvfb-run`
  with a fake main process and fail on any `console-message` error: the
  browser preview can hide script-order and IPC bugs.
- Screenshots you only look at yourself: `deviceScaleFactor: 1`. Ones the
  user will see: `2`. Clip to the part that changed plus enough context.

## 2. Drive it, don't just look at it

Click, drag, type and press keys the way the user would, then assert on the
DOM *and* look at the result:

- the happy path, then the edges: empty list, one item, 50 items, a 200-char
  title, narrow window, wide window
- focus: does typing land where it should; does Escape do the obvious thing
- re-renders: does state survive a refresh/push; does focus or an open
  popover get wiped while the user is typing
- anything that moves time: fake the clock forward and check what changes

## 3. Score it (0–10 each, be strict)

| Area | 10 means |
|---|---|
| Works | Every interaction does what was asked; no console errors |
| Clarity | A first-time user knows what it is and what to do in 2 seconds |
| Layout | Aligned to one grid; nothing overflows, wraps oddly, overlaps or clips |
| Spacing & rhythm | Consistent gaps; related things close, unrelated apart; no dead whitespace |
| Type & contrast | Clear hierarchy (one primary thing); secondary text readable, not shouting |
| Consistency | Matches the project's design system (tokens, radii, controls, wording) |
| Restraint | Nothing extra; minimal, premium, quiet — the user's standing taste |
| States | Hover, focus, empty, loading, error, long content all handled |

Write the scores down briefly (for yourself). **Pass = every area ≥ 8 and
average ≥ 8.5.** Anything lower: name the exact defect ("Start button takes
space when hidden, so times don't line up"), fix it, re-render, re-score.
Stop after it passes, or after 4 loops — then tell the user what still falls
short and why.

## 4. Before you report

- Re-run the project's tests and the Electron page check.
- Look at the final screenshot one more time at the size the user will see.
- In the reply, mention the loop briefly (what you caught and fixed); don't
  paste the score table unless asked.

## Defects worth hunting for every time

- text spilling out of cards; two-line labels in pills; ellipsis hiding the
  only important word
- hidden elements still taking space
- class-name collisions (a new `.x-now` restyling an existing `.x-now`)
- popovers behind other content, or re-animating on every state update
- re-render guards that skip updates whenever *any* element has focus
  (only skip while an input is being typed in)
- windows that blink white on open, or open behind other apps
- anything that only works when the window is focused
