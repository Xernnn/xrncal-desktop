import { test, expect, type Page } from '@playwright/test'
import { rmSync } from 'node:fs'
import { launchApp, newProfile } from './app'

// Getting around without a mouse, and what has to survive: an undo, a
// relaunch, a sync landing while the editor is open.

/** A one-hour event today at `hour`:00 on this machine's clock (UTC+7 here). */
async function addEventToday(page: Page, title: string, hour: number): Promise<void> {
  await page.evaluate(
    async ({ title, hour }) => {
      const now = new Date()
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, 0)
      await window.xrncal.events.create({
        calendarId: 'calendar-local-default',
        title,
        dtStartUtc: start.toISOString(),
        dtEndUtc: new Date(start.getTime() + 60 * 60_000).toISOString(),
        tzid: 'Asia/Ho_Chi_Minh'
      })
    },
    { title, hour }
  )
}

/** The week grid is up, and with it the app's key listener. */
async function gridReady(page: Page): Promise<void> {
  await expect(page.locator('[data-hour-height]').first()).toBeVisible()
}

/** Where the event called `title` starts, as HH:mm on this machine's clock - or null once it is gone. */
async function startOf(page: Page, title: string): Promise<string | null> {
  return page.evaluate(async (title) => {
    const found = (await window.xrncal.events.search(title)).find((e) => e.title === title)
    if (!found) return null
    const d = new Date(found.dtStartUtc)
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }, title)
}

test('the keyboard walks to an event, moves it, deletes it, and Ctrl+Z undoes each', async () => {
  const running = await launchApp()
  try {
    const { page } = running
    await addEventToday(page, 'Dentist', 10)
    await page.reload()
    await gridReady(page)
    await page.keyboard.press('d')
    const block = page.locator('[data-occurrence-id]', { hasText: 'Dentist' })
    await expect(block).toBeVisible()

    // The cursor lands on today's event; Enter opens it, Escape closes it.
    await page.keyboard.press('ArrowDown')
    await expect(page.locator('.is-key-selected', { hasText: 'Dentist' })).toBeVisible()
    await page.keyboard.press('Enter')
    await expect(page.getByPlaceholder('Event title…')).toHaveValue('Dentist')
    await page.keyboard.press('Escape')
    await expect(page.getByPlaceholder('Event title…')).toBeHidden()

    // Shift+Down moves it one drag step (15 minutes); Ctrl+Z puts it back.
    await page.keyboard.press('Shift+ArrowDown')
    await expect.poll(() => startOf(page, 'Dentist')).toBe('10:15')
    await page.keyboard.press('Control+z')
    await expect.poll(() => startOf(page, 'Dentist')).toBe('10:00')

    // Delete asks first, then takes it off the grid with an Undo on the toast;
    // Ctrl+Z works too.
    await expect(page.locator('.is-key-selected', { hasText: 'Dentist' })).toBeVisible()
    page.once('dialog', (dialog) => void dialog.accept())
    await page.keyboard.press('Delete')
    await expect(block).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeVisible()
    await page.keyboard.press('Control+z')
    await expect(block).toBeVisible()
    await expect.poll(() => startOf(page, 'Dentist')).toBe('10:00')

    // The view keys, and paging with the arrows once nothing is selected.
    await page.keyboard.press('m')
    await expect(page.locator('[data-day][data-all-day-slot]').first()).toBeVisible()
    await page.keyboard.press('w')
    await expect(page.locator('[data-hour-height]').first()).toBeVisible()
    expect(running.errors).toEqual([])
  } finally {
    await running.close()
  }
})

test('a setting changed in the panel is still set after a relaunch', async () => {
  const profile = newProfile()
  try {
    const first = await launchApp({ profile })
    try {
      const { page } = first
      await gridReady(page)
      await page.keyboard.press(',')
      const panel = page.locator('.gc-slide-right')
      await panel.getByRole('button', { name: 'General', exact: true }).click()
      await panel.getByRole('button', { name: 'AM/PM', exact: true }).click()
      await expect.poll(() => page.evaluate(() => window.xrncal.settings.get('timeFormat'))).toBe('12h')
      // The grid follows straight away, without a reload.
      await page.keyboard.press('Escape')
      await expect(page.getByText(/\d PM/).first()).toBeVisible()
    } finally {
      await first.close()
    }

    const second = await launchApp({ profile })
    try {
      const { page } = second
      expect(await page.evaluate(() => window.xrncal.settings.get('timeFormat'))).toBe('12h')
      await expect(page.getByText(/\d PM/).first()).toBeVisible()
      expect(second.errors).toEqual([])
    } finally {
      await second.close()
    }
  } finally {
    rmSync(profile, { recursive: true, force: true })
  }
})

test('a sync that lands while the editor is open leaves what was typed alone', async () => {
  const running = await launchApp()
  try {
    const { page, app } = running
    await addEventToday(page, 'Team lunch', 12)
    await page.reload()
    await gridReady(page)
    await page.keyboard.press('d')
    await page.locator('[data-occurrence-id]', { hasText: 'Team lunch' }).click()
    const title = page.getByPlaceholder('Event title…')
    await expect(title).toHaveValue('Team lunch')
    await title.fill('Team lunch at the noodle place')

    // What the sync worker sends after a poll that changed rows. The reload it
    // causes replaces the calendar list, which used to refill the form.
    await app.evaluate(({ BrowserWindow }) => {
      for (const w of BrowserWindow.getAllWindows()) w.webContents.send('xrncal:sync:changed')
    })
    await page.waitForTimeout(1000)
    await expect(title).toHaveValue('Team lunch at the noodle place')

    await page.keyboard.press('Control+Enter')
    await expect(title).toBeHidden()
    await expect.poll(() => startOf(page, 'Team lunch at the noodle place')).toBe('12:00')
    expect(running.errors).toEqual([])
  } finally {
    await running.close()
  }
})
