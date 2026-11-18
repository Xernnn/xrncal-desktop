import { calendarExpansionBudget } from './bounded-rrule'
import type { CalendarEvent, EventException, ExpandedOccurrence } from './event-model'
import { expandOccurrences } from './expand-occurrences'

const DAY_MS = 86_400_000
/** How far either side of now a series is looked at first: a whole period of
 *  any yearly rule, and of a two-yearly one. */
const AROUND_MS = 2 * 366 * DAY_MS

/**
 * The date of a series nearest to `nowMs` - the one a search result shows and
 * opens, rather than the series' first-ever date - or null when it has none
 * (every date deleted, or a rule that cannot be read). Within two years of now,
 * the nearest either way (the later on a tie); past that, the first date of a
 * series that has not begun, or the last of one that has ended.
 */
export function nearestOccurrence(
  event: CalendarEvent,
  exceptions: EventException[],
  nowMs: number,
  coveredYears?: Set<number>
): ExpandedOccurrence | null {
  const expand = (fromMs: number, toMs: number): ExpandedOccurrence[] => {
    if (toMs < fromMs) return []
    const from = new Date(fromMs).toISOString()
    const to = new Date(toMs).toISOString()
    return expandOccurrences(event, exceptions, from, to, coveredYears, calendarExpansionBudget(from, to)).sort((a, b) =>
      a.startUtc.localeCompare(b.startUtc)
    )
  }

  const around = expand(nowMs - AROUND_MS, nowMs + AROUND_MS)
  if (around.length > 0) {
    let best = around[0]
    let bestDistance = Infinity
    for (const occ of around) {
      const distance = Math.abs(Date.parse(occ.startUtc) - nowMs)
      if (distance < bestDistance || (distance === bestDistance && occ.startUtc > best.startUtc)) {
        best = occ
        bestDistance = distance
      }
    }
    return best
  }

  const firstMs = Date.parse(event.dtStartUtc)
  if (Number.isNaN(firstMs)) return null
  if (firstMs > nowMs) return expand(firstMs, firstMs + AROUND_MS)[0] ?? null
  const before = expand(firstMs, nowMs - AROUND_MS)
  return before[before.length - 1] ?? null
}
