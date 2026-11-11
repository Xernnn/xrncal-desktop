import { describe, it, expect } from 'vitest'
import { DateTime } from 'luxon'
import { parseEntry, applyEntry, type EntrySlot } from '../src/shared/natural-entry'
import { resolveLunarOccurrence } from '../src/shared/lunar-vietnam'

// Thursday 5 November 2026, weeks starting on Monday.
const today = DateTime.fromISO('2026-11-05T10:20:00')
const context = { today, firstDayOfWeek: 1 }
const parse = (text: string) => parseEntry(text, context)

describe('parseEntry, Vietnamese', () => {
  it.each([
    ['Họp 3h chiều thứ 6', { title: 'Họp', date: '2026-11-06', start: '15:00' }],
    ['Họp 3pm thứ 6', { title: 'Họp', date: '2026-11-06', start: '15:00' }],
    ['Hop 3h chieu thu 6', { title: 'Hop', date: '2026-11-06', start: '15:00' }],
    ['Họp t6 lúc 9h', { title: 'Họp', date: '2026-11-06', start: '09:00' }],
    ['Họp mai 9h', { title: 'Họp', date: '2026-11-06', start: '09:00' }],
    ['Họp ngày mai lúc 8 giờ', { title: 'Họp', date: '2026-11-06', start: '08:00' }],
    ['Họp ngày kia 10h', { title: 'Họp', date: '2026-11-07', start: '10:00' }],
    ['tối nay xem phim 8h', { title: 'xem phim', date: '2026-11-05', start: '20:00' }],
    ['Đi khám 8h sáng 20/11', { title: 'Đi khám', date: '2026-11-20', start: '08:00' }],
    ['Nộp hồ sơ ngày 3 tháng 12 năm 2026', { title: 'Nộp hồ sơ', date: '2026-12-03' }],
    ['Họp lúc 3 giờ rưỡi chiều', { title: 'Họp', start: '15:30' }],
    ['Họp 3h', { title: 'Họp', start: '15:00' }],
    ['Họp 05:30', { title: 'Họp', start: '05:30' }],
    ['Họp 14h-15h30', { title: 'Họp', start: '14:00', end: '15:30' }],
    ['Họp từ 9h đến 11h', { title: 'Họp', start: '09:00', end: '11:00' }],
    ['Tiệc 22h-1h', { title: 'Tiệc', start: '22:00', end: '01:00' }],
    ['Họp trong 2 tiếng lúc 9h', { title: 'Họp', start: '09:00', durationMinutes: 120 }],
    ['Nghỉ cả ngày thứ 6', { title: 'Nghỉ', date: '2026-11-06', allDay: true }],
    ['Ăn tối 7h', { title: 'Ăn tối', start: '19:00' }],
    ['Ăn trưa mai', { title: 'Ăn trưa', date: '2026-11-06' }],
    ['Ăn sáng 7h', { title: 'Ăn sáng', start: '07:00' }],
    ['Họp 8h tối nay', { title: 'Họp', date: '2026-11-05', start: '20:00' }],
    ['Họp chiều mai 3h', { title: 'Họp', date: '2026-11-06', start: '15:00' }],
    ['Ăn tối nay lúc 7h', { title: 'Ăn tối', date: '2026-11-05', start: '19:00' }],
    ['Họp sáng thứ 2 lúc 9h', { title: 'Họp', date: '2026-11-09', start: '09:00' }]
  ])('%s', (text, expected) => {
    expect(parse(text)).toMatchObject(expected)
  })

  it('reads "thứ 5" as today and "thứ 5 tuần sau" as next week', () => {
    expect(parse('Họp thứ 5')?.date).toBe('2026-11-05')
    expect(parse('Họp thứ 5 tuần sau')?.date).toBe('2026-11-12')
    expect(parse('Họp thứ hai tuần tới')?.date).toBe('2026-11-09')
    expect(parse('Đi chơi chủ nhật')?.date).toBe('2026-11-08')
  })

  it('puts a date that has passed this year in the next', () => {
    expect(parse('Sinh nhật Mai 12/8')).toMatchObject({ title: 'Sinh nhật Mai', date: '2027-08-12' })
  })

  it('repeats', () => {
    expect(parse('Chạy bộ 6h sáng hàng ngày')).toMatchObject({
      title: 'Chạy bộ',
      start: '06:00',
      repeat: { kind: 'daily' }
    })
    expect(parse('Họp nhóm thứ 2 hàng tuần 9h30')).toMatchObject({
      title: 'Họp nhóm',
      date: '2026-11-09',
      start: '09:30',
      repeat: { kind: 'weekly', byDay: 'MO' }
    })
    expect(parse('Học tiếng Anh mỗi thứ 4 19h')).toMatchObject({
      title: 'Học tiếng Anh',
      date: '2026-11-11',
      start: '19:00',
      repeat: { kind: 'weekly', byDay: 'WE' }
    })
    expect(parse('Đóng tiền nhà hàng tháng')).toMatchObject({ title: 'Đóng tiền nhà', repeat: { kind: 'monthly' } })
  })

  describe('lunar dates', () => {
    const next = (day: number, month: number, leap = false): string => {
      const spec = { day, month, leap }
      for (const y of [2026, 2027]) {
        const iso = resolveLunarOccurrence(spec, y)
        if (iso && iso >= '2026-11-05') return iso
      }
      throw new Error('unplaceable')
    }

    it.each([
      ['Giỗ ông 12/8 âm lịch', 'Giỗ ông', 12, 8],
      ['Giỗ ông ngày 12 tháng 8 âm lịch', 'Giỗ ông', 12, 8],
      ['Giỗ bà 3/3 (âl)', 'Giỗ bà', 3, 3],
      ['Gio ong 12/8 am lich', 'Gio ong', 12, 8],
      ['Đi chùa rằm tháng 7', 'Đi chùa', 15, 7],
      ['Đi chùa mùng 1 Tết', 'Đi chùa', 1, 1],
      ['Giỗ bà 3 tháng chạp', 'Giỗ bà', 3, 12],
      ['Giỗ cụ mùng 10 tháng giêng', 'Giỗ cụ', 10, 1]
    ])('%s', (text, title, day, month) => {
      expect(parse(text)).toEqual({
        title,
        date: next(day, month),
        allDay: true,
        repeat: { kind: 'lunar-yearly', spec: { day, month, leap: false } },
        matched: expect.any(Array)
      })
    })

    it('keeps a leap month', () => {
      expect(parse('Giỗ 5/4 nhuận âm lịch')?.repeat).toEqual({
        kind: 'lunar-yearly',
        spec: { day: 5, month: 4, leap: true }
      })
    })
  })

  it.each([
    ['Phòng 3'],
    ['Phòng 301'],
    ['Họp 2 người'],
    ['Sinh nhật Mai'],
    ['Mua 3G'],
    ['Họp nay'],
    ['Dự án B3'],
    // Nothing would be left of the title.
    ['3h chiều mai'],
    ['Mùng 1 Tết']
  ])('leaves "%s" alone', (text) => {
    expect(parse(text)).toBeNull()
  })
})

describe('parseEntry, English', () => {
  it.each([
    ['Lunch with Sam tomorrow at 12:30', { title: 'Lunch with Sam', date: '2026-11-06', start: '12:30' }],
    ['Dentist friday 10am', { title: 'Dentist', date: '2026-11-06', start: '10:00' }],
    ['Dentist next friday 10am', { title: 'Dentist', date: '2026-11-13', start: '10:00' }],
    ['Dentist on friday next week at 10am', { title: 'Dentist', date: '2026-11-13', start: '10:00' }],
    ['Review Dec 3 2pm', { title: 'Review', date: '2026-12-03', start: '14:00' }],
    ['Trip the 3rd of March', { title: 'Trip', date: '2027-03-03' }],
    ['Trip on December 24th, 2026', { title: 'Trip', date: '2026-12-24' }],
    ['Call in 3 days', { title: 'Call', date: '2026-11-08' }],
    ['Offsite all day monday', { title: 'Offsite', date: '2026-11-09', allDay: true }],
    ['Meeting 9-10:30am', { title: 'Meeting', start: '09:00', end: '10:30' }],
    ['Meeting 3-5pm', { title: 'Meeting', start: '15:00', end: '17:00' }],
    ['Meeting 11-1pm', { title: 'Meeting', start: '11:00', end: '13:00' }],
    ['Meeting for 30 minutes at 4pm', { title: 'Meeting', start: '16:00', durationMinutes: 30 }],
    ['Dinner at 7', { title: 'Dinner', start: '19:00' }],
    ['Team lunch at noon', { title: 'Team lunch', start: '12:00' }],
    ['Movie tonight at 8', { title: 'Movie', date: '2026-11-05', start: '20:00' }],
    ['Standup every monday 9:15', { title: 'Standup', date: '2026-11-09', start: '09:15', repeat: { kind: 'weekly', byDay: 'MO' } }],
    ['Water the plants weekly', { title: 'Water the plants', repeat: { kind: 'weekly' } }]
  ])('%s', (text, expected) => {
    expect(parse(text)).toMatchObject(expected)
  })

  it.each([['I may be late'], ['Ship v2.0'], ['Room 12'], ['Sunset walk']])('leaves "%s" alone', (text) => {
    expect(parse(text)).toBeNull()
  })

  it('lists what it recognised, as typed', () => {
    expect(parse('Họp 3h chiều thứ 6')?.matched).toEqual(['3h chiều', 'thứ 6'])
  })
})

describe('applyEntry', () => {
  const slot: EntrySlot = {
    allDay: false,
    startDate: '2026-11-04',
    startTime: '10:00',
    endDate: '2026-11-04',
    endTime: '11:30'
  }
  const entry = (extra: object) => ({ title: 'x', matched: [], ...extra })

  it('a time alone keeps the day and the length', () => {
    expect(applyEntry(slot, entry({ start: '15:00' }))).toEqual({
      allDay: false,
      startDate: '2026-11-04',
      startTime: '15:00',
      endDate: '2026-11-04',
      endTime: '16:30'
    })
  })

  it('a day alone keeps the hours', () => {
    expect(applyEntry(slot, entry({ date: '2026-11-06' }))).toEqual({ ...slot, startDate: '2026-11-06', endDate: '2026-11-06' })
  })

  it('an end before the start is the next day', () => {
    expect(applyEntry(slot, entry({ start: '22:00', end: '01:00' }))).toMatchObject({
      startDate: '2026-11-04',
      endDate: '2026-11-05',
      endTime: '01:00'
    })
  })

  it('a time on an all-day slot makes it an hour long', () => {
    const allDay = { ...slot, allDay: true, endDate: '2026-11-05' }
    expect(applyEntry(allDay, entry({ start: '09:00' }))).toEqual({
      allDay: false,
      startDate: '2026-11-04',
      startTime: '09:00',
      endDate: '2026-11-04',
      endTime: '10:00'
    })
  })

  it('a time on an all-day slot makes it as long as new events are set to be', () => {
    const allDay = { ...slot, allDay: true, endDate: '2026-11-05' }
    expect(applyEntry(allDay, entry({ start: '09:00' }), 30)).toMatchObject({ allDay: false, startTime: '09:00', endTime: '09:30' })
    expect(applyEntry(allDay, entry({ start: '23:00' }), 120)).toMatchObject({
      startDate: '2026-11-04',
      startTime: '23:00',
      endDate: '2026-11-05',
      endTime: '01:00'
    })
    // A length or an end that was typed still wins, and a timed slot keeps its own.
    expect(applyEntry(allDay, entry({ start: '09:00', durationMinutes: 45 }), 30)).toMatchObject({ endTime: '09:45' })
    expect(applyEntry(allDay, entry({ start: '09:00', end: '11:00' }), 30)).toMatchObject({ endTime: '11:00' })
    expect(applyEntry(slot, entry({ start: '15:00' }), 30)).toMatchObject({ startTime: '15:00', endTime: '16:30' })
  })

  it('a length alone keeps the start', () => {
    expect(applyEntry(slot, entry({ durationMinutes: 45 }))).toMatchObject({ startTime: '10:00', endTime: '10:45' })
  })

  it('a lunar date is one all-day date', () => {
    expect(
      applyEntry(slot, entry({ date: '2027-09-12', allDay: true, repeat: { kind: 'lunar-yearly', spec: { day: 12, month: 8, leap: false } } }))
    ).toEqual({ ...slot, allDay: true, startDate: '2027-09-12', endDate: '2027-09-12' })
  })

  it('all day keeps a multi-day span', () => {
    const span = { ...slot, allDay: true, endDate: '2026-11-06' }
    expect(applyEntry(span, entry({ date: '2026-11-10', allDay: true }))).toMatchObject({
      startDate: '2026-11-10',
      endDate: '2026-11-12'
    })
  })
})
