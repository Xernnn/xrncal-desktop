import { nativeTheme } from 'electron'

const DARK_CANVAS = '#2b2d31'
const LIGHT_CANVAS = '#f7f6f3'

/**
 * The canvas colour a new window is painted with before the renderer mounts,
 * in the theme it is about to draw - a fixed dark colour flashed dark on every
 * light-themed start, which "follow the system" made the common case.
 * `nativeTheme.themeSource` already carries the chosen theme (setting-effects.ts).
 */
export function windowBackground(): string {
  return nativeTheme.shouldUseDarkColors ? DARK_CANVAS : LIGHT_CANVAS
}
