import React, { useEffect, useLayoutEffect, useRef } from 'react'
import { sortOccurrencesWithinDay } from '@shared/occurrence-order'
import { occurrenceDateKey } from '@shared/all-day'
import { DateTime } from 'luxon'
import { useTranslation } from 'react-i18next'
import { CalendarDays, Clock, MapPin, Repeat, Layers } from 'lucide-react'
import type { ExpandedOccurrence } from '@shared/event-model'
import { TODAY_COLOR, DEFAULT_EVENT_COLOR } from '@shared/mini-calendar-grid'
import { formatClockTime } from '@shared/time-format'
import { useDisplayPreferences } from '../context/DisplayPreferencesContext'
import LunarLabel from '../components/LunarLabel'
import { useToday } from '../hooks/use-now'

interface ListViewProps {
  anchorDate: DateTime
  occurrences: ExpandedOccurrence[]
  showLunar: boolean
  /** The occurrence the keyboard cursor is on, drawn with a ring. */
  selectedOccurrenceId?: string | null
  onSelectOccurrence?: (occ: ExpandedOccurrence) => void
  onAddEvent?: () => void
  /** Scrolled near the top/bottom of what's currently loaded - ask for more. */
  onNearEdge?: (direction: 'past' | 'future') => void
}

const NEAR_EDGE_PX = 600

export const ListView: React.FC<ListViewProps> = ({
  anchorDate,
  occurrences,
  showLunar,
  selectedOccurrenceId,
  onSelectOccurrence,
  onAddEvent,
  onNearEdge
}) => {
  const { t, i18n } = useTranslation()
  const { timeFormat } = useDisplayPreferences()
  const today = useToday()
  const scrollRef = useRef<HTMLDivElement>(null)
  const groupRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  // The anchor date stays at the top until the user scrolls. The list draws
  // first with whatever the previous view had loaded, then with its own range,
  // then with the past it asks for when it lands near the top - each of which
  // moves the anchor's group, and a one-off scroll left the list weeks away.
  const anchorPinnedRef = useRef(true)
  const programmaticScrollRef = useRef(false)
  const lastAnchorKeyRef = useRef('')
  const edgeRequestedRef = useRef<{ past: boolean; future: boolean }>({ past: false, future: false })
  // Once the user has scrolled: the group at the top of the view, and how far
  // below the top it sat, so loading more past events can put it back.
  const keepInPlaceRef = useRef<{ key: string; offset: number } | null>(null)

  const groupedOccurrences = React.useMemo(() => {
    const groups: { date: DateTime; items: ExpandedOccurrence[] }[] = []
    const map = new Map<string, ExpandedOccurrence[]>()

    for (const occ of occurrences) {
      const key = occurrenceDateKey(occ.allDay, occ.startUtc)
      const list = map.get(key) || []
      list.push(occ)
      map.set(key, list)
    }

    const sortedKeys = Array.from(map.keys()).sort()
    for (const key of sortedKeys) {
      groups.push({
        date: DateTime.fromFormat(key, 'yyyy-MM-dd'),
        // Same ordering rule as the month grid: all-day first, then by start.
        items: sortOccurrencesWithinDay(map.get(key)!)
      })
    }

    return groups
  }, [occurrences])

  // Focus on today (or wherever anchorDate points) until the user scrolls, then
  // stay put across routine data refreshes so editing an event elsewhere
  // doesn't yank the scroll.
  useEffect(() => {
    const anchorKey = anchorDate.toFormat('yyyy-MM-dd')
    if (anchorKey !== lastAnchorKeyRef.current) anchorPinnedRef.current = true
    lastAnchorKeyRef.current = anchorKey
    if (!anchorPinnedRef.current) return
    if (groupedOccurrences.length === 0) return

    let closestKey: string | null = null
    for (const { date } of groupedOccurrences) {
      const key = date.toFormat('yyyy-MM-dd')
      if (key === anchorKey) {
        closestKey = key
        break
      }
      if (key > anchorKey && !closestKey) closestKey = key
    }
    if (!closestKey) closestKey = groupedOccurrences[groupedOccurrences.length - 1].date.toFormat('yyyy-MM-dd')

    requestAnimationFrame(() => {
      const el = groupRefs.current.get(closestKey!)
      if (!el) return
      programmaticScrollRef.current = true
      el.scrollIntoView({ block: 'start' })
    })
  }, [anchorDate, groupedOccurrences])

  // New data landing means the loaded range actually grew - allow asking again.
  useEffect(() => {
    edgeRequestedRef.current = { past: false, future: false }
  }, [occurrences])

  // Loading more past events inserts groups above the current scroll position -
  // put the group that was at the top back where it was. (Adding the change in
  // scroll height instead also counted groups that landed below, and jumped.)
  useLayoutEffect(() => {
    const el = scrollRef.current
    const keep = keepInPlaceRef.current
    keepInPlaceRef.current = null
    if (!el || !keep || anchorPinnedRef.current) return
    const group = groupRefs.current.get(keep.key)
    if (!group) return
    const offset = group.getBoundingClientRect().top - el.getBoundingClientRect().top
    if (Math.abs(offset - keep.offset) > 1) {
      programmaticScrollRef.current = true
      el.scrollTop += offset - keep.offset
    }
  }, [groupedOccurrences])

  /** The group at the top of the view and its distance from the top. */
  const topGroup = (el: HTMLDivElement): { key: string; offset: number } | null => {
    const top = el.getBoundingClientRect().top
    // Map order is the order groups mounted, not date order, once past ones arrive.
    const byDate = [...groupRefs.current].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    for (const [key, group] of byDate) {
      const rect = group.getBoundingClientRect()
      if (rect.bottom > top) return { key, offset: rect.top - top }
    }
    return null
  }

  const handleScroll = () => {
    const el = scrollRef.current
    if (!el) return
    // The user scrolling, not us: from here on the list stays where they put it.
    if (programmaticScrollRef.current) programmaticScrollRef.current = false
    else anchorPinnedRef.current = false
    if (!onNearEdge) return
    const { scrollTop, scrollHeight, clientHeight } = el

    if (scrollTop < NEAR_EDGE_PX && !edgeRequestedRef.current.past) {
      edgeRequestedRef.current.past = true
      keepInPlaceRef.current = topGroup(el)
      onNearEdge('past')
    } else if (scrollHeight - clientHeight - scrollTop < NEAR_EDGE_PX && !edgeRequestedRef.current.future) {
      edgeRequestedRef.current.future = true
      onNearEdge('future')
    }
  }

  if (occurrences.length === 0) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center bg-surface p-8 text-center select-none">
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-hover">
          <CalendarDays className="h-8 w-8 text-accent" />
        </div>
        <h3 className="mb-2 text-lg font-semibold text-primary">
          {anchorDate.setLocale(i18n.language).toFormat('MMMM yyyy')}
        </h3>
        <p className="mb-5 max-w-sm text-sm text-muted">{t('list.empty')}</p>
        <button type="button" onClick={onAddEvent} className="gc-btn-primary">
          + {t('list.addEvent')}
        </button>
      </div>
    )
  }

  return (
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      className="h-full w-full space-y-6 overflow-y-auto bg-surface p-5 select-none"
    >
      {groupedOccurrences.map(({ date, items }) => {
        const isToday = date.hasSame(today, 'day')
        const isWeekend = date.weekday >= 6
        const totalDayCount = items.length
        const dateKey = date.toFormat('yyyy-MM-dd')
        const dateFormat = date.year === today.year ? 'cccc, d MMMM' : 'cccc, d MMMM yyyy'

        return (
          <div
            key={dateKey}
            data-today-group={isToday || undefined}
            ref={(el) => {
              if (el) groupRefs.current.set(dateKey, el)
              else groupRefs.current.delete(dateKey)
            }}
            // Today gets its own tinted band around the whole day (heading + events),
            // not just red text on the date pill - otherwise it reads the same as a
            // plain weekend day, which only tints its date text.
            className={`gc-stack-container space-y-2.5 rounded-lg ${isToday ? '-mx-3 px-3 py-2' : ''}`}
            style={
              isToday
                ? { backgroundColor: `${TODAY_COLOR}0f`, boxShadow: `inset 3px 0 0 ${TODAY_COLOR}` }
                : undefined
            }
          >
            <div className="sticky top-0 z-10 flex items-center justify-between gap-3 bg-surface/90 backdrop-blur-md py-1.5 border-b border-hairline">
              <div className="flex min-w-0 items-center gap-2">
                <span
                  className={`truncate rounded-full px-3 py-1 text-sm font-semibold ${
                    isWeekend && !isToday ? 'text-today' : ''
                  }`}
                  style={isToday ? { color: '#fff', backgroundColor: TODAY_COLOR } : undefined}
                >
                  {date.setLocale(i18n.language).toFormat(dateFormat)}
                </span>
                {/* Beside the date, not out at the row's far end: mùng 1 and rằm
                    are read with the date they fall on. */}
                {showLunar && (
                  <LunarLabel day={date.day} month={date.month} year={date.year} full className="shrink-0" />
                )}
                {totalDayCount >= 2 && (
                  <span className="flex shrink-0 items-center gap-1 text-[10px] font-medium text-muted bg-hover px-1.5 py-0.5 rounded-[3px] border border-hairline font-mono">
                    <Layers className="w-3 h-3 text-muted" />
                    {totalDayCount}
                  </span>
                )}
              </div>
            </div>

            <div className="grid gap-2 pl-1">
              {items.map((occ, idx) => {
                const startDt = DateTime.fromISO(occ.startUtc, { zone: 'utc' }).setZone('local')
                const endDt = DateTime.fromISO(occ.endUtc, { zone: 'utc' }).setZone('local')
                const bg = occ.color || DEFAULT_EVENT_COLOR

                return (
                  <button
                    type="button"
                    key={occ.id}
                    onClick={() => onSelectOccurrence?.(occ)}
                    data-selected-occurrence={selectedOccurrenceId === occ.id || undefined}
                    data-occurrence-id={occ.id}
                    className={`gc-event gc-stack-card-3d flex w-full cursor-pointer flex-col gap-1 rounded-[3px] px-3.5 py-3 text-left text-white shadow-xs sm:flex-row sm:items-center sm:justify-between ${
                      selectedOccurrenceId === occ.id ? 'is-key-selected' : ''
                    }`}
                    style={{
                      backgroundColor: bg,
                      animationDelay: `${idx * 20}ms`
                    }}
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="text-sm font-semibold">{occ.title}</h4>
                        {occ.isRecurring && <Repeat className="h-3.5 w-3.5 opacity-80" />}
                      </div>
                    </div>
                    <div className="flex items-center gap-3 text-xs opacity-90">
                      <span className="inline-flex items-center gap-1 font-mono">
                        <Clock className="h-3.5 w-3.5" />
                        {occ.allDay
                          ? t('list.allDay')
                          : `${formatClockTime(startDt, timeFormat)} - ${formatClockTime(endDt, timeFormat)}`}
                      </span>
                      {occ.location && (
                        <span className="inline-flex max-w-[150px] items-center gap-1 truncate">
                          <MapPin className="h-3.5 w-3.5 shrink-0" />
                          {occ.location}
                        </span>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}

export default ListView
