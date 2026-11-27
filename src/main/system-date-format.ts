import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

/** Windows keeps the user's exact short-date pattern separately from its regional locale. */
export async function windowsShortDateFormat(): Promise<string | undefined> {
  if (process.platform !== 'win32') return undefined

  const powershell = join(process.env.SystemRoot ?? 'C:/Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  const script = [
    '[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)',
    "Get-ItemPropertyValue -LiteralPath 'HKCU:\\Control Panel\\International' -Name sShortDate"
  ].join('\n')
  try {
    const { stdout } = await run(powershell, ['-NoProfile', '-NonInteractive', '-Command', script], {
      windowsHide: true,
      timeout: 3000
    })
    const pattern = stdout.trim()
    if (!pattern || pattern.length > 80) return undefined
    // Windows uses ddd/dddd for weekdays and Luxon uses ccc/cccc.
    return pattern.replace(/'[^']*'|d{3,4}/g, (token) => token.startsWith("'") ? token : 'c'.repeat(token.length))
  } catch {
    return undefined
  }
}
