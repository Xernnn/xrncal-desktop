import { describe, it, expect, beforeEach } from 'vitest'
import { DateTime } from 'luxon'
import { createSqliteDriver, type ISqliteDatabase } from '../src/main/db/sqlite-driver'
import { runMigrations, seedDefaultData } from '../src/main/db/database'
import { CalendarsRepo } from '../src/main/db/repos/calendars-repo'
import { EventsRepo } from '../src/main/db/repos/events-repo'
import { occurrenceShift, seriesWideUpdate } from '../src/shared/series-update'

/**
 * A deleted or changed occurrence is a row keyed by the date the series gave
 * it. Moving the series moved its dates but not the keys, so nothing matched
 * them any more: a deleted date came back, at the new time, and a changed one
 * lost its change.
 */
describe('a series moved in time keeps its deleted and changed dates', () => {
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

  /** Mondays at 09:00 UTC from 5 October; 12 October deleted, 19 October renamed, 26 October moved to 14:00. */
  function mondays(rrule = 'FREQ=WEEKLY;BYDAY=MO'): string {
    const id = repo.createEvent({
      calendarId: cal,
      title: 'Standup',
      dtStartUtc: '2026-10-05T09:00:00.000Z',
      dtEndUtc: '2026-10-05T09:30:00.000Z',
      rrule
    }).id
    repo.deleteRecurringScope({ masterEventId: id, originalStartUtc: '2026-10-12T09:00:00.000Z', scope: 'this' })
    // The editor sends an occurrence's times with any change, moved or not.
    repo.updateRecurringScope({
      masterEventId: id,
      originalStartUtc: '2026-10-19T09:00:00.000Z',
      scope: 'this',
      updateInput: { title: 'Retro', dtStartUtc: '2026-10-19T09:00:00.000Z', dtEndUtc: '2026-10-19T09:30:00.000Z' }
    })
    repo.updateRecurringScope({
      masterEventId: id,
      originalStartUtc: '2026-10-26T09:00:00.000Z',
      scope: 'this',
      updateInput: { title: 'Moved', dtStartUtc: '2026-10-26T14:00:00.000Z', dtEndUtc: '2026-10-26T14:30:00.000Z' }
    })
    return id
  }

  const october = (): string[] =>
    repo
      .queryEventsByRange([cal], '2026-10-01T00:00:00.000Z', '2026-11-03T00:00:00.000Z')
      .map((o) => `${DateTime.fromISO(o.startUtc, { zone: 'utc' }).toFormat('ccc dd HH:mm')}-${DateTime.fromISO(o.endUtc, { zone: 'utc' }).toFormat('HH:mm')} ${o.title}`)

  it('the whole series an hour later, edited from search', () => {
    const id = mondays()

    repo.updateEvent(id, { dtStartUtc: '2026-10-05T10:00:00.000Z', dtEndUtc: '2026-10-05T11:00:00.000Z' })

    expect(october()).toEqual([
      'Mon 05 10:00-11:00 Standup',
      // 12 October stays deleted; 19 October, left at the series' time, goes with it.
      'Mon 19 10:00-11:00 Retro',
      // Moved on its own, it stays where it was put.
      'Mon 26 14:00-14:30 Moved',
      'Mon 02 10:00-11:00 Standup'
    ])
  })

  it('"all events" from an occurrence dragged an hour later', () => {
    const id = mondays()

    const input = { dtStartUtc: '2026-11-02T10:00:00.000Z', dtEndUtc: '2026-11-02T10:30:00.000Z', title: 'Standup' }
    repo.updateRecurringScope({
      masterEventId: id,
      originalStartUtc: '2026-11-02T09:00:00.000Z',
      scope: 'all',
      updateInput: seriesWideUpdate(input, '2026-11-02T09:00:00.000Z', repo.getEventById(id)!)
    })

    expect(october()).toEqual([
      'Mon 05 10:00-10:30 Standup',
      'Mon 19 10:00-10:30 Retro',
      'Mon 26 14:00-14:30 Moved',
      'Mon 02 10:00-10:30 Standup'
    ])
  })

  it('moved to Tuesdays, each change goes to its Tuesday', () => {
    const id = mondays()

    repo.updateEvent(id, { dtStartUtc: '2026-10-06T09:00:00.000Z', dtEndUtc: '2026-10-06T09:30:00.000Z' })

    expect(october()).toEqual(['Tue 06 09:00-09:30 Standup', 'Tue 20 09:00-09:30 Retro', 'Mon 26 14:00-14:30 Moved'])
  })

  it('"this and following" an hour later takes them along at the new time', () => {
    const id = repo.createEvent({
      calendarId: cal,
      title: 'Standup',
      dtStartUtc: '2026-09-28T09:00:00.000Z',
      dtEndUtc: '2026-09-28T09:30:00.000Z',
      rrule: 'FREQ=WEEKLY;BYDAY=MO',
      // A deletion pushed to CalDAV comes back as an EXDATE.
      exdate: '2026-11-02T09:00:00.000Z'
    }).id
    repo.deleteRecurringScope({ masterEventId: id, originalStartUtc: '2026-10-12T09:00:00.000Z', scope: 'this' })
    repo.updateRecurringScope({
      masterEventId: id,
      originalStartUtc: '2026-10-19T09:00:00.000Z',
      scope: 'this',
      updateInput: { title: 'Retro', dtStartUtc: '2026-10-19T09:00:00.000Z', dtEndUtc: '2026-10-19T09:30:00.000Z' }
    })

    repo.updateRecurringScope({
      masterEventId: id,
      originalStartUtc: '2026-10-05T09:00:00.000Z',
      scope: 'future',
      updateInput: { title: 'Standup', dtStartUtc: '2026-10-05T10:00:00.000Z', dtEndUtc: '2026-10-05T10:30:00.000Z' }
    })

    expect(october()).toEqual(['Mon 05 10:00-10:30 Standup', 'Mon 19 10:00-10:30 Retro', 'Mon 26 10:00-10:30 Standup'])
  })

  it('holds its clock time across a change of offset', () => {
    // 09:00 Berlin: 07:00Z in October, 08:00Z from November.
    const zone = 'Europe/Berlin'
    const local = (iso: string): string => DateTime.fromISO(iso, { zone }).toUTC().toISO()!
    const id = repo.createEvent({
      calendarId: cal,
      title: 'Standup',
      dtStartUtc: local('2026-10-05T09:00'),
      dtEndUtc: local('2026-10-05T09:30'),
      tzid: zone,
      rrule: 'FREQ=WEEKLY;BYDAY=MO'
    }).id
    repo.deleteRecurringScope({ masterEventId: id, originalStartUtc: local('2026-11-09T09:00'), scope: 'this' })

    repo.updateEvent(id, { tzid: zone, dtStartUtc: local('2026-10-05T10:00'), dtEndUtc: local('2026-10-05T10:30') })

    const november = repo
      .queryEventsByRange([cal], '2026-11-01T00:00:00.000Z', '2026-11-20T00:00:00.000Z')
      .map((o) => DateTime.fromISO(o.startUtc, { zone: 'utc' }).setZone(zone).toFormat('dd HH:mm'))
    expect(november).toEqual(['02 10:00', '16 10:00'])
  })

  it('a daily series started a day later keeps its deleted dates on their dates', () => {
    const id = repo.createEvent({
      calendarId: cal,
      title: 'Walk',
      dtStartUtc: '2026-10-05T07:00:00.000Z',
      dtEndUtc: '2026-10-05T08:00:00.000Z',
      rrule: 'FREQ=DAILY'
    }).id
    repo.deleteRecurringScope({ masterEventId: id, originalStartUtc: '2026-10-08T07:00:00.000Z', scope: 'this' })

    repo.updateEvent(id, { dtStartUtc: '2026-10-06T07:00:00.000Z', dtEndUtc: '2026-10-06T08:00:00.000Z' })

    const days = repo
      .queryEventsByRange([cal], '2026-10-01T00:00:00.000Z', '2026-10-10T00:00:00.000Z')
      .map((o) => o.startUtc.slice(8, 10))
    expect(days).toEqual(['06', '07', '09'])
  })

  it('sends the moved rows to the provider again, as new ones', () => {
    const id = mondays()
    // As after a push: clean, with the provider's ids for the old occurrences.
    db.prepare("UPDATE event_exceptions SET dirty = 0, provider_instance_id = 'old', etag = 'e'").run()

    repo.updateEvent(id, { dtStartUtc: '2026-10-05T10:00:00.000Z', dtEndUtc: '2026-10-05T11:00:00.000Z' })

    const rows = db
      .prepare('SELECT original_start_utc, dirty, provider_instance_id, etag FROM event_exceptions ORDER BY original_start_utc')
      .all<{ original_start_utc: string; dirty: number; provider_instance_id: string | null; etag: string | null }>()
    expect(rows).toEqual([
      { original_start_utc: '2026-10-12T10:00:00.000Z', dirty: 1, provider_instance_id: null, etag: null },
      { original_start_utc: '2026-10-19T10:00:00.000Z', dirty: 1, provider_instance_id: null, etag: null },
      { original_start_utc: '2026-10-26T10:00:00.000Z', dirty: 1, provider_instance_id: null, etag: null }
    ])
  })

  it('leaves them alone when the series keeps its times', () => {
    const id = mondays()
    db.prepare("UPDATE event_exceptions SET dirty = 0, provider_instance_id = 'old'").run()

    repo.updateEvent(id, { title: 'Daily standup', dtStartUtc: '2026-10-05T09:00:00.000Z', dtEndUtc: '2026-10-05T09:45:00.000Z' })

    const rows = db.prepare('SELECT dirty, provider_instance_id FROM event_exceptions').all<{ dirty: number }>()
    expect(rows.every((r) => r.dirty === 0)).toBe(true)
  })
})

describe('occurrenceShift', () => {
  const at = (iso: string): DateTime => DateTime.fromISO(iso, { zone: 'utc' })
  const hours = (ms: number): number => ms / 3_600_000

  it('moves the dates as far as the start, within one period of the rule', () => {
    expect(hours(occurrenceShift('FREQ=WEEKLY', 'FREQ=WEEKLY', at('2026-10-05T09:00'), at('2026-10-06T10:00')))).toBe(25)
    // A weekly series started a week later is on the same dates.
    expect(hours(occurrenceShift('FREQ=WEEKLY', 'FREQ=WEEKLY', at('2026-10-05T09:00'), at('2026-10-12T09:00')))).toBe(0)
    expect(hours(occurrenceShift('FREQ=WEEKLY;INTERVAL=2', 'FREQ=WEEKLY;INTERVAL=2', at('2026-10-05T09:00'), at('2026-10-12T09:00')))).toBe(168)
    // 23:30 to half past midnight is an hour later, not 23 hours earlier.
    expect(hours(occurrenceShift('FREQ=DAILY', 'FREQ=DAILY', at('2026-10-05T23:30'), at('2026-10-06T00:30')))).toBe(1)
  })

  it('moves a monthly date by the change of day, whatever the month', () => {
    const shift = occurrenceShift('FREQ=MONTHLY;BYMONTHDAY=15', 'FREQ=MONTHLY;BYMONTHDAY=16', at('2026-09-15T00:00'), at('2026-10-16T00:00'))
    expect(hours(shift)).toBe(24)
  })

  it('keeps the dates of a rule whose days stayed, changing only the time', () => {
    const weekdays = 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR'
    expect(hours(occurrenceShift(weekdays, weekdays, at('2026-10-05T09:00'), at('2026-10-07T10:00')))).toBe(1)
  })
})
