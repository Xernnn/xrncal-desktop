import { useEffect, useEffectEvent } from 'react'
import { commandForKey, type KeyCommand, type KeyContext } from '@shared/keyboard-commands'

/**
 * The calendar's keyboard: each keydown is turned into a command by
 * `commandForKey()` (where every rule about which key does what lives) and
 * handed to `run`. A key that is a command has its default prevented.
 * Bound once; `context` and `run` are read as they are when the key arrives.
 */
export function useKeyCommands(context: KeyContext, run: (command: KeyCommand) => void): void {
  const onKeyDown = useEffectEvent((e: KeyboardEvent) => {
    const target = e.target as HTMLElement | null
    const command = commandForKey(
      {
        key: e.key,
        ctrl: e.ctrlKey || e.metaKey,
        shift: e.shiftKey,
        alt: e.altKey,
        inTextField: Boolean(
          target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
        ),
        onControl: Boolean(target && ['BUTTON', 'A', 'SELECT'].includes(target.tagName))
      },
      context
    )
    if (!command) return
    e.preventDefault()
    run(command)
  })

  useEffect(() => {
    const listener = (e: KeyboardEvent): void => onKeyDown(e)
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [])
}
