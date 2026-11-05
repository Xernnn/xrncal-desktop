import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app } from 'electron'

/**
 * Where the OAuth client credentials come from, first match wins:
 *
 * 1. the environment;
 * 2. a plain `KEY=VALUE` file - `xrncal.env` in the data directory or next to
 *    the executable, or (only when run from source) the project's `.env`;
 * 3. the ids an official build carries, baked in by electron.vite.config.ts
 *    from the release workflow's secrets.
 *
 * So the official build signs in out of the box, and anyone can still point
 * their copy at an OAuth client of their own: a developer through these, anyone
 * else from the form in the accounts dialog, which is saved encrypted and comes
 * before all of this (`activeOAuthClient()`). Google calls a desktop client's
 * secret "not treated as a secret" (an installed app cannot keep one), and
 * Microsoft's public clients have none, which is why shipping them is normal.
 */
const CREDENTIAL_KEYS = [
  'GOOGLE_OAUTH_CLIENT_ID',
  'GOOGLE_OAUTH_CLIENT_SECRET',
  'MICROSOFT_CLIENT_ID',
  'MICROSOFT_CLIENT_SECRET'
] as const

type CredentialKey = (typeof CREDENTIAL_KEYS)[number]

function isCredentialKey(key: string): key is CredentialKey {
  return (CREDENTIAL_KEYS as readonly string[]).includes(key)
}

/** The ids baked into this build. `typeof` keeps tests (which have no build
 *  step to define them) from tripping over the undeclared names. */
function bakedCredentials(): Partial<Record<CredentialKey, string>> {
  return {
    GOOGLE_OAUTH_CLIENT_ID: typeof __XRNCAL_GOOGLE_CLIENT_ID__ === 'string' ? __XRNCAL_GOOGLE_CLIENT_ID__ : '',
    GOOGLE_OAUTH_CLIENT_SECRET:
      typeof __XRNCAL_GOOGLE_CLIENT_SECRET__ === 'string' ? __XRNCAL_GOOGLE_CLIENT_SECRET__ : '',
    MICROSOFT_CLIENT_ID: typeof __XRNCAL_MICROSOFT_CLIENT_ID__ === 'string' ? __XRNCAL_MICROSOFT_CLIENT_ID__ : ''
  }
}

export function loadCredentialsFile(): void {
  const candidates = [
    join(app.getPath('userData'), 'xrncal.env'),
    join(dirname(app.getPath('exe')), 'xrncal.env'),
    // The working directory is wherever the app happened to be started from;
    // an installed build has no business reading a .env out of it.
    ...(app.isPackaged ? [] : [join(process.cwd(), '.env')])
  ]

  for (const file of candidates) {
    if (!existsSync(file)) continue
    try {
      const text = readFileSync(file, 'utf8')
      for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.trim()
        if (!line || line.startsWith('#')) continue
        const eq = line.indexOf('=')
        if (eq === -1) continue
        const key = line.slice(0, eq).trim()
        let value = line.slice(eq + 1).trim()
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1)
        }
        // Only the four credentials: copying every line into the environment
        // let a stray file set anything at all for this process and the
        // processes it starts (the updater, a relaunch).
        if (isCredentialKey(key) && !process.env[key]) {
          process.env[key] = value
        }
      }
    } catch {
      // An unreadable file is skipped and the next location is tried.
    }
  }

  // A provider's baked client is used whole or not at all: a file naming its
  // own Google id must not be paired with the baked secret of another client.
  const baked = bakedCredentials()
  if (!process.env.GOOGLE_OAUTH_CLIENT_ID && baked.GOOGLE_OAUTH_CLIENT_ID) {
    process.env.GOOGLE_OAUTH_CLIENT_ID = baked.GOOGLE_OAUTH_CLIENT_ID
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = baked.GOOGLE_OAUTH_CLIENT_SECRET ?? ''
  }
  if (!process.env.MICROSOFT_CLIENT_ID && baked.MICROSOFT_CLIENT_ID) {
    process.env.MICROSOFT_CLIENT_ID = baked.MICROSOFT_CLIENT_ID
    // A public client has no secret; a stray one would be sent with it.
    delete process.env.MICROSOFT_CLIENT_SECRET
  }
}

const DUMMY_VALUES = new Set([
  '',
  'dummy_google_id.apps.googleusercontent.com',
  'dummy_microsoft_client_id'
])

export function isConfigured(clientId: string | undefined): boolean {
  return Boolean(clientId) && !DUMMY_VALUES.has(clientId as string)
}
