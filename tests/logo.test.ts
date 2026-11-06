import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// resources/icon.svg is the logo; `npm run icons` makes the other copies from it. A new design
// once reached the SVG and the PNG and stopped there, so the website, the README and every
// Windows icon kept showing the old one.
const projectFile = (path: string) => resolve(import.meta.dirname, '..', path)
const source = readFileSync(projectFile('resources/icon.svg'), 'utf8')
const withoutRootTag = (svg: string) => svg.replace(/^<svg [^>]*>/, '').trim()

function hex(bytes: number[]): string {
  return `#${bytes.map((b) => b.toString(16).padStart(2, '0')).join('')}`.toUpperCase()
}

/** Each entry of an .ico: its size, and the colour 12% in from the left edge, half way down. */
function icoEntries(ico: Buffer): { size: number; isBitmap: boolean; tile: string }[] {
  return Array.from({ length: ico.readUInt16LE(4) }, (_, i) => {
    const entry = 6 + i * 16
    const size = ico[entry] || 256
    const offset = ico.readUInt32LE(entry + 12)
    const isBitmap = ico.readUInt32LE(offset) === 40
    // A 40-byte header, then 32-bit BGRA rows from the bottom up.
    const rowsBelow = size - 1 - Math.floor(size / 2)
    const pixel = offset + 40 + (rowsBelow * size + Math.floor(size * 0.12)) * 4
    return { size, isBitmap, tile: hex([ico[pixel + 2], ico[pixel + 1], ico[pixel]]) }
  })
}

describe('the logo', () => {
  it.each(['site/mark.svg', 'docs/assets/mark.svg'])('%s draws what icon.svg draws', (path) => {
    const mark = readFileSync(projectFile(path), 'utf8')

    expect(withoutRootTag(mark)).toBe(withoutRootTag(source))
    expect(mark).toContain('aria-label="xrncal"')
  })

  it('has every Windows size in icon.ico, in the colour of icon.svg', () => {
    const tile = /<rect width="100" height="100" fill="(#[0-9A-F]{6})"/.exec(source)?.[1]
    const entries = icoEntries(readFileSync(projectFile('resources/icon.ico')))

    expect(tile).toBeDefined()
    expect(entries).toEqual(
      [256, 128, 64, 48, 32, 16].map((size) => ({ size, isBitmap: true, tile }))
    )
  })
})
