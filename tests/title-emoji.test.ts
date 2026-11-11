import { describe, it, expect } from 'vitest'
import {
  EMOJI_GROUPS,
  FAVORITE_EMOJI_SHOWN,
  favoriteEmojis,
  hasTitleText,
  leadingEmoji,
  recordEmojiUse,
  titleFromSuggestion,
  withLeadingEmoji,
  withoutLeadingEmoji
} from '../src/shared/title-emoji'

const ALL = EMOJI_GROUPS.flatMap((group) => group.emojis)

/** One emoji as Unicode recommends it be written (fully qualified), and nothing else. */
const ONE_RGI_EMOJI = new RegExp('^\\p{RGI_Emoji}$', 'v')

describe('the emojis the picker offers', () => {
  it('is a compact set in the seven groups, in the order shown', () => {
    expect(EMOJI_GROUPS.map((group) => group.id)).toEqual([
      'people',
      'activities',
      'food',
      'travel',
      'objects',
      'symbols',
      'nature'
    ])
    expect(ALL.length).toBeGreaterThanOrEqual(200)
    expect(ALL.length).toBeLessThanOrEqual(300)
    for (const group of EMOJI_GROUPS) expect(group.emojis.length).toBeGreaterThanOrEqual(24)
  })

  it('lists each emoji once', () => {
    const seen = new Set<string>()
    const twice = ALL.filter((emoji) => (seen.has(emoji) ? true : (seen.add(emoji), false)))
    expect(twice).toEqual([])
  })

  // A stray space, a missing variation selector (which draws ✈ as a black
  // glyph) or two emojis run together would each show as a broken cell.
  it('writes each as exactly one fully-qualified emoji', () => {
    expect(ALL.filter((emoji) => !ONE_RGI_EMOJI.test(emoji))).toEqual([])
  })

  it('offers nothing the title functions would not take off again', () => {
    const kept = ALL.filter((emoji) => {
      const found = leadingEmoji(`${emoji} Lunch`)
      return found?.emoji !== emoji || found.rest !== 'Lunch'
    })
    expect(kept).toEqual([])
  })
})

describe('leadingEmoji', () => {
  it('finds the emoji a title starts with, and the title after it', () => {
    expect(leadingEmoji("🍴 Lunch at Pablo's")).toEqual({ emoji: '🍴', rest: "Lunch at Pablo's" })
    expect(leadingEmoji('🎂Birthday')).toEqual({ emoji: '🎂', rest: 'Birthday' })
    expect(leadingEmoji('  ☕  Cà phê')).toEqual({ emoji: '☕', rest: 'Cà phê' })
    expect(leadingEmoji('🎂')).toEqual({ emoji: '🎂', rest: '' })
  })

  it('takes a whole sequence as one emoji', () => {
    // A variation selector, a skin tone, people joined into one, a flag, a keycap.
    for (const emoji of ['❤️', '👍🏽', '🧑‍💻', '👨‍👩‍👧', '🏳️‍🌈', '❤️‍🔥', '🇻🇳', '1️⃣', '🏴\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}']) {
      expect(leadingEmoji(`${emoji} Trip`)).toEqual({ emoji, rest: 'Trip' })
    }
  })

  it('takes only the first of several', () => {
    expect(leadingEmoji('🎉🎂 Party')).toEqual({ emoji: '🎉', rest: '🎂 Party' })
  })

  it('finds none in a title that starts with text', () => {
    expect(leadingEmoji('Lunch 🍴')).toBeNull()
    expect(leadingEmoji('Lunch')).toBeNull()
    expect(leadingEmoji('')).toBeNull()
    expect(leadingEmoji('Họp nhóm')).toBeNull()
  })

  it('does not take a digit, a sign or a text symbol for an emoji', () => {
    for (const title of ['3 things to buy', '#1 priority', '* starred', '© 2026 report', '™ review', '↔ swap desks']) {
      expect(leadingEmoji(title)).toBeNull()
    }
  })
})

describe('withLeadingEmoji / withoutLeadingEmoji', () => {
  it('puts the emoji in front, with a space', () => {
    expect(withLeadingEmoji('Lunch', '🍴')).toBe('🍴 Lunch')
    expect(withLeadingEmoji('  Lunch', '🍴')).toBe('🍴 Lunch')
  })

  it('makes an empty title the emoji and a space, ready for the title', () => {
    expect(withLeadingEmoji('', '🍴')).toBe('🍴 ')
    expect(withLeadingEmoji('   ', '🍴')).toBe('🍴 ')
  })

  it('replaces an emoji already leading the title', () => {
    expect(withLeadingEmoji('🥗 Lunch', '🍴')).toBe('🍴 Lunch')
    expect(withLeadingEmoji('🧑‍💻Standup', '☕')).toBe('☕ Standup')
    expect(withLeadingEmoji('🥗 ', '🍴')).toBe('🍴 ')
    // Only the leading one: an emoji further in is part of the title.
    expect(withLeadingEmoji('Lunch 🥗', '🍴')).toBe('🍴 Lunch 🥗')
  })

  it('takes a leading emoji off, and leaves a title without one alone', () => {
    expect(withoutLeadingEmoji("🍴 Lunch at Pablo's")).toBe("Lunch at Pablo's")
    expect(withoutLeadingEmoji('🍴')).toBe('')
    expect(withoutLeadingEmoji('Lunch 🍴')).toBe('Lunch 🍴')
    expect(withoutLeadingEmoji(' Lunch')).toBe(' Lunch')
  })
})

describe('hasTitleText', () => {
  it('is false until something besides a leading emoji is there', () => {
    expect(hasTitleText('')).toBe(false)
    expect(hasTitleText('   ')).toBe(false)
    // What the emoji button leaves in an empty field.
    expect(hasTitleText('🍴 ')).toBe(false)
    expect(hasTitleText('🧑‍💻')).toBe(false)
  })

  it('is true for text, with or without an emoji in front', () => {
    expect(hasTitleText('L')).toBe(true)
    expect(hasTitleText('🍴 L')).toBe(true)
    expect(hasTitleText('🍴L')).toBe(true)
    // A second emoji is something typed.
    expect(hasTitleText('🍴 🥗')).toBe(true)
  })
})

describe('titleFromSuggestion', () => {
  it('is the suggestion when no emoji was picked', () => {
    expect(titleFromSuggestion('lun', "Lunch at Pablo's")).toBe("Lunch at Pablo's")
  })

  it('keeps an emoji picked before typing in front of a suggestion that has none', () => {
    expect(titleFromSuggestion('🍴 lun', "Lunch at Pablo's")).toBe("🍴 Lunch at Pablo's")
  })

  it("leaves a suggestion's own emoji alone", () => {
    expect(titleFromSuggestion('🍴 lun', '🥗 Lunch with Sam')).toBe('🥗 Lunch with Sam')
    expect(titleFromSuggestion('lun', '🥗 Lunch with Sam')).toBe('🥗 Lunch with Sam')
  })
})

describe('the emojis picked most', () => {
  const pick = (setting: string, ...emojis: string[]): string =>
    emojis.reduce((stored, emoji) => recordEmojiUse(stored, emoji), setting)

  it('starts empty', () => {
    expect(favoriteEmojis('')).toEqual([])
    expect(favoriteEmojis(undefined)).toEqual([])
  })

  it('counts each pick in one plain string', () => {
    const stored = pick('', '🍴', '🎂', '🍴')
    expect(stored).toBe('🍴:2 🎂:1')
    expect(pick(stored, '🧑‍💻')).toBe('🧑‍💻:1 🍴:2 🎂:1')
  })

  it('lists the most picked first, the latest pick first among equals', () => {
    const stored = pick('', '☕', '🍴', '🎂', '🍴', '⚽')
    expect(favoriteEmojis(stored)).toEqual(['🍴', '⚽', '🎂', '☕'])
  })

  it(`shows at most ${FAVORITE_EMOJI_SHOWN}`, () => {
    const stored = pick('', ...ALL.slice(0, 30))
    expect(favoriteEmojis(stored)).toHaveLength(16)
    expect(favoriteEmojis(stored, 4)).toHaveLength(4)
    // The latest of thirty single picks.
    expect(favoriteEmojis(stored)[0]).toBe(ALL[29])
  })

  it('remembers a bounded number, dropping the one picked least and longest ago', () => {
    // Sixty different emojis: the first is picked three times, the rest once.
    let stored = pick('', ALL[0], ALL[0], ALL[0])
    stored = pick(stored, ...ALL.slice(1, 60))
    const kept = stored.split(' ')
    expect(kept).toHaveLength(48)
    expect(kept[0]).toBe(`${ALL[59]}:1`)
    expect(stored).toContain(`${ALL[0]}:3`)
    // The earliest single picks are the ones that went.
    expect(stored).not.toContain(`${ALL[1]}:`)
    expect(favoriteEmojis(stored)[0]).toBe(ALL[0])
  })

  it('ignores anything in the setting that is not an offered emoji with a count', () => {
    const stored = '🍴:2 <b>:9 lunch:3 🎂 🎂:0 ☕:x ⚽:1.5 🍴:7 :4 🏁:3 🎉:2'
    expect(favoriteEmojis(stored)).toEqual(['🍴', '🎉'])
    expect(favoriteEmojis(42)).toEqual([])
    expect(favoriteEmojis(null)).toEqual([])
    // Recording rewrites it clean.
    expect(recordEmojiUse(stored, '🎉')).toBe('🎉:3 🍴:2')
  })

  it('does not record an emoji the picker does not offer', () => {
    expect(recordEmojiUse('🍴:2', 'x')).toBe('🍴:2')
    expect(recordEmojiUse('🍴:2', '🍴:9 🎂')).toBe('🍴:2')
  })

  it('stops counting at a number that stays short', () => {
    expect(recordEmojiUse('🍴:9999', '🍴')).toBe('🍴:9999')
    expect(favoriteEmojis('🍴:123456789')).toEqual(['🍴'])
  })
})
