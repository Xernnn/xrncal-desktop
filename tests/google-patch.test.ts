import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createSqliteDriver, type ISqliteDatabase } from '../src/main/db/sqlite-driver'
import { runMigrations, seedDefaultData } from '../src/main/db/database'
import { EventsRepo } from '../src/main/db/repos/events-repo'
import { GoogleSyncEngine } from '../src/main/sync/google-sync-engine'

/**
 * An edit here went to Google as a PUT of the fields the app models. Google's
 * update replaces the whole resource, so every edit reset what the app does
 * not model: the event's visibility, free/busy, attachments, conference and
 * other apps' extended properties. It is a PATCH now, which changes only what
 * it names - and so has to name a removed field with null to remove it.
 *
 * The fake below keeps one event the way Google documents its writes: a PUT
 * replaces it; a PATCH merges objects into it, replaces arrays and deletes a
 * field set to null.
 */

const CAL = 'me@example.com'

type Json = Record<string, unknown>

function merge(target: Json, patch: Json): Json {
  const out: Json = { ...target }
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete out[key]
    else if (typeof value === 'object' && !Array.isArray(value) && typeof out[key] === 'object' && out[key] !== null && !Array.isArray(out[key]))
      out[key] = merge(out[key] as Json, value as Json)
    else out[key] = value
  }
  return out
}

/** The event as Google holds it: everything the app reads, and some it does not. */
const onGoogle = (): Json => ({
  id: 'g1',
  etag: '"e1"',
  status: 'confirmed',
  summary: 'Review',
  description: 'Bring the figures',
  location: 'Room 4',
  start: { dateTime: '2026-04-01T16:00:00+07:00', timeZone: 'Asia/Ho_Chi_Minh' },
  end: { dateTime: '2026-04-01T17:00:00+07:00', timeZone: 'Asia/Ho_Chi_Minh' },
  recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=WE'],
  colorId: '5',
  reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 30 }] },
  extendedProperties: {
    private: { xrncalMeetingUrl: 'https://meet.example.com/abc', goneMeetingUrl: 'https://meet.example.com/abc', otherApp: 'kept' },
    shared: { crmId: '42' }
  },
  visibility: 'private',
  transparency: 'transparent',
  attachments: [{ fileUrl: 'https://drive.example.com/f/1', title: 'Figures' }],
  conferenceData: { conferenceId: 'abc', entryPoints: [{ entryPointType: 'video', uri: 'https://meet.example.com/abc' }] },
  guestsCanModify: true
})

describe('an edit here pushed to Google', () => {
  let db: ISqliteDatabase
  let repo: EventsRepo
  let resource: Json
  let methods: string[]

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
    resource = onGoogle()
    methods = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET'
        methods.push(method)
        const body = init?.body ? (JSON.parse(String(init.body)) as Json) : {}
        const listing = url.includes('/events?')
        if (!listing) {
          if (method === 'PUT') resource = { ...body, id: 'g1' }
          else if (method === 'PATCH') resource = merge(resource, body)
          resource.etag = `"e${methods.length + 1}"`
        }
        const reply = listing ? { items: [resource], nextSyncToken: 't' } : resource
        return { ok: true, status: 200, json: async () => reply, text: async () => JSON.stringify(reply) } as Response
      })
    )
  })

  afterEach(() => vi.unstubAllGlobals())

  /** Pull the event, apply `edit` to it here, push. */
  async function editAndPush(edit: Parameters<EventsRepo['updateEvent']>[1]): Promise<void> {
    const engine = new GoogleSyncEngine(db)
    await engine.pullCalendarEvents(CAL, 'token')
    const id = repo.queryEventsByCalendar(CAL)[0].id
    repo.updateEvent(id, edit)
    methods.length = 0
    await engine.pushDirtyEvents(CAL, 'token')
  }

  it('changes what was edited and keeps everything the app does not model', async () => {
    await editAndPush({ title: 'Review (moved room)' })

    expect(methods).toEqual(['PATCH'])
    expect(resource.summary).toBe('Review (moved room)')
    expect(resource).toMatchObject({
      visibility: 'private',
      transparency: 'transparent',
      attachments: [{ fileUrl: 'https://drive.example.com/f/1', title: 'Figures' }],
      conferenceData: { conferenceId: 'abc' },
      guestsCanModify: true,
      extendedProperties: { private: { otherApp: 'kept' }, shared: { crmId: '42' } },
      description: 'Bring the figures',
      location: 'Room 4',
      recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=WE'],
      colorId: '5',
      reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 30 }] }
    })
  })

  it('removes on Google the notes, place, link, rule and colour removed here', async () => {
    await editAndPush({ notes: '', location: '', meetingUrl: '', rrule: '', color: '' })

    expect(resource).not.toHaveProperty('description')
    expect(resource).not.toHaveProperty('location')
    expect(resource).not.toHaveProperty('recurrence')
    expect(resource).not.toHaveProperty('colorId')
    expect(resource.extendedProperties).toEqual({ private: { otherApp: 'kept' }, shared: { crmId: '42' } })
    expect(resource.visibility).toBe('private')
  })

  it('turns a timed event into an all-day one without leaving its time behind', async () => {
    await editAndPush({ allDay: true, dtStartUtc: '2026-04-01T00:00:00.000Z', dtEndUtc: '2026-04-01T23:59:59.999Z' })

    expect(resource.start).toMatchObject({ date: '2026-04-01' })
    expect(resource.end).toMatchObject({ date: '2026-04-02' })
    expect(resource.start).not.toHaveProperty('dateTime')
    expect(resource.end).not.toHaveProperty('dateTime')
  })

  it('goes back to the calendar default reminders without keeping the event its own', async () => {
    await editAndPush({ reminders: null })

    expect(resource.reminders).toEqual({ useDefault: true })
  })
})
