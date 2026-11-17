import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from 'react'

/** What Tab can reach inside a dialog. */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Where Tab (or Shift+Tab, `backwards`) has to go from `active` to stay among
 * `items`, the dialog's focusable elements in order: round to the other end
 * at either end, and in from outside. Null leaves the move to the browser.
 */
export function trappedTabTarget<T>(items: readonly T[], active: T | null, backwards: boolean): T | null {
  if (items.length === 0) return null
  const at = active === null ? -1 : items.indexOf(active)
  if (at === -1) return backwards ? items[items.length - 1] : items[0]
  if (!backwards && at === items.length - 1) return items[0]
  if (backwards && at === 0) return items[items.length - 1]
  return null
}

/**
 * Keep the keyboard in a dialog while it is open. Tab walked out of every
 * overlay into the header and sidebar behind the scrim, where keys then acted
 * on a calendar the person could not see. Put `ref`, `onKeyDown` and
 * `tabIndex={-1}` on the dialog element: focus moves into it when it opens (if
 * nothing in it took focus itself), Tab and Shift+Tab go round inside it, and
 * focus goes back where it was when it closes. A key a control inside has
 * already handled (preventDefault) is left alone.
 */
export function useDialogFocus<T extends HTMLElement>(
  open = true
): { ref: RefObject<T | null>; onKeyDown: (e: ReactKeyboardEvent) => void } {
  const ref = useRef<T | null>(null)

  useEffect(() => {
    if (!open) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const dialog = ref.current
    if (dialog && !dialog.contains(document.activeElement)) dialog.focus()
    return () => {
      if (previous && previous.isConnected) previous.focus()
    }
  }, [open])

  const onKeyDown = (e: ReactKeyboardEvent): void => {
    if (e.key !== 'Tab' || e.defaultPrevented) return
    const dialog = e.currentTarget as HTMLElement
    const items = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.getClientRects().length > 0)
    const target = trappedTabTarget(items, document.activeElement as HTMLElement | null, e.shiftKey)
    if (!target) return
    e.preventDefault()
    target.focus()
  }

  return { ref, onKeyDown }
}
