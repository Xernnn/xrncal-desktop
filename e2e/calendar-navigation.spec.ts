import { expect, test } from '@playwright/test'
import { launchApp } from './app'

test('selects year and month in either header and shows a Thursday series when opened from the grid', async () => {
  const running = await launchApp({ useDefaultView: true })
  try {
    const { page } = running
    const rule = 'FREQ=WEEKLY;INTERVAL=1;BYDAY=TH'
    const event = await page.evaluate(async (rrule) => {
      await window.xrncal.settings.set('locale', 'zh-CN')
      return window.xrncal.events.create({
        calendarId: 'calendar-local-default',
        title: 'Thursday appointment',
        dtStartUtc: '2027-02-04T01:00:00.000Z',
        dtEndUtc: '2027-02-04T01:30:00.000Z',
        tzid: 'Asia/Shanghai',
        rrule
      })
    }, rule)
    await page.reload()

    const header = page.getByRole('banner')
    const sidebar = page.getByRole('complementary')
    const year = header.getByRole('combobox', { name: '选择年份' })
    const month = header.getByRole('combobox', { name: '选择月份' })
    await expect(header.getByRole('heading').getByText('年', { exact: true })).toBeVisible()
    await expect(header.getByRole('heading').getByText('月', { exact: true })).toBeVisible()
    const todayYear = await year.inputValue()
    const todayMonth = await month.inputValue()
    await expect(header.getByRole('button', { name: '回到今天' })).toBeHidden()
    await year.selectOption(String(Number(todayYear) + 1))
    await expect(header.getByRole('button', { name: '回到今天' })).toBeVisible()
    await sidebar.getByRole('button', { name: '回到今天' }).click()
    await expect(year).toHaveValue(todayYear)
    await expect(month).toHaveValue(todayMonth)
    await expect(header.getByRole('button', { name: '回到今天' })).toBeHidden()

    await year.selectOption('2027')
    await month.selectOption('2')
    await expect(sidebar.getByRole('combobox', { name: '选择年份' })).toHaveValue('2027')

    const sidebarMonth = sidebar.getByRole('combobox', { name: '选择月份' })
    await expect(sidebarMonth).toHaveValue('2')
    await sidebarMonth.selectOption('3')
    await expect(month).toHaveValue('3')
    await expect(page.locator('[data-day="2027-03-15"]')).toBeVisible()
    await sidebarMonth.selectOption('2')

    await page.locator('[data-occurrence-id]', { hasText: 'Thursday appointment' }).first().click()
    const occurrence = page.getByRole('dialog', { name: '编辑日程' })
    await expect(occurrence.getByText('此日程属于重复系列。')).toBeVisible()
    await occurrence.getByRole('button', { name: '修改系列', exact: true }).click()
    const editor = page.getByRole('dialog', { name: '修改系列' })
    await expect(editor.getByRole('button', { name: '每周', exact: true })).toBeVisible()
    await expect(editor.getByRole('button', { name: '四', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await editor.getByPlaceholder('日程标题…').fill('Thursday appointment edited')
    await editor.getByRole('button', { name: '保存更改' }).click()

    await expect.poll(() => page.evaluate(async (id) => {
      const saved = await window.xrncal.events.getById(id)
      return { title: saved?.event.title, rrule: saved?.event.rrule }
    }, event.id)).toEqual({ title: 'Thursday appointment edited', rrule: rule })
    expect(running.errors).toEqual([])
  } finally {
    await running.close()
  }
})
