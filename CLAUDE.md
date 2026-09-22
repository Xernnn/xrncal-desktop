# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev            # electron-vite dev app with renderer HMR
npm run build          # production bundle -> out/{main,preload,renderer}
npm run lint           # eslint . (flat config in eslint.config.mjs)
npm run lint:fix       # eslint . --fix
npm run clean          # remove out/, dist/, *.tsbuildinfo
npm run typecheck      # typecheck:node && :web && :android (run this before commit)
npm run typecheck:node # tsc -p tsconfig.node.json  (main + preload + shared + most tests)
npm run typecheck:web  # tsc -p tsconfig.web.json   (renderer + shared + renderer-touching tests)
npm run test           # vitest run (whole suite)
npm run pack:win       # build + electron-builder NSIS x64
npm run pack:linux     # build + electron-builder AppImage x64
npm run app:install    # pack:linux + install AppImage & .desktop entry for this user
npm run app:update     # alias of app:install
```

Android target:

```bash
npm run build:android          # vite build (vite.android.config.ts) + cap sync android
npm run pack:android           # build:android + gradlew assembleDebug -> app-debug.apk
npm run pack:android:release   # ...assembleRelease, R8-minified (~8 MB); signs if configured
npm run android:run            # build + cap run android (needs a device/emulator on adb)
npm run android:open           # open the Gradle project in Android Studio
npm run android:configure-oauth # derive the Google redirect scheme -> android/gradle.properties
npm run typecheck:android      # tsc -p tsconfig.android.json (part of `npm run typecheck`)
cd android && ./gradlew :app:testDebugUnitTest   # JVM tests for the Kotlin bridge
```

The APK lands at `android/app/build/outputs/apk/debug/app-debug.apk` (~12 MB; the R8-minified
release is ~8 MB).

Release signing is opt-in and never committed: set `xrncalStoreFile`, `xrncalStorePassword`,
`xrncalKeyAlias` and `xrncalKeyPassword` in `~/.gradle/gradle.properties` (or the matching
`XRNCAL_*` environment variables) and `assembleRelease` signs; leave them unset and it still
builds, just unsigned, so CI keeps working. R8 is on for release, which matters for the bridge:
`XrncalNative` is only ever called from JavaScript, so R8 sees no callers and would rename or
strip every `@JavascriptInterface` method - `android/app/proguard-rules.pro` keeps it, along with
requery's native SQLite classes and Capacitor's reflectively-resolved plugins. A release build
that starts but shows an empty calendar is the signature of those rules going missing. The Gradle
build provisions its own JDK 21 (Capacitor 7 requires it) through the foojay resolver in
`android/settings.gradle`, so the daemon's JVM does not matter; `android/build.gradle` pins
every compile task to that toolchain. `android/` is generated - it is in `.eslintignore`
territory (see `eslint.config.mjs`) and `npx cap add android` can recreate it.

### Running it on an emulator

```bash
export ANDROID_HOME=~/.local/opt/android-sdk
$ANDROID_HOME/emulator/emulator -avd xrncal_test -no-window -no-audio -no-boot-anim \
  -gpu swiftshader_indirect &          # headless; drop -no-window for a screen
adb wait-for-device && adb install -r android/app/build/outputs/apk/debug/app-debug.apk
adb shell am start -n app.xrncal.android/.MainActivity
adb exec-out screencap -p > /tmp/shot.png
adb logcat -d | grep Capacitor/Console      # the renderer's console
```

Two things bite when setting the SDK up from the command line:

- **`sdkmanager` may fail to unzip its downloads** ("Error on ZipFile unknown archive") while a
  plain `curl` of the same artifact succeeds. When that happens, fetch the zip from
  `dl.google.com/android/repository/`, unpack it into `$ANDROID_HOME`, and hand-write the
  `package.xml` the package would have contained - `avdmanager` discovers packages through
  those manifests, not by scanning directories, and reports "emulator package must be
  installed!" without one.
- The **WebView is remotely debuggable in a debug build**, which is far more useful than
  screenshots for diagnosing layout: `adb forward tcp:9222
  localabstract:webview_devtools_remote_$(adb shell pidof app.xrncal.android)`, then drive
  `Runtime.evaluate` over the socket listed at `http://localhost:9222/json`. Several of the
  layout bugs found during the port were only diagnosable by reading computed styles this way.

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

Calendar for Windows, Linux (Electron) and Android (Capacitor), from one codebase. Local-first:
**SQLite is the single source of truth for the UI**; provider sync engines only push/pull against it.
Unless a section says otherwise it describes both targets — see "Android (Capacitor)" below for the
handful of places they diverge.

### Four layers, strict import boundaries

| Layer | May import | Notes |
|---|---|---|
| `src/main` | Node, Electron main, `src/shared` | app lifecycle, DB, OAuth, sync, tray, notifications |
| `src/preload` | `contextBridge`, `ipcRenderer`, `src/shared` | exposes `window.xrncal` |
| `src/renderer` | React, DOM, `src/shared`, `window.xrncal` | never imports `src/main` |
| `src/shared` | pure TS only | no Node, no DOM, no Electron — used by both sides |
| `src/android` | Capacitor, `src/main`, `src/renderer`, `src/shared` | host shims + mobile chrome; the only platform-specific tree |

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

### Android (Capacitor)

Android runs **the same code**, not a port of it. There is one renderer, one set of repos and
one set of sync engines; `vite.android.config.ts` compiles `src/main/**` straight into the web
bundle and swaps only the modules that genuinely cannot work in a WebView. Adding a feature
means touching the shared code, not two implementations.

The swap is done by the `androidModuleSwap` Vite plugin rather than `resolve.alias`, because
aliases match import *specifiers* and the same module is reached as both `./sqlite-driver` and
`../db/sqlite-driver`. The plugin resolves first and matches on the resulting file path, so
every import route is covered. `MODULE_SWAPS` in that config is the authoritative list:

| Desktop module | Android replacement | Why |
|---|---|---|
| `db/sqlite-driver.ts` | `android/platform/sqlite-driver.ts` | `node:sqlite` -> Android SQLite over the JS bridge |
| `secure-store.ts` | `android/platform/secure-store.ts` | `safeStorage` -> Keystore AES-GCM |
| `oauth/google-oauth.ts` | `android/oauth/google-oauth.ts` | loopback listener -> custom-scheme redirect, PKCE-only |
| `oauth/microsoft-oauth.ts` | `android/oauth/microsoft-oauth.ts` | same |
| `load-credentials.ts` | `android/platform/load-credentials.ts` | no `.env` on disk -> build-time inlined client ids |
| `db/backup.ts` | `android/platform/backup.ts` | still `VACUUM INTO`, then the share sheet |
| `notifications/reminder-scheduler.ts` | `android/platform/reminder-scheduler.ts` | polling -> OS-scheduled alarms |

Everything else is shimmed at the module level: `electron` resolves to
`src/android/shims/electron.ts`, which reimplements `ipcMain`/`ipcRenderer` as one in-process
map. That is what lets `src/main/ipc/*.ts` **and `src/preload/index.ts` run unchanged** - `invoke`
looks the channel up in the map `handle` wrote to. `node:fs`, `node:path` and friends have
shims beside it; `Buffer` and `process` are installed by `src/android/boot/polyfills.ts`, which
the entry point imports first so the globals exist before any main-process module body runs.

**The synchronous bridge is the load-bearing decision.** `ISqliteDatabase` is synchronous and
every repo is written against it, so Capacitor's promise-based plugin bridge is unusable here -
it would mean rewriting the repos, the IPC handlers and the three sync engines. Instead
`XrncalNative` is injected with `WebView.addJavascriptInterface`, whose methods *are*
synchronous from JS. Native code lives in `android/app/src/main/java/app/xrncal/android/`;
`src/android/native/bridge.ts` is the typed TS side of that contract. Change one, change both.
Methods return a JSON envelope because an exception thrown out of an `@JavascriptInterface`
method reaches JS as a bare `null`.

Two consequences worth knowing:

- SQLite is **requery's bundled build** (`com.github.requery:sqlite-android`, via JitPack - the
  original jcenter artifact is gone), not the platform's. Migration 002 creates an `fts5` virtual
  table and FTS5 is not reliably compiled into Android's own SQLite at minSdk 23.
- `node:sqlite`'s `exec()` takes a whole script; Android's `execSQL` takes one statement. The
  migrations are multi-statement blobs containing trigger bodies with their own `;`, so
  `SqlStatementSplitter.kt` cuts them up. It is the riskiest new logic in the port and is covered
  by `SqlStatementSplitterTest.kt`, which asserts against migration 002 verbatim.
- **Never re-enable WAL with `SQLiteDatabase.enableWriteAheadLogging()`.** It switches Android to
  a multi-connection pool, and a read issued inside an explicit `SAVEPOINT` is then served by a
  different connection that cannot see the transaction's own uncommitted rows. `createEvent`
  inserts and reads back, and `importIcs` wraps that in a transaction - the symptom was an
  import reporting "0 imported, 2 errors" while both rows had in fact been written.
  `XrncalNative.dbOpen` sets `PRAGMA journal_mode = WAL` directly instead, which keeps the WAL
  journal while leaving the pool at one connection. `tests/android-sqlite-bridge.test.ts` states
  the read-your-writes contract.
- A statement that returns rows must not go to `execSQL`, which rejects it with "Queries can be
  performed using SQLiteDatabase query or rawQuery methods only". `PRAGMA journal_mode = …`
  returns a row, which is why `execOne()` routes PRAGMA/SELECT/WITH through `rawQuery`.

**Window insets.** `env(safe-area-inset-*)` is *not* enough on Android: in a WebView those
values describe display cutouts only and read 0 for the status bar and the gesture pill. The app
draws edge to edge, so `MainActivity` reads the real insets and pushes them in as
`--xrncal-inset-*` (see `src/android/platform/window-insets.ts`); `mobile.css` uses those with
env() only as a fallback. The same applies horizontally - a punch-hole that sits in the status
bar in portrait moves to a screen *edge* in landscape. The soft keyboard is handled the same way
(`--xrncal-keyboard`) because the WebView is deliberately not resized on focus.

**Touch gestures.** The views drive direct manipulation with APIs a phone does not produce:
moving an event uses HTML5 drag-and-drop (`draggable`, `dataTransfer`), which touch input never
fires, and drag-to-create a time range uses `mousedown`/`mousemove`, of which touch produces only
a down/up pair. Both were completely dead on device. `src/android/ui/touch-drag.ts` synthesises
what those hooks expect - real `DragEvent`s carrying a real `DataTransfer`, and real
`MouseEvent`s - from a long press, so the shared hooks and their unit-tested geometry are
untouched and React cannot tell a finger was involved. The gesture has to be long-press-then-drag
because an immediate drag is indistinguishable from a scroll, and the week grid scrolls in both
axes. The engine also auto-scrolls near an edge, which is not optional: only three days are
visible on a phone, so reaching Friday depends on it. Resize is left alone - it already uses
pointer events, which touch does fire - but its handles need `touch-action: none` (or the browser
claims the gesture and cancels the pointer stream) and a grown hit area, both in `mobile.css`.
Resize handles are excluded from drag arming so resting a finger on one cannot turn a resize into
a move.

**Back button.** `src/android/ui/use-back-button.ts` dismisses one layer per press and minimises
at the root. It closes dialogs by dispatching `Escape` rather than hunting for a close button,
because `App.tsx` already owns a full Escape hierarchy - reusing it means Back and Escape can
never disagree and a new dialog gets Back support for free. Which layers count is read from the
DOM, not from React state: `isOverlayOpen` reaches the shell through a ref that `App` refreshes as
it renders, and `App` re-rendering does not re-render the shell around it, so that value can lag.
Note `EventEditorDialog` renders either a centred modal (`.gc-dialog`) *or* a side panel
(`.gc-slide-left` / `.gc-slide-right`, chosen by where the drag started) - matching only one of
them made Back leave the app with the editor still on screen. Also expect the first Back to
dismiss the soft keyboard rather than the sheet; that is Android, not a bug.

**UI.** `App.tsx` is shared. It grew three optional render props - `renderHeader`,
`renderSidebar`, `renderBottomBar` - each handed an `AppShellContext`. Desktop passes none and
behaves exactly as before; `src/android/ui/MobileApp.tsx` passes mobile chrome (bottom nav,
drawer, compact header). Forking the 1,400-line container was the alternative and it would have
drifted within a release. Styling differences live in `src/android/ui/mobile.css`, layered over
the shared stylesheet - the Notion look and the `docs/design-guidelines.md` rules are unchanged.

Two traps worth knowing before changing the mobile shell:

- **Tailwind's source detection follows the build root.** The Android build sets Vite's root to
  `src/android`, which silently narrowed Tailwind v4's scan to that directory and dropped every
  utility used only under `src/renderer` - the stylesheet shipped at 28 kB instead of 63 kB, and
  the app *almost* looked right while `min-h-0` and `h-screen` were simply missing, so the shell's
  flex layout collapsed. `src/renderer/src/styles/index.css` now declares both trees with
  `@source`. Add a new source tree there, not to a config file.
- **Overlays must be portalled.** App renders the sidebar inside its content row, which carries
  `z-10` and is a flex item, so it opens a stacking context; anything inside it paints below the
  bottom nav's `z-30` no matter how large its own z-index. `CalendarDrawer` renders through
  `createPortal` to `document.body` for that reason.

**OAuth differs by necessity.** Android flows are public PKCE clients and never send a client
secret; a secret inside an APK is readable by anyone who unzips it. `vite.android.config.ts`
inlines client *ids* through an explicit `define` allowlist rather than `envPrefix`, because any
prefix covering `GOOGLE_OAUTH_CLIENT_ID` also covers `..._SECRET`. Google's redirect scheme is
the reversed client id, so it is per-install: `npm run android:configure-oauth` derives it and
writes `googleRedirectScheme` into `android/gradle.properties`, where the manifest placeholder
picks it up. Microsoft's is the fixed `app.xrncal.android://oauth2callback`. Both are declared as
intent filters in `AndroidManifest.xml` - change the scheme in TS and you must change it there.

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

- **Path aliases (`@main`, `@preload`, `@renderer`, `@shared`) are declared twice** — in `electron.vite.config.ts` (per-bundle, for the build) and in each `tsconfig.*.json` + `vitest.config.ts` (for typecheck/tests); `vite.android.config.ts` declares its own set again. Adding an alias means updating all of them.
- **Electron binary install can silently fail** — if `node_modules/electron/dist/` contains only `locales/`, `npm run dev` and packaging break (tests still pass via the stub). Recover with:
  ```bash
  cd node_modules/electron/dist && unzip -q ~/.cache/electron/*/electron-v*-linux-x64.zip && printf electron > ../path.txt
  ```
- **The DB tests need a Node with `node:sqlite` built in** — it is flagged in 22.5 and unflagged
  from 23.4 on, and `better-sqlite3` is not a declared dependency, so there is no fallback in a
  fresh checkout. CI pins Node 24 for exactly this reason (`.github/workflows/ci.yml`, which also
  sets `ELECTRON_SKIP_BINARY_DOWNLOAD=1` since the tests stub `electron`).
- `.agents/skills/notion-ui-skills/SKILL.md` is a project skill holding the Notion design tokens (surface/text/border hexes, 4px grid) that `docs/design-guidelines.md` describes in prose.
- Docs live in `docs/`: `urd.md`, `project-overview-pdr.md`, `system-architecture.md`, `codebase-summary.md`, `design-guidelines.md`, `code-standards.md`, `deployment-guide.md`, `project-roadmap.md`. `README.md` (English) and `README.vi.md` (Vietnamese) are user-facing and kept in step with each other, not specs. Implementation history is in `docs/journals/`; plans in `plans/<timestamp>-<slug>/`. Commit messages follow `feat(scope): …` / `fix(scope): …`.
