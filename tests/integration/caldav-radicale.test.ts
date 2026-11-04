import { describe, it, expect, inject, beforeAll, vi } from 'vitest'
import { RADICALE_PASSWORD, RADICALE_USER } from './radicale-server'

/**
 * A CalDAV round trip against a real Radicale (`npm run test:caldav`; the
 * server is started by radicale-server.ts). The unit tests stub `fetch` with
 * what a server is believed to send; this one sends real requests, so the
 * XML, the iCalendar the server stores and gives back, its etags, ctags and
 * preconditions are a server's own. It goes through the app's own code: the
 * connect handler from the account dialog, then CalDavSyncEngine.syncAll(),
 * which is what each poll runs. A second database plays a second computer
 * signed in to the same account.
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
const { createSqliteDriver } = await import('../../src/main/db/sqlite-driver')
const { runMigrations, seedDefaultData } = await import('../../src/main/db/database')
const { EventsRepo } = await import('../../src/main/db/repos/events-repo')
const { AccountsRepo } = await import('../../src/main/db/repos/accounts-repo')
const { SecureStore } = await import('../../src/main/secure-store')
const { CalDavSyncEngine } = await import('../../src/main/sync/caldav-sync-engine')
const { SyncWorker } = await import('../../src/main/sync/sync-worker')
const { registerAuthSyncIpcHandlers } = await import('../../src/main/ipc/auth-sync-ipc')
const { IPC_CHANNELS } = await import('../../src/shared/ipc-contract')

// The poll loop is not wanted here: each sync is run by hand, one at a time.
vi.spyOn(SyncWorker.prototype, 'start').mockImplementation(() => undefined)
vi.spyOn(SyncWorker.prototype, 'triggerSync').mockResolvedValue(undefined as never)

const base = inject('radicaleUrl')
const authorization = `Basic ${Buffer.from(`${RADICALE_USER}:${RADICALE_PASSWORD}`).toString('base64')}`
const WORK = `${base}${RADICALE_USER}/work/`
const FAMILY = `${base}${RADICALE_USER}/family/`

/** A request to the server as another client would make it. */
function dav(method: string, url: string, body?: string, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(url, { method, body, headers: { Authorization: authorization, ...headers } })
}

async function makeCalendar(url: string, name: string, color: string): Promise<void> {
  const res = await dav(
    'MKCALENDAR',
    url,
    `<?xml version="1.0" encoding="utf-8"?>
<C:mkcalendar xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:I="http://apple.com/ns/ical/">
  <D:set><D:prop>
    <D:displayname>${name}</D:displayname>
    <I:calendar-color>${color}</I:calendar-color>
    <C:supported-calendar-component-set><C:comp name="VEVENT"/></C:supported-calendar-component-set>
  </D:prop></D:set>
</C:mkcalendar>`,
    { 'Content-Type': 'application/xml; charset=utf-8' }
  )
  expect(res.status, await res.text()).toBe(201)
}

/** The iCalendar text the server holds at `href`, unfolded, with its etag. */
async function onServer(href: string): Promise<{ status: number; ics: string; etag: string | null }> {
  const res = await dav('GET', href)
  const ics = (await res.text()).replace(/\r?\n[ \t]/g, '')
  return { status: res.status, ics, etag: res.headers.get('etag') }
}

/** The names of the resources in a calendar. */
async function listing(calendar: string): Promise<string[]> {
  const res = await dav('PROPFIND', calendar, '<?xml version="1.0"?><D:propfind xmlns:D="DAV:"><D:prop><D:getetag/></D:prop></D:propfind>', {
    Depth: '1',
    'Content-Type': 'application/xml'
  })
  const xml = await res.text()
  return [...xml.matchAll(/<(?:\w+:)?href>([^<]+\.ics)<\/(?:\w+:)?href>/g)].map((m) => decodeURIComponent(m[1].split('/').pop()!))
}

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
  engine: InstanceType<typeof CalDavSyncEngine>
  sync: () => Promise<Awaited<ReturnType<InstanceType<typeof CalDavSyncEngine>['syncAll']>>>
  row: (id: string) => { title: string; dirty: number; has_conflict: number; provider_event_id: string | null; etag: string | null } | undefined
  titles: (calendarId: string) => string[]
}

function device(db: ReturnType<typeof createSqliteDriver>): Device {
  const engine = new CalDavSyncEngine(db)
  return {
    db,
    events: new EventsRepo(db),
    engine,
    sync: async () => {
      const result = await engine.syncAll()
      expect(result.accountErrors ?? {}, JSON.stringify(result)).toEqual({})
      return result
    },
    row: (id) =>
      db
        .prepare('SELECT title, dirty, has_conflict, provider_event_id, etag FROM events WHERE id = ?')
        .get<{ title: string; dirty: number; has_conflict: number; provider_event_id: string | null; etag: string | null }>(id),
    titles: (calendarId) =>
      db
        .prepare('SELECT title FROM events WHERE calendar_id = ? ORDER BY title')
        .all<{ title: string }>(calendarId)
        .map((r) => r.title)
  }
}

describe('CalDAV against Radicale', () => {
  const laptop = device(initDatabase(':memory:'))
  let accountId = ''

  beforeAll(async () => {
    await makeCalendar(WORK, 'Work', '#4dab9a')
    await makeCalendar(FAMILY, 'Gia đình', '#e06f9f')
    registerAuthSyncIpcHandlers()
  })

  it('connects with nothing but the server address, and finds both calendars', async () => {
    const connect = handlers.get(IPC_CHANNELS.AUTH.CONNECT_CALDAV)!
    const result = (await connect({}, {
      provider: 'generic',
      serverUrl: base,
      username: RADICALE_USER,
      password: RADICALE_PASSWORD
    })) as { success: boolean; message?: string; account?: { id: string } }
    expect(result.message).toBeUndefined()
    expect(result.success).toBe(true)
    accountId = result.account!.id

    // The calendar home is what is kept, so each poll lists calendars with one request.
    const stored = new SecureStore(laptop.db).getToken<{ url: string; password: string }>(accountId)
    expect(stored).toMatchObject({ url: `${base}${RADICALE_USER}/`, password: RADICALE_PASSWORD })

    await laptop.sync()
    const calendars = laptop.db
      .prepare('SELECT id, name, color, is_read_only FROM calendars WHERE account_id = ? ORDER BY name')
      .all<{ id: string; name: string; color: string; is_read_only: number }>(accountId)
    expect(calendars).toEqual([
      { id: FAMILY, name: 'Gia đình', color: '#e06f9f', is_read_only: 0 },
      { id: WORK, name: 'Work', color: '#4dab9a', is_read_only: 0 }
    ])
  })

  let dentist = ''
  const notes =
    'Mang theo phiếu khám và thẻ bảo hiểm. Nhớ hỏi bác sĩ về lịch tái khám tháng sau; đường Nguyễn Thị Minh Khai, quận 3.'

  it('puts an event made here on the server, with its zone, reminder and text intact', async () => {
    dentist = laptop.events.createEvent({
      calendarId: WORK,
      title: 'Khám răng — Dentist',
      notes,
      location: 'Phòng khám Ánh Dương, 12 Lê Lợi',
      dtStartUtc: '2026-12-01T02:00:00.000Z',
      dtEndUtc: '2026-12-01T03:00:00.000Z',
      tzid: 'Asia/Ho_Chi_Minh',
      reminders: [{ minutesBefore: 30 }]
    }).id

    expect((await laptop.sync()).pushedCount).toBe(1)
    const row = laptop.row(dentist)!
    expect(row.dirty).toBe(0)
    expect(row.provider_event_id).toMatch(new RegExp(`^${WORK}.+\\.ics$`))
    expect(row.etag).toBeTruthy()

    const { status, ics } = await onServer(row.provider_event_id!)
    expect(status).toBe(200)
    expect(ics).toContain('SUMMARY:Khám răng — Dentist')
    expect(ics).toContain(`DESCRIPTION:${notes.replace(/[,;]/g, (c) => `\\${c}`)}`)
    expect(ics).toContain('LOCATION:Phòng khám Ánh Dương\\, 12 Lê Lợi')
    expect(ics).toContain('DTSTART;TZID=Asia/Ho_Chi_Minh:20261201T090000')
    expect(ics).toContain('BEGIN:VTIMEZONE')
    expect(ics).toMatch(/TRIGGER:-PT30M/)

    // The pull that follows recognises it: one event, under the id it was made with.
    await laptop.sync()
    expect(laptop.titles(WORK)).toEqual(['Khám răng — Dentist'])
  })

  let trip = ''
  it('keeps an all-day span to its dates, whatever the zone', async () => {
    trip = laptop.events.createEvent({
      calendarId: WORK,
      title: 'Nghỉ Giáng sinh',
      dtStartUtc: '2026-12-24T00:00:00.000Z',
      // The app's all-day end is inclusive, the last instant of the last day, as the editor writes it.
      dtEndUtc: '2026-12-26T23:59:59.999Z',
      allDay: true
    }).id
    await laptop.sync()
    const { ics } = await onServer(laptop.row(trip)!.provider_event_id!)
    // DATE values, with the end the day after the last (RFC 5545).
    expect(ics).toContain('DTSTART;VALUE=DATE:20261224')
    expect(ics).toContain('DTEND;VALUE=DATE:20261227')
  })

  it('replaces it on the server when it is edited here', async () => {
    laptop.events.updateEvent(dentist, {
      title: 'Khám răng (dời giờ)',
      dtStartUtc: '2026-12-01T07:00:00.000Z',
      dtEndUtc: '2026-12-01T08:00:00.000Z'
    })
    expect((await laptop.sync()).pushedCount).toBe(1)
    const { ics } = await onServer(laptop.row(dentist)!.provider_event_id!)
    expect(ics).toContain('SUMMARY:Khám răng (dời giờ)')
    expect(ics).toContain('DTSTART;TZID=Asia/Ho_Chi_Minh:20261201T140000')
    expect(ics).toMatch(/TRIGGER:-PT30M/)
    expect(await listing(WORK)).toHaveLength(2)
  })

  it('takes an edit another client made on the server', async () => {
    const href = laptop.row(dentist)!.provider_event_id!
    const { ics, etag } = await onServer(href)
    const edited = ics.replace(/SUMMARY:[^\r\n]*/, 'SUMMARY:Khám răng (sửa trên điện thoại)')
    const put = await dav('PUT', href, edited, { 'Content-Type': 'text/calendar; charset=utf-8', 'If-Match': etag! })
    expect(put.status).toBeLessThan(300)

    await laptop.sync()
    expect(laptop.row(dentist)).toMatchObject({ title: 'Khám răng (sửa trên điện thoại)', dirty: 0 })
    expect(laptop.titles(WORK).filter((title) => title.startsWith('Khám răng'))).toHaveLength(1)
  })

  it('takes an event another client created, under whatever name it gave it', async () => {
    const href = `${WORK}from-phone-7f3a.ics`
    const put = await dav('PUT', href, vevent('phone-7f3a@example.org', 'Họp phụ huynh'), {
      'Content-Type': 'text/calendar; charset=utf-8',
      'If-None-Match': '*'
    })
    expect(put.status).toBe(201)

    await laptop.sync()
    const pulled = laptop.db
      .prepare('SELECT id, title FROM events WHERE provider_event_id = ?')
      .get<{ id: string; title: string }>(href)
    expect(pulled?.title).toBe('Họp phụ huynh')
  })

  let standup = ''
  let desktop: Device
  it('keeps a moved and a cancelled occurrence of a series, as another computer sees them', async () => {
    // Weekly on Mondays at 09:00 in Ho Chi Minh City, four times from 7 December.
    standup = laptop.events.createEvent({
      calendarId: WORK,
      title: 'Standup',
      dtStartUtc: '2026-12-07T02:00:00.000Z',
      dtEndUtc: '2026-12-07T02:15:00.000Z',
      tzid: 'Asia/Ho_Chi_Minh',
      rrule: 'FREQ=WEEKLY;BYDAY=MO;COUNT=4'
    }).id
    await laptop.sync()

    laptop.events.updateRecurringScope({
      masterEventId: standup,
      originalStartUtc: '2026-12-14T02:00:00.000Z',
      scope: 'this',
      updateInput: { title: 'Standup (moved)', dtStartUtc: '2026-12-14T04:00:00.000Z', dtEndUtc: '2026-12-14T04:15:00.000Z' }
    })
    laptop.events.deleteRecurringScope({ masterEventId: standup, originalStartUtc: '2026-12-21T02:00:00.000Z', scope: 'this' })
    await laptop.sync()

    // One resource holds the series: the rule, the cancelled week and the moved one.
    const { ics } = await onServer(laptop.row(standup)!.provider_event_id!)
    expect(ics).toContain('RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=4')
    expect(ics).toMatch(/EXDATE;TZID=Asia\/Ho_Chi_Minh:20261221T090000/)
    expect(ics).toMatch(/RECURRENCE-ID;TZID=Asia\/Ho_Chi_Minh:20261214T090000/)
    expect(ics).toContain('SUMMARY:Standup (moved)')

    // Another computer signed in to the same account draws the same three weeks.
    const desktopDb = createSqliteDriver(':memory:')
    runMigrations(desktopDb)
    seedDefaultData(desktopDb)
    new AccountsRepo(desktopDb).upsert({ id: accountId, type: 'caldav', name: 'Radicale', email: RADICALE_USER })
    new SecureStore(desktopDb).storeToken(accountId, { url: `${base}${RADICALE_USER}/`, username: RADICALE_USER, password: RADICALE_PASSWORD })
    desktop = device(desktopDb)
    await desktop.sync()

    const occurrences = desktop.events
      .queryEventsByRange([WORK], '2026-12-01T00:00:00.000Z', '2027-01-01T00:00:00.000Z')
      .filter((o) => o.title.startsWith('Standup'))
      .map((o) => [o.startUtc.slice(0, 16), o.title])
    expect(occurrences).toEqual([
      ['2026-12-07T02:00', 'Standup'],
      ['2026-12-14T04:00', 'Standup (moved)'],
      ['2026-12-28T02:00', 'Standup']
    ])
    expect(desktop.titles(WORK)).toEqual(['Họp phụ huynh', 'Khám răng (sửa trên điện thoại)', 'Nghỉ Giáng sinh', 'Standup'])
    const holiday = desktop.db
      .prepare("SELECT dtstart_utc, dtend_utc, all_day FROM events WHERE title = 'Nghỉ Giáng sinh'")
      .get<{ dtstart_utc: string; dtend_utc: string; all_day: number }>()!
    expect([holiday.dtstart_utc.slice(0, 10), holiday.dtend_utc.slice(0, 10), holiday.all_day]).toEqual(['2026-12-24', '2026-12-26', 1])
  })

  it('brings a deleted occurrence back everywhere when the delete is undone after it synced', async () => {
    laptop.events.restoreOccurrence(standup, '2026-12-21T02:00:00.000Z')
    await laptop.sync()
    expect((await onServer(laptop.row(standup)!.provider_event_id!)).ics).not.toContain('EXDATE')

    await desktop.sync()
    const weeks = desktop.events
      .queryEventsByRange([WORK], '2026-12-01T00:00:00.000Z', '2027-01-01T00:00:00.000Z')
      .filter((o) => o.title.startsWith('Standup'))
      .map((o) => o.startUtc.slice(0, 10))
    expect(weeks).toEqual(['2026-12-07', '2026-12-14', '2026-12-21', '2026-12-28'])
  })

  it('deletes here what another client deleted on the server', async () => {
    const res = await dav('DELETE', `${WORK}from-phone-7f3a.ics`)
    expect(res.status).toBeLessThan(300)
    await laptop.sync()
    expect(laptop.titles(WORK)).toEqual(['Khám răng (sửa trên điện thoại)', 'Nghỉ Giáng sinh', 'Standup'])
  })

  it('deletes on the server what is deleted here', async () => {
    const href = laptop.row(dentist)!.provider_event_id!
    laptop.events.deleteEvent(dentist)
    await laptop.sync()
    expect((await onServer(href)).status).toBe(404)
    expect((await listing(WORK)).sort()).toEqual(
      [laptop.row(trip)!.provider_event_id!, laptop.row(standup)!.provider_event_id!].map((h) => decodeURIComponent(h.split('/').pop()!)).sort()
    )
  })

  it('flags an edit made on both sides as a conflict instead of overwriting the server', async () => {
    const href = laptop.row(standup)!.provider_event_id!
    const before = await onServer(href)
    const put = await dav('PUT', href, before.ics.replace('SUMMARY:Standup\r\n', 'SUMMARY:Standup (theirs)\r\n'), {
      'Content-Type': 'text/calendar; charset=utf-8',
      'If-Match': before.etag!
    })
    expect(put.status).toBeLessThan(300)
    // Edited here too, before this computer has seen theirs.
    laptop.events.updateEvent(standup, { title: 'Standup (mine)' })

    await laptop.sync()
    expect(laptop.row(standup)).toMatchObject({ title: 'Standup (mine)', has_conflict: 1, dirty: 1 })
    expect((await onServer(href)).ics).toContain('SUMMARY:Standup (theirs)')

    // Keeping theirs takes the server's copy at the next sync.
    expect(laptop.events.resolveConflict(standup, 'keepTheirs')).toBe(true)
    await laptop.sync()
    expect(laptop.row(standup)).toMatchObject({ title: 'Standup (theirs)', has_conflict: 0, dirty: 0 })
  })

  it('asks for nothing but the calendar list when nothing has changed', async () => {
    await laptop.sync()
    const methods: string[] = []
    const realFetch = globalThis.fetch
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      methods.push(init?.method ?? 'GET')
      return realFetch(input, init)
    })
    try {
      const result = await laptop.sync()
      expect(result).toMatchObject({ pulledCount: 0, pushedCount: 0 })
    } finally {
      spy.mockRestore()
    }
    expect(methods).toEqual(['PROPFIND'])
  })
})
