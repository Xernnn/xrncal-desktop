import { describe, it, expect } from 'vitest'
import { defaultsForSystem } from '../src/shared/locale-defaults'

describe('defaults from the computer', () => {
  it('starts a Vietnamese computer in Vietnamese, 24-hour, weeks from Monday', () => {
    expect(defaultsForSystem('vi-VN', 'vi-VN')).toEqual({ locale: 'vi', timeFormat: '24h', firstDayOfWeek: 1 })
  })

  it('starts a US computer in English, 12-hour, weeks from Sunday', () => {
    expect(defaultsForSystem('en-US', 'en-US')).toEqual({ locale: 'en', timeFormat: '12h', firstDayOfWeek: 0 })
  })

  it('takes the clock and week from the region, not the menu language', () => {
    // English menus with Vietnamese regional formats, as Windows allows.
    expect(defaultsForSystem('en-US', 'vi-VN')).toEqual({ locale: 'en', timeFormat: '24h', firstDayOfWeek: 1 })
    expect(defaultsForSystem('vi', 'en-US')).toMatchObject({ locale: 'vi', timeFormat: '12h', firstDayOfWeek: 0 })
  })

  it('falls back to English for languages the app does not have', () => {
    expect(defaultsForSystem('de-DE', 'de-DE')).toEqual({ locale: 'en', timeFormat: '24h', firstDayOfWeek: 1 })
  })

  it('knows a Saturday-first week', () => {
    expect(defaultsForSystem('ar-EG', 'ar-EG').firstDayOfWeek).toBe(6)
  })

  it('says nothing when it is told nothing usable', () => {
    expect(defaultsForSystem(undefined, undefined)).toEqual({})
    expect(defaultsForSystem('not a tag', undefined)).toEqual({})
  })
})
