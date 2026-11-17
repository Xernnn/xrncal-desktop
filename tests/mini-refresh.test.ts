import { describe, it, expect, vi } from 'vitest'
import { keepUpcomingFresh, type RefreshHost } from '../src/renderer/src/mini/upcoming-refresh'

/**
 * The mini window read its upcoming events every minute while hidden (main
 * hides it rather than closing it, and each read expands every series), yet
 * did not listen for syncs, so a just-synced event showed up to a minute late.
 */
function fakeHost(hidden: boolean) {
  let visibility: (() => void) | null = null
  let synced: (() => void) | null = null
  const timers = new Set<() => void>()
  const host: RefreshHost = {
    isHidden: () => hidden,
    onVisibilityChange: (listener) => {
      visibility = listener
      return () => (visibility = null)
    },
    onSyncChanged: (listener) => {
      synced = listener
      return () => (synced = null)
    },
    every: (tick) => {
      timers.add(tick)
      return () => timers.delete(tick)
    }
  }
  return {
    host,
    timers,
    show: () => {
      hidden = false
      visibility?.()
    },
    hide: () => {
      hidden = true
      visibility?.()
    },
    sync: () => synced?.(),
    listening: () => Boolean(visibility || synced)
  }
}

describe('keepUpcomingFresh', () => {
  it('reads once a minute only while shown, and again as soon as it is shown', () => {
    const load = vi.fn()
    const page = fakeHost(true)
    keepUpcomingFresh(load, page.host)
    expect(page.timers.size).toBe(0)

    page.show()
    expect(load).toHaveBeenCalledTimes(1)
    expect(page.timers.size).toBe(1)

    page.hide()
    expect(page.timers.size).toBe(0)
  })

  it('reads as soon as a sync changes something, while shown', () => {
    const load = vi.fn()
    const page = fakeHost(false)
    keepUpcomingFresh(load, page.host)
    page.sync()
    expect(load).toHaveBeenCalledTimes(1)

    page.hide()
    page.sync()
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('stops everything when stopped', () => {
    const page = fakeHost(false)
    const stop = keepUpcomingFresh(vi.fn(), page.host)
    stop()
    expect(page.timers.size).toBe(0)
    expect(page.listening()).toBe(false)
  })
})
