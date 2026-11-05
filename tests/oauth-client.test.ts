import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const electron = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  keyring: true,
  openedUrls: [] as string[]
}))

vi.mock('electron', async () => {
  const stub = await vi.importActual<typeof import('./stubs/electron')>('./stubs/electron')
  return {
    ...stub,
    safeStorage: {
      isEncryptionAvailable: () => electron.keyring,
      getSelectedStorageBackend: () => 'gnome_libsecret',
      encryptString: (text: string) => Buffer.from(`enc:${Buffer.from(text).toString('base64')}`),
      decryptString: (buffer: Buffer) => {
        if (!electron.keyring) throw new Error('locked')
        return Buffer.from(buffer.toString().slice(4), 'base64').toString()
      }
    },
    ipcMain: {
      handle: (channel: string, fn: (...args: unknown[]) => unknown) => electron.handlers.set(channel, fn),
      removeHandler: (channel: string) => electron.handlers.delete(channel)
    }
  }
})

const { initDatabase, closeDatabase } = await import('../src/main/db/database')
const { SecureStore } = await import('../src/main/secure-store')
const { SettingsRepo } = await import('../src/main/db/repos/settings-repo')
const { activeOAuthClient, oauthClientInfo, saveOAuthClient } = await import('../src/main/oauth/oauth-clients')
const { registerAuthSyncIpcHandlers } = await import('../src/main/ipc/auth-sync-ipc')
const { SyncWorker } = await import('../src/main/sync/sync-worker')
const { IPC_CHANNELS } = await import('../src/shared/ipc-contract')
const { cleanOAuthClientForm, isOAuthProvider, microsoftRedirectUri, MICROSOFT_REDIRECT_URI, oauthClientProblem } =
  await import('../src/shared/oauth-client')

const GOOGLE_ID = '1234-abc.apps.googleusercontent.com'
const OTHER_GOOGLE_ID = '5678-def.apps.googleusercontent.com'
const MICROSOFT_ID = '12345678-1234-1234-1234-123456789012'
const SECRET = 'GOCSPX-not-a-real-secret'
const ENV_KEYS = ['GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET', 'MICROSOFT_CLIENT_ID', 'MICROSOFT_CLIENT_SECRET']

describe('checking what was typed', () => {
  const form = (clientId: string, clientSecret = '') => ({ clientId, clientSecret })

  it('accepts a Google id with its secret, and a Microsoft id alone', () => {
    expect(oauthClientProblem('google', form(GOOGLE_ID, SECRET))).toBeNull()
    expect(oauthClientProblem('microsoft', form(MICROSOFT_ID))).toBeNull()
    expect(oauthClientProblem('microsoft', form(MICROSOFT_ID.toUpperCase()))).toBeNull()
  })

  it('says what is missing', () => {
    expect(oauthClientProblem('google', form(''))).toBe('idMissing')
    expect(oauthClientProblem('microsoft', form(''))).toBe('idMissing')
    expect(oauthClientProblem('google', form(GOOGLE_ID))).toBe('secretMissing')
  })

  it('needs no secret when a saved one still applies', () => {
    expect(oauthClientProblem('google', form(GOOGLE_ID), true)).toBeNull()
  })

  it('catches an id from the wrong place', () => {
    expect(oauthClientProblem('google', form(MICROSOFT_ID, SECRET))).toBe('idFormat')
    expect(oauthClientProblem('microsoft', form(GOOGLE_ID))).toBe('idFormat')
    expect(oauthClientProblem('google', form('dummy_google_id.apps.googleusercontent.com', SECRET))).toBe('idFormat')
  })

  it('catches the id pasted as the secret, and text that cannot be one', () => {
    expect(oauthClientProblem('google', form(GOOGLE_ID, GOOGLE_ID))).toBe('secretFormat')
    expect(oauthClientProblem('google', form(GOOGLE_ID, 'two words'))).toBe('secretFormat')
    expect(oauthClientProblem('google', form(GOOGLE_ID, 'x'.repeat(513)))).toBe('secretFormat')
  })

  it('cleans pasted spaces, and treats what is not text as empty', () => {
    expect(cleanOAuthClientForm({ clientId: `  ${GOOGLE_ID}\n`, clientSecret: ` ${SECRET} ` })).toEqual(form(GOOGLE_ID, SECRET))
    expect(cleanOAuthClientForm({ clientId: 7, clientSecret: {} })).toEqual(form(''))
    expect(cleanOAuthClientForm(null)).toEqual(form(''))
  })

  it('knows the two providers and nothing else', () => {
    expect(isOAuthProvider('google')).toBe(true)
    expect(isOAuthProvider('microsoft')).toBe(true)
    expect(isOAuthProvider('graph')).toBe(false)
    expect(isOAuthProvider('__proto__')).toBe(false)
  })
})

describe('the redirect Microsoft is sent', () => {
  it('matches what the steps say to register, apart from the port Microsoft ignores', () => {
    const sent = new URL(microsoftRedirectUri(49152))
    const registered = new URL(MICROSOFT_REDIRECT_URI)
    expect(sent.hostname).toBe('localhost')
    expect(`${sent.protocol}//${sent.hostname}${sent.pathname}`).toBe(`${registered.protocol}//${registered.hostname}${registered.pathname}`)
  })
})

describe('sign-in details kept in the app', () => {
  let db: ReturnType<typeof initDatabase>
  let store: InstanceType<typeof SecureStore>
  const invoke = (channel: string, ...args: unknown[]) => electron.handlers.get(channel)!({}, ...args)

  beforeEach(() => {
    for (const key of ENV_KEYS) delete process.env[key]
    electron.keyring = true
    db = initDatabase(':memory:')
    store = new SecureStore(db)
    vi.spyOn(SyncWorker.prototype, 'start').mockImplementation(() => {})
    registerAuthSyncIpcHandlers()
  })

  afterEach(() => {
    for (const key of ENV_KEYS) delete process.env[key]
    vi.restoreAllMocks()
    closeDatabase()
  })

  it('has nothing until something is saved', () => {
    expect(activeOAuthClient(store, 'google')).toBeNull()
    expect(oauthClientInfo(store, 'google')).toEqual({ source: 'none', hasSecret: false, canSave: true })
  })

  it('saves encrypted, not as text in the database', () => {
    saveOAuthClient(store, 'google', { clientId: GOOGLE_ID, clientSecret: SECRET })
    expect(activeOAuthClient(store, 'google')).toEqual({ clientId: GOOGLE_ID, clientSecret: SECRET })
    const raw = db.prepare("SELECT value FROM settings WHERE key = 'oauth-client:google'").get<{ value: string }>()!.value
    expect(raw).not.toContain(SECRET)
    expect(raw).not.toContain(GOOGLE_ID)
  })

  it('never shows the renderer the secret', async () => {
    await invoke(IPC_CHANNELS.AUTH.SAVE_OAUTH_CLIENT, 'google', { clientId: GOOGLE_ID, clientSecret: SECRET })
    const info = await invoke(IPC_CHANNELS.AUTH.GET_OAUTH_CLIENT, 'google')
    expect(info).toEqual({ source: 'saved', clientId: GOOGLE_ID, hasSecret: true, canSave: true })
    expect(JSON.stringify(info)).not.toContain(SECRET)
    expect(JSON.stringify(new SettingsRepo(db).getAllSettings())).not.toContain('oauth-client')
  })

  it('keeps the saved secret when the field is left empty, but only for the same id', () => {
    saveOAuthClient(store, 'google', { clientId: GOOGLE_ID, clientSecret: SECRET })
    saveOAuthClient(store, 'google', { clientId: GOOGLE_ID, clientSecret: '' })
    expect(activeOAuthClient(store, 'google')?.clientSecret).toBe(SECRET)

    expect(() => saveOAuthClient(store, 'google', { clientId: OTHER_GOOGLE_ID, clientSecret: '' })).toThrow(/secretMissing/)
    expect(activeOAuthClient(store, 'google')?.clientId).toBe(GOOGLE_ID)
  })

  it('drops a secret sent for Microsoft, whose public clients have none', () => {
    saveOAuthClient(store, 'microsoft', { clientId: MICROSOFT_ID, clientSecret: 'stray' })
    expect(activeOAuthClient(store, 'microsoft')).toEqual({ clientId: MICROSOFT_ID })
  })

  it('refuses invalid details and unknown providers over IPC', () => {
    expect(() => invoke(IPC_CHANNELS.AUTH.SAVE_OAUTH_CLIENT, 'google', { clientId: 'nonsense' })).toThrow(/idFormat/)
    expect(() => invoke(IPC_CHANNELS.AUTH.SAVE_OAUTH_CLIENT, 'token', { clientId: GOOGLE_ID })).toThrow(/Unknown/)
    expect(() => invoke(IPC_CHANNELS.AUTH.GET_OAUTH_CLIENT, 'token')).toThrow(/Unknown/)
    expect(() => invoke(IPC_CHANNELS.AUTH.CLEAR_OAUTH_CLIENT, 'x')).toThrow(/Unknown/)
  })

  it('fails closed without a keyring, storing nothing', async () => {
    electron.keyring = false
    expect(oauthClientInfo(store, 'google').canSave).toBe(false)
    expect(() => saveOAuthClient(store, 'google', { clientId: GOOGLE_ID, clientSecret: SECRET })).toThrow(/keyring/i)
    expect(db.prepare("SELECT 1 FROM settings WHERE key LIKE 'oauth-client:%'").get()).toBeUndefined()
  })

  it('treats a saved client it cannot decrypt as absent, and a new save replaces it', () => {
    saveOAuthClient(store, 'google', { clientId: GOOGLE_ID, clientSecret: SECRET })
    electron.keyring = false
    expect(activeOAuthClient(store, 'google')).toBeNull()
    electron.keyring = true
    saveOAuthClient(store, 'google', { clientId: OTHER_GOOGLE_ID, clientSecret: SECRET })
    expect(activeOAuthClient(store, 'google')?.clientId).toBe(OTHER_GOOGLE_ID)
  })

  it('puts a saved client ahead of one from the build or a file, and falls back when removed', async () => {
    process.env.GOOGLE_OAUTH_CLIENT_ID = '9999-built.apps.googleusercontent.com'
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'built-in'
    expect(oauthClientInfo(store, 'google').source).toBe('built-in')
    expect(activeOAuthClient(store, 'google')?.clientSecret).toBe('built-in')

    saveOAuthClient(store, 'google', { clientId: GOOGLE_ID, clientSecret: SECRET })
    expect(activeOAuthClient(store, 'google')).toEqual({ clientId: GOOGLE_ID, clientSecret: SECRET })

    await invoke(IPC_CHANNELS.AUTH.CLEAR_OAUTH_CLIENT, 'google')
    expect(activeOAuthClient(store, 'google')?.clientSecret).toBe('built-in')
    expect(db.prepare("SELECT 1 FROM settings WHERE key = 'oauth-client:google'").get()).toBeUndefined()
  })

  it('counts a placeholder id from a file as no client', () => {
    process.env.MICROSOFT_CLIENT_ID = 'dummy_microsoft_client_id'
    expect(activeOAuthClient(store, 'microsoft')).toBeNull()
  })

  it('tells the picker as soon as details are saved', async () => {
    expect(await invoke(IPC_CHANNELS.AUTH.PROVIDER_STATUS)).toEqual({ google: false, microsoft: false })
    await invoke(IPC_CHANNELS.AUTH.SAVE_OAUTH_CLIENT, 'microsoft', { clientId: MICROSOFT_ID })
    expect(await invoke(IPC_CHANNELS.AUTH.PROVIDER_STATUS)).toEqual({ google: false, microsoft: true })
  })

  it('sends nobody to a file when nothing is set up', async () => {
    const google = (await invoke(IPC_CHANNELS.AUTH.CONNECT_GOOGLE)) as { success: boolean; message: string }
    const microsoft = (await invoke(IPC_CHANNELS.AUTH.CONNECT_MICROSOFT)) as { success: boolean; message: string }
    for (const result of [google, microsoft]) {
      expect(result.success).toBe(false)
      expect(result.message).toMatch(/isn't configured/)
      expect(result.message).not.toMatch(/\.env|restart/i)
    }
  })

  it('hands a running sync worker details saved after it started', async () => {
    const seen: Array<string | undefined> = []
    const worker = new SyncWorker(db, () => ({ google: activeOAuthClient(store, 'google'), microsoft: null }))
    const engine = (worker as unknown as { googleEngine: { syncAll: (id?: string) => Promise<unknown> } }).googleEngine
    engine.syncAll = async (id) => {
      seen.push(id)
      return { pulledCount: 0, pushedCount: 0, errorCount: 0, success: true }
    }
    await worker.triggerSync()
    saveOAuthClient(store, 'google', { clientId: GOOGLE_ID, clientSecret: SECRET })
    await worker.triggerSync()
    expect(seen).toEqual([undefined, GOOGLE_ID])
  })
})
