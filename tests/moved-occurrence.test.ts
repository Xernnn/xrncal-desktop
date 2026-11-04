import { describe, it, expect } from 'vitest'
import { createSqliteDriver } from '../src/main/db/sqlite-driver'
import { runMigrations, seedDefaultData, MIGRATION_022_SQL } from '../src/main/db/database'
import { generateIcs } from '../src/main/ics/write-ics'
import { parseIcsContent } from '../src/main/ics/parse-ics'
import type { Calendar, CalendarEvent, EventException } from '../src/shared/event-model'

/**
 * One week of an all-day series moved to a time of day - a weekly placeholder
 * every Tuesday, each week dragged to when it actually happened. Over CalDAV
 * the .ics reader dropped the moved week's own all-day flag, so it showed as an
 * all-day event, and the writer used the series' flag, so a push turned every
 * moved week on the server back into an all-day one.
 */

const CALENDAR: Calendar = {
  id: 'cal',
  accountId: 'acc',
  name: 'Weeb',
  color: '#529cca',
  isVisible: true,
  isReadOnly: false,
  isDefault: false,
  createdAt: '',
  updatedAt: ''
}

const SERIES: CalendarEvent = {
  id: 'series',
  calendarId: 'cal',
  uid: 'series@example.com',
  title: 'Sanctuary + Tantarus',
  dtStartUtc: '2025-11-25T00:00:00.000Z',
  dtEndUtc: '2025-11-25T23:59:59.999Z',
  tzid: 'floating',
  allDay: true,
  rrule: 'FREQ=WEEKLY;BYDAY=TU',
  exdate: '2026-07-14T00:00:00.000Z',
  reminders: [{ minutesBefore: 15 }],
  dirty: false,
  isDeleted: false,
  createdAt: '',
  updatedAt: ''
}

function moved(original: string, start: string, end: string, tzid: string, over: Partial<EventException> = {}): EventException {
  return {
    id: `x-${original}`,
    masterEventId: 'series',
    originalStartUtc: `${original}T00:00:00.000Z`,
    dtStartUtc: start,
    dtEndUtc: end,
    tzid,
    allDay: false,
    isCancelled: false,
    createdAt: '',
    updatedAt: '',
    ...over
  }
}

describe('a week of an all-day series moved to a time of day', () => {
  const weeks = [
    // Tuesday 8 September moved to Monday 10:00 in Sydney.
    moved('2026-09-08', '2026-09-07T00:00:00.000Z', '2026-09-07T01:00:00.000Z', 'Australia/Sydney'),
    // Tuesday 3 February moved to 18:00 in Vietnam's zone.
    moved('2026-02-03', '2026-02-03T11:00:00.000Z', '2026-02-03T12:00:00.000Z', 'Asia/Bangkok')
  ]

  it('is written with its own clock time and zone, the week it replaces as a date', () => {
    const ics = generateIcs(CALENDAR, [SERIES], weeks)
    expect(ics).toContain('DTSTART;VALUE=DATE:20251125')
    expect(ics).toContain('EXDATE;VALUE=DATE:20260714')
    expect(ics).toContain('RECURRENCE-ID;VALUE=DATE:20260908')
    expect(ics).toContain('DTSTART;TZID=Australia/Sydney:20260907T100000')
    expect(ics).toContain('DTSTART;TZID=Asia/Bangkok:20260203T180000')
    expect(ics.match(/BEGIN:VTIMEZONE/g)).toHaveLength(2)
  })

  it('reads back timed, at the same instants', () => {
    const back = parseIcsContent(generateIcs(CALENDAR, [SERIES], weeks), 'cal')
    expect(back.events[0]).toMatchObject({ allDay: true, rrule: SERIES.rrule, exdate: SERIES.exdate })
    const byWeek = Object.fromEntries(back.exceptions.map((x) => [x.originalStartUtc, x]))
    for (const w of weeks) {
      expect(byWeek[w.originalStartUtc]).toMatchObject({ allDay: false, dtStartUtc: w.dtStartUtc, dtEndUtc: w.dtEndUtc, tzid: w.tzid })
    }
  })

  it('leaves a week that stays all-day as a date, and a cancelled one cancelled', () => {
    const ics = generateIcs(CALENDAR, [SERIES], [
      moved('2026-03-03', '2026-03-05T00:00:00.000Z', '2026-03-05T23:59:59.999Z', 'floating', { allDay: true }),
      moved('2026-03-10', '2026-03-10T00:00:00.000Z', '2026-03-10T23:59:59.999Z', 'floating', { isCancelled: true })
    ])
    expect(ics).toContain('RECURRENCE-ID;VALUE=DATE:20260303\r\nDTSTART;VALUE=DATE:20260305\r\nDTEND;VALUE=DATE:20260306')
    // A cancelled week is an EXDATE, as a date like the series' own.
    expect(ics).toContain('EXDATE;VALUE=DATE:20260310,20260714\r\n')
    expect(ics).not.toContain('STATUS:CANCELLED')
    const back = parseIcsContent(ics, 'cal')
    expect(back.exceptions.find((x) => x.originalStartUtc.startsWith('2026-03-03'))).toMatchObject({ allDay: true })
    expect(back.events[0].exdate).toContain('2026-03-10')
  })
})

describe('a week of a timed series made all-day', () => {
  it('is written as a date and read back all-day', () => {
    const timed: CalendarEvent = {
      ...SERIES,
      allDay: false,
      tzid: 'Australia/Sydney',
      dtStartUtc: '2026-03-02T22:00:00.000Z',
      dtEndUtc: '2026-03-02T23:00:00.000Z',
      exdate: undefined
    }
    const ics = generateIcs(CALENDAR, [timed], [
      {
        ...moved('2026-03-09', '2026-03-10T00:00:00.000Z', '2026-03-10T23:59:59.999Z', 'Australia/Sydney', { allDay: true }),
        originalStartUtc: '2026-03-09T22:00:00.000Z'
      }
    ])
    expect(ics).toContain('RECURRENCE-ID;TZID=Australia/Sydney:20260310T090000\r\nDTSTART;VALUE=DATE:20260310')
    expect(parseIcsContent(ics, 'cal').exceptions[0]).toMatchObject({ allDay: true, originalStartUtc: '2026-03-09T22:00:00.000Z' })
  })
})

describe('migration 022', () => {
  it('makes the moved weeks already stored without a flag timed, and only those', () => {
    const db = createSqliteDriver(':memory:')
    runMigrations(db)
    seedDefaultData(db)
    const calendarId = db.prepare('SELECT id FROM calendars LIMIT 1').get<{ id: string }>()!.id
    const now = '2026-10-16T00:00:00.000Z'
    const insertEvent = db.prepare(
      `INSERT INTO events (id, calendar_id, uid, title, dtstart_utc, dtend_utc, tzid, all_day, rrule, created_at, updated_at)
       VALUES (?, ?, ?, 'S', ?, ?, 'floating', ?, 'FREQ=WEEKLY', ?, ?)`
    )
    insertEvent.run('allday', calendarId, 'allday', '2025-11-25T00:00:00.000Z', '2025-11-25T23:59:59.999Z', 1, now, now)
    insertEvent.run('timed', calendarId, 'timed', '2025-11-25T22:00:00.000Z', '2025-11-25T23:00:00.000Z', 0, now, now)
    const insertException = db.prepare(
      `INSERT INTO event_exceptions (id, master_event_id, original_start_utc, is_cancelled, dtstart_utc, dtend_utc, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    // As a CalDAV pull stored them: no all_day.
    insertException.run('moved', 'allday', '2026-09-08T00:00:00.000Z', 0, '2026-09-07T00:00:00.000Z', '2026-09-07T01:00:00.000Z', now, now)
    insertException.run('whole-day', 'allday', '2026-09-15T00:00:00.000Z', 0, '2026-09-17T00:00:00.000Z', '2026-09-17T23:59:59.999Z', now, now)
    insertException.run('cancelled', 'allday', '2026-09-22T00:00:00.000Z', 1, '2026-09-22T00:00:00.000Z', '2026-09-22T00:00:00.000Z', now, now)
    insertException.run('timed-series', 'timed', '2026-09-08T22:00:00.000Z', 0, '2026-09-09T01:00:00.000Z', '2026-09-09T02:00:00.000Z', now, now)

    db.exec(MIGRATION_022_SQL)

    const flags = Object.fromEntries(
      db.prepare('SELECT id, all_day FROM event_exceptions').all<{ id: string; all_day: number | null }>().map((r) => [r.id, r.all_day])
    )
    expect(flags).toEqual({ moved: 0, 'whole-day': null, cancelled: null, 'timed-series': null })
    db.close()
  })
})
