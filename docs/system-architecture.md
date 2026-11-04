# xrncal — System Architecture

**Last updated:** 2026-10-27

---

## Process Architecture

xrncal follows Electron's multi-process model with strict security boundaries.

```
┌─────────────────────────────────────────────────────────────┐
│  Renderer Process (sandboxed, contextIsolation, no Node.js) │
│                                                             │
│  React App (App.tsx - one useState container, no store lib) │
│  ├── Views: Day / Week / Month / Year / List                │
│  ├── Editor: full form, reminders, invitation replies       │
│  ├── Right-click menu: edit, duplicate, delete, new event   │
│  ├── Welcome (first run), .ics import, clock (use-now)      │
│  ├── DnD: use-event-dnd + DropActionPopover, edge resize    │
│  ├── Sidebar: mini calendar + calendar list (by account)    │
│  ├── Dialogs: Accounts (page stack), Search, Settings,      │
│  │            Shortcuts, Sync conflicts                     │
│  ├── ReminderStack: rung reminders - join, snooze, dismiss  │
│  └── Undo stack: inverse of each move / resize / delete     │
│                                                             │
│  MiniApp (companion window via #mini hash)                  │
│  └── Upcoming events                                        │
└───────────────────────┬─────────────────────────────────────┘
                        │ contextBridge (window.xrncal)
┌───────────────────────▼─────────────────────────────────────┐
│  Preload Script                                             │
│  exposes window.xrncal (XrncalAPI), typed IPC_CHANNELS      │
└───────────────────────┬─────────────────────────────────────┘
                        │ ipcRenderer.invoke / ipcMain.handle
                        │ + three push channels: SYNC.CHANGED,
                        │   REMINDERS.CHANGED, ICS.FILE_OPENED
┌───────────────────────▼─────────────────────────────────────┐
│  Main Process                                               │
│                                                             │
│  index.ts - lifecycle, single-instance lock, showMainWindow │
│  ├── ipc.ts → registers the IPC handler groups              │
│  ├── DB: sqlite-driver, database.ts (migrations 001-022),   │
│  │       repos/ (calendars, events, settings, sync-state)   │
│  ├── Sync: sync-worker.ts → Google, Graph, CalDAV engines,  │
│  │         and due .ics subscriptions                       │
│  ├── ICS: parse-ics (ical.js) / write-ics (RFC 5545)        │
│  ├── OAuth: loopback 127.0.0.1 + PKCE (Google, Microsoft)   │
│  ├── Secure Store (safeStorage, fails closed)               │
│  ├── Reminders: reminder-scheduler.ts + reminders-ipc.ts    │
│  ├── Updater: electron-updater (packaged builds only)       │
│  ├── System Tray (tray.ts) - closing the window keeps the  │
│  │   app here; launch-at-login.ts starts it in the tray     │
│  ├── first-run.ts, setting-effects.ts, opened-ics-files.ts │
│  └── Mini Window (mini-window.ts, frameless BrowserWindow)  │
└─────────────────────────────────────────────────────────────┘
```

---

## Data Flow

### Reading events

```
User navigates to Week view
  → App.tsx computes the visible range
  → window.xrncal.events.queryRange(calendarIds, startUtc, endUtc)
  → EventsRepo.queryEventsByRange() → SQLite SELECT + RRULE / lunar expansion
  → ExpandedOccurrence[] → App state → React re-renders
```

### Writing an event

```
User saves in the editor (or drags, resizes, deletes)
  → window.xrncal.events.create / update / move / delete
  → EventsRepo writes SQLite (dirty = 1); read-only calendars throw here
  → the handler nudges a sync; the renderer reloads the range
  → App pushes the inverse onto its undo stack (moves, resizes, copies, deletes)
```

### Sync loop

```
SyncWorker: every 20 s while the window has focus, 5 min otherwise
  → Google, Graph, CalDAV and due subscriptions run concurrently, each with its own .catch
  → per calendar: replies (rsvp_pending) → dirty pushes → pull
      Google: incremental via syncToken
      Graph:  changes since the last poll; a full listing every 10 min removes deleted events;
              a changed series (and every series each 6 h) is read for its changed and
              cancelled occurrences
      CalDAV: skipped when the ctag is unchanged and nothing was pushed
  → SYNC.CHANGED to every window when rows changed
```

### Reminders

```
ReminderScheduler.tick() every 30 s
  → occurrences from now to the longest reminder lead in use
  → each occurrence's reminders: its own list, else the calendar's default
    (Google), else the app setting - which applies only to writable calendars
  → a due reminder: OS notification (click → showMainWindow) + active list
  → REMINDERS.CHANGED → ReminderStack (join / open / snooze / dismiss)
```

### Authentication (Google; Microsoft is the same shape)

```
window.xrncal.auth.connectGoogle()
  → loopback HTTP server on 127.0.0.1, random port
  → shell.openExternal(OAuth URL with PKCE challenge)
  → callback ?code=… → token exchange
  → tokens encrypted with safeStorage → settings row token:<accountId>
  → account row inserted → first sync triggered
```

---

## Database Schema

```sql
accounts (id, type, name, email, is_active, created_at, updated_at)

calendars (id, account_id → accounts, name, color, is_visible, is_read_only,
           is_default, color_is_custom, default_reminders, subscription_url,
           subscription_refreshed_at, sync_token, created_at, updated_at)

events (id, calendar_id → calendars, provider_event_id, uid, title, notes,
        location, dtstart_utc, dtend_utc, tzid, all_day, rrule, rdate, exdate,
        lunar_rule, lunar_source_event_id, color, meeting_url, reminders,
        etag, dirty, has_conflict, moved_from_calendar_id, rsvp_pending,
        attendees_synced, is_deleted, created_at, updated_at)

event_exceptions (id, master_event_id → events, original_start_utc,
                  is_cancelled, title, notes, location, dtstart_utc,
                  dtend_utc, tzid, all_day, color, dirty, etag,
                  provider_instance_id, created_at, updated_at)

attendees (id, event_id → events, email, display_name, response_status,
           is_organizer, is_self, role, created_at)

reminder_log (ring_key PK, anchor_utc)  -- reminders that have rung

reminder_state (occurrence_id PK, snoozed_until)  -- cards on screen (NULL) and snoozes

event_sources (event_id PK → events, ics)  -- the CalDAV server's copy, for lossless edits (020)

events_fts (title, notes, location)  -- FTS5 over events by rowid (019), diacritics folded

sync_state (calendar_id PK → calendars, account_id, last_synced_at, sync_token,
            sync_status, error_message, updated_at)

settings (key, value, updated_at)
```

`sync_state.sync_token` holds whatever a calendar's engine uses to skip work:
Google's syncToken, a CalDAV ctag, Graph's `{since, fullAt, overridesPending, overridesAt}`, or a hash of a
subscribed feed.

### Key indexes

- `idx_events_calendar_range` on `(calendar_id, is_deleted, dtstart_utc, dtend_utc)` - view range queries
- `idx_events_provider_id` UNIQUE on `(calendar_id, provider_event_id)`
- `idx_event_exceptions_master` UNIQUE on `(master_event_id, original_start_utc)`

---

## Lifecycle

- **Start:** credentials (`load-credentials.ts`), the computer's defaults for settings nobody
  chose (`setSystemDefaults(defaultsForSystem(...))`), the database, holiday refresh, and - for a
  profile already in use - `settleExistingProfile()`, which pins the values it has been showing
  and skips the welcome. `nativeTheme.themeSource` is set from the theme setting, so the first
  paint is in the right theme. Then IPC, tray, and the main window - unless started at login
  with `--hidden` and a tray to come back from.
- **Close:** the main window is destroyed, and the app stays in the tray (`closeToTray`); a
  one-time notification says so. Without a tray, or with the setting off, it quits. A real quit
  (tray menu, `Ctrl+Q` → `APP.QUIT`, an update) sets `isQuitting` first; the database closes in
  `will-quit`.
- **Second launch:** brings the window back and hands over any `.ics` path from its command line.
- **Restore:** `restore-database.ts` checks the chosen backup on a copy, saves the current data
  in `<userData>/backups`, swaps the files with the database closed, and relaunches. Its file
  dialog opens in that folder when it holds automatic backups.
- **Automatic backups:** `auto-backup.ts` checks two minutes after start and every six hours,
  and when the newest `xrncal-auto-*.sqlite` (dated by its name) is a week old it takes a
  `VACUUM INTO` snapshot and keeps the newest four (`autoBackup` setting). Every snapshot,
  manual ones included, is created `0600` before SQLite writes into it.
- **Log:** `log.ts` appends to `<userData>/logs/xrncal.log` (rotated to `xrncal.old.log` at
  1 MB, `0600`): startup, the database failing to open, sync failures per account when they
  start, change or end (`accountErrorChanges()`, not every poll), feed failures (without the
  link: a private feed's address is its password), automatic backups, update errors, crashed
  windows and helper processes, unhandled rejections. `redactSecrets()` runs over every line.
  Never log event text or a credential. Settings → *Show log file* opens it (`APP.SHOW_LOG_FILE`).
- **Tray on GNOME:** GNOME Shell shows tray icons only with the AppIndicator extension, and
  Electron creates a `Tray` either way. `tray-host.ts` asks the session bus (`gdbus`) whether a
  StatusNotifier host is registered - on GNOME Shell only, at startup and whenever the main window
  takes focus - and `hasTray()` is false without one, so closing the window quits and launch at
  login opens the window instead of leaving an unreachable app. Other desktops are not asked:
  some have only an XEmbed tray, which that query cannot see.

## IPC Contract

All IPC channels are constants in `src/shared/ipc-contract.ts`. The `XrncalAPI` interface mirrors `window.xrncal` and is the single source of truth for the preload bridge.

**Namespace groups:** `APP`, `SETTINGS`, `AUTH`, `SYNC`, `REMINDERS`, `CALENDAR`, `EVENT`, `ICS`, `MINI`, `HOLIDAYS`, `SUBSCRIPTIONS`

---

## Provider Engines

Each engine (`src/main/sync/*-sync-engine.ts`) follows the same pattern: list
the account's calendars, then per calendar deliver pending replies, push dirty
rows (with `If-Match`; a 412 parks the row as a conflict), and pull. Provider
JSON is normalized by the `*-event-mapper.ts` modules and never reaches SQLite
or the renderer.

What each provider can hold of a reminder list differs - Google five of any
kind, Graph one, CalDAV display alarms - so a pull keeps the local list when the
provider sends back exactly its share of it (`mergePulledReminders`). A guest
list is pushed only when it is known to be the provider's (`attendees_synced`),
so a list that was never fetched cannot erase a meeting's guests.

---

## Shared Module (`src/shared`)

The only place both main and renderer import. Zero Node.js and zero DOM
dependencies. Key contracts: `event-model.ts` (domain types),
`ipc-contract.ts`, `settings-contract.ts`, `reminders.ts`, `expand-occurrences.ts` (with
`bounded-rrule.ts`, which caps what one recurrence rule may cost), `lunar-vietnam.ts`,
`keyboard-nav.ts`.

---

## Security Boundaries

| Control | Value |
|---------|-------|
| `sandbox` | `true` on both BrowserWindows |
| `contextIsolation` | `true` |
| `nodeIntegration` | `false` |
| `webSecurity` | `true` |
| Token storage | `safeStorage.encryptString()` only; no plaintext fallback |
| External links | `shell.openExternal()` behind `isSafeExternalUrl()` (http, https, mailto) |
| Navigation | `will-navigate` blocks leaving the app's own document |
| ICS input | 5 MB cap (`MAX_ICS_SIZE_BYTES`), imports and subscriptions alike |
| Subscription URLs | `https://`, `http://` or `webcal://` only |
| Read-only calendars | Rejected in the repo layer (`ReadOnlyCalendarError`) |

---

## Mini Window Architecture

The companion mini window (`mini-window.ts`) is a second frameless `BrowserWindow` that loads the same renderer HTML file with `#mini` appended. `main.tsx` detects the hash and renders `MiniApp` instead of `App`, keeping a single Vite build output for both surfaces. Its IPC handlers are registered by `registerMiniIpcHandlers(showMainWindow)` from `index.ts`, as the reminder handlers are, since both need to open the main window.

---

## Build, Packaging and Releases

```
electron-vite build
├── out/main/index.js      # Main process bundle
├── out/preload/index.js   # Preload bundle
└── out/renderer/          # React app (Vite static bundle)

electron-builder (electron-builder.yml)
├── Windows: NSIS x64 installer (pack:win)
└── Linux:   AppImage x64 (pack:linux)
```

A `v*` tag runs `.github/workflows/release.yml`: it checks the tag matches
`package.json`, runs lint, typecheck and tests, then builds both installers and
uploads them with the `latest*.yml` files to a **draft** GitHub release.
Publishing the draft is what makes installed builds (`src/main/updater.ts`)
see it. Builds are not code-signed, so Windows shows a SmartScreen prompt.
