import { BrowserWindow, screen, ipcMain } from 'electron'
import { devServerUrl, lockDownContents } from './web-contents-guard'
import { join } from 'node:path'
import { IPC_CHANNELS } from '@shared/ipc-contract'
import { getDatabase } from './db/database'
import { EventsRepo } from './db/repos/events-repo'
import { CalendarsRepo } from './db/repos/calendars-repo'
import { withCalendarColors } from '@shared/event-colors'
import { DateTime } from 'luxon'
import { windowBackground } from './window-background'
import { miniWindowPosition } from './mini-window-position'

let miniWindow: BrowserWindow | null = null
/**
 * How to bring the main window back. A function rather than the window itself:
 * the main window can be closed (and destroyed) while the mini window lives on,
 * and a held reference then pointed at a dead window, so "Open xrncal" did
 * nothing. index.ts recreates the window when it has to.
 */
let showMainWindow: () => void = () => {}

function createMiniWindow(): BrowserWindow {
  if (miniWindow && !miniWindow.isDestroyed()) {
    return miniWindow
  }

  miniWindow = new BrowserWindow({
    width: 380,
    height: 560,
    minWidth: 320,
    minHeight: 400,
    show: false,
    frame: false,
    resizable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: windowBackground(),
    title: 'xrncal Mini',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true
    }
  })

  // The same bridge as the main window, so the same locks: no new windows, no
  // navigating away from the app.
  lockDownContents(miniWindow.webContents)

  // Its own title, not the page's ("xrncal", the main window's too). On
  // Wayland a window can neither stay on top nor choose where it goes, so a
  // compositor rule does both (README), and it finds the mini window by this
  // title - the one it had when it opened.
  miniWindow.on('page-title-updated', (event) => event.preventDefault())

  // Load URL with #mini hash
  const devServer = devServerUrl()
  if (devServer) {
    miniWindow.loadURL(`${devServer}#mini`)
  } else {
    miniWindow.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'mini' })
  }

  miniWindow.on('blur', () => {
    // Optional: auto-hide on blur if not alwaysOnTop
    if (miniWindow && !miniWindow.isAlwaysOnTop()) {
      miniWindow.hide()
    }
  })

  miniWindow.on('closed', () => {
    miniWindow = null
  })

  return miniWindow
}

function positionMiniWindow(trayBounds?: { x: number; y: number; width: number; height: number }): void {
  if (!miniWindow || miniWindow.isDestroyed()) return

  // The display the tray icon is on, not always the primary one.
  const display = trayBounds
    ? screen.getDisplayNearestPoint({
        x: Math.round(trayBounds.x + trayBounds.width / 2),
        y: Math.round(trayBounds.y + trayBounds.height / 2)
      })
    : screen.getPrimaryDisplay()
  const { x, y } = miniWindowPosition(miniWindow.getBounds(), display.workArea, trayBounds)
  miniWindow.setPosition(x, y, false)
}

export function toggleMiniWindow(trayBounds?: { x: number; y: number; width: number; height: number }): void {
  if (!miniWindow || miniWindow.isDestroyed()) {
    createMiniWindow()
  }

  if (!miniWindow) return

  if (miniWindow.isVisible()) {
    miniWindow.hide()
  } else {
    positionMiniWindow(trayBounds)
    miniWindow.show()
    miniWindow.focus()
  }
}

export function registerMiniIpcHandlers(showMain: () => void): void {
  showMainWindow = showMain
  const db = getDatabase()
  const eventsRepo = new EventsRepo(db)
  const calendarsRepo = new CalendarsRepo(db)

  ipcMain.removeHandler(IPC_CHANNELS.MINI.OPEN_MAIN)
  ipcMain.removeHandler(IPC_CHANNELS.MINI.TOGGLE)
  ipcMain.removeHandler(IPC_CHANNELS.MINI.GET_UPCOMING)
  ipcMain.removeHandler(IPC_CHANNELS.MINI.SET_ALWAYS_ON_TOP)

  ipcMain.handle(IPC_CHANNELS.MINI.OPEN_MAIN, () => {
    showMainWindow()
  })

  ipcMain.handle(IPC_CHANNELS.MINI.TOGGLE, () => {
    toggleMiniWindow()
  })

  ipcMain.handle(IPC_CHANNELS.MINI.GET_UPCOMING, (_event, limit = 10) => {
    const cals = calendarsRepo.listCalendars()
    const activeCalIds = cals.filter((c) => c.isVisible).map((c) => c.id)

    const now = DateTime.utc()
    const startUtc = now.minus({ hours: 1 }).toISO()!
    const endUtc = now.plus({ days: 7 }).toISO()!

    const found = activeCalIds.length > 0
      ? eventsRepo.queryEventsByRange(activeCalIds, startUtc, endUtc).slice(0, limit)
      : []

    // As stored, an event without a colour of its own has none; the main
    // window's views draw it in its calendar's, and so does the mini window.
    return { occurrences: withCalendarColors(found, cals) }
  })

  ipcMain.handle(IPC_CHANNELS.MINI.SET_ALWAYS_ON_TOP, (_event, flag: boolean) => {
    if (miniWindow && !miniWindow.isDestroyed()) {
      miniWindow.setAlwaysOnTop(flag)
      return miniWindow.isAlwaysOnTop()
    }
    return false
  })
}
