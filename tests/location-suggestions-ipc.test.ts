import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { DateTime } from 'luxon'

/**
 * The places the Location field offers come from the main process: the rows
 * the repo reads (which events count as "a place used before"), and the
 * handler that checks what the renderer asked and ranks them.
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

const { initDatabase, closeDatabase } = await import('../src/main/db/database')
const { EventsRepo } = await import('../src/main/db/repos/events-repo')
const { CalendarsRepo } = await import('../src/main/db/repos/calendars-repo')
const { registerCalendarIpcHandlers } = await import('../src/main/ipc/calendar-ipc')
const { IPC_CHANNELS } = await import('../src/shared/ipc-contract')
const { checkedLocationRequest } = await import('../src/shared/location-suggestions')

const NOW = DateTime.utc()
const daysFromNow = (days: number): string => NOW.plus({ days }).toISO()!

describe('location suggestions, from the database to the renderer', () => {
  let db: ReturnType<typeof initDatabase>
  let eventsRepo: InstanceType<typeof EventsRepo>
  let calendarsRepo: InstanceType<typeof CalendarsRepo>
  let calendarId: string

  beforeEach(() => {
    db = initDatabase(':memory:')
    eventsRepo = new EventsRepo(db)
    calendarsRepo = new CalendarsRepo(db)
    calendarId = calendarsRepo.listCalendars()[0].id
    registerCalendarIpcHandlers()
  })

  afterEach(() => {
    closeDatabase()
  })

  function add(location: string | undefined, startUtc: string, extra: Record<string, unknown> = {}) {
    return eventsRepo.createEvent({
      calendarId,
      title: 'Sample',
      location,
      dtStartUtc: startUtc,
      dtEndUtc: DateTime.fromISO(startUtc, { zone: 'utc' }).plus({ hours: 1 }).toISO()!,
      ...extra
    })
  }

  const samples = (limit?: number) => eventsRepo.listLocationSamples(daysFromNow(-730), daysFromNow(90), limit)
  const places = () => samples().map((s) => s.location).sort()
  const suggest = (options: unknown): string[] =>
    (handlers.get(IPC_CHANNELS.EVENT.SUGGEST_LOCATIONS)!({}, options) as { location: string }[]).map((s) => s.location)

  describe('EventsRepo.listLocationSamples', () => {
    it('returns each event that has a place, flattened to what ranking needs', () => {
      add('Harbour Library', daysFromNow(-3))
      add(undefined, daysFromNow(-2))
      add('   ', daysFromNow(-1))

      expect(samples()).toEqual([{ location: 'Harbour Library', startUtc: daysFromNow(-3), rrule: null }])
    })

    it('keeps a series whose start is far outside the window, and drops an old one-off', () => {
      add('Pool Lane 4', '2019-01-07T09:00:00.000Z', { rrule: 'FREQ=WEEKLY;BYDAY=MO' })
      add('Old Hall', '2019-01-08T09:00:00.000Z')

      expect(places()).toEqual(['Pool Lane 4'])
    })

    it('drops events further ahead than the forward window', () => {
      add('Soon Street', daysFromNow(30))
      add('Next Year Road', daysFromNow(300))

      expect(places()).toEqual(['Soon Street'])
    })

    it('excludes deleted events', () => {
      const evt = add('Cancelled Corner', daysFromNow(-1))
      eventsRepo.deleteEvent(evt.id)

      expect(places()).toEqual([])
    })

    it('excludes read-only calendars, whose places the user never typed', () => {
      const feed = calendarsRepo.createCalendar({ name: 'Fixtures', color: '#888888' })
      eventsRepo.createEvent({
        calendarId: feed.id,
        title: 'Away match',
        location: 'Riverside Stadium',
        dtStartUtc: daysFromNow(-5),
        dtEndUtc: daysFromNow(-5)
      })
      db.prepare('UPDATE calendars SET is_read_only = 1 WHERE id = ?').run(feed.id)
      add('Home Ground', daysFromNow(-4))

      expect(places()).toEqual(['Home Ground'])
    })

    it('honours the row cap, newest first', () => {
      for (let i = 1; i <= 5; i++) add(`Room ${i}`, daysFromNow(-i))

      expect(samples(2).map((s) => s.location)).toEqual(['Room 1', 'Room 2'])
    })
  })

  describe('the suggest-locations handler', () => {
    it('ranks what the repo holds against what was typed, accents ignored', () => {
      add('Cà phê Sáng', daysFromNow(-2))
      add('Cà phê Sáng', daysFromNow(-9))
      add('Cà phê Chiều', daysFromNow(-200))
      add('Harbour Library', daysFromNow(-1))

      expect(suggest({ query: 'ca phe' })).toEqual(['Cà phê Sáng', 'Cà phê Chiều'])
      expect(suggest({ query: 'ca phe', limit: 1 })).toEqual(['Cà phê Sáng'])
      expect(suggest({ query: 'zzz' })).toEqual([])
    })

    it('offers nothing for an empty field', () => {
      add('Harbour Library', daysFromNow(-1))

      expect(suggest({ query: '' })).toEqual([])
      expect(suggest({ query: '   ' })).toEqual([])
    })

    it('refuses anything that is not a query', () => {
      for (const bad of [undefined, null, 'library', 7, {}, { query: 7 }, { query: null }, { query: ['a'] }]) {
        expect(() => suggest(bad)).toThrow(/Not a location query/)
      }
    })
  })

  describe('checkedLocationRequest', () => {
    it('keeps the text and a sane limit', () => {
      expect(checkedLocationRequest({ query: 'lib' })).toEqual({ query: 'lib', limit: 5 })
      expect(checkedLocationRequest({ query: 'lib', limit: 3 })).toEqual({ query: 'lib', limit: 3 })
      expect(checkedLocationRequest({ query: 'lib', limit: 3.9 })).toEqual({ query: 'lib', limit: 3 })
    })

    it('bounds what a caller may ask for', () => {
      expect(checkedLocationRequest({ query: 'lib', limit: 5000 }).limit).toBe(20)
      expect(checkedLocationRequest({ query: 'lib', limit: 0 }).limit).toBe(1)
      expect(checkedLocationRequest({ query: 'lib', limit: -4 }).limit).toBe(1)
      for (const limit of [NaN, Infinity, '3', null, {}]) {
        expect(checkedLocationRequest({ query: 'lib', limit }).limit).toBe(5)
      }
      expect(checkedLocationRequest({ query: 'x'.repeat(5000) }).query).toHaveLength(200)
    })
  })
})
