import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Vitest global setup for `npm run test:caldav`: a real Radicale on a free
 * local port, with two users (`alice` / `wonderland`, `bob` / `builder`) and an empty store that
 * is thrown away afterwards. The tests get its address from `inject('radicaleUrl')`.
 *
 * Radicale is a Python program: `pip install radicale`, or point
 * XRNCAL_RADICALE at the `radicale` executable (a virtualenv's, say).
 * XRNCAL_RADICALE_LOG=info (or debug) shows what the server makes of each
 * request, which is how to find out why it refused one.
 */

declare module 'vitest' {
  export interface ProvidedContext {
    radicaleUrl: string
  }
}

export const RADICALE_USER = 'alice'
export const RADICALE_PASSWORD = 'wonderland'
/** A second account, so a test file can have a calendar home to itself. */
export const RADICALE_USER_2 = 'bob'
export const RADICALE_PASSWORD_2 = 'builder'

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.unref()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close(() => resolve(port))
    })
  })
}

async function waitUntilUp(url: string, child: ChildProcess, log: () => string): Promise<void> {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Radicale exited with ${child.exitCode}:\n${log()}`)
    try {
      // Any answer at all (401 without credentials) means it is listening.
      await fetch(url, { signal: AbortSignal.timeout(1000) })
      return
    } catch {
      await new Promise((r) => setTimeout(r, 200))
    }
  }
  throw new Error(`Radicale did not answer at ${url} within 20 s:\n${log()}`)
}

export default async function setup({ provide }: { provide: (key: 'radicaleUrl', value: string) => void }) {
  const dir = mkdtempSync(join(tmpdir(), 'xrncal-radicale-'))
  const port = await freePort()
  writeFileSync(join(dir, 'users'), `${RADICALE_USER}:${RADICALE_PASSWORD}\n${RADICALE_USER_2}:${RADICALE_PASSWORD_2}\n`)
  writeFileSync(
    join(dir, 'config'),
    [
      '[server]',
      `hosts = 127.0.0.1:${port}`,
      '[auth]',
      'type = htpasswd',
      `htpasswd_filename = ${join(dir, 'users')}`,
      'htpasswd_encryption = plain',
      '[rights]',
      'type = owner_only',
      '[storage]',
      `filesystem_folder = ${join(dir, 'collections')}`,
      '[logging]',
      `level = ${process.env.XRNCAL_RADICALE_LOG || 'warning'}`,
      'mask_passwords = True',
      // With XRNCAL_RADICALE_LOG set, a refused PUT is logged with what was sent.
      `bad_put_request_content = ${process.env.XRNCAL_RADICALE_LOG ? 'True' : 'False'}`,
      ''
    ].join('\n')
  )

  const bin = process.env.XRNCAL_RADICALE || 'radicale'
  let output = ''
  const child = spawn(bin, ['--config', join(dir, 'config')], { stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout?.on('data', (chunk) => (output += chunk))
  child.stderr?.on('data', (chunk) => (output += chunk))
  if (process.env.XRNCAL_RADICALE_LOG) child.stderr?.pipe(process.stderr)
  const spawned = new Promise<void>((resolve, reject) => {
    child.once('spawn', resolve)
    child.once('error', (err) =>
      reject(new Error(`Could not start ${bin} (${err.message}). Install it with "pip install radicale", or set XRNCAL_RADICALE.`))
    )
  })
  await spawned

  const url = `http://127.0.0.1:${port}/`
  try {
    await waitUntilUp(url, child, () => output)
  } catch (err) {
    child.kill()
    rmSync(dir, { recursive: true, force: true })
    throw err
  }
  provide('radicaleUrl', url)

  return async () => {
    if (child.exitCode === null) {
      const exited = new Promise((r) => child.once('exit', r))
      child.kill()
      await exited
    }
    rmSync(dir, { recursive: true, force: true })
  }
}
