import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { DateTime } from 'luxon'
import { parseZoneHistory, recordZoneMove, serializeZoneHistory } from '@shared/zone-history'
import { useSettings } from '../context/SettingsContext'

/**
 * Notices this computer's zone changing - a flight, a move - and records it in
 * Where you were from today, so events saved without a zone keep the one they
 * were made in. Looks when the settings arrive, every minute and on focus (the
 * laptop woke up somewhere else).
 *
 * Returns how many moves it has seen: the views are keyed by it, because their
 * hours are this computer's and have to be drawn again.
 */
export function useZoneFollowing(): number {
  const { settings, ready, setSetting } = useSettings()
  const [moves, setMoves] = useState(0)
  // The zone last seen, null until the settings say what it was. A ref, not the
  // setting: a focus and the minute's tick can arrive together, and the second
  // must already see the first one's answer.
  const lastSeen = useRef<string | null>(null)

  const check = useEffectEvent(async (): Promise<void> => {
    const before = lastSeen.current
    const current = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (before === null || !current || before === current) return
    lastSeen.current = current
    const moved = recordZoneMove(
      parseZoneHistory(settings.zoneHistory),
      before,
      current,
      DateTime.local().toISODate() ?? ''
    )
    const stored =
      (!moved || (await setSetting('zoneHistory', serializeZoneHistory(moved), { quiet: true }))) &&
      (await setSetting('lastSeenZone', current, { quiet: true }))
    if (!stored) {
      // Looked at again on the next check.
      lastSeen.current = before
      return
    }
    // The first look only records the zone; a later change is a move.
    if (before) setMoves((n) => n + 1)
  })

  const start = useEffectEvent(() => {
    lastSeen.current = settings.lastSeenZone ?? ''
    void check()
  })

  useEffect(() => {
    if (!ready) return
    start()
    const look = (): void => void check()
    const timer = setInterval(look, 60_000)
    window.addEventListener('focus', look)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', look)
    }
  }, [ready])

  return moves
}
