import { DateTime } from 'luxon'
import { toLuxonWeekStart } from './week-start'

export { toLuxonWeekStart }

/** 0 = Sunday, 1 = Monday, 6 = Saturday (matches AppSettings.firstDayOfWeek). */

const WEEKDAY_LABELS_MON: string[] = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN']
const WEEKDAY_LABELS_SUN: string[] = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7']

const WEEKDAY_LABELS_SAT: string[] = ['T7', 'CN', 'T2', 'T3', 'T4', 'T5', 'T6']

export function weekdayHeaders(firstDayOfWeek: number): string[] {
  if (firstDayOfWeek === 0) return WEEKDAY_LABELS_SUN
  if (firstDayOfWeek === 6) return WEEKDAY_LABELS_SAT
  return WEEKDAY_LABELS_MON
}

/**
 * Build a 42-cell month grid starting on the configured first weekday.
 */
export function buildMiniCalendarDays(
  anchorDate: DateTime,
  firstDayOfWeek: number = 1
): DateTime[] {
  const monthStart = anchorDate.startOf('month')
  const weekStart = toLuxonWeekStart(firstDayOfWeek)
  const startOffset = (monthStart.weekday - weekStart + 7) % 7
  const gridStart = monthStart.minus({ days: startOffset }).startOf('day')
  return Array.from({ length: 42 }, (_, i) => gridStart.plus({ days: i }))
}

export const DEFAULT_EVENT_COLOR = '#529cca'
export const DEFAULT_ACCENT_COLOR = '#5865f2'
export const TODAY_COLOR = '#eb5757'


