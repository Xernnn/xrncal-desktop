import { readFileSync, statSync } from 'node:fs'
import { basename, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { OpenedIcsFile } from '@shared/ipc-contract'
import { MAX_ICS_SIZE_BYTES } from './ics/parse-ics'

/**
 * .ics files the OS has asked xrncal to open - "Open with xrncal", a
 * double-click once the installer has registered the type - held until the
 * renderer collects them. Held rather than pushed: on a first launch the
 * file arrives before the window has loaded anything to receive it.
 */
let pending: OpenedIcsFile[] = []
let notifyRenderer: () => void = () => {}

/** The .ics paths in a command line: the first launch's, or the one a second
 *  launch hands over in `second-instance`. A Linux launcher's `%U` hands
 *  local files over as `file://` URLs, which are turned back into paths. */
export function icsPathsIn(argv: string[]): string[] {
  const paths: string[] = []
  for (const arg of argv) {
    if (arg.startsWith('-')) continue
    let path = arg
    if (arg.startsWith('file://')) {
      try {
        path = fileURLToPath(arg)
      } catch {
        continue
      }
    } else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(arg)) {
      // Another scheme (https://, webcal://): not a file on this computer.
      continue
    }
    if (extname(path).toLowerCase() === '.ics') paths.push(path)
  }
  return paths
}

export function setOpenedFileNotifier(notify: () => void): void {
  notifyRenderer = notify
}

/** Read each file (within the size cap the importer enforces) and queue it. */
export function queueOpenedFiles(paths: string[]): void {
  let queued = false
  for (const path of paths) {
    try {
      // A plain file only: an "invite.ics" that is really a pipe or a link to
      // /dev/zero would hang the app reading it, or fill its memory.
      const stat = statSync(path)
      if (!stat.isFile() || stat.size > MAX_ICS_SIZE_BYTES) continue
      pending.push({ name: basename(path), content: readFileSync(path, 'utf8') })
      queued = true
    } catch {
      // Gone or unreadable by the time we looked: nothing to import.
    }
  }
  if (queued) notifyRenderer()
}

export function takeOpenedFiles(): OpenedIcsFile[] {
  const files = pending
  pending = []
  return files
}
