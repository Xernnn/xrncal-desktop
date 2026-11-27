import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createSqliteDriver } from '../src/main/db/sqlite-driver'
import { runMigrations, seedDefaultData } from '../src/main/db/database'
import { SyncWorker } from '../src/main/sync/sync-worker'

/**
 * How often the sync worker asks the providers for changes.
 *
 * The rate followed focus and blur events alone. A focused window closed to
 * the tray is destroyed without necessarily reporting a blur, and the app then
 * polled every 20 s for as long as it ran: a home server's Radicale worked out
 * its calendars' ctags three times a minute, day and night (about 7.5 % of a
 * core for 8,000 events). Now each poll asks which window has focus before
 * timing the next one, and the rate without focus is 10 minutes.
 */

describe('sync polling', () => {
  let focused: boolean
  let syncs: number
  let worker: SyncWorker

  beforeEach(() => {
    vi.useFakeTimers()
    focused = false
    syncs = 0
    const db = createSqliteDriver(':memory:')
    runMigrations(db)
    seedDefaultData(db)
    worker = new SyncWorker(db, () => ({ google: null, microsoft: null }), () => focused)
    // A real round (no accounts: nothing goes over the network), counted.
    const realSync = worker.triggerSync.bind(worker)
    vi.spyOn(worker, 'triggerSync').mockImplementation(() => {
      syncs++
      return realSync()
    })
  })

  afterEach(() => {
    worker.stop()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  const minutes = (n: number) => vi.advanceTimersByTimeAsync(n * 60_000)

  it('polls every 20 s while a window has focus', async () => {
    focused = true
    worker.start()
    worker.setFocusState(true)
    await minutes(1)
    // The first sync 3 s after start, then at 20, 40 and 60 s.
    expect(syncs).toBe(4)
  })

  it('polls every 10 minutes while no window has focus', async () => {
    worker.start()
    await minutes(60)
    expect(syncs).toBe(1 + 6)
  })

  it('slows down once the focused window is gone, even when no blur says so', async () => {
    focused = true
    worker.start()
    worker.setFocusState(true)
    await minutes(1)
    expect(syncs).toBe(4)

    // The window is closed to the tray: nothing has focus, and nothing called setFocusState(false).
    focused = false
    syncs = 0
    await minutes(60)
    // The poll already timed at the focused rate (20 s on), then one every 10 minutes.
    expect(syncs).toBe(1 + 5)
  })

  it('speeds up as soon as a window has focus again', async () => {
    worker.start()
    await minutes(1)
    expect(syncs).toBe(1)

    focused = true
    worker.setFocusState(true)
    await vi.advanceTimersByTimeAsync(20_000)
    expect(syncs).toBe(2)
  })

  it('syncs on focus, but not when a sync began less than a focused poll ago', async () => {
    worker.start()
    await vi.advanceTimersByTimeAsync(3_000)
    expect(syncs).toBe(1)

    worker.syncOnFocus()
    expect(syncs).toBe(1)

    await vi.advanceTimersByTimeAsync(20_000)
    worker.syncOnFocus()
    expect(syncs).toBe(2)
  })

  it('stops polling when stopped', async () => {
    worker.start()
    worker.stop()
    worker.setFocusState(true)
    await minutes(60)
    expect(syncs).toBe(0)
  })
})
