import { describe, it, expect, beforeEach } from 'vitest'
import { createSqliteDriver, type ISqliteDatabase } from '../src/main/db/sqlite-driver'
import { MIGRATION_026_SQL, runMigrations, seedDefaultData } from '../src/main/db/database'
import { parseIcsContent, unescapeTextEscapes } from '../src/main/ics/parse-ics'

/**
 * Until 2a60e6f a push wrote the meeting link escaped as text, which no reader
 * unescapes in a URI: the server, every other client and the next pull here
 * kept "\," for ",", and each later push added a layer. A backslash is never
 * part of a URI, so the reader takes the escapes off, and migration 026 does
 * the same to the links already stored.
 */

const LINK = 'https://maps.example.com/place/@10.7769,106.7009,17z;layer=transit'
/** As the server has it after one push from an old build. */
const ONCE = String.raw`https://maps.example.com/place/@10.7769\,106.7009\,17z\;layer=transit`
/** After a pull and a second push. */
const TWICE = String.raw`https://maps.example.com/place/@10.7769\\\,106.7009\\\,17z\\\;layer=transit`

const icsWithUrl = (url: string): string =>
  [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Test//EN',
    'BEGIN:VEVENT',
    'UID:dinner@example.com',
    'SUMMARY:Dinner',
    'DTSTART:20260818T100000Z',
    'DTEND:20260818T110000Z',
    `URL:${url}`,
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n')

describe('a meeting link a push escaped as text', () => {
  it('is read back as the link it was, however many times it was escaped', () => {
    expect(parseIcsContent(icsWithUrl(ONCE), 'cal').events[0].meetingUrl).toBe(LINK)
    expect(parseIcsContent(icsWithUrl(TWICE), 'cal').events[0].meetingUrl).toBe(LINK)
  })

  it('leaves a link with nothing escaped in it as it is', () => {
    const plain = 'https://meet.example.com/abc-defg-hij?pwd=a%5Cb'
    expect(parseIcsContent(icsWithUrl(plain), 'cal').events[0].meetingUrl).toBe(plain)
    expect(parseIcsContent(icsWithUrl(LINK), 'cal').events[0].meetingUrl).toBe(LINK)
  })
})

describe('meeting links stored before the reader repaired them (migration 026)', () => {
  let db: ISqliteDatabase
  const now = '2026-08-01T00:00:00.000Z'

  const addCalendar = (id: string, type: string, readOnly = false): void => {
    db.prepare('INSERT OR IGNORE INTO accounts (id, type, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(
      `acc-${type}`,
      type,
      type,
      now,
      now
    )
    db.prepare(
      'INSERT INTO calendars (id, account_id, name, color, is_read_only, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(id, `acc-${type}`, id, '#000000', readOnly ? 1 : 0, now, now)
  }
  const addEvent = (id: string, calendarId: string, url: string | null, extra = ''): void => {
    db.prepare(
      `INSERT INTO events (id, calendar_id, uid, title, dtstart_utc, dtend_utc, meeting_url, etag, created_at, updated_at)
       VALUES (?, ?, ?, 'Dinner', '2026-08-18T10:00:00.000Z', '2026-08-18T11:00:00.000Z', ?, '"e1"', ?, ?)`
    ).run(id, calendarId, `${id}@x`, url, now, now)
    if (extra) db.prepare(`UPDATE events SET ${extra} WHERE id = ?`).run(id)
  }
  const row = (id: string) =>
    db.prepare('SELECT meeting_url, dirty FROM events WHERE id = ?').get<{ meeting_url: string | null; dirty: number }>(id)

  beforeEach(() => {
    db = createSqliteDriver(':memory:')
    runMigrations(db)
    seedDefaultData(db)
    addCalendar('dav', 'caldav')
    addCalendar('dav-ro', 'caldav', true)
    addCalendar('feed', 'ics')
  })

  it('repairs every stored link, and pushes the writable CalDAV ones again so the server is corrected too', () => {
    addEvent('once', 'dav', ONCE)
    addEvent('twice', 'dav', TWICE)
    addEvent('read-only', 'dav-ro', ONCE)
    addEvent('feed', 'feed', ONCE)
    addEvent('deleted', 'dav', ONCE, 'is_deleted = 1')
    addEvent('clean', 'dav', LINK)
    addEvent('none', 'dav', null)
    addEvent('lone', 'dav', String.raw`https://example.com/a\b`)

    db.exec(MIGRATION_026_SQL)

    expect(row('once')).toEqual({ meeting_url: LINK, dirty: 1 })
    expect(row('twice')).toEqual({ meeting_url: LINK, dirty: 1 })
    expect(row('read-only')).toEqual({ meeting_url: LINK, dirty: 0 })
    expect(row('feed')).toEqual({ meeting_url: LINK, dirty: 0 })
    expect(row('deleted')).toEqual({ meeting_url: LINK, dirty: 0 })
    expect(row('clean')).toEqual({ meeting_url: LINK, dirty: 0 })
    expect(row('none')).toEqual({ meeting_url: null, dirty: 0 })
    expect(row('lone')).toEqual({ meeting_url: String.raw`https://example.com/a\b`, dirty: 0 })
  })

  it('ends where the reader does', () => {
    const samples = [ONCE, TWICE, String.raw`a\\\\b\\;c\,`, String.raw`\\\\\\`, String.raw`x\y\\z`]
    samples.forEach((url, i) => addEvent(`s${i}`, 'feed', url))

    db.exec(MIGRATION_026_SQL)

    samples.forEach((url, i) => expect(row(`s${i}`)?.meeting_url).toBe(unescapeTextEscapes(url)))
  })
})
