import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/** The page loads images from itself only (and imported ones as data:). The
 *  preset wallpapers were the one reason it took any https address; they ship
 *  with the app now (see wallpapers.test.ts). */
describe("the renderer's Content-Security-Policy", () => {
  it('allows images from the app and data: URLs only', () => {
    const html = readFileSync(join(__dirname, '../src/renderer/index.html'), 'utf8')
    const csp = /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/.exec(html)?.[1] ?? ''
    const imgSrc = csp
      .split(';')
      .map((d) => d.trim())
      .find((d) => d.startsWith('img-src'))
    expect(imgSrc).toBe("img-src 'self' data:")
  })
})
