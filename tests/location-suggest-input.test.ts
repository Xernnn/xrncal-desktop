import { describe, it, expect } from 'vitest'
import React from 'react'
import { renderToString } from 'react-dom/server'
import '../src/renderer/src/i18n'
import { LocationSuggestInput, LocationSuggestionList } from '../src/renderer/src/editor/LocationSuggestInput'
import { suggestionKeyAction } from '../src/renderer/src/lib/suggestion-keys'
import type { LocationSuggestion } from '../src/shared/location-suggestions'

const place = (location: string): LocationSuggestion => ({
  location,
  uses: 1,
  lastUsedUtc: '2026-09-14T09:00:00.000Z',
  score: 1
})

/**
 * The list under the Location field is walked from the field, where focus
 * stays: which key does what is a function of the list and the row
 * highlighted.
 */
describe('keys in a suggestion list', () => {
  it('walks down from nothing highlighted, and wraps', () => {
    expect(suggestionKeyAction('ArrowDown', 3, -1)).toEqual({ kind: 'move', index: 0 })
    expect(suggestionKeyAction('ArrowDown', 3, 0)).toEqual({ kind: 'move', index: 1 })
    expect(suggestionKeyAction('ArrowDown', 3, 2)).toEqual({ kind: 'move', index: 0 })
  })

  it('walks up, entering from the bottom', () => {
    expect(suggestionKeyAction('ArrowUp', 3, -1)).toEqual({ kind: 'move', index: 2 })
    expect(suggestionKeyAction('ArrowUp', 3, 2)).toEqual({ kind: 'move', index: 1 })
    expect(suggestionKeyAction('ArrowUp', 3, 0)).toEqual({ kind: 'move', index: 2 })
  })

  it('takes the highlighted row on Enter or Tab', () => {
    expect(suggestionKeyAction('Enter', 3, 1)).toEqual({ kind: 'pick', index: 1 })
    expect(suggestionKeyAction('Tab', 3, 2)).toEqual({ kind: 'pick', index: 2 })
  })

  it('leaves Enter and Tab to the field while nothing is highlighted', () => {
    // Typing a new place and pressing Enter must not swap it for an old one.
    expect(suggestionKeyAction('Enter', 3, -1)).toBeNull()
    expect(suggestionKeyAction('Tab', 3, -1)).toBeNull()
    // A row that is no longer there (the list shrank) is not picked either.
    expect(suggestionKeyAction('Enter', 2, 5)).toBeNull()
  })

  it('closes on Escape, whatever is highlighted', () => {
    expect(suggestionKeyAction('Escape', 3, -1)).toEqual({ kind: 'close' })
    expect(suggestionKeyAction('Escape', 3, 1)).toEqual({ kind: 'close' })
  })

  it('has no say over other keys, or with no list', () => {
    expect(suggestionKeyAction('a', 3, 0)).toBeNull()
    expect(suggestionKeyAction('ArrowLeft', 3, 0)).toBeNull()
    expect(suggestionKeyAction('ArrowDown', 0, -1)).toBeNull()
    expect(suggestionKeyAction('Escape', 0, -1)).toBeNull()
  })
})

describe('the Location field', () => {
  it('is a combobox that starts with no list, whatever it already holds', () => {
    const html = renderToString(
      React.createElement(LocationSuggestInput, {
        value: 'Harbour Library',
        onChange: () => {},
        placeholder: 'Add location'
      })
    )
    expect(html).toContain('role="combobox"')
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('aria-autocomplete="list"')
    expect(html).toContain('aria-label="Location"')
    expect(html).toContain('placeholder="Add location"')
    expect(html).toContain('value="Harbour Library"')
    expect(html).not.toContain('role="listbox"')
    // The app's own list, not the browser's.
    expect(html).not.toContain('<datalist')
  })

  it('lists the places as options and marks the one highlighted', () => {
    const html = renderToString(
      React.createElement(LocationSuggestionList, {
        suggestions: [place('Cà phê Sáng'), place('Harbour Library')],
        activeIndex: 1,
        onPick: () => {},
        onHover: () => {}
      })
    )
    expect(html).toContain('role="listbox"')
    expect(html).toContain('aria-label="Places used before"')
    expect(html.match(/role="option"/g)).toHaveLength(2)
    expect(html).toContain('Cà phê Sáng')
    expect(html).toMatch(/id="gc-location-suggestions-0"[^>]*aria-selected="false"/)
    expect(html).toMatch(/id="gc-location-suggestions-1"[^>]*aria-selected="true"/)
    // Rows are buttons that never submit the editor's form.
    expect(html.match(/<button type="button"/g)).toHaveLength(2)
  })
})
