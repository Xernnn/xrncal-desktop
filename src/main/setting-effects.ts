import { nativeTheme } from 'electron'
import type { AppSettings } from '@shared/settings-contract'
import { getDatabase } from './db/database'
import { SettingsRepo } from './db/repos/settings-repo'
import { applyLaunchAtLogin } from './launch-at-login'

/**
 * The settings the main process has to act on, not just store. Run when the
 * renderer changes one, and for all of them at startup.
 */
export function applySettingEffect<K extends keyof AppSettings>(key: K, value: AppSettings[K]): void {
  if (key === 'theme') {
    // Chromium's prefers-color-scheme then matches the chosen theme from the
    // first paint, so a window opens in it without a flash of the other one,
    // and native menus and dialogs follow it too.
    nativeTheme.themeSource = value === 'light' || value === 'dark' ? value : 'system'
  } else if (key === 'launchAtLogin') {
    applyLaunchAtLogin(Boolean(value))
  }
}

export function applySavedSettingEffects(): void {
  try {
    const settings = new SettingsRepo(getDatabase()).getAllSettings()
    applySettingEffect('theme', settings.theme)
    applySettingEffect('launchAtLogin', settings.launchAtLogin)
  } catch {
    // No database: the defaults stand.
  }
}
