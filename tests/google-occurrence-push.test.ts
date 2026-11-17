import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createSqliteDriver, type ISqliteDatabase } from '../src/main/db/sqlite-driver'
import { runMigrations, seedDefaultData } from '../src/main/db/database'
import { EventsRepo } from '../src/main/db/repos/events-repo'
import { GoogleSyncEngine } from '../src/main/sync/google-sync-engine'

/**
 * An occurrence edited here is PATCHed onto its own instance on Google, found
 * by the date it had before any move. The lookup asked for the instances at
 * that time now, and when none had it as its original date it took the first
 * one listed: with the wanted occurrence moved away and another moved into
 * its slot, the edit or cancellation landed on that other date. And a PATCH
 * Google refused was counted with no reason, so the calendar showed an
 * unknown push error on every poll.
 */

const CAL = 'cal_google'
const WANTED = '2026-04-08T09:00:00.000Z'

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) } as Response
}

describe('pushing an occurrence override to Google', () => {
  let db: ISqliteDatabase
  let repo: EventsRepo
  let masterId: string

  beforeEach(() => {
    db = createSqliteDriver(':memory:')
    runMigrations(db)
    seedDefaultData(db)
    repo = new EventsRepo(db)
    const now = new Date().toISOString()
    db.prepare(
      `INSERT INTO calendars (id, account_id, name, color, is_visible, is_read_only, is_default, created_at, updated_at)
       VALUES (?, 'account-local-primary', 'Work', '#000', 1, 0, 0, ?, ?)`
    ).run(CAL, now, now)
    masterId = repo.createEvent({
      calendarId: CAL,
      title: 'Review',
      dtStartUtc: '2026-04-01T09:00:00.000Z',
      dtEndUtc: '2026-04-01T10:00:00.000Z',
      rrule: 'FREQ=WEEKLY'
    }).id
    db.prepare("UPDATE events SET provider_event_id = 'series1', etag = 'e1', dirty = 0 WHERE id = ?").run(masterId)
    repo.upsertException({ masterEventId: masterId, originalStartUtc: WANTED, isCancelled: false, title: 'Review (room 4)' })
  })

  afterEach(() => vi.unstubAllGlobals())

  /** Google's instances: `byOriginal` answers a lookup by original start, `atTime` one by the time they are at now. */
  function fakeGoogle(options: { byOriginal: unknown[]; atTime: unknown[]; patchStatus?: number }) {
    const calls: { method: string; url: string }[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET'
        calls.push({ method, url })
        if (url.includes('/instances?')) {
          return jsonResponse({ items: url.includes('originalStart=') ? options.byOriginal : options.atTime })
        }
        if (method === 'PATCH') {
          const status = options.patchStatus ?? 200
          return status === 200
            ? jsonResponse({ etag: 'x2' })
            : jsonResponse({ error: { code: status, message: 'You need to have writer access to this calendar.' } }, status)
        }
        return jsonResponse({}, 404)
      })
    )
    return calls
  }

  const patches = (calls: { method: string; url: string }[]) =>
    calls.filter((c) => c.method === 'PATCH').map((c) => decodeURIComponent(c.url.split('/events/')[1]))

  it('does not put the edit on another occurrence that was moved into its slot', async () => {
    const calls = fakeGoogle({
      byOriginal: [],
      // The 15th's occurrence, moved onto the 8th's time; the 8th's is elsewhere.
      atTime: [
        {
          id: 'series1_20260415T090000Z',
          recurringEventId: 'series1',
          originalStartTime: { dateTime: '2026-04-15T09:00:00Z' },
          start: { dateTime: '2026-04-08T09:00:00Z' }
        }
      ]
    })

    const result = await new GoogleSyncEngine(db).pushDirtyEvents(CAL, 'token')

    expect(patches(calls)).toEqual([])
    expect(result.errorCount).toBe(1)
    expect(result.lastError).toMatch(/Review/)
    expect(repo.listDirtyExceptions(CAL)).toHaveLength(1)
  })

  it('finds an occurrence moved away from its date by that date', async () => {
    const calls = fakeGoogle({
      byOriginal: [
        {
          id: 'series1_20260408T090000Z',
          recurringEventId: 'series1',
          originalStartTime: { dateTime: '2026-04-08T09:00:00Z' },
          start: { dateTime: '2026-04-09T14:00:00Z' }
        }
      ],
      atTime: []
    })

    const result = await new GoogleSyncEngine(db).pushDirtyEvents(CAL, 'token')

    expect(patches(calls)).toEqual(['series1_20260408T090000Z'])
    expect(result.errorCount).toBe(0)
    expect(repo.listDirtyExceptions(CAL)).toEqual([])
  })

  it('says why Google refused the edit', async () => {
    fakeGoogle({
      byOriginal: [{ id: 'series1_20260408T090000Z', originalStartTime: { dateTime: '2026-04-08T09:00:00Z' } }],
      atTime: [],
      patchStatus: 403
    })

    const result = await new GoogleSyncEngine(db).pushDirtyEvents(CAL, 'token')

    expect(result.errorCount).toBe(1)
    expect(result.lastError).toMatch(/403/)
  })
})
