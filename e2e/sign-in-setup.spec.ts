import { test, expect, type ElectronApplication } from '@playwright/test'
import { rmSync } from 'node:fs'
import { launchApp, newProfile, type RunningApp } from './app'

const GOOGLE_ID = '1234-abc.apps.googleusercontent.com'
const SECRET = 'GOCSPX-not-a-real-secret'
const MICROSOFT_ID = '12345678-1234-1234-1234-123456789012'

let running: RunningApp

/** CI has no keyring, and nothing here should touch the desktop's. */
function fakeKeyring(app: ElectronApplication): Promise<void> {
  return app.evaluate(({ safeStorage }) => {
    safeStorage.isEncryptionAvailable = () => true
    safeStorage.getSelectedStorageBackend = () => 'gnome_libsecret'
    safeStorage.encryptString = (text: string) => Buffer.from(text)
    safeStorage.decryptString = (buffer: Buffer) => buffer.toString()
  })
}

test.beforeEach(async () => {
  running = await launchApp()
  await fakeKeyring(running.app)
  // The browser is recorded rather than opened, as in smoke.spec.ts.
  await running.app.evaluate(({ shell }) => {
    const opened: string[] = []
    ;(globalThis as { openedExternally?: string[] }).openedExternally = opened
    shell.openExternal = async (url: string) => {
      opened.push(url)
    }
  })
})

test.afterEach(async () => {
  await running.close()
})

async function openProvider(name: string): Promise<void> {
  const { page } = running
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('button', { name: /Calendars & accounts/ }).click()
  await page.locator('.gc-dialog').getByRole('button', { name: /Add account/ }).click()
  await expect(page.getByRole('button', { name: new RegExp(`^${name}`) })).toContainText('Set up once, then sign in')
  await page.getByRole('button', { name: new RegExp(`^${name}`) }).click()
}

const browserLinks = () =>
  running.app.evaluate(() => (globalThis as { openedExternally?: string[] }).openedExternally ?? [])

test('Google details are entered in the app, and sign-in uses them with no restart', async () => {
  const { page } = running
  await openProvider('Google')

  await expect(page.getByText('Create a project')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Open' })).toHaveCount(5)

  const save = page.getByRole('button', { name: 'Save and continue' })
  await save.click()
  await expect(page.getByText('Paste the ID here.')).toBeVisible()

  await page.getByLabel('Client ID').fill('not an id')
  await page.getByLabel('Client secret').fill(SECRET)
  await save.click()
  await expect(page.getByText('A Client ID ends in .apps.googleusercontent.com.')).toBeVisible()

  await page.getByLabel('Client ID').fill(`  ${GOOGLE_ID} `)
  await save.click()

  await expect(page.getByRole('button', { name: 'Continue in browser' })).toBeVisible()
  await page.getByRole('button', { name: 'Continue in browser' }).click()
  await expect.poll(async () => (await browserLinks()).length).toBe(1)
  const signIn = new URL((await browserLinks())[0])
  expect(signIn.hostname).toBe('accounts.google.com')
  expect(signIn.searchParams.get('client_id')).toBe(GOOGLE_ID)

  // The secret stays in main: not in anything the page can ask for.
  const seen = await page.evaluate(async () => ({
    info: await window.xrncal.auth.oauthClient('google'),
    settings: await window.xrncal.settings.getAll()
  }))
  expect(seen.info).toMatchObject({ source: 'saved', clientId: GOOGLE_ID, hasSecret: true })
  expect(JSON.stringify(seen)).not.toContain(SECRET)
  expect(running.errors).toEqual([])
})

test('saved details can be changed and removed, and the secret is kept unless replaced', async () => {
  const { page } = running
  await page.evaluate(
    ([clientId, clientSecret]) => window.xrncal.auth.saveOAuthClient('google', { clientId, clientSecret }),
    [GOOGLE_ID, SECRET]
  )
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('button', { name: /Calendars & accounts/ }).click()
  await page.locator('.gc-dialog').getByRole('button', { name: /Add account/ }).click()
  await page.getByRole('button', { name: /^Google/ }).click()

  await page.getByRole('button', { name: 'Change your Google sign-in details' }).click()
  await expect(page.getByLabel('Client ID')).toHaveValue(GOOGLE_ID)
  await expect(page.getByLabel('Client secret')).toHaveValue('')
  await page.getByRole('button', { name: 'Save and continue' }).click()
  await expect(page.getByRole('button', { name: 'Continue in browser' })).toBeVisible()
  expect(await page.evaluate(() => window.xrncal.auth.oauthClient('google'))).toMatchObject({ hasSecret: true })

  await page.getByRole('button', { name: 'Change your Google sign-in details' }).click()
  await page.getByRole('button', { name: 'Remove' }).click()
  await expect(page.getByLabel('Client ID')).toHaveValue('')
  expect(await page.evaluate(() => window.xrncal.auth.oauthClient('google'))).toMatchObject({ source: 'none' })
})

test('Microsoft asks for one id, and sends the redirect its steps say to register', async () => {
  const { page } = running
  await openProvider('Microsoft')

  await expect(page.getByText('http://localhost/oauth2callback')).toBeVisible()
  await expect(page.getByLabel('Client secret')).toHaveCount(0)
  await page.getByLabel('Application (client) ID').fill(MICROSOFT_ID)
  await page.getByRole('button', { name: 'Save and continue' }).click()

  await page.getByRole('button', { name: 'Continue in browser' }).click()
  await expect.poll(async () => (await browserLinks()).length).toBe(1)
  const signIn = new URL((await browserLinks())[0])
  expect(signIn.searchParams.get('client_id')).toBe(MICROSOFT_ID)
  expect(signIn.searchParams.get('redirect_uri')).toMatch(/^http:\/\/localhost:\d+\/oauth2callback$/)
})

test('saved details are still there after a restart', async () => {
  const profile = newProfile()
  try {
    const first = await launchApp({ profile })
    await fakeKeyring(first.app)
    await first.page.evaluate(
      ([clientId, clientSecret]) => window.xrncal.auth.saveOAuthClient('google', { clientId, clientSecret }),
      [GOOGLE_ID, SECRET]
    )
    await first.close()

    const second = await launchApp({ profile })
    await fakeKeyring(second.app)
    expect(await second.page.evaluate(() => window.xrncal.auth.oauthClient('google'))).toMatchObject({
      source: 'saved',
      clientId: GOOGLE_ID,
      hasSecret: true
    })
    await second.close()
  } finally {
    rmSync(profile, { recursive: true, force: true })
  }
})

test('the first-run welcome leads to the form rather than a dead end', async () => {
  const welcomed = await launchApp({ welcome: true })
  try {
    const { page } = welcomed
    const welcome = page.getByRole('dialog', { name: 'Welcome to xrncal' })
    await welcome.getByRole('button', { name: 'Next', exact: true }).click()
    await welcome.getByRole('button', { name: 'Next', exact: true }).click()
    await expect(welcome.getByRole('button', { name: /^Google/ })).toContainText('Set up once, then sign in')
    await welcome.getByRole('button', { name: /^Google/ }).click()
    await expect(page.locator('.gc-dialog').getByLabel('Client ID')).toBeVisible()
  } finally {
    await welcomed.close()
  }
})

test('without a keyring it says so and stores nothing', async () => {
  const { app, page } = running
  await app.evaluate(({ safeStorage }) => {
    safeStorage.isEncryptionAvailable = () => false
  })
  await openProvider('Google')
  await expect(page.getByText(/keyring is unavailable/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Save and continue' })).toBeDisabled()
  await expect(page.getByLabel('Client ID')).toBeDisabled()
})
