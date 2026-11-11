import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createSqliteDriver, type ISqliteDatabase } from '../src/main/db/sqlite-driver'
import { runMigrations, seedDefaultData } from '../src/main/db/database'
import { CalendarsRepo } from '../src/main/db/repos/calendars-repo'
import { EventsRepo } from '../src/main/db/repos/events-repo'
import { CalDavSyncEngine } from '../src/main/sync/caldav-sync-engine'
import type { CalDavCredentials } from '../src/main/sync/caldav-adapter'
import { generateIcs } from '../src/main/ics/write-ics'
import type { Calendar, CalendarEvent, EventException } from '../src/shared/event-model'

/**
 * An occurrence's notes or place removed on that occurrence alone. The
 * override stored the emptied field as NULL, which is what "as the series has
 * it" is stored as, so the series' notes came straight back - here, in what
 * was written to the server, and from the server on the next pull.
 */
describe('a field removed from one occurrence stays removed', () => {
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

  const standup = (): string =>
    repo.createEvent({
      calendarId: cal,
      title: 'Standup',
      notes: 'Agenda',
      location: 'Room 1',
      dtStartUtc: '2026-10-05T09:00:00.000Z',
      dtEndUtc: '2026-10-05T09:30:00.000Z',
      rrule: 'FREQ=WEEKLY'
    }).id

  /** What the editor sends for one occurrence: its times, and a text field only when it has one or was just emptied. */
  const editTwelfth = (id: string, fields: { title: string; notes?: string; location?: string }): void => {
    repo.updateRecurringScope({
      masterEventId: id,
      originalStartUtc: '2026-10-12T09:00:00.000Z',
      scope: 'this',
      updateInput: { ...fields, dtStartUtc: '2026-10-12T09:00:00.000Z', dtEndUtc: '2026-10-12T09:30:00.000Z' }
    })
  }

  const october = (): string[] =>
    repo
      .queryEventsByRange([cal], '2026-10-01T00:00:00.000Z', '2026-10-20T00:00:00.000Z')
      .map((o) => `${o.startUtc.slice(8, 10)} ${o.title} [${o.notes ?? ''}|${o.location ?? ''}]`)

  it('here, and through a later edit of the same occurrence', () => {
    const id = standup()

    editTwelfth(id, { title: 'Standup', notes: '', location: '' })
    expect(october()).toEqual(['05 Standup [Agenda|Room 1]', '12 Standup [|]', '19 Standup [Agenda|Room 1]'])

    // Renamed later: both fields are empty in the editor, so neither is sent.
    editTwelfth(id, { title: 'Short standup' })
    expect(october()).toEqual(['05 Standup [Agenda|Room 1]', '12 Short standup [|]', '19 Standup [Agenda|Room 1]'])
  })

  it('in what is written to a CalDAV server', () => {
    const id = standup()
    editTwelfth(id, { title: 'Standup', notes: '', location: '' })
    const { event, exceptions } = repo.getEventById(id)!
    // A renamed occurrence that inherits the series' text, for comparison.
    const inherits: EventException = { ...exceptions[0], id: 'x2', originalStartUtc: '2026-10-19T09:00:00.000Z', notes: undefined, location: undefined }

    const ics = generateIcs({ id: cal, name: 'Work' } as Calendar, [event as CalendarEvent], [...exceptions, inherits])
    const overrides = ics.split('BEGIN:VEVENT').slice(2)

    expect(overrides[0]).toContain('RECURRENCE-ID:20261012T090000Z')
    expect(overrides[0]).not.toContain('DESCRIPTION')
    expect(overrides[0]).not.toContain('LOCATION')
    expect(overrides[1]).toContain('DESCRIPTION:Agenda')
    expect(overrides[1]).toContain('LOCATION:Room 1')
  })
})

describe('an override pulled from a CalDAV server', () => {
  const CAL = 'https://dav.example/sonn/personal/'
  const CREDS: CalDavCredentials = { url: 'https://dav.example/sonn/', username: 'sonn', password: 'pw' }
  let db: ISqliteDatabase
  let repo: EventsRepo

  beforeEach(() => {
    db = createSqliteDriver(':memory:')
    runMigrations(db)
    seedDefaultData(db)
    const now = new Date().toISOString()
    db.prepare(
      `INSERT INTO calendars (id, account_id, name, color, is_visible, is_read_only, is_default, created_at, updated_at)
       VALUES (?, 'account-local-primary', 'Personal', '#000000', 1, 0, 0, ?, ?)`
    ).run(CAL, now, now)
    repo = new EventsRepo(db)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  /** A weekly series, with its 12 October moved to 10:00 by an override that has no DESCRIPTION or LOCATION. */
  function serve(seriesFields: string[]): void {
    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//test//EN',
      'BEGIN:VEVENT',
      'UID:uid-series',
      'DTSTAMP:20261001T000000Z',
      'DTSTART:20261005T090000Z',
      'DTEND:20261005T093000Z',
      'RRULE:FREQ=WEEKLY',
      'SUMMARY:Standup',
      ...seriesFields,
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:uid-series',
      'DTSTAMP:20261001T000000Z',
      'RECURRENCE-ID:20261012T090000Z',
      'DTSTART:20261012T100000Z',
      'DTEND:20261012T103000Z',
      'SUMMARY:Standup',
      'END:VEVENT',
      'END:VCALENDAR'
    ].join('\r\n')
    const xml = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    const answer = (status: number, body: string): Response =>
      ({
        ok: status < 300,
        status,
        url: '',
        text: async () => body,
        body: new Response(body).body,
        headers: { get: () => null }
      }) as unknown as Response
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        if (init.method === 'PROPFIND') {
          return answer(
            207,
            `<?xml version="1.0"?><D:multistatus xmlns:D="DAV:" xmlns:CS="http://calendarserver.org/ns/">` +
              `<D:response><D:href>/sonn/personal/</D:href><D:propstat><D:prop>` +
              `<D:resourcetype><D:collection/><C:calendar xmlns:C="urn:ietf:params:xml:ns:caldav"/></D:resourcetype>` +
              `<D:displayname>Personal</D:displayname><CS:getctag>c1</CS:getctag>` +
              `</D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response></D:multistatus>`
          )
        }
        if (init.method === 'REPORT') {
          return answer(
            207,
            `<?xml version="1.0"?><D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">` +
              `<D:response><D:href>/sonn/personal/series.ics</D:href><D:propstat><D:prop>` +
              `<D:getetag>"s1"</D:getetag><C:calendar-data>${xml(ics)}</C:calendar-data>` +
              `</D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response></D:multistatus>`
          )
        }
        return answer(204, '')
      })
    )
  }

  const twelfth = (): { notes?: string; location?: string } => {
    const [occ] = repo.queryEventsByRange([CAL], '2026-10-12T00:00:00.000Z', '2026-10-12T23:59:59.999Z')
    return { notes: occ.notes || undefined, location: occ.location || undefined }
  }

  it('has none of the series\' text it leaves out: an override is a whole event', async () => {
    serve(['DESCRIPTION:Agenda', 'LOCATION:Room 1'])
    await new CalDavSyncEngine(db).pullCalendarEvents(CAL, CREDS)
    expect(twelfth()).toEqual({ notes: undefined, location: undefined })
  })

  it('still takes up text the series gets later, when the series had none to leave out', async () => {
    serve([])
    await new CalDavSyncEngine(db).pullCalendarEvents(CAL, CREDS)
    const [series] = repo.queryEventsByCalendar(CAL)
    repo.updateEvent(series.id, { notes: 'Agenda' })
    expect(twelfth()).toEqual({ notes: 'Agenda', location: undefined })
  })
})
