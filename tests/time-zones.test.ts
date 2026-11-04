import { describe, it, expect } from 'vitest'
import {
  parseZoneList,
  serializeZoneList,
  zoneLabel,
  zoneForEditing,
  zoneOptions,
  zonePickerOptions
} from '../src/renderer/src/lib/time-zones'

describe('time zone picker', () => {
  it('labels a zone with its name and the offset it has today', () => {
    expect(zoneLabel('Asia/Ho_Chi_Minh')).toBe('Asia/Ho Chi Minh (GMT+7)')
    expect(zoneLabel('Asia/Kolkata')).toBe('Asia/Kolkata (GMT+5:30)')
    expect(zoneLabel('Not/A_Zone')).toBe('Not/A Zone')
  })

  it('offers every zone the runtime knows', () => {
    const values = zoneOptions().map((o) => o.value)
    expect(values.length).toBeGreaterThan(300)
    expect(values).toContain('Europe/Berlin')
  })
})

describe('preferred time zones', () => {
  it('reads the stored list in order, once each, dropping zones the runtime does not know', () => {
    expect(parseZoneList('Europe/London, Asia/Tokyo,Europe/London,,Not/A_Zone')).toEqual([
      'Europe/London',
      'Asia/Tokyo'
    ])
    expect(parseZoneList('')).toEqual([])
    expect(parseZoneList(undefined)).toEqual([])
    expect(parseZoneList(serializeZoneList(['Asia/Tokyo', 'America/New_York']))).toEqual([
      'Asia/Tokyo',
      'America/New_York'
    ])
  })

  it('lists the preferred zones, then this computer and the event, ahead of the rest', () => {
    const { pinned, rest } = zonePickerOptions(['Asia/Tokyo', 'Europe/London'], 'Europe/Berlin', 'America/New_York')
    expect(pinned.map((o) => o.value)).toEqual(['Asia/Tokyo', 'Europe/London', 'Europe/Berlin', 'America/New_York'])
    expect(pinned.filter((o) => o.isLocal).map((o) => o.value)).toEqual(['Europe/Berlin'])
    expect(rest.map((o) => o.value)).not.toContain('Asia/Tokyo')
    expect(rest.map((o) => o.value)).toContain('Europe/Paris')
    expect(pinned.length + rest.length).toBe(zoneOptions().length)
  })

  it('lists one zone spelled two ways once, in the spelling the event holds', () => {
    const { pinned, rest } = zonePickerOptions(['Asia/Ho_Chi_Minh'], 'Asia/Saigon', 'Asia/Saigon')
    expect(pinned).toEqual([{ value: 'Asia/Saigon', label: zoneLabel('Asia/Saigon'), isLocal: true }])
    expect(rest.some((o) => o.value === 'Asia/Saigon' || o.value === 'Asia/Ho_Chi_Minh')).toBe(false)
  })
})

describe('the zone an existing event is edited in', () => {
  // Where the user was on the event's date, or this computer's zone.
  const here = 'Australia/Sydney'

  it('keeps a zone the event was given', () => {
    expect(zoneForEditing('Asia/Ho_Chi_Minh', false, here)).toBe('Asia/Ho_Chi_Minh')
    expect(zoneForEditing('America/New_York', true, here)).toBe('America/New_York')
  })

  it('edits a one-off event stamped in UTC in the zone it has no name for', () => {
    // An .ics from Google's export: DTSTART:20241215T063000Z reads back as UTC.
    expect(zoneForEditing('UTC', false, here)).toBe(here)
    expect(zoneForEditing('Etc/UTC', false, here)).toBe(here)
    expect(zoneForEditing('GMT', false, here)).toBe(here)
    expect(zoneForEditing('UTC', false, 'Asia/Ho_Chi_Minh')).toBe('Asia/Ho_Chi_Minh')
  })

  it('keeps UTC on a series, which repeats at that UTC time', () => {
    expect(zoneForEditing('UTC', true, here)).toBe('UTC')
  })

  it('does the same for a zone it cannot resolve', () => {
    expect(zoneForEditing('floating', false, here)).toBe(here)
    expect(zoneForEditing('floating', true, here)).toBe(here)
    expect(zoneForEditing('', false, here)).toBe(here)
    expect(zoneForEditing(undefined, false, here)).toBe(here)
  })
})
