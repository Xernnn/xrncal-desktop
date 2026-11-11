import ICAL from 'ical.js'
import { exclusiveEndToInclusive } from '@shared/all-day'
import { DateTime, IANAZone } from 'luxon'
import type { Attendee, AttendeeResponseStatus, CreateEventInput, EventException } from '@shared/event-model'
import { normalizeReminders, type EventReminder } from '@shared/reminders'

export const MAX_ICS_SIZE_BYTES = 5 * 1024 * 1024 // 5 MB cap

/** An occurrence override, with what it needs to stand as an event of its own
 *  when its series is not in the file (an invitation to that one date). */
type ParsedOccurrence = Omit<EventException, 'id' | 'createdAt' | 'updatedAt'> & {
  masterUid?: string
  attendees?: Attendee[]
  reminders?: EventReminder[]
  meetingUrl?: string
}

interface ParsedIcsData {
  events: (CreateEventInput & { uid?: string })[]
  exceptions: ParsedOccurrence[]
  /** VEVENTs that could not be read and are left out. A caller that takes the
   *  file as all there is (a CalDAV pull) must not. */
  skipped: number
}

/** What `icalTimeToIso()` reads of an ICAL.Time. `timezone` is the TZID
 *  ical.js keeps when it could not resolve the zone, which its types omit. */
interface IcalTimeParts {
  isDate?: boolean
  timezone?: string
  zone?: { tzid: string }
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
  toJSDate(): Date
}

/**
 * Format ICAL.Time into an ISO 8601 UTC string
 */
function icalTimeToIso(time: IcalTimeParts | null | undefined): { iso: string; allDay: boolean; tzid: string } {
  if (!time) {
    const now = new Date().toISOString()
    return { iso: now, allDay: false, tzid: 'UTC' }
  }

  const allDay = time.isDate === true
  const tzid = time.timezone || (time.zone ? time.zone.tzid : 'UTC')
  // A DATE is a calendar day, not an instant. toJSDate() puts it at midnight in
  // this machine's zone, which east of UTC reads back as the previous day: every
  // all-day event pulled or imported in Sydney started at 14:00Z the day before.
  // The app keeps all-day dates at UTC midnight.
  const pad = (n: number, width = 2): string => String(n).padStart(width, '0')
  if (allDay) return { iso: `${pad(time.year, 4)}-${pad(time.month)}-${pad(time.day)}T00:00:00.000Z`, allDay, tzid }

  // A TZID whose VTIMEZONE the file left out stays unresolved, and ical.js then
  // reads the time as floating - in this machine's zone, so 09:00 New York came
  // out as 09:00 here. An IANA name can still be resolved without the block.
  if (time.timezone && time.zone?.tzid === 'floating' && IANAZone.isValidZone(time.timezone)) {
    const zoned = DateTime.fromObject(
      { year: time.year, month: time.month, day: time.day, hour: time.hour, minute: time.minute, second: time.second },
      { zone: time.timezone }
    )
    if (zoned.isValid) return { iso: zoned.toUTC().toISO()!, allDay, tzid }
  }

  const jsDate = time.toJSDate()
  const iso = DateTime.fromJSDate(jsDate, { zone: 'utc' }).toISO() || jsDate.toISOString()
  return { iso, allDay, tzid }
}

/**
 * Safely parse an iCalendar (.ics) string with size limits
 */
/**
 * RFC 5545 DTEND is exclusive for DATE values, like every other interchange
 * format; the app stores an inclusive end. Timed events pass through unchanged.
 */
function normaliseIcsEnd(
  startInfo: { iso: string; allDay: boolean },
  endInfo: { iso: string }
): string {
  return startInfo.allDay
    ? exclusiveEndToInclusive(startInfo.iso, endInfo.iso)
    : endInfo.iso
}

/**
 * A VEVENT's alarms as reminders: undefined when it has none at all. Only
 * alarms counted back from the start can be expressed here - an alarm at a
 * fixed date-time, or relative to the end, is left out.
 */
function parseAlarms(vEvent: ICAL.Component): EventReminder[] | undefined {
  const alarms = vEvent.getAllSubcomponents('valarm')
  if (alarms.length === 0) return undefined

  const out: EventReminder[] = []
  for (const alarm of alarms) {
    const reminder = alarmAsReminder(alarm)
    if (reminder) out.push(reminder)
  }
  return normalizeReminders(out)
}

/** The reminder a VALARM is, or null for one this app cannot express. */
export function alarmAsReminder(alarm: ICAL.Component): EventReminder | null {
  const triggerProp = alarm.getFirstProperty('trigger')
  if (!triggerProp) return null
  const related = String(triggerProp.getParameter('related') || 'START').toUpperCase()
  const trigger = triggerProp.getFirstValue()
  // A DATE-TIME trigger parses to an ICAL.Time; only a duration counts back from the start.
  if (related !== 'START' || !(trigger instanceof ICAL.Duration)) return null
  const seconds = trigger.toSeconds()
  if (seconds > 0) return null
  const action = String(alarm.getFirstPropertyValue('action') || '').toUpperCase()
  const minutesBefore = Math.round(-seconds / 60)
  return action === 'EMAIL' ? { minutesBefore, method: 'email' } : { minutesBefore }
}

const PARTSTAT: Record<string, AttendeeResponseStatus> = {
  ACCEPTED: 'accepted',
  DECLINED: 'declined',
  TENTATIVE: 'tentative',
  'NEEDS-ACTION': 'needsAction'
}

function mailtoAddress(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const address = value.trim().replace(/^mailto:/i, '')
  return address.includes('@') ? address : undefined
}

/**
 * ATTENDEE and ORGANIZER as a guest list. An organizer not also listed as an
 * attendee is added, so the list always says who sent the invitation. Which
 * entry is the account's own is the caller's to mark (see markSelfAttendee).
 */
function parseAttendees(vEvent: ICAL.Component): Attendee[] {
  const organizerProp = vEvent.getFirstProperty('organizer')
  const organizerEmail = mailtoAddress(organizerProp?.getFirstValue())
  const organizer = organizerEmail?.toLowerCase()

  const out: Attendee[] = []
  for (const prop of vEvent.getAllProperties('attendee')) {
    const email = mailtoAddress(prop.getFirstValue())
    if (!email) continue
    const cn = prop.getParameter('cn')
    const partstat = String(prop.getParameter('partstat') || 'NEEDS-ACTION').toUpperCase()
    const cutype = String(prop.getParameter('cutype') || '').toUpperCase()
    const role = String(prop.getParameter('role') || '').toUpperCase()
    out.push({
      email,
      displayName: typeof cn === 'string' && cn ? cn : undefined,
      responseStatus: PARTSTAT[partstat] ?? 'needsAction',
      isOrganizer: email.toLowerCase() === organizer,
      role:
        cutype === 'ROOM'
          ? 'room'
          : cutype === 'RESOURCE'
            ? 'resource'
            : role === 'OPT-PARTICIPANT' || role === 'NON-PARTICIPANT'
              ? 'optional'
              : undefined
    })
  }

  if (organizerEmail && out.length > 0 && !out.some((a) => a.isOrganizer)) {
    const cn = organizerProp?.getParameter('cn')
    out.unshift({
      email: organizerEmail,
      displayName: typeof cn === 'string' && cn ? cn : undefined,
      responseStatus: 'accepted',
      isOrganizer: true
    })
  }
  return out
}

/** URL and COLOR are what write-ics puts the meeting link and event colour in.
 *  Reading them back is what stops a CalDAV pull from wiping both. */
function urlOf(vEvent: ICAL.Component): string | undefined {
  const url = vEvent.getFirstPropertyValue('url')
  return typeof url === 'string' && url.trim() ? unescapeTextEscapes(url.trim()) : undefined
}

/** A text escape in a URI: a backslash before a backslash, comma or semicolon. */
const TEXT_ESCAPE_IN_URI = /\\([\\,;])/g

/**
 * A meeting link as it was before xrncal wrote it escaped as text. Until
 * 2a60e6f a push sent "a,b" as "a\,b", which no reader unescapes in a URI, so
 * the next pull stored it so and the next push escaped it again ("a\\\,b").
 * A backslash is not a URI character at all, so none of these is ever meant:
 * each layer is taken off until none is left. (Migration 026 does the same to
 * the links already stored.)
 */
export function unescapeTextEscapes(url: string): string {
  for (let out = url; ; ) {
    const next = out.replace(TEXT_ESCAPE_IN_URI, '$1')
    if (next === out) return out
    out = next
  }
}

/** COLOR (RFC 7986) may be a CSS colour name from another client; only the hex
 *  colours this app writes are kept. */
function parseColor(vEvent: ICAL.Component): string | undefined {
  const raw = vEvent.getFirstPropertyValue('color')
  return typeof raw === 'string' && /^#[0-9a-f]{3,8}$/i.test(raw.trim()) ? raw.trim() : undefined
}

export function parseIcsContent(icsContent: string, targetCalendarId: string): ParsedIcsData {
  if (typeof icsContent !== 'string') {
    throw new Error('Invalid ICS content: expected string')
  }

  // Size limit validation (reject files > 5MB)
  const byteLength = Buffer.byteLength(icsContent, 'utf-8')
  if (byteLength > MAX_ICS_SIZE_BYTES) {
    throw new Error(`ICS payload exceeds size cap of 5MB (${(byteLength / (1024 * 1024)).toFixed(2)} MB)`)
  }

  if (!icsContent.trim()) {
    return { events: [], exceptions: [], skipped: 0 }
  }

  let jcal: unknown[]
  try {
    jcal = ICAL.parse(icsContent)
  } catch (err) {
    throw new Error(`Failed to parse iCalendar format: ${err instanceof Error ? err.message : String(err)}`, { cause: err })
  }

  const comp = new ICAL.Component(jcal)
  const vEvents = comp.getAllSubcomponents('vevent')

  const events: (CreateEventInput & { uid?: string })[] = []
  const exceptions: ParsedOccurrence[] = []
  let skipped = 0

  for (const vEvent of vEvents) {
    try {
      const icalEvent = new ICAL.Event(vEvent)
      const uid = icalEvent.uid || `ics_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      const summary = icalEvent.summary || 'Untitled Event'
      const description = icalEvent.description || undefined
      const location = icalEvent.location || undefined

      const startInfo = icalTimeToIso(icalEvent.startDate)
      const endInfo = icalTimeToIso(icalEvent.endDate)

      // Check if this VEVENT is an occurrence exception (RECURRENCE-ID present)
      const recIdProp = vEvent.getFirstProperty('recurrence-id')
      if (recIdProp) {
        // RECURRENCE-ID is a DATE or DATE-TIME, which ical.js reads as a Time.
        const recIdTime = recIdProp.getFirstValue() as ICAL.Time | null
        const origStartInfo = icalTimeToIso(recIdTime)
        const status = vEvent.getFirstPropertyValue('status')
        const isCancelled = String(status).toUpperCase() === 'CANCELLED'

        exceptions.push({
          masterUid: uid,
          masterEventId: '', // Will be resolved to master event ID
          originalStartUtc: origStartInfo.iso,
          isCancelled,
          title: summary,
          notes: description,
          location,
          dtStartUtc: startInfo.iso,
          dtEndUtc: normaliseIcsEnd(startInfo, endInfo),
          tzid: startInfo.tzid,
          // One week of an all-day series moved to 10:00 is a timed occurrence
          // (and the other way round). Left out, it inherited the series' flag
          // and showed as an all-day event on the day it was moved to.
          allDay: startInfo.allDay,
          attendees: parseAttendees(vEvent),
          reminders: parseAlarms(vEvent),
          meetingUrl: urlOf(vEvent)
        })
        continue
      }

      // Check RRULE
      let rruleString: string | undefined
      const rruleProp = vEvent.getFirstProperty('rrule')
      if (rruleProp) {
        const rruleVal = rruleProp.getFirstValue()
        if (rruleVal) {
          rruleString = typeof rruleVal.toString === 'function' ? rruleVal.toString() : String(rruleVal)
        }
      }

      // Check EXDATE
      let exdateString: string | undefined
      const exdateProps = vEvent.getAllProperties('exdate')
      if (exdateProps.length > 0) {
        const exdates: string[] = []
        for (const prop of exdateProps) {
          const vals = prop.getValues()
          for (const val of vals) {
            const exInfo = icalTimeToIso(val)
            exdates.push(exInfo.iso)
          }
        }
        if (exdates.length > 0) {
          exdateString = exdates.join(',')
        }
      }

      events.push({
        calendarId: targetCalendarId,
        uid,
        title: summary,
        notes: description,
        location,
        dtStartUtc: startInfo.iso,
        dtEndUtc: normaliseIcsEnd(startInfo, endInfo),
        tzid: startInfo.tzid,
        allDay: startInfo.allDay,
        rrule: rruleString,
        exdate: exdateString,
        meetingUrl: urlOf(vEvent),
        color: parseColor(vEvent),
        reminders: parseAlarms(vEvent),
        attendees: parseAttendees(vEvent)
      })
    } catch {
      // A malformed VEVENT is skipped; the rest of the file still imports.
      // (ical.js reads values lazily, so one bad EXDATE or alarm lands here.)
      skipped++
    }
  }

  return { events, exceptions, skipped }
}
