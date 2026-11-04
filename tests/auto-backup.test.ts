import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSqliteDriver, type ISqliteDatabase } from '../src/main/db/sqlite-driver'
import { runMigrations, seedDefaultData } from '../src/main/db/database'
import {
  AUTO_BACKUPS_KEPT,
  autoBackupFileName,
  backupsDirectory,
  listAutoBackups,
  runAutoBackupIfDue
} from '../src/main/auto-backup'

const DAY = 24 * 60 * 60 * 1000

/**
 * A copy a week, the last four kept. The schedule is decided from the dates in
 * the file names, so every case here passes its own clock.
 */
describe('automatic backups', () => {
  let profile: string
  let dir: string
  let db: ISqliteDatabase

  beforeEach(() => {
    profile = mkdtempSync(join(tmpdir(), 'xrncal-auto-backup-'))
    dir = backupsDirectory(profile)
    db = createSqliteDriver(join(profile, 'xrncal.sqlite'))
    runMigrations(db)
    seedDefaultData(db)
  })

  afterEach(() => {
    db.close()
    rmSync(profile, { recursive: true, force: true })
  })

  const at = (iso: string): Date => new Date(iso)

  it('writes the first backup straight away, into the backups folder', () => {
    const written = runAutoBackupIfDue(db, dir, at('2026-11-01T10:00:00Z'))

    expect(written).toBe(join(dir, 'xrncal-auto-2026-11-01T10-00-00.sqlite'))
    const copy = createSqliteDriver(written!)
    expect(copy.prepare('SELECT COUNT(*) c FROM calendars').get<{ c: number }>()!.c).toBeGreaterThan(0)
    copy.close()
  })

  it.skipIf(process.platform === 'win32')('keeps the folder and the copies private', () => {
    const written = runAutoBackupIfDue(db, dir, at('2026-11-01T10:00:00Z'))!

    expect(statSync(dir).mode & 0o777).toBe(0o700)
    expect(statSync(written).mode & 0o777).toBe(0o600)
  })

  it('waits a week before the next one', () => {
    runAutoBackupIfDue(db, dir, at('2026-11-01T10:00:00Z'))

    expect(runAutoBackupIfDue(db, dir, at('2026-11-02T10:00:00Z'))).toBeNull()
    expect(runAutoBackupIfDue(db, dir, at('2026-11-08T09:59:00Z'))).toBeNull()
    expect(runAutoBackupIfDue(db, dir, at('2026-11-08T10:00:00Z'))).not.toBeNull()
    expect(listAutoBackups(dir)).toHaveLength(2)
  })

  it(`keeps only the newest ${AUTO_BACKUPS_KEPT}`, () => {
    const start = Date.parse('2026-01-01T08:00:00Z')
    for (let week = 0; week < 7; week++) runAutoBackupIfDue(db, dir, new Date(start + week * 7 * DAY))

    const kept = listAutoBackups(dir).map((f) => f.path)
    expect(kept).toEqual(
      [6, 5, 4, 3].map((week) => join(dir, autoBackupFileName(new Date(start + week * 7 * DAY))))
    )
  })

  it('never touches backups the user made, or the copy taken before a restore', () => {
    runAutoBackupIfDue(db, dir, at('2026-01-01T08:00:00Z'))
    writeFileSync(join(dir, 'xrncal-before-restore-2025-12-01T08-00-00.sqlite'), '')
    writeFileSync(join(dir, 'xrncal-backup-2025-12-01T08-00-00.sqlite'), '')
    const start = Date.parse('2026-01-08T08:00:00Z')
    for (let week = 0; week < 6; week++) runAutoBackupIfDue(db, dir, new Date(start + week * 7 * DAY))

    const names = readdirSync(dir)
    expect(names).toContain('xrncal-before-restore-2025-12-01T08-00-00.sqlite')
    expect(names).toContain('xrncal-backup-2025-12-01T08-00-00.sqlite')
    expect(names.filter((n) => n.startsWith('xrncal-auto-'))).toHaveLength(AUTO_BACKUPS_KEPT)
  })

  it('does not stop for years because one copy was dated by a wrong clock', () => {
    runAutoBackupIfDue(db, dir, at('2031-05-01T08:00:00Z'))

    expect(runAutoBackupIfDue(db, dir, at('2026-11-01T10:00:00Z'))).not.toBeNull()
    // ...and then goes back to weekly, rather than a copy at every check.
    expect(runAutoBackupIfDue(db, dir, at('2026-11-01T16:00:00Z'))).toBeNull()
  })

  it('finds nothing in a folder that does not exist yet', () => {
    expect(listAutoBackups(join(profile, 'nowhere'))).toEqual([])
  })
})
