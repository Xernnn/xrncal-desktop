import { test, expect, type Page } from '@playwright/test'
import { launchApp } from './app'

// A save is sent once, however often it is asked for while it is on its way:
// Ctrl+Enter twice before the editor closes, or a double click in the
// recurring-event prompt. Both are dispatched in one go here, so the second
// lands while the first is still waiting for the main process.

/** Events whose title starts with `prefix`. */
async function titled(page: Page, prefix: string): Promise<string[]> {
  return page.evaluate(
    async (prefix) =>
      (await window.xrncal.events.search(prefix)).map((e) => e.title).filter((t) => t.startsWith(prefix)).sort(),
    prefix
  )
}

test('Ctrl+Enter pressed twice creates the event once', async () => {
  const running = await launchApp()
  try {
    const { page } = running
    await page.getByRole('button', { name: 'Create' }).click()
    const title = page.getByPlaceholder('Event title…')
    await title.fill('Dentist')

    await page.evaluate(() => {
      for (let i = 0; i < 2; i++) {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }))
      }
    })
    await expect(title).toBeHidden()
    await page.reload()

    expect(await titled(page, 'Dentist')).toEqual(['Dentist'])
    expect(running.errors).toEqual([])
  } finally {
    await running.close()
  }
})

test('a double click on "This and following events" splits the series once', async () => {
  const running = await launchApp()
  try {
    const { page } = running
    // Weekly from a week ago, so today's is its second date.
    await page.evaluate(async () => {
      const start = new Date()
      start.setDate(start.getDate() - 7)
      start.setHours(10, 0, 0, 0)
      const calendarId = (await window.xrncal.calendars.list()).find((c) => !c.isReadOnly)!.id
      await window.xrncal.events.create({
        calendarId,
        title: 'Weekly review',
        dtStartUtc: start.toISOString(),
        dtEndUtc: new Date(start.getTime() + 3_600_000).toISOString(),
        tzid: 'Asia/Ho_Chi_Minh',
        rrule: 'FREQ=WEEKLY'
      })
    })
    await page.reload()

    await page.locator('[data-occurrence-id]', { hasText: 'Weekly review' }).first().click()
    const title = page.getByPlaceholder('Event title…')
    await expect(title).toHaveValue('Weekly review')
    await title.fill('Weekly review (new room)')
    await page.keyboard.press('Control+Enter')

    const following = page.getByRole('button', { name: /This and following events/ })
    await expect(following).toBeVisible()
    await following.evaluate((button: HTMLButtonElement) => {
      button.click()
      button.click()
    })
    await expect(following).toBeHidden()

    expect(await titled(page, 'Weekly review')).toEqual(['Weekly review', 'Weekly review (new room)'])
    expect(running.errors).toEqual([])
  } finally {
    await running.close()
  }
})
