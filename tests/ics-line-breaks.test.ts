import { describe, it, expect } from 'vitest'
import { parseIcsContent } from '../src/main/ics/parse-ics'
import { generateIcs } from '../src/main/ics/write-ics'
import type { Calendar, CalendarEvent } from '../src/shared/event-model'

const calendar: Calendar = {
  id: 'cal-test',
  accountId: 'acc-test',
  name: 'Work',
  color: '#4f46e5',
  isVisible: true,
  isReadOnly: false,
  isDefault: true,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z'
}

const event: CalendarEvent = {
  id: 'evt-1',
  calendarId: 'cal-test',
  uid: 'uid-1',
  title: 'Review',
  dtStartUtc: '2026-08-18T10:00:00.000Z',
  dtEndUtc: '2026-08-18T11:00:00.000Z',
  tzid: 'UTC',
  allDay: false,
  dirty: true,
  isDeleted: false,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z'
}

const file = (...vevent: string[]): string =>
  ['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', ...vevent, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n')

/** The names of the properties each VEVENT line starts, as a server reading
 *  any line break as the end of a line sees them. */
const propertyNames = (ics: string): string[] => {
  const lines = ics.split(/\r\n|\r|\n/)
  return lines.slice(lines.indexOf('BEGIN:VEVENT') + 1, lines.indexOf('END:VEVENT')).map((l) => l.split(/[;:]/)[0])
}

describe('a line break inside a value cannot start a new line of the event', () => {
  it('writes the UID of an imported file on one line, so it cannot add guests', () => {
    // What a file to import can hold: the reader unescapes \n to a line break.
    const imported = parseIcsContent(
      file(
        'UID:abc\\nATTENDEE:mailto:victim@example.com\\nORGANIZER:mailto:me@example.com',
        'SUMMARY:Lunch',
        'DTSTART:20260818T100000Z',
        'DTEND:20260818T110000Z'
      ),
      'cal-test'
    ).events[0]
    expect(imported.uid).toContain('\n')

    // The import leaves the guest list out; the push must not bring one back.
    const pushed = generateIcs(calendar, [{ ...event, uid: imported.uid! }])
    expect(propertyNames(pushed)).not.toContain('ATTENDEE')
    expect(propertyNames(pushed)).not.toContain('ORGANIZER')

    const back = parseIcsContent(pushed, 'cal-test').events[0]
    expect(back.attendees).toEqual([])
    expect(back.uid).toBe(imported.uid)
  })

  it('writes a guest name holding a line break (RFC 6868 ^n) on one line', () => {
    const invited = parseIcsContent(
      file(
        'UID:abc',
        'SUMMARY:Lunch',
        'DTSTART:20260818T100000Z',
        'DTEND:20260818T110000Z',
        'ORGANIZER;CN="Boss^nX-INJECTED:1":mailto:boss@example.com',
        'ATTENDEE;CN=Me:mailto:me@example.com'
      ),
      'cal-test'
    ).events[0]
    expect(invited.attendees?.[0].displayName).toContain('\n')

    const pushed = generateIcs(calendar, [{ ...event, attendees: invited.attendees }])
    expect(propertyNames(pushed)).not.toContain('X-INJECTED')
    // Every line is a whole property again, which a reader takes.
    const back = parseIcsContent(pushed, 'cal-test')
    expect(back.skipped).toBe(0)
    expect(back.events[0].attendees?.map((a) => a.email)).toEqual(['boss@example.com', 'me@example.com'])
  })

  it('writes a bare carriage return in a title or in notes as a line break of the text', () => {
    const pushed = generateIcs(calendar, [{ ...event, title: 'Lunch\rX-INJECTED:1', notes: 'one\r\ntwo' }])
    expect(pushed.split('\r\n')).toContain('SUMMARY:Lunch\\nX-INJECTED:1')
    expect(pushed.split('\r\n')).toContain('DESCRIPTION:one\\ntwo')
    expect(pushed.replace(/\r\n/g, '')).not.toContain('\r')
  })
})
