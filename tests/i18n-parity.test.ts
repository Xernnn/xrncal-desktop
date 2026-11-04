import { describe, it, expect } from 'vitest'
import { resources } from '../src/renderer/src/i18n'

/** Every renderer source file as text (Vite's glob: this test is typechecked
 *  with the renderer, which has no Node types to read files with). */
const rendererSources = import.meta.glob('../src/renderer/src/**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true
}) as Record<string, string>

/**
 * `vi` and `en` are meant to stay in lockstep. Nothing enforced that, so a key
 * added to one and forgotten in the other silently fell back to English (or to
 * the raw key) at runtime, with no build or test failure.
 */
function keyPaths(node: unknown, prefix = ''): string[] {
  if (node === null || typeof node !== 'object' || Array.isArray(node)) return [prefix]
  return Object.entries(node as Record<string, unknown>).flatMap(([key, value]) =>
    keyPaths(value, prefix ? `${prefix}.${key}` : key)
  )
}

/** The value at a dotted key path, or undefined where the path stops. */
function valueAt(tree: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>(
    (node, key) => (node !== null && typeof node === 'object' ? (node as Record<string, unknown>)[key] : undefined),
    tree
  )
}

describe('i18n resources', () => {
  const en = new Set(keyPaths(resources.en.translation))
  const vi = new Set(keyPaths(resources.vi.translation))

  it('defines the same key set in both locales', () => {
    expect([...en].filter((k) => !vi.has(k))).toEqual([])
    expect([...vi].filter((k) => !en.has(k))).toEqual([])
  })

  it('has no empty translation strings', () => {
    for (const [locale, bundle] of Object.entries(resources)) {
      const empties = keyPaths(bundle.translation).filter((path) => {
        const value = valueAt(bundle.translation, path)
        return typeof value === 'string' && value.trim() === ''
      })
      expect(empties, `empty strings in "${locale}"`).toEqual([])
    }
  })

  // A key the code asks for that no locale has renders as the raw key. The
  // sync-conflict screen did exactly that after its strings were dropped in a
  // cleanup - nothing failed, because nothing checked this direction.
  it('has every key the renderer asks for by name', () => {
    const lookup = (key: string): unknown => valueAt(resources.en.translation, key)
    const missing: string[] = []
    expect(Object.keys(rendererSources).length).toBeGreaterThan(50)
    for (const [file, source] of Object.entries(rendererSources)) {
      for (const match of source.matchAll(/\bt\(\s*'([a-zA-Z0-9_.]+)'/g)) {
        const key = match[1]
        const found = [key, `${key}_one`, `${key}_other`].some((k) => typeof lookup(k) === 'string')
        if (!found) missing.push(`${file.split('src/renderer/src/')[1]}: ${key}`)
      }
    }
    expect(missing).toEqual([])
  })
})
