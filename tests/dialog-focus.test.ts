import { describe, it, expect } from 'vitest'
import React from 'react'
import { renderToString } from 'react-dom/server'
import { DateTime } from 'luxon'
import { trappedTabTarget } from '../src/renderer/src/hooks/use-dialog-focus'
import KeyboardShortcutsModal from '../src/renderer/src/components/KeyboardShortcutsModal'
import SyncConflictsModal from '../src/renderer/src/components/SyncConflictsModal'
import SearchPaletteModal from '../src/renderer/src/components/SearchPaletteModal'
import ImportIcsDialog from '../src/renderer/src/components/ImportIcsDialog'
import RecurringScopeDialog from '../src/renderer/src/editor/RecurringScopeDialog'
import EventEditorDialog from '../src/renderer/src/editor/EventEditorDialog'

/**
 * No overlay kept the keyboard: with Settings, the scope prompt or the editor
 * open, Tab walked out of the sheet into the header and sidebar behind the
 * scrim, and most overlays did not say they were dialogs at all.
 */
describe('trappedTabTarget', () => {
  const items = ['title', 'notes', 'save']

  it('goes round at either end', () => {
    expect(trappedTabTarget(items, 'save', false)).toBe('title')
    expect(trappedTabTarget(items, 'title', true)).toBe('save')
  })

  it('leaves a move between two of them to the browser', () => {
    expect(trappedTabTarget(items, 'title', false)).toBeNull()
    expect(trappedTabTarget(items, 'save', true)).toBeNull()
  })

  it('brings focus in from outside', () => {
    expect(trappedTabTarget(items, 'sidebar', false)).toBe('title')
    expect(trappedTabTarget(items, null, true)).toBe('save')
    expect(trappedTabTarget([], 'sidebar', false)).toBeNull()
  })
})

describe('overlays', () => {
  const calendar = {
    id: 'cal1',
    name: 'Main',
    color: '#4A90E2',
    isVisible: true,
    isReadOnly: false,
    accountId: 'local',
    isDefault: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  }
  const noop = () => {}

  it.each([
    ['keyboard shortcuts', React.createElement(KeyboardShortcutsModal, { isOpen: true, onClose: noop })],
    [
      'sync conflicts',
      React.createElement(SyncConflictsModal, { isOpen: true, conflicts: [], onClose: noop, onResolve: async () => {} })
    ],
    ['search', React.createElement(SearchPaletteModal, { isOpen: true, onClose: noop, calendars: [], onSelectEvent: noop })],
    [
      'import',
      React.createElement(ImportIcsDialog, {
        files: [{ name: 'a.ics', content: 'BEGIN:VCALENDAR' }],
        calendars: [calendar],
        onClose: noop,
        onImported: noop
      })
    ],
    [
      'recurring scope',
      React.createElement(RecurringScopeDialog, { isOpen: true, title: 'Standup', action: 'edit', onConfirm: noop, onCancel: noop })
    ],
    [
      'event editor',
      React.createElement(EventEditorDialog, {
        calendars: [calendar],
        data: { initialStart: DateTime.local(), initialEnd: DateTime.local().plus({ hours: 1 }) },
        onSave: noop,
        onDelete: noop,
        onClose: noop
      })
    ]
  ])('%s is a modal dialog that can take focus', (_name, element) => {
    const html = renderToString(element)
    expect(html).toMatch(/role="dialog"/)
    expect(html).toMatch(/aria-modal="true"/)
    expect(html).toMatch(/aria-label="[^"]+"/)
    expect(html).toMatch(/tabindex="-1"/)
  })
})
