import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createSqliteDriver, type ISqliteDatabase } from '../src/main/db/sqlite-driver'
import { runMigrations, seedDefaultData, initDatabase, closeDatabase } from '../src/main/db/database'
import { CalendarsRepo } from '../src/main/db/repos/calendars-repo'
import { EventsRepo } from '../src/main/db/repos/events-repo'

describe('Recurring Scope Operations (this / future / all)', () => {
  let db: ISqliteDatabase
  let calendarsRepo: CalendarsRepo
  let eventsRepo: EventsRepo
  let testCalId: string

  beforeEach(() => {
    db = createSqliteDriver(':memory:')
    runMigrations(db)
    seedDefaultData(db)
    calendarsRepo = new CalendarsRepo(db)
    eventsRepo = new EventsRepo(db)

    const cal = calendarsRepo.createCalendar({ name: 'Work', color: '#8b5cf6' })
    testCalId = cal.id
  })

  it('should create an occurrence exception when updating scope "this"', () => {
    const master = eventsRepo.createEvent({
      calendarId: testCalId,
      title: 'Weekly Standup',
      dtStartUtc: '2026-08-03T09:00:00.000Z',
      dtEndUtc: '2026-08-03T09:30:00.000Z',
      rrule: 'FREQ=WEEKLY;BYDAY=MO'
    })

    const success = eventsRepo.updateRecurringScope({
      masterEventId: master.id,
      originalStartUtc: '2026-08-10T09:00:00.000Z',
      scope: 'this',
      updateInput: {
        title: 'Special Guest Standup',
        dtStartUtc: '2026-08-10T10:00:00.000Z',
        dtEndUtc: '2026-08-10T10:30:00.000Z'
      }
    })

    expect(success).toBe(true)

    // Verify exception exists in DB
    const exceptions = eventsRepo.getExceptionsForEvent(master.id)
    expect(exceptions).toHaveLength(1)
    expect(exceptions[0].title).toBe('Special Guest Standup')
    expect(exceptions[0].originalStartUtc).toBe('2026-08-10T09:00:00.000Z')
    expect(exceptions[0].isCancelled).toBe(false)
  })

  it('stores a removed repeat rule as no rule, so the event is a one-off everywhere', () => {
    const master = eventsRepo.createEvent({
      calendarId: testCalId,
      title: 'Weekly Standup',
      dtStartUtc: '2026-08-03T09:00:00.000Z',
      dtEndUtc: '2026-08-03T09:30:00.000Z',
      rrule: 'FREQ=WEEKLY;BYDAY=MO'
    })

    // What the editor sends for "Does not repeat".
    const updated = eventsRepo.updateEvent(master.id, { rrule: '' })

    expect(updated.rrule).toBeUndefined()
    // NULL, not '': the range query and the sync engines tell a series by `rrule IS NOT NULL`.
    expect(db.prepare('SELECT rrule FROM events WHERE id = ?').get<{ rrule: string | null }>(master.id)?.rrule).toBeNull()
    const august = eventsRepo.queryEventsByRange([testCalId], '2026-08-01T00:00:00.000Z', '2026-08-31T23:59:59.999Z')
    expect(august.map((o) => [o.startUtc, o.isRecurring])).toEqual([['2026-08-03T09:00:00.000Z', false]])
  })

  it('should mark an occurrence cancelled when deleting scope "this"', () => {
    const master = eventsRepo.createEvent({
      calendarId: testCalId,
      title: 'Daily Sync',
      dtStartUtc: '2026-08-01T08:00:00.000Z',
      dtEndUtc: '2026-08-01T08:30:00.000Z',
      rrule: 'FREQ=DAILY'
    })

    const success = eventsRepo.deleteRecurringScope({
      masterEventId: master.id,
      originalStartUtc: '2026-08-05T08:00:00.000Z',
      scope: 'this'
    })

    expect(success).toBe(true)

    const exceptions = eventsRepo.getExceptionsForEvent(master.id)
    expect(exceptions).toHaveLength(1)
    expect(exceptions[0].isCancelled).toBe(true)
    expect(exceptions[0].originalStartUtc).toBe('2026-08-05T08:00:00.000Z')
  })

  it('should split recurring series when updating scope "future"', () => {
    const master = eventsRepo.createEvent({
      calendarId: testCalId,
      title: 'Biweekly Planning',
      dtStartUtc: '2026-08-03T14:00:00.000Z',
      dtEndUtc: '2026-08-03T15:00:00.000Z',
      rrule: 'FREQ=WEEKLY;INTERVAL=2'
    })

    const success = eventsRepo.updateRecurringScope({
      masterEventId: master.id,
      originalStartUtc: '2026-08-17T14:00:00.000Z',
      scope: 'future',
      updateInput: {
        title: 'Biweekly Planning (New Time)',
        dtStartUtc: '2026-08-17T16:00:00.000Z',
        dtEndUtc: '2026-08-17T17:00:00.000Z'
      }
    })

    expect(success).toBe(true)

    // Master event RRULE should now be capped with UNTIL
    const updatedMaster = eventsRepo.getEventById(master.id)
    expect(updatedMaster?.event.rrule).toContain('UNTIL=')

    // Query range across August should find both series
    const occurrences = eventsRepo.queryEventsByRange(
      [testCalId],
      '2026-08-01T00:00:00.000Z',
      '2026-08-31T23:59:59.999Z'
    )

    const titles = occurrences.map((o) => o.title)
    expect(titles).toContain('Biweekly Planning')
    expect(titles).toContain('Biweekly Planning (New Time)')
  })
})

describe('moving an event between calendars', () => {
  let db: ISqliteDatabase
  let repo: EventsRepo
  let calA: string
  let calB: string

  beforeEach(() => {
    db = initDatabase(':memory:')
    repo = new EventsRepo(db)
    const cals = new CalendarsRepo(db)
    calA = cals.createCalendar({ name: 'Work', color: '#111111' }).id
    calB = cals.createCalendar({ name: 'Personal', color: '#222222' }).id
  })

  afterEach(() => {
    closeDatabase()
  })

  function makeEvent(calendarId: string) {
    return repo.createEvent({
      calendarId,
      title: 'Filed in the wrong place',
      dtStartUtc: '2026-09-20T09:00:00.000Z',
      dtEndUtc: '2026-09-20T10:00:00.000Z'
    })
  }

  it('actually moves the event, which updateEvent used to ignore entirely', () => {
    // UpdateEventInput had no calendarId and the UPDATE never touched the
    // column, so the editor reported "changes saved" and nothing moved.
    const evt = makeEvent(calA)

    const updated = repo.updateEvent(evt.id, { calendarId: calB })

    expect(updated.calendarId).toBe(calB)
  })

  it('leaves the calendar alone when the update does not mention one', () => {
    const evt = makeEvent(calA)
    const updated = repo.updateEvent(evt.id, { title: 'Renamed only' })
    expect(updated.calendarId).toBe(calA)
  })

  it('refuses to move into a read-only calendar', () => {
    const evt = makeEvent(calA)
    db.prepare('UPDATE calendars SET is_read_only = 1 WHERE id = ?').run(calB)

    expect(() => repo.updateEvent(evt.id, { calendarId: calB })).toThrow(/read-only/i)
    expect(repo.getEventById(evt.id)!.event.calendarId).toBe(calA)
  })

  const movedFrom = (id: string) =>
    db
      .prepare('SELECT moved_from_calendar_id m FROM events WHERE id = ?')
      .get<{ m: string | null }>(id)!.m

  it('remembers the origin for an event the provider already has', () => {
    const evt = makeEvent(calA)
    db.prepare("UPDATE events SET etag = 'e1' WHERE id = ?").run(evt.id)

    repo.updateEvent(evt.id, { calendarId: calB })

    expect(movedFrom(evt.id)).toBe(calA)
  })

  it('records nothing for an event the provider has never seen', () => {
    // Nothing to move - it will simply be created in the right calendar.
    const evt = makeEvent(calA)
    repo.updateEvent(evt.id, { calendarId: calB })
    expect(movedFrom(evt.id)).toBeNull()
  })

  it('keeps naming the calendar the provider actually holds it in', () => {
    // A -> B -> C before the next poll. The move endpoint needs A, not B.
    const evt = makeEvent(calA)
    db.prepare("UPDATE events SET etag = 'e1' WHERE id = ?").run(evt.id)
    const calC = new CalendarsRepo(db).createCalendar({ name: 'Third', color: '#333333' }).id

    repo.updateEvent(evt.id, { calendarId: calB })
    repo.updateEvent(evt.id, { calendarId: calC })

    expect(movedFrom(evt.id)).toBe(calA)
  })

  it('forgets the move when the event comes back where it started', () => {
    const evt = makeEvent(calA)
    db.prepare("UPDATE events SET etag = 'e1' WHERE id = ?").run(evt.id)

    repo.updateEvent(evt.id, { calendarId: calB })
    repo.updateEvent(evt.id, { calendarId: calA })

    expect(movedFrom(evt.id)).toBeNull()
  })

  it('moves the whole series when the scope is all', () => {
    const master = repo.createEvent({
      calendarId: calA,
      title: 'Weekly',
      dtStartUtc: '2026-09-07T09:00:00.000Z',
      dtEndUtc: '2026-09-07T09:30:00.000Z',
      rrule: 'FREQ=WEEKLY;BYDAY=MO'
    })

    repo.updateRecurringScope({
      masterEventId: master.id,
      originalStartUtc: '2026-09-14T09:00:00.000Z',
      scope: 'all',
      updateInput: { calendarId: calB }
    })

    expect(repo.getEventById(master.id)!.event.calendarId).toBe(calB)
  })

  it('takes one occurrence out of the series and into the other calendar, as an event of its own', () => {
    const master = repo.createEvent({
      calendarId: calA,
      title: 'Weekly',
      notes: 'Bring the notes',
      dtStartUtc: '2026-09-07T09:00:00.000Z',
      dtEndUtc: '2026-09-07T09:30:00.000Z',
      rrule: 'FREQ=WEEKLY;BYDAY=MO',
      reminders: [{ minutesBefore: 10 }]
    })

    // The editor, opened on the 14th: another calendar, an hour later, renamed.
    repo.updateRecurringScope({
      masterEventId: master.id,
      originalStartUtc: '2026-09-14T09:00:00.000Z',
      scope: 'this',
      updateInput: {
        calendarId: calB,
        title: 'Weekly (with the client)',
        dtStartUtc: '2026-09-14T10:00:00.000Z',
        dtEndUtc: '2026-09-14T10:30:00.000Z'
      }
    })

    // The series stays where it was, without that date.
    const series = repo.getEventById(master.id)!
    expect(series.event.calendarId).toBe(calA)
    expect(series.exceptions.map((ex) => [ex.originalStartUtc, ex.isCancelled])).toEqual([['2026-09-14T09:00:00.000Z', true]])

    const drawn = repo.queryEventsByRange([calA, calB], '2026-09-07T00:00:00.000Z', '2026-09-22T00:00:00.000Z')
    expect(drawn.map((o) => [o.calendarId === calB ? 'B' : 'A', o.startUtc, o.title, o.isRecurring])).toEqual([
      ['A', '2026-09-07T09:00:00.000Z', 'Weekly', true],
      ['B', '2026-09-14T10:00:00.000Z', 'Weekly (with the client)', false],
      ['A', '2026-09-21T09:00:00.000Z', 'Weekly', true]
    ])
    // What the series had and the editor left alone goes with it.
    const moved = repo.getEventById(drawn[1].eventId)!.event
    expect(moved).toMatchObject({ notes: 'Bring the notes', reminders: [{ minutesBefore: 10 }], dirty: true })
    expect(moved.rrule).toBeUndefined()
  })

  it('takes an occurrence already changed on its own, with its changes, when only the calendar is new', () => {
    const master = repo.createEvent({
      calendarId: calA,
      title: 'Weekly',
      dtStartUtc: '2026-09-07T09:00:00.000Z',
      dtEndUtc: '2026-09-07T09:30:00.000Z',
      rrule: 'FREQ=WEEKLY;BYDAY=MO'
    })
    repo.updateRecurringScope({
      masterEventId: master.id,
      originalStartUtc: '2026-09-14T09:00:00.000Z',
      scope: 'this',
      updateInput: { title: 'Weekly (late)', dtStartUtc: '2026-09-14T11:00:00.000Z', dtEndUtc: '2026-09-14T11:45:00.000Z' }
    })

    repo.updateRecurringScope({
      masterEventId: master.id,
      originalStartUtc: '2026-09-14T09:00:00.000Z',
      scope: 'this',
      updateInput: { calendarId: calB }
    })

    const drawn = repo.queryEventsByRange([calA, calB], '2026-09-14T00:00:00.000Z', '2026-09-15T00:00:00.000Z')
    expect(drawn.map((o) => [o.calendarId === calB ? 'B' : 'A', o.startUtc, o.endUtc, o.title])).toEqual([
      ['B', '2026-09-14T11:00:00.000Z', '2026-09-14T11:45:00.000Z', 'Weekly (late)']
    ])
  })

  it('starts the rest of the series in the other calendar for "this and following"', () => {
    const master = repo.createEvent({
      calendarId: calA,
      title: 'Weekly',
      dtStartUtc: '2026-09-07T09:00:00.000Z',
      dtEndUtc: '2026-09-07T09:30:00.000Z',
      rrule: 'FREQ=WEEKLY;BYDAY=MO;COUNT=4'
    })

    repo.updateRecurringScope({
      masterEventId: master.id,
      originalStartUtc: '2026-09-21T09:00:00.000Z',
      scope: 'future',
      updateInput: { calendarId: calB }
    })

    const drawn = repo.queryEventsByRange([calA, calB], '2026-09-01T00:00:00.000Z', '2026-10-31T00:00:00.000Z')
    expect(drawn.map((o) => [o.calendarId === calB ? 'B' : 'A', o.startUtc])).toEqual([
      ['A', '2026-09-07T09:00:00.000Z'],
      ['A', '2026-09-14T09:00:00.000Z'],
      ['B', '2026-09-21T09:00:00.000Z'],
      ['B', '2026-09-28T09:00:00.000Z']
    ])
    expect(repo.getEventById(master.id)!.event.calendarId).toBe(calA)
  })

  it('leaves the dates of someone else’s meeting in the calendar it was sent to', () => {
    const master = repo.createEvent({
      calendarId: calA,
      title: 'Their weekly',
      dtStartUtc: '2026-09-07T09:00:00.000Z',
      dtEndUtc: '2026-09-07T09:30:00.000Z',
      rrule: 'FREQ=WEEKLY;BYDAY=MO',
      attendees: [
        { email: 'boss@example.com', isOrganizer: true },
        { email: 'me@example.com', isSelf: true }
      ]
    })

    for (const scope of ['this', 'future'] as const) {
      expect(() =>
        repo.updateRecurringScope({
          masterEventId: master.id,
          originalStartUtc: '2026-09-14T09:00:00.000Z',
          scope,
          updateInput: { calendarId: calB }
        })
      ).toThrow(/invitation stays/)
    }
    expect(repo.queryEventsByRange([calB], '2026-09-01T00:00:00.000Z', '2026-10-31T00:00:00.000Z')).toEqual([])
    expect(repo.getEventById(master.id)!.exceptions).toEqual([])
  })

  it('does not write to a read-only calendar that way either', () => {
    const master = repo.createEvent({
      calendarId: calA,
      title: 'Weekly',
      dtStartUtc: '2026-09-07T09:00:00.000Z',
      dtEndUtc: '2026-09-07T09:30:00.000Z',
      rrule: 'FREQ=WEEKLY;BYDAY=MO'
    })
    db.prepare('UPDATE calendars SET is_read_only = 1 WHERE id = ?').run(calB)

    expect(() =>
      repo.updateRecurringScope({
        masterEventId: master.id,
        originalStartUtc: '2026-09-14T09:00:00.000Z',
        scope: 'this',
        updateInput: { calendarId: calB }
      })
    ).toThrow(/read-only/)
    expect(repo.getEventById(master.id)!.exceptions).toEqual([])
  })
})
