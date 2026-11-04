import { useMemo } from 'react'
import { DateTime } from 'luxon'
import { getVisibleRange, type CalendarViewType, type VisibleRange } from '@shared/visible-range'

export type { CalendarViewType, VisibleRange }
export { getVisibleRange }

export function useVisibleRange(
  anchorDate: DateTime,
  view: CalendarViewType,
  locale: string = 'vi',
  firstDayOfWeek: number = 1
): VisibleRange {
  return useMemo(
    () => getVisibleRange(anchorDate, view, locale, firstDayOfWeek),
    [anchorDate, view, locale, firstDayOfWeek]
  )
}
