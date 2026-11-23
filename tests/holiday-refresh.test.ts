import { describe, it, expect, beforeEach } from 'vitest'
import { createSqliteDriver, type ISqliteDatabase } from '../src/main/db/sqlite-driver'
import { runMigrations, seedDefaultData } from '../src/main/db/database'
import {
  subscribeHolidayCalendar,
  refreshHolidayCalendars
} from '../src/main/holidays/holiday-subscription'

/**
 * A holiday subscription was generated once, last year through two years
 * ahead, and never extended - so one taken out in 2026 was empty from 2029.
 */
describe('refreshHolidayCalendars', () => {
  let db: ISqliteDatabase

  const yearsIn = (calendarId: string): number[] =>
    db
      .prepare(
        "SELECT DISTINCT CAST(substr(dtstart_utc, 1, 4) AS INTEGER) AS y FROM events WHERE calendar_id = ? ORDER BY y"
      )
      .all<{ y: number }>(calendarId)
      .map((r) => r.y)

  beforeEach(() => {
    db = createSqliteDriver(':memory:')
    runMigrations(db)
    seedDefaultData(db)
  })

  it('leaves a subscription that still covers the years ahead alone', () => {
    const { calendarId } = subscribeHolidayCalendar(db, 'vietnam', 2026)
    expect(yearsIn(calendarId)).toEqual([2025, 2026, 2027, 2028])

    expect(refreshHolidayCalendars(db, 2026)).toEqual([])
  })

  it('extends a subscription once the calendar has moved past its first year', () => {
    const { calendarId } = subscribeHolidayCalendar(db, 'vietnam', 2026)
    subscribeHolidayCalendar(db, 'international', 2026)

    expect(refreshHolidayCalendars(db, 2029).sort()).toEqual(['international', 'vietnam'])
    expect(yearsIn(calendarId)).toEqual([2028, 2029, 2030, 2031])
  })

  it('does nothing without a subscription', () => {
    expect(refreshHolidayCalendars(db, 2030)).toEqual([])
    expect(db.prepare('SELECT COUNT(*) c FROM events').get<{ c: number }>()!.c).toBe(0)
  })

  // The lunar search stopped 400 days into the year, so a list generated
  // before it reached far enough has no Giao Thừa on 5 February 2027 (nor
  // Ông Táo and Giao Thừa in 2026). Migration 031 empties the Vietnamese
  // calendar once, and the start-up refresh writes it again.
  it('writes the Vietnamese holidays again once, with the days the old search missed', () => {
    const { calendarId } = subscribeHolidayCalendar(db, 'vietnam', 2026)
    const intl = subscribeHolidayCalendar(db, 'international', 2026)
    const giaoThua = "SELECT substr(dtstart_utc, 1, 10) AS d FROM events WHERE calendar_id = ? AND title LIKE 'Đêm Giao Thừa%' ORDER BY d"
    // As the old build left it.
    db.prepare("DELETE FROM events WHERE calendar_id = ? AND title LIKE 'Đêm Giao Thừa%' AND dtstart_utc LIKE '2027-%'").run(calendarId)
    db.prepare('DELETE FROM schema_migrations WHERE version >= 31').run()
    const intlCount = db.prepare('SELECT COUNT(*) c FROM events WHERE calendar_id = ?').get<{ c: number }>(intl.calendarId)!.c

    runMigrations(db)
    expect(refreshHolidayCalendars(db, 2026)).toEqual(['vietnam'])

    expect(db.prepare(giaoThua).all<{ d: string }>(calendarId).map((r) => r.d)).toEqual([
      '2025-01-28',
      '2026-02-16',
      '2027-02-05',
      '2028-01-25'
    ])
    expect(yearsIn(calendarId)).toEqual([2025, 2026, 2027, 2028])
    expect(db.prepare('SELECT COUNT(*) c FROM events WHERE calendar_id = ?').get<{ c: number }>(intl.calendarId)!.c).toBe(intlCount)
    // Once: the next start leaves it alone.
    runMigrations(db)
    expect(refreshHolidayCalendars(db, 2026)).toEqual([])
  })
})
