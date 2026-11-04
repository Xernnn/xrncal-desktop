import { describe, it, expect } from 'vitest'
import { DateTime } from 'luxon'
import { commandForKey, type KeyContext, type KeyInput } from '../src/shared/keyboard-commands'
import { stepAnchor } from '../src/shared/visible-range'

const key = (k: string, mods: Partial<KeyInput> = {}): KeyInput => ({
  key: k,
  ctrl: false,
  shift: false,
  alt: false,
  inTextField: false,
  onControl: false,
  ...mods
})

const calm: KeyContext = {
  overlayOpen: false,
  searchOpen: false,
  overlayOwnsEscape: false,
  hasSelection: false,
  view: 'week',
  dragSnapMinutes: 15
}

describe('commandForKey', () => {
  it('maps the bare keys of the calendar', () => {
    expect(commandForKey(key('t'), calm)).toEqual({ type: 'today' })
    expect(commandForKey(key('T', { shift: true }), calm)).toEqual({ type: 'today' })
    for (const k of ['k', 'ArrowLeft', 'PageUp']) expect(commandForKey(key(k), calm)).toEqual({ type: 'page', direction: -1 })
    for (const k of ['j', 'ArrowRight', 'PageDown']) expect(commandForKey(key(k), calm)).toEqual({ type: 'page', direction: 1 })
    expect(commandForKey(key('ArrowDown'), calm)).toEqual({ type: 'cursor', direction: 1 })
    expect(commandForKey(key('ArrowUp'), calm)).toEqual({ type: 'cursor', direction: -1 })
    expect(commandForKey(key('n'), calm)).toEqual({ type: 'newEvent' })
    expect(commandForKey(key('c'), calm)).toEqual({ type: 'newEvent' })
    expect(commandForKey(key('/'), calm)).toEqual({ type: 'openSearch' })
    expect(commandForKey(key('?', { shift: true }), calm)).toEqual({ type: 'toggleShortcuts' })
    expect(commandForKey(key('F1'), calm)).toEqual({ type: 'toggleShortcuts' })
    expect(commandForKey(key(','), calm)).toEqual({ type: 'openSettings' })
    expect(commandForKey(key('r'), calm)).toEqual({ type: 'sync' })
    expect(commandForKey(key('x'), calm)).toBeNull()
  })

  it('switches views by number and by letter', () => {
    const views = { '1': 'day', d: 'day', '2': 'week', w: 'week', '3': 'month', m: 'month', '4': 'year', y: 'year', '5': 'list', l: 'list' }
    for (const [k, view] of Object.entries(views)) {
      expect(commandForKey(key(k), calm)).toEqual({ type: 'view', view })
    }
  })

  it('opens the event under the cursor on Enter, else starts a new one', () => {
    expect(commandForKey(key('Enter'), calm)).toEqual({ type: 'newEvent' })
    expect(commandForKey(key('Enter'), { ...calm, hasSelection: true })).toEqual({ type: 'openSelected' })
  })

  it('deletes only with something under the cursor', () => {
    expect(commandForKey(key('Delete'), calm)).toBeNull()
    expect(commandForKey(key('Backspace'), { ...calm, hasSelection: true })).toEqual({ type: 'deleteSelected' })
  })

  it('has no cursor to walk in Year view', () => {
    expect(commandForKey(key('ArrowDown'), { ...calm, view: 'year' })).toBeNull()
    expect(commandForKey(key('ArrowUp'), { ...calm, view: 'year' })).toBeNull()
  })

  it('moves and stretches the selected event with Shift and Alt', () => {
    const sel = { ...calm, hasSelection: true, dragSnapMinutes: 30 }
    expect(commandForKey(key('ArrowUp', { shift: true }), sel)).toEqual({ type: 'nudge', delta: { minutes: -30 }, mode: 'move' })
    expect(commandForKey(key('ArrowDown', { shift: true }), sel)).toEqual({ type: 'nudge', delta: { minutes: 30 }, mode: 'move' })
    expect(commandForKey(key('ArrowLeft', { shift: true }), sel)).toEqual({ type: 'nudge', delta: { days: -1 }, mode: 'move' })
    expect(commandForKey(key('ArrowRight', { shift: true }), sel)).toEqual({ type: 'nudge', delta: { days: 1 }, mode: 'move' })
    expect(commandForKey(key('ArrowDown', { alt: true }), sel)).toEqual({ type: 'nudge', delta: { minutes: 30 }, mode: 'resize' })
    // Shift+Alt moves rather than stretches.
    expect(commandForKey(key('ArrowUp', { alt: true, shift: true }), sel)).toEqual({ type: 'nudge', delta: { minutes: -30 }, mode: 'move' })
  })

  it('pages with Alt + Left/Right, which stretch nothing', () => {
    const sel = { ...calm, hasSelection: true }
    expect(commandForKey(key('ArrowLeft', { alt: true }), sel)).toEqual({ type: 'page', direction: -1 })
    expect(commandForKey(key('ArrowRight', { alt: true }), sel)).toEqual({ type: 'page', direction: 1 })
  })

  it('walks the cursor with Shift + arrows when nothing is selected', () => {
    expect(commandForKey(key('ArrowDown', { shift: true }), calm)).toEqual({ type: 'cursor', direction: 1 })
  })

  it('takes Ctrl+K and Ctrl+Q over anything but another dialog', () => {
    expect(commandForKey(key('k', { ctrl: true }), calm)).toEqual({ type: 'toggleSearch' })
    expect(commandForKey(key('K', { ctrl: true, inTextField: true }), calm)).toEqual({ type: 'toggleSearch' })
    // Search open: Ctrl+K closes it again.
    expect(commandForKey(key('k', { ctrl: true }), { ...calm, overlayOpen: true, searchOpen: true })).toEqual({ type: 'toggleSearch' })
    // Some other dialog open: left alone.
    expect(commandForKey(key('k', { ctrl: true }), { ...calm, overlayOpen: true })).toBeNull()
    expect(commandForKey(key('q', { ctrl: true }), { ...calm, overlayOpen: true })).toEqual({ type: 'quit' })
    expect(commandForKey(key('q', { ctrl: true, shift: true }), calm)).toBeNull()
  })

  it('leaves Escape to a layer that closes itself', () => {
    expect(commandForKey(key('Escape'), calm)).toEqual({ type: 'escape' })
    expect(commandForKey(key('Escape'), { ...calm, overlayOpen: true })).toEqual({ type: 'escape' })
    expect(commandForKey(key('Escape'), { ...calm, overlayOpen: true, overlayOwnsEscape: true })).toBeNull()
    expect(commandForKey(key('Escape', { inTextField: true }), calm)).toEqual({ type: 'escape' })
  })

  it('keeps out of text fields and from behind dialogs', () => {
    expect(commandForKey(key('d', { inTextField: true }), calm)).toBeNull()
    expect(commandForKey(key('d'), { ...calm, overlayOpen: true })).toBeNull()
    expect(commandForKey(key('z', { ctrl: true }), { ...calm, overlayOpen: true })).toBeNull()
  })

  it('leaves Enter and Space to a focused button', () => {
    expect(commandForKey(key('Enter', { onControl: true }), { ...calm, hasSelection: true })).toBeNull()
    expect(commandForKey(key(' ', { onControl: true }), calm)).toBeNull()
    // Other keys on a button still work.
    expect(commandForKey(key('w', { onControl: true }), calm)).toEqual({ type: 'view', view: 'week' })
  })

  it('handles Ctrl+B, Ctrl+Z and Ctrl+P and leaves other Ctrl keys to Electron', () => {
    expect(commandForKey(key('b', { ctrl: true }), calm)).toEqual({ type: 'toggleSidebar' })
    expect(commandForKey(key('z', { ctrl: true }), calm)).toEqual({ type: 'undo' })
    expect(commandForKey(key('p', { ctrl: true }), calm)).toEqual({ type: 'print' })
    expect(commandForKey(key('p', { ctrl: true }), { ...calm, overlayOpen: true })).toBeNull()
    expect(commandForKey(key('p', { ctrl: true, inTextField: true }), calm)).toBeNull()
    expect(commandForKey(key('z', { ctrl: true, shift: true }), calm)).toBeNull()
    expect(commandForKey(key('r', { ctrl: true }), calm)).toBeNull()
    expect(commandForKey(key('d', { ctrl: true }), calm)).toBeNull()
  })
})

describe('stepAnchor', () => {
  const at = DateTime.fromISO('2026-01-31T10:00:00')
  it('pages a day, a week, a month or a year', () => {
    expect(stepAnchor(at, 'day', 1).toISODate()).toBe('2026-02-01')
    expect(stepAnchor(at, 'week', -1).toISODate()).toBe('2026-01-24')
    // Luxon keeps the day inside the shorter month.
    expect(stepAnchor(at, 'month', 1).toISODate()).toBe('2026-02-28')
    expect(stepAnchor(at, 'list', -1).toISODate()).toBe('2025-12-31')
    expect(stepAnchor(at, 'year', 1).toISODate()).toBe('2027-01-31')
  })
})
