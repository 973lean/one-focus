# One Focus — Design System

> One thing on screen. Nothing else earns a pixel.

One Focus lives in a small window on a secondary monitor, all day, in peripheral vision. Every decision serves a glance from across the desk.

## Principles

1. **One focus at a time.** The screen shows one thing that matters most. If a second thing appears, it must be visibly quieter.
2. **Space is the design.** Generous padding and empty space do the work that borders, cards and dividers usually do.
3. **Hierarchy by opacity, not colour.** One ink colour at three strengths. No accent colours until a feature needs to signal something.
4. **No chrome.** No icons, buttons, shadows, gradients or decoration unless they carry meaning.
5. **Glanceable.** Readable from ~1 m away at a small window size. If it needs reading, it's too much.
6. **Calm motion.** Changes fade; nothing bounces, slides or blinks.

## Colour

Dark by default — it disappears next to a main monitor.

| Token | Value | Use |
|---|---|---|
| `--bg` | `#0B0B0C` | Window background |
| `--fg` | `#F5F5F4` | Primary — the time |
| `--fg-secondary` | `rgba(245,245,244,0.62)` | Current task |
| `--fg-date` | `rgba(245,245,244,0.48)` | Date — between task and meta |
| `--fg-tertiary` | `rgba(245,245,244,0.32)` | Meta — task start time, AM/PM, placeholders |
| `--hairline` | `rgba(245,245,244,0.10)` | The only line allowed: input underline |

## Typography

One family: **Inter**, falling back to the system UI font. Numbers always use `tabular-nums` so the clock never jitters.

| Role | Size | Weight | Notes |
|---|---|---|---|
| Time | `clamp(56px, 22cqw, 140px)` | 500 | Tracking −0.04em, line-height 0.9 |
| Task | `clamp(17px, 5cqw, 24px)` | 400 | Secondary ink when running, `--fg-date` ink when queued, single line, ellipsis |
| Date | `clamp(14px, 4cqw, 18px)` | 400 | Above the time, format "Sat, Oct 17", tracking 0.04em, `--fg-date` ink |
| Task start time · time on task (or "Idle 12m") | `clamp(16px, 4.3cqw, 19px)` | 400 | Tertiary ink, own line under the task, `--space-1` gap |
| AM/PM | 0.36em of time | 400 | Tertiary ink, suffix to the time; never wraps |

Sizes scale with the window width (container units, `cqw`) so the hierarchy holds from a tiny corner window to half a screen.

## Spacing

4 px base. Use only these steps.

| Token | Value |
|---|---|
| `--space-1` | 4px |
| `--space-2` | 8px |
| `--space-3` | 16px |
| `--space-4` | 24px |
| `--space-5` | 40px |

Window padding is `--space-5`. Major groups (clock → task) are separated by `--space-5`; related items (date → time) by `--space-3`.

## Layout

- Single column, centred horizontally and vertically: date, time, task, then its start time and time on task.
- Default window 420 × 300, minimum 280 × 220.
- Nothing scrolls. If content doesn't fit, it truncates.

## Motion

- Easing `cubic-bezier(0.2, 0, 0, 1)`, duration `240ms`.
- Only colour and opacity animate.

## Interaction

- Interactions are invisible until needed: click the task to edit it inline, **Enter** to save, **Esc** to cancel.
- No visible buttons. Hover lifts text from secondary to primary ink — that is the only affordance.

## Window chrome

- No OS title bar. The window is frameless and the top 36px strip drags it.
- Top left: the menu (Now · Log · Today · Settings), 12px text. Top right: minimize, maximize, close as thin 10px line glyphs.
- Both are hidden at rest. Each fades in over 400ms only when the pointer comes near it: the top 64px of the window, left half for the menu, right half for the controls. Inside a panel the menu stays visible so you can always get back.
- On the Now screen, hairline buttons appear on hover in a row under the task. Hold and Done are 30px circles with 12px line icons: pause on the left (Hold), tick on the right (Done). Start (when a task is queued) and Back to stay as text pills. There is no Stop: a task ends with Done, a Hold, or by starting another. They never shift the layout.

## Panels (Log, Today, Settings)

Panels are for the occasional look, not the resting state, so they can be denser than Now.

- The window grows to at least 440 × 480 while a panel is open and returns to its size on **Now** (or Esc).
- Left-aligned, 13px text in secondary ink, `--space-4` side padding, `--space-3` between blocks.
- Section labels: 11px uppercase, tracking 0.08em, tertiary ink.
- Rows are separated by hairlines, never boxed. Row actions (Focus, Delete) appear on hover.
- Controls: text buttons, a hairline-bordered button for the main action, small switches for toggles. No colour accents.
- The one big number (time tracked in Log) is 32px, weight 500, primary ink. In the session list each date heading shows that day's total on the right in secondary ink.

| Token | Value | Use |
|---|---|---|
| `--fill` | `rgba(245,245,244,0.06)` | Switch background |

## After Done

- When a task is finished from Now, its title stays briefly (struck through, tertiary) with "Done · 47m" under it.
- Below: up to 3 category chips (most recent, or search matches) and a 9ch search field, then five 13px stars. All 12px, hairline, no labels.
- Both are optional. The row closes on its own once everything asked is answered, after 20s without input, or on Esc.

## Goal timeline

- A third round icon (clock) sits left of Hold and Done; it reads brighter when a goal is set.
- Clicking it swaps the buttons for one 6px bar in tertiary ink, `min(78cqw, 340px)` wide: the rest of the day, from now to midnight (at least 4 hours). Faint hour ticks under it, "now" and the end time at the ends in 11px.
- Hover: a 2px marker and a tooltip above it, "2:30 PM · in 4h 25m". Times snap to 15 minutes. Click sets the goal. Esc or clicking elsewhere closes it.
- With a goal, the time line shows progress (Settings → Goal progress): **Ring** (default) — a 0.85em ring right after the time on task, filling from task start to goal, primary ink once over; **Ring + %** — the same with "(54%)"; **Time left** — "2h 10m left" / "15m over". Hovering the time line always shows the goal time. One jolt when the goal is reached.

## Hold

- Hover pill **Hold** (next to Start / Done) opens the same 3 chips + search as categories, defaulting to Meeting, Call, Break.
- While on hold the task line reads "Hold: Meeting" in `--fg-date` ink, the time line shows time on hold, and one pill reads **Back to: <task>** (24ch max, ellipsis).
- In the Log, holds are listed in tertiary ink and totalled separately from task time ("hold 1h 10m").

## The blur (Still on this? / End of day)

- Every monitor gets a full-screen window: Windows 11 acrylic blur plus a 28% `--bg` tint, or a 78% tint where blur isn't available. It fades in over 400ms. Nothing else is drawn on it.
- One Focus stays above it, sharp. Its pills become loud (primary ink, visible without hover): **Confirm** for Still on this?, **Done** / **Tomorrow** for end of day.
- The time line explains why: "Still on this? 2h 03m" or "End of day · wrap up? 6h 10m".

## Jolt (the one colour)

- `--jolt: #5B8CFF`. It is the only colour in the app and is used for nothing else.
- Every N minutes (Off / 30 / 60 / 90 / 120, set in Settings) the time and task turn blue for 0.3s, then fade back over 240ms. This is the one deliberate exception to "calm motion".

## Adding something new

Before adding an element, ask: does it help the user know what to do *right now*? If not, it doesn't go on the main view.
