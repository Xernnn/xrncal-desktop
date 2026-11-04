/** Milliseconds from `nowMs` to the start of the next minute, plus a little so
 *  the tick lands inside the new minute rather than on its edge. */
export function msUntilNextMinute(nowMs: number): number {
  return 60_000 - (nowMs % 60_000) + 50
}
