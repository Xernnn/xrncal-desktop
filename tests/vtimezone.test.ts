import { describe, it, expect } from 'vitest'
import ICAL from 'ical.js'
import { DateTime } from 'luxon'
import { vtimezoneLines, writableZone } from '../src/main/ics/vtimezone'
import { generateIcs } from '../src/main/ics/write-ics'
import { parseIcsContent } from '../src/main/ics/parse-ics'
import type { Calendar, CalendarEvent, EventException } from '../src/shared/event-model'

/**
 * Timed events are written in their own zone, with a VTIMEZONE worked out from
 * the zone database. Every other client - and xrncal itself on the next pull -
 * turns those clock times back into instants through that block alone, so it
 * has to agree with the zone database on every day it covers.
 */

/** Reads clock times in `zone` the way ical.js does for a DTSTART;TZID, with
 *  our VTIMEZONE as the only definition of the zone. */
function reader(zone: string, fromYear: number): (wall: DateTime) => number {
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//test//EN', ...vtimezoneLines(zone, fromYear), 'END:VCALENDAR']
  const tz = new ICAL.Timezone(new ICAL.Component(ICAL.parse(ics.join('\r\n'))).getFirstSubcomponent('vtimezone')!)
  return (wall) =>
    new ICAL.Time({ year: wall.year, month: wall.month, day: wall.day, hour: wall.hour, minute: wall.minute, second: 0 }, tz).toUnixTime() * 1000
}

/** [zone, first year, whether its present rules can be trusted past the span]. */
const ZONES: [string, number, boolean][] = [
  ['Australia/Sydney', 2026, true],
  ['Australia/Sydney', 2024, true],
  // Sydney moved its summer time in 2008; the older years are listed one by one.
  ['Australia/Sydney', 2006, true],
  ['Asia/Ho_Chi_Minh', 2026, true],
  ['Europe/Berlin', 2026, true],
  ['America/New_York', 2026, true],
  // The US moved its summer time in 2007.
  ['America/New_York', 2005, true],
  ['Pacific/Auckland', 2026, true],
  ['Asia/Kolkata', 2026, true],
  ['Asia/Kathmandu', 2026, true],
  ['America/St_Johns', 2026, true],
  // Changes at midnight, on Saturdays' end.
  ['America/Santiago', 2026, true],
  // Half-hour summer time.
  ['Australia/Lord_Howe', 2026, true],
  // Summer time kept all year from 2011, then a new standard offset in 2014.
  ['Europe/Moscow', 2010, true],
  // Summer time on fixed dates, abolished in 2022.
  ['Asia/Tehran', 2021, true],
  // Summer time abolished in 2019.
  ['America/Sao_Paulo', 2018, true],
  // Summer time paused for Ramadan: no yearly rule fits, nothing to go on past the span.
  ['Africa/Casablanca', 2024, false]
]

describe('VTIMEZONE from the zone database', () => {
  it.each(ZONES)(
    '%s from %i reads back at the instant it was written, every day of the span',
    (zone, year, beyond) => {
      const readBack = reader(zone, year)
      const start = DateTime.utc(year, 1, 1, 0, 30)
      const end = DateTime.utc(Math.max(year, DateTime.utc().year) + 1 + (beyond ? 5 : 0), 12, 31)
      let checked = 0
      // 13 hours: steps through every hour of the day as the days go by.
      for (let instant = start; instant < end; instant = instant.plus({ hours: 13 })) {
        const wall = instant.setZone(zone)
        // A clock time that happens twice (the hour summer time ends) or not at
        // all cannot name one instant in any format; leave those out.
        if (wall.minus({ hours: 1 }).offset !== wall.offset || wall.plus({ hours: 1 }).offset !== wall.offset) continue
        expect(readBack(wall), `${zone} ${instant.toISO()}`).toBe(instant.toMillis())
        checked++
      }
      expect(checked).toBeGreaterThan(1000)
    },
    30_000
  )

  it("states Sydney's rules as yearly rules, like other clients do", () => {
    const lines = vtimezoneLines('Australia/Sydney', 2026)
    expect(lines).toEqual([
      'BEGIN:VTIMEZONE',
      'TZID:Australia/Sydney',
      'BEGIN:STANDARD',
      'DTSTART:20250406T030000',
      'RRULE:FREQ=YEARLY;BYMONTH=4;BYDAY=1SU',
      'TZOFFSETFROM:+1100',
      'TZOFFSETTO:+1000',
      'END:STANDARD',
      'BEGIN:DAYLIGHT',
      'DTSTART:20251005T020000',
      'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=1SU',
      'TZOFFSETFROM:+1000',
      'TZOFFSETTO:+1100',
      'END:DAYLIGHT',
      'END:VTIMEZONE'
    ])
  })

  it('picks "last Sunday" for Europe and "second Sunday" for the US', () => {
    expect(vtimezoneLines('Europe/Berlin', 2026)).toContain('RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU')
    expect(vtimezoneLines('Europe/Berlin', 2026)).toContain('RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU')
    expect(vtimezoneLines('America/New_York', 2026)).toContain('RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU')
    expect(vtimezoneLines('America/New_York', 2026)).toContain('RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU')
  })

  it('gives a zone without summer time one observance', () => {
    expect(vtimezoneLines('Asia/Ho_Chi_Minh', 2026)).toEqual([
      'BEGIN:VTIMEZONE',
      'TZID:Asia/Ho_Chi_Minh',
      'BEGIN:STANDARD',
      'DTSTART:19700101T000000',
      'TZOFFSETFROM:+0700',
      'TZOFFSETTO:+0700',
      'END:STANDARD',
      'END:VTIMEZONE'
    ])
  })

  it('writes UTC and zones it cannot name as UTC', () => {
    expect(writableZone('Australia/Sydney')).toBe('Australia/Sydney')
    expect(writableZone('UTC')).toBeNull()
    expect(writableZone('Etc/UTC')).toBeNull()
    expect(writableZone('floating')).toBeNull()
    expect(writableZone(undefined)).toBeNull()
  })
})

const CALENDAR: Calendar = {
  id: 'cal',
  accountId: 'acc',
  name: 'Home',
  color: '#529cca',
  isVisible: true,
  isReadOnly: false,
  isDefault: true,
  createdAt: '',
  updatedAt: ''
}

function event(over: Partial<CalendarEvent>): CalendarEvent {
  return {
    id: 'e1',
    calendarId: 'cal',
    uid: 'e1',
    title: 'Standup',
    dtStartUtc: '2026-03-04T22:00:00.000Z',
    dtEndUtc: '2026-03-04T22:30:00.000Z',
    tzid: 'Australia/Sydney',
    allDay: false,
    dirty: false,
    isDeleted: false,
    createdAt: '',
    updatedAt: '',
    ...over
  }
}

describe('generateIcs writes a timed event in its own zone', () => {
  it('keeps the zone, the instants, the skipped dates and the moved occurrence through a round trip', () => {
    // Thursdays 09:00 in Sydney, either side of the end of summer time on 5 April.
    const series = event({
      rrule: 'FREQ=WEEKLY;BYDAY=TH;UNTIL=20260430T130000Z',
      exdate: '2026-03-11T22:00:00.000Z,2026-04-15T23:00:00.000Z'
    })
    const moved: EventException = {
      id: 'x1',
      masterEventId: 'e1',
      originalStartUtc: '2026-04-08T23:00:00.000Z',
      dtStartUtc: '2026-04-09T00:00:00.000Z',
      dtEndUtc: '2026-04-09T00:30:00.000Z',
      isCancelled: false,
      createdAt: '',
      updatedAt: ''
    }
    const ics = generateIcs(CALENDAR, [series], [moved])

    expect(ics).toContain('DTSTART;TZID=Australia/Sydney:20260305T090000')
    expect(ics).toContain('EXDATE;TZID=Australia/Sydney:20260312T090000,20260416T090000')
    expect(ics).toContain('RECURRENCE-ID;TZID=Australia/Sydney:20260409T090000')
    expect(ics.indexOf('BEGIN:VTIMEZONE')).toBeLessThan(ics.indexOf('BEGIN:VEVENT'))

    const back = parseIcsContent(ics, 'cal')
    expect(back.events[0]).toMatchObject({
      tzid: 'Australia/Sydney',
      dtStartUtc: series.dtStartUtc,
      dtEndUtc: series.dtEndUtc,
      rrule: series.rrule,
      exdate: series.exdate
    })
    expect(back.exceptions[0]).toMatchObject({
      originalStartUtc: moved.originalStartUtc,
      dtStartUtc: moved.dtStartUtc,
      dtEndUtc: moved.dtEndUtc
    })
  })

  it('turns an UNTIL that is not UTC into one, as RFC 5545 asks with a zoned start', () => {
    const ics = generateIcs(CALENDAR, [event({ rrule: 'FREQ=WEEKLY;UNTIL=20261231' })])
    // The end of 31 December in Sydney (UTC+11).
    expect(ics).toContain('RRULE:FREQ=WEEKLY;UNTIL=20261231T125959Z')
  })

  it('still writes UTC, and no VTIMEZONE, for an event in UTC or without a zone', () => {
    for (const tzid of ['UTC', 'floating']) {
      const ics = generateIcs(CALENDAR, [event({ tzid })])
      expect(ics).toContain('DTSTART:20260304T220000Z')
      expect(ics).not.toContain('VTIMEZONE')
    }
  })

  it('defines each zone once for a file of many events, from the earliest year in it', () => {
    const ics = generateIcs(CALENDAR, [
      event({ id: 'a', uid: 'a' }),
      event({ id: 'b', uid: 'b', dtStartUtc: '2023-06-01T00:00:00.000Z', dtEndUtc: '2023-06-01T01:00:00.000Z' }),
      event({ id: 'c', uid: 'c', tzid: 'Asia/Ho_Chi_Minh' }),
      event({ id: 'd', uid: 'd', allDay: true, dtStartUtc: '2026-03-05T00:00:00.000Z', dtEndUtc: '2026-03-05T23:59:59.999Z' })
    ])
    expect(ics.match(/TZID:Australia\/Sydney\r\n/g)).toHaveLength(1)
    expect(ics.match(/TZID:Asia\/Ho_Chi_Minh\r\n/g)).toHaveLength(1)
    expect(ics).toContain('DTSTART:20220403T030000')
    expect(ics).toContain('DTSTART;VALUE=DATE:20260305')
  })
})
