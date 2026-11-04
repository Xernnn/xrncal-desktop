import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * A small log file in the profile folder, for when something goes wrong in an
 * installed build: until it existed, a sync failure left one line in the
 * accounts dialog and nothing else, and errors such as a failed update check
 * went nowhere at all.
 *
 * What is written: startup, sync failures and recoveries per account, feed
 * refresh failures, automatic backups, update errors, crashed windows and
 * unhandled errors. Never event text, and never a secret - `redactSecrets()`
 * runs over every line as a second wall, but callers should not pass one.
 *
 * Writes are synchronous and few (a handful a day when things work), so a line
 * is on disk even if the process dies right after. Logging never throws.
 */

const LOG_FILE = 'xrncal.log'
const OLD_LOG_FILE = 'xrncal.old.log'
/** Past this, the log moves to xrncal.old.log and a new one starts: at most
 *  two files of this size are kept. */
export const MAX_LOG_BYTES = 1024 * 1024

export type LogLevel = 'info' | 'warn' | 'error'

let logDir: string | null = null

/** Start writing to `<dir>/xrncal.log`. Until this runs, log() does nothing. */
export function initLog(dir: string): void {
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    logDir = dir
  } catch {
    logDir = null
  }
}

/** The log file, or undefined before initLog(). It may not exist yet. */
export function logFilePath(): string | undefined {
  return logDir ? join(logDir, LOG_FILE) : undefined
}

/** The folder the log lives in, or undefined before initLog(). */
export function logDirectory(): string | undefined {
  return logDir ?? undefined
}

/**
 * Strip what must never reach a file: passwords in URLs, bearer tokens, and
 * token, secret or password fields in query strings, form bodies and JSON.
 * Provider error bodies are copied into messages, and some echo what was sent.
 */
export function redactSecrets(text: string): string {
  return (
    text
      // https://user:password@host
      .replace(/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi, '$1***@')
      .replace(/(\bAuthorization"?\s*[:=]\s*"?)(?:Bearer|Basic)?\s*[^\s"&,}]+/gi, '$1***')
      .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/g, 'Bearer ***')
      // access_token=..., "refresh_token": "...", client_secret: ...
      .replace(
        /("?\b(?:access_token|refresh_token|id_token|client_secret|password|code_verifier)"?\s*[:=]\s*"?)[^\s"&,}]+/gi,
        '$1***'
      )
  )
}

/** One line of the log: time, level, message - newlines folded so each entry
 *  stays one line. */
export function formatLogLine(level: LogLevel, message: string, now = new Date()): string {
  const oneLine = redactSecrets(message).replace(/\s*\r?\n\s*/g, ' | ').trim()
  return `${now.toISOString()} ${level.toUpperCase().padEnd(5)} ${oneLine}\n`
}

export function log(level: LogLevel, message: string): void {
  const file = logFilePath()
  if (!file || !logDir) return
  try {
    if (existsSync(file) && statSync(file).size > MAX_LOG_BYTES) {
      renameSync(file, join(logDir, OLD_LOG_FILE))
    }
    appendFileSync(file, formatLogLine(level, message), { encoding: 'utf8', mode: 0o600 })
  } catch {
    // A full disk or a read-only profile must not take the app down with it.
  }
}
