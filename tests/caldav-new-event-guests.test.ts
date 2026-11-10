import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createSqliteDriver, type ISqliteDatabase } from '../src/main/db/sqlite-driver'
import { runMigrations, seedDefaultData } from '../src/main/db/database'
import { EventsRepo } from '../src/main/db/repos/events-repo'
import { CalDavSyncEngine } from '../src/main/sync/caldav-sync-engine'

/**
 * A push carries the guest list only once `attendees_synced` says the local
 * list is the server's, or while the event has no etag (a new event, whose
 * list can only be the one made here). The first PUT of an event made here
 * sends its guests, and the server answers with an etag - but nothing set
 * `attendees_synced`, and the next pull skips the resource as unchanged. So
 * every later push of that event went without guests: a guest added in the
 * editor was never invited, and since a new event has no server copy to keep
 * guests from, the PUT replaced the meeting with one that had none.
 */

const DAV = 'https://dav.example/me/work/'
const CREDS = { url: 'https://dav.example/me/', username: 'me', password: 'pw' }
const ME = 'me@example.com'

interface Call {
  url: string
  method: string
  body?: string
}

function serve(): Call[] {
  const calls: Call[] = []
  let n = 0
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const call = { url, method: init?.method ?? 'GET', body: init?.body === undefined ? undefined : String(init.body) }
      calls.push(call)
      const ok = call.method === 'PUT'
      return {
        ok,
        status: ok ? 201 : 404,
        url: '',
        json: async () => ({}),
        text: async () => '',
        body: new Response('').body,
        headers: new Headers(ok ? { etag: `"v${++n}"` } : {})
      } as unknown as Response
    })
  )
  return calls
}

const guestsIn = (ics: string | undefined): string[] =>
  (ics ?? '')
    .split(/\r?\n/)
    .filter((line) => line.startsWith('ATTENDEE'))
    .map((line) => line.slice(line.lastIndexOf('mailto:') + 'mailto:'.length))
    .sort()

describe('guests of an event made here, on CalDAV', () => {
  let db: ISqliteDatabase
  let repo: EventsRepo

  beforeEach(() => {
    db = createSqliteDriver(':memory:')
    runMigrations(db)
    seedDefaultData(db)
    repo = new EventsRepo(db)
    const now = new Date().toISOString()
    db.prepare(
      `INSERT INTO accounts (id, type, name, email, is_active, created_at, updated_at) VALUES ('acc', 'caldav', 'acc', ?, 1, ?, ?)`
    ).run(ME, now, now)
    db.prepare(
      `INSERT INTO calendars (id, account_id, name, color, is_visible, is_read_only, is_default, created_at, updated_at)
       VALUES (?, 'acc', 'Work', '#000', 1, 0, 0, ?, ?)`
    ).run(DAV, now, now)
  })

  afterEach(() => vi.unstubAllGlobals())

  it('are sent with every push after the first, including a guest added later', async () => {
    const id = repo.createEvent({
      calendarId: DAV,
      uid: 'uid-1',
      title: 'Planning',
      dtStartUtc: '2026-04-01T09:00:00.000Z',
      dtEndUtc: '2026-04-01T10:00:00.000Z',
      attendees: [{ email: 'ann@example.com' }]
    }).id
    const calls = serve()
    const engine = new CalDavSyncEngine(db)

    await engine.pushDirtyEvents(DAV, CREDS)
    expect(guestsIn(calls[0]?.body)).toContain('ann@example.com')
    expect(db.prepare('SELECT attendees_synced FROM events WHERE id = ?').get<{ attendees_synced: number }>(id))
      .toEqual({ attendees_synced: 1 })

    repo.updateEvent(id, { attendees: [{ email: 'ann@example.com' }, { email: 'bob@example.com' }] })
    await engine.pushDirtyEvents(DAV, CREDS)

    const second = calls.filter((c) => c.method === 'PUT')[1]
    expect(second).toBeDefined()
    expect(guestsIn(second.body)).toEqual(expect.arrayContaining(['ann@example.com', 'bob@example.com']))
  })

  it('a push that fails leaves the list as it was', async () => {
    const id = repo.createEvent({
      calendarId: DAV,
      uid: 'uid-2',
      title: 'Planning',
      dtStartUtc: '2026-04-01T09:00:00.000Z',
      dtEndUtc: '2026-04-01T10:00:00.000Z',
      attendees: [{ email: 'ann@example.com' }]
    }).id
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 500, url: '', text: async () => '', headers: new Headers() }) as unknown as Response)
    )

    await new CalDavSyncEngine(db).pushDirtyEvents(DAV, CREDS)

    expect(db.prepare('SELECT attendees_synced, dirty FROM events WHERE id = ?').get(id)).toEqual({
      attendees_synced: 0,
      dirty: 1
    })
  })
})
