import { describe, it, expect } from 'vitest'
import type { Calendar } from '../src/shared/event-model'
import { defaultCalendarFor } from '../src/renderer/src/lib/new-event'
import { msUntilNextMinute } from '../src/renderer/src/lib/clock'

function cal(id: string): Calendar {
  return {
    id,
    accountId: 'acc',
    name: id,
    color: '#529cca',
    isVisible: true,
    isReadOnly: false,
    isDefault: false,
    createdAt: '',
    updatedAt: ''
  }
}

describe('the calendar a new event goes into', () => {
  it('prefers the default calendar when it is shown and writable', () => {
    const calendars = [cal('a'), { ...cal('home'), isDefault: true }]
    expect(defaultCalendarFor(calendars)?.id).toBe('home')
  })

  it('skips read-only and hidden calendars while there is anything else', () => {
    const calendars = [
      { ...cal('holidays'), isReadOnly: true },
      { ...cal('home'), isDefault: true, isVisible: false },
      cal('work')
    ]
    expect(defaultCalendarFor(calendars)?.id).toBe('work')
    expect(defaultCalendarFor([{ ...cal('only'), isVisible: false }])?.id).toBe('only')
    expect(defaultCalendarFor([])).toBeUndefined()
  })
})

describe('the minute clock', () => {
  it('aims just past the start of the next minute', () => {
    expect(msUntilNextMinute(Date.UTC(2026, 9, 20, 23, 59, 30))).toBe(30_050)
    expect(msUntilNextMinute(Date.UTC(2026, 9, 20, 23, 59, 0))).toBe(60_050)
  })
})
