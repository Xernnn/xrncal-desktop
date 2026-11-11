import { describe, it, expect } from 'vitest'
import { expandOccurrences } from '../src/shared/expand-occurrences'
import type { CalendarEvent, EventException } from '../src/shared/event-model'

describe('expandOccurrences', () => {
  const baseEvent: CalendarEvent = {
    id: 'evt-1',
    calendarId: 'cal-1',
    uid: 'uid-1@xrncal.calendar',
    title: 'Team Standup',
    dtStartUtc: '2026-08-03T09:00:00.000Z',
    dtEndUtc: '2026-08-03T09:30:00.000Z',
    tzid: 'UTC',
    allDay: false,
    dirty: false,
    isDeleted: false,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z'
  }

  it('should expand a non-recurring event within date window', () => {
    const occs = expandOccurrences(
      baseEvent,
      [],
      '2026-08-01T00:00:00.000Z',
      '2026-08-10T00:00:00.000Z'
    )
    expect(occs).toHaveLength(1)
    expect(occs[0].title).toBe('Team Standup')
    expect(occs[0].startUtc).toBe('2026-08-03T09:00:00.000Z')
    expect(occs[0].isRecurring).toBe(false)
  })

  it('should return empty when non-recurring event is outside date window', () => {
    const occs = expandOccurrences(
      baseEvent,
      [],
      '2026-08-10T00:00:00.000Z',
      '2026-08-20T00:00:00.000Z'
    )
    expect(occs).toHaveLength(0)
  })

  it('should expand weekly recurring event across multiple weeks', () => {
    const recurringEvent: CalendarEvent = {
      ...baseEvent,
      rrule: 'FREQ=WEEKLY;BYDAY=MO'
    }

    // Window covering 4 Mondays in August 2026: Aug 3, 10, 17, 24, 31
    const occs = expandOccurrences(
      recurringEvent,
      [],
      '2026-08-01T00:00:00.000Z',
      '2026-08-31T23:59:59.999Z'
    )

    expect(occs).toHaveLength(5)
    expect(occs.every((o) => o.isRecurring)).toBe(true)
    expect(occs[0].startUtc).toBe('2026-08-03T09:00:00.000Z')
    expect(occs[1].startUtc).toBe('2026-08-10T09:00:00.000Z')
    expect(occs[2].startUtc).toBe('2026-08-17T09:00:00.000Z')
    expect(occs[3].startUtc).toBe('2026-08-24T09:00:00.000Z')
    expect(occs[4].startUtc).toBe('2026-08-31T09:00:00.000Z')
  })

  it('should respect COUNT limit in RRULE', () => {
    const countEvent: CalendarEvent = {
      ...baseEvent,
      rrule: 'FREQ=WEEKLY;COUNT=3'
    }

    const occs = expandOccurrences(
      countEvent,
      [],
      '2026-08-01T00:00:00.000Z',
      '2026-08-31T23:59:59.999Z'
    )

    expect(occs).toHaveLength(3)
  })

  it('should exclude dates listed in EXDATE', () => {
    const exdateEvent: CalendarEvent = {
      ...baseEvent,
      rrule: 'FREQ=WEEKLY;BYDAY=MO',
      exdate: '2026-08-10T09:00:00.000Z,2026-08-24T09:00:00.000Z'
    }

    const occs = expandOccurrences(
      exdateEvent,
      [],
      '2026-08-01T00:00:00.000Z',
      '2026-08-31T23:59:59.999Z'
    )

    // 5 mondays minus 2 excluded mondays = 3
    expect(occs).toHaveLength(3)
    const dates = occs.map((o) => o.startUtc)
    expect(dates).toContain('2026-08-03T09:00:00.000Z')
    expect(dates).not.toContain('2026-08-10T09:00:00.000Z')
    expect(dates).toContain('2026-08-17T09:00:00.000Z')
    expect(dates).not.toContain('2026-08-24T09:00:00.000Z')
    expect(dates).toContain('2026-08-31T09:00:00.000Z')
  })

  it('should apply modified occurrence exception', () => {
    const recurringEvent: CalendarEvent = {
      ...baseEvent,
      rrule: 'FREQ=WEEKLY;BYDAY=MO'
    }

    const exception: EventException = {
      id: 'ex-1',
      masterEventId: 'evt-1',
      originalStartUtc: '2026-08-10T09:00:00.000Z',
      isCancelled: false,
      title: 'Rescheduled Special Standup',
      dtStartUtc: '2026-08-10T14:00:00.000Z',
      dtEndUtc: '2026-08-10T14:45:00.000Z',
      tzid: 'UTC',
      createdAt: '2026-08-02T00:00:00.000Z',
      updatedAt: '2026-08-02T00:00:00.000Z'
    }

    const occs = expandOccurrences(
      recurringEvent,
      [exception],
      '2026-08-01T00:00:00.000Z',
      '2026-08-15T23:59:59.999Z'
    )

    expect(occs).toHaveLength(2)
    expect(occs[0].title).toBe('Team Standup')
    expect(occs[1].title).toBe('Rescheduled Special Standup')
    expect(occs[1].startUtc).toBe('2026-08-10T14:00:00.000Z')
    expect(occs[1].endUtc).toBe('2026-08-10T14:45:00.000Z')
    expect(occs[1].isException).toBe(true)
  })

  it('should omit cancelled occurrence exception', () => {
    const recurringEvent: CalendarEvent = {
      ...baseEvent,
      rrule: 'FREQ=WEEKLY;BYDAY=MO'
    }

    const cancelledException: EventException = {
      id: 'ex-cancel',
      masterEventId: 'evt-1',
      originalStartUtc: '2026-08-17T09:00:00.000Z',
      isCancelled: true,
      createdAt: '2026-08-02T00:00:00.000Z',
      updatedAt: '2026-08-02T00:00:00.000Z'
    }

    const occs = expandOccurrences(
      recurringEvent,
      [cancelledException],
      '2026-08-01T00:00:00.000Z',
      '2026-08-31T23:59:59.999Z'
    )

    expect(occs).toHaveLength(4)
    const dates = occs.map((o) => o.startUtc)
    expect(dates).not.toContain('2026-08-17T09:00:00.000Z')
  })

  describe('lunar-recurring master (âm lịch anniversaries)', () => {
    const lunarMaster: CalendarEvent = {
      ...baseEvent,
      id: 'evt-lunar',
      title: 'Giỗ ông nội',
      allDay: true,
      dtStartUtc: '2024-04-18T00:00:00.000Z',
      dtEndUtc: '2024-04-18T23:59:59.999Z',
      lunarRule: { day: 10, month: 3, leap: false }
    }

    it('emits one all-day occurrence per Gregorian year in range', () => {
      const occs = expandOccurrences(
        lunarMaster,
        [],
        '2025-01-01T00:00:00.000Z',
        '2027-12-31T23:59:59.999Z'
      )
      expect(occs.map((o) => o.startUtc)).toEqual([
        '2025-04-07T00:00:00.000Z',
        '2026-04-26T00:00:00.000Z',
        '2027-04-16T00:00:00.000Z'
      ])
      expect(occs.every((o) => o.allDay && o.isRecurring)).toBe(true)
      expect(occs[0].title).toBe('Giỗ ông nội')
    })

    it('honors an EXDATE for a single year', () => {
      const occs = expandOccurrences(
        { ...lunarMaster, exdate: '2026-04-26' },
        [],
        '2025-01-01T00:00:00.000Z',
        '2027-12-31T23:59:59.999Z'
      )
      expect(occs.map((o) => o.startUtc)).toEqual([
        '2025-04-07T00:00:00.000Z',
        '2027-04-16T00:00:00.000Z'
      ])
    })

    it('skips years already covered by a materialized instance', () => {
      const occs = expandOccurrences(
        lunarMaster,
        [],
        '2025-01-01T00:00:00.000Z',
        '2027-12-31T23:59:59.999Z',
        new Set([2026])
      )
      expect(occs.map((o) => o.startUtc)).toEqual([
        '2025-04-07T00:00:00.000Z',
        '2027-04-16T00:00:00.000Z'
      ])
    })

    it('applies a per-year exception override', () => {
      const exception: EventException = {
        id: 'ex-lunar',
        masterEventId: 'evt-lunar',
        originalStartUtc: '2026-04-26T00:00:00.000Z',
        isCancelled: false,
        title: 'Giỗ ông nội (làm sớm)',
        dtStartUtc: '2026-04-25T00:00:00.000Z',
        dtEndUtc: '2026-04-25T23:59:59.999Z',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      }
      const occs = expandOccurrences(
        lunarMaster,
        [exception],
        '2026-01-01T00:00:00.000Z',
        '2026-12-31T23:59:59.999Z'
      )
      expect(occs).toHaveLength(1)
      expect(occs[0].title).toBe('Giỗ ông nội (làm sớm)')
      expect(occs[0].startUtc).toBe('2026-04-25T00:00:00.000Z')
      expect(occs[0].isException).toBe(true)
    })
  })
})

/**
 * An .ics DATE reads back with the zone 'floating', which Luxon cannot resolve.
 * Expanding in it made every date invalid, the rule threw, and the series fell
 * back to its first occurrence: every all-day series pulled over CalDAV -
 * birthdays, a weekly placeholder - showed once and never again.
 */
describe('a series in a zone Luxon cannot resolve', () => {
  const allDay: CalendarEvent = {
    id: 'weekly',
    calendarId: 'cal',
    uid: 'weekly@example.com',
    title: 'Sanctuary + Tantarus',
    dtStartUtc: '2025-11-25T00:00:00.000Z',
    dtEndUtc: '2025-11-25T23:59:59.999Z',
    tzid: 'floating',
    allDay: true,
    rrule: 'FREQ=WEEKLY;BYDAY=TU',
    exdate: '2025-12-09T00:00:00.000Z',
    dirty: false,
    isDeleted: false,
    createdAt: '',
    updatedAt: ''
  }

  it('repeats an all-day series on its dates, with its skips and moved weeks', () => {
    const moved: EventException = {
      id: 'x',
      masterEventId: 'weekly',
      originalStartUtc: '2025-12-16T00:00:00.000Z',
      dtStartUtc: '2025-12-15T00:00:00.000Z',
      dtEndUtc: '2025-12-15T01:00:00.000Z',
      tzid: 'Australia/Sydney',
      allDay: false,
      isCancelled: false,
      createdAt: '',
      updatedAt: ''
    }
    const occs = expandOccurrences(allDay, [moved], '2025-11-20T00:00:00.000Z', '2025-12-31T00:00:00.000Z')
    expect(occs.map((o) => [o.startUtc, o.allDay])).toEqual([
      ['2025-11-25T00:00:00.000Z', true],
      ['2025-12-02T00:00:00.000Z', true],
      ['2025-12-15T00:00:00.000Z', false],
      ['2025-12-23T00:00:00.000Z', true],
      ['2025-12-30T00:00:00.000Z', true]
    ])
  })

  it('keeps all-day dates on their day across a summer-time change, whatever the zone says', () => {
    const sydney = { ...allDay, tzid: 'Australia/Sydney', exdate: undefined }
    const occs = expandOccurrences(sydney, [], '2026-03-30T00:00:00.000Z', '2026-04-20T00:00:00.000Z')
    expect(occs.map((o) => o.startUtc)).toEqual([
      '2026-03-31T00:00:00.000Z',
      '2026-04-07T00:00:00.000Z',
      '2026-04-14T00:00:00.000Z'
    ])
  })

  it('repeats a timed series in this computer\'s zone', () => {
    const timed = { ...allDay, allDay: false, dtStartUtc: '2025-11-25T09:00:00.000Z', dtEndUtc: '2025-11-25T10:00:00.000Z', exdate: undefined }
    const occs = expandOccurrences(timed, [], '2025-11-20T00:00:00.000Z', '2025-12-10T00:00:00.000Z')
    expect(occs).toHaveLength(3)
  })
})

/**
 * Rules come from feeds and invitations, and rrule.js has no limit of its own:
 * each of these froze the main process (51 s, 0.65 s, 4.75 s per 200-byte
 * event; a feed holds thousands). bounded-rrule.ts has the details.
 */
describe('a rule that would cost too much to expand', () => {
  const series: CalendarEvent = {
    id: 'feed-1',
    calendarId: 'feed',
    uid: 'feed-1@example.com',
    title: 'x',
    dtStartUtc: '2026-10-05T09:00:00.000Z',
    dtEndUtc: '2026-10-05T09:01:00.000Z',
    tzid: 'UTC',
    allDay: false,
    dirty: false,
    isDeleted: false,
    createdAt: '',
    updatedAt: ''
  }
  const october = ['2026-10-01T00:00:00.000Z', '2026-10-31T23:59:59.999Z'] as const

  it('shows a secondly series once, at its start, like a rule it cannot read', () => {
    const occs = expandOccurrences({ ...series, rrule: 'FREQ=SECONDLY' }, [], ...october)
    expect(occs.map((o) => o.startUtc)).toEqual(['2026-10-05T09:00:00.000Z'])
  })

  it('shows nothing for a rule that can never match', () => {
    const occs = expandOccurrences({ ...series, rrule: 'FREQ=DAILY;BYMONTH=2;BYMONTHDAY=30' }, [], ...october)
    expect(occs).toEqual([])
  })

  it('does not go back centuries for the dates of a series whose every date lasts centuries', () => {
    // One 200-byte event: each date of it is still running two centuries
    // later, so every one since 1900 overlapped any range asked for - 46,000
    // occurrences and most of a second for ten minutes of the reminder check,
    // which runs every 30 s, and 700,000 with 24 times a day.
    const endless = { ...series, dtStartUtc: '1900-01-01T09:00:00.000Z', dtEndUtc: '2100-01-01T09:00:00.000Z', rrule: 'FREQ=DAILY' }
    const occs = expandOccurrences(endless, [], '2026-10-05T00:00:00.000Z', '2026-10-05T00:10:00.000Z')
    // The dates of the year before the range, and no further back.
    expect(occs.length).toBeGreaterThan(300)
    expect(occs.length).toBeLessThanOrEqual(367)
    expect(occs.at(-1)?.startUtc).toBe('2026-10-04T09:00:00.000Z')
  })

  it('still shows a yearly event of several months part-way through it', () => {
    const term = { ...series, dtStartUtc: '2020-06-01T00:00:00.000Z', dtEndUtc: '2020-09-15T00:00:00.000Z', rrule: 'FREQ=YEARLY' }
    const occs = expandOccurrences(term, [], '2026-09-01T00:00:00.000Z', '2026-09-07T00:00:00.000Z')
    expect(occs.map((o) => o.startUtc)).toEqual(['2026-06-01T00:00:00.000Z'])
  })

  it('still finds this month of a daily series that started in the year 1000', () => {
    const ancient = { ...series, dtStartUtc: '1000-01-01T09:00:00.000Z', dtEndUtc: '1000-01-01T09:01:00.000Z', rrule: 'FREQ=DAILY' }
    const occs = expandOccurrences(ancient, [], ...october)
    expect(occs).toHaveLength(31)
    expect(occs[30].startUtc).toBe('2026-10-31T09:00:00.000Z')
  })
})
