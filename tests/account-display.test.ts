import { describe, it, expect } from 'vitest'
import type { Calendar, CalendarAccount } from '../src/shared/event-model'
import {
  canRemoveLocalCalendar,
  classifyConnectError,
  eventMoveTargets,
  classifySyncError,
  groupCalendars,
  hostOf,
  normaliseServerInput,
  providerKind,
  showAllChanges,
  showOnlyChanges,
  LOCAL_ACCOUNT_ID
} from '../src/renderer/src/lib/account-display'

const account = (id: string, type: CalendarAccount['type'], createdAt: string, extra: Partial<CalendarAccount> = {}): CalendarAccount => ({
  id,
  type,
  name: id,
  isActive: true,
  createdAt,
  updatedAt: createdAt,
  ...extra
})

const cal = (id: string, accountId: string, extra: Partial<Calendar> = {}): Calendar => ({
  id,
  accountId,
  name: id,
  color: '#7c9cbf',
  isVisible: true,
  isReadOnly: false,
  isDefault: false,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  ...extra
})

describe('groupCalendars', () => {
  const local = account(LOCAL_ACCOUNT_ID, 'local', '2026-01-01T00:00:00Z')
  const google = account('acc_google', 'google', '2026-03-01T00:00:00Z')
  const server = account('acc_caldav', 'caldav', '2026-02-01T00:00:00Z')

  it('puts this computer first, then accounts in the order they were added, then holidays', () => {
    const groups = groupCalendars(
      [google, server, local],
      [
        cal('Ngày lễ Việt Nam', LOCAL_ACCOUNT_ID, { isReadOnly: true, holidayType: 'vietnam' }),
        cal('Work', 'acc_google'),
        cal('Personal', 'acc_caldav'),
        cal('Notes', LOCAL_ACCOUNT_ID)
      ]
    )
    expect(groups.map((g) => [g.key, g.calendars.map((c) => c.name)])).toEqual([
      [LOCAL_ACCOUNT_ID, ['Notes']],
      ['acc_caldav', ['Personal']],
      ['acc_google', ['Work']],
      ['holidays', ['Ngày lễ Việt Nam']]
    ])
  })

  it('gives calendars subscribed to by link a group of their own, before holidays', () => {
    const groups = groupCalendars(
      [local],
      [
        cal('Ngày lễ Việt Nam', LOCAL_ACCOUNT_ID, { isReadOnly: true, holidayType: 'vietnam' }),
        cal('Fixtures', LOCAL_ACCOUNT_ID, { isReadOnly: true, subscriptionUrl: 'https://example.com/f.ics' }),
        cal('Notes', LOCAL_ACCOUNT_ID)
      ]
    )
    expect(groups.map((g) => [g.key, g.kind, g.calendars.map((c) => c.name)])).toEqual([
      [LOCAL_ACCOUNT_ID, 'local', ['Notes']],
      ['subscriptions', 'subscription', ['Fixtures']],
      ['holidays', 'holidays', ['Ngày lễ Việt Nam']]
    ])
  })

  it('keeps a calendar that is only named like a holiday calendar in its own account', () => {
    const groups = groupCalendars(
      [local, google],
      [cal('International Holidays', LOCAL_ACCOUNT_ID), cal('Ngày lễ Việt Nam', 'acc_google', { isReadOnly: true })]
    )
    expect(groups.map((g) => [g.key, g.calendars.map((c) => c.name)])).toEqual([
      [LOCAL_ACCOUNT_ID, ['International Holidays']],
      ['acc_google', ['Ngày lễ Việt Nam']]
    ])
  })

  it('leads each group with its default calendar, then sorts by name', () => {
    const [group] = groupCalendars(
      [google],
      [cal('Zebra', 'acc_google'), cal('Alpha', 'acc_google'), cal('Main', 'acc_google', { isDefault: true })]
    )
    expect(group.calendars.map((c) => c.name)).toEqual(['Main', 'Alpha', 'Zebra'])
  })

  it('keeps an account that has no calendars yet, for the dialog to list while it syncs', () => {
    const groups = groupCalendars([local, server], [cal('Notes', LOCAL_ACCOUNT_ID)])
    expect(groups.find((g) => g.key === 'acc_caldav')?.calendars).toEqual([])
  })

  it('files a calendar whose account is gone under this computer rather than losing it', () => {
    const groups = groupCalendars([local], [cal('Stray', 'acc_deleted')])
    expect(groups[0].calendars.map((c) => c.name)).toEqual(['Stray'])
  })

  it('calls an iCloud CalDAV account iCloud', () => {
    expect(providerKind(account('a', 'caldav', 'x', { name: 'iCloud' }))).toBe('icloud')
    expect(providerKind(account('a', 'caldav', 'x', { name: 'homeserver.ts.net' }))).toBe('caldav')
  })
})

describe('show only / show all', () => {
  const cals = [cal('a', 'x'), cal('b', 'x', { isVisible: false }), cal('c', 'x')]

  it('hides the others and shows the chosen one, writing only what changes', () => {
    expect(showOnlyChanges(cals, 'b')).toEqual([
      { id: 'a', isVisible: false },
      { id: 'b', isVisible: true },
      { id: 'c', isVisible: false }
    ])
    expect(showOnlyChanges(cals, 'a')).toEqual([{ id: 'c', isVisible: false }])
  })

  it('turns every hidden calendar back on', () => {
    expect(showAllChanges(cals)).toEqual([{ id: 'b', isVisible: true }])
  })
})

describe('classifyConnectError', () => {
  it.each([
    ['CalDAV discovery failed with HTTP 401: Unauthorized', 'auth'],
    ['No calendars found at https://dav.example.com', 'noCalendars'],
    ['getaddrinfo ENOTFOUND dav.example.com', 'notFound'],
    ['Request to https://dav.example.com timed out after 30000ms', 'unreachable'],
    ['fetch failed', 'unreachable'],
    ['connect ECONNREFUSED 127.0.0.1:5232', 'unreachable'],
    ['unable to verify the first certificate', 'certificate'],
    ['OS Keyring encryption is unavailable. Cannot store credentials securely.', 'keyring'],
    ["Google sign-in isn't configured. Create a Google OAuth client", 'notConfigured'],
    ['The user denied access', 'cancelled'],
    ['Something odd', 'unknown'],
    [undefined, 'unknown']
  ])('%s -> %s', (message, expected) => {
    expect(classifyConnectError(message)).toBe(expected)
  })
})

describe('server address input', () => {
  it('adds https:// to a bare host and leaves full addresses alone', () => {
    expect(normaliseServerInput(' cloud.example.com ')).toBe('https://cloud.example.com')
    expect(normaliseServerInput('http://192.168.1.5:5232/')).toBe('http://192.168.1.5:5232/')
    expect(normaliseServerInput('')).toBe('')
  })

  it('reads the host for the default account name', () => {
    expect(hostOf('homeserver.example.ts.net/')).toBe('homeserver.example.ts.net')
    expect(hostOf('not a url at all')).toBe('')
  })
})

describe('classifySyncError', () => {
  it('says why an account stopped syncing', () => {
    expect(classifySyncError('fetch failed: getaddrinfo ENOTFOUND homeserver.example.ts.net')).toBe('notFound')
    expect(classifySyncError('fetch failed: connect ECONNREFUSED 100.101.102.103:443')).toBe('unreachable')
    expect(classifySyncError('Request timed out after 30000ms: https://dav.example/')).toBe('unreachable')
    expect(classifySyncError('CalDAV discovery failed with HTTP 401: Unauthorized')).toBe('auth')
    expect(classifySyncError('Token refresh failed: invalid_grant')).toBe('auth')
    expect(classifySyncError('CalDAV event query failed with HTTP 503: Service Unavailable')).toBe('server')
    expect(classifySyncError('fetch failed: self-signed certificate')).toBe('certificate')
    expect(classifySyncError('The saved password could not be read: the system keyring is locked or unavailable')).toBe('keyring')
  })

  it('blames the sign-in details when connecting, and asks for a new sign-in once connected', () => {
    const refused = 'Token exchange failed: {"error":"unauthorized_client"}'
    expect(classifyConnectError(refused)).toBe('clientRejected')
    expect(classifyConnectError('Token exchange failed: {"error":"invalid_client"}')).toBe('clientRejected')
    expect(classifySyncError(refused)).toBe('auth')
  })

  it('has no connect-only answers', () => {
    expect(classifySyncError('No calendars found')).toBe('unknown')
    expect(classifySyncError('Sign-in was cancelled')).toBe('unknown')
    expect(classifySyncError(undefined)).toBe('unknown')
  })
})

describe('removing a calendar on this computer', () => {
  const local = account(LOCAL_ACCOUNT_ID, 'local', '2026-01-01T00:00:00Z')
  const server = account('acc_caldav', 'caldav', '2026-02-01T00:00:00Z')
  const google = account('acc_google', 'google', '2026-03-01T00:00:00Z')
  const personal = cal('calendar-local-default', LOCAL_ACCOUNT_ID, { name: 'Personal Calendar', isDefault: true })
  const holidays = cal('cal_holidays', LOCAL_ACCOUNT_ID, { isReadOnly: true, holidayType: 'vietnam' })
  const feed = cal('cal_feed', LOCAL_ACCOUNT_ID, { isReadOnly: true, subscriptionUrl: 'https://example.com/team.ics' })

  it('is offered for the default calendar too, while another calendar can be written to', () => {
    // It used to be offered for every calendar here but the default.
    expect(canRemoveLocalCalendar(personal, [personal, cal('cal_trips', LOCAL_ACCOUNT_ID)])).toBe(true)
    expect(canRemoveLocalCalendar(personal, [personal, cal('https://dav.example.com/alex/work/', server.id)])).toBe(true)
  })

  it('is not offered for the last calendar new events could go into', () => {
    const readOnly = cal('https://dav.example.com/alex/shared/', server.id, { isReadOnly: true })
    expect(canRemoveLocalCalendar(personal, [personal, holidays, feed, readOnly])).toBe(false)
  })

  it("offers the events every other writable calendar, in the sidebar's order, starting with the one the default moves to", () => {
    const work = cal('https://dav.example.com/alex/work/', server.id, { name: 'Work' })
    const family = cal('https://dav.example.com/alex/family/', server.id, { name: 'Family', isVisible: false })
    const shared = cal('https://dav.example.com/alex/shared/', server.id, { name: 'Alpha', isReadOnly: true })
    const primary = cal('alex@example.com', google.id, { name: 'alex@example.com' })
    const trips = cal('cal_trips', LOCAL_ACCOUNT_ID, { name: 'Trips' })
    const calendars = [personal, trips, holidays, feed, work, family, shared, primary]

    const { groups, preferred } = eventMoveTargets(personal, [local, server, google], calendars)

    expect(groups.map((g) => [g.key, g.calendars.map((c) => c.id)])).toEqual([
      [LOCAL_ACCOUNT_ID, ['cal_trips']],
      [server.id, [family.id, work.id]],
      [google.id, [primary.id]]
    ])
    // The first shown account calendar: what the main process makes the default.
    expect(preferred?.id).toBe(work.id)
    // A default that stays is where new events keep going.
    expect(eventMoveTargets(trips, [local, server, google], calendars.map((c) => (c.id === primary.id ? { ...c, isDefault: true } : { ...c, isDefault: false }))).preferred?.id).toBe(primary.id)
  })
})
