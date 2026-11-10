import { DateTime, IANAZone } from 'luxon'
import { WINDOWS_ZONES, ianaZoneFor } from '@shared/windows-time-zones'

/**
 * Which time zone name to give Microsoft Graph for an event.
 *
 * Graph documents `timeZone` as a Windows zone name ("SE Asia Standard Time")
 * or one of a fixed list of IANA names, and warns that create and update may not
 * take all of those. Events went out with whatever IANA zone they had -
 * Asia/Ho_Chi_Minh is not on the list. A Windows name is the form Graph is sure
 * to take, and a series needs a real zone (not UTC) to keep its clock time when
 * summer time starts or ends.
 *
 * The names and their zones live in shared/windows-time-zones.ts. Any other
 * IANA zone is matched to the first one there that keeps the same
 * clock - the same UTC offset on every day of the coming year - so Asia/Ho_Chi_Minh
 * goes out as SE Asia Standard Time (Asia/Bangkok's) and Europe/Amsterdam as
 * W. Europe Standard Time (Europe/Berlin's).
 */
const SAMPLE_DAYS = 366

const windowsCache = new Map<string, string | null>()

/** Whether two zones have the same UTC offset at noon on each day of the coming year. */
function sameClock(a: string, b: string): boolean {
  const start = DateTime.utc().startOf('day').plus({ hours: 12 })
  for (let day = 0; day < SAMPLE_DAYS; day++) {
    const at = start.plus({ days: day })
    if (at.setZone(a).offset !== at.setZone(b).offset) return false
  }
  return true
}

/** The Windows zone name that keeps the same clock as `tzid`, or null for none known. */
export function windowsZoneFor(tzid: string | undefined): string | null {
  if (!tzid || !IANAZone.isValidZone(tzid)) return null
  const cached = windowsCache.get(tzid)
  if (cached !== undefined) return cached

  const found =
    WINDOWS_ZONES.find(([iana]) => iana === tzid)?.[1] ??
    WINDOWS_ZONES.find(([iana]) => sameClock(iana, tzid))?.[1] ??
    null
  windowsCache.set(tzid, found)
  return found
}

/** The IANA zone for a zone name Graph reports (`originalStartTimeZone`). */
export { ianaZoneFor }
