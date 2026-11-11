import { useCallback, useEffect, useRef, useState } from 'react'
import { DateTime } from 'luxon'
import { minutesFromPointer } from './drop-target'
import { formatClockTimeStr, type TimeFormatPref } from '@shared/time-format'
import { useDisplayPreferences } from '../context/DisplayPreferencesContext'
import { atClockMinutes } from '@shared/clock-minutes'
import { newEventEnd } from '@shared/event-length'

interface SlotDragPreview {
  dayKey: string
  topPos: number
  height: number
  clientX: number
  clientY: number
  label: string
}

interface DragState {
  day: DateTime
  dayKey: string
  columnTop: number
  anchorMinutes: number
  currentMinutes: number
  clientX: number
  clientY: number
}

/** Below this span, a drag reads as a plain click - the new event gets the default length. */
const CLICK_THRESHOLD_MINUTES = 15

const DAY_MINUTES = 24 * 60

/**
 * What a finished gesture on `day`'s hour grid selects, from the earlier and
 * later of the minutes it touched. A range that was dragged is kept as it was
 * dragged; a click, which has no range of its own, gets the length chosen in
 * Settings - past midnight onto the next day when it was that late.
 */
export function slotRange(
  day: DateTime,
  loMinutes: number,
  hiMinutes: number,
  defaultEventMinutes: number
): { start: DateTime; end: DateTime } {
  // By clock face: on a day the clocks change, startOf('day').plus({ minutes })
  // turns a drag across the 17:00 row into an event at 16:00 or 18:00.
  const start = atClockMinutes(day, loMinutes)
  const end =
    hiMinutes - loMinutes < CLICK_THRESHOLD_MINUTES
      ? newEventEnd(start, defaultEventMinutes)
      : atClockMinutes(day, hiMinutes)
  return { start, end }
}

function formatRangeLabel(startMin: number, endMin: number, timeFormat: TimeFormatPref): string {
  // An end at or past midnight is a time on the next day: "00:30", not "24:30"
  // (which the AM/PM clock then showed as 12:30 PM).
  const fmt = (m: number) =>
    formatClockTimeStr(
      `${String(Math.floor((m % DAY_MINUTES) / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`,
      timeFormat
    )
  const durMin = endMin - startMin
  const hours = Math.floor(durMin / 60)
  const rest = durMin % 60
  const duration = hours > 0 && rest > 0 ? `${hours}h ${rest}m` : hours > 0 ? `${hours}h` : `${rest}m`
  return `${fmt(startMin)}–${fmt(endMin)} · ${duration}`
}

/**
 * Click-and-drag slot selection for the timed grid: mouse down + drag sets both the
 * start and the duration of a new event in one gesture (a plain click with no drag
 * gets the default length from Settings, see slotRange).
 */
export function useSlotDragSelect(options: {
  hourHeight: number
  onComplete: (start: DateTime, end: DateTime, meta: { clientX: number }) => void
}) {
  const { hourHeight, onComplete } = options
  const { timeFormat, dragSnapMinutes, defaultEventMinutes } = useDisplayPreferences()
  const [preview, setPreview] = useState<SlotDragPreview | null>(null)

  const buildPreview = useCallback(
    (drag: DragState): SlotDragPreview => {
      const lo = Math.min(drag.anchorMinutes, drag.currentMinutes)
      const hi = Math.max(drag.anchorMinutes, drag.currentMinutes)
      // Before the pointer has moved, what a click here would make.
      const shownHi = hi === lo ? lo + defaultEventMinutes : hi
      return {
        dayKey: drag.dayKey,
        topPos: (lo / 60) * hourHeight,
        // The box stops at the foot of the day's column; the label still says
        // when the event ends.
        height: ((Math.min(shownHi, DAY_MINUTES) - lo) / 60) * hourHeight,
        clientX: drag.clientX,
        clientY: drag.clientY,
        label: formatRangeLabel(lo, shownHi, timeFormat)
      }
    },
    [hourHeight, timeFormat, defaultEventMinutes]
  )

  // The listeners of the drag in progress, taken down together when it ends
  // (or if the grid goes away mid-drag).
  const listeners = useRef<AbortController | null>(null)
  useEffect(() => () => listeners.current?.abort(), [])

  const startDrag = useCallback(
    (e: React.MouseEvent, day: DateTime, dayKey: string) => {
      if (e.button !== 0) return
      // Don't hijack drags/clicks that started on an existing event card.
      if ((e.target as HTMLElement).closest('.gc-event')) return

      const rect = e.currentTarget.getBoundingClientRect()
      const minutes = minutesFromPointer(e.clientY, rect.top, hourHeight, dragSnapMinutes)
      const drag: DragState = {
        day,
        dayKey,
        columnTop: rect.top,
        anchorMinutes: minutes,
        currentMinutes: minutes,
        clientX: e.clientX,
        clientY: e.clientY
      }
      setPreview(buildPreview(drag))

      listeners.current?.abort()
      const controller = new AbortController()
      listeners.current = controller

      const onMove = (ev: MouseEvent): void => {
        // The moving edge may reach midnight; the anchor below may not.
        drag.currentMinutes = minutesFromPointer(ev.clientY, drag.columnTop, hourHeight, dragSnapMinutes, true)
        drag.clientX = ev.clientX
        drag.clientY = ev.clientY
        setPreview(buildPreview(drag))
      }

      const onUp = (): void => {
        controller.abort()
        setPreview(null)

        const lo = Math.min(drag.anchorMinutes, drag.currentMinutes)
        const hi = Math.max(drag.anchorMinutes, drag.currentMinutes)
        const { start, end } = slotRange(drag.day, lo, hi, defaultEventMinutes)
        onComplete(start, end, { clientX: drag.clientX })
      }

      window.addEventListener('mousemove', onMove, { signal: controller.signal })
      window.addEventListener('mouseup', onUp, { signal: controller.signal })
    },
    [hourHeight, dragSnapMinutes, defaultEventMinutes, buildPreview, onComplete]
  )

  return { preview, startDrag }
}
