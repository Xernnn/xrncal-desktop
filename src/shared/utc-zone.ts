/** Zone names that mean UTC itself, lower-cased. */
const UTC_ZONES = new Set([
  'utc',
  'etc/utc',
  'uct',
  'etc/uct',
  'gmt',
  'etc/gmt',
  'gmt0',
  'etc/gmt0',
  'etc/gmt+0',
  'etc/gmt-0',
  'greenwich',
  'etc/greenwich',
  'universal',
  'etc/universal',
  'zulu',
  'etc/zulu'
])

/** Whether a zone name is UTC under one of its spellings. A time read from an
 *  .ics as a bare `...Z` instant comes back with the zone 'UTC'. */
export function isUtcZone(tzid: string): boolean {
  return UTC_ZONES.has(tzid.trim().toLowerCase())
}
