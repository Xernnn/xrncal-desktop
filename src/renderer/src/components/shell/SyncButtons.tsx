import React, { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, RefreshCw } from 'lucide-react'
import type { Calendar, CalendarAccount } from '@shared/event-model'

interface SyncButtonsProps {
  calendars: Calendar[]
  accounts: CalendarAccount[]
  syncing: boolean
  onSync: (sourceId?: string) => void
}

export const SyncButtons: React.FC<SyncButtonsProps> = ({ calendars, accounts, syncing, onSync }) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const toggle = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const closeOutside = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', closeOutside)
    return () => document.removeEventListener('mousedown', closeOutside)
  }, [open])

  const sources = [
    ...accounts.filter((account) => account.isActive && account.type !== 'local'),
    ...calendars.filter((calendar) => calendar.subscriptionUrl)
  ]
  const sync = (sourceId?: string) => {
    setOpen(false)
    onSync(sourceId)
  }

  return (
    <div
      ref={root}
      className="relative inline-flex shrink-0"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false)
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || !open) return
        event.stopPropagation()
        setOpen(false)
        toggle.current?.focus()
      }}
    >
      <button
        type="button"
        className="gc-btn rounded-r-none"
        title={`${t('accounts.syncNow')} (R)`}
        disabled={syncing}
        onClick={() => sync()}
      >
        <RefreshCw className={`h-3.5 w-3.5 ${syncing ? 'animate-spin' : ''}`} />
        <span>{t(syncing ? 'accounts.syncing' : 'accounts.syncNow')}</span>
      </button>
      <button
        type="button"
        ref={toggle}
        className="gc-btn rounded-l-none border-l-0 px-1.5"
        title={t('actions.syncSource')}
        aria-label={t('actions.syncSource')}
        aria-expanded={open && !syncing}
        aria-controls={open && !syncing ? 'calendar-sync-options' : undefined}
        disabled={syncing}
        onClick={() => setOpen((value) => !value)}
      >
        <ChevronDown className="h-3.5 w-3.5" />
      </button>
      {open && !syncing && (
        <div id="calendar-sync-options" className="gc-menu right-0 top-full mt-1 max-h-72 w-64 overflow-y-auto">
          {sources.length === 0 && (
            <p className="px-3 py-2 text-sm text-muted">{t('actions.noSyncSources')}</p>
          )}
          {sources.map(({ id, name }) => (
            <button key={id} type="button" className="gc-menu-item" title={name} onClick={() => sync(id)}>
              <span className="truncate">{name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
