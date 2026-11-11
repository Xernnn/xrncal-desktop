import { describe, it, expect } from 'vitest'
import { DateTime } from 'luxon'
import { EVENT_LENGTH_OPTIONS, newEventEnd, newEventMinutes } from '../src/shared/event-length'
import { DEFAULT_APP_SETTINGS } from '../src/shared/settings-contract'

/**
 * The length of a new event that was started without a range of its own (a
 * click, "New event here", Create, N). It was an hour, written out in each of
 * those places; it is a setting now.
 */
describe('the length of a new event', () => {
  it('is an hour until another length is chosen', () => {
    expect(DEFAULT_APP_SETTINGS.defaultEventMinutes).toBe(60)
    expect(EVENT_LENGTH_OPTIONS).toEqual([15, 30, 45, 60, 90, 120])
    expect(EVENT_LENGTH_OPTIONS).toContain(DEFAULT_APP_SETTINGS.defaultEventMinutes)
  })

  it('keeps each length that Settings offers', () => {
    for (const option of EVENT_LENGTH_OPTIONS) expect(newEventMinutes(option)).toBe(option)
  })

  it('falls back to an hour for anything else that was stored', () => {
    // 0 or a negative length would open the editor on a range it cannot save.
    for (const stored of [0, -30, 20, 600, NaN, '30', null, undefined, true]) {
      expect(newEventMinutes(stored)).toBe(60)
    }
  })

  it('ends the event that long after its start', () => {
    const start = DateTime.fromISO('2026-11-12T09:00:00', { zone: 'Asia/Ho_Chi_Minh' })
    const clock = (setting: unknown): string => newEventEnd(start, setting).toFormat('yyyy-MM-dd HH:mm')
    expect(clock(15)).toBe('2026-11-12 09:15')
    expect(clock(45)).toBe('2026-11-12 09:45')
    expect(clock(60)).toBe('2026-11-12 10:00')
    expect(clock(90)).toBe('2026-11-12 10:30')
    expect(clock(120)).toBe('2026-11-12 11:00')
    expect(clock('nonsense')).toBe('2026-11-12 10:00')
  })

  it('runs past midnight onto the next day, and always ends after it starts', () => {
    const late = DateTime.fromISO('2026-11-12T23:30:00', { zone: 'Asia/Ho_Chi_Minh' })
    expect(newEventEnd(late, 60).toFormat('yyyy-MM-dd HH:mm')).toBe('2026-11-13 00:30')
    expect(newEventEnd(late, 120).toFormat('yyyy-MM-dd HH:mm')).toBe('2026-11-13 01:30')
    expect(newEventEnd(late, 15).toFormat('yyyy-MM-dd HH:mm')).toBe('2026-11-12 23:45')
    for (const stored of [...EVENT_LENGTH_OPTIONS, 0, -5, 'x']) {
      expect(newEventEnd(late, stored) > late).toBe(true)
    }
  })
})
