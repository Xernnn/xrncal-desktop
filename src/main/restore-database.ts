import { app, BrowserWindow, dialog } from 'electron'
import { copyFileSync, mkdirSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { RestoreResult } from '@shared/ipc-contract'
import { closeDatabase, getDatabase, SCHEMA_VERSION } from './db/database'
import { createSqliteDriver } from './db/sqlite-driver'
import { backupDatabaseTo, beforeRestoreFileName, checkBackup } from './db/backup'
import { START_HIDDEN_ARG } from './launch-at-login'
import { backupsDirectory, listAutoBackups } from './auto-backup'

function removeWithSidecars(path: string): void {
  for (const file of [path, `${path}-wal`, `${path}-shm`]) rmSync(file, { force: true })
}

/**
 * Replace the database with a backup the user picks, and restart.
 *
 * The file is checked on a copy (opening the original would leave WAL files
 * next to it), what is there now is saved in the profile's backups folder first, and the
 * swap happens with the database closed. The app restarts rather than
 * reopening in place: the sync worker, reminder scheduler and every repo hold
 * the old connection.
 */
export async function restoreDatabaseFromBackup(): Promise<RestoreResult> {
  const profile = app.getPath('userData')
  const backups = backupsDirectory(profile)
  const win = BrowserWindow.getFocusedWindow()
  const options: Electron.OpenDialogOptions = {
    properties: ['openFile'],
    // The automatic backups, when there are any: they are in the profile
    // folder, which is hidden and hard to browse to from a file dialog.
    defaultPath: listAutoBackups(backups).length > 0 ? backups : app.getPath('documents'),
    filters: [{ name: 'SQLite database', extensions: ['sqlite', 'db'] }]
  }
  const picked = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
  if (picked.canceled || picked.filePaths.length === 0) return { success: false, message: 'cancelled' }

  const live = join(profile, 'xrncal.sqlite')
  const staging = join(profile, 'restore-staging.sqlite')

  removeWithSidecars(staging)
  try {
    copyFileSync(picked.filePaths[0], staging)
    let verdict: ReturnType<typeof checkBackup>
    try {
      const candidate = createSqliteDriver(staging)
      try {
        verdict = checkBackup(candidate, SCHEMA_VERSION)
      } finally {
        candidate.close()
      }
    } catch {
      verdict = { ok: false, problem: 'notDatabase' }
    }
    if (!verdict.ok) {
      removeWithSidecars(staging)
      return { success: false, message: verdict.problem }
    }

    mkdirSync(backups, { recursive: true, mode: 0o700 })
    backupDatabaseTo(getDatabase(), join(backups, beforeRestoreFileName()))
    closeDatabase()
    removeWithSidecars(live)
    renameSync(staging, live)
    removeWithSidecars(staging)
  } catch (err) {
    removeWithSidecars(staging)
    return { success: false, message: err instanceof Error ? err.message : String(err) }
  }

  // Open the window after the restart even if this run started in the tray.
  app.relaunch({ args: process.argv.slice(1).filter((arg) => arg !== START_HIDDEN_ARG) })
  app.exit(0)
  return { success: true }
}
