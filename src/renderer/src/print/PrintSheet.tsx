import React from 'react'
import { useTranslation } from 'react-i18next'
import { DateTime } from 'luxon'
import type { ExpandedOccurrence } from '@shared/event-model'
import { DEFAULT_EVENT_COLOR } from '@shared/mini-calendar-grid'
import { convertSolarToLunar, formatLunarLabel } from '@shared/lunar-vietnam'
import { segmentDayMinutes, segmentTimedOccurrence } from '@shared/timed-event-segments'
import { formatClockTime, type TimeFormatPref } from '@shared/time-format'
import { getVisibleRange } from '@shared/visible-range'
import {
  bandLayout,
  eventsByDay,
  fitCell,
  isBandEvent,
  monthCellLines,
  printDays,
  printHourWindow,
  type PrintPeriod
} from '@shared/print-layout'
import { layoutTimedSegments } from '../dnd/layout-timed-events'
import { weekdayShortLabels } from '../i18n/weekday-labels'

/**
 * One A4 landscape page of a week or a month, for the print dialog's preview
 * and for printing (`.gc-print-*` in index.css). It is paper: it keeps a
 * light palette of its own whatever the app's theme, sizes everything in
 * millimetres, and draws no controls.
 */

export interface PrintSheetProps {
  period: PrintPeriod
  occurrences: ExpandedOccurrence[]
  timeFormat: TimeFormatPref
  showLunar: boolean
  firstDayOfWeek: number
}

/** All-day lanes a week page has room for before it counts the rest. */
const MAX_BAND_LANES = 4

/** Layout widths leave a strip clear for clicking (layout-timed-events.ts); paper has no clicks. */
const LAYOUT_WIDTH_PERCENT = 92

const colorOf = (occ: ExpandedOccurrence): React.CSSProperties =>
  ({ '--ev': occ.color || DEFAULT_EVENT_COLOR }) as React.CSSProperties

/** "09:00–10:30"; on the 12-hour clock "9:00–10:30 AM" when both ends are in the same half of the day. */
const range = (occ: ExpandedOccurrence, timeFormat: TimeFormatPref): string => {
  const start = DateTime.fromISO(occ.startUtc, { zone: 'utc' }).toLocal()
  const end = DateTime.fromISO(occ.endUtc, { zone: 'utc' }).toLocal()
  if (timeFormat === '12h' && (start.hour < 12) === (end.hour < 12) && end.hasSame(start, 'day')) {
    return `${start.toFormat('h:mm')}–${formatClockTime(end, timeFormat)}`
  }
  return `${formatClockTime(start, timeFormat)}–${formatClockTime(end, timeFormat)}`
}

const startTime = (occ: ExpandedOccurrence, timeFormat: TimeFormatPref): string =>
  formatClockTime(DateTime.fromISO(occ.startUtc, { zone: 'utc' }).toLocal(), timeFormat)

/**
 * The zone the times are in, by name and offset on `day` ("Indochina Time
 * (GMT+7)"). Not the IANA id: Chromium still calls Vietnam's "Asia/Saigon".
 */
function zoneCaption(day: DateTime, locale: string): string {
  const offset = day.toFormat("'GMT'Z")
  const name = day.setLocale(locale).toFormat('ZZZZZ')
  return !name || name.startsWith('GMT') || name.startsWith('UTC') ? offset : `${name} (${offset})`
}

/** The 1st names its month: "1 Nov"; in Vietnamese "1/11", as dates are written there. */
function firstOfMonth(day: DateTime, locale: string): string {
  return locale === 'vi' ? `${day.day}/${day.month}` : day.setLocale(locale).toFormat('d MMM')
}

function hourLabel(hour: number, timeFormat: TimeFormatPref): string {
  if (timeFormat === '24h') return `${String(hour).padStart(2, '0')}:00`
  const h12 = hour % 12 === 0 ? 12 : hour % 12
  return `${h12} ${hour < 12 ? 'AM' : 'PM'}`
}

export const PrintSheet: React.FC<PrintSheetProps> = (props) => {
  const { i18n } = useTranslation()
  // A week is titled by its middle day, so a Sunday-first week keeps the ISO week number most of it is in.
  const titleDay = props.period.layout === 'week' ? props.period.anchor.plus({ days: 3 }) : props.period.anchor
  const title = getVisibleRange(titleDay, props.period.layout, i18n.language, props.firstDayOfWeek).label
  return (
    <div className={`gc-print-sheet gc-print-${props.period.layout}`} lang={i18n.language}>
      <header className="gc-print-head">
        <h1>{title}</h1>
        <span>{zoneCaption(props.period.anchor, i18n.language)}</span>
      </header>
      {props.period.layout === 'week' ? <WeekPage {...props} /> : <MonthPage {...props} />}
    </div>
  )
}

const WeekPage: React.FC<PrintSheetProps> = ({ period, occurrences, timeFormat, showLunar, firstDayOfWeek }) => {
  const { t } = useTranslation()
  const days = period.weeks[0]
  const dayKeys = days.map((d) => d.toISODate()!)
  const labels = weekdayShortLabels(t, firstDayOfWeek)

  const band = bandLayout(occurrences.filter(isBandEvent), dayKeys, MAX_BAND_LANES)
  const hasHidden = band.hidden.some((n) => n > 0)
  const segments = occurrences
    .filter((occ) => !isBandEvent(occ))
    .flatMap((occ) => segmentTimedOccurrence(occ, { first: days[0], last: days[days.length - 1] }))
    .filter((segment) => dayKeys.includes(segment.dateKey))
  const { from, to } = printHourWindow(segments.map(segmentDayMinutes))
  const windowMin = (to - from) * 60
  const pct = (minutes: number): string => `${((minutes - from * 60) / windowMin) * 100}%`
  const hours = Array.from({ length: to - from }, (_, i) => from + i)

  return (
    <>
      <div className="gc-print-days">
        <div />
        {days.map((day, i) => {
          const lunar = showLunar ? convertSolarToLunar(day.day, day.month, day.year) : null
          return (
            <div key={dayKeys[i]} className="gc-print-dayhead">
              <span className="gc-print-wd">{labels[i]}</span>
              <span className="gc-print-dn">{day.day}</span>
              {lunar && (
                <span className="gc-print-lunar">
                  {lunar.day}/{lunar.month}
                  {lunar.leap ? '*' : ''}
                </span>
              )}
            </div>
          )
        })}
      </div>

      {band.lanes > 0 && (
        <div className="gc-print-band">
          <div className="gc-print-band-label" style={{ gridRow: `1 / span ${band.lanes + (hasHidden ? 1 : 0)}` }}>
            {t('print.allDay')}
          </div>
          {band.bars.map((bar) => (
            <div
              key={`${bar.occ.id}:${bar.startCol}`}
              className="gc-print-ev gc-print-bar"
              style={{ ...colorOf(bar.occ), gridColumn: `${bar.startCol + 2} / span ${bar.span}`, gridRow: bar.lane + 1 }}
            >
              {!bar.occ.allDay && <span className="gc-print-time">{startTime(bar.occ, timeFormat)} </span>}
              {bar.occ.title || t('common.untitled')}
            </div>
          ))}
          {band.hidden.map((count, col) =>
            count > 0 ? (
              <div
                key={dayKeys[col]}
                className="gc-print-more"
                style={{ gridColumn: col + 2, gridRow: band.lanes + 1 }}
              >
                {t('print.more', { count })}
              </div>
            ) : null
          )}
        </div>
      )}

      <div className="gc-print-hours">
        <div className="gc-print-gutter">
          {hours.map((hour) => (
            <span key={hour} style={{ top: pct(hour * 60) }}>
              {hourLabel(hour, timeFormat)}
            </span>
          ))}
        </div>
        {dayKeys.map((key) => (
          <div key={key} className="gc-print-col">
            {hours.slice(1).map((hour) => (
              <div key={hour} className="gc-print-hourline" style={{ top: pct(hour * 60) }} />
            ))}
            {layoutTimedSegments(
              segments.filter((segment) => segment.dateKey === key),
              60
            ).map((layout) => {
              // With hourHeight 60 the layout's top and height are minutes of the day.
              const top = Math.max(layout.topPos, from * 60)
              const height = Math.min(layout.topPos + layout.height, to * 60) - top
              return (
                <div
                  key={layout.occ.id}
                  className="gc-print-ev gc-print-block"
                  style={{
                    ...colorOf(layout.occ),
                    top: pct(top),
                    height: `${(height / windowMin) * 100}%`,
                    left: `${(layout.leftPercent / LAYOUT_WIDTH_PERCENT) * 100}%`,
                    width: `${(layout.widthPercent / LAYOUT_WIDTH_PERCENT) * 100}%`,
                    zIndex: layout.isNested ? 2 : 1
                  }}
                >
                  {/* Clear of an event nested on top of this one, as in Week view. */}
                  <div style={layout.contentWidthPercent < 100 ? { maxWidth: `${layout.contentWidthPercent}%` } : undefined}>
                    <span className="gc-print-title">{layout.occ.title || t('common.untitled')}</span>{' '}
                    <span className="gc-print-time">{range(layout.occ, timeFormat)}</span>
                    {layout.occ.location && layout.segment.isFirst && (
                      <span className="gc-print-place">{layout.occ.location}</span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </>
  )
}

const MonthPage: React.FC<PrintSheetProps> = ({ period, occurrences, timeFormat, showLunar, firstDayOfWeek }) => {
  const { t, i18n } = useTranslation()
  const labels = weekdayShortLabels(t, firstDayOfWeek)
  const byDay = eventsByDay(occurrences)
  const rows = period.weeks.length
  const lines = monthCellLines(rows)

  return (
    <>
      <div className="gc-print-monthhead">
        {labels.map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>
      <div className="gc-print-monthgrid" style={{ gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))` }}>
        {period.weeks.flat().map((day) => {
          const key = day.toISODate()!
          const { shown, more } = fitCell(byDay.get(key) ?? [], lines)
          const outside = day.month !== period.anchor.month
          return (
            <div key={key} className={`gc-print-cell${outside ? ' is-outside' : ''}`}>
              <div className="gc-print-cellhead">
                <span className="gc-print-dn">{day.day === 1 ? firstOfMonth(day, i18n.language) : day.day}</span>
                {showLunar && (
                  <span className="gc-print-lunar">
                    {formatLunarLabel(convertSolarToLunar(day.day, day.month, day.year)).label}
                  </span>
                )}
              </div>
              {shown.map((occ) =>
                occ.allDay || isBandEvent(occ) ? (
                  <div key={occ.id} className="gc-print-ev gc-print-pill" style={colorOf(occ)}>
                    {occ.title || t('common.untitled')}
                  </div>
                ) : (
                  <div key={occ.id} className="gc-print-line" style={colorOf(occ)}>
                    <span className="gc-print-dot" />
                    {printDays(occ)[0] === key && <span className="gc-print-time">{startTime(occ, timeFormat)}</span>}
                    <span className="gc-print-title">{occ.title || t('common.untitled')}</span>
                  </div>
                )
              )}
              {more > 0 && <div className="gc-print-more">{t('print.more', { count: more })}</div>}
            </div>
          )
        })}
      </div>
    </>
  )
}

export default PrintSheet
