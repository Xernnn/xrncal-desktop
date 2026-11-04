import { test, expect } from '@playwright/test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApp } from './app'

// What a new user does in the first five minutes: gets welcomed, makes an
// event by clicking the grid, opens it, right-clicks it.

test('a fresh profile opens on the welcome, which can be finished without an account', async () => {
  const running = await launchApp({ welcome: true })
  try {
    const { page } = running
    const welcome = page.getByRole('dialog', { name: 'Welcome to xrncal' })
    await expect(welcome).toBeVisible()
    await welcome.getByRole('button', { name: 'Next', exact: true }).click()
    await expect(welcome.getByText('A few basics')).toBeVisible()
    await welcome.getByRole('button', { name: 'Next', exact: true }).click()
    await welcome.getByRole('button', { name: 'Not now' }).click()
    await expect(welcome).toBeHidden()
    expect(await page.evaluate(() => window.xrncal.settings.get('welcomeDone'))).toBe(true)
    expect(running.errors).toEqual([])
  } finally {
    await running.close()
  }
})

test('a click on the grid or an event opens the editor; right-click duplicates', async () => {
  const running = await launchApp()
  try {
    const { page, app } = running
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows().find((w) => !w.webContents.getURL().includes('#mini'))?.setSize(1280, 820)
    })
    // The editor's time list has its own step, apart from the drag step.
    await page.evaluate(async () => {
      await window.xrncal.settings.set('dragSnapMinutes', 15)
      await window.xrncal.settings.set('timePickerStepMinutes', 30)
    })
    await page.reload()

    await expect(page.getByRole('button', { name: 'Today', exact: true })).toHaveCount(0)
    // The editor is always a side panel; with no spot on the grid to keep in
    // sight (the Create button) it comes in from the right.
    await page.getByRole('button', { name: 'Create' }).click()
    await expect(page.locator('.gc-slide-right')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByPlaceholder('Event title…')).toBeHidden()

    // Month view: a click on a day opens the full editor straight away.
    await page.keyboard.press('m')
    const day = page.locator('[data-day][data-all-day-slot]').nth(17)
    await day.click({ position: { x: 60, y: 70 } })
    const title = page.getByPlaceholder('Event title…')
    await expect(title).toBeVisible()
    await title.fill('Pick up the cake')

    await page.locator('div.group', { hasText: 'Start' }).first().getByRole('textbox').click()
    await expect(page.getByRole('button', { name: '09:30', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '09:15', exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: '09:30', exact: true }).click()

    await page.keyboard.press('Control+Enter')
    const pill = page.locator('[data-occurrence-id]', { hasText: 'Pick up the cake' })
    await expect(pill).toBeVisible()

    // A click on the event opens it in the editor too, docked to the side.
    await pill.click()
    await expect(page.getByPlaceholder('Event title…')).toHaveValue('Pick up the cake')
    await expect(page.locator('.gc-slide-left, .gc-slide-right')).toHaveCount(1)
    await page.keyboard.press('Escape')
    await expect(page.getByPlaceholder('Event title…')).toBeHidden()

    // Right-click: edit, duplicate or delete; colour stays in the editor.
    await pill.click({ button: 'right' })
    const menu = page.getByRole('menu')
    await expect(menu.getByRole('menuitem', { name: 'Edit' })).toBeVisible()
    await expect(menu.getByRole('menuitemradio')).toHaveCount(0)
    await menu.getByRole('menuitem', { name: 'Duplicate' }).click()
    await expect(page.getByPlaceholder('Event title…')).toHaveValue('Pick up the cake')
    await page.keyboard.press('Escape')
    await expect
      .poll(() => page.evaluate(async () => (await window.xrncal.events.search('cake')).length))
      .toBe(2)
    expect(running.errors).toEqual([])
  } finally {
    await running.close()
  }
})

test('closing the window leaves xrncal running in the tray', async () => {
  const running = await launchApp()
  try {
    const { app } = running
    let exited = false
    app.process().on('exit', () => {
      exited = true
    })
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows().find((w) => !w.webContents.getURL().includes('#mini'))?.close()
    })
    await new Promise((resolve) => setTimeout(resolve, 1500))
    const trayUp = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length === 0)
    expect(trayUp).toBe(true)
    expect(exited).toBe(false)
  } finally {
    await running.close()
  }
})

test('List view opens on today, however many events the previous view had loaded', async () => {
  const running = await launchApp()
  try {
    const { page } = running
    // A daily series fills every day either side of today, which is what used
    // to throw the list weeks off: it first drew the week view's events, then
    // its own range, and corrected the scroll by the whole change in height.
    await page.evaluate(async () => {
      const today = new Date()
      const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 2, 1, 2, 15))
      await window.xrncal.events.create({
        calendarId: 'calendar-local-default',
        title: 'Standup',
        dtStartUtc: start.toISOString(),
        dtEndUtc: new Date(start.getTime() + 15 * 60_000).toISOString(),
        tzid: 'Asia/Ho_Chi_Minh',
        rrule: 'FREQ=DAILY'
      })
    })
    await page.reload()
    // Week view settled with its own events, as a user would have it, then
    // List - and time for the list's own range and the past it asks for to
    // arrive, which is when the scroll used to run off.
    await expect(page.locator('[data-occurrence-id]').first()).toBeVisible()
    await page.waitForTimeout(1000)
    await page.keyboard.press('l')
    await page.waitForTimeout(2500)
    await expect(page.locator('[data-today-group]')).toBeInViewport()
  } finally {
    await running.close()
  }
})

test('an .ics file opened with xrncal is imported after the welcome', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'xrncal-ics-'))
  const file = join(dir, 'invite.ics')
  writeFileSync(
    file,
    'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:open-1\r\nDTSTART:20261024T020000Z\r\n' +
      'DTEND:20261024T030000Z\r\nSUMMARY:From a file\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n'
  )
  const running = await launchApp({ welcome: true, args: [file] })
  try {
    const { page } = running
    const welcome = page.getByRole('dialog', { name: 'Welcome to xrncal' })
    await expect(welcome).toBeVisible()
    // Not both at once: the import waits for the welcome.
    await expect(page.getByText('invite.ics')).toBeHidden()
    await welcome.getByRole('button', { name: 'Next', exact: true }).click()
    await welcome.getByRole('button', { name: 'Next', exact: true }).click()
    await welcome.getByRole('button', { name: 'Not now' }).click()

    await expect(page.getByText('invite.ics')).toBeVisible()
    await page.getByRole('button', { name: 'Import', exact: true }).click()
    await expect
      .poll(() => page.evaluate(async () => (await window.xrncal.events.search('From a file')).length))
      .toBe(1)
  } finally {
    await running.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('an event saved without a zone opens in the zone the user was in on its date', async () => {
  const running = await launchApp()
  try {
    const { page } = running
    // Google's export writes one-off events as bare UTC times; these read back
    // with the zone 'UTC'. One from before the move, one from after.
    await page.evaluate(async () => {
      await window.xrncal.settings.set('zoneHistory', 'Asia/Ho_Chi_Minh,2026-01-28=Australia/Sydney')
      for (const [title, start] of [
        ['Before the move', '2024-12-15T06:30:00.000Z'],
        ['After the move', '2026-07-07T00:00:00.000Z']
      ]) {
        await window.xrncal.events.create({
          calendarId: 'calendar-local-default',
          title,
          dtStartUtc: start,
          dtEndUtc: new Date(Date.parse(start) + 3600_000).toISOString(),
          tzid: 'UTC'
        })
      }
    })
    await page.reload()
    await expect(page.getByText('Calendars', { exact: true }).first()).toBeVisible()

    const open = async (title: string): Promise<void> => {
      await page.keyboard.press('Control+k')
      await page.getByPlaceholder(/Search events by title/).fill(title)
      await page.getByText(title).last().click()
      await expect(page.getByPlaceholder('Event title…')).toHaveValue(title)
    }
    const startRow = page.locator('div.group', { hasText: 'Start' }).first()
    const zoneRow = page.locator('div.group', { hasText: 'Time zone' }).first()

    await open('Before the move')
    await expect(zoneRow).toContainText('Asia/Ho Chi Minh')
    await expect(startRow.getByRole('textbox')).toHaveValue('13:30')
    await page.keyboard.press('Escape')
    await expect(page.getByPlaceholder('Event title…')).toBeHidden()

    // 00:00Z on 7 July is 10:00 in Sydney (AEST, UTC+10).
    await open('After the move')
    await expect(zoneRow).toContainText('Australia/Sydney')
    await expect(startRow.getByRole('textbox')).toHaveValue('10:00')
    await page.keyboard.press('Escape')
    expect(running.errors).toEqual([])
  } finally {
    await running.close()
  }
})

test('a change of the computer\'s time zone is added to Where you were by itself', async () => {
  const running = await launchApp()
  try {
    const { page } = running
    // The suite runs in Asia/Ho_Chi_Minh; say xrncal was last open in Sydney.
    await page.evaluate(async () => {
      await window.xrncal.settings.set('zoneHistory', '')
      await window.xrncal.settings.set('lastSeenZone', 'Australia/Sydney')
    })
    await page.reload()
    const today = await page.evaluate(() => new Date().toLocaleDateString('en-CA'))
    // Chromium names Vietnam's zone by its older spelling, Asia/Saigon.
    const here = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone)
    expect(['Asia/Ho_Chi_Minh', 'Asia/Saigon']).toContain(here)
    const stored = (): Promise<unknown> => page.evaluate(() => window.xrncal.settings.get('zoneHistory'))
    await expect.poll(stored).toBe(`Australia/Sydney,${today}=${here}`)
    expect(await page.evaluate(() => window.xrncal.settings.get('lastSeenZone'))).toBe(here)

    // Seen again in the same zone, nothing more is added.
    await page.reload()
    await expect(page.getByText('Calendars', { exact: true }).first()).toBeVisible()
    await page.waitForTimeout(500)
    expect(await stored()).toBe(`Australia/Sydney,${today}=${here}`)
    expect(running.errors).toEqual([])
  } finally {
    await running.close()
  }
})
