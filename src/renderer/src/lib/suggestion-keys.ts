import { nextEnabledIndex } from './roving-index'

/**
 * What a key press means to a suggestion list that hangs under a text field
 * while focus stays in the field (the Location field's places). A plain
 * function of the key, the list's length and the row highlighted, so "Enter
 * takes it, Escape closes the list" is tested without a DOM.
 *
 * Nothing is highlighted (-1) until an arrow key says so: Enter and Tab mean
 * what they always mean in the field until the user has reached into the list.
 */
export type SuggestionKeyAction =
  | { kind: 'move'; index: number }
  | { kind: 'pick'; index: number }
  | { kind: 'close' }

/** `null`: the key is not the list's, and the field handles it as usual. */
export function suggestionKeyAction(key: string, count: number, activeIndex: number): SuggestionKeyAction | null {
  if (count <= 0) return null
  const rows = Array.from({ length: count })
  switch (key) {
    case 'ArrowDown':
      return { kind: 'move', index: nextEnabledIndex(rows, activeIndex, 1) }
    case 'ArrowUp':
      return { kind: 'move', index: nextEnabledIndex(rows, activeIndex, -1) }
    case 'Enter':
    case 'Tab':
      return activeIndex >= 0 && activeIndex < count ? { kind: 'pick', index: activeIndex } : null
    case 'Escape':
      return { kind: 'close' }
    default:
      return null
  }
}
