import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { addCalDavAccount, addEvent, defaults, exists, tempProfile, DAV_FAMILY, DAV_SHARED, DAV_WORK, LOCAL } from './personal-calendar-fixtures'

/**
 * A calendar on this computer can be removed from the accounts dialog, the
 * default one too; one that holds events is asked about first, as removing an
 * account is: its events move into another calendar - uploaded there when it
 * is an account's - or go with it.
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

const { EventsRepo } = await import('../src/main/db/repos/events-repo')
const { registerCalendarIpcHandlers } = await import('../src/main/ipc/calendar-ipc')
const { IPC_CHANNELS } = await import('../src/shared/ipc-contract')

let profile: ReturnType<typeof tempProfile>
const start = () => profile.start()

beforeEach(() => {
  handlers.clear()
  profile = tempProfile()
})

afterEach(() => profile.remove())

describe('removing a calendar on this computer', () => {
  it('keeps its events by moving them into the calendar picked, to be uploaded there with their changed dates', () => {
    const db = start()
    registerCalendarIpcHandlers()
    addCalDavAccount(db)
    const repo = new EventsRepo(db)
    const series = repo.createEvent({
      calendarId: LOCAL,
      title: 'Piano lesson',
      dtStartUtc: '2026-12-02T09:00:00.000Z',
      dtEndUtc: '2026-12-02T10:00:00.000Z',
      rrule: 'FREQ=WEEKLY'
    })
    repo.upsertException({ masterEventId: series.id, originalStartUtc: '2026-12-09T09:00:00.000Z', isCancelled: true })
    const single = addEvent(db, LOCAL, 'Dentist')
    addEvent(db, LOCAL, 'Deleted already', true)
    db.prepare('UPDATE event_exceptions SET dirty = 0').run()

    expect(call(IPC_CHANNELS.CALENDAR.DELETE, LOCAL, { moveEventsTo: DAV_WORK })).toBe(true)

    expect(exists(db, LOCAL)).toBe(false)
    const moved = db
      .prepare('SELECT id, calendar_id, dirty, etag, provider_event_id FROM events ORDER BY title')
      .all<{ id: string }>()
    expect(moved).toEqual([
      { id: single, calendar_id: DAV_WORK, dirty: 1, etag: null, provider_event_id: null },
      { id: series.id, calendar_id: DAV_WORK, dirty: 1, etag: null, provider_event_id: null }
    ])
    expect(db.prepare('SELECT dirty FROM event_exceptions').all()).toEqual([{ dirty: 1 }])
    expect(defaults(db)).toEqual([DAV_WORK])
  })

  it('counts the events there are to ask about: not deleted ones, and a lunar anniversary once', () => {
    const db = start()
    registerCalendarIpcHandlers()
    const repo = new EventsRepo(db)
    const anniversary = repo.createEvent({
      calendarId: LOCAL,
      title: 'Giỗ',
      dtStartUtc: '2026-12-02T00:00:00.000Z',
      dtEndUtc: '2026-12-02T23:59:59.000Z',
      allDay: true,
      lunarRule: { day: 10, month: 3, leap: false }
    })
    repo.materializeLunarEvent({ masterEventId: anniversary.id, targetCalendarId: LOCAL, throughYear: 2029 })
    addEvent(db, LOCAL, 'Dentist')
    addEvent(db, LOCAL, 'Deleted already', true)

    expect(db.prepare('SELECT COUNT(*) AS c FROM events WHERE is_deleted = 0').get<{ c: number }>()!.c).toBeGreaterThan(2)
    expect(call(IPC_CHANNELS.CALENDAR.EVENT_COUNT, LOCAL)).toBe(2)
  })

  it('deletes its events with it when not asked to move them', () => {
    const db = start()
    registerCalendarIpcHandlers()
    addCalDavAccount(db)
    addEvent(db, LOCAL, 'Dentist')

    call(IPC_CHANNELS.CALENDAR.DELETE, LOCAL)

    expect(db.prepare('SELECT COUNT(*) AS c FROM events').get()).toEqual({ c: 0 })
  })

  it('refuses a target that cannot be written to, before anything is removed', () => {
    const db = start()
    registerCalendarIpcHandlers()
    addCalDavAccount(db)
    addEvent(db, LOCAL, 'Dentist')

    expect(() => call(IPC_CHANNELS.CALENDAR.DELETE, LOCAL, { moveEventsTo: DAV_SHARED })).toThrow(/written to/)
    expect(() => call(IPC_CHANNELS.CALENDAR.DELETE, LOCAL, { moveEventsTo: 'no-such-calendar' })).toThrow(/written to/)

    expect(exists(db, LOCAL)).toBe(true)
    expect(db.prepare('SELECT calendar_id FROM events').all()).toEqual([{ calendar_id: LOCAL }])
  })

  it("will not hand an account calendar's events to another calendar", () => {
    const db = start()
    registerCalendarIpcHandlers()
    addCalDavAccount(db)
    addEvent(db, DAV_FAMILY, 'Birthday')

    expect(() => call(IPC_CHANNELS.CALENDAR.DELETE, DAV_FAMILY, { moveEventsTo: LOCAL })).toThrow(/server/)
    expect(exists(db, DAV_FAMILY)).toBe(true)
  })
})
