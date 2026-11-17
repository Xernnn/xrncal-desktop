import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createSqliteDriver, type ISqliteDatabase } from '../src/main/db/sqlite-driver'
import { runMigrations, seedDefaultData } from '../src/main/db/database'
import { EventsRepo } from '../src/main/db/repos/events-repo'
import { GoogleSyncEngine } from '../src/main/sync/google-sync-engine'
import { MicrosoftSyncEngine } from '../src/main/sync/microsoft-sync-engine'

/**
 * A new event whose create reached the provider but whose answer did not come
 * back (a timeout, a dropped connection) was created twice. The row stayed
 * dirty with no provider id, so the pull in the same pass read the provider's
 * copy in as a second event, and the next poll POSTed the original again: two
 * events on the provider and two here.
 *
 * Each create now carries an id of the app's own, kept on the row from before
 * the first try: Google's event `id`, Outlook's `transactionId`. The pull knows
 * the provider's copy by it, and a retry is the same create again.
 */

const CAL = 'cal_retry'
const GOOGLE_ID = /^[a-v0-9]{5,1024}$/

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) } as Response
}

interface Row {
  id: string
  title: string
  dirty: number
  etag: string | null
  provider_event_id: string | null
  create_id: string | null
}

interface Call {
  method: string
  url: string
  body?: Record<string, unknown>
  ifMatch?: string
}

describe('a create whose answer is lost', () => {
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
       VALUES (?, 'account-local-primary', 'Work', '#000', 1, 0, 0, ?, ?)`
    ).run(CAL, now, now)
  })

  afterEach(() => vi.unstubAllGlobals())

  const rows = (): Row[] =>
    db.prepare('SELECT id, title, dirty, etag, provider_event_id, create_id FROM events WHERE calendar_id = ?').all<Row>(CAL)

  const newEvent = (): string =>
    repo.createEvent({
      calendarId: CAL,
      title: 'Planning',
      dtStartUtc: '2026-04-01T09:00:00.000Z',
      dtEndUtc: '2026-04-01T10:00:00.000Z'
    }).id

  describe('Google', () => {
    /** Google's side: events by id, and whether the next create's answer is lost. */
    function fakeGoogle() {
      const held = new Map<string, Record<string, unknown>>()
      const calls: Call[] = []
      let loseNext = false
      let version = 0
      const fetchFake = vi.fn(async (url: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET'
        const body = init?.body ? JSON.parse(String(init.body)) : undefined
        const ifMatch = (init?.headers as Record<string, string> | undefined)?.['If-Match']
        calls.push({ method, url, body, ifMatch })
        const path = new URL(url).pathname
        const one = /\/events\/([^/]+)$/.exec(path)?.[1]
        if (method === 'POST') {
          const id = (body.id as string | undefined) ?? `server${held.size + 1}`
          if (held.has(id)) return jsonResponse({ error: { code: 409, message: 'The requested identifier already exists.' } }, 409)
          const event = { ...body, id, status: 'confirmed', etag: `"v${++version}"` }
          held.set(id, event)
          if (loseNext) {
            loseNext = false
            throw new Error('The request timed out')
          }
          return jsonResponse(event)
        }
        if (method === 'GET' && one) {
          const event = held.get(decodeURIComponent(one))
          return event ? jsonResponse(event) : jsonResponse({}, 404)
        }
        if (method === 'GET') return jsonResponse({ items: [...held.values()], nextSyncToken: 'token1' })
        if (method === 'PATCH' && one) {
          const id = decodeURIComponent(one)
          const event = held.get(id)
          if (!event) return jsonResponse({}, 404)
          if (ifMatch && ifMatch !== event.etag) return jsonResponse({}, 412)
          const next = { ...event, ...body, id, etag: `"v${++version}"` }
          held.set(id, next)
          return jsonResponse(next)
        }
        return jsonResponse({}, 400)
      })
      vi.stubGlobal('fetch', fetchFake)
      return { held, calls, loseNextAnswer: () => (loseNext = true) }
    }

    it('sends an id of its own, which the next pull finds on the row, so the event is not read in twice', async () => {
      const google = fakeGoogle()
      const id = newEvent()
      google.loseNextAnswer()

      await new GoogleSyncEngine(db).pushDirtyEvents(CAL, 'token')
      const post = google.calls.find((c) => c.method === 'POST')!
      expect(post.body?.id).toMatch(GOOGLE_ID)
      expect(google.held.size).toBe(1)
      expect(rows()).toMatchObject([{ id, dirty: 1, create_id: post.body?.id }])

      await new GoogleSyncEngine(db).pullCalendarEvents(CAL, 'token')
      expect(rows()).toMatchObject([{ id, dirty: 1, provider_event_id: post.body?.id, etag: '"v1"', create_id: null }])

      repo.updateEvent(id, { title: 'Planning (room 2)' })
      await new GoogleSyncEngine(db).pushDirtyEvents(CAL, 'token')
      expect(google.calls.filter((c) => c.method === 'POST')).toHaveLength(1)
      expect(google.held.size).toBe(1)
      expect([...google.held.values()][0]).toMatchObject({ summary: 'Planning (room 2)' })
      expect(rows()).toMatchObject([{ id, dirty: 0, provider_event_id: post.body?.id }])
    })

    it('takes a 409 on a retried create as already made: it reads the event and sends the row over it', async () => {
      const google = fakeGoogle()
      const id = newEvent()
      google.loseNextAnswer()
      await new GoogleSyncEngine(db).pushDirtyEvents(CAL, 'token')
      repo.updateEvent(id, { title: 'Planning (moved)' })

      const result = await new GoogleSyncEngine(db).pushDirtyEvents(CAL, 'token')

      const posts = google.calls.filter((c) => c.method === 'POST')
      expect(posts).toHaveLength(2)
      expect(posts[1].body?.id).toBe(posts[0].body?.id)
      const patch = google.calls.find((c) => c.method === 'PATCH')!
      expect(patch.ifMatch).toBe('"v1"')
      expect(result).toMatchObject({ errorCount: 0, lastError: null })
      expect(google.held.size).toBe(1)
      expect([...google.held.values()][0]).toMatchObject({ summary: 'Planning (moved)' })
      expect(rows()).toMatchObject([{ id, dirty: 0, provider_event_id: posts[0].body?.id, create_id: null }])
    })

    it('gives each new event an id of its own', async () => {
      const google = fakeGoogle()
      newEvent()
      newEvent()
      await new GoogleSyncEngine(db).pushDirtyEvents(CAL, 'token')
      const ids = google.calls.filter((c) => c.method === 'POST').map((c) => c.body?.id)
      expect(ids).toHaveLength(2)
      expect(ids[0]).not.toBe(ids[1])
      expect(rows().map((r) => r.create_id)).toEqual([null, null])
    })
  })

  describe('Outlook', () => {
    /** Graph's side: events by its own id, deduplicated by transactionId as Graph does. */
    function fakeGraph() {
      const held = new Map<string, Record<string, unknown>>()
      const calls: Call[] = []
      let loseNext = false
      let version = 0
      const fetchFake = vi.fn(async (url: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET'
        const body = init?.body ? JSON.parse(String(init.body)) : undefined
        const ifMatch = (init?.headers as Record<string, string> | undefined)?.['if-match']
        calls.push({ method, url, body, ifMatch })
        const one = /\/me\/events\/([^/?]+)/.exec(new URL(url).pathname)?.[1]
        if (method === 'POST') {
          const same = [...held.values()].find((e) => body.transactionId && e.transactionId === body.transactionId)
          if (same) return jsonResponse(same, 201)
          const event = {
            ...body,
            id: `AAMk${held.size + 1}`,
            '@odata.etag': `W/"${++version}"`,
            lastModifiedDateTime: '2026-03-01T08:00:00.0000000Z'
          }
          held.set(event.id, event)
          if (loseNext) {
            loseNext = false
            throw new Error('The request timed out')
          }
          return jsonResponse(event, 201)
        }
        if (method === 'GET' && !one) return jsonResponse({ value: [...held.values()] })
        if (method === 'PATCH' && one) {
          const event = held.get(decodeURIComponent(one))
          if (!event) return jsonResponse({}, 404)
          if (ifMatch && ifMatch !== event['@odata.etag']) return jsonResponse({}, 412)
          const next = { ...event, ...body, '@odata.etag': `W/"${++version}"` }
          held.set(String(event.id), next)
          return jsonResponse(next)
        }
        return jsonResponse({}, 400)
      })
      vi.stubGlobal('fetch', fetchFake)
      return { held, calls, loseNextAnswer: () => (loseNext = true) }
    }

    it('sends a transactionId, which the next pull finds on the row, so the event is not read in twice', async () => {
      const graph = fakeGraph()
      const id = newEvent()
      graph.loseNextAnswer()

      await new MicrosoftSyncEngine(db).pushDirtyEvents(CAL, 'token')
      const post = graph.calls.find((c) => c.method === 'POST')!
      expect(post.body?.transactionId).toEqual(expect.any(String))
      expect(rows()).toMatchObject([{ id, dirty: 1, create_id: post.body?.transactionId }])

      await new MicrosoftSyncEngine(db).pullCalendarEvents(CAL, 'token')
      expect(rows()).toMatchObject([{ id, dirty: 1, provider_event_id: 'AAMk1', etag: 'W/"1"', create_id: null }])

      repo.updateEvent(id, { title: 'Planning (room 2)' })
      await new MicrosoftSyncEngine(db).pushDirtyEvents(CAL, 'token')
      expect(graph.calls.filter((c) => c.method === 'POST')).toHaveLength(1)
      expect(graph.held.size).toBe(1)
      expect(graph.held.get('AAMk1')).toMatchObject({ subject: 'Planning (room 2)' })
      expect(rows()).toMatchObject([{ id, dirty: 0, provider_event_id: 'AAMk1' }])
    })

    it('sends a retried create with the same transactionId, so Outlook answers with the event it has', async () => {
      const graph = fakeGraph()
      const id = newEvent()
      graph.loseNextAnswer()
      await new MicrosoftSyncEngine(db).pushDirtyEvents(CAL, 'token')
      await new MicrosoftSyncEngine(db).pushDirtyEvents(CAL, 'token')

      const posts = graph.calls.filter((c) => c.method === 'POST')
      expect(posts).toHaveLength(2)
      expect(posts[1].body?.transactionId).toBe(posts[0].body?.transactionId)
      expect(graph.held.size).toBe(1)
      expect(rows()).toMatchObject([{ id, dirty: 0, provider_event_id: 'AAMk1', create_id: null }])
    })
  })
})
