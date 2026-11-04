import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { nextEnabledIndex } from '../../lib/roving-index'

export type ContextMenuEntry =
  | {
      label: string
      icon?: React.ReactNode
      /** Shown dimmed on the right, e.g. the shortcut that does the same. */
      hint?: string
      danger?: boolean
      disabled?: boolean
      onSelect: () => void
    }
  | 'separator'

interface ContextMenuProps {
  /** Viewport point the menu opens at; null closes it. */
  at: { x: number; y: number } | null
  entries: ContextMenuEntry[]
  onClose: () => void
  /** Accessible name, e.g. the event's title. */
  label?: string
}

const MARGIN = 8

const isUnselectable = (entry: ContextMenuEntry): boolean =>
  entry === 'separator' || Boolean(entry.disabled)

/**
 * The right-click menu. Opens at the pointer and stays inside the window;
 * arrows walk it, Enter picks, Escape, a click elsewhere, scrolling or
 * resizing closes it - like a native menu, which a renderer cannot draw.
 */
export const ContextMenu: React.FC<ContextMenuProps> = ({ at, entries, onClose, label }) => {
  const ref = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null)
  const [active, setActive] = useState(-1)

  useLayoutEffect(() => {
    if (!at || !ref.current) {
      setPosition(null)
      return
    }
    const box = ref.current.getBoundingClientRect()
    const left = Math.min(at.x, window.innerWidth - box.width - MARGIN)
    const top = at.y + box.height > window.innerHeight - MARGIN ? Math.max(MARGIN, at.y - box.height) : at.y
    setPosition({ left: Math.max(MARGIN, left), top })
    setActive(-1)
    ref.current.focus()
  }, [at])

  useEffect(() => {
    if (!at) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onClose()
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        e.stopPropagation()
        setActive((i) => nextEnabledIndex(entries, i, e.key === 'ArrowDown' ? 1 : -1, isUnselectable))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        e.stopPropagation()
        const entry = entries[active]
        if (entry && entry !== 'separator' && !entry.disabled) {
          onClose()
          entry.onSelect()
        }
      }
    }
    const onPointerDown = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    // Capture, so the calendar's own Escape and arrow handling never sees
    // keys meant for the menu.
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('mousedown', onPointerDown, true)
    window.addEventListener('resize', onClose)
    window.addEventListener('scroll', onClose, true)
    window.addEventListener('blur', onClose)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('mousedown', onPointerDown, true)
      window.removeEventListener('resize', onClose)
      window.removeEventListener('scroll', onClose, true)
      window.removeEventListener('blur', onClose)
    }
  }, [at, entries, active, onClose])

  if (!at || typeof document === 'undefined') return null

  return createPortal(
    <div
      ref={ref}
      role="menu"
      aria-label={label}
      tabIndex={-1}
      onContextMenu={(e) => e.preventDefault()}
      className="fixed z-[10000] min-w-52 overflow-hidden rounded-[4px] border border-hairline bg-surface py-1 text-primary shadow-lg outline-none animate-popover select-none"
      style={position ?? { left: -9999, top: -9999 }}
    >
      {entries.map((entry, idx) =>
        entry === 'separator' ? (
          <div key={`sep-${idx}`} className="my-1 border-t border-hairline" role="separator" />
        ) : (
          <button
            key={entry.label}
            type="button"
            role="menuitem"
            disabled={entry.disabled}
            onMouseEnter={() => setActive(idx)}
            onClick={() => {
              onClose()
              entry.onSelect()
            }}
            className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[13px] transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
              idx === active ? 'bg-hover' : ''
            } ${entry.danger ? 'text-today' : 'text-primary'}`}
          >
            <span className="flex h-4 w-4 shrink-0 items-center justify-center text-muted">{entry.icon}</span>
            <span className="min-w-0 flex-1 truncate">{entry.label}</span>
            {entry.hint && <span className="shrink-0 text-[11px] text-muted">{entry.hint}</span>}
          </button>
        )
      )}
    </div>,
    document.body
  )
}

export default ContextMenu
