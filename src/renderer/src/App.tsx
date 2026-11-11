import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { DateTime } from 'luxon'
import type { ExpandedOccurrence } from '@shared/event-model'
import type { KeyCommand } from '@shared/keyboard-commands'
import {
  sortForCursor,
  stepCursor,
  nudgedRange,
  resizedRange,
  refindSelection,
  type CursorSelection
} from '@shared/keyboard-nav'
import { stepAnchor, weekTitle, type CalendarViewType } from '@shared/visible-range'
import { startOfWeek } from '@shared/week-start'
import { recordEmojiUse } from '@shared/title-emoji'
import { useVisibleRange } from './hooks/use-visible-range'
import { useTheme } from './hooks/use-theme'
import { useQueryRange } from './hooks/use-query-range'
import { useCalendarData } from './hooks/use-calendar-data'
import { useUndoStack } from './hooks/use-undo-stack'
import { useEventCommands } from './hooks/use-event-commands'
import { useLastPointer } from './hooks/use-last-pointer'
import { useZoneFollowing } from './hooks/use-zone-following'
import { useAutoHideHeader } from './hooks/use-auto-hide-header'
import { useIcsIntake } from './hooks/use-ics-intake'
import { useCalendarContextMenu } from './hooks/use-calendar-context-menu'
import { useKeyCommands } from './hooks/use-key-commands'
import MonthView from './views/MonthView'
import WeekView from './views/WeekView'
import DayView from './views/DayView'
import YearView from './views/YearView'
import ListView from './views/ListView'
import EventEditorDialog, {
  type EventEditorInitialData,
  type EventEditorDraftPreview
} from './editor/EventEditorDialog'
import RecurringScopeDialog from './editor/RecurringScopeDialog'
import DropActionPopover from './dnd/DropActionPopover'
import AccountsDialog from './components/accounts/AccountsDialog'
import type { AccountsView } from './components/accounts/accounts-nav'
import SearchPaletteModal from './components/SearchPaletteModal'
import SettingsPanel, { type SettingsSection } from './components/SettingsPanel'
import KeyboardShortcutsModal from './components/KeyboardShortcutsModal'
import PrintDialog from './print/PrintDialog'
import SyncConflictsModal from './components/SyncConflictsModal'
import ReminderStack from './components/ReminderStack'
import AppHeader from './components/shell/AppHeader'
import AppSidebar from './components/shell/AppSidebar'
import { useEventDnD } from './dnd/use-event-dnd'
import { NotionToaster, toast, showFriendlyError, ContextMenu } from './components/ui'
import { DisplayPreferencesProvider, displayPreferencesOf } from './context/DisplayPreferencesContext'
import { SettingsProvider, useSettings, useSettingsState } from './context/SettingsContext'
import ImportIcsDialog from './components/ImportIcsDialog'
import WelcomeDialog, { type WelcomeNext } from './components/WelcomeDialog'

export type { CalendarViewType }

/** The dialog's start when nothing more specific was asked for; stable so it never resets the stack. */
const ACCOUNTS_LIST: AccountsView[] = [{ name: 'list' }]

/** The settings are read once, here; everything below reads them from the context. */
export const App: React.FC = () => {
  const settingsState = useSettingsState()
  return (
    <SettingsProvider value={settingsState}>
      <CalendarApp />
    </SettingsProvider>
  )
}

/**
 * The main window: which view and date are showing, which dialog is open, and
 * the wiring between the views and what the hooks under `hooks/` do - reading
 * events (`useCalendarData`), changing them (`useEventCommands`), undo, the
 * keyboard (`useKeyCommands` over `commandForKey`), the right-click menu,
 * .ics intake and following the computer's time zone.
 */
const CalendarApp: React.FC = () => {
  const { t, i18n } = useTranslation()
  const { settings, ready, setSetting, setLanguage } = useSettings()
  const { themeConfig } = useTheme()
  const displayPreferences = useMemo(() => displayPreferencesOf(settings), [settings])
  const { firstDayOfWeek, dragSnapMinutes, defaultEventMinutes } = displayPreferences

  const [currentView, setCurrentView] = useState<CalendarViewType>('week')
  const [anchorDate, setAnchorDate] = useState<DateTime>(() => DateTime.local())
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [appInfo, setAppInfo] = useState({ version: '0.1.0', platform: 'win32' })
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [settingsSection, setSettingsSection] = useState<SettingsSection | null>(null)
  // The pages the accounts dialog opens on; null while it is closed. Held in
  // state so the array keeps its identity while open - the dialog resets its
  // page stack whenever this changes.
  const [accountsDialog, setAccountsDialog] = useState<AccountsView[] | null>(null)
  const [isSearchPaletteOpen, setIsSearchPaletteOpen] = useState(false)
  const [isShortcutsModalOpen, setIsShortcutsModalOpen] = useState(false)
  const [isPrintOpen, setIsPrintOpen] = useState(false)
  const [isConflictsModalOpen, setIsConflictsModalOpen] = useState(false)
  const welcomeOpen = ready && !settings.welcomeDone

  const [isEditorOpen, setIsEditorOpen] = useState(false)
  const [editorData, setEditorData] = useState<EventEditorInitialData | null>(null)
  // Live slot/color preview for a NEW event while its editor is open - null the rest
  // of the time.
  const [draftPreview, setDraftPreview] = useState<EventEditorDraftPreview | null>(null)
  // Each opening is a new editor (see EventEditorDialog's initialForm).
  const [editorSession, setEditorSession] = useState(0)
  const openEditor = useCallback((data: EventEditorInitialData) => {
    setEditorData(data)
    setEditorSession((n) => n + 1)
    setIsEditorOpen(true)
  }, [])
  const closeEditor = useCallback(() => setIsEditorOpen(false), [])

  const visibleRange = useVisibleRange(anchorDate, currentView, i18n.language, firstDayOfWeek)
  const { queryRange, extendList } = useQueryRange(anchorDate, currentView, visibleRange)
  // Held back until the settings are in: the week start decides the range.
  const data = useCalendarData(queryRange, ready)
  const { calendars, accounts, occurrences, conflicts, reload } = data
  const undo = useUndoStack(reload)
  const { clientXOf, lastX } = useLastPointer()
  const commands = useEventCommands({ calendars, reload, undo, dragSnapMinutes, openEditor, closeEditor, clientXOf })
  const { moveOccurrence, deleteOccurrence } = commands
  const zoneMoves = useZoneFollowing()
  const header = useAutoHideHeader(settings.autoHideHeader)
  const ics = useIcsIntake()
  const icsInputRef = useRef<HTMLInputElement>(null)

  // Which occurrence the keyboard cursor is sitting on, found again whenever
  // the occurrences are read again (see refindSelection) - while rendering, so
  // the cursor never points at an occurrence that has just gone.
  const [selection, setSelection] = useState<CursorSelection | null>(null)
  const [selectionReadFrom, setSelectionReadFrom] = useState(occurrences)
  if (selectionReadFrom !== occurrences) {
    setSelectionReadFrom(occurrences)
    setSelection((prev) => refindSelection(prev, occurrences))
  }

  useEffect(() => {
    const api = window.xrncal?.app
    if (!api) return
    let cancelled = false
    Promise.all([api.getVersion(), api.getPlatform()])
      .then(([version, platform]) => {
        if (!cancelled) setAppInfo({ version: version || '0.1.0', platform: platform || 'win32' })
      })
      .catch(() => {
        // Keep the built-in version and platform fallbacks.
      })
    return () => {
      cancelled = true
    }
  }, [])

  const onDndMove = useCallback(
    (occ: ExpandedOccurrence, start: DateTime, end: DateTime, isCopy: boolean, targetAllDay?: boolean) =>
      void moveOccurrence(occ, start, end, isCopy, targetAllDay),
    [moveOccurrence]
  )
  const {
    pendingDrop,
    setPendingDrop,
    draggedOccurrence,
    dropTarget,
    wasJustDragging,
    handleDragStart,
    handleDragEnd,
    handleDragOverTarget,
    handleDropOnDate,
    markPointerBusyEnd
  } = useEventDnD(dragSnapMinutes, onDndMove)

  const handleResizeCommit = useCallback(
    (occ: ExpandedOccurrence, start: DateTime, end: DateTime) => void moveOccurrence(occ, start, end, false),
    [moveOccurrence]
  )

  // Week view drops onto the all-day lane, which turns a timed event into an
  // all-day one - the mirror of dragging an all-day event onto the hourly grid.
  const handleWeekAllDayDrop = useCallback(
    (e: React.DragEvent, targetDate: DateTime) => {
      handleDropOnDate(e, targetDate, undefined, { toAllDayLane: true })
    },
    [handleDropOnDate]
  )

  /** A new event from 09:00 on `date`: a Month view day click (with where it
   *  was, so the editor opens away from it), Create, N or Enter on a day. No
   *  end is handed over: the editor makes it the default length (Settings). */
  const openEditorForDate = useCallback(
    (date: DateTime, clientX?: number) => {
      if (wasJustDragging()) return
      openEditor({
        initialStart: date.set({ hour: 9, minute: 0, second: 0 }),
        initialClientX: clientX
      })
    },
    [wasJustDragging, openEditor]
  )

  /** A click or drag on an empty slot of the hour grid or the all-day lane.
   *  `clientX` docks the editor on the side away from the slot. */
  const openEditorForSlot = useCallback(
    (start: DateTime, end: DateTime, allDay?: boolean, clientX?: number) => {
      if (wasJustDragging()) return
      openEditor({ initialStart: start, initialEnd: end, initialAllDay: allDay, initialClientX: clientX })
    },
    [wasJustDragging, openEditor]
  )

  const handleSelectOccurrence = useCallback(
    (occ: ExpandedOccurrence) => {
      if (wasJustDragging()) return
      setSelection({ occurrenceId: occ.id, eventId: occ.eventId })
      openEditor({ occurrence: occ, initialClientX: clientXOf(occ.id) })
    },
    [wasJustDragging, openEditor, clientXOf]
  )

  // Week view middle-click gesture: delete the occurrence without opening the editor.
  const handleQuickDeleteOccurrence = useCallback(
    (occ: ExpandedOccurrence) => {
      if (wasJustDragging()) return
      deleteOccurrence(occ, { confirm: false })
    },
    [wasJustDragging, deleteOccurrence]
  )

  const page = useCallback(
    (direction: 1 | -1) => setAnchorDate((d) => stepAnchor(d, currentView, direction)),
    [currentView]
  )
  const handlePrev = useCallback(() => page(-1), [page])
  const handleNext = useCallback(() => page(1), [page])
  const handleToday = useCallback(() => setAnchorDate(DateTime.local()), [])

  const contextMenu = useCalendarContextMenu({
    occurrences,
    calendars,
    defaultEventMinutes,
    select: (occ) => setSelection({ occurrenceId: occ.id, eventId: occ.eventId }),
    open: handleSelectOccurrence,
    duplicate: (occ) => void commands.duplicateOccurrence(occ),
    remove: (occ) => deleteOccurrence(occ),
    newEventAt: openEditorForSlot,
    openDay: (day) => {
      setAnchorDate(day)
      setCurrentView('day')
    }
  })

  const restoreFromBackup = async (): Promise<void> => {
    if (!window.xrncal?.app?.restoreDatabase) return
    if (!window.confirm(t('settings.restoreConfirm'))) return
    try {
      const result = await window.xrncal.app.restoreDatabase()
      // On success the app restarts and nothing comes back.
      if (!result.success && result.message && result.message !== 'cancelled') {
        const known = ['notDatabase', 'notXrncal', 'newer'].includes(result.message)
        toast.error(t('settings.restoreFailed'), {
          description: known ? t(`settings.restoreProblem.${result.message}`) : result.message
        })
      }
    } catch (err) {
      showFriendlyError(err, t('settings.restoreFailed'))
    }
  }

  const finishWelcome = async (next: WelcomeNext, startAtLogin: boolean): Promise<void> => {
    await setSetting('welcomeDone', true)
    await setSetting('launchAtLogin', startAtLogin)
    if (next === 'subscription') setAccountsDialog([{ name: 'list' }, { name: 'subscriptions' }])
    else if (next) setAccountsDialog([{ name: 'list' }, { name: 'add' }, { name: 'connect', provider: next }])
  }

  const syncNow = async (): Promise<void> => {
    if (!window.xrncal?.sync?.triggerNow) return
    try {
      const res = await window.xrncal.sync.triggerNow()
      await reload()
      toast.success(t('toast.syncDone'), { description: res.message || undefined })
    } catch (err) {
      showFriendlyError(err, t('toast.syncFailed'))
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Keyboard control
  //
  // Everything the mouse can do to an event - open it, delete it, move it,
  // stretch it - needs some way of saying *which* event without pointing at
  // one. That is the cursor: an occurrence drawn with a ring, walked with the
  // up/down arrows, acted on by everything else.
  // ─────────────────────────────────────────────────────────────────────────

  const orderedOccurrences = useMemo(() => sortForCursor(occurrences), [occurrences])

  const selectedOccurrence = useMemo(
    () => occurrences.find((o) => o.id === selection?.occurrenceId) ?? null,
    [occurrences, selection]
  )

  // Keep the cursor on screen: Week and Day scroll a 24-hour grid, List scrolls
  // weeks of events. One query from up here beats a ref in every view.
  useEffect(() => {
    if (!selection) return
    const frame = requestAnimationFrame(() => {
      document
        .querySelector('[data-selected-occurrence]')
        ?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    })
    return () => cancelAnimationFrame(frame)
  }, [selection, currentView])

  // A layer above the calendar is taking keys: a bare letter must not reach
  // through a dialog and switch the view behind it.
  const isOverlayOpen =
    isEditorOpen ||
    Boolean(contextMenu.menu) ||
    Boolean(ics.files) ||
    welcomeOpen ||
    isSettingsOpen ||
    Boolean(accountsDialog) ||
    isShortcutsModalOpen ||
    isPrintOpen ||
    isConflictsModalOpen ||
    isSearchPaletteOpen ||
    Boolean(commands.pendingScope) ||
    Boolean(pendingDrop)

  // These close themselves on Escape - the accounts dialog steps back a page
  // per press. Handling it here as well would close two layers with one press.
  const ownsEscape =
    isEditorOpen ||
    isSearchPaletteOpen ||
    Boolean(pendingDrop) ||
    Boolean(accountsDialog) ||
    Boolean(contextMenu.menu) ||
    Boolean(ics.files) ||
    welcomeOpen

  const runKeyCommand = (command: KeyCommand): void => {
    switch (command.type) {
      case 'toggleSearch':
        setIsSearchPaletteOpen((prev) => !prev)
        break
      case 'openSearch':
        setIsSearchPaletteOpen(true)
        break
      case 'quit':
        void window.xrncal?.app?.quit?.()
        break
      case 'escape':
        if (commands.pendingScope) commands.cancelScope()
        else if (isShortcutsModalOpen) setIsShortcutsModalOpen(false)
        else if (isPrintOpen) setIsPrintOpen(false)
        else if (isConflictsModalOpen) setIsConflictsModalOpen(false)
        else if (isSettingsOpen) setIsSettingsOpen(false)
        else setSelection(null)
        break
      case 'toggleSidebar':
        // With the sidebar switched off there is nothing to collapse, so the
        // first press is what puts one there rather than doing nothing.
        if (settings.showMiniCalendar) setSidebarCollapsed((v) => !v)
        else {
          setSidebarCollapsed(false)
          void setSetting('showMiniCalendar', true)
        }
        break
      case 'undo':
        undo.undoLast()
        break
      case 'print':
        setIsPrintOpen(true)
        break
      case 'nudge': {
        // The same commit path as a drag or an edge-resize, so read-only
        // calendars, recurring scope and stale-id recovery all behave exactly
        // as they do with a mouse.
        if (!selectedOccurrence) break
        const range =
          command.mode === 'move'
            ? nudgedRange(selectedOccurrence, command.delta)
            : resizedRange(selectedOccurrence, command.delta.minutes ?? 0, dragSnapMinutes)
        if (range) void moveOccurrence(selectedOccurrence, range.start, range.end, false)
        break
      }
      case 'today':
        setAnchorDate(DateTime.local())
        break
      case 'page':
        page(command.direction)
        break
      case 'cursor': {
        const next = stepCursor(
          orderedOccurrences,
          selection?.occurrenceId ?? null,
          command.direction,
          anchorDate.toFormat('yyyy-MM-dd')
        )
        if (next) setSelection({ occurrenceId: next.id, eventId: next.eventId })
        break
      }
      case 'openSelected':
        if (selectedOccurrence) handleSelectOccurrence(selectedOccurrence)
        break
      case 'deleteSelected':
        if (selectedOccurrence) deleteOccurrence(selectedOccurrence)
        break
      case 'newEvent':
        openEditorForDate(anchorDate)
        break
      case 'view':
        setCurrentView(command.view)
        break
      case 'toggleShortcuts':
        setIsShortcutsModalOpen((prev) => !prev)
        break
      case 'openSettings':
        setSettingsSection(null)
        setIsSettingsOpen(true)
        break
      case 'sync':
        void syncNow()
        break
    }
  }

  useKeyCommands(
    {
      overlayOpen: isOverlayOpen,
      searchOpen: isSearchPaletteOpen,
      overlayOwnsEscape: ownsEscape,
      hasSelection: Boolean(selectedOccurrence),
      view: currentView,
      dragSnapMinutes
    },
    runKeyCommand
  )

  // Day view heads its column with the full date, so the bar would only repeat
  // it. Week view's columns carry day numbers but not the month, which is what
  // the bar says there.
  const appHeader = (
    <AppHeader
      title={
        currentView === 'day'
          ? ''
          : currentView === 'week'
            ? weekTitle(startOfWeek(anchorDate, firstDayOfWeek), i18n.language)
            : visibleRange.label
      }
      currentView={currentView}
      showSidebarToggle={settings.showMiniCalendar}
      onToggleSidebar={() => setSidebarCollapsed((v) => !v)}
      onPrev={handlePrev}
      onNext={handleNext}
      onNewEvent={() => openEditorForDate(anchorDate)}
      onChangeView={setCurrentView}
      onSearch={() => setIsSearchPaletteOpen(true)}
      onOpenMenu={() => {
        setSettingsSection(null)
        setIsSettingsOpen(true)
      }}
      conflictCount={conflicts.length}
    />
  )

  return (
    <DisplayPreferencesProvider value={displayPreferences}>
    <div
      className="relative flex h-screen w-screen flex-col overflow-hidden bg-app font-sans text-primary select-none"
      style={
        {
          '--accent-color': themeConfig.accentColor,
          '--color-accent-mark': themeConfig.accentColor
        } as React.CSSProperties
      }
    >
      {themeConfig.customBgUrl && (
        <>
          <div
            className="pointer-events-none fixed inset-0 z-0 scale-105 bg-cover bg-center"
            style={{
              backgroundImage: `url(${themeConfig.customBgUrl})`,
              filter: `blur(${themeConfig.bgBlur}px)`
            }}
          />
          <div
            className="pointer-events-none fixed inset-0 z-0"
            style={{
              background: 'var(--gc-overlay-color)',
              opacity: themeConfig.bgOverlayOpacity
            }}
          />
        </>
      )}

      {!settings.autoHideHeader ? (
        // Plain, always-visible header - no collapse machinery.
        <div className="shrink-0">{appHeader}</div>
      ) : (
        <>
          {/* Thin hotspot at the very top edge - catches the pointer re-entering
              while the header is collapsed away, taskbar-style. */}
          <div className="fixed inset-x-0 top-0 z-20 h-1.5" onMouseEnter={header.show} />

          {/* Push-based collapse (not an overlay) - the header's own box shrinks to
              0, so the calendar content underneath slides down/up with it instead of
              ever being covered. Overflow only clips while collapsed/collapsing -
              once expanded it switches to visible so the view-switcher and overflow
              menu dropdowns (which extend below the 48px bar) aren't cut off. */}
          <div
            className={`shrink-0 transition-[max-height] duration-100 ease-out ${
              header.visible ? 'overflow-visible' : 'overflow-hidden'
            }`}
            style={{ maxHeight: header.visible ? '48px' : '0px' }}
            onMouseEnter={header.show}
            onMouseLeave={header.scheduleHide}
          >
            {appHeader}
          </div>
        </>
      )}

      <div className="z-10 flex min-h-0 flex-1 overflow-hidden">
        {settings.showMiniCalendar && (
          <AppSidebar
            collapsed={sidebarCollapsed}
            anchorDate={anchorDate}
            occurrences={occurrences}
            firstDayOfWeek={firstDayOfWeek}
            onSelectDate={setAnchorDate}
            onPrevMonth={() => setAnchorDate((d) => d.minus({ months: 1 }))}
            onNextMonth={() => setAnchorDate((d) => d.plus({ months: 1 }))}
            accounts={accounts}
            calendars={calendars}
            onToggleCalendarVisibility={data.toggleCalendarVisibility}
            onSetCalendarsVisibility={data.setCalendarsVisibility}
            onChangeCalendarColor={data.changeCalendarColor}
            onOpenAccount={(accountId) =>
              setAccountsDialog(
                accountId === 'subscriptions'
                  ? [{ name: 'list' }, { name: 'subscriptions' }]
                  : accountId
                    ? [{ name: 'list' }, { name: 'account', accountId }]
                    : [{ name: 'list' }]
              )
            }
            onAddAccount={() => setAccountsDialog([{ name: 'list' }, { name: 'add' }])}
          />
        )}

        <main key={zoneMoves} className="relative flex min-w-0 flex-1 flex-col overflow-hidden bg-surface">

          {currentView === 'month' && (
            <MonthView
              anchorDate={anchorDate}
              occurrences={occurrences}
              showLunar={settings.showLunar}
              showWeekNumbers={settings.showWeekNumbers}
              onSelectDate={(date) => openEditorForDate(date, lastX())}
              onSelectOccurrence={handleSelectOccurrence}
              onPrevMonth={handlePrev}
              onNextMonth={handleNext}
              draggedOccurrenceId={draggedOccurrence?.id}
              selectedOccurrenceId={selection?.occurrenceId}
              dropTarget={dropTarget}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              onDragOverTarget={handleDragOverTarget}
              onDropOnDate={handleDropOnDate}
            />
          )}

          {currentView === 'week' && (
            <WeekView
              anchorDate={anchorDate}
              occurrences={occurrences}
              showLunar={settings.showLunar}
              showWeekNumbers={settings.showWeekNumbers}
              previewSlot={draftPreview}
              onSelectSlot={(start, end, meta) => openEditorForSlot(start, end, meta?.allDay, meta?.clientX)}
              onSelectOccurrence={handleSelectOccurrence}
              onDeleteOccurrence={handleQuickDeleteOccurrence}
              onGoToday={handleToday}
              onPrevWeek={handlePrev}
              onNextWeek={handleNext}
              draggedOccurrenceId={draggedOccurrence?.id}
              selectedOccurrenceId={selection?.occurrenceId}
              dropTarget={dropTarget}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              onDragOverTarget={handleDragOverTarget}
              onDropOnDate={handleDropOnDate}
              onDropOnAllDayLane={handleWeekAllDayDrop}
              onResizeCommit={handleResizeCommit}
              onResizeBusyEnd={markPointerBusyEnd}
            />
          )}

          {currentView === 'day' && (
            <DayView
              anchorDate={anchorDate}
              occurrences={occurrences}
              showLunar={settings.showLunar}
              previewSlot={draftPreview}
              onSelectSlot={(start, end, meta) => openEditorForSlot(start, end, meta?.allDay, meta?.clientX)}
              onSelectOccurrence={handleSelectOccurrence}
              onPrevDay={handlePrev}
              onNextDay={handleNext}
              draggedOccurrenceId={draggedOccurrence?.id}
              selectedOccurrenceId={selection?.occurrenceId}
              dropTarget={dropTarget}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              onDragOverTarget={handleDragOverTarget}
              onDropOnDate={handleDropOnDate}
              onResizeCommit={handleResizeCommit}
              onResizeBusyEnd={markPointerBusyEnd}
            />
          )}

          {currentView === 'year' && (
            <YearView
              anchorDate={anchorDate}
              occurrences={occurrences}
              showLunar={settings.showLunar}
              onPrevYear={handlePrev}
              onNextYear={handleNext}
              onSelectMonth={(year, month) => {
                setAnchorDate((d) => d.set({ year, month, day: 1 }))
                setCurrentView('month')
              }}
              onSelectDate={(date) => {
                setAnchorDate(date)
                setCurrentView('day')
              }}
            />
          )}

          {currentView === 'list' && (
            <ListView
              anchorDate={anchorDate}
              occurrences={occurrences}
              showLunar={settings.showLunar}
              selectedOccurrenceId={selection?.occurrenceId}
              onSelectOccurrence={handleSelectOccurrence}
              onAddEvent={() => openEditorForDate(anchorDate)}
              onNearEdge={extendList}
            />
          )}
        </main>
      </div>

      <SearchPaletteModal
        isOpen={isSearchPaletteOpen}
        onClose={() => setIsSearchPaletteOpen(false)}
        calendars={calendars}
        onSelectEvent={(event, targetDate) => {
          setAnchorDate(DateTime.fromISO(targetDate))
          openEditor({ event })
        }}
      />

      <KeyboardShortcutsModal
        isOpen={isShortcutsModalOpen}
        onClose={() => setIsShortcutsModalOpen(false)}
      />

      {isPrintOpen && (
        <PrintDialog
          calendars={calendars}
          view={currentView}
          anchorDate={anchorDate}
          onClose={() => setIsPrintOpen(false)}
        />
      )}

      <SyncConflictsModal
        isOpen={isConflictsModalOpen}
        conflicts={conflicts}
        onClose={() => setIsConflictsModalOpen(false)}
        onResolve={data.resolveConflict}
      />

      {isEditorOpen && (
        <EventEditorDialog
          key={editorSession}
          calendars={calendars}
          accounts={accounts}
          data={editorData}
          onSave={commands.saveEvent}
          onDelete={commands.deleteEvent}
          onDataChanged={reload}
          onClose={closeEditor}
          onDraftChange={setDraftPreview}
          onEmojiPicked={(emoji) =>
            void setSetting('favoriteEmojis', recordEmojiUse(settings.favoriteEmojis, emoji), { quiet: true })
          }
        />
      )}

      <RecurringScopeDialog
        isOpen={Boolean(commands.pendingScope)}
        title={commands.pendingScope?.title || ''}
        action={commands.pendingScope?.action || 'edit'}
        onConfirm={commands.confirmScope}
        onCancel={commands.cancelScope}
      />

      <DropActionPopover
        pendingDrop={pendingDrop}
        onMove={(drop) => commands.dropMove(drop, () => setPendingDrop(null))}
        onCopy={(drop, copyInstanceOnly) => commands.dropCopy(drop, copyInstanceOnly, () => setPendingDrop(null))}
        onCancel={() => setPendingDrop(null)}
      />

      <AccountsDialog
        isOpen={Boolean(accountsDialog)}
        start={accountsDialog ?? ACCOUNTS_LIST}
        accounts={accounts}
        calendars={calendars}
        onClose={() => setAccountsDialog(null)}
        onRefresh={reload}
        onToggleVisibility={data.toggleCalendarVisibility}
        onChangeColor={data.changeCalendarColor}
      />

      <SettingsPanel
        isOpen={isSettingsOpen}
        section={settingsSection}
        onSectionChange={setSettingsSection}
        onClose={() => setIsSettingsOpen(false)}
        onManageAccounts={() => {
          setIsSettingsOpen(false)
          setAccountsDialog([{ name: 'list' }])
        }}
        onOpenShortcuts={() => setIsShortcutsModalOpen(true)}
        onImportIcs={() => {
          setIsSettingsOpen(false)
          icsInputRef.current?.click()
        }}
        onRestoreBackup={() => void restoreFromBackup()}
        onPrint={() => {
          setIsSettingsOpen(false)
          setIsPrintOpen(true)
        }}
        conflictCount={conflicts.length}
        onOpenConflicts={() => setIsConflictsModalOpen(true)}
        appVersion={appInfo.version}
        platform={appInfo.platform}
      />

      <ContextMenu
        at={contextMenu.menu?.at ?? null}
        entries={contextMenu.menu?.entries ?? []}
        label={contextMenu.menu?.label}
        onClose={contextMenu.close}
      />

      {/* Held back while the welcome is up: a new user who opened xrncal by
          double-clicking an invitation gets the welcome first, then the import. */}
      <ImportIcsDialog
        files={welcomeOpen ? null : ics.files}
        calendars={calendars}
        onClose={ics.clear}
        onImported={reload}
      />

      <WelcomeDialog
        isOpen={welcomeOpen}
        language={i18n.language}
        onSetLanguage={(locale) => void setLanguage(locale)}
        showLunar={settings.showLunar}
        onToggleLunar={(next) => void setSetting('showLunar', next)}
        calendars={calendars}
        onCalendarsChanged={() => void reload()}
        onFinish={(next, startAtLogin) => void finishWelcome(next, startAtLogin)}
      />

      {/* Settings -> Import opens this; the picked files go to ImportIcsDialog. */}
      <input
        ref={icsInputRef}
        type="file"
        accept=".ics,.ical,text/calendar"
        multiple
        className="hidden"
        onChange={(e) => {
          const list = e.target.files
          if (list && list.length > 0) ics.accept(list)
          e.target.value = ''
        }}
      />

      <ReminderStack
        calendars={calendars}
        onOpen={(occurrence) => {
          setSelection({ occurrenceId: occurrence.id, eventId: occurrence.eventId })
          openEditor({ occurrence, initialClientX: clientXOf(occurrence.id) })
        }}
      />

      <NotionToaster />
    </div>
    </DisplayPreferencesProvider>
  )
}

export default App
