import { DateTime } from 'luxon'
import { describe, expect, it } from 'vitest'
import type { ExpandedOccurrence } from '../src/shared/event-model'
import { segmentDayMinutes, segmentTimedOccurrence } from '../src/shared/timed-event-segments'

function occ(
  partial: Partial<ExpandedOccurrence> & { start: DateTime; end: DateTime }
): ExpandedOccurrence {
  const { start, end, ...rest } = partial
  return {
    id: rest.id || 'evt_1',
    eventId: 'evt',
    calendarId: 'cal',
    title: 'Test',
    startUtc: start.toUTC().toISO()!,
    endUtc: end.toUTC().toISO()!,
    tzid: 'local',
    allDay: false,
    isRecurring: false,
    isException: false,
    originalStartUtc: start.toUTC().toISO()!,
    ...rest
  }
}

describe('segmentTimedOccurrence', () => {
  it('keeps a same-day timed event as one first+last segment', () => {
    const start = DateTime.local(2026, 8, 19, 10, 0, 0)
    const end = DateTime.local(2026, 8, 19, 11, 15, 0)
    const segments = segmentTimedOccurrence(occ({ start, end }))
    expect(segments).toHaveLength(1)
    expect(segments[0].isFirst).toBe(true)
    expect(segments[0].isLast).toBe(true)
    expect(segments[0].dateKey).toBe('2026-08-19')
    expect(segmentDayMinutes(segments[0])).toEqual({ startMin: 10 * 60, endMin: 11 * 60 + 15 })
  })

  it('splits overnight events across two local days', () => {
    const start = DateTime.local(2026, 8, 18, 22, 0, 0)
    const end = DateTime.local(2026, 8, 19, 2, 0, 0)
    const segments = segmentTimedOccurrence(occ({ start, end }))
    expect(segments.map((s) => s.dateKey)).toEqual(['2026-08-18', '2026-08-19'])
    expect(segments[0].isFirst).toBe(true)
    expect(segments[0].isLast).toBe(false)
    expect(segments[1].isFirst).toBe(false)
    expect(segments[1].isLast).toBe(true)
    expect(segmentDayMinutes(segments[0]).endMin).toBe(24 * 60)
    expect(segmentDayMinutes(segments[1])).toEqual({ startMin: 0, endMin: 120 })
  })

  it('treats exclusive midnight as ending on the previous day', () => {
    const start = DateTime.local(2026, 8, 18, 22, 0, 0)
    const end = DateTime.local(2026, 8, 19, 0, 0, 0)
    const segments = segmentTimedOccurrence(occ({ start, end }))
    expect(segments).toHaveLength(1)
    expect(segments[0].dateKey).toBe('2026-08-18')
    expect(segments[0].isLast).toBe(true)
  })

  it('returns no segments for all-day events', () => {
    const start = DateTime.local(2026, 8, 19)
    const segments = segmentTimedOccurrence(
      occ({ start, end: start.plus({ days: 1 }), allDay: true, id: 'all' })
    )
    expect(segments).toHaveLength(0)
  })

  it('repeats the clock window on each day when a daytime event spans dates', () => {
    const start = DateTime.local(2026, 8, 18, 10, 0, 0)
    const end = DateTime.local(2026, 8, 20, 11, 0, 0)
    const segments = segmentTimedOccurrence(occ({ start, end }))
    expect(segments.map((s) => s.dateKey)).toEqual(['2026-08-18', '2026-08-19', '2026-08-20'])
    expect(segments.map((s) => segmentDayMinutes(s))).toEqual([
      { startMin: 10 * 60, endMin: 11 * 60 },
      { startMin: 10 * 60, endMin: 11 * 60 },
      { startMin: 10 * 60, endMin: 11 * 60 }
    ])
  })
})

describe('segmentTimedOccurrence for the days on screen', () => {
  const week = { first: DateTime.local(2026, 8, 17), last: DateTime.local(2026, 8, 23) }

  it('slices only the days shown of an event that runs for centuries', () => {
    // What a feed or an invitation can carry; every day of it used to be sliced on each render.
    const forever = occ({ start: DateTime.local(1900, 1, 1, 22, 0, 0), end: DateTime.local(2100, 1, 1, 6, 0, 0) })

    const segments = segmentTimedOccurrence(forever, week)

    expect(segments.map((s) => s.dateKey)).toEqual([
      '2026-08-17',
      '2026-08-18',
      '2026-08-19',
      '2026-08-20',
      '2026-08-21',
      '2026-08-22',
      '2026-08-23'
    ])
    expect(segments.every((s) => !s.isFirst && !s.isLast)).toBe(true)
    expect(segments[0].startLocal.toFormat('HH:mm')).toBe('00:00')
  })

  it('gives the same slices as before for the days it is asked about', () => {
    const start = DateTime.local(2026, 8, 16, 22, 0, 0)
    const end = DateTime.local(2026, 8, 18, 6, 0, 0)
    const all = segmentTimedOccurrence(occ({ start, end }))
    const shown = segmentTimedOccurrence(occ({ start, end }), week)

    expect(all.map((s) => s.dateKey)).toEqual(['2026-08-16', '2026-08-17', '2026-08-18'])
    expect(shown.map((s) => [s.dateKey, s.startLocal.toISO(), s.endLocal.toISO(), s.isFirst, s.isLast])).toEqual(
      all.slice(1).map((s) => [s.dateKey, s.startLocal.toISO(), s.endLocal.toISO(), s.isFirst, s.isLast])
    )
  })

  it('returns nothing for an event outside the days shown', () => {
    const start = DateTime.local(2026, 8, 30, 10, 0, 0)
    expect(segmentTimedOccurrence(occ({ start, end: start.plus({ hours: 1 }) }), week)).toEqual([])
  })
})
