import { describe, it, expect } from 'vitest'
import React from 'react'
import { renderToString } from 'react-dom/server'
import { resources } from '../src/renderer/src/i18n'
import SettingsPanel from '../src/renderer/src/components/SettingsPanel'
import { SettingsProvider, type SettingsContextValue } from '../src/renderer/src/context/SettingsContext'
import { displayPreferencesOf } from '../src/renderer/src/context/DisplayPreferencesContext'
import { DEFAULT_APP_SETTINGS, type AppSettings } from '../src/shared/settings-contract'
import { EVENT_LENGTH_OPTIONS } from '../src/shared/event-length'

/**
 * Settings -> Calendar view offers the length of a new event beside the snap
 * step, and marks the one in use.
 */
describe('the "Length of a new event" setting', () => {
  const panel = (settings: AppSettings): string => {
    const value: SettingsContextValue = {
      settings,
      ready: true,
      setSetting: async () => true,
      setLanguage: async () => {}
    }
    return renderToString(
      React.createElement(
        SettingsProvider,
        { value },
        React.createElement(SettingsPanel, {
          isOpen: true,
          section: 'view',
          onSectionChange: () => {},
          onClose: () => {},
          onManageAccounts: () => {},
          onOpenShortcuts: () => {},
          onImportIcs: () => {},
          onPrint: () => {},
          onRestoreBackup: () => {},
          appVersion: '0.0.0',
          platform: 'linux'
        })
      )
    )
  }

  /** The label of the length button that is pressed. */
  const pressed = (html: string): string[] =>
    [...html.matchAll(/<button[^>]*aria-pressed="true"[^>]*>([^<]*)<\/button>/g)].map((m) => m[1])

  it('offers every length, with an hour chosen until it is changed', () => {
    const html = panel(DEFAULT_APP_SETTINGS)
    expect(html).toContain('Length of a new event')
    for (const label of ['15 min', '30 min', '45 min', '1 hour', '1.5 hours', '2 hours']) {
      expect(html).toContain(`>${label}</button>`)
    }
    expect(pressed(html)).toEqual(['1 hour'])
    // No raw key where a label should be.
    expect(html).not.toContain('settings.eventLengthOption')
  })

  // The labels are looked up by the length, so the parity test alone would
  // not notice a length added without its two labels.
  it('has a label for every length in both languages', () => {
    for (const locale of ['en', 'vi'] as const) {
      const labels: Record<string, string> = resources[locale].translation.settings.eventLengthOption
      expect(Object.keys(labels).sort()).toEqual(EVENT_LENGTH_OPTIONS.map(String).sort())
    }
  })

  it('marks the length that was chosen', () => {
    expect(pressed(panel({ ...DEFAULT_APP_SETTINGS, defaultEventMinutes: 90 }))).toEqual(['1.5 hours'])
    expect(pressed(panel({ ...DEFAULT_APP_SETTINGS, defaultEventMinutes: 15 }))).toEqual(['15 min'])
  })

  it('hands the views the length chosen, or an hour for one that was never offered', () => {
    expect(displayPreferencesOf({ ...DEFAULT_APP_SETTINGS, defaultEventMinutes: 45 }).defaultEventMinutes).toBe(45)
    const stored = { ...DEFAULT_APP_SETTINGS, defaultEventMinutes: 0 as unknown as AppSettings['defaultEventMinutes'] }
    expect(displayPreferencesOf(stored).defaultEventMinutes).toBe(60)
    expect(pressed(panel(stored))).toEqual(['1 hour'])
  })
})
