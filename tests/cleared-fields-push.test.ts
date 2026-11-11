import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createSqliteDriver, type ISqliteDatabase } from '../src/main/db/sqlite-driver'
import { runMigrations, seedDefaultData } from '../src/main/db/database'
import { EventsRepo } from '../src/main/db/repos/events-repo'
import { MicrosoftSyncEngine } from '../src/main/sync/microsoft-sync-engine'
import { CalDavSyncEngine } from '../src/main/sync/caldav-sync-engine'

/**
 * Notes, a place, a meeting link or the repeat rule removed in the editor
 * (sent as '', which an update stores) has to be removed at the provider too.
 * An update that leaves a field out keeps what the provider has there, and the
 * next pull brings it back.
 */

const CAL = 'cal_cleared'
const DAV_CAL = 'https://dav.example/me/cal/'
const HREF = `${DAV_CAL}uid-1.ics`
const CREDS = { url: 'https://dav.example/me/', username: 'me', password: 'pw' }

interface Call {
  url: string
  method: string
  body?: string
}

function recordFetch(reply: (call: Call) => Response): Call[] {
  const calls: Call[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const call = { url, method: init?.method ?? 'GET', body: init?.body === undefined ? undefined : String(init.body) }
      calls.push(call)
      return reply(call)
    })
  )
  return calls
}

const json = (body: unknown, status = 200): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    url: '',
    json: async () => body,
    text: async () => JSON.stringify(body),
    headers: new Headers({ etag: '"e2"' })
  }) as unknown as Response

describe('a field removed here', () => {
  let db: ISqliteDatabase
  let repo: EventsRepo

  beforeEach(() => {
    db = createSqliteDriver(':memory:')
    runMigrations(db)
    seedDefaultData(db)
    repo = new EventsRepo(db)
    const now = new Date().toISOString()
    for (const id of [CAL, DAV_CAL]) {
      db.prepare(
        `INSERT INTO calendars (id, account_id, name, color, is_visible, is_read_only, is_default, created_at, updated_at)
         VALUES (?, 'account-local-primary', 'Work', '#000', 1, 0, 0, ?, ?)`
      ).run(id, now, now)
    }
  })

  afterEach(() => vi.unstubAllGlobals())

  /** A weekly event the provider has, with notes, a place and a link, all removed here. */
  function clearedHere(calendarId: string, provider: { id: string; etag: string }): string {
    const id = repo.createEvent({
      calendarId,
      uid: 'uid-1',
      title: 'Review',
      notes: 'Bring the figures',
      location: 'Room 4',
      meetingUrl: 'https://meet.example.com/abc',
      rrule: 'FREQ=WEEKLY;BYDAY=WE',
      dtStartUtc: '2026-04-01T09:00:00.000Z',
      dtEndUtc: '2026-04-01T10:00:00.000Z'
    }).id
    db.prepare('UPDATE events SET provider_event_id = ?, etag = ?, attendees_synced = 1, dirty = 0 WHERE id = ?').run(
      provider.id,
      provider.etag,
      id
    )
    repo.updateEvent(id, { notes: '', location: '', meetingUrl: '', rrule: '' })
    return id
  }

  it('is emptied on Outlook, and the series stops repeating there', async () => {
    clearedHere(CAL, { id: 'm1', etag: 'W/"1"' })
    const calls = recordFetch(() => json({ id: 'm1', '@odata.etag': 'W/"2"' }))

    await new MicrosoftSyncEngine(db).pushDirtyEvents(CAL, 'token')

    expect(calls.map((c) => c.method)).toEqual(['PATCH'])
    const body = JSON.parse(calls[0].body!)
    expect(body.body).toEqual({ contentType: 'text', content: '' })
    expect(body.location).toEqual({ displayName: '' })
    expect(body).toHaveProperty('recurrence', null)
  })

  it('leaves a field never known on Outlook alone', async () => {
    const id = repo.createEvent({
      calendarId: CAL,
      title: 'Lunch',
      dtStartUtc: '2026-04-01T05:00:00.000Z',
      dtEndUtc: '2026-04-01T06:00:00.000Z'
    }).id
    db.prepare("UPDATE events SET provider_event_id = 'm2', etag = 'W/\"1\"', attendees_synced = 1 WHERE id = ?").run(id)
    const calls = recordFetch(() => json({ id: 'm2', '@odata.etag': 'W/"2"' }))

    await new MicrosoftSyncEngine(db).pushDirtyEvents(CAL, 'token')

    const body = JSON.parse(calls[0].body!)
    expect(body).not.toHaveProperty('body')
    expect(body).not.toHaveProperty('location')
  })

  it('is gone from the CalDAV resource, whatever the server copy had', async () => {
    const id = clearedHere(DAV_CAL, { id: HREF, etag: '"e1"' })
    db.prepare('INSERT INTO event_sources (event_id, ics) VALUES (?, ?)').run(
      id,
      [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//test//EN',
        'BEGIN:VEVENT',
        'UID:uid-1',
        'DTSTAMP:20260101T000000Z',
        'DTSTART:20260401T090000Z',
        'DTEND:20260401T100000Z',
        'RRULE:FREQ=WEEKLY;BYDAY=WE',
        'SUMMARY:Review',
        'DESCRIPTION:Bring the figures',
        'LOCATION:Room 4',
        'URL:https://meet.example.com/abc',
        'END:VEVENT',
        'END:VCALENDAR'
      ].join('\r\n')
    )
    const calls = recordFetch(
      () => ({ ok: true, status: 204, url: '', text: async () => '', headers: new Headers({ etag: '"e2"' }) }) as unknown as Response
    )

    await new CalDavSyncEngine(db).pushDirtyEvents(DAV_CAL, CREDS)

    const put = calls.find((c) => c.method === 'PUT')!
    expect(put.body).toContain('SUMMARY:Review')
    for (const name of ['DESCRIPTION', 'LOCATION', 'URL', 'RRULE']) expect(put.body).not.toMatch(new RegExp(`^${name}[:;]`, 'm'))
  })
})
