import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createSqliteDriver, type ISqliteDatabase } from '../src/main/db/sqlite-driver'
import { runMigrations, seedDefaultData } from '../src/main/db/database'
import { EventsRepo } from '../src/main/db/repos/events-repo'
import { GoogleSyncEngine } from '../src/main/sync/google-sync-engine'
import { MicrosoftSyncEngine } from '../src/main/sync/microsoft-sync-engine'
import { CalDavSyncEngine } from '../src/main/sync/caldav-sync-engine'

/**
 * "Keep mine" on a sync conflict has to overwrite the event the provider holds.
 *
 * It used to clear the stored etag, and every engine reads "no etag" as "never
 * pushed": Google and Outlook POSTed the edit as a new event - a duplicate,
 * with the original still on the server and the guests invited again - and the
 * guest list went out whole even when it had never been read here, which on a
 * PUT removes every guest the provider has.
 */

const CAL = 'cal_keep'
const DAV_CAL = 'https://dav.example/me/cal/'
const HREF = `${DAV_CAL}uid-1.ics`
const CREDS = { url: 'https://dav.example/me/', username: 'me', password: 'pw' }

interface Call {
  url: string
  method: string
  headers: Record<string, string>
  body?: Record<string, unknown> | string
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
    headers: new Headers()
  } as unknown as Response
}

/** fetch that records every request and answers with `reply`'s response. */
function recordFetch(reply: (call: Call, n: number) => Response): Call[] {
  const calls: Call[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const raw = init?.body === undefined ? undefined : String(init.body)
      let body: Call['body'] = raw
      try {
        body = raw === undefined ? undefined : JSON.parse(raw)
      } catch {
        // CalDAV sends iCalendar text.
      }
      const call = { url, method: init?.method ?? 'GET', headers: (init?.headers ?? {}) as Record<string, string>, body }
      calls.push(call)
      return reply(call, calls.length)
    })
  )
  return calls
}

const ifMatchOf = (call: Call): string | undefined =>
  Object.entries(call.headers).find(([name]) => name.toLowerCase() === 'if-match')?.[1]

describe('keep mine', () => {
  let db: ISqliteDatabase
  let repo: EventsRepo

  beforeEach(() => {
    db = createSqliteDriver(':memory:')
    runMigrations(db)
    seedDefaultData(db)
    repo = new EventsRepo(db)
    const now = new Date().toISOString()
    for (const id of [CAL, DAV_CAL]) {
      db.prepare(
        `INSERT INTO calendars (id, account_id, name, color, is_visible, is_read_only, is_default, created_at, updated_at)
         VALUES (?, 'account-local-primary', 'Work', '#000', 1, 0, 0, ?, ?)`
      ).run(id, now, now)
    }
  })

  afterEach(() => vi.unstubAllGlobals())

  /** An event the provider has, edited here while someone changed it there. */
  function editedHere(calendarId: string, provider: { id: string; etag: string; guestsRead: boolean }): string {
    const id = repo.createEvent({
      calendarId,
      uid: 'uid-1',
      title: 'Review (mine)',
      dtStartUtc: '2026-04-01T09:00:00.000Z',
      dtEndUtc: '2026-04-01T10:00:00.000Z'
    }).id
    db.prepare('UPDATE events SET provider_event_id = ?, etag = ?, attendees_synced = ? WHERE id = ?').run(
      provider.id,
      provider.etag,
      provider.guestsRead ? 1 : 0,
      id
    )
    return id
  }

  describe('on Google', () => {
    it('overwrites the event it has, without a precondition, instead of creating another', async () => {
      const id = editedHere(CAL, { id: 'prov1', etag: 'e1', guestsRead: true })
      let conflicted = false
      const calls = recordFetch((call) => {
        if (call.method === 'PATCH' && !conflicted) {
          conflicted = true
          return jsonResponse({ error: 'changed' }, 412)
        }
        return jsonResponse({ id: 'prov1', etag: 'e3' })
      })

      await new GoogleSyncEngine(db).pushDirtyEvents(CAL, 'token')
      expect(repo.listConflicts().map((c) => c.eventId)).toEqual([id])

      expect(repo.resolveConflict(id, 'keepMine')).toBe(true)
      calls.length = 0
      await new GoogleSyncEngine(db).pushDirtyEvents(CAL, 'token')

      expect(calls.map((c) => [c.method, c.url.replace(/^.*\/calendars\//, '')])).toEqual([
        ['PATCH', `${CAL}/events/prov1`]
      ])
      expect(ifMatchOf(calls[0])).toBeUndefined()
      expect(repo.getEventById(id)!.event).toMatchObject({ dirty: false, etag: 'e3', providerEventId: 'prov1' })

      // From here on edits are checked against the version just written again.
      repo.updateEvent(id, { title: 'Review (later)' })
      calls.length = 0
      await new GoogleSyncEngine(db).pushDirtyEvents(CAL, 'token')
      expect(ifMatchOf(calls[0])).toBe('e3')
    })

    it('does not send a guest list it never read', async () => {
      const id = editedHere(CAL, { id: 'prov1', etag: 'e1', guestsRead: false })
      const guests = [{ email: 'guest@example.com', responseStatus: 'accepted' }]
      let conflicted = false
      const calls = recordFetch((call) => {
        if (call.method === 'PATCH' && !conflicted) {
          conflicted = true
          return jsonResponse({ error: 'changed' }, 412)
        }
        return jsonResponse({ id: 'prov1', etag: 'e3', attendees: guests })
      })

      await new GoogleSyncEngine(db).pushDirtyEvents(CAL, 'token')
      repo.resolveConflict(id, 'keepMine')
      calls.length = 0
      await new GoogleSyncEngine(db).pushDirtyEvents(CAL, 'token')

      // Left out of the PATCH, Google's list stays as it is, and the answer has it.
      expect(calls.map((c) => c.method)).toEqual(['PATCH'])
      expect(calls[0].body).not.toHaveProperty('attendees')
      expect(repo.getEventById(id)!.event.attendees?.map((a) => a.email)).toEqual(['guest@example.com'])
    })
  })

  describe('on Outlook', () => {
    it('patches the event it has, without a precondition, instead of creating another', async () => {
      const id = editedHere(CAL, { id: 'm1', etag: 'W/"1"', guestsRead: true })
      let conflicted = false
      const calls = recordFetch((call) => {
        if (call.method === 'PATCH' && !conflicted) {
          conflicted = true
          return jsonResponse({ error: 'changed' }, 412)
        }
        return jsonResponse({ id: 'm1', '@odata.etag': 'W/"3"', attendees: [] })
      })

      await new MicrosoftSyncEngine(db).pushDirtyEvents(CAL, 'token')
      repo.resolveConflict(id, 'keepMine')
      calls.length = 0
      await new MicrosoftSyncEngine(db).pushDirtyEvents(CAL, 'token')

      expect(calls.map((c) => [c.method, c.url.replace(/^.*\/v1\.0/, '')])).toEqual([['PATCH', '/me/events/m1']])
      expect(ifMatchOf(calls[0])).toBeUndefined()
      expect(repo.getEventById(id)!.event).toMatchObject({ dirty: false, etag: 'W/"3"' })
    })
  })

  describe('on CalDAV', () => {
    it('PUTs over the resource without a precondition, keeping the guests it never read', async () => {
      const id = editedHere(DAV_CAL, { id: HREF, etag: '"e1"', guestsRead: false })
      db.prepare('INSERT INTO event_sources (event_id, ics) VALUES (?, ?)').run(
        id,
        [
          'BEGIN:VCALENDAR',
          'VERSION:2.0',
          'PRODID:-//test//EN',
          'BEGIN:VEVENT',
          'UID:uid-1',
          'DTSTAMP:20260101T000000Z',
          'DTSTART:20260401T090000Z',
          'DTEND:20260401T100000Z',
          'SUMMARY:Review',
          'ORGANIZER:mailto:boss@example.com',
          'ATTENDEE;PARTSTAT=ACCEPTED:mailto:guest@example.com',
          'END:VEVENT',
          'END:VCALENDAR'
        ].join('\r\n')
      )
      let conflicted = false
      const calls = recordFetch(() => {
        if (!conflicted) {
          conflicted = true
          return { ok: false, status: 412, url: '', text: async () => '', headers: new Headers() } as unknown as Response
        }
        return { ok: true, status: 204, url: '', text: async () => '', headers: new Headers({ etag: '"e3"' }) } as unknown as Response
      })

      await new CalDavSyncEngine(db).pushDirtyEvents(DAV_CAL, CREDS)
      expect(repo.resolveConflict(id, 'keepMine')).toBe(true)
      calls.length = 0
      await new CalDavSyncEngine(db).pushDirtyEvents(DAV_CAL, CREDS)

      expect(calls.map((c) => [c.method, c.url])).toEqual([['PUT', HREF]])
      expect(ifMatchOf(calls[0])).toBeUndefined()
      expect(calls[0].body).toContain('SUMMARY:Review (mine)')
      expect(calls[0].body).toContain('mailto:guest@example.com')
      expect(repo.getEventById(id)!.event).toMatchObject({ dirty: false, etag: '"e3"' })
    })
  })
})
