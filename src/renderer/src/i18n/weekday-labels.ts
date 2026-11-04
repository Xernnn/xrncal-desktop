import { weekdayOrder } from '@shared/week-start'

/** Luxon weekday (1 = Monday … 7 = Sunday) to the recurrence editor's code. */
const CODES = ['', 'mo', 'tu', 'we', 'th', 'fr', 'sa', 'su'] as const

/**
 * Locale-aware short weekday headers (reuses the recurrence editor's weekday
 * abbreviations so "T2/T3/.../CN" only shows up for the vi locale, not en too),
 * in the order the week is drawn.
 */
export function weekdayShortLabels(t: (key: string) => string, firstDayOfWeek: number): string[] {
  return weekdayOrder(firstDayOfWeek).map((day) => t(`editor.weekdayShort.${CODES[day]}`))
}

/** The short name of one Luxon weekday (1 = Monday … 7 = Sunday). */
export function weekdayShortLabel(t: (key: string) => string, weekday: number): string {
  return t(`editor.weekdayShort.${CODES[weekday]}`)
}
