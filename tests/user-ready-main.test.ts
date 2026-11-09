import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSqliteDriver } from '../src/main/db/sqlite-driver'
import { closeDatabase, initDatabase, runMigrations, SCHEMA_VERSION } from '../src/main/db/database'
import { SettingsRepo, setSystemDefaults } from '../src/main/db/repos/settings-repo'
import { EventsRepo } from '../src/main/db/repos/events-repo'
import { beforeRestoreFileName, checkBackup } from '../src/main/db/backup'
import { linuxAutostartEntry, START_HIDDEN_ARG } from '../src/main/launch-at-login'
import { icsPathsIn, queueOpenedFiles, setOpenedFileNotifier, takeOpenedFiles } from '../src/main/opened-ics-files'
import { settleExistingProfile } from '../src/main/first-run'

describe('settings that follow the computer', () => {
  afterEach(() => setSystemDefaults({}))

  it('uses the computer’s defaults until the user picks something', () => {
    const repo = new SettingsRepo(initDatabase(':memory:'))
    setSystemDefaults({ locale: 'vi', timeFormat: '12h', firstDayOfWeek: 0 })
    expect(repo.getAllSettings()).toMatchObject({ locale: 'vi', timeFormat: '12h', firstDayOfWeek: 0 })
    expect(repo.getSetting('firstDayOfWeek')).toBe(0)

    repo.setSetting('timeFormat', '24h')
    expect(repo.getSetting('timeFormat')).toBe('24h')
    expect(repo.hasSetting('timeFormat')).toBe(true)
    expect(repo.hasSetting('locale')).toBe(false)
    closeDatabase()
  })

  it('keeps one-time flags out of the settings the renderer reads', () => {
    const repo = new SettingsRepo(initDatabase(':memory:'))
    expect(repo.getFlag('trayNotice')).toBe(false)
    repo.setFlag('trayNotice')
    repo.setFlag('trayNotice')
    expect(repo.getFlag('trayNotice')).toBe(true)
    expect(Object.keys(repo.getAllSettings()).some((k) => k.startsWith('flag:'))).toBe(false)
    closeDatabase()
  })
})

describe('the first-run welcome', () => {
  afterEach(() => closeDatabase())

  it('is for a new profile', () => {
    const db = initDatabase(':memory:')
    settleExistingProfile(db)
    expect(new SettingsRepo(db).getSetting('welcomeDone')).toBe(false)
  })

  it('is skipped for a profile that already has events, which keeps what it was showing', () => {
    const db = initDatabase(':memory:')
    const settings = new SettingsRepo(db)
    settings.setSetting('theme', 'light')
    new EventsRepo(db).createEvent({
      calendarId: 'calendar-local-default',
      title: 'Giỗ ông',
      dtStartUtc: '2026-10-20T00:00:00.000Z',
      dtEndUtc: '2026-10-20T23:59:59.999Z',
      allDay: true
    })
    // The computer now says 12-hour and Sunday; this user never chose either.
    setSystemDefaults({ timeFormat: '12h', firstDayOfWeek: 0, locale: 'vi' })
    settleExistingProfile(db)
    expect(settings.getAllSettings()).toMatchObject({
      welcomeDone: true,
      timeFormat: '24h',
      firstDayOfWeek: 1,
      locale: 'en',
      autoHideHeader: true,
      // Chosen before: left as chosen.
      theme: 'light'
    })
    setSystemDefaults({})
  })

  it('gives a new profile the computer’s defaults', () => {
    const db = initDatabase(':memory:')
    setSystemDefaults({ timeFormat: '12h' })
    settleExistingProfile(db)
    expect(new SettingsRepo(db).getAllSettings()).toMatchObject({ welcomeDone: false, timeFormat: '12h', theme: 'system' })
    setSystemDefaults({})
  })

  it('leaves a choice already made alone', () => {
    const db = initDatabase(':memory:')
    new SettingsRepo(db).setSetting('welcomeDone', false)
    new EventsRepo(db).createEvent({
      calendarId: 'calendar-local-default',
      title: 'x',
      dtStartUtc: '2026-10-20T01:00:00.000Z',
      dtEndUtc: '2026-10-20T02:00:00.000Z'
    })
    settleExistingProfile(db)
    expect(new SettingsRepo(db).getSetting('welcomeDone')).toBe(false)
  })
})

describe('restoring a backup', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'xrncal-restore-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('accepts an xrncal database from this or an older build', () => {
    const db = createSqliteDriver(join(dir, 'ok.sqlite'))
    runMigrations(db)
    expect(checkBackup(db, SCHEMA_VERSION)).toEqual({ ok: true, version: SCHEMA_VERSION })
    db.close()
  })

  it('refuses one from a newer build', () => {
    const db = createSqliteDriver(join(dir, 'newer.sqlite'))
    runMigrations(db)
    db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(SCHEMA_VERSION + 1, '')
    expect(checkBackup(db, SCHEMA_VERSION)).toEqual({ ok: false, problem: 'newer' })
    db.close()
  })

  it('refuses a database that is not xrncal’s', () => {
    const db = createSqliteDriver(join(dir, 'other.sqlite'))
    db.exec('CREATE TABLE notes (id INTEGER PRIMARY KEY)')
    expect(checkBackup(db, SCHEMA_VERSION)).toEqual({ ok: false, problem: 'notXrncal' })
    db.close()
  })

  it('cannot open a file that is not a database at all', () => {
    const path = join(dir, 'photo.sqlite')
    writeFileSync(path, 'this is not sqlite '.repeat(200))
    expect(() => checkBackup(createSqliteDriver(path), SCHEMA_VERSION)).toThrow()
  })

  it('names what it set aside', () => {
    expect(beforeRestoreFileName(new Date('2026-10-19T08:05:09.123Z'))).toBe(
      'xrncal-before-restore-2026-10-19T08-05-09.sqlite'
    )
  })
})

describe('starting at login on Linux', () => {
  it('starts the AppImage in the tray, with the path quoted for the desktop entry', () => {
    const entry = linuxAutostartEntry('/home/a "b"/Apps/xrncal.AppImage')
    expect(entry).toContain('[Desktop Entry]')
    expect(entry).toContain(
      `Exec=env NO_CLEANUP=1 "/home/a \\"b\\"/Apps/xrncal.AppImage" --appimage-extract-and-run --ozone-platform=x11 ${START_HIDDEN_ARG}`
    )
    expect(linuxAutostartEntry('/opt/$HOME`x`.AppImage')).toContain(
      'Exec=env NO_CLEANUP=1 "/opt/\\$HOME\\`x\\`.AppImage"'
    )
  })
})

describe('.ics files the OS opens xrncal with', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'xrncal-open-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('picks the calendar files out of a command line', () => {
    expect(icsPathsIn(['/usr/bin/xrncal', '--hidden', '/tmp/invite.ics', '/tmp/notes.txt', '/tmp/TRIP.ICS'])).toEqual([
      '/tmp/invite.ics',
      '/tmp/TRIP.ICS'
    ])
    // What a file manager passes through a desktop entry's %U.
    expect(icsPathsIn(['file:///home/a/My%20Invite.ics', 'https://example.com/x.ics'])).toEqual(['/home/a/My Invite.ics'])
  })

  it('holds them until the window collects them, and says when one arrives', () => {
    const file = join(dir, 'invite.ics')
    writeFileSync(file, 'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n')
    let told = 0
    setOpenedFileNotifier(() => told++)
    queueOpenedFiles([file, join(dir, 'missing.ics')])
    expect(told).toBe(1)
    expect(takeOpenedFiles()).toEqual([{ name: 'invite.ics', content: 'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n' }])
    expect(takeOpenedFiles()).toEqual([])
    queueOpenedFiles([join(dir, 'missing.ics')])
    expect(told).toBe(1)
  })
})
