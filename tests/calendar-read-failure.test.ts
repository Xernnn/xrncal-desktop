import { describe, it, expect, vi, afterEach } from 'vitest'
import { occurrencesAfterRead, readCalendarData } from '../src/renderer/src/hooks/use-calendar-data'
import type { ExpandedOccurrence } from '../src/shared/event-model'

/**
 * A read of the calendars or their events that failed was swallowed: the
 * first load showed an empty grid that looked like a week with no events, and
 * after paging the previous range's events stayed drawn on the new one.
 */
describe('a failed calendar read', () => {
  afterEach(() => vi.unstubAllGlobals())

  const occ = { id: 'o1', eventId: 'e1', title: 'Planning', startUtc: '2026-11-16T09:00:00.000Z' } as ExpandedOccurrence

  it('is reported as failed, with nothing read', async () => {
    vi.stubGlobal('window', {
      xrncal: {
        calendars: { list: () => Promise.reject(new Error('database is locked')) },
        events: { queryRange: vi.fn(), listConflicts: () => Promise.resolve([]) },
        auth: { listAccounts: () => Promise.resolve([]) }
      }
    })
    const found = await readCalendarData('2026-11-16T00:00:00.000Z', '2026-11-23T00:00:00.000Z')
    expect(found.failed).toBe(true)
    expect(found.occurrences).toBeUndefined()
    expect(found.conflicts).toEqual([])
  })

  it("does not leave the last range's events on a new range", () => {
    const shown = { occurrences: [occ], rangeKey: 'last-week' }
    expect(occurrencesAfterRead({ failed: true }, shown, 'this-week')).toEqual([])
  })

  it('keeps the events on screen when the same range fails to read again', () => {
    const shown = { occurrences: [occ], rangeKey: 'this-week' }
    expect(occurrencesAfterRead({ failed: true }, shown, 'this-week')).toBe(shown.occurrences)
  })

  it('shows what a read found', () => {
    const found = { occurrences: [] as ExpandedOccurrence[] }
    expect(occurrencesAfterRead(found, { occurrences: [occ], rangeKey: 'x' }, 'x')).toBe(found.occurrences)
  })
})
