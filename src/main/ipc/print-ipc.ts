import { app, ipcMain, dialog, BrowserWindow, shell, type WebContents } from 'electron'
import { writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { IPC_CHANNELS, type PdfExportResult, type PrintResult } from '../../shared/ipc-contract'
import { log } from '../log'
import { describeError } from '../sync/http'

/**
 * Printing and PDF export of the week or month the print dialog shows. The
 * renderer draws one page into `.gc-print-host` and hides everything else for
 * print (`@media print` in index.css); these print the sender's page as it is.
 */

/** The PDF saved last, so "Show in folder" can show it without the renderer naming a path. */
let lastSaved: string | null = null

/** A file name the renderer suggested, made safe to offer: no folders, no odd characters, ending .pdf. */
export function pdfFileName(suggested: unknown): string {
  const raw = typeof suggested === 'string' ? suggested : ''
  const printable = [...raw].filter((ch) => ch.charCodeAt(0) >= 32).join('')
  const clean = printable
    .replace(/\.pdf$/i, '')
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
  return `${clean || 'xrncal'}.pdf`
}

const pdfOptions: Electron.PrintToPDFOptions = {
  landscape: true,
  pageSize: 'A4',
  printBackground: true,
  // The sheet sets its own size and margins (@page in index.css).
  preferCSSPageSize: true,
  margins: { top: 0, bottom: 0, left: 0, right: 0 }
}

export async function savePdf(sender: WebContents, suggested: unknown): Promise<PdfExportResult> {
  const win = BrowserWindow.fromWebContents(sender)
  const options: Electron.SaveDialogOptions = {
    defaultPath: join(app.getPath('documents'), pdfFileName(suggested)),
    filters: [{ name: 'PDF', extensions: ['pdf'] }]
  }
  const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
  if (result.canceled || !result.filePath) return { saved: false }
  const filePath = /\.pdf$/i.test(result.filePath) ? result.filePath : `${result.filePath}.pdf`
  try {
    await writeFile(filePath, await sender.printToPDF(pdfOptions))
  } catch (err) {
    log('error', `print: saving a PDF failed: ${describeError(err)}`)
    throw err
  }
  lastSaved = filePath
  return { saved: true, fileName: basename(filePath) }
}

export function printSheet(sender: WebContents): Promise<PrintResult> {
  return new Promise((resolve) => {
    sender.print({ silent: false, printBackground: true, landscape: true, pageSize: 'A4' }, (printed, failureReason) => {
      // Closing the dialog is not a failure worth a message.
      const cancelled = !printed && /cancel/i.test(failureReason || '')
      if (!printed && !cancelled) log('error', `print: printing failed: ${failureReason}`)
      resolve(printed || cancelled ? { printed } : { printed, error: failureReason || 'unknown' })
    })
  })
}

export function registerPrintIpcHandlers(): void {
  ipcMain.removeHandler(IPC_CHANNELS.PRINT.SAVE_PDF)
  ipcMain.removeHandler(IPC_CHANNELS.PRINT.PRINT)
  ipcMain.removeHandler(IPC_CHANNELS.PRINT.SHOW_SAVED)

  ipcMain.handle(IPC_CHANNELS.PRINT.SAVE_PDF, (event, suggested: unknown) => savePdf(event.sender, suggested))
  ipcMain.handle(IPC_CHANNELS.PRINT.PRINT, (event) => printSheet(event.sender))
  ipcMain.handle(IPC_CHANNELS.PRINT.SHOW_SAVED, () => {
    if (!lastSaved) return false
    shell.showItemInFolder(lastSaved)
    return true
  })
}
