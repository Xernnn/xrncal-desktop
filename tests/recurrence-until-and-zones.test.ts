import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { DateTime } from 'luxon'
import { createSqliteDriver, type ISqliteDatabase } from '../src/main/db/sqlite-driver'
import { runMigrations, seedDefaultData } from '../src/main/db/database'
import { CalendarsRepo } from '../src/main/db/repos/calendars-repo'
import { EventsRepo } from '../src/main/db/repos/events-repo'
import { expandOccurrences } from '../src/shared/expand-occurrences'
import { READ_ONLY_WINDOWS_ZONES, WINDOWS_ZONES, ianaZoneFor } from '../src/shared/windows-time-zones'
import { windowsZoneFor } from '../src/main/sync/graph-time-zones'
import type { CalendarEvent } from '../src/shared/event-model'

/**
 * A series is expanded in wall-clock time dressed as UTC (see expand-occurrences.ts),
 * but two things in it are not wall clock:
 *
 * - UNTIL is a real UTC instant. "This and following" writes it as the second
 *   before the cut occurrence, so west of UTC the cut day still showed (twice,
 *   after "edit following"), and east of UTC a series ending at its own last
 *   start lost that occurrence.
 * - Exchange and Outlook name zones the Windows way. "W. Europe Standard Time"
 *   is no IANA zone, so the series repeated in this computer's zone instead:
 *   a Berlin meeting seen from Vietnam was an hour off from late October.
 *
 * The old tests used no zone at all, which is why neither showed.
 */

function series(localIso: string, zone: string, rrule: string, tzid = zone): CalendarEvent {
  const start = DateTime.fromISO(localIso, { zone })
  return {
    id: 'e1',
    calendarId: 'c1',
    uid: 'u1',
    title: 'Standup',
    dtStartUtc: start.toUTC().toISO()!,
    dtEndUtc: start.plus({ minutes: 30 }).toUTC().toISO()!,
    tzid,
    allDay: false,
    rrule,
    isDeleted: false,
    createdAt: '',
    updatedAt: ''
  } as CalendarEvent
}

const at = (iso: string, zone: string): string =>
  DateTime.fromISO(iso, { zone: 'utc' }).setZone(zone).toFormat('yyyy-MM-dd HH:mm')

function shown(event: CalendarEvent, zone: string, fromIso: string, toIso: string): string[] {
  return expandOccurrences(event, [], fromIso, toIso).map((o) => at(o.startUtc, zone))
}

describe('a series cut with UNTIL', () => {
  it('west of UTC, stops before the cut day', () => {
    // 09:00 New York is 13:00Z; the cut on 10 July writes 12:59:59Z.
    const event = series('2026-07-06T09:00', 'America/New_York', 'FREQ=DAILY;UNTIL=20260710T125959Z')
    expect(shown(event, 'America/New_York', '2026-07-01T00:00:00Z', '2026-07-20T00:00:00Z')).toEqual([
      '2026-07-06 09:00',
      '2026-07-07 09:00',
      '2026-07-08 09:00',
      '2026-07-09 09:00'
    ])
  })

  it('east of UTC, keeps an occurrence that starts exactly at UNTIL', () => {
    // 09:00 Ho Chi Minh is 02:00Z; UNTIL is inclusive.
    const event = series('2026-07-06T09:00', 'Asia/Ho_Chi_Minh', 'FREQ=DAILY;UNTIL=20260710T020000Z')
    const days = shown(event, 'Asia/Ho_Chi_Minh', '2026-07-01T00:00:00Z', '2026-07-20T00:00:00Z')
    expect(days).toHaveLength(5)
    expect(days.at(-1)).toBe('2026-07-10 09:00')
  })

  it('holds across a DST change between the start and the cut', () => {
    // Sydney moves to UTC+11 on 4 October; the cut on 13 October is 08:59:59 +11.
    const event = series('2026-09-29T09:00', 'Australia/Sydney', 'FREQ=WEEKLY;UNTIL=20261012T215959Z')
    expect(shown(event, 'Australia/Sydney', '2026-09-01T00:00:00Z', '2026-11-01T00:00:00Z')).toEqual([
      '2026-09-29 09:00',
      '2026-10-06 09:00'
    ])
  })

  it('is unchanged in UTC and for all-day series', () => {
    const utc = series('2026-07-06T09:00', 'utc', 'FREQ=DAILY;UNTIL=20260709T090000Z', 'UTC')
    expect(shown(utc, 'utc', '2026-07-01T00:00:00Z', '2026-07-20T00:00:00Z')).toHaveLength(4)
  })
})

describe('"this and following" in a zone', () => {
  let db: ISqliteDatabase
  let repo: EventsRepo
  let cal: string

  beforeEach(() => {
    db = createSqliteDriver(':memory:')
    runMigrations(db)
    seedDefaultData(db)
    repo = new EventsRepo(db)
    cal = new CalendarsRepo(db).createCalendar({ name: 'Work', color: '#8b5cf6' }).id
  })

  function newYorkDaily(): string {
    return repo.createEvent({
      calendarId: cal,
      title: 'Standup',
      dtStartUtc: '2026-07-06T13:00:00.000Z', // 09:00 New York
      dtEndUtc: '2026-07-06T13:30:00.000Z',
      tzid: 'America/New_York',
      rrule: 'FREQ=DAILY'
    }).id
  }

  const days = (): string[] =>
    repo
      .queryEventsByRange([cal], '2026-07-01T00:00:00.000Z', '2026-07-14T00:00:00.000Z')
      .map((o) => at(o.startUtc, 'America/New_York'))

  it('deleting from 10 July leaves 6 to 9 July', () => {
    const id = newYorkDaily()
    repo.deleteRecurringScope({ masterEventId: id, originalStartUtc: '2026-07-10T13:00:00.000Z', scope: 'future' })
    expect(days()).toEqual(['2026-07-06 09:00', '2026-07-07 09:00', '2026-07-08 09:00', '2026-07-09 09:00'])
  })

  it('editing from 10 July shows that day once, at its new time', () => {
    const id = newYorkDaily()
    repo.updateRecurringScope({
      masterEventId: id,
      originalStartUtc: '2026-07-10T13:00:00.000Z',
      scope: 'future',
      updateInput: { dtStartUtc: '2026-07-10T14:00:00.000Z', dtEndUtc: '2026-07-10T14:30:00.000Z' }
    })
    const tenth = days().filter((d) => d.startsWith('2026-07-10'))
    expect(tenth).toEqual(['2026-07-10 10:00'])
  })
})

describe('Windows zone names', () => {
  let tz: string | undefined
  beforeEach(() => {
    tz = process.env.TZ
    process.env.TZ = 'Asia/Ho_Chi_Minh' // far from Berlin, where this computer happens to be
  })
  afterEach(() => {
    if (tz === undefined) delete process.env.TZ
    else process.env.TZ = tz
  })

  it('a Berlin meeting named the Windows way keeps 09:00 Berlin time through the October change', () => {
    const event = series('2026-10-13T09:00', 'Europe/Berlin', 'FREQ=WEEKLY;BYDAY=TU', 'W. Europe Standard Time')
    const times = shown(event, 'Europe/Berlin', '2026-10-01T00:00:00Z', '2026-11-11T00:00:00Z')
    expect(times).toEqual(['2026-10-13 09:00', '2026-10-20 09:00', '2026-10-27 09:00', '2026-11-03 09:00', '2026-11-10 09:00'])
  })

  it('knows every Windows name it lists, in this runtime', () => {
    for (const [, name] of WINDOWS_ZONES) expect(ianaZoneFor(name), name).not.toBeNull()
    for (const name of Object.keys(READ_ONLY_WINDOWS_ZONES)) expect(ianaZoneFor(name), name).not.toBeNull()
    expect(ianaZoneFor('Asia/Ho_Chi_Minh')).toBe('Asia/Ho_Chi_Minh')
    expect(ianaZoneFor('tzone://Microsoft/Custom')).toBeNull()
  })

  it('still sends Graph the same names as before', () => {
    expect(windowsZoneFor('Asia/Ho_Chi_Minh')).toBe('SE Asia Standard Time')
    expect(windowsZoneFor('Europe/Amsterdam')).toBe('W. Europe Standard Time')
    expect(windowsZoneFor('Australia/Sydney')).toBe('AUS Eastern Standard Time')
  })
})
