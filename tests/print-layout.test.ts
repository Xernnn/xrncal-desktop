import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { DateTime, Settings } from 'luxon'
import type { ExpandedOccurrence } from '../src/shared/event-model'
import {
  printPeriod,
  printDays,
  isBandEvent,
  bandLayout,
  eventsByDay,
  printHourWindow,
  monthCellLines,
  fitCell,
  printFileName
} from '../src/shared/print-layout'

// UTC+7 all year, as in the e2e suite.
const zone = Settings.defaultZone
beforeAll(() => {
  Settings.defaultZone = 'Asia/Ho_Chi_Minh'
})
afterAll(() => {
  Settings.defaultZone = zone
})

const local = (iso: string) => DateTime.fromISO(iso)
const utc = (localIso: string) => DateTime.fromISO(localIso).toUTC().toISO()!

function occ(id: string, start: string, end: string, allDay = false, title = id): ExpandedOccurrence {
  return {
    id,
    eventId: id,
    calendarId: 'cal',
    title,
    startUtc: allDay ? `${start}T00:00:00.000Z` : utc(start),
    endUtc: allDay ? `${end}T00:00:00.000Z` : utc(end),
    tzid: 'Asia/Ho_Chi_Minh',
    allDay,
    isRecurring: false,
    isException: false,
    originalStartUtc: allDay ? `${start}T00:00:00.000Z` : utc(start)
  }
}

describe('printPeriod', () => {
  it('a week is seven days from the first day of the week', () => {
    const week = printPeriod('week', local('2026-11-05'), 1)
    expect(week.weeks).toHaveLength(1)
    expect(week.weeks[0].map((d) => d.toISODate())).toEqual([
      '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08'
    ])
    expect(week.startUtc).toBe('2026-11-01T17:00:00.000Z')
    expect(week.endUtc).toBe('2026-11-08T16:59:59.999Z')
    expect(printPeriod('week', local('2026-11-05'), 0).weeks[0][0].toISODate()).toBe('2026-11-01')
    expect(printPeriod('week', local('2026-11-05'), 6).weeks[0][0].toISODate()).toBe('2026-10-31')
  })

  it('a month takes only the weeks it touches', () => {
    // November 2026 starts on a Sunday and ends on a Monday: six Monday weeks.
    const nov = printPeriod('month', local('2026-11-18'), 1)
    expect(nov.weeks).toHaveLength(6)
    expect(nov.weeks[0][0].toISODate()).toBe('2026-10-26')
    expect(nov.weeks[5][6].toISODate()).toBe('2026-12-06')
    expect(nov.anchor.toISODate()).toBe('2026-11-01')
    // February 2026 is exactly four Sunday weeks.
    expect(printPeriod('month', local('2026-02-10'), 0).weeks).toHaveLength(4)
    expect(printPeriod('month', local('2026-02-10'), 1).weeks).toHaveLength(5)
  })
})

describe('printDays', () => {
  it('an all-day span is every date it covers', () => {
    expect(printDays(occ('a', '2026-11-03', '2026-11-05', true))).toEqual(['2026-11-03', '2026-11-04', '2026-11-05'])
  })

  it('an evening that ends at midnight is one day; one that runs past it is two', () => {
    expect(printDays(occ('a', '2026-11-03T22:00', '2026-11-04T00:00'))).toEqual(['2026-11-03'])
    expect(printDays(occ('a', '2026-11-03T22:00', '2026-11-04T01:00'))).toEqual(['2026-11-03', '2026-11-04'])
  })
})

describe('isBandEvent', () => {
  it('all-day events and timed ones of a day or more go across the top', () => {
    expect(isBandEvent(occ('a', '2026-11-03', '2026-11-03', true))).toBe(true)
    expect(isBandEvent(occ('a', '2026-11-03T09:00', '2026-11-05T17:00'))).toBe(true)
    expect(isBandEvent(occ('a', '2026-11-03T22:00', '2026-11-04T01:00'))).toBe(false)
  })
})

describe('bandLayout', () => {
  const days = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08']

  it('stacks overlapping bars and reuses a lane once it is free', () => {
    const { bars, lanes, hidden } = bandLayout(
      [
        occ('short', '2026-11-03', '2026-11-03', true),
        occ('long', '2026-11-03', '2026-11-05', true),
        occ('later', '2026-11-06', '2026-11-06', true),
        occ('before', '2026-10-30', '2026-11-02', true)
      ],
      days,
      4
    )
    expect(bars.map((b) => [b.occ.id, b.startCol, b.span, b.lane])).toEqual([
      ['before', 0, 1, 0],
      ['long', 1, 3, 0],
      ['short', 1, 1, 1],
      ['later', 4, 1, 0]
    ])
    expect(lanes).toBe(2)
    expect(hidden).toEqual([0, 0, 0, 0, 0, 0, 0])
  })

  it('counts what does not fit under each day it would cover', () => {
    const { bars, lanes, hidden } = bandLayout(
      [
        occ('a', '2026-11-03', '2026-11-03', true),
        occ('b', '2026-11-03', '2026-11-03', true),
        occ('c', '2026-11-03', '2026-11-04', true)
      ],
      days,
      2
    )
    // The longer bar is placed first, so it is a one-day bar that is left out.
    expect(bars.map((b) => b.occ.id)).toEqual(['c', 'a'])
    expect(lanes).toBe(2)
    expect(hidden).toEqual([0, 1, 0, 0, 0, 0, 0])
  })

  it('leaves out events outside the week', () => {
    expect(bandLayout([occ('a', '2026-11-10', '2026-11-10', true)], days, 4)).toEqual({
      bars: [],
      lanes: 0,
      hidden: [0, 0, 0, 0, 0, 0, 0]
    })
  })
})

describe('eventsByDay', () => {
  it('files each event under every day it is on, all-day first', () => {
    const byDay = eventsByDay([
      occ('late', '2026-11-03T18:00', '2026-11-03T19:00'),
      occ('early', '2026-11-03T08:00', '2026-11-03T09:00'),
      occ('trip', '2026-11-03', '2026-11-04', true)
    ])
    expect(byDay.get('2026-11-03')!.map((o) => o.id)).toEqual(['trip', 'early', 'late'])
    expect(byDay.get('2026-11-04')!.map((o) => o.id)).toEqual(['trip'])
  })
})

describe('printHourWindow', () => {
  it('is 08:00-18:00 unless an event is outside it', () => {
    expect(printHourWindow([])).toEqual({ from: 8, to: 18 })
    expect(printHourWindow([{ startMin: 9 * 60, endMin: 17 * 60 }])).toEqual({ from: 8, to: 18 })
    expect(printHourWindow([{ startMin: 6 * 60 + 30, endMin: 7 * 60 }, { startMin: 20 * 60, endMin: 21 * 60 + 15 }])).toEqual({
      from: 6,
      to: 22
    })
    expect(printHourWindow([{ startMin: 23 * 60, endMin: 24 * 60 }])).toEqual({ from: 8, to: 24 })
    expect(printHourWindow([{ startMin: 0, endMin: 30 }])).toEqual({ from: 0, to: 18 })
  })
})

describe('month cells', () => {
  it('fit fewer lines the more weeks the month has', () => {
    expect(monthCellLines(4)).toBeGreaterThan(monthCellLines(6))
    expect(monthCellLines(6)).toBeGreaterThanOrEqual(5)
    expect(monthCellLines(100)).toBe(1)
  })

  it('keep the last line for how many more there are', () => {
    const list = ['a', 'b', 'c', 'd'].map((id) => occ(id, '2026-11-03T08:00', '2026-11-03T09:00'))
    expect(fitCell(list, 4)).toEqual({ shown: list, more: 0 })
    expect(fitCell(list, 3)).toEqual({ shown: list.slice(0, 2), more: 2 })
    expect(fitCell(list, 1)).toEqual({ shown: [], more: 4 })
  })
})

describe('printFileName', () => {
  it('names a month by its month and a week by its ISO week', () => {
    expect(printFileName(printPeriod('month', local('2026-11-18'), 1))).toBe('xrncal 2026-11.pdf')
    expect(printFileName(printPeriod('week', local('2026-11-05'), 1))).toBe('xrncal 2026-W45.pdf')
    // A Sunday week is still named by the ISO week most of it is in.
    expect(printFileName(printPeriod('week', local('2026-11-05'), 0))).toBe('xrncal 2026-W45.pdf')
    // The week of 1 January 2027 belongs to ISO 2026's week 53.
    expect(printFileName(printPeriod('week', local('2027-01-01'), 1))).toBe('xrncal 2026-W53.pdf')
  })
})
