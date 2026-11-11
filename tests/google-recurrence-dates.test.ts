import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createSqliteDriver, type ISqliteDatabase } from '../src/main/db/sqlite-driver'
import { MIGRATION_027_SQL, runMigrations, seedDefaultData } from '../src/main/db/database'
import { SyncStateRepo } from '../src/main/db/repos/sync-state-repo'
import { EventsRepo } from '../src/main/db/repos/events-repo'
import { GoogleSyncEngine } from '../src/main/sync/google-sync-engine'
import {
  mapDomainEventToGoogle,
  mapGoogleEventToDomain,
  recurrenceLineDates,
  type GoogleCalendarApiEvent
} from '../src/main/sync/google-event-mapper'

/**
 * Google keeps a series' excluded and added dates as EXDATE and RDATE lines
 * next to its RRULE. They were skipped on the way in, so a date excluded that
 * way on Google still showed here, and a push sent the RRULE alone, which took
 * every exclusion off the series on Google as well.
 */

const CAL = 'me@example.com'

const zurichSeries = (recurrence: string[]): GoogleCalendarApiEvent => ({
  id: 'weekly',
  status: 'confirmed',
  summary: 'Weekly review',
  start: { dateTime: '2026-08-18T12:00:00+02:00', timeZone: 'Europe/Zurich' },
  end: { dateTime: '2026-08-18T13:00:00+02:00', timeZone: 'Europe/Zurich' },
  recurrence,
  etag: '"e1"'
})

describe('the dates a Google series excludes and adds', () => {
  it('reads each form Google writes them in', () => {
    expect(recurrenceLineDates('EXDATE;TZID=Europe/Zurich:20260825T120000,20260901T120000', 'UTC')).toEqual([
      '2026-08-25T10:00:00.000Z',
      '2026-09-01T10:00:00.000Z'
    ])
    expect(recurrenceLineDates('EXDATE:20260825T100000Z', 'Europe/Zurich')).toEqual(['2026-08-25T10:00:00.000Z'])
    expect(recurrenceLineDates('EXDATE;VALUE=DATE:20260825', 'UTC')).toEqual(['2026-08-25T00:00:00.000Z'])
    // No zone of its own: the series'.
    expect(recurrenceLineDates('RDATE:20260826T120000', 'Europe/Zurich')).toEqual(['2026-08-26T10:00:00.000Z'])
    expect(recurrenceLineDates('RDATE;VALUE=PERIOD:20260826T100000Z/PT1H', 'UTC')).toEqual(['2026-08-26T10:00:00.000Z'])
  })

  it('are stored with the series, and the excluded ones are not shown', () => {
    const { event } = mapGoogleEventToDomain(
      zurichSeries([
        'RRULE:FREQ=WEEKLY;BYDAY=TU',
        'EXDATE;TZID=Europe/Zurich:20260825T120000',
        'EXDATE;TZID=Europe/Zurich:20260908T120000',
        'RDATE;TZID=Europe/Zurich:20260827T120000'
      ]),
      CAL
    )
    expect(event?.rrule).toBe('FREQ=WEEKLY;BYDAY=TU')
    expect(event?.exdate).toBe('2026-08-25T10:00:00.000Z,2026-09-08T10:00:00.000Z')
    expect(event?.rdate).toBe('2026-08-27T10:00:00.000Z')
  })

  it('go back to Google with the rule, in the series zone', () => {
    const payload = mapDomainEventToGoogle({
      calendarId: CAL,
      title: 'Weekly review',
      dtStartUtc: '2026-08-18T10:00:00.000Z',
      dtEndUtc: '2026-08-18T11:00:00.000Z',
      tzid: 'Europe/Zurich',
      rrule: 'FREQ=WEEKLY;BYDAY=TU',
      exdate: '2026-08-25T10:00:00.000Z,2026-09-08T10:00:00.000Z',
      rdate: '2026-08-27T10:00:00.000Z'
    })
    expect(payload.recurrence).toEqual([
      'RRULE:FREQ=WEEKLY;BYDAY=TU',
      'EXDATE;TZID=Europe/Zurich:20260825T120000,20260908T120000',
      'RDATE;TZID=Europe/Zurich:20260827T120000'
    ])

    const allDay = mapDomainEventToGoogle({
      calendarId: CAL,
      title: 'Bins',
      dtStartUtc: '2026-08-18T00:00:00.000Z',
      dtEndUtc: '2026-08-18T23:59:59.999Z',
      allDay: true,
      rrule: 'FREQ=WEEKLY',
      exdate: '2026-08-25T00:00:00.000Z'
    })
    expect(allDay.recurrence).toEqual(['RRULE:FREQ=WEEKLY', 'EXDATE;VALUE=DATE:20260825'])
  })
})

describe('a Google series with excluded dates, synced', () => {
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

  const json = (body: unknown, status = 200): Response =>
    ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) }) as Response

  it('shows without the excluded date, and an edit here keeps the exclusion on Google', async () => {
    const series = zurichSeries(['RRULE:FREQ=WEEKLY;BYDAY=TU;COUNT=4', 'EXDATE;TZID=Europe/Zurich:20260825T120000'])
    vi.stubGlobal('fetch', vi.fn(async () => json({ items: [series], nextSyncToken: 't1' })))
    await new GoogleSyncEngine(db).pullCalendarEvents(CAL, 'token')

    const shown = repo.queryEventsByRange([CAL], '2026-08-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z')
    expect(shown.map((o) => o.startUtc)).toEqual(['2026-08-18T10:00:00.000Z', '2026-09-01T10:00:00.000Z', '2026-09-08T10:00:00.000Z'])

    const localId = repo.queryEventsByCalendar(CAL)[0].id
    repo.updateEvent(localId, { title: 'Weekly review (moved room)' })
    const sent: { method?: string; body?: string }[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        sent.push({ method: init?.method, body: init?.body as string | undefined })
        return json({ ...series, summary: 'Weekly review (moved room)', etag: '"e2"' })
      })
    )
    await new GoogleSyncEngine(db).pushDirtyEvents(CAL, 'token')

    const write = sent.find((r) => r.body)
    expect(JSON.parse(write!.body!).recurrence).toEqual([
      'RRULE:FREQ=WEEKLY;BYDAY=TU;COUNT=4',
      'EXDATE;TZID=Europe/Zurich:20260825T120000'
    ])
  })

  it('is read again in full once, so a series stored before gets its excluded dates (migration 027)', async () => {
    const now = new Date().toISOString()
    db.prepare(
      `INSERT INTO accounts (id, type, name, created_at, updated_at) VALUES ('acc_g', 'google', 'G', ?, ?), ('acc_d', 'caldav', 'D', ?, ?)`
    ).run(now, now, now, now)
    db.prepare("UPDATE calendars SET account_id = 'acc_g' WHERE id = ?").run(CAL)
    db.prepare(
      `INSERT INTO calendars (id, account_id, name, color, is_visible, is_read_only, is_default, created_at, updated_at)
       VALUES ('https://dav.example/me/cal/', 'acc_d', 'D', '#000', 1, 0, 0, ?, ?)`
    ).run(now, now)
    const tokens = new SyncStateRepo(db)
    tokens.saveSyncToken(CAL, 'google-token')
    tokens.saveSyncToken('https://dav.example/me/cal/', 'dav-token')

    db.exec(MIGRATION_027_SQL)

    expect(tokens.getSyncToken(CAL)).toBeNull()
    expect(tokens.getSyncToken('https://dav.example/me/cal/')).toBe('dav-token')
    const urls: string[] = []
    const series = zurichSeries(['RRULE:FREQ=WEEKLY;BYDAY=TU', 'EXDATE;TZID=Europe/Zurich:20260825T120000'])
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        urls.push(url)
        return json({ items: [series], nextSyncToken: 't2' })
      })
    )
    await new GoogleSyncEngine(db).pullCalendarEvents(CAL, 'token')
    expect(urls[0]).not.toContain('syncToken=')
    expect(repo.queryEventsByCalendar(CAL)[0].exdate).toBe('2026-08-25T10:00:00.000Z')
  })
})
