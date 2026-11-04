import { useCallback, useEffect, useState } from 'react'
import type { SyncStatus } from '@shared/event-model'

/** How often a visible status is re-read: a failed sync changes no rows, so nothing else would tell it. */
const POLL_MS = 30_000

/** The status now; null when the worker cannot be asked. */
function readSyncStatus(): Promise<SyncStatus | null> {
  const sync = window.xrncal?.sync
  if (!sync) return Promise.resolve(null)
  return sync.getStatus().then(
    (status) => status ?? null,
    () => null
  )
}

/**
 * The sync worker's status - last sync, what is waiting, and which accounts
 * failed and why - kept current while the component is mounted.
 */
export function useSyncStatus(): { status: SyncStatus | null; reload: () => Promise<void> } {
  const [status, setStatus] = useState<SyncStatus | null>(null)

  const reload = useCallback(() => readSyncStatus().then(setStatus), [])

  useEffect(() => {
    void reload()
    const timer = setInterval(() => void reload(), POLL_MS)
    const unsubscribe = window.xrncal?.sync?.onChanged?.(() => void reload())
    return () => {
      clearInterval(timer)
      unsubscribe?.()
    }
  }, [reload])

  return { status, reload }
}
