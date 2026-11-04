import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Taskbar-style auto-hide: with `enabled`, the header only stays up while the
 * pointer is near the top edge or resting on it, and slides away again after a
 * short delay. Switching it off brings the header back.
 */
export function useAutoHideHeader(enabled: boolean): {
  visible: boolean
  show: () => void
  scheduleHide: () => void
} {
  const [visible, setVisible] = useState(true)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Adjusted while rendering, not in an effect: switched off, it is up at once.
  const [wasEnabled, setWasEnabled] = useState(enabled)
  if (wasEnabled !== enabled) {
    setWasEnabled(enabled)
    if (!enabled) setVisible(true)
  }

  const show = useCallback(() => {
    if (hideTimer.current) {
      clearTimeout(hideTimer.current)
      hideTimer.current = null
    }
    setVisible(true)
  }, [])

  const scheduleHide = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(() => setVisible(false), 150)
  }, [])

  useEffect(() => {
    scheduleHide()
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current)
    }
  }, [scheduleHide])

  return { visible, show, scheduleHide }
}
