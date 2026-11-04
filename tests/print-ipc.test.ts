import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const handlers = new Map<string, (...args: unknown[]) => unknown>()
const saveDialog = vi.fn()
const showItemInFolder = vi.fn()

vi.mock('electron', async () => {
  const stub = await vi.importActual<Record<string, unknown>>('./stubs/electron')
  return {
    ...stub,
    ipcMain: {
      handle: (channel: string, fn: (...args: unknown[]) => unknown) => handlers.set(channel, fn),
      on: () => undefined,
      removeHandler: () => undefined
    },
    BrowserWindow: class {
      static fromWebContents = () => null
    },
    dialog: { showSaveDialog: (...args: unknown[]) => saveDialog(...args) },
    shell: { showItemInFolder: (...args: unknown[]) => showItemInFolder(...args) }
  }
})

const { pdfFileName, registerPrintIpcHandlers } = await import('../src/main/ipc/print-ipc')
const { IPC_CHANNELS } = await import('../src/shared/ipc-contract')

describe('pdfFileName', () => {
  it.each([
    ['xrncal 2026-11.pdf', 'xrncal 2026-11.pdf'],
    ['xrncal 2026-W45', 'xrncal 2026-W45.pdf'],
    ['../../etc/passwd', '.. .. etc passwd.pdf'],
    ['a:b*c?d"e<f>g|h', 'a b c d e f g h.pdf'],
    ['bad\u0000\u001fname', 'badname.pdf'],
    ['', 'xrncal.pdf'],
    [42, 'xrncal.pdf']
  ])('%j -> %j', (input, expected) => {
    expect(pdfFileName(input)).toBe(expected)
  })

  it('keeps a long name to 80 characters', () => {
    expect(pdfFileName('x'.repeat(200))).toBe(`${'x'.repeat(80)}.pdf`)
  })
})

describe('print IPC', () => {
  registerPrintIpcHandlers()
  const pdf = Buffer.from('%PDF-1.4 test')
  const sender = { printToPDF: vi.fn(async () => pdf), print: vi.fn() }
  const call = (channel: string, ...args: unknown[]) => handlers.get(channel)!({ sender }, ...args)

  beforeEach(() => {
    saveDialog.mockReset()
    showItemInFolder.mockReset()
    sender.printToPDF.mockClear()
  })

  it('has nothing to show before a PDF is saved, and saves nothing when the dialog is cancelled', async () => {
    expect(await call(IPC_CHANNELS.PRINT.SHOW_SAVED)).toBe(false)
    saveDialog.mockResolvedValue({ canceled: true })
    expect(await call(IPC_CHANNELS.PRINT.SAVE_PDF, 'xrncal 2026-11.pdf')).toEqual({ saved: false })
    expect(sender.printToPDF).not.toHaveBeenCalled()
  })

  it('prints the page to the file picked, A4 landscape, and can show it after', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'xrncal-pdf-'))
    saveDialog.mockResolvedValue({ canceled: false, filePath: join(dir, 'November') })
    expect(await call(IPC_CHANNELS.PRINT.SAVE_PDF, 'xrncal 2026-11.pdf')).toEqual({
      saved: true,
      fileName: 'November.pdf'
    })
    expect(saveDialog.mock.calls[0][0]).toMatchObject({ defaultPath: join('/tmp', 'xrncal 2026-11.pdf') })
    expect(sender.printToPDF).toHaveBeenCalledWith(
      expect.objectContaining({ landscape: true, pageSize: 'A4', printBackground: true, preferCSSPageSize: true })
    )
    const file = join(dir, 'November.pdf')
    expect(existsSync(file)).toBe(true)
    expect(readFileSync(file, 'utf8')).toBe('%PDF-1.4 test')

    expect(await call(IPC_CHANNELS.PRINT.SHOW_SAVED)).toBe(true)
    expect(showItemInFolder).toHaveBeenCalledWith(file)
  })

  it('reports a failed print but not a cancelled one', async () => {
    sender.print.mockImplementationOnce((_options: unknown, done: (ok: boolean, reason: string) => void) =>
      done(false, 'cancelled')
    )
    expect(await call(IPC_CHANNELS.PRINT.PRINT)).toEqual({ printed: false })
    sender.print.mockImplementationOnce((_options: unknown, done: (ok: boolean, reason: string) => void) =>
      done(false, 'Printer is offline')
    )
    expect(await call(IPC_CHANNELS.PRINT.PRINT)).toEqual({ printed: false, error: 'Printer is offline' })
    sender.print.mockImplementationOnce((_options: unknown, done: (ok: boolean, reason: string) => void) => done(true, ''))
    expect(await call(IPC_CHANNELS.PRINT.PRINT)).toEqual({ printed: true })
  })
})
