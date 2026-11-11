import { describe, it, expect, afterEach } from 'vitest'
import { resultWhen } from '../src/renderer/src/components/SearchPaletteModal'
import type { CalendarEvent } from '../src/shared/event-model'

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
})
