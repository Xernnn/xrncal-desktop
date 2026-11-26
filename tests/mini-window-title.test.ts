import { describe, it, expect, vi } from 'vitest'

/**
 * On native Wayland a window can neither stay on top nor choose where it
 * goes, so the mini window's "on top, by the tray" comes from a compositor
 * rule, which can only tell it from the main window by its title (both are
 * the app's, `xrncal`). It took the page's title, "xrncal" like the main
 * window's, as soon as the page loaded, so no rule could single it out. It
 * keeps its own now.
 */

const { windows } = vi.hoisted(() => ({
  windows: [] as { options: Record<string, unknown>; handlers: Map<string, (...args: unknown[]) => void> }[]
}))

vi.mock('electron', async () => {
  const stub = await vi.importActual<Record<string, unknown>>('./stubs/electron')
  class FakeWindow {
    handlers = new Map<string, (...args: unknown[]) => void>()
    webContents = { on: () => undefined, setWindowOpenHandler: () => undefined, send: () => undefined }
    constructor(public options: Record<string, unknown>) {
      windows.push(this)
    }
    on(event: string, fn: (...args: unknown[]) => void) {
      this.handlers.set(event, fn)
      return this
    }
    isDestroyed = () => false
    isVisible = () => false
    isAlwaysOnTop = () => true
    loadURL = () => Promise.resolve()
    loadFile = () => Promise.resolve()
    getBounds = () => ({ x: 0, y: 0, width: 380, height: 560 })
    setPosition = () => undefined
    show = () => undefined
    focus = () => undefined
    hide = () => undefined
  }
  return {
    ...stub,
    BrowserWindow: FakeWindow,
    screen: { getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }) }
  }
})

const { toggleMiniWindow } = await import('../src/main/mini-window')

describe('the mini window', () => {
  it('keeps its own title when its page sets one', () => {
    toggleMiniWindow()

    const mini = windows.find((w) => w.options.title === 'xrncal Mini')
    expect(mini).toBeDefined()
    const onTitle = mini!.handlers.get('page-title-updated')
    expect(onTitle).toBeDefined()
    const event = { preventDefault: vi.fn() }
    onTitle!(event, 'xrncal')
    expect(event.preventDefault).toHaveBeenCalled()
  })
})
