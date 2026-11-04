import appIconPng from '../../resources/icon.png?asset&asarUnpack'
import appIconIco from '../../resources/icon.ico?asset&asarUnpack'

/**
 * The app icon on disk, for the tray and the window. Unpacked from the asar
 * archive (electron-builder.yml `asarUnpack`) so the OS-facing APIs that take
 * a file path - the tray on Windows, a window's icon on Linux - can read it.
 */
export const APP_ICON_PNG = appIconPng
export const APP_ICON_ICO = appIconIco
