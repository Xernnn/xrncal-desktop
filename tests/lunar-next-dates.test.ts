import { describe, it, expect, vi, afterEach } from 'vitest'
import React from 'react'
import { renderToString } from 'react-dom/server'
import EventEditorDialog from '../src/renderer/src/editor/EventEditorDialog'
import { nextLunarOccurrences } from '../src/shared/lunar-vietnam'
import type { Calendar, CalendarEvent } from '../src/shared/event-model'
import i18n from '../src/renderer/src/i18n'
import { LunarLabel } from '../src/renderer/src/components/LunarLabel'
import { chineseLunarLabel, lunarRuleForDate, resolveCalendarLunarOccurrence } from '../src/shared/lunar-calendar'

/**
 * A lunar anniversary's "Next:" line in the editor listed this year's date
 * and the three after it, whether or not this year's had already gone by: on
 * 19 November 2026 the 3rd day of the 2nd lunar month read "Next: Sat, 21 Mar
 * 2026 · …". It lists the dates still to come, from today.
 */

// 3/2 âm lịch: 21 Mar 2026, 10 Mar 2027, 27 Feb 2028, 17 Mar 2029, 6 Mar 2030.
const GIO = { day: 3, month: 2, leap: false }

describe('nextLunarOccurrences', () => {
  it('leaves out this year’s date once it has gone by', () => {
    expect(nextLunarOccurrences(GIO, '2026-11-19', 4)).toEqual([
      '2027-03-10',
      '2028-02-27',
      '2029-03-17',
      '2030-03-06'
    ])
  })

  it('starts with this year’s date while it is still to come', () => {
    expect(nextLunarOccurrences(GIO, '2026-01-05', 2)).toEqual(['2026-03-21', '2027-03-10'])
  })

  it('counts the day itself as still to come', () => {
    expect(nextLunarOccurrences(GIO, '2026-03-21', 1)).toEqual(['2026-03-21'])
  })
})

describe('the lunar anniversary editor’s "Next:" line', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  const calendar: Calendar = {
    id: 'family',
    name: 'Family',
    color: '#e5487a',
    isVisible: true,
    isReadOnly: false,
    accountId: 'local',
    isDefault: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  }

  const anniversary: CalendarEvent = {
    id: 'evt_gio',
    calendarId: 'family',
    uid: 'uid-gio',
    title: 'Giỗ bà ngoại',
    dtStartUtc: '2026-03-21T00:00:00.000Z',
    dtEndUtc: '2026-03-21T23:59:59.999Z',
    tzid: 'Asia/Ho_Chi_Minh',
    allDay: true,
    lunarRule: GIO,
    dirty: false,
    isDeleted: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  }

  it('lists the dates from today on, not a date already past', () => {
    // Midday, so the day is 19 November in any zone the tests run in.
    vi.useFakeTimers({ now: new Date('2026-11-19T12:00:00.000Z'), toFake: ['Date'] })
    const html = renderToString(
      React.createElement(EventEditorDialog, {
        calendars: [calendar],
        data: { event: anniversary },
        onSave: () => {},
        onDelete: () => {},
        onClose: () => {}
      })
    )
    const next = /Next: ([^<]*)</.exec(html)?.[1]
    expect(next).toBe('Wed, 10 Mar 2027 · Sun, 27 Feb 2028 · Sat, 17 Mar 2029 · Wed, 06 Mar 2030')
  })
})

describe('localized lunar calendar', () => {
  it('uses Chinese day names and solar terms in the reference month', () => {
    expect([24, 26, 29, 30].map((day) => chineseLunarLabel(day, 11, 2026).label)).toEqual([
      '十六', '十八', '廿一', '廿二'
    ])
    expect(chineseLunarLabel(1, 12, 2026).label).toBe('廿三')
    expect(chineseLunarLabel(7, 11, 2026).label).toBe('立冬')
    expect(chineseLunarLabel(22, 11, 2026).label).toBe('小雪')
    expect(chineseLunarLabel(9, 11, 2026).label).toBe('十月')
  })

  it('renders the same day in the Chinese and Vietnamese modes', async () => {
    try {
      const label = () => renderToString(React.createElement(LunarLabel, { day: 24, month: 11, year: 2026 }))
      await i18n.changeLanguage('zh-CN')
      expect(label()).toContain('>十六</span>')
      await i18n.changeLanguage('vi')
      expect(label()).toContain('>16</span>')
    } finally {
      await i18n.changeLanguage('en')
    }
  })

  it('keeps a Chinese leap month in a recurrence rule', () => {
    const rule = lunarRuleForDate(25, 7, 2025, true)
    expect(rule).toEqual({ day: 1, month: 6, leap: true, calendar: 'chinese' })
    expect(resolveCalendarLunarOccurrence(rule, 2025)).toBe('2025-07-25')
  })
})
