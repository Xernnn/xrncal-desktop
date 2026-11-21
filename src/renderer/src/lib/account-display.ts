import type { Calendar, CalendarAccount } from '@shared/event-model'
import { compareAccountsForSidebar, compareCalendarsForSidebar } from '@shared/calendar-order'

/**
 * How accounts and calendars are presented: grouped the way OneCalendar does it,
 * one heading per account with its calendars underneath, so "which calendars do
 * I have and where do they come from" has one answer everywhere - the sidebar,
 * the accounts dialog and the add-account flow all read these helpers.
 */

/** What a group is, for its icon and label. `icloud` is a CalDAV account on Apple's server. */
export type ProviderKind = 'local' | 'google' | 'graph' | 'caldav' | 'icloud' | 'holidays' | 'subscription'

export interface CalendarGroup {
  /** The account id, or `holidays` / `subscriptions` for those two groups. */
  key: string
  kind: ProviderKind
  /** Absent for the holidays and subscriptions groups. */
  account?: CalendarAccount
  calendars: Calendar[]
}

/** The account seeded for calendars that live only on this computer. */
export const LOCAL_ACCOUNT_ID = 'account-local-primary'

/** Holiday subscriptions carry their type; a calendar merely named like one is not one. */
function isHolidayCalendar(cal: Calendar): boolean {
  return Boolean(cal.holidayType)
}

export function providerKind(account: CalendarAccount): ProviderKind {
  if (account.type === 'caldav' && /icloud/i.test(`${account.name} ${account.email ?? ''}`)) return 'icloud'
  return account.type
}

/** A remote account is one the sync worker talks to; it can be synced and removed. */
export function isRemoteAccount(account: CalendarAccount): boolean {
  return account.type !== 'local'
}

/**
 * Calendars grouped under their accounts: this computer first, then each
 * connected account in the order it was added, then subscriptions, then
 * holidays. Within a group
 * the default calendar leads and the rest are alphabetical. Every account gets
 * a group even with no calendars yet - the accounts dialog lists it while its
 * first sync runs; the sidebar skips empty groups itself.
 */
export function groupCalendars(accounts: CalendarAccount[], calendars: Calendar[]): CalendarGroup[] {
  const byAccount = new Map<string, Calendar[]>()
  const holidays: Calendar[] = []
  const subscriptions: Calendar[] = []
  const known = new Set(accounts.map((a) => a.id))

  for (const cal of calendars) {
    if (isHolidayCalendar(cal)) {
      holidays.push(cal)
      continue
    }
    // Local calendars too, but fed from a link: a group of their own, so
    // "this computer" stays the calendars the user writes in.
    if (cal.subscriptionUrl) {
      subscriptions.push(cal)
      continue
    }
    // A calendar whose account row is gone still has to show somewhere.
    const key = known.has(cal.accountId) ? cal.accountId : LOCAL_ACCOUNT_ID
    const list = byAccount.get(key) ?? []
    list.push(cal)
    byAccount.set(key, list)
  }

  const sortCalendars = (list: Calendar[]) => [...list].sort(compareCalendarsForSidebar)

  const ordered = [...accounts].sort(compareAccountsForSidebar)

  const groups: CalendarGroup[] = ordered.map((account) => ({
    key: account.id,
    kind: providerKind(account),
    account,
    calendars: sortCalendars(byAccount.get(account.id) ?? [])
  }))

  // Calendars filed under the local account when it is not in `accounts` at all.
  const orphans = byAccount.get(LOCAL_ACCOUNT_ID)
  if (orphans && !known.has(LOCAL_ACCOUNT_ID)) {
    groups.unshift({ key: LOCAL_ACCOUNT_ID, kind: 'local', calendars: sortCalendars(orphans) })
  }

  if (subscriptions.length > 0) {
    groups.push({ key: 'subscriptions', kind: 'subscription', calendars: sortCalendars(subscriptions) })
  }
  if (holidays.length > 0) {
    groups.push({ key: 'holidays', kind: 'holidays', calendars: sortCalendars(holidays) })
  }
  return groups
}

/** A calendar new events can go into: not read-only, and not filled from a feed. */
export function isWritableCalendar(cal: Calendar): boolean {
  return !cal.isReadOnly && !cal.subscriptionUrl && !cal.holidayType
}

/**
 * Whether a calendar on this computer can be removed: one new events can go
 * into, while another such calendar is left to be the default (the main
 * process moves the default there, settleDefaultCalendar).
 */
export function canRemoveLocalCalendar(cal: Calendar, calendars: Calendar[]): boolean {
  return isWritableCalendar(cal) && calendars.some((other) => other.id !== cal.id && isWritableCalendar(other))
}

/**
 * Where a removed calendar's events can be moved: every other calendar they
 * can be written into, in the sidebar's order, grouped by account. The one
 * picked to start with is the calendar new events go into after the removal -
 * the default if it is not the one going, else what the main process makes
 * the default: the first account calendar, a shown one before a hidden one,
 * else the first calendar on this computer the same way.
 */
export function eventMoveTargets(
  cal: Calendar,
  accounts: CalendarAccount[],
  calendars: Calendar[]
): { groups: CalendarGroup[]; preferred?: Calendar } {
  const groups = groupCalendars(accounts, calendars)
    .map((group) => ({ ...group, calendars: group.calendars.filter((c) => c.id !== cal.id && isWritableCalendar(c)) }))
    .filter((group) => group.calendars.length > 0)
  const targets = groups.flatMap((group) => group.calendars)
  const remoteIds = new Set(accounts.filter(isRemoteAccount).map((a) => a.id))
  const remote = targets.filter((c) => remoteIds.has(c.accountId))
  const pool = remote.length > 0 ? remote : targets
  const preferred =
    targets.find((c) => c.isDefault) ?? pool.find((c) => c.isVisible) ?? pool[0]
  return { groups, preferred }
}

/**
 * The visibility changes that leave only `calendarId` showing - the sidebar's
 * "Show only this". Only calendars whose state actually changes are returned,
 * so a press costs as many writes as it has to.
 */
export function showOnlyChanges(calendars: Calendar[], calendarId: string): { id: string; isVisible: boolean }[] {
  return calendars
    .filter((cal) => cal.isVisible !== (cal.id === calendarId))
    .map((cal) => ({ id: cal.id, isVisible: cal.id === calendarId }))
}

/** Everything hidden turned back on. */
export function showAllChanges(calendars: Calendar[]): { id: string; isVisible: boolean }[] {
  return calendars.filter((cal) => !cal.isVisible).map((cal) => ({ id: cal.id, isVisible: true }))
}

/** Why connecting failed, in terms the person at the keyboard can act on. */
export type ConnectProblem =
  | 'auth'
  | 'clientRejected'
  | 'notFound'
  | 'unreachable'
  | 'certificate'
  | 'noCalendars'
  | 'keyring'
  | 'notConfigured'
  | 'cancelled'
  | 'unknown'

/**
 * Sort a connect failure into something to tell the user. The messages come
 * from the main process (fetch, the CalDAV adapter, the OAuth managers) and are
 * matched loosely on purpose: the raw text is still shown underneath, so an
 * unrecognised one degrades to "here is what the server said".
 */
export function classifyConnectError(message: string | undefined): ConnectProblem {
  const text = (message ?? '').toLowerCase()
  if (!text) return 'unknown'
  if (text.includes('no calendars found')) return 'noCalendars'
  if (text.includes("isn't configured") || text.includes('not configured')) return 'notConfigured'
  // Before the 401 check below: `unauthorized_client` is the client, not the user.
  if (text.includes('invalid_client') || text.includes('unauthorized_client')) return 'clientRejected'
  if (text.includes('keyring') || text.includes('safestorage') || text.includes('encryption is unavailable')) return 'keyring'
  if (/\b401\b/.test(text) || text.includes('unauthorized') || text.includes('invalid_grant') || text.includes('authentication failed')) return 'auth'
  if (text.includes('cancel') || text.includes('denied') || text.includes('access_denied')) return 'cancelled'
  if (text.includes('certificate') || text.includes('cert_') || text.includes('self-signed') || text.includes('self signed')) return 'certificate'
  if (text.includes('enotfound') || text.includes('getaddrinfo') || text.includes('could not resolve') || text.includes('invalid url')) return 'notFound'
  if (
    text.includes('econnrefused') ||
    text.includes('timed out') ||
    text.includes('timeout') ||
    text.includes('fetch failed') ||
    text.includes('network') ||
    text.includes('econnreset') ||
    text.includes('ehostunreach')
  ) return 'unreachable'
  return 'unknown'
}

/** Why an account's last sync failed, in terms a person can act on. */
export type SyncProblem = 'auth' | 'notFound' | 'unreachable' | 'certificate' | 'keyring' | 'server' | 'unknown'

const SYNC_PROBLEMS: ReadonlySet<ConnectProblem> = new Set(['auth', 'notFound', 'unreachable', 'certificate', 'keyring'])

/**
 * The connect classifier, narrowed to what can go wrong once connected, plus
 * the server failing (a 5xx) - which a person can only wait out, unlike a
 * refused password.
 */
export function classifySyncError(message: string | undefined): SyncProblem {
  if (/\bhttp 5\d\d\b/i.test(message ?? '')) return 'server'
  const problem = classifyConnectError(message)
  // Details changed after the account signed in: signing in again is the answer.
  if (problem === 'clientRejected') return 'auth'
  return SYNC_PROBLEMS.has(problem) ? (problem as SyncProblem) : 'unknown'
}

/** `https://` added when a bare host was typed - what the main process does too. */
export function normaliseServerInput(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
}

/** The host an address points at, or '' while it is not a URL yet - for the default account name. */
export function hostOf(raw: string): string {
  try {
    return new URL(normaliseServerInput(raw)).hostname
  } catch {
    return ''
  }
}
