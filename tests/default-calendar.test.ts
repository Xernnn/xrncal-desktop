import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  addAccount,
  addCalDavAccount,
  addCalendar,
  addEvent,
  defaults,
  exists,
  tempProfile,
  DAV_WORK,
  LOCAL,
  LOCAL_ACCOUNT
} from './personal-calendar-fixtures'

/**
 * The default calendar - where a new event goes - is a calendar that exists
 * and can be written to, and an account's while one can be: a calendar on
 * this computer never syncs. The "Personal Calendar" a fresh profile starts
 * with was made whenever the accounts table was empty and stayed the default
 * after an account was added; it is made now only when there is nowhere else
 * to write, and removing it never brings it back.
 */

const handlers = new Map<string, (...args: unknown[]) => unknown>()

vi.mock('electron', async () => {
  const stub = await vi.importActual<Record<string, unknown>>('./stubs/electron')
  return {
    ...stub,
    ipcMain: {
      handle: (channel: string, fn: (...args: unknown[]) => unknown) => handlers.set(channel, fn),
      on: () => undefined,
      removeHandler: () => undefined
    }
  }
})

const call = (channel: string, ...args: unknown[]) => handlers.get(channel)!({}, ...args)

const { registerCalendarIpcHandlers } = await import('../src/main/ipc/calendar-ipc')
const { SyncWorker } = await import('../src/main/sync/sync-worker')
const { IPC_CHANNELS } = await import('../src/shared/ipc-contract')

let profile: ReturnType<typeof tempProfile>
const start = () => profile.start()

beforeEach(() => {
  handlers.clear()
  profile = tempProfile()
})

afterEach(() => profile.remove())

describe('seeding the calendar on this computer', () => {
  it('gives a fresh profile its Personal Calendar as the default', () => {
    const db = start()
    expect(db.prepare('SELECT id, name, account_id FROM calendars').all()).toEqual([
      { id: LOCAL, name: 'Personal Calendar', account_id: LOCAL_ACCOUNT }
    ])
    expect(defaults(db)).toEqual([LOCAL])
  })

  it('does not bring it back after it was removed, on the next start or once an account is added', () => {
    let db = start()
    registerCalendarIpcHandlers()
    db.prepare("INSERT INTO calendars (id, account_id, name, color, created_at, updated_at) VALUES ('cal_trips', ?, 'Trips', '#e57373', '', '')").run(LOCAL_ACCOUNT)

    expect(call(IPC_CHANNELS.CALENDAR.DELETE, LOCAL)).toBe(true)
    expect(defaults(db)).toEqual(['cal_trips'])

    db = start()
    expect(exists(db, LOCAL)).toBe(false)

    addCalDavAccount(db)
    db = start()
    expect(exists(db, LOCAL)).toBe(false)
    expect(defaults(db)).toEqual([DAV_WORK])
  })
})

describe('the default calendar', () => {
  it('moves at start-up from a calendar on this computer to an account calendar, even one in use', () => {
    let db = start()
    addEvent(db, LOCAL, 'Dentist')
    addCalDavAccount(db)

    db = start()

    expect(exists(db, LOCAL)).toBe(true)
    expect(defaults(db)).toEqual([DAV_WORK])
  })

  it("stays with the first account's calendar when a second account's primary calendar arrives marked default", () => {
    let db = start()
    addCalDavAccount(db)
    db = start()
    expect(defaults(db)).toEqual([DAV_WORK])

    // Google marks its primary calendar default when it first syncs it.
    addAccount(db, 'google-alex', 'google', '2026-11-05T00:00:00.000Z')
    addCalendar(db, 'alex@example.com', 'google-alex', 'alex@example.com', { isDefault: true })
    db = start()

    expect(defaults(db)).toEqual([DAV_WORK])
  })

  it("is taken over by the new account's primary calendar when it was on this computer", () => {
    let db = start()
    addAccount(db, 'google-alex', 'google', '2026-11-05T00:00:00.000Z')
    addCalendar(db, 'alex@example.com', 'google-alex', 'alex@example.com', { isDefault: true })
    addCalendar(db, 'birthdays@example.com', 'google-alex', 'Birthdays')
    db = start()

    expect(defaults(db)).toEqual(['alex@example.com'])
  })

  it('moves off a calendar on this computer when a sync brings in an account calendar', async () => {
    const db = start()
    addCalDavAccount(db)
    expect(defaults(db)).toEqual([LOCAL])

    // No credentials are stored, so the account's sync fails; the round still settles.
    const worker = new SyncWorker(db, () => ({ google: null, microsoft: null }))
    await worker.triggerSync()

    expect(defaults(db)).toEqual([DAV_WORK])
  })

  it('moves on when the default is removed, to the first shown account calendar in the sidebar', () => {
    const db = start()
    registerCalendarIpcHandlers()
    // Not settled yet: as the account's first sync left it, before the round finished.
    addCalDavAccount(db)

    expect(call(IPC_CHANNELS.CALENDAR.DELETE, LOCAL)).toBe(true)

    expect(exists(db, LOCAL)).toBe(false)
    // Family comes first by name but is hidden; the shared one is read-only.
    expect(defaults(db)).toEqual([DAV_WORK])
  })
})

