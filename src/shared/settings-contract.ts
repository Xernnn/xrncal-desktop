/**
 * Application Settings Interface & Defaults
 */

export interface AppSettings {
  locale: 'en' | 'vi'
  showLunar: boolean
  showWeekNumbers: boolean
  showMiniCalendar: boolean
  /** The day weeks start on: 0 = Sunday, 1 = Monday, 6 = Saturday. Until it is
   *  chosen it follows the computer's region (see `defaultsForSystem`). */
  firstDayOfWeek: number
  timeFormat: '12h' | '24h'
  theme: 'system' | 'dark' | 'light'
  themeAccent?: string
  themeCustomBg?: string
  themeOverlayOpacity?: number
  themeBlur?: number
  /** Taskbar-style auto-hide for the top app header (menu/nav/search/view bar).
   *  Off by default: the header holds Today, New event and the view switcher,
   *  which a new user has to be able to see. */
  autoHideHeader: boolean
  /** Hour the Day/Week timed grid is scrolled to by default (0-23). */
  dayStartHour: number
  /** Row height of one hour in the Day/Week timed grid. */
  hourBlockSize: 'small' | 'medium' | 'large'
  /** IANA zone name (e.g. "America/New_York") shown as a second hour gutter in
   *  Day/Week view - empty means disabled. */
  secondaryTimezone: string
  /** IANA zones the event editor's zone picker lists first, comma-separated
   *  ("Asia/Ho_Chi_Minh,Europe/London") - a setting holds only plain values.
   *  Empty: the picker leads with this computer's zone alone. */
  preferredTimeZones: string
  /** Where the user was, from when ("Asia/Ho_Chi_Minh,2026-01-28=Australia/Sydney",
   *  see zone-history.ts): the zone an event that names none opens in, by its
   *  date. Empty: this computer's zone. */
  zoneHistory: string
  /** Grid step that dragging, dropping and edge-resizing snap to, in minutes.
   *  Also the shortest event a resize can produce - a 15-minute floor under a
   *  one-hour tick would let a drag land off the grid it just snapped to. */
  dragSnapMinutes: 15 | 30 | 60
  /** Gap between the times the event editor's time lists offer, in minutes.
   *  Separate from the drag step: a coarse list is quicker to pick from while
   *  a drag still lands on quarter hours, or the other way round. */
  timePickerStepMinutes: 15 | 30 | 60
  /** How long a new timed event is when it was started without a range of its
   *  own: a click on an empty slot, "New event here", Create, N. A dragged
   *  range keeps the range dragged (see event-length.ts). */
  defaultEventMinutes: 15 | 30 | 45 | 60 | 90 | 120
  /** Title suggestions always show the calendar's colour dot; this adds its name
   *  next to it. Off keeps the list to one line per suggestion. */
  suggestionShowCalendarName: boolean
  /** Minutes before a timed event that it rings when it names no reminders of
   *  its own (and its calendar publishes no default). null: none. */
  defaultReminderMinutes: number | null
  /** The same for all-day events, counted back from midnight on the day, so
   *  900 is "the day before at 09:00". null: none. */
  defaultAllDayReminderMinutes: number | null
  /** Look for new releases on GitHub and install them on quit. The only
   *  request the app makes that is not to a calendar provider. */
  checkForUpdates: boolean
  /** Once a week, copy the database into the profile's `backups` folder,
   *  keeping the last four (`src/main/auto-backup.ts`). */
  autoBackup: boolean
  /** Closing the main window leaves xrncal running in the tray, so reminders
   *  and sync carry on. Off: closing the window quits. Has no effect where the
   *  desktop has no tray. */
  closeToTray: boolean
  /** Start xrncal, in the tray, when the user signs in to the computer - the
   *  only way reminders ring after a restart. Installed builds only. */
  launchAtLogin: boolean
  /** The emojis picked in the event editor and how often ("🍴:5 🎂:2", see
   *  title-emoji.ts): its "frequently used" row. Not a control. */
  favoriteEmojis: string
  /** The first-run welcome has been shown (or was not needed: a profile that
   *  already had events when this setting arrived). Not a control. */
  welcomeDone: boolean
  /** The computer's zone when xrncal last looked; a different one now is a
   *  move, added to `zoneHistory`. Empty until the first look. Not a control. */
  lastSeenZone: string
}

/**
 * What a setting is until the user picks something. `locale`, `timeFormat` and
 * `firstDayOfWeek` are overridden in the main process by what the computer is
 * set up for (`defaultsForSystem`), so these three are only the fallback.
 */
export const DEFAULT_APP_SETTINGS: AppSettings = {
  locale: 'en',
  showLunar: true,
  showWeekNumbers: true,
  // The sidebar holds the calendar list now, not just the mini calendar, so it
  // starts shown. Only the default moves: a user who switched it off stays off.
  showMiniCalendar: true,
  firstDayOfWeek: 1, // ISO standard Monday
  timeFormat: '24h',
  theme: 'system',
  themeAccent: '#5865f2',
  themeCustomBg: '',
  themeOverlayOpacity: 0.8,
  themeBlur: 8,
  autoHideHeader: false,
  dayStartHour: 7,
  hourBlockSize: 'medium',
  secondaryTimezone: '',
  preferredTimeZones: '',
  zoneHistory: '',
  dragSnapMinutes: 15,
  timePickerStepMinutes: 15,
  // An hour is what every new event was before the length could be chosen.
  defaultEventMinutes: 60,
  suggestionShowCalendarName: true,
  // Ten minutes is what every timed event rang with before reminders existed.
  defaultReminderMinutes: 10,
  defaultAllDayReminderMinutes: null,
  checkForUpdates: true,
  autoBackup: true,
  closeToTray: true,
  launchAtLogin: false,
  favoriteEmojis: '',
  welcomeDone: false,
  lastSeenZone: ''
}

/**
 * Whether `key` names a setting. The `settings` table also holds rows that are
 * not settings - the encrypted `token:<accountId>` credentials - and the IPC
 * handed those to the renderer and let it overwrite any key at all.
 */
export function isAppSettingKey(key: unknown): key is keyof AppSettings {
  return typeof key === 'string' && Object.prototype.hasOwnProperty.call(DEFAULT_APP_SETTINGS, key)
}
