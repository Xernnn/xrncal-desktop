import { describe, it, expect, vi, afterAll } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'

/**
 * A shared event was written to the temp directory itself - /tmp on Linux,
 * shared by every account - at a guessable name, readable by all of them.
 */

const temp = mkdtempSync(join(tmpdir(), 'share-ics-test-'))

vi.mock('electron', async () => {
  const stub = await vi.importActual<Record<string, unknown>>('./stubs/electron')
  return { ...stub, app: { ...(stub.app as object), getPath: () => temp } }
})

const { writeSharedIcs } = await import('../src/main/share-ics-file')

describe('writeSharedIcs', () => {
  afterAll(() => rmSync(temp, { recursive: true, force: true }))

  it('writes into a folder of its own, not the shared temp directory', () => {
    const path = writeSharedIcs('Design review', 'BEGIN:VCALENDAR')
    expect(dirname(dirname(path))).toBe(temp)
    expect(basename(dirname(path))).toMatch(/^xrncal-share-/)
    expect(readFileSync(path, 'utf-8')).toBe('BEGIN:VCALENDAR')
    if (process.platform !== 'win32') {
      expect(statSync(dirname(path)).mode & 0o777).toBe(0o700)
      expect(statSync(path).mode & 0o777).toBe(0o600)
    }
  })

  it('keeps one folder for the run, and a title cannot leave it', () => {
    const first = writeSharedIcs('One', 'x')
    const second = writeSharedIcs('../../etc/passwd', 'x')
    expect(dirname(second)).toBe(dirname(first))
    expect(basename(second)).toBe('______etc_passwd.ics')
    expect(basename(writeSharedIcs('', 'x'))).toBe('event.ics')
  })
})
