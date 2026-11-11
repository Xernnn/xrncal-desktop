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

  // The hour was written into the menu; it is the length chosen in Settings.
  it('makes the event as long as new events are set to be', () => {
    env.TZ = 'Asia/Ho_Chi_Minh'
    const slot = (minutes: number, length: number): string[] => {
      const { start, end } = halfHourAt(DateTime.fromISO('2026-11-11'), minutes, length)
      return [start.toFormat('MM-dd HH:mm'), end.toFormat('MM-dd HH:mm')]
    }
    expect(slot(9 * 60 + 29, 30)).toEqual(['11-11 09:00', '11-11 09:30'])
    expect(slot(9 * 60 + 40, 15)).toEqual(['11-11 09:30', '11-11 09:45'])
    expect(slot(14 * 60, 90)).toEqual(['11-11 14:00', '11-11 15:30'])
    // Late enough, it ends on the next day, as the hour from 23:30 always did.
    expect(slot(24 * 60, 120)).toEqual(['11-11 23:30', '11-12 01:30'])
    expect(slot(24 * 60, 30)).toEqual(['11-11 23:30', '11-12 00:00'])
  })
})
