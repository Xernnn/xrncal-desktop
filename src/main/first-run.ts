import { Notification } from 'electron'
import type { AppSettings } from '@shared/settings-contract'
import type { ISqliteDatabase } from './db/sqlite-driver'
import { SettingsRepo } from './db/repos/settings-repo'
import { EventsRepo } from './db/repos/events-repo'
import { CalendarsRepo } from './db/repos/calendars-repo'
import { mt } from './i18n-main'

/**
 * Settings whose default changed when xrncal started following the computer
 * (language, clock, first day of the week) and looking like a regular calendar
 * (system theme, header always shown). A profile already in use keeps what it
 * has been showing for these: an Australian English desktop would otherwise
 * have switched a long-time user to a 12-hour clock they never chose.
 */
const PINNED_FOR_EXISTING_PROFILES = ['locale', 'timeFormat', 'firstDayOfWeek', 'theme', 'autoHideHeader'] as const

/** What those settings were before their defaults moved. */
const PREVIOUS_DEFAULTS: Pick<AppSettings, (typeof PINNED_FOR_EXISTING_PROFILES)[number]> = {
  locale: 'en',
  timeFormat: '24h',
  firstDayOfWeek: 1,
  theme: 'dark',
  autoHideHeader: true
}

/**
 * The welcome screen and the new defaults are for a new profile. One that
 * already has events or calendars of its own was set up before either existed:
 * it is marked welcomed, and keeps the values it has been showing - once, the
 * first time this build opens it.
 */
export function settleExistingProfile(db: ISqliteDatabase): void {
  const settings = new SettingsRepo(db)
  if (settings.hasSetting('welcomeDone')) return
  const used = new EventsRepo(db).hasAnyEvents() || new CalendarsRepo(db).listCalendars().length > 1
  if (!used) return
  for (const key of PINNED_FOR_EXISTING_PROFILES) {
    if (!settings.hasSetting(key)) settings.setSetting(key, PREVIOUS_DEFAULTS[key])
  }
  settings.setSetting('welcomeDone', true)
}

/**
 * Said once, the first time closing the window leaves xrncal running: a window
 * that closes without the app quitting is a surprise until it has been
 * explained.
 */
export function noticeRunningInTray(db: ISqliteDatabase): void {
  const settings = new SettingsRepo(db)
  if (settings.getFlag('trayNotice') || !Notification.isSupported()) return
  settings.setFlag('trayNotice')
  new Notification({ title: mt('tray.stillRunningTitle'), body: mt('tray.stillRunningBody') }).show()
}
