import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createSqliteDriver, type ISqliteDatabase } from '../src/main/db/sqlite-driver'
import { runMigrations, seedDefaultData } from '../src/main/db/database'
import { EventsRepo } from '../src/main/db/repos/events-repo'
import { GoogleSyncEngine } from '../src/main/sync/google-sync-engine'
import type { GoogleCalendarApiEvent } from '../src/main/sync/google-event-mapper'

/**
 * Google gives a meeting the same event id in every calendar it is in - the
 * organizer's, a colleague's shared calendar, a second calendar of one's own.
 * Rows were keyed by that id alone, so the copy pulled second landed on the
 * first one's row: one event where there were two, its data and etag swapped
 * between the copies on every poll, and an edit sent with the other copy's
 * etag failed as a conflict nobody had caused.
 */

const CAL_A = 'me@example.com'
const CAL_B = 'team@group.calendar.google.com'

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) } as Response
}

const meeting = (title: string, etag: string, extra: Partial<GoogleCalendarApiEvent> = {}): GoogleCalendarApiEvent => ({
  id: 'shared1',
  status: 'confirmed',
  summary: title,
  start: { dateTime: '2026-04-01T09:00:00Z' },
  end: { dateTime: '2026-04-01T10:00:00Z' },
  etag,
  ...extra
})

interface Row {
  id: string
  calendar_id: string
  title: string
  etag: string
  is_deleted: number
}

describe('one Google event in two calendars', () => {
  let db: ISqliteDatabase
  let repo: EventsRepo

  beforeEach(() => {
    db = createSqliteDriver(':memory:')
    runMigrations(db)
    seedDefaultData(db)
    repo = new EventsRepo(db)
    const now = new Date().toISOString()
    for (const id of [CAL_A, CAL_B]) {
      db.prepare(
        `INSERT INTO calendars (id, account_id, name, color, is_visible, is_read_only, is_default, created_at, updated_at)
         VALUES (?, 'account-local-primary', ?, '#000', 1, 0, 0, ?, ?)`
      ).run(id, id, now, now)
    }
  })

  afterEach(() => vi.unstubAllGlobals())

  async function pull(calendarId: string, items: GoogleCalendarApiEvent[]): Promise<void> {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ items, nextSyncToken: 'next' })))
    await new GoogleSyncEngine(db).pullCalendarEvents(calendarId, 'token')
  }

  const rows = (): Row[] =>
    db.prepare('SELECT id, calendar_id, title, etag, is_deleted FROM events ORDER BY calendar_id').all<Row>()

  it('keeps a row for each copy, with its own data and etag', async () => {
    await pull(CAL_A, [meeting('Standup', 'etag-a')])
    await pull(CAL_B, [meeting('Standup (team view)', 'etag-b')])
    await pull(CAL_A, [meeting('Standup', 'etag-a2')])

    expect(rows().map((r) => [r.calendar_id, r.title, r.etag])).toEqual([
      [CAL_A, 'Standup', 'etag-a2'],
      [CAL_B, 'Standup (team view)', 'etag-b']
    ])
  })

  it('sends an edit to one copy with that copy\'s etag', async () => {
    await pull(CAL_A, [meeting('Standup', 'etag-a')])
    await pull(CAL_B, [meeting('Standup', 'etag-b')])
    const mine = rows().find((r) => r.calendar_id === CAL_A)!
    repo.updateEvent(mine.id, { title: 'Standup (moved)' })
    db.prepare('UPDATE events SET attendees_synced = 1').run()

    const sent: { url: string; ifMatch?: string }[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        sent.push({ url, ifMatch: (init?.headers as Record<string, string>)['If-Match'] })
        return jsonResponse({ id: 'shared1', etag: 'etag-a3' })
      })
    )
    await new GoogleSyncEngine(db).pushDirtyEvents(CAL_A, 'token')

    expect(sent).toEqual([{ url: expect.stringContaining(`/calendars/${encodeURIComponent(CAL_A)}/events/shared1`), ifMatch: 'etag-a' }])
  })

  it('puts an occurrence override on its own calendar\'s series', async () => {
    const series = { recurrence: ['RRULE:FREQ=WEEKLY'] }
    await pull(CAL_A, [meeting('Standup', 'etag-a', series)])
    await pull(CAL_B, [
      meeting('Standup', 'etag-b', series),
      {
        id: 'shared1_20260408T090000Z',
        recurringEventId: 'shared1',
        originalStartTime: { dateTime: '2026-04-08T09:00:00Z' },
        status: 'confirmed',
        summary: 'Standup (later)',
        start: { dateTime: '2026-04-08T11:00:00Z' },
        end: { dateTime: '2026-04-08T12:00:00Z' }
      }
    ])

    const byCalendar = Object.fromEntries(rows().map((r) => [r.calendar_id, r.id]))
    expect(repo.getExceptionsForEvent(byCalendar[CAL_A])).toEqual([])
    expect(repo.getExceptionsForEvent(byCalendar[CAL_B]).map((x) => x.title)).toEqual(['Standup (later)'])
  })

  it('does not delete one calendar\'s copy when the other is cancelled', async () => {
    await pull(CAL_A, [meeting('Standup', 'etag-a')])
    // Taken off the team calendar, which never had it here.
    await pull(CAL_B, [meeting('Standup', 'etag-b', { status: 'cancelled' })])

    expect(rows().map((r) => [r.calendar_id, r.is_deleted])).toEqual([[CAL_A, 0]])
  })
})
