/**
 * The arithmetic of a printed week or month: which days are on the page,
 * which events go in which day, which hours a week grid shows, and how many
 * events a month cell has room for. One A4 page, landscape. Pure, so it is
 * tested without a page to print.
 */
import { DateTime } from 'luxon'
import type { ExpandedOccurrence } from './event-model'
import { occurrenceDateKeys } from './all-day'
import { compareOccurrencesWithinDay } from './occurrence-order'
import { startOfWeek } from './week-start'

export type PrintLayout = 'week' | 'month'

export interface PrintPeriod {
  layout: PrintLayout
  /** Rows of seven local days: one for a week, four to six for a month. */
  weeks: DateTime[][]
  /** The month a month sheet is of (its first day); a week sheet's first day. */
  anchor: DateTime
  /** The span to read events for. */
  startUtc: string
  endUtc: string
}

/** The days a sheet of `layout` around `anchor` shows. A month takes only the weeks it touches. */
export function printPeriod(layout: PrintLayout, anchor: DateTime, firstDayOfWeek: number): PrintPeriod {
  const first =
    layout === 'week' ? startOfWeek(anchor, firstDayOfWeek) : startOfWeek(anchor.startOf('month'), firstDayOfWeek)
  const lastRow = layout === 'week' ? first : startOfWeek(anchor.endOf('month'), firstDayOfWeek)
  const weeks: DateTime[][] = []
  for (let row = first; row <= lastRow; row = row.plus({ weeks: 1 })) {
    weeks.push(Array.from({ length: 7 }, (_, i) => row.plus({ days: i }).startOf('day')))
  }
  const lastDay = weeks[weeks.length - 1][6]
  return {
    layout,
    weeks,
    anchor: layout === 'week' ? first.startOf('day') : anchor.startOf('month'),
    startUtc: first.startOf('day').toUTC().toISO()!,
    endUtc: lastDay.endOf('day').toUTC().toISO()!
  }
}

/**
 * The dates (yyyy-MM-dd) an event is on. A timed event that ends at midnight
 * is not on the next day: 22:00-24:00 is one evening.
 */
export function printDays(occ: ExpandedOccurrence): string[] {
  if (occ.allDay) return occurrenceDateKeys(true, occ.startUtc, occ.endUtc)
  const start = DateTime.fromISO(occ.startUtc, { zone: 'utc' })
  const end = DateTime.fromISO(occ.endUtc, { zone: 'utc' })
  const lastInstant = end > start ? end.minus({ milliseconds: 1 }).toISO()! : occ.startUtc
  return occurrenceDateKeys(false, occ.startUtc, lastInstant)
}

/** Whether a week sheet draws the event as a bar over the days instead of a block in the hours. */
export function isBandEvent(occ: ExpandedOccurrence): boolean {
  if (occ.allDay) return true
  // A timed event of a day or more would stretch every column it is in to 24 hours.
  const ms = Date.parse(occ.endUtc) - Date.parse(occ.startUtc)
  return ms >= 24 * 60 * 60 * 1000
}

export interface BandBar {
  occ: ExpandedOccurrence
  /** 0-6, clamped to the week. */
  startCol: number
  span: number
  lane: number
}

/**
 * The bars across the top of a week sheet: each event on every day it covers
 * in `dayKeys`, stacked in lanes, earlier and longer first. Bars past
 * `maxLanes` are left out and counted under each day they would cover.
 */
export function bandLayout(
  occurrences: ExpandedOccurrence[],
  dayKeys: string[],
  maxLanes: number
): { bars: BandBar[]; lanes: number; hidden: number[] } {
  const items = occurrences
    .map((occ) => {
      const cols = printDays(occ)
        .map((key) => dayKeys.indexOf(key))
        .filter((col) => col >= 0)
      if (cols.length === 0) return null
      const startCol = Math.min(...cols)
      return { occ, startCol, endCol: Math.max(...cols) }
    })
    .filter((x): x is { occ: ExpandedOccurrence; startCol: number; endCol: number } => x !== null)
    .sort(
      (a, b) =>
        a.startCol - b.startCol || b.endCol - a.endCol || compareOccurrencesWithinDay(a.occ, b.occ)
    )

  const laneEnds: number[] = []
  const bars: BandBar[] = []
  const hidden = dayKeys.map(() => 0)
  for (const item of items) {
    let lane = laneEnds.findIndex((end) => end < item.startCol)
    if (lane === -1) {
      lane = laneEnds.length
      laneEnds.push(item.endCol)
    } else {
      laneEnds[lane] = item.endCol
    }
    if (lane < maxLanes) {
      bars.push({ occ: item.occ, startCol: item.startCol, span: item.endCol - item.startCol + 1, lane })
    } else {
      for (let col = item.startCol; col <= item.endCol; col++) hidden[col]++
    }
  }
  return { bars, lanes: Math.min(maxLanes, laneEnds.length), hidden }
}

/** Each day's events (yyyy-MM-dd), in the order a day reads: all-day first, then by start. */
export function eventsByDay(occurrences: ExpandedOccurrence[]): Map<string, ExpandedOccurrence[]> {
  const byDay = new Map<string, ExpandedOccurrence[]>()
  for (const occ of occurrences) {
    for (const key of printDays(occ)) {
      const list = byDay.get(key)
      if (list) list.push(occ)
      else byDay.set(key, [occ])
    }
  }
  for (const list of byDay.values()) list.sort(compareOccurrencesWithinDay)
  return byDay
}

/**
 * The hours a printed week grid shows: 08:00 to 18:00, widened to the whole
 * hour around every timed event on it, so nothing is cut off and an empty
 * evening does not take half the page. `spans` are minutes of the day.
 */
export function printHourWindow(spans: Array<{ startMin: number; endMin: number }>): { from: number; to: number } {
  let from = 8
  let to = 18
  for (const { startMin, endMin } of spans) {
    from = Math.min(from, Math.floor(startMin / 60))
    to = Math.max(to, Math.ceil(endMin / 60))
  }
  return { from: Math.max(0, from), to: Math.min(24, Math.max(to, from + 1)) }
}

/**
 * How many event lines fit in a month cell when the month has `rows` weeks.
 * The sizes are the page's (`.gc-print-*` in index.css): the grid is 177 mm
 * tall (a 209 mm page less 16 mm of padding, the 10 mm title and the 6 mm
 * weekday row), a cell's date takes 5 mm and a line 3.6 mm. The last line is
 * kept for "+N more" when a day has more than fit.
 */
export function monthCellLines(rows: number): number {
  return Math.max(1, Math.floor((177 / Math.max(1, rows) - 5) / 3.6))
}

/** What a month cell shows: up to `lines` events, or one fewer and how many are left out. */
export function fitCell(events: ExpandedOccurrence[], lines: number): { shown: ExpandedOccurrence[]; more: number } {
  if (events.length <= lines) return { shown: events, more: 0 }
  const shown = events.slice(0, Math.max(0, lines - 1))
  return { shown, more: events.length - shown.length }
}

/** A file name for the sheet ("xrncal 2026-11.pdf", "xrncal 2026-W45.pdf"). */
export function printFileName(period: PrintPeriod): string {
  // A week is named by the ISO week of its middle day, whichever day it starts on.
  return period.layout === 'week'
    ? `xrncal ${period.anchor.plus({ days: 3 }).toFormat("kkkk-'W'WW")}.pdf`
    : `xrncal ${period.anchor.toFormat('yyyy-MM')}.pdf`
}
