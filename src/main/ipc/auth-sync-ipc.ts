import { ipcMain } from 'electron'
import { IPC_CHANNELS, type ConnectCalDavInput, type ProviderStatus } from '@shared/ipc-contract'
import { getDatabase } from '../db/database'
import { credentialsFilePath, isConfigured } from '../load-credentials'
import { GoogleOAuthManager } from '../oauth/google-oauth'
import { MicrosoftOAuthManager } from '../oauth/microsoft-oauth'
import { SecureStore } from '../secure-store'
import { normalizeCalDavUrl, defaultCalDavName } from '../sync/caldav-discover'
import { CalDavAdapter, type CalDavCredentials } from '../sync/caldav-adapter'
import { resolveCalDavAccount } from '../sync/caldav-account-id'
import { SyncWorker } from '../sync/sync-worker'
import { describeError } from '../sync/http'
import { AccountsRepo } from '../db/repos/accounts-repo'
import { detachAccount } from '../db/repos/detach-account'
import type { CalendarAccount } from '@shared/event-model'

let syncWorkerInstance: SyncWorker | null = null

export function getSyncWorker(): SyncWorker | null {
  return syncWorkerInstance
}

function initSync(
  googleClientId?: string,
  googleClientSecret?: string,
  msClientId?: string,
  msClientSecret?: string
): void {
  const db = getDatabase()
  syncWorkerInstance = new SyncWorker(
    db,
    googleClientId,
    googleClientSecret,
    msClientId,
    msClientSecret
  )
  syncWorkerInstance.start()
}

export function registerAuthSyncIpcHandlers(): void {
  const db = getDatabase()
  const googleOAuth = new GoogleOAuthManager(db)
  const msOAuth = new MicrosoftOAuthManager(db)
  const secureStore = new SecureStore(db)
  const accounts = new AccountsRepo(db)

  if (!syncWorkerInstance) {
    const googleClientId = process.env.GOOGLE_OAUTH_CLIENT_ID
    const googleClientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET
    const msClientId = process.env.MICROSOFT_CLIENT_ID
    const msClientSecret = process.env.MICROSOFT_CLIENT_SECRET
    initSync(googleClientId, googleClientSecret, msClientId, msClientSecret)
  }

  ipcMain.removeHandler(IPC_CHANNELS.AUTH.CONNECT_GOOGLE)
  ipcMain.removeHandler(IPC_CHANNELS.AUTH.DISCONNECT_GOOGLE)
  ipcMain.removeHandler(IPC_CHANNELS.AUTH.CONNECT_MICROSOFT)
  ipcMain.removeHandler(IPC_CHANNELS.AUTH.DISCONNECT_MICROSOFT)
  ipcMain.removeHandler(IPC_CHANNELS.AUTH.CONNECT_CALDAV)
  ipcMain.removeHandler(IPC_CHANNELS.AUTH.DISCONNECT_CALDAV)
  ipcMain.removeHandler(IPC_CHANNELS.AUTH.LIST_ACCOUNTS)
  ipcMain.removeHandler(IPC_CHANNELS.AUTH.DETACH_ACCOUNT)
  ipcMain.removeHandler(IPC_CHANNELS.AUTH.PROVIDER_STATUS)
  ipcMain.removeHandler(IPC_CHANNELS.SYNC.TRIGGER_NOW)
  ipcMain.removeHandler(IPC_CHANNELS.SYNC.GET_STATUS)

  // The account picker asks first, so a build without an OAuth client says
  // so up front instead of failing after "Continue in browser".
  ipcMain.handle(IPC_CHANNELS.AUTH.PROVIDER_STATUS, (): ProviderStatus => ({
    google: isConfigured(process.env.GOOGLE_OAUTH_CLIENT_ID),
    microsoft: isConfigured(process.env.MICROSOFT_CLIENT_ID)
  }))

  // Google OAuth
  ipcMain.handle(IPC_CHANNELS.AUTH.CONNECT_GOOGLE, async () => {
    try {
      const activeClientId = process.env.GOOGLE_OAUTH_CLIENT_ID
      const activeClientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET
      if (!isConfigured(activeClientId)) {
        return {
          success: false,
          message:
            `Google sign-in isn't configured. Create a Google OAuth "Desktop app" client at ` +
            `console.cloud.google.com/apis/credentials, then add GOOGLE_OAUTH_CLIENT_ID and ` +
            `GOOGLE_OAUTH_CLIENT_SECRET to:\n${credentialsFilePath()}\nand restart the app.`
        }
      }

      const result = await googleOAuth.startAuthFlow(activeClientId!, activeClientSecret)
      if (syncWorkerInstance) {
        syncWorkerInstance.triggerSync().catch(() => {})
      }
      return { success: true, account: result.account }
    } catch (err) {
      return { success: false, message: describeError(err) }
    }
  })

  ipcMain.handle(IPC_CHANNELS.AUTH.DISCONNECT_GOOGLE, (_event, accountId: string) => {
    try {
      googleOAuth.disconnectAccount(accountId)
      return true
    } catch {
      return false
    }
  })

  // Microsoft OAuth
  ipcMain.handle(IPC_CHANNELS.AUTH.CONNECT_MICROSOFT, async () => {
    try {
      const activeClientId = process.env.MICROSOFT_CLIENT_ID
      const activeClientSecret = process.env.MICROSOFT_CLIENT_SECRET
      if (!isConfigured(activeClientId)) {
        return {
          success: false,
          message:
            `Microsoft sign-in isn't configured. Register an app at ` +
            `portal.azure.com (Azure AD → App registrations), then add MICROSOFT_CLIENT_ID ` +
            `(and MICROSOFT_CLIENT_SECRET if required) to:\n${credentialsFilePath()}\nand restart the app.`
        }
      }

      const result = await msOAuth.startAuthFlow(activeClientId!, activeClientSecret)
      if (syncWorkerInstance) {
        syncWorkerInstance.triggerSync().catch(() => {})
      }
      return { success: true, account: result.account }
    } catch (err) {
      return { success: false, message: describeError(err) }
    }
  })

  ipcMain.handle(IPC_CHANNELS.AUTH.DISCONNECT_MICROSOFT, (_event, accountId: string) => {
    try {
      msOAuth.disconnectAccount(accountId)
      return true
    } catch {
      return false
    }
  })

  // CalDAV Connection
  ipcMain.handle(IPC_CHANNELS.AUTH.CONNECT_CALDAV, async (_event, input: ConnectCalDavInput) => {
    try {
      if (!secureStore.isAvailable()) {
        throw new Error('OS Keyring encryption is unavailable. Cannot store credentials securely.')
      }

      const normalizedUrl = normalizeCalDavUrl(input.provider, input.serverUrl, input.username)
      const adapter = new CalDavAdapter({
        url: normalizedUrl,
        username: input.username,
        password: input.password
      })

      // Follow the address down to where the calendars actually are, so a bare
      // server URL works. An account with nothing to show is refused here
      // rather than connected empty - the old behaviour, which looked like a
      // sync bug.
      const { url: calendarHomeUrl, calendars } = await adapter.locateCalendarHome()
      if (calendars.length === 0) {
        throw new Error(`No calendars found at ${normalizedUrl}`)
      }

      const { accountId, takeOver } = resolveCalDavAccount(
        { homeUrl: calendarHomeUrl, username: input.username, calendarIds: calendars.map((c) => c.href) },
        accounts,
        (id) => secureStore.getToken<CalDavCredentials>(id)
      )
      const displayName = input.name?.trim() || defaultCalDavName(input.provider, normalizedUrl)

      // Store credentials encrypted in SecureStore
      secureStore.storeToken(accountId, {
        url: calendarHomeUrl,
        username: input.username,
        password: input.password,
        provider: input.provider
      })

      const account = db.transaction(() => {
        const saved = accounts.upsert({ id: accountId, type: 'caldav', name: displayName, email: input.username })
        accounts.moveCalendars(takeOver, accountId)
        return saved
      })()

      if (syncWorkerInstance) {
        syncWorkerInstance.triggerSync().catch(() => {})
      }

      return { success: true, account }
    } catch (err) {
      return { success: false, message: describeError(err) }
    }
  })

  ipcMain.handle(IPC_CHANNELS.AUTH.DISCONNECT_CALDAV, (_event, accountId: string) => {
    try {
      secureStore.deleteToken(accountId)
      accounts.deactivate(accountId)
      return true
    } catch {
      return false
    }
  })

  // Accounts & Sync
  ipcMain.handle(IPC_CHANNELS.AUTH.LIST_ACCOUNTS, (): CalendarAccount[] => accounts.list())

  // Keep the data, drop the provider. See detachAccount for why the account row
  // can only be deleted after its calendars have been re-homed.
  ipcMain.handle(IPC_CHANNELS.AUTH.DETACH_ACCOUNT, (_event, accountId: string) => {
    // Nothing to sync afterwards - the point is that this data is now local -
    // but the worker should stop polling an account that no longer exists.
    return detachAccount(db, accountId)
  })

  ipcMain.handle(IPC_CHANNELS.SYNC.TRIGGER_NOW, async () => {
    if (syncWorkerInstance) {
      return await syncWorkerInstance.triggerSync()
    }
    return { success: false, pulledCount: 0, pushedCount: 0, errorCount: 1, message: 'Sync worker not initialized' }
  })

  ipcMain.handle(IPC_CHANNELS.SYNC.GET_STATUS, () => {
    if (syncWorkerInstance) {
      return syncWorkerInstance.getStatus()
    }
    return {
      isSyncing: false,
      pendingPushesCount: 0,
      connectedAccounts: []
    }
  })
}
