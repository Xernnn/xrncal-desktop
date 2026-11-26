import { describe, it, expect, inject, beforeAll, vi } from 'vitest'
import { RADICALE_PASSWORD_4, RADICALE_USER_4 } from './radicale-server'

/**
 * A calendar deleted on the server, against a real Radicale
 * (`npm run test:caldav`). It stayed on this computer for good, events and
 * all; now it goes - unless it holds a change not yet sent - and a listing
 * that names none of the account's calendars (what Radicale answers once
 * they are all gone, as after a restore into the wrong folder) removes
 * nothing and fails the sync instead.
 */

const handlers = new Map<string, (...args: unknown[]) => unknown>()

vi.mock('electron', async () => {
  const stub = await vi.importActual<Record<string, unknown>>('../stubs/electron')
  return {
    ...stub,
    // A keyring that works: the connect handler refuses to store a password without one.
    safeStorage: {
      isEncryptionAvailable: () => true,
      getSelectedStorageBackend: () => 'gnome_libsecret',
      encryptString: (text: string) => Buffer.from(`enc:${text}`, 'utf8'),
      decryptString: (data: Buffer) => data.toString('utf8').slice(4)
    },
    ipcMain: {
      handle: (channel: string, fn: (...args: unknown[]) => unknown) => handlers.set(channel, fn),
      on: () => undefined,
      removeHandler: () => undefined
    }
  }
})

const { initDatabase } = await import('../../src/main/db/database')
const { EventsRepo } = await import('../../src/main/db/repos/events-repo')
const { CalDavSyncEngine } = await import('../../src/main/sync/caldav-sync-engine')
const { SyncWorker } = await import('../../src/main/sync/sync-worker')
const { registerAuthSyncIpcHandlers } = await import('../../src/main/ipc/auth-sync-ipc')
const { IPC_CHANNELS } = await import('../../src/shared/ipc-contract')

// The poll loop is not wanted here: each sync is run by hand, one at a time.
vi.spyOn(SyncWorker.prototype, 'start').mockImplementation(() => undefined)
vi.spyOn(SyncWorker.prototype, 'triggerSync').mockResolvedValue(undefined as never)

const base = inject('radicaleUrl')
const authorization = `Basic ${Buffer.from(`${RADICALE_USER_4}:${RADICALE_PASSWORD_4}`).toString('base64')}`
const HOME = `${base}${RADICALE_USER_4}/`
const PERSONAL = `${HOME}personal/`
const TRIP = `${HOME}trip/`
const WORK = `${HOME}work/`

function dav(method: string, url: string, body?: string, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(url, { method, body, headers: { Authorization: authorization, ...headers } })
}

async function makeCalendar(url: string, name: string): Promise<void> {
  const res = await dav(
    'MKCALENDAR',
    url,
    `<?xml version="1.0" encoding="utf-8"?>
<C:mkcalendar xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:set><D:prop>
    <D:displayname>${name}</D:displayname>
    <C:supported-calendar-component-set><C:comp name="VEVENT"/></C:supported-calendar-component-set>
  </D:prop></D:set>
</C:mkcalendar>`,
    { 'Content-Type': 'application/xml; charset=utf-8' }
  )
  expect(res.status, await res.text()).toBe(201)
}

async function deleteCalendar(url: string): Promise<void> {
  const res = await dav('DELETE', url)
  expect(res.ok, `${res.status} ${await res.text()}`).toBe(true)
}

const vevent = (uid: string, summary: string): string =>
  [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//another client//EN',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    'DTSTAMP:20261101T000000Z',
    'DTSTART:20261203T020000Z',
    'DTEND:20261203T030000Z',
    `SUMMARY:${summary}`,
    'END:VEVENT',
    'END:VCALENDAR',
    ''
  ].join('\r\n')

describe('a calendar deleted on the server, against Radicale', () => {
  const db = initDatabase(':memory:')
  const events = new EventsRepo(db)
  const engine = new CalDavSyncEngine(db)
  let accountId = ''

  const calendars = () =>
    db
      .prepare('SELECT id FROM calendars WHERE account_id = ? ORDER BY id')
      .all<{ id: string }>(accountId)
      .map((c) => c.id)
  const titles = (calendarId: string) =>
    db
      .prepare('SELECT title FROM events WHERE calendar_id = ? ORDER BY title')
      .all<{ title: string }>(calendarId)
      .map((e) => e.title)

  beforeAll(async () => {
    await makeCalendar(PERSONAL, 'Personal')
    await makeCalendar(TRIP, 'Trip')
    await makeCalendar(WORK, 'Work')
    const put = await dav('PUT', `${TRIP}flight.ics`, vevent('flight', 'Flight'), { 'Content-Type': 'text/calendar; charset=utf-8' })
    expect(put.status).toBe(201)
    registerAuthSyncIpcHandlers()
    const connect = handlers.get(IPC_CHANNELS.AUTH.CONNECT_CALDAV)!
    const result = (await connect({}, {
      provider: 'generic',
      serverUrl: base,
      username: RADICALE_USER_4,
      password: RADICALE_PASSWORD_4
    })) as { success: boolean; message?: string; account?: { id: string } }
    expect(result.message).toBeUndefined()
    accountId = result.account!.id
    expect((await engine.syncAll()).accountErrors).toEqual({})
    expect(calendars()).toEqual([PERSONAL, TRIP, WORK])
    expect(titles(TRIP)).toEqual(['Flight'])
  })

  it('removes it here, with its events', async () => {
    await deleteCalendar(TRIP)

    const result = await engine.syncAll()

    expect(result.accountErrors).toEqual({})
    expect(calendars()).toEqual([PERSONAL, WORK])
    expect(titles(TRIP)).toEqual([])
  })

  it('keeps it while it holds an event not yet sent, and removes it once that is gone', async () => {
    const draft = events.createEvent({
      calendarId: WORK,
      title: 'Planning',
      dtStartUtc: '2026-12-04T01:00:00.000Z',
      dtEndUtc: '2026-12-04T02:00:00.000Z'
    })
    await deleteCalendar(WORK)

    const result = await engine.syncAll()

    expect(calendars()).toEqual([PERSONAL, WORK])
    expect(titles(WORK)).toEqual(['Planning'])
    expect(result.accountErrors?.[accountId]).toBe('Not on the server: Work')

    events.deleteEvent(draft.id)
    expect((await engine.syncAll()).accountErrors).toEqual({})
    expect(calendars()).toEqual([PERSONAL])
  })

  it('removes nothing once the server lists none of the calendars here', async () => {
    const before = await dav('PUT', `${PERSONAL}lunch.ics`, vevent('lunch', 'Lunch'), { 'Content-Type': 'text/calendar; charset=utf-8' })
    expect(before.status).toBe(201)
    await engine.syncAll()
    expect(titles(PERSONAL)).toEqual(['Lunch'])
    // The last calendar gone: Radicale lists the principal and nothing else.
    await deleteCalendar(PERSONAL)

    const result = await engine.syncAll()

    expect(result.accountErrors?.[accountId]).toMatch(/names none of this account's calendars/)
    expect(calendars()).toEqual([PERSONAL])
    expect(titles(PERSONAL)).toEqual(['Lunch'])
  })
})
