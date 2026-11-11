import { describe, it, expect } from 'vitest'
import React from 'react'
import { renderToString } from 'react-dom/server'
import { DateTime } from 'luxon'
import MonthView from '../src/renderer/src/views/MonthView'
import YearView from '../src/renderer/src/views/YearView'
import MiniCalendar from '../src/renderer/src/components/MiniCalendar'
import type { ExpandedOccurrence } from '../src/shared/event-model'

/**
 * Month, Year and the mini calendar file an occurrence under each day it
 * covers, and that walk stopped after 366 days from the event's start: a
 * three-year secondment that began in 2024 was not drawn at all in 2026.
 */
describe('an event longer than a year is drawn on the days on screen', () => {
  const secondment: ExpandedOccurrence = {
    id: 'e_2024-01-01',
    eventId: 'e',
    calendarId: 'c',
    title: 'Secondment',
    startUtc: '2024-01-01T00:00:00.000Z',
    endUtc: '2027-12-31T23:59:59.999Z',
    tzid: 'UTC',
    allDay: true,
    color: '#123456',
    isRecurring: false,
    isException: false,
    originalStartUtc: '2024-01-01T00:00:00.000Z'
  }
  const anchorDate = DateTime.fromISO('2026-06-10')
  const count = (html: string, text: string): number => html.split(text).length - 1

  it('in Month view', () => {
    const html = renderToString(
      React.createElement(MonthView, { anchorDate, occurrences: [secondment], showLunar: false, showWeekNumbers: false })
    )
    expect(count(html, 'Secondment')).toBeGreaterThan(0)
  })

  it('in Year view, on every day of the year', () => {
    const html = renderToString(
      React.createElement(YearView, {
        anchorDate,
        occurrences: [secondment],
        showLunar: false,
        onSelectMonth: () => {},
        onSelectDate: () => {}
      })
    )
    // Today's cell is drawn in its own colour instead.
    expect(count(html, '#12345633')).toBeGreaterThanOrEqual(364)
  })

  it('in the mini calendar', () => {
    const html = renderToString(
      React.createElement(MiniCalendar, {
        anchorDate,
        occurrences: [secondment],
        onSelectDate: () => {},
        onPrevMonth: () => {},
        onNextMonth: () => {}
      })
    )
    expect(count(html, '#123456')).toBeGreaterThanOrEqual(42)
  })
})
