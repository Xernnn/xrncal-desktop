import { describe, it, expect } from 'vitest'
import { parseIcsContent } from '../src/main/ics/parse-ics'

/**
 * A VEVENT with no DTSTART, which RFC 5545 requires, was read as starting
 * "now": an import or a feed put it at the moment it was read, and every
 * refresh moved it again.
 */

const calendar = (...events: string[][]): string =>
  ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Test//EN', ...events.flat(), 'END:VCALENDAR'].join('\r\n')

describe('a VEVENT without a DTSTART', () => {
  it('is left out, and counted as one that could not be read', () => {
    const parsed = parseIcsContent(
      calendar(
        ['BEGIN:VEVENT', 'UID:no-start@example.com', 'SUMMARY:Whenever', 'DTEND:20260818T110000Z', 'END:VEVENT'],
        ['BEGIN:VEVENT', 'UID:dinner@example.com', 'SUMMARY:Dinner', 'DTSTART:20260818T100000Z', 'DTEND:20260818T110000Z', 'END:VEVENT']
      ),
      'cal'
    )

    expect(parsed.events.map((e) => e.title)).toEqual(['Dinner'])
    expect(parsed.skipped).toBe(1)
  })

  it('stays at the date it stands for when it is an override, so a cancelled date stays cancelled', () => {
    const parsed = parseIcsContent(
      calendar(
        [
          'BEGIN:VEVENT',
          'UID:weekly@example.com',
          'SUMMARY:Weekly',
          'DTSTART:20260818T100000Z',
          'DTEND:20260818T110000Z',
          'RRULE:FREQ=WEEKLY',
          'END:VEVENT'
        ],
        ['BEGIN:VEVENT', 'UID:weekly@example.com', 'RECURRENCE-ID:20260825T100000Z', 'STATUS:CANCELLED', 'END:VEVENT']
      ),
      'cal'
    )

    expect(parsed.skipped).toBe(0)
    expect(parsed.exceptions).toHaveLength(1)
    expect(parsed.exceptions[0]).toMatchObject({ originalStartUtc: '2026-08-25T10:00:00.000Z', isCancelled: true })
    expect(parsed.exceptions[0].dtStartUtc).toBeUndefined()
    expect(parsed.exceptions[0].dtEndUtc).toBeUndefined()
  })
})
