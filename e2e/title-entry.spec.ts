import { test, expect, type Page } from '@playwright/test'
import { launchApp } from './app'

// A new event's title is read for when it is: the fields follow what is
// typed, and the words are left out of the title saved.

/** The saved event called `title`: its start on this machine's clock (yyyy-MM-dd HH:mm) and its lunar rule. */
async function saved(page: Page, title: string): Promise<{ start: string; lunar: unknown } | null> {
  return page.evaluate(async (title) => {
    const found = (await window.xrncal.events.search(title)).find((e) => e.title === title)
    if (!found) return null
    const d = new Date(found.dtStartUtc)
    const pad = (n: number) => String(n).padStart(2, '0')
    return {
      start: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`,
      lunar: found.lunarRule ?? null
    }
  }, title)
}

/** Tomorrow on this machine's clock, yyyy-MM-dd. */
async function tomorrow(page: Page): Promise<string> {
  return page.evaluate(() => {
    const d = new Date()
    d.setDate(d.getDate() + 1)
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  })
}

test('a time and day typed into the title fill the fields and are left out of the title saved', async () => {
  const running = await launchApp()
  try {
    const { page } = running
    await page.getByRole('button', { name: 'Create' }).click()
    const title = page.getByPlaceholder('Event title…')
    await title.fill('Dentist tomorrow at 3pm')

    const status = page.getByRole('status').filter({ hasText: 'Saved as' })
    await expect(status).toContainText('Saved as “Dentist”')
    await expect(status).toContainText('15:00–16:00')
    await expect(page.locator('div.group', { hasText: 'Start' }).first().getByRole('textbox')).toHaveValue('15:00')

    await page.keyboard.press('Control+Enter')
    await expect(title).toBeHidden()
    await expect.poll(() => saved(page, 'Dentist')).toEqual({ start: `${await tomorrow(page)} 15:00`, lunar: null })
    expect(running.errors).toEqual([])
  } finally {
    await running.close()
  }
})

test('× keeps the title as typed and puts the time back', async () => {
  const running = await launchApp()
  try {
    const { page } = running
    await page.getByRole('button', { name: 'Create' }).click()
    const title = page.getByPlaceholder('Event title…')
    await title.fill('Call 3pm')
    const start = page.locator('div.group', { hasText: 'Start' }).first().getByRole('textbox')
    await expect(start).toHaveValue('15:00')

    await page.getByRole('button', { name: 'Keep the title as typed' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Saved as' })).toHaveCount(0)
    await expect(start).toHaveValue('09:00')
    // Typing on does not bring it back for this event.
    await title.fill('Call 3pm tomorrow')
    await expect(start).toHaveValue('09:00')

    await page.keyboard.press('Control+Enter')
    await expect(title).toBeHidden()
    await expect.poll(async () => (await saved(page, 'Call 3pm tomorrow'))?.start.slice(-5)).toBe('09:00')
  } finally {
    await running.close()
  }
})

test('a lunar date makes a yearly anniversary by the lunar calendar', async () => {
  const running = await launchApp()
  try {
    const { page } = running
    await page.getByRole('button', { name: 'Create' }).click()
    await page.getByPlaceholder('Event title…').fill('Giỗ ông 12/8 âm lịch')
    await expect(page.getByRole('status').filter({ hasText: 'Saved as' })).toContainText('Saved as “Giỗ ông”')

    await page.keyboard.press('Control+Enter')
    await expect.poll(async () => (await saved(page, 'Giỗ ông'))?.lunar).toEqual({ day: 12, month: 8, leap: false })
    expect(running.errors).toEqual([])
  } finally {
    await running.close()
  }
})
