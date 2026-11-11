import { describe, it, expect, beforeEach } from 'vitest'
import { DateTime } from 'luxon'
import { createSqliteDriver, type ISqliteDatabase } from '../src/main/db/sqlite-driver'
import { runMigrations, seedDefaultData } from '../src/main/db/database'
import { CalendarsRepo } from '../src/main/db/repos/calendars-repo'
import { EventsRepo } from '../src/main/db/repos/events-repo'
import { ruleForMovedStart, seriesWideUpdate } from '../src/shared/series-update'
import type { UpdateEventInput } from '../src/shared/event-model'

/**
 * A rule that names its days - Google and Outlook always write them, and the
 * editor's weekday buttons do - stays on them when the series' first date
 * moves, and rrule makes no date the rule does not name: a Monday series
 * moved to Tuesday kept its Mondays and never showed the Tuesday.
 */
describe('a series moved to another day repeats on that day', () => {
  let db: ISqliteDatabase
  let repo: EventsRepo
  let cal: string

  beforeEach(() => {
    db = createSqliteDriver(':memory:')
    runMigrations(db)
    seedDefaultData(db)
    repo = new EventsRepo(db)
    cal = new CalendarsRepo(db).createCalendar({ name: 'Work', color: '#8b5cf6' }).id
  })

  /** Mondays from 7 September, 09:00-09:30 UTC. */
  const mondays = (rrule = 'FREQ=WEEKLY;BYDAY=MO'): string =>
    repo.createEvent({
      calendarId: cal,
      title: 'Standup',
      dtStartUtc: '2026-09-07T09:00:00.000Z',
      dtEndUtc: '2026-09-07T09:30:00.000Z',
      rrule
    }).id

  const september = (): string[] =>
    repo
      .queryEventsByRange([cal], '2026-09-01T00:00:00.000Z', '2026-09-30T23:59:59.999Z')
      .map((o) => DateTime.fromISO(o.startUtc, { zone: 'utc' }).toFormat('ccc dd HH:mm'))

  it('the whole series, edited from search with the rule the editor rebuilt', () => {
    const id = mondays()
    // The editor sends the rule its controls build: still Monday's button.
    repo.updateEvent(id, {
      dtStartUtc: '2026-09-08T09:00:00.000Z',
      dtEndUtc: '2026-09-08T09:30:00.000Z',
      rrule: 'FREQ=WEEKLY;BYDAY=MO'
    })

    expect(repo.getEventById(id)!.event.rrule).toBe('FREQ=WEEKLY;BYDAY=TU')
    expect(september()).toEqual(['Tue 08 09:00', 'Tue 15 09:00', 'Tue 22 09:00', 'Tue 29 09:00'])
  })

  it('"all events" from an occurrence dragged a day later', () => {
    const id = mondays()
    const input: UpdateEventInput = { dtStartUtc: '2026-09-15T09:00:00.000Z', dtEndUtc: '2026-09-15T09:30:00.000Z' }
    repo.updateRecurringScope({
      masterEventId: id,
      originalStartUtc: '2026-09-14T09:00:00.000Z',
      scope: 'all',
      updateInput: seriesWideUpdate(input, '2026-09-14T09:00:00.000Z', repo.getEventById(id)!)
    })

    expect(september()).toEqual(['Tue 08 09:00', 'Tue 15 09:00', 'Tue 22 09:00', 'Tue 29 09:00'])
  })

  it('"this and following" from an occurrence moved to the Wednesday', () => {
    const id = mondays('FREQ=WEEKLY;BYDAY=MO,TH')
    repo.updateRecurringScope({
      masterEventId: id,
      originalStartUtc: '2026-09-14T09:00:00.000Z',
      scope: 'future',
      updateInput: { dtStartUtc: '2026-09-16T09:00:00.000Z', dtEndUtc: '2026-09-16T09:30:00.000Z' }
    })

    // Both days move on by two, as the first did.
    expect(september()).toEqual([
      'Mon 07 09:00',
      'Thu 10 09:00',
      'Wed 16 09:00',
      'Sat 19 09:00',
      'Wed 23 09:00',
      'Sat 26 09:00',
      'Wed 30 09:00'
    ])
  })

  it('a monthly series on a numbered day moves to the new day', () => {
    // Outlook writes a monthly series by date as BYMONTHDAY.
    const id = repo.createEvent({
      calendarId: cal,
      title: 'Rent',
      dtStartUtc: '2026-09-15T00:00:00.000Z',
      dtEndUtc: '2026-09-15T23:59:59.999Z',
      allDay: true,
      rrule: 'FREQ=MONTHLY;BYMONTHDAY=15'
    }).id
    repo.updateEvent(id, { dtStartUtc: '2026-09-16T00:00:00.000Z', dtEndUtc: '2026-09-16T23:59:59.999Z' })

    const shown = repo
      .queryEventsByRange([cal], '2026-09-01T00:00:00.000Z', '2026-11-30T23:59:59.999Z')
      .map((o) => o.startUtc.slice(0, 10))
    expect(shown).toEqual(['2026-09-16', '2026-10-16', '2026-11-16'])
  })

  it('leaves days the user picked in the editor as they are', () => {
    const id = mondays()
    repo.updateEvent(id, {
      dtStartUtc: '2026-09-08T09:00:00.000Z',
      dtEndUtc: '2026-09-08T09:30:00.000Z',
      rrule: 'FREQ=WEEKLY;BYDAY=TU,FR'
    })
    expect(repo.getEventById(id)!.event.rrule).toBe('FREQ=WEEKLY;BYDAY=TU,FR')
  })
})

describe('ruleForMovedStart', () => {
  const at = (iso: string): DateTime => DateTime.fromISO(iso, { zone: 'utc' })
  const monday = at('2026-09-07T09:00')

  it('leaves a rule alone when the date stays and only the time moves', () => {
    expect(ruleForMovedStart('FREQ=WEEKLY;BYDAY=MO', monday, at('2026-09-07T10:00'))).toBe('FREQ=WEEKLY;BYDAY=MO')
  })

  it('turns the days round by as many as the start moved, either way', () => {
    expect(ruleForMovedStart('FREQ=WEEKLY;BYDAY=MO,WE', monday, at('2026-09-08T09:00'))).toBe('FREQ=WEEKLY;BYDAY=TU,TH')
    expect(ruleForMovedStart('FREQ=WEEKLY;BYDAY=MO', monday, at('2026-09-06T09:00'))).toBe('FREQ=WEEKLY;BYDAY=SU')
    expect(ruleForMovedStart('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO;COUNT=5', monday, at('2026-09-11T09:00'))).toBe(
      'FREQ=WEEKLY;INTERVAL=2;BYDAY=FR;COUNT=5'
    )
  })

  it('leaves the days of a daily rule, which are not where the start falls', () => {
    expect(ruleForMovedStart('FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR', monday, at('2026-09-08T09:00'))).toBe(
      'FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR'
    )
  })

  it('moves a numbered day of the month, and a yearly date', () => {
    const fifteenth = at('2026-09-15T00:00')
    expect(ruleForMovedStart('FREQ=MONTHLY;BYMONTHDAY=15', fifteenth, at('2026-09-16T00:00'))).toBe(
      'FREQ=MONTHLY;BYMONTHDAY=16'
    )
    expect(ruleForMovedStart('FREQ=MONTHLY;BYMONTHDAY=1,15', fifteenth, at('2026-09-17T00:00'))).toBe(
      'FREQ=MONTHLY;BYMONTHDAY=3,17'
    )
    expect(ruleForMovedStart('FREQ=YEARLY;BYMONTH=9;BYMONTHDAY=15', fifteenth, at('2026-10-02T00:00'))).toBe(
      'FREQ=YEARLY;BYMONTH=10;BYMONTHDAY=2'
    )
  })

  it('leaves a rule that does not name the start day, and one it cannot read', () => {
    expect(ruleForMovedStart('FREQ=WEEKLY', monday, at('2026-09-08T09:00'))).toBe('FREQ=WEEKLY')
    expect(ruleForMovedStart('FREQ=WEEKLY;BYDAY=WE', monday, at('2026-09-08T09:00'))).toBe('FREQ=WEEKLY;BYDAY=WE')
    expect(ruleForMovedStart('FREQ=MONTHLY;BYDAY=2MO', monday, at('2026-09-08T09:00'))).toBe('FREQ=MONTHLY;BYDAY=2MO')
  })
})
