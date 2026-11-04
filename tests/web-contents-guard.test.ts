import { afterEach, describe, it, expect, vi } from 'vitest'
import { app } from 'electron'
import { devServerUrl, isAppUrl } from '../src/main/web-contents-guard'

/**
 * ELECTRON_RENDERER_URL names the page both windows load, and isAppUrl() trusts
 * that page's IPC. An installed build that followed it loaded any page with the
 * bridge to every calendar, account and setting - tested against a packaged
 * build with a page served on 127.0.0.1.
 */
describe('the dev server address', () => {
  const stubApp = app as { isPackaged: boolean }
  const page = 'http://127.0.0.1:48731'

  afterEach(() => {
    stubApp.isPackaged = false
    vi.unstubAllEnvs()
  })

  it('is followed by an unpackaged build, as npm run dev needs', () => {
    vi.stubEnv('ELECTRON_RENDERER_URL', page)
    expect(devServerUrl()).toBe(page)
    expect(isAppUrl(`${page}/#mini`)).toBe(true)
  })

  it('is ignored by an installed build, whose IPC then refuses that page', () => {
    vi.stubEnv('ELECTRON_RENDERER_URL', page)
    stubApp.isPackaged = true
    expect(devServerUrl()).toBeUndefined()
    expect(isAppUrl(`${page}/`)).toBe(false)
  })
})
