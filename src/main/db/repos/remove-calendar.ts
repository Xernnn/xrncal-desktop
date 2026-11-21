import type { ISqliteDatabase } from '../sqlite-driver'
import { settleDefaultCalendar } from './default-calendar'

export interface RemoveCalendarOptions {
  /** Keep the calendar's events by moving them into this calendar first.
   *  Only a calendar on this computer can hand its events on. */
  moveEventsTo?: string
}

/** The events a calendar holds, as the person removing it counts them: not
 *  ones already deleted, and a lunar anniversary once, not once per year. */
export function countCalendarEvents(db: ISqliteDatabase, calendarId: string): number {
  return (
    db
      .prepare(
        'SELECT COUNT(*) AS c FROM events WHERE calendar_id = ? AND is_deleted = 0 AND lunar_source_event_id IS NULL'
      )
      .get<{ c: number }>(calendarId)?.c ?? 0
  )
}

/**
 * Remove a calendar, with its events or after moving them to another
 * calendar, and settle the default calendar again (settleDefaultCalendar), so
 * removing the default hands it to another calendar in the same step.
 *
 * A calendar on this computer holds events no provider has, so they move as
 * they are and are new events in their new calendar: one of an account's is
 * uploaded on the next sync with its changed and cancelled dates. An
 * account's calendar cannot hand its events on this way; its events are the
 * provider's, and a move across accounts is a copy (calendarMoveBlock).
 *
 * Returns false when there is no such calendar. Refuses a target that is not
 * a writable calendar before anything is written.
 */
export function removeCalendar(
  db: ISqliteDatabase,
  calendarId: string,
  options: RemoveCalendarOptions = {}
): boolean {
  const calendar = db
    .prepare('SELECT c.id, a.type AS account_type FROM calendars c LEFT JOIN accounts a ON a.id = c.account_id WHERE c.id = ?')
    .get<{ id: string; account_type: string | null }>(calendarId)
  if (!calendar) return false

  const target = options.moveEventsTo
  if (target !== undefined) {
    if (calendar.account_type !== null && calendar.account_type !== 'local') {
      throw new Error("An account's calendar keeps its events on the account's server; only a calendar on this computer can move them.")
    }
    if (target === calendarId) throw new Error('The events cannot move into the calendar being removed.')
    const to = db
      .prepare('SELECT is_read_only, subscription_url, holiday_type FROM calendars WHERE id = ?')
      .get<{ is_read_only: number; subscription_url: string | null; holiday_type: string | null }>(target)
    if (!to || to.is_read_only === 1 || to.subscription_url || to.holiday_type) {
      throw new Error('The events can only move into a calendar that can be written to.')
    }
  }

  db.transaction(() => {
    const now = new Date().toISOString()
    if (target !== undefined) {
      const moved = db
        .prepare('SELECT id FROM events WHERE calendar_id = ? AND is_deleted = 0')
        .all<{ id: string }>(calendarId)
        .map((row) => row.id)
      if (moved.length > 0) {
        // Nothing of a provider's goes with them: a calendar here has none
        // (removing an account clears it, see detachAccount), and an id left
        // over would send the upload as an edit to an event the target's
        // provider never had.
        db.prepare(
          `UPDATE events
           SET calendar_id = ?, dirty = 1, etag = NULL, provider_event_id = NULL,
               moved_from_calendar_id = NULL, has_conflict = 0, keep_mine = 0, updated_at = ?
           WHERE calendar_id = ? AND is_deleted = 0`
        ).run(target, now, calendarId)
        const placeholders = moved.map(() => '?').join(',')
        // A series' changed and cancelled dates go up with it (as forgetMovedCopy does).
        db.prepare(
          `UPDATE event_exceptions SET dirty = 1, etag = NULL, provider_instance_id = NULL
           WHERE master_event_id IN (${placeholders})`
        ).run(...moved)
      }
    }
    // Deleted events still waiting here, and the rest when they were not
    // moved, go with the calendar (ON DELETE CASCADE).
    db.prepare('DELETE FROM calendars WHERE id = ?').run(calendarId)
    settleDefaultCalendar(db, now)
  })()
  return true
}
