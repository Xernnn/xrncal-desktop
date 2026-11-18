/*
 * The preset wallpapers ship with the app. They are photos from Unsplash
 * (images.unsplash.com photo-1506703719100-a0f3a48c0f86, -1448375240586-882707db888b,
 * -1518495973542-4542c06a5843 and -1519501025264-65ba15a82390), used under the
 * Unsplash License, not this repository's MIT licence; cropped to 1600x900 WebP.
 */
import cosmicNight from '../assets/wallpapers/cosmic-night.webp'
import mistyForest from '../assets/wallpapers/misty-forest.webp'
import purpleSunset from '../assets/wallpapers/purple-sunset.webp'
import cyberCity from '../assets/wallpapers/cyber-city.webp'

export type WallpaperPreset = 'cosmicNight' | 'mistyForest' | 'purpleSunset' | 'cyberCity'

/**
 * The presets, in the order Appearance lists them. They used to be hot-linked
 * from Unsplash, the one remote image the app loaded: every launch asked a
 * third party for it, offline or behind a VPN kill switch the background was
 * blank, and it was the only reason the page allowed images from any https
 * address. The setting now stores `preset:<key>`.
 */
export const WALLPAPER_PRESETS: readonly { key: WallpaperPreset; url: string; unsplashId: string }[] = [
  { key: 'cosmicNight', url: cosmicNight, unsplashId: 'photo-1506703719100-a0f3a48c0f86' },
  { key: 'mistyForest', url: mistyForest, unsplashId: 'photo-1448375240586-882707db888b' },
  { key: 'purpleSunset', url: purpleSunset, unsplashId: 'photo-1518495973542-4542c06a5843' },
  { key: 'cyberCity', url: cyberCity, unsplashId: 'photo-1519501025264-65ba15a82390' }
]

const PRESET_PREFIX = 'preset:'

/** What the background setting stores for a preset. */
export const presetSetting = (key: WallpaperPreset): string => `${PRESET_PREFIX}${key}`

/** The preset a background setting names - also the Unsplash address a preset
 *  was saved as before they were bundled - or null. */
export function wallpaperPreset(setting: string): WallpaperPreset | null {
  if (setting.startsWith(PRESET_PREFIX)) {
    const key = setting.slice(PRESET_PREFIX.length)
    return WALLPAPER_PRESETS.find((p) => p.key === key)?.key ?? null
  }
  if (/^https:\/\/images\.unsplash\.com\//.test(setting)) {
    return WALLPAPER_PRESETS.find((p) => setting.includes(`/${p.unsplashId}?`) || setting.endsWith(`/${p.unsplashId}`))?.key ?? null
  }
  return null
}

/**
 * The image the background setting shows: a preset (bundled), or an image
 * imported from this computer (a data: URL). Anything else - an address typed
 * when there was a field for one - is no background: the page loads no image
 * from elsewhere.
 */
export function wallpaperUrl(setting: string | undefined): string {
  if (!setting) return ''
  const preset = wallpaperPreset(setting)
  if (preset) return WALLPAPER_PRESETS.find((p) => p.key === preset)!.url
  return setting.startsWith('data:image/') ? setting : ''
}
