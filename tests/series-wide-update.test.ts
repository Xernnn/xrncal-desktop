import { describe, it, expect, beforeEach } from 'vitest'
import { DateTime } from 'luxon'
import { createSqliteDriver, type ISqliteDatabase } from '../src/main/db/sqlite-driver'
import { runMigrations, seedDefaultData } from '../src/main/db/database'
import { CalendarsRepo } from '../src/main/db/repos/calendars-repo'
import { EventsRepo } from '../src/main/db/repos/events-repo'
import { seriesWideUpdate } from '../src/shared/series-update'
import type { UpdateEventInput } from '../src/shared/event-model'

/**
 * "All events" on a change made from one occurrence. The editor and a drop
 * send that occurrence's own date; the series must keep its first one.
 */
describe('a change to one occurrence applied to all events', () => {
  let db: ISqliteDatabase
  let repo: EventsRepo
  let calId: string

  beforeEach(() => {
    db = createSqliteDriver(':memory:')
    runMigrations(db)
    seedDefaultData(db)
    calId = new CalendarsRepo(db).createCalendar({ name: 'Work', color: '#8b5cf6' }).id
    repo = new EventsRepo(db)
  })

  /** What useEventCommands.confirmScope does for "all events". */
  const applyToAll = (masterId: string, originalStartUtc: string, input: UpdateEventInput): void => {
    repo.updateRecurringScope({
      masterEventId: masterId,
      originalStartUtc,
      scope: 'all',
      updateInput: seriesWideUpdate(input, originalStartUtc, repo.getEventById(masterId)!)
    })
  }

  const august = (): { startUtc: string; endUtc: string; title: string }[] =>
    repo
      .queryEventsByRange([calId], '2026-08-01T00:00:00.000Z', '2026-08-31T23:59:59.999Z')
      .map(({ startUtc, endUtc, title }) => ({ startUtc, endUtc, title }))

  it('renaming the third meeting keeps the two before it', () => {
    const master = repo.createEvent({
      calendarId: calId,
      title: 'Weekly Standup',
      dtStartUtc: '2026-08-03T09:00:00.000Z',
      dtEndUtc: '2026-08-03T09:30:00.000Z',
      rrule: 'FREQ=WEEKLY;BYDAY=MO'
    })

    // The editor, opened on 17 August: the title changed, the times as they were.
    applyToAll(master.id, '2026-08-17T09:00:00.000Z', {
      title: 'Renamed',
      dtStartUtc: '2026-08-17T09:00:00.000Z',
      dtEndUtc: '2026-08-17T09:30:00.000Z'
    })

    expect(august()).toEqual(
      ['03', '10', '17', '24', '31'].map((day) => ({
        startUtc: `2026-08-${day}T09:00:00.000Z`,
        endUtc: `2026-08-${day}T09:30:00.000Z`,
        title: 'Renamed'
      }))
    )
  })

  it('an hour later and twice as long, on every date from the first', () => {
    const master = repo.createEvent({
      calendarId: calId,
      title: 'Weekly Standup',
      dtStartUtc: '2026-08-03T09:00:00.000Z',
      dtEndUtc: '2026-08-03T09:30:00.000Z',
      rrule: 'FREQ=WEEKLY;BYDAY=MO'
    })

    // Dragged from 09:00 to 10:00 on 17 August and stretched to an hour.
    applyToAll(master.id, '2026-08-17T09:00:00.000Z', {
      dtStartUtc: '2026-08-17T10:00:00.000Z',
      dtEndUtc: '2026-08-17T11:00:00.000Z'
    })

    expect(august().map((o) => [o.startUtc, o.endUtc])).toEqual(
      ['03', '10', '17', '24', '31'].map((day) => [`2026-08-${day}T10:00:00.000Z`, `2026-08-${day}T11:00:00.000Z`])
    )
  })

  it('measures the move on the clock, so winter and summer both get the new time', () => {
    const zone = 'Europe/Berlin'
    const first = DateTime.fromISO('2026-07-06T09:00', { zone })
    const master = repo.createEvent({
      calendarId: calId,
      title: 'Standup',
      dtStartUtc: first.toUTC().toISO()!,
      dtEndUtc: first.plus({ minutes: 30 }).toUTC().toISO()!,
      tzid: zone,
      rrule: 'FREQ=WEEKLY;BYDAY=MO'
    })

    // A December occurrence (UTC+1; the series began at UTC+2) moved to 10:30.
    const original = DateTime.fromISO('2026-12-14T09:00', { zone })
    const moved = DateTime.fromISO('2026-12-14T10:30', { zone })
    applyToAll(master.id, original.toUTC().toISO()!, {
      tzid: zone,
      dtStartUtc: moved.toUTC().toISO()!,
      dtEndUtc: moved.plus({ minutes: 30 }).toUTC().toISO()!
    })

    const stored = repo.getEventById(master.id)!.event
    expect(DateTime.fromISO(stored.dtStartUtc, { zone: 'utc' }).setZone(zone).toFormat('yyyy-MM-dd HH:mm')).toBe(
      '2026-07-06 10:30'
    )
    const december = repo.queryEventsByRange([calId], '2026-12-14T00:00:00.000Z', '2026-12-14T23:59:59.999Z')
    expect(december.map((o) => o.startUtc)).toEqual([moved.toUTC().toISO()])
  })

  it('counts from where an occurrence already moved on its own was', () => {
    const master = repo.createEvent({
      calendarId: calId,
      title: 'Weekly Standup',
      dtStartUtc: '2026-08-03T09:00:00.000Z',
      dtEndUtc: '2026-08-03T09:30:00.000Z',
      rrule: 'FREQ=WEEKLY;BYDAY=MO'
    })
    repo.updateRecurringScope({
      masterEventId: master.id,
      originalStartUtc: '2026-08-17T09:00:00.000Z',
      scope: 'this',
      updateInput: { dtStartUtc: '2026-08-17T14:00:00.000Z', dtEndUtc: '2026-08-17T14:30:00.000Z' }
    })

    // Opened where it now is, 14:00, and only renamed.
    applyToAll(master.id, '2026-08-17T09:00:00.000Z', {
      title: 'Renamed',
      dtStartUtc: '2026-08-17T14:00:00.000Z',
      dtEndUtc: '2026-08-17T14:30:00.000Z'
    })

    const stored = repo.getEventById(master.id)!.event
    expect(stored.dtStartUtc).toBe('2026-08-03T09:00:00.000Z')
    expect(stored.dtEndUtc).toBe('2026-08-03T09:30:00.000Z')
  })

  it('keeps an all-day series on whole days', () => {
    const master = repo.createEvent({
      calendarId: calId,
      title: 'Rent',
      dtStartUtc: '2026-08-01T00:00:00.000Z',
      dtEndUtc: '2026-08-01T23:59:59.999Z',
      allDay: true,
      rrule: 'FREQ=MONTHLY'
    })

    applyToAll(master.id, '2026-10-01T00:00:00.000Z', {
      title: 'Rent and bills',
      allDay: true,
      dtStartUtc: '2026-10-01T00:00:00.000Z',
      dtEndUtc: '2026-10-01T23:59:59.999Z'
    })

    const stored = repo.getEventById(master.id)!.event
    expect([stored.title, stored.dtStartUtc, stored.dtEndUtc]).toEqual([
      'Rent and bills',
      '2026-08-01T00:00:00.000Z',
      '2026-08-01T23:59:59.999Z'
    ])
  })
})
