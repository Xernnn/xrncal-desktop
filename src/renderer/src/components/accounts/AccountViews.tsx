import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DateTime } from 'luxon'
import { AlertTriangle, ChevronRight, Loader2, Palette, Plus, RotateCw, Trash2 } from 'lucide-react'
import type { Calendar, SyncStatus } from '@shared/event-model'
import { CALENDAR_COLOR_PALETTE } from '../../lib/calendar-colors'
import {
  canRemoveLocalCalendar,
  classifySyncError,
  eventMoveTargets,
  groupCalendars,
  isRemoteAccount,
  LOCAL_ACCOUNT_ID,
  providerKind,
  type CalendarGroup
} from '../../lib/account-display'
import { CustomSelect, TextInput, toast, showFriendlyError } from '../ui'
import { CalendarRow, ColorPalette } from './CalendarToggle'
import ProviderMark from './ProviderMark'
import type { AccountsPageProps } from './accounts-nav'
import { useSyncStatus } from '../../hooks/use-sync-status'

/** The provider's name, e.g. "Google" - used in subtitles and the remove wording. */
function useProviderLabel() {
  const { t } = useTranslation()
  return (kind: CalendarGroup['kind']) =>
    kind === 'local' ? t('calendarList.thisComputer') : t(`addAccount.providers.${kind}.title`)
}

/** A row that leads somewhere: icon, two lines, chevron. Shared with the provider picker. */
export const NavRow: React.FC<{
  icon: React.ReactNode
  title: React.ReactNode
  subtitle?: React.ReactNode
  onClick: () => void
  trailing?: React.ReactNode
  disabled?: boolean
}> = ({ icon, title, subtitle, onClick, trailing, disabled = false }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className={`gc-focus-ring flex w-full items-center gap-3 px-2.5 py-2.5 text-left transition-colors ${
      disabled ? 'cursor-not-allowed opacity-50' : 'hover:bg-hover'
    }`}
    style={{ borderRadius: 'var(--radius-control)' }}
  >
    {icon}
    <span className="min-w-0 flex-1">
      <span className="block truncate text-sm text-primary">{title}</span>
      {subtitle && <span className="block truncate text-xs text-muted">{subtitle}</span>}
    </span>
    {trailing}
    {!disabled && <ChevronRight className="h-4 w-4 shrink-0 text-muted" />}
  </button>
)

/* ------------------------------------------------------------------ list */

export const AccountListView: React.FC<AccountsPageProps> = (props) => {
  const { t } = useTranslation()
  const label = useProviderLabel()
  // This computer has a row while it has calendars of its own; a new one is
  // made from Add account.
  const groups = groupCalendars(props.accounts, props.calendars).filter(
    (group) => group.kind !== 'local' || group.calendars.length > 0
  )
  const { status, reload } = useSyncStatus()

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-0.5">
        {groups.map((group) => {
          const count = t('accounts.calendarCount', { count: group.calendars.length })
          if (group.kind === 'holidays') {
            return (
              <NavRow
                key={group.key}
                icon={<ProviderMark kind="holidays" />}
                title={t('holidays.title')}
                subtitle={count}
                onClick={() => props.push({ name: 'holidays' })}
              />
            )
          }
          if (group.kind === 'subscription') {
            return (
              <NavRow
                key={group.key}
                icon={<ProviderMark kind="subscription" />}
                title={t('subscriptions.title')}
                subtitle={count}
                onClick={() => props.push({ name: 'subscriptions' })}
              />
            )
          }
          const account = group.account
          const inactive = account && isRemoteAccount(account) && !account.isActive
          const syncError = status?.accountErrors?.[group.key]
          return (
            <NavRow
              key={group.key}
              icon={<ProviderMark kind={group.kind} />}
              title={group.kind === 'local' ? t('calendarList.thisComputer') : account?.name}
              subtitle={
                inactive ? (
                  <span className="text-today">{t('accounts.notSyncing')}</span>
                ) : syncError ? (
                  <span className="text-today" title={syncError}>
                    {t(`accounts.syncProblems.${classifySyncError(syncError)}`)}
                  </span>
                ) : group.kind === 'local' ? (
                  count
                ) : (
                  [label(group.kind), account?.email, count].filter(Boolean).join(' · ')
                )
              }
              onClick={() => props.push({ name: 'account', accountId: group.key })}
            />
          )
        })}
      </div>

      <button type="button" className="gc-btn-primary justify-center" onClick={() => props.push({ name: 'add' })}>
        <Plus className="h-4 w-4" />
        {t('addAccount.title')}
      </button>

      <SyncFooter status={status} reload={reload} refresh={props.refresh} />
    </div>
  )
}

/** Last sync, what is waiting, and Sync now - for all accounts at once, as the worker syncs them together. */
const SyncFooter: React.FC<{
  status: SyncStatus | null
  reload: () => Promise<void>
  refresh: () => Promise<void>
}> = ({ status, reload, refresh }) => {
  const { t, i18n } = useTranslation()
  const [busy, setBusy] = useState(false)

  const syncNow = async () => {
    if (!window.xrncal?.sync) return
    setBusy(true)
    try {
      const res = await window.xrncal.sync.triggerNow()
      await refresh()
      if (!res.success && res.message) toast.error(t('accounts.syncFailed'), { description: res.message })
    } catch (err) {
      showFriendlyError(err, t('accounts.syncFailed'))
    } finally {
      setBusy(false)
      void reload()
    }
  }

  const when = status?.lastSyncTime
    ? DateTime.fromISO(status.lastSyncTime).toRelative({ locale: i18n.language }) ?? ''
    : null
  const remotes = status?.connectedAccounts?.length ?? 0

  return (
    <div
      className="flex items-center gap-3 border border-hairline px-3 py-2.5"
      style={{ borderRadius: 'var(--radius-control)' }}
    >
      <div className="min-w-0 flex-1 text-xs">
        <div className="text-primary">
          {remotes === 0 ? t('accounts.nothingToSync') : when ? t('accounts.lastSynced', { when }) : t('accounts.neverSynced')}
        </div>
        {status?.lastError && <div className="truncate text-today" title={status.lastError}>{t('accounts.lastSyncFailed')}</div>}
        {!!status?.pendingPushesCount && (
          <div className="text-muted">{t('accounts.waiting', { count: status.pendingPushesCount })}</div>
        )}
      </div>
      {remotes > 0 && (
        <button type="button" className="gc-btn shrink-0" onClick={syncNow} disabled={busy}>
          <RotateCw className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} />
          {busy ? t('accounts.syncing') : t('accounts.syncNow')}
        </button>
      )}
    </div>
  )
}

/* --------------------------------------------------------------- account */

export const AccountDetailView: React.FC<AccountsPageProps & { accountId: string }> = (props) => {
  const { t } = useTranslation()
  const label = useProviderLabel()
  const [paletteFor, setPaletteFor] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)

  const account = props.accounts.find((a) => a.id === props.accountId)
  const group = groupCalendars(props.accounts, props.calendars).find((g) => g.key === props.accountId)
  const calendars = group?.calendars ?? []
  const isLocal = props.accountId === LOCAL_ACCOUNT_ID || account?.type === 'local'
  const kind = account ? providerKind(account) : 'local'
  const { status, reload } = useSyncStatus()
  const syncError = account?.isActive ? status?.accountErrors?.[props.accountId] : undefined

  const syncNow = async () => {
    setSyncing(true)
    try {
      await window.xrncal?.sync?.triggerNow()
      await props.refresh()
    } catch (err) {
      showFriendlyError(err, t('accounts.syncFailed'))
    } finally {
      setSyncing(false)
      void reload()
    }
  }

  // An empty calendar is deleted after the confirmation here; one with events
  // asks first what should happen to them, as removing an account does.
  const askDelete = async (cal: Calendar) => {
    if (deleting === cal.id) {
      setDeleting(null)
      return
    }
    try {
      const count = (await window.xrncal?.calendars?.eventCount(cal.id)) ?? 0
      if (count > 0) props.push({ name: 'removeCalendar', calendarId: cal.id, eventCount: count })
      else setDeleting(cal.id)
    } catch (err) {
      showFriendlyError(err, t('accounts.calendarDeleteFailed'))
    }
  }

  const deleteCalendar = async (cal: Calendar) => {
    try {
      await window.xrncal?.calendars?.delete(cal.id)
      setDeleting(null)
      await props.refresh()
      toast.success(t('accounts.calendarDeleted'), { description: cal.name })
    } catch (err) {
      showFriendlyError(err, t('accounts.calendarDeleteFailed'))
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <ProviderMark kind={kind} />
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-primary">
            {isLocal ? t('calendarList.thisComputer') : account?.name}
          </div>
          {!isLocal && (
            <div className="truncate text-xs text-muted">{[label(kind), account?.email].filter(Boolean).join(' · ')}</div>
          )}
        </div>
      </div>

      {account && isRemoteAccount(account) && !account.isActive && (
        <div
          className="flex gap-2 border border-today/40 px-3 py-2 text-xs text-primary"
          style={{ borderRadius: 'var(--radius-control)' }}
        >
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-today" />
          <span>{t('accounts.notSyncing')}</span>
        </div>
      )}

      {syncError && (
        <div
          className="flex gap-2 border border-today/40 px-3 py-2 text-xs text-primary"
          style={{ borderRadius: 'var(--radius-control)' }}
          role="status"
        >
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-today" />
          <span className="min-w-0">
            <span className="block">{t(`accounts.syncProblems.${classifySyncError(syncError)}`)}</span>
            <span className="mt-0.5 block select-text break-words text-muted">{syncError}</span>
          </span>
        </div>
      )}

      <div>
        <div className="mb-1 px-2 text-[11px] font-medium text-muted">{t('calendarList.title')}</div>
        {calendars.length === 0 && (
          <div className="px-2 py-2 text-xs text-muted">{t('accounts.noCalendarsYet')}</div>
        )}
        {calendars.map((cal) => (
          <div key={cal.id}>
            <CalendarRow
              calendar={cal}
              onToggle={() => props.onToggleVisibility(cal)}
              trailing={
                <span className="flex shrink-0 items-center gap-0.5">
                  <button
                    type="button"
                    className="gc-icon-btn h-6 w-6"
                    title={t('calendarList.color')}
                    aria-label={t('calendarList.color')}
                    aria-expanded={paletteFor === cal.id}
                    onClick={() => setPaletteFor(paletteFor === cal.id ? null : cal.id)}
                  >
                    <Palette className="h-3.5 w-3.5" />
                  </button>
                  {isLocal && canRemoveLocalCalendar(cal, props.calendars) && (
                    <button
                      type="button"
                      className="gc-icon-btn h-6 w-6 hover:text-today"
                      title={t('accounts.deleteCalendar')}
                      aria-label={t('accounts.deleteCalendar')}
                      onClick={() => void askDelete(cal)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </span>
              }
            />
            {paletteFor === cal.id && (
              <ColorPalette
                calendar={cal}
                calendars={props.calendars}
                onPick={(hex) => {
                  props.onChangeColor(cal, hex)
                  setPaletteFor(null)
                }}
              />
            )}
            {deleting === cal.id && (
              <div
                className="mx-2 mb-2 flex items-center gap-2 border border-today/40 px-3 py-2 text-xs"
                style={{ borderRadius: 'var(--radius-control)' }}
              >
                <span className="flex-1 text-primary">{t('accounts.deleteCalendarConfirm', { name: cal.name })}</span>
                <button type="button" className="gc-btn" onClick={() => setDeleting(null)}>
                  {t('common.cancel')}
                </button>
                <button type="button" className="gc-btn text-today" onClick={() => deleteCalendar(cal)}>
                  {t('common.delete')}
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {isLocal ? (
        <button type="button" className="gc-btn justify-center" onClick={() => props.push({ name: 'local' })}>
          <Plus className="h-4 w-4" />
          {t('addAccount.providers.local.action')}
        </button>
      ) : (
        <div className="flex gap-2">
          <button type="button" className="gc-btn flex-1 justify-center" onClick={syncNow} disabled={syncing || !account?.isActive}>
            <RotateCw className={`h-3.5 w-3.5 ${syncing ? 'animate-spin' : ''}`} />
            {syncing ? t('accounts.syncing') : t('accounts.syncNow')}
          </button>
          <button
            type="button"
            className="gc-btn flex-1 justify-center text-today"
            onClick={() => props.push({ name: 'remove', accountId: props.accountId })}
          >
            <Trash2 className="h-3.5 w-3.5" />
            {t('accounts.remove')}
          </button>
        </div>
      )}
    </div>
  )
}

/* ---------------------------------------------------------------- remove */

/**
 * One question instead of the old pair of unlabeled icons ("unlink" vs "trash",
 * which did different things nobody could tell apart): keep the events here, or
 * take them out of xrncal too. Neither touches anything on the provider.
 */
export const RemoveAccountView: React.FC<AccountsPageProps & { accountId: string }> = (props) => {
  const { t } = useTranslation()
  const [keep, setKeep] = useState(true)
  const [busy, setBusy] = useState(false)
  const account = props.accounts.find((a) => a.id === props.accountId)
  if (!account) return null

  const remove = async () => {
    if (!window.xrncal?.auth || !window.xrncal?.calendars) return
    setBusy(true)
    // Remember the calendars before detaching moves them to this computer.
    const calendarIds = props.calendars.filter((c) => c.accountId === account.id).map((c) => c.id)
    try {
      // Detach first in both cases: with the account gone, no sync can bring
      // the calendars back while they are being deleted.
      const result = await window.xrncal.auth.detachAccount(account.id)
      if (!result.success) throw new Error(result.message || '')
      if (!keep) {
        for (const id of calendarIds) await window.xrncal.calendars.delete(id)
      }
      await props.refresh()
      toast.success(t('accounts.removed', { name: account.name }), {
        description: keep
          ? t('accounts.removedKept', { calendars: result.calendarCount, events: result.eventCount })
          : t('accounts.removedAll')
      })
      props.reset([{ name: 'list' }])
    } catch (err) {
      showFriendlyError(err, t('accounts.removeFailed'))
      setBusy(false)
    }
  }

  const option = (value: boolean, title: string) => (
    <label
      className={`flex cursor-pointer gap-3 border px-3 py-2.5 transition-colors ${
        keep === value ? 'border-accent/60 bg-accent/5' : 'border-hairline hover:bg-hover'
      }`}
      style={{ borderRadius: 'var(--radius-control)' }}
    >
      <input
        type="radio"
        name="remove-mode"
        className="mt-0.5 accent-accent"
        checked={keep === value}
        onChange={() => setKeep(value)}
      />
      <span className="block text-sm text-primary">{title}</span>
    </label>
  )

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-primary">{t('accounts.removeQuestion', { name: account.name })}</p>
      {option(true, t('accounts.removeKeep'))}
      {option(false, t('accounts.removeAll'))}
      <div className="flex justify-end gap-2 pt-1">
        <button type="button" className="gc-btn" onClick={props.back} disabled={busy}>
          {t('common.cancel')}
        </button>
        <button type="button" className="gc-btn text-today" onClick={remove} disabled={busy}>
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {t('accounts.removeConfirm')}
        </button>
      </div>
    </div>
  )
}

/* ------------------------------------------------------ remove calendar */

/**
 * The account removal's question, for a calendar on this computer that holds
 * events: keep them by moving them into another calendar, or delete them with
 * it. The calendar picked to start with is the one new events go into next.
 */
export const RemoveCalendarView: React.FC<AccountsPageProps & { calendarId: string; eventCount: number }> = (props) => {
  const { t } = useTranslation()
  const calendar = props.calendars.find((c) => c.id === props.calendarId)
  const { groups, preferred } = calendar
    ? eventMoveTargets(calendar, props.accounts, props.calendars)
    : { groups: [], preferred: undefined }
  const [keep, setKeep] = useState(preferred !== undefined)
  const [targetId, setTargetId] = useState(preferred?.id ?? '')
  const [busy, setBusy] = useState(false)
  if (!calendar) return null

  const accountName = (group: CalendarGroup) =>
    group.kind === 'local' ? t('calendarList.thisComputer') : group.account?.name ?? ''
  const target = groups.flatMap((g) => g.calendars).find((c) => c.id === targetId)

  const remove = async () => {
    if (!window.xrncal?.calendars) return
    setBusy(true)
    try {
      const moveTo = keep ? target : undefined
      await window.xrncal.calendars.delete(calendar.id, moveTo ? { moveEventsTo: moveTo.id } : undefined)
      await props.refresh()
      toast.success(t('accounts.calendarDeleted'), {
        description: moveTo ? t('accounts.eventsMoved', { count: props.eventCount, name: moveTo.name }) : calendar.name
      })
      props.back()
    } catch (err) {
      showFriendlyError(err, t('accounts.calendarDeleteFailed'))
      setBusy(false)
    }
  }

  const option = (value: boolean, title: string, disabled: boolean, extra?: React.ReactNode) => (
    <div
      className={`border px-3 py-2.5 transition-colors ${
        keep === value ? 'border-accent/60 bg-accent/5' : 'border-hairline hover:bg-hover'
      } ${disabled ? 'opacity-50' : ''}`}
      style={{ borderRadius: 'var(--radius-control)' }}
    >
      <label className={`flex gap-3 ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}>
        <input
          type="radio"
          name="remove-calendar-mode"
          className="mt-0.5 accent-accent"
          checked={keep === value}
          disabled={disabled}
          onChange={() => setKeep(value)}
        />
        <span className="block text-sm text-primary">{title}</span>
      </label>
      {extra}
    </div>
  )

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-primary">
        {t('accounts.removeCalendarQuestion', { name: calendar.name, count: props.eventCount })}
      </p>
      {option(
        true,
        t('accounts.removeCalendarMove'),
        groups.length === 0,
        keep && groups.length > 0 ? (
          <div className="mt-2 pl-7">
            <CustomSelect
              value={targetId}
              onChange={setTargetId}
              variant="boxed"
              options={groups.flatMap((group) =>
                group.calendars.map((c) => ({ value: c.id, label: c.name, color: c.color, group: accountName(group) }))
              )}
            />
          </div>
        ) : undefined
      )}
      {option(false, t('accounts.removeCalendarDelete'), false)}
      <div className="flex justify-end gap-2 pt-1">
        <button type="button" className="gc-btn" onClick={props.back} disabled={busy}>
          {t('common.cancel')}
        </button>
        <button type="button" className="gc-btn text-today" onClick={remove} disabled={busy || (keep && !target)}>
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {t('accounts.deleteCalendar')}
        </button>
      </div>
    </div>
  )
}

/* ----------------------------------------------------------- new local */

export const NewLocalCalendarView: React.FC<AccountsPageProps> = (props) => {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [color, setColor] = useState(() => {
    const used = new Set(props.calendars.map((c) => c.color?.toLowerCase()))
    return CALENDAR_COLOR_PALETTE.find((hex) => !used.has(hex.toLowerCase())) ?? CALENDAR_COLOR_PALETTE[0]
  })
  const [busy, setBusy] = useState(false)

  const create = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !window.xrncal?.calendars) return
    setBusy(true)
    try {
      await window.xrncal.calendars.create({ name: name.trim(), color })
      await props.refresh()
      toast.success(t('accounts.calendarCreated'), { description: name.trim() })
      props.reset([{ name: 'list' }, { name: 'account', accountId: LOCAL_ACCOUNT_ID }])
    } catch (err) {
      showFriendlyError(err, t('accounts.calendarCreateFailed'))
      setBusy(false)
    }
  }

  const preview: Calendar = {
    id: '__new__',
    accountId: LOCAL_ACCOUNT_ID,
    name,
    color,
    isVisible: true,
    isReadOnly: false,
    isDefault: false,
    createdAt: '',
    updatedAt: ''
  }

  return (
    <form className="flex flex-col gap-3" onSubmit={create}>
      <TextInput
        variant="boxed"
        label={t('addAccount.local.name')}
        placeholder={t('addAccount.local.placeholder')}
        value={name}
        onChange={setName}
        autoFocus
      />
      <div>
        <div className="mb-1 text-xs text-muted">{t('calendarList.color')}</div>
        <ColorPalette calendar={preview} calendars={props.calendars} onPick={setColor} />
      </div>
      <div className="flex justify-end">
        <button type="submit" className="gc-btn-primary" disabled={!name.trim() || busy}>
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {t('addAccount.local.create')}
        </button>
      </div>
    </form>
  )
}
