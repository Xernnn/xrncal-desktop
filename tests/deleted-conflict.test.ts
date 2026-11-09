import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createSqliteDriver, type ISqliteDatabase } from '../src/main/db/sqlite-driver'
import { runMigrations, seedDefaultData } from '../src/main/db/database'
import { EventsRepo } from '../src/main/db/repos/events-repo'
import { SyncStateRepo } from '../src/main/db/repos/sync-state-repo'
import { GoogleSyncEngine } from '../src/main/sync/google-sync-engine'
import { MicrosoftSyncEngine } from '../src/main/sync/microsoft-sync-engine'

/**
 * A delete that reaches the provider after someone changed the event there is
 * refused (412), and the row is parked as a conflict. Conflicts were listed only
 * among events not deleted, and neither push nor pull touches a parked row, so
 * this one vanished from every screen while the event stayed on the server for
 * everyone else, with nothing here to resolve it.
 */

const CAL = 'cal_del'

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) } as Response
}

describe('a delete that met a change on the server', () => {
  let db: ISqliteDatabase
  let repo: EventsRepo
  let calls: { method: string; headers: Record<string, string> }[]

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
    calls = []
  })

  afterEach(() => vi.unstubAllGlobals())

  /** A synced event deleted here; the server answers each DELETE with `status`. */
  function deletedHere(status: () => number): string {
    const id = repo.createEvent({
      calendarId: CAL,
      title: 'Planning',
      dtStartUtc: '2026-04-01T09:00:00.000Z',
      dtEndUtc: '2026-04-01T10:00:00.000Z'
    }).id
    db.prepare("UPDATE events SET provider_event_id = 'prov1', etag = 'e1', dirty = 0, attendees_synced = 1 WHERE id = ?").run(id)
    repo.deleteEvent(id)
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        calls.push({ method: init?.method ?? 'GET', headers: (init?.headers ?? {}) as Record<string, string> })
        const code = status()
        return jsonResponse(code === 412 ? { error: 'changed' } : {}, code)
      })
    )
    return id
  }

  it('is listed with the other conflicts, as a delete (Google)', async () => {
    const id = deletedHere(() => 412)
    await new GoogleSyncEngine(db).pushDirtyEvents(CAL, 'token')

    expect(repo.listConflicts()).toEqual([
      expect.objectContaining({ eventId: id, title: 'Planning', calendarName: 'Work', deletedHere: true })
    ])
  })

  it('is listed with the other conflicts, as a delete (Outlook)', async () => {
    const id = deletedHere(() => 412)
    await new MicrosoftSyncEngine(db).pushDirtyEvents(CAL, 'token')

    expect(repo.listConflicts()).toEqual([expect.objectContaining({ eventId: id, deletedHere: true })])
  })

  it('"keep mine" deletes it on the server after all', async () => {
    let answer = 412
    const id = deletedHere(() => answer)
    await new GoogleSyncEngine(db).pushDirtyEvents(CAL, 'token')

    expect(repo.resolveConflict(id, 'keepMine')).toBe(true)
    answer = 204
    calls = []
    await new GoogleSyncEngine(db).pushDirtyEvents(CAL, 'token')

    expect(calls.map((c) => c.method)).toEqual(['DELETE'])
    expect(calls[0].headers['If-Match']).toBeUndefined()
    expect(db.prepare('SELECT 1 FROM events WHERE id = ?').get(id)).toBeUndefined()
    expect(repo.listConflicts()).toEqual([])
  })

  it('"keep theirs" brings it back and reads the server\'s version again', async () => {
    const id = deletedHere(() => 412)
    new SyncStateRepo(db).saveSyncToken(CAL, 'token-before')
    await new GoogleSyncEngine(db).pushDirtyEvents(CAL, 'token')

    expect(repo.resolveConflict(id, 'keepTheirs')).toBe(true)

    expect(repo.getEventById(id)?.event).toMatchObject({ title: 'Planning', dirty: false, hasConflict: false })
    expect(new SyncStateRepo(db).getSyncToken(CAL)).toBeNull()
    expect(repo.listConflicts()).toEqual([])
  })
})
