import { DateTime } from 'luxon'
import type { ExpandedOccurrence } from './event-model'
import { clockMinutesOfDay } from './clock-minutes'

export interface TimedSegment {
  occ: ExpandedOccurrence
  dateKey: string
  startLocal: DateTime
  endLocal: DateTime
  isFirst: boolean
  isLast: boolean
}

/**
 * Split a timed occurrence into local calendar-day slices.
 * Exclusive midnight end stays on the previous day (22:00–24:00 is one segment).
 *
 * `days` is the span of days on screen, and only those are sliced. Without it
 * every day the occurrence covers is, and the grid then kept the ones it
 * shows: an event running twenty years cost 7,000 slices on each render of
 * the week, and one from the year 1 to 9999 - which a feed or an invitation
 * can carry - 3.6 million, a window that never drew again.
 */
export function segmentTimedOccurrence(
  occ: ExpandedOccurrence,
  days?: { first: DateTime; last: DateTime }
): TimedSegment[] {
  if (occ.allDay) return []

  const start = DateTime.fromISO(occ.startUtc, { zone: 'utc' }).setZone('local')
  const end = DateTime.fromISO(occ.endUtc, { zone: 'utc' }).setZone('local')
  if (!start.isValid || !end.isValid || end <= start) return []

  const lastDay = isExclusiveMidnight(end) ? end.minus({ milliseconds: 1 }).startOf('day') : end.startOf('day')
  const spansDays = lastDay > start.startOf('day')
  const startClock = start.hour * 60 + start.minute
  const endClock = end.hour * 60 + end.minute
  const useClockWindow = spansDays && startClock < endClock

  const segments: TimedSegment[] = []
  let cursor: DateTime = start.startOf('day')
  let stop: DateTime = lastDay
  if (days) {
    const first = days.first.setZone('local').startOf('day')
    const last = days.last.setZone('local').startOf('day')
    if (first > cursor) cursor = first
    if (last < stop) stop = last
  }

  while (cursor <= stop) {
    let segStart: DateTime
    let segEnd: DateTime
    if (useClockWindow) {
      segStart = cursor.set({ hour: start.hour, minute: start.minute, second: 0, millisecond: 0 })
      segEnd = cursor.set({ hour: end.hour, minute: end.minute, second: 0, millisecond: 0 })
    } else {
      const dayEnd = cursor.plus({ days: 1 })
      segStart = start > cursor ? start : cursor
      segEnd = end < dayEnd ? end : dayEnd
    }
    if (segEnd > segStart) {
      segments.push({
        occ,
        dateKey: cursor.toFormat('yyyy-MM-dd'),
        startLocal: segStart,
        endLocal: segEnd,
        isFirst: cursor.hasSame(start, 'day'),
        isLast: cursor.hasSame(lastDay, 'day')
      })
    }
    cursor = cursor.plus({ days: 1 })
  }

  return segments
}

/**
 * Where a segment sits on its day's hour grid, by clock face. Elapsed minutes
 * put every event an hour early on the day the clocks spring forward, and an
 * hour late on the day they fall back.
 */
export function segmentDayMinutes(segment: TimedSegment): { startMin: number; endMin: number } {
  const day = DateTime.fromFormat(segment.dateKey, 'yyyy-MM-dd')
  const startMin = clockMinutesOfDay(segment.startLocal, day)
  const endMin = Math.max(startMin + 1, clockMinutesOfDay(segment.endLocal, day))
  return { startMin, endMin }
}

function isExclusiveMidnight(dt: DateTime): boolean {
  return dt.hour === 0 && dt.minute === 0 && dt.second === 0 && dt.millisecond === 0
}
