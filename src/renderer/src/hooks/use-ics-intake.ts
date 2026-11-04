import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { OpenedIcsFile } from '@shared/ipc-contract'
import { readIcsFiles } from '../components/ImportIcsDialog'
import { toast } from '../components/ui'

/**
 * .ics files waiting to be imported: those the OS opened xrncal with (collected
 * now and whenever main says another is waiting), those dropped onto the
 * window, and those picked in Settings -> Import (`accept`).
 */
export function useIcsIntake(): {
  files: OpenedIcsFile[] | null
  clear: () => void
  accept: (list: FileList) => void
} {
  const { t } = useTranslation()
  const [files, setFiles] = useState<OpenedIcsFile[] | null>(null)

  const accept = useCallback(
    (list: FileList) => {
      void readIcsFiles(list).then((read) => {
        if (read.length > 0) setFiles(read)
        else toast.error(t('ics.notCalendar'))
      })
    },
    [t]
  )

  useEffect(() => {
    const api = window.xrncal?.ics
    if (!api?.takeOpenedFiles) return
    const collect = (): void => {
      api
        .takeOpenedFiles()
        .then((opened) => {
          if (opened.length > 0) setFiles(opened)
        })
        .catch(() => {})
    }
    collect()
    return api.onFileOpened?.(collect)
  }, [])

  useEffect(() => {
    // Capture phase: the day cells' own drop handlers (moving events) stop
    // propagation, and a file is not theirs to handle.
    const isFileDrag = (e: DragEvent): boolean => Array.from(e.dataTransfer?.types ?? []).includes('Files')
    const onDragOver = (e: DragEvent): void => {
      if (!isFileDrag(e)) return
      e.preventDefault()
      e.stopPropagation()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
    }
    const onDrop = (e: DragEvent): void => {
      if (!isFileDrag(e) || !e.dataTransfer) return
      e.preventDefault()
      e.stopPropagation()
      accept(e.dataTransfer.files)
    }
    window.addEventListener('dragover', onDragOver, true)
    window.addEventListener('drop', onDrop, true)
    return () => {
      window.removeEventListener('dragover', onDragOver, true)
      window.removeEventListener('drop', onDrop, true)
    }
  }, [accept])

  const clear = useCallback(() => setFiles(null), [])

  return { files, clear, accept }
}
