import { useMemo, useSyncExternalStore } from 'react'
import { DateTime } from 'luxon'
import { msUntilNextMinute } from '../lib/clock'

/**
 * One clock for every view, ticking on the minute.
 *
 * The views used to read `DateTime.local()` while rendering and had no reason
 * to render again on their own, so a window left open overnight kept marking
 * yesterday as today, and the current-time line stopped wherever it was when
 * something last redrew the grid.
 */
const listeners = new Set<() => void>()
let timer: ReturnType<typeof setTimeout> | null = null

function tick(): void {
  for (const listener of listeners) listener()
  schedule()
}

function schedule(): void {
  if (timer) clearTimeout(timer)
  // Re-aimed at the next minute each time, so the ticks never drift, and a
  // computer waking from sleep catches up on the first one that fires.
  timer = setTimeout(tick, msUntilNextMinute(Date.now()))
}

function onWake(): void {
  if (document.visibilityState === 'visible') tick()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  if (listeners.size === 1) {
    schedule()
    document.addEventListener('visibilitychange', onWake)
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) {
      if (timer) clearTimeout(timer)
      timer = null
      document.removeEventListener('visibilitychange', onWake)
    }
  }
}

const minuteKey = (): number => Math.floor(Date.now() / 60_000)
const dayKey = (): string => DateTime.local().toISODate() ?? ''

/** The current minute. Re-renders the caller once a minute. */
export function useNow(): DateTime {
  // The same snapshot for a server render (the views are rendered to strings in tests).
  const key = useSyncExternalStore(subscribe, minuteKey, minuteKey)
  return useMemo(() => DateTime.fromMillis(key * 60_000), [key])
}

/** Today, at midnight. Re-renders the caller only when the date changes. */
export function useToday(): DateTime {
  const key = useSyncExternalStore(subscribe, dayKey, dayKey)
  return useMemo(() => DateTime.fromISO(key), [key])
}
