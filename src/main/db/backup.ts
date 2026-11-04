import { closeSync, existsSync, openSync, rmSync, statSync, unlinkSync } from 'node:fs'
import type { ISqliteDatabase } from './sqlite-driver'

/**
 * Write a consistent snapshot of the whole database to `destPath`.
 *
 * `VACUUM INTO` is the right tool rather than copying the file: the database
 * runs in WAL mode, so the `.sqlite` on disk is only part of the story and a
 * plain copy taken mid-write can land torn or miss committed data sitting in the
 * `-wal`. VACUUM INTO takes a read transaction, so it is safe while the app is
 * running, and it writes a single compacted file with no sidecars to keep
 * together.
 *
 * The result is an ordinary SQLite database: restoring is copying it back over
 * `xrncal.sqlite` with the app closed.
 *
 * The snapshot is readable by this user only. The live database sits in the
 * profile folder, which only its owner can open; a backup goes wherever the
 * user saves it (usually Documents, readable by everyone on the computer), and
 * it holds every event and the encrypted sign-ins.
 */
export function backupDatabaseTo(db: ISqliteDatabase, destPath: string): number {
  // VACUUM INTO refuses to overwrite, so an existing snapshot at this path is
  // cleared first - the user already confirmed the overwrite in the save dialog.
  if (existsSync(destPath)) unlinkSync(destPath)
  // VACUUM INTO also writes into an empty file, and keeps that file's mode: so
  // the file is created private first, rather than made private once written.
  closeSync(openSync(destPath, 'wx', 0o600))

  // The path comes from a save dialog, not from user-typed SQL, but it still
  // goes into a statement: escape the quote character so a path containing one
  // cannot terminate the literal.
  try {
    db.exec(`VACUUM INTO '${destPath.replace(/'/g, "''")}'`)
  } catch (err) {
    // Not an empty file left behind that looks like a backup.
    rmSync(destPath, { force: true })
    throw err
  }

  return statSync(destPath).size
}

/** `xrncal-backup-2026-09-14T19-20-31.sqlite` */
export function defaultBackupFileName(now = new Date()): string {
  const stamp = now.toISOString().replace(/\.\d+Z$/, '').replace(/:/g, '-')
  return `xrncal-backup-${stamp}.sqlite`
}

/** Why a file cannot be restored: not readable as SQLite, not an xrncal
 *  database, or made by a newer xrncal whose schema this build cannot read. */
export type BackupProblem = 'notDatabase' | 'notXrncal' | 'newer'

/**
 * Whether `candidate` - a working copy of the file the user picked, never the
 * file itself - can replace the database: it passes SQLite's quick check, has
 * xrncal's tables, and was not written by a newer build. An older one is fine;
 * the next start migrates it like any other old profile.
 */
export function checkBackup(
  candidate: ISqliteDatabase,
  schemaVersion: number
): { ok: true; version: number } | { ok: false; problem: BackupProblem } {
  try {
    const check = candidate.prepare('PRAGMA quick_check').get<{ quick_check: string }>()
    if (check?.quick_check !== 'ok') return { ok: false, problem: 'notDatabase' }
  } catch {
    return { ok: false, problem: 'notDatabase' }
  }
  try {
    const hasEvents = candidate
      .prepare("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'events'")
      .get()
    const row = candidate.prepare('SELECT MAX(version) AS version FROM schema_migrations').get<{ version: number | null }>()
    if (!hasEvents || !row?.version) return { ok: false, problem: 'notXrncal' }
    if (row.version > schemaVersion) return { ok: false, problem: 'newer' }
    return { ok: true, version: row.version }
  } catch {
    return { ok: false, problem: 'notXrncal' }
  }
}

/** `xrncal-before-restore-2026-09-14T19-20-31.sqlite`: what was there before a restore. */
export function beforeRestoreFileName(now = new Date()): string {
  return defaultBackupFileName(now).replace('xrncal-backup-', 'xrncal-before-restore-')
}
