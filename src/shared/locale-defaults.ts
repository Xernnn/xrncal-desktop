import type { AppSettings } from './settings-contract'

export type SystemDefaults = Partial<Pick<AppSettings, 'locale' | 'timeFormat' | 'firstDayOfWeek'>>

/** `Intl.Locale` week data: a method in newer engines, a getter in older ones. */
function firstDayOf(locale: Intl.Locale): number | undefined {
  const withWeekInfo = locale as Intl.Locale & {
    getWeekInfo?: () => { firstDay: number }
    weekInfo?: { firstDay: number }
  }
  try {
    return (withWeekInfo.getWeekInfo?.() ?? withWeekInfo.weekInfo)?.firstDay
  } catch {
    return undefined
  }
}

/**
 * What a new install should start with on a computer set up for `language`
 * (the UI language, "vi-VN") and `region` (the regional format, which on
 * Windows can differ: English menus, Vietnamese dates). The app's language when
 * it has one, the region's clock, and the day its weeks start on.
 *
 * These are defaults, not choices: a setting the user has picked wins, and one
 * they have not keeps following the computer.
 */
export function defaultsForSystem(language: string | undefined, region: string | undefined): SystemDefaults {
  const out: SystemDefaults = {}

  try {
    if (language) out.locale = new Intl.Locale(language).language === 'vi' ? 'vi' : 'en'
  } catch {
    // Not a language tag; keep the built-in default.
  }

  const formats = region || language
  if (!formats) return out
  try {
    const cycle = new Intl.DateTimeFormat(formats, { hour: 'numeric' }).resolvedOptions().hourCycle
    if (cycle) out.timeFormat = cycle === 'h11' || cycle === 'h12' ? '12h' : '24h'
  } catch {
    // Unknown region; keep the built-in clock.
  }
  try {
    const firstDay = firstDayOf(new Intl.Locale(formats))
    // Intl counts 1 = Monday … 7 = Sunday; the setting has Sunday as 0.
    if (firstDay === 7) out.firstDayOfWeek = 0
    else if (firstDay === 6) out.firstDayOfWeek = 6
    else if (firstDay !== undefined) out.firstDayOfWeek = 1
  } catch {
    // Unknown region; weeks start on Monday.
  }
  return out
}
