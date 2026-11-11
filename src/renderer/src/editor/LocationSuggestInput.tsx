import React, { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MapPin } from 'lucide-react'
import type { LocationSuggestion } from '@shared/location-suggestions'
import { suggestionKeyAction } from '../lib/suggestion-keys'

interface LocationSuggestInputProps {
  value: string
  /** Typing, and picking a suggestion: either way only the field's text changes. */
  onChange: (value: string) => void
  placeholder?: string
}

const DEBOUNCE_MS = 140
const MAX_SUGGESTIONS = 5
const LIST_ID = 'gc-location-suggestions'

/** The places on offer. Drawn apart from the field so it can be shown (and
 *  tested) for any list and highlighted row. */
export const LocationSuggestionList: React.FC<{
  suggestions: LocationSuggestion[]
  activeIndex: number
  onPick: (suggestion: LocationSuggestion) => void
  onHover: (index: number) => void
}> = ({ suggestions, activeIndex, onPick, onHover }) => {
  const { t } = useTranslation()
  return (
    <div
      id={LIST_ID}
      role="listbox"
      aria-label={t('editor.locationSuggestions')}
      // Keep focus in the input: blur would close the list before the click
      // on a row ever landed.
      onMouseDown={(e) => e.preventDefault()}
      className="absolute left-0 right-0 top-full z-50 mt-1.5 border border-hairline bg-dialog p-1 text-primary animate-popover select-none"
      style={{
        borderRadius: 'var(--radius-dialog)',
        boxShadow: '0 12px 32px rgba(0, 0, 0, 0.18), 0 0 0 1px var(--color-border)'
      }}
    >
      {suggestions.map((s, i) => (
        <button
          key={s.location}
          type="button"
          id={`${LIST_ID}-${i}`}
          role="option"
          aria-selected={i === activeIndex}
          onClick={() => onPick(s)}
          onMouseEnter={() => onHover(i)}
          className={`flex w-full items-center gap-2 px-2 py-1.5 text-left transition-colors ${
            i === activeIndex ? 'bg-hover' : ''
          }`}
          style={{ borderRadius: 'var(--radius-control)' }}
        >
          <MapPin className="h-3 w-3 shrink-0 text-muted" aria-hidden />
          <span className="min-w-0 flex-1 truncate text-xs text-primary">{s.location}</span>
        </button>
      ))}
    </div>
  )
}

/**
 * The editor's Location field, with the places used before offered under it
 * as they are typed. Ranking lives in `@shared/location-suggestions`; this
 * asks the main process for it and draws the answer, the same list the title
 * field has.
 *
 * The list comes up only for typing: not on focus, and not for the place an
 * event opened for editing already has. Picking a row fills the field and
 * does nothing else. Up and Down walk the list, Enter (or Tab) takes the row
 * highlighted, and Escape closes the list and stops there - the editor's own
 * Escape, which closes the whole panel, must not also get it.
 */
export const LocationSuggestInput: React.FC<LocationSuggestInputProps> = ({ value, onChange, placeholder }) => {
  const { t } = useTranslation()
  const [suggestions, setSuggestions] = useState<LocationSuggestion[]>([])
  const [isOpen, setIsOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)

  // Asked for only while the field is being typed in and has something in it.
  const searching = isOpen && value.trim().length > 0

  useEffect(() => {
    if (!searching) return
    let cancelled = false
    const timer = setTimeout(async () => {
      try {
        const res = await window.xrncal?.events?.suggestLocations?.({ query: value, limit: MAX_SUGGESTIONS })
        if (cancelled) return
        setSuggestions(res ?? [])
        setActiveIndex(-1)
      } catch {
        // No suggestions this time; typing is unaffected.
      }
    }, DEBOUNCE_MS)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [value, searching])

  const close = (): void => {
    setIsOpen(false)
    setActiveIndex(-1)
    // The next list is for the next thing typed; until it arrives there is none.
    setSuggestions([])
  }

  const accept = (suggestion: LocationSuggestion): void => {
    // Closed first, so the new text is not itself looked up: the list comes
    // back with the next keystroke.
    close()
    onChange(suggestion.location)
    inputRef.current?.focus()
  }

  const visible = searching && suggestions.length > 0

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (!visible) return
    const action = suggestionKeyAction(e.key, suggestions.length, activeIndex)
    if (!action) return
    e.preventDefault()
    if (action.kind === 'move') setActiveIndex(action.index)
    else if (action.kind === 'pick') accept(suggestions[action.index])
    else {
      // The dialog also listens for Escape; dismissing the list must not close
      // the whole editor out from under a half-written event.
      e.stopPropagation()
      close()
    }
  }

  return (
    <div className="relative w-full">
      {/* The same ghost field as TextInput, which cannot carry a list. */}
      <div
        className="flex items-center px-2.5 py-1.5 transition-colors duration-100 bg-transparent border border-transparent hover:border-hairline hover:bg-hover/30 focus-within:border-hairline focus-within:bg-hover/20"
        style={{ borderRadius: 'var(--radius-control)' }}
      >
        <span className="mr-1.5 text-muted shrink-0">
          <MapPin className="h-3.5 w-3.5" />
        </span>
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => {
            onChange(e.target.value)
            // Cleared: the next letter starts a new list, not the last one.
            if (!e.target.value.trim()) setSuggestions([])
            setIsOpen(true)
          }}
          onBlur={close}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          role="combobox"
          aria-label={t('editor.location')}
          aria-expanded={visible}
          aria-autocomplete="list"
          aria-controls={LIST_ID}
          aria-activedescendant={visible && activeIndex >= 0 ? `${LIST_ID}-${activeIndex}` : undefined}
          className="w-full bg-transparent text-xs text-primary placeholder:text-muted border-none outline-none focus:outline-none focus:ring-0 focus-visible:outline-none"
        />
      </div>

      {visible && (
        <LocationSuggestionList
          suggestions={suggestions}
          activeIndex={activeIndex}
          onPick={accept}
          onHover={setActiveIndex}
        />
      )}
    </div>
  )
}

export default LocationSuggestInput
