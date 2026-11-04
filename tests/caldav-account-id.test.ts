import { describe, it, expect, beforeEach } from 'vitest'
import { createSqliteDriver, type ISqliteDatabase } from '../src/main/db/sqlite-driver'
import { runMigrations, seedDefaultData } from '../src/main/db/database'
import { AccountsRepo } from '../src/main/db/repos/accounts-repo'
import { newCalDavAccountId, resolveCalDavAccount } from '../src/main/sync/caldav-account-id'
import type { CalDavCredentials } from '../src/main/sync/caldav-adapter'

/**
 * A CalDAV account's id was the first five bytes of its URL in hex - "https" -
 * so every account on an https server was `acc_caldav_6874747073`, and adding
 * a second replaced the first one's password.
 */

const LEGACY_ID = 'acc_caldav_6874747073'
const ALICE_HOME = 'https://dav.example/alice/'
const BOB_HOME = 'https://dav.example/bob/'
const ALICE_CALS = ['https://dav.example/alice/personal/', 'https://dav.example/alice/work/']
const BOB_CALS = ['https://dav.example/bob/personal/']

const signIn = (url: string, username: string): CalDavCredentials => ({ url, username, password: 'pw' })

describe('CalDAV account ids', () => {
  let db: ISqliteDatabase
  let accounts: AccountsRepo
  let saved: Map<string, CalDavCredentials>
  const savedSignIn = (id: string): CalDavCredentials | null => saved.get(id) ?? null

  function addAccount(id: string, calendarIds: string[]): void {
    accounts.upsert({ id, type: 'caldav', name: 'Home server', email: 'x' })
    const now = new Date().toISOString()
    for (const calendarId of calendarIds) {
      db.prepare(
        `INSERT INTO calendars (id, account_id, name, color, is_visible, is_read_only, is_default, created_at, updated_at)
         VALUES (?, ?, 'Cal', '#000000', 1, 0, 0, ?, ?)`
      ).run(calendarId, id, now, now)
    }
  }

  beforeEach(() => {
    db = createSqliteDriver(':memory:')
    runMigrations(db)
    seedDefaultData(db)
    accounts = new AccountsRepo(db)
    saved = new Map()
  })

  it('gives two users of one https server two accounts', () => {
    const alice = resolveCalDavAccount({ homeUrl: ALICE_HOME, username: 'alice', calendarIds: ALICE_CALS }, accounts, savedSignIn)
    const bob = resolveCalDavAccount({ homeUrl: BOB_HOME, username: 'bob', calendarIds: BOB_CALS }, accounts, savedSignIn)

    expect(alice.accountId).toMatch(/^acc_caldav_[0-9a-f]{16}$/)
    expect(bob.accountId).toMatch(/^acc_caldav_[0-9a-f]{16}$/)
    expect(alice.accountId).not.toBe(bob.accountId)
    expect(alice.accountId).not.toBe(LEGACY_ID)
    expect(alice.takeOver).toEqual([])
  })

  it('finds the same account each time it is connected', () => {
    expect(newCalDavAccountId(ALICE_HOME, 'alice')).toBe(newCalDavAccountId(ALICE_HOME, 'alice'))
    addAccount(newCalDavAccountId(ALICE_HOME, 'alice'), ALICE_CALS)
    saved.set(newCalDavAccountId(ALICE_HOME, 'alice'), signIn(ALICE_HOME, 'alice'))

    const again = resolveCalDavAccount({ homeUrl: ALICE_HOME, username: 'alice', calendarIds: ALICE_CALS }, accounts, savedSignIn)
    expect(again).toEqual({ accountId: newCalDavAccountId(ALICE_HOME, 'alice'), takeOver: [] })
  })

  it('keeps an account connected under the old id', () => {
    addAccount(LEGACY_ID, ALICE_CALS)
    saved.set(LEGACY_ID, signIn(ALICE_HOME, 'alice'))

    const again = resolveCalDavAccount({ homeUrl: ALICE_HOME, username: 'alice', calendarIds: ALICE_CALS }, accounts, savedSignIn)
    expect(again).toEqual({ accountId: LEGACY_ID, takeOver: [] })
  })

  it('knows the old account by its username and server when it saved the address as typed', () => {
    addAccount(LEGACY_ID, ALICE_CALS)
    saved.set(LEGACY_ID, signIn('https://dav.example/', 'alice'))

    const again = resolveCalDavAccount({ homeUrl: ALICE_HOME, username: 'alice', calendarIds: ALICE_CALS }, accounts, savedSignIn)
    expect(again.accountId).toBe(LEGACY_ID)
  })

  it('knows the account by its calendars when its sign-in cannot be read', () => {
    // Disconnected (the token is deleted) or the keyring is locked.
    addAccount(LEGACY_ID, ALICE_CALS)

    const again = resolveCalDavAccount({ homeUrl: ALICE_HOME, username: 'alice', calendarIds: ALICE_CALS }, accounts, savedSignIn)
    expect(again).toEqual({ accountId: LEGACY_ID, takeOver: [] })
  })

  it('does not take a same-named user on another server for this one', () => {
    addAccount(LEGACY_ID, ['https://other.example/alice/personal/'])
    saved.set(LEGACY_ID, signIn('https://other.example/alice/', 'alice'))

    const here = resolveCalDavAccount({ homeUrl: ALICE_HOME, username: 'alice', calendarIds: ALICE_CALS }, accounts, savedSignIn)
    expect(here.accountId).not.toBe(LEGACY_ID)
  })

  it('separates two users who were connected under the one old id', () => {
    // Alice connected, then Bob: Bob's password replaced hers, and both users'
    // calendars sat under the one account.
    addAccount(LEGACY_ID, [...ALICE_CALS, ...BOB_CALS])
    saved.set(LEGACY_ID, signIn(BOB_HOME, 'bob'))

    const alice = resolveCalDavAccount({ homeUrl: ALICE_HOME, username: 'alice', calendarIds: ALICE_CALS }, accounts, savedSignIn)
    expect(alice.accountId).toBe(newCalDavAccountId(ALICE_HOME, 'alice'))
    expect(alice.takeOver).toEqual(ALICE_CALS)

    accounts.upsert({ id: alice.accountId, type: 'caldav', name: 'Alice', email: 'alice' })
    accounts.moveCalendars(alice.takeOver, alice.accountId)
    saved.set(alice.accountId, signIn(ALICE_HOME, 'alice'))

    const bob = resolveCalDavAccount({ homeUrl: BOB_HOME, username: 'bob', calendarIds: BOB_CALS }, accounts, savedSignIn)
    expect(bob).toEqual({ accountId: LEGACY_ID, takeOver: [] })
    expect(accounts.calDavHolders([...ALICE_CALS, ...BOB_CALS])).toEqual(
      new Map([
        [ALICE_CALS[0], alice.accountId],
        [ALICE_CALS[1], alice.accountId],
        [BOB_CALS[0], LEGACY_ID]
      ])
    )
  })

  it('does not count a calendar the local account holds', () => {
    // Removed from xrncal but kept: the calendars are local now.
    const now = new Date().toISOString()
    db.prepare(
      `INSERT INTO calendars (id, account_id, name, color, is_visible, is_read_only, is_default, created_at, updated_at)
       VALUES (?, 'account-local-primary', 'Cal', '#000000', 1, 0, 0, ?, ?)`
    ).run(ALICE_CALS[0], now, now)

    expect(accounts.calDavHolders(ALICE_CALS).size).toBe(0)
    const fresh = resolveCalDavAccount({ homeUrl: ALICE_HOME, username: 'alice', calendarIds: ALICE_CALS }, accounts, savedSignIn)
    expect(fresh.takeOver).toEqual([])
  })
})

describe('AccountsRepo', () => {
  let db: ISqliteDatabase
  let accounts: AccountsRepo

  beforeEach(() => {
    db = createSqliteDriver(':memory:')
    runMigrations(db)
    seedDefaultData(db)
    accounts = new AccountsRepo(db)
  })

  it('keeps when an account was first added across a reconnect', () => {
    const first = accounts.upsert({ id: 'acc_google_1', type: 'google', name: 'Sonn', email: 'a@example.com' }, '2026-01-01T00:00:00.000Z')
    accounts.deactivate('acc_google_1', '2026-02-01T00:00:00.000Z')
    expect(accounts.get('acc_google_1')?.isActive).toBe(false)

    const again = accounts.upsert({ id: 'acc_google_1', type: 'google', name: 'Sonn N', email: 'b@example.com' }, '2026-03-01T00:00:00.000Z')
    expect(again).toEqual({
      ...first,
      name: 'Sonn N',
      email: 'b@example.com',
      isActive: true,
      updatedAt: '2026-03-01T00:00:00.000Z'
    })
  })

  it('lists connected accounts, of one provider when asked', () => {
    accounts.upsert({ id: 'acc_google_1', type: 'google', name: 'G' })
    accounts.upsert({ id: 'acc_graph_1', type: 'graph', name: 'M' })
    accounts.upsert({ id: 'acc_graph_2', type: 'graph', name: 'M2' })
    accounts.deactivate('acc_graph_2')

    expect(accounts.listActive('graph').map((a) => a.id)).toEqual(['acc_graph_1'])
    expect(accounts.listActive().map((a) => a.id)).toContain('acc_google_1')
    expect(accounts.listActive().map((a) => a.id)).not.toContain('acc_graph_2')
    expect(accounts.list().map((a) => a.id)).toContain('acc_graph_2')
    // No address reads back as none, not null.
    expect(accounts.get('acc_google_1')?.email).toBeUndefined()
  })
})
