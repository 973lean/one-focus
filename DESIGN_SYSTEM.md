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
| Task start time · time on task (or "Idle 12m") | `clamp(16px, 4.3cqw, 19px)` | 400 | Tertiary ink, same line as task, time only (no label), `--space-2` gap |
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

- Single column, centred horizontally and vertically: date, time, then task.
- Default window 420 × 260, minimum 280 × 180.
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
- Both are hidden at rest and fade in over 400ms while the pointer is over the window. Inside a panel the menu stays visible so you can always get back.
- On the Now screen, hairline pills appear on hover in a row under the task: **Start** when a task is queued, **Done** and **Stop** while one runs. They never shift the layout.

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

## Adding something new

Before adding an element, ask: does it help the user know what to do *right now*? If not, it doesn't go on the main view.
