import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSqliteDriver, type ISqliteDatabase } from '../src/main/db/sqlite-driver'
import { runMigrations, seedDefaultData } from '../src/main/db/database'
import { EventsRepo } from '../src/main/db/repos/events-repo'
import { CALENDAR_MAX_OCCURRENCES } from '../src/shared/bounded-rrule'
import { initLog, logFilePath } from '../src/main/log'

/**
 * A feed of dense but valid rules (every hour of every day) produced millions
 * of occurrences per view, as the work meter counts reads of a rule, not the
 * dates it makes. Each calendar now makes at most CALENDAR_MAX_OCCURRENCES per
 * query, and the log says so once.
 */

describe('a calendar with more repeating dates than one query takes', () => {
  let db: ISqliteDatabase
  let repo: EventsRepo
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'xrncal-cap-'))
    initLog(dir)
    db = createSqliteDriver(':memory:')
    runMigrations(db)
    seedDefaultData(db)
    repo = new EventsRepo(db)
    const now = new Date().toISOString()
    for (const id of ['cal_feed', 'cal_mine']) {
      db.prepare(
        `INSERT INTO calendars (id, account_id, name, color, is_visible, is_read_only, is_default, created_at, updated_at)
         VALUES (?, 'account-local-primary', ?, '#000', 1, 0, 0, ?, ?)`
      ).run(id, id, now, now)
    }
  })

  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it("stops at that calendar's share, leaves the others whole, and logs it once", () => {
    const hourly = `FREQ=DAILY;BYHOUR=${Array.from({ length: 24 }, (_, h) => h).join(',')}`
    for (let i = 0; i < 60; i++) {
      repo.createEvent({
        calendarId: 'cal_feed',
        title: `Shift ${i}`,
        dtStartUtc: '2026-01-01T00:00:00.000Z',
        dtEndUtc: '2026-01-01T00:30:00.000Z',
        rrule: hourly
      })
    }
    repo.createEvent({
      calendarId: 'cal_mine',
      title: 'Standup',
      dtStartUtc: '2026-01-05T02:00:00.000Z',
      dtEndUtc: '2026-01-05T02:15:00.000Z',
      rrule: 'FREQ=DAILY'
    })

    const range = ['2026-09-28T00:00:00.000Z', '2026-11-08T23:59:59.999Z'] as const
    for (let query = 0; query < 2; query++) {
      const shown = repo.queryEventsByRange(['cal_feed', 'cal_mine'], ...range)
      expect(shown.filter((o) => o.calendarId === 'cal_feed').length).toBeLessThanOrEqual(CALENDAR_MAX_OCCURRENCES)
      expect(shown.filter((o) => o.calendarId === 'cal_mine')).toHaveLength(42)
    }

    const lines = readFileSync(logFilePath()!, 'utf8').split('\n').filter((l) => l.includes('cal_feed'))
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatch(/WARN .*more than 50000 repeating dates/)
    // Two queries of 50,000 dates each take about 3 s here; more on a busy machine.
  }, 30_000)
})
