import { DateTime } from 'luxon'
import { RRule, Weekday, rrulestr, type Options } from 'rrule'

/**
 * Recurrence expansion with a ceiling on what one rule may cost.
 *
 * A rule is input like any other - it arrives from providers, subscribed feeds
 * and .ics files - and rrule.js puts no limit on what it spends. It walks a
 * series one period at a time from its first date and stops only once it
 * produces a date past the range, runs out its COUNT, or reaches the year 9999.
 * Measured on 200-byte events, in the main process, which froze the whole app:
 * a daily rule started in the year 1000 took 0.65 s to reach this month; one
 * that can never match (February 30th) walked on to 9999, 4.75 s; a secondly
 * rule took 51 s for a single day; and the hourly/minutely/secondly steppers
 * can loop forever (INTERVAL=24;BYHOUR=5 from 03:00 never reaches 5). A feed
 * holds thousands of events, and a stored one froze every launch after.
 *
 * So: a series that repeats more often than daily is not expanded at all; a
 * yearly one held to one month walks month by month; one with no COUNT starts
 * its walk at the period the range falls in rather than at its first date; and
 * the walk is metered, per series and per calendar.
 */

/** Longer than any real RRULE (the longest seen are ~100 characters); the
 *  BY lists in a longer one cost work per period the meter does not see. */
const MAX_RULE_LENGTH = 512

/** BYHOUR x BYMINUTE x BYSECOND. More than once an hour is a sub-daily series
 *  in all but name, and rrule builds that list in full before the meter runs. */
const MAX_TIMES_PER_DAY = 24

/**
 * Work is counted in reads of the rule's options, which rrule makes for every
 * day it looks at, every date it produces and every step it takes. Real rules
 * measured 5-21 reads per day of the walk (a daily series with four times a
 * day was the most); a series may spend three times that, plus a floor.
 */
const SERIES_WORK_PER_DAY = 64
const SERIES_WORK_FLOOR = 5_000

/** A COUNT series cannot start its walk late - the count runs from its first
 *  date - so its allowance grows with its age, up to this. A 30-year mortgage
 *  is the longest real one; past it, whatever was found in the allowance is
 *  what shows. */
const MAX_WALK_DAYS = 40 * 366

/** What one calendar may spend on all its series in one query: about a
 *  thousand daily series' worth per day of the range, and never less than the
 *  floor, which holds a few hundred series that started decades ago. A feed
 *  of thousands of costly rules then costs a calendar ~1 s, not hours. */
const CALENDAR_WORK_PER_DAY = 20_000
const CALENDAR_WORK_FLOOR = 5_000_000

const DAY_MS = 86_400_000

/** Work left for the series of one calendar in one range query. */
export interface ExpansionBudget {
  remaining: number
}

export function calendarExpansionBudget(rangeStartUtc: string, rangeEndUtc: string): ExpansionBudget {
  const days = Math.max(0, (Date.parse(rangeEndUtc) - Date.parse(rangeStartUtc)) / DAY_MS)
  return { remaining: Math.max(CALENDAR_WORK_FLOOR, CALENDAR_WORK_PER_DAY * days) }
}

/** A rule this module will not expand; the caller shows the series' first
 *  occurrence alone, as it does for a rule rrule cannot parse. */
export class UnexpandableRuleError extends Error {
  constructor(reason: string) {
    super(`Recurrence not expanded: ${reason}`)
    this.name = 'UnexpandableRuleError'
  }
}

class OutOfWork extends Error {}

/**
 * The dates of `ruleString` (an RRULE value, or DTSTART + RRULE lines) from
 * `after` to `before`, both inclusive - what `rrulestr(...).between(after,
 * before, true)` returns, at a bounded cost. A walk that runs out of work
 * returns the dates found so far: for a rule that has no more dates in reach
 * (the walk past the range looking for the next one) that is all of them.
 */
export function boundedBetween(
  ruleString: string,
  dtstart: Date,
  after: Date,
  before: Date,
  budget?: ExpansionBudget
): Date[] {
  if (ruleString.length > MAX_RULE_LENGTH) throw new UnexpandableRuleError('rule too long')
  const parsed = rrulestr(ruleString, { dtstart })
  if (!(parsed instanceof RRule)) throw new UnexpandableRuleError('more than one rule')

  const { freq, byhour, byminute, bysecond } = parsed.options
  if (freq > RRule.DAILY) throw new UnexpandableRuleError('repeats more often than daily')
  const timesPerDay = (byhour?.length || 1) * (byminute?.length || 1) * (bysecond?.length || 1)
  if (timesPerDay > MAX_TIMES_PER_DAY) throw new UnexpandableRuleError('too many times a day')

  const rule = startingNear(monthlyIfOneMonth(parsed), after)
  const walkDays = Math.max(0, (before.getTime() - rule.options.dtstart.getTime()) / DAY_MS)
  const allowance = Math.min(
    SERIES_WORK_FLOOR + SERIES_WORK_PER_DAY * Math.min(walkDays, MAX_WALK_DAYS),
    budget?.remaining ?? Infinity
  )

  const dates: Date[] = []
  const meter = metered(rule, allowance)
  try {
    rule.between(after, before, true, (date) => {
      dates.push(date)
      return true
    })
  } catch (err) {
    if (!(err instanceof OutOfWork)) throw err
  } finally {
    if (budget) budget.remaining = Math.max(0, budget.remaining - meter.reads)
  }
  return dates
}

/** Count reads of the rule's options, and stop the walk past the allowance.
 *  The options object is threaded through every part of rrule's iteration. */
function metered(rule: RRule, allowance: number): { reads: number } {
  const meter = { reads: 0 }
  rule.options = new Proxy(rule.options, {
    get(target, key, receiver) {
      if (++meter.reads > allowance) throw new OutOfWork()
      return Reflect.get(target, key, receiver)
    }
  })
  return meter
}

/**
 * A yearly rule held to one month, as a monthly rule every 12 x INTERVAL months:
 * the same dates for a tenth of the work. rrule looks at every day of a yearly
 * period - 365 checks to find one birthday, in the year of the range and again
 * in the next, where the walk stops - and a calendar of contacts' birthdays
 * holds thousands of them: about a thousand used up a calendar's allowance, and
 * the rest went missing.
 *
 * Exact because whatever picks days within the year here picks them within
 * that month: BYMONTHDAY, BYDAY (rrule counts an ordinal one within the BYMONTH
 * month), and BYSETPOS, over a set that lies wholly in it. A rule that numbers
 * days or weeks of the year (BYYEARDAY, BYWEEKNO, BYEASTER) stays yearly. The
 * first monthly period is the first month the yearly rule reaches.
 */
function monthlyIfOneMonth(rule: RRule): RRule {
  const options = rule.options
  if (options.freq !== RRule.YEARLY || options.bymonth?.length !== 1) return rule
  if (options.byyearday?.length || options.byweekno?.length || options.byeaster !== null) return rule

  const month = options.bymonth[0]
  const first = DateTime.fromJSDate(options.dtstart, { zone: 'utc' })
  // In DTSTART's own month the series still starts at DTSTART; before it, that
  // month has passed for the first year.
  const dtstart =
    month === first.month
      ? options.dtstart
      : first
          .startOf('year')
          .plus({ years: month < first.month ? options.interval : 0, months: month - 1 })
          .set({ millisecond: first.millisecond })
          .toJSDate()
  return new RRule({
    ...explicitOptions(options),
    freq: RRule.MONTHLY,
    interval: options.interval * 12,
    count: options.count,
    dtstart
  })
}

/**
 * The same series, started at the beginning of the period `near` falls in
 * (or the last one the INTERVAL lands on before it) instead of at its first
 * date, so the walk skips the years in between.
 *
 * Exact because rrule fills in what a rule leaves out from its DTSTART (the
 * day of the month, the month, the weekday, the time of day), and those are
 * written into the moved rule explicitly. The period is whole from its first
 * instant, so nothing in it is cut off by the new start either. A COUNT series
 * is left as it is: its count runs from its own first date.
 */
function startingNear(rule: RRule, near: Date): RRule {
  const options = rule.options
  if (options.count !== null) return rule

  const { freq, interval, wkst } = options
  const first = periodStart(DateTime.fromJSDate(options.dtstart, { zone: 'utc' }), freq, wkst)
  const target = periodStart(DateTime.fromJSDate(near, { zone: 'utc' }), freq, wkst)
  const skipped = Math.floor(periodsBetween(first, target, freq) / interval) * interval
  if (skipped <= 0) return rule

  const unit = freq === RRule.YEARLY ? 'years' : freq === RRule.MONTHLY ? 'months' : freq === RRule.WEEKLY ? 'weeks' : 'days'
  const dtstart = first
    .plus({ [unit]: skipped })
    // rrule takes the millisecond of every date from DTSTART's.
    .set({ millisecond: options.dtstart.getUTCMilliseconds() })
    .toJSDate()
  return new RRule({ ...explicitOptions(options), dtstart })
}

/** The first instant of the period (year, month, week from WKST, day) that
 *  rrule steps by for `freq`. rrule numbers weekdays from Monday = 0. */
function periodStart(dt: DateTime, freq: number, wkst: number): DateTime {
  if (freq === RRule.YEARLY) return dt.startOf('year')
  if (freq === RRule.MONTHLY) return dt.startOf('month')
  if (freq === RRule.WEEKLY) return dt.startOf('day').minus({ days: (dt.weekday - 1 - wkst + 7) % 7 })
  return dt.startOf('day')
}

function periodsBetween(from: DateTime, to: DateTime, freq: number): number {
  if (freq === RRule.YEARLY) return to.year - from.year
  if (freq === RRule.MONTHLY) return (to.year - from.year) * 12 + to.month - from.month
  const days = Math.round(to.diff(from, 'days').days)
  return freq === RRule.WEEKLY ? Math.round(days / 7) : days
}

/** Parsed options as rule options, with everything rrule derived from the
 *  first date spelled out, so a new DTSTART changes nothing else. rrule splits
 *  BYDAY into plain and nth weekdays, and BYMONTHDAY by sign; they are joined
 *  back. Its parsed lists may be null at runtime whatever the types say. */
function explicitOptions(options: RRule['options']): Partial<Options> {
  const weekdays = [
    ...(options.byweekday ?? []).map((day) => new Weekday(day)),
    ...(options.bynweekday ?? []).map(([day, n]) => new Weekday(day, n))
  ]
  const monthdays = [...(options.bymonthday ?? []), ...(options.bynmonthday ?? [])]
  return {
    freq: options.freq,
    interval: options.interval,
    wkst: options.wkst,
    until: options.until,
    tzid: options.tzid,
    bysetpos: options.bysetpos,
    bymonth: options.bymonth,
    byyearday: options.byyearday,
    byweekno: options.byweekno,
    byeaster: options.byeaster,
    byhour: options.byhour,
    byminute: options.byminute,
    bysecond: options.bysecond,
    byweekday: weekdays.length > 0 ? weekdays : null,
    bymonthday: monthdays.length > 0 ? monthdays : null
  }
}
