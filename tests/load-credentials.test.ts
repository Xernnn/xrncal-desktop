import { describe, it, expect, vi, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const profile = vi.hoisted(() => ({ dir: '' }))

vi.mock('electron', async () => {
  const stub = await vi.importActual<typeof import('./stubs/electron')>('./stubs/electron')
  return {
    ...stub,
    // An installed build: it reads xrncal.env from its data directory and never
    // a .env from whatever folder it was started in.
    app: { ...stub.app, isPackaged: true, getPath: () => profile.dir }
  }
})

const { loadCredentialsFile, isConfigured } = await import('../src/main/load-credentials')

const KEYS = ['GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET', 'MICROSOFT_CLIENT_ID', 'XRNCAL_TEST_STRAY']

describe('OAuth client credentials', () => {
  afterEach(() => {
    for (const key of KEYS) delete process.env[key]
    if (profile.dir) rmSync(profile.dir, { recursive: true, force: true })
  })

  it('reads the four sign-in keys from xrncal.env, and nothing else', () => {
    profile.dir = mkdtempSync(join(tmpdir(), 'xrncal-creds-'))
    writeFileSync(
      join(profile.dir, 'xrncal.env'),
      ['# mine', 'GOOGLE_OAUTH_CLIENT_ID="123.apps.googleusercontent.com"', 'XRNCAL_TEST_STRAY=1', 'MICROSOFT_CLIENT_ID=abc'].join('\n')
    )
    loadCredentialsFile()
    expect(process.env.GOOGLE_OAUTH_CLIENT_ID).toBe('123.apps.googleusercontent.com')
    expect(process.env.MICROSOFT_CLIENT_ID).toBe('abc')
    expect(process.env.XRNCAL_TEST_STRAY).toBeUndefined()
  })

  it('lets the environment win over the file', () => {
    profile.dir = mkdtempSync(join(tmpdir(), 'xrncal-creds-'))
    writeFileSync(join(profile.dir, 'xrncal.env'), 'MICROSOFT_CLIENT_ID=from-file\n')
    process.env.MICROSOFT_CLIENT_ID = 'from-env'
    loadCredentialsFile()
    expect(process.env.MICROSOFT_CLIENT_ID).toBe('from-env')
  })

  it('treats empty and placeholder ids as not configured', () => {
    expect(isConfigured(undefined)).toBe(false)
    expect(isConfigured('')).toBe(false)
    expect(isConfigured('dummy_microsoft_client_id')).toBe(false)
    expect(isConfigured('123.apps.googleusercontent.com')).toBe(true)
  })
})
