import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createSqliteDriver, type ISqliteDatabase } from '../src/main/db/sqlite-driver'
import { runMigrations, seedDefaultData } from '../src/main/db/database'
import { EventsRepo } from '../src/main/db/repos/events-repo'
import { GoogleSyncEngine } from '../src/main/sync/google-sync-engine'
import { MicrosoftSyncEngine } from '../src/main/sync/microsoft-sync-engine'
import { CalDavSyncEngine } from '../src/main/sync/caldav-sync-engine'
import { CalDavAdapter } from '../src/main/sync/caldav-adapter'

/**
 * An edit made while a push is in flight must not be marked as pushed.
 *
 * Every engine cleared `dirty` on success with `WHERE id = ?` alone. Drag an
 * event (sync starts its PUT), resize it before the PUT returns: the resize was
 * marked clean, never sent, and the next pull could overwrite it. The same held
 * for occurrence overrides, and an undone delete was wiped when the DELETE
 * landed. Each test makes the edit from inside the fake server's reply.
 */

const CAL = 'cal_race'
const OLD = '2026-01-01T00:00:00.000Z' // an updated_at well before any edit a test makes

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) } as Response
}

interface Row {
  dirty: number
  etag: string | null
  provider_event_id: string | null
  dtend_utc: string
  is_deleted: number
}

describe('an edit made while its push is in flight', () => {
  let db: ISqliteDatabase
  let repo: EventsRepo

  beforeEach(() => {
    db = createSqliteDriver(':memory:')
    runMigrations(db)
    seedDefaultData(db)
    repo = new EventsRepo(db)
    db.prepare(
      `INSERT INTO calendars (id, account_id, name, color, is_visible, is_read_only, is_default, created_at, updated_at)
       VALUES (?, 'account-local-primary', 'Work', '#000', 1, 0, 0, ?, ?)`
    ).run(CAL, OLD, OLD)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  const row = (id: string): Row =>
    db.prepare('SELECT dirty, etag, provider_event_id, dtend_utc, is_deleted FROM events WHERE id = ?').get<Row>(id)!

  /** An event on the provider with a local edit waiting to go. */
  function pendingEdit(series = false): string {
    const id = repo.createEvent({
      calendarId: CAL,
      title: 'Review',
      dtStartUtc: '2026-04-01T09:00:00.000Z',
      dtEndUtc: '2026-04-01T10:00:00.000Z',
      rrule: series ? 'FREQ=WEEKLY' : undefined
    }).id
    db.prepare(
      `UPDATE events SET provider_event_id = 'prov1', etag = 'e1', attendees_synced = 1, dirty = 1, updated_at = ?
       WHERE id = ?`
    ).run(OLD, id)
    return id
  }

  const resize = (id: string): void => {
    repo.updateEvent(id, { dtEndUtc: '2026-04-01T11:00:00.000Z' })
  }

  describe('Google', () => {
    it('keeps the edit dirty, takes the new etag, and sends it next time', async () => {
      const id = pendingEdit()
      const bodies: { end?: { dateTime?: string } }[] = []
      vi.stubGlobal(
        'fetch',
        vi.fn(async (_url: string, init?: RequestInit) => {
          bodies.push(JSON.parse(String(init?.body)))
          if (bodies.length === 1) resize(id) // the user, mid-PUT
          return jsonResponse({ id: 'prov1', etag: `e${bodies.length + 1}` })
        })
      )

      await new GoogleSyncEngine(db).pushDirtyEvents(CAL, 'token')
      expect(row(id)).toMatchObject({ dirty: 1, etag: 'e2', dtend_utc: '2026-04-01T11:00:00.000Z' })

      await new GoogleSyncEngine(db).pushDirtyEvents(CAL, 'token')
      expect(bodies[1].end?.dateTime).toBe('2026-04-01T11:00:00.000Z')
      expect(row(id)).toMatchObject({ dirty: 0, etag: 'e3' })
    })

    it('still marks an untouched event clean', async () => {
      const id = pendingEdit()
      vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ id: 'prov1', etag: 'e2' })))
      await new GoogleSyncEngine(db).pushDirtyEvents(CAL, 'token')
      expect(row(id)).toMatchObject({ dirty: 0, etag: 'e2' })
    })

    it('does not let the reply overwrite a guest list edited mid-PUT', async () => {
      const id = pendingEdit()
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => {
          repo.updateEvent(id, { attendees: [{ email: 'new@example.com', responseStatus: 'needsAction' }] })
          return jsonResponse({ id: 'prov1', etag: 'e2', attendees: [] })
        })
      )
      await new GoogleSyncEngine(db).pushDirtyEvents(CAL, 'token')
      expect(repo.getEventById(id)!.event.attendees?.map((a) => a.email)).toEqual(['new@example.com'])
      expect(row(id).dirty).toBe(1)
    })

    it('keeps an occurrence override edited mid-PATCH', async () => {
      const id = pendingEdit(true)
      db.prepare('UPDATE events SET dirty = 0 WHERE id = ?').run(id)
      const exc = repo.upsertException({
        masterEventId: id,
        originalStartUtc: '2026-04-08T09:00:00.000Z',
        isCancelled: false,
        title: 'Moved'
      })
      db.prepare("UPDATE event_exceptions SET provider_instance_id = 'inst1', updated_at = ? WHERE id = ?").run(OLD, exc.id)
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => {
          repo.upsertException({
            masterEventId: id,
            originalStartUtc: '2026-04-08T09:00:00.000Z',
            isCancelled: false,
            title: 'Moved again'
          })
          return jsonResponse({ etag: 'x2' })
        })
      )
      await new GoogleSyncEngine(db).pushDirtyEvents(CAL, 'token')
      expect(repo.listDirtyExceptions(CAL).map((p) => p.exception.title)).toEqual(['Moved again'])
    })

    it('an event brought back while its DELETE was out is created again, not wiped', async () => {
      const id = pendingEdit()
      const snapshot = repo.getEventById(id)!
      repo.deleteEvent(id)
      db.prepare('UPDATE events SET updated_at = ? WHERE id = ?').run(OLD, id)
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => {
          repo.restoreEvent(snapshot) // undo, mid-DELETE
          return jsonResponse({}, 204)
        })
      )
      await new GoogleSyncEngine(db).pushDirtyEvents(CAL, 'token')
      expect(row(id)).toMatchObject({ is_deleted: 0, dirty: 1, provider_event_id: null, etag: null })
    })
  })

  describe('Microsoft', () => {
    it('keeps the edit dirty and takes the new etag', async () => {
      const id = pendingEdit()
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => {
          resize(id)
          return jsonResponse({ id: 'prov1', '@odata.etag': 'W/"2"' })
        })
      )
      await new MicrosoftSyncEngine(db).pushDirtyEvents(CAL, 'token')
      expect(row(id)).toMatchObject({ dirty: 1, etag: 'W/"2"', dtend_utc: '2026-04-01T11:00:00.000Z' })
    })

    it('still marks an untouched event clean', async () => {
      const id = pendingEdit()
      vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ id: 'prov1', '@odata.etag': 'W/"2"' })))
      await new MicrosoftSyncEngine(db).pushDirtyEvents(CAL, 'token')
      expect(row(id)).toMatchObject({ dirty: 0, etag: 'W/"2"' })
    })
  })

  describe('CalDAV', () => {
    const creds = { serverUrl: 'https://dav.example.com/', username: 'u', password: 'p' } as never

    it('keeps the edit dirty and takes the new etag', async () => {
      const id = pendingEdit()
      vi.spyOn(CalDavAdapter.prototype, 'pushEvent').mockImplementation(async () => {
        resize(id)
        return { success: true, etag: '"2"', href: '/cal/prov1.ics' }
      })
      await new CalDavSyncEngine(db).pushDirtyEvents(CAL, creds)
      expect(row(id)).toMatchObject({ dirty: 1, etag: '"2"', provider_event_id: '/cal/prov1.ics' })
    })

    it('still marks an untouched event clean', async () => {
      const id = pendingEdit()
      vi.spyOn(CalDavAdapter.prototype, 'pushEvent').mockResolvedValue({ success: true, etag: '"2"', href: '/cal/prov1.ics' })
      await new CalDavSyncEngine(db).pushDirtyEvents(CAL, creds)
      expect(row(id)).toMatchObject({ dirty: 0, etag: '"2"' })
    })

    it('clears only the overrides that went out with the series', async () => {
      const id = pendingEdit(true)
      db.prepare('UPDATE events SET dirty = 0 WHERE id = ?').run(id)
      const sent = repo.upsertException({ masterEventId: id, originalStartUtc: '2026-04-08T09:00:00.000Z', isCancelled: true })
      db.prepare('UPDATE event_exceptions SET updated_at = ? WHERE id = ?').run(OLD, sent.id)
      vi.spyOn(CalDavAdapter.prototype, 'pushEvent').mockImplementation(async () => {
        // Another occurrence is moved while the series PUT is out.
        repo.upsertException({ masterEventId: id, originalStartUtc: '2026-04-15T09:00:00.000Z', isCancelled: false, title: 'Later' })
        return { success: true, etag: '"2"', href: '/cal/prov1.ics' }
      })
      await new CalDavSyncEngine(db).pushDirtyEvents(CAL, creds)
      expect(repo.listDirtyExceptions(CAL).map((p) => p.exception.title)).toEqual(['Later'])
    })
  })
})
