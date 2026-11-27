import { app } from 'electron'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { getPortableFolder } from './portable-folder'

/** Passed by the login entry: start in the tray, without opening the window. */
export const START_HIDDEN_ARG = '--hidden'

/** Set to 1 by a launcher that runs the app under XWayland (XRNCAL_X11=1 npm run app:install). */
export const X11_OPT_IN = 'XRNCAL_X11'

function linuxAutostartFile(): string {
  const configHome = process.env.XDG_CONFIG_HOME || join(homedir(), '.config')
  return join(configHome, 'autostart', 'xrncal.desktop')
}

/** A desktop-entry Exec argument: quoted, with the characters the spec reserves escaped. */
function execArg(value: string): string {
  return `"${value.replace(/(["`$\\])/g, '\\$1')}"`
}

/**
 * Where the AppImage unpacks itself to run: xrncal's own folder in the user's
 * cache, on disk, the same one scripts/install-linux-app.sh gives the launcher.
 */
export function linuxUnpackFolder(): string {
  const cacheHome = process.env.XDG_CACHE_HOME || join(homedir(), '.cache')
  return join(cacheHome, 'xrncal')
}

/**
 * The freedesktop autostart entry that starts the AppImage at login. The path
 * is the AppImage's own, which only an AppImage run knows (`APPIMAGE`). The
 * extract-and-run launch and the TMPDIR it unpacks into match the launcher
 * `npm run app:install` writes, for the same reasons (see
 * scripts/install-linux-app.sh): run from the FUSE mount, the app dies with
 * SIGBUS if the mount goes away under it, and unpacked into /tmp it sits in
 * memory, where files untouched for days can be cleaned away under it.
 *
 * `x11` runs the app under XWayland, as the launcher does only when asked to
 * (X11_OPT_IN): native Wayland keeps other X11 clients from reading xrncal's
 * windows and keystrokes. The choice travels as X11_OPT_IN in the entry's own
 * environment, not as the switch alone, so an entry written by an older build
 * (which always passed the switch) does not keep the app on X11 for good.
 */
export function linuxAutostartEntry(appImagePath: string, unpackFolder: string, x11 = false): string {
  const optIn = x11 ? ` ${X11_OPT_IN}=1` : ''
  const ozone = x11 ? ' --ozone-platform=x11' : ''
  return [
    '[Desktop Entry]',
    'Type=Application',
    'Name=xrncal',
    `Exec=env NO_CLEANUP=1${optIn} ${execArg(`TMPDIR=${unpackFolder}`)} ${execArg(appImagePath)} --appimage-extract-and-run${ozone} ${START_HIDDEN_ARG}`,
    'Terminal=false',
    'X-GNOME-Autostart-enabled=true',
    ''
  ].join('\n')
}

/**
 * Register (or remove) xrncal as something the OS starts at login, in the tray.
 * Only an installed build: a dev or unpacked run has no stable path to start.
 * Called on every launch as well as when the setting changes, so an AppImage
 * that was moved points the entry at its new place.
 */
export function applyLaunchAtLogin(enabled: boolean): void {
  if (!app.isPackaged) return
  // A movable portable build should not leave a startup entry behind.
  if (getPortableFolder()) return
  try {
    if (process.platform === 'linux') {
      const file = linuxAutostartFile()
      const appImage = process.env.APPIMAGE
      if (!enabled || !appImage) {
        rmSync(file, { force: true })
        return
      }
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, linuxAutostartEntry(appImage, linuxUnpackFolder(), process.env[X11_OPT_IN] === '1'))
      return
    }
    app.setLoginItemSettings({ openAtLogin: enabled, args: [START_HIDDEN_ARG] })
  } catch {
    // A read-only config directory or a refused registry write: the setting
    // stays as chosen and the next launch tries again.
  }
}
