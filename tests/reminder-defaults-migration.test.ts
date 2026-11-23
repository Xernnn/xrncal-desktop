import { describe, it, expect, beforeEach } from 'vitest'
import { createSqliteDriver, type ISqliteDatabase } from '../src/main/db/sqlite-driver'
import { runMigrations, seedDefaultData } from '../src/main/db/database'
import { SettingsRepo } from '../src/main/db/repos/settings-repo'
import { DEFAULT_APP_SETTINGS } from '../src/shared/settings-contract'

/**
 * The default reminders are One Calendar's: 15 minutes before a timed event,
 * 12 hours before an all-day one (the day before at 12:00). They were 10
 * minutes and none. Migration 032 moves a profile that still holds those old
 * values to the new ones, once; any other choice stays.
 */
describe('the default reminders', () => {
  let db: ISqliteDatabase
  let settings: SettingsRepo

  beforeEach(() => {
    db = createSqliteDriver(':memory:')
    runMigrations(db)
    seedDefaultData(db)
    settings = new SettingsRepo(db)
  })

  /** Stored as a build before migration 032 left them, then opened by this one. */
  function upgrade(stored: { timed?: number | null; allDay?: number | null }): void {
    if (stored.timed !== undefined) settings.setSetting('defaultReminderMinutes', stored.timed)
    if (stored.allDay !== undefined) settings.setSetting('defaultAllDayReminderMinutes', stored.allDay)
    db.prepare('DELETE FROM schema_migrations WHERE version >= 32').run()
    runMigrations(db)
  }

  const current = () => [settings.getSetting('defaultReminderMinutes'), settings.getSetting('defaultAllDayReminderMinutes')]

  it('are 15 minutes and 12 hours on a new profile', () => {
    expect([DEFAULT_APP_SETTINGS.defaultReminderMinutes, DEFAULT_APP_SETTINGS.defaultAllDayReminderMinutes]).toEqual([15, 720])
    expect(current()).toEqual([15, 720])
  })

  it('move a profile that still holds the old defaults to the new ones', () => {
    upgrade({ timed: 10, allDay: null })
    expect(current()).toEqual([15, 720])
  })

  it('move a profile that never stored them, by the new defaults', () => {
    upgrade({})
    expect(current()).toEqual([15, 720])
  })

  it('leave any other choice as it is', () => {
    upgrade({ timed: 5, allDay: 900 })
    expect(current()).toEqual([5, 900])
    upgrade({ timed: null, allDay: 2340 })
    expect(current()).toEqual([null, 2340])
  })

  it('move them once: the old values picked again afterwards stay', () => {
    upgrade({ timed: 10, allDay: null })
    settings.setSetting('defaultReminderMinutes', 10)
    settings.setSetting('defaultAllDayReminderMinutes', null)
    runMigrations(db)
    expect(current()).toEqual([10, null])
  })
})
