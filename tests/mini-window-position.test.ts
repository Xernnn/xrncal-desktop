import { describe, it, expect } from 'vitest'
import { miniWindowPosition } from '../src/main/mini-window-position'

/**
 * The mini window was placed against the primary display's size, with the
 * work area taken to start at 0,0: on a second monitor, or a primary display
 * with a bar along its left or top, it was clamped away from the tray icon.
 */
describe('miniWindowPosition', () => {
  const win = { width: 380, height: 560 }

  it('sits above a tray icon on a bottom bar of a second monitor to the right', () => {
    const second = { x: 1920, y: 0, width: 2560, height: 1400 }
    const tray = { x: 4300, y: 1410, width: 24, height: 24 }
    expect(miniWindowPosition(win, second, tray)).toEqual({ x: 4088, y: 828 })
  })

  it('sits below a tray icon on a top bar, inside a work area that starts below it', () => {
    const primary = { x: 0, y: 32, width: 1920, height: 1048 }
    const tray = { x: 1880, y: 4, width: 24, height: 24 }
    expect(miniWindowPosition(win, primary, tray)).toEqual({ x: 1528, y: 44 })
  })

  it('stays inside a work area that starts to the right of a left bar', () => {
    const primary = { x: 48, y: 0, width: 1872, height: 1080 }
    const tray = { x: 10, y: 1000, width: 24, height: 24 }
    expect(miniWindowPosition(win, primary, tray).x).toBe(60)
  })

  it('goes to the top-right of the work area without a tray icon', () => {
    expect(miniWindowPosition(win, { x: 1920, y: 0, width: 1920, height: 1080 })).toEqual({ x: 3436, y: 48 })
  })
})
