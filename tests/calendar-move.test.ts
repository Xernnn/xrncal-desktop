import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createSqliteDriver, type ISqliteDatabase } from '../src/main/db/sqlite-driver'
import { runMigrations, seedDefaultData, MIGRATION_024_SQL } from '../src/main/db/database'
import { EventsRepo } from '../src/main/db/repos/events-repo'
import { GoogleSyncEngine } from '../src/main/sync/google-sync-engine'
import { MicrosoftSyncEngine } from '../src/main/sync/microsoft-sync-engine'
import { CalDavSyncEngine } from '../src/main/sync/caldav-sync-engine'
import type { Attendee } from '../src/shared/event-model'

/**
 * An event lives in a calendar on the provider, so moving it to another
 * calendar is not a field update. Only the Google push knew that: a CalDAV move
 * was PUT back to the old calendar's resource, the new calendar's pull then
 * deleted the row as unlisted and the old one's put it back; Outlook's PATCH
 * cannot change calendars at all, so the move was undone the same way. And the
 * editor offered every writable calendar, so an event could be "moved" to
 * another account or provider, whose push then addressed an id it had never
 * issued and failed on every sync.
 */

const G_A = 'a@group.calendar.google.com'
const G_B = 'b@group.calendar.google.com'
const G_OTHER = 'someone.else@gmail.com'
const DAV_A = 'https://dav.example/me/a/'
const DAV_B = 'https://dav.example/me/b/'
const MS_A = 'ms-cal-a'
const MS_B = 'ms-cal-b'
const CREDS = { url: 'https://dav.example/me/', username: 'me', password: 'pw' }
const ME = 'me@example.com'

interface Call {
  url: string
  method: string
  headers: Record<string, string>
  body?: string
}

function response(status: number, body: unknown = {}, headers: Record<string, string> = {}): Response {
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  return {
    ok: status >= 200 && status < 300,
    status,
    url: '',
    json: async () => body,
    text: async () => text,
    body: new Response(text).body,
    headers: new Headers(headers)
  } as unknown as Response
}

function serve(reply: (call: Call) => Response): Call[] {
  const calls: Call[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const call = {
        url,
        method: init?.method ?? 'GET',
        headers: (init?.headers ?? {}) as Record<string, string>,
        body: init?.body === undefined ? undefined : String(init.body)
      }
      calls.push(call)
      return reply(call)
    })
  )
  return calls
}

const ifMatchOf = (call: Call): string | undefined =>
  Object.entries(call.headers).find(([name]) => name.toLowerCase() === 'if-match')?.[1]

function ics(uid: string, title: string): string {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//test//EN',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    'DTSTAMP:20260101T000000Z',
    'DTSTART:20260401T090000Z',
    'DTEND:20260401T100000Z',
    `SUMMARY:${title}`,
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n')
}

const escapeXml = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

describe('moving an event to another calendar', () => {
  let db: ISqliteDatabase
  let repo: EventsRepo

  beforeEach(() => {
    db = createSqliteDriver(':memory:')
    runMigrations(db)
    seedDefaultData(db)
    repo = new EventsRepo(db)
    const now = new Date().toISOString()
    for (const [id, type] of [
      ['acc-g1', 'google'],
      ['acc-g2', 'google'],
      ['acc-dav', 'caldav'],
      ['acc-ms', 'graph']
    ]) {
      db.prepare(
        `INSERT INTO accounts (id, type, name, email, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)`
      ).run(id, type, id, ME, now, now)
    }
    for (const [id, account] of [
      [G_A, 'acc-g1'],
      [G_B, 'acc-g1'],
      [G_OTHER, 'acc-g2'],
      [DAV_A, 'acc-dav'],
      [DAV_B, 'acc-dav'],
      [MS_A, 'acc-ms'],
      [MS_B, 'acc-ms']
    ]) {
      db.prepare(
        `INSERT INTO calendars (id, account_id, name, color, is_visible, is_read_only, is_default, created_at, updated_at)
         VALUES (?, ?, ?, '#000', 1, 0, 0, ?, ?)`
      ).run(id, account, id, now, now)
    }
  })

  afterEach(() => vi.unstubAllGlobals())

  /** An event the provider has, clean. `etag: null` is a server that named it but sent none. */
  function synced(
    calendarId: string,
    provider: { id: string; etag?: string | null },
    attendees?: Attendee[],
    rrule?: string
  ): string {
    const id = repo.createEvent({
      calendarId,
      uid: 'uid-1',
      title: 'Planning',
      dtStartUtc: '2026-04-01T09:00:00.000Z',
      dtEndUtc: '2026-04-01T10:00:00.000Z',
      attendees,
      rrule
    }).id
    db.prepare(
      'UPDATE events SET provider_event_id = ?, etag = ?, dirty = 0, attendees_synced = 1 WHERE id = ?'
    ).run(provider.id, provider.etag === undefined ? 'e1' : provider.etag, id)
    return id
  }

  const row = (id: string) =>
    db
      .prepare('SELECT calendar_id, provider_event_id, etag, moved_from_calendar_id, dirty FROM events WHERE id = ?')
      .get<{
        calendar_id: string
        provider_event_id: string | null
        etag: string | null
        moved_from_calendar_id: string | null
        dirty: number
      }>(id)

  const countIn = (calendarId: string): number =>
    db.prepare('SELECT COUNT(*) AS n FROM events WHERE calendar_id = ?').get<{ n: number }>(calendarId)!.n

  describe('which calendars it may go to', () => {
    it('only those of its own account, once the provider has it', () => {
      const id = synced(G_A, { id: 'g1' })
      expect(() => repo.updateEvent(id, { calendarId: G_OTHER })).toThrow(/same account/)
      expect(() => repo.updateEvent(id, { calendarId: DAV_A })).toThrow(/same account/)
      expect(() => repo.updateEvent(id, { calendarId: 'calendar-local-default' })).toThrow(/same account/)
      expect(() =>
        repo.moveEvent({
          eventId: id,
          dtStartUtc: '2026-04-01T09:00:00.000Z',
          dtEndUtc: '2026-04-01T10:00:00.000Z',
          targetCalendarId: G_OTHER
        })
      ).toThrow(/same account/)
      expect(row(id)!.calendar_id).toBe(G_A)

      repo.updateEvent(id, { calendarId: G_B })
      expect(row(id)).toMatchObject({ calendar_id: G_B, moved_from_calendar_id: G_A })
    })

    it('any, before it has reached a provider', () => {
      const draft = repo.createEvent({
        calendarId: G_A,
        title: 'Draft',
        dtStartUtc: '2026-04-01T09:00:00.000Z',
        dtEndUtc: '2026-04-01T10:00:00.000Z'
      })
      repo.updateEvent(draft.id, { calendarId: DAV_A })
      expect(row(draft.id)).toMatchObject({ calendar_id: DAV_A, moved_from_calendar_id: null })
    })

    it('none, for an invitation from someone else', () => {
      const id = synced(G_A, { id: 'g1' }, [
        { email: 'boss@example.com', isOrganizer: true },
        { email: ME, isSelf: true }
      ])
      expect(() => repo.updateEvent(id, { calendarId: G_B })).toThrow(/invitation stays/)
    })

    it('for a meeting with guests, only on Google', () => {
      const guests: Attendee[] = [{ email: ME, isOrganizer: true, isSelf: true }, { email: 'guest@example.com' }]
      const google = synced(G_A, { id: 'g1' }, guests)
      repo.updateEvent(google, { calendarId: G_B })

      const dav = synced(DAV_A, { id: `${DAV_A}x.ics` }, guests)
      expect(() => repo.updateEvent(dav, { calendarId: DAV_B })).toThrow(/meeting with guests/)
      const outlook = synced(MS_A, { id: 'm9' }, guests)
      expect(() => repo.updateEvent(outlook, { calendarId: MS_B })).toThrow(/meeting with guests/)
    })

    it('remembers where the server keeps an event it gave no etag for', () => {
      const id = synced(DAV_A, { id: `${DAV_A}x.ics`, etag: null })
      repo.updateEvent(id, { calendarId: DAV_B })
      expect(row(id)!.moved_from_calendar_id).toBe(DAV_A)
    })
  })

  describe('between CalDAV calendars', () => {
    const oldHref = `${DAV_A}x.ics`
    const newHref = `${DAV_B}uid-1.ics`

    it('is PUT into the new calendar, then deleted from the old', async () => {
      const id = synced(DAV_A, { id: oldHref, etag: '"e1"' })
      repo.updateEvent(id, { calendarId: DAV_B })
      const calls = serve((call) => (call.method === 'PUT' ? response(201, '', { etag: '"n1"' }) : response(204, '')))

      await new CalDavSyncEngine(db).pushDirtyEvents(DAV_B, CREDS)

      expect(calls.map((c) => [c.method, c.url])).toEqual([
        ['PUT', newHref],
        ['DELETE', oldHref]
      ])
      // A new resource there: nothing to check it against.
      expect(ifMatchOf(calls[0])).toBeUndefined()
      expect(row(id)).toMatchObject({
        calendar_id: DAV_B,
        provider_event_id: newHref,
        etag: '"n1"',
        moved_from_calendar_id: null,
        dirty: 0
      })
    })

    it('tries again, to the same address, while the old copy cannot be deleted', async () => {
      const id = synced(DAV_A, { id: oldHref, etag: '"e1"' })
      repo.updateEvent(id, { calendarId: DAV_B })
      let deleteStatus = 500
      const calls = serve((call) =>
        call.method === 'PUT' ? response(201, '', { etag: '"n1"' }) : response(deleteStatus, '')
      )

      const first = await new CalDavSyncEngine(db).pushDirtyEvents(DAV_B, CREDS)
      expect(first.errorCount).toBe(1)
      expect(row(id)).toMatchObject({ provider_event_id: oldHref, moved_from_calendar_id: DAV_A, dirty: 1 })

      deleteStatus = 204
      calls.length = 0
      await new CalDavSyncEngine(db).pushDirtyEvents(DAV_B, CREDS)
      expect(calls.map((c) => [c.method, c.url])).toEqual([
        ['PUT', newHref],
        ['DELETE', oldHref]
      ])
      expect(row(id)).toMatchObject({ provider_event_id: newHref, moved_from_calendar_id: null, dirty: 0 })
    })

    it('is not put back in the old calendar by a pull of it meanwhile', async () => {
      const id = synced(DAV_A, { id: oldHref, etag: '"e1"' })
      repo.updateEvent(id, { calendarId: DAV_B })
      // Changed there since, so the pull downloads it.
      const listing =
        '<?xml version="1.0"?><D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">' +
        `<D:response><D:href>/me/a/x.ics</D:href><D:propstat><D:prop><D:getetag>"e2"</D:getetag>` +
        `<C:calendar-data>${escapeXml(ics('uid-1', 'Planning (edited there)'))}</C:calendar-data>` +
        '</D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response></D:multistatus>'
      serve(() => response(207, listing))

      await new CalDavSyncEngine(db).pullCalendarEvents(DAV_A, CREDS)

      expect(countIn(DAV_A)).toBe(0)
      expect(row(id)).toMatchObject({ calendar_id: DAV_B, moved_from_calendar_id: DAV_A, dirty: 1 })
    })
  })

  describe('between Outlook calendars', () => {
    it('deletes the old copy, then creates the event in the new calendar', async () => {
      const id = synced(MS_A, { id: 'm1', etag: 'W/"1"' }, undefined, 'FREQ=WEEKLY')
      const moved = repo.upsertException({
        masterEventId: id,
        originalStartUtc: '2026-04-08T09:00:00.000Z',
        isCancelled: false,
        title: 'Planning (later)'
      })
      db.prepare("UPDATE event_exceptions SET dirty = 0, provider_instance_id = 'm1-inst' WHERE id = ?").run(moved.id)
      repo.updateEvent(id, { calendarId: MS_B })
      const calls = serve((call) => {
        if (call.method === 'DELETE') return response(204, '')
        if (call.method === 'POST') return response(201, { id: 'm2', '@odata.etag': 'W/"2"', attendees: [] })
        return response(200, { value: [] })
      })

      await new MicrosoftSyncEngine(db).pushDirtyEvents(MS_B, 'token', ME)

      expect(calls.slice(0, 2).map((c) => [c.method, c.url.replace(/^.*\/v1\.0/, '')])).toEqual([
        ['DELETE', '/me/events/m1'],
        ['POST', `/me/calendars/${MS_B}/events`]
      ])
      expect(ifMatchOf(calls[0])).toBe('W/"1"')
      expect(row(id)).toMatchObject({ calendar_id: MS_B, provider_event_id: 'm2', etag: 'W/"2"', moved_from_calendar_id: null, dirty: 0 })
      // The occurrence the old series had goes onto the new one.
      expect(repo.listDirtyExceptions(MS_B).map((p) => [p.exception.title, p.providerInstanceId])).toEqual([
        ['Planning (later)', null]
      ])
    })

    it('stops at a conflict if the old copy changed, and "keep theirs" leaves it where Outlook has it', async () => {
      const id = synced(MS_A, { id: 'm1', etag: 'W/"1"' })
      repo.updateEvent(id, { calendarId: MS_B })
      const calls = serve(() => response(412, { error: 'changed' }))

      await new MicrosoftSyncEngine(db).pushDirtyEvents(MS_B, 'token', ME)
      expect(calls.map((c) => c.method)).toEqual(['DELETE'])
      expect(repo.listConflicts().map((c) => c.eventId)).toEqual([id])

      repo.resolveConflict(id, 'keepTheirs')
      expect(row(id)).toMatchObject({ calendar_id: MS_A, moved_from_calendar_id: null, dirty: 0 })
    })

    it('is not put back in the old calendar by a pull of it meanwhile', async () => {
      const id = synced(MS_A, { id: 'm1', etag: 'W/"1"' })
      repo.updateEvent(id, { calendarId: MS_B })
      serve(() =>
        response(200, {
          value: [
            {
              id: 'm1',
              subject: 'Planning (edited there)',
              start: { dateTime: '2026-04-01T09:00:00.0000000', timeZone: 'UTC' },
              end: { dateTime: '2026-04-01T10:00:00.0000000', timeZone: 'UTC' },
              '@odata.etag': 'W/"5"'
            }
          ]
        })
      )

      await new MicrosoftSyncEngine(db).pullCalendarEvents(MS_A, 'token', ME)

      expect(countIn(MS_A)).toBe(0)
      expect(row(id)).toMatchObject({ calendar_id: MS_B, moved_from_calendar_id: MS_A, dirty: 1 })
    })
  })

  describe('between Google calendars', () => {
    it('sends the edit after the move with the etag the move answered with', async () => {
      const id = synced(G_A, { id: 'g1', etag: 'e1' })
      repo.updateEvent(id, { calendarId: G_B, title: 'Planning (moved)' })
      const calls = serve((call) =>
        call.url.includes('/move') ? response(200, { id: 'g1', etag: 'e-moved' }) : response(200, { id: 'g1', etag: 'e3' })
      )

      await new GoogleSyncEngine(db).pushDirtyEvents(G_B, 'token')

      expect(calls.map((c) => c.method)).toEqual(['POST', 'PATCH'])
      expect(ifMatchOf(calls[1])).toBe('e-moved')
      expect(row(id)).toMatchObject({ calendar_id: G_B, etag: 'e3', moved_from_calendar_id: null, dirty: 0 })
    })

    it('deletes a moved event from the calendar Google still has it in', async () => {
      const id = synced(G_A, { id: 'g1', etag: 'e1' })
      repo.updateEvent(id, { calendarId: G_B })
      repo.deleteEvent(id)
      const calls = serve(() => response(204, ''))

      await new GoogleSyncEngine(db).pushDirtyEvents(G_B, 'token')

      expect(calls.map((c) => [c.method, decodeURIComponent(c.url.replace(/^.*\/calendars\//, ''))])).toEqual([
        ['DELETE', `${G_A}/events/g1`]
      ])
      expect(row(id)).toBeUndefined()
    })
  })

  describe('a move across accounts made before they were refused (migration 024)', () => {
    it('becomes a new event in the calendar it was moved to; one within an account is left alone', () => {
      const across = synced(G_A, { id: `${DAV_A}x.ics`, etag: '"dav"' })
      db.prepare('UPDATE events SET moved_from_calendar_id = ?, dirty = 1 WHERE id = ?').run(DAV_A, across)
      const within = repo.createEvent({
        calendarId: G_B,
        title: 'Within',
        dtStartUtc: '2026-04-02T09:00:00.000Z',
        dtEndUtc: '2026-04-02T10:00:00.000Z'
      }).id
      db.prepare("UPDATE events SET provider_event_id = 'g2', etag = 'e1', moved_from_calendar_id = ? WHERE id = ?").run(
        G_A,
        within
      )

      db.exec(MIGRATION_024_SQL)

      expect(row(across)).toMatchObject({ provider_event_id: null, etag: null, moved_from_calendar_id: null, dirty: 1 })
      expect(row(within)).toMatchObject({ provider_event_id: 'g2', etag: 'e1', moved_from_calendar_id: G_A })
    })
  })
})
