import { describe, it, expect } from 'vitest'
import { WALLPAPER_PRESETS, presetSetting, wallpaperPreset, wallpaperUrl } from '../src/renderer/src/lib/wallpapers'

/**
 * The preset wallpapers were hot-linked from images.unsplash.com: each launch
 * asked a third party for the picture, offline or behind the VPN kill switch
 * the background was silently blank, and they were the only reason the page's
 * policy let images in from any https address. They ship with the app now,
 * and a background is a preset or an image imported from this computer.
 */
describe('wallpapers', () => {
  const legacy = {
    cosmicNight: 'https://images.unsplash.com/photo-1506703719100-a0f3a48c0f86?q=80&w=1200&auto=format&fit=crop',
    mistyForest: 'https://images.unsplash.com/photo-1448375240586-882707db888b?q=80&w=1200&auto=format&fit=crop',
    purpleSunset: 'https://images.unsplash.com/photo-1518495973542-4542c06a5843?q=80&w=1200&auto=format&fit=crop',
    cyberCity: 'https://images.unsplash.com/photo-1519501025264-65ba15a82390?q=80&w=1200&auto=format&fit=crop'
  } as const

  it('are files of the app, not addresses elsewhere', () => {
    expect(WALLPAPER_PRESETS).toHaveLength(4)
    for (const preset of WALLPAPER_PRESETS) {
      expect(preset.url).toMatch(/\.webp$/)
      expect(preset.url).not.toMatch(/^https?:/)
      expect(wallpaperUrl(presetSetting(preset.key))).toBe(preset.url)
    }
  })

  it('shows a preset saved as its old Unsplash address from the bundled file', () => {
    for (const [key, url] of Object.entries(legacy)) {
      expect(wallpaperPreset(url)).toBe(key)
      expect(wallpaperUrl(url)).toBe(WALLPAPER_PRESETS.find((p) => p.key === key)!.url)
    }
  })

  it('shows an imported image, and nothing for any other address', () => {
    expect(wallpaperUrl('data:image/png;base64,iVBORw0KGgo=')).toBe('data:image/png;base64,iVBORw0KGgo=')
    expect(wallpaperUrl('https://example.com/beach.jpg')).toBe('')
    expect(wallpaperUrl('https://images.unsplash.com/photo-1000000000000-000000000000?w=10')).toBe('')
    expect(wallpaperUrl('')).toBe('')
    expect(wallpaperUrl(undefined)).toBe('')
  })
})
