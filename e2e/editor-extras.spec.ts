import { test, expect } from '@playwright/test'
import { launchApp } from './app'

// The editor's emoji button, its Location suggestions and the default length
// of a new event, in the real window: where the panel and the list sit, what
// Escape closes, and where the keyboard is afterwards.

test('an emoji picked for the title leads it, is replaced by the next one, and can be taken off', async () => {
  const running = await launchApp()
  try {
    const { page } = running
    await page.getByRole('button', { name: 'Create' }).click()
    const title = page.getByPlaceholder('Event title…')
    await title.fill('Dinner')

    const button = page.getByRole('button', { name: 'Put an emoji in front of the title' })
    await button.click()
    const panel = page.getByRole('dialog', { name: 'Emoji' })
    await expect(panel).toBeVisible()
    // Nothing picked yet on a new profile, and nothing to remove.
    await expect(panel.getByText('Frequently used')).toHaveCount(0)
    await expect(panel.getByRole('button', { name: 'Remove the emoji' })).toHaveCount(0)

    await panel.getByRole('button', { name: '🍴', exact: true }).click()
    await expect(panel).toBeHidden()
    await expect(title).toHaveValue('🍴 Dinner')
    // The keyboard is back in the title, so typing carries on.
    await expect(title).toBeFocused()

    // The next one takes its place, and the first is now a favourite.
    await button.click()
    await expect(panel.getByRole('group', { name: 'Frequently used' }).getByRole('button', { name: '🍴', exact: true })).toBeVisible()
    await panel.getByRole('button', { name: '🎂', exact: true }).first().click()
    await expect(title).toHaveValue('🎂 Dinner')

    // Escape closes the panel and nothing else.
    await button.click()
    await expect(panel).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(panel).toBeHidden()
    await expect(title).toBeVisible()
    await expect(title).toHaveValue('🎂 Dinner')

    await button.click()
    await panel.getByRole('button', { name: 'Remove the emoji' }).click()
    await expect(title).toHaveValue('Dinner')

    await button.click()
    await panel.getByRole('button', { name: '🍴', exact: true }).first().click()
    await page.keyboard.press('Control+Enter')
    await expect(title).toBeHidden()
    // Saved with its emoji, and still found by its words.
    await expect
      .poll(() => page.evaluate(async () => (await window.xrncal.events.search('dinner')).map((e) => e.title)))
      .toEqual(['🍴 Dinner'])
    expect(running.errors).toEqual([])
  } finally {
    await running.close()
  }
})

test('the Location field offers a place used before, and Escape closes only the list', async () => {
  const running = await launchApp()
  try {
    const { page } = running
    await page.getByRole('button', { name: 'Create' }).click()
    const title = page.getByPlaceholder('Event title…')
    await title.fill('Coffee')
    const location = page.getByRole('combobox', { name: 'Location' })
    await location.fill('Cà phê Ánh Dương, 12 Lê Lợi')
    // Nothing to offer yet: this place has never been saved.
    await expect(page.getByRole('listbox', { name: 'Places used before' })).toHaveCount(0)
    await page.keyboard.press('Control+Enter')
    await expect(title).toBeHidden()

    await page.getByRole('button', { name: 'Create' }).click()
    await title.fill('Coffee again')
    // Without its accents, as it would be typed in a hurry.
    await location.pressSequentially('ca phe')
    const list = page.getByRole('listbox', { name: 'Places used before' })
    await expect(list.getByRole('option')).toHaveText(['Cà phê Ánh Dương, 12 Lê Lợi'])

    await page.keyboard.press('Escape')
    await expect(list).toBeHidden()
    await expect(title).toBeVisible()
    await expect(location).toHaveValue('ca phe')

    // Typing on brings it back; Down and Enter take it, and the event is not saved by that Enter.
    await location.pressSequentially(' a')
    await expect(list.getByRole('option')).toHaveCount(1)
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    await expect(location).toHaveValue('Cà phê Ánh Dương, 12 Lê Lợi')
    await expect(list).toBeHidden()
    await expect(title).toBeVisible()
    await expect(title).toHaveValue('Coffee again')
    expect(running.errors).toEqual([])
  } finally {
    await running.close()
  }
})

test('a new event is as long as Settings says', async () => {
  const running = await launchApp()
  try {
    const { page } = running
    // "Calendar" has "end" in it too: the row whose label starts with End.
    const end = page.locator('div.group', { hasText: /^End/ }).first().getByRole('textbox')

    await page.getByRole('button', { name: 'Create' }).click()
    await expect(end).toHaveValue('10:00')
    await page.keyboard.press('Escape')
    await expect(page.getByPlaceholder('Event title…')).toBeHidden()

    await page.evaluate(() => window.xrncal.settings.set('defaultEventMinutes', 30))
    await page.reload()
    await page.waitForLoadState('domcontentloaded')
    await page.getByRole('button', { name: 'Create' }).click()
    await expect(end).toHaveValue('09:30')
    expect(running.errors).toEqual([])
  } finally {
    await running.close()
  }
})
