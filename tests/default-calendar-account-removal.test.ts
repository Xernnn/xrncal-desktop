import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  addAccount,
  addCalDavAccount,
  addCalendar,
  defaults,
  tempProfile,
  DAV_ACCOUNT,
  DAV_FAMILY,
  DAV_SHARED,
  DAV_WORK,
  LOCAL,
  LOCAL_ACCOUNT
} from './personal-calendar-fixtures'

/**
 * Removing an account can take the default calendar with it, or every
 * calendar new events could go into. The default moves on to a calendar that
 * is left, and a profile left with nowhere to write gets a calendar on this
 * computer again - the one case besides a fresh profile where one is made.
 * (Its own file: the account handlers start a sync worker, which stays for
 * the rest of the file.)
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

const { registerCalendarIpcHandlers } = await import('../src/main/ipc/calendar-ipc')
const { registerAuthSyncIpcHandlers, getSyncWorker } = await import('../src/main/ipc/auth-sync-ipc')
const { IPC_CHANNELS } = await import('../src/shared/ipc-contract')

const GOOGLE_ACCOUNT = 'google-alex'
const GOOGLE_PRIMARY = 'alex@example.com'

let profile: ReturnType<typeof tempProfile>

beforeEach(() => {
  handlers.clear()
  profile = tempProfile()
})

afterEach(() => {
  getSyncWorker()?.stop()
  profile.remove()
})

/** Start the app on the profile, with the handlers the accounts dialog calls. */
function start() {
  const db = profile.start()
  registerCalendarIpcHandlers()
  registerAuthSyncIpcHandlers()
  getSyncWorker()?.stop()
  return db
}

const call = (channel: string, ...args: unknown[]) => handlers.get(channel)!({}, ...args)

describe('removing an account', () => {
  it("moves the default to another account's calendar, and keeps it there once every calendar is on this computer", () => {
    let db = start()
    addCalDavAccount(db)
    db = start()
    addAccount(db, GOOGLE_ACCOUNT, 'google', '2026-11-05T00:00:00.000Z')
    addCalendar(db, GOOGLE_PRIMARY, GOOGLE_ACCOUNT, 'alex@example.com', { isDefault: true })
    db = start()
    expect(defaults(db)).toEqual([DAV_WORK])

    expect(call(IPC_CHANNELS.AUTH.DETACH_ACCOUNT, DAV_ACCOUNT)).toMatchObject({ success: true })
    expect(defaults(db)).toEqual([GOOGLE_PRIMARY])

    // Its calendars are on this computer now, as the default still is.
    expect(call(IPC_CHANNELS.AUTH.DETACH_ACCOUNT, GOOGLE_ACCOUNT)).toMatchObject({ success: true })
    expect(defaults(db)).toEqual([GOOGLE_PRIMARY])
  })

  it('leaves a calendar on this computer to write to when the last account goes with every calendar', () => {
    let db = start()
    addCalDavAccount(db)
    call(IPC_CHANNELS.CALENDAR.DELETE, LOCAL)
    db = start()
    expect(defaults(db)).toEqual([DAV_WORK])

    // The accounts dialog's "Remove them from xrncal": detach, then delete each calendar.
    expect(call(IPC_CHANNELS.AUTH.DETACH_ACCOUNT, DAV_ACCOUNT)).toMatchObject({ success: true })
    for (const id of [DAV_WORK, DAV_FAMILY, DAV_SHARED]) call(IPC_CHANNELS.CALENDAR.DELETE, id)

    expect(db.prepare('SELECT name, account_id, is_read_only, is_default FROM calendars').all()).toEqual([
      { name: 'Personal Calendar', account_id: LOCAL_ACCOUNT, is_read_only: 0, is_default: 1 }
    ])
  })
})
