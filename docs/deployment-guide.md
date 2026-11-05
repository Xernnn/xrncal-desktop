# xrncal — Deployment Guide

**Last updated:** 2026-10-27

---

## Prerequisites

- Node.js 23.4+ (24 recommended, as CI uses) - the database tests need the built-in `node:sqlite`
- npm 10+
- Git

---

## Development Setup

```bash
# Clone the repository
git clone https://github.com/Xernnn/xrncal-desktop
cd xrncal-desktop

# Install dependencies
npm install

# Start the Electron dev app (hot-reload via electron-vite)
npm run dev
```

The dev server starts the Electron app with Vite HMR for the renderer process.

---

## Type Checking

```bash
# Check both main process and renderer
npm run typecheck

# Check individually
npm run typecheck:node   # Main + preload (tsconfig.node.json)
npm run typecheck:web    # Renderer (tsconfig.web.json)
```

---

## Running Tests

```bash
npm run test
# Runs: vitest run (the whole suite, ~950 tests)
```

Test files live in `tests/` at the project root and use `:memory:` SQLite for database tests.
Main-process tests import a stub `electron` module (`tests/stubs/electron.ts`, aliased in
`vitest.config.ts`), so the Electron binary is not required to run them.

### UI tests

```bash
npm run test:e2e
# Runs: npm run build && playwright test
```

`e2e/` drives the built app through Playwright's Electron support: it launches
`out/main/index.js` on a throwaway profile (`XRNCAL_USER_DATA_DIR`, which `src/main/index.ts`
honours outside a packaged build, before taking the single-instance lock, so a running copy of
xrncal is neither touched nor in the way) with `TZ=Asia/Ho_Chi_Minh` and an `en_GB` locale (a new
profile takes its clock and first day of the week from the computer), and checks a fresh start and the first-run welcome,
the settings IPC, search without diacritics, an edit in another time zone, creating and opening
an event from the grid, the editor's own time step, the right-click menu, the zone an event saved
without one opens in, a change of the computer's zone being recorded, keyboard commands with undo, a setting surviving a
relaunch, a sync landing mid-edit, dates read from a new event's title, saving the week and month as one-page PDFs, entering sign-in
details in the app, and that
closing the window leaves the app in the tray. `launchApp()` marks the welcome done unless a test passes `{ welcome: true }`. These need
the real Electron binary and a display; on a Linux machine without one, run them under
`xvfb-run -a`.

### CalDAV against a real server

```bash
pip install radicale        # or: XRNCAL_RADICALE=/path/to/venv/bin/radicale
npm run test:caldav
# Runs: vitest run --config vitest.integration.config.ts
```

`tests/integration/` connects to a real Radicale that `radicale-server.ts` starts on a free local
port with a throwaway store, and goes through the app's own code: the connect handler (from the
server address alone), then `CalDavSyncEngine.syncAll()` as each poll runs it. It checks an event made
here reaching the server with its zone, reminder and Vietnamese text, edits each way, an event another
client created under a name of its own, deletions each way, a series with a moved and a deleted week
as a second computer reads it back, undoing that delete, a conflict, and that an unchanged calendar
costs one PROPFIND. `npm run test` leaves it out: unit tests need no network. Set
`XRNCAL_RADICALE_LOG=info` to see what the server makes of each request (and the body of any PUT it
refuses).

---

## Continuous Integration

`.github/workflows/ci.yml` runs on every push to `main` and every pull request:

1. `npm ci` (with `ELECTRON_SKIP_BINARY_DOWNLOAD=1` — CI does not package the app)
2. `npm run lint` — ESLint with `--max-warnings 0`, so a warning fails it too
3. `npm run typecheck` — main + renderer
4. `npm run test` — full Vitest suite
5. `npm run build` — production bundle

A second job, `ui`, installs Electron and runs `xvfb-run -a npm run test:e2e`. A third, `caldav`,
installs Radicale 3.9 in a virtualenv and runs `npm run test:caldav`.

---

## Releases and In-App Updates

### Release checklist

What an official, user-ready release needs, in order. The first three are one-off setup in
accounts only the maintainer has; the rest is per release.

1. **Google sign-in** - [OAuth for an official build](#oauth-for-an-official-build), Google part:
   add the two `XRNCAL_GOOGLE_*` secrets, then publish the consent screen and send the app for
   verification. Until Google verifies it, users see an "unverified app" warning and at most 100
   of them can sign in.
2. **Microsoft sign-in** - same section, Microsoft part: register a public client and add
   `XRNCAL_MICROSOFT_CLIENT_ID`.
3. **Windows signing** - [Code signing](#code-signing). Optional, but without it SmartScreen
   warns on every download.
4. Bump `version` in `package.json`, commit, tag `v<version>` and push the tag.
5. Wait for the Release workflow, install the draft's artifacts on Windows and Linux, sign in to
   Google and Microsoft with them, then publish the draft. Publishing is what installed copies
   update from.

`.github/workflows/release.yml` runs on a pushed `v*` tag:

1. Checks the tag equals `v` + `package.json`'s `version` (electron-builder names the release
   after `package.json`, so a mismatch would publish under the wrong version).
2. Lint, typecheck and tests.
3. On `windows-latest` and `ubuntu-latest`: `npm run build` (with the OAuth secrets, see below), then
   `electron-builder --publish always`, which uploads the NSIS installer, the AppImage and the
   `latest.yml` / `latest-linux.yml` files to a **draft** release (`publish` in
   `electron-builder.yml`, authenticated by the workflow's `GITHUB_TOKEN`).

To ship:

```bash
npm version 0.2.0 --no-git-tag-version   # or edit package.json by hand
git commit -am "chore: release 0.2.0"
git tag v0.2.0 && git push origin main v0.2.0
# then review and publish the draft on GitHub
```

Installed builds check the published releases every six hours (`src/main/updater.ts`), download
a newer one in the background and install it when the app quits. Only packaged builds update, and
on Linux only the AppImage; the **Check for updates** setting turns it off.

### OAuth for an official build

A build signs in to Google and Microsoft only if it knows an OAuth client. The release workflow
passes three repository secrets to `npm run build`, and `electron.vite.config.ts` bakes them into
the main process; `src/main/load-credentials.ts` falls back to them when the environment and the
`xrncal.env` files name none. A build without them still works - local calendars, CalDAV,
iCloud and subscriptions - and Google and Microsoft lead to a form for a client of the user's own
(next section) instead of failing after the browser opens.

Shipping these in the app is how desktop OAuth works: Google's documentation says an installed
app's client secret is not treated as a secret, and a Microsoft public client has none. What
protects users is the consent screen and PKCE, not the id.

Add them in **Settings → Secrets and variables → Actions → Secrets**:

| Secret | Value |
|--------|-------|
| `XRNCAL_GOOGLE_CLIENT_ID` | The Desktop client's id (`…apps.googleusercontent.com`) |
| `XRNCAL_GOOGLE_CLIENT_SECRET` | The same client's secret (`GOCSPX-…`) |
| `XRNCAL_MICROSOFT_CLIENT_ID` | The Entra app's *Application (client) ID* |

**Google**

1. In the [Google Cloud Console](https://console.cloud.google.com/), use the project that already
   holds the Desktop client (the one in your own `xrncal.env`), or create one, and enable the
   **Google Calendar API**.
2. **OAuth consent screen** (Google Auth Platform → Branding): app name `xrncal`, the support
   email, the app logo (`resources/icon.png`), home page
   `https://xernnn.github.io/xrncal-desktop/` and privacy policy
   `https://xernnn.github.io/xrncal-desktop/privacy.html` - both are served from `site/` by the
   Pages workflow. Add `xernnn.github.io` as an authorised domain.
3. **Data access**: the scopes the app asks for - `…/auth/calendar`, `openid`, `email`,
   `profile`. `calendar` is a *sensitive* scope, so publishing needs verification.
4. **Audience**: switch from *Testing* to *In production*, then **Verification centre** →
   submit. Google asks for a justification of the scope (two-way sync of the user's calendars
   in a desktop app) and a short YouTube video of the sign-in, showing the consent screen and
   the calendar appearing in xrncal. Verification usually takes a few days to a few weeks; the
   homepage domain has to be verified in Search Console first (an HTML file in `site/` does it).
5. **Clients**: the existing *Desktop app* client works as it is - loopback redirects need no
   registration. Put its id and secret in the two secrets above.

**Microsoft**

1. In the [Entra admin centre](https://entra.microsoft.com/) → App registrations → New
   registration: name `xrncal`; supported account types *Accounts in any organizational
   directory and personal Microsoft accounts*; redirect URI platform *Public client/native
   (mobile & desktop)* with `http://localhost/oauth2callback`. The app sends
   `http://localhost:<port>/oauth2callback`: Microsoft ignores a `localhost` port but not the path,
   and its portal will not take an `http://127.0.0.1` address.
2. **Authentication** → *Allow public client flows*: **Yes**. No client secret: the app uses
   the authorization-code flow with PKCE (`src/main/oauth/microsoft-oauth.ts`).
3. **API permissions** → Microsoft Graph, delegated: `Calendars.ReadWrite`, `User.Read`,
   `offline_access`. None needs admin consent.
4. Optional but worth it: **Branding & properties** → publisher verification with a Microsoft
   Partner Network id. Without it the consent screen says "unverified", and some work tenants
   do not let users consent to unverified multi-tenant apps.
5. Put the *Application (client) ID* in `XRNCAL_MICROSOFT_CLIENT_ID`.

### A build without a client

Nobody has to edit a file to sign in. With no client, **Add account** and the welcome mark Google
and Microsoft "Set up once, then sign in", and their page is `OAuthClientSetup`: the steps with a
link for each, and fields for the details, which take effect at once. Saved details are encrypted
with `safeStorage` under `oauth-client:<provider>`, like a token; without a keyring the form says
so and stores nothing. The secret is write-only: the renderer can learn the id and whether a secret
exists, never the secret (`oauthClientInfo()`). Saved details come before everything in
`load-credentials.ts`, and removing them falls back to it.

What the form cannot do is make this easy: the person still goes through Google Cloud or Azure,
Google warns that the app is unverified, and a personal Microsoft account needs a free Azure account
first (app registrations have needed a directory since June 2024). Baking a client into the release,
as above, is what makes sign-in work with no setup at all.

Refresh tokens belong to the client that issued them, so accounts connected under other details have
to sign in again after a change; the form says so when there are any.

### Code signing

Unsigned, the Windows installer makes SmartScreen ask before the first run, and nothing ties an
update to its publisher. The release workflow signs it as soon as one of these is set up in the
repository's **Settings → Secrets and variables → Actions** (until then it builds unsigned):

- **Azure Trusted Signing** (Microsoft's signing service; the usual choice now that new
  certificates come on hardware or cloud keys rather than as files). Create a Trusted Signing
  account and certificate profile, and an app registration with the *Trusted Signing Certificate
  Profile Signer* role. Secrets: `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`.
  Variables: `AZURE_PUBLISHER_NAME` (the certificate's subject CN), `AZURE_ENDPOINT` (e.g.
  `https://eus.codesigning.azure.net`), `AZURE_CODE_SIGNING_ACCOUNT`, `AZURE_CERTIFICATE_PROFILE`.
- **A `.pfx` certificate**: `WIN_CSC_LINK` (the file, base64-encoded) and `WIN_CSC_KEY_PASSWORD`.

Once releases are signed, electron-updater checks each Windows update against the publisher name
before installing it. The AppImage is not signed.

---

## Building for Production

```bash
npm run build
# Outputs to:
#   out/main/index.js       (Electron main process)
#   out/preload/index.js    (contextBridge preload)
#   out/renderer/           (React static bundle)
```

---

## Packaging

### Windows (NSIS x64 Installer)

```bash
npm run pack:win
# Runs: electron-vite build && electron-builder --win --x64
# Output: dist/*.exe (NSIS installer)
```

Requirements:
- Run on Windows or use a CI Windows runner.
- Unsigned when built locally; see [Code signing](#code-signing) for signed release builds.

### Linux (AppImage x64)

```bash
npm run pack:linux
# Runs: electron-vite build && electron-builder --linux AppImage --x64
# Output: dist/*.AppImage
```

**R1 validated target:** Ubuntu LTS + AppImage x64.

To run the AppImage on Linux:
```bash
chmod +x xrncal-*.AppImage
./xrncal-*.AppImage
```

---

## electron-builder Configuration

See [`electron-builder.yml`](../electron-builder.yml) at the project root. Key settings:

- `appId`: `app.xrncal.desktop`
- `productName`: `xrncal`
- `nsis.oneClick`: false (installer shows options)
- `fileAssociations`: `.ics` / `text/calendar` (see Opening .ics Files)
- `files` + `asarUnpack`: the app icon in `resources/`, for the tray and the Linux window icon
- `linux.category`: `Office;Calendar;`
- `linux.target`: AppImage
- `publish`: GitHub, `Xernnn/xrncal-desktop`, as a draft release (see Releases above)

---

## Environment Variables

| Variable | Description |
|----------|-------------|
| `ELECTRON_RENDERER_URL` | Set automatically by electron-vite in dev mode. Points to the Vite dev server. In production, renderer loads `index.html` from disk; an installed build ignores the variable. |
| `XRNCAL_USER_DATA_DIR` | Profile folder for the UI tests (`e2e/`). Unpackaged builds only; an installed build ignores it. |
| `XRNCAL_GOOGLE_CLIENT_ID`, `XRNCAL_GOOGLE_CLIENT_SECRET`, `XRNCAL_MICROSOFT_CLIENT_ID` | **Build time only.** Baked into the build as the fallback client (see [OAuth for an official build](#oauth-for-an-official-build)). |
| `GOOGLE_OAUTH_CLIENT_ID` | Google OAuth Desktop client ID (required for live Google sync). |
| `GOOGLE_OAUTH_CLIENT_SECRET` | Google OAuth Desktop client secret. |
| `MICROSOFT_CLIENT_ID` | Microsoft Entra public-client app ID (required for Microsoft Graph sync). |
| `MICROSOFT_CLIENT_SECRET` | Microsoft client secret (optional; public-client + loopback works without one). |

These are read from `process.env` in `src/main/ipc/auth-sync-ipc.ts`.
`src/main/load-credentials.ts` fills them at startup from the first place that has them -
the environment, then a plain `KEY=VALUE` file, then the ids baked into an official build - and
copies only these four keys out of a file, nothing else in it. The files it checks, in order:

1. `<userData>/xrncal.env` — on Linux, `~/.config/xrncal/xrncal.env`
2. `xrncal.env` next to the executable / AppImage
3. `.env` in the current working directory - **only when run from source**; an installed build
   never reads a `.env` from wherever it happened to be started

Example `~/.config/xrncal/xrncal.env`:

```
GOOGLE_OAUTH_CLIENT_ID=1234567890-abcdef.apps.googleusercontent.com
GOOGLE_OAUTH_CLIENT_SECRET=GOCSPX-xxxxxxxxxxxxxxxx
```

Restart the app after editing. With no client at all, Google and Microsoft lead to the form in
[A build without a client](#a-build-without-a-client) and do not open the browser. Details saved
there come before these.

> **Note:** `.env` is in `.gitignore`. Never commit OAuth credentials. Without these vars
> the app still runs in local + CalDAV mode; only Google/Microsoft sync is disabled.

See `.env.example` for the full list of environment variables.

---

## Google OAuth Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/).
2. Create a project (or use an existing one).
3. Enable the **Google Calendar API**.
4. Create OAuth credentials: **Desktop app** type.
5. Download the client ID and client secret.
6. Enter them in the app, or set `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET` in your
   environment.
7. Add test users in the OAuth consent screen (while in testing mode). For a client that ships in
   releases, see [OAuth for an official build](#oauth-for-an-official-build).

The app uses a loopback redirect URI (`http://127.0.0.1:<random-port>/oauth2callback`) — no redirect URI pre-registration is needed for Desktop app type.

---

## Microsoft Graph OAuth Setup

1. Go to [Azure Portal → Entra](https://portal.azure.com/).
2. Register a new application.
3. Set redirect URI to `http://localhost/oauth2callback` (platform *Public client/native (mobile &
   desktop)*). Microsoft ignores the port of a `localhost` redirect, not its path.
4. Add API permissions: `Calendars.ReadWrite`, `User.Read`, `offline_access`, and turn on
   *Allow public client flows*.
5. Enter it in the app, or set `MICROSOFT_CLIENT_ID` in your environment (or, for releases, the
   `XRNCAL_MICROSOFT_CLIENT_ID` secret - see [OAuth for an official build](#oauth-for-an-official-build)).

`src/main/oauth/microsoft-oauth.ts` implements the auth-code + PKCE loopback flow
directly against `login.microsoftonline.com` (Node `http` + `crypto`, system browser
via `shell.openExternal`) — no `@azure/msal-node` dependency.

---

## Data Storage Locations

| Platform | Path |
|----------|------|
| Windows | `%APPDATA%\xrncal\xrncal.sqlite` |
| Linux | `~/.config/xrncal/xrncal.sqlite` |

Determined by `app.getPath('userData')` in Electron.

OAuth tokens are stored encrypted via `safeStorage` in the same `userData` directory.

---

## Single-Instance Lock

The app enforces a single-instance lock via `app.requestSingleInstanceLock()`. If a second instance is launched, it focuses the existing window and quits immediately.

---

## System Tray, Closing and Starting at Login

On both Windows and Linux, the app creates a system tray icon on startup (the app icon, from
`resources/`, which `electron-builder.yml` ships unpacked from the asar). Its menu: Open xrncal,
Mini window, Quit. A left click opens the mini window on Windows; Linux panels open the menu.

**Closing the window does not quit.** The window is destroyed (and its memory freed), and the
app keeps running in the tray so reminders ring and sync carries on; the first time, a
notification says so. Quit from the tray menu or with Ctrl+Q. With *Keep running when the window
is closed* off in Settings, or with no tray at all, closing the window quits as before.

**Start when I sign in** (Settings → General, and ticked in the first-run welcome) registers the
app to start at login, in the tray, with `--hidden`: on Windows through
`app.setLoginItemSettings`, on Linux by writing `~/.config/autostart/xrncal.desktop` pointing at
the AppImage (`$APPIMAGE`). Installed builds only; it is re-applied on every launch, so a moved
AppImage is followed.

On Linux, tray support depends on the desktop environment (GNOME, KDE). Tray initialization failure is non-fatal — the app continues, and closing the window quits. On GNOME Shell without the AppIndicator extension the tray is created but nothing shows it; xrncal asks the session bus (`src/main/tray-host.ts`) and treats that as no tray.

## Opening .ics Files

`electron-builder.yml` registers `.ics` (`text/calendar`) with the installer on Windows and in
the AppImage's desktop entry; `scripts/install-linux-app.sh` adds the MIME type to the launcher it
writes. A file opened with xrncal arrives in `argv` - at launch, or through `second-instance`
when it is already running - and `src/main/opened-ics-files.ts` holds it until the window
collects it and asks which calendar to import into. Files can also be dropped on the window, or
picked in Settings → *Import .ics file…*.

---

## Linux Notes

- **Notifications:** Uses Electron's `Notification` API (backed by `libnotify` / DBus). Works on GNOME and KDE.
- **Tray:** Works on KDE out of the box. On GNOME, requires the AppIndicator extension (`gnome-shell-extension-appindicator`) or equivalent; without it, closing the window quits instead of hiding to an invisible tray, and launch at login opens the window.
- **safeStorage:** Backed by `libsecret` (Secret Service API). On headless environments without a keyring, the app will refuse to persist OAuth tokens and display a visible error. It will not silently fall back to plaintext storage.
- **AppImage:** The packaged AppImage is self-contained. Run with `--no-sandbox` if needed in restricted environments (not recommended for production use).
