import { app, Tray, Menu, nativeImage } from 'electron'
import { APP_ICON_ICO, APP_ICON_PNG } from './app-icon'
import { toggleMiniWindow } from './mini-window'
import { mt, loadMainLocaleFromDb } from './i18n-main'
import { trayHostVisible } from './tray-host'

let trayInstance: Tray | null = null
let openMain: () => void = () => {}

/**
 * The app icon, at a size the tray can use. It used to be an SVG handed to
 * `nativeImage.createFromBuffer`, which decodes PNG and JPEG only: the image was
 * 0x0 and the tray showed nothing. Windows takes the multi-size .ico and picks
 * its own size; Linux panels are given a 32px PNG and scale it.
 */
function trayIcon(): Electron.NativeImage {
  if (process.platform === 'win32') return nativeImage.createFromPath(APP_ICON_ICO)
  return nativeImage.createFromPath(APP_ICON_PNG).resize({ width: 32, height: 32, quality: 'best' })
}

function buildMenu(): Menu {
  return Menu.buildFromTemplate([
    { label: mt('tray.openMain'), click: () => openMain() },
    { label: mt('tray.miniWindow'), click: () => toggleMiniWindow() },
    { type: 'separator' },
    { label: mt('tray.quit'), click: () => app.quit() }
  ])
}

/** Whether something on the desktop shows the icon (tray-host.ts). Assumed
 *  until asked, and asked again whenever the main window takes focus, so
 *  turning GNOME's AppIndicator extension on or off is noticed. */
let hostVisible = true

/** Whether the tray icon is up and can be seen - closing the window keeps the
 *  app running only then. */
export function hasTray(): boolean {
  return Boolean(trayInstance && !trayInstance.isDestroyed()) && hostVisible
}

/** Ask the desktop again whether it shows tray icons. */
export async function refreshTrayHost(): Promise<void> {
  try {
    hostVisible = await trayHostVisible()
  } catch {
    hostVisible = true
  }
}

/** Rebuild the menu in the current language (after Settings switches it). */
export function refreshTrayMenu(): void {
  if (trayInstance && !trayInstance.isDestroyed()) trayInstance.setContextMenu(buildMenu())
}

/** `showMainWindow` brings the main window back, recreating it if it was closed. */
export function setupTray(showMainWindow: () => void): Tray {
  openMain = showMainWindow
  if (trayInstance && !trayInstance.isDestroyed()) {
    return trayInstance
  }

  loadMainLocaleFromDb()
  trayInstance = new Tray(trayIcon())
  trayInstance.setToolTip('xrncal')
  // setContextMenu, not a popUpContextMenu on right-click: Linux panels
  // (StatusNotifierItem) never send right-click and cannot pop a menu up on
  // request, so the menu - and Quit with it - was out of reach there.
  trayInstance.setContextMenu(buildMenu())

  // Left-click toggles the mini window where the panel reports clicks
  // (Windows); on Linux a click opens the menu, which holds the same item.
  trayInstance.on('click', (_event, bounds) => {
    toggleMiniWindow(bounds)
  })

  return trayInstance
}
