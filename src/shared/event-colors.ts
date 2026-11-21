/**
 * Colours an event can have of its own, instead of its calendar's.
 *
 * They are Google Calendar's eleven event colours: Google takes no others (an
 * event's `colorId` names one of these), while CalDAV's COLOR and local events
 * take any hex - so these are the ones that hold whichever calendar the event
 * is in. `name` keys the label in the i18n catalog (`editor.colors.<name>`).
 */
export const EVENT_COLORS: readonly { googleId: string; hex: string; name: string }[] = [
  { googleId: '1', hex: '#7986cb', name: 'lavender' },
  { googleId: '2', hex: '#33b679', name: 'sage' },
  { googleId: '3', hex: '#8e24aa', name: 'grape' },
  { googleId: '4', hex: '#e67c73', name: 'flamingo' },
  { googleId: '5', hex: '#f6bf26', name: 'banana' },
  { googleId: '6', hex: '#f4511e', name: 'tangerine' },
  { googleId: '7', hex: '#039be5', name: 'peacock' },
  { googleId: '8', hex: '#616161', name: 'graphite' },
  { googleId: '9', hex: '#3f51b5', name: 'blueberry' },
  { googleId: '10', hex: '#0b8043', name: 'basil' },
  { googleId: '11', hex: '#d50000', name: 'tomato' }
]

/**
 * Each occurrence in the colour it is drawn in: its own, else its calendar's.
 * An event that has no colour of its own is stored without one, so whatever
 * shows a list of them fills it in here - the main window's views and the mini
 * window alike, so the two never disagree.
 */
export function withCalendarColors<T extends { calendarId: string; color?: string }>(
  occurrences: readonly T[],
  calendars: readonly { id: string; color: string }[]
): T[] {
  const colorById = new Map(calendars.map((c) => [c.id, c.color]))
  return occurrences.map((occ) => ({ ...occ, color: occ.color || colorById.get(occ.calendarId) }))
}
