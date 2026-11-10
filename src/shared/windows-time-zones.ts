import { IANAZone } from 'luxon'

/**
 * Windows time zone names, the form Exchange, Outlook and Microsoft Graph use
 * ("W. Europe Standard Time"), and the IANA zone CLDR's windowsZones gives each.
 *
 * Shared because both sides need it: the Graph sync names zones on the way out
 * (graph-time-zones.ts), and expanding a series needs a real zone to hold its
 * clock time, whatever wrote its TZID.
 *
 * One zone per Windows name. Graph's outgoing choice is the first row here that
 * keeps an event's clock, so the order of this list is part of what gets sent.
 */
export const WINDOWS_ZONES: readonly (readonly [iana: string, windows: string])[] = [
  ['Etc/UTC', 'UTC'],
  ['Pacific/Honolulu', 'Hawaiian Standard Time'],
  ['America/Anchorage', 'Alaskan Standard Time'],
  ['America/Los_Angeles', 'Pacific Standard Time'],
  ['America/Phoenix', 'US Mountain Standard Time'],
  ['America/Denver', 'Mountain Standard Time'],
  ['America/Chicago', 'Central Standard Time'],
  ['America/Mexico_City', 'Central Standard Time (Mexico)'],
  ['America/Regina', 'Canada Central Standard Time'],
  ['America/Bogota', 'SA Pacific Standard Time'],
  ['America/New_York', 'Eastern Standard Time'],
  ['America/Halifax', 'Atlantic Standard Time'],
  ['America/St_Johns', 'Newfoundland Standard Time'],
  ['America/Sao_Paulo', 'E. South America Standard Time'],
  ['America/Argentina/Buenos_Aires', 'Argentina Standard Time'],
  ['America/Santiago', 'Pacific SA Standard Time'],
  ['Atlantic/Azores', 'Azores Standard Time'],
  ['Europe/London', 'GMT Standard Time'],
  ['Atlantic/Reykjavik', 'Greenwich Standard Time'],
  ['Europe/Berlin', 'W. Europe Standard Time'],
  ['Europe/Budapest', 'Central Europe Standard Time'],
  ['Europe/Paris', 'Romance Standard Time'],
  ['Europe/Warsaw', 'Central European Standard Time'],
  ['Africa/Lagos', 'W. Central Africa Standard Time'],
  ['Europe/Bucharest', 'GTB Standard Time'],
  ['Europe/Helsinki', 'FLE Standard Time'],
  ['Africa/Cairo', 'Egypt Standard Time'],
  ['Africa/Johannesburg', 'South Africa Standard Time'],
  ['Europe/Istanbul', 'Turkey Standard Time'],
  ['Asia/Jerusalem', 'Israel Standard Time'],
  ['Asia/Riyadh', 'Arab Standard Time'],
  ['Europe/Moscow', 'Russian Standard Time'],
  ['Africa/Nairobi', 'E. Africa Standard Time'],
  ['Asia/Tehran', 'Iran Standard Time'],
  ['Asia/Dubai', 'Arabian Standard Time'],
  ['Asia/Kabul', 'Afghanistan Standard Time'],
  ['Asia/Karachi', 'Pakistan Standard Time'],
  ['Asia/Kolkata', 'India Standard Time'],
  ['Asia/Kathmandu', 'Nepal Standard Time'],
  ['Asia/Dhaka', 'Bangladesh Standard Time'],
  ['Asia/Bangkok', 'SE Asia Standard Time'],
  ['Asia/Shanghai', 'China Standard Time'],
  ['Asia/Singapore', 'Singapore Standard Time'],
  ['Australia/Perth', 'W. Australia Standard Time'],
  ['Asia/Taipei', 'Taipei Standard Time'],
  ['Asia/Tokyo', 'Tokyo Standard Time'],
  ['Asia/Seoul', 'Korea Standard Time'],
  ['Australia/Adelaide', 'Cen. Australia Standard Time'],
  ['Australia/Darwin', 'AUS Central Standard Time'],
  ['Australia/Brisbane', 'E. Australia Standard Time'],
  ['Australia/Sydney', 'AUS Eastern Standard Time'],
  ['Australia/Hobart', 'Tasmania Standard Time'],
  ['Pacific/Port_Moresby', 'West Pacific Standard Time'],
  ['Pacific/Auckland', 'New Zealand Standard Time'],
  ['Pacific/Fiji', 'Fiji Standard Time'],
  ['Pacific/Tongatapu', 'Tonga Standard Time']
]


/**
 * More Windows names, read but never written: an .ics from Exchange or a CalDAV
 * server fronting it may carry any of them. Kept out of WINDOWS_ZONES so adding
 * one can never change which name an outgoing event is given.
 */
export const READ_ONLY_WINDOWS_ZONES: Readonly<Record<string, string>> = {
  'Dateline Standard Time': 'Etc/GMT+12',
  'UTC-11': 'Etc/GMT+11',
  'Aleutian Standard Time': 'America/Adak',
  'Marquesas Standard Time': 'Pacific/Marquesas',
  'UTC-09': 'Etc/GMT+9',
  'Pacific Standard Time (Mexico)': 'America/Tijuana',
  'UTC-08': 'Etc/GMT+8',
  'Mountain Standard Time (Mexico)': 'America/Mazatlan',
  'Yukon Standard Time': 'America/Whitehorse',
  'Central America Standard Time': 'America/Guatemala',
  'Easter Island Standard Time': 'Pacific/Easter',
  'Eastern Standard Time (Mexico)': 'America/Cancun',
  'Haiti Standard Time': 'America/Port-au-Prince',
  'Cuba Standard Time': 'America/Havana',
  'US Eastern Standard Time': 'America/Indiana/Indianapolis',
  'Turks And Caicos Standard Time': 'America/Grand_Turk',
  'Paraguay Standard Time': 'America/Asuncion',
  'Venezuela Standard Time': 'America/Caracas',
  'Central Brazilian Standard Time': 'America/Cuiaba',
  'SA Western Standard Time': 'America/La_Paz',
  'Tocantins Standard Time': 'America/Araguaina',
  'SA Eastern Standard Time': 'America/Cayenne',
  'Greenland Standard Time': 'America/Nuuk',
  'Montevideo Standard Time': 'America/Montevideo',
  'Magallanes Standard Time': 'America/Punta_Arenas',
  'Saint Pierre Standard Time': 'America/Miquelon',
  'Bahia Standard Time': 'America/Bahia',
  'UTC-02': 'Etc/GMT+2',
  'Mid-Atlantic Standard Time': 'Etc/GMT+2',
  'Cape Verde Standard Time': 'Atlantic/Cape_Verde',
  'Coordinated Universal Time': 'Etc/UTC',
  'Morocco Standard Time': 'Africa/Casablanca',
  'Sao Tome Standard Time': 'Africa/Sao_Tome',
  'Jordan Standard Time': 'Asia/Amman',
  'Middle East Standard Time': 'Asia/Beirut',
  'Syria Standard Time': 'Asia/Damascus',
  'West Bank Standard Time': 'Asia/Hebron',
  'E. Europe Standard Time': 'Europe/Chisinau',
  'Kaliningrad Standard Time': 'Europe/Kaliningrad',
  'Libya Standard Time': 'Africa/Tripoli',
  'Namibia Standard Time': 'Africa/Windhoek',
  'South Sudan Standard Time': 'Africa/Juba',
  'Sudan Standard Time': 'Africa/Khartoum',
  'Arabic Standard Time': 'Asia/Baghdad',
  'Belarus Standard Time': 'Europe/Minsk',
  'Volgograd Standard Time': 'Europe/Volgograd',
  'Astrakhan Standard Time': 'Europe/Astrakhan',
  'Azerbaijan Standard Time': 'Asia/Baku',
  'Russia Time Zone 3': 'Europe/Samara',
  'Mauritius Standard Time': 'Indian/Mauritius',
  'Saratov Standard Time': 'Europe/Saratov',
  'Georgian Standard Time': 'Asia/Tbilisi',
  'Caucasus Standard Time': 'Asia/Yerevan',
  'Ekaterinburg Standard Time': 'Asia/Yekaterinburg',
  'West Asia Standard Time': 'Asia/Tashkent',
  'Qyzylorda Standard Time': 'Asia/Qyzylorda',
  'Sri Lanka Standard Time': 'Asia/Colombo',
  'Omsk Standard Time': 'Asia/Omsk',
  'Myanmar Standard Time': 'Asia/Yangon',
  'Altai Standard Time': 'Asia/Barnaul',
  'W. Mongolia Standard Time': 'Asia/Hovd',
  'North Asia Standard Time': 'Asia/Krasnoyarsk',
  'N. Central Asia Standard Time': 'Asia/Novosibirsk',
  'Tomsk Standard Time': 'Asia/Tomsk',
  'North Asia East Standard Time': 'Asia/Irkutsk',
  'Ulaanbaatar Standard Time': 'Asia/Ulaanbaatar',
  'Aus Central W. Standard Time': 'Australia/Eucla',
  'Transbaikal Standard Time': 'Asia/Chita',
  'North Korea Standard Time': 'Asia/Pyongyang',
  'Yakutsk Standard Time': 'Asia/Yakutsk',
  'Vladivostok Standard Time': 'Asia/Vladivostok',
  'Lord Howe Standard Time': 'Australia/Lord_Howe',
  'Bougainville Standard Time': 'Pacific/Bougainville',
  'Russia Time Zone 10': 'Asia/Srednekolymsk',
  'Magadan Standard Time': 'Asia/Magadan',
  'Norfolk Standard Time': 'Pacific/Norfolk',
  'Sakhalin Standard Time': 'Asia/Sakhalin',
  'Central Pacific Standard Time': 'Pacific/Guadalcanal',
  'Russia Time Zone 11': 'Asia/Kamchatka',
  'Kamchatka Standard Time': 'Asia/Kamchatka',
  'UTC+12': 'Etc/GMT-12',
  'Chatham Islands Standard Time': 'Pacific/Chatham',
  'UTC+13': 'Etc/GMT-13',
  'Samoa Standard Time': 'Pacific/Apia',
  'Line Islands Standard Time': 'Pacific/Kiritimati'
}

/**
 * The IANA zone for a zone name: a Windows name from the tables above, or an
 * IANA name as it is. Null for anything else, such as "tzone://Microsoft/Custom".
 */
export function ianaZoneFor(name: string | undefined | null): string | null {
  if (!name) return null
  const windows = WINDOWS_ZONES.find(([, w]) => w === name)?.[0] ?? READ_ONLY_WINDOWS_ZONES[name]
  if (windows && IANAZone.isValidZone(windows)) return windows
  return IANAZone.isValidZone(name) ? name : null
}
