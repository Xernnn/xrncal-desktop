import { describe, it, expect } from 'vitest'
import { DateTime } from 'luxon'
import { rankLocationSuggestions, type LocationSample } from '../src/shared/location-suggestions'
import { foldAccents, foldForMatch } from '../src/shared/text-fold'

/**
 * The Location field offers the places used before that match what is typed,
 * the ones used lately and often first. `now` is injected because recency is
 * relative to it.
 */
const NOW = DateTime.fromISO('2026-09-15T12:00:00.000Z', { zone: 'utc' })

const daysAgo = (days: number): string => NOW.minus({ days }).toISO()!

function at(location: string, startUtc = daysAgo(1), rrule: string | null = null): LocationSample {
  return { location, startUtc, rrule }
}

function rank(samples: LocationSample[], query: string, limit?: number): string[] {
  return rankLocationSuggestions(samples, { query, now: NOW, limit }).map((s) => s.location)
}

describe('foldAccents / foldForMatch', () => {
  it('takes the accents off Vietnamese, đ included', () => {
    expect(foldAccents('Cà phê sữa đá')).toBe('Ca phe sua da')
    expect(foldAccents('ĐƯỜNG Nguyễn Huệ')).toBe('DUONG Nguyen Hue')
    // Typed as separate marks (NFD) or as one letter (NFC): the same.
    expect(foldAccents('Phở'.normalize('NFD'))).toBe(foldAccents('Phở'.normalize('NFC')))
  })

  it('leaves the words, lower-cased, with one space between them', () => {
    expect(foldForMatch('  12 Lê Lợi,  Q.1 ')).toBe('12 le loi q 1')
    expect(foldForMatch('(Room 3) — HQ')).toBe('room 3 hq')
    expect(foldForMatch(' ,;- ')).toBe('')
  })
})

describe('rankLocationSuggestions', () => {
  it('offers nothing for an empty field', () => {
    const samples = [at('Cà phê Sáng'), at('Office')]
    expect(rank(samples, '')).toEqual([])
    expect(rank(samples, '   ')).toEqual([])
    // Punctuation alone names no place either.
    expect(rank(samples, ' , ')).toEqual([])
  })

  it('finds a place by how it starts, by a word in it, or by letters inside a word', () => {
    const samples = [at('Blue Door Studio'), at('Harbour Library')]
    expect(rank(samples, 'blu')).toEqual(['Blue Door Studio'])
    expect(rank(samples, 'door')).toEqual(['Blue Door Studio'])
    expect(rank(samples, 'brar')).toEqual(['Harbour Library'])
    expect(rank(samples, 'zzz')).toEqual([])
  })

  it('ignores accents and capitals: "ca phe" finds "Cà phê"', () => {
    const samples = [at('Cà phê Sáng, 12 Lê Lợi'), at('Đình làng'), at('Office')]
    expect(rank(samples, 'ca phe')).toEqual(['Cà phê Sáng, 12 Lê Lợi'])
    expect(rank(samples, 'CA PHE')).toEqual(['Cà phê Sáng, 12 Lê Lợi'])
    expect(rank(samples, 'le loi')).toEqual(['Cà phê Sáng, 12 Lê Lợi'])
    expect(rank(samples, 'dinh')).toEqual(['Đình làng'])
    // And the other way round: accents typed find a place stored without them.
    expect(rank([at('Ca phe Sang')], 'cà phê')).toEqual(['Ca phe Sang'])
  })

  it('needs every word typed to be in the place', () => {
    const samples = [at('Blue Door Studio'), at('Blue Whale Pool')]
    expect(rank(samples, 'blue pool')).toEqual(['Blue Whale Pool'])
    expect(rank(samples, 'blue moon')).toEqual([])
  })

  it('puts the place used most recently first, other things being equal', () => {
    const samples = [at('Studio North', daysAgo(90)), at('Studio South', daysAgo(2))]
    expect(rank(samples, 'studio')).toEqual(['Studio South', 'Studio North'])
  })

  it('puts the place used most often first, other things being equal', () => {
    const samples = [
      at('Studio North', daysAgo(3)),
      at('Studio South', daysAgo(3)),
      at('Studio South', daysAgo(10)),
      at('Studio South', daysAgo(17)),
      at('Studio South', daysAgo(24))
    ]
    expect(rank(samples, 'studio')).toEqual(['Studio South', 'Studio North'])
  })

  it('counts a repeating event as every time it happened, and as used until now', () => {
    // One row, but fifty-odd visits a year, the last of them this week.
    const samples = [
      at('Pool Lane 4', daysAgo(400), 'FREQ=WEEKLY;BYDAY=TU'),
      at('Pool Hall', daysAgo(20)),
      at('Pool Hall', daysAgo(40))
    ]
    const ranked = rankLocationSuggestions(samples, { query: 'pool', now: NOW })
    expect(ranked.map((s) => s.location)).toEqual(['Pool Lane 4', 'Pool Hall'])
    expect(ranked[0].uses).toBeGreaterThan(50)
    expect(ranked[0].lastUsedUtc).toBe(NOW.toISO())
  })

  it('leaves out a series that ended before the window', () => {
    const samples = [at('Old Hall', '2019-01-07T09:00:00.000Z', 'FREQ=WEEKLY;UNTIL=20190601T000000Z')]
    expect(rank(samples, 'old')).toEqual([])
  })

  it('ranks a place that starts with what was typed above one that only has it in a later word', () => {
    const samples = [at('Market Garden', daysAgo(3)), at('Garden Room', daysAgo(3))]
    expect(rank(samples, 'gar')).toEqual(['Garden Room', 'Market Garden'])
  })

  it('still lets a place used far more, and lately, come first on a looser match', () => {
    const samples = [
      at('Market Garden', daysAgo(1)),
      at('Market Garden', daysAgo(2)),
      at('Market Garden', daysAgo(3)),
      at('Garden Room', daysAgo(30))
    ]
    expect(rank(samples, 'gar')).toEqual(['Market Garden', 'Garden Room'])
  })

  it('offers one place once, however it was spelled, in the spelling used most', () => {
    const samples = [
      at('ca phe sang', daysAgo(1)),
      at('Cà phê Sáng', daysAgo(5)),
      at('Cà phê  Sáng ', daysAgo(9)),
      at('CÀ PHÊ SÁNG', daysAgo(12))
    ]
    const ranked = rankLocationSuggestions(samples, { query: 'ca', now: NOW })
    expect(ranked.map((s) => s.location)).toEqual(['Cà phê Sáng'])
    expect(ranked[0].uses).toBe(4)
    expect(ranked[0].lastUsedUtc).toBe(daysAgo(1))
  })

  it('takes the latest spelling when none was used more than another', () => {
    const samples = [at('Blue door studio', daysAgo(9)), at('Blue Door Studio', daysAgo(2))]
    expect(rank(samples, 'blue')).toEqual(['Blue Door Studio'])
  })

  it('does not offer exactly what is already in the field', () => {
    const samples = [at('Office'), at('Office Annex')]
    expect(rank(samples, 'Office')).toEqual(['Office Annex'])
    // Typed without its capital or accents, the stored spelling is still worth offering.
    expect(rank(samples, 'office')).toEqual(['Office', 'Office Annex'])
  })

  it('keeps to the limit, five unless told otherwise', () => {
    const samples = Array.from({ length: 8 }, (_, i) => at(`Room ${i + 1}`, daysAgo(i + 1)))
    expect(rank(samples, 'room')).toEqual(['Room 1', 'Room 2', 'Room 3', 'Room 4', 'Room 5'])
    expect(rank(samples, 'room', 2)).toEqual(['Room 1', 'Room 2'])
  })

  it('skips blank places', () => {
    expect(rank([at('   '), at('')], 'a')).toEqual([])
  })

  it('orders level scores by name, so the list does not shuffle between keystrokes', () => {
    const samples = [at('Room B', daysAgo(3)), at('Room A', daysAgo(3))]
    expect(rank(samples, 'room')).toEqual(['Room A', 'Room B'])
  })
})
