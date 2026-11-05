import {
  cleanOAuthClientForm,
  oauthClientProblem,
  type OAuthClient,
  type OAuthClientInfo,
  type OAuthProvider
} from '@shared/oauth-client'
import { isConfigured } from '../load-credentials'
import type { SecureStore } from '../secure-store'

/** The client this build, the environment or a credentials file names (`load-credentials.ts`). */
function builtInClient(provider: OAuthProvider): OAuthClient | null {
  const clientId = provider === 'google' ? process.env.GOOGLE_OAUTH_CLIENT_ID : process.env.MICROSOFT_CLIENT_ID
  const clientSecret =
    provider === 'google' ? process.env.GOOGLE_OAUTH_CLIENT_SECRET : process.env.MICROSOFT_CLIENT_SECRET
  return isConfigured(clientId) ? { clientId: clientId as string, clientSecret } : null
}

/**
 * The client to sign in with. One typed into the app comes first: it is the
 * person's latest choice, and a form that a file silently overruled would look
 * broken. Read on every use, so a change applies without a restart, and so a
 * keyring unlocked after startup is picked up.
 */
export function activeOAuthClient(store: SecureStore, provider: OAuthProvider): OAuthClient | null {
  return store.getOAuthClient(provider) ?? builtInClient(provider)
}

export function oauthClientInfo(store: SecureStore, provider: OAuthProvider): OAuthClientInfo {
  const canSave = store.isAvailable()
  const saved = store.getOAuthClient(provider)
  if (saved) return { source: 'saved', clientId: saved.clientId, hasSecret: Boolean(saved.clientSecret), canSave }
  return { source: builtInClient(provider) ? 'built-in' : 'none', hasSecret: false, canSave }
}

/** Throws on anything invalid, and without a keyring: see `SecureStore.encrypt`. */
export function saveOAuthClient(store: SecureStore, provider: OAuthProvider, input: unknown): void {
  const form = cleanOAuthClientForm(input)
  const saved = store.getOAuthClient(provider)
  // The secret field starts empty, because a saved secret is never sent back to
  // fill it. It belongs to its id, so a new id never inherits it.
  const kept = saved?.clientId === form.clientId ? saved.clientSecret : undefined
  const problem = oauthClientProblem(provider, form, Boolean(kept))
  if (problem) throw new Error(`Those sign-in details were not accepted (${problem}).`)
  store.storeOAuthClient(
    provider,
    provider === 'google' ? { clientId: form.clientId, clientSecret: form.clientSecret || kept } : { clientId: form.clientId }
  )
}
