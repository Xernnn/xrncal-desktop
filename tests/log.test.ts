import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { formatLogLine, initLog, log, logFilePath, MAX_LOG_BYTES, redactSecrets } from '../src/main/log'
import { accountErrorChanges } from '../src/main/sync/sync-worker'

describe('redactSecrets', () => {
  it('removes a password written into a URL', () => {
    expect(redactSecrets('PROPFIND https://sonn:hunter2@example.com/dav/ failed')).toBe(
      'PROPFIND https://***@example.com/dav/ failed'
    )
  })

  it('removes bearer tokens and Authorization headers', () => {
    expect(redactSecrets('sent Bearer ya29.a0AfH6SMBx-abc_123')).toBe('sent Bearer ***')
    expect(redactSecrets('{"Authorization": "Basic c29ubjpodW50ZXIy"}')).toBe('{"Authorization": "***"}')
  })

  it('removes token, secret and password fields in JSON, forms and queries', () => {
    expect(redactSecrets('Token exchange failed: {"access_token":"ya29.x","refresh_token":"1//0g"}')).toBe(
      'Token exchange failed: {"access_token":"***","refresh_token":"***"}'
    )
    expect(redactSecrets('client_id=abc&client_secret=GOCSPX-xyz&code_verifier=v1')).toBe(
      'client_id=abc&client_secret=***&code_verifier=***'
    )
    expect(redactSecrets('password: hunter2')).toBe('password: ***')
  })

  it('leaves ordinary errors alone, status codes included', () => {
    const text = 'HTTP 401 Unauthorized: {"error":{"code":401,"message":"Invalid Credentials"}}'
    expect(redactSecrets(text)).toBe(text)
    expect(redactSecrets('fetch failed: connect ECONNREFUSED 100.101.102.103:443')).toBe(
      'fetch failed: connect ECONNREFUSED 100.101.102.103:443'
    )
  })
})

describe('formatLogLine', () => {
  it('writes one line per entry, with time and level', () => {
    const line = formatLogLine('warn', 'first\n  second\r\nthird', new Date('2026-11-03T08:00:00Z'))
    expect(line).toBe('2026-11-03T08:00:00.000Z WARN  first | second | third\n')
  })
})

describe('log file', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'xrncal-log-'))
    initLog(join(dir, 'logs'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('appends to xrncal.log in the folder it was given', () => {
    log('info', 'one')
    log('error', 'two')

    const text = readFileSync(logFilePath()!, 'utf8')
    expect(logFilePath()).toBe(join(dir, 'logs', 'xrncal.log'))
    expect(text.trim().split('\n')).toHaveLength(2)
    expect(text).toMatch(/INFO {2}one\n.*ERROR two\n$/)
  })

  it.skipIf(process.platform === 'win32')('is readable by its owner only', () => {
    log('info', 'private')
    expect(statSync(logFilePath()!).mode & 0o777).toBe(0o600)
  })

  it('moves a full log aside and starts a new one, keeping two at most', () => {
    writeFileSync(logFilePath()!, 'x'.repeat(MAX_LOG_BYTES + 1))
    log('info', 'after rotation')

    expect(readFileSync(logFilePath()!, 'utf8')).toMatch(/INFO {2}after rotation\n$/)
    expect(statSync(join(dir, 'logs', 'xrncal.old.log')).size).toBe(MAX_LOG_BYTES + 1)
  })

  it('never throws, even when the folder is gone', () => {
    rmSync(join(dir, 'logs'), { recursive: true, force: true })
    expect(() => log('info', 'nowhere to go')).not.toThrow()
    expect(existsSync(logFilePath()!)).toBe(false)
  })
})

describe('sync failures in the log', () => {
  it('logs a failure when it starts and when it changes, not on every poll', () => {
    expect(accountErrorChanges({}, { acc_a: 'offline' })).toEqual([
      { level: 'warn', message: 'Sync: acc_a failed: offline' }
    ])
    expect(accountErrorChanges({ acc_a: 'offline' }, { acc_a: 'offline' })).toEqual([])
    expect(accountErrorChanges({ acc_a: 'offline' }, { acc_a: 'HTTP 401' })).toEqual([
      { level: 'warn', message: 'Sync: acc_a failed: HTTP 401' }
    ])
  })

  it('logs the recovery', () => {
    expect(accountErrorChanges({ acc_a: 'offline' }, {})).toEqual([
      { level: 'info', message: 'Sync: acc_a no longer failing' }
    ])
  })
})
