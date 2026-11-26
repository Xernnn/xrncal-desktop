import { createServer } from 'node:http'
import { once } from 'node:events'
import { expect, test } from '@playwright/test'
import { launchApp, type RunningApp } from './app'

test('the toolbar refreshes all configured feeds or just the selected calendar', async () => {
  const requests: string[] = []
  const server = createServer((req, res) => {
    requests.push(req.url ?? '')
    res.end('BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n')
  })
  let running: RunningApp | undefined
  try {
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Calendar test server did not open a TCP port')
    const base = `http://127.0.0.1:${address.port}`
    running = await launchApp()
    const { page } = running
    await page.evaluate(async (url) => {
      await window.xrncal.settings.set('locale', 'zh-CN')
      await window.xrncal.subscriptions.add(`${url}/first.ics`, 'First online calendar')
      await window.xrncal.subscriptions.add(`${url}/second.ics`, 'Second online calendar')
    }, base)
    await page.reload()

    const header = page.getByRole('banner')
    const sync = header.getByRole('button', { name: '立即同步', exact: true })
    const choose = header.getByRole('button', { name: '同步指定账户或订阅', exact: true })
    await expect(sync).toBeEnabled()
    await choose.click()
    await expect(header.getByRole('button', { name: 'Second online calendar', exact: true })).toBeVisible()
    requests.length = 0
    await header.getByRole('button', { name: 'First online calendar', exact: true }).click()
    await expect(page.getByText('同步完成', { exact: true })).toBeVisible()
    expect(requests).toEqual(['/first.ics'])

    requests.length = 0
    await sync.click()
    await expect.poll(() => [...requests].sort()).toEqual(['/first.ics', '/second.ics'])
    await expect(sync).toBeEnabled()
    expect(running.errors).toEqual([])
  } finally {
    try {
      await running?.close()
    } finally {
      server.close()
    }
  }
})
