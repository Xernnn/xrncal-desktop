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

/**
 * How often the providers are asked for changes while one of the app's windows
 * has focus: near-instant pulls without hammering provider APIs (true push
 * would need a public HTTPS webhook, which a desktop app doesn't have).
 */
export const FOCUSED_POLL_MS = 20 * 1000

/**
 * ...and while none has: the window closed to the tray, minimised or behind
 * another app. Every poll costs the server something even when nothing has
 * changed - a CalDAV server works out each calendar's ctag from every event in
 * it, about 1.6 s of a small home server's CPU for 8,000 events - and nobody is
 * looking. Coming back to the window syncs at once.
 */
export const BACKGROUND_POLL_MS = 10 * 60 * 1000

/** Whether one of the app's windows has focus now. */
function anyWindowFocused(): boolean {
  return BrowserWindow.getFocusedWindow() !== null
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
  /** When the last sync began (ms), so a focus soon after one does not start another. */
  private lastStartedAt = 0
  private lastSyncTime?: string
  private lastError?: string
  /** Accounts the last sync could not reach, by id, and why. */
  private accountErrors: Record<string, string> = {}
  /** A provider's whole sync that threw this round, by provider. */
  private engineErrors: Record<string, string> = {}
  /** The failures last written to the log, so each is logged when it starts,
   *  changes or ends rather than on every poll. */
  private loggedFailures: Record<string, string> = {}

  private currentIntervalMs = BACKGROUND_POLL_MS

  /**
   * `oauthClients` is asked on every sync, so details saved in the app apply
   * without a restart. `hasFocus` is asked before each poll is timed.
   */
  constructor(
    private db: ISqliteDatabase,
    private oauthClients: () => SyncOAuthClients,
    private hasFocus: () => boolean = anyWindowFocused
  ) {
    this.googleEngine = new GoogleSyncEngine(db)
    this.microsoftEngine = new MicrosoftSyncEngine(db)
    this.caldavEngine = new CalDavSyncEngine(db)
  }

  /**
   * Start periodic background sync: a first sync shortly after launch, then
   * polls at the rate that goes with focus (FOCUSED_POLL_MS, BACKGROUND_POLL_MS).
   */
  start(): void {
    // Initial sync
    if (this.startupTimer) clearTimeout(this.startupTimer)
    this.startupTimer = setTimeout(() => {
      this.startupTimer = null
      this.triggerSync().catch(() => {})
    }, 3000)

    this.schedule(this.pollIntervalNow(), true)
  }

  /**
   * A window gained or lost focus, or closed: poll at the rate that goes with
   * it from now on.
   *
   * The rate used to follow these calls alone, so a blur that never came left
   * the app polling every 20 s for as long as it ran: a focused window closed
   * to the tray is destroyed, and nothing promises a blur on the way out. A
   * home server's calendar was asked for its ctags three times a minute, day
   * and night, at about 7.5 % of a core. Each poll now also asks which window
   * has focus before timing the next one.
   */
  setFocusState(isFocused: boolean): void {
    this.schedule(isFocused ? FOCUSED_POLL_MS : BACKGROUND_POLL_MS)
  }

  /**
   * Sync because the user came back to a window - unless a sync began less
   * than a focused poll ago. Each switch back to the window used to sync, so
   * moving between windows asked the servers again every few seconds.
   */
  syncOnFocus(): void {
    if (Date.now() - this.lastStartedAt < FOCUSED_POLL_MS) return
    this.triggerSync().catch(() => {})
  }

  private pollIntervalNow(): number {
    return this.hasFocus() ? FOCUSED_POLL_MS : BACKGROUND_POLL_MS
  }

  /** Time the next poll `intervalMs` from now, unless one is already timed at that rate. */
  private schedule(intervalMs: number, restart = false): void {
    if (!restart && !this.timer) return // not started, or stopped
    if (!restart && intervalMs === this.currentIntervalMs) return
    if (this.timer) clearTimeout(this.timer)
    this.currentIntervalMs = intervalMs
    this.timer = setTimeout(() => {
      // The next one first, so nothing a sync does can end the polling.
      this.schedule(this.pollIntervalNow(), true)
      this.triggerSync().catch(() => {})
    }, intervalMs)
  }

  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer)
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
    this.lastStartedAt = Date.now()
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
