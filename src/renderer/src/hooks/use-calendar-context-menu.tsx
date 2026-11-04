import { useCallback, useEffect, useEffectEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DateTime } from 'luxon'
import { CalendarPlus, Copy, CalendarDays, Pencil, Trash2 } from 'lucide-react'
import type { Calendar, ExpandedOccurrence } from '@shared/event-model'
import type { ContextMenuEntry } from '../components/ui'

export interface OpenContextMenu {
  at: { x: number; y: number }
  entries: ContextMenuEntry[]
  label: string
}

interface ContextMenuActions {
  occurrences: ExpandedOccurrence[]
  calendars: Calendar[]
  /** Put the keyboard cursor on the event right-clicked. */
  select: (occ: ExpandedOccurrence) => void
  open: (occ: ExpandedOccurrence) => void
  duplicate: (occ: ExpandedOccurrence) => void
  remove: (occ: ExpandedOccurrence) => void
  newEventAt: (start: DateTime, end: DateTime, allDay: boolean, clientX: number) => void
  openDay: (day: DateTime) => void
}

/**
 * Right-click: on an event, what can be done to it; on an empty day or hour, a
 * new event there. Found through the data attributes the views put on events
 * (`data-occurrence-id`) and on days (`data-day`, with `data-hour-height` on
 * the hour grid).
 */
export function useCalendarContextMenu(actions: ContextMenuActions): {
  menu: OpenContextMenu | null
  close: () => void
} {
  const { t, i18n } = useTranslation()
  const [menu, setMenu] = useState<OpenContextMenu | null>(null)

  // Reads the occurrences and calendars on screen when the click comes, so the
  // listener is bound once rather than after every render.
  const onContextMenu = useEffectEvent((e: MouseEvent): void => {
    const target = e.target as HTMLElement
    if (target.closest('input, textarea, [contenteditable="true"], [role="dialog"], [role="menu"]')) return
    const at = { x: e.clientX, y: e.clientY }

    const eventEl = target.closest<HTMLElement>('[data-occurrence-id]')
    if (eventEl) {
      const occ = actions.occurrences.find((o) => o.id === eventEl.dataset.occurrenceId)
      if (!occ) return
      e.preventDefault()
      actions.select(occ)
      const readOnly = Boolean(actions.calendars.find((c) => c.id === occ.calendarId)?.isReadOnly)
      setMenu({
        at,
        label: occ.title,
        entries: [
          {
            label: readOnly ? t('contextMenu.open') : t('contextMenu.edit'),
            icon: <Pencil className="h-3.5 w-3.5" />,
            hint: 'Enter',
            onSelect: () => actions.open(occ)
          },
          {
            label: readOnly ? t('contextMenu.copyToMine') : t('contextMenu.duplicate'),
            icon: <Copy className="h-3.5 w-3.5" />,
            onSelect: () => actions.duplicate(occ)
          },
          'separator',
          {
            label: t('common.delete'),
            icon: <Trash2 className="h-3.5 w-3.5" />,
            hint: 'Del',
            danger: true,
            disabled: readOnly,
            onSelect: () => actions.remove(occ)
          }
        ]
      })
      return
    }

    const dayEl = target.closest<HTMLElement>('[data-day]')
    if (!dayEl?.dataset.day) return
    e.preventDefault()
    const day = DateTime.fromISO(dayEl.dataset.day)
    const hourHeight = Number(dayEl.dataset.hourHeight)
    // On the hour grid, the half hour under the pointer; on a day cell or the
    // all-day lane, the whole day.
    let slot = { start: day, end: day, allDay: true }
    if (hourHeight > 0) {
      const minutes = ((e.clientY - dayEl.getBoundingClientRect().top) / hourHeight) * 60
      const start = day.plus({ minutes: Math.max(0, Math.min(23 * 60 + 30, Math.floor(minutes / 30) * 30)) })
      slot = { start, end: start.plus({ hours: 1 }), allDay: false }
    }
    setMenu({
      at,
      label: day.setLocale(i18n.language).toFormat('cccc, d MMMM'),
      entries: [
        {
          label: t('contextMenu.newEventHere'),
          icon: <CalendarPlus className="h-3.5 w-3.5" />,
          onSelect: () => actions.newEventAt(slot.start, slot.end, slot.allDay, at.x)
        },
        {
          label: t('contextMenu.openDay'),
          icon: <CalendarDays className="h-3.5 w-3.5" />,
          onSelect: () => actions.openDay(day)
        }
      ]
    })
  })

  useEffect(() => {
    const listener = (e: MouseEvent): void => onContextMenu(e)
    window.addEventListener('contextmenu', listener)
    return () => window.removeEventListener('contextmenu', listener)
  }, [])

  const close = useCallback(() => setMenu(null), [])

  return { menu, close }
}
