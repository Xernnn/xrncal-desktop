import { describe, it, expect } from 'vitest'
import { DateTime } from 'luxon'
import { isoWeekOfRow, startOfWeek, toLuxonWeekStart, weekdayOrder } from '../src/shared/week-start'
import { getVisibleRange, weekTitle } from '../src/shared/visible-range'
import { buildMiniCalendarDays } from '../src/shared/mini-calendar-grid'

// Wednesday 21 October 2026.
const wednesday = DateTime.fromISO('2026-10-21T15:30:00', { zone: 'Asia/Ho_Chi_Minh' })

describe('week start', () => {
  it('maps the setting to a Luxon weekday, Monday for anything unknown', () => {
    expect(toLuxonWeekStart(1)).toBe(1)
    expect(toLuxonWeekStart(0)).toBe(7)
    expect(toLuxonWeekStart(6)).toBe(6)
    expect(toLuxonWeekStart(3)).toBe(1)
  })

  it('finds the first day of the week for each start', () => {
    expect(startOfWeek(wednesday, 1).toISODate()).toBe('2026-10-19') // Monday
    expect(startOfWeek(wednesday, 0).toISODate()).toBe('2026-10-18') // Sunday
    expect(startOfWeek(wednesday, 6).toISODate()).toBe('2026-10-17') // Saturday
    expect(startOfWeek(wednesday, 0).hour).toBe(0)
    // A day that is itself the first day of the week stays put.
    expect(startOfWeek(DateTime.fromISO('2026-10-18'), 0).toISODate()).toBe('2026-10-18')
  })

  it('orders the weekday headers from the first day', () => {
    expect(weekdayOrder(1)).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(weekdayOrder(0)).toEqual([7, 1, 2, 3, 4, 5, 6])
    expect(weekdayOrder(6)).toEqual([6, 7, 1, 2, 3, 4, 5])
  })

  it('numbers a row by its Thursday, so a Sunday-first row keeps its ISO week', () => {
    expect(isoWeekOfRow(DateTime.fromISO('2026-10-19'))).toBe(43) // Mon 19 - Sun 25
    expect(isoWeekOfRow(DateTime.fromISO('2026-10-18'))).toBe(43) // Sun 18 - Sat 24
    // 3 Jan 2027 is a Sunday; that row's Thursday is 7 Jan, in ISO week 1.
    expect(isoWeekOfRow(DateTime.fromISO('2027-01-03'))).toBe(1)
  })

  it('starts month and week ranges on the chosen day', () => {
    const sundayWeek = getVisibleRange(wednesday, 'week', 'en', 0)
    expect(DateTime.fromISO(sundayWeek.startUtc).setZone('Asia/Ho_Chi_Minh').toISODate()).toBe('2026-10-18')
    const sundayMonth = getVisibleRange(wednesday, 'month', 'en', 0)
    // October 2026 starts on a Thursday; a Sunday-first grid opens on 27 September.
    expect(DateTime.fromISO(sundayMonth.startUtc).setZone('Asia/Ho_Chi_Minh').toISODate()).toBe('2026-09-27')
    expect(getVisibleRange(wednesday, 'month', 'en').startUtc).not.toBe(sundayMonth.startUtc)
  })

  it('lays the mini calendar out from a Saturday too', () => {
    expect(buildMiniCalendarDays(wednesday, 6)[0].weekday).toBe(6)
  })
})

describe('week title', () => {
  it('names the month a week is in, or both months it spans', () => {
    expect(weekTitle(DateTime.fromISO('2026-10-19'), 'en')).toBe('October 2026')
    expect(weekTitle(DateTime.fromISO('2026-10-19'), 'vi')).toBe('Tháng 10, 2026')
    expect(weekTitle(DateTime.fromISO('2026-10-26'), 'en')).toBe('Oct – Nov 2026')
    expect(weekTitle(DateTime.fromISO('2026-10-26'), 'vi')).toBe('Tháng 10 – 11, 2026')
    expect(weekTitle(DateTime.fromISO('2026-12-28'), 'en')).toBe('Dec 2026 – Jan 2027')
  })
})
