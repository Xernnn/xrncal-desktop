import { DateTime } from 'luxon'
import { boundedBetween, type ExpansionBudget } from './bounded-rrule'
import type { CalendarEvent, EventException, ExpandedOccurrence } from './event-model'
import { resolveLunarOccurrence } from './lunar-vietnam'
import { ianaZoneFor } from './windows-time-zones'

/**
 * Expand a master calendar event and its exceptions into concrete occurrences
 * within a requested UTC date-time window [rangeStartUtc, rangeEndUtc].
 *
 * `coveredYears` lists Gregorian years for which a lunar master already has a
 * materialized standalone instance; those years are skipped so nothing draws twice.
 * `budget` is shared by the series of one calendar in one query (see bounded-rrule.ts).
 */
export function expandOccurrences(
  event: CalendarEvent,
  exceptions: EventException[] = [],
  rangeStartUtc: string,
  rangeEndUtc: string,
  coveredYears?: Set<number>,
  budget?: ExpansionBudget
): ExpandedOccurrence[] {
  if (event.isDeleted) {
    return []
  }

  const rangeStart = DateTime.fromISO(rangeStartUtc, { zone: 'utc' })
  const rangeEnd = DateTime.fromISO(rangeEndUtc, { zone: 'utc' })

  if (!rangeStart.isValid || !rangeEnd.isValid) {
    throw new Error(`Invalid range parameters: ${rangeStartUtc}, ${rangeEndUtc}`)
  }

  // Yearly lunar-date recurrence (âm lịch anniversaries / giỗ)
  if (event.lunarRule) {
    return expandLunarOccurrences(event, exceptions, rangeStart, rangeEnd, coveredYears)
  }

  // Non-recurring event
  if (!event.rrule) {
    const eventStart = DateTime.fromISO(event.dtStartUtc, { zone: 'utc' })
    const eventEnd = DateTime.fromISO(event.dtEndUtc, { zone: 'utc' })

    // Check overlap with requested window
    if (eventStart <= rangeEnd && eventEnd >= rangeStart) {
      return [
        {
          id: `${event.id}_${event.dtStartUtc}`,
          eventId: event.id,
          calendarId: event.calendarId,
          title: event.title,
          notes: event.notes,
          location: event.location,
          startUtc: event.dtStartUtc,
          endUtc: event.dtEndUtc,
          tzid: event.tzid,
          allDay: event.allDay,
          color: event.color,
          meetingUrl: event.meetingUrl,
          isRecurring: false,
          isException: false,
          originalStartUtc: event.dtStartUtc
        }
      ]
    }
    return []
  }

  return expandRruleOccurrences(event, exceptions, rangeStart, rangeEnd, budget)
}

/**
 * Expand a lunar-recurring master into one all-day occurrence per Gregorian year
 * within the range. Honors EXDATE cancellations and per-year exception overrides,
 * both keyed on the occurrence's ISO date.
 */
function expandLunarOccurrences(
  event: CalendarEvent,
  exceptions: EventException[],
  rangeStart: DateTime,
  rangeEnd: DateTime,
  coveredYears?: Set<number>
): ExpandedOccurrence[] {
  const spec = event.lunarRule!
  const results: ExpandedOccurrence[] = []

  const exdateSet = new Set<string>()
  if (event.exdate) {
    event.exdate
      .split(',')
      .map((d) => d.trim())
      .filter(Boolean)
      .forEach((d) => {
        const dt = DateTime.fromISO(d, { zone: 'utc' })
        if (dt.isValid) exdateSet.add(dt.toISODate() || d.slice(0, 10))
      })
  }

  const exceptionsByDate = new Map<string, EventException>()
  for (const ex of exceptions) {
    const dt = DateTime.fromISO(ex.originalStartUtc, { zone: 'utc' })
    if (dt.isValid) exceptionsByDate.set(dt.toISODate() || ex.originalStartUtc.slice(0, 10), ex)
  }

  for (let year = rangeStart.year - 1; year <= rangeEnd.year + 1; year++) {
    if (coveredYears?.has(year)) continue

    const isoDate = resolveLunarOccurrence(spec, year)
    if (!isoDate) continue

    const occStart = DateTime.fromISO(`${isoDate}T00:00:00.000Z`, { zone: 'utc' })
    const occEnd = DateTime.fromISO(`${isoDate}T23:59:59.999Z`, { zone: 'utc' })
    if (occStart > rangeEnd || occEnd < rangeStart) continue
    if (exdateSet.has(isoDate)) continue

    const originalIso = occStart.toISO() || `${isoDate}T00:00:00.000Z`
    const ex = exceptionsByDate.get(isoDate)
    if (ex?.isCancelled) continue

    results.push({
      id: `${event.id}_${originalIso}`,
      eventId: event.id,
      calendarId: event.calendarId,
      title: ex?.title !== undefined ? ex.title : event.title,
      notes: ex?.notes !== undefined ? ex.notes : event.notes,
      location: ex?.location !== undefined ? ex.location : event.location,
      startUtc: ex?.dtStartUtc || originalIso,
      endUtc: ex?.dtEndUtc || occEnd.toISO() || `${isoDate}T23:59:59.999Z`,
      tzid: ex?.tzid || event.tzid,
      allDay: true,
      color: ex?.color || event.color,
      meetingUrl: event.meetingUrl,
      isRecurring: true,
      isException: Boolean(ex),
      isLunar: true,
      originalStartUtc: originalIso
    })
  }

  return results
}

/**
 * How far before the range a series is searched for dates still running into
 * it. The search went back as far as one date lasts, and that length is input
 * like the rule is: a daily series from a feed with DTSTART in 1900 and DTEND
 * in 2100 put every date since 1900 into every query - 46,000 occurrences and
 * most of a second for one event, on each view and each reminder check, which
 * bounded-rrule.ts's meter allows because the walk is that long. No real series
 * has dates longer than a year; of one that does, the last year's show.
 */
const MAX_LOOK_BACK_MS = 366 * 86_400_000

function expandRruleOccurrences(
  event: CalendarEvent,
  exceptions: EventException[],
  rangeStart: DateTime,
  rangeEnd: DateTime,
  budget?: ExpansionBudget
): ExpandedOccurrence[] {
  const rrule = event.rrule
  if (!rrule) return []

  // Recurring Event: Parse master start/end and duration
  const masterStart = DateTime.fromISO(event.dtStartUtc, { zone: 'utc' })
  const masterEnd = DateTime.fromISO(event.dtEndUtc, { zone: 'utc' })
  const durationMillis = masterEnd.diff(masterStart).milliseconds

  // Parse EXDATE set
  const exdateSet = new Set<string>()
  if (event.exdate) {
    event.exdate
      .split(',')
      .map((d) => d.trim())
      .filter(Boolean)
      .forEach((d) => {
        const dt = DateTime.fromISO(d, { zone: 'utc' })
        if (dt.isValid) {
          exdateSet.add(dt.toISO() || d)
          exdateSet.add(dt.toMillis().toString())
        }
      })
  }

  // Map exceptions by originalStartUtc ISO / timestamp
  const exceptionsByOriginal = new Map<string, EventException>()
  for (const ex of exceptions) {
    const dt = DateTime.fromISO(ex.originalStartUtc, { zone: 'utc' })
    if (dt.isValid) {
      exceptionsByOriginal.set(dt.toISO() || ex.originalStartUtc, ex)
      exceptionsByOriginal.set(dt.toMillis().toString(), ex)
    }
  }

  const results: ExpandedOccurrence[] = []

  // Construct RRULE
  try {
    // Expand against the event's own zone, not UTC.
    //
    // A weekly 09:00 meeting is 09:00 every week *where it lives*. Expanding the
    // rule in UTC pins it to a fixed offset instead, so the moment that zone
    // changes offset the whole series slides: a 09:00 Sydney standup started in
    // September became 10:00 from October onwards, for half the year, silently.
    //
    // rrule.js has no timezone of its own, so the trick is to hand it wall-clock
    // times dressed as UTC, let it do the calendar arithmetic, then read each
    // result's fields back as wall-clock in the real zone. Luxon resolves the
    // offset per occurrence, which is what makes the series hold its clock time.
    //
    // All-day dates are floating, parked at UTC midnight, so they repeat on the
    // UTC calendar. A zone Luxon cannot resolve - an .ics date reads back as
    // 'floating' - made every date invalid, the rule threw, and the series fell
    // back to its first occurrence alone: every all-day series pulled over
    // CalDAV (birthdays, payments) showed once. A timed series in such a zone
    // was read in this computer's zone, so that is where it repeats; one with
    // no zone at all repeats in UTC, as it always has.
    //
    // Exchange and Outlook name zones the Windows way ("W. Europe Standard
    // Time"), which is no IANA zone; read in this computer's zone, a Berlin
    // meeting viewed from Vietnam sat an hour off for half the year. Those
    // names are translated first.
    const zone = event.allDay || !event.tzid ? 'utc' : (ianaZoneFor(event.tzid) ?? 'local')
    const toWallClockUtc = (dt: DateTime): Date =>
      new Date(
        Date.UTC(
          dt.year,
          dt.month - 1,
          dt.day,
          dt.hour,
          dt.minute,
          dt.second,
          dt.millisecond
        )
      )
    const fromWallClockUtc = (d: Date): DateTime =>
      DateTime.fromObject(
        {
          year: d.getUTCFullYear(),
          month: d.getUTCMonth() + 1,
          day: d.getUTCDate(),
          hour: d.getUTCHours(),
          minute: d.getUTCMinutes(),
          second: d.getUTCSeconds(),
          millisecond: d.getUTCMilliseconds()
        },
        { zone }
      ).toUTC()

    const masterLocal = masterStart.setZone(zone)
    const dtstartWall = toWallClockUtc(masterLocal)
    const wallStamp = (d: Date): string =>
      DateTime.fromJSDate(d, { zone: 'utc' }).toFormat("yyyyMMdd'T'HHmmss'Z'")

    // UNTIL is the one part of a rule that is a real instant: RFC 5545 makes it
    // UTC whenever the start has a zone, and "this and following" writes it as
    // the second before the cut. Everything else here is wall clock dressed as
    // UTC, so UNTIL moves into the same space. Left as it was, a New York series
    // cut at 08:59:59 local (12:59:59Z) still showed its 09:00 that day, and a
    // Ho Chi Minh series ending at its last 09:00 (02:00Z) lost that occurrence.
    const inWallClock = (rule: string): string =>
      rule.replace(/UNTIL=(\d{8}T\d{6})Z/gi, (whole, stamp: string) => {
        const until = DateTime.fromFormat(stamp, "yyyyMMdd'T'HHmmss", { zone: 'utc' })
        return until.isValid ? `UNTIL=${wallStamp(toWallClockUtc(until.setZone(zone)))}` : whole
      })

    const ruleString = inWallClock(
      rrule.includes('DTSTART') ? rrule : `DTSTART:${wallStamp(dtstartWall)}\nRRULE:${rrule}`
    )

    // Expand between rangeStart and rangeEnd, in the same wall-clock space.
    // Expand a bit earlier/later to account for duration overlap.
    const searchStart = toWallClockUtc(
      rangeStart.minus({ milliseconds: Math.min(Math.max(0, durationMillis), MAX_LOOK_BACK_MS) }).setZone(zone)
    )
    const searchEnd = toWallClockUtc(rangeEnd.setZone(zone))

    // Not rrule's own between(): a rule can cost hours or never finish there.
    const dates = boundedBetween(ruleString, dtstartWall, searchStart, searchEnd, budget).map(fromWallClockUtc)

    for (const occurrenceStart of dates) {
      const originalIso = occurrenceStart.toISO()!
      const originalTimestamp = occurrenceStart.toMillis().toString()

      // 1. Check EXDATE
      if (exdateSet.has(originalIso) || exdateSet.has(originalTimestamp)) {
        continue
      }

      // 2. Check Event Exceptions
      const exception = exceptionsByOriginal.get(originalIso) || exceptionsByOriginal.get(originalTimestamp)
      if (exception) {
        if (exception.isCancelled) {
          // Cancelled occurrence
          continue
        }

        // Modified occurrence
        const effectiveStartIso = exception.dtStartUtc || originalIso
        const effectiveStart = DateTime.fromISO(effectiveStartIso, { zone: 'utc' })
        const effectiveEndIso = exception.dtEndUtc || effectiveStart.plus({ milliseconds: durationMillis }).toISO() || ''
        const effectiveEnd = DateTime.fromISO(effectiveEndIso, { zone: 'utc' })

        if (effectiveStart <= rangeEnd && effectiveEnd >= rangeStart) {
          results.push({
            id: `${event.id}_${originalIso}`,
            eventId: event.id,
            calendarId: event.calendarId,
            title: exception.title !== undefined ? exception.title : event.title,
            notes: exception.notes !== undefined ? exception.notes : event.notes,
            location: exception.location !== undefined ? exception.location : event.location,
            startUtc: effectiveStartIso,
            endUtc: effectiveEndIso,
            tzid: exception.tzid || event.tzid,
            // An override may flip all-day-ness for this occurrence alone -
            // Google and Outlook both allow converting a single occurrence of an
            // all-day series into a timed one. undefined inherits the master.
            allDay: exception.allDay !== undefined ? exception.allDay : event.allDay,
            color: exception.color || event.color,
            meetingUrl: event.meetingUrl,
            isRecurring: true,
            isException: true,
            originalStartUtc: originalIso
          })
        }
      } else {
        // Standard recurrence occurrence
        const occurrenceEnd = occurrenceStart.plus({ milliseconds: durationMillis })
        const endIso = occurrenceEnd.toISO() || ''

        if (occurrenceStart <= rangeEnd && occurrenceEnd >= rangeStart) {
          results.push({
            id: `${event.id}_${originalIso}`,
            eventId: event.id,
            calendarId: event.calendarId,
            title: event.title,
            notes: event.notes,
            location: event.location,
            startUtc: originalIso,
            endUtc: endIso,
            tzid: event.tzid,
            allDay: event.allDay,
            color: event.color,
            meetingUrl: event.meetingUrl,
            isRecurring: true,
            isException: false,
            originalStartUtc: originalIso
          })
        }
      }
    }
  } catch {
    // Fallback - a rule rrule cannot parse, or one bounded-rrule.ts will not
    // expand (sub-daily, too long): the master instance alone, if it overlaps.
    if (masterStart <= rangeEnd && masterEnd >= rangeStart) {
      results.push({
        id: `${event.id}_${event.dtStartUtc}`,
        eventId: event.id,
        calendarId: event.calendarId,
        title: event.title,
        notes: event.notes,
        location: event.location,
        startUtc: event.dtStartUtc,
        endUtc: event.dtEndUtc,
        tzid: event.tzid,
        allDay: event.allDay,
        color: event.color,
        meetingUrl: event.meetingUrl,
        isRecurring: true,
        isException: false,
        originalStartUtc: event.dtStartUtc
      })
    }
  }

  return results
}
