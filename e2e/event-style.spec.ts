import { expect, test, type Locator } from '@playwright/test'
import { launchApp } from './app'

const TRANSPARENT = 'rgba(0, 0, 0, 0)'
const MARKER_GREEN = 'rgb(51, 153, 68)'

function markerColor(event: Locator): Promise<string> {
  return event.evaluate((node) => getComputedStyle(node, '::before').backgroundColor)
}

test('all-day rows have a fill and timed rows keep their own color in a short marker', async () => {
  const running = await launchApp({ useDefaultView: true })
  try {
    const { page } = running
    await page.evaluate(async () => {
      const today = new Date()
      const ymd = new Intl.DateTimeFormat('sv-SE').format(today)
      today.setHours(10, 0, 0, 0)
      const calendarId = 'calendar-local-default'
      await window.xrncal.settings.set('theme', 'light')
      await window.xrncal.events.create({
        calendarId, title: 'All-day sample', color: '#d98728', allDay: true,
        dtStartUtc: `${ymd}T00:00:00.000Z`, dtEndUtc: `${ymd}T23:59:59.999Z`, tzid: 'floating'
      })
      await window.xrncal.events.create({
        calendarId, title: 'Timed sample', color: '#339944', allDay: false,
        dtStartUtc: today.toISOString(), dtEndUtc: new Date(today.getTime() + 3_600_000).toISOString(),
        tzid: Intl.DateTimeFormat().resolvedOptions().timeZone
      })
    })
    await page.reload()
    const allDay = page.locator('[data-occurrence-id]', { hasText: 'All-day sample' })
    const timed = page.locator('[data-occurrence-id]', { hasText: 'Timed sample' })
    await expect(allDay).toHaveCSS('background-color', /^color\(srgb/)
    await expect(timed).toHaveCSS('background-color', TRANSPARENT)
    await expect(timed).toHaveCSS('padding-inline-start', '14px')
    await expect.poll(() => markerColor(timed)).toBe(MARKER_GREEN)
    const lightFill = await allDay.evaluate((node) => getComputedStyle(node).backgroundColor)

    await page.evaluate(() => window.xrncal.settings.set('theme', 'dark'))
    await page.reload()
    await expect(timed).toHaveCSS('background-color', TRANSPARENT)
    await expect(timed).toHaveCSS('color', 'rgb(219, 222, 225)')
    await expect.poll(() => markerColor(timed)).toBe(MARKER_GREEN)
    await expect(allDay).toHaveCSS('background-color', /^color\(srgb/)
    await expect(allDay).not.toHaveCSS('background-color', lightFill)

    for (const shortcut of ['2', '1', '5']) {
      await page.keyboard.press(shortcut)
      await expect(timed).toHaveCSS('background-color', 'rgb(49, 51, 56)')
      await expect(timed).toHaveCSS('color', 'rgb(219, 222, 225)')
      await expect.poll(() => markerColor(timed)).toBe(MARKER_GREEN)
      await expect(allDay).toHaveCSS('background-color', /^color\(srgb/)
    }
    expect(running.errors).toEqual([])
  } finally {
    await running.close()
  }
})
