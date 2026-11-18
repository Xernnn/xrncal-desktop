import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Deleting a one-off event raised a native, unthemed "Are you sure?" and then
 * offered Undo as well: two safety nets, one in a different visual language
 * from every other dialog (middle-click already deleted without it). Restoring
 * a backup, removing a sign-in client and unsubscribing from a feed asked the
 * same native way. Native dialogs also take down headless Electron, so the
 * e2e suite could not reach any of them. Deletes now rely on Undo; the three
 * that cannot be undone ask in the app's own rows.
 */

const RENDERER = join(__dirname, '../src/renderer/src')

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sources(path)
    return /\.(ts|tsx)$/.test(name) ? [path] : []
  })
}

describe('the renderer', () => {
  it('raises no native confirm, alert or prompt', () => {
    const calls = sources(RENDERER).flatMap((file) =>
      readFileSync(file, 'utf8')
        .split('\n')
        .map((line, index) => ({ file, line: index + 1, text: line }))
        .filter(({ text }) => /(?<![\w.])(?:window\.)?(?:confirm|alert|prompt)\s*\(/.test(text))
        .map(({ file, line, text }) => `${file.slice(RENDERER.length + 1)}:${line}: ${text.trim()}`)
    )
    expect(calls).toEqual([])
  })
})
