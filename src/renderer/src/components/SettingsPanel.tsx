import React from 'react'
import { useTranslation } from 'react-i18next'
import {
  X,
  ChevronLeft,
  ChevronRight,
  SlidersHorizontal,
  Palette,
  CalendarRange,
  CalendarDays,
  Keyboard,
  AlertTriangle,
  Sun,
  Moon,
  Monitor,
  Globe,
  HardDriveDownload,
  HardDriveUpload,
  FileUp,
  FileText
} from 'lucide-react'
import { useSettings } from '../context/SettingsContext'
import { NumberInput, CustomSelect, DatePicker, toast } from './ui'
import { SNAP_STEP_OPTIONS } from '../dnd/resize-math'
import { ALL_DAY_REMINDER_PRESETS, TIMED_REMINDER_PRESETS } from '@shared/reminders'
import { reminderLabel } from '../lib/reminder-labels'
import { TIME_ZONE_NAMES, parseZoneList, serializeZoneList, zoneLabel, zoneOptions } from '../lib/time-zones'
import { WEEK_START_CHOICES } from '@shared/week-start'
import { parseZoneHistory, serializeZoneHistory, type ZonePeriod } from '@shared/zone-history'
import { DateTime } from 'luxon'
import AppearanceSettings from './AppearanceSettings'

/** `null` is the panel's root list; anything else is the one level below it. */
export type SettingsSection = 'general' | 'appearance' | 'view'

const SECTIONS: { id: SettingsSection; icon: typeof SlidersHorizontal }[] = [
  { id: 'appearance', icon: Palette },
  { id: 'general', icon: SlidersHorizontal },
  { id: 'view', icon: CalendarRange }
]

interface SettingsPanelProps {
  isOpen: boolean
  section: SettingsSection | null
  onSectionChange: (section: SettingsSection | null) => void
  onClose: () => void

  /** Opens the accounts dialog, which owns calendars and accounts now. */
  onManageAccounts: () => void

  onOpenShortcuts: () => void
  /** Pick .ics files to import. */
  onImportIcs: () => void
  /** Replace everything with a backup (asks first, then restarts). */
  onRestoreBackup: () => void
  conflictCount?: number
  onOpenConflicts?: () => void

  appVersion: string
  platform: string
}

/** One labelled control. Consistent rhythm across every section. */
const Row: React.FC<{ label: string; hint?: string; children: React.ReactNode }> = ({
  label,
  hint,
  children
}) => (
  <div className="flex items-start justify-between gap-3 border-b border-hairline py-3 last:border-b-0">
    <div className="min-w-0 pt-0.5">
      <div className="text-sm text-primary">{label}</div>
      {hint && <div className="mt-0.5 text-xs leading-snug text-muted">{hint}</div>}
    </div>
    <div className="shrink-0">{children}</div>
  </div>
)

const Toggle: React.FC<{ on: boolean; onChange: (next: boolean) => void }> = ({ on, onChange }) => {
  const { t } = useTranslation()
  return (
    <button type="button" className={on ? 'gc-btn-primary' : 'gc-btn'} onClick={() => onChange(!on)}>
      {on ? t('common.on') : t('common.off')}
    </button>
  )
}

export const SettingsPanel: React.FC<SettingsPanelProps> = (props) => {
  const { t, i18n } = useTranslation()
  const { settings, setSetting, setLanguage } = useSettings()
  if (!props.isOpen) return null

  const preferredTimeZones = parseZoneList(settings.preferredTimeZones)
  const zoneHistory = parseZoneHistory(settings.zoneHistory)
  const setPreferredTimeZones = (next: string[]) =>
    void setSetting('preferredTimeZones', serializeZoneList(next))
  const setZoneHistory = (next: ZonePeriod[]) => void setSetting('zoneHistory', serializeZoneHistory(next))

  const atRoot = props.section === null

  return (
    // Same presentation as the event editor's side panel: a light scrim with the
    // sheet sliding in from the right, rather than a centred modal.
    <div className="fixed inset-0 z-50 select-none bg-black/30" onMouseDown={props.onClose}>
      <div
        className="gc-slide-right absolute top-0 right-0 flex h-full w-full max-w-[400px] flex-col overflow-hidden border-l border-hairline bg-dialog text-primary shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="flex shrink-0 items-center gap-1 border-b border-hairline px-2 py-2.5">
          {!atRoot && (
            <button
              type="button"
              className="gc-icon-btn"
              onClick={() => props.onSectionChange(null)}
              aria-label={t('common.back')}
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
          )}
          <h3 className={`flex-1 truncate text-sm font-semibold ${atRoot ? 'px-2' : ''}`}>
            {atRoot
              ? t('settings.title')
              : t(`settings.tab${props.section![0].toUpperCase()}${props.section!.slice(1)}`)}
          </h3>
          <button type="button" onClick={props.onClose} className="gc-icon-btn">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {atRoot ? (
            <div className="p-2">
              {props.conflictCount ? (
                <button
                  type="button"
                  className="mb-1 flex w-full items-center gap-2.5 rounded-[3px] px-2.5 py-2.5 text-left text-sm text-primary transition-colors hover:bg-hover"
                  onClick={() => {
                    props.onOpenConflicts?.()
                    props.onClose()
                  }}
                >
                  <AlertTriangle className="h-4 w-4 shrink-0 text-today" />
                  <span className="flex-1 truncate">
                    {t('sync.conflictsMenuItem', { count: props.conflictCount })}
                  </span>
                </button>
              ) : null}

              {SECTIONS.map(({ id, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => props.onSectionChange(id)}
                  className="flex w-full items-center gap-2.5 rounded-[3px] px-2.5 py-2.5 text-left text-sm text-primary transition-colors hover:bg-hover"
                >
                  <Icon className="h-4 w-4 shrink-0 text-muted" />
                  <span className="flex-1 truncate">
                    {t(`settings.tab${id[0].toUpperCase()}${id.slice(1)}`)}
                  </span>
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted" />
                </button>
              ))}

              {/* Calendars and accounts have their own dialog; this is a way in, not a copy. */}
              <button
                type="button"
                onClick={props.onManageAccounts}
                className="flex w-full items-center gap-2.5 rounded-[3px] px-2.5 py-2.5 text-left text-sm text-primary transition-colors hover:bg-hover"
              >
                <CalendarDays className="h-4 w-4 shrink-0 text-muted" />
                <span className="flex-1 truncate">{t('settings.tabCalendars')}</span>
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted" />
              </button>

              <div className="my-2 border-t border-hairline" />

              {/* Quick toggles - the things worth reaching without drilling in. */}
              <div className="flex items-center gap-1 px-2.5 py-2">
                <span className="mr-auto text-sm text-primary">{t('settings.theme')}</span>
                {(
                  [
                    { id: 'light' as const, icon: Sun },
                    { id: 'dark' as const, icon: Moon },
                    { id: 'system' as const, icon: Monitor }
                  ] as const
                ).map(({ id, icon: Icon }) => (
                  <button
                    key={id}
                    type="button"
                    title={t(`settings.themeMode${id[0].toUpperCase()}${id.slice(1)}`)}
                    className={`rounded-[3px] p-1.5 transition-colors ${
                      settings.theme === id
                        ? 'bg-hover text-primary'
                        : 'text-muted hover:text-primary'
                    }`}
                    onClick={() => void setSetting('theme', id)}
                  >
                    <Icon className="h-4 w-4" />
                  </button>
                ))}
              </div>

              <button
                type="button"
                className="flex w-full items-center gap-2.5 rounded-[3px] px-2.5 py-2.5 text-left text-sm text-primary transition-colors hover:bg-hover"
                onClick={() => void setLanguage(i18n.language === 'vi' ? 'en' : 'vi')}
              >
                <Globe className="h-4 w-4 shrink-0 text-muted" />
                <span className="flex-1 truncate">{t('settings.language')}</span>
                <span className="shrink-0 text-xs text-muted">
                  {i18n.language === 'vi' ? 'Tiếng Việt' : 'English'}
                </span>
              </button>

              <button
                type="button"
                className="flex w-full items-center gap-2.5 rounded-[3px] px-2.5 py-2.5 text-left text-sm text-primary transition-colors hover:bg-hover"
                onClick={() => {
                  props.onOpenShortcuts()
                  props.onClose()
                }}
              >
                <Keyboard className="h-4 w-4 shrink-0 text-muted" />
                <span className="flex-1 truncate">{t('actions.keyboard')}</span>
              </button>

              <button
                type="button"
                className="flex w-full items-center gap-2.5 rounded-[3px] px-2.5 py-2.5 text-left text-sm text-primary transition-colors hover:bg-hover"
                onClick={async () => {
                  const result = await window.xrncal?.app?.backupDatabase?.()
                  if (!result) return
                  if (result.success) {
                    toast.success(t('settings.backupDone'), { description: result.filePath })
                  } else if (result.message && result.message !== 'cancelled') {
                    toast.error(t('settings.backupFailed'), { description: result.message })
                  }
                }}
              >
                <HardDriveDownload className="h-4 w-4 shrink-0 text-muted" />
                <span className="flex-1 truncate">{t('settings.backup')}</span>
              </button>

              <button
                type="button"
                className="flex w-full items-center gap-2.5 rounded-[3px] px-2.5 py-2.5 text-left text-sm text-primary transition-colors hover:bg-hover"
                onClick={props.onRestoreBackup}
              >
                <HardDriveUpload className="h-4 w-4 shrink-0 text-muted" />
                <span className="flex-1 truncate">{t('settings.restore')}</span>
              </button>

              <button
                type="button"
                className="flex w-full items-center gap-2.5 rounded-[3px] px-2.5 py-2.5 text-left text-sm text-primary transition-colors hover:bg-hover"
                onClick={props.onImportIcs}
              >
                <FileUp className="h-4 w-4 shrink-0 text-muted" />
                <span className="flex-1 truncate">{t('ics.importMenu')}</span>
              </button>

              {/* For a bug report: the log is in the profile folder, which is hidden. */}
              <button
                type="button"
                className="flex w-full items-center gap-2.5 rounded-[3px] px-2.5 py-2.5 text-left text-sm text-primary transition-colors hover:bg-hover"
                onClick={async () => {
                  const shown = await window.xrncal?.app?.showLogFile?.()
                  if (shown === false) toast.error(t('settings.showLogFailed'))
                }}
              >
                <FileText className="h-4 w-4 shrink-0 text-muted" />
                <span className="flex-1 truncate">{t('settings.showLog')}</span>
              </button>

              <div className="px-2.5 pt-3 pb-1 font-mono text-[11px] text-muted">
                v{props.appVersion} ({props.platform})
              </div>
            </div>
          ) : (
            <div className="px-4 py-2">
              {props.section === 'general' && (
                <div>
                  <Row label={t('settings.timeFormat')}>
                    <div className="flex gap-1">
                      {(['24h', '12h'] as const).map((opt) => (
                        <button
                          key={opt}
                          type="button"
                          className={settings.timeFormat === opt ? 'gc-btn-primary' : 'gc-btn'}
                          onClick={() => void setSetting('timeFormat', opt)}
                        >
                          {opt === '24h'
                            ? t('settings.timeFormat24h')
                            : t('settings.timeFormat12h')}
                        </button>
                      ))}
                    </div>
                  </Row>
                  <Row label={t('settings.lunar')}>
                    <Toggle on={settings.showLunar} onChange={(next) => void setSetting('showLunar', next)} />
                  </Row>
                  <Row label={t('settings.weekNumbers')}>
                    <Toggle on={settings.showWeekNumbers} onChange={(next) => void setSetting('showWeekNumbers', next)} />
                  </Row>
                  <Row label={t('settings.showMiniCalendar')}>
                    <Toggle on={settings.showMiniCalendar} onChange={(next) => void setSetting('showMiniCalendar', next)} />
                  </Row>
                  <Row label={t('settings.launchAtLogin')} hint={t('settings.launchAtLoginHint')}>
                    <Toggle on={settings.launchAtLogin} onChange={(next) => void setSetting('launchAtLogin', next)} />
                  </Row>
                  <Row label={t('settings.closeToTray')} hint={t('settings.closeToTrayHint')}>
                    <Toggle on={settings.closeToTray} onChange={(next) => void setSetting('closeToTray', next)} />
                  </Row>
                  <Row label={t('settings.checkForUpdates')} hint={t('settings.checkForUpdatesHint')}>
                    <Toggle on={settings.checkForUpdates} onChange={(next) => void setSetting('checkForUpdates', next)} />
                  </Row>
                  <Row label={t('settings.autoBackup')} hint={t('settings.autoBackupHint')}>
                    <Toggle on={settings.autoBackup} onChange={(next) => void setSetting('autoBackup', next)} />
                  </Row>
                  {/* Full width, like the timezone list: the labels are long. */}
                  <div className="border-b border-hairline py-3">
                    <div className="text-sm text-primary">{t('reminders.settingsTimed')}</div>
                    <div className="mt-0.5 mb-2 text-xs leading-snug text-muted">
                      {t('reminders.settingsTimedHint')}
                    </div>
                    <CustomSelect
                      value={settings.defaultReminderMinutes === null ? '' : String(settings.defaultReminderMinutes)}
                      onChange={(v) => void setSetting('defaultReminderMinutes', v === '' ? null : Number(v))}
                      variant="boxed"
                      options={[
                        { value: '', label: t('reminders.none') },
                        ...TIMED_REMINDER_PRESETS.map((m) => ({
                          value: String(m),
                          label: reminderLabel(t, { minutesBefore: m }, false, settings.timeFormat)
                        }))
                      ]}
                    />
                  </div>
                  <div className="border-b border-hairline py-3">
                    <div className="text-sm text-primary">{t('reminders.settingsAllDay')}</div>
                    <div className="mt-0.5 mb-2 text-xs leading-snug text-muted">
                      {t('reminders.settingsAllDayHint')}
                    </div>
                    <CustomSelect
                      value={
                        settings.defaultAllDayReminderMinutes === null ? '' : String(settings.defaultAllDayReminderMinutes)
                      }
                      onChange={(v) => void setSetting('defaultAllDayReminderMinutes', v === '' ? null : Number(v))}
                      variant="boxed"
                      options={[
                        { value: '', label: t('reminders.none') },
                        ...ALL_DAY_REMINDER_PRESETS.map((m) => ({
                          value: String(m),
                          label: reminderLabel(t, { minutesBefore: m }, true, settings.timeFormat)
                        }))
                      ]}
                    />
                  </div>
                  {/* The zones the event editor lists first, so picking one there
                      is not a hunt through the whole list. */}
                  <div className="border-b border-hairline py-3">
                    <div className="text-sm text-primary">{t('settings.preferredTimeZones')}</div>
                    <div className="mt-0.5 mb-2 text-xs leading-snug text-muted">
                      {t('settings.preferredTimeZonesHint')}
                    </div>
                    {preferredTimeZones.length > 0 && (
                      <div className="mb-2 space-y-1">
                        {preferredTimeZones.map((zone) => (
                          <div
                            key={zone}
                            className="flex items-center gap-2 rounded-[3px] bg-hover/60 px-2.5 py-1.5 text-xs"
                          >
                            <span className="min-w-0 flex-1 truncate text-primary">{zoneLabel(zone)}</span>
                            <button
                              type="button"
                              onClick={() =>
                                setPreferredTimeZones(preferredTimeZones.filter((z) => z !== zone))
                              }
                              className="shrink-0 cursor-pointer text-muted transition-colors hover:text-today"
                              title={t('settings.preferredTimeZonesRemove', { zone: zone.replace(/_/g, ' ') })}
                              aria-label={t('settings.preferredTimeZonesRemove', { zone: zone.replace(/_/g, ' ') })}
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                    <CustomSelect
                      value=""
                      onChange={(zone) => {
                        if (zone && !preferredTimeZones.includes(zone)) {
                          setPreferredTimeZones([...preferredTimeZones, zone])
                        }
                      }}
                      searchable
                      variant="boxed"
                      placeholder={t('settings.preferredTimeZonesAdd')}
                      options={zoneOptions().filter((o) => !preferredTimeZones.includes(o.value))}
                    />
                  </div>
                  {/* Where the user was, from when: the zone an event that names
                      none opens in - Google's export writes one-off events as bare
                      UTC, with nothing to say whether they were made at +7 or +11. */}
                  <div className="py-3">
                    <div className="text-sm text-primary">{t('settings.zoneHistory')}</div>
                    <div className="mt-0.5 mb-2 text-xs leading-snug text-muted">{t('settings.zoneHistoryHint')}</div>
                    {zoneHistory.length > 0 && (
                      <div className="mb-2 space-y-1">
                        {zoneHistory.map((period, idx) => (
                          <div
                            key={`${period.from ?? 'first'}-${period.zone}`}
                            className="flex items-center gap-2 rounded-[3px] bg-hover/60 px-2.5 py-1.5 text-xs"
                          >
                            <div className="w-36 shrink-0">
                              {idx === 0 ? (
                                <span className="text-muted">{t('settings.zoneHistoryFirst')}</span>
                              ) : (
                                <DatePicker
                                  compact
                                  clearable={false}
                                  value={period.from ?? ''}
                                  onChange={(from) => {
                                    if (!from) return
                                    setZoneHistory(
                                      zoneHistory.map((p, i) => (i === idx ? { ...p, from } : p))
                                    )
                                  }}
                                />
                              )}
                            </div>
                            <span className="min-w-0 flex-1 truncate text-primary">{zoneLabel(period.zone)}</span>
                            <button
                              type="button"
                              onClick={() => setZoneHistory(zoneHistory.filter((_, i) => i !== idx))}
                              className="shrink-0 cursor-pointer text-muted transition-colors hover:text-today"
                              title={t('settings.zoneHistoryRemove')}
                              aria-label={t('settings.zoneHistoryRemove')}
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                    <CustomSelect
                      value=""
                      onChange={(zone) => {
                        if (!zone) return
                        // The first is where it all started; each later one is a
                        // move, dated today until its date is picked.
                        setZoneHistory([
                          ...zoneHistory,
                          { from: zoneHistory.length === 0 ? null : DateTime.local().toISODate(), zone }
                        ])
                      }}
                      searchable
                      variant="boxed"
                      placeholder={zoneHistory.length === 0 ? t('settings.zoneHistoryStart') : t('settings.zoneHistoryAdd')}
                      options={zoneOptions()}
                    />
                  </div>
                </div>
              )}

              {props.section === 'appearance' && (
                <div className="py-2">
                  <AppearanceSettings />
                </div>
              )}

              {props.section === 'view' && (
                <div>
                  <Row label={t('settings.weekStart')}>
                    <div className="flex gap-1">
                      {WEEK_START_CHOICES.map((day) => (
                        <button
                          key={day}
                          type="button"
                          className={settings.firstDayOfWeek === day ? 'gc-btn-primary' : 'gc-btn'}
                          onClick={() => void setSetting('firstDayOfWeek', day)}
                        >
                          {t(`settings.weekStartDay.${day}`)}
                        </button>
                      ))}
                    </div>
                  </Row>
                  <Row label={t('settings.dayStartHour')} hint={t('settings.dayStartHourHint')}>
                    <NumberInput
                      value={settings.dayStartHour}
                      onChange={(v) =>
                        void setSetting('dayStartHour', Math.max(0, Math.min(23, Math.round(v))))
                      }
                      min={0}
                      max={23}
                      suffix="h"
                    />
                  </Row>
                  <Row label={t('settings.hourBlockSize')}>
                    <div className="flex gap-1">
                      {(['small', 'medium', 'large'] as const).map((opt) => (
                        <button
                          key={opt}
                          type="button"
                          className={settings.hourBlockSize === opt ? 'gc-btn-primary' : 'gc-btn'}
                          onClick={() => void setSetting('hourBlockSize', opt)}
                        >
                          {t(`settings.hourBlockSize${opt[0].toUpperCase()}${opt.slice(1)}`)}
                        </button>
                      ))}
                    </div>
                  </Row>
                  <Row label={t('settings.dragSnap')}>
                    <div className="flex gap-1">
                      {SNAP_STEP_OPTIONS.map((opt) => (
                        <button
                          key={opt}
                          type="button"
                          className={settings.dragSnapMinutes === opt ? 'gc-btn-primary' : 'gc-btn'}
                          onClick={() => void setSetting('dragSnapMinutes', opt)}
                        >
                          {opt === 60 ? t('settings.dragSnapHour') : t('settings.dragSnapMin', { count: opt })}
                        </button>
                      ))}
                    </div>
                  </Row>
                  <Row label={t('settings.timePickerStep')}>
                    <div className="flex gap-1">
                      {SNAP_STEP_OPTIONS.map((opt) => (
                        <button
                          key={opt}
                          type="button"
                          className={settings.timePickerStepMinutes === opt ? 'gc-btn-primary' : 'gc-btn'}
                          onClick={() => void setSetting('timePickerStepMinutes', opt)}
                        >
                          {opt === 60 ? t('settings.dragSnapHour') : t('settings.dragSnapMin', { count: opt })}
                        </button>
                      ))}
                    </div>
                  </Row>
                  <Row label={t('settings.autoHideHeader')}>
                    <Toggle on={settings.autoHideHeader} onChange={(next) => void setSetting('autoHideHeader', next)} />
                  </Row>
                  <Row label={t('settings.suggestionShowCalendarName')}>
                    <Toggle
                      on={settings.suggestionShowCalendarName}
                      onChange={(next) => void setSetting('suggestionShowCalendarName', next)}
                    />
                  </Row>
                  {/* Full width: a searchable zone list needs the room. */}
                  <div className="border-b border-hairline py-3 last:border-b-0">
                    <div className="text-sm text-primary">{t('settings.secondaryTimezone')}</div>
                    <div className="mt-0.5 mb-2 text-xs leading-snug text-muted">
                      {t('settings.secondaryTimezoneHint')}
                    </div>
                    <CustomSelect
                      value={settings.secondaryTimezone}
                      onChange={(next) => void setSetting('secondaryTimezone', next)}
                      searchable
                      placeholder={t('settings.secondaryTimezoneNone')}
                      options={[
                        { value: '', label: t('settings.secondaryTimezoneNone') },
                        ...TIME_ZONE_NAMES.map((tz) => ({
                          value: tz,
                          label: tz.replace(/_/g, ' ')
                        }))
                      ]}
                    />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default SettingsPanel
