import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export interface RunningApp {
  app: ElectronApplication
  page: Page
  /** Uncaught errors the renderer threw. */
  errors: string[]
  close: () => Promise<void>
}

/**
 * The built app on a fresh profile, in a fixed zone (Asia/Ho_Chi_Minh, UTC+7
 * all year) so times read the same on every machine. On Linux without a display
 * (CI) run it under xvfb-run.
 *
 * A fresh profile opens on the first-run welcome; it is marked done unless a
 * test asks to see it (`{ welcome: true }`). A test that relaunches passes its
 * own `profile` (from `newProfile()`), which closing leaves for it to remove.
 */
export async function launchApp(
  options: { welcome?: boolean; args?: string[]; profile?: string } = {}
): Promise<RunningApp> {
  const profile = options.profile ?? newProfile()
  const app = await electron.launch({
    // CI runners cannot start Chromium's OS sandbox for an unpacked Electron
    // (no setuid helper, user namespaces restricted); the window sandboxes stay.
    args: [
      join(__dirname, '..', 'out', 'main', 'index.js'),
      ...(process.env.CI ? ['--no-sandbox'] : []),
      // Command-line arguments as the OS would pass them, e.g. a file to open.
      ...(options.args ?? [])
    ],
    // A fixed locale as well: a new profile takes its clock and first day of
    // the week from the computer, and the tests read times as 24-hour.
    env: {
      ...process.env,
      XRNCAL_USER_DATA_DIR: profile,
      TZ: 'Asia/Ho_Chi_Minh',
      LANG: 'en_GB.UTF-8',
      LANGUAGE: 'en_GB',
      LC_ALL: 'en_GB.UTF-8'
    }
  })
  const page = await mainWindow(app)
  const errors: string[] = []
  page.on('pageerror', (err) => errors.push(err.message))
  await page.waitForLoadState('domcontentloaded')
  if (!options.welcome) {
    await page.waitForFunction(() => Boolean(window.xrncal?.settings))
    await page.evaluate(() => window.xrncal.settings.set('welcomeDone', true))
    await page.reload()
    await page.waitForLoadState('domcontentloaded')
  }
  return {
    app,
    page,
    errors,
    close: async () => {
      await app.close()
      if (!options.profile) rmSync(profile, { recursive: true, force: true })
    }
  }
}

/** An empty profile directory, for a test that launches the app more than once. */
export function newProfile(): string {
  return mkdtempSync(join(tmpdir(), 'xrncal-e2e-'))
}

/** The main window, not the tray's mini window (`#mini`). */
async function mainWindow(app: ElectronApplication): Promise<Page> {
  for (let i = 0; i < 50; i++) {
    const main = app.windows().find((w) => !w.url().includes('#mini'))
    if (main) return main
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error('The main window never opened')
}
