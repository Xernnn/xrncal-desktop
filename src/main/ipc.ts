import { app, ipcMain, dialog, BrowserWindow, shell } from 'electron'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { IPC_CHANNELS, type AppLocale, type BackupResult } from '@shared/ipc-contract'
import { registerCalendarIpcHandlers } from './ipc/calendar-ipc'
import { registerSettingsIpcHandlers } from './ipc/settings-ipc'
import { registerAuthSyncIpcHandlers } from './ipc/auth-sync-ipc'
import { registerHolidayIpcHandlers } from './ipc/holiday-ipc'
import { registerSubscriptionIpcHandlers } from './ipc/subscriptions-ipc'
import { registerPrintIpcHandlers } from './ipc/print-ipc'
import { setMainLocale, loadMainLocaleFromDb, getMainLocale } from './i18n-main'
import { getDatabase } from './db/database'
import { backupDatabaseTo, defaultBackupFileName } from './db/backup'
import { restoreDatabaseFromBackup } from './restore-database'
import { refreshTrayMenu } from './tray'
import { logDirectory, logFilePath } from './log'
import { describeError } from './sync/http'

let currentLocale: AppLocale = 'en'

export function registerIpcHandlers(): void {
  loadMainLocaleFromDb()
  currentLocale = getMainLocale()

  // Clear any existing handlers to allow safe re-registration during dev reload
  ipcMain.removeHandler(IPC_CHANNELS.APP.GET_VERSION)
  ipcMain.removeHandler(IPC_CHANNELS.APP.GET_LOCALE)
  ipcMain.removeHandler(IPC_CHANNELS.APP.SET_LOCALE)
  ipcMain.removeHandler(IPC_CHANNELS.APP.GET_PLATFORM)
  ipcMain.removeHandler(IPC_CHANNELS.APP.PICK_BACKGROUND_IMAGE)
  ipcMain.removeHandler(IPC_CHANNELS.APP.BACKUP_DATABASE)
  ipcMain.removeHandler(IPC_CHANNELS.APP.RESTORE_DATABASE)
  ipcMain.removeHandler(IPC_CHANNELS.APP.SHOW_LOG_FILE)
  ipcMain.removeHandler(IPC_CHANNELS.APP.QUIT)

  // Return current application version
  ipcMain.handle(IPC_CHANNELS.APP.GET_VERSION, () => {
    return app.getVersion()
  })

  // Return current app locale
  ipcMain.handle(IPC_CHANNELS.APP.GET_LOCALE, () => {
    return currentLocale
  })

  // Update current app locale
  ipcMain.handle(IPC_CHANNELS.APP.SET_LOCALE, (_event, locale: AppLocale) => {
    if (locale === 'vi' || locale === 'en') {
      currentLocale = locale
      setMainLocale(locale)
      refreshTrayMenu()
      return true
    }
    return false
  })

  // Return OS platform
  ipcMain.handle(IPC_CHANNELS.APP.GET_PLATFORM, () => {
    return process.platform
  })

  // Let the user pick a local image file to use as the background wallpaper
  ipcMain.handle(IPC_CHANNELS.APP.PICK_BACKGROUND_IMAGE, async () => {
    const win = BrowserWindow.getFocusedWindow()
    const options: Electron.OpenDialogOptions = {
      title: 'Select background image',
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }]
    }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) {
      return null
    }
    const filePath = result.filePaths[0]
    const buffer = await readFile(filePath)
    const ext = extname(filePath).slice(1).toLowerCase()
    const mime = ext === 'jpg' ? 'jpeg' : ext || 'png'
    return { dataUrl: `data:image/${mime};base64,${buffer.toString('base64')}` }
  })

  ipcMain.handle(IPC_CHANNELS.APP.BACKUP_DATABASE, async (): Promise<BackupResult> => {
    const win = BrowserWindow.getFocusedWindow()
    const options: Electron.SaveDialogOptions = {
      title: 'Back up calendar database',
      defaultPath: join(app.getPath('documents'), defaultBackupFileName()),
      filters: [{ name: 'SQLite database', extensions: ['sqlite'] }]
    }
    const result = win
      ? await dialog.showSaveDialog(win, options)
      : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) {
      return { success: false, message: 'cancelled' }
    }

    try {
      const byteSize = backupDatabaseTo(getDatabase(), result.filePath)
      return { success: true, filePath: result.filePath, byteSize }
    } catch (err) {
      return { success: false, message: describeError(err) }
    }
  })

  ipcMain.handle(IPC_CHANNELS.APP.RESTORE_DATABASE, () => restoreDatabaseFromBackup())

  // For a bug report: the file is in the profile folder, which is hidden.
  ipcMain.handle(IPC_CHANNELS.APP.SHOW_LOG_FILE, async () => {
    const file = logFilePath()
    const dir = logDirectory()
    if (file && existsSync(file)) {
      shell.showItemInFolder(file)
      return true
    }
    if (!dir) return false
    return (await shell.openPath(dir)) === ''
  })

  // Closing the window only hides xrncal in the tray; this is the way out
  // from inside it (Ctrl+Q).
  ipcMain.handle(IPC_CHANNELS.APP.QUIT, () => {
    app.quit()
  })

  // Register domain calendar, event, settings, auth, sync, and holiday IPC handlers
  registerSettingsIpcHandlers()
  registerCalendarIpcHandlers()
  registerAuthSyncIpcHandlers()
  registerHolidayIpcHandlers()
  registerSubscriptionIpcHandlers()
  registerPrintIpcHandlers()
}

