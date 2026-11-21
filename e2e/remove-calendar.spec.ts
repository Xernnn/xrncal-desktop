import { test, expect } from '@playwright/test'
import { launchApp, type RunningApp } from './app'

/**
 * The Personal Calendar a fresh profile starts with can be removed like any
 * other calendar on this computer; one that holds events asks first whether
 * to move them or delete them with it, and the default moves on. The last
 * calendar new events could go into cannot be removed.
 */

let running: RunningApp

test.beforeAll(async () => {
  running = await launchApp()
})

test.afterAll(async () => {
  await running?.close()
})

test('removes the Personal Calendar after moving its events, and keeps the last calendar', async () => {
  const { page, errors } = running
  const { tripsId, eventId } = await page.evaluate(async () => {
    const trips = await window.xrncal.calendars.create({ name: 'Trips', color: '#ffb74d' })
    const event = await window.xrncal.events.create({
      calendarId: 'calendar-local-default',
      title: 'Piano lesson',
      dtStartUtc: '2026-03-02T09:00:00.000Z',
      dtEndUtc: '2026-03-02T10:00:00.000Z'
    })
    return { tripsId: trips.id, eventId: event.id }
  })
  await page.reload()

  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('button', { name: /Calendars & accounts/ }).click()
  const dialog = page.locator('.gc-dialog')
  await dialog.getByRole('button', { name: /On this computer/ }).click()
  await dialog.locator('div.group', { hasText: 'Personal Calendar' }).getByRole('button', { name: 'Delete calendar' }).click()

  await expect(dialog.getByText('What should happen to the event in Personal Calendar?')).toBeVisible()
  await expect(dialog.getByRole('radio', { name: 'Move to another calendar' })).toBeChecked()
  await expect(dialog.getByRole('button', { name: /Trips/ })).toBeVisible()
  await dialog.getByRole('button', { name: 'Delete calendar' }).click()

  await expect(page.getByText('1 event moved to Trips')).toBeVisible()
  await expect
    .poll(async () => page.evaluate(async () => (await window.xrncal.calendars.list()).map((c) => [c.name, c.isDefault])))
    .toEqual([['Trips', true]])
  expect(await page.evaluate(async (id) => (await window.xrncal.events.getById(id))?.event.calendarId, eventId)).toBe(tripsId)

  // Trips is all that is left to write to.
  await expect(dialog.locator('div.group', { hasText: 'Trips' })).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Delete calendar' })).toHaveCount(0)
  expect(errors).toEqual([])
})
