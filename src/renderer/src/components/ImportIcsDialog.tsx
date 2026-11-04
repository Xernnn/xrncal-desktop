import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FileUp, X } from 'lucide-react'
import type { Calendar } from '@shared/event-model'
import type { OpenedIcsFile } from '@shared/ipc-contract'
import { defaultCalendarFor } from '../lib/new-event'
import { CustomSelect, showFriendlyError, toast } from './ui'

interface ImportIcsDialogProps {
  /** The files to import; null while closed. */
  files: OpenedIcsFile[] | null
  calendars: Calendar[]
  onClose: () => void
  onImported: () => void
}

/**
 * Import .ics files - picked in Settings, dropped on the window, or opened
 * with xrncal from the file manager - into a calendar the user chooses. The
 * events are copies: a guest list is not brought along (see the import handler).
 */
export const ImportIcsDialog: React.FC<ImportIcsDialogProps> = ({ files, calendars, onClose, onImported }) => {
  const { t } = useTranslation()
  // The calendar picked here, else the default one - which may only be known
  // once the calendars have loaded, when xrncal was opened with the file.
  const [picked, setPicked] = useState('')
  const calendarId = picked || defaultCalendarFor(calendars)?.id || ''
  // The files being imported; a new batch is never busy.
  const [importing, setImporting] = useState<OpenedIcsFile[] | null>(null)
  const busy = importing !== null && importing === files

  useEffect(() => {
    if (!files) return
    // Bubble phase, like the event editor: an open calendar picker stops its
    // own Escape, so this only fires when nothing smaller is open.
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [files, onClose])

  if (!files || files.length === 0) return null

  const writable = calendars.filter((c) => !c.isReadOnly)

  const runImport = async (): Promise<void> => {
    if (!files || !calendarId || !window.xrncal?.ics) return
    setImporting(files)
    let imported = 0
    let failed = 0
    try {
      for (const file of files) {
        const result = await window.xrncal.ics.importIcs(calendarId, file.content)
        if (!result.success) throw new Error(result.message || file.name)
        imported += result.importedCount
        failed += result.errorCount
      }
      const target = calendars.find((c) => c.id === calendarId)?.name ?? ''
      toast.success(t('ics.imported', { count: imported, calendar: target }), {
        description: failed > 0 ? t('ics.importSkipped', { count: failed }) : undefined
      })
      onImported()
      onClose()
    } catch (err) {
      showFriendlyError(err, t('ics.importFailed'))
      setImporting(null)
    }
  }

  return (
    <div className="gc-overlay select-none" onMouseDown={onClose}>
      <div className="gc-dialog w-full max-w-sm p-5" onMouseDown={(e) => e.stopPropagation()}>
        <button type="button" onClick={onClose} className="gc-icon-btn absolute top-3 right-3" aria-label={t('common.close')}>
          <X className="h-4 w-4" />
        </button>

        <div className="mb-4 flex items-center gap-2 pr-6">
          <FileUp className="h-4 w-4 text-muted" />
          <h3 className="text-sm font-semibold text-primary">{t('ics.importTitle')}</h3>
        </div>

        <ul className="mb-4 space-y-1 text-xs text-muted">
          {files.map((file, idx) => (
            <li key={`${file.name}-${idx}`} className="truncate">
              {file.name}
            </li>
          ))}
        </ul>

        <label className="mb-1.5 block text-xs text-primary">{t('ics.importInto')}</label>
        <CustomSelect
          value={calendarId}
          onChange={setPicked}
          variant="boxed"
          options={writable.map((c) => ({ value: c.id, label: c.name, color: c.color }))}
          placeholder={t('editor.chooseCalendar')}
        />
        <p className="mt-2 text-[11px] leading-snug text-muted">{t('ics.importHint')}</p>

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="gc-btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="button" className="gc-btn-primary" disabled={busy || !calendarId} onClick={() => void runImport()}>
            {t('ics.import')}
          </button>
        </div>
      </div>
    </div>
  )
}

/** Read picked or dropped files that look like calendars. */
export async function readIcsFiles(list: FileList | File[]): Promise<OpenedIcsFile[]> {
  const files = Array.from(list).filter((f) => /\.(ics|ical|ifb|icalendar)$/i.test(f.name) || f.type === 'text/calendar')
  return Promise.all(files.map(async (f) => ({ name: f.name, content: await f.text() })))
}

export default ImportIcsDialog
