import { test, expect, type Page } from '@playwright/test'
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApp, type RunningApp } from './app'

// Ctrl+P prints, or saves as PDF, the week or month on screen: one A4
// landscape page, light whatever the theme.

/** Events on this machine's clock: a timed one and an all-day one, both today. Any other day can fall
 *  outside the week or month on screen (tomorrow is next week on the last day of the week). */
async function addEvents(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const now = new Date()
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 10, 0)
    await window.xrncal.events.create({
      calendarId: 'calendar-local-default',
      title: 'Quarterly review',
      location: 'Room 4',
      dtStartUtc: start.toISOString(),
      dtEndUtc: new Date(start.getTime() + 90 * 60_000).toISOString(),
      tzid: 'Asia/Ho_Chi_Minh'
    })
    const pad = (n: number) => String(n).padStart(2, '0')
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const date = `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`
    await window.xrncal.events.create({
      calendarId: 'calendar-local-default',
      title: 'Company holiday',
      dtStartUtc: `${date}T00:00:00.000Z`,
      dtEndUtc: `${date}T00:00:00.000Z`,
      allDay: true
    })
  })
}

/** Answer the next save dialog with `file`, as if the user had picked it. */
async function answerSaveDialog(running: RunningApp, file: string): Promise<void> {
  await running.app.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: file })) as typeof dialog.showSaveDialog
  }, file)
}

/** The pages in a PDF file. */
function pageCount(file: string): number {
  return (readFileSync(file, 'latin1').match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length
}

test('Ctrl+P saves the week and the month as one-page PDFs', async () => {
  const running = await launchApp()
  const dir = mkdtempSync(join(tmpdir(), 'xrncal-print-'))
  try {
    const { page } = running
    await addEvents(page)
    await page.evaluate(() => window.xrncal.settings.set('theme', 'dark'))
    await page.reload()
    await expect(page.locator('[data-hour-height]').first()).toBeVisible()

    await page.keyboard.press('Control+p')
    const dialog = page.getByRole('dialog', { name: 'Print' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Week' })).toHaveAttribute('aria-pressed', 'true')

    // The page printed: the timed event in the hours, the all-day one across the top.
    const host = page.locator('.gc-print-host')
    await expect(host.locator('.gc-print-block', { hasText: 'Quarterly review' })).toHaveCount(1)
    await expect(host.locator('.gc-print-bar', { hasText: 'Company holiday' })).toHaveCount(1)
    await expect(host.locator('.gc-print-block')).toContainText('10:00–11:30')
    // Paper stays white in the dark theme.
    expect(await host.locator('.gc-print-sheet').evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
      'rgb(255, 255, 255)'
    )

    const week = join(dir, 'week.pdf')
    await answerSaveDialog(running, week)
    await dialog.getByRole('button', { name: 'Save as PDF' }).click()
    await expect(page.getByText('PDF saved')).toBeVisible()
    await expect(dialog).toBeHidden()
    expect(readFileSync(week, 'latin1').startsWith('%PDF-')).toBe(true)
    expect(pageCount(week)).toBe(1)

    // The month, from the menu this time.
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await page.getByRole('button', { name: /Print or save as PDF/ }).click()
    await dialog.getByRole('button', { name: 'Month' }).click()
    await expect(host.locator('.gc-print-monthgrid')).toHaveCount(1)
    expect([28, 35, 42]).toContain(await host.locator('.gc-print-cell').count())
    await expect(host.locator('.gc-print-line', { hasText: 'Quarterly review' })).toHaveCount(1)
    await expect(host.locator('.gc-print-pill', { hasText: 'Company holiday' })).toHaveCount(1)
    const month = join(dir, 'month.pdf')
    await answerSaveDialog(running, month)
    await dialog.getByRole('button', { name: 'Save as PDF' }).click()
    await expect(dialog).toBeHidden()
    expect(pageCount(month)).toBe(1)

    // To look at them: PRINT_OUT=<folder> keeps a copy.
    if (process.env.PRINT_OUT) {
      copyFileSync(week, join(process.env.PRINT_OUT, 'week.pdf'))
      copyFileSync(month, join(process.env.PRINT_OUT, 'month.pdf'))
    }
    expect(running.errors).toEqual([])
  } finally {
    await running.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('Escape closes the print dialog, and a cancelled save leaves it open', async () => {
  const running = await launchApp()
  try {
    const { page } = running
    await expect(page.locator('[data-hour-height]').first()).toBeVisible()
    await page.keyboard.press('Control+p')
    const dialog = page.getByRole('dialog', { name: 'Print' })
    await expect(dialog).toBeVisible()

    await running.app.evaluate(({ dialog }) => {
      dialog.showSaveDialog = (async () => ({ canceled: true, filePath: '' })) as typeof dialog.showSaveDialog
    })
    await dialog.getByRole('button', { name: 'Save as PDF' }).click()
    await expect(dialog.getByRole('button', { name: 'Save as PDF' })).toBeEnabled()
    await expect(dialog).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    // The calendar has its keys back.
    await page.keyboard.press('m')
    await expect(page.locator('[data-hour-height]')).toHaveCount(0)
    expect(running.errors).toEqual([])
  } finally {
    await running.close()
  }
})
