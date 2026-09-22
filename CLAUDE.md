# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev            # electron-vite dev app with renderer HMR
npm run build          # production bundle -> out/{main,preload,renderer}
npm run lint           # eslint . (flat config in eslint.config.mjs)
npm run lint:fix       # eslint . --fix
npm run clean          # remove out/, dist/, *.tsbuildinfo
npm run typecheck      # typecheck:node && typecheck:web (run this before commit)
npm run typecheck:node # tsc -p tsconfig.node.json  (main + preload + shared + most tests)
npm run typecheck:web  # tsc -p tsconfig.web.json   (renderer + shared + renderer-touching tests)
npm run test           # vitest run (whole suite)
npm run pack:win       # build + electron-builder NSIS x64
npm run pack:linux     # build + electron-builder AppImage x64
npm run app:install    # pack:linux + install AppImage & .desktop entry for this user
npm run app:update     # alias of app:install
```

`app:install` (`scripts/install-linux-app.sh`) builds the AppImage, drops it at
`~/Applications/xrncal.AppImage`, and writes `~/.local/share/applications/xrncal.desktop`.
It writes a temp file and `mv -f`s it over the target on purpose — `install`/`cp` would truncate the
file a *running* AppImage is mounted from and corrupt the live app; a rename only swaps the directory
entry. A running instance therefore keeps the old build until it is quit and reopened.

Single test / focused runs (vitest is not exposed as an npm script):

```bash
npx vitest run tests/database-repos.test.ts                        # one file
npx vitest run -t "should expand weekly recurring event"           # one test by name
npx vitest                                                         # watch mode
```

ESLint 9 (flat config, `eslint.config.mjs`) is the lint gate; **there is no formatter** — match surrounding style by hand (2-space indent, single quotes, no semicolons; `.editorconfig` carries these for your editor). `@typescript-eslint/no-explicit-any` is set to `warn` on purpose: provider payloads and IPC boundaries are genuinely untyped at the edge, so the ~100 existing warnings are visible debt rather than a CI blocker — don't add more, and don't "fix" them by silencing the rule. Everything else is an error and CI fails on it. `npm run typecheck` with the project's strict flags (`noUnusedLocals`, `noImplicitReturns`, etc.) remains the type gate. CI (`.github/workflows/ci.yml`) runs lint + typecheck + test + build on every push/PR.

## Architecture

Electron desktop calendar (Windows + Linux). Local-first: **SQLite is the single source of truth for the UI**; provider sync engines only push/pull against it.

### Four layers, strict import boundaries

| Layer | May import | Notes |
|---|---|---|
| `src/main` | Node, Electron main, `src/shared` | app lifecycle, DB, OAuth, sync, tray, notifications |
| `src/preload` | `contextBridge`, `ipcRenderer`, `src/shared` | exposes `window.xrncal` |
| `src/renderer` | React, DOM, `src/shared`, `window.xrncal` | never imports `src/main` |
| `src/shared` | pure TS only | no Node, no DOM, no Electron — used by both sides |

IPC is the only bridge between renderer and main. See `docs/code-standards.md` for the full conventions (naming, i18n, security rules); the points below are the ones that span multiple files.

### IPC contract (touch all of these together)

`src/shared/ipc-contract.ts` holds `IPC_CHANNELS` (channel-string constants, grouped by domain) and the `XrncalAPI` interface. Adding or changing an IPC method means editing, in lockstep:

1. `IPC_CHANNELS` + `XrncalAPI` in `src/shared/ipc-contract.ts`
2. the bridge in `src/preload/index.ts` (and `src/preload/index.d.ts`)
3. a handler in the relevant `src/main/ipc/<domain>-ipc.ts` module
4. its `register*IpcHandlers()` call in `src/main/ipc.ts`

Never pass raw channel strings to `invoke`/`handle`. `tests/ipc-contract.test.ts` guards that the surface stays in sync.

### Settings contract (the other lockstep surface)

`AppSettings` + `DEFAULT_APP_SETTINGS` in `src/shared/settings-contract.ts` is one flat object persisted
row-per-key in the `settings` table via `SettingsRepo`. Adding a setting means:

1. field + default in `settings-contract.ts`
2. a control in `src/renderer/src/components/SettingsPanel.tsx` + `vi`/`en` i18n keys
3. if any view or leaf component needs it, add it to `DisplayPreferences` in
   `src/renderer/src/context/DisplayPreferencesContext.tsx` and read it with `useDisplayPreferences()`

That context exists so cross-cutting display settings (time format, hour height, day start hour,
`dragSnapMinutes`) are not prop-drilled through every view. A setting that reaches drag/resize code but
is only read in `App.tsx` is the classic bug here — the hooks in `src/renderer/src/dnd/` read it from
context, not from props.

### Database

- `src/main/db/sqlite-driver.ts` — `ISqliteDatabase` abstraction. Prefers `node:sqlite` (`DatabaseSync`), falls back to `better-sqlite3` if that native module is present (it is **not** a declared dependency). WAL + `foreign_keys = ON`. Nested `transaction()` calls use savepoints.
- Migrations are **inline SQL string constants** in `src/main/db/database.ts` (`MIGRATION_001_SQL` …), applied by `runMigrations()`, version-tracked in `schema_migrations`. The files under `src/main/db/migrations/*.sql` are reference copies only. Never edit an applied migration — add the next-numbered one and update both places. Head is currently `014`; a few constants are `export`ed only because a test asserts on them (`tests/migration-007.test.ts`).
- All SQL lives in repo classes under `src/main/db/repos/`. IPC handlers call repo methods, never `db.prepare` directly.
- Timestamps are ISO 8601 UTC strings everywhere. Events store `dtstart_utc` / `dtend_utc` + a `tzid` column for the original zone.

### Events, recurrence, read-only

- Canonical model: `CalendarEvent` / `ExpandedOccurrence` in `src/shared/event-model.ts`. Provider JSON is normalized by `src/main/sync/*-event-mapper.ts` and must never reach the renderer.
- `src/shared/expand-occurrences.ts` expands recurring masters via `rrule` and applies `event_exceptions` rows (EXDATE cancellations + per-instance overrides).
- Edit/delete of a recurring series is scoped `this` / `this-and-future` / `all` (`RecurringEditScope`); the renderer prompts via `RecurringScopeDialog`.
- **Lunar anniversaries** (`giỗ` / âm lịch): an event with a `lunar_rule` JSON column (`{day,month,leap}`) and no `rrule`. `expand-occurrences.ts` resolves one all-day occurrence per Gregorian year via `resolveLunarOccurrence()` in `src/shared/lunar-vietnam.ts` (leap-month + 29-day-month fallbacks, memoized). The master is local-only; `EventsRepo.materializeLunarEvent()` writes standalone `dirty=1` instances (linked by `lunar_source_event_id`) into a syncable calendar so they push to providers as ordinary events. `queryEventsByRange` passes a covered-years set so the synthetic master and its materialized instances never double-draw. Editing a lunar occurrence always applies to the whole series (no scope prompt); deleting still offers this-year vs series.
- Calendars with `is_read_only` (holiday subscriptions, some provider calendars) reject mutations in the **repo layer**: every write path in `EventsRepo` calls `checkReadOnlyCalendar()` and throws `ReadOnlyCalendarError`, which the IPC handler translates into a user-facing message. Put the guard in the repo, not the handler — it can't be bypassed there.

### Sync

`src/main/sync/sync-worker.ts` runs one poll loop across all connected accounts. Interval is adaptive — 20s while the main window is focused, 5m when blurred — driven by `SyncWorker.setFocusState()`, wired to `BrowserWindow` `focus`/`blur` in `src/main/index.ts`. Local edits set `dirty = 1`; the engine pushes dirty rows before pulling. Every request goes through `fetchWithTimeout` (`src/main/sync/http.ts`) — Node's bare `fetch` never times out, and a stalled connection would wedge `SyncWorker.isSyncing` for the life of the process. The three engines run concurrently under `Promise.all` with per-engine `.catch`, so one provider cannot block or cancel the others.

Conflict strategy is last-write-wins guarded by an `If-Match` precondition on every update/delete (Google and CalDAV use `If-Match`, Graph uses `if-match`). A 412 sets `has_conflict = 1`, and conflicted rows are excluded from the push set until `resolveConflict()` clears them — otherwise they retry and re-fail every poll.

**Occurrence exceptions sync too.** A `this`-scoped edit or delete writes an `event_exceptions` row with `dirty = 1`. CalDAV re-PUTs the whole series (master + `RECURRENCE-ID` components) since a series is one resource; Google and Graph resolve the occurrence through the master's `/instances` collection and PATCH (or DELETE) that instance, caching the resolved id in `provider_instance_id`. A pull never overwrites a row that is still `dirty`. Per-provider engines: `google-sync-engine.ts`, `microsoft-sync-engine.ts`, `caldav-sync-engine.ts`.

### Renaming and the user profile

The app was called "Gone Calendar" until it became **xrncal**, which moved Electron's `userData`
directory. `src/main/adopt-legacy-userdata.ts` runs before `initDatabase()` on every start and, when
the new profile has no `xrncal.sqlite` but a `gone-calendar` profile next door does, snapshots the old
database across with `VACUUM INTO` (never a file copy — WAL, and the old build may still be running)
and copies the credentials file. The old profile is left untouched. Anything else keyed to the old
name (Google's `goneMeetingUrl` extended property, `@gone.calendar` UIDs on already-synced rows) is
read as a fallback but never written.

### Secrets

`src/main/secure-store.ts` wraps Electron `safeStorage`. OAuth tokens / CalDAV credentials are encrypted and stored in the `settings` table under key `token:<accountId>` — never plaintext. On Linux with no available keyring it **fails closed** (refuses to persist, shows a visible error); do not add a plaintext fallback.

OAuth *client* credentials are separate and are never bundled: `src/main/load-credentials.ts` copies
`KEY=VALUE` lines into `process.env` from the first of `<userData>/xrncal.env`, a
`xrncal.env` next to the executable, or the project `.env` (see `.env.example`). With no real
`GOOGLE_OAUTH_CLIENT_ID` / `MICROSOFT_CLIENT_ID`, `isConfigured()` returns false and the app runs
local-only with Google/Microsoft connect disabled — so "connect does nothing" in a fresh checkout is
usually a missing `.env`, not a bug. CalDAV needs no client credentials.

### Renderer

- `src/renderer/src/main.tsx` inspects the URL hash: `#mini` → `MiniApp` (frameless always-on-top tray companion), otherwise `App`.
- `App.tsx` is a single large `useState` container that owns view routing (Day/Week/Month/Year/List), the global keyboard-shortcut listener, and all modal state. There is no state-management library — follow the existing `useState` pattern unless deliberately introducing one.
- All five calendar views are hand-built React components (no third-party calendar library). Drag/drop and edge-resize math lives in `src/renderer/src/dnd/` with pure functions unit-tested separately.
- **Year view is one year per page**, like month and week - navigation moves a year at a time
  (header arrows, wheel, or swipe on Android). It used to be an infinite scroller with a moving
  window of year blocks, scroll-anchor compensation and an active-year probe, which is why
  `App.tsx` had a `yearSpan` state widening the event query to whatever span was mounted; all of
  that is gone and the query is the plain `visibleRange`. Twelve months divide the page with
  `.gc-year-grid` (3 columns on a phone, 4 normally, 6 when short and wide, 6 when very wide), and
  each month always lays out six week rows so the cards stay the same height. Two rules in
  `index.css` earn their keep: a `min-height` per card, without which short windows shrank the
  rows below the height of the digits and the numbers overlapped into an unreadable stack; and
  `.gc-year-lunar`, which shows the lunar date only when the viewport is both wide *and* tall
  enough for a second line in each cell. `align-content: safe center` banks the page's leftover
  height at the edges instead of dealing it out between the rows; the `safe` keyword is what keeps
  January reachable when a short window makes the grid overflow.
- **Wheel navigation is shared by Day, Week, Month and Year** — the decision lives in
  `src/renderer/src/lib/wheel-navigation.ts`, the DOM side in `hooks/use-wheel-navigation.ts`.
  Two rules: a step is taken on the *first* event of a gesture, never on a throttle (one trackpad
  flick emits events for a second or more, and throttling stepped several periods per flick), and
  a scroller passed to the hook keeps the gesture until it is against the edge being pushed —
  events it consumes still advance the gesture clock, so reaching that edge and stepping never
  happen on one flick. **Where it is attached is the design:** Month and Year take it on their
  root, Day and Week only on their header band, because the hour grid's wheel means "scroll the 24
  hours" and nothing else. Inside that band the all-day strip is the scroller — it is capped
  (`ALL_DAY_MAX_LANES`, and `max-h` in Day) and scrolls its hidden lanes before the wheel moves on
  to the next day or week. Its scrollbar is hidden in `.gc-allday-scroll` on purpose: the strip's
  day columns are aligned with the hour grid below, and a scrollbar inside it would take its width
  out of the last column. List view is left out of all of this: scrolling it already extends its
  loaded range.
- All user-visible strings go through i18next; keys in `src/renderer/src/i18n/index.ts`, `vi` + `en` kept in sync — `tests/i18n-parity.test.ts` fails on a key present in one locale only, or on an empty string.
- The main process has its own tiny flat catalog, `src/main/i18n-main.ts` (`mt('tray.quit')`), for the strings the renderer can't own: tray menu, notifications, sync status, OAuth callback pages. It reads the persisted locale from the DB and is kept in sync by `IPC_CHANNELS.APP.SET_LOCALE`. Add main-side strings there, not to the i18next catalog.
- Styling is Tailwind 4 utilities over CSS variables in `src/renderer/src/styles/index.css`, mapped to theme tokens (`app`, `surface`, `sidebar`, `hairline`, `primary`, `muted`, `today`, `accent`, `hover`). It is a deliberate Notion/Notion-Calendar look — see `docs/design-guidelines.md` for the palette and the hard rules (corner radius strictly `<5px` outside the `ToggleSwitch` track; soft pastel event colours, no saturated gradients). Dark is the default theme.

### Keyboard navigation and focus

The whole calendar is drivable without a mouse, and the maths for that is pure and shared:

- `src/shared/keyboard-nav.ts` owns *where* the cursor lands — `sortForCursor` (day by day,
  all-day first, matching draw order), `stepCursor` (enters an unselected list at the anchor date,
  not at the oldest loaded row, and stops rather than wraps at the ends), `nudgedRange` and
  `resizedRange`. `App.tsx` owns *when*: plain arrows walk the cursor, Shift+arrows move the event
  under it, Alt+arrows stretch its end. All-day spans are floating dates read in UTC; timed ones
  shift in local time so "one day later" survives a DST change.
- Views take `selectedOccurrenceId` and draw `.is-key-selected`; `EventPill` / `TimedEventBlock`
  also set `data-selected-occurrence` so `App.tsx` can scroll the cursor into view. Month view
  swaps a selected event into its visible rows instead of growing the cell, so the `+N more` count
  is unchanged.
- Every picker (`CustomSelect`, `DatePicker`, `TimePicker`) portals its list to the end of `<body>`,
  so the list can never be tabbed into. Focus stays on the trigger and a **roving index** moves
  instead — `src/renderer/src/lib/roving-index.ts` (`nextEnabledIndex` / `firstEnabledIndex`,
  skipping disabled entries and wrapping), with `.gc-option-active` for the highlight. Tested
  without a DOM in `tests/roving-index.test.ts`.
- `.gc-focus-ring` is drawn on `:focus-visible` only (and `:has(:focus-visible)` for composite
  fields), so a mouse click never leaves a ring behind. Don't reintroduce `:focus`.

### Testing notes

- Main-process tests run in plain Node. `vitest.config.ts` aliases `electron` → `tests/stubs/electron.ts`, so tests do not need the Electron binary. Extend that stub if a test needs another Electron API.
- DB tests call `initDatabase(':memory:')`. No network in unit tests — mock provider HTTP.
- A test that imports renderer code (`src/renderer/**`) must be added to `tsconfig.web.json`'s `include` **and** `tsconfig.node.json`'s `exclude` (see how `drop-target` / `resize-math` / `ui-components` tests are wired), or `npm run typecheck` fails.

## Gotchas

- **Path aliases are declared twice** — in `electron.vite.config.ts` (per-bundle, for the build) and in each `tsconfig.*.json` + `vitest.config.ts` (for typecheck/tests). Adding an alias means updating both.
- **Electron binary install can silently fail** — if `node_modules/electron/dist/` contains only `locales/`, `npm run dev` and packaging break (tests still pass via the stub). Recover with:
  ```bash
  cd node_modules/electron/dist && unzip -q ~/.cache/electron/*/electron-v*-linux-x64.zip && printf electron > ../path.txt
  ```
- Docs live in `docs/`: `urd.md`, `project-overview-pdr.md`, `system-architecture.md`, `codebase-summary.md`, `design-guidelines.md`, `code-standards.md`, `deployment-guide.md`, `project-roadmap.md`. The README is in Vietnamese and is user-facing, not a spec — parts of it (local tasks) describe a feature that migration `005` dropped. Implementation history is in `docs/journals/`; plans in `plans/<timestamp>-<slug>/`. Commit messages follow `feat(scope): …` / `fix(scope): …`.
