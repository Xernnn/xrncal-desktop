import { app } from 'electron'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/** Passed by the login entry: start in the tray, without opening the window. */
export const START_HIDDEN_ARG = '--hidden'

function linuxAutostartFile(): string {
  const configHome = process.env.XDG_CONFIG_HOME || join(homedir(), '.config')
  return join(configHome, 'autostart', 'xrncal.desktop')
}

/** A desktop-entry Exec argument: quoted, with the characters the spec reserves escaped. */
function execArg(value: string): string {
  return `"${value.replace(/(["`$\\])/g, '\\$1')}"`
}

/**
 * The freedesktop autostart entry that starts the AppImage at login. The path
 * is the AppImage's own, which only an AppImage run knows (`APPIMAGE`); the X11
 * switch matches the launcher `npm run app:install` writes, for the same reason
 * (see electron-builder.yml).
 */
export function linuxAutostartEntry(appImagePath: string): string {
  return [
    '[Desktop Entry]',
    'Type=Application',
    'Name=xrncal',
    `Exec=${execArg(appImagePath)} --ozone-platform=x11 ${START_HIDDEN_ARG}`,
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
  try {
    if (process.platform === 'linux') {
      const file = linuxAutostartFile()
      const appImage = process.env.APPIMAGE
      if (!enabled || !appImage) {
        rmSync(file, { force: true })
        return
      }
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, linuxAutostartEntry(appImage))
      return
    }
    app.setLoginItemSettings({ openAtLogin: enabled, args: [START_HIDDEN_ARG] })
  } catch {
    // A read-only config directory or a refused registry write: the setting
    // stays as chosen and the next launch tries again.
  }
}
