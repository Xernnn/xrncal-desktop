import React from 'react'
import { useTranslation } from 'react-i18next'
import type { DateTime } from 'luxon'
import { useToday } from '../hooks/use-now'

interface MonthYearPickerProps {
  date: DateTime
  onChange: (date: DateTime) => void
}

const MONTHS = Array.from({ length: 12 }, (_, index) => index + 1)
const NUMBER_STYLE =
  'gc-focus-ring cursor-pointer appearance-none rounded-sm bg-transparent text-center tabular-nums hover:bg-hover'

export const MonthYearPicker: React.FC<MonthYearPickerProps> = ({ date, onChange }) => {
  const { t, i18n } = useTranslation()
  const chinese = i18n.language === 'zh-CN'
  const today = useToday()
  const years = React.useMemo(() => {
    const first = Math.max(1, date.year - 100)
    return Array.from({ length: date.year + 101 - first }, (_, index) => first + index)
  }, [date.year])
  const yearLabel = t('nav.selectYear')
  const monthLabel = t('nav.selectMonth')

  return (
    <span className="inline-flex items-baseline gap-1 whitespace-nowrap" onKeyDown={(event) => event.stopPropagation()}>
      <span>
        <select
          aria-label={yearLabel}
          title={yearLabel}
          className={`${NUMBER_STYLE} w-[4.5ch]`}
          value={date.year}
          onChange={(event) => onChange(date.set({ year: Number(event.target.value) }))}
        >
          {years.map((year) => (
            <option key={year} value={year} className="bg-surface text-sm text-primary">
              {year}
            </option>
          ))}
        </select>
        {chinese && <span>年</span>}
      </span>
      {!chinese && <span>/</span>}
      <span>
        <select
          aria-label={monthLabel}
          title={monthLabel}
          className={`${NUMBER_STYLE} w-[2.5ch]`}
          value={date.month}
          onChange={(event) => onChange(date.set({ month: Number(event.target.value) }))}
        >
          {MONTHS.map((month) => (
            <option key={month} value={month} className="bg-surface text-sm text-primary">
              {String(month).padStart(2, '0')}
            </option>
          ))}
        </select>
        {chinese && <span>月</span>}
      </span>
      {!date.hasSame(today, 'day') && (
        <button type="button" className="gc-btn ml-1 px-2 py-1" onClick={() => onChange(today)}>
          {t('nav.backToToday')}
        </button>
      )}
    </span>
  )
}
