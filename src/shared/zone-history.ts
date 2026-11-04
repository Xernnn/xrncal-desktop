import { DateTime, IANAZone } from 'luxon'

/**
 * Where the user was, and from when: the zone an event that names none of its
 * own belongs to. A time written as a bare UTC instant (an .ics with `...Z`
 * times, which is how Google's export writes every one-off event) carries no
 * zone, and someone who moved from Vietnam to Sydney has years of events made
 * at +7 and months made at +10/+11 with nothing in the files to tell them apart.
 *
 * The first period covers everything before the second; it has no date of its
 * own. Each later one starts at midnight of `from` in its own zone.
 */
export interface ZonePeriod {
  /** yyyy-MM-dd; null for the first period. */
  from: string | null
  zone: string
}

const DATE = /^\d{4}-\d{2}-\d{2}$/

/** Stored as one plain setting: "Asia/Ho_Chi_Minh,2026-01-28=Australia/Sydney". */
export function parseZoneHistory(stored: string | null | undefined): ZonePeriod[] {
  const periods: ZonePeriod[] = []
  for (const part of (stored ?? '').split(',')) {
    const entry = part.trim()
    if (!entry) continue
    const eq = entry.indexOf('=')
    const from = eq >= 0 ? entry.slice(0, eq).trim() : null
    const zone = (eq >= 0 ? entry.slice(eq + 1) : entry).trim()
    if (!IANAZone.isValidZone(zone)) continue
    if (from !== null && !(DATE.test(from) && DateTime.fromISO(from).isValid)) continue
    periods.push({ from, zone })
  }
  return normalizeZoneHistory(periods)
}

export function serializeZoneHistory(periods: ZonePeriod[]): string {
  return normalizeZoneHistory(periods)
    .map((p) => (p.from ? `${p.from}=${p.zone}` : p.zone))
    .join(',')
}

/** In date order, with only the first undated - whichever period comes first
 *  loses its date, since it covers everything before the next one anyway. */
export function normalizeZoneHistory(periods: ZonePeriod[]): ZonePeriod[] {
  const sorted = [...periods].sort((a, b) => (a.from ?? '').localeCompare(b.from ?? ''))
  return sorted.map((p, i) => ({ zone: p.zone, from: i === 0 ? null : p.from ?? null })).filter(
    (p, i) => i === 0 || p.from !== null
  )
}

/** The zone the user was in at `isoUtc`; undefined when no periods are set. */
export function zoneAt(periods: ZonePeriod[], isoUtc: string): string | undefined {
  if (periods.length === 0) return undefined
  const at = Date.parse(isoUtc)
  let zone = periods[0].zone
  for (const p of periods) {
    if (p.from && at >= DateTime.fromISO(p.from, { zone: p.zone }).toMillis()) zone = p.zone
  }
  return zone
}

/** One zone under two spellings (Asia/Saigon, Asia/Ho_Chi_Minh) compares equal. */
function sameZone(a: string, b: string): boolean {
  const canonical = (zone: string): string => {
    try {
      return new Intl.DateTimeFormat('en-US', { timeZone: zone }).resolvedOptions().timeZone
    } catch {
      return zone
    }
  }
  return a === b || canonical(a) === canonical(b)
}

/**
 * The history after this computer's zone changed from `lastSeen` to `current`
 * on `today` (yyyy-MM-dd, in the new zone): the move added from that day.
 * Null when there is nothing to add - no change, or the history already ends
 * in the new zone. An empty history first gets the zone it was in, so the
 * events from before the move stay in it rather than following the computer.
 * A second move on one day replaces the first.
 */
export function recordZoneMove(
  periods: ZonePeriod[],
  lastSeen: string,
  current: string,
  today: string
): ZonePeriod[] | null {
  if (!lastSeen || !current || sameZone(lastSeen, current) || !IANAZone.isValidZone(current)) return null
  const history = periods.length > 0 ? periods : [{ from: null, zone: lastSeen }]
  if (sameZone(history[history.length - 1].zone, current)) return null
  const kept = history.filter((p, i) => i === 0 || p.from !== today)
  if (sameZone(kept[kept.length - 1].zone, current)) return normalizeZoneHistory(kept)
  return normalizeZoneHistory([...kept, { from: today, zone: current }])
}
