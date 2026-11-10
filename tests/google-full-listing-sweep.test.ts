import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createSqliteDriver, type ISqliteDatabase } from '../src/main/db/sqlite-driver'
import { runMigrations, seedDefaultData } from '../src/main/db/database'
import { EventsRepo } from '../src/main/db/repos/events-repo'
import { SyncStateRepo } from '../src/main/db/repos/sync-state-repo'
import { GoogleSyncEngine } from '../src/main/sync/google-sync-engine'
import type { GoogleCalendarApiEvent } from '../src/main/sync/google-event-mapper'

/**
 * An incremental pull hears of a deletion as a cancelled event; a listing made
 * without a sync token - the first, the one after "keep theirs", the restart
 * after a 410 - simply leaves deleted events out. Nothing compared that listing
 * with what was stored, so an event deleted on Google while the token was
 * invalid stayed here for good.
 */

const CAL = 'me@example.com'

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) } as Response
}

const event = (id: string, day: number, extra: Partial<GoogleCalendarApiEvent> = {}): GoogleCalendarApiEvent => ({
  id,
  status: 'confirmed',
  summary: `Event ${id}`,
  start: { dateTime: `2026-04-0${day}T09:00:00Z` },
  end: { dateTime: `2026-04-0${day}T10:00:00Z` },
  etag: `"${id}"`,
  ...extra
})

describe('a Google listing made without a sync token', () => {
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

  /** The pull's requests: a 410 for a stale token, else `pages` in order. */
  async function pull(pages: GoogleCalendarApiEvent[][], tokenGone = false): Promise<void> {
    let page = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (tokenGone && url.includes('syncToken=')) return jsonResponse({ error: 'gone' }, 410)
        const items = pages[page]
        page++
        return jsonResponse(page < pages.length ? { items, nextPageToken: `p${page}` } : { items, nextSyncToken: 'next' })
      })
    )
    await new GoogleSyncEngine(db).pullCalendarEvents(CAL, 'token')
  }

  const titles = (): string[] => repo.queryEventsByCalendar(CAL).map((e) => e.title).sort()

  it('removes what Google no longer has after the restart that follows a 410', async () => {
    await pull([[event('a1', 1), event('a2', 2)], [event('a3', 3)]])
    expect(titles()).toEqual(['Event a1', 'Event a2', 'Event a3'])

    // a2 deleted on Google while the token went stale.
    await pull([[event('a1', 1)], [event('a3', 3)]], true)

    expect(titles()).toEqual(['Event a1', 'Event a3'])
    expect(new SyncStateRepo(db).getSyncToken(CAL)).toBe('next')
  })

  it('keeps what has not reached Google yet, and edits not yet sent', async () => {
    await pull([[event('a1', 1), event('a2', 2)]])
    const draft = repo.createEvent({
      calendarId: CAL,
      title: 'Not pushed yet',
      dtStartUtc: '2026-04-05T09:00:00.000Z',
      dtEndUtc: '2026-04-05T10:00:00.000Z'
    })
    repo.updateEvent('a2', { title: 'Event a2 (edited here)' })

    await pull([[]], true)

    expect(titles()).toEqual(['Event a2 (edited here)', draft.title])
  })

  it('keeps an occurrence on its own that the listing still has', async () => {
    const occurrence = event('series9_20260408T090000Z', 8, {
      recurringEventId: 'series9',
      originalStartTime: { dateTime: '2026-04-08T09:00:00Z' }
    })
    await pull([[occurrence]])
    await pull([[occurrence]], true)

    expect(titles()).toEqual(['Event series9_20260408T090000Z'])
  })

  it('removes nothing on an incremental pull, which reports deletions itself', async () => {
    await pull([[event('a1', 1), event('a2', 2)]])
    await pull([[event('a1', 1, { summary: 'Event a1 (renamed)' })]])

    expect(titles()).toEqual(['Event a1 (renamed)', 'Event a2'])
  })
})
