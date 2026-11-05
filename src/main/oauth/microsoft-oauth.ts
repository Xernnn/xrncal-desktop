import { escapeHtml } from '../html-escape'
import { describeError, fetchWithTimeout } from '../sync/http'
import http from 'http'
import type { AddressInfo } from 'net'
import crypto from 'crypto'
import { shell } from 'electron'
import type { ISqliteDatabase } from '../db/sqlite-driver'
import { SecureStore } from '../secure-store'
import { AccountsRepo } from '../db/repos/accounts-repo'
import { mt } from '../i18n-main'
import { microsoftRedirectUri } from '@shared/oauth-client'

export interface MicrosoftTokens {
  accessToken: string
  refreshToken: string
  expiresAt: number
  tokenType: string
  scope: string
}

export interface MicrosoftUserInfo {
  id: string
  userPrincipalName?: string
  displayName?: string
  mail?: string
}

const MS_AUTH_ENDPOINT = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize'
const MS_TOKEN_ENDPOINT = 'https://login.microsoftonline.com/common/oauth2/v2.0/token'
const GRAPH_ME_ENDPOINT = 'https://graph.microsoft.com/v1.0/me'

export class MicrosoftOAuthManager {
  private secureStore: SecureStore
  private accounts: AccountsRepo

  constructor(db: ISqliteDatabase) {
    this.secureStore = new SecureStore(db)
    this.accounts = new AccountsRepo(db)
  }

  private base64UrlEncode(buffer: Buffer): string {
    return buffer
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
  }

  private generatePkce(): { verifier: string; challenge: string } {
    const verifier = this.base64UrlEncode(crypto.randomBytes(32))
    const hash = crypto.createHash('sha256').update(verifier).digest()
    const challenge = this.base64UrlEncode(hash)
    return { verifier, challenge }
  }

  /**
   * Start Microsoft OAuth flow on loopback 127.0.0.1
   */
  async startAuthFlow(clientId: string, clientSecret?: string): Promise<{
    account: { id: string; name: string; email: string }
    tokens: MicrosoftTokens
  }> {
    if (!this.secureStore.isAvailable()) {
      throw new Error('OS Keyring encryption is unavailable. Cannot store Microsoft credentials securely.')
    }

    const { verifier, challenge } = this.generatePkce()
    const state = this.base64UrlEncode(crypto.randomBytes(16))

    return new Promise((resolve, reject) => {
      let timeoutId: NodeJS.Timeout | null = null

      const cleanup = () => {
        if (timeoutId) {
          clearTimeout(timeoutId)
          timeoutId = null
        }
        try {
          server.close()
        } catch {
          // Already closed, or never listened - nothing to recover from here.
        }
      }

      timeoutId = setTimeout(() => {
        cleanup()
        reject(new Error(mt('oauth.timeout.microsoft')))
      }, 5 * 60 * 1000)

      const server = http.createServer(async (req, res) => {
        try {
          const reqUrl = new URL(req.url || '/', 'http://127.0.0.1')

          if (reqUrl.pathname !== '/oauth2callback') {
            res.writeHead(404)
            res.end('Not found')
            return
          }

          const queryCode = reqUrl.searchParams.get('code')
          const queryState = reqUrl.searchParams.get('state')
          const queryError = reqUrl.searchParams.get('error')

          // Only the browser coming back from this sign-in knows the state. A
          // request without it - another page probing local ports - is turned
          // away without ending the sign-in, and cannot put text on this page.
          if (queryState !== state) {
            res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
            res.end('<h3>' + escapeHtml(mt('oauth.stateError')) + '</h3>')
            return
          }

          if (queryError || !queryCode) {
            const reason = queryError || 'no code'
            res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
            res.end('<h3>' + escapeHtml(mt('oauth.microsoft.failed', { error: reason })) + '</h3><p>' + escapeHtml(mt('oauth.canCloseShort')) + '</p>')
            cleanup()
            reject(new Error(`Microsoft OAuth error: ${reason}`))
            return
          }

          const address = server.address() as AddressInfo
          const redirectUri = microsoftRedirectUri(address.port)

          const tokenParams = new URLSearchParams({
            client_id: clientId,
            code: queryCode,
            code_verifier: verifier,
            grant_type: 'authorization_code',
            redirect_uri: redirectUri,
            scope: 'Calendars.ReadWrite offline_access User.Read'
          })

          if (clientSecret) {
            tokenParams.append('client_secret', clientSecret)
          }

          const tokenRes = await fetchWithTimeout(MS_TOKEN_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: tokenParams.toString()
          })

          if (!tokenRes.ok) {
            const errText = await tokenRes.text()
            throw new Error(`Microsoft Token exchange failed: ${errText}`)
          }

          const tokenData = await tokenRes.json()

          const tokens: MicrosoftTokens = {
            accessToken: tokenData.access_token,
            refreshToken: tokenData.refresh_token || '',
            expiresAt: Date.now() + (tokenData.expires_in || 3600) * 1000,
            tokenType: tokenData.token_type || 'Bearer',
            scope: tokenData.scope || ''
          }

          // Fetch user info from Microsoft Graph
          const userRes = await fetchWithTimeout(GRAPH_ME_ENDPOINT, {
            headers: { Authorization: `Bearer ${tokens.accessToken}` }
          })
          // Without the profile there is no account id to file the tokens
          // under: inventing one made a second account on every retry.
          if (!userRes.ok) throw new Error(mt('oauth.profileFailed', { status: userRes.status }))
          const userInfo: MicrosoftUserInfo = await userRes.json()

          const email = userInfo.mail || userInfo.userPrincipalName || 'user@outlook.com'
          const name = userInfo.displayName || 'Microsoft User'

          // Respond to browser
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
          res.end(`
            <!DOCTYPE html>
            <html>
              <head><meta charset="utf-8"><title>xrncal Auth</title></head>
              <body style="font-family:system-ui,sans-serif;text-align:center;padding:40px;background:#2b2d31;color:#dbdee1;">
                <h2 style="color:#0078d4;">${escapeHtml(mt('oauth.microsoft.success'))}</h2>
                <p style="color:#94a3b8;">${escapeHtml(mt('oauth.account', { detail: `${email} (${name})` }))}</p>
                <p style="color:#64748b;">${escapeHtml(mt('oauth.canClose'))}</p>
              </body>
            </html>
          `)

          cleanup()

          const accountId = `acc_graph_${userInfo.id}`
          this.accounts.upsert({ id: accountId, type: 'graph', name: name, email: email })

          // Store tokens securely
          this.secureStore.storeToken(accountId, tokens)

          resolve({
            account: { id: accountId, name, email },
            tokens
          })
        } catch (err) {
          // The browser is still waiting for this page.
          if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' })
            res.end('<h3>' + escapeHtml(mt('oauth.microsoft.failed', { error: describeError(err) })) + '</h3><p>' + escapeHtml(mt('oauth.canCloseShort')) + '</p>')
          }
          cleanup()
          reject(err)
        }
      })

      // Bind exclusively to 127.0.0.1 on random port
      server.listen(0, '127.0.0.1', () => {
        const address = server.address() as AddressInfo
        const redirectUri = microsoftRedirectUri(address.port)

        const authUrl = new URL(MS_AUTH_ENDPOINT)
        authUrl.searchParams.set('client_id', clientId)
        authUrl.searchParams.set('response_type', 'code')
        authUrl.searchParams.set('redirect_uri', redirectUri)
        authUrl.searchParams.set('response_mode', 'query')
        authUrl.searchParams.set('scope', 'Calendars.ReadWrite offline_access User.Read')
        authUrl.searchParams.set('code_challenge', challenge)
        authUrl.searchParams.set('code_challenge_method', 'S256')
        authUrl.searchParams.set('state', state)
        authUrl.searchParams.set('prompt', 'select_account')

        shell.openExternal(authUrl.toString())
      })

      server.on('error', (err) => {
        cleanup()
        reject(err)
      })
    })
  }

  /**
   * Get valid Microsoft Graph access token (auto-refreshes if needed)
   */
  async getValidAccessToken(accountId: string, clientId: string, clientSecret?: string): Promise<string> {
    const tokens = this.secureStore.getToken<MicrosoftTokens>(accountId)
    if (!tokens) {
      throw new Error(`No credentials found for account ${accountId}`)
    }

    if (tokens.expiresAt > Date.now() + 120 * 1000 && tokens.accessToken) {
      return tokens.accessToken
    }

    if (!tokens.refreshToken) {
      throw new Error(`Refresh token missing for account ${accountId}. Please re-authenticate.`)
    }

    const refreshParams = new URLSearchParams({
      client_id: clientId,
      refresh_token: tokens.refreshToken,
      grant_type: 'refresh_token',
      scope: 'Calendars.ReadWrite offline_access User.Read'
    })
    if (clientSecret) {
      refreshParams.append('client_secret', clientSecret)
    }

    const res = await fetchWithTimeout(MS_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: refreshParams.toString()
    })

    if (!res.ok) {
      throw new Error(`Failed to refresh Microsoft token: ${await res.text()}`)
    }

    const data = await res.json()
    const updatedTokens: MicrosoftTokens = {
      ...tokens,
      accessToken: data.access_token,
      refreshToken: data.refresh_token || tokens.refreshToken,
      expiresAt: Date.now() + (data.expires_in || 3600) * 1000
    }

    this.secureStore.storeToken(accountId, updatedTokens)
    return updatedTokens.accessToken
  }

  disconnectAccount(accountId: string): void {
    this.secureStore.deleteToken(accountId)
    this.accounts.deactivate(accountId)
  }
}
