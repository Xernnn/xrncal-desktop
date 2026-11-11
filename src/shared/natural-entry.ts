/**
 * Dates, times and repeats typed into a new event's title, in Vietnamese and
 * English: "Họp 3h chiều thứ 6", "Lunch with Sam tomorrow at 12:30",
 * "Giỗ ông 12/8 âm lịch", "Chạy bộ 6h sáng hàng ngày".
 *
 * `parseEntry()` says what it found and what the title is without it; the
 * editor fills its fields from that as the title is typed and saves the
 * shorter title. Only what is clearly a date or time is taken: a bare number
 * is never a time ("Phòng 3"), a period word belongs to the title unless it
 * sits next to a time or a day ("Ăn tối 7h" keeps "Ăn tối"), and "Mai" with a
 * capital is a name, not tomorrow.
 *
 * Diacritics are optional throughout ("thu 6", "3h chieu"), except where
 * leaving them off makes another word ("mốt", the day after tomorrow, is
 * "một", one, without them). Dates are day first, as the app shows them.
 */
import { DateTime } from 'luxon'
import type { LunarRecurrenceSpec } from './event-model'
import { resolveLunarOccurrence } from './lunar-vietnam'
import { startOfWeek } from './week-start'

export type EntryWeekday = 'MO' | 'TU' | 'WE' | 'TH' | 'FR' | 'SA' | 'SU'

/** Indexed by Luxon weekday - 1. */
export const ENTRY_WEEKDAYS: readonly EntryWeekday[] = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU']

export type EntryRepeat =
  | { kind: 'daily' | 'monthly' | 'yearly' }
  | { kind: 'weekly'; byDay?: EntryWeekday }
  | { kind: 'lunar-yearly'; spec: LunarRecurrenceSpec }

export interface ParsedEntry {
  /** The title with what was recognised taken out. Never empty. */
  title: string
  /** yyyy-MM-dd. For a lunar date, its next Gregorian date (today counts). */
  date?: string
  /** HH:mm, 24-hour. */
  start?: string
  /** HH:mm; earlier than `start` means the next day ("22h-1h"). */
  end?: string
  durationMinutes?: number
  allDay?: boolean
  repeat?: EntryRepeat
  /** The phrases recognised, as typed, in the order they appear. */
  matched: string[]
}

export interface EntryContext {
  /** The day "today", "thứ 6" and a year left out are counted from. */
  today: DateTime
  /** For "next week" (0 Sunday, 1 Monday, 6 Saturday). */
  firstDayOfWeek: number
}

// ─── Pattern pieces (matched against the lower-cased title) ──────────────────

const S = '\\s+'
const O = '\\s*'
const NGAY = 'ng[aà]y'
const THANG = '(?:th[aá]ng|thg)'
const NAM = 'n[aă]m'
const THU = 'th[uứ]'
const TUAN = 'tu[aầ]n'
const NHUAN = 'nhu[aậ]n'
const AM_LICH = `(?:\\(${O})?(?:[aâ]m${O}l[iị]ch|[aâ]m|[aâ]l)(?:${O}\\))?`
const LUNAR_MONTH = '\\d{1,2}|gi[eê]ng|ch[aạ]p'
const PERIOD_WORDS = 's[aá]ng|tr[uư]a|chi[eề]u|t[oố]i|(?:đ|d)[eê]m|khuya|morning|afternoon|evening|night'
const period = (name: string): string => `(?<${name}>${PERIOD_WORDS})`
const EN_WEEKDAY = 'monday|tuesday|wednesday|thursday|friday|saturday|sunday'
const EN_MONTH =
  'january|february|march|april|may|june|july|august|september|october|november|december|' +
  'jan|feb|mar|apr|jun|jul|aug|sept|sep|oct|nov|dec'
/** "thứ 6", "thứ sáu", "t6", "chủ nhật", "cn"; groups `${p}n` (thứ ...), `${p}t` (tN), `${p}cn`. */
const vnWeekday = (p: string): string =>
  `${THU}${O}(?<${p}n>[2-7]|hai|ba|t[uư]|n[aă]m|s[aá]u|b[aả]y)|t(?<${p}t>[2-7])|(?<${p}cn>ch[uủ]${O}nh[aậ]t|cn)`
/** One clock time: hour, optional separator + minutes, optional am/pm or period word. */
const clock = (p: string): string =>
  `(?<${p}h>\\d{1,2})` +
  `(?:(?<${p}sep>:|h|g(?=\\d)|${O}gi[oờ]${O})(?<${p}min>\\d{2}|${O}r[uư][oỡ]i)?(?:${O}(?:ph[uú]t|p))?)?` +
  `(?:${O}(?<${p}mer>a\\.?m\\.?|p\\.?m\\.?|${PERIOD_WORDS}))?`

/** A word or number may not continue on either side of a match. */
const pattern = (source: string): RegExp => new RegExp(`(?<![\\p{L}\\p{N}])(?:${source})(?![\\p{L}\\p{N}])`, 'gu')

const LUNAR_NUMERIC = pattern(
  `(?:${NGAY}${S})?(?<d>\\d{1,2})${O}(?:\\/|-|${THANG})${O}(?<m>${LUNAR_MONTH})` +
    `(?:${O}(?<leap1>${NHUAN}))?${O}${AM_LICH}(?:${O}(?<leap2>${NHUAN}))?`
)
// Tháng giêng and tháng chạp are lunar months by name.
const LUNAR_NAMED_MONTH = pattern(
  `(?:${NGAY}${S}|m[uùoồ]ng${O})?(?<d>\\d{1,2})${O}${THANG}${O}(?<m>gi[eê]ng|ch[aạ]p)(?:${O}(?<leap1>${NHUAN}))?(?:${O}${AM_LICH})?`
)
const LUNAR_RAM = pattern(`r[aằ]m${O}${THANG}${O}(?<m>${LUNAR_MONTH})(?:${O}(?<leap1>${NHUAN}))?(?:${O}${AM_LICH})?`)
const LUNAR_MUNG = pattern(
  `m[uùoồ]ng${O}(?<d>\\d{1,2})${O}(?:${THANG}${O}(?<m>${LUNAR_MONTH})(?:${O}(?<leap1>${NHUAN}))?(?:${O}${AM_LICH})?|(?<tet>t[eế]t))`
)

const DURATION = pattern(
  `(?:for|trong)${S}(?<h>\\d{1,2})(?:[.,](?<tenth>\\d))?${O}(?:hours?|hrs?|h|ti[eế]ng|gi[oờ])` +
    `(?:${O}(?<m>\\d{1,2})(?:${O}(?:minutes?|mins?|ph[uú]t|p|m))?)?` +
    `|(?:for|trong)${S}(?<mm>\\d{1,3})${O}(?:minutes?|mins?|ph[uú]t|p)`
)

const DATE_SLASH = pattern(`(?:(?:${NGAY}|on)${S})?(?<d>\\d{1,2})\\/(?<m>\\d{1,2})(?:\\/(?<y>\\d{4}|\\d{2}))?`)
const DATE_VN = pattern(
  `(?:${NGAY}${O})?(?<d>\\d{1,2})${O}${THANG}${O}(?<m>\\d{1,2})(?:${O}(?:${NAM}${O})?(?<y>\\d{4}))?`
)
const DATE_EN_MONTH_FIRST = pattern(
  `(?:on${S})?(?<mon>${EN_MONTH})\\.?${S}(?<d>\\d{1,2})(?:st|nd|rd|th)?(?:,?${S}(?<y>\\d{4}))?`
)
const DATE_EN_DAY_FIRST = pattern(
  `(?:on${S})?(?:the${S})?(?<d>\\d{1,2})(?:st|nd|rd|th)?${S}(?:of${S})?(?<mon>${EN_MONTH})\\.?(?:,?${S}(?<y>\\d{4}))?`
)

const REPEAT_EVERY_WEEKDAY = pattern(`(?:every|each)${S}(?<en>${EN_WEEKDAY})s?|m[oỗ]i${O}(?:${vnWeekday('w')})`)
const REPEAT_DAILY = pattern(`(?:every|each)${S}day|daily|(?:h[aàằ]ng|m[oỗ]i)${O}${NGAY}`)
const REPEAT_WEEKLY = pattern(`(?:every|each)${S}week|weekly|(?:h[aàằ]ng|m[oỗ]i)${O}${TUAN}`)
const REPEAT_MONTHLY = pattern(`(?:every|each)${S}month|monthly|(?:h[aàằ]ng|m[oỗ]i)${O}th[aá]ng`)
const REPEAT_YEARLY = pattern(`(?:every|each)${S}year|yearly|annually|(?:h[aàằ]ng|m[oỗ]i)${O}${NAM}`)

// "ăn tối", "bữa trưa": the period word is a meal there, not a time of day.
const NOT_A_MEAL = '(?<!(?:[aă]n|b[uữ]a)\\s)'
const RELATIVE_DAY = pattern(
  `(?:${NOT_A_MEAL}${period('p1')}${S})?` +
    `(?<rel>h[oô]m${O}nay|nay|today|tonight|${NGAY}${O}mai|mai|tomorrow|${NGAY}${O}kia|${NGAY}${O}mốt|mốt|(?:the${S})?day${S}after${S}tomorrow)` +
    `(?:${S}${period('p2')})?` +
    `|in${S}(?<n1>\\d{1,2})${S}days?|(?<n2>\\d{1,2})${O}${NGAY}${O}n[uữ]a|sau${S}(?<n3>\\d{1,2})${O}${NGAY}`
)
const VN_WEEKDAY = pattern(
  `(?:${NOT_A_MEAL}${period('p1')}${S})?(?:v[aà]o${S})?(?:${vnWeekday('v')})` +
    `(?:${S}(?<mod>${TUAN}${S}(?:sau|t[ớo]i|n[aà]y)|n[aà]y|t[ớo]i))?(?:${S}${period('p2')})?`
)
const EN_WEEKDAY_RE = pattern(
  `(?:(?<mod>next|this|coming|on)${S})?(?<wd>${EN_WEEKDAY})(?:${S}(?<nw>next${S}week))?` +
    `(?:${S}(?<p2>morning|afternoon|evening|night))?`
)

const TIME_RANGE = pattern(
  `(?:(?:from|t[uừ]|v[aà]o|l[uú]c|at)${S})?${clock('a')}${O}(?:-|–|—|to|until|till|(?:đ|d)[eế]n|tới)${O}${clock('b')}`
)
const TIME = pattern(`(?:v[aà]o${S})?(?:(?<at>at|@|l[uú]c)${O})?${clock('a')}`)
const NOON = pattern(`(?:at${S})?(?:noon|midday)`)
const ALL_DAY = pattern(`all${O}-?${O}day|c[aả]${S}${NGAY}|nguy[eê]n${S}${NGAY}`)

// ─── Values ──────────────────────────────────────────────────────────────────

type Period = 'morning' | 'noon' | 'afternoon' | 'evening' | 'night'

/** A period word just before this point ("3h tối| nay"). */
const PERIOD_BEFORE = new RegExp(`(?:${PERIOD_WORDS})\\s*$`, 'u')

// A meal says when a bare hour is ("Ăn tối 7h", "Dinner at 7") but stays in the title.
const MEAL_PERIOD: Array<[RegExp, Period]> = [
  [/(?:[aă]n|b[uữ]a)\s+s[aá]ng|breakfast/u, 'morning'],
  [/(?:[aă]n|b[uữ]a)\s+tr[uư]a|lunch/u, 'noon'],
  [/(?:[aă]n|b[uữ]a)\s+t[oố]i|dinner|supper/u, 'evening']
]

function periodOf(word: string | undefined): Period | undefined {
  if (!word) return undefined
  if (/^(?:s[aá]ng|morning)$/.test(word)) return 'morning'
  if (/^tr[uư]a$/.test(word)) return 'noon'
  if (/^(?:chi[eề]u|afternoon)$/.test(word)) return 'afternoon'
  if (/^(?:t[oố]i|evening)$/.test(word)) return 'evening'
  return 'night'
}

const VN_WEEKDAY_WORDS: Record<string, number> = {
  '2': 1, hai: 1, '3': 2, ba: 2, '4': 3, tư: 3, tu: 3, '5': 4, năm: 4, nam: 4, '6': 5, sáu: 5, sau: 5, '7': 6, bảy: 6, bay: 6
}

/** Luxon weekday (1 Monday ... 7 Sunday) from a vnWeekday() match. */
function vnWeekdayOf(groups: Record<string, string | undefined>, p: string): number | undefined {
  if (groups[`${p}cn`]) return 7
  const word = groups[`${p}n`] ?? groups[`${p}t`]
  return word ? VN_WEEKDAY_WORDS[word] : undefined
}

function enWeekdayOf(word: string): number {
  return EN_WEEKDAY.split('|').indexOf(word) + 1
}

const EN_MONTH_NUMBERS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12
}

function enMonthOf(word: string): number {
  return EN_MONTH_NUMBERS[word.slice(0, word === 'sept' ? 4 : 3)]
}

function lunarMonthOf(word: string): number {
  if (/^gi[eê]ng$/.test(word)) return 1
  if (/^ch[aạ]p$/.test(word)) return 12
  return Number(word)
}

interface Clock {
  hour: number
  minute: number
  /** am/pm or a period word was given with it. */
  meridiem?: 'am' | 'pm' | Period
  /** Written with a separator ("3h", "3:00", "3 giờ"). */
  separated: boolean
  /** Written with a leading zero ("05:30"): a 24-hour clock, taken as is. */
  padded: boolean
}

function clockOf(groups: Record<string, string | undefined>, p: string): Clock | null {
  const rawHour = groups[`${p}h`]
  if (rawHour === undefined) return null
  const rawMinute = groups[`${p}min`]
  const minute = rawMinute === undefined ? 0 : /\d/.test(rawMinute) ? Number(rawMinute) : 30
  if (minute > 59) return null
  const mer = groups[`${p}mer`]?.replace(/\./g, '')
  return {
    hour: Number(rawHour),
    minute,
    meridiem: mer === undefined ? undefined : mer === 'am' || mer === 'pm' ? mer : periodOf(mer),
    separated: groups[`${p}sep`] !== undefined,
    padded: rawHour.length === 2 && rawHour.startsWith('0')
  }
}

/** The 24-hour hour a clock means, or null if it cannot be one. */
function resolveHour(c: Clock, context?: Period): number | null {
  const { hour } = c
  const mer = c.meridiem ?? context
  if (mer === 'am' || mer === 'pm') {
    if (hour < 1 || hour > 12) return null
    return (hour % 12) + (mer === 'pm' ? 12 : 0)
  }
  if (hour > 23) return null
  switch (mer) {
    case 'morning':
      return hour
    case 'noon':
      return hour >= 1 && hour <= 4 ? hour + 12 : hour
    case 'afternoon':
    case 'evening':
      return hour >= 1 && hour < 12 ? hour + 12 : hour
    case 'night':
      return hour >= 6 && hour < 12 ? hour + 12 : hour === 12 ? 0 : hour
    default:
      // "Họp 3h" is a meeting at three in the afternoon, not the night; a
      // leading zero ("03:00") is a 24-hour clock read as written.
      return !c.padded && hour >= 1 && hour <= 6 ? hour + 12 : hour
  }
}

const hhmm = (hour: number, minute: number): string =>
  `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`

/** The date given by day and month, in `year` - or, with none given, the next one from today. */
function solarDate(today: DateTime, day: number, month: number, year?: number): DateTime | null {
  if (year !== undefined) {
    const d = DateTime.fromObject({ year: year < 100 ? 2000 + year : year, month, day })
    return d.isValid ? d : null
  }
  for (const y of [today.year, today.year + 1]) {
    const d = DateTime.fromObject({ year: y, month, day })
    if (d.isValid && d >= today.startOf('day')) return d
  }
  // February 29th in a year without one: the next leap year's.
  for (let y = today.year + 2; y <= today.year + 8; y++) {
    const d = DateTime.fromObject({ year: y, month, day })
    if (d.isValid) return d
  }
  return null
}

/** The next Gregorian date of a lunar day and month (today counts). */
function nextLunarDate(today: DateTime, spec: LunarRecurrenceSpec): DateTime | null {
  const todayIso = today.toISODate()!
  for (const y of [today.year, today.year + 1, today.year + 2]) {
    const iso = resolveLunarOccurrence(spec, y)
    if (iso && iso >= todayIso) return DateTime.fromISO(iso)
  }
  return null
}

/** This weekday from today on (today counts). */
function upcomingWeekday(today: DateTime, weekday: number): DateTime {
  return today.plus({ days: (weekday - today.weekday + 7) % 7 })
}

/** This weekday in next week, by the week start the user chose. */
function weekdayNextWeek(today: DateTime, weekday: number, firstDayOfWeek: number): DateTime {
  const next = startOfWeek(today, firstDayOfWeek).plus({ weeks: 1 })
  return next.plus({ days: (weekday - next.weekday + 7) % 7 })
}

// ─── Scanning ────────────────────────────────────────────────────────────────

/**
 * The title, lower-cased (character for character, so positions line up with
 * the original), with what has been recognised blanked out so that no later
 * pattern can match it again.
 */
class Scanner {
  readonly spans: Array<[number, number]> = []
  /** The whole title lower-cased, nothing blanked. */
  readonly lower: string
  private work: string

  constructor(readonly text: string) {
    let lower = ''
    for (const ch of text) {
      const l = ch.toLowerCase()
      lower += l.length === ch.length ? l : ch
    }
    this.lower = lower
    this.work = lower
  }

  /** Each match of `re` not yet taken; `accept` returns false to leave it for other patterns. */
  scan(re: RegExp, accept: (groups: Record<string, string | undefined>, at: number, raw: string) => boolean): void {
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(this.work)) !== null) {
      if (m[0].length === 0) {
        re.lastIndex++
        continue
      }
      const start = m.index
      const end = start + m[0].length
      if (accept(m.groups ?? {}, start, this.text.slice(start, end))) {
        this.spans.push([start, end])
        this.work = this.work.slice(0, start) + '\u0000'.repeat(end - start) + this.work.slice(end)
      }
    }
  }

  /** The title without what was taken, tidied. */
  rest(): string {
    let out = ''
    for (let i = 0; i < this.text.length; i++) out += this.work[i] === '\u0000' ? ' ' : this.text[i]
    out = out.replace(/\s+/g, ' ').trim()
    // Words that only led into what was taken out ("lúc", "vào", "at", "on").
    const dangling = /(?:^|\s)(?:at|on|from|in|l[uú]c|v[aà]o|t[uừ]|ng[aà]y|@|[-–—,;:])$/iu
    for (let guard = 0; guard < 4 && dangling.test(out); guard++) out = out.replace(dangling, '').trim()
    return out.replace(/^[\s,;:\-–—@]+|[\s,;:\-–—@]+$/gu, '').trim()
  }

  matched(): string[] {
    return [...this.spans].sort((a, b) => a[0] - b[0]).map(([s, e]) => this.text.slice(s, e).trim())
  }
}

/** What has been recognised so far. */
interface Found {
  lunar?: { spec: LunarRecurrenceSpec; date: DateTime }
  /** By strength: explicit (3) beats relative (2) beats a weekday (1). */
  date?: { value: DateTime; strength: number }
  weekday?: number
  /** "chiều mai", "tối nay": how a bare hour later on is read. */
  dayPeriod?: Period
  /** The clock typed, read once the day words are known. */
  time?: { a: Clock; b?: Clock } | 'noon'
  durationMinutes?: number
  allDay?: boolean
  repeat?: EntryRepeat
}

/** For a bare end hour ("22h-1h", "2h-4h"): whichever of h and h+12 comes soonest after the start. */
function soonestAfter(startMinutes: number, end: Clock): number {
  const candidates = end.hour < 12 ? [end.hour, end.hour + 12] : [end.hour % 24]
  const wait = (h: number): number => (h * 60 + end.minute - startMinutes + 1440 - 1) % 1440
  return candidates.reduce((best, h) => (wait(h) < wait(best) ? h : best))
}

/** The start (and end) a typed time or range means, given the part of the day it is in. */
function readClocks(a: Clock, b: Clock | undefined, dayPeriod: Period | undefined): { start?: string; end?: string } {
  if (!b) {
    const hour = resolveHour(a, dayPeriod)
    return hour === null ? {} : { start: hhmm(hour, a.minute) }
  }
  // "3-5pm": the start takes the end's am/pm - unless that puts it after the end ("11-1pm").
  const inherited = !a.meridiem && b.meridiem ? { ...a, meridiem: b.meridiem } : a
  let startHour = resolveHour(inherited, dayPeriod)
  if (startHour === null) return {}
  const bare = !b.meridiem && !dayPeriod && !b.padded && b.hour <= 12
  let endHour = bare ? soonestAfter(startHour * 60 + a.minute, b) : resolveHour(b, dayPeriod)
  if (endHour === null) return {}
  if (inherited !== a && startHour * 60 + a.minute > endHour * 60 + b.minute) {
    startHour = resolveHour(a, dayPeriod)
    if (startHour === null) return {}
    if (bare) endHour = soonestAfter(startHour * 60 + a.minute, b)
  }
  return { start: hhmm(startHour, a.minute), end: hhmm(endHour, b.minute) }
}

/**
 * What the title says about when the event is, or null when it says nothing
 * (or nothing would be left of it once that was taken out).
 */
export function parseEntry(rawTitle: string, context: EntryContext): ParsedEntry | null {
  const text = rawTitle.normalize('NFC')
  const today = context.today.startOf('day')
  const scan = new Scanner(text)
  const f: Found = {}

  const setDate = (value: DateTime | null, strength: number): boolean => {
    if (!value) return false
    if (!f.date || strength > f.date.strength) f.date = { value, strength }
    return true
  }

  // Lunar dates first: "12/8 âm lịch" is not the 12th of August.
  const takeLunar = (day: number, month: number, leap: boolean): boolean => {
    if (f.lunar || day < 1 || day > 30 || month < 1 || month > 12) return false
    const spec = { day, month, leap }
    const date = nextLunarDate(today, spec)
    if (!date) return false
    f.lunar = { spec, date }
    return true
  }
  scan.scan(LUNAR_NUMERIC, (g) => takeLunar(Number(g.d), lunarMonthOf(g.m!), Boolean(g.leap1 || g.leap2)))
  scan.scan(LUNAR_NAMED_MONTH, (g) => takeLunar(Number(g.d), lunarMonthOf(g.m!), Boolean(g.leap1)))
  scan.scan(LUNAR_RAM, (g) => takeLunar(15, lunarMonthOf(g.m!), Boolean(g.leap1)))
  scan.scan(LUNAR_MUNG, (g) => takeLunar(Number(g.d), g.tet ? 1 : lunarMonthOf(g.m!), Boolean(g.leap1)))

  scan.scan(DURATION, (g) => {
    const minutes =
      g.mm !== undefined ? Number(g.mm) : Number(g.h) * 60 + (g.tenth ? Number(g.tenth) * 6 : 0) + (g.m ? Number(g.m) : 0)
    if (minutes <= 0 || minutes > 24 * 60) return false
    f.durationMinutes = minutes
    return true
  })

  const year = (y: string | undefined): number | undefined => (y ? Number(y) : undefined)
  scan.scan(DATE_SLASH, (g) => setDate(solarDate(today, Number(g.d), Number(g.m), year(g.y)), 3))
  scan.scan(DATE_VN, (g) => setDate(solarDate(today, Number(g.d), Number(g.m), year(g.y)), 3))
  scan.scan(DATE_EN_MONTH_FIRST, (g) => setDate(solarDate(today, Number(g.d), enMonthOf(g.mon!), year(g.y)), 3))
  scan.scan(DATE_EN_DAY_FIRST, (g) => setDate(solarDate(today, Number(g.d), enMonthOf(g.mon!), year(g.y)), 3))

  // Times before day words, so a period word right after a time is the
  // time's ("3h chiều thứ 6"); they are read at the end, once "tối nay" or a
  // meal has said what part of the day a bare hour is in.
  scan.scan(TIME_RANGE, (g) => {
    if (f.time) return false
    const a = clockOf(g, 'a')
    const b = clockOf(g, 'b')
    // "Phòng 3-5" is not a time; "3-5pm" and "15h-17h" are.
    if (!a || !b || !(a.separated || a.meridiem || b.separated || b.meridiem)) return false
    if (resolveHour(a) === null || resolveHour(b) === null) return false
    f.time = { a, b }
    return true
  })
  scan.scan(TIME, (g) => {
    if (f.time) return false
    const a = clockOf(g, 'a')
    if (!a || !(a.separated || a.meridiem || g.at) || resolveHour(a) === null) return false
    f.time = { a }
    return true
  })
  scan.scan(NOON, () => {
    if (f.time) return false
    f.time = 'noon'
    return true
  })

  scan.scan(REPEAT_EVERY_WEEKDAY, (g) => {
    const wd = g.en ? enWeekdayOf(g.en) : vnWeekdayOf(g, 'w')
    if (!wd || f.repeat) return false
    f.weekday = wd
    setDate(upcomingWeekday(today, wd), 1)
    f.repeat = { kind: 'weekly', byDay: ENTRY_WEEKDAYS[wd - 1] }
    return true
  })
  const takeRepeat = (repeat: EntryRepeat) => (): boolean => {
    if (f.repeat) return false
    f.repeat = repeat
    return true
  }
  scan.scan(REPEAT_DAILY, takeRepeat({ kind: 'daily' }))
  scan.scan(REPEAT_WEEKLY, takeRepeat({ kind: 'weekly' }))
  scan.scan(REPEAT_MONTHLY, takeRepeat({ kind: 'monthly' }))
  scan.scan(REPEAT_YEARLY, takeRepeat({ kind: 'yearly' }))

  scan.scan(RELATIVE_DAY, (g, at) => {
    const n = g.n1 ?? g.n2 ?? g.n3
    if (n !== undefined) return Number(n) > 0 && setDate(today.plus({ days: Number(n) }), 2)
    const rel = g.rel!
    // "nay" alone is not today, and "Mai" with a capital is a name.
    if (rel === 'nay' && !g.p1 && !PERIOD_BEFORE.test(scan.lower.slice(0, at))) return false
    if (rel === 'mai' && !g.p1 && scan.text[at] === 'M') return false
    const days = /after|kia|mốt/.test(rel) ? 2 : /mai|tomorrow/.test(rel) ? 1 : 0
    f.dayPeriod = periodOf(g.p1 ?? g.p2) ?? (rel === 'tonight' ? 'evening' : f.dayPeriod)
    return setDate(today.plus({ days }), 2)
  })

  scan.scan(VN_WEEKDAY, (g) => {
    const wd = vnWeekdayOf(g, 'v')
    if (!wd) return false
    const nextWeek = g.mod !== undefined && /sau|t[ớo]i/.test(g.mod)
    f.weekday = f.weekday ?? wd
    f.dayPeriod = periodOf(g.p1 ?? g.p2) ?? f.dayPeriod
    return setDate(nextWeek ? weekdayNextWeek(today, wd, context.firstDayOfWeek) : upcomingWeekday(today, wd), 1)
  })
  scan.scan(EN_WEEKDAY_RE, (g) => {
    const wd = enWeekdayOf(g.wd!)
    const nextWeek = g.mod === 'next' || g.nw !== undefined
    f.weekday = f.weekday ?? wd
    f.dayPeriod = periodOf(g.p2) ?? f.dayPeriod
    return setDate(nextWeek ? weekdayNextWeek(today, wd, context.firstDayOfWeek) : upcomingWeekday(today, wd), 1)
  })

  scan.scan(ALL_DAY, () => {
    f.allDay = true
    return true
  })

  if (scan.spans.length === 0) return null
  const title = scan.rest()
  if (!title) return null

  const dayPeriod = f.dayPeriod ?? MEAL_PERIOD.find(([re]) => re.test(scan.lower))?.[1]
  const clocks = f.time === 'noon' ? { start: '12:00' } : f.time ? readClocks(f.time.a, f.time.b, dayPeriod) : {}

  const out: ParsedEntry = { title, matched: scan.matched() }
  if (f.lunar) {
    out.date = f.lunar.date.toISODate()!
    out.allDay = true
    out.repeat = { kind: 'lunar-yearly', spec: f.lunar.spec }
    return out
  }
  if (f.date) out.date = f.date.value.toISODate()!
  if (clocks.start) out.start = clocks.start
  if (clocks.end) out.end = clocks.end
  if (f.durationMinutes !== undefined && !clocks.end) out.durationMinutes = f.durationMinutes
  if (f.allDay && !clocks.start) out.allDay = true
  if (f.repeat) {
    // "Thứ 2 hàng tuần": weekly, on the day named.
    out.repeat =
      f.repeat.kind === 'weekly' && !f.repeat.byDay && f.weekday
        ? { kind: 'weekly', byDay: ENTRY_WEEKDAYS[f.weekday - 1] }
        : f.repeat
  }
  return out
}

// ─── Applying it to the editor's slot ────────────────────────────────────────

/** The part of the editor's form a title can set. Dates yyyy-MM-dd, times HH:mm. */
export interface EntrySlot {
  allDay: boolean
  startDate: string
  startTime: string
  endDate: string
  endTime: string
}

/**
 * `slot` with what the title said put into it. Whatever the title left out
 * stays as it was: a time alone keeps the day clicked, a day alone keeps the
 * hour, and an event keeps its length unless an end or a length was given.
 * An all-day slot has no length to keep, so a time typed onto one makes an
 * event of `defaultEventMinutes` (the length new events are set to have).
 * Clock arithmetic is on the wall clock, so "3pm" stays 3pm across a change of
 * the clocks.
 */
export function applyEntry(slot: EntrySlot, entry: ParsedEntry, defaultEventMinutes = 60): EntrySlot {
  const wall = (date: string, time: string): DateTime => DateTime.fromISO(`${date}T${time}`, { zone: 'utc' })
  const baseStart = wall(slot.startDate, slot.startTime)
  const baseEnd = wall(slot.endDate, slot.endTime)
  const length =
    !slot.allDay && baseEnd.isValid && baseEnd > baseStart ? baseEnd.diff(baseStart, 'minutes').minutes : defaultEventMinutes
  const spanDays = Math.max(
    0,
    Math.round(DateTime.fromISO(slot.endDate, { zone: 'utc' }).diff(DateTime.fromISO(slot.startDate, { zone: 'utc' }), 'days').days) || 0
  )
  const startDate = entry.date ?? slot.startDate
  const timed = (start: DateTime, end: DateTime): EntrySlot => ({
    allDay: false,
    startDate: start.toISODate()!,
    startTime: start.toFormat('HH:mm'),
    endDate: end.toISODate()!,
    endTime: end.toFormat('HH:mm')
  })

  if (entry.repeat?.kind === 'lunar-yearly') return { ...slot, allDay: true, startDate, endDate: startDate }

  if (entry.start) {
    const start = wall(startDate, entry.start)
    let end = entry.end ? wall(startDate, entry.end) : start.plus({ minutes: entry.durationMinutes ?? length })
    if (end <= start) end = end.plus({ days: 1 })
    return timed(start, end)
  }

  const endDate = DateTime.fromISO(startDate, { zone: 'utc' }).plus({ days: spanDays }).toISODate()!
  if (entry.allDay) return { ...slot, allDay: true, startDate, endDate }
  if (entry.durationMinutes && !slot.allDay) {
    const start = wall(startDate, slot.startTime)
    return timed(start, start.plus({ minutes: entry.durationMinutes }))
  }
  return { ...slot, startDate, endDate }
}
