import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { DateTime } from 'luxon'
import type { ExpandedOccurrence } from '../src/shared/event-model'

/**
 * The mini window drew every event's dot indigo: its upcoming list came from
 * the repo as it is stored, where an event that has no colour of its own has
 * none at all, and MiniApp fell back to #6366f1. The main window's views give
 * such an event its calendar's colour, so the mini window's list must too.
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
const { registerMiniIpcHandlers } = await import('../src/main/mini-window')
const { IPC_CHANNELS } = await import('../src/shared/ipc-contract')

const hoursFromNow = (hours: number): string => DateTime.utc().plus({ hours }).toISO()!

describe('the mini window’s upcoming events', () => {
  let eventsRepo: InstanceType<typeof EventsRepo>
  let calendarsRepo: InstanceType<typeof CalendarsRepo>

  beforeEach(() => {
    const db = initDatabase(':memory:')
    eventsRepo = new EventsRepo(db)
    calendarsRepo = new CalendarsRepo(db)
    registerMiniIpcHandlers(() => undefined)
  })

  afterEach(() => {
    closeDatabase()
  })

  function add(calendarId: string, title: string, startsIn: number, color?: string) {
    eventsRepo.createEvent({
      calendarId,
      title,
      dtStartUtc: hoursFromNow(startsIn),
      dtEndUtc: hoursFromNow(startsIn + 1),
      color
    })
  }

  async function upcoming(): Promise<ExpandedOccurrence[]> {
    const read = handlers.get(IPC_CHANNELS.MINI.GET_UPCOMING)!
    const res = (await read({}, 15)) as { occurrences: ExpandedOccurrence[] }
    return res.occurrences
  }

  it('gives an event without a colour of its own its calendar’s colour', async () => {
    const work = calendarsRepo.createCalendar({ name: 'Work', color: '#0b8043' })
    const family = calendarsRepo.createCalendar({ name: 'Family', color: '#f4511e' })
    add(work.id, 'Design review', 2)
    add(family.id, 'Swimming lesson', 4)

    const colors = Object.fromEntries((await upcoming()).map((o) => [o.title, o.color]))
    expect(colors).toEqual({ 'Design review': '#0b8043', 'Swimming lesson': '#f4511e' })
  })

  it('keeps the colour an event has of its own over its calendar’s', async () => {
    const work = calendarsRepo.createCalendar({ name: 'Work', color: '#0b8043' })
    add(work.id, 'Release day', 3, '#d50000')

    const [release] = await upcoming()
    expect(release.color).toBe('#d50000')
  })

  it('leaves out calendars that are hidden', async () => {
    const work = calendarsRepo.createCalendar({ name: 'Work', color: '#0b8043' })
    const hidden = calendarsRepo.createCalendar({ name: 'Archive', color: '#616161', isVisible: false })
    add(work.id, 'Design review', 2)
    add(hidden.id, 'Old plan', 3)

    expect((await upcoming()).map((o) => o.title)).toEqual(['Design review'])
  })
})
