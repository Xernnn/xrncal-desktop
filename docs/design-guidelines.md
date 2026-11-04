# xrncal Design Guidelines

Visual language for the desktop renderer. Minimalist Notion + Notion Calendar aesthetic: warm, clean off-white / deep charcoal canvas, soft pastel event palette, quiet hairline borders, and disciplined corner radius (<5px on controls and sidebar).

## Principles

- **Clarity & Calm:** Soft pastel event colors, high-contrast typography, quiet today indicator in Notion coral `#eb5757`.
- **Minimalist Chrome:** Compact top bar (~48px), collapsible left sidebar (~256px), secondary actions tucked cleanly into overflow menus.
- **Unified Notion Tones:** Shared canvas and card language between sidebar, header, dialogs, and calendar views. No loud saturated gradients or AI-purple slop.
- **Restrained Corner Radii:** Strictly `<5px` (`3px` for controls/chips/sidebar items, `4px` for dialogs/popovers). The only pill allowed is the `ToggleSwitch` track.

## Color Tokens

Defined in `src/renderer/src/styles/index.css` and mapped as Tailwind theme tokens `app`, `surface`, `sidebar`, `hairline`, `primary`, `muted`, `today`, `accent`, `hover`.

### Light Mode (Notion Theme)
- Canvas / App: `#f7f6f3` (Warm off-white paper)
- Surface / Cards: `#ffffff`
- Sidebar: `#fbfbfa`
- Hairline Border: `#e9e9e7`
- Primary Text: `#37352f` (Notion signature charcoal)
- Muted Text: `#787774`
- Hover Fill: `#efefee`
- Today Mark: `#eb5757` (Notion soft coral red)
- Accent Mark: `#2383e2` (Notion blue)

The theme follows the system by default (light or dark with the OS); both can be chosen in Settings. A profile from before 0.2.0 keeps the dark theme it had.

### Dark Mode (Discord-style dark)
Soft blue-grey, comfortable contrast, deliberately never pure black.
- Canvas / App: `#2b2d31` (main calendar surface)
- Surface / Cards: `#313338` (elevated: dialogs, menus, inputs, event blocks)
- Sidebar: `#232428` (deepest tone, structural chrome)
- Hairline Border: `#3a3d44`
- Primary Text: `#dbdee1` (near-white, not `#fff`)
- Muted Text: `#9aa0a6`
- Hover Fill: `#35373d`
- Today Mark: `#f0616d` (red, softened for dark ground)
- Accent Mark: `#5865f2` (blurple — also the default `themeAccent`)

### Soft Pastel Event Palette
Replaced saturated Google primaries with gentle pastel tones:
- Soft Blue: `#529cca`
- Soft Sage Green: `#52b788`
- Soft Peach / Amber: `#ea9a5f`
- Soft Lavender: `#9a6dd7`
- Soft Coral / Red: `#eb5757`
- Soft Teal: `#4dab9a`
- Soft Rose Pink: `#e06f9f`
- Soft Slate Gray: `#868e96`
- Soft Honey Gold: `#e3b341`

### Day Markers
Notable days are marked the same way in every view, each by its **own shape** as well as its colour - four cell tints at 10% (the old month view) were indistinguishable on the dark theme.
- **Today:** a filled `today` circle behind the solar date (white digits). Month view also tints today's cell (`--color-today-mark` 10% into the surface); no other day is tinted.
- **1st of the solar month:** the month's name beside the number ("1 Nov", "1 thg 11") - text, not colour.
- **Mùng 1 / Tết (new moon):** `LunarLabel` chip, hollow ○ glyph, `moon-new` teal (`#0b7166` light / `#4fd1c1` dark) on a 15% tint of itself.
- **Rằm (full moon):** the same chip with a filled ● glyph in `moon-full` gold (`#8a5a00` light / `#f2c14e` dark).
- Year view's cells are too small for a chip, so `LunarLabel variant="text"` only colours the lunar date.

Neither moon colour may be red: red means today.

## Typography

Font: Inter. Hierarchy:
- H1 period title: ~28px, weight 400
- H2 day groups: 14–16px, weight 600
- Body event titles: 13–14px, weight 400–500
- Caption time/week numbers: 10–12px

## Chrome & Sidebar Specifications

### Radius Tokens
| Token | Value | Usage |
|---|---|---|
| `--radius-control` | `3px` | Inputs, checkboxes, buttons, chips, sidebar cards & cells |
| `--radius-dialog` | `4px` | `.gc-dialog`, dropdown popovers, hover flyouts |

### Sidebar Rules (< 5px Radius)
- **Tasks Launcher Card:** `rounded-[4px]`, `border-hairline`, `bg-surface`, `hover:bg-hover`, `text-primary`.
- **Tasks Icon Box:** `rounded-[3px]`, `bg-hover`, `text-muted`.
- **Tasks Counter Badge:** `rounded-[3px]`, `bg-accent/15 text-accent text-[10px]`.
- **Mini Calendar Cells:** `rounded-[3px]`, today indicator `rounded-[3px]` with `TODAY_COLOR` (`#eb5757`). Event bars `rounded-[1px]`.
- **Calendar Items:** `rounded-[3px]`, checkboxes `rounded-[3px]`, RO tag `rounded-[3px]`.
- **Holiday Toggle Cards:** `rounded-[4px]`, `border-hairline`, active state `bg-accent/10 border-accent/30 text-primary`, badge `rounded-[3px] bg-accent/20 text-accent`.
- **Footer Status:** `rounded-[3px]` refresh button, soft pastel emerald `#52b788` dot.

### Header Rules
The header is always shown by default (auto-hide is an opt-in setting), laid out like every calendar app:
- **Left:** sidebar toggle (☰), previous / next arrows, the period's name (28px). There is no Today button: `T` and Week view's week number go to today. Week view names its month ("October 2026", "Oct – Nov 2026"); Day view leaves the bar empty because its column carries the full date.
- **Right:** **Create** (`gc-btn-primary` with a plus), search, `ViewSwitcher`, Settings as a **gear** (never a second ☰), with a `bg-today` dot when there are sync conflicts.
- **Controls & Buttons:** `gc-btn`, `gc-btn-primary`, `ViewSwitcher`, `SettingsPanel` all follow `var(--radius-control)`.
- Week view column heads carry the weekday ("MO", "T2") above the number; weekend names use `text-today`.

### Right-click menu
A click on an empty slot or an event opens the full editor; there is no quick-create box or event card in between. The editor is always a 420px side panel, never a centred dialog: opened from the grid it slides in from the side away from the slot or event, which stays in sight; from the Create button, `N` or search it comes in from the right. The right-click menu (`ContextMenu`) is portalled to `<body>` at the pointer and kept inside the window: `rounded-[4px]`, `border-hairline`, `bg-surface`, `shadow-lg`, `animate-popover`; 13px rows with a muted 16px icon column and a shortcut hint on the right; destructive rows in `text-today`. It closes on Escape, a click outside, scrolling and resize. Colour is changed in the editor only.

The accent colour is set on `<html>`, not only on the app root, so portalled UI uses the chosen accent too.

## Motion & Interaction

- Keep calendar interactions on a 140–180ms ease-out curve (`--ease-out` in `index.css`).
- Month cells (`.gc-cell`): subtle hover wash at ~5% opacity.
- Week/Day hour rows (`.gc-hour-slot`): hover only the hovered hour. Timed drag uses a 15-minute drop line, not a full-hour highlight.
- Event chips (`.gc-event`): slight lift and brightness increase on hover.
- Overlays and dialogs fade/scale in smoothly.
- Honor `prefers-reduced-motion`.

## Forms & Dialogs

- **Page-like Dialogs:** (Event editor, Task pane, Theme settings) use `FormRow` property rows with ghost inputs.
- **Settings-like Dialogs:** (CalDAV connect, Account manager) use boxed inputs (`variant="boxed"`).
- **Focus state:** 1px `accent` outline, zero glow rings or saturated shadows.
