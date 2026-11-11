import { databaseFilePath, initDatabase, NewerDatabaseError } from './db/database'
import type { ISqliteDatabase } from './db/sqlite-driver'
import { mt } from './i18n-main'
import { log, logFilePath } from './log'
import { describeError } from './sync/http'

/** What startup needs of Electron to give up: `dialog.showErrorBox` and `app.exit`. */
export interface StartupFailureUi {
  showErrorBox(title: string, content: string): void
  exit(code: number): void
}

/** The box shown when the database cannot be opened: what failed, and where the log is. */
export function databaseFailureNotice(err: unknown, dbPath: string, logPath: string | undefined): { title: string; content: string } {
  const lines =
    err instanceof NewerDatabaseError
      ? [mt('startup.dbNewerBody', { path: dbPath, version: err.version, known: err.knownVersion })]
      : [mt('startup.dbFailedBody', { path: dbPath }), describeError(err)]
  if (logPath) lines.push(mt('startup.dbFailedLog', { path: logPath }))
  return { title: mt('startup.dbFailedTitle'), content: lines.join('\n\n') }
}

/**
 * Open the profile's database, or say why it could not be and end the process.
 * Null when it ended it.
 *
 * A failure here used to be logged and nothing else. Every IPC handler reads
 * the database when it is registered, so the next step threw, the window was
 * never built, and the process stayed on with nothing on screen and the
 * single-instance lock held: launching xrncal again only woke that process.
 */
export function openDatabaseOrQuit(userDataDir: string, ui: StartupFailureUi): ISqliteDatabase | null {
  try {
    return initDatabase(userDataDir)
  } catch (err) {
    log('error', `The database could not be opened: ${describeError(err)}`)
    const { title, content } = databaseFailureNotice(err, databaseFilePath(userDataDir), logFilePath())
    ui.showErrorBox(title, content)
    ui.exit(1)
    return null
  }
}
