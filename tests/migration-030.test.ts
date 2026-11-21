import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  addAccount,
  addCalDavAccount,
  addCalendar,
  addEvent,
  asOldBuildLeftIt,
  defaults,
  exists,
  tempProfile,
  DAV_ACCOUNT,
  DAV_WORK,
  LOCAL,
  LOCAL_ACCOUNT,
  type Db
} from './personal-calendar-fixtures'

/**
 * Profiles whose every calendar in use comes from an account kept the
 * "Personal Calendar" of their first start: hidden, empty, and still the
 * default. Migration 030 removes it once, and only that: never one that is
 * shown or holds an event, nor while no account calendar can take over.
 */

let profile: ReturnType<typeof tempProfile>
const start = () => profile.start()

beforeEach(() => {
  profile = tempProfile()
})

afterEach(() => profile.remove())

describe('migration 030: the unused Personal Calendar', () => {
  /** A profile the old build kept: the Personal Calendar as it is set here,
   *  next to an account's calendars, from before migration 030. */
  function oldProfile(personal: { visible: boolean; events: string[]; deletedEvents?: string[] }, account = addCalDavAccount): Db {
    start()
    asOldBuildLeftIt(profile.path, (db) => {
      db.prepare('UPDATE calendars SET is_visible = ?, is_default = 1 WHERE id = ?').run(personal.visible ? 1 : 0, LOCAL)
      for (const title of personal.events) addEvent(db, LOCAL, title)
      for (const title of personal.deletedEvents ?? []) addEvent(db, LOCAL, title, true)
      account(db)
      addEvent(db, DAV_WORK, 'Standup')
      db.prepare('DELETE FROM schema_migrations WHERE version >= 30').run()
    })
    return start()
  }

  it('removes it when it is hidden, holds no event and an account calendar can take over, and moves the default there', () => {
    const db = oldProfile({ visible: false, events: [], deletedEvents: ['Deleted long ago'] })

    expect(exists(db, LOCAL)).toBe(false)
    expect(defaults(db)).toEqual([DAV_WORK])
    expect(db.prepare('SELECT title, calendar_id FROM events').all()).toEqual([{ title: 'Standup', calendar_id: DAV_WORK }])
    // The account the app files its holidays and subscriptions under stays.
    expect(db.prepare('SELECT type FROM accounts WHERE id = ?').get(LOCAL_ACCOUNT)).toEqual({ type: 'local' })
  })

  it('keeps it when it holds an event', () => {
    const db = oldProfile({ visible: false, events: ['Dentist'] })

    expect(exists(db, LOCAL)).toBe(true)
    expect(db.prepare('SELECT title FROM events WHERE calendar_id = ?').all(LOCAL)).toEqual([{ title: 'Dentist' }])
    expect(defaults(db)).toEqual([DAV_WORK])
  })

  it('keeps it when it is shown', () => {
    const db = oldProfile({ visible: true, events: [] })

    expect(exists(db, LOCAL)).toBe(true)
    expect(defaults(db)).toEqual([DAV_WORK])
  })

  it('keeps it, as the default, when no account calendar can be written to', () => {
    const readOnlyAccount = (db: Db) => {
      addAccount(db, DAV_ACCOUNT, 'caldav', '2026-11-02T00:00:00.000Z')
      addCalendar(db, DAV_WORK, DAV_ACCOUNT, 'Work', { readOnly: true })
    }
    const db = oldProfile({ visible: false, events: [] }, readOnlyAccount)

    expect(exists(db, LOCAL)).toBe(true)
    expect(defaults(db)).toEqual([LOCAL])
  })

  it('runs once: a later start leaves a calendar hidden and emptied since', () => {
    let db = oldProfile({ visible: true, events: [] })
    db.prepare('UPDATE calendars SET is_visible = 0 WHERE id = ?').run(LOCAL)

    db = start()

    expect(exists(db, LOCAL)).toBe(true)
  })
})
