import { DateTime } from 'luxon'
import { startOfWeek } from './week-start'

export type CalendarViewType = 'day' | 'week' | 'month' | 'year' | 'list'

export interface VisibleRange {
  startUtc: string
  endUtc: string
  label: string
}

/**
 * Calculate the exact query date range and human label for the current view and anchor date
 */
export function getVisibleRange(
  anchorDate: DateTime,
  view: CalendarViewType,
  locale: string = 'vi',
  /** AppSettings.firstDayOfWeek: 0 = Sunday, 1 = Monday, 6 = Saturday. */
  firstDayOfWeek: number = 1
): VisibleRange {
  let start: DateTime = anchorDate
  let end: DateTime = anchorDate
  let label: string = ''

  const isVi = locale === 'vi'
  // Weekday and month names come out of Luxon in the DateTime's own locale, not
  // the app's - so a label built from a bare anchorDate read "Thursday" with the
  // whole UI in Vietnamese. Range maths stays on anchorDate: weekday, weekNumber
  // and startOf() are ISO here and a locale must not be able to shift them.
  const labelDate = anchorDate.setLocale(locale)

  switch (view) {
    case 'month': {
      // The first day of the week the month starts in.
      start = startOfWeek(anchorDate.startOf('month'), firstDayOfWeek)
      // 42 days total (6 weeks x 7 days)
      end = start.plus({ days: 41 }).endOf('day')
      label = isVi
        ? `Tháng ${anchorDate.month}, ${anchorDate.year}`
        : `${labelDate.toFormat('MMMM yyyy')}`
      break
    }
    case 'week': {
      start = startOfWeek(anchorDate, firstDayOfWeek)
      end = start.plus({ days: 6 }).endOf('day')
      const startFmt = start.toFormat('dd/MM')
      const endFmt = end.toFormat('dd/MM/yyyy')
      label = isVi
        ? `Tuần ${anchorDate.weekNumber} (${startFmt} – ${endFmt})`
        : `Week ${anchorDate.weekNumber} (${start.setLocale(locale).toFormat('MMM d')} – ${end
            .setLocale(locale)
            .toFormat('MMM d, yyyy')})`
      break
    }
    case 'day': {
      start = anchorDate.startOf('day')
      end = anchorDate.endOf('day')
      label = isVi
        ? `${labelDate.toFormat('cccc, dd/MM/yyyy')}`
        : `${labelDate.toFormat('cccc, MMMM d, yyyy')}`
      break
    }
    case 'year': {
      start = anchorDate.startOf('year')
      end = anchorDate.endOf('year')
      label = String(anchorDate.year)
      break
    }
    case 'list': {
      // Generous window either side of anchor - list view is meant to be freely
      // scrollable, not just a narrow slice around "today".
      start = anchorDate.minus({ days: 90 }).startOf('day')
      end = anchorDate.plus({ days: 180 }).endOf('day')
      // No header title for list view - each group's own sticky date heading already
      // says what date it is, so a static "Schedule (Month)" label above it is redundant.
      label = ''
      break
    }
  }

  return {
    startUtc: start.toUTC().toISO() || start.toISO()!,
    endUtc: end.toUTC().toISO() || end.toISO()!,
    label
  }
}

/**
 * The header title for a week: the month it is in ("October 2026"), or both
 * months when it spans two ("Oct – Nov 2026", "Dec 2026 – Jan 2027"). The
 * columns already carry the day numbers; what they do not say is the month.
 */
export function weekTitle(weekStart: DateTime, locale: string = 'vi'): string {
  const first = weekStart.setLocale(locale)
  const last = weekStart.plus({ days: 6 }).setLocale(locale)
  const isVi = locale === 'vi'
  if (first.month === last.month) {
    return isVi ? `Tháng ${first.month}, ${first.year}` : first.toFormat('MMMM yyyy')
  }
  if (first.year === last.year) {
    return isVi
      ? `Tháng ${first.month} – ${last.month}, ${first.year}`
      : `${first.toFormat('MMM')} – ${last.toFormat('MMM yyyy')}`
  }
  return isVi
    ? `Tháng ${first.month}, ${first.year} – Tháng ${last.month}, ${last.year}`
    : `${first.toFormat('MMM yyyy')} – ${last.toFormat('MMM yyyy')}`
}
