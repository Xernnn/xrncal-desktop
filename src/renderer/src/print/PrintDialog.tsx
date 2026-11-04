import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import type { DateTime } from 'luxon'
import { ChevronLeft, ChevronRight, FileDown, Printer, X } from 'lucide-react'
import type { Calendar, ExpandedOccurrence } from '@shared/event-model'
import { printFileName, printPeriod, type PrintLayout } from '@shared/print-layout'
import { getVisibleRange, stepAnchor, type CalendarViewType } from '@shared/visible-range'
import { useSettings } from '../context/SettingsContext'
import { useDisplayPreferences } from '../context/DisplayPreferencesContext'
import { readVisibleOccurrences } from '../hooks/use-calendar-data'
import { showFriendlyError, toast } from '../components/ui/toast'
import { PrintSheet } from './PrintSheet'

/**
 * Print or save as PDF the week or month around where the calendar is. The
 * page is drawn twice: scaled down here as a preview, and full size in
 * `.gc-print-host` at the end of <body>, which is all a print shows
 * (`@media print` in index.css). Escape is App's: it closes this like the
 * other plain dialogs.
 */

interface PrintDialogProps {
  calendars: Calendar[]
  view: CalendarViewType
  anchorDate: DateTime
  onClose: () => void
}

/** The page's width (297 mm) in CSS pixels, which the preview scales down from. */
const SHEET_WIDTH_PX = (297 / 25.4) * 96

/** The scale that fits the page into the width of the element `ref` is put on. */
function useFitScale(): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(0.5)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => setScale(entry.contentRect.width / SHEET_WIDTH_PX))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  return [ref, scale]
}

export const PrintDialog: React.FC<PrintDialogProps> = ({ calendars, view, anchorDate, onClose }) => {
  const { t, i18n } = useTranslation()
  const { settings } = useSettings()
  const { timeFormat, firstDayOfWeek } = useDisplayPreferences()
  const [layout, setLayout] = useState<PrintLayout>(view === 'day' || view === 'week' ? 'week' : 'month')
  const [anchor, setAnchor] = useState(anchorDate)
  const [busy, setBusy] = useState<'pdf' | 'print' | null>(null)
  const [previewRef, scale] = useFitScale()

  const period = useMemo(() => printPeriod(layout, anchor, firstDayOfWeek), [layout, anchor, firstDayOfWeek])
  const [read, setRead] = useState<{ startUtc: string; occurrences: ExpandedOccurrence[] } | null>(null)
  useEffect(() => {
    let live = true
    readVisibleOccurrences(calendars, period.startUtc, period.endUtc).then(
      (occurrences) => {
        if (live) setRead({ startUtc: period.startUtc, occurrences })
      },
      (err: unknown) => {
        if (live) showFriendlyError(err)
      }
    )
    return () => {
      live = false
    }
  }, [calendars, period.startUtc, period.endUtc])
  // Until the period's own events are in, nothing is drawn rather than the last period's.
  const ready = read?.startUtc === period.startUtc
  const occurrences = ready ? read.occurrences : []

  const title =
    layout === 'week'
      ? getVisibleRange(period.anchor.plus({ days: 3 }), 'week', i18n.language, firstDayOfWeek).label
      : getVisibleRange(period.anchor, 'month', i18n.language, firstDayOfWeek).label

  const sheet = (
    <PrintSheet
      period={period}
      occurrences={occurrences}
      timeFormat={timeFormat}
      showLunar={settings.showLunar}
      firstDayOfWeek={firstDayOfWeek}
    />
  )

  const savePdf = async (): Promise<void> => {
    const api = window.xrncal?.print
    if (!api) return
    setBusy('pdf')
    try {
      const result = await api.savePdf(printFileName(period))
      if (result.saved) {
        toast.success(t('print.saved'), {
          description: result.fileName,
          action: { label: t('print.showInFolder'), onClick: () => void api.showSaved() }
        })
        onClose()
      }
    } catch (err) {
      showFriendlyError(err, t('print.saveFailed'))
    } finally {
      setBusy(null)
    }
  }

  const print = async (): Promise<void> => {
    const api = window.xrncal?.print
    if (!api) return
    setBusy('print')
    try {
      const result = await api.print()
      if (result.printed) onClose()
      else if (result.error) toast.error(t('print.printFailed'), { description: result.error })
    } catch (err) {
      showFriendlyError(err, t('print.printFailed'))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="gc-overlay select-none" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="gc-dialog w-full max-w-4xl" role="dialog" aria-modal="true" aria-labelledby="gc-print-title">
        <div className="flex items-center justify-between border-b border-hairline bg-app px-6 py-4">
          <div className="flex items-center gap-2">
            <Printer className="h-5 w-5 text-accent" />
            <h3 id="gc-print-title" className="text-sm font-semibold text-primary">
              {t('print.title')}
            </h3>
          </div>
          <button type="button" onClick={onClose} className="gc-icon-btn" aria-label={t('common.close')}>
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-3 px-6 pt-4">
          <div className="flex items-center gap-0.5 rounded-[4px] border border-hairline p-0.5" role="group">
            {(['week', 'month'] as const).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={layout === option}
                // Focus starts on the page chosen, so the keyboard is in the dialog from the start.
                autoFocus={layout === option}
                className={`gc-focus-ring rounded-[3px] px-3 py-1 text-xs font-medium transition-colors ${
                  layout === option ? 'bg-hover text-primary' : 'text-muted hover:text-primary'
                }`}
                onClick={() => setLayout(option)}
              >
                {t(`views.${option}`)}
              </button>
            ))}
          </div>
          <div className="flex min-w-0 items-center gap-1">
            <button
              type="button"
              className="gc-icon-btn gc-focus-ring p-1.5"
              aria-label={t('nav.prev')}
              onClick={() => setAnchor((a) => stepAnchor(a, layout, -1))}
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              className="gc-icon-btn gc-focus-ring p-1.5"
              aria-label={t('nav.next')}
              onClick={() => setAnchor((a) => stepAnchor(a, layout, 1))}
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            <span className="truncate text-sm font-medium text-primary" aria-live="polite">
              {title}
            </span>
          </div>
        </div>

        <div className="min-h-0 overflow-y-auto px-6 py-4">
          <div
            ref={previewRef}
            className="relative mx-auto w-full overflow-hidden rounded-[3px] border border-hairline bg-white"
            // As wide as the dialog, or as wide as fits the window's height with the dialog's bars around it.
            style={{ aspectRatio: '297 / 209', maxWidth: 'calc((90vh - 230px) * 297 / 209)' }}
            role="img"
            aria-label={t('print.preview')}
          >
            <div
              className="pointer-events-none absolute left-0 top-0 origin-top-left"
              style={{ transform: `scale(${scale})` }}
              aria-hidden
            >
              {sheet}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-hairline bg-app px-6 py-3">
          <span className="mr-auto min-w-0 text-xs text-muted">{t('print.hint')}</span>
          <button
            type="button"
            className="gc-btn gc-focus-ring"
            disabled={!ready || busy !== null}
            onClick={() => void print()}
          >
            <Printer className="h-3.5 w-3.5" />
            {t('print.print')}
          </button>
          <button
            type="button"
            className="gc-btn-primary gc-focus-ring"
            disabled={!ready || busy !== null}
            onClick={() => void savePdf()}
          >
            <FileDown className="h-3.5 w-3.5" />
            {busy === 'pdf' ? t('print.saving') : t('print.savePdf')}
          </button>
        </div>
      </div>

      {createPortal(
        <div className="gc-print-host" aria-hidden>
          {sheet}
        </div>,
        document.body
      )}
    </div>
  )
}

export default PrintDialog
