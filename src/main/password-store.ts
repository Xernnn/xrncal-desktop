/**
 * Electron picks the Linux password store from XDG_CURRENT_DESKTOP. Desktops it doesn't
 * recognise (Hyprland, Sway, niri, …) get `basic_text`, a key built into every copy of
 * Chromium, which this app refuses, so saving a password fails even with a keyring running.
 * Anywhere but KDE (which has its own KWallet backend) the Secret Service is the keyring:
 * GNOME Keyring or KeePassXC. An explicit --password-store always wins.
 *
 * Must run before the app is ready: the switch is read when safeStorage starts.
 */
export function passwordStoreSwitch(
  platform: string,
  desktop: string | undefined,
  hasSwitch: (name: string) => boolean
): string | null {
  if (platform !== 'linux' || hasSwitch('password-store')) return null
  if (/kde/i.test(desktop ?? '')) return null
  return 'gnome-libsecret'
}
