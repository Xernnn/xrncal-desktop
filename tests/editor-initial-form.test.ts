import { describe, it, expect } from 'vitest'
import { DateTime } from 'luxon'
import { initialForm, textFieldUpdate } from '../src/renderer/src/editor/EventEditorDialog'
import type { Calendar, CalendarEvent, ExpandedOccurrence } from '../src/shared/event-model'

const calendar = (id: string, extra: Partial<Calendar> = {}): Calendar => ({
  id,
  name: id,
  color: '#4A90E2',
  isVisible: true,
  isReadOnly: false,
  accountId: 'local',
  isDefault: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...extra
})

const event = (extra: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id: 'evt_1',
  calendarId: 'work',
  uid: 'uid-1',
  title: 'Standup',
  dtStartUtc: '2026-03-02T02:00:00.000Z',
  dtEndUtc: '2026-03-02T02:30:00.000Z',
  tzid: 'Asia/Ho_Chi_Minh',
  allDay: false,
  dirty: false,
  isDeleted: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...extra
})

const occurrence = (extra: Partial<ExpandedOccurrence> = {}): ExpandedOccurrence => ({
  id: 'evt_2_2026-03-03T02:00:00.000Z',
  eventId: 'evt_2',
  calendarId: 'work',
  title: 'Review',
  startUtc: '2026-03-03T02:00:00.000Z',
  endUtc: '2026-03-03T03:00:00.000Z',
  tzid: 'Asia/Ho_Chi_Minh',
  allDay: false,
  isRecurring: true,
  isException: false,
  originalStartUtc: '2026-03-03T02:00:00.000Z',
  ...extra
})

describe('initialForm (the editor form for what it was opened on)', () => {
  const calendars = [calendar('work'), calendar('home', { isDefault: true })]

  it('reads a weekly series into the friendly repeat controls', () => {
    const form = initialForm(
      { event: event({ rrule: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;COUNT=6' }) },
      calendars,
      []
    )
    expect(form).toMatchObject({
      title: 'Standup',
      calendarId: 'work',
      startDateStr: '2026-03-02',
      startTimeStr: '09:00',
      endTimeStr: '09:30',
      recurrencePreset: 'weekly',
      recurrenceInterval: 2,
      recurrenceByDay: ['MO', 'WE'],
      recurrenceEnd: 'afterCount',
      recurrenceCount: 6
    })
  })

  // The form used to be filled by an effect that set only the fields its
  // branch knew about, so opening a series' occurrence after a weekly event
  // kept that event's rule and repeat controls.
  it('gives an occurrence none of the repeat settings of anything opened before', () => {
    const form = initialForm({ occurrence: occurrence() }, calendars, [])
    expect(form).toMatchObject({
      recurrencePreset: 'custom',
      customRrule: '',
      recurrenceInterval: 1,
      recurrenceByDay: [],
      recurrenceEnd: 'never',
      attendeesLoaded: false,
      reminders: null
    })
  })

  it('drops the calendar colour the grid painted onto an occurrence', () => {
    const own = initialForm({ occurrence: occurrence({ color: '#ff0000' }) }, calendars, [])
    const painted = initialForm({ occurrence: occurrence({ color: '#4a90e2' }) }, calendars, [])
    expect(own.color).toBe('#ff0000')
    expect(painted.color).toBe('')
  })

  it('opens an all-day event on its stored date, whatever the zone', () => {
    const form = initialForm(
      { event: event({ allDay: true, dtStartUtc: '2026-03-02T00:00:00.000Z', dtEndUtc: '2026-03-02T23:59:59.999Z' }) },
      calendars,
      []
    )
    expect(form.startDateStr).toBe('2026-03-02')
    expect(form.endDateStr).toBe('2026-03-02')
  })

  it('opens a lunar anniversary as all-day and lunar-yearly', () => {
    const form = initialForm(
      { event: event({ lunarRule: { day: 12, month: 8, leap: false }, rrule: undefined }) },
      calendars,
      []
    )
    expect(form.allDay).toBe(true)
    expect(form.recurrencePreset).toBe('lunar-yearly')
    expect(form.customRrule).toBe('')
  })

  it('puts a new event in the slot it was opened on, in the default calendar', () => {
    const start = DateTime.fromISO('2026-03-04T14:00:00')
    const form = initialForm({ initialStart: start, initialEnd: start.plus({ minutes: 45 }) }, calendars, [])
    expect(form).toMatchObject({
      calendarId: 'home',
      title: '',
      startDateStr: '2026-03-04',
      startTimeStr: '14:00',
      endTimeStr: '14:45',
      recurrencePreset: 'none',
      attendeesLoaded: true
    })
  })

  it('keeps a guest list handed over, and marks one not handed over as unread', () => {
    const withGuests = initialForm(
      { event: event({ attendees: [{ email: 'a@example.com', responseStatus: 'accepted' }] }) },
      calendars,
      []
    )
    expect(withGuests.attendeesLoaded).toBe(true)
    expect(withGuests.attendees).toHaveLength(1)
    expect(initialForm({ event: event() }, calendars, []).attendeesLoaded).toBe(false)
  })
})

describe('what a save sends for notes, a location and a meeting link', () => {
  it('sends a field the user emptied as empty, so the event loses it', () => {
    // Left out, an update keeps what the event had: the notes came back.
    expect(textFieldUpdate('', 'Bring the contract')).toBe('')
    expect(textFieldUpdate('   ', 'https://meet.example/abc')).toBe('')
  })

  it('leaves out a field that was empty and still is', () => {
    expect(textFieldUpdate('', '')).toBeUndefined()
    expect(textFieldUpdate('  ', '')).toBeUndefined()
  })

  it('sends the text, trimmed, when there is some', () => {
    expect(textFieldUpdate(' Room 2 ', '')).toBe('Room 2')
    expect(textFieldUpdate('Room 3', 'Room 2')).toBe('Room 3')
  })
})
