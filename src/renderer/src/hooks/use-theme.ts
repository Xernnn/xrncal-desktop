import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ThemeConfig } from '@shared/theme-mode'
import {
  applyCustomBackground,
  applyDocumentTheme,
  shouldUseDarkClass,
  type ThemeMode
} from '@shared/theme-mode'
import { DEFAULT_ACCENT_COLOR } from '@shared/mini-calendar-grid'
import { useSettings } from '../context/SettingsContext'

function getSystemPrefersDark(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

/** The theme the settings describe, applied to the document. */
export function useTheme() {
  const { settings, setSetting } = useSettings()
  const [systemPrefersDark, setSystemPrefersDark] = useState<boolean>(getSystemPrefersDark)
  const mode: ThemeMode = settings.theme

  const themeConfig = useMemo<ThemeConfig>(
    () => ({
      mode: settings.theme,
      accentColor: settings.themeAccent || DEFAULT_ACCENT_COLOR,
      customBgUrl: settings.themeCustomBg || '',
      bgOverlayOpacity: settings.themeOverlayOpacity ?? 0.8,
      bgBlur: settings.themeBlur ?? 8
    }),
    [settings.theme, settings.themeAccent, settings.themeCustomBg, settings.themeOverlayOpacity, settings.themeBlur]
  )

  const isDark = shouldUseDarkClass(mode, systemPrefersDark)

  useEffect(() => {
    applyDocumentTheme(isDark)
  }, [isDark])

  // The accent goes on <html>, not only on the app's root element: pickers,
  // menus and popovers are portalled to <body>, outside that root, and drew in
  // the theme's stock accent instead of the one chosen.
  useEffect(() => {
    const root = document.documentElement.style
    root.setProperty('--accent-color', themeConfig.accentColor)
    root.setProperty('--color-accent-mark', themeConfig.accentColor)
  }, [themeConfig.accentColor])

  // Chrome goes translucent only while a background image is set.
  useEffect(() => {
    applyCustomBackground(Boolean(themeConfig.customBgUrl))
    return () => applyCustomBackground(false)
  }, [themeConfig.customBgUrl])

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (event: MediaQueryListEvent) => setSystemPrefersDark(event.matches)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  const persistMode = useCallback((next: ThemeMode) => setSetting('theme', next), [setSetting])

  return { mode, isDark, themeConfig, persistMode }
}
