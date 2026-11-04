import { useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { showFriendlyError, toast } from '../components/ui'

/** How many steps Ctrl+Z can go back. */
const UNDO_LIMIT = 20

type Undo = () => Promise<unknown>

export interface UndoStack {
  /** Remember how to put back what was just done. */
  pushUndo: (undo: Undo) => void
  /** Ctrl+Z: put back the latest. */
  undoLast: () => void
  /**
   * A deleted event or occurrence can be brought back from a toast as well as
   * with Ctrl+Z. The toast is the delete's only feedback when it was not
   * confirmed first (middle-click), and the one destructive action worth a
   * second chance in plain sight.
   */
  offerUndoDelete: (undo: Undo) => void
}

/**
 * Each entry undoes one move, resize, copy or delete. Only those: an edit in
 * the editor is deliberate, and a series-wide change has no simple inverse.
 * `reload` runs after every undo, whether it worked or not.
 */
export function useUndoStack(reload: () => Promise<void>): UndoStack {
  const { t } = useTranslation()
  const stack = useRef<Undo[]>([])

  const pushUndo = useCallback((undo: Undo) => {
    stack.current.push(undo)
    if (stack.current.length > UNDO_LIMIT) stack.current.shift()
  }, [])

  const runUndo = useCallback(
    async (undo: Undo) => {
      stack.current = stack.current.filter((u) => u !== undo)
      try {
        await undo()
      } catch (err) {
        showFriendlyError(err, t('undo.failed'))
      }
      await reload()
    },
    [reload, t]
  )

  const undoLast = useCallback(() => {
    const undo = stack.current[stack.current.length - 1]
    if (undo) void runUndo(undo)
  }, [runUndo])

  const offerUndoDelete = useCallback(
    (undo: Undo) => {
      pushUndo(undo)
      toast(t('undo.deleted'), {
        action: {
          label: t('undo.action'),
          onClick: () => void runUndo(undo)
        }
      })
    },
    [pushUndo, runUndo, t]
  )

  return { pushUndo, undoLast, offerUndoDelete }
}
