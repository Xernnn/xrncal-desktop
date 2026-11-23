import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createSqliteDriver, type ISqliteDatabase } from '../src/main/db/sqlite-driver'
import { runMigrations, seedDefaultData } from '../src/main/db/database'
import { CalendarsRepo } from '../src/main/db/repos/calendars-repo'
import { CalDavSyncEngine } from '../src/main/sync/caldav-sync-engine'
import { SecureStore } from '../src/main/secure-store'

/**
 * A CalDAV calendar's colour is the server's (Apple's calendar-color), as in
 * One Calendar and on the phone: picking one here writes it there with a
 * PROPPATCH, and a colour changed on another device arrives with the next
 * sync. It used to be seeded once, at discovery, and kept on this computer
 * from then on. A calendar the server will not take a colour for - read-only,
 * or a server that refuses the property - keeps it here, as every calendar did.
 */

const HOME = 'https://dav.example/alex/'
const WORK = `${HOME}work/`
const SHARED = `${HOME}shared/`
const ACC = 'acc_caldav'
const CREDS = { url: HOME, username: 'alex', password: 'pw' }

interface FakeServer {
  /** Each calendar's calendar-color as the server holds it. */
  colors: Record<string, string>
  /** How a PROPPATCH is answered: an HTTP status, or 207 with this propstat status. */
  proppatch: { status: number; propstat?: number }
  requests: { method: string; url: string; body: string }[]
  /** Runs while a PROPPATCH is on its way, before the server answers. */
  duringProppatch?: () => void
}

const listing = (server: FakeServer) => `<?xml version="1.0"?>
<multistatus xmlns="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:CS="http://calendarserver.org/ns/" xmlns:I="http://apple.com/ns/ical/">
${[WORK, SHARED]
  .map(
    (href) => `<response><href>${new URL(href).pathname}</href><propstat><prop>
  <resourcetype><collection/><C:calendar/></resourcetype>
  <displayname>${href === WORK ? 'Work' : 'Shared'}</displayname>
  <I:calendar-color>${server.colors[href]}</I:calendar-color>
  <CS:getctag>c1</CS:getctag>
  <current-user-privilege-set><privilege><read/></privilege>${href === WORK ? '<privilege><write/></privilege>' : ''}</current-user-privilege-set>
</prop><status>HTTP/1.1 200 OK</status></propstat></response>`
  )
  .join('\n')}
</multistatus>`

function stubServer(server: FakeServer): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init: RequestInit) => {
      const method = init.method ?? 'GET'
      const body = String(init.body ?? '')
      server.requests.push({ method, url: input, body })
      if (method === 'PROPPATCH') {
        server.duringProppatch?.()
        const { status, propstat } = server.proppatch
        if (status !== 207) return new Response('', { status })
        const color = /<I:calendar-color>([^<]*)<\/I:calendar-color>/.exec(body)?.[1] ?? ''
        if (propstat === 200) server.colors[input] = color
        return new Response(
          `<?xml version="1.0"?><multistatus xmlns="DAV:" xmlns:I="http://apple.com/ns/ical/"><response><href>${new URL(input).pathname}</href><propstat><prop><I:calendar-color/></prop><status>HTTP/1.1 ${propstat} X</status></propstat></response></multistatus>`,
          { status: 207 }
        )
      }
      if (method === 'PROPFIND') return new Response(listing(server), { status: 207 })
      if (method === 'REPORT') return new Response('<multistatus xmlns="DAV:"/>', { status: 207 })
      return new Response('', { status: 404 })
    }) as unknown as typeof fetch
  )
}

describe('CalDAV calendar colours', () => {
  let db: ISqliteDatabase
  let calendars: CalendarsRepo
  let engine: CalDavSyncEngine
  let server: FakeServer

  // dirty: a colour picked here waits to go to the server.
  const row = (id: string) =>
    db
      .prepare(
        `SELECT color, color_is_custom AS custom,
           EXISTS (SELECT 1 FROM calendar_color_push WHERE calendar_id = calendars.id) AS dirty
         FROM calendars WHERE id = ?`
      )
      .get<{ color: string; custom: number; dirty: number }>(id)!
  const proppatches = () => server.requests.filter((r) => r.method === 'PROPPATCH')

  beforeEach(async () => {
    db = createSqliteDriver(':memory:')
    runMigrations(db)
    seedDefaultData(db)
    const now = new Date().toISOString()
    db.prepare(
      `INSERT INTO accounts (id, type, name, email, is_active, created_at, updated_at)
       VALUES (?, 'caldav', 'Home server', 'alex', 1, ?, ?)`
    ).run(ACC, now, now)
    calendars = new CalendarsRepo(db)
    engine = new CalDavSyncEngine(db)
    vi.spyOn(SecureStore.prototype, 'getToken').mockReturnValue(CREDS)
    server = { colors: { [WORK]: '#4DAB9AFF', [SHARED]: '#E06F9FFF' }, proppatch: { status: 207, propstat: 200 }, requests: [] }
    stubServer(server)
    await engine.syncAll()
    server.requests.length = 0
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('writes a colour picked here to the server, and keeps it there', async () => {
    calendars.updateCalendar(WORK, { color: '#529cca' })
    expect(row(WORK)).toEqual({ color: '#529cca', custom: 0, dirty: 1 })

    const result = await engine.syncAll()

    expect(result.accountErrors).toEqual({})
    expect(proppatches()).toHaveLength(1)
    expect(proppatches()[0].url).toBe(WORK)
    expect(proppatches()[0].body).toMatch(
      /<D:propertyupdate[^>]*xmlns:I="http:\/\/apple.com\/ns\/ical\/"[\s\S]*<D:set>\s*<D:prop>\s*<I:calendar-color>#529CCAFF<\/I:calendar-color>/
    )
    expect(server.colors[WORK]).toBe('#529CCAFF')
    expect(row(WORK)).toEqual({ color: '#529cca', custom: 0, dirty: 0 })

    // Sent once.
    await engine.syncAll()
    expect(proppatches()).toHaveLength(1)
  })

  it('takes a colour changed on another device', async () => {
    server.colors[WORK] = '#EB5757FF'
    await engine.syncAll()
    expect(row(WORK)).toEqual({ color: '#eb5757', custom: 0, dirty: 0 })
  })

  it('keeps a colour picked here until the server has it, through a failed attempt', async () => {
    calendars.updateCalendar(WORK, { color: '#529cca' })
    server.proppatch = { status: 503 }
    const failed = await engine.syncAll()
    expect(failed.accountErrors?.[ACC]).toMatch(/503/)
    // The listing still says the old colour; the one picked here stays.
    expect(row(WORK)).toEqual({ color: '#529cca', custom: 0, dirty: 1 })

    server.proppatch = { status: 207, propstat: 200 }
    await engine.syncAll()
    expect(server.colors[WORK]).toBe('#529CCAFF')
    expect(row(WORK)).toEqual({ color: '#529cca', custom: 0, dirty: 0 })
  })

  it('sends again a colour picked while the last one was on its way', async () => {
    calendars.updateCalendar(WORK, { color: '#529cca' })
    server.duringProppatch = () => {
      server.duringProppatch = undefined
      calendars.updateCalendar(WORK, { color: '#52b788' })
    }
    await engine.syncAll()
    expect(row(WORK)).toEqual({ color: '#52b788', custom: 0, dirty: 1 })

    await engine.syncAll()
    expect(server.colors[WORK]).toBe('#52B788FF')
    expect(row(WORK)).toEqual({ color: '#52b788', custom: 0, dirty: 0 })
  })

  for (const refusal of [{ status: 207, propstat: 403 }, { status: 403 }, { status: 405 }]) {
    it(`keeps the colour here when the server will not take it (${JSON.stringify(refusal)})`, async () => {
      calendars.updateCalendar(WORK, { color: '#529cca' })
      server.proppatch = refusal
      expect((await engine.syncAll()).accountErrors).toEqual({})
      expect(row(WORK)).toEqual({ color: '#529cca', custom: 1, dirty: 0 })

      // Not asked again, and not overwritten by the server's.
      server.colors[WORK] = '#EB5757FF'
      await engine.syncAll()
      expect(proppatches()).toHaveLength(1)
      expect(row(WORK).color).toBe('#529cca')
    })
  }

  it('keeps a read-only calendar\'s colour here, as before', async () => {
    calendars.updateCalendar(SHARED, { color: '#529cca' })
    expect(row(SHARED)).toEqual({ color: '#529cca', custom: 1, dirty: 0 })
    server.colors[SHARED] = '#EB5757FF'
    await engine.syncAll()
    expect(proppatches()).toHaveLength(0)
    expect(row(SHARED).color).toBe('#529cca')
  })

  it('leaves a read-only calendar\'s colour as it was first seen, as before', async () => {
    server.colors[SHARED] = '#EB5757FF'
    await engine.syncAll()
    expect(row(SHARED)).toEqual({ color: '#e06f9f', custom: 0, dirty: 0 })
  })

  it('asks nothing more than the calendar list when no colour is waiting', async () => {
    await engine.syncAll()
    expect(server.requests.map((r) => r.method)).toEqual(['PROPFIND'])
  })

  // Migration 033: a colour picked here before this was kept here only; on a
  // calendar that can take one it goes to the server at the next sync, so
  // every device shows what this one has been showing.
  it('sends a colour an older build kept here to the server once', async () => {
    db.prepare('UPDATE calendars SET color = ?, color_is_custom = 1 WHERE id = ?').run('#529cca', WORK)
    db.prepare('UPDATE calendars SET color = ?, color_is_custom = 1 WHERE id = ?').run('#52b788', SHARED)
    db.exec('DROP TABLE calendar_color_push')
    db.prepare('DELETE FROM schema_migrations WHERE version >= 33').run()
    runMigrations(db)

    expect(row(WORK)).toEqual({ color: '#529cca', custom: 0, dirty: 1 })
    expect(row(SHARED)).toEqual({ color: '#52b788', custom: 1, dirty: 0 })
    await engine.syncAll()
    expect(server.colors[WORK]).toBe('#529CCAFF')
    expect(proppatches().map((r) => r.url)).toEqual([WORK])
  })
})
