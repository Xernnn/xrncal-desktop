import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDatabase, getDatabase, NewerDatabaseError, runMigrations, SCHEMA_VERSION } from '../src/main/db/database'
import { createSqliteDriver } from '../src/main/db/sqlite-driver'
import { initLog, logFilePath } from '../src/main/log'
import { openDatabaseOrQuit, type StartupFailureUi } from '../src/main/startup-database'

/**
 * A database that will not open used to be logged and nothing more: the IPC
 * handlers, which read it as they are registered, threw next, so no window was
 * ever built and the process held the single-instance lock with nothing on
 * screen. Startup now tells the user, names the log, and ends.
 *
 * What this cannot cover: that index.ts calls it before registering any
 * handler, and Electron's own dialog and exit - those need a real launch,
 * which would put a dialog on the desktop.
 */

let dir: string

function fakeUi(): StartupFailureUi & { boxes: { title: string; content: string }[]; exits: number[] } {
  const boxes: { title: string; content: string }[] = []
  const exits: number[] = []
  return {
    boxes,
    exits,
    showErrorBox: (title, content) => boxes.push({ title, content }),
    exit: (code) => exits.push(code)
  }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'xrncal-startup-'))
  initLog(join(dir, 'logs'))
})

afterEach(() => {
  closeDatabase()
  rmSync(dir, { recursive: true, force: true })
})

describe('opening the database at startup', () => {
  it('shows what failed and where the log is, then exits, when the file is not a database', () => {
    writeFileSync(join(dir, 'xrncal.sqlite'), 'this is not an SQLite file, it only has its name'.repeat(100))
    const ui = fakeUi()

    expect(openDatabaseOrQuit(dir, ui)).toBeNull()

    expect(ui.boxes).toHaveLength(1)
    expect(ui.boxes[0].content).toContain(join(dir, 'xrncal.sqlite'))
    expect(ui.boxes[0].content).toContain(logFilePath()!)
    expect(ui.exits).toEqual([1])
    expect(readFileSync(logFilePath()!, 'utf8')).toMatch(/ERROR .*database could not be opened/)
  })

  it('opens a good profile without a word', () => {
    const ui = fakeUi()

    const db = openDatabaseOrQuit(dir, ui)

    expect(db).not.toBeNull()
    expect(getDatabase()).toBe(db)
    expect(ui.boxes).toEqual([])
    expect(ui.exits).toEqual([])
  })
})

describe('a database a newer xrncal has used', () => {
  /** A profile whose database a build one migration ahead has opened. */
  function newerProfile(): string {
    const path = join(dir, 'xrncal.sqlite')
    const db = createSqliteDriver(path)
    runMigrations(db)
    db.prepare("INSERT INTO accounts (id, type, name, created_at, updated_at) VALUES ('acc_mine', 'local', 'Mine', '', '')").run()
    db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(SCHEMA_VERSION + 1, '')
    db.close()
    return path
  }

  it('is not migrated or written to', () => {
    const db = createSqliteDriver(newerProfile())
    const before = db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get<{ n: number }>()!.n

    expect(() => runMigrations(db)).toThrow(NewerDatabaseError)
    expect(db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get<{ n: number }>()!.n).toBe(before)
    db.close()
  })

  it('is refused at startup with a box that says so, and left closed and as it was', () => {
    const path = newerProfile()
    const ui = fakeUi()

    expect(openDatabaseOrQuit(dir, ui)).toBeNull()

    expect(ui.boxes).toHaveLength(1)
    expect(ui.boxes[0].content).toContain('newer version of xrncal')
    expect(ui.boxes[0].content).toContain(`data version ${SCHEMA_VERSION + 1}`)
    expect(ui.boxes[0].content).toContain(logFilePath()!)
    expect(ui.exits).toEqual([1])
    expect(() => getDatabase()).toThrow()

    // Untouched: not seeded with a default calendar, no migration recorded.
    const db = createSqliteDriver(path)
    expect(db.prepare('SELECT id FROM accounts').all<{ id: string }>().map((r) => r.id)).toEqual(['acc_mine'])
    expect(db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get<{ v: number }>()!.v).toBe(SCHEMA_VERSION + 1)
    db.close()
  })
})
