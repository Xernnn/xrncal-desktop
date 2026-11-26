import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createSqliteDriver, type ISqliteDatabase } from '../src/main/db/sqlite-driver'
import { runMigrations, seedDefaultData } from '../src/main/db/database'
import { CalDavSyncEngine } from '../src/main/sync/caldav-sync-engine'
import type { CalDavCredentials } from '../src/main/sync/caldav-adapter'
import { SecureStore } from '../src/main/secure-store'
import { SyncStateRepo } from '../src/main/db/repos/sync-state-repo'

/**
 * A calendar deleted on the server stayed on this computer for good, events
 * and all, while the phone dropped it: the calendar list only ever added and
 * renamed. It is removed now - but only on a real listing, never on an error
 * or a listing that names none of the account's calendars (what a server that
 * lost its folder or its rights answers too), and never while it holds a
 * change not yet sent.
 */

const HOME = 'https://dav.example/alex/'
const PERSONAL = `${HOME}personal/`
const WORK = `${HOME}work/`
const CREDS: CalDavCredentials = { url: HOME, username: 'alex', password: 'pw' }
const ACCOUNT = 'acc_caldav_home'

function calendar(path: string, name: string): string {
  return (
    `<D:response><D:href>${path}</D:href><D:propstat><D:prop>` +
    `<D:resourcetype><D:collection/><C:calendar xmlns:C="urn:ietf:params:xml:ns:caldav"/></D:resourcetype>` +
    `<D:displayname>${name}</D:displayname><CS:getctag>ctag-1</CS:getctag>` +
    `<D:current-user-privilege-set><D:privilege><D:write/></D:privilege></D:current-user-privilege-set>` +
    `</D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>`
  )
}

/** The calendar home's Depth 1 listing, the home itself first, as Radicale sends it. */
function homeListing(...calendars: string[]): string {
  return (
    `<?xml version="1.0"?><D:multistatus xmlns:D="DAV:" xmlns:CS="http://calendarserver.org/ns/">` +
    `<D:response><D:href>/alex/</D:href><D:propstat><D:prop><D:resourcetype><D:collection/></D:resourcetype>` +
    `</D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>` +
    calendars.join('') +
    `</D:multistatus>`
  )
}

function response(status: number, body = ''): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    url: '',
    text: async () => body,
    body: new Response(body).body,
    headers: { get: () => null }
  } as unknown as Response
}

/** PROPFIND answers `status` with `listing`; nothing else should be asked (the ctags are unchanged). */
function stubServer(status: number, listing: string): { method: string }[] {
  const calls: { method: string }[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit) => {
      calls.push({ method: init.method ?? 'GET' })
      if (init.method === 'PROPFIND') return response(status, listing)
      return response(500, 'unexpected')
    })
  )
  return calls
}

describe('a CalDAV calendar deleted on the server', () => {
  let db: ISqliteDatabase
  let engine: CalDavSyncEngine

  const calendars = () =>
    db
      .prepare('SELECT id FROM calendars WHERE account_id = ? ORDER BY id')
      .all<{ id: string }>(ACCOUNT)
      .map((c) => c.id)
  const titles = (calendarId: string) =>
    db
      .prepare('SELECT title FROM events WHERE calendar_id = ? ORDER BY title')
      .all<{ title: string }>(calendarId)
      .map((e) => e.title)

  beforeEach(() => {
    db = createSqliteDriver(':memory:')
    runMigrations(db)
    seedDefaultData(db)
    const now = new Date().toISOString()
    db.prepare(
      `INSERT INTO accounts (id, type, name, email, is_active, created_at, updated_at)
       VALUES (?, 'caldav', 'Home server', 'alex', 1, ?, ?)`
    ).run(ACCOUNT, now, now)
    for (const [id, name] of [
      [PERSONAL, 'Personal'],
      [WORK, 'Work']
    ]) {
      db.prepare(
        `INSERT INTO calendars (id, account_id, name, color, is_visible, is_read_only, is_default, created_at, updated_at)
         VALUES (?, ?, ?, '#000000', 1, 0, 0, ?, ?)`
      ).run(id, ACCOUNT, name, now, now)
      // Pulled at this ctag, so a poll that lists it unchanged asks for nothing more.
      new SyncStateRepo(db).saveSyncToken(id, 'ctag-1')
      db.prepare(
        `INSERT INTO events (id, provider_event_id, calendar_id, uid, title, dtstart_utc, dtend_utc, tzid, all_day,
                             etag, dirty, is_deleted, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, '2026-12-01T01:00:00.000Z', '2026-12-01T02:00:00.000Z', 'UTC', 0, '"e1"', 0, 0, ?, ?)`
      ).run(`uid-${name}`, `${id}${name}.ics`, id, `uid-${name}`, `${name} meeting`, now, now)
    }
    vi.spyOn(SecureStore.prototype, 'getToken').mockReturnValue(CREDS as never)
    engine = new CalDavSyncEngine(db)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('is removed here, with its events, when the listing leaves it out', async () => {
    const calls = stubServer(207, homeListing(calendar('/alex/personal/', 'Personal')))

    const res = await engine.syncAll()

    expect(res.accountErrors).toEqual({})
    expect(calendars()).toEqual([PERSONAL])
    expect(titles(WORK)).toEqual([])
    expect(titles(PERSONAL)).toEqual(['Personal meeting'])
    // Counted, so the window reads its calendars again.
    expect(res.pulledCount).toBe(1)
    expect(calls.map((c) => c.method)).toEqual(['PROPFIND'])
  })

  it.each([
    ['an edit not yet sent', "UPDATE events SET dirty = 1, title = 'Work meeting (moved)' WHERE calendar_id = ?"],
    ['a conflict', 'UPDATE events SET has_conflict = 1 WHERE calendar_id = ?'],
    ['an answer to an invitation', "UPDATE events SET rsvp_pending = 'accepted' WHERE calendar_id = ?"]
  ])('stays while it holds %s, and the account says why', async (_what, change) => {
    db.prepare(change).run(WORK)
    stubServer(207, homeListing(calendar('/alex/personal/', 'Personal')))

    const res = await engine.syncAll()

    expect(calendars()).toEqual([PERSONAL, WORK])
    expect(titles(WORK)).toHaveLength(1)
    expect(res.accountErrors?.[ACCOUNT]).toBe('Not on the server: Work')
    const state = db
      .prepare('SELECT sync_status, error_message FROM sync_state WHERE calendar_id = ?')
      .get<{ sync_status: string; error_message: string }>(WORK)
    expect(state).toEqual({ sync_status: 'error', error_message: 'Not on the server' })
  })

  it("stays while a changed date of one of its series hasn't been sent", async () => {
    const now = new Date().toISOString()
    db.prepare(
      `INSERT INTO event_exceptions (id, master_event_id, original_start_utc, is_cancelled, dirty, created_at, updated_at)
       VALUES ('exc_work', 'uid-Work', '2026-12-08T01:00:00.000Z', 1, 1, ?, ?)`
    ).run(now, now)
    stubServer(207, homeListing(calendar('/alex/personal/', 'Personal')))

    await engine.syncAll()

    expect(calendars()).toEqual([PERSONAL, WORK])
  })

  it.each([
    ['a 404', 404, 'Not Found'],
    ['a 403', 403, 'Forbidden'],
    ['a sign-in page answered 200', 200, '<html><body>Sign in to continue</body></html>'],
    ['an empty 200', 200, ''],
    ['a listing cut short', 207, homeListing(calendar('/alex/personal/', 'Personal')).replace('</D:multistatus>', '')]
  ])('removes nothing on %s', async (_what, status, body) => {
    stubServer(status, body)

    const res = await engine.syncAll()

    expect(calendars()).toEqual([PERSONAL, WORK])
    expect(titles(WORK)).toEqual(['Work meeting'])
    expect(res.success).toBe(false)
    expect(res.accountErrors?.[ACCOUNT]).toBeTruthy()
  })

  it.each([
    ['lists no calendars', homeListing()],
    ['lists only calendars it never had', homeListing(calendar('/alex/elsewhere/', 'Elsewhere'))]
  ])('removes nothing, and adds nothing, when the server %s', async (_what, listing) => {
    stubServer(207, listing)

    const res = await engine.syncAll()

    expect(calendars()).toEqual([PERSONAL, WORK])
    expect(titles(PERSONAL)).toEqual(['Personal meeting'])
    expect(titles(WORK)).toEqual(['Work meeting'])
    expect(res.accountErrors?.[ACCOUNT]).toMatch(/names none of this account's calendars/)
  })

  it('leaves a calendar detached onto this computer alone', async () => {
    db.prepare("UPDATE calendars SET account_id = 'account-local-primary' WHERE id = ?").run(WORK)
    stubServer(207, homeListing(calendar('/alex/personal/', 'Personal')))

    await engine.syncAll()

    expect(db.prepare('SELECT account_id FROM calendars WHERE id = ?').get<{ account_id: string }>(WORK)).toEqual({
      account_id: 'account-local-primary'
    })
    expect(titles(WORK)).toEqual(['Work meeting'])
  })
})
