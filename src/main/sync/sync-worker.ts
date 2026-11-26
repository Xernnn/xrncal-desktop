import type { ISqliteDatabase } from '../db/sqlite-driver'
import { AccountsRepo } from '../db/repos/accounts-repo'
import { CalendarsRepo } from '../db/repos/calendars-repo'
import { SyncStateRepo } from '../db/repos/sync-state-repo'
import { GoogleSyncEngine } from './google-sync-engine'
import { MicrosoftSyncEngine } from './microsoft-sync-engine'
import { CalDavSyncEngine } from './caldav-sync-engine'
import { refreshDueSubscriptions } from '../subscriptions/ics-subscription'
import { settleDefaultCalendar } from '../db/repos/default-calendar'
import type { SyncStatus, SyncResult } from '@shared/event-model'
import type { OAuthClient } from '@shared/oauth-client'
import { mt } from '../i18n-main'
import { BrowserWindow } from 'electron'
import { IPC_CHANNELS } from '@shared/ipc-contract'
import { log, type LogLevel } from '../log'
import { describeError } from './http'

/**
 * What changed in the accounts' sync errors since the last round, as log
 * lines: an account that started failing, failed differently, or recovered.
 * Polls run every 20 s, so an account that stays offline is logged once, not
 * thrice a minute.
 */
export function accountErrorChanges(
  before: Record<string, string>,
  after: Record<string, string>
): { level: LogLevel; message: string }[] {
  const lines: { level: LogLevel; message: string }[] = []
  for (const [accountId, error] of Object.entries(after)) {
    if (before[accountId] !== error) lines.push({ level: 'warn', message: `Sync: ${accountId} failed: ${error}` })
  }
  for (const accountId of Object.keys(before)) {
    if (!(accountId in after)) lines.push({ level: 'info', message: `Sync: ${accountId} no longer failing` })
  }
  return lines
}

export interface SyncOAuthClients {
  google: OAuthClient | null
  microsoft: OAuthClient | null
}

export class SyncWorker {
  private googleEngine: GoogleSyncEngine
  private microsoftEngine: MicrosoftSyncEngine
  private caldavEngine: CalDavSyncEngine
  private timer: NodeJS.Timeout | null = null
  /** Kick-off timer from start(); tracked so stop() can cancel it before it
   *  fires a sync against a database the app is in the middle of closing. */
  private startupTimer: NodeJS.Timeout | null = null
  private activeSync: Promise<SyncResult> | null = null
  private lastSyncTime?: string
  private lastError?: string
  /** Accounts the last sync could not reach, by id, and why. */
  private accountErrors: Record<string, string> = {}
  /** A provider's whole sync that threw this round, by provider. */
  private engineErrors: Record<string, string> = {}
  /** The failures last written to the log, so each is logged when it starts,
   *  changes or ends rather than on every poll. */
  private loggedFailures: Record<string, string> = {}

  private currentIntervalMs = 5 * 60 * 1000

  /** `oauthClients` is asked on every sync, so details saved in the app apply without a restart. */
  constructor(
    private db: ISqliteDatabase,
    private oauthClients: () => SyncOAuthClients
  ) {
    this.googleEngine = new GoogleSyncEngine(db)
    this.microsoftEngine = new MicrosoftSyncEngine(db)
    this.caldavEngine = new CalDavSyncEngine(db)
  }

  /**
   * Start periodic background sync with adaptive polling
   */
  start(intervalMs = 5 * 60 * 1000): void {
    this.currentIntervalMs = intervalMs
    if (this.timer) clearInterval(this.timer)

    // Initial sync
    if (this.startupTimer) clearTimeout(this.startupTimer)
    this.startupTimer = setTimeout(() => {
      this.startupTimer = null
      this.triggerSync().catch(() => {})
    }, 3000)

    this.timer = setInterval(() => {
      this.triggerSync().catch(() => {})
    }, this.currentIntervalMs)
  }

  /**
   * Adaptive polling policy: 20s when focused (near-instant pulls without hammering provider
   * APIs — true push notifications would need a public HTTPS webhook endpoint, which a desktop
   * app doesn't have), 5m when background/tray
   */
  setFocusState(isFocused: boolean): void {
    const nextInterval = isFocused ? 20 * 1000 : 5 * 60 * 1000
    if (this.currentIntervalMs !== nextInterval) {
      this.currentIntervalMs = nextInterval
      if (this.timer) {
        clearInterval(this.timer)
        this.timer = setInterval(() => {
          this.triggerSync().catch(() => {})
        }, this.currentIntervalMs)
      }
    }
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    if (this.startupTimer) {
      clearTimeout(this.startupTimer)
      this.startupTimer = null
    }
  }

  /** Contain an engine-level throw so one provider cannot cancel the others. */
  private engineFailure(provider: string, err: unknown): SyncResult {
    const reason = describeError(err)
    const message = `${provider} sync failed: ${reason}`
    this.engineErrors[`${provider} engine`] = reason
    return { success: false, pulledCount: 0, pushedCount: 0, errorCount: 1, message }
  }

  /** A manual request waits for the current round before starting its own. */
  async syncNow(sourceId?: string): Promise<SyncResult> {
    while (this.activeSync) await this.activeSync
    return this.startSync({ sourceId })
  }

  /** Trigger a regular round, keeping the subscription refresh interval. */
  async triggerSync(): Promise<SyncResult> {
    if (this.activeSync) {
      return { success: false, pulledCount: 0, pushedCount: 0, errorCount: 0, message: 'Sync already in progress' }
    }
    return this.startSync()
  }

  private startSync(manual?: { sourceId?: string }): Promise<SyncResult> {
    this.activeSync = this.runSync(manual).finally(() => {
      this.activeSync = null
    })
    return this.activeSync
  }

  private async syncSource(sourceId: string): Promise<SyncResult> {
    const calendar = new CalendarsRepo(this.db).getCalendarById(sourceId)
    if (calendar?.subscriptionUrl) {
      const { pulledCount, errorCount } = await refreshDueSubscriptions(this.db, undefined, { force: true, calendarId: sourceId })
      return { success: errorCount === 0, pulledCount, pushedCount: 0, errorCount }
    }

    const account = new AccountsRepo(this.db).get(sourceId)
    if (!account?.isActive || account.type === 'local') {
      return { success: false, pulledCount: 0, pushedCount: 0, errorCount: 1, message: mt('sync.sourceUnavailable') }
    }

    const { google, microsoft } = this.oauthClients()
    let result: SyncResult
    switch (account.type) {
      case 'caldav':
        result = await this.caldavEngine.syncAll(account.id)
        break
      case 'google':
        result = await this.googleEngine.syncAll(google?.clientId, google?.clientSecret, account.id)
        break
      case 'graph':
        result = await this.microsoftEngine.syncAll(microsoft?.clientId, microsoft?.clientSecret, account.id)
        break
    }
    return { ...result, message: result.accountErrors?.[account.id] }
  }

  private async syncAll(forceSubscriptions: boolean): Promise<SyncResult> {
    this.engineErrors = {}
    // A slow or failing provider must not block the others from starting.
    const { google, microsoft } = this.oauthClients()
    const [googleRes, msRes, caldavRes, feedsRes] = await Promise.all([
      this.googleEngine.syncAll(google?.clientId, google?.clientSecret).catch((err) => this.engineFailure('Google', err)),
      this.microsoftEngine.syncAll(microsoft?.clientId, microsoft?.clientSecret).catch((err) => this.engineFailure('Microsoft', err)),
      this.caldavEngine.syncAll().catch((err) => this.engineFailure('CalDAV', err)),
      refreshDueSubscriptions(this.db, undefined, { force: forceSubscriptions }).catch(() => ({ pulledCount: 0, errorCount: 1 }))
    ])

    const pulledCount = googleRes.pulledCount + msRes.pulledCount + caldavRes.pulledCount + feedsRes.pulledCount
    const pushedCount = googleRes.pushedCount + msRes.pushedCount + caldavRes.pushedCount
    const errorCount = googleRes.errorCount + msRes.errorCount + caldavRes.errorCount + feedsRes.errorCount
    this.lastError = errorCount > 0 ? `Sync completed with ${errorCount} errors` : undefined
    this.accountErrors = { ...googleRes.accountErrors, ...msRes.accountErrors, ...caldavRes.accountErrors }
    const failures = { ...this.accountErrors, ...this.engineErrors }
    for (const line of accountErrorChanges(this.loggedFailures, failures)) log(line.level, line.message)
    this.loggedFailures = failures
    return { success: errorCount === 0, pulledCount, pushedCount, errorCount }
  }

  private async runSync(manual?: { sourceId?: string }): Promise<SyncResult> {
    try {
      const result = manual?.sourceId === undefined
        ? await this.syncAll(manual !== undefined)
        : await this.syncSource(manual.sourceId)
      this.lastSyncTime = new Date().toISOString()

      // Sync may discover calendars or change event IDs and subscriptions can
      // change to an empty feed. Reload the windows after each manual round.
      const defaultMoved = settleDefaultCalendar(this.db)
      if (manual || result.pulledCount > 0 || result.pushedCount > 0 || defaultMoved) {
        for (const win of BrowserWindow.getAllWindows()) {
          if (!win.isDestroyed()) win.webContents.send(IPC_CHANNELS.SYNC.CHANGED)
        }
      }

      const { pulledCount, pushedCount, errorCount } = result
      const message = result.success
        ? mt('sync.done', { pulled: pulledCount, pushed: pushedCount })
        : result.message || mt('sync.errors', { count: errorCount })
      return { ...result, message }
    } catch (err) {
      const message = describeError(err)
      if (manual?.sourceId === undefined) this.lastError = message
      log('error', `Sync failed: ${message}`)
      return { success: false, pulledCount: 0, pushedCount: 0, errorCount: 1, message }
    }
  }

  /**
   * Query current sync status
   */
  getStatus(): SyncStatus {
    const accounts = new AccountsRepo(this.db).listActive()

    return {
      lastSyncTime: this.lastSyncTime,
      isSyncing: this.activeSync !== null,
      lastError: this.lastError,
      pendingPushesCount: new SyncStateRepo(this.db).countPendingPushes(),
      connectedAccounts: accounts,
      accountErrors: this.accountErrors
    }
  }
}
