import { describe, it, expect, vi } from 'vitest'
import { MAX_BACKGROUND_BYTES, backgroundImageDataUrl } from '../src/main/background-image'

/**
 * An imported background picture went into the settings whole, as a data:
 * URL: a 10 MB photo put ~13 MB of base64 into one settings row, which every
 * settings read in both windows parsed and shipped over IPC, and every backup
 * copied. It is now capped, and a larger PNG or JPEG is scaled down first.
 */
describe('backgroundImageDataUrl', () => {
  const bytes = (n: number) => Buffer.alloc(n, 7)

  it('keeps a picture under the cap as it is', () => {
    const shrink = vi.fn()
    expect(backgroundImageDataUrl(bytes(10), 'JPG', shrink)).toEqual({
      dataUrl: `data:image/jpeg;base64,${bytes(10).toString('base64')}`
    })
    expect(shrink).not.toHaveBeenCalled()
  })

  it('scales a large photo down and keeps that', () => {
    const small = bytes(1000)
    const shrink = vi.fn(() => small)
    expect(backgroundImageDataUrl(bytes(MAX_BACKGROUND_BYTES + 1), 'png', shrink)).toEqual({
      dataUrl: `data:image/jpeg;base64,${small.toString('base64')}`
    })
  })

  it('refuses a large picture it cannot scale or bring under the cap', () => {
    const big = bytes(MAX_BACKGROUND_BYTES + 1)
    expect(backgroundImageDataUrl(big, 'gif', () => bytes(10))).toEqual({ tooLarge: true })
    expect(backgroundImageDataUrl(big, 'jpeg', () => null)).toEqual({ tooLarge: true })
    expect(backgroundImageDataUrl(big, 'jpeg', () => big)).toEqual({ tooLarge: true })
  })
})
