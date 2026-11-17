import { describe, it, expect, beforeEach } from 'vitest'
import { createSqliteDriver, type ISqliteDatabase } from '../src/main/db/sqlite-driver'
import { runMigrations, seedDefaultData, MIGRATION_029_SQL } from '../src/main/db/database'
import { CalendarsRepo } from '../src/main/db/repos/calendars-repo'
import { EventsRepo } from '../src/main/db/repos/events-repo'
import {
  subscribeHolidayCalendar,
  refreshHolidayCalendars,
  unsubscribeHolidayCalendar
} from '../src/main/holidays/holiday-subscription'

/**
 * The holiday subscriptions were found by name. Any calendar called
 * "International Holidays" or "Ngày lễ Việt Nam" - made here, renamed, or
 * synced from an account - was taken for one: each start-up found its last
 * event before the years ahead, deleted all its events and put generated
 * holidays in their place; Subscribe did the same and Unsubscribe deleted the
 * calendar. Renaming the real one made Subscribe create a second and
 * Unsubscribe do nothing. Now a holiday calendar carries its type
 * (calendars.holiday_type, migration 029), and only that finds it.
 */

const eventsIn = (db: ISqliteDatabase, calendarId: string): string[] =>
  db
    .prepare('SELECT title FROM events WHERE calendar_id = ? AND is_deleted = 0 ORDER BY title')
    .all<{ title: string }>(calendarId)
    .map((r) => r.title)

describe('holiday calendars are known by their type, not their name', () => {
  let db: ISqliteDatabase
  let calendars: CalendarsRepo
  let events: EventsRepo

  beforeEach(() => {
    db = createSqliteDriver(':memory:')
    runMigrations(db)
    seedDefaultData(db)
    calendars = new CalendarsRepo(db)
    events = new EventsRepo(db)
  })

  /** A calendar of the user's own that happens to share a holiday calendar's name. */
  function usersOwn(name: string): string {
    const cal = calendars.createCalendar({ name, color: '#336699' })
    events.createEvent({
      calendarId: cal.id,
      title: 'Team offsite',
      dtStartUtc: '2026-05-04T00:00:00.000Z',
      dtEndUtc: '2026-05-04T23:59:59.000Z',
      allDay: true
    })
    return cal.id
  }

  it('leaves a calendar of the user\'s named "International Holidays" alone at start-up', () => {
    const own = usersOwn('International Holidays')
    expect(refreshHolidayCalendars(db, 2026)).toEqual([])
    expect(eventsIn(db, own)).toEqual(['Team offsite'])
  })

  it('subscribes and unsubscribes beside it without touching it', () => {
    const own = usersOwn('International Holidays')

    const { calendarId } = subscribeHolidayCalendar(db, 'international', 2026)
    expect(calendarId).not.toBe(own)
    expect(eventsIn(db, own)).toEqual(['Team offsite'])
    expect(calendars.getCalendarById(calendarId)?.holidayType).toBe('international')

    expect(unsubscribeHolidayCalendar(db, 'international')).toBe(true)
    expect(calendars.getCalendarById(calendarId)).toBeNull()
    expect(eventsIn(db, own)).toEqual(['Team offsite'])
  })

  it('still knows a holiday calendar the user renamed', () => {
    const { calendarId } = subscribeHolidayCalendar(db, 'vietnam', 2026)
    calendars.updateCalendar(calendarId, { name: 'Lễ' })

    expect(subscribeHolidayCalendar(db, 'vietnam', 2026).calendarId).toBe(calendarId)
    expect(calendars.listCalendars().filter((c) => c.holidayType === 'vietnam')).toHaveLength(1)
    expect(unsubscribeHolidayCalendar(db, 'vietnam')).toBe(true)
    expect(calendars.getCalendarById(calendarId)).toBeNull()
  })

  it('migration 029 marks the subscriptions made before it, and only those, and start-up keeps the user\'s calendar', () => {
    // The calendars as the old build left them: no holiday_type column.
    db.exec('ALTER TABLE calendars DROP COLUMN holiday_type')
    const now = new Date().toISOString()
    const insert = db.prepare(
      `INSERT INTO calendars (id, account_id, name, color, is_visible, is_read_only, is_default, created_at, updated_at)
       VALUES (?, ?, ?, '#529cca', 1, ?, 0, ?, ?)`
    )
    insert.run('cal_old_holidays', 'account-local-primary', 'Ngày lễ Việt Nam', 1, now, now)
    insert.run('cal_users_own', 'account-local-primary', 'International Holidays', 0, now, now)
    db.prepare(
      `INSERT INTO accounts (id, type, name, is_active, created_at, updated_at) VALUES ('acc_g', 'google', 'G', 1, ?, ?)`
    ).run(now, now)
    insert.run('cal_synced', 'acc_g', 'International Holidays', 1, now, now)
    for (const calendarId of ['cal_users_own', 'cal_synced']) {
      db.prepare(
        `INSERT INTO events (id, calendar_id, uid, title, dtstart_utc, dtend_utc, tzid, all_day, created_at, updated_at)
         VALUES (?, ?, ?, 'Team offsite', '2026-05-04T00:00:00.000Z', '2026-05-04T23:59:59.000Z', 'UTC', 1, ?, ?)`
      ).run(`evt_${calendarId}`, calendarId, `${calendarId}@example.com`, now, now)
    }

    db.exec(MIGRATION_029_SQL)
    expect(refreshHolidayCalendars(db, 2026)).toEqual(['vietnam'])

    expect(calendars.getCalendarById('cal_old_holidays')?.holidayType).toBe('vietnam')
    expect(eventsIn(db, 'cal_old_holidays').length).toBeGreaterThan(0)
    for (const id of ['cal_users_own', 'cal_synced']) {
      expect(calendars.getCalendarById(id)?.holidayType).toBeUndefined()
      expect(eventsIn(db, id)).toEqual(['Team offsite'])
    }
  })
})
