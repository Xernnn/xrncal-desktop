/**
 * Arrow keys over cells laid out in rows of unequal length, such as the emoji
 * picker: a "remove" row of one, a row of favourites, then each group's rows,
 * the last of them usually short. Cells are numbered straight through, row
 * after row, so "where does this arrow land" is a function of the row lengths
 * and the cell the cursor is on, testable without a DOM.
 *
 * Left and Right step through the cells in reading order, running on from the
 * end of one row to the start of the next. Up and Down keep the column, or
 * take the last cell of a row too short to have it. Home and End go to the
 * ends of the row. Nothing wraps: at an edge the cursor stays where it is.
 */
export function gridMove(rowLengths: number[], index: number, key: string): number | null {
  const rows = rowLengths.filter((length) => length > 0)
  const total = rows.reduce((sum, length) => sum + length, 0)
  if (total === 0) return null
  const at = Math.max(0, Math.min(total - 1, index))

  let row = 0
  let rowStart = 0
  while (at >= rowStart + rows[row]) {
    rowStart += rows[row]
    row++
  }
  const column = at - rowStart

  switch (key) {
    case 'ArrowRight':
      return Math.min(total - 1, at + 1)
    case 'ArrowLeft':
      return Math.max(0, at - 1)
    case 'ArrowDown':
      if (row === rows.length - 1) return at
      return rowStart + rows[row] + Math.min(column, rows[row + 1] - 1)
    case 'ArrowUp':
      if (row === 0) return at
      return rowStart - rows[row - 1] + Math.min(column, rows[row - 1] - 1)
    case 'Home':
      return rowStart
    case 'End':
      return rowStart + rows[row] - 1
    default:
      return null
  }
}

/** The lengths of the rows that `count` cells make, `columns` to a row. */
export function rowsOf(count: number, columns: number): number[] {
  const rows: number[] = []
  for (let left = count; left > 0; left -= columns) rows.push(Math.min(columns, left))
  return rows
}
