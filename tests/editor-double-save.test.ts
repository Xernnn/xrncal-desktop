import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React from 'react'
import { renderToString } from 'react-dom/server'
import { useEventCommands } from '../src/renderer/src/hooks/use-event-commands'

/**
 * Ctrl+Enter saves from anywhere in the editor, and the editor stays open
 * until the save is back. Pressed twice while the main process was busy, the
 * second press saved again: two events, or two splits of a series.
 */
describe('a save already on its way is not sent again', () => {
  type Commands = ReturnType<typeof useEventCommands>
  let commands: Commands
  let finish: () => void
  const events = {
    create: vi.fn(),
    getById: vi.fn()
  }

  beforeEach(() => {
    const waiting: (() => void)[] = []
    finish = () => waiting.splice(0).forEach((resolve) => resolve())
    const pending = (): Promise<unknown> =>
      new Promise((resolve) => waiting.push(() => resolve({ id: 'e1' })))
    events.create.mockReset().mockImplementation(pending)
    events.getById.mockReset().mockResolvedValue(null)
    ;(globalThis as { window?: unknown }).window = { xrncal: { events } }

    const Probe = (): null => {
      commands = useEventCommands({
        calendars: [],
        reload: async () => {},
        undo: { pushUndo: () => {}, offerUndoDelete: () => {} } as unknown as Parameters<
          typeof useEventCommands
        >[0]['undo'],
        dragSnapMinutes: 15,
        openEditor: () => {},
        closeEditor: () => {},
        clientXOf: () => undefined
      })
      return null
    }
    renderToString(React.createElement(Probe))
  })

  afterEach(() => {
    delete (globalThis as { window?: unknown }).window
  })

  const input = {
    calendarId: 'c1',
    title: 'Dentist',
    dtStartUtc: '2026-11-12T09:00:00.000Z',
    dtEndUtc: '2026-11-12T10:00:00.000Z'
  }

  it('creates one event for two presses', async () => {
    const first = commands.saveEvent({ isNew: true, input })
    const second = commands.saveEvent({ isNew: true, input })
    finish()
    await Promise.all([first, second])

    expect(events.create).toHaveBeenCalledTimes(1)
  })

  it('saves again once the first save is back, or has failed', async () => {
    const first = commands.saveEvent({ isNew: true, input })
    finish()
    await first
    events.create.mockRejectedValueOnce(new Error('disk full'))
    await commands.saveEvent({ isNew: true, input })
    const third = commands.saveEvent({ isNew: true, input })
    finish()
    await third

    expect(events.create).toHaveBeenCalledTimes(3)
  })
})
