import React, { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Smile, X } from 'lucide-react'
import { EMOJI_GROUPS } from '@shared/title-emoji'
import { gridMove, rowsOf } from '../lib/grid-nav'

/** Cells to a row: the grid below is `grid-cols-8`, and the arrow keys count
 *  rows by the same number. */
const COLUMNS = 8

const PANEL_ID = 'gc-emoji-panel'

interface EmojiSection {
  id: string
  label: string
  emojis: readonly string[]
  /** The number of its first cell, counting through the panel from 0. */
  firstCell: number
}

/**
 * What the panel holds, top to bottom: the emojis picked most (when there are
 * any), then the built-in groups. The same emoji can be in both, so cells are
 * told apart by where they are, not by what they show.
 */
function sectionsFor(favorites: readonly string[], hasRemove: boolean, t: (key: string) => string): EmojiSection[] {
  const listed = [
    ...(favorites.length > 0 ? [{ id: 'frequent', label: t('editor.emoji.frequent'), emojis: favorites }] : []),
    ...EMOJI_GROUPS.map((group) => ({
      id: group.id,
      label: t(`editor.emoji.groups.${group.id}`),
      emojis: group.emojis
    }))
  ]
  // "Remove", when it is there, is cell 0.
  return listed.map((section, i) => ({
    ...section,
    firstCell: listed.slice(0, i).reduce((cells, before) => cells + before.emojis.length, hasRemove ? 1 : 0)
  }))
}

/** The row lengths the arrow keys walk: the "remove" row, then each section's rows. */
export function emojiPanelRows(hasRemove: boolean, sectionSizes: number[]): number[] {
  return [...(hasRemove ? [1] : []), ...sectionSizes.flatMap((size) => rowsOf(size, COLUMNS))]
}

interface EmojiPanelProps {
  /** The emoji the title starts with, which "remove" takes off; null when it has none. */
  current: string | null
  /** The emojis picked before, most used first. */
  favorites: readonly string[]
  /** The cell the arrow keys are on, counted through the panel from 0. */
  cursor: number
  onCursor: (cell: number) => void
  onPick: (emoji: string) => void
  onRemove: () => void
  /** Tab: shut the panel and nothing else (Escape is the picker's, below). */
  onDismiss: () => void
}

/**
 * The emoji panel: "remove" when the title has an emoji, the ones picked most,
 * then the built-in set by kind.
 *
 * Focus is on one cell at a time (a roving tabindex) and the arrow keys move
 * it, so Enter and Space pick as they press any button. Each emoji is its
 * button's whole text, which is the name a screen reader says for it; the
 * groups are named by their headings.
 */
export const EmojiPanel: React.FC<EmojiPanelProps> = ({
  current,
  favorites,
  cursor,
  onCursor,
  onPick,
  onRemove,
  onDismiss
}) => {
  const { t } = useTranslation()
  const panelRef = useRef<HTMLDivElement>(null)
  const hasRemove = current !== null
  const sections = sectionsFor(favorites, hasRemove, t)
  const rows = emojiPanelRows(
    hasRemove,
    sections.map((section) => section.emojis.length)
  )

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'Tab') {
      // There is nowhere in the panel to tab to; leaving it shuts it.
      e.preventDefault()
      onDismiss()
      return
    }
    const next = gridMove(rows, cursor, e.key)
    if (next === null) return
    e.preventDefault()
    onCursor(next)
    panelRef.current?.querySelector<HTMLElement>(`[data-cell="${next}"]`)?.focus()
  }

  return (
    <div
      ref={panelRef}
      id={PANEL_ID}
      role="dialog"
      aria-label={t('editor.emoji.title')}
      onKeyDown={handleKeyDown}
      // A press on a heading or the padding would take focus off the cell it
      // is on, and the arrow keys with it.
      onMouseDown={(e) => {
        if (!(e.target as HTMLElement).closest('button')) e.preventDefault()
      }}
      className="absolute left-0 top-full z-50 mt-1.5 max-h-[280px] w-[288px] overflow-x-hidden overflow-y-auto border border-hairline bg-dialog p-1.5 text-primary animate-popover select-none"
      style={{
        borderRadius: 'var(--radius-dialog)',
        boxShadow: '0 12px 32px rgba(0, 0, 0, 0.18), 0 0 0 1px var(--color-border)'
      }}
    >
      {hasRemove && (
        <button
          type="button"
          data-cell={0}
          tabIndex={cursor === 0 ? 0 : -1}
          onClick={onRemove}
          onFocus={() => onCursor(0)}
          className="gc-focus-ring flex w-full cursor-pointer items-center gap-2 px-2 py-1.5 text-left text-xs text-muted transition-colors hover:bg-hover hover:text-primary"
          style={{ borderRadius: 'var(--radius-control)' }}
        >
          <X className="h-3 w-3 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1 truncate">{t('editor.emoji.remove')}</span>
          <span aria-hidden>{current}</span>
        </button>
      )}

      {sections.map((section) => (
        <div key={section.id} role="group" aria-labelledby={`${PANEL_ID}-${section.id}`}>
          <div id={`${PANEL_ID}-${section.id}`} className="px-1 pt-2 pb-1 text-[11px] text-muted">
            {section.label}
          </div>
          <div className="grid grid-cols-8">
            {section.emojis.map((emoji, i) => {
              const index = section.firstCell + i
              return (
                <button
                  key={emoji}
                  type="button"
                  data-cell={index}
                  tabIndex={cursor === index ? 0 : -1}
                  onClick={() => onPick(emoji)}
                  onFocus={() => onCursor(index)}
                  className="gc-focus-ring flex h-8 w-full cursor-pointer items-center justify-center text-[18px] leading-none transition-colors hover:bg-hover"
                  style={{ borderRadius: 'var(--radius-control)' }}
                >
                  {emoji}
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

interface EmojiPickerProps {
  current: string | null
  favorites: readonly string[]
  onPick: (emoji: string) => void
  onRemove: () => void
  /** The panel shut, by a pick or without one: where the keyboard goes next. */
  onClosed?: () => void
}

/**
 * The button in front of the title and the panel it opens. Picking an emoji
 * (or "remove") shuts the panel and hands the keyboard back through
 * `onClosed`, to the title; Escape, Tab or a click anywhere else shuts it and
 * leaves the title as it was.
 *
 * Escape is taken on its way down from the window, before the editor's own
 * Escape (which closes the whole panel, or asks to discard) can hear it, and
 * wherever focus happens to be while the panel is open.
 */
export const EmojiPicker: React.FC<EmojiPickerProps> = ({ current, favorites, onPick, onRemove, onClosed }) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [cursor, setCursor] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  // While open: the keyboard starts on the first cell, a press anywhere
  // outside shuts the panel, and so does Escape - and only the panel.
  useEffect(() => {
    if (!open) return
    rootRef.current?.querySelector<HTMLElement>('[data-cell="0"]')?.focus()
    const onMouseDown = (e: MouseEvent): void => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      setOpen(false)
      buttonRef.current?.focus()
    }
    document.addEventListener('mousedown', onMouseDown)
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('keydown', onKeyDown, true)
    }
  }, [open])

  const toggle = (): void => {
    // Opening is where the cursor is put: on the first cell, every time.
    if (!open) setCursor(0)
    setOpen(!open)
  }

  const finish = (apply: () => void): void => {
    setOpen(false)
    apply()
    onClosed?.()
  }

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        className="gc-icon-btn gc-focus-ring p-1.5"
        title={t('editor.emoji.button')}
        aria-label={t('editor.emoji.button')}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? PANEL_ID : undefined}
      >
        <Smile className="h-4 w-4" aria-hidden />
      </button>

      {open && (
        <EmojiPanel
          current={current}
          favorites={favorites}
          cursor={cursor}
          onCursor={setCursor}
          onPick={(emoji) => finish(() => onPick(emoji))}
          onRemove={() => finish(onRemove)}
          onDismiss={() => {
            setOpen(false)
            buttonRef.current?.focus()
          }}
        />
      )}
    </div>
  )
}

export default EmojiPicker
