import { app } from 'electron'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** A Windows portable ZIP marks the directory that holds the real executable. */
export function getPortableFolder(): string | undefined {
  if (process.platform !== 'win32' || !app.isPackaged) return undefined
  const folder = dirname(app.getPath('exe'))
  if (existsSync(join(folder, 'portable.flag'))) return folder
  return process.env.PORTABLE_EXECUTABLE_DIR
}
