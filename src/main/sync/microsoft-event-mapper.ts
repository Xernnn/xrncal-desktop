import { DateTime } from 'luxon'
import { exclusiveEndToInclusive, inclusiveEndToExclusiveDate } from '@shared/all-day'
import type {
  Attendee,
  AttendeeResponseStatus,
  CalendarEvent,
  EventException,
  CreateEventInput
} from '@shared/event-model'
import { invitationSelf } from '@shared/event-model'
import { expandOccurrences } from '@shared/expand-occurrences'
import type { PulledOccurrenceOverride } from '../db/repos/events-repo'
import { remindersForProvider, type EventReminder } from '@shared/reminders'
import { ianaZoneFor, windowsZoneFor } from './graph-time-zones'
import {
  graphRecurrenceToRrule,
  rruleToGraphRecurrence,
  type GraphRecurrence
} from './graph-recurrence-map'

interface GraphDateTimeTimeZone {
  dateTime: string // e.g. "2026-08-18T10:00:00.0000000"
  timeZone: string // e.g. "UTC", "SE Asia Standard Time", "Asia/Ho_Chi_Minh"
}

/** What we send to Graph - see GoogleEventWritePayload for why the id is absent. */
type GraphEventWritePayload = Omit<MicrosoftGraphApiEvent, 'id'>

export interface MicrosoftGraphApiEvent {
  id: string
  subject?: string
  body?: { contentType?: string; content?: string }
  bodyPreview?: string
  start?: GraphDateTimeTimeZone
  end?: GraphDateTimeTimeZone
  isAllDay?: boolean
  location?: { displayName?: string }
  recurrence?: GraphRecurrence
  type?: 'singleInstance' | 'occurrence' | 'exception' | 'seriesMaster'
  seriesMasterId?: string
  isCancelled?: boolean
  webLink?: string
  onlineMeeting?: { joinUrl?: string }
  '@odata.etag'?: string
  lastModifiedDateTime?: string
  categories?: string[]
  isReminderOn?: boolean
  reminderMinutesBeforeStart?: number
  attendees?: GraphAttendee[]
  organizer?: { emailAddress?: GraphEmailAddress }
  /** Whether the signed-in user organised this event. */
  isOrganizer?: boolean
  /** The signed-in user's own answer. */
  responseStatus?: { response?: string }
  /** The zone the organiser created it in; `start` is in UTC (the pull asks for it). */
  originalStartTimeZone?: string
  /** An occurrence's or exception's start before it was moved, in UTC. */
  originalStart?: string
  /** `OID.<series id>.<yyyy-mm-dd>`: which occurrence of its series this is. */
  occurrenceId?: string
}

/**
 * What a series master read by id says about its occurrences. Graph v1.0 has
 * these only on a GET of the master itself, never in a listing - which holds
 * series masters and single events, so an occurrence moved or cancelled in
 * Outlook never reached the app at all.
 */
export interface GraphSeriesOccurrences {
  /** Changed occurrences, as events of their own (cancelled ones are not here). */
  exceptionOccurrences?: MicrosoftGraphApiEvent[]
  /** The occurrenceIds of cancelled occurrences. */
  cancelledOccurrences?: string[]
}


interface GraphEmailAddress {
  address?: string
  name?: string
}

interface GraphAttendee {
  emailAddress?: GraphEmailAddress
  status?: { response?: string }
  type?: string
}

function graphResponseToDomain(response?: string): AttendeeResponseStatus {
  switch (response) {
    case 'accepted':
    case 'organizer':
      return 'accepted'
    case 'tentativelyAccepted':
      return 'tentative'
    case 'declined':
      return 'declined'
    default:
      return 'needsAction'
  }
}

/**
 * Graph's guest list as ours. Graph lists the guests but not the organizer,
 * and reports the signed-in user's own answer in `responseStatus` rather than
 * marking an entry, so both are filled in here - the organizer so the list
 * says who sent the invitation, and `isSelf` so there is something to answer.
 */
export function graphAttendeesToDomain(gEvent: MicrosoftGraphApiEvent, selfEmail?: string): Attendee[] {
  const self = selfEmail?.trim().toLowerCase()
  const organizerAddress = gEvent.organizer?.emailAddress?.address
  const organizer = organizerAddress?.toLowerCase()

  const list: Attendee[] = (gEvent.attendees || [])
    .filter((a) => a.emailAddress?.address)
    .map((a): Attendee => {
      const email = a.emailAddress!.address!
      const lower = email.toLowerCase()
      return {
        email,
        displayName: a.emailAddress?.name || undefined,
        responseStatus: graphResponseToDomain(a.status?.response),
        isOrganizer: lower === organizer,
        isSelf: Boolean(self) && lower === self,
        // Rooms stay in the list: a PATCH without one would cancel its booking.
        role: a.type === 'resource' ? 'room' : a.type === 'optional' ? 'optional' : undefined
      }
    })
  if (list.length === 0) return list

  if (organizerAddress && !list.some((a) => a.isOrganizer)) {
    list.unshift({
      email: organizerAddress,
      displayName: gEvent.organizer?.emailAddress?.name || undefined,
      responseStatus: 'accepted',
      isOrganizer: true,
      isSelf: gEvent.isOrganizer === true || (Boolean(self) && organizer === self)
    })
  }

  if (gEvent.isOrganizer === false) {
    let me = list.find((a) => a.isSelf)
    // Invited through a group or an alias: no entry carries our address.
    if (!me && selfEmail) {
      me = { email: selfEmail, responseStatus: 'needsAction', isSelf: true }
      list.push(me)
    }
    if (me) me.responseStatus = graphResponseToDomain(gEvent.responseStatus?.response)
  }
  return list
}

/** Graph holds one reminder per event, or none. */
function graphReminderToDomain(gEvent: MicrosoftGraphApiEvent): EventReminder[] | undefined {
  if (gEvent.isReminderOn === undefined) return undefined
  if (!gEvent.isReminderOn) return []
  return [{ minutesBefore: Math.max(0, gEvent.reminderMinutesBeforeStart ?? 15) }]
}

/**
 * Parse Graph DateTimeTimeZone to ISO UTC string
 */
function parseGraphDateTime(
  dt?: GraphDateTimeTimeZone,
  isAllDay?: boolean
): { iso: string; tzid: string } {
  if (!dt || !dt.dateTime) {
    const now = DateTime.utc().toISO()!
    return { iso: now, tzid: 'UTC' }
  }

  const raw = dt.dateTime.split('.')[0] // strip microsecond decimals
  const tzid = dt.timeZone || 'UTC'

  if (isAllDay) {
    const datePart = raw.split('T')[0]
    return { iso: `${datePart}T00:00:00.000Z`, tzid }
  }

  // If timeZone is specified and luxon can parse it
  let parsed = DateTime.fromISO(raw, { zone: tzid })
  if (!parsed.isValid) {
    parsed = DateTime.fromISO(raw, { zone: 'utc' })
  }

  const iso = parsed.toUTC().toISO() || `${raw}Z`
  return { iso, tzid: parsed.zoneName || tzid }
}

/**
 * Map Microsoft Graph API event to Canonical CalendarEvent / EventException
 */
/**
 * All-day ends arrive exclusive from Graph; the app stores them inclusive.
 */
function normaliseEnd(
  isAllDay: boolean,
  startInfo: { iso: string },
  endInfo: { iso: string }
): string {
  return isAllDay ? exclusiveEndToInclusive(startInfo.iso, endInfo.iso) : endInfo.iso
}

export function mapGraphEventToDomain(
  gEvent: MicrosoftGraphApiEvent,
  calendarId: string,
  /** The account's address, to find its own entry in the guest list. */
  selfEmail?: string
): {
  isException: boolean
  event?: CreateEventInput & { id: string; etag?: string; isDeleted?: boolean }
  exception?: Omit<EventException, 'id' | 'createdAt' | 'updatedAt'> & { etag?: string }
} {
  const isAllDay = Boolean(gEvent.isAllDay)
  const startInfo = parseGraphDateTime(gEvent.start, isAllDay)
  const endInfo = parseGraphDateTime(gEvent.end, isAllDay)
  // The pull reads times in UTC, which made every event's zone UTC: a series
  // repeats in its zone's clock here, so a weekly 09:00 New York showed an hour
  // off after a summer-time change, and an edit sent it back anchored in UTC.
  const tzid = (!isAllDay && ianaZoneFor(gEvent.originalStartTimeZone)) || startInfo.tzid
  // The pull asks for plain-text bodies; an HTML one (a server ignoring that)
  // would show as markup, so the preview is the fallback.
  const notes =
    (gEvent.body?.contentType?.toLowerCase() === 'text' ? gEvent.body.content?.trim() : undefined) ||
    gEvent.bodyPreview ||
    undefined

  const isCancelled = Boolean(gEvent.isCancelled)
  const meetingUrl = gEvent.onlineMeeting?.joinUrl || gEvent.webLink

  // Exception / Occurrence Override
  if (gEvent.type === 'exception' && gEvent.seriesMasterId) {
    return {
      isException: true,
      exception: {
        masterEventId: gEvent.seriesMasterId,
        // Where the occurrence was, not where it was moved to.
        originalStartUtc: utcInstant(gEvent.originalStart) ?? startInfo.iso,
        isCancelled,
        title: gEvent.subject || 'Untitled Event',
        notes,
        location: gEvent.location?.displayName || undefined,
        dtStartUtc: startInfo.iso,
        dtEndUtc: normaliseEnd(isAllDay, startInfo, endInfo),
        tzid,
        // An occurrence can be timed while its series is all-day (and back).
        allDay: isAllDay
      }
    }
  }

  // Master Series or Single Instance
  let rruleString: string | undefined
  if (gEvent.recurrence) {
    rruleString = graphRecurrenceToRrule(gEvent.recurrence)
  }

  return {
    isException: false,
    event: {
      id: gEvent.id,
      calendarId,
      uid: `${gEvent.id}@outlook.com`,
      title: gEvent.subject || 'Untitled Event',
      notes,
      location: gEvent.location?.displayName || undefined,
      dtStartUtc: startInfo.iso,
      dtEndUtc: normaliseEnd(isAllDay, startInfo, endInfo),
      tzid,
      allDay: isAllDay,
      rrule: rruleString,
      meetingUrl,
      reminders: graphReminderToDomain(gEvent),
      attendees: graphAttendeesToDomain(gEvent, selfEmail),
      etag: gEvent['@odata.etag'],
      isDeleted: isCancelled
    }
  }
}

/** A Graph DateTimeOffset ("2020-05-21T11:30:00Z", up to seven fractional
 *  digits) as the app's UTC ISO string, or undefined. */
function utcInstant(value: string | undefined): string | undefined {
  if (!value) return undefined
  const at = DateTime.fromISO(value, { zone: 'utc' })
  return at.isValid ? at.toUTC().toISO()! : undefined
}

/** The date an occurrenceId (`OID.<series id>.<yyyy-mm-dd>`) names. */
export function occurrenceIdDate(occurrenceId: string | undefined): string | undefined {
  return occurrenceId?.match(/\.(\d{4}-\d{2}-\d{2})$/)?.[1]
}

/**
 * The start an occurrence of `master` had before any change - the key an
 * exception is stored under, which has to be the very string the app's own
 * expansion gives that occurrence, or the exception would not replace it.
 *
 * A changed occurrence carries `originalStart`. A cancelled one is only an
 * occurrenceId, which names a date, so the occurrence is found by expanding the
 * series around it: the one falling on that date in the series' own zone (else
 * in UTC - the documentation does not say which calendar the date is read in).
 * All-day occurrences are floating dates, parked at UTC midnight.
 */
function originalStartOf(master: CalendarEvent, date: string | undefined, originalStart: string | undefined): string | undefined {
  if (master.allDay) {
    const day = date ?? utcInstant(originalStart)?.slice(0, 10)
    return day ? `${day}T00:00:00.000Z` : undefined
  }
  const exact = utcInstant(originalStart)
  if (exact) return exact
  if (!date) return undefined

  const day = DateTime.fromISO(date, { zone: 'utc' })
  if (!day.isValid) return undefined
  const around = expandOccurrences(
    { ...master, exdate: undefined, isDeleted: false },
    [],
    day.minus({ days: 1 }).toISO()!,
    day.plus({ days: 2 }).toISO()!
  )
  const falling = (zone: string) =>
    around.find((o) => DateTime.fromISO(o.originalStartUtc, { zone: 'utc' }).setZone(zone).toISODate() === date)
  return (falling(master.tzid) ?? falling('utc'))?.originalStartUtc
}

/**
 * A series' changed and cancelled occurrences, as read from its master
 * (`GraphSeriesOccurrences`), in the form they are stored. One whose original
 * start cannot be worked out is left out rather than guessed.
 */
export function graphOccurrenceOverrides(master: CalendarEvent, series: GraphSeriesOccurrences): PulledOccurrenceOverride[] {
  const overrides = new Map<string, PulledOccurrenceOverride>()

  for (const occurrenceId of series.cancelledOccurrences ?? []) {
    const originalStartUtc = originalStartOf(master, occurrenceIdDate(occurrenceId), undefined)
    if (originalStartUtc) overrides.set(originalStartUtc, { originalStartUtc, isCancelled: true })
  }

  for (const item of series.exceptionOccurrences ?? []) {
    const originalStartUtc = originalStartOf(master, occurrenceIdDate(item.occurrenceId), item.originalStart)
    if (!originalStartUtc) continue
    const isAllDay = item.isAllDay ?? master.allDay
    const startInfo = parseGraphDateTime(item.start, isAllDay)
    const endInfo = parseGraphDateTime(item.end, isAllDay)
    overrides.set(originalStartUtc, {
      originalStartUtc,
      isCancelled: false,
      title: item.subject || master.title,
      notes:
        (item.body?.contentType?.toLowerCase() === 'text' ? item.body.content?.trim() : undefined) ||
        item.bodyPreview ||
        undefined,
      location: item.location?.displayName || undefined,
      dtStartUtc: startInfo.iso,
      dtEndUtc: normaliseEnd(isAllDay, startInfo, endInfo),
      tzid: master.tzid,
      allDay: isAllDay,
      providerInstanceId: item.id
    })
  }

  return [...overrides.values()]
}

/**
 * Map Canonical Domain Event to Microsoft Graph API format for push
 */
export function mapDomainEventToGraph(
  event: CalendarEvent | (CreateEventInput & { id?: string })
): GraphEventWritePayload {
  const isAllDay = Boolean(event.allDay)
  // Graph wants the clock time with no offset ("2026-08-18T10:00:00") and a
  // zone it knows. This sent the UTC instant with its "Z" and the event's own
  // IANA zone, which Graph's list does not always have (Asia/Ho_Chi_Minh). A
  // Windows zone keeping the same clock, else UTC; an all-day event is dates
  // only, and goes as UTC midnights.
  const windowsZone = isAllDay ? null : windowsZoneFor(event.tzid)
  const clockZone = windowsZone ? event.tzid! : 'utc'
  const timeZone = windowsZone ?? 'UTC'
  const clock = (iso: string): string =>
    DateTime.fromISO(iso, { zone: 'utc' }).setZone(clockZone).toFormat("yyyy-MM-dd'T'HH:mm:ss")

  const startDateStr = isAllDay ? event.dtStartUtc.split('T')[0] : clock(event.dtStartUtc).split('T')[0]
  // Graph, like Google and RFC 5545, wants the exclusive end date for all-day.
  const endDateStr = inclusiveEndToExclusiveDate(event.dtStartUtc, event.dtEndUtc)

  const gEvent: GraphEventWritePayload = {
    // No `id`, for the same reason as the Google mapper: it is in the URL on a
    // PATCH, and on a POST it is a server-assigned, read-only property.
    subject: event.title,
    body: event.notes ? { contentType: 'text', content: event.notes } : undefined,
    location: event.location ? { displayName: event.location } : undefined,
    isAllDay,
    start: {
      dateTime: isAllDay ? `${startDateStr}T00:00:00` : clock(event.dtStartUtc),
      timeZone
    },
    end: {
      dateTime: isAllDay ? `${endDateStr}T00:00:00` : clock(event.dtEndUtc),
      timeZone
    }
  }

  if (event.rrule) {
    gEvent.recurrence = rruleToGraphRecurrence(event.rrule, startDateStr, clockZone)
  }

  // Guests go out only on the organizer's own events, and only when the list
  // is known to be complete (`attendees` undefined otherwise): a PATCH that
  // carried an empty list for an event whose guests were never fetched would
  // cancel the meeting for all of them. The organizer is Graph's to set.
  if (event.attendees && !invitationSelf(event.attendees)) {
    gEvent.attendees = event.attendees
      .filter((a) => !a.isOrganizer)
      .map((a) => ({
        emailAddress: { address: a.email, name: a.displayName },
        type: a.role === 'optional' ? 'optional' : a.role ? 'resource' : 'required'
      }))
  }

  // An event on the default leaves both fields out, so Outlook keeps whatever
  // reminder it already has (and gives a new event the mailbox's default).
  if (event.reminders) {
    const [first] = remindersForProvider('graph', event.reminders)
    gEvent.isReminderOn = Boolean(first)
    if (first) gEvent.reminderMinutesBeforeStart = first.minutesBefore
  }

  // Deliberately not pushed: Graph has no writable counterpart for either field.
  // `meetingUrl` is read back from `onlineMeeting.joinUrl`/`webLink`, both
  // server-owned, and per-event colour does not exist on Graph at all (Outlook
  // colours come from named categories, which are an account-level concept the
  // app does not model). Both are preserved locally; they just do not round-trip
  // through Microsoft.

  return gEvent
}
