import React from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, ChevronRight, Menu, Plus, Search, Settings } from 'lucide-react'
import type { CalendarViewType } from '@shared/visible-range'
import ViewSwitcher from './ViewSwitcher'

interface AppHeaderProps {
  onOpenMenu: () => void
  title: string
  currentView: CalendarViewType
  showSidebarToggle?: boolean
  onToggleSidebar: () => void
  onPrev: () => void
  onNext: () => void
  onNewEvent: () => void
  onChangeView: (view: CalendarViewType) => void
  onSearch: () => void
  conflictCount?: number
}

/**
 * The arrows on the left with the period's name; Create, search, the view and
 * Settings on the right. T goes to today, as does Week view's week number.
 */
export const AppHeader: React.FC<AppHeaderProps> = ({
  onOpenMenu,
  title,
  currentView,
  showSidebarToggle = true,
  onToggleSidebar,
  onPrev,
  onNext,
  onNewEvent,
  onChangeView,
  onSearch,
  conflictCount
}) => {
  const { t } = useTranslation()

  const isYearView = currentView === 'year'

  return (
    <header className="relative z-20 flex h-12 shrink-0 items-center justify-between gap-2 border-b border-hairline bg-surface px-3 select-none">
      <div className="flex min-w-0 items-center gap-2">
        {showSidebarToggle && (
          <button
            type="button"
            className="gc-icon-btn"
            onClick={onToggleSidebar}
            title={`${t('actions.toggleSidebar')} (Ctrl+B)`}
            aria-label={t('actions.toggleSidebar')}
          >
            <Menu className="h-5 w-5" />
          </button>
        )}
        <div className="flex shrink-0 items-center">
          <button type="button" className="gc-icon-btn" onClick={onPrev} title={t('nav.prev')} aria-label={t('nav.prev')}>
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button type="button" className="gc-icon-btn" onClick={onNext} title={t('nav.next')} aria-label={t('nav.next')}>
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>
        {title && !isYearView && (
          <h1 className="truncate py-0.5 text-[28px] font-normal leading-snug tracking-tight text-primary">
            {title}
          </h1>
        )}
      </div>

      {title && isYearView && (
        <h1 className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-[28px] font-normal leading-snug tracking-tight text-primary">
          {title}
        </h1>
      )}

      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          className="gc-btn-primary mr-1"
          onClick={onNewEvent}
          title={`${t('actions.newEvent')} (N)`}
        >
          <Plus className="h-4 w-4" />
          <span>{t('actions.newEvent')}</span>
        </button>
        <button
          type="button"
          className="gc-icon-btn"
          onClick={onSearch}
          title={`${t('actions.search')} (Ctrl+K)`}
          aria-label={t('actions.search')}
        >
          <Search className="h-4 w-4" />
        </button>

        <ViewSwitcher currentView={currentView} onChange={onChangeView} />
        <button
          type="button"
          onClick={onOpenMenu}
          className="gc-icon-btn relative"
          title={`${t('settings.title')} (,)`}
          aria-label={t('settings.title')}
        >
          <Settings className="h-4 w-4" />
          {conflictCount ? (
            <span className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-today" />
          ) : null}
        </button>
      </div>
    </header>
  )
}

export default AppHeader
