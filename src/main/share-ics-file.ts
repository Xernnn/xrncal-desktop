import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

/**
 * Share writes the event as an .ics and shows it in the file manager, ready to
 * be dragged into a mail. It used to go straight into the temp directory - /tmp
 * on Linux, shared by every account on the computer - under a name taken from
 * the title and readable by all of them. Now it goes into a folder of the
 * app's own, which mkdtemp creates for this user alone, once per run.
 */
let folder: string | null = null

/** Write `content` as `<title>.ics` and return its path. */
export function writeSharedIcs(title: string, content: string): string {
  // Made again if something (systemd-tmpfiles, a cleaner) removed it meanwhile.
  if (!folder || !existsSync(folder)) folder = mkdtempSync(join(app.getPath('temp'), 'xrncal-share-'))
  const name = title.replace(/[^a-zA-Z0-9_\-\s]/g, '_').trim().slice(0, 40) || 'event'
  const filePath = join(folder, `${name}.ics`)
  writeFileSync(filePath, content, { encoding: 'utf-8', mode: 0o600 })
  return filePath
}
