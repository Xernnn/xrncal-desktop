import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { passwordStoreSwitch } from './password-store'
import { registerIpcHandlers } from './ipc'
import { loadCredentialsFile } from './load-credentials'
import { adoptLegacyUserDataForApp } from './adopt-legacy-userdata'
import { initDatabase, closeDatabase, getDatabase } from './db/database'
import { SettingsRepo, setSystemDefaults } from './db/repos/settings-repo'
import { hasTray, refreshTrayHost, setupTray } from './tray'
import { initLog, log } from './log'
import { startAutoBackups } from './auto-backup'
import { describeError } from './sync/http'
import { registerMiniIpcHandlers } from './mini-window'
import { registerReminderIpcHandlers } from './ipc/reminders-ipc'
import { getSyncWorker } from './ipc/auth-sync-ipc'
import { denyUnusedPermissions, devServerUrl, guardIpcSenders, lockDownContents } from './web-contents-guard'
import { refreshHolidayCalendars } from './holidays/holiday-subscription'
import { startAutoUpdates } from './updater'
import { defaultsForSystem } from '@shared/locale-defaults'
import { IPC_CHANNELS } from '@shared/ipc-contract'
import { applySavedSettingEffects } from './setting-effects'
import { windowBackground } from './window-background'
import { APP_ICON_PNG } from './app-icon'
import { START_HIDDEN_ARG } from './launch-at-login'
import { noticeRunningInTray, settleExistingProfile } from './first-run'
import { icsPathsIn, queueOpenedFiles, setOpenedFileNotifier } from './opened-ics-files'

// The UI tests (e2e/) run the app on a throwaway profile. The single-instance
// lock and the database both live in it, so a test run neither touches the real
// profile nor quits because the installed app is already running. They run the
// unpackaged build; an installed one keeps its profile where it belongs.
if (!app.isPackaged && process.env.XRNCAL_USER_DATA_DIR) app.setPath('userData', process.env.XRNCAL_USER_DATA_DIR)

// Windows credits a notification to the app whose AppUserModelID it carries,
// and the installer's Start-menu shortcut is registered under the appId
// (electron-builder.yml). Without the same id here, reminders could be shown
// under a generic Electron name or not at all.
if (process.platform === 'win32') app.setAppUserModelId('app.xrncal.desktop')

// An installed build will not run with a debugging port or inspector open:
// either would let any program running as the user drive the window that
// holds the bridge to every calendar and the saved sign-ins. (The build's
// fuses already ignore --inspect; this covers Chromium's own switches.)
if (app.isPackaged && ['remote-debugging-port', 'remote-debugging-pipe', 'inspect', 'inspect-brk'].some((s) => app.commandLine.hasSwitch(s))) {
  app.exit(1)
}

// Save passwords to the system keyring on desktops Electron doesn't recognise (Hyprland and
// other Wayland compositors), where it would otherwise fall back to basic_text and refuse.
const passwordStore = passwordStoreSwitch(process.platform, process.env.XDG_CURRENT_DESKTOP, (s) => app.commandLine.hasSwitch(s))
if (passwordStore) app.commandLine.appendSwitch('password-store', passwordStore)

// Enforce single instance lock
const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  app.quit()
} else {
  let mainWindow: BrowserWindow | null = null
  // Set once a real quit has begun (tray menu, Ctrl+Q, an update), so the
  // window closing on the way out is not mistaken for "hide in the tray".
  let isQuitting = false

  /** Whether closing the window should leave the app running in the tray. */
  function keepsRunningWhenClosed(): boolean {
    if (!hasTray()) return false
    try {
      return new SettingsRepo(getDatabase()).getSetting('closeToTray')
    } catch {
      return true
    }
  }

  function createWindow(): void {
    mainWindow = new BrowserWindow({
      width: 1240,
      height: 820,
      minWidth: 860,
      minHeight: 580,
      show: false,
      autoHideMenuBar: true,
      // In the theme the renderer is about to draw, so it opens without a flash.
      backgroundColor: windowBackground(),
      // Linux shows this in the dock and window switcher when the app was not
      // started from its .desktop entry (a bare AppImage); Windows takes the exe's.
      ...(process.platform === 'linux' ? { icon: APP_ICON_PNG } : {}),
      title: 'xrncal',
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true
      }
    })

    mainWindow.on('ready-to-show', () => {
      mainWindow?.show()
    })

    // Closing the window destroys it (its memory goes with it), but the app
    // carries on in the tray so reminders and sync keep running - the usual
    // calendar-app behaviour, and the only one under which a reminder can ring
    // with the window shut. Forget the dead window so the next request builds a
    // new one instead of calling into a destroyed object. Without a tray, or
    // with the setting off, closing the window quits as it used to.
    mainWindow.on('closed', () => {
      mainWindow = null
      if (isQuitting) return
      if (keepsRunningWhenClosed()) {
        try {
          noticeRunningInTray(getDatabase())
        } catch {
          // No database: no notice, the app still runs.
        }
        return
      }
      app.quit()
    })

    // Adaptive sync polling on focus/blur; also sync right away when the user comes back
    mainWindow.on('focus', () => {
      // GNOME's tray extension may have been turned on or off since.
      void refreshTrayHost()
      const worker = getSyncWorker()
      worker?.setFocusState(true)
      worker?.triggerSync().catch(() => {})
    })

    mainWindow.on('blur', () => {
      getSyncWorker()?.setFocusState(false)
    })

    // Links open in the browser (web and mail addresses only: event text comes
    // from providers, and openExternal launches whatever handles a scheme), and
    // nothing navigates the window away from the app, which would leave the
    // preload bridge in a page that is not ours.
    lockDownContents(mainWindow.webContents)

    // Load URL in dev or index.html in production
    const devServer = devServerUrl()
    if (devServer) {
      mainWindow.loadURL(devServer)
    } else {
      mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
    }
  }

  /**
   * Bring the main window to the front, building a new one if it was closed.
   * Everything that means "open xrncal" goes through here: launching it again,
   * the tray's Open item and the mini window's button. Each used to poke the
   * first window it was given; once that window had been closed while the tray
   * kept the app alive, launching threw "Object has been destroyed" in a modal
   * error box and the tray item silently did nothing - the app was stuck until
   * it was killed.
   */
  function showMainWindow(): void {
    if (!mainWindow || mainWindow.isDestroyed()) {
      createWindow()
      return // shown on ready-to-show
    }
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  }

  // Launching again while running opens the existing app instead of a second
  // copy - and hands over any .ics file it was asked to open.
  app.on('second-instance', (_event, argv) => {
    showMainWindow()
    queueOpenedFiles(icsPathsIn(argv))
  })

  setOpenedFileNotifier(() => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(IPC_CHANNELS.ICS.FILE_OPENED)
  })

  app.on('before-quit', () => {
    isQuitting = true
  })

  app.whenReady().then(async () => {
    initLog(join(app.getPath('userData'), 'logs'))
    log(
      'info',
      `xrncal ${app.getVersion()} starting (${process.platform} ${process.arch}, Electron ${process.versions.electron}${app.isPackaged ? '' : ', unpackaged'})`
    )
    logCrashes()

    adoptLegacyUserDataForApp()
    loadCredentialsFile()
    // A setting nobody has chosen follows the computer: its language when the
    // app has it, its clock, the day its weeks start on.
    setSystemDefaults(defaultsForSystem(app.getPreferredSystemLanguages()[0], app.getSystemLocale()))

    try {
      const db = initDatabase(app.getPath('userData'))
      refreshHolidayCalendars(db)
      settleExistingProfile(db)
    } catch (err) {
      // The window still opens; anything that needs the database fails visibly on its own.
      log('error', `The database could not be opened: ${describeError(err)}`)
    }
    applySavedSettingEffects()

    // Before any handler: every request must come from the app's own page.
    guardIpcSenders()
    denyUnusedPermissions()
    registerIpcHandlers()
    registerMiniIpcHandlers(showMainWindow)
    registerReminderIpcHandlers(showMainWindow)
    try {
      setupTray(showMainWindow)
    } catch {
      // No system tray on this desktop - the app runs without one.
    }

    // Started by the login entry: stay in the tray, where reminders still
    // ring, unless there is no tray to come back from - or one GNOME does not
    // show (asked first; elsewhere this answers at once).
    await refreshTrayHost()
    if (!(process.argv.includes(START_HIDDEN_ARG) && hasTray())) createWindow()
    queueOpenedFiles(icsPathsIn(process.argv.slice(1)))

    app.on('activate', () => showMainWindow())
    startAutoUpdates()
    startAutoBackups(app.getPath('userData'))
  })

  /** Into the log: a window's page that died, a helper process that crashed,
   *  and a promise rejected with nobody to catch it - each otherwise leaves
   *  no trace in an installed build. */
  function logCrashes(): void {
    app.on('render-process-gone', (_event, contents, details) => {
      log('error', `A window stopped (${details.reason}, exit code ${details.exitCode}): ${contents.getURL().split('#')[0]}`)
    })
    app.on('child-process-gone', (_event, details) => {
      if (details.reason === 'clean-exit') return
      log('error', `The ${details.type} process stopped (${details.reason}, exit code ${details.exitCode})`)
    })
    process.on('unhandledRejection', (reason) => {
      console.error('Unhandled rejection:', reason)
      log('error', `Unhandled rejection: ${reason instanceof Error ? (reason.stack ?? describeError(reason)) : String(reason)}`)
    })
  }

  // Closing windows never quits by itself: the main window's 'closed' handler
  // decides (tray or quit), and a hidden mini window must not keep a quit from
  // happening or cause one. Electron quits on its own unless this is handled.
  app.on('window-all-closed', () => {})

  app.on('will-quit', () => {
    closeDatabase()
  })
}
