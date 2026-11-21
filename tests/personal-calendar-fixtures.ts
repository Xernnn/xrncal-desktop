import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDatabase, initDatabase } from '../src/main/db/database'
import { createSqliteDriver, type ISqliteDatabase } from '../src/main/db/sqlite-driver'

/**
 * Profiles on disk for the tests of the calendar on this computer and the
 * default calendar: started the way the app starts one, or written the way an
 * older build left one. Made-up data only.
 */

export type Db = ISqliteDatabase

export const LOCAL = 'calendar-local-default'
export const LOCAL_ACCOUNT = 'account-local-primary'
export const DAV_ACCOUNT = 'caldav-alex'
export const DAV_WORK = 'https://dav.example.com/alex/work/'
export const DAV_FAMILY = 'https://dav.example.com/alex/family/'
export const DAV_SHARED = 'https://dav.example.com/alex/shared/'

/** A throwaway profile, and how to start the app on it: migrations, seeding, the default settled. */
export function tempProfile(): { path: string; start: () => Db; remove: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'xrncal-profile-'))
  const path = join(dir, 'xrncal.sqlite')
  return {
    path,
    start: () => {
      closeDatabase()
      return initDatabase(path)
    },
    remove: () => {
      closeDatabase()
      rmSync(dir, { recursive: true, force: true })
    }
  }
}

/** Write to the profile without the start-up rules, as an older build would have. */
export function asOldBuildLeftIt(path: string, write: (db: Db) => void): void {
  closeDatabase()
  const db = createSqliteDriver(path)
  write(db)
  db.close()
}

export function addAccount(db: Db, id: string, type: string, createdAt: string): void {
  db.prepare(
    `INSERT INTO accounts (id, type, name, email, is_active, created_at, updated_at)
     VALUES (?, ?, ?, 'alex@example.com', 1, ?, ?)`
  ).run(id, type, id, createdAt, createdAt)
}

export function addCalendar(
  db: Db,
  id: string,
  accountId: string,
  name: string,
  { visible = true, readOnly = false, isDefault = false } = {}
): void {
  const now = '2026-11-01T00:00:00.000Z'
  db.prepare(
    `INSERT INTO calendars (id, account_id, name, color, is_visible, is_read_only, is_default, created_at, updated_at)
     VALUES (?, ?, ?, '#7c9cbf', ?, ?, ?, ?, ?)`
  ).run(id, accountId, name, visible ? 1 : 0, readOnly ? 1 : 0, isDefault ? 1 : 0, now, now)
}

/** A CalDAV account as its first sync leaves it: Work, Family (hidden, first by name) and a read-only one. */
export function addCalDavAccount(db: Db): void {
  addAccount(db, DAV_ACCOUNT, 'caldav', '2026-11-02T00:00:00.000Z')
  addCalendar(db, DAV_WORK, DAV_ACCOUNT, 'Work')
  addCalendar(db, DAV_FAMILY, DAV_ACCOUNT, 'Family', { visible: false })
  addCalendar(db, DAV_SHARED, DAV_ACCOUNT, 'Alpha shared', { readOnly: true })
}

export function addEvent(db: Db, calendarId: string, title: string, deleted = false): string {
  const id = `evt_${title.replace(/\W/g, '_')}`
  db.prepare(
    `INSERT INTO events (id, calendar_id, uid, title, dtstart_utc, dtend_utc, tzid, all_day, is_deleted, dirty, created_at, updated_at)
     VALUES (?, ?, ?, ?, '2026-12-01T09:00:00.000Z', '2026-12-01T10:00:00.000Z', 'UTC', 0, ?, 0, '', '')`
  ).run(id, calendarId, `${id}@example.com`, title, deleted ? 1 : 0)
  return id
}

/** The calendars marked default. */
export const defaults = (db: Db): string[] =>
  db
    .prepare('SELECT id FROM calendars WHERE is_default = 1 ORDER BY id')
    .all<{ id: string }>()
    .map((r) => r.id)

export const exists = (db: Db, calendarId: string): boolean =>
  Boolean(db.prepare('SELECT 1 AS found FROM calendars WHERE id = ?').get<{ found: number }>(calendarId))
