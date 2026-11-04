import { useCallback, useEffect, useRef } from 'react'

/**
 * Where the pointer last went down, and on which event if any: the views report
 * which event was clicked, not where, and the editor docks on the side away
 * from it.
 */
export function useLastPointer(): {
  /** The viewport X of an occurrence on screen: where it was just clicked, else
   *  the middle of its element (Enter on the selection, a right-click menu).
   *  Undefined when it is not drawn; the editor then opens on the right. */
  clientXOf: (occurrenceId: string) => number | undefined
  /** Where the last press was, wherever it was. */
  lastX: () => number | undefined
} {
  const last = useRef<{ x: number; occurrenceId?: string } | null>(null)

  useEffect(() => {
    const remember = (e: PointerEvent): void => {
      const el = (e.target as Element | null)?.closest?.<HTMLElement>('[data-occurrence-id]')
      last.current = { x: e.clientX, occurrenceId: el?.dataset.occurrenceId }
    }
    window.addEventListener('pointerdown', remember, true)
    return () => window.removeEventListener('pointerdown', remember, true)
  }, [])

  const clientXOf = useCallback((occurrenceId: string): number | undefined => {
    if (last.current && last.current.occurrenceId === occurrenceId) return last.current.x
    const el = document.querySelector(`[data-occurrence-id="${CSS.escape(occurrenceId)}"]`)
    if (!el) return undefined
    const rect = el.getBoundingClientRect()
    return rect.left + rect.width / 2
  }, [])

  const lastX = useCallback(() => last.current?.x, [])

  return { clientXOf, lastX }
}
