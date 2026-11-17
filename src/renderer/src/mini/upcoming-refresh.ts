/** What keepUpcomingFresh needs from the page, so it can be tested without one. */
export interface RefreshHost {
  isHidden: () => boolean
  onVisibilityChange: (listener: () => void) => () => void
  /** A sync has changed what is stored (`sync.onChanged`). */
  onSyncChanged?: (listener: () => void) => () => void
  every: (tick: () => void, ms: number) => () => void
}

/**
 * Keep the mini window's list of upcoming events current: once a minute
 * while it shows (an event starting rolls off), as soon as it is shown again,
 * and as soon as a sync changes what is stored. It used to read every minute
 * whether shown or not - main hides the window rather than closing it, and
 * each read expands every series in main - yet an event just synced showed up
 * to a minute late. Returns the function that stops it.
 */
export function keepUpcomingFresh(load: () => void, host: RefreshHost, ms = 60_000): () => void {
  let stopTimer: (() => void) | null = null
  const start = (): void => {
    stopTimer ??= host.every(load, ms)
  }
  const stop = (): void => {
    stopTimer?.()
    stopTimer = null
  }

  if (!host.isHidden()) start()
  const stopWatchingVisibility = host.onVisibilityChange(() => {
    if (host.isHidden()) {
      stop()
    } else {
      load()
      start()
    }
  })
  // Hidden, it is read again when shown.
  const stopWatchingSync = host.onSyncChanged?.(() => {
    if (!host.isHidden()) load()
  })

  return () => {
    stop()
    stopWatchingVisibility()
    stopWatchingSync?.()
  }
}
