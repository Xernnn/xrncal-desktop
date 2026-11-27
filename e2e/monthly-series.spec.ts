import { expect, test } from '@playwright/test'
import { launchApp } from './app'

test('opens CalDAV-style monthly rules and offers a series edit when an all-day occurrence is moved', async () => {
  const running = await launchApp({ useDefaultView: true })
  try {
    const { page } = running
    const allDay = await page.evaluate(async () => {
      const { settings, events } = window.xrncal
      await settings.set('locale', 'zh-CN')
      await settings.set('dateFormat', 'yyyy/MM/dd')
      await events.create({
        calendarId: 'calendar-local-default',
        title: 'Monthly payment',
        dtStartUtc: '2026-03-12T04:00:00.000Z',
        dtEndUtc: '2026-03-12T05:00:00.000Z',
        tzid: 'Asia/Shanghai',
        rrule: 'FREQ=MONTHLY;BYMONTHDAY=12;UNTIL=20270311T040000Z'
      })
      return events.create({
        calendarId: 'calendar-local-default',
        title: 'Monthly all-day expiry',
        dtStartUtc: '2026-06-09T00:00:00.000Z',
        dtEndUtc: '2026-06-09T23:59:59.999Z',
        tzid: 'floating',
        allDay: true,
        rrule: 'FREQ=MONTHLY;BYMONTHDAY=9;UNTIL=20270609T000000Z'
      })
    })
    await page.reload()
    const header = page.getByRole('banner')
    await header.getByRole('combobox', { name: '选择年份' }).selectOption('2026')
    await header.getByRole('combobox', { name: '选择月份' }).selectOption('11')

    const editor = page.getByRole('dialog', { name: '编辑日程' })
    const series = page.getByRole('dialog', { name: '修改系列' })
    await page.locator('[data-occurrence-id]', { hasText: 'Monthly payment' }).click()
    await editor.getByRole('button', { name: '修改系列' }).click()
    await expect(series.getByRole('button', { name: '每月', exact: true })).toBeVisible()
    await expect(series.getByText('每月第 12 日', { exact: true })).toBeVisible()
    await expect(series.getByRole('button', { name: '2027/03/11', exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(series).toBeHidden()

    const occurrence = page.locator('[data-occurrence-id]', { hasText: 'Monthly all-day expiry' })
    await occurrence.click()
    await editor.getByRole('button', { name: '修改系列' }).click()
    await expect(series.getByRole('button', { name: '2027/06/09', exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(series).toBeHidden()

    const target = page.locator('[data-day="2026-11-10"][data-all-day-slot]')
    await occurrence.dragTo(target, { targetPosition: { x: 20, y: 28 } })
    const scope = page.getByRole('dialog', { name: '编辑重复日程' })
    await expect(scope.getByRole('button', { name: '仅此日程' })).toBeVisible()
    await expect(scope.getByRole('button', { name: '此日程及之后的日程' })).toBeVisible()
    await scope.getByRole('button', { name: '重复系列中的所有日程' }).click()

    await expect.poll(() => page.evaluate(async (id) => {
      const saved = (await window.xrncal.events.getById(id))?.event
      return { start: saved?.dtStartUtc, end: saved?.dtEndUtc, rrule: saved?.rrule }
    }, allDay.id)).toEqual({
      start: '2026-06-10T00:00:00.000Z',
      end: '2026-06-10T23:59:59.999Z',
      rrule: 'FREQ=MONTHLY;BYMONTHDAY=10;UNTIL=20270610T000000Z'
    })

    await page.locator('[data-day="2026-11-10"] [data-occurrence-id]', { hasText: 'Monthly all-day expiry' }).click()
    await editor.getByRole('button', { name: '2026/11/10', exact: true }).first().click()
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('Enter')
    await expect(editor.getByRole('button', { name: '2026/11/09', exact: true })).toHaveCount(2)
    await editor.getByRole('button', { name: '保存更改' }).click()
    await expect(editor).toBeHidden()
    await expect(scope).toBeHidden()
    await expect.poll(() => page.evaluate(async (id) => {
      const snapshot = await window.xrncal.events.getById(id)
      return { rule: snapshot?.event.rrule, end: snapshot?.exceptions[0]?.dtEndUtc }
    }, allDay.id)).toEqual({ end: '2026-11-09T23:59:59.999Z', rule: 'FREQ=MONTHLY;BYMONTHDAY=10;UNTIL=20270610T000000Z' })
    expect(running.errors).toEqual([])
  } finally {
    await running.close()
  }
})
