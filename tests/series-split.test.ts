import { describe, it, expect, beforeEach } from 'vitest'
import { createSqliteDriver, type ISqliteDatabase } from '../src/main/db/sqlite-driver'
import { runMigrations, seedDefaultData } from '../src/main/db/database'
import { CalendarsRepo } from '../src/main/db/repos/calendars-repo'
import { EventsRepo } from '../src/main/db/repos/events-repo'
import type { UpdateEventInput } from '../src/shared/event-model'

/**
 * "This and following": the series stops before the occurrence, and a new
 * one carries the rest. The rest is what the series still had - no more
 * dates, and none of its deleted or changed ones lost.
 */
describe('"this and following" keeps the rest of the series as it was', () => {
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

  const weekly = (rrule: string, exdate?: string): string =>
    repo.createEvent({
      calendarId: cal,
      title: 'Standup',
      dtStartUtc: '2026-08-03T09:00:00.000Z',
      dtEndUtc: '2026-08-03T09:30:00.000Z',
      rrule,
      exdate
    }).id

  /** What the editor sends for an occurrence opened from the grid: its own times, no rule. */
  const splitAt = (id: string, originalStartUtc: string, input: UpdateEventInput = {}): void => {
    repo.updateRecurringScope({
      masterEventId: id,
      originalStartUtc,
      scope: 'future',
      updateInput: {
        title: 'Standup (new)',
        dtStartUtc: originalStartUtc,
        dtEndUtc: new Date(Date.parse(originalStartUtc) + 30 * 60_000).toISOString(),
        ...input
      }
    })
  }

  const shown = (): string[] =>
    repo
      .queryEventsByRange([cal], '2026-07-01T00:00:00.000Z', '2027-12-31T23:59:59.999Z')
      .map((o) => `${o.startUtc.slice(0, 10)} ${o.title}`)

  it('a series of four, split at its third date, still has four dates', () => {
    const id = weekly('FREQ=WEEKLY;COUNT=4')

    splitAt(id, '2026-08-17T09:00:00.000Z')

    expect(shown()).toEqual([
      '2026-08-03 Standup',
      '2026-08-10 Standup',
      '2026-08-17 Standup (new)',
      '2026-08-24 Standup (new)'
    ])
  })

  it('counts a deleted date as one of the series, as the rule does', () => {
    // The second date was deleted; the count still includes it.
    const id = weekly('FREQ=WEEKLY;COUNT=4', '2026-08-10T09:00:00.000Z')

    splitAt(id, '2026-08-17T09:00:00.000Z')

    expect(shown()).toEqual(['2026-08-03 Standup', '2026-08-17 Standup (new)', '2026-08-24 Standup (new)'])
  })

  it('a series that ends on a date still ends on it', () => {
    const id = weekly('FREQ=WEEKLY;UNTIL=20260831T235959Z')

    splitAt(id, '2026-08-17T09:00:00.000Z')

    expect(shown()).toEqual([
      '2026-08-03 Standup',
      '2026-08-10 Standup',
      '2026-08-17 Standup (new)',
      '2026-08-24 Standup (new)',
      '2026-08-31 Standup (new)'
    ])
  })

  it('takes the deleted and changed dates after the split along', () => {
    const id = weekly('FREQ=WEEKLY;COUNT=8', '2026-08-24T09:00:00.000Z')
    repo.deleteRecurringScope({ masterEventId: id, originalStartUtc: '2026-08-31T09:00:00.000Z', scope: 'this' })
    repo.updateRecurringScope({
      masterEventId: id,
      originalStartUtc: '2026-09-07T09:00:00.000Z',
      scope: 'this',
      updateInput: { title: 'Moved', dtStartUtc: '2026-09-08T14:00:00.000Z', dtEndUtc: '2026-09-08T14:30:00.000Z' }
    })

    splitAt(id, '2026-08-17T09:00:00.000Z')

    expect(shown()).toEqual([
      '2026-08-03 Standup',
      '2026-08-10 Standup',
      '2026-08-17 Standup (new)',
      '2026-09-08 Moved',
      '2026-09-14 Standup (new)',
      '2026-09-21 Standup (new)'
    ])
    // They belong to the new series now, and still have to reach the provider as part of it.
    const tail = repo.queryEventsByRange([cal], '2026-09-14T00:00:00.000Z', '2026-09-14T23:59:59.999Z')[0]
    const carried = repo.getEventById(tail.eventId)!
    expect(carried.event.exdate).toBe('2026-08-24T09:00:00.000Z')
    expect(carried.exceptions.map((ex) => [ex.originalStartUtc, ex.isCancelled])).toEqual([
      ['2026-08-31T09:00:00.000Z', true],
      ['2026-09-07T09:00:00.000Z', false]
    ])
    expect(repo.getEventById(id)!.exceptions).toEqual([])
    expect(repo.getEventById(id)!.event.exdate).toBeUndefined()
  })

  it('gives the rest the rule the editor chose for it', () => {
    // An occurrence opens with no rule typed; picking one sends it whole.
    splitAt(weekly('FREQ=WEEKLY;COUNT=10'), '2026-08-17T09:00:00.000Z', { rrule: 'FREQ=WEEKLY;COUNT=2' })
    expect(shown().filter((d) => d.endsWith('(new)'))).toEqual(['2026-08-17 Standup (new)', '2026-08-24 Standup (new)'])
  })

  it('makes the rest one event when the editor chose "Does not repeat"', () => {
    splitAt(weekly('FREQ=WEEKLY;COUNT=10'), '2026-08-17T09:00:00.000Z', { rrule: '' })
    expect(shown().filter((d) => d.endsWith('(new)'))).toEqual(['2026-08-17 Standup (new)'])
  })
})
