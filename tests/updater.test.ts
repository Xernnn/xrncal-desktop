import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * The self-updater looked for GitHub releases by default. A copy built from
 * source and installed by hand (the usual way here: no release has been
 * published) then logged "No published versions on GitHub" every six hours,
 * and a `v*` draft published one day would have replaced that build with the
 * CI's when the app quit, unasked. Checks are off now until Settings turns
 * them on, and a failure that repeats is logged once.
 */

const { checkForUpdates, updaterHandlers, logged } = vi.hoisted(() => ({
  checkForUpdates: vi.fn(() => Promise.resolve(null)),
  updaterHandlers: new Map<string, ((...args: unknown[]) => void)[]>(),
  logged: [] as { level: string; message: string }[]
}))

vi.mock('electron', async () => {
  const stub = await vi.importActual<Record<string, unknown>>('./stubs/electron')
  // Only an installed build updates itself.
  return { ...stub, app: { ...(stub.app as Record<string, unknown>), isPackaged: true } }
})

vi.mock('electron-updater', () => ({
  autoUpdater: {
    on: (event: string, fn: (...args: unknown[]) => void) => {
      updaterHandlers.set(event, [...(updaterHandlers.get(event) ?? []), fn])
    },
    checkForUpdates
  }
}))

vi.mock('../src/main/log', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../src/main/log')
  return { ...actual, log: (level: string, message: string) => logged.push({ level, message }) }
})

const SIX_HOURS = 6 * 60 * 60 * 1000

describe('the self-updater', () => {
  const savedAppImage = process.env.APPIMAGE

  beforeEach(() => {
    vi.useFakeTimers()
    vi.resetModules()
    checkForUpdates.mockClear()
    updaterHandlers.clear()
    logged.length = 0
    // On Linux only an AppImage updates itself.
    process.env.APPIMAGE = '/opt/test/xrncal.AppImage'
  })

  afterEach(async () => {
    ;(await import('../src/main/db/database')).closeDatabase()
    vi.useRealTimers()
    if (savedAppImage === undefined) delete process.env.APPIMAGE
    else process.env.APPIMAGE = savedAppImage
  })

  /** A fresh profile (optionally with checks turned on), and the updater started on it. */
  async function start(checks?: boolean): Promise<void> {
    const { initDatabase } = await import('../src/main/db/database')
    const { SettingsRepo } = await import('../src/main/db/repos/settings-repo')
    const db = initDatabase(':memory:')
    if (checks !== undefined) new SettingsRepo(db).setSetting('checkForUpdates', checks)
    const { startAutoUpdates } = await import('../src/main/updater')
    startAutoUpdates()
  }

  it('asks GitHub nothing on a profile that never turned checks on', async () => {
    await start()
    await vi.advanceTimersByTimeAsync(3 * SIX_HOURS)
    expect(checkForUpdates).not.toHaveBeenCalled()
  })

  it('looks every six hours once checks are turned on', async () => {
    await start(true)
    expect(checkForUpdates).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(SIX_HOURS)
    expect(checkForUpdates).toHaveBeenCalledTimes(2)
  })

  it('logs a check that keeps failing the same way once', async () => {
    await start(true)
    const fail = (message: string) => updaterHandlers.get('error')!.forEach((fn) => fn(new Error(message)))

    fail('No published versions on GitHub')
    fail('No published versions on GitHub')
    fail('No published versions on GitHub')
    expect(logged).toEqual([{ level: 'warn', message: 'Update check failed: No published versions on GitHub' }])

    // A different failure is news.
    fail('net::ERR_INTERNET_DISCONNECTED')
    expect(logged.map((l) => l.message)).toEqual([
      'Update check failed: No published versions on GitHub',
      'Update check failed: net::ERR_INTERNET_DISCONNECTED'
    ])
  })
})
