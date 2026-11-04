import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AppLocale } from '@shared/ipc-contract'
import { DEFAULT_APP_SETTINGS, type AppSettings } from '@shared/settings-contract'
import { showFriendlyError } from '../components/ui/toast'

/**
 * The app's settings, read once and kept here: what every control in Settings
 * shows and what the views are drawn with.
 *
 * Before this, App held each setting in a `useState` of its own and handed the
 * value and a setter for it to the Settings panel as props (sixty of them), while
 * the theme hook and the Appearance tab each read the whole table again for
 * themselves. App also re-read everything every time the visible range moved.
 */
export interface SettingsContextValue {
  /** The stored settings, or the defaults until they have been read. */
  settings: AppSettings
  /** True once the stored settings have been read (or there are none to read). */
  ready: boolean
  /**
   * Show `value` at once and store it. A setting that cannot be stored goes back
   * to what it was, with a toast unless `quiet`; resolves to whether it was stored.
   */
  setSetting: <K extends keyof AppSettings>(
    key: K,
    value: AppSettings[K],
    options?: { quiet?: boolean }
  ) => Promise<boolean>
  /** Switch the interface language, here and in the main process (tray, notifications). */
  setLanguage: (next: AppLocale) => Promise<void>
}

const SettingsContext = createContext<SettingsContextValue | null>(null)

export const SettingsProvider = SettingsContext.Provider

/** The settings and how to change them. Only below a `SettingsProvider`. */
export function useSettings(): SettingsContextValue {
  const value = useContext(SettingsContext)
  if (!value) throw new Error('useSettings() needs a SettingsProvider above it')
  return value
}

function asLocale(value: unknown): AppLocale {
  return value === 'vi' ? 'vi' : 'en'
}

/** The state behind `SettingsProvider`: App calls this once and provides it. */
export function useSettingsState(): SettingsContextValue {
  const { i18n } = useTranslation()
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_APP_SETTINGS)
  // Without the bridge (a renderer opened on its own) there is nothing to wait for.
  const [ready, setReady] = useState(() => !window.xrncal?.settings)
  // What is on screen, for putting a setting back when storing it fails.
  const current = useRef(settings)
  useEffect(() => {
    current.current = settings
  }, [settings])

  useEffect(() => {
    const api = window.xrncal?.settings
    if (!api) return
    let cancelled = false
    void (async () => {
      try {
        const stored = await api.getAll()
        if (cancelled) return
        setSettings({ ...DEFAULT_APP_SETTINGS, ...stored })
        const locale = asLocale(stored.locale)
        if (locale !== i18n.language) await i18n.changeLanguage(locale)
        await window.xrncal?.app?.setLocale?.(locale)
      } catch {
        // The defaults stay; every control still works and stores what it is set to.
      }
      if (!cancelled) setReady(true)
    })()
    return () => {
      cancelled = true
    }
  }, [i18n])

  const setSetting = useCallback(
    async <K extends keyof AppSettings>(
      key: K,
      value: AppSettings[K],
      options?: { quiet?: boolean }
    ): Promise<boolean> => {
      const previous = current.current[key]
      setSettings((s) => (s[key] === value ? s : { ...s, [key]: value }))
      const api = window.xrncal?.settings
      if (!api) return true
      try {
        await api.set(key, value)
        return true
      } catch (err) {
        // Only if nothing has changed it again since.
        setSettings((s) => (s[key] === value ? { ...s, [key]: previous } : s))
        if (!options?.quiet) showFriendlyError(err, i18n.t('toast.settingFailed'))
        return false
      }
    },
    [i18n]
  )

  const setLanguage = useCallback(
    async (next: AppLocale): Promise<void> => {
      if (next === i18n.language) return
      await i18n.changeLanguage(next)
      await setSetting('locale', next)
      await window.xrncal?.app?.setLocale?.(next)
    },
    [i18n, setSetting]
  )

  return useMemo(
    () => ({ settings, ready, setSetting, setLanguage }),
    [settings, ready, setSetting, setLanguage]
  )
}
