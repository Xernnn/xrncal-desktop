import { describe, it, expect } from 'vitest'
import { normalizeZoneHistory, parseZoneHistory, recordZoneMove, serializeZoneHistory, zoneAt } from '../src/shared/zone-history'

describe('where the user was', () => {
  const moved = parseZoneHistory('Asia/Ho_Chi_Minh,2026-01-28=Australia/Sydney')

  it('reads and writes the stored setting', () => {
    expect(moved).toEqual([
      { from: null, zone: 'Asia/Ho_Chi_Minh' },
      { from: '2026-01-28', zone: 'Australia/Sydney' }
    ])
    expect(serializeZoneHistory(moved)).toBe('Asia/Ho_Chi_Minh,2026-01-28=Australia/Sydney')
    expect(parseZoneHistory('')).toEqual([])
    expect(parseZoneHistory(undefined)).toEqual([])
  })

  it('drops what it cannot use and keeps date order', () => {
    expect(
      parseZoneHistory('2026-08-11=Asia/Ho_Chi_Minh, Not/A_Zone, 2026-13-40=Asia/Tokyo, Australia/Sydney, 2026-08-21=Australia/Sydney')
    ).toEqual([
      { from: null, zone: 'Australia/Sydney' },
      { from: '2026-08-11', zone: 'Asia/Ho_Chi_Minh' },
      { from: '2026-08-21', zone: 'Australia/Sydney' }
    ])
  })

  it('takes the date off whichever period comes first', () => {
    expect(
      normalizeZoneHistory([
        { from: '2026-01-28', zone: 'Australia/Sydney' },
        { from: '2020-01-01', zone: 'Asia/Ho_Chi_Minh' }
      ])
    ).toEqual([
      { from: null, zone: 'Asia/Ho_Chi_Minh' },
      { from: '2026-01-28', zone: 'Australia/Sydney' }
    ])
  })

  it('gives the zone in force at an instant, switching at local midnight of the move', () => {
    expect(zoneAt(moved, '2024-12-15T06:30:00.000Z')).toBe('Asia/Ho_Chi_Minh')
    // 28 January 00:00 in Sydney (UTC+11) is 27 January 13:00 UTC.
    expect(zoneAt(moved, '2026-01-27T12:59:00.000Z')).toBe('Asia/Ho_Chi_Minh')
    expect(zoneAt(moved, '2026-01-27T13:00:00.000Z')).toBe('Australia/Sydney')
    expect(zoneAt(moved, '2026-10-07T11:00:00.000Z')).toBe('Australia/Sydney')
    expect(zoneAt([], '2026-10-07T11:00:00.000Z')).toBeUndefined()
  })
})

describe('a move of this computer to another zone', () => {
  const moved = parseZoneHistory('Asia/Ho_Chi_Minh,2026-01-28=Australia/Sydney')

  it('is added from the day it was noticed', () => {
    expect(serializeZoneHistory(recordZoneMove(moved, 'Australia/Sydney', 'Asia/Ho_Chi_Minh', '2026-12-20')!)).toBe(
      'Asia/Ho_Chi_Minh,2026-01-28=Australia/Sydney,2026-12-20=Asia/Ho_Chi_Minh'
    )
  })

  it('starts an empty history with where the computer was, so older events stay there', () => {
    expect(serializeZoneHistory(recordZoneMove([], 'Australia/Sydney', 'Asia/Ho_Chi_Minh', '2026-12-20')!)).toBe(
      'Australia/Sydney,2026-12-20=Asia/Ho_Chi_Minh'
    )
  })

  it('adds nothing when the zone did not change or the history already says so', () => {
    expect(recordZoneMove(moved, 'Australia/Sydney', 'Australia/Sydney', '2026-12-20')).toBeNull()
    expect(recordZoneMove(moved, 'Asia/Saigon', 'Asia/Ho_Chi_Minh', '2026-12-20')).toBeNull()
    expect(recordZoneMove(moved, 'Asia/Ho_Chi_Minh', 'Australia/Sydney', '2026-12-20')).toBeNull()
    expect(recordZoneMove(moved, '', 'Asia/Ho_Chi_Minh', '2026-12-20')).toBeNull()
  })

  it('keeps one move per day: a second replaces the first, and going back cancels it', () => {
    const trip = recordZoneMove(moved, 'Australia/Sydney', 'Asia/Tokyo', '2026-12-20')!
    expect(serializeZoneHistory(recordZoneMove(trip, 'Asia/Tokyo', 'Asia/Ho_Chi_Minh', '2026-12-20')!)).toBe(
      'Asia/Ho_Chi_Minh,2026-01-28=Australia/Sydney,2026-12-20=Asia/Ho_Chi_Minh'
    )
    expect(serializeZoneHistory(recordZoneMove(trip, 'Asia/Tokyo', 'Australia/Sydney', '2026-12-20')!)).toBe(
      'Asia/Ho_Chi_Minh,2026-01-28=Australia/Sydney'
    )
  })
})
