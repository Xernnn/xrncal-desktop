import type { CalendarAccount } from '@shared/event-model'
import type { ISqliteDatabase } from '../sqlite-driver'

type AccountType = CalendarAccount['type']

interface AccountRow {
  id: string
  type: AccountType
  name: string
  email: string | null
  is_active: number
  created_at: string
  updated_at: string
}

export interface AccountUpsert {
  id: string
  type: AccountType
  name: string
  email?: string
}

function toAccount(row: AccountRow): CalendarAccount {
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    email: row.email ?? undefined,
    isActive: row.is_active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

/** The `accounts` table. Removing an account is `detachAccount()`, which has
 *  to re-home its calendars first (the foreign key cascades). */
export class AccountsRepo {
  constructor(private db: ISqliteDatabase) {}

  list(): CalendarAccount[] {
    return this.db.prepare('SELECT * FROM accounts ORDER BY created_at, id').all<AccountRow>().map(toAccount)
  }

  /** Connected accounts, of one provider when `type` is given. */
  listActive(type?: AccountType): CalendarAccount[] {
    const rows = type
      ? this.db.prepare('SELECT * FROM accounts WHERE is_active = 1 AND type = ? ORDER BY created_at, id').all<AccountRow>(type)
      : this.db.prepare('SELECT * FROM accounts WHERE is_active = 1 ORDER BY created_at, id').all<AccountRow>()
    return rows.map(toAccount)
  }

  get(id: string): CalendarAccount | undefined {
    const row = this.db.prepare('SELECT * FROM accounts WHERE id = ?').get<AccountRow>(id)
    return row ? toAccount(row) : undefined
  }

  /** Add the account, or refresh its name and address and mark it connected
   *  again; a reconnect keeps when it was first added. */
  upsert(input: AccountUpsert, now = new Date().toISOString()): CalendarAccount {
    this.db
      .prepare(
        `INSERT INTO accounts (id, type, name, email, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, email = excluded.email, is_active = 1, updated_at = excluded.updated_at`
      )
      .run(input.id, input.type, input.name, input.email ?? null, now, now)
    return this.get(input.id)!
  }

  /** Stop syncing the account; its calendars stay where they are. */
  deactivate(id: string, now = new Date().toISOString()): void {
    this.db.prepare('UPDATE accounts SET is_active = 0, updated_at = ? WHERE id = ?').run(now, id)
  }

  /** Which CalDAV account holds each of these calendars, for those one does
   *  (a CalDAV calendar's id is its absolute URL). */
  calDavHolders(calendarIds: readonly string[]): Map<string, string> {
    const query = this.db.prepare(
      `SELECT a.id FROM calendars c JOIN accounts a ON a.id = c.account_id
       WHERE c.id = ? AND a.type = 'caldav'`
    )
    const holders = new Map<string, string>()
    for (const calendarId of calendarIds) {
      const row = query.get<{ id: string }>(calendarId)
      if (row) holders.set(calendarId, row.id)
    }
    return holders
  }

  /** Hand calendars to another account, events and sync state included (both
   *  hang off the calendar's id, which does not change). */
  moveCalendars(calendarIds: readonly string[], toAccountId: string, now = new Date().toISOString()): void {
    const move = this.db.prepare('UPDATE calendars SET account_id = ?, updated_at = ? WHERE id = ?')
    this.db.transaction(() => {
      for (const calendarId of calendarIds) move.run(toAccountId, now, calendarId)
    })()
  }
}
