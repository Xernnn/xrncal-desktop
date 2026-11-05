/**
 * The OAuth client a copy of xrncal signs in to Google or Microsoft with, when
 * the person typed it into the app rather than the build carrying one.
 *
 * The form checks what was typed with these, and main checks it again: what
 * arrives over IPC is never taken on trust.
 */
export type OAuthProvider = 'google' | 'microsoft'

export interface OAuthClient {
  clientId: string
  /** Google's Desktop clients have one; a Microsoft public client has none. */
  clientSecret?: string
}

/** What the form sends. An empty secret on a saved client means "keep it". */
export interface OAuthClientForm {
  clientId: string
  clientSecret: string
}

/** What the renderer may know. The secret never leaves the main process. */
export interface OAuthClientInfo {
  /** `built-in`: from this build, the environment or a credentials file. */
  source: 'saved' | 'built-in' | 'none'
  /** Only for a saved client, to fill the form with. */
  clientId?: string
  hasSecret: boolean
  /** False without an OS keyring: nothing is stored unencrypted. */
  canSave: boolean
}

export type OAuthClientProblem = 'idMissing' | 'idFormat' | 'secretMissing' | 'secretFormat'

/**
 * What a Microsoft app registration lists. Microsoft ignores the port of a
 * `localhost` redirect but not its path, and only `localhost` can be entered in
 * its portal: `http://127.0.0.1` needs the manifest edited by hand.
 */
export const MICROSOFT_REDIRECT_URI = 'http://localhost/oauth2callback'

export function microsoftRedirectUri(port: number): string {
  return `http://localhost:${port}/oauth2callback`
}

const GOOGLE_CLIENT_ID = /^[a-z0-9-]+\.apps\.googleusercontent\.com$/i
const MICROSOFT_CLIENT_ID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i
const MAX_SECRET_LENGTH = 512

export function isOAuthProvider(value: unknown): value is OAuthProvider {
  return value === 'google' || value === 'microsoft'
}

/** Pasting from a web page brings spaces along. Anything that is not text is empty. */
export function cleanOAuthClientForm(input: unknown): OAuthClientForm {
  const fields = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>
  const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')
  return { clientId: text(fields.clientId), clientSecret: text(fields.clientSecret) }
}

/** What is wrong with a cleaned form, if anything. `keepsSecret`: a saved secret still applies. */
export function oauthClientProblem(
  provider: OAuthProvider,
  form: OAuthClientForm,
  keepsSecret = false
): OAuthClientProblem | null {
  if (!form.clientId) return 'idMissing'
  if (!(provider === 'google' ? GOOGLE_CLIENT_ID : MICROSOFT_CLIENT_ID).test(form.clientId)) return 'idFormat'
  if (provider === 'microsoft') return null
  if (!form.clientSecret) return keepsSecret ? null : 'secretMissing'
  // The usual slip is the id pasted into both fields.
  const looksWrong =
    GOOGLE_CLIENT_ID.test(form.clientSecret) || /\s/.test(form.clientSecret) || form.clientSecret.length > MAX_SECRET_LENGTH
  return looksWrong ? 'secretFormat' : null
}
