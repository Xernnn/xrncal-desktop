/**
 * The sidebar's order, in one place: the renderer groups calendars by it and
 * the main process picks the default calendar by it (default-calendar.ts), so
 * "the first calendar in the sidebar" means the same calendar to both.
 *
 * Accounts: this computer first, then each connected account in the order it
 * was added. Within an account: the default calendar, then by name.
 */

export function compareAccountsForSidebar(
  a: { type: string; createdAt: string },
  b: { type: string; createdAt: string }
): number {
  if (a.type === 'local' && b.type !== 'local') return -1
  if (b.type === 'local' && a.type !== 'local') return 1
  return a.createdAt.localeCompare(b.createdAt)
}

export function compareCalendarsForSidebar(
  a: { isDefault: boolean; name: string },
  b: { isDefault: boolean; name: string }
): number {
  return Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name)
}
