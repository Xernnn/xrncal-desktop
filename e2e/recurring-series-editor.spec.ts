import { expect, test } from '@playwright/test'
import { launchApp } from './app'

test('edits one quarterly occurrence by default and opens the original series on request', async () => {
  const running = await launchApp({ useDefaultView: true })
  try {
    const { page } = running
    const rule = 'FREQ=MONTHLY;INTERVAL=3;BYSETPOS=3;BYDAY=WE'
    const master = await page.evaluate(async (rrule) => {
      const { settings, events } = window.xrncal
      await settings.set('locale', 'zh-CN')
      await settings.set('dateFormat', 'yyyy/MM/dd')
      return events.create({
        calendarId: 'calendar-local-default',
        title: 'Quarterly recovery test',
        dtStartUtc: '2025-12-17T00:00:00.000Z',
        dtEndUtc: '2025-12-17T23:59:59.999Z',
        tzid: 'floating',
        allDay: true,
        rrule
      })
    }, rule)
    await page.reload()

    const header = page.getByRole('banner')
    await header.getByRole('combobox', { name: '选择年份' }).selectOption('2026')
    await header.getByRole('combobox', { name: '选择月份' }).selectOption('12')
    const scheduled = page.locator('[data-day="2026-12-16"] [data-occurrence-id]')
    await scheduled.getByText('Quarterly recovery test', { exact: true }).click()
    const occurrence = page.getByRole('dialog', { name: '编辑日程' })
    await expect(occurrence.getByText('此日程属于重复系列。')).toBeVisible()
    await expect(occurrence.getByRole('button', { name: '2026/12/16', exact: true })).toHaveCount(2)
    await occurrence.getByPlaceholder('日程标题…').fill('Recovery test with extra checks')
    await occurrence.getByRole('button', { name: '保存更改' }).click()
    await expect(occurrence).toBeHidden()
    await expect(page.getByRole('dialog', { name: '编辑重复日程' })).toBeHidden()

    await scheduled.getByText('Recovery test with extra checks', { exact: true }).click()
    await occurrence.getByRole('button', { name: '修改系列', exact: true }).click()
    const series = page.getByRole('dialog', { name: '修改系列' })
    await expect(series.getByPlaceholder('日程标题…')).toHaveValue('Quarterly recovery test')
    await expect(series.getByRole('button', { name: '2025/12/17', exact: true })).toHaveCount(2)
    await expect(series.getByRole('button', { name: '每月', exact: true })).toBeVisible()
    await expect(series.getByRole('button', { name: '第 3 个', exact: true })).toBeVisible()
    await expect(series.getByRole('button', { name: '星期三', exact: true })).toBeVisible()
    await series.getByPlaceholder('日程标题…').fill('Quarterly recovery and reporting')
    await series.getByRole('button', { name: '保存更改' }).click()
    await expect(series).toBeHidden()

    const updated = await page.evaluate((id) => window.xrncal.events.getById(id), master.id)
    expect(updated?.event.title).toBe('Quarterly recovery and reporting')
    expect(updated?.event.rrule).toBe(rule)
    expect(updated?.exceptions.map((record) => record.title)).toEqual(['Recovery test with extra checks'])
    await header.getByRole('combobox', { name: '选择年份' }).selectOption('2027')
    await header.getByRole('combobox', { name: '选择月份' }).selectOption('3')
    await expect(page.locator('[data-day="2027-03-17"]').getByText('Quarterly recovery and reporting', { exact: true })).toBeVisible()
    expect(running.errors).toEqual([])
  } finally {
    await running.close()
  }
})
