import { execFile } from 'node:child_process'

/**
 * Whether a tray icon would actually be seen.
 *
 * Electron creates a Tray on Linux whether or not anything shows it. GNOME
 * Shell has no tray of its own: icons appear only with the AppIndicator
 * extension (Ubuntu ships it on; Fedora and plain GNOME do not), which runs
 * a StatusNotifier host. Without one, closing the window "to the tray" left
 * an app running with no window and no icon, and launch at login started
 * xrncal where nobody could reach it.
 *
 * Only GNOME Shell is asked. Other desktops have a tray of their own, some of
 * them the older XEmbed kind that a StatusNotifier query cannot see, and
 * treating those as trayless would make closing the window quit.
 */

/** Desktops that name GNOME in XDG_CURRENT_DESKTOP but have a panel with a tray. */
const GNOME_BASED_WITH_TRAY = new Set([
  'budgie',
  'cinnamon',
  'x-cinnamon',
  'gnome-flashback',
  'gnome-classic',
  'mate',
  'pantheon',
  'unity',
  'xfce',
  'kde',
  'lxqt',
  'lxde'
])

/** GNOME Shell, by XDG_CURRENT_DESKTOP: `GNOME`, `ubuntu:GNOME`, `pop:GNOME`. */
export function isGnomeShell(env: NodeJS.ProcessEnv = process.env): boolean {
  const names = (env.XDG_CURRENT_DESKTOP ?? '')
    .split(':')
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean)
  return names.includes('gnome') && !names.some((name) => GNOME_BASED_WITH_TRAY.has(name))
}

/** gdbus prints a property as `(<true>,)`. */
export function parseHostRegistered(stdout: string): boolean {
  return /<\s*true\s*>/.test(stdout)
}

/**
 * Ask the session bus whether a StatusNotifier host is registered. Resolves
 * true when the answer is yes, false when it is no or there is no watcher at
 * all, and undefined when it cannot be asked (no gdbus): then nothing changes.
 */
export function statusNotifierHostRegistered(timeoutMs = 2000): Promise<boolean | undefined> {
  return new Promise((resolve) => {
    execFile(
      'gdbus',
      [
        'call',
        '--session',
        '--dest',
        'org.kde.StatusNotifierWatcher',
        '--object-path',
        '/StatusNotifierWatcher',
        '--method',
        'org.freedesktop.DBus.Properties.Get',
        'org.kde.StatusNotifierWatcher',
        'IsStatusNotifierHostRegistered'
      ],
      { timeout: timeoutMs },
      (err, stdout) => {
        if (!err) return resolve(parseHostRegistered(String(stdout)))
        const code = (err as NodeJS.ErrnoException).code
        // No gdbus on this system, or it hung: no answer, so no change.
        if (code === 'ENOENT' || err.killed) return resolve(undefined)
        // gdbus ran and the bus said no such service: GNOME without the extension.
        resolve(false)
      }
    )
  })
}

/**
 * Whether a tray icon on this desktop would be visible. Everywhere but GNOME
 * Shell the answer is yes without asking; on GNOME Shell it is what the
 * session bus says, defaulting to yes when it cannot be asked.
 */
export async function trayHostVisible(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  ask: () => Promise<boolean | undefined> = statusNotifierHostRegistered
): Promise<boolean> {
  if (platform !== 'linux' || !isGnomeShell(env)) return true
  return (await ask()) ?? true
}
