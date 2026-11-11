/**
 * An emoji in front of an event's title: "🍴 Lunch at Pablo's".
 *
 * The emoji is part of the title, not a field of its own, so it syncs to every
 * provider, shows wherever the title shows and needs no migration. What this
 * module knows is how to find one leading a title, put one there or take it
 * off, which emojis the editor's picker offers, and which of them the user
 * picks most.
 */

export type EmojiGroupId = 'people' | 'activities' | 'food' | 'travel' | 'objects' | 'symbols' | 'nature'

export interface EmojiGroup {
  id: EmojiGroupId
  emojis: readonly string[]
}

const each = (row: string): string[] => row.split(' ')

/**
 * What the picker offers: a compact set for a calendar (meals, travel, sport,
 * appointments, birthdays), not all of Unicode. Written out as characters so
 * the app carries no emoji data package; all of them are from Unicode 13 or
 * earlier, which the system emoji fonts of Windows 10 and current Linux have.
 * tests/title-emoji.test.ts holds each to one fully-qualified emoji, once.
 */
export const EMOJI_GROUPS: readonly EmojiGroup[] = [
  {
    id: 'people',
    emojis: each(
      '😀 😄 😊 🙂 😉 😍 🥰 😎 🤔 😴 😷 🥳 😭 😱 🙏 👍 👏 🙌 💪 👋 🤝 ✌️ 👀 👶 🧒 👦 👧 🧑 👨 👩 👴 👵 👪 👫 🧑‍💻 🧑‍🏫 🧑‍⚕️ 🧑‍🍳 💇 💆'
    )
  },
  {
    id: 'activities',
    emojis: each(
      '⚽ 🏀 ⚾ 🎾 🏐 🏓 🏸 🥊 ⛳ 🏹 🎣 🎿 ⛷️ 🏋️ 🤸 🧘 🏃 🚶 🚴 🏊 🏄 🚣 🧗 🏆 🥇 🏅 🎯 🎮 🎲 🧩 🎨 🎭 🎤 🎧 🎸 🎹 🥁 🎻 🎬 🎳'
    )
  },
  {
    id: 'food',
    emojis: each(
      '🍎 🍌 🍊 🍉 🍇 🍓 🍍 🥑 🥕 🥦 🍅 🥗 🍞 🥐 🧀 🍳 🍔 🍟 🍕 🌮 🍜 🍲 🍛 🍣 🍱 🥟 🍚 🍝 🍦 🍰 🎂 🍪 🍫 🍩 ☕ 🍵 🧋 🥤 🍺 🍻 🍷 🥂 🍹 🍴'
    )
  },
  {
    id: 'travel',
    emojis: each(
      '🚗 🚕 🚌 🚑 🚚 🚲 🛵 🏍️ 🚆 🚄 🚇 ✈️ 🛫 🚁 🚀 ⛵ 🚢 ⛽ 🚦 🗺️ 🧭 🧳 🏠 🏡 🏢 🏫 🏥 🏦 🏨 🏪 ⛪ 🕌 ⛩️ 🏛️ 🏖️ ⛰️ 🏕️ ⛺ 🗼 🎡 🎢 🌉'
    )
  },
  {
    id: 'objects',
    emojis: each(
      '📱 💻 ⌨️ 🖥️ 📷 ⏰ ⌚ 📅 🗓️ 📌 📍 📝 ✏️ 📚 📖 📦 ✉️ 📧 📞 💡 🔋 🔑 🔒 🔧 🧰 🧹 🛒 🛏️ 🛁 🪑 💊 💉 🩺 🦷 👓 👔 👟 🎒 🎁 🎈 🎉 💰 💳 🧾'
    )
  },
  {
    id: 'symbols',
    emojis: each(
      '❤️ 🧡 💛 💚 💙 💜 💔 ⭐ ✨ ⚡ 🔥 💧 ❗ ❓ ‼️ ✅ ❌ 🚫 ⚠️ ♻️ 💯 🔔 🔕 🎵 🎶 ➕ ✔️ 🔴 🟠 🟡 🟢 🔵 🟣 ⚫ ⚪ 🆕 🆘 💤 💬 🔁'
    )
  },
  {
    id: 'nature',
    emojis: each(
      '☀️ ⛅ ☁️ 🌧️ ⛈️ ❄️ 🌈 ☔ 🌙 🌊 🌍 🌱 🌿 🍀 🍂 🍁 🌳 🌴 🌵 🌷 🌹 🌺 🌸 🌻 💐 🐶 🐱 🐰 🐻 🐼 🦁 🐮 🐷 🐸 🐔 🐧 🐦 🐴 🦋 🐝 🐢 🐟 🐬 🐘'
    )
  }
]

const OFFERED = new Set(EMOJI_GROUPS.flatMap((group) => group.emojis))

// ─── An emoji leading a title ────────────────────────────────────────────────

/** A variation selector or a skin tone after a pictograph. */
const TAIL = '(?:\\uFE0F|\\p{Emoji_Modifier})*'

/**
 * One emoji as people type them, which is wider than the picker's set: titles
 * come from phones and other calendars too.
 *
 * - a flag: two regional indicators
 * - a keycap: 1️⃣, #️⃣
 * - a pictograph, with what may follow it: a variation selector, a skin tone,
 *   the tags of a subdivision flag, and further pictographs joined to it
 *   (👩‍💻, ❤️‍🔥)
 *
 * A character that is only an emoji when asked to be (©, ™, ↔, a digit) counts
 * when it carries the selector that asks, U+FE0F, and not otherwise: "© 2026
 * report" does not start with an emoji.
 */
const ONE_EMOJI =
  '(?:\\p{Regional_Indicator}{2}' +
  '|[0-9#*]\\uFE0F?\\u20E3' +
  `|(?:\\p{Emoji_Presentation}|\\p{Extended_Pictographic}(?=\\uFE0F|\\p{Emoji_Modifier}|\\u200D))${TAIL}` +
  '[\\u{E0020}-\\u{E007F}]*' +
  `(?:\\u200D\\p{Extended_Pictographic}${TAIL})*)`

const LEADING_EMOJI = new RegExp(`^\\s*(${ONE_EMOJI})\\s*`, 'u')

/** The emoji a title starts with and the title after it, or null when it starts with none. */
export function leadingEmoji(title: string): { emoji: string; rest: string } | null {
  const match = LEADING_EMOJI.exec(title)
  return match ? { emoji: match[1], rest: title.slice(match[0].length) } : null
}

/** The title without the emoji it starts with (as it was when it starts with none). */
export function withoutLeadingEmoji(title: string): string {
  return leadingEmoji(title)?.rest ?? title
}

/**
 * Whether anything has been typed in a title field: an emoji picked in front
 * of the title is not typing. The title suggestions wait for this, so picking
 * an emoji does not bring their list up over an otherwise empty field.
 */
export function hasTitleText(title: string): boolean {
  return withoutLeadingEmoji(title).trim().length > 0
}

/**
 * The title with `emoji` in front, a space after it, in place of an emoji that
 * was leading it already. An empty title becomes the emoji and the space, so
 * the next thing typed is the title.
 */
export function withLeadingEmoji(title: string, emoji: string): string {
  return `${emoji} ${withoutLeadingEmoji(title).trimStart()}`
}

/**
 * The title a suggestion gives the field. A suggestion replaces what was
 * typed; an emoji picked before typing is not something typed, so it stays in
 * front - unless the suggestion comes with an emoji of its own.
 */
export function titleFromSuggestion(typed: string, suggested: string): string {
  const picked = leadingEmoji(typed)
  if (!picked || leadingEmoji(suggested)) return suggested
  return withLeadingEmoji(suggested, picked.emoji)
}

// ─── The emojis picked most ──────────────────────────────────────────────────

/** How many the picker's "frequently used" row shows. */
export const FAVORITE_EMOJI_SHOWN = 16

/** How many are remembered: enough that one outside the row can work its way
 *  in. Past that, the one picked least goes (the longest ago among equals). */
const FAVORITE_EMOJI_KEPT = 48

/** A count large enough to be "always", small enough to stay a short number. */
const MAX_COUNT = 9999

interface EmojiUse {
  emoji: string
  count: number
}

/**
 * The `favoriteEmojis` setting read back: "🍴:5 🎂:2", most recently picked
 * first. A setting holds only plain values, hence one string. Anything in it
 * that is not an emoji the picker offers with a count is left out - the row is
 * drawn from this, and the setting is whatever was last written.
 */
function parseEmojiUses(setting: unknown): EmojiUse[] {
  if (typeof setting !== 'string') return []
  const uses: EmojiUse[] = []
  for (const entry of setting.split(' ')) {
    const colon = entry.lastIndexOf(':')
    if (colon <= 0) continue
    const emoji = entry.slice(0, colon)
    const count = Number(entry.slice(colon + 1))
    if (!OFFERED.has(emoji) || !Number.isInteger(count) || count < 1) continue
    if (uses.some((use) => use.emoji === emoji)) continue
    uses.push({ emoji, count: Math.min(count, MAX_COUNT) })
  }
  return uses
}

/** The emojis picked before, most used first (the latest pick first among equals). */
export function favoriteEmojis(setting: unknown, limit = FAVORITE_EMOJI_SHOWN): string[] {
  // The stored order is latest first, and the sort is stable.
  return parseEmojiUses(setting)
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
    .map((use) => use.emoji)
}

/** The setting after `emoji` was picked once more. One the picker does not offer changes nothing. */
export function recordEmojiUse(setting: unknown, emoji: string): string {
  const uses = parseEmojiUses(setting)
  if (!OFFERED.has(emoji)) return serializeEmojiUses(uses)
  const before = uses.find((use) => use.emoji === emoji)
  const next = [
    { emoji, count: Math.min((before?.count ?? 0) + 1, MAX_COUNT) },
    ...uses.filter((use) => use.emoji !== emoji)
  ]
  while (next.length > FAVORITE_EMOJI_KEPT) {
    // Never the one just picked, which is first.
    let drop = next.length - 1
    for (let i = drop - 1; i >= 1; i--) if (next[i].count < next[drop].count) drop = i
    next.splice(drop, 1)
  }
  return serializeEmojiUses(next)
}

function serializeEmojiUses(uses: EmojiUse[]): string {
  return uses.map((use) => `${use.emoji}:${use.count}`).join(' ')
}
