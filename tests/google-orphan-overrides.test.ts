import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createSqliteDriver, type ISqliteDatabase } from '../src/main/db/sqlite-driver'
import { runMigrations, seedDefaultData } from '../src/main/db/database'
import { EventsRepo } from '../src/main/db/repos/events-repo'
import { SyncStateRepo } from '../src/main/db/repos/sync-state-repo'
import { GoogleSyncEngine } from '../src/main/sync/google-sync-engine'
import type { GoogleCalendarApiEvent } from '../src/main/sync/google-event-mapper'

/**
 * An occurrence override names its series by `recurringEventId`, and was stored
 * as an exception of that series whether or not the calendar had it. When it
 * did not, the insert broke the foreign key, the page's transaction rolled
 * back, and the pull failed - every poll, for good, as the sync token is only
 * saved after the last page. Two everyday ways to get there: an invitation to
 * one occurrence of someone else's series (the series is not in your calendar),
 * and a full listing that returns an override on a page before its series.
 */

const CAL = 'me@example.com'

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) } as Response
}

const series = (id: string): GoogleCalendarApiEvent => ({
  id,
  status: 'confirmed',
  summary: 'Weekly review',
  start: { dateTime: '2026-04-01T09:00:00Z' },
  end: { dateTime: '2026-04-01T10:00:00Z' },
  recurrence: ['RRULE:FREQ=WEEKLY'],
  etag: `"${id}"`
})

const occurrence = (seriesId: string, extra: Partial<GoogleCalendarApiEvent> = {}): GoogleCalendarApiEvent => ({
  id: `${seriesId}_20260408T090000Z`,
  recurringEventId: seriesId,
  originalStartTime: { dateTime: '2026-04-08T09:00:00Z' },
  status: 'confirmed',
  summary: 'Weekly review (with you)',
  start: { dateTime: '2026-04-08T09:30:00Z' },
  end: { dateTime: '2026-04-08T10:30:00Z' },
  etag: '"occ"',
  attendees: [
    { email: 'boss@example.com', organizer: true, responseStatus: 'accepted' },
    { email: CAL, self: true, responseStatus: 'needsAction' }
  ],
  ...extra
})

const single = (id: string): GoogleCalendarApiEvent => ({
  id,
  status: 'confirmed',
  summary: 'Lunch',
  start: { dateTime: '2026-04-02T12:00:00Z' },
  end: { dateTime: '2026-04-02T13:00:00Z' },
  etag: `"${id}"`
})

describe('a Google occurrence whose series is not in the calendar', () => {
  let db: ISqliteDatabase
  let repo: EventsRepo

  beforeEach(() => {
    db = createSqliteDriver(':memory:')
    runMigrations(db)
    seedDefaultData(db)
    repo = new EventsRepo(db)
    const now = new Date().toISOString()
    db.prepare(
      `INSERT INTO calendars (id, account_id, name, color, is_visible, is_read_only, is_default, created_at, updated_at)
       VALUES (?, 'account-local-primary', 'Me', '#000', 1, 0, 0, ?, ?)`
    ).run(CAL, now, now)
  })

  afterEach(() => vi.unstubAllGlobals())

  /** Serve `pages` in order, the last with the sync token. */
  async function pull(pages: GoogleCalendarApiEvent[][]): Promise<void> {
    let page = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        const items = pages[page]
        page++
        return jsonResponse(page < pages.length ? { items, nextPageToken: `p${page}` } : { items, nextSyncToken: 'next' })
      })
    )
    await new GoogleSyncEngine(db).pullCalendarEvents(CAL, 'token')
  }

  const week = () => repo.queryEventsByRange([CAL], '2026-04-01T00:00:00.000Z', '2026-04-09T00:00:00.000Z')

  it('keeps an invitation to one occurrence as an event of its own, and the rest of the page', async () => {
    await pull([[occurrence('series9'), single('lunch1')]])

    expect(new SyncStateRepo(db).getSyncToken(CAL)).toBe('next')
    expect(week().map((o) => [o.title, o.startUtc])).toEqual([
      ['Lunch', '2026-04-02T12:00:00.000Z'],
      ['Weekly review (with you)', '2026-04-08T09:30:00.000Z']
    ])
    // It is the provider's occurrence: edits and replies go to its own id.
    const standalone = repo.queryEventsByCalendar(CAL).find((e) => e.title === 'Weekly review (with you)')!
    expect(standalone).toMatchObject({ providerEventId: 'series9_20260408T090000Z', etag: '"occ"' })
    expect(repo.respondToInvite(standalone.id, 'accepted')).toBeTruthy()
  })

  it('puts an override listed ahead of its series on that series', async () => {
    await pull([[occurrence('series1')], [series('series1')]])

    expect(new SyncStateRepo(db).getSyncToken(CAL)).toBe('next')
    expect(repo.queryEventsByCalendar(CAL).map((e) => e.providerEventId)).toEqual(['series1'])
    expect(repo.getExceptionsForEvent('series1').map((x) => x.title)).toEqual(['Weekly review (with you)'])
  })

  it('folds the occurrence into its series once the series arrives', async () => {
    await pull([[occurrence('series9')]])
    await pull([[series('series9'), occurrence('series9', { etag: '"occ2"' })]])

    expect(repo.queryEventsByCalendar(CAL).map((e) => e.providerEventId)).toEqual(['series9'])
    expect(repo.getExceptionsForEvent('series9').map((x) => x.title)).toEqual(['Weekly review (with you)'])
    expect(week().filter((o) => o.startUtc.startsWith('2026-04-08'))).toHaveLength(1)
  })

  it('stores nothing for a cancelled occurrence of a series it never had', async () => {
    await pull([[occurrence('series9', { status: 'cancelled' })]])

    expect(new SyncStateRepo(db).getSyncToken(CAL)).toBe('next')
    expect(db.prepare('SELECT COUNT(*) AS n FROM events').get<{ n: number }>()!.n).toBe(0)
  })
})
