import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createSqliteDriver, type ISqliteDatabase } from '../src/main/db/sqlite-driver'
import { runMigrations, seedDefaultData } from '../src/main/db/database'
import { EventsRepo } from '../src/main/db/repos/events-repo'
import { CalDavSyncEngine } from '../src/main/sync/caldav-sync-engine'
import type { CalDavCredentials } from '../src/main/sync/caldav-adapter'

/**
 * Two kinds of CalDAV resource the pull mishandled.
 *
 * One holding only RECURRENCE-ID components - an invitation to one or a few
 * dates of someone else's series, which a scheduling server delivers without
 * the series - was dropped: its occurrences had no series to go on, and the
 * user never saw the invitation.
 *
 * And a VEVENT the reader could not make sense of was left out without a word,
 * so the resource read as having nothing in it: the row stored for it was
 * deleted as gone from the server, and never came back.
 */

const CAL = 'https://dav.example/me/cal/'
const CREDS: CalDavCredentials = { url: 'https://dav.example/me/', username: 'me', password: 'pw' }
const ME = 'me@example.com'

interface Item {
  name: string
  etag: string
  ics: string
}

interface Call {
  method: string
  url: string
  headers: Record<string, string>
  body?: string
}

const calendar = (...vevents: string[][]): string =>
  ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//test//EN', ...vevents.flat(), 'END:VCALENDAR'].join('\r\n')

const plain = (uid: string, title: string, extra: string[] = []): string[] => [
  'BEGIN:VEVENT',
  `UID:${uid}`,
  'DTSTAMP:20260101T000000Z',
  'DTSTART:20260401T090000Z',
  'DTEND:20260401T100000Z',
  `SUMMARY:${title}`,
  ...extra,
  'END:VEVENT'
]

const SERIES = 'series-uid@example.org'

/** One date of the organizer's weekly series, with this account invited. */
const occurrence = (day: string, partstat = 'NEEDS-ACTION'): string[] => [
  'BEGIN:VEVENT',
  `UID:${SERIES}`,
  'DTSTAMP:20260101T000000Z',
  `RECURRENCE-ID:202604${day}T090000Z`,
  `DTSTART:202604${day}T093000Z`,
  `DTEND:202604${day}T103000Z`,
  `SUMMARY:Review ${day}`,
  'ORGANIZER;CN=Boss:mailto:boss@example.com',
  'ATTENDEE;PARTSTAT=ACCEPTED:mailto:boss@example.com',
  `ATTENDEE;PARTSTAT=${partstat};RSVP=TRUE:mailto:${ME}`,
  'X-OTHER-CLIENT:kept',
  'END:VEVENT'
]

const theSeries = (): string[] => [
  'BEGIN:VEVENT',
  `UID:${SERIES}`,
  'DTSTAMP:20260101T000000Z',
  'DTSTART:20260401T090000Z',
  'DTEND:20260401T100000Z',
  'RRULE:FREQ=WEEKLY',
  'SUMMARY:Review',
  'ORGANIZER;CN=Boss:mailto:boss@example.com',
  'ATTENDEE;PARTSTAT=ACCEPTED:mailto:boss@example.com',
  `ATTENDEE;PARTSTAT=NEEDS-ACTION:mailto:${ME}`,
  'END:VEVENT'
]

const escapeXml = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function multistatus(items: Item[]): string {
  const responses = items
    .map(
      (i) =>
        `<D:response><D:href>/me/cal/${i.name}</D:href><D:propstat><D:prop>` +
        `<D:getetag>${escapeXml(i.etag)}</D:getetag><C:calendar-data>${escapeXml(i.ics)}</C:calendar-data>` +
        '</D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>'
    )
    .join('')
  return `<?xml version="1.0"?><D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">${responses}</D:multistatus>`
}

function response(status: number, body = '', headers: Record<string, string> = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    url: '',
    text: async () => body,
    body: new Response(body).body,
    headers: new Headers(headers)
  } as unknown as Response
}

describe('CalDAV resources without a series of their own', () => {
  let db: ISqliteDatabase
  let repo: EventsRepo
  let items: Item[]
  let calls: Call[]

  beforeEach(() => {
    db = createSqliteDriver(':memory:')
    runMigrations(db)
    seedDefaultData(db)
    repo = new EventsRepo(db)
    const now = new Date().toISOString()
    db.prepare(
      `INSERT INTO calendars (id, account_id, name, color, is_visible, is_read_only, is_default, created_at, updated_at)
       VALUES (?, 'account-local-primary', 'Me', '#000', 1, 0, 0, ?, ?)`
    ).run(CAL, now, now)
    items = []
    calls = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const call = {
          method: init?.method ?? 'GET',
          url,
          headers: (init?.headers ?? {}) as Record<string, string>,
          body: init?.body === undefined ? undefined : String(init.body)
        }
        calls.push(call)
        if (call.method === 'REPORT') return response(207, multistatus(items))
        if (call.method === 'PUT') return response(204, '', { etag: '"after-put"' })
        return response(204)
      })
    )
  })

  afterEach(() => vi.unstubAllGlobals())

  const pull = () => new CalDavSyncEngine(db).pullCalendarEvents(CAL, CREDS, ME)
  const push = () => new CalDavSyncEngine(db).pushDirtyEvents(CAL, CREDS, ME)
  const april = () => repo.queryEventsByRange([CAL], '2026-04-01T00:00:00.000Z', '2026-04-30T00:00:00.000Z')
  const byTitle = (title: string) => repo.queryEventsByCalendar(CAL).find((e) => e.title === title)!

  describe('a VEVENT the reader cannot make sense of', () => {
    it('keeps what was stored for its resource', async () => {
      items = [{ name: 'x.ics', etag: '"1"', ics: calendar(plain('x-uid', 'Dentist')) }]
      await pull()
      expect(april().map((o) => o.title)).toEqual(['Dentist'])

      // Another client rewrote it with a value nothing can read.
      items = [
        { name: 'x.ics', etag: '"2"', ics: calendar(plain('x-uid', 'Dentist (moved)', ['EXDATE:notadate'])) },
        { name: 'y.ics', etag: '"1"', ics: calendar(plain('y-uid', 'Lunch')) }
      ]
      await pull()

      expect(april().map((o) => o.title).sort()).toEqual(['Dentist', 'Lunch'])
    })
  })

  describe('an invitation to some dates of someone else\'s series', () => {
    it('shows each date as an event of its own, ready to answer', async () => {
      items = [{ name: 'inv.ics', etag: '"1"', ics: calendar(occurrence('08'), occurrence('15')) }]
      await pull()

      expect(april().map((o) => [o.title, o.startUtc])).toEqual([
        ['Review 08', '2026-04-08T09:30:00.000Z'],
        ['Review 15', '2026-04-15T09:30:00.000Z']
      ])
      const first = byTitle('Review 08')
      expect(first.providerEventId).toBe(`${CAL}inv.ics`)
      expect(repo.respondToInvite(first.id, 'accepted').attendees?.find((a) => a.isSelf)?.responseStatus).toBe(
        'accepted'
      )
    })

    it('sends an answer back in the server\'s copy, to that date only', async () => {
      items = [{ name: 'inv.ics', etag: '"1"', ics: calendar(occurrence('08'), occurrence('15')) }]
      await pull()
      repo.respondToInvite(byTitle('Review 15').id, 'declined')
      calls = []

      await push()

      expect(calls.map((c) => [c.method, c.url])).toEqual([['PUT', `${CAL}inv.ics`]])
      expect(calls[0].headers['If-Match']).toBe('"1"')
      const body = calls[0].body!.replace(/\r\n /g, '')
      const [, week08, week15] = body.split('BEGIN:VEVENT')
      expect(week08).toContain(`PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${ME}`)
      expect(week15).toContain(`PARTSTAT=DECLINED;RSVP=TRUE:mailto:${ME}`)
      // Still the organizer's occurrences, everything else as the server had it.
      expect(body).not.toContain('RRULE')
      expect(body.match(/RECURRENCE-ID/g)).toHaveLength(2)
      expect(body).toContain('X-OTHER-CLIENT:kept')
      expect(repo.listPendingRsvps(CAL)).toEqual([])
    })

    it('takes one date out of the resource, and the resource away with the last', async () => {
      items = [{ name: 'inv.ics', etag: '"1"', ics: calendar(occurrence('08'), occurrence('15')) }]
      await pull()
      repo.deleteEvent(byTitle('Review 08').id)
      calls = []

      await push()
      expect(calls.map((c) => c.method)).toEqual(['PUT'])
      expect(calls[0].body).not.toContain('Review 08')
      expect(calls[0].body).toContain('Review 15')

      repo.deleteEvent(byTitle('Review 15').id)
      calls = []
      await push()
      expect(calls.map((c) => [c.method, c.url])).toEqual([['DELETE', `${CAL}inv.ics`]])
      expect(repo.queryEventsByCalendar(CAL)).toEqual([])
    })

    it('stays in the calendar the invitation came to, guest list or not', async () => {
      // A server that leaves the guests out of the copy it delivers.
      const bare = occurrence('08').filter((line) => !/^(ORGANIZER|ATTENDEE)/.test(line))
      items = [{ name: 'inv.ics', etag: '"1"', ics: calendar(bare) }]
      await pull()
      const now = new Date().toISOString()
      db.prepare(
        `INSERT INTO calendars (id, account_id, name, color, is_visible, is_read_only, is_default, created_at, updated_at)
         VALUES ('https://dav.example/me/other/', 'account-local-primary', 'Other', '#000', 1, 0, 0, ?, ?)`
      ).run(now, now)

      expect(() => repo.updateEvent(byTitle('Review 08').id, { calendarId: 'https://dav.example/me/other/' })).toThrow(
        /invitation stays/
      )
    })

    it('folds the dates into the series once the resource has it', async () => {
      items = [{ name: 'inv.ics', etag: '"1"', ics: calendar(occurrence('08')) }]
      await pull()
      // Invited to the whole series since.
      items = [{ name: 'inv.ics', etag: '"2"', ics: calendar(theSeries(), occurrence('08')) }]
      await pull()

      const stored = repo.queryEventsByCalendar(CAL)
      expect(stored.map((e) => e.rrule)).toEqual(['FREQ=WEEKLY'])
      expect(repo.getExceptionsForEvent(stored[0].id).map((x) => x.title)).toEqual(['Review 08'])
    })
  })
})
