import { DateTime } from 'luxon'
import type { CalendarEvent, EventException, UpdateEventInput } from './event-model'
import { ianaZoneFor } from './windows-time-zones'

/** The zone a series repeats in - the one its occurrences are expanded in (see expandOccurrences). */
function seriesZone(allDay: boolean, tzid: string | undefined): string {
  return allDay || !tzid ? 'utc' : (ianaZoneFor(tzid) ?? 'local')
}

/** An instant's clock reading in `zone`, as a number that can be added to and subtracted. */
function wallClock(isoUtc: string, zone: string): number {
  return DateTime.fromISO(isoUtc, { zone: 'utc' }).setZone(zone).setZone('utc', { keepLocalTime: true }).toMillis()
}

/**
 * What "all events" sends for a change made on one occurrence.
 *
 * The editor and a drop both describe the occurrence they were opened on: its
 * own date, with the new time. Sent to the series as it stood, that date became
 * the series' first: renaming the fifth meeting of a weekly series and choosing
 * "all events" removed the four before it, here and on the provider after the
 * next sync.
 *
 * The series keeps its first date and takes what changed instead. Its start
 * moves by as much as the occurrence's did, measured on the clock - a 09:00
 * series moved to 10:00 from a winter occurrence is 10:00 in summer too - and
 * it gets the occurrence's new length. An occurrence left where it was leaves
 * the series where it was.
 */
export function seriesWideUpdate(
  input: UpdateEventInput,
  originalStartUtc: string,
  series: { event: CalendarEvent; exceptions: EventException[] }
): UpdateEventInput {
  if (!input.dtStartUtc) return input
  const master = series.event
  const at = Date.parse(originalStartUtc)
  // Where the occurrence was before this change: an earlier move of it alone counts.
  const moved = series.exceptions.find((ex) => Date.parse(ex.originalStartUtc) === at && !ex.isCancelled)
  const occurrenceStartUtc = moved?.dtStartUtc || originalStartUtc

  const fromZone = seriesZone(master.allDay, master.tzid)
  const toZone = seriesZone(input.allDay ?? master.allDay, input.tzid ?? master.tzid)
  const shift = wallClock(input.dtStartUtc, toZone) - wallClock(occurrenceStartUtc, fromZone)
  const start = DateTime.fromMillis(wallClock(master.dtStartUtc, fromZone) + shift, { zone: 'utc' })
    .setZone(toZone, { keepLocalTime: true })
    .toUTC()
  const lengthMs = input.dtEndUtc
    ? Date.parse(input.dtEndUtc) - Date.parse(input.dtStartUtc)
    : Date.parse(master.dtEndUtc) - Date.parse(master.dtStartUtc)
  if (!start.isValid || !Number.isFinite(lengthMs)) return input

  return {
    ...input,
    dtStartUtc: start.toISO()!,
    dtEndUtc: start.plus({ milliseconds: lengthMs }).toISO()!
  }
}
