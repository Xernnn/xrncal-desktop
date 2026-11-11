import { describe, it, expect } from 'vitest'
import { gridMove, rowsOf } from '../src/renderer/src/lib/grid-nav'

/**
 * The emoji picker is walked with the arrow keys: a "remove" row of one cell,
 * then rows of eight, the last row of each group usually short.
 *
 *   row 0:  0
 *   row 1:  1  2  3  4  5  6  7  8
 *   row 2:  9 10 11
 *   row 3: 12 13 14 15 16 17 18 19
 */
describe('gridMove', () => {
  const rows = [1, 8, 3, 8]

  it('steps right and left in reading order, across the ends of rows', () => {
    expect(gridMove(rows, 3, 'ArrowRight')).toBe(4)
    expect(gridMove(rows, 3, 'ArrowLeft')).toBe(2)
    expect(gridMove(rows, 8, 'ArrowRight')).toBe(9)
    expect(gridMove(rows, 9, 'ArrowLeft')).toBe(8)
    expect(gridMove(rows, 0, 'ArrowRight')).toBe(1)
  })

  it('keeps the column going down and up', () => {
    expect(gridMove(rows, 2, 'ArrowDown')).toBe(10)
    expect(gridMove(rows, 10, 'ArrowDown')).toBe(13)
    expect(gridMove(rows, 13, 'ArrowUp')).toBe(10)
    expect(gridMove(rows, 10, 'ArrowUp')).toBe(2)
  })

  it('takes the last cell of a row too short to have the column', () => {
    expect(gridMove(rows, 7, 'ArrowDown')).toBe(11)
    expect(gridMove(rows, 19, 'ArrowUp')).toBe(11)
    expect(gridMove(rows, 5, 'ArrowUp')).toBe(0)
  })

  it('stays put at the edges rather than wrapping', () => {
    expect(gridMove(rows, 0, 'ArrowLeft')).toBe(0)
    expect(gridMove(rows, 0, 'ArrowUp')).toBe(0)
    expect(gridMove(rows, 19, 'ArrowRight')).toBe(19)
    expect(gridMove(rows, 14, 'ArrowDown')).toBe(14)
  })

  it('goes to the ends of the row on Home and End', () => {
    expect(gridMove(rows, 4, 'Home')).toBe(1)
    expect(gridMove(rows, 4, 'End')).toBe(8)
    expect(gridMove(rows, 10, 'End')).toBe(11)
    expect(gridMove(rows, 0, 'End')).toBe(0)
  })

  it('reaches every cell from the first with the arrows alone', () => {
    const reached = new Set([0])
    const queue = [0]
    while (queue.length > 0) {
      const at = queue.pop()!
      for (const key of ['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp']) {
        const next = gridMove(rows, at, key)!
        if (!reached.has(next)) {
          reached.add(next)
          queue.push(next)
        }
      }
    }
    expect(reached.size).toBe(20)
  })

  it('leaves other keys alone', () => {
    expect(gridMove(rows, 3, 'Enter')).toBeNull()
    expect(gridMove(rows, 3, 'a')).toBeNull()
    expect(gridMove(rows, 3, 'Escape')).toBeNull()
  })

  it('copes with a cursor outside the grid, empty rows and no cells at all', () => {
    expect(gridMove(rows, 99, 'ArrowLeft')).toBe(18)
    expect(gridMove(rows, -4, 'ArrowRight')).toBe(1)
    expect(gridMove([0, 2, 0, 2], 1, 'ArrowDown')).toBe(3)
    expect(gridMove([], 0, 'ArrowDown')).toBeNull()
    expect(gridMove([0], 0, 'ArrowRight')).toBeNull()
  })
})

describe('rowsOf', () => {
  it('splits cells into full rows and what is left over', () => {
    expect(rowsOf(16, 8)).toEqual([8, 8])
    expect(rowsOf(19, 8)).toEqual([8, 8, 3])
    expect(rowsOf(3, 8)).toEqual([3])
    expect(rowsOf(0, 8)).toEqual([])
  })
})
