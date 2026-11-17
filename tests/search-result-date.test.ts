import { describe, it, expect, afterEach } from 'vitest'
import { resultDate, resultWhen } from '../src/renderer/src/components/SearchPaletteModal'
import type { CalendarEvent, EventSearchResult } from '../src/shared/event-model'

/**
 * An all-day event is a floating date parked at UTC midnight. Search showed
 * it read in this computer's zone, which west of GMT is the evening before:
 * a birthday on the 14th was listed on the 13th.
 */
describe('the date a search result shows', () => {
  // TZ is what moves luxon's 'local'; this project's tsconfig has no Node types.
  const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env
  const previous = env.TZ
  afterEach(() => {
    if (previous === undefined) delete env.TZ
    else env.TZ = previous
  })

  const event = (allDay: boolean, dtStartUtc: string, dtEndUtc: string): CalendarEvent =>
    ({ id: 'e', calendarId: 'c', title: 'Birthday', allDay, dtStartUtc, dtEndUtc, tzid: 'UTC' }) as CalendarEvent

  for (const zone of ['America/New_York', 'Asia/Ho_Chi_Minh', 'Pacific/Kiritimati', 'UTC']) {
    it(`is an all-day event's own date in ${zone}`, () => {
      env.TZ = zone
      expect(resultWhen(event(true, '2026-09-14T00:00:00.000Z', '2026-09-14T23:59:59.999Z'), '24h', 'all day')).toBe(
        '14/09/2026 (all day)'
      )
    })
  }

  it("is a timed event's date and times on this computer's clock", () => {
    env.TZ = 'America/New_York'
    expect(resultWhen(event(false, '2026-09-14T02:00:00.000Z', '2026-09-14T03:00:00.000Z'), '24h', 'all day')).toBe(
      '13/09/2026 22:00 – 23:00'
    )
  })

  // A series found by search stands for its date nearest to now (EventsRepo.searchEvents);
  // its own start is its first-ever date, years back.
  it("is a series' date nearest to now, and that is the day it goes to", () => {
    env.TZ = 'UTC'
    const series: EventSearchResult = {
      ...event(false, '2023-01-02T09:00:00.000Z', '2023-01-02T09:15:00.000Z'),
      rrule: 'FREQ=WEEKLY;BYDAY=MO',
      occurrence: {
        id: 'e_2026-11-16T09:00:00.000Z',
        eventId: 'e',
        calendarId: 'c',
        title: 'Standup',
        startUtc: '2026-11-16T09:00:00.000Z',
        endUtc: '2026-11-16T09:15:00.000Z',
        tzid: 'UTC',
        allDay: false,
        isRecurring: true,
        isException: false,
        originalStartUtc: '2026-11-16T09:00:00.000Z'
      }
    }
    expect(resultWhen(series, '24h', 'all day')).toBe('16/11/2026 09:00 – 09:15')
    expect(resultDate(series)).toBe('2026-11-16')
  })
})
