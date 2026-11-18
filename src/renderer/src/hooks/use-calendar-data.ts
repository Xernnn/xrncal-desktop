import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Calendar, CalendarAccount, ExpandedOccurrence, SyncConflict } from '@shared/event-model'
import { showFriendlyError, toast } from '../components/ui'

export interface CalendarData {
  calendars: Calendar[]
  accounts: CalendarAccount[]
  /** What the visible calendars have in the range, each with its colour resolved. */
  occurrences: ExpandedOccurrence[]
  conflicts: SyncConflict[]
  /** Read everything again. Later calls win over earlier ones still in flight. */
  reload: () => Promise<void>
  toggleCalendarVisibility: (cal: Calendar) => Promise<void>
  /** Several visibility changes at once ("show only this"), then one reload. */
  setCalendarsVisibility: (changes: { id: string; isVisible: boolean }[]) => Promise<void>
  changeCalendarColor: (cal: Calendar, color: string) => Promise<void>
  resolveConflict: (eventId: string, resolution: 'keepMine' | 'keepTheirs') => Promise<void>
}

/** What one read found; a part that could not be read is left out, and what
 *  is on screen for it stays. */
export interface CalendarDataRead {
  calendars?: Calendar[]
  accounts?: CalendarAccount[]
  occurrences?: ExpandedOccurrence[]
  conflicts?: SyncConflict[]
  /** The calendars or their events could not be read. */
  failed?: boolean
}

/** The occurrences the visible ones of `calendars` have in a span, each with its colour resolved. */
export async function readVisibleOccurrences(
  calendars: Calendar[],
  startUtc: string,
  endUtc: string
): Promise<ExpandedOccurrence[]> {
  const api = window.xrncal?.events
  const visible = calendars.filter((c) => c.isVisible).map((c) => c.id)
  if (!api || visible.length === 0) return []
  const colorById = new Map(calendars.map((c) => [c.id, c.color]))
  const occs = await api.queryRange(visible, startUtc, endUtc)
  return occs.map((occ) => ({ ...occ, color: occ.color || colorById.get(occ.calendarId) }))
}

export async function readCalendarData(startUtc: string, endUtc: string): Promise<CalendarDataRead> {
  const api = window.xrncal
  const found: CalendarDataRead = {}
  if (!api?.calendars || !api.events) return found

  try {
    const [cals, accs] = await Promise.all([
      api.calendars.list(),
      api.auth?.listAccounts() ?? Promise.resolve([] as CalendarAccount[])
    ])
    found.calendars = cals
    found.accounts = accs
    found.occurrences = await readVisibleOccurrences(cals, startUtc, endUtc)
  } catch {
    // Keep the events already on screen - if they are this range's (see reload).
    found.failed = true
  }

  if (api.events.listConflicts) {
    try {
      found.conflicts = await api.events.listConflicts()
    } catch {
      // Keep the last known conflicts; the next refresh tries again.
    }
  }
  return found
}

/**
 * The occurrences to show after a read: those read, else - the read failed -
 * the ones on screen while they are of the range asked for, or none. Paging
 * after a failed read used to leave last week's events drawn on this week.
 */
export function occurrencesAfterRead(
  found: CalendarDataRead,
  shown: { occurrences: ExpandedOccurrence[]; rangeKey: string },
  rangeKey: string
): ExpandedOccurrence[] {
  if (found.occurrences) return found.occurrences
  return shown.rangeKey === rangeKey ? shown.occurrences : []
}

/**
 * The calendars, accounts and occurrences on screen, kept current: read when
 * the range moves and whenever a sync changes rows. `enabled` holds the first
 * read back until the settings are in, which decide the range.
 */
export function useCalendarData(range: { startUtc: string; endUtc: string }, enabled: boolean): CalendarData {
  const { t } = useTranslation()
  const [calendars, setCalendars] = useState<Calendar[]>([])
  const [accounts, setAccounts] = useState<CalendarAccount[]>([])
  const [occurrences, setOccurrences] = useState<ExpandedOccurrence[]>([])
  const [conflicts, setConflicts] = useState<SyncConflict[]>([])
  // Paging quickly starts reads that can finish out of order; only the latest
  // may write, or last week's events could land on this week.
  const latestRead = useRef(0)
  // The range the occurrences on screen were read for.
  const shownRange = useRef('')
  const occurrencesShown = useRef<ExpandedOccurrence[]>([])

  const reload = useCallback((): Promise<void> => {
    const read = ++latestRead.current
    const rangeKey = `${range.startUtc}/${range.endUtc}`
    return readCalendarData(range.startUtc, range.endUtc).then((found) => {
      if (read !== latestRead.current) return
      if (found.calendars) setCalendars(found.calendars)
      if (found.accounts) setAccounts(found.accounts)
      const shown = { occurrences: occurrencesShown.current, rangeKey: shownRange.current }
      const next = occurrencesAfterRead(found, shown, rangeKey)
      if (next !== occurrencesShown.current) {
        occurrencesShown.current = next
        setOccurrences(next)
      }
      shownRange.current = rangeKey
      if (found.conflicts) setConflicts(found.conflicts)
      // An empty grid used to look like a week with no events. One toast,
      // replaced rather than stacked while the failure lasts.
      if (found.failed) toast.error(t('toast.readFailed'), { id: 'calendar-read-failed' })
    })
  }, [range.startUtc, range.endUtc, t])

  useEffect(() => {
    if (enabled) void reload()
  }, [enabled, reload])

  // A background sync can rewrite the rows under the view - including the id of
  // an event that has just been pushed for the first time, which the provider
  // assigns. Reloading on that signal is what keeps a drag or resize from acting
  // on an occurrence that no longer exists.
  //
  // Never mid-gesture, though. The poll runs every 20s while the window is
  // focused, so reloading the moment the signal arrives yanks the view out from
  // under a drag that is still in the user's hand - the blocks re-render, the
  // occurrence being dragged is replaced, and the drop lands somewhere nobody
  // asked for. Both gesture hooks mark `is-dnd-active` on <body> for exactly as
  // long as a drag or resize is live, so the reload waits for it to clear.
  useEffect(() => {
    if (!window.xrncal?.sync?.onChanged) return

    let pending = false
    const isGestureActive = (): boolean => document.body.classList.contains('is-dnd-active')

    const drain = (): void => {
      if (!pending || isGestureActive()) return
      pending = false
      void reload()
    }

    // Attribute changes on <body> are the signal that a gesture ended; watching
    // them beats polling for a class that is usually not there.
    const observer = new MutationObserver(drain)
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] })

    const unsubscribe = window.xrncal.sync.onChanged(() => {
      pending = true
      drain()
    })

    return () => {
      observer.disconnect()
      unsubscribe()
    }
  }, [reload])

  const replaceCalendars = (updated: Calendar[]): void => {
    const byId = new Map(updated.map((c) => [c.id, c]))
    setCalendars((prev) => prev.map((c) => byId.get(c.id) ?? c))
  }

  // A refused change used to be an unhandled rejection with nothing on screen.
  const updateCalendars = async (update: () => Promise<Calendar[]>): Promise<void> => {
    try {
      replaceCalendars(await update())
    } catch (err) {
      showFriendlyError(err, t('toast.calendarUpdateFailed'))
      return
    }
    await reload()
  }

  const toggleCalendarVisibility = async (cal: Calendar): Promise<void> => {
    const api = window.xrncal?.calendars
    if (!api) return
    await updateCalendars(async () => [await api.update(cal.id, { isVisible: !cal.isVisible })])
  }

  const setCalendarsVisibility = async (changes: { id: string; isVisible: boolean }[]): Promise<void> => {
    const api = window.xrncal?.calendars
    if (!api || changes.length === 0) return
    await updateCalendars(() => Promise.all(changes.map((c) => api.update(c.id, { isVisible: c.isVisible }))))
  }

  const changeCalendarColor = async (cal: Calendar, color: string): Promise<void> => {
    const api = window.xrncal?.calendars
    if (!api) return
    await updateCalendars(async () => [await api.update(cal.id, { color })])
  }

  const resolveConflict = async (eventId: string, resolution: 'keepMine' | 'keepTheirs'): Promise<void> => {
    if (!window.xrncal?.events?.resolveConflict) return
    try {
      await window.xrncal.events.resolveConflict(eventId, resolution)
      setConflicts((prev) => prev.filter((c) => c.eventId !== eventId))
    } catch (err) {
      showFriendlyError(err, t('toast.conflictResolveFailed'))
    }
  }

  return {
    calendars,
    accounts,
    occurrences,
    conflicts,
    reload,
    toggleCalendarVisibility,
    setCalendarsVisibility,
    changeCalendarColor,
    resolveConflict
  }
}
