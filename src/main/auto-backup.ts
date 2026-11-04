import { mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { ISqliteDatabase } from './db/sqlite-driver'
import { backupDatabaseTo, defaultBackupFileName } from './db/backup'
import { getDatabase } from './db/database'
import { SettingsRepo } from './db/repos/settings-repo'
import { log } from './log'
import { describeError } from './sync/http'

/**
 * A copy of the database once a week, kept in the profile's `backups` folder.
 *
 * The database is the only full copy of what xrncal holds: local calendars,
 * lunar anniversaries, settings and the zone history live nowhere else, and a
 * synced calendar is only as good as the last sync. Backups used to be made by
 * hand or not at all. The last AUTO_BACKUPS_KEPT copies are kept, so a mistake
 * noticed weeks later can still be undone from Settings → Restore, whose
 * dialog opens in this folder.
 */

export const AUTO_BACKUP_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000
export const AUTO_BACKUPS_KEPT = 4
/** Not at startup: a snapshot takes a fraction of a second on the main
 *  thread, and the window is drawing then. */
const FIRST_CHECK_DELAY_MS = 2 * 60 * 1000
/** The app runs in the tray for days, so the check repeats. */
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

const AUTO_PREFIX = 'xrncal-auto-'

/** Where automatic backups go - and the copy taken before a restore. */
export function backupsDirectory(profileDir: string): string {
  return join(profileDir, 'backups')
}

/** `xrncal-auto-2026-09-14T19-20-31.sqlite` */
export function autoBackupFileName(now = new Date()): string {
  return defaultBackupFileName(now).replace('xrncal-backup-', AUTO_PREFIX)
}

/** When an automatic backup was taken, read from its name: copying the folder
 *  elsewhere keeps names but not always modification times. */
function takenAt(fileName: string): number | undefined {
  const match = fileName.match(/^xrncal-auto-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})\.sqlite$/)
  if (!match) return undefined
  const ms = Date.parse(`${match[1]}T${match[2]}:${match[3]}:${match[4]}Z`)
  return Number.isNaN(ms) ? undefined : ms
}

/** Automatic backups in `dir`, newest first. */
export function listAutoBackups(dir: string): { path: string; takenAt: number }[] {
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch {
    return []
  }
  return names
    .map((name) => ({ path: join(dir, name), takenAt: takenAt(name) }))
    .filter((f): f is { path: string; takenAt: number } => f.takenAt !== undefined)
    .sort((a, b) => b.takenAt - a.takenAt)
}

/**
 * Write a backup if the newest one is a week old or more (or there is none),
 * then drop all but the newest AUTO_BACKUPS_KEPT. Returns the file written, or
 * null when none was due.
 */
export function runAutoBackupIfDue(db: ISqliteDatabase, dir: string, now = new Date()): string | null {
  // A backup dated in the future means the clock was wrong when it was taken;
  // counting it would stop backups until the clock caught up, possibly years.
  const newest = listAutoBackups(dir).find((f) => f.takenAt <= now.getTime() + 24 * 60 * 60 * 1000)
  if (newest && now.getTime() - newest.takenAt < AUTO_BACKUP_INTERVAL_MS) return null

  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const dest = join(dir, autoBackupFileName(now))
  backupDatabaseTo(db, dest)
  for (const old of listAutoBackups(dir).slice(AUTO_BACKUPS_KEPT)) rmSync(old.path, { force: true })
  return dest
}

let started = false

/** Check now and then whether a backup is due, following the `autoBackup`
 *  setting, read again before every check. */
export function startAutoBackups(profileDir: string): void {
  if (started) return
  started = true
  const dir = backupsDirectory(profileDir)

  const check = (): void => {
    try {
      const db = getDatabase()
      if (!new SettingsRepo(db).getSetting('autoBackup')) return
      const written = runAutoBackupIfDue(db, dir)
      if (written) log('info', `Automatic backup written: ${written}`)
    } catch (err) {
      log('error', `Automatic backup failed: ${describeError(err)}`)
    }
  }

  setTimeout(check, FIRST_CHECK_DELAY_MS)
  setInterval(check, CHECK_INTERVAL_MS)
}
