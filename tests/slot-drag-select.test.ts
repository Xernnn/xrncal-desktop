import { describe, it, expect, afterEach } from 'vitest'
import { DateTime } from 'luxon'
import { slotRange } from '../src/renderer/src/dnd/use-slot-drag-select'

/**
 * A click on an empty slot of the hour grid makes an event of the length
 * chosen in Settings; a drag makes one of the range dragged. The click's hour
 * used to be written into the gesture.
 */
describe('what a click or drag on the hour grid selects', () => {
  // TZ is what moves luxon's 'local'; this project's tsconfig has no Node types.
  const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env
  const previous = env.TZ
  afterEach(() => {
    if (previous === undefined) delete env.TZ
    else env.TZ = previous
  })

  const range = (day: string, lo: number, hi: number, length: number): string[] => {
    const { start, end } = slotRange(DateTime.fromISO(day), lo, hi, length)
    return [start.toFormat('yyyy-MM-dd HH:mm'), end.toFormat('yyyy-MM-dd HH:mm')]
  }

  it('gives a click the default length', () => {
    env.TZ = 'Asia/Ho_Chi_Minh'
    expect(range('2026-11-12', 9 * 60, 9 * 60, 60)).toEqual(['2026-11-12 09:00', '2026-11-12 10:00'])
    expect(range('2026-11-12', 9 * 60, 9 * 60, 30)).toEqual(['2026-11-12 09:00', '2026-11-12 09:30'])
    expect(range('2026-11-12', 9 * 60 + 15, 9 * 60 + 15, 90)).toEqual(['2026-11-12 09:15', '2026-11-12 10:45'])
  })

  it('keeps a dragged range whatever the default length is', () => {
    env.TZ = 'Asia/Ho_Chi_Minh'
    for (const length of [15, 30, 60, 120]) {
      expect(range('2026-11-12', 9 * 60, 9 * 60 + 15, length)).toEqual(['2026-11-12 09:00', '2026-11-12 09:15'])
      expect(range('2026-11-12', 13 * 60, 17 * 60 + 30, length)).toEqual(['2026-11-12 13:00', '2026-11-12 17:30'])
    }
    // Dragged to the foot of the column: midnight, the start of the next day.
    expect(range('2026-11-12', 22 * 60, 24 * 60, 30)).toEqual(['2026-11-12 22:00', '2026-11-13 00:00'])
  })

  it('ends a late click on the next day, after its start', () => {
    env.TZ = 'Asia/Ho_Chi_Minh'
    expect(range('2026-11-12', 23 * 60 + 45, 23 * 60 + 45, 60)).toEqual(['2026-11-12 23:45', '2026-11-13 00:45'])
    expect(range('2026-11-12', 23 * 60, 23 * 60, 120)).toEqual(['2026-11-12 23:00', '2026-11-13 01:00'])
    expect(range('2026-11-12', 23 * 60 + 45, 23 * 60 + 45, 15)).toEqual(['2026-11-12 23:45', '2026-11-13 00:00'])
  })

  it('starts on the row clicked on a day the clocks change', () => {
    env.TZ = 'Australia/Sydney' // 02:00 became 03:00 on 4 October 2026
    expect(range('2026-10-04', 17 * 60, 17 * 60, 45)).toEqual(['2026-10-04 17:00', '2026-10-04 17:45'])
  })
})
