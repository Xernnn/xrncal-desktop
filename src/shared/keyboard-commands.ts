import type { CalendarViewType } from './visible-range'

/**
 * Which key does what, decided without a DOM. `App.tsx` turns a keydown into a
 * `KeyInput`, asks `commandForKey()`, and carries the command out; a command
 * also means the key is handled (its default is prevented), null that it is
 * left alone.
 *
 * The order of the checks is the design: Ctrl+K and Ctrl+Q work over anything,
 * Escape goes to a dialog that handles it itself, nothing else reaches through
 * a dialog or out of a text field, and Enter/Space belong to a focused button.
 */
export interface KeyInput {
  key: string
  /** Ctrl, or Cmd on a Mac. */
  ctrl: boolean
  shift: boolean
  alt: boolean
  /** Focus is in a text field. */
  inTextField: boolean
  /** Focus is on a button, link or select, which Enter and Space press. */
  onControl: boolean
}

export interface KeyContext {
  /** A layer above the calendar (dialog, menu, editor) is open. */
  overlayOpen: boolean
  searchOpen: boolean
  /** The open layer closes itself on Escape; handling it here as well would
   *  close two layers with one press. */
  overlayOwnsEscape: boolean
  /** The keyboard cursor is on an event. */
  hasSelection: boolean
  view: CalendarViewType
  /** What Shift/Alt + Up/Down move or stretch an event by. */
  dragSnapMinutes: number
}

export type KeyCommand =
  | { type: 'toggleSearch' }
  | { type: 'openSearch' }
  | { type: 'quit' }
  /** Close the top layer that does not close itself, else drop the cursor. */
  | { type: 'escape' }
  | { type: 'toggleSidebar' }
  | { type: 'undo' }
  | { type: 'nudge'; delta: { days?: number; minutes?: number }; mode: 'move' | 'resize' }
  | { type: 'today' }
  | { type: 'page'; direction: 1 | -1 }
  | { type: 'cursor'; direction: 1 | -1 }
  | { type: 'openSelected' }
  | { type: 'deleteSelected' }
  | { type: 'newEvent' }
  | { type: 'view'; view: CalendarViewType }
  | { type: 'toggleShortcuts' }
  | { type: 'openSettings' }
  | { type: 'sync' }

const VIEW_KEYS: Record<string, CalendarViewType> = {
  '1': 'day',
  d: 'day',
  '2': 'week',
  w: 'week',
  '3': 'month',
  m: 'month',
  '4': 'year',
  y: 'year',
  '5': 'list',
  l: 'list'
}

export function commandForKey(input: KeyInput, ctx: KeyContext): KeyCommand | null {
  const lower = input.key.toLowerCase()

  if (input.ctrl && lower === 'k') {
    return ctx.overlayOpen && !ctx.searchOpen ? null : { type: 'toggleSearch' }
  }
  // Closing the window leaves xrncal in the tray; Ctrl+Q is the way out.
  if (input.ctrl && !input.shift && lower === 'q') return { type: 'quit' }
  if (input.key === 'Escape') return ctx.overlayOwnsEscape ? null : { type: 'escape' }

  // A bare letter must not reach through a dialog and switch the view behind it.
  if (input.inTextField || ctx.overlayOpen) return null
  // Enter and Space belong to whatever control has focus. Claiming them here
  // would stop Tab + Enter from pressing a button, which is the other half of
  // getting around without a mouse.
  if ((input.key === 'Enter' || input.key === ' ') && input.onControl) return null

  if (input.ctrl && lower === 'b') return { type: 'toggleSidebar' }
  if (input.ctrl && !input.shift && lower === 'z') return { type: 'undo' }
  // Anything else held with Ctrl/Cmd belongs to Electron (reload, zoom...).
  if (input.ctrl) return null

  // Shift/Alt + arrows act on the event under the cursor rather than on the
  // cursor itself: Shift moves it, Alt stretches its end. Alt + Left/Right
  // stretch nothing, so they page like the bare arrows.
  if (ctx.hasSelection && (input.shift || input.alt) && input.key.startsWith('Arrow')) {
    const resize = input.alt && !input.shift
    const mode = resize ? 'resize' : 'move'
    if (input.key === 'ArrowUp') return { type: 'nudge', delta: { minutes: -ctx.dragSnapMinutes }, mode }
    if (input.key === 'ArrowDown') return { type: 'nudge', delta: { minutes: ctx.dragSnapMinutes }, mode }
    if (!resize && input.key === 'ArrowLeft') return { type: 'nudge', delta: { days: -1 }, mode: 'move' }
    if (!resize && input.key === 'ArrowRight') return { type: 'nudge', delta: { days: 1 }, mode: 'move' }
  }

  const key = input.key.length === 1 ? lower : input.key
  if (VIEW_KEYS[key]) return { type: 'view', view: VIEW_KEYS[key] }

  switch (key) {
    case 't':
      return { type: 'today' }
    case 'k':
    case 'ArrowLeft':
    case 'PageUp':
      return { type: 'page', direction: -1 }
    case 'j':
    case 'ArrowRight':
    case 'PageDown':
      return { type: 'page', direction: 1 }
    // Year view draws no events, so there is no cursor to walk.
    case 'ArrowDown':
      return ctx.view === 'year' ? null : { type: 'cursor', direction: 1 }
    case 'ArrowUp':
      return ctx.view === 'year' ? null : { type: 'cursor', direction: -1 }
    case 'Enter':
      return ctx.hasSelection ? { type: 'openSelected' } : { type: 'newEvent' }
    case 'Delete':
    case 'Backspace':
      return ctx.hasSelection ? { type: 'deleteSelected' } : null
    case 'n':
    case 'c':
      return { type: 'newEvent' }
    case '/':
      return { type: 'openSearch' }
    case '?':
    case 'F1':
      return { type: 'toggleShortcuts' }
    case ',':
      return { type: 'openSettings' }
    case 'r':
      return { type: 'sync' }
    default:
      return null
  }
}
