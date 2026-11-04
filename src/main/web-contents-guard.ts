import { app, ipcMain, session, shell, type WebContents } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { isSafeExternalUrl } from './safe-external-url'

/**
 * What only xrncal's own pages may do. Both windows carry the preload bridge,
 * which can read and change every calendar, so a page that is not the app's
 * own must never be shown in them or be listened to.
 */

/** Permissions a page may have: the renderer copies error details to the
 *  clipboard and needs nothing else - no camera, microphone or location. */
const ALLOWED_PERMISSIONS = new Set(['clipboard-sanitized-write'])

/** The Vite dev server `npm run dev` serves the renderer from. An installed
 *  build never has one: honouring the variable there let whoever could set it
 *  load any page into a window holding the bridge, with IPC trusting it. */
export function devServerUrl(): string | undefined {
  return app.isPackaged ? undefined : process.env['ELECTRON_RENDERER_URL']
}

/** The app's own document: the dev server in `npm run dev`, else the built
 *  index.html - not any file:// page, which could be a downloaded one. */
export function isAppUrl(url: string, devServer = devServerUrl()): boolean {
  try {
    if (devServer) return new URL(url).origin === new URL(devServer).origin
    const index = pathToFileURL(join(__dirname, '../renderer/index.html')).href
    const parsed = new URL(url)
    parsed.hash = ''
    parsed.search = ''
    return parsed.href === index
  } catch {
    return false
  }
}

/** No new windows, and no navigating away from the app: a link opens in the
 *  browser (web and mail addresses only), anything else goes nowhere. */
export function lockDownContents(contents: WebContents): void {
  contents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  contents.on('will-navigate', (event, url) => {
    if (isAppUrl(url)) return
    event.preventDefault()
    if (isSafeExternalUrl(url)) void shell.openExternal(url)
  })
  contents.on('will-attach-webview', (event) => event.preventDefault())
}

/**
 * Every IPC request has to come from the app's own page. Navigation is locked
 * down already; this is the second wall, so that a page which somehow got into
 * a window still cannot call the bridge. Installed before any handler.
 */
export function guardIpcSenders(): void {
  const handle = ipcMain.handle.bind(ipcMain)
  ipcMain.handle = (channel, listener) =>
    handle(channel, (event, ...args) => {
      const url = event.senderFrame?.url ?? ''
      if (!isAppUrl(url)) throw new Error(`Refused ${channel} from ${url || 'an unknown page'}`)
      return listener(event, ...args)
    })
}

/** Deny every browser permission the app does not use. Electron grants them
 *  all by default. */
export function denyUnusedPermissions(): void {
  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) =>
    callback(ALLOWED_PERMISSIONS.has(permission))
  )
  session.defaultSession.setPermissionCheckHandler((_contents, permission) => ALLOWED_PERMISSIONS.has(permission))
}
