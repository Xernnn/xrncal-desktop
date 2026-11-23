import { describe, it, expect, inject, beforeAll, vi } from 'vitest'
import { RADICALE_PASSWORD_3, RADICALE_USER_3 } from './radicale-server'

/**
 * What a CalDAV calendar carries between xrncal, One Calendar and the phone
 * app, against a real Radicale (`npm run test:caldav`): a new event's default
 * reminders, as alarms on the server that every device rings, and nothing
 * rung for an event the server holds no alarm for. A second database plays
 * another device signed in to the same account.
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

const { initDatabase, runMigrations, seedDefaultData } = await import('../../src/main/db/database')
const { createSqliteDriver } = await import('../../src/main/db/sqlite-driver')
const { EventsRepo } = await import('../../src/main/db/repos/events-repo')
const { AccountsRepo } = await import('../../src/main/db/repos/accounts-repo')
const { CalendarsRepo } = await import('../../src/main/db/repos/calendars-repo')
const { SettingsRepo } = await import('../../src/main/db/repos/settings-repo')
const { SecureStore } = await import('../../src/main/secure-store')
const { CalDavSyncEngine } = await import('../../src/main/sync/caldav-sync-engine')
const { SyncWorker } = await import('../../src/main/sync/sync-worker')
const { ReminderScheduler } = await import('../../src/main/notifications/reminder-scheduler')
const { registerAuthSyncIpcHandlers } = await import('../../src/main/ipc/auth-sync-ipc')
const { IPC_CHANNELS } = await import('../../src/shared/ipc-contract')
// What the editor fills a new event in with (see editorReminders).
const { newEventReminders } = await import('../../src/shared/reminders')

vi.spyOn(SyncWorker.prototype, 'start').mockImplementation(() => undefined)
vi.spyOn(SyncWorker.prototype, 'triggerSync').mockResolvedValue(undefined as never)

const base = inject('radicaleUrl')
const authorization = `Basic ${Buffer.from(`${RADICALE_USER_3}:${RADICALE_PASSWORD_3}`).toString('base64')}`
const HOME = `${base}${RADICALE_USER_3}/`
const PERSONAL = `${HOME}personal/`
const MIN = 60_000

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

/** Each alarm of the resource at `href`, as "ACTION TRIGGER". */
async function alarmsOnServer(href: string): Promise<string[]> {
  const res = await dav('GET', href)
  expect(res.status).toBe(200)
  const ics = (await res.text()).replace(/\r?\n[ \t]/g, '')
  return [...ics.matchAll(/BEGIN:VALARM\r?\n([\s\S]*?)END:VALARM/g)].map((m) => {
    const action = /^ACTION:(.*)$/m.exec(m[1])?.[1].trim()
    const trigger = /^TRIGGER[^:]*:(.*)$/m.exec(m[1])?.[1].trim()
    return `${action} ${trigger}`
  })
}

type Db = ReturnType<typeof createSqliteDriver>

function device(db: Db) {
  const engine = new CalDavSyncEngine(db)
  return {
    db,
    events: new EventsRepo(db),
    sync: async () => {
      const result = await engine.syncAll()
      expect(result.accountErrors ?? {}, JSON.stringify(result)).toEqual({})
      return result
    },
    /** The row of the event called `title`. */
    row: (title: string) =>
      db
        .prepare('SELECT id, reminders, provider_event_id FROM events WHERE title = ?')
        .get<{ id: string; reminders: string | null; provider_event_id: string | null }>(title)!,
    /** The titles the reminder scheduler rings at `nowMs`. */
    ringsAt: (nowMs: number) => {
      const scheduler = new ReminderScheduler(db, () => undefined)
      scheduler.tick(nowMs)
      return scheduler.listActive().map((r) => r.occurrence.title)
    }
  }
}

describe('One Calendar’s reminders, against Radicale', () => {
  const laptop = device(initDatabase(':memory:'))
  let accountId = ''

  beforeAll(async () => {
    await makeCalendar(PERSONAL, 'Personal', '#4dab9a')
    registerAuthSyncIpcHandlers()
    const connect = handlers.get(IPC_CHANNELS.AUTH.CONNECT_CALDAV)!
    const result = (await connect({}, {
      provider: 'generic',
      serverUrl: base,
      username: RADICALE_USER_3,
      password: RADICALE_PASSWORD_3
    })) as { success: boolean; message?: string; account?: { id: string } }
    expect(result.message).toBeUndefined()
    accountId = result.account!.id
    await laptop.sync()
  })

  /** Another device signed in to the same account, synced. */
  async function anotherDevice() {
    const db = createSqliteDriver(':memory:')
    runMigrations(db)
    seedDefaultData(db)
    new AccountsRepo(db).upsert({ id: accountId, type: 'caldav', name: 'Radicale', email: RADICALE_USER_3 })
    new SecureStore(db).storeToken(accountId, { url: HOME, username: RADICALE_USER_3, password: RADICALE_PASSWORD_3 })
    const other = device(db)
    await other.sync()
    return other
  }

  it('saves a new event with the default reminders, as alarms another device rings', async () => {
    const settings = new SettingsRepo(laptop.db).getAllSettings()
    const defaults = { timed: settings.defaultReminderMinutes, allDay: settings.defaultAllDayReminderMinutes }
    const calendar = new CalendarsRepo(laptop.db).getCalendarById(PERSONAL)!
    laptop.events.createEvent({
      calendarId: PERSONAL,
      title: 'Họp nhóm',
      dtStartUtc: '2026-12-02T02:00:00.000Z',
      dtEndUtc: '2026-12-02T03:00:00.000Z',
      tzid: 'Asia/Ho_Chi_Minh',
      reminders: newEventReminders(false, calendar.defaultReminders, defaults)
    })
    laptop.events.createEvent({
      calendarId: PERSONAL,
      title: 'Sinh nhật Minh',
      dtStartUtc: '2026-12-05T00:00:00.000Z',
      dtEndUtc: '2026-12-05T23:59:59.999Z',
      allDay: true,
      reminders: newEventReminders(true, calendar.defaultReminders, defaults)
    })
    expect((await laptop.sync()).pushedCount).toBe(2)

    // One Calendar's defaults: 15 minutes, and 12 hours before an all-day event.
    expect(await alarmsOnServer(laptop.row('Họp nhóm').provider_event_id!)).toEqual(['DISPLAY -PT15M'])
    expect(await alarmsOnServer(laptop.row('Sinh nhật Minh').provider_event_id!)).toEqual(['DISPLAY -PT12H'])

    const other = await anotherDevice()
    expect(JSON.parse(other.row('Họp nhóm').reminders!)).toEqual([{ minutesBefore: 15 }])
    expect(JSON.parse(other.row('Sinh nhật Minh').reminders!)).toEqual([{ minutesBefore: 720 }])
    const start = Date.parse('2026-12-02T02:00:00.000Z')
    expect(other.ringsAt(start - 16 * MIN)).toEqual([])
    expect(other.ringsAt(start - 15 * MIN)).toEqual(['Họp nhóm'])
  })

  it('rings nothing for an event the server holds no alarm for, or a "none" alarm', async () => {
    const put = (name: string, uid: string, summary: string, alarm: string[] = []) =>
      dav(
        'PUT',
        `${PERSONAL}${name}.ics`,
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
          ...alarm,
          'END:VEVENT',
          'END:VCALENDAR',
          ''
        ].join('\r\n'),
        { 'Content-Type': 'text/calendar; charset=utf-8', 'If-None-Match': '*' }
      )
    expect((await put('from-phone-1', 'phone-1@example.org', 'Đi chợ')).status).toBe(201)
    // Apple's marker for "no alarm", which other calendars write too.
    const none = ['BEGIN:VALARM', 'ACTION:NONE', 'TRIGGER;VALUE=DATE-TIME:19760401T005545Z', 'END:VALARM']
    expect((await put('from-phone-2', 'phone-2@example.org', 'Gọi mẹ', none)).status).toBe(201)

    await laptop.sync()
    expect(laptop.row('Đi chợ').reminders).toBeNull()
    expect(laptop.row('Gọi mẹ').reminders).toBe('[]')
    const start = Date.parse('2026-12-03T02:00:00.000Z')
    for (const minutesBefore of [900, 720, 60, 15, 10, 5, 0]) {
      expect(laptop.ringsAt(start - minutesBefore * MIN), `${minutesBefore} min before`).toEqual([])
    }
  })
})
