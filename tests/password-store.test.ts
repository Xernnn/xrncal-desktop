import { describe, expect, it } from 'vitest'
import { passwordStoreSwitch } from '../src/main/password-store'

const none = () => false

describe('passwordStoreSwitch', () => {
  it('points desktops Electron does not know at the Secret Service', () => {
    expect(passwordStoreSwitch('linux', 'Hyprland', none)).toBe('gnome-libsecret')
    expect(passwordStoreSwitch('linux', 'sway', none)).toBe('gnome-libsecret')
    expect(passwordStoreSwitch('linux', undefined, none)).toBe('gnome-libsecret')
  })

  it('leaves the same choice on GNOME, where Electron already makes it', () => {
    expect(passwordStoreSwitch('linux', 'ubuntu:GNOME', none)).toBe('gnome-libsecret')
  })

  it('leaves KDE to KWallet', () => {
    expect(passwordStoreSwitch('linux', 'KDE', none)).toBeNull()
  })

  it('never overrides an explicit --password-store', () => {
    expect(passwordStoreSwitch('linux', 'Hyprland', (s) => s === 'password-store')).toBeNull()
  })

  it('does nothing off Linux', () => {
    expect(passwordStoreSwitch('win32', undefined, none)).toBeNull()
    expect(passwordStoreSwitch('darwin', undefined, none)).toBeNull()
  })
})
