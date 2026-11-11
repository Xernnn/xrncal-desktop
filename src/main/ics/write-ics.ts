import { DateTime } from 'luxon'
import { inclusiveEndToExclusiveDate } from '@shared/all-day'
import type { Attendee, Calendar, CalendarEvent, EventException } from '@shared/event-model'
import { remindersForProvider, type EventReminder } from '@shared/reminders'
import { localStamp, vtimezoneLines, writableZone } from './vtimezone'

function formatIcsDateTime(isoUtc: string, isAllDay: boolean): string {
  const dt = DateTime.fromISO(isoUtc, { zone: 'utc' })
  if (isAllDay) {
    return dt.toFormat('yyyyMMdd')
  }
  return dt.toFormat("yyyyMMdd'T'HHmmss'Z'")
}

/** A timed property in the event's zone (`DTSTART;TZID=Australia/Sydney:20261007T220000`),
 *  or as UTC when it has none worth writing. */
function timedLine(name: string, isoUtc: string, zone: string | null): string {
  return zone ? `${name};TZID=${zone}:${localStamp(isoUtc, zone)}` : `${name}:${formatIcsDateTime(isoUtc, false)}`
}

/**
 * With a zoned start, UNTIL has to be a UTC date-time (RFC 5545 3.3.10). The
 * editor writes it that way; a custom or imported rule may carry a clock time
 * or a bare date, read here in the event's zone.
 */
function utcUntil(rrule: string, zone: string): string {
  return rrule.replace(/UNTIL=(\d{8})(?:T(\d{6}))?(Z?)/i, (whole, date: string, time: string | undefined, z: string) => {
    if (z) return whole
    const local = time
      ? DateTime.fromFormat(`${date}${time}`, 'yyyyMMddHHmmss', { zone })
      : DateTime.fromFormat(date, 'yyyyMMdd', { zone }).endOf('day')
    return local.isValid ? `UNTIL=${local.toUTC().toFormat("yyyyMMdd'T'HHmmss'Z'")}` : whole
  })
}

/**
 * The zone a moved occurrence's times are written in, or null when they are
 * written as a date (an all-day occurrence) or as UTC. A timed series' overrides
 * share its zone; a week of an all-day series moved to a time of day has no
 * series zone to share and keeps its own.
 */
function overrideZone(event: CalendarEvent, ex: EventException, seriesZone: string | null): string | null {
  if (ex.allDay ?? event.allDay) return null
  return event.allDay ? writableZone(ex.tzid) : seriesZone
}

/**
 * A value written with a line break of its own ends its content line there, and
 * the rest is read as the next property. Titles, names and UIDs arrive from
 * feeds, invitations and imported files: an imported `UID:x\nATTENDEE:mailto:...`
 * (which a reader unescapes to a real line break) put a guest list back on an
 * event whose guests the import had deliberately left out, and a guest's
 * `CN="A^nB"` left a line no server would take, so a reply never went. A bare
 * CR counts: some servers read it as the end of a line.
 */
const LINE_BREAK = /\r\n?|\n/g

function escapeIcsText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(LINE_BREAK, '\\n')
}

/** A UID as other clients wrote it, which few escape as text: only its line
 *  breaks are, the way a reader gave them. */
function uidLine(uid: string): string {
  return `UID:${uid.replace(LINE_BREAK, '\\n')}`
}

/** `-P1DT15H` for 2340 minutes before; `PT0S` for the start itself. */
function formatTriggerDuration(minutesBefore: number): string {
  if (minutesBefore <= 0) return 'PT0S'
  const days = Math.floor(minutesBefore / 1440)
  const hours = Math.floor((minutesBefore % 1440) / 60)
  const minutes = minutesBefore % 60
  const time = `${hours ? `${hours}H` : ''}${minutes ? `${minutes}M` : ''}`
  return `-P${days ? `${days}D` : ''}${time ? `T${time}` : ''}`
}

/**
 * One DISPLAY alarm per reminder. Email alarms need an address to send to,
 * which this app does not have, so they stay local (see remindersForProvider).
 * An override component gets the same alarms: in iCalendar it does not inherit
 * them from the series, so without this a moved occurrence would ring nowhere.
 */
function pushAlarmLines(lines: string[], reminders: EventReminder[] | undefined, title: string): void {
  if (!reminders) return
  for (const r of remindersForProvider('caldav', reminders)) {
    lines.push('BEGIN:VALARM')
    lines.push('ACTION:DISPLAY')
    lines.push(`DESCRIPTION:${escapeIcsText(title)}`)
    lines.push(`TRIGGER:${formatTriggerDuration(r.minutesBefore)}`)
    lines.push('END:VALARM')
  }
}

const PARTSTAT: Record<NonNullable<Attendee['responseStatus']>, string> = {
  accepted: 'ACCEPTED',
  declined: 'DECLINED',
  tentative: 'TENTATIVE',
  needsAction: 'NEEDS-ACTION'
}

/** A quoted parameter value; RFC 5545 has no escape for a double quote. */
function paramValue(text: string): string {
  return `"${text.replace(/"/g, "'").replace(LINE_BREAK, ' ')}"`
}

/** An address is one token: no line break belongs in it. */
function mailto(email: string): string {
  return `mailto:${email.replace(LINE_BREAK, '')}`
}

/**
 * ORGANIZER and ATTENDEE lines. A CalDAV push replaces the whole resource, so
 * leaving these out deleted the guest list on the server - and a guest's reply
 * travels as their own PARTSTAT here, for the server to pass on.
 */
function pushAttendeeLines(lines: string[], attendees: Attendee[] | undefined): void {
  if (!attendees || attendees.length === 0) return
  const organizer = attendees.find((a) => a.isOrganizer)
  if (organizer) {
    const cn = organizer.displayName ? `;CN=${paramValue(organizer.displayName)}` : ''
    lines.push(`ORGANIZER${cn}:${mailto(organizer.email)}`)
  }
  for (const a of attendees) {
    const cn = a.displayName ? `;CN=${paramValue(a.displayName)}` : ''
    const role =
      a.role === 'room'
        ? ';CUTYPE=ROOM'
        : a.role === 'resource'
          ? ';CUTYPE=RESOURCE'
          : a.role === 'optional'
            ? ';ROLE=OPT-PARTICIPANT'
            : ''
    lines.push(`ATTENDEE${cn}${role};PARTSTAT=${PARTSTAT[a.responseStatus || 'needsAction']}:${mailto(a.email)}`)
  }
}

/**
 * Generate RFC 5545 iCalendar (.ics) string for a calendar and its events
 */
export function generateIcs(
  calendar: Calendar,
  events: CalendarEvent[],
  exceptions: EventException[] = []
): string {
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//xrncal//xrncal Desktop//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeIcsText(calendar.name)}`
  ]

  const exceptionsByMaster = new Map<string, EventException[]>()
  for (const ex of exceptions) {
    const list = exceptionsByMaster.get(ex.masterEventId) || []
    list.push(ex)
    exceptionsByMaster.set(ex.masterEventId, list)
  }

  // Each zone a timed event is written in, defined once ahead of the events,
  // from the year of the earliest event in it.
  const zoneYears = new Map<string, number>()
  const useZone = (zone: string | null, isoUtc: string): void => {
    if (!zone) return
    const year = DateTime.fromISO(isoUtc, { zone: 'utc' }).setZone(zone).year
    zoneYears.set(zone, Math.min(year, zoneYears.get(zone) ?? year))
  }
  for (const event of events) {
    if (event.isDeleted) continue
    const zone = event.allDay ? null : writableZone(event.tzid)
    useZone(zone, event.dtStartUtc)
    for (const ex of exceptionsByMaster.get(event.id) ?? []) {
      if (!ex.isCancelled) useZone(overrideZone(event, ex, zone), ex.dtStartUtc || ex.originalStartUtc)
    }
  }
  for (const [zone, year] of zoneYears) lines.push(...vtimezoneLines(zone, year))

  for (const event of events) {
    if (event.isDeleted) continue
    const zone = event.allDay ? null : writableZone(event.tzid)

    lines.push('BEGIN:VEVENT')
    lines.push(uidLine(event.uid))
    lines.push(`DTSTAMP:${DateTime.utc().toFormat("yyyyMMdd'T'HHmmss'Z'")}`)

    if (event.allDay) {
      lines.push(`DTSTART;VALUE=DATE:${formatIcsDateTime(event.dtStartUtc, true)}`)
      // DTEND is exclusive for DATE values per RFC 5545.
      lines.push(
        `DTEND;VALUE=DATE:${inclusiveEndToExclusiveDate(event.dtStartUtc, event.dtEndUtc).replace(/-/g, '')}`
      )
    } else {
      lines.push(timedLine('DTSTART', event.dtStartUtc, zone))
      lines.push(timedLine('DTEND', event.dtEndUtc, zone))
    }

    lines.push(`SUMMARY:${escapeIcsText(event.title)}`)
    if (event.notes) {
      lines.push(`DESCRIPTION:${escapeIcsText(event.notes)}`)
    }
    if (event.location) {
      lines.push(`LOCATION:${escapeIcsText(event.location)}`)
    }
    // URL and COLOR are both RFC-defined (5545 / 7986) and round-trip through
    // CalDAV servers, so a meeting link or per-event colour survives a push.
    if (event.meetingUrl) {
      lines.push(`URL:${escapeIcsText(event.meetingUrl)}`)
    }
    if (event.color) {
      lines.push(`COLOR:${escapeIcsText(event.color)}`)
    }
    if (event.rrule) {
      lines.push(`RRULE:${zone ? utcUntil(event.rrule, zone) : event.rrule}`)
    }
    // A cancelled occurrence is one more EXDATE. It used to be a RECURRENCE-ID
    // component with STATUS:CANCELLED and nothing else, and without a DTSTART
    // (which RFC 5545 requires of every VEVENT) Radicale refused the whole series
    // with a 400 - the push failed on every poll, and the series' other edits
    // never reached the server. EXDATE is also what other clients write, and
    // read: some draw a cancelled instance as an ordinary or struck-through event.
    const cancelled = (exceptionsByMaster.get(event.id) ?? []).filter((ex) => ex.isCancelled).map((ex) => ex.originalStartUtc)
    const dates = [
      ...new Map(
        [...(event.exdate ? event.exdate.split(',').map((d) => d.trim()) : []), ...cancelled]
          .filter(Boolean)
          .map((d) => [event.allDay ? d.slice(0, 10) : String(Date.parse(d)), d] as const)
      ).values()
    ].sort((a, b) => Date.parse(a) - Date.parse(b))
    if (dates.length > 0) {
      if (event.allDay) {
        lines.push(`EXDATE;VALUE=DATE:${dates.map((d) => formatIcsDateTime(d, true)).join(',')}`)
      } else if (zone) {
        lines.push(`EXDATE;TZID=${zone}:${dates.map((d) => localStamp(d, zone)).join(',')}`)
      } else {
        lines.push(`EXDATE:${dates.map((d) => formatIcsDateTime(d, false)).join(',')}`)
      }
    }
    pushAttendeeLines(lines, event.attendees)
    pushAlarmLines(lines, event.reminders, event.title)

    lines.push('END:VEVENT')

    // Append recurrence exceptions (RECURRENCE-ID); cancelled ones are EXDATEs above.
    const eventExceptions = (exceptionsByMaster.get(event.id) || []).filter((ex) => !ex.isCancelled)
    for (const ex of eventExceptions) {
      lines.push('BEGIN:VEVENT')
      lines.push(uidLine(event.uid))
      lines.push(`DTSTAMP:${DateTime.utc().toFormat("yyyyMMdd'T'HHmmss'Z'")}`)

      lines.push(
        event.allDay
          ? `RECURRENCE-ID;VALUE=DATE:${formatIcsDateTime(ex.originalStartUtc, true)}`
          : timedLine('RECURRENCE-ID', ex.originalStartUtc, zone)
      )

      const startIso = ex.dtStartUtc || ex.originalStartUtc
      const endIso = ex.dtEndUtc || startIso
      // The occurrence's own all-day flag, not the series': one week of an
      // all-day series moved to 10:00 used to be written as all-day too, and
      // every such week lost its time on the server at the next edit here.
      if (ex.allDay ?? event.allDay) {
        lines.push(`DTSTART;VALUE=DATE:${formatIcsDateTime(startIso, true)}`)
        lines.push(
          `DTEND;VALUE=DATE:${inclusiveEndToExclusiveDate(startIso, endIso).replace(/-/g, '')}`
        )
      } else {
        const at = overrideZone(event, ex, zone)
        lines.push(timedLine('DTSTART', startIso, at))
        lines.push(timedLine('DTEND', endIso, at))
      }

      lines.push(`SUMMARY:${escapeIcsText(ex.title || event.title)}`)
      if (ex.notes || event.notes) {
        lines.push(`DESCRIPTION:${escapeIcsText(ex.notes || event.notes || '')}`)
      }
      if (ex.location || event.location) {
        lines.push(`LOCATION:${escapeIcsText(ex.location || event.location || '')}`)
      }
      pushAttendeeLines(lines, event.attendees)
      pushAlarmLines(lines, event.reminders, ex.title || event.title)

      lines.push('END:VEVENT')
    }
  }

  lines.push('END:VCALENDAR')
  return lines.join('\r\n')
}
