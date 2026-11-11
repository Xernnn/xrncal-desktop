import { describe, it, expect, inject, beforeAll, afterEach, vi } from 'vitest'
import { RADICALE_PASSWORD_2, RADICALE_USER_2 } from './radicale-server'

/**
 * Changing an event's calendar, against a real Radicale (`npm run test:caldav`).
 *
 * At the server an event lives *in* a calendar, so the change is a new
 * resource in one collection and a delete in the other, spread over requests
 * that the user's next edit, the poll and another device can all land between.
 * Each case here ends the same way: the event is in the calendar it was put
 * in, once, here and on the server, and further syncs leave it so.
 */

const handlers = new Map<string, (...args: unknown[]) => unknown>()

vi.mock('electron', async () => {
  const stub = await vi.importActual<Record<string, unknown>>('../stubs/electron')
  return {
    ...stub,
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
const { createSqliteDriver } = await import('../../src/main/db/sqlite-driver')
const { runMigrations, seedDefaultData } = await import('../../src/main/db/database')
const { EventsRepo } = await import('../../src/main/db/repos/events-repo')
const { AccountsRepo } = await import('../../src/main/db/repos/accounts-repo')
const { SecureStore } = await import('../../src/main/secure-store')
const { CalDavSyncEngine } = await import('../../src/main/sync/caldav-sync-engine')
const { SyncWorker } = await import('../../src/main/sync/sync-worker')
const { registerAuthSyncIpcHandlers } = await import('../../src/main/ipc/auth-sync-ipc')
const { IPC_CHANNELS } = await import('../../src/shared/ipc-contract')

vi.spyOn(SyncWorker.prototype, 'start').mockImplementation(() => undefined)
vi.spyOn(SyncWorker.prototype, 'triggerSync').mockResolvedValue(undefined as never)

const base = inject('radicaleUrl')
const authorization = `Basic ${Buffer.from(`${RADICALE_USER_2}:${RADICALE_PASSWORD_2}`).toString('base64')}`
const HOME = `${base}${RADICALE_USER_2}/`
const WORK = `${HOME}work/`
const FAMILY = `${HOME}family/`
const STUDY = `${HOME}study/`

const realFetch = globalThis.fetch

function dav(method: string, url: string, body?: string, headers: Record<string, string> = {}): Promise<Response> {
  return realFetch(url, { method, body, headers: { Authorization: authorization, ...headers } })
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

/** Every event the server holds in a calendar: its resource, UID and title. */
async function onServer(calendar: string): Promise<{ href: string; uid: string; title: string; ics: string }[]> {
  const res = await dav(
    'REPORT',
    calendar,
    `<?xml version="1.0" encoding="utf-8"?>
<C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:prop><D:getetag/><C:calendar-data/></D:prop>
  <C:filter><C:comp-filter name="VCALENDAR"><C:comp-filter name="VEVENT"/></C:comp-filter></C:filter>
</C:calendar-query>`,
    { Depth: '1', 'Content-Type': 'application/xml; charset=utf-8' }
  )
  const xml = await res.text()
  const out: { href: string; uid: string; title: string; ics: string }[] = []
  for (const block of xml.split(/<(?:\w+:)?response>/).slice(1)) {
    const href = /<(?:\w+:)?href>([^<]+)<\/(?:\w+:)?href>/.exec(block)?.[1] ?? ''
    const ics = (/<(?:\w+:)?calendar-data[^>]*>([\s\S]*?)<\/(?:\w+:)?calendar-data>/.exec(block)?.[1] ?? '')
      .replace(/&#13;/g, '')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/\r?\n[ \t]/g, '')
    out.push({
      href,
      uid: /^UID:(.*)$/m.exec(ics)?.[1].trim() ?? '',
      title: /^SUMMARY:(.*)$/m.exec(ics)?.[1].trim() ?? '',
      ics
    })
  }
  return out.sort((a, b) => a.title.localeCompare(b.title))
}

const titlesOnServer = async (calendar: string): Promise<string[]> => (await onServer(calendar)).map((e) => e.title)

const vevent = (uid: string, summary: string, extra: string[] = []): string =>
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
    ...extra,
    'END:VEVENT',
    'END:VCALENDAR',
    ''
  ].join('\r\n')

interface Device {
  db: ReturnType<typeof createSqliteDriver>
  events: InstanceType<typeof EventsRepo>
  sync: () => Promise<Awaited<ReturnType<InstanceType<typeof CalDavSyncEngine>['syncAll']>>>
  titles: (calendarId: string) => string[]
  row: (id: string) =>
    | {
        calendar_id: string
        dirty: number
        has_conflict: number
        provider_event_id: string | null
        etag: string | null
        moved_from_calendar_id: string | null
      }
    | undefined
}

function device(db: ReturnType<typeof createSqliteDriver>): Device {
  const engine = new CalDavSyncEngine(db)
  return {
    db,
    events: new EventsRepo(db),
    sync: async () => {
      const result = await engine.syncAll()
      expect(result.accountErrors ?? {}, JSON.stringify(result)).toEqual({})
      return result
    },
    titles: (calendarId) =>
      db
        .prepare('SELECT title FROM events WHERE calendar_id = ? AND is_deleted = 0 ORDER BY title')
        .all<{ title: string }>(calendarId)
        .map((r) => r.title),
    row: (id) =>
      db
        .prepare(
          'SELECT calendar_id, dirty, has_conflict, provider_event_id, etag, moved_from_calendar_id FROM events WHERE id = ?'
        )
        .get(id)
  }
}

/**
 * Run `act` once, at the moment a request matching `when` is on the wire:
 * 'sent' is before the server has seen it, 'answered' once its reply is back
 * but before the engine has read it. That is where a click in the window
 * lands while a sync is running.
 */
function during(
  when: { method: string; url: (url: string) => boolean; at: 'sent' | 'answered' },
  act: () => void | Promise<void>
): { fired: () => boolean } {
  let done = false
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input)
      const hit = !done && (init?.method ?? 'GET') === when.method && when.url(url)
      if (hit && when.at === 'sent') {
        done = true
        await act()
      }
      const res = await realFetch(input, init)
      if (hit && when.at === 'answered') {
        done = true
        await act()
      }
      return res
    })
  )
  return { fired: () => done }
}

const at = (hour: number): { dtStartUtc: string; dtEndUtc: string; tzid: string } => ({
  dtStartUtc: `2026-12-0${1 + (hour % 9)}T0${hour % 10}:00:00.000Z`,
  dtEndUtc: `2026-12-0${1 + (hour % 9)}T0${hour % 10}:30:00.000Z`,
  tzid: 'Asia/Ho_Chi_Minh'
})

describe('changing an event’s calendar, against Radicale', () => {
  const laptop = device(initDatabase(':memory:'))
  let accountId = ''

  /** The event is in `calendar` and nowhere else, once, here and on the server; and stays so. */
  async function expectOnlyIn(title: string, calendar: string): Promise<void> {
    const everywhere = [WORK, FAMILY, STUDY]
    for (let pass = 0; pass < 3; pass++) {
      for (const cal of everywhere) {
        const want = cal === calendar ? [title] : []
        expect(laptop.titles(cal).filter((t) => t === title), `here, in ${cal}, pass ${pass}`).toEqual(want)
        expect((await titlesOnServer(cal)).filter((t) => t === title), `on the server, in ${cal}, pass ${pass}`).toEqual(want)
      }
      const rows = laptop.db
        .prepare('SELECT dirty, has_conflict, moved_from_calendar_id, provider_event_id FROM events WHERE title = ?')
        .all<{ dirty: number; has_conflict: number; moved_from_calendar_id: string | null; provider_event_id: string }>(title)
      expect(rows, `pass ${pass}`).toEqual([
        { dirty: 0, has_conflict: 0, moved_from_calendar_id: null, provider_event_id: expect.stringContaining(calendar) }
      ])
      await laptop.sync()
    }
  }

  beforeAll(async () => {
    await makeCalendar(WORK, 'Work')
    await makeCalendar(FAMILY, 'Family')
    await makeCalendar(STUDY, 'Study')
    registerAuthSyncIpcHandlers()
    const connect = handlers.get(IPC_CHANNELS.AUTH.CONNECT_CALDAV)!
    const result = (await connect({}, {
      provider: 'generic',
      serverUrl: base,
      username: RADICALE_USER_2,
      password: RADICALE_PASSWORD_2
    })) as { success: boolean; message?: string; account?: { id: string } }
    expect(result.message).toBeUndefined()
    accountId = result.account!.id
    await laptop.sync()
    expect(
      laptop.db.prepare('SELECT id FROM calendars WHERE account_id = ? ORDER BY id').all<{ id: string }>(accountId).map((c) => c.id)
    ).toEqual([FAMILY, STUDY, WORK])
  })

  afterEach(() => {
    vi.stubGlobal('fetch', realFetch)
  })

  it('moves an event the server already has', async () => {
    const id = laptop.events.createEvent({ calendarId: WORK, title: 'Dentist', ...at(1) }).id
    await laptop.sync()
    await expectOnlyIn('Dentist', WORK)

    laptop.events.updateEvent(id, { calendarId: FAMILY })
    await laptop.sync()
    await expectOnlyIn('Dentist', FAMILY)
  })

  it('creates an event in the calendar it was changed to before it ever synced', async () => {
    const id = laptop.events.createEvent({ calendarId: WORK, title: 'Bữa tối', ...at(2) }).id
    laptop.events.updateEvent(id, { calendarId: FAMILY })
    await laptop.sync()
    await expectOnlyIn('Bữa tối', FAMILY)
  })

  for (const moment of ['sent', 'answered'] as const) {
    it(`moves an event whose calendar is changed while its first upload is ${moment}`, async () => {
      const title = `Planning (${moment})`
      const id = laptop.events.createEvent({ calendarId: WORK, title, ...at(3) }).id
      const edit = during({ method: 'PUT', url: (url) => url.startsWith(WORK), at: moment }, () => {
        laptop.events.updateEvent(id, { calendarId: FAMILY })
      })
      await laptop.sync()
      expect(edit.fired()).toBe(true)
      vi.stubGlobal('fetch', realFetch)
      await laptop.sync()
      await laptop.sync()
      await expectOnlyIn(title, FAMILY)
    })
  }

  it('moves an event whose calendar is changed while the calendar it was in is being read', async () => {
    const id = laptop.events.createEvent({ calendarId: WORK, title: 'Revision', ...at(4) }).id
    const edit = during({ method: 'REPORT', url: (url) => url.startsWith(WORK), at: 'answered' }, () => {
      laptop.events.updateEvent(id, { calendarId: STUDY })
    })
    await laptop.sync()
    expect(edit.fired()).toBe(true)
    vi.stubGlobal('fetch', realFetch)
    await laptop.sync()
    await expectOnlyIn('Revision', STUDY)
  })

  it('moves an event whose calendar is changed while the calendar it goes to is being read', async () => {
    const id = laptop.events.createEvent({ calendarId: WORK, title: 'Đọc sách', ...at(5) }).id
    await laptop.sync()
    // Something new in Study, so the next poll reads it.
    expect((await dav('PUT', `${STUDY}phone-1.ics`, vevent('phone-1', 'From the phone'), { 'Content-Type': 'text/calendar' })).status).toBe(201)
    const edit = during({ method: 'REPORT', url: (url) => url.startsWith(STUDY), at: 'answered' }, () => {
      laptop.events.updateEvent(id, { calendarId: STUDY })
    })
    await laptop.sync()
    expect(edit.fired()).toBe(true)
    vi.stubGlobal('fetch', realFetch)
    await laptop.sync()
    await expectOnlyIn('Đọc sách', STUDY)
  })

  it('moves on from a second change made before the first was sent', async () => {
    const id = laptop.events.createEvent({ calendarId: WORK, title: 'Twice', ...at(6) }).id
    await laptop.sync()
    laptop.events.updateEvent(id, { calendarId: FAMILY })
    laptop.events.updateEvent(id, { calendarId: STUDY })
    await laptop.sync()
    await expectOnlyIn('Twice', STUDY)
  })

  it('leaves an event changed and changed back where it was', async () => {
    const id = laptop.events.createEvent({ calendarId: WORK, title: 'There and back', ...at(7) }).id
    await laptop.sync()
    laptop.events.updateEvent(id, { calendarId: FAMILY })
    laptop.events.updateEvent(id, { calendarId: WORK, title: 'There and back' })
    await laptop.sync()
    await expectOnlyIn('There and back', WORK)
  })

  it('moves again an event whose calendar is changed while its move is being sent', async () => {
    const id = laptop.events.createEvent({ calendarId: WORK, title: 'Changed my mind', ...at(8) }).id
    await laptop.sync()
    laptop.events.updateEvent(id, { calendarId: FAMILY })
    const edit = during({ method: 'PUT', url: (url) => url.startsWith(FAMILY), at: 'answered' }, () => {
      laptop.events.updateEvent(id, { calendarId: STUDY })
    })
    await laptop.sync()
    expect(edit.fired()).toBe(true)
    vi.stubGlobal('fetch', realFetch)
    await laptop.sync()
    await laptop.sync()
    await expectOnlyIn('Changed my mind', STUDY)
  })

  it('moves again an event whose calendar is changed while its old copy is being deleted', async () => {
    const id = laptop.events.createEvent({ calendarId: WORK, title: 'Changed my mind late', ...at(9) }).id
    await laptop.sync()
    laptop.events.updateEvent(id, { calendarId: FAMILY })
    const edit = during({ method: 'DELETE', url: (url) => url.startsWith(WORK), at: 'answered' }, () => {
      laptop.events.updateEvent(id, { calendarId: STUDY })
    })
    await laptop.sync()
    expect(edit.fired()).toBe(true)
    vi.stubGlobal('fetch', realFetch)
    await laptop.sync()
    await laptop.sync()
    await expectOnlyIn('Changed my mind late', STUDY)
  })

  it('finishes a move whose delete from the old calendar did not get through', async () => {
    const id = laptop.events.createEvent({ calendarId: WORK, title: 'Flaky link', ...at(1) }).id
    await laptop.sync()
    laptop.events.updateEvent(id, { calendarId: FAMILY })
    let dropped = false
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        if (!dropped && init?.method === 'DELETE') {
          dropped = true
          throw new TypeError('fetch failed')
        }
        return realFetch(input, init)
      })
    )
    const engine = new CalDavSyncEngine(laptop.db)
    await engine.syncAll()
    expect(dropped).toBe(true)
    vi.stubGlobal('fetch', realFetch)
    await laptop.sync()
    await expectOnlyIn('Flaky link', FAMILY)
  })

  it('moves an event another program made, whatever it called the resource', async () => {
    const uid = "Phone's (event) *7!@example.org"
    expect(
      (await dav('PUT', `${WORK}0b7c-from-phone.ics`, vevent(uid, 'Made on the phone'), { 'Content-Type': 'text/calendar' })).status
    ).toBe(201)
    await laptop.sync()
    const id = laptop.db.prepare('SELECT id FROM events WHERE title = ?').get<{ id: string }>('Made on the phone')!.id
    laptop.events.updateEvent(id, { calendarId: FAMILY })
    await laptop.sync()
    await expectOnlyIn('Made on the phone', FAMILY)
    // It is still the same event to every other program.
    expect((await onServer(FAMILY)).find((e) => e.title === 'Made on the phone')?.uid).toBe(uid)
  })

  it('moves a whole series, with the dates changed and removed from it', async () => {
    const id = laptop.events.createEvent({
      calendarId: WORK,
      title: 'Gym',
      dtStartUtc: '2026-12-07T11:00:00.000Z',
      dtEndUtc: '2026-12-07T12:00:00.000Z',
      tzid: 'Asia/Ho_Chi_Minh',
      rrule: 'FREQ=WEEKLY;COUNT=6'
    }).id
    await laptop.sync()
    laptop.events.updateRecurringScope({
      masterEventId: id,
      originalStartUtc: '2026-12-14T11:00:00.000Z',
      scope: 'this',
      updateInput: { title: 'Gym (late)', dtStartUtc: '2026-12-14T13:00:00.000Z', dtEndUtc: '2026-12-14T14:00:00.000Z' }
    })
    laptop.events.deleteRecurringScope({ masterEventId: id, originalStartUtc: '2026-12-21T11:00:00.000Z', scope: 'this' })
    await laptop.sync()

    laptop.events.updateRecurringScope({
      masterEventId: id,
      originalStartUtc: '2026-12-28T11:00:00.000Z',
      scope: 'all',
      updateInput: { calendarId: FAMILY }
    })
    await laptop.sync()
    await expectOnlyIn('Gym', FAMILY)
    const series = (await onServer(FAMILY)).find((e) => e.title === 'Gym')!
    expect(series.ics).toContain('SUMMARY:Gym (late)')
    expect(series.ics).toMatch(/EXDATE[^\r\n]*20261221T/)
    expect(await titlesOnServer(WORK)).not.toContain('Gym')
  })

  it('shows a move made here on another computer, as a move', async () => {
    const id = laptop.events.createEvent({ calendarId: WORK, title: 'Seen elsewhere', ...at(2) }).id
    await laptop.sync()

    const db = createSqliteDriver(':memory:')
    runMigrations(db)
    seedDefaultData(db)
    new AccountsRepo(db).upsert({ id: accountId, type: 'caldav', name: 'Radicale', email: RADICALE_USER_2 })
    new SecureStore(db).storeToken(accountId, { url: HOME, username: RADICALE_USER_2, password: RADICALE_PASSWORD_2 })
    const desktop = device(db)
    await desktop.sync()
    expect(desktop.titles(WORK)).toContain('Seen elsewhere')

    laptop.events.updateEvent(id, { calendarId: STUDY })
    await laptop.sync()
    await desktop.sync()
    await desktop.sync()
    expect(desktop.titles(WORK)).not.toContain('Seen elsewhere')
    expect(desktop.titles(STUDY).filter((t) => t === 'Seen elsewhere')).toEqual(['Seen elsewhere'])
  })
})
