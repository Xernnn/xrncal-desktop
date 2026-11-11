import { DateTime } from 'luxon'
import { effectiveLastUsed, estimateOccurrences, matchWeight } from './title-suggestions'
import { foldForMatch } from './text-fold'

/**
 * Ranking for the Location field's autocomplete: the places typed before that
 * match what is being typed, the ones used lately and often first.
 *
 * A place has no hour or weekday it belongs to, so of the four signals the
 * title ranking uses (title-suggestions.ts) only two apply here: how often,
 * and how recently. Matching ignores accents, capitals and punctuation, and
 * nothing is offered for an empty field: every place ever used is not an
 * answer to anything.
 */

/** One past event's place, flattened to what ranking needs. */
export interface LocationSample {
  location: string
  /** ISO 8601 UTC, as stored. */
  startUtc: string
  rrule: string | null
}

export interface LocationSuggestion {
  /** As it was typed most often; the latest spelling on a tie. */
  location: string
  /** Estimated number of times it was used in the window, recurrence expanded. */
  uses: number
  lastUsedUtc: string
  score: number
}

export interface SuggestLocationsOptions {
  /** What is in the field so far. */
  query: string
  limit?: number
  /** Injectable so tests do not depend on the wall clock. */
  now?: DateTime
}

/** How far back a place still counts as one the user goes to. Longer than the
 *  title window's year: places stay where they are, and one visited every
 *  year (the dentist, a family home) should still be there the second time. */
export const LOCATION_LOOKBACK_DAYS = 730

/** Recency half-life: a place last used 30 days ago scores half of one used today. */
const RECENCY_HALF_LIFE_DAYS = 30

/** `uses` at which the frequency signal saturates. */
const FREQ_SATURATION = 40

const WEIGHTS = { freq: 0.5, recency: 0.5 }

const DEFAULT_LIMIT = 5

/** The most a caller may ask for, and the longest text it may ask about: a
 *  place name is far shorter, and the ranking runs on every keystroke. */
const MAX_LIMIT = 20
const MAX_QUERY_LENGTH = 200

/**
 * A request for suggestions as it arrived from the renderer, checked: the
 * text typed (cut to a sane length) and how many to return. Throws for
 * anything that is not a request, as the other handlers do for theirs.
 */
export function checkedLocationRequest(input: unknown): { query: string; limit: number } {
  const request = typeof input === 'object' && input !== null ? (input as { query?: unknown; limit?: unknown }) : null
  if (!request || typeof request.query !== 'string') throw new Error('Not a location query')
  const limit =
    typeof request.limit === 'number' && Number.isFinite(request.limit)
      ? Math.min(MAX_LIMIT, Math.max(1, Math.floor(request.limit)))
      : DEFAULT_LIMIT
  return { query: request.query.slice(0, MAX_QUERY_LENGTH), limit }
}

interface Group {
  /** Each spelling of the place and how many samples carry it, newest first. */
  spellings: Map<string, number>
  uses: number
  lastUsedUtc: string
}

/** The spelling seen most; the newest one when several are level. */
function mainSpelling(spellings: Map<string, number>): string {
  let best = ''
  let bestCount = 0
  // Strictly greater, and the map was filled newest first.
  for (const [spelling, count] of spellings) {
    if (count > bestCount) {
      best = spelling
      bestCount = count
    }
  }
  return best
}

export function rankLocationSuggestions(
  samples: LocationSample[],
  options: SuggestLocationsOptions
): LocationSuggestion[] {
  const query = foldForMatch(options.query)
  if (!query) return []

  const now = options.now ?? DateTime.utc()
  const nowUtc = now.toUTC().toISO()!
  const windowStartUtc = now.minus({ days: LOCATION_LOOKBACK_DAYS }).toUTC().toISO()!
  const limit = options.limit ?? DEFAULT_LIMIT
  const typed = options.query.trim()

  // "Cà phê Sáng", "ca phe sang" and "Cà phê  Sáng" are one place.
  const ordered = [...samples].sort((a, b) => (a.startUtc < b.startUtc ? 1 : -1))
  const groups = new Map<string, Group>()

  for (const sample of ordered) {
    const spelling = sample.location.trim().replace(/\s+/g, ' ')
    const key = foldForMatch(spelling)
    if (!key || matchWeight(key, query) === 0) continue

    let group = groups.get(key)
    if (!group) {
      group = { spellings: new Map(), uses: 0, lastUsedUtc: sample.startUtc }
      groups.set(key, group)
    }
    group.spellings.set(spelling, (group.spellings.get(spelling) ?? 0) + 1)
    group.uses += estimateOccurrences(sample, windowStartUtc, nowUtc)
    const lastUsed = effectiveLastUsed(sample, nowUtc)
    if (lastUsed > group.lastUsedUtc) group.lastUsedUtc = lastUsed
  }

  const suggestions: LocationSuggestion[] = []

  for (const [key, group] of groups) {
    if (group.uses === 0) continue
    const location = mainSpelling(group.spellings)
    // Offering exactly what is already in the field would change nothing.
    if (location === typed) continue

    const freq = Math.min(1, Math.log1p(group.uses) / Math.log1p(FREQ_SATURATION))
    const daysSince = Math.max(0, now.diff(DateTime.fromISO(group.lastUsedUtc, { zone: 'utc' }), 'days').days)
    const recency = Math.pow(0.5, daysSince / RECENCY_HALF_LIFE_DAYS)

    suggestions.push({
      location,
      uses: group.uses,
      lastUsedUtc: group.lastUsedUtc,
      score: matchWeight(key, query) * (WEIGHTS.freq * freq + WEIGHTS.recency * recency)
    })
  }

  return suggestions
    .sort(
      (a, b) =>
        b.score - a.score ||
        (a.lastUsedUtc === b.lastUsedUtc ? 0 : a.lastUsedUtc < b.lastUsedUtc ? 1 : -1) ||
        (a.location < b.location ? -1 : 1)
    )
    .slice(0, limit)
}
