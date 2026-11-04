import { DateTime, IANAZone } from 'luxon'
import { isUtcZone } from '@shared/utc-zone'

/**
 * VTIMEZONE blocks, so a timed event can be written in its own zone.
 *
 * generateIcs() used to write every timed event as UTC (`DTSTART:...Z`). The
 * zone was lost on the way: an event made here in Sydney came back from the
 * CalDAV server as a UTC event, and a weekly 09:00 written as a fixed UTC time
 * moved by an hour on every other client whenever summer time began or ended.
 * RFC 5545 needs a VTIMEZONE for each TZID a file names, and there is no zone
 * database to copy one from, so it is worked out from the one Luxon reads.
 */

/** The zone a timed event's times are written in; null writes them as UTC (`...Z`). */
export function writableZone(tzid: string | null | undefined): string | null {
  if (!tzid || isUtcZone(tzid) || !IANAZone.isValidZone(tzid)) return null
  return tzid
}

/** `20261007T220000`: the clock time in `zone` at a UTC instant. */
export function localStamp(isoUtc: string, zone: string): string {
  return DateTime.fromISO(isoUtc, { zone: 'utc' }).setZone(zone).toFormat("yyyyMMdd'T'HHmmss")
}

interface Transition {
  /** Unix seconds of the change. */
  at: number
  /** Offsets in minutes, before and after. */
  from: number
  to: number
}

interface YearlyRule {
  rrule: string
  month: number
  clock: string
  day: (year: number) => number
}

const DAY_S = 86_400
const WEEKDAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU']
/** Years past the span that a rule is checked against, so one that only looks
 *  right for a few years ("first Sunday" for Chile's "Sunday on or after the
 *  2nd") is caught by a year in which the two differ. */
const LOOKAHEAD_YEARS = 10

/** Every offset change between two instants, to the second. */
function transitionsBetween(zone: IANAZone, fromS: number, toS: number): Transition[] {
  const out: Transition[] = []
  let prevS = fromS
  let prev = zone.offset(fromS * 1000)
  for (let s = fromS + DAY_S; s <= toS; s += DAY_S) {
    const offset = zone.offset(s * 1000)
    if (offset !== prev) {
      let lo = prevS
      let hi = s
      while (hi - lo > 1) {
        const mid = Math.floor((lo + hi) / 2)
        if (zone.offset(mid * 1000) === prev) lo = mid
        else hi = mid
      }
      out.push({ at: hi, from: prev, to: offset })
      prev = offset
    }
    prevS = s
  }
  return out
}

/** An observance starts at the clock time of the offset in force before it (RFC 5545 3.6.5). */
function wallClock(t: Transition): DateTime {
  return DateTime.fromSeconds(t.at + t.from * 60, { zone: 'utc' })
}

function stamp(t: Transition): string {
  return wallClock(t).toFormat("yyyyMMdd'T'HHmmss")
}

function formatOffset(minutes: number): string {
  const abs = Math.abs(minutes)
  const hh = String(Math.floor(abs / 60)).padStart(2, '0')
  const mm = String(abs % 60).padStart(2, '0')
  return `${minutes < 0 ? '-' : '+'}${hh}${mm}`
}

/** The first `weekday` on or after day `from` of the month. */
function weekdayOnOrAfter(year: number, month: number, weekday: number, from: number): number {
  const start = DateTime.utc(year, month, from)
  return from + ((weekday - start.weekday + 7) % 7)
}

function lastWeekday(year: number, month: number, weekday: number): number {
  const last = DateTime.utc(year, month, 1).endOf('month')
  return last.day - ((last.weekday - weekday + 7) % 7)
}

function follows(rule: YearlyRule, wall: DateTime): boolean {
  return wall.month === rule.month && wall.toFormat('HHmmss') === rule.clock && rule.day(wall.year) === wall.day
}

/**
 * The yearly rules a change at `wall` could be following, most usual first:
 * the nth weekday of the month, the last one, the first one on or after a
 * date (tzdb's "Sun>=2"), a fixed date.
 */
function candidateRules(wall: DateTime): YearlyRule[] {
  const { month, weekday, day } = wall
  const clock = wall.toFormat('HHmmss')
  const wd = WEEKDAYS[weekday - 1]
  const daysInMonth = wall.daysInMonth!
  const yearly = (by: string, dayIn: (y: number) => number): YearlyRule => ({
    rrule: `FREQ=YEARLY;BYMONTH=${month};${by}`,
    month,
    clock,
    day: dayIn
  })
  const nth = Math.ceil(day / 7)
  const rules = [
    yearly(`BYDAY=${nth}${wd}`, (y) => weekdayOnOrAfter(y, month, weekday, 1 + (nth - 1) * 7)),
    yearly(`BYDAY=-1${wd}`, (y) => lastWeekday(y, month, weekday))
  ]
  // In the last week of a month, "last Sunday" is the likelier rule than "fourth".
  if (day > daysInMonth - 7) rules.reverse()
  for (let from = Math.max(1, day - 6); from <= Math.min(day, daysInMonth - 6); from++) {
    if ((from - 1) % 7 === 0) continue // the nth-weekday rule above
    const days = Array.from({ length: 7 }, (_, i) => from + i).join(',')
    rules.push(yearly(`BYDAY=${wd};BYMONTHDAY=${days}`, (y) => weekdayOnOrAfter(y, month, weekday, from)))
  }
  rules.push(yearly(`BYMONTHDAY=${day}`, () => day))
  return rules
}

/**
 * The yearly rule a kind of change follows at the end of the span, and the
 * change it took over at: of the rules the last year's change fits, the one
 * that the most years running back from the end keep. Null when none holds
 * for three years, or the last year has no such change.
 */
function trailingRule(list: Transition[], lastYear: number): { rule: YearlyRule; since: Transition } | null {
  const byYear = new Map<number, Transition | null>()
  for (const c of list) {
    const year = wallClock(c).year
    // Two changes of one kind in a year (a pause for Ramadan) fit no yearly rule.
    byYear.set(year, byYear.has(year) ? null : c)
  }
  const last = byYear.get(lastYear)
  if (!last) return null
  let best: { rule: YearlyRule; since: Transition; years: number } | null = null
  for (const rule of candidateRules(wallClock(last))) {
    let years = 0
    let since = last
    for (let y = lastYear; ; y--) {
      const c = byYear.get(y)
      if (!c || !follows(rule, wallClock(c))) break
      years++
      since = c
    }
    if (years >= 3 && (!best || years > best.years)) best = { rule, since, years }
  }
  return best && { rule: best.rule, since: best.since }
}

function observance(kind: 'STANDARD' | 'DAYLIGHT', start: string, from: number, to: number, rrule?: string): string[] {
  return [
    `BEGIN:${kind}`,
    `DTSTART:${start}`,
    ...(rrule ? [`RRULE:${rrule}`] : []),
    `TZOFFSETFROM:${formatOffset(from)}`,
    `TZOFFSETTO:${formatOffset(to)}`,
    `END:${kind}`
  ]
}

const cache = new Map<string, string[]>()

/**
 * A VTIMEZONE for `tzid` that is right from the start of `fromYear - 1` to the
 * end of `toYear` (by default next year, or `fromYear` if later) and, while the
 * zone keeps its present rules, after it.
 *
 * The zone's changes over that span are read from the zone database. Those
 * that follow today's yearly rule are stated as that rule, so the block holds
 * for a series that runs on for years. Earlier changes under other rules -
 * Sydney's before 2008, New York's before 2007 - and changes no yearly rule
 * fits are listed one by one; after the last listed one, its offset carries on.
 */
export function vtimezoneLines(
  tzid: string,
  fromYear: number,
  toYear = Math.max(fromYear, DateTime.utc().year) + 1
): string[] {
  const key = `${tzid}|${fromYear}|${toYear}`
  const known = cache.get(key)
  if (known) return known
  const lines = buildVtimezone(tzid, fromYear, toYear)
  cache.set(key, lines)
  return lines
}

function buildVtimezone(tzid: string, fromYear: number, toYear: number): string[] {
  const zone = IANAZone.create(tzid)
  const lastYear = toYear + LOOKAHEAD_YEARS
  const startS = Date.UTC(fromYear - 1, 0, 1) / 1000
  const endS = Date.UTC(lastYear + 1, 0, 1) / 1000
  const changes = transitionsBetween(zone, startS, endS)
  const lines = ['BEGIN:VTIMEZONE', `TZID:${tzid}`]

  if (changes.length === 0) {
    const offset = zone.offset(startS * 1000)
    lines.push(...observance('STANDARD', '19700101T000000', offset, offset))
    lines.push('END:VTIMEZONE')
    return lines
  }

  const daylight = trailingRule(
    changes.filter((c) => c.to > c.from),
    lastYear
  )
  const standard = trailingRule(
    changes.filter((c) => c.to < c.from),
    lastYear
  )
  const ruled = daylight && standard ? { daylight, standard } : null
  const listed = ruled
    ? changes.filter((c) => c.at < (c.to > c.from ? ruled.daylight.since.at : ruled.standard.since.at))
    : changes

  if (listed.length > 0) {
    // The offset before the first change, so nothing earlier is left undefined.
    lines.push(...observance('STANDARD', '19700101T000000', changes[0].from, changes[0].from))
    for (const c of listed) lines.push(...observance(c.to > c.from ? 'DAYLIGHT' : 'STANDARD', stamp(c), c.from, c.to))
  }
  if (ruled) {
    const { standard: s, daylight: d } = ruled
    lines.push(...observance('STANDARD', stamp(s.since), s.since.from, s.since.to, s.rule.rrule))
    lines.push(...observance('DAYLIGHT', stamp(d.since), d.since.from, d.since.to, d.rule.rrule))
  }

  lines.push('END:VTIMEZONE')
  return lines
}
