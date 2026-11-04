import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createSqliteDriver, type ISqliteDatabase } from '../src/main/db/sqlite-driver'
import { runMigrations, seedDefaultData } from '../src/main/db/database'
import { EventsRepo } from '../src/main/db/repos/events-repo'
import { MicrosoftSyncEngine } from '../src/main/sync/microsoft-sync-engine'
import { graphOccurrenceOverrides, occurrenceIdDate } from '../src/main/sync/microsoft-event-mapper'
import type { CalendarEvent } from '../src/shared/event-model'

/**
 * Graph's listing holds series masters and single events only, so an
 * occurrence moved or cancelled in Outlook kept its series time here. A series'
 * changed and cancelled occurrences are read from the master itself.
 */

const CAL = 'cal_graph'

function master(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 'series',
    calendarId: CAL,
    uid: 'series@outlook.com',
    title: 'Standup',
    // Mondays 09:00 in Ho Chi Minh City (UTC+7).
    dtStartUtc: '2026-10-05T02:00:00.000Z',
    dtEndUtc: '2026-10-05T02:15:00.000Z',
    tzid: 'Asia/Bangkok',
    allDay: false,
    rrule: 'FREQ=WEEKLY;BYDAY=MO',
    dirty: false,
    hasConflict: false,
    isDeleted: false,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...overrides
  }
}

describe('Outlook occurrences read from their series', () => {
  it('reads the date an occurrenceId names', () => {
    expect(occurrenceIdDate('OID.AAMkADAGAADDdm4NAAA=.2020-04-30')).toBe('2020-04-30')
    expect(occurrenceIdDate('OID.AAMkADAGAADDdm4NAAA=')).toBeUndefined()
    expect(occurrenceIdDate(undefined)).toBeUndefined()
  })

  it('keys a cancelled occurrence by the start the series gives it', () => {
    const overrides = graphOccurrenceOverrides(master(), {
      cancelledOccurrences: ['OID.series=.2026-10-12']
    })
    expect(overrides).toEqual([{ originalStartUtc: '2026-10-12T02:00:00.000Z', isCancelled: true }])
  })

  it('finds a cancelled occurrence whose UTC date is the day before its own', () => {
    // Mondays 06:00 in UTC+7 are Sundays 23:00 UTC; the date may be read in
    // either calendar.
    const early = master({ dtStartUtc: '2026-10-04T23:00:00.000Z', dtEndUtc: '2026-10-04T23:30:00.000Z' })
    expect(graphOccurrenceOverrides(early, { cancelledOccurrences: ['OID.s.2026-10-12'] })[0]?.originalStartUtc).toBe(
      '2026-10-11T23:00:00.000Z'
    )
    expect(graphOccurrenceOverrides(early, { cancelledOccurrences: ['OID.s.2026-10-11'] })[0]?.originalStartUtc).toBe(
      '2026-10-11T23:00:00.000Z'
    )
    // A date the series never falls on is left out, not guessed.
    expect(graphOccurrenceOverrides(early, { cancelledOccurrences: ['OID.s.2026-10-14'] })).toEqual([])
  })

  it('keeps a moved occurrence under its original start, with its new time and its own id', () => {
    const overrides = graphOccurrenceOverrides(master(), {
      exceptionOccurrences: [
        {
          id: 'instance-19',
          occurrenceId: 'OID.series=.2026-10-19',
          originalStart: '2026-10-19T02:00:00Z',
          subject: 'Standup (moved)',
          body: { contentType: 'text', content: 'Room 4 ' },
          location: { displayName: 'Room 4' },
          isAllDay: false,
          start: { dateTime: '2026-10-19T03:00:00.0000000', timeZone: 'UTC' },
          end: { dateTime: '2026-10-19T03:15:00.0000000', timeZone: 'UTC' }
        }
      ]
    })
    expect(overrides).toEqual([
      {
        originalStartUtc: '2026-10-19T02:00:00.000Z',
        isCancelled: false,
        title: 'Standup (moved)',
        notes: 'Room 4',
        location: 'Room 4',
        dtStartUtc: '2026-10-19T03:00:00.000Z',
        dtEndUtc: '2026-10-19T03:15:00.000Z',
        tzid: 'Asia/Bangkok',
        allDay: false,
        providerInstanceId: 'instance-19'
      }
    ])
  })

  it('keys an all-day series by its floating dates', () => {
    const allDay = master({
      dtStartUtc: '2026-10-05T00:00:00.000Z',
      dtEndUtc: '2026-10-05T23:59:59.999Z',
      tzid: 'UTC',
      allDay: true
    })
    const overrides = graphOccurrenceOverrides(allDay, {
      cancelledOccurrences: ['OID.s.2026-10-12'],
      exceptionOccurrences: [
        {
          id: 'i',
          occurrenceId: 'OID.s.2026-10-19',
          // Midnight in the organiser's zone, as an instant.
          originalStart: '2026-10-18T17:00:00Z',
          subject: 'Holiday',
          isAllDay: true,
          start: { dateTime: '2026-10-20T00:00:00.0000000', timeZone: 'UTC' },
          end: { dateTime: '2026-10-21T00:00:00.0000000', timeZone: 'UTC' }
        }
      ]
    })
    expect(overrides.map((o) => [o.originalStartUtc, o.isCancelled, o.dtStartUtc])).toEqual([
      ['2026-10-12T00:00:00.000Z', true, undefined],
      ['2026-10-19T00:00:00.000Z', false, '2026-10-20T00:00:00.000Z']
    ])
  })
})

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body)
  } as Response
}

function graphSeries(id: string, etag = 'W/"1"') {
  return {
    id,
    type: 'seriesMaster',
    subject: `Series ${id}`,
    start: { dateTime: '2026-10-05T02:00:00.0000000', timeZone: 'UTC' },
    end: { dateTime: '2026-10-05T02:15:00.0000000', timeZone: 'UTC' },
    originalStartTimeZone: 'SE Asia Standard Time',
    recurrence: {
      pattern: { type: 'weekly', interval: 1, daysOfWeek: ['monday'], firstDayOfWeek: 'sunday' },
      range: { type: 'noEnd', startDate: '2026-10-05' }
    },
    '@odata.etag': etag,
    lastModifiedDateTime: '2026-10-01T00:00:00Z'
  }
}

describe('Microsoft pull of occurrence changes', () => {
  let db: ISqliteDatabase
  let repo: EventsRepo
  /** What each series answers when read by id. */
  let occurrences: Record<string, unknown>
  let listing: unknown[]
  let seriesReads: string[]
  let readStatus: number

  beforeEach(() => {
    db = createSqliteDriver(':memory:')
    runMigrations(db)
    seedDefaultData(db)
    const now = new Date().toISOString()
    db.prepare(
      `INSERT INTO calendars (id, account_id, name, color, is_visible, is_read_only, is_default, created_at, updated_at)
       VALUES (?, 'account-local-primary', 'Outlook', '#000000', 1, 0, 0, ?, ?)`
    ).run(CAL, now, now)
    repo = new EventsRepo(db)
    occurrences = {}
    listing = [graphSeries('series')]
    seriesReads = []
    readStatus = 200
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/calendars/')) return jsonResponse({ value: listing })
        const id = decodeURIComponent(url.split('/me/events/')[1].split('?')[0])
        seriesReads.push(id)
        if (readStatus !== 200) return jsonResponse({ error: {} }, readStatus)
        return jsonResponse(occurrences[id] ?? {})
      })
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  const october = () =>
    repo
      .queryEventsByRange([CAL], '2026-10-01T00:00:00.000Z', '2026-10-31T23:59:59.999Z')
      .map((o) => `${o.startUtc} ${o.title}`)

  const forceFullListing = () => {
    const state = JSON.parse(db.prepare('SELECT sync_token FROM sync_state WHERE calendar_id = ?').get<{ sync_token: string }>(CAL)!.sync_token)
    db.prepare('UPDATE sync_state SET sync_token = ? WHERE calendar_id = ?').run(
      JSON.stringify({ ...state, fullAt: '2000-01-01T00:00:00.000Z' }),
      CAL
    )
  }

  it('shows an occurrence moved in Outlook at its new time, and a cancelled one not at all', async () => {
    occurrences.series = {
      cancelledOccurrences: ['OID.series.2026-10-12'],
      exceptionOccurrences: [
        {
          id: 'instance-19',
          occurrenceId: 'OID.series.2026-10-19',
          originalStart: '2026-10-19T02:00:00Z',
          subject: 'Series series',
          start: { dateTime: '2026-10-19T04:00:00.0000000', timeZone: 'UTC' },
          end: { dateTime: '2026-10-19T04:15:00.0000000', timeZone: 'UTC' }
        }
      ]
    }

    const res = await new MicrosoftSyncEngine(db).pullCalendarEvents(CAL, 'token')

    expect(seriesReads).toEqual(['series'])
    expect(res.pulledCount).toBe(3)
    expect(october()).toEqual([
      '2026-10-05T02:00:00.000Z Series series',
      '2026-10-19T04:00:00.000Z Series series',
      '2026-10-26T02:00:00.000Z Series series'
    ])
    // An edit here to the moved occurrence goes to that instance, without a search.
    const moved = repo.getExceptionsForEvent('series').find((x) => !x.isCancelled)!
    expect(db.prepare('SELECT provider_instance_id FROM event_exceptions WHERE id = ?').get<{ provider_instance_id: string }>(moved.id)!.provider_instance_id).toBe('instance-19')
  })

  it('reads a series again only when it changes, or when the calendar is due a refresh', async () => {
    const engine = new MicrosoftSyncEngine(db)
    await engine.pullCalendarEvents(CAL, 'token')
    expect(seriesReads).toEqual(['series'])

    forceFullListing()
    const unchanged = await engine.pullCalendarEvents(CAL, 'token')
    expect(seriesReads).toEqual(['series'])
    expect(unchanged.pulledCount).toBe(0)

    // Changing an occurrence in Outlook changes the master's etag.
    listing = [graphSeries('series', 'W/"2"')]
    forceFullListing()
    await engine.pullCalendarEvents(CAL, 'token')
    expect(seriesReads).toEqual(['series', 'series'])

    // Six hours on, every series is read once more.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.now() + 6 * 60 * 60 * 1000 + 1000)
    forceFullListing()
    await engine.pullCalendarEvents(CAL, 'token')
    expect(seriesReads).toEqual(['series', 'series', 'series'])
  })

  it('drops a change Outlook no longer has, but keeps a colour set here', async () => {
    occurrences.series = {
      cancelledOccurrences: ['OID.series.2026-10-12'],
      exceptionOccurrences: [
        {
          id: 'i19',
          originalStart: '2026-10-19T02:00:00Z',
          subject: 'Moved',
          start: { dateTime: '2026-10-19T04:00:00.0000000', timeZone: 'UTC' },
          end: { dateTime: '2026-10-19T04:15:00.0000000', timeZone: 'UTC' }
        }
      ]
    }
    const engine = new MicrosoftSyncEngine(db)
    await engine.pullCalendarEvents(CAL, 'token')
    const moved = repo.getExceptionsForEvent('series').find((x) => !x.isCancelled)!
    db.prepare("UPDATE event_exceptions SET color = '#d50000' WHERE id = ?").run(moved.id)

    // Both restored in Outlook.
    occurrences.series = {}
    listing = [graphSeries('series', 'W/"2"')]
    forceFullListing()
    await engine.pullCalendarEvents(CAL, 'token')

    expect(october()).toEqual([
      '2026-10-05T02:00:00.000Z Series series',
      '2026-10-12T02:00:00.000Z Series series',
      '2026-10-19T02:00:00.000Z Series series',
      '2026-10-26T02:00:00.000Z Series series'
    ])
    expect(repo.getExceptionsForEvent('series')).toMatchObject([
      { originalStartUtc: '2026-10-19T02:00:00.000Z', isCancelled: false, color: '#d50000', title: undefined }
    ])
  })

  it('leaves an occurrence with an unsent edit here alone', async () => {
    const engine = new MicrosoftSyncEngine(db)
    await engine.pullCalendarEvents(CAL, 'token')
    repo.upsertException({ masterEventId: 'series', originalStartUtc: '2026-10-12T02:00:00.000Z', isCancelled: false, title: 'Mine' })
    expect(db.prepare('SELECT COUNT(*) c FROM event_exceptions WHERE dirty = 1').get<{ c: number }>()!.c).toBe(1)

    occurrences.series = { cancelledOccurrences: ['OID.series.2026-10-12'] }
    listing = [graphSeries('series', 'W/"2"')]
    forceFullListing()
    await engine.pullCalendarEvents(CAL, 'token')

    expect(repo.getExceptionsForEvent('series')).toMatchObject([
      { originalStartUtc: '2026-10-12T02:00:00.000Z', isCancelled: false, title: 'Mine' }
    ])
  })

  it('reads a few dozen series per poll and keeps the rest for the next', async () => {
    listing = Array.from({ length: 45 }, (_, i) => graphSeries(`s${String(i).padStart(2, '0')}`))
    const engine = new MicrosoftSyncEngine(db)
    await engine.pullCalendarEvents(CAL, 'token')
    expect(seriesReads).toHaveLength(40)

    await engine.pullCalendarEvents(CAL, 'token')
    expect(new Set(seriesReads).size).toBe(45)
    expect(seriesReads).toHaveLength(45)
  })

  it('keeps a series it could not read for the next poll', async () => {
    readStatus = 429
    const engine = new MicrosoftSyncEngine(db)
    await engine.pullCalendarEvents(CAL, 'token')
    expect(seriesReads).toEqual(['series'])

    readStatus = 200
    occurrences.series = { cancelledOccurrences: ['OID.series.2026-10-12'] }
    await engine.pullCalendarEvents(CAL, 'token')
    expect(seriesReads).toEqual(['series', 'series'])
    expect(october()).toHaveLength(3)
  })
})
