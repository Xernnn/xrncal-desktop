import { Lunar, Solar } from 'lunar-javascript'
import type { LunarRecurrenceSpec } from './event-model'
import { convertSolarToLunar, nextLunarOccurrences, resolveLunarOccurrence } from './lunar-vietnam'

export function usesChineseLunar(locale: string): boolean {
  return /^zh(?:-|$)/i.test(locale)
}

const chineseDates = new Map<string, ReturnType<ReturnType<typeof Solar.fromYmd>['getLunar']>>()

function toChineseLunar(day: number, month: number, year: number) {
  const key = `${year}-${month}-${day}`
  const cached = chineseDates.get(key)
  if (cached) return cached
  const date = Solar.fromYmd(year, month, day).getLunar()
  if (chineseDates.size >= 4096) chineseDates.clear()
  chineseDates.set(key, date)
  return date
}

export function chineseLunarLabel(day: number, month: number, year: number, full = false) {
  const lunar = toChineseLunar(day, month, year)
  const lunarMonth = `${lunar.getMonthInChinese()}月`
  const lunarDay = lunar.getDayInChinese()
  const solarTerm = lunar.getJieQi()
  const date = `农历${lunar.getYearInGanZhi()}年${lunarMonth}${lunarDay}`
  return {
    label: solarTerm || (full ? lunarMonth + lunarDay : lunar.getDay() === 1 ? lunarMonth : lunarDay),
    title: solarTerm ? `${solarTerm} · ${date}` : date
  }
}

export function lunarRuleForDate(day: number, month: number, year: number, chinese: boolean): LunarRecurrenceSpec {
  if (!chinese) {
    const lunar = convertSolarToLunar(day, month, year)
    return { day: lunar.day, month: lunar.month, leap: lunar.leap }
  }
  const lunar = toChineseLunar(day, month, year)
  return { day: lunar.getDay(), month: Math.abs(lunar.getMonth()), leap: lunar.getMonth() < 0, calendar: 'chinese' }
}

function chineseLunarToSolar(day: number, month: number, year: number, leap = false) {
  try {
    const date = Lunar.fromYmd(year, leap ? -month : month, day).getSolar()
    return { day: date.getDay(), month: date.getMonth(), year: date.getYear() }
  } catch {
    // The date does not exist, e.g. a leap month in a year without one.
    return null
  }
}

export function resolveCalendarLunarOccurrence(spec: LunarRecurrenceSpec, year: number): string | null {
  return resolveLunarOccurrence(spec, year, spec.calendar === 'chinese' ? chineseLunarToSolar : undefined)
}

export function nextCalendarLunarOccurrences(spec: LunarRecurrenceSpec, fromIsoDate: string, count: number): string[] {
  return nextLunarOccurrences(spec, fromIsoDate, count, spec.calendar === 'chinese' ? chineseLunarToSolar : undefined)
}
