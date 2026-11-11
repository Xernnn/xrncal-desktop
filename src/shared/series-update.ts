import { DateTime } from 'luxon'
import type { CalendarEvent, EventException, UpdateEventInput } from './event-model'
import { ianaZoneFor } from './windows-time-zones'

/** The zone a series repeats in - the one its occurrences are expanded in (see expandOccurrences). */
export function seriesZone(allDay: boolean, tzid: string | undefined): string {
  return allDay || !tzid ? 'utc' : (ianaZoneFor(tzid) ?? 'local')
}

/** An instant's clock reading in `zone`, as a number that can be added to and subtracted. */
function wallClock(isoUtc: string, zone: string): number {
  return DateTime.fromISO(isoUtc, { zone: 'utc' }).setZone(zone).setZone('utc', { keepLocalTime: true }).toMillis()
}

/** An instant's clock reading in `zone`, as a UTC DateTime whose fields are that reading. */
export function wallTime(isoUtc: string, zone: string): DateTime {
  return DateTime.fromMillis(wallClock(isoUtc, zone), { zone: 'utc' })
}

const WEEKDAY_CODES = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU']

/**
 * A series' rule once its first date moves from `from` to `to` (both clock
 * readings in the series' zone, as `wallTime` gives them).
 *
 * rrule takes what a rule leaves out from the first date, so `FREQ=WEEKLY`
 * moves with it. A rule that names its days stays on them - Google and
 * Outlook always name them, and so do the editor's weekday buttons - and rrule
 * makes no date the rule does not name: `FREQ=WEEKLY;BYDAY=MO` moved to a
 * Tuesday went on with Mondays, and the Tuesday it now starts on never showed.
 *
 * So the days that named the old start move with it: a weekly rule's weekdays
 * turn round by as many days as the start moved, a monthly rule's numbered
 * days shift by as many, and a yearly date becomes the new one. A rule that
 * does not name the old start's day is left as it is, and so is one whose days
 * are not the start's (a daily rule's weekdays, an nth weekday of the month).
 */
export function ruleForMovedStart(rrule: string, from: DateTime, to: DateTime): string {
  const days = Math.round(to.startOf('day').diff(from.startOf('day'), 'days').days)
  if (days === 0 || !/^[A-Z0-9=;,+-]+$/i.test(rrule)) return rrule

  const parts = rrule.split(';').map((part) => {
    const at = part.indexOf('=')
    return { key: part.slice(0, at).toUpperCase(), value: part.slice(at + 1) }
  })
  const value = (key: string): string | undefined => parts.find((p) => p.key === key)?.value
  const list = (key: string): string[] => (value(key) ?? '').split(',').filter(Boolean)
  let changed = false
  const set = (key: string, next: string): void => {
    const part = parts.find((p) => p.key === key)!
    changed ||= part.value !== next
    part.value = next
  }
  const freq = value('FREQ')?.toUpperCase()
  const pickers = ['BYDAY', 'BYYEARDAY', 'BYWEEKNO', 'BYSETPOS'].filter((key) => value(key) !== undefined)

  if (freq === 'WEEKLY' && value('BYDAY') !== undefined) {
    const named = list('BYDAY').map((d) => WEEKDAY_CODES.indexOf(d.toUpperCase()))
    // Only when the new day isn't one of the rule's already: "every weekday" started on a
    // Tuesday instead of a Monday is still every weekday, not Tuesday to Saturday.
    if (!named.includes(-1) && named.includes(from.weekday - 1) && !named.includes(to.weekday - 1)) {
      set('BYDAY', named.map((d) => WEEKDAY_CODES[(((d + days) % 7) + 7) % 7]).join(','))
    }
  } else if (freq === 'MONTHLY' && pickers.length === 0) {
    const named = list('BYMONTHDAY').map(Number)
    if (named.includes(from.day)) {
      // A day counted from the end of the month (-1) is not a date that moves.
      const shifted = named.map((d) => (d > 0 ? d + to.day - from.day : d))
      const valid = shifted.every((d) => d < 0 || (d >= 1 && d <= 31))
      set('BYMONTHDAY', (valid ? shifted : named.map((d) => (d === from.day ? to.day : d))).join(','))
    }
  } else if (freq === 'YEARLY' && pickers.length === 0) {
    if (value('BYMONTH') === String(from.month)) set('BYMONTH', String(to.month))
    if (value('BYMONTHDAY') === String(from.day)) set('BYMONTHDAY', String(to.day))
  }
  return changed ? parts.map((p) => `${p.key}=${p.value}`).join(';') : rrule
}

const DAY_MS = 86_400_000

function ruleParts(rrule: string): Map<string, string> {
  return new Map(rrule.toUpperCase().split(';').map((part) => part.split('=') as [string, string]))
}

/** The days a rule names, as one string to compare. */
export function namedDays(rrule: string): string {
  const parts = ruleParts(rrule)
  return ['BYDAY', 'BYMONTHDAY', 'BYMONTH'].map((key) => (parts.get(key) ?? '').split(',').sort().join(',')).join(';')
}

/**
 * How far, on the clock, each date of a series moves when its first date
 * moves from `from` to `to` and its rule goes from `stored` to `rule`: what a
 * deleted or changed occurrence, keyed by the date it was, has to move by to
 * stay on its occurrence.
 *
 * The time of day moves as the start's did. The day moves with it only as far
 * as the dates do: not at all where the rule names days the move left alone
 * (every weekday, the second Tuesday), by the start's move within one period
 * for a daily or weekly series - a weekly series started a week later is on
 * the same dates - by the change of day of the month for a monthly one, and
 * of date in the year for a yearly one.
 */
export function occurrenceShift(stored: string, rule: string, from: DateTime, to: DateTime): number {
  const total = to.toMillis() - from.toMillis()
  const clock = total - Math.round(to.startOf('day').diff(from.startOf('day'), 'days').days) * DAY_MS
  const parts = ruleParts(rule)
  const names = ['BYDAY', 'BYMONTHDAY', 'BYMONTH', 'BYYEARDAY', 'BYWEEKNO', 'BYSETPOS'].some((key) => parts.has(key))
  if (names && namedDays(rule) === namedDays(stored)) return clock

  const interval = Math.max(1, Number(parts.get('INTERVAL')) || 1)
  /** `total` less whole periods, as near nought as it goes. */
  const withinPeriod = (period: number): number => {
    const rest = ((total % period) + period) % period
    return rest > period / 2 ? rest - period : rest
  }
  switch (parts.get('FREQ')) {
    case 'DAILY':
      return withinPeriod(interval * DAY_MS)
    case 'WEEKLY':
      return withinPeriod(7 * interval * DAY_MS)
    case 'MONTHLY':
      return (to.day - from.day) * DAY_MS + clock
    case 'YEARLY': {
      const sameYear = to.set({ year: from.year })
      return sameYear.isValid && sameYear.month === to.month ? sameYear.toMillis() - from.toMillis() : total
    }
    default:
      return total
  }
}

/**
 * What "all events" sends for a change made on one occurrence.
 *
 * The editor and a drop both describe the occurrence they were opened on: its
 * own date, with the new time. Sent to the series as it stood, that date became
 * the series' first: renaming the fifth meeting of a weekly series and choosing
 * "all events" removed the four before it, here and on the provider after the
 * next sync.
 *
 * The series keeps its first date and takes what changed instead. Its start
 * moves by as much as the occurrence's did, measured on the clock - a 09:00
 * series moved to 10:00 from a winter occurrence is 10:00 in summer too - and
 * it gets the occurrence's new length. An occurrence left where it was leaves
 * the series where it was.
 */
export function seriesWideUpdate(
  input: UpdateEventInput,
  originalStartUtc: string,
  series: { event: CalendarEvent; exceptions: EventException[] }
): UpdateEventInput {
  if (!input.dtStartUtc) return input
  const master = series.event
  const at = Date.parse(originalStartUtc)
  // Where the occurrence was before this change: an earlier move of it alone counts.
  const moved = series.exceptions.find((ex) => Date.parse(ex.originalStartUtc) === at && !ex.isCancelled)
  const occurrenceStartUtc = moved?.dtStartUtc || originalStartUtc

  const fromZone = seriesZone(master.allDay, master.tzid)
  const toZone = seriesZone(input.allDay ?? master.allDay, input.tzid ?? master.tzid)
  const shift = wallClock(input.dtStartUtc, toZone) - wallClock(occurrenceStartUtc, fromZone)
  const start = DateTime.fromMillis(wallClock(master.dtStartUtc, fromZone) + shift, { zone: 'utc' })
    .setZone(toZone, { keepLocalTime: true })
    .toUTC()
  const lengthMs = input.dtEndUtc
    ? Date.parse(input.dtEndUtc) - Date.parse(input.dtStartUtc)
    : Date.parse(master.dtEndUtc) - Date.parse(master.dtStartUtc)
  if (!start.isValid || !Number.isFinite(lengthMs)) return input

  return {
    ...input,
    dtStartUtc: start.toISO()!,
    dtEndUtc: start.plus({ milliseconds: lengthMs }).toISO()!
  }
}
