import { describe, it, expect } from 'vitest'
import { resources } from '../src/renderer/src/i18n'

/**
 * The setting that turns the lunar dates under the solar ones on and off was
 * called "Lunar & solar terms" ("Lịch âm & Tiết khí"), in Settings and on the
 * welcome's first page. xrncal shows no solar terms (tiết khí) anywhere, so the
 * name promised something the switch does not do. It is named for what it
 * shows, and no string in any language mentions solar terms.
 */

function strings(node: unknown): string[] {
  if (typeof node === 'string') return [node]
  if (node === null || typeof node !== 'object') return []
  return Object.values(node as Record<string, unknown>).flatMap(strings)
}

describe('the lunar dates setting', () => {
  it('is named for the lunar dates it shows', () => {
    expect(resources.en.translation.settings.lunar).toBe('Lunar dates')
    expect(resources.vi.translation.settings.lunar).toBe('Ngày âm lịch')
  })

  it('promises no solar terms in any language', () => {
    for (const [locale, bundle] of Object.entries(resources)) {
      const promised = strings(bundle.translation).filter((s) => /solar term|tiết khí/i.test(s))
      expect(promised, locale).toEqual([])
    }
  })
})
