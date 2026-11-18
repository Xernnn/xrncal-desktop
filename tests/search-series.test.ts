import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { initDatabase, closeDatabase } from '../src/main/db/database'
import type { ISqliteDatabase } from '../src/main/db/sqlite-driver'
import { EventsRepo } from '../src/main/db/repos/events-repo'
import { nearestOccurrence } from '../src/shared/nearest-occurrence'
import type { CalendarEvent } from '../src/shared/event-model'

/**
 * Search opened a recurring series at its first-ever date: "standup" for a
 * weekly meeting begun in 2023 jumped the calendar to 2023 and opened the
 * series there. Results were ordered by that first date too, so a
 * long-running series ranked below every newer one-off and fell off the end
 * of the list. A series now stands for its date nearest to now, in the list,
 * in the order and when opened.
 */

const NOW = Date.parse('2026-11-18T03:00:00.000Z') // a Wednesday
const CAL = 'calendar-local-default'

const weekly = (extra: Partial<CalendarEvent> = {}): CalendarEvent =>
  ({
    id: 'evt_standup',
    calendarId: CAL,
    uid: 'standup@example.com',
    title: 'Standup',
    dtStartUtc: '2023-01-02T09:00:00.000Z', // a Monday
    dtEndUtc: '2023-01-02T09:15:00.000Z',
    tzid: 'UTC',
    allDay: false,
    rrule: 'FREQ=WEEKLY;BYDAY=MO',
    createdAt: '2023-01-01T00:00:00.000Z',
    updatedAt: '2023-01-01T00:00:00.000Z',
    ...extra
  }) as CalendarEvent

describe('nearestOccurrence', () => {
  it('is the date of a running series nearest to now, either way', () => {
    // Monday the 16th is two days back, Monday the 23rd five days ahead.
    expect(nearestOccurrence(weekly(), [], NOW)?.startUtc).toBe('2026-11-16T09:00:00.000Z')
    expect(nearestOccurrence(weekly({ rrule: 'FREQ=WEEKLY;BYDAY=FR' }), [], NOW)?.startUtc).toBe(
      '2026-11-20T09:00:00.000Z'
    )
  })

  it('is the last date of a series that ended long ago', () => {
    const ended = weekly({ rrule: 'FREQ=WEEKLY;BYDAY=MO;UNTIL=20230227T235959Z' })
    expect(nearestOccurrence(ended, [], NOW)?.startUtc).toBe('2023-02-27T09:00:00.000Z')
  })

  it('is the first date of a series that starts years from now', () => {
    const later = weekly({ dtStartUtc: '2030-03-04T09:00:00.000Z', dtEndUtc: '2030-03-04T09:15:00.000Z' })
    expect(nearestOccurrence(later, [], NOW)?.startUtc).toBe('2030-03-04T09:00:00.000Z')
  })

  it('skips a deleted date', () => {
    const series = weekly({ exdate: '2026-11-16T09:00:00.000Z' })
    expect(nearestOccurrence(series, [], NOW)?.startUtc).toBe('2026-11-23T09:00:00.000Z')
  })
})

describe('searching for a recurring series', () => {
  let db: ISqliteDatabase
  let repo: EventsRepo

  beforeEach(() => {
    db = initDatabase(':memory:')
    repo = new EventsRepo(db)
  })

  afterEach(() => closeDatabase())

  it('keeps an old series in the list, dated and ranked by its nearest date', () => {
    const series = repo.createEvent({
      calendarId: CAL,
      title: 'Standup',
      dtStartUtc: '2023-01-02T09:00:00.000Z',
      dtEndUtc: '2023-01-02T09:15:00.000Z',
      tzid: 'UTC',
      rrule: 'FREQ=WEEKLY;BYDAY=MO'
    })
    // Newer one-offs that match too, more than the list holds.
    for (let day = 1; day <= 12; day++) {
      const date = `2025-03-${String(day).padStart(2, '0')}`
      repo.createEvent({
        calendarId: CAL,
        title: `Standup notes ${day}`,
        dtStartUtc: `${date}T10:00:00.000Z`,
        dtEndUtc: `${date}T10:30:00.000Z`,
        tzid: 'UTC'
      })
    }

    const results = repo.searchEvents('standup', 10, new Date(NOW))

    expect(results).toHaveLength(10)
    expect(results[0].id).toBe(series.id)
    expect(results[0].occurrence).toMatchObject({
      eventId: series.id,
      startUtc: '2026-11-16T09:00:00.000Z',
      originalStartUtc: '2026-11-16T09:00:00.000Z',
      isRecurring: true
    })
    // A one-off is still itself.
    expect(results[1].occurrence).toBeUndefined()
  })
})

/**
 * `%` and `_` in a search went into LIKE as wildcards: "0%" matched every
 * title with a 0 anywhere in it, "Room 101" included.
 */
describe('search text with % and _', () => {
  let repo: EventsRepo

  beforeEach(() => {
    repo = new EventsRepo(initDatabase(':memory:'))
    for (const [title, day] of [['Room 101', 1], ['Discount 30%', 2], ['plan_b review', 3], ['planXb review', 4]] as const) {
      repo.createEvent({
        calendarId: CAL,
        title,
        dtStartUtc: `2026-06-0${day}T09:00:00.000Z`,
        dtEndUtc: `2026-06-0${day}T10:00:00.000Z`,
        tzid: 'UTC'
      })
    }
  })

  afterEach(() => closeDatabase())

  it('are the characters typed, not wildcards', () => {
    expect(repo.searchEvents('0%').map((r) => r.title)).toEqual(['Discount 30%'])
    expect(repo.searchEvents('n_b').map((r) => r.title)).toEqual(['plan_b review'])
  })

  it('still finds a match inside a word, with its guests', () => {
    expect(repo.searchEvents('oom 1').map((r) => r.title)).toEqual(['Room 101'])
    expect(repo.searchEvents('oom 1')[0].attendees).toEqual([])
  })
})
