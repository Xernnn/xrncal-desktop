import { describe, it, expect, afterEach } from 'vitest'
import { DateTime } from 'luxon'
import { halfHourAt } from '../src/renderer/src/hooks/use-calendar-context-menu'

/**
 * "New event here" on the hour grid starts at the row right-clicked. The grid
 * is a clock face (clock-minutes.ts); counting elapsed minutes from midnight
 * put the new event an hour off on the two days a zone changes offset.
 */
describe('right-click "New event here" on the hour grid', () => {
  // TZ is what moves luxon's 'local'; this project's tsconfig has no Node types.
  const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env
  const previous = env.TZ
  afterEach(() => {
    if (previous === undefined) delete env.TZ
    else env.TZ = previous
  })

  const clock = (day: string, minutes: number): string[] => {
    const { start, end } = halfHourAt(DateTime.fromISO(day), minutes)
    return [start.toFormat('HH:mm'), end.toFormat('HH:mm')]
  }

  it('starts on the 17:00 row on the day Sydney springs forward', () => {
    env.TZ = 'Australia/Sydney' // 02:00 became 03:00 on 4 October 2026
    expect(clock('2026-10-04', 17 * 60 + 10)).toEqual(['17:00', '18:00'])
  })

  it('starts on the 17:30 row on the day Sydney falls back', () => {
    env.TZ = 'Australia/Sydney' // 03:00 became 02:00 on 5 April 2026
    expect(clock('2026-04-05', 17 * 60 + 40)).toEqual(['17:30', '18:30'])
  })

  it('is the row under the pointer on an ordinary day, and never past 23:30', () => {
    env.TZ = 'Asia/Ho_Chi_Minh'
    expect(clock('2026-11-11', 9 * 60 + 29)).toEqual(['09:00', '10:00'])
    expect(clock('2026-11-11', 24 * 60)).toEqual(['23:30', '00:30'])
  })
})
