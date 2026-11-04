import { useCallback, useMemo, useState } from 'react'
import type { DateTime } from 'luxon'
import type { CalendarViewType, VisibleRange } from '@shared/visible-range'

// List view starts with a modest window and grows as the user scrolls near an
// edge, instead of always fetching a huge fixed range.
const LIST_BASE_DAYS_BEFORE = 14
const LIST_BASE_DAYS_AFTER = 30
const LIST_EXPAND_STEP_DAYS = 60

interface ListGrowth {
  /** The view and date it was grown for; anywhere else it starts again. */
  key: string
  before: number
  after: number
}

/**
 * The span of events to read: the visible range, except in List view, which
 * reads around the anchor date and grows each time `extendList` is called.
 */
export function useQueryRange(
  anchorDate: DateTime,
  view: CalendarViewType,
  visibleRange: VisibleRange
): { queryRange: VisibleRange; extendList: (direction: 'past' | 'future') => void } {
  const key = `${view}|${anchorDate.toMillis()}`
  const [growth, setGrowth] = useState<ListGrowth>({ key, before: 0, after: 0 })
  // Moving to another view or date starts List over - read here rather than
  // reset in an effect, so the first read already has the plain range.
  const before = growth.key === key ? growth.before : 0
  const after = growth.key === key ? growth.after : 0

  const extendList = useCallback(
    (direction: 'past' | 'future') => {
      setGrowth((prev) => {
        const base = prev.key === key ? prev : { key, before: 0, after: 0 }
        return direction === 'past'
          ? { ...base, before: base.before + LIST_EXPAND_STEP_DAYS }
          : { ...base, after: base.after + LIST_EXPAND_STEP_DAYS }
      })
    },
    [key]
  )

  const queryRange = useMemo(() => {
    // Year needs no special case: it shows exactly one year, and visibleRange
    // already spans startOf('year') to endOf('year').
    if (view !== 'list') return visibleRange
    const start = anchorDate.minus({ days: LIST_BASE_DAYS_BEFORE + before }).startOf('day')
    const end = anchorDate.plus({ days: LIST_BASE_DAYS_AFTER + after }).endOf('day')
    return {
      startUtc: start.toUTC().toISO() || start.toISO()!,
      endUtc: end.toUTC().toISO() || end.toISO()!,
      label: visibleRange.label
    }
  }, [view, anchorDate, before, after, visibleRange])

  return { queryRange, extendList }
}
