import type { ISqliteDatabase } from '../sqlite-driver'
import { DEFAULT_APP_SETTINGS, isAppSettingKey, type AppSettings } from '@shared/settings-contract'
import type { SystemDefaults } from '@shared/locale-defaults'

/**
 * Defaults taken from the computer (language, clock, first day of the week),
 * set once at startup. A setting the user has never chosen keeps following
 * them; one they have chosen is a row in the table and wins.
 */
let systemDefaults: SystemDefaults = {}

export function setSystemDefaults(defaults: SystemDefaults): void {
  systemDefaults = { ...defaults }
}

function defaults(): AppSettings {
  return { ...DEFAULT_APP_SETTINGS, ...systemDefaults }
}

/** Rows in the settings table that are app state rather than settings. */
const FLAG_PREFIX = 'flag:'

export class SettingsRepo {
  constructor(private db: ISqliteDatabase) {}

  getAllSettings(): AppSettings {
    const rows = this.db.prepare('SELECT key, value FROM settings').all<{ key: string; value: string }>()
    const settings = defaults()
    // Stored values are JSON as written by setSetting(); each key is trusted to
    // hold its own type, as everywhere settings are read.
    const values = settings as Record<keyof AppSettings, unknown>

    for (const row of rows) {
      // Credentials live in this table too; they are not settings.
      if (!isAppSettingKey(row.key)) continue
      try {
        values[row.key] = JSON.parse(row.value)
      } catch {
        values[row.key] = row.value
      }
    }

    return settings
  }

  getSetting<K extends keyof AppSettings>(key: K): AppSettings[K] {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get<{ value: string }>(key)
    if (!row) {
      return defaults()[key]
    }
    try {
      return JSON.parse(row.value) as AppSettings[K]
    } catch {
      return row.value as unknown as AppSettings[K]
    }
  }

  setSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]): boolean {
    const now = new Date().toISOString()
    const serialized = JSON.stringify(value)

    this.db
      .prepare(
        `INSERT INTO settings (key, value, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      )
      .run(key, serialized, now)

    return true
  }

  /** Whether the user (or the app on their behalf) has ever stored `key`. */
  hasSetting(key: keyof AppSettings): boolean {
    return Boolean(this.db.prepare('SELECT 1 AS present FROM settings WHERE key = ?').get(key))
  }

  /** A one-time marker, such as "the tray notice has been shown". Never sent to
   *  the renderer: getAllSettings and the settings IPC read setting keys only. */
  getFlag(name: string): boolean {
    return Boolean(this.db.prepare('SELECT 1 AS present FROM settings WHERE key = ?').get(FLAG_PREFIX + name))
  }

  setFlag(name: string): void {
    this.db
      .prepare(
        `INSERT INTO settings (key, value, updated_at) VALUES (?, 'true', ?)
         ON CONFLICT(key) DO NOTHING`
      )
      .run(FLAG_PREFIX + name, new Date().toISOString())
  }
}
