import type { DateTime } from 'luxon'

/** The days a week can start on, as `AppSettings.firstDayOfWeek` stores them. */
export const WEEK_START_CHOICES = [1, 0, 6] as const

/** `AppSettings.firstDayOfWeek` (0 = Sunday, 1 = Monday, 6 = Saturday) as a
 *  Luxon weekday (1 = Monday … 7 = Sunday). Anything else is Monday. */
export function toLuxonWeekStart(firstDayOfWeek: number): number {
  if (firstDayOfWeek === 0) return 7
  if (firstDayOfWeek === 6) return 6
  return 1
}

/** Midnight on the first day of the week `date` falls in. Luxon's own
 *  `startOf('week')` is always Monday. */
export function startOfWeek(date: DateTime, firstDayOfWeek: number): DateTime {
  const offset = (date.weekday - toLuxonWeekStart(firstDayOfWeek) + 7) % 7
  return date.minus({ days: offset }).startOf('day')
}

/** The seven Luxon weekdays in the order the week is drawn. */
export function weekdayOrder(firstDayOfWeek: number): number[] {
  const first = toLuxonWeekStart(firstDayOfWeek)
  return Array.from({ length: 7 }, (_, i) => ((first - 1 + i) % 7) + 1)
}

/** The ISO week number for a row of seven days drawn from `rowStart`. ISO
 *  weeks are named by their Thursday, which is in every row whatever day the
 *  row starts on, so a Sunday-first row is still numbered the way the rest of
 *  the world numbers it. */
export function isoWeekOfRow(rowStart: DateTime): number {
  for (let i = 0; i < 7; i++) {
    const day = rowStart.plus({ days: i })
    if (day.weekday === 4) return day.weekNumber
  }
  return rowStart.weekNumber
}
