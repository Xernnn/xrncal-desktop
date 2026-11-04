import type { Calendar } from '@shared/event-model'

/**
 * The calendar a new event goes into when nobody has picked one: the default
 * calendar if it can be written to and is shown, else the first writable one
 * that is shown, else any writable one. A hidden calendar is a last resort - an
 * event saved into one vanishes from the screen the moment it is created.
 */
export function defaultCalendarFor(calendars: Calendar[]): Calendar | undefined {
  const writable = calendars.filter((c) => !c.isReadOnly)
  return (
    writable.find((c) => c.isDefault && c.isVisible) ??
    writable.find((c) => c.isVisible) ??
    writable[0] ??
    calendars[0]
  )
}
