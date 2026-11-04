import { describe, it, expect } from 'vitest'
import { rrulestr } from 'rrule'
import {
  boundedBetween,
  calendarExpansionBudget,
  UnexpandableRuleError,
  type ExpansionBudget
} from '../src/shared/bounded-rrule'

/**
 * boundedBetween() must return exactly what rrule's own between() does for any
 * real rule - it only starts the walk later and stops it sooner. Each rule here
 * is expanded both ways from three first dates (a month end with milliseconds,
 * a leap day, a Sunday midnight) over ranges decades later, across a year end,
 * three years long, and right at the start.
 */
const RULES = [
  'FREQ=DAILY',
  'FREQ=DAILY;INTERVAL=3',
  'FREQ=DAILY;BYDAY=MO,WE,FR',
  'FREQ=DAILY;BYHOUR=8,17;BYMINUTE=0,30',
  'FREQ=WEEKLY',
  'FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,TH',
  'FREQ=WEEKLY;INTERVAL=3;WKST=SU;BYDAY=SU,SA',
  'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1',
  'FREQ=MONTHLY',
  'FREQ=MONTHLY;INTERVAL=5',
  'FREQ=MONTHLY;BYMONTHDAY=31',
  'FREQ=MONTHLY;BYMONTHDAY=-1',
  'FREQ=MONTHLY;BYDAY=-1FR',
  'FREQ=MONTHLY;INTERVAL=2;BYDAY=2TU,4TU',
  'FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=1,-1',
  'FREQ=YEARLY',
  'FREQ=YEARLY;INTERVAL=4',
  'FREQ=YEARLY;BYMONTH=11;BYDAY=4TH',
  'FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=29',
  'FREQ=YEARLY;BYWEEKNO=1;BYDAY=MO',
  'FREQ=YEARLY;BYYEARDAY=100,-1',
  // Held to one month, so expanded month by month - from a first date before,
  // in and after that month.
  'FREQ=YEARLY;BYMONTH=1',
  'FREQ=YEARLY;BYMONTH=3',
  'FREQ=YEARLY;BYMONTH=6;BYMONTHDAY=16',
  'FREQ=YEARLY;INTERVAL=3;BYMONTH=1;BYMONTHDAY=-1',
  'FREQ=YEARLY;BYMONTH=9;BYDAY=1MO',
  'FREQ=YEARLY;INTERVAL=2;BYMONTH=5;BYDAY=-1SU',
  'FREQ=YEARLY;BYMONTH=6;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1',
  'FREQ=YEARLY;BYMONTH=12;BYDAY=SA,SU;BYHOUR=9,18',
  'FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=29;COUNT=6',
  'FREQ=YEARLY;COUNT=40',
  'FREQ=YEARLY;UNTIL=20290101T000000Z',
  'FREQ=YEARLY;BYMONTH=1,7',
  'FREQ=WEEKLY;UNTIL=20261015T000000Z',
  'FREQ=DAILY;UNTIL=20200101T000000Z',
  'FREQ=WEEKLY;COUNT=1000',
  'FREQ=MONTHLY;COUNT=360'
]

const FIRST_DATES = [
  new Date('2001-01-31T09:30:15.250Z'),
  new Date('2004-02-29T23:00:00.000Z'),
  new Date('2019-06-16T00:00:00.000Z')
]

const RANGES: [string, string][] = [
  ['2026-10-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z'],
  ['2026-12-28T00:00:00.000Z', '2027-01-04T00:00:00.000Z'],
  ['2028-01-01T00:00:00.000Z', '2030-12-31T23:59:59.999Z'],
  ['2019-06-01T00:00:00.000Z', '2019-07-01T00:00:00.000Z']
]

function iso(dates: Date[]): string[] {
  return dates.map((d) => d.toISOString())
}

/** As expand-occurrences.ts builds it: a DTSTART line plus the stored rule. */
function ruleString(rule: string, dtstart: Date): string {
  return `DTSTART:${dtstart.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '')}\nRRULE:${rule}`
}

/** The work one expansion spent, read off an allowance too large to run out. */
function work(rule: string, dtstart: Date, after: string, before: string): { dates: string[]; spent: number } {
  const budget: ExpansionBudget = { remaining: 1e12 }
  const dates = boundedBetween(ruleString(rule, dtstart), dtstart, new Date(after), new Date(before), budget)
  return { dates: iso(dates), spent: 1e12 - budget.remaining }
}

describe('boundedBetween returns what rrule does', () => {
  it.each(RULES)('%s', (rule) => {
    for (const dtstart of FIRST_DATES) {
      for (const [after, before] of RANGES) {
        const text = ruleString(rule, dtstart)
        const expected = rrulestr(text, { dtstart }).between(new Date(after), new Date(before), true)
        const actual = boundedBetween(text, dtstart, new Date(after), new Date(before))
        expect(iso(actual), `${dtstart.toISOString()} ${after}..${before}`).toEqual(iso(expected))
      }
    }
  })
})

describe('boundedBetween keeps the cost of a rule bounded', () => {
  // Without these limits the same rules took 0.65 s, 4.75 s, 51 s, and forever.

  it('walks only this month of a daily series that started in the year 1000', () => {
    const { dates, spent } = work('FREQ=DAILY', new Date('1000-01-01T09:00:00.000Z'), '2026-10-01T00:00:00.000Z', '2026-10-31T23:59:59.999Z')
    expect(dates).toHaveLength(31)
    expect(dates[0]).toBe('2026-10-01T09:00:00.000Z')
    expect(spent).toBeLessThan(2_000)
  })

  it.each([
    'FREQ=WEEKLY;INTERVAL=3;WKST=SU;BYDAY=SU,SA',
    'FREQ=MONTHLY;BYDAY=-1FR',
    'FREQ=YEARLY;BYWEEKNO=1;BYDAY=MO'
  ])('starts the walk near the range, not at the first date: %s', (rule) => {
    // From 2001, rrule's own walk to this month spent 30,514 / 70,953 / 69,765.
    const { spent } = work(rule, FIRST_DATES[0], '2026-10-01T00:00:00.000Z', '2026-10-31T23:59:59.999Z')
    expect(spent).toBeLessThan(10_000)
  })

  it('expands a yearly rule held to one month month by month', () => {
    // As yearly periods, rrule checked every day of two years: 5,140 reads for
    // one birthday, and 11,400 for one on February 29th seen in March 2028.
    const birthday = work('FREQ=YEARLY', new Date('1975-05-15T00:00:00.000Z'), '2026-11-30T00:00:00.000Z', '2027-01-10T23:59:59.999Z')
    expect(birthday.spent).toBeLessThan(1_000)
    const leapDay = work('FREQ=YEARLY', new Date('1996-02-29T00:00:00.000Z'), '2028-02-28T00:00:00.000Z', '2028-04-09T23:59:59.999Z')
    expect(leapDay.dates).toEqual(['2028-02-29T00:00:00.000Z'])
    expect(leapDay.spent).toBeLessThan(2_000)
  })

  it('gives up on a rule that can never match (February 30th) at its allowance', () => {
    // rrule's own walk read the options 49.5 million times, to the year 9999.
    const { dates, spent } = work('FREQ=DAILY;BYMONTH=2;BYMONTHDAY=30', new Date('2026-01-01T09:00:00.000Z'), '2026-10-01T00:00:00.000Z', '2026-10-31T23:59:59.999Z')
    expect(dates).toEqual([])
    expect(spent).toBeLessThan(10_000)
  })

  it('keeps what it found in the range when the walk past it runs out', () => {
    // The next February 29th after 2028 is in 2032 - more walking than allowed.
    const { dates } = work('FREQ=DAILY;BYMONTH=2;BYMONTHDAY=29', new Date('2001-01-01T09:00:00.000Z'), '2028-02-01T00:00:00.000Z', '2028-03-01T00:00:00.000Z')
    expect(dates).toEqual(['2028-02-29T09:00:00.000Z'])
  })

  it('caps a COUNT series, which has to walk from its first date', () => {
    const { spent } = work('FREQ=DAILY;COUNT=1000000000', new Date('1000-01-01T09:00:00.000Z'), '2026-10-01T00:00:00.000Z', '2026-10-31T23:59:59.999Z')
    expect(spent).toBeLessThan(1_000_000)
  })

  it.each([
    'FREQ=SECONDLY',
    'FREQ=MINUTELY;INTERVAL=5',
    'FREQ=HOURLY',
    // rrule's hourly stepper never reaches 05:00 from 03:00 in 24-hour steps.
    'FREQ=HOURLY;INTERVAL=24;BYHOUR=5'
  ])('does not expand a rule that repeats more often than daily: %s', (rule) => {
    const dtstart = new Date('2026-01-01T03:00:00.000Z')
    expect(() => boundedBetween(ruleString(rule, dtstart), dtstart, new Date('2026-10-01T00:00:00.000Z'), new Date('2026-10-02T00:00:00.000Z'))).toThrow(UnexpandableRuleError)
  })

  it('does not expand a daily rule with more than 24 times a day, or an overlong rule', () => {
    const dtstart = new Date('2026-01-01T00:00:00.000Z')
    const after = new Date('2026-10-01T00:00:00.000Z')
    const before = new Date('2026-10-02T00:00:00.000Z')
    const halfHourly = `FREQ=DAILY;BYHOUR=${Array.from({ length: 24 }, (_, h) => h).join(',')};BYMINUTE=0,30`
    const overlong = `FREQ=YEARLY;BYSETPOS=${Array.from({ length: 200 }, (_, i) => i + 1).join(',')}`
    expect(() => boundedBetween(ruleString(halfHourly, dtstart), dtstart, after, before)).toThrow(UnexpandableRuleError)
    expect(() => boundedBetween(ruleString(overlong, dtstart), dtstart, after, before)).toThrow(UnexpandableRuleError)
  })
})

describe('a calendar shares one allowance across its series', () => {
  const range = ['2026-10-01T00:00:00.000Z', '2026-10-31T23:59:59.999Z'] as const
  const dtstart = new Date('2026-01-01T09:00:00.000Z')

  it('stops spending once a feed of costly rules has used it up', () => {
    const budget = calendarExpansionBudget(...range)
    const allowance = budget.remaining
    for (let i = 0; i < 5_000; i++) {
      boundedBetween(ruleString('FREQ=DAILY;BYMONTH=2;BYMONTHDAY=30', dtstart), dtstart, new Date(range[0]), new Date(range[1]), budget)
    }
    expect(budget.remaining).toBe(0)
    expect(allowance).toBeLessThanOrEqual(5_000_000)
  })

  it('holds far more ordinary series than anyone keeps in one calendar', () => {
    const budget = calendarExpansionBudget(...range)
    for (let i = 0; i < 1_000; i++) {
      const dates = boundedBetween(ruleString('FREQ=DAILY', dtstart), dtstart, new Date(range[0]), new Date(range[1]), budget)
      expect(dates).toHaveLength(31)
    }
    expect(budget.remaining).toBeGreaterThan(0)
  })

  it('holds a calendar of five thousand birthdays', () => {
    // Contacts' birthdays come as one yearly series each. At a yearly series'
    // own cost the allowance ran out after about a thousand, and in a month
    // with 115 birthdays among a thousand, 9 were missing.
    const budget = calendarExpansionBudget(...range)
    let found = 0
    for (let i = 0; i < 5_000; i++) {
      const birth = new Date(Date.UTC(1950 + (i % 56), 0, 1 + (i % 365)))
      found += boundedBetween(ruleString('FREQ=YEARLY', birth), birth, new Date(range[0]), new Date(range[1]), budget).length
    }
    // Days 274-304 of the year are October's 31 days.
    expect(found).toBe(Array.from({ length: 5_000 }, (_, i) => i % 365).filter((d) => d >= 273 && d <= 303).length)
    expect(budget.remaining).toBeGreaterThan(0)
  })
})
