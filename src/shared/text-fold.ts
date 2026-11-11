/**
 * Text as it is compared when what was typed should find what was stored
 * whatever its accents and capitals: "ca phe" finds "Cà phê", as the search
 * palette's full-text index does for events.
 */

/**
 * `text` without its accents. Vietnamese letters are a base letter with marks
 * on it, which Unicode can take apart (NFD) - all but đ, a letter of its own.
 */
export function foldAccents(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
}

/**
 * The words of `text` for matching: no accents, lower case, and anything that
 * is neither a letter nor a digit turned into a single space, so "(Room 3)"
 * and "12 Lê Lợi, Q1" are found by the words in them.
 */
export function foldForMatch(text: string): string {
  return foldAccents(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}
