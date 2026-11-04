import { createHash } from 'node:crypto'
import type { AccountsRepo } from '../db/repos/accounts-repo'
import type { CalDavCredentials } from './caldav-adapter'

export interface CalDavAccountIdentity {
  /** The account to store the sign-in under. */
  accountId: string
  /** Calendars found at this account's home that another CalDAV account holds,
   *  to be handed back to this one. */
  takeOver: string[]
}

/** A new CalDAV account's id: one per user per calendar home. */
export function newCalDavAccountId(homeUrl: string, username: string): string {
  const digest = createHash('sha256').update(`${homeUrl}\n${username}`).digest('hex')
  return `acc_caldav_${digest.slice(0, 16)}`
}

/**
 * Which account a CalDAV sign-in belongs to.
 *
 * The id used to be the first five bytes of the typed URL in hex - "https" -
 * so every account on an https server was `acc_caldav_6874747073`: connecting a
 * second one replaced the first one's password and put both users' calendars
 * under one account, each then synced with the other's sign-in.
 *
 * An account connected again keeps its id, old style or new: the account
 * already signed in as this user on this server, else the one holding the
 * calendars just found - unless that one is signed in as somebody else, which
 * is that collision, and then this user gets an account of their own. Every
 * calendar listed at this home is this user's, so any of them another account
 * holds is handed back.
 *
 * A saved sign-in is compared by username and server, not by URL: one saved
 * by an older build may hold the address as typed rather than the calendar
 * home it led to, and taking that for another user would give the same
 * calendars two accounts.
 */
export function resolveCalDavAccount(
  found: { homeUrl: string; username: string; calendarIds: readonly string[] },
  accounts: AccountsRepo,
  savedSignIn: (accountId: string) => CalDavCredentials | null
): CalDavAccountIdentity {
  const { homeUrl, username, calendarIds } = found
  const server = originOf(homeUrl)

  const signedIn = accounts.list().find((account) => {
    if (account.type !== 'caldav') return false
    const creds = savedSignIn(account.id)
    return creds !== null && creds.username === username && originOf(creds.url) === server
  })?.id

  const holders = accounts.calDavHolders(calendarIds)
  const holder = [...holders.values()].find((accountId) => {
    // No readable sign-in (disconnected, or the keyring is locked) is no
    // evidence of another user; the calendars' own URLs already name the server.
    const creds = savedSignIn(accountId)
    return creds === null || creds.username === username
  })

  const accountId = signedIn ?? holder ?? newCalDavAccountId(homeUrl, username)
  const takeOver = calendarIds.filter((calendarId) => {
    const current = holders.get(calendarId)
    return current !== undefined && current !== accountId
  })
  return { accountId, takeOver }
}

function originOf(url: string): string {
  try {
    return new URL(url).origin
  } catch {
    return url
  }
}
