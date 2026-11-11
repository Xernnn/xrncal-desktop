import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDatabase, getDatabase } from '../src/main/db/database'
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
