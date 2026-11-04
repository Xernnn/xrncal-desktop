import { describe, it, expect } from 'vitest'
import { isGnomeShell, parseHostRegistered, trayHostVisible } from '../src/main/tray-host'

/**
 * GNOME Shell shows tray icons only with the AppIndicator extension. Without
 * it, closing the window to the tray left xrncal running out of reach - so
 * there, and only there, the session bus is asked first.
 */
describe('tray host', () => {
  it('recognises GNOME Shell, including distribution-branded sessions', () => {
    expect(isGnomeShell({ XDG_CURRENT_DESKTOP: 'GNOME' })).toBe(true)
    expect(isGnomeShell({ XDG_CURRENT_DESKTOP: 'ubuntu:GNOME' })).toBe(true)
    expect(isGnomeShell({ XDG_CURRENT_DESKTOP: 'pop:GNOME' })).toBe(true)
  })

  it('leaves desktops with a tray of their own alone', () => {
    for (const desktop of ['KDE', 'XFCE', 'X-Cinnamon', 'Budgie:GNOME', 'GNOME-Flashback:GNOME', 'Unity', 'MATE', '']) {
      expect(isGnomeShell({ XDG_CURRENT_DESKTOP: desktop })).toBe(false)
    }
    expect(isGnomeShell({})).toBe(false)
  })

  it("reads gdbus's answer", () => {
    expect(parseHostRegistered('(<true>,)\n')).toBe(true)
    expect(parseHostRegistered('(<false>,)\n')).toBe(false)
    expect(parseHostRegistered('')).toBe(false)
  })

  it('asks only on GNOME Shell under Linux', async () => {
    const never = async (): Promise<boolean | undefined> => {
      throw new Error('should not ask')
    }
    expect(await trayHostVisible('linux', { XDG_CURRENT_DESKTOP: 'KDE' }, never)).toBe(true)
    expect(await trayHostVisible('win32', { XDG_CURRENT_DESKTOP: 'GNOME' }, never)).toBe(true)
  })

  it('on GNOME Shell, follows what the session bus says', async () => {
    const gnome = { XDG_CURRENT_DESKTOP: 'GNOME' }
    expect(await trayHostVisible('linux', gnome, async () => false)).toBe(false)
    expect(await trayHostVisible('linux', gnome, async () => true)).toBe(true)
    // gdbus missing or hung: keep the tray, as before this check existed.
    expect(await trayHostVisible('linux', gnome, async () => undefined)).toBe(true)
  })
})
