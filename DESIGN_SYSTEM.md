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
| Task | `clamp(14px, 4.2cqw, 20px)` | 400 | Secondary ink, single line, ellipsis |
| Date | `clamp(14px, 4cqw, 18px)` | 400 | Above the time, format "Sat, Oct 17", tracking 0.04em, `--fg-date` ink |
| Task start time | `clamp(13px, 3.6cqw, 16px)` | 400 | Tertiary ink, same line as task, time only (no label), `--space-2` gap |
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

## Hover menu

- Top-left, 12px, tertiary ink (active item secondary ink), stacked text only: no icons, no box.
- Hidden at rest. Fades in over 400ms when the pointer is over the window, or on keyboard focus, and fades out when it leaves.
- Items not yet available are marked "soon".

## Adding something new

Before adding an element, ask: does it help the user know what to do *right now*? If not, it doesn't go on the main view.
