import type { ISqliteDatabase } from '../sqlite-driver'
import { compareAccountsForSidebar, compareCalendarsForSidebar } from '@shared/calendar-order'
import { LOCAL_ACCOUNT_ID } from './detach-account'

/** The calendar a fresh profile starts with, on this computer. */
export const LOCAL_CALENDAR_ID = 'calendar-local-default'

/** A calendar new events can be written to: not read-only, and not filled from
 *  a feed (subscriptions and holidays are both read-only too). */
const WRITABLE = 'is_read_only = 0 AND subscription_url IS NULL AND holiday_type IS NULL'

/**
 * The account that owns calendars kept only on this computer. Holidays, .ics
 * subscriptions and the calendars of a removed account live under it, so it
 * stays even with no calendar of its own.
 */
export function ensureLocalAccount(db: ISqliteDatabase, now = new Date().toISOString()): void {
  db.prepare(
    `INSERT OR IGNORE INTO accounts (id, type, name, is_active, created_at, updated_at)
     VALUES (?, 'local', 'Personal Account', 1, ?, ?)`
  ).run(LOCAL_ACCOUNT_ID, now, now)
}

/**
 * A calendar on this computer, made only when the profile has nowhere to write
 * at all: a fresh profile, or one whose every writable calendar went with a
 * removed account. It used to be made whenever the accounts table was empty
 * and could never be removed, so a profile that synced every calendar from an
 * account kept an empty "Personal Calendar" as its default. Asking whether
 * anything can be written to instead needs no record of the user removing it:
 * removing it is only offered while another writable calendar exists, so it
 * is never what brings it back, and neither is adding an account.
 */
export function ensureWritableCalendar(db: ISqliteDatabase, now = new Date().toISOString()): boolean {
  if (db.prepare(`SELECT 1 AS found FROM calendars WHERE ${WRITABLE} LIMIT 1`).get<{ found: number }>()) return false
  ensureLocalAccount(db, now)
  const taken = db.prepare('SELECT 1 AS found FROM calendars WHERE id = ?').get<{ found: number }>(LOCAL_CALENDAR_ID)
  const id = taken ? `cal_${Date.now()}_${Math.random().toString(36).slice(2, 8)}` : LOCAL_CALENDAR_ID
  db.prepare(
    `INSERT INTO calendars (id, account_id, name, color, is_visible, is_read_only, is_default, created_at, updated_at)
     VALUES (?, ?, 'Personal Calendar', '#6366f1', 1, 0, 1, ?, ?)`
  ).run(id, LOCAL_ACCOUNT_ID, now, now)
  return true
}

interface CalendarChoiceRow {
  id: string
  name: string
  account_id: string
  is_visible: number
  is_read_only: number
  is_default: number
  subscription_url: string | null
  holiday_type: string | null
  /** Null for a calendar whose account row is gone: it shows under this computer. */
  account_type: string | null
  account_created_at: string | null
}

const isRemote = (row: CalendarChoiceRow) => row.account_type !== null && row.account_type !== 'local'

/** The sidebar's order (calendar-order.ts), on rows read here. */
function sidebarOrder(a: CalendarChoiceRow, b: CalendarChoiceRow): number {
  const account = (row: CalendarChoiceRow) => ({
    type: row.account_type ?? 'local',
    createdAt: row.account_created_at ?? ''
  })
  return (
    compareAccountsForSidebar(account(a), account(b)) ||
    (isRemote(a) && isRemote(b) ? a.account_id.localeCompare(b.account_id) : 0) ||
    compareCalendarsForSidebar(
      { isDefault: a.is_default === 1, name: a.name },
      { isDefault: b.is_default === 1, name: b.name }
    )
  )
}

/**
 * Keep exactly one default calendar - the one a new event goes into - and keep
 * it one that exists and can be written to. Run at start-up, after a calendar
 * is removed, after an account is removed, and after every sync (an account's
 * first sync brings its calendars in).
 *
 * While any account's calendar can be written to, the default is one of those:
 * a calendar on this computer never syncs, so an event saved there reaches no
 * other device. A default that is already such a calendar stays - including a
 * hidden one, as hiding a calendar is not choosing another - and otherwise the
 * first in the sidebar's order takes over, a shown one before a hidden one.
 * The app does not record which calendar the last new event went into, so the
 * sidebar's order is the choice. With no account calendar to write to, the
 * default is a calendar on this computer the same way.
 *
 * Providers mark their own primary calendar as default when it first syncs;
 * only the first of those in the sidebar keeps the mark, so connecting a second
 * account does not move the default away from the first one's.
 *
 * Returns whether anything changed.
 */
export function settleDefaultCalendar(db: ISqliteDatabase, now = new Date().toISOString()): boolean {
  return db.transaction(() => {
    const seeded = ensureWritableCalendar(db, now)
    const rows = db
      .prepare(
        `SELECT c.id, c.name, c.account_id, c.is_visible, c.is_read_only, c.is_default, c.subscription_url,
                c.holiday_type, a.type AS account_type, a.created_at AS account_created_at
         FROM calendars c LEFT JOIN accounts a ON a.id = c.account_id`
      )
      .all<CalendarChoiceRow>()
    const writable = rows
      .filter((r) => r.is_read_only === 0 && !r.subscription_url && !r.holiday_type)
      .sort(sidebarOrder)
    const remote = writable.filter(isRemote)
    const pool = remote.length > 0 ? remote : writable
    const chosen = pool.find((r) => r.is_default === 1) ?? pool.find((r) => r.is_visible === 1) ?? pool[0]

    const changes = rows.filter((r) => (r.id === chosen?.id) !== (r.is_default === 1))
    const set = db.prepare('UPDATE calendars SET is_default = ?, updated_at = ? WHERE id = ?')
    for (const row of changes) set.run(row.id === chosen?.id ? 1 : 0, now, row.id)
    return seeded || changes.length > 0
  })()
}
