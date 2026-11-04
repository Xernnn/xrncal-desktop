# xrncal — Code Standards

**Last updated:** 2026-10-27

---

## Language & Toolchain

- **TypeScript 6** — strict mode. No `any` except where bridging a third-party library without types.
- **React 19** — functional components only. No class components.
- **Tailwind CSS 4** — utility-first; design tokens defined in `src/renderer/src/styles/index.css`.
- **Vitest** — unit tests for main process, shared modules, and event mappers.

---

## Project Structure Conventions

### Process Boundaries

| Layer | What it can import |
|-------|--------------------|
| `src/main` | Node.js APIs, Electron main APIs, `src/shared` |
| `src/preload` | Electron `contextBridge`, `ipcRenderer`, `src/shared` |
| `src/renderer` | React, DOM APIs, `src/shared`, `window.xrncal` (IPC bridge) |
| `src/shared` | Pure TypeScript only. No Node.js, no DOM, no Electron |

**Never import main-process modules from the renderer.** IPC is the only bridge.

### Path Aliases

```ts
// tsconfig.web.json / tsconfig.node.json
"@shared/*" → "src/shared/*"
"@renderer/*" → "src/renderer/src/*"
"@main/*" → "src/main/*"
```

---

## Naming Conventions

### Files

| Type | Convention | Example |
|------|-----------|---------|
| React components | `PascalCase.tsx` | `EventPill.tsx` |
| Hooks | `use-kebab-case.ts` | `use-event-dnd.ts` |
| Utilities/modules | `kebab-case.ts` | `google-event-mapper.ts` |
| IPC handlers | `kebab-case-ipc.ts` | `calendar-ipc.ts` |
| Test files | `kebab-case.test.ts` | `events-repo.test.ts` |

### TypeScript

- **Interfaces** for data shapes (`CalendarEvent`, `Calendar`, `Attendee`).
- **Types** for unions and utility types (`AccountType`, `RecurringEditScope`, `ThemeMode`).
- **`I` prefix** only for the SQLite driver abstraction (`ISqliteDatabase`). Not for general interfaces.
- **Props type** inline or as `interface ComponentNameProps`.

### IPC Channels

All IPC channel strings are defined in `src/shared/ipc-contract.ts` under `IPC_CHANNELS`. Never use raw string literals in `ipcRenderer.invoke()` or `ipcMain.handle()`.

```ts
// Correct
ipcRenderer.invoke(IPC_CHANNELS.EVENT.CREATE, input)

// Wrong
ipcRenderer.invoke('event:create', input)
```

---

## Component Patterns

### Renderer Components

```tsx
// Good — typed props, named export
interface EventPillProps {
  event: ExpandedOccurrence
  onClick?: (event: ExpandedOccurrence) => void
}

export function EventPill({ event, onClick }: EventPillProps) {
  // ...
}
```

- Prefer named exports over default exports for components.
- Co-locate styles with components using Tailwind utility classes.
- Build conditional classes with template literals; there is no `clsx`/`cn()` helper in this project.

### Hooks

- Custom hooks start with `use` and live in `src/renderer/src/hooks/`.
- Hooks that call `window.xrncal.*` must handle errors gracefully and not throw to the render tree.

---

## Database Layer

### Repository Pattern

All database access goes through repository classes in `src/main/db/repos/`. Direct `db.exec()` or `db.prepare()` calls belong in repo methods, not in IPC handlers.

```ts
// IPC handler → repo method (correct)
ipcMain.handle(IPC_CHANNELS.EVENT.CREATE, (_, input) => {
  return eventsRepo.create(input)
})

// Direct DB call in IPC handler (wrong)
ipcMain.handle(IPC_CHANNELS.EVENT.CREATE, (_, input) => {
  return db.prepare('INSERT INTO events ...').run(...)
})
```

### Migrations

- Sequential numbered migrations in `src/main/db/database.ts` (`MIGRATION_001_SQL`, etc.).
- Schema version tracked in `schema_migrations` table.
- Never alter existing migrations — always add a new version.
- SQL also exists as reference files in `src/main/db/migrations/`.

### Timestamps

All timestamps stored as **ISO 8601 UTC strings** (`new Date().toISOString()`). Never store local time strings. Event start/end stored in UTC (`dtstart_utc`, `dtend_utc`) with a `tzid` column for the user's original timezone.

---

## IPC Conventions

### Handler Registration

IPC handlers are registered once at startup in `src/main/ipc.ts` which calls each module's registration function:

```ts
export function registerIpcHandlers(): void {
  registerSettingsIpcHandlers()
  registerCalendarIpcHandlers()
  registerAuthSyncIpcHandlers()
  registerHolidayIpcHandlers()
  registerSubscriptionIpcHandlers()
}
```

The two exceptions are the mini window's and the reminders' handlers, registered from
`src/main/index.ts` (`registerMiniIpcHandlers(showMainWindow)`,
`registerReminderIpcHandlers(showMainWindow)`): both have to open the main window, and only
`index.ts` can hand out `showMainWindow`.

### Read-Only Enforcement

Read-only calendars (holiday and link subscriptions, calendars a provider only lets you read) are
enforced in the **repo layer**: every write path in `EventsRepo` calls `checkReadOnlyCalendar()`
and throws `ReadOnlyCalendarError`, which the handler turns into a user-facing message. Put the
guard in the repo, not the handler - nothing can get round it there.

### Error Handling

Handlers throw. Electron delivers the error to the renderer as a rejected `invoke`, and the
renderer's `showFriendlyError()` (`components/ui/toast.tsx`) strips the IPC wrapper and shows the
message. Translate known domain errors (such as `ReadOnlyCalendarError`) into a sentence before
rethrowing. Handlers that return a result object instead (`connectCalDav`, `importIcs`,
`backupDatabase`) do so because the renderer branches on the outcome, not only on success.

---

## Security Rules

1. **`safeStorage` only** for OAuth tokens and CalDAV credentials. Never write tokens to SQLite plaintext.
2. **Fail-closed** on Linux if `safeStorage` is unavailable: refuse to persist tokens and display a visible error. Do not silently fall back to plaintext.
3. **Sandbox + contextIsolation enabled** on every `BrowserWindow`. `nodeIntegration: false`, `webSecurity: true`.
4. **External links** opened via `shell.openExternal()`, never by `loadURL()` inside the renderer window.
5. **ICS import size limit**: cap imported ICS files to prevent memory exhaustion.
6. **CalDAV TLS**: Node's default certificate verification, so self-signed servers are refused. The
   per-host SHA-256 pinning the URD describes was never built; do not add a "trust anyway" switch.
7. **Outgoing links**: anything handed to `shell.openExternal()` passes `isSafeExternalUrl()`
   (http, https, mailto). Subscription feeds are fetched only from `https://`, `http://` or
   `webcal://` addresses.
8. **Only the app's own page**: both windows go through `lockDownContents()`
   (`src/main/web-contents-guard.ts`) - no new windows, no navigation away from the built
   `index.html` (not "any file://"), no `<webview>`. `guardIpcSenders()` refuses every IPC request
   whose frame is not that page, and `denyUnusedPermissions()` grants nothing but clipboard
   writing. The CSP adds `object-src`, `frame-src`, `base-uri` and `form-action 'none'`. The dev
   server is read through `devServerUrl()`, which an installed build ignores.
9. **CalDAV credentials stay with their server**: `mayCarryCredentials()` sends the password only
   to the account's host or its own domain, never down to plain HTTP. Hrefs come from the server,
   and a hostile one could otherwise name another host to collect it. Server colours pass
   `normalizeCalendarColor()`; discovery and error bodies are size-capped.
10. **Text from providers in HTML or markup is escaped**: the sign-in pages (`escapeHtml()`), and
    Linux notification bodies, which notification servers read as markup.
11. **Packaged builds are locked**: Electron fuses (`electron-builder.yml`) disable run-as-Node,
    `NODE_OPTIONS` and `--inspect`; `src/main/index.ts` exits on `--remote-debugging-*`, and
    ignores `ELECTRON_RENDERER_URL` and `XRNCAL_USER_DATA_DIR` (dev and test only). On Linux,
    `safeStorage`'s `basic_text` backend counts as no encryption.
12. **Recurrence rules are input too**: they come from feeds and invitations, and `rrule` has no
    limit of its own - one 200-byte event could freeze the main process for minutes or forever.
    Expansion goes through `boundedBetween()` (`src/shared/bounded-rrule.ts`): sub-daily rules are
    not expanded, the walk starts near the range, and work is metered per series and per calendar.
    Never call `rrule`'s `between()`/`all()` on stored rules directly.
13. **Files written for the user go in a folder of their own**: a shared `.ics` is written by
    `writeSharedIcs()` into a private `mkdtemp` folder, not straight into the shared temp directory.

---

## Sync Engine Rules

- **Adapters normalize** provider data into the canonical `CalendarEvent` model. Provider-specific JSON must not leak into the renderer.
- **Dirty flag**: events modified locally are marked `dirty = 1` in SQLite. The sync engine pushes dirty events before pulling.
- **Conflict strategy**: last-write-wins guarded by `If-Match`. A 412 sets `has_conflict = 1`; the row leaves the push set until the user resolves it in the conflicts dialog. Never overwrite silently.
- **Adaptive poll interval**: 20 seconds when the main window is focused; 5 minutes when blurred/minimized. Controlled via `SyncWorker.setFocusState()`.
- **Guest lists**: push an event's attendees only when `attendees_synced = 1` or the event has never been pushed. An empty list that was simply never fetched would remove every guest from the meeting.
- **Reminders**: a pull merges with `mergePulledReminders()` so the parts of a local list a provider cannot hold (Graph keeps one reminder) survive the round trip.
- **Replies**: an invitation reply waits in `rsvp_pending` and travels on its own path (Google guest-list PATCH, Graph accept/decline, CalDAV PUT), not through `dirty`.

---

## i18n Rules

- All user-visible strings go through i18next. Never hardcode English strings in JSX.
- Translation keys live in `src/renderer/src/i18n/index.ts`.
- A new profile's language, clock and first day of the week follow the computer
  (`defaultsForSystem()` in `src/shared/locale-defaults.ts`, applied in the main process by
  `setSystemDefaults()`); a setting the user has chosen wins. A profile already in use keeps the
  values it showed (`settleExistingProfile()` in `src/main/first-run.ts`).
- Both `vi` and `en` namespaces must be kept in sync. `tests/i18n-parity.test.ts` checks that,
  and that every `t('literal.key')` in the renderer names a key that exists - a missing one renders
  as the raw key.

---

## Testing Standards

- **Test framework:** Vitest.
- **Coverage targets:** lunar/recurrence logic (must have golden tests), event mappers, SQLite repos.
- **Test location:** `tests/` at project root. Mirrors source module name (`events-repo.test.ts` for `src/main/db/repos/events-repo.ts`).
- **Database tests:** use `:memory:` SQLite via `initDatabase(':memory:')`.
- **No external network calls** in unit tests. Mock provider HTTP responses.

---

## Git & Branch Conventions

- Commit messages follow `type(scope): brief description` - `feat(sync): …`, `fix(dnd): …`,
  `chore: …`, `docs(readme): …`.
- Releases: bump `version` in `package.json`, then push a `v<version>` tag; the release workflow
  builds a draft GitHub release to review and publish.
