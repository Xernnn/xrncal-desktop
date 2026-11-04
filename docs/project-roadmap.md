# xrncal — Project Roadmap

**Last updated:** 2026-10-20  
**Current version:** 0.2.0 (in package.json; not yet released)

---

## Current State

All 10 planned phases are **complete**. The codebase ships R1 + R2 + R3 + Stretch capabilities in version 0.1.0.

| Phase | Name | Status |
|-------|------|--------|
| 1 | Scaffold Electron + Vite + React + TypeScript | ✅ Complete |
| 2 | Domain, SQLite, ICS, Recurrence | ✅ Complete |
| 3 | Custom Views, Lunar, Week Numbers | ✅ Complete |
| 4 | Event Editor and Drag-and-Drop | ✅ Complete |
| 5 | Google Sync, Offline, Notifications | ✅ Complete — **R1 gate** |
| 6 | Microsoft Graph Adapter | ✅ Complete |
| 7 | CalDAV Adapter and Onboarding | ✅ Complete |
| 8 | Invite, Share, Search, Filters | ✅ Complete — **R2 gate** |
| 9 | Mini Window, Local Tasks, Deep Theme | ✅ Complete — **R3 gate** |
| 10 | Stretch: A11y, Adaptive Sync, Holidays | ✅ Complete |

---

## R1 Features (Complete)

- ✅ Five calendar views: Day, Week, Month, Year, List
- ✅ Full event editor on blank click (not a title-only popover)
- ✅ Create / edit / delete events with full field set
- ✅ Recurring event create + edit (this / this-and-future / all)
- ✅ Drag-and-drop with Move / Copy / Cancel popover
- ✅ Week numbers (ISO, toggle in settings)
- ✅ Vietnamese lunar secondary labels (toggle)
- ✅ Google Calendar OAuth + two-way sync
- ✅ Offline: browse and mutate local cache; sync when online
- ✅ OS notifications for reminders (Windows + Linux)
- ✅ Show/hide calendars; color per calendar; optional color per event
- ✅ Light / dark / system theme
- ✅ UI language vi + en

## R2 Features (Complete)

- ✅ Microsoft Graph (Outlook.com / Microsoft 365) two-way sync
- ✅ CalDAV: Nextcloud, Synology, generic URL — discovery + two-way sync
- ✅ Guest lists sync with all three providers; reply Yes / Maybe / No to invitations (added 2026-10)
- ✅ Share appointment: export `.ics` + OS open-with flow
- ✅ Full-text search across cached events (FTS5)
- ✅ Birthday calendars via provider (when exposed)
- ✅ Filter events by calendar color

## R3 Features (Complete)

- ✅ Mini window: always-on-top tray companion with upcoming events
- ~~Local tasks~~ — built, then removed (migration 005); not planned to return
- ✅ Deep theme: accent colors, custom wallpaper, blur + darkness overlay

## Stretch Features (Complete)

- ✅ Global keyboard shortcuts (T=today, 1–5=views, N/C=new, /=search, ?=help)
- ✅ Adaptive sync polling (20s focused / 5m blurred)
- ✅ Vietnamese and International holiday calendar subscriptions
- ✅ Copy single recurring instance (separate from full-series copy)

## Added after 0.1.0 (2026-10)

- ✅ **Reminders:** a list per event, defaults for timed and all-day events, synced with Google
  (`reminders`), Graph (one reminder) and CalDAV (`VALARM`); all-day reminders such as "the day
  before at 09:00", which new lunar anniversaries start with; an in-app list to snooze, join the
  meeting or dismiss. Declined invitations and read-only calendars do not ring by default.
- ✅ **Invitation replies:** guest lists pulled and pushed for all providers; Yes / Maybe / No
  delivered through Google's guest list, Graph's accept/decline actions, or CalDAV PARTSTAT.
- ✅ **Subscriptions by link:** read-only calendars from an `.ics` / `webcal://` feed, refreshed
  every six hours.
- ✅ **Undo:** `Ctrl+Z` for moves, resizes, copies and deletes; an Undo button on the delete toast.
- ✅ **Releases and updates:** tag-triggered release workflow (draft GitHub release, Windows NSIS +
  Linux AppImage) and in-app updates via `electron-updater`, behind a setting.
- ✅ **Fixes:** Microsoft sync now removes events deleted in Outlook and skips unchanged rows;
  holiday calendars extend themselves as years pass; clicking a reminder opens the main window
  even after it was closed to the tray; editing an event opened from the grid no longer deletes
  its guests; CalDAV pulls keep meeting links and colours.
- ✅ **Search that works:** the full-text index never matched (it was built contentless) and slowed
  every write; rebuilt, it now also finds words without their diacritics ("hop" finds "họp").
- ✅ **Sync robustness:** CalDAV pulls download only the events whose etag changed; an edit here
  keeps what other CalDAV clients stored on the event; each account shows why its sync failed;
  a stalled response body can no longer stop sync until restart.
- ✅ **Outlook times:** clock time in a zone Graph accepts, the organiser's zone kept on pull, and
  full notes instead of the 255-character preview.
- ✅ **Editor:** an event's own time zone and colour; all-day dates no longer move a day west of UTC.
- ✅ **Reminders:** snoozes and cards on screen survive a restart.
- ✅ **UI tests and signing:** Playwright drives the built app in CI; the release workflow signs the
  Windows installer once a certificate (Azure Trusted Signing or `.pfx`) is configured.

---

## 0.2.0 - ready for everyday use (2026-10)

Built to make xrncal usable by someone who is not its developer:

- ✅ **Header:** always shown, with Create, the month in Week view and Settings as a gear; weekday
  names on Week view's columns.
- ✅ **Right-click menus** (PDR-011): edit, duplicate or delete an event, or start one on a day. A
  click on a slot or an event still opens the full editor.
- ✅ **The editor's time lists have their own step** (15 / 30 / 60 minutes), apart from the step
  drag and resize snap to.
- ✅ **Events saved without a time zone** (Google's export writes every one-off event as a bare UTC
  time) no longer open in UTC: they take the zone the user was in on their date (Settings →
  *Where you were*), else this computer's. When the computer's zone changes, xrncal adds the move
  there by itself and redraws the views in the new zone.
- ✅ **Security review (2026-10-20):** IPC requests accepted only from the app's own page; the
  tray window locked down like the main one and navigation limited to the app's `index.html`;
  browser permissions denied; CalDAV passwords sent only to the account's own server (a server
  could name another host for an href); sign-in pages escape what they show, keep waiting after
  a stray request instead of failing, and no longer invent an account when the profile cannot be
  read; Linux notifications escape event text; Electron fuses and a debugging-port refusal in
  packaged builds; `basic_text` refused as encryption; CI's token read-only. Server colours are
  now read (they were requested in the wrong namespace) and validated.
- ✅ **CalDAV repeating series fixed:** an all-day series read from a CalDAV server (zone
  `floating`) showed only its first occurrence - 131 of one user's 200 series, birthdays and
  payments among them. One week of an all-day series moved to a time of day showed as all-day, and
  any edit here wrote every such week back to the server as all-day; the moved week now keeps its
  own all-day flag both ways (migration 022 repairs the rows already stored).
- ✅ **Events keep their zone on the way out:** CalDAV pushes and `.ics` exports write timed
  events in their own zone with a VTIMEZONE built from the zone database, instead of as UTC - an
  event made here no longer comes back from the server zone-less, and a weekly series no longer
  moves by an hour on other clients when summer time changes.
- ✅ **Runs in the tray** when the window is closed, can **start at sign-in**, and Ctrl+Q quits
  (PDR-012). The tray icon now actually draws (it was a blank SVG decode) and its menu works on
  Linux.
- ✅ **"Today" follows the clock:** the today mark and the current-time line move on their own,
  across midnight.
- ✅ **First-run welcome:** language, lunar dates, holidays, start at sign-in, connect calendars.
- ✅ **Follows the computer:** a new profile takes its language, 12/24-hour clock, first day of
  the week and light/dark theme from the system; weeks can start on Monday, Sunday or Saturday.
  An existing profile keeps what it showed.
- ✅ **.ics in and out:** import from Settings, by dropping files on the window or "Open with
  xrncal" (registered by the installers); export any calendar.
- ✅ **Restore from backup**, alongside backup.
- ✅ **Automatic backups** (2026-11): a weekly snapshot into the profile's `backups` folder, the
  newest four kept; restore opens there. Every backup is created readable by its owner only (one
  saved to Documents used to be readable by every user of the computer).
- ✅ **A log file** (2026-11): `logs/xrncal.log` in the profile, with sync failures and
  recoveries, backups, update errors and crashes, secrets redacted; Settings → *Show log file*.
- ✅ **GNOME without the AppIndicator extension** (2026-11): the tray is known to be invisible
  there, so closing the window quits instead of leaving an app nobody can reach.
- ✅ **Electron 44.10.1** (2026-11): 44.9.0 carried advisory GHSA-jr5w-w6x2-84p9 (trust in
  compromised eMudhra intermediate certificates).
- ✅ **Outlook occurrence changes** (2026-11): an occurrence moved, edited or cancelled in
  Outlook shows that way here. Graph's listing holds series only, so each series is read for its
  changed and cancelled occurrences when it changes, and every six hours.
- ✅ **One CalDAV account per user** (2026-11): every account on an https server was stored under
  one id, so adding a second replaced the first one's password. Accounts already merged that way
  are separated the next time either is connected.
- ✅ **Type the when into the title** (2026-11): "Họp 3h chiều thứ 6", "Lunch tomorrow at
  12:30", "Giỗ ông 12/8 âm lịch" fill a new event's date, time and repeat (or lunar
  anniversary), in Vietnamese and English, and the title is saved without them.
- ✅ **Print or save as PDF** (2026-11): `Ctrl+P` prints the week or month on one A4 landscape
  page, with lunar dates, on paper colours whatever the theme.
- ✅ **Deleting one week of a CalDAV series** (2026-11): the deleted week went up as a
  cancelled override with no start, which the server refused, so the whole series stopped
  syncing; it now goes up as an `EXDATE`, and undoing the delete works after the sync. Found by
  the new CI job that syncs with a real Radicale server.
- ✅ **Sign-in ready for release builds:** OAuth client ids baked in from repository secrets; a
  build without them says so instead of failing in the browser. The credentials file accepts only
  the four sign-in keys, and installed builds no longer read a `.env` from the working directory.
- ✅ **Fixes:** the sync-conflict screen showed raw translation keys (its strings had been dropped;
  a test now fails on any missing key); pickers and menus ignored a custom accent colour; the
  Inter font is bundled instead of fetched from Google; Windows notifications carry the app's
  AppUserModelID.

**To release 0.2.0** (maintainer accounts; see the checklist in `docs/deployment-guide.md`):
add the `XRNCAL_GOOGLE_*` / `XRNCAL_MICROSOFT_CLIENT_ID` secrets, publish and verify the Google
consent screen, register the Microsoft public client, optionally set up Windows signing, then tag
`v0.2.0` and publish the draft.

## Open Items / Known Gaps

These are non-blocking items that remain for post-0.1.0:

### Must Validate Before "Daily Driver" Gate

- [ ] **Live Google OAuth round-trip from a release build** — sign-in works with the maintainer's own client; it has to be tried from the 0.2.0 installers built with the release secrets, and Google's verification of the consent screen is pending.
- [ ] **Microsoft sign-in from a release build** — needs the public-client registration first.
- [x] **Close-to-tray on GNOME without the AppIndicator extension** — detected through the session bus (`tray-host.ts`); closing the window quits there. Still to try on a real GNOME session with and without the extension.
- [ ] **Linux `safeStorage` validation** — Verify fail-closed behavior on a headless Ubuntu environment where D-Bus / libsecret is unavailable.

### Known Deferrals (URD-tracked)

- [ ] **iCloud CalDAV** — Best-effort in R2. Known Apple non-standard behavior. Nextcloud/generic are the R2 Must targets.
- [ ] **Fedora / `.deb` packaging** — Deferred post-R1. Ubuntu LTS + AppImage is the only validated Linux package.
- [ ] **Linux distro matrix** — Full xdg desktop integration tested on Ubuntu LTS only.

### Open Architecture Questions (URD §15)

- [ ] Google OAuth client: published app vs testing-mode quota.
- [ ] Whether R1 Google sync includes Google Tasks, birthdays, and holidays calendars as read-only.
- [ ] Recurring copy: keep "whole series" as permanent behavior, or add "this instance only" promotion in R2 (already implemented as stretch).

---

## Post-0.1.0 Candidates

The following ideas are outside the current URD scope and require a URD change before planning:

| Idea | Notes |
|------|-------|
| macOS support | Out of scope (URD §6). Electron supports it; requires separate packager config and safeStorage behavior check. |
| Near-real-time sync (push) | Google / Graph push notifications via webhooks; currently polling-only. |
| Multi-year cache expansion | Currently pulls a bounded window. Full history requires a configurable cache depth. |
| `.deb` / Fedora RPM packaging | Follow-on after AppImage is validated. |
| CalDAV self-signed TLS UI | Planned in the URD, never implemented: self-signed servers are simply refused by Node's TLS. |
| Code signing | The release workflow signs once a certificate is configured (`docs/deployment-guide.md`); none is yet, so SmartScreen still warns. |
| Per-occurrence reminders | Reminders belong to the series; a `this`-scoped reminder change applies to all occurrences. |
| Moving an Outlook event between calendars | Graph has no move endpoint and the push does not recreate the event, so it returns to its original calendar at the next full listing (it used to leave a duplicate). |

---

## Versioning Plan

| Version | Milestone |
|---------|-----------|
| 0.1.0 | All 10 phases complete. R1+R2+R3+Stretch in codebase. |
| 0.2.0 | First published release: everything above plus the everyday-use work (tray, welcome, right-click menus, sign-in in official builds), live Google and Microsoft OAuth tested from the installers. "Daily driver" gate. |
| 0.3.0 | iCloud CalDAV best-effort validated. Fedora AppImage. |
| 1.0.0 | Stable release after daily driver validation on both OS targets. |
