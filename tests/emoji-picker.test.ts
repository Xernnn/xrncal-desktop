import { describe, it, expect } from 'vitest'
import React from 'react'
import { renderToString } from 'react-dom/server'
import { resources } from '../src/renderer/src/i18n'
import { EmojiPanel, EmojiPicker, emojiPanelRows } from '../src/renderer/src/editor/EmojiPicker'
import EventEditorDialog from '../src/renderer/src/editor/EventEditorDialog'
import { TitleSuggestInput } from '../src/renderer/src/editor/TitleSuggestInput'
import { displayPreferencesOf } from '../src/renderer/src/context/DisplayPreferencesContext'
import { DEFAULT_APP_SETTINGS } from '../src/shared/settings-contract'
import { EMOJI_GROUPS } from '../src/shared/title-emoji'

const TOTAL = EMOJI_GROUPS.reduce((n, group) => n + group.emojis.length, 0)

const panel = (props: Partial<React.ComponentProps<typeof EmojiPanel>> = {}): string =>
  renderToString(
    React.createElement(EmojiPanel, {
      current: null,
      favorites: [],
      cursor: 0,
      onCursor: () => {},
      onPick: () => {},
      onRemove: () => {},
      onDismiss: () => {},
      ...props
    })
  )

/** The `data-cell` numbers in the order drawn, and which of them the Tab key lands on. */
const cells = (html: string): number[] => [...html.matchAll(/data-cell="(\d+)"/g)].map((m) => Number(m[1]))
const tabStops = (html: string): number[] =>
  [...html.matchAll(/<button[^>]*data-cell="(\d+)"[^>]*tabindex="0"/gi)].map((m) => Number(m[1]))

describe('the emoji panel', () => {
  it('is a named dialog with the built-in set, group by group', () => {
    const html = panel()
    expect(html).toContain('role="dialog"')
    expect(html).toContain('aria-label="Emoji"')
    for (const name of ['People', 'Activities and sport', 'Food and drink', 'Travel and places', 'Objects', 'Symbols', 'Nature']) {
      expect(html).toContain(`>${name}</div>`)
    }
    expect(html.match(/role="group"/g)).toHaveLength(7)
    // Each group is named by its heading.
    expect(html).toMatch(/role="group" aria-labelledby="gc-emoji-panel-food"/)
    expect(html).toContain('id="gc-emoji-panel-food"')
    for (const group of EMOJI_GROUPS) {
      for (const emoji of group.emojis) expect(html).toContain(`>${emoji}</button>`)
    }
  })

  it('numbers its cells straight through, so the arrow keys can walk them', () => {
    expect(cells(panel())).toEqual(Array.from({ length: TOTAL }, (_, i) => i))
    const withBoth = cells(panel({ current: '🍴', favorites: ['🎂', '☕'] }))
    expect(withBoth).toEqual(Array.from({ length: TOTAL + 3 }, (_, i) => i))
  })

  it('has one tab stop, the cell the cursor is on', () => {
    expect(tabStops(panel())).toEqual([0])
    expect(tabStops(panel({ cursor: 12 }))).toEqual([12])
    expect(tabStops(panel({ current: '🍴', favorites: ['🎂'], cursor: 1 }))).toEqual([1])
  })

  it('offers "remove" only when the title starts with an emoji', () => {
    expect(panel()).not.toContain('Remove the emoji')
    const html = panel({ current: '🍴' })
    expect(html).toContain('Remove the emoji')
    // First, where the keyboard starts.
    expect(html.indexOf('Remove the emoji')).toBeLessThan(html.indexOf('>People</div>'))
    expect(html).toMatch(/<button[^>]*data-cell="0"[^>]*>.*?Remove the emoji/s)
  })

  it('leads with the emojis picked most, when there are any', () => {
    expect(panel()).not.toContain('Frequently used')
    const html = panel({ favorites: ['🎂', '☕', '🍴'] })
    expect(html.indexOf('Frequently used')).toBeLessThan(html.indexOf('>People</div>'))
    expect(html.match(/role="group"/g)).toHaveLength(8)
    // In the order given, as cells 0 to 2.
    expect(html).toMatch(/data-cell="0"[^>]*>🎂<\/button>.*data-cell="1"[^>]*>☕<\/button>.*data-cell="2"[^>]*>🍴<\/button>/s)
  })

  it('draws every cell as a button that cannot submit the editor', () => {
    const html = panel({ current: '🍴', favorites: ['🎂'] })
    expect(html.match(/<button/g)!.length).toBe(html.match(/<button type="button"/g)!.length)
  })

  it('lays the arrow keys out as the cells are drawn: remove, favourites, then rows of eight', () => {
    expect(emojiPanelRows(false, [40, 3])).toEqual([8, 8, 8, 8, 8, 3])
    expect(emojiPanelRows(true, [16, 9])).toEqual([1, 8, 8, 8, 1])
    const sizes = EMOJI_GROUPS.map((group) => group.emojis.length)
    expect(emojiPanelRows(true, [2, ...sizes]).reduce((n, row) => n + row, 0)).toBe(TOTAL + 3)
  })

  it('speaks Vietnamese too', () => {
    const vi = resources.vi.translation.editor.emoji
    expect(Object.keys(vi.groups).sort()).toEqual(EMOJI_GROUPS.map((group) => group.id).sort())
    expect(vi.frequent).toBe('Hay dùng')
  })
})

describe('the emoji button', () => {
  it('is a named button in front of the title, with its panel shut', () => {
    const html = renderToString(
      React.createElement(EmojiPicker, { current: null, favorites: [], onPick: () => {}, onRemove: () => {} })
    )
    expect(html).toContain('aria-label="Put an emoji in front of the title"')
    expect(html).toContain('aria-haspopup="dialog"')
    expect(html).toContain('aria-expanded="false"')
    expect(html).not.toContain('role="dialog"')
  })

  it('comes before the title field in the editor, for a new event and an old one', () => {
    const calendars = [
      {
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
    ]
    const editor = (data: React.ComponentProps<typeof EventEditorDialog>['data']): string =>
      renderToString(
        React.createElement(EventEditorDialog, { calendars, data, onSave: () => {}, onDelete: () => {}, onClose: () => {} })
      )
    const event = {
      id: 'evt_1',
      calendarId: 'cal1',
      uid: 'uid-1',
      title: "🍴 Lunch at Pablo's",
      dtStartUtc: '2026-03-02T05:00:00.000Z',
      dtEndUtc: '2026-03-02T06:00:00.000Z',
      tzid: 'Asia/Ho_Chi_Minh',
      allDay: false,
      dirty: false,
      isDeleted: false,
      attendees: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    }
    for (const html of [editor({}), editor({ event })]) {
      const button = html.indexOf('aria-label="Put an emoji in front of the title"')
      expect(button).toBeGreaterThan(-1)
      expect(button).toBeLessThan(html.indexOf('placeholder="Event title…"'))
    }
    // The emoji is in the title itself, where it was typed or picked.
    expect(editor({ event })).toContain('value="🍴 Lunch at Pablo&#x27;s"')
  })
})

describe('the title field with an emoji in front', () => {
  const field = (value: string): string =>
    renderToString(
      React.createElement(TitleSuggestInput, {
        value,
        onChange: () => {},
        onPick: () => {},
        targetStartUtc: '2026-03-02T05:00:00.000Z',
        targetAllDay: false,
        calendars: [],
        enabled: true
      })
    )

  it('shows the emoji and the text as one title', () => {
    expect(field('🍴 Lunch')).toContain('value="🍴 Lunch"')
  })
})

describe('the emojis picked most, as the editor gets them', () => {
  it('reads the favoriteEmojis setting, most used first', () => {
    expect(displayPreferencesOf(DEFAULT_APP_SETTINGS).favoriteEmojis).toEqual([])
    expect(displayPreferencesOf({ ...DEFAULT_APP_SETTINGS, favoriteEmojis: '☕:1 🍴:5 🎂:2' }).favoriteEmojis).toEqual([
      '🍴',
      '🎂',
      '☕'
    ])
  })
})
