export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** How far the mini window keeps from the work area's edges. */
const MARGIN = 12

/**
 * Where the mini window goes: by the tray icon when its bounds are known -
 * above it on a bar at the bottom, below it on a bar at the top - kept inside
 * `workArea`, the work area of the display the icon is on. Without them, the
 * top-right corner of `workArea`.
 *
 * It used to be placed against the primary display's size with its origin
 * taken as 0,0: with the tray on a second monitor, or a primary display whose
 * work area does not start at the corner (a bar on the left or top), it was
 * clamped into the wrong place, away from the icon.
 */
export function miniWindowPosition(
  win: { width: number; height: number },
  workArea: Rect,
  trayBounds?: Rect
): { x: number; y: number } {
  const right = workArea.x + workArea.width
  const bottom = workArea.y + workArea.height

  if (!trayBounds) {
    return { x: right - win.width - 24, y: workArea.y + 48 }
  }

  let x = Math.round(trayBounds.x + trayBounds.width / 2 - win.width / 2)
  let y =
    trayBounds.y > workArea.y + workArea.height / 2
      ? Math.round(trayBounds.y - win.height - 8)
      : Math.round(trayBounds.y + trayBounds.height + 8)

  if (x + win.width > right - MARGIN) x = right - win.width - MARGIN
  if (x < workArea.x + MARGIN) x = workArea.x + MARGIN
  if (y + win.height > bottom - MARGIN) y = bottom - win.height - MARGIN
  if (y < workArea.y + MARGIN) y = workArea.y + MARGIN
  return { x, y }
}
