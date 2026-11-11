import { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { DateTime } from 'luxon'
import type { XrncalAPI } from '@shared/ipc-contract'
import type {
  Calendar,
  CalendarEvent,
  CreateEventInput,
  EventException,
  ExpandedOccurrence,
  RecurringEditScope,
  UpdateEventInput
} from '@shared/event-model'
import type { EventEditorInitialData } from '../editor/EventEditorDialog'
import type { PendingDropAction } from '../dnd/DropActionPopover'
import { singleDayRange } from '../dnd/drop-target'
import { defaultCalendarFor } from '../lib/new-event'
import { seriesWideUpdate } from '@shared/series-update'
import { isStaleEventError, showFriendlyError, toast } from '../components/ui'
import type { UndoStack } from './use-undo-stack'

/** A change to one occurrence of a series, waiting for "this / following / all". */
export interface PendingRecurringScope {
  action: 'edit' | 'delete'
  title: string
  eventId: string
  occurrenceStartUtc: string
  input?: UpdateEventInput
}

export interface EditorSavePayload {
  isNew: boolean
  eventId?: string
  occurrenceStartUtc?: string
  isRecurringOccurrence?: boolean
  input: CreateEventInput | UpdateEventInput
}

interface EventCommandDeps {
  calendars: Calendar[]
  reload: () => Promise<void>
  undo: UndoStack
  dragSnapMinutes: number
  openEditor: (data: EventEditorInitialData) => void
  closeEditor: () => void
  clientXOf: (occurrenceId: string) => number | undefined
}

/** An occurrence put back where it was: the update a 'this'-scoped change of
 *  a recurring occurrence is undone with. */
function occurrenceAsUpdate(occ: ExpandedOccurrence): UpdateEventInput {
  return {
    title: occ.title,
    dtStartUtc: occ.startUtc,
    dtEndUtc: occ.endUtc,
    tzid: occ.tzid,
    allDay: occ.allDay,
    notes: occ.notes,
    location: occ.location,
    meetingUrl: occ.meetingUrl
  }
}

/** The inverse of deleting one, this-and-future, or all occurrences of a series. */
function undoForScopedDelete(
  events: XrncalAPI['events'],
  snapshot: { event: CalendarEvent; exceptions: EventException[] },
  originalStartUtc: string,
  scope: RecurringEditScope
): () => Promise<unknown> {
  const master = snapshot.event
  if (scope === 'all') return () => events.restore(snapshot)
  // The series was capped with UNTIL; give it its old rule back.
  if (scope === 'future') return () => events.update(master.id, { rrule: master.rrule })
  // One occurrence was cancelled. The repo knows whether that has reached
  // the provider yet, and so how to bring it back (see restoreOccurrence).
  return () => events.restore(snapshot, originalStartUtc)
}

/**
 * What can be done to events from the calendar: move, resize and copy (by
 * mouse, keyboard or the drop popover), save from the editor, delete, and
 * the recurring-scope prompt those lead to. Every move, resize, copy and
 * delete leaves its exact inverse on the undo stack.
 */
export function useEventCommands(deps: EventCommandDeps) {
  const { calendars, reload, undo, dragSnapMinutes, openEditor, closeEditor, clientXOf } = deps
  const { pushUndo, offerUndoDelete } = undo
  const { t } = useTranslation()
  const [pendingScope, setPendingScope] = useState<PendingRecurringScope | null>(null)
  // A save, or a choice in the scope prompt, still on its way to the main
  // process. Ctrl+Enter saves from anywhere in the editor, which stays open
  // until the save is back: pressed twice while the main process was busy, it
  // created the event twice. A double click on "this and following" split the
  // series twice the same way.
  const saving = useRef(false)

  const moveOccurrence = useCallback(
    async (
      occ: ExpandedOccurrence,
      targetStart: DateTime,
      targetEnd: DateTime,
      isCopy: boolean,
      /** Undefined keeps the occurrence's current all-day-ness. */
      targetAllDay?: boolean
    ): Promise<void> => {
      if (!window.xrncal?.events) return
      const events = window.xrncal.events

      const sourceCal = calendars.find((c) => c.id === occ.calendarId)
      if (sourceCal?.isReadOnly && !isCopy) {
        toast.error(t('toast.readOnlyTitle'), { description: t('toast.readOnlyMove') })
        return
      }

      try {
        if (isCopy) {
          // Drag-copy makes a new event that shares a name and a calendar, not a
          // duplicate: no recurrence, no multi-day span, and none of the
          // original's notes, location or meeting link. Its length is kept.
          const range = singleDayRange(targetStart, targetEnd, dragSnapMinutes)
          const copied = await events.copy({
            sourceEventId: occ.eventId,
            dtStartUtc: range.start.toUTC().toISO()!,
            dtEndUtc: range.end.toUTC().toISO()!,
            targetCalendarId: occ.calendarId,
            copyInstanceOnly: true,
            bare: true,
            // Alt-dragging an all-day event onto the grid has to produce a timed
            // copy too, or the copy keeps its all-day flag with an hour's range.
            allDay: targetAllDay === undefined ? occ.allDay : targetAllDay
          })
          pushUndo(() => events.delete(copied.id))
        } else if (occ.isRecurring) {
          await events.updateScope({
            masterEventId: occ.eventId,
            originalStartUtc: occ.originalStartUtc || occ.startUtc,
            scope: 'this',
            updateInput: {
              title: occ.title,
              dtStartUtc: targetStart.toUTC().toISO()!,
              dtEndUtc: targetEnd.toUTC().toISO()!,
              tzid: occ.tzid,
              // Dropping one occurrence of an all-day series onto the hourly grid
              // detaches just that occurrence as a timed event, like Google does.
              allDay: targetAllDay === undefined ? occ.allDay : targetAllDay,
              notes: occ.notes,
              location: occ.location,
              meetingUrl: occ.meetingUrl
            }
          })
          pushUndo(() =>
            events.updateScope({
              masterEventId: occ.eventId,
              originalStartUtc: occ.originalStartUtc || occ.startUtc,
              scope: 'this',
              updateInput: occurrenceAsUpdate(occ)
            })
          )
        } else {
          await events.move({
            eventId: occ.eventId,
            dtStartUtc: targetStart.toUTC().toISO()!,
            dtEndUtc: targetEnd.toUTC().toISO()!,
            targetCalendarId: occ.calendarId,
            allDay: targetAllDay === undefined ? occ.allDay : targetAllDay
          })
          pushUndo(() =>
            events.move({
              eventId: occ.eventId,
              dtStartUtc: occ.startUtc,
              dtEndUtc: occ.endUtc,
              targetCalendarId: occ.calendarId,
              allDay: occ.allDay
            })
          )
        }
        await reload()
      } catch (err) {
        // A sync that lands between the drag starting and the drop finishing can
        // re-key the event, so the id in hand is already gone. Refresh instead of
        // blaming the user for a move that was valid when they began it.
        if (isStaleEventError(err)) {
          await reload()
          toast.error(t('friendly.staleTitle'), { description: t('friendly.staleBody') })
          return
        }
        showFriendlyError(err, t('toast.moveFailed'))
      }
    },
    [calendars, dragSnapMinutes, reload, pushUndo, t]
  )

  const saveEvent = async (payload: EditorSavePayload): Promise<void> => {
    if (!window.xrncal?.events || saving.current) return
    saving.current = true

    try {
      if (payload.isNew) {
        await window.xrncal.events.create(payload.input as CreateEventInput)
        closeEditor()
        await reload()
      } else if (payload.eventId) {
        if (payload.isRecurringOccurrence && payload.occurrenceStartUtc) {
          closeEditor()
          setPendingScope({
            action: 'edit',
            title: (payload.input as UpdateEventInput).title || '',
            eventId: payload.eventId,
            occurrenceStartUtc: payload.occurrenceStartUtc,
            input: payload.input as UpdateEventInput
          })
        } else {
          await window.xrncal.events.update(payload.eventId, payload.input as UpdateEventInput)
          closeEditor()
          await reload()
        }
      }
    } catch (err) {
      showFriendlyError(err, t('toast.saveFailed'))
    } finally {
      saving.current = false
    }
  }

  const deleteEvent = useCallback(
    async (
      eventId: string,
      occurrenceStartUtc?: string,
      isRecurring?: boolean,
      /** Middle-click asks for no prompt: the gesture is already the decision. */
      options?: { confirm?: boolean }
    ): Promise<void> => {
      if (!window.xrncal?.events) return
      const events = window.xrncal.events

      const shouldPrompt = options?.confirm !== false
      const done = async (): Promise<void> => {
        closeEditor()
        await reload()
      }

      if (isRecurring && occurrenceStartUtc) {
        if (!shouldPrompt) {
          // Middle-clicking picks out one occurrence, so that is what it removes.
          // The scope prompt asks a question the gesture has already answered, and
          // 'this' is both the literal reading and the least destructive one.
          try {
            const snapshot = await events.getById(eventId)
            await events.deleteScope({ masterEventId: eventId, originalStartUtc: occurrenceStartUtc, scope: 'this' })
            if (snapshot) offerUndoDelete(undoForScopedDelete(events, snapshot, occurrenceStartUtc, 'this'))
            await done()
          } catch (err) {
            showFriendlyError(err, t('toast.deleteFailed'))
          }
          return
        }

        closeEditor()
        setPendingScope({ action: 'delete', title: '', eventId, occurrenceStartUtc })
        return
      }

      if (shouldPrompt && !window.confirm(t('toast.confirmDelete'))) return

      try {
        // Taken before the delete: a synced deletion is pushed within seconds, and
        // after that only the snapshot can bring the event back.
        const snapshot = await events.getById(eventId)
        await events.delete(eventId)
        if (snapshot) offerUndoDelete(() => events.restore(snapshot))
        await done()
      } catch (err) {
        showFriendlyError(err, t('toast.deleteFailed'))
      }
    },
    [closeEditor, reload, offerUndoDelete, t]
  )

  /** Delete what the cursor, a right-click or a middle-click is on - not out
   *  of a read-only calendar. */
  const deleteOccurrence = useCallback(
    (occ: ExpandedOccurrence, options?: { confirm?: boolean }): void => {
      if (calendars.find((c) => c.id === occ.calendarId)?.isReadOnly) {
        toast.error(t('toast.readOnlyTitle'), { description: t('toast.readOnlyDelete') })
        return
      }
      void deleteEvent(occ.eventId, occ.originalStartUtc || occ.startUtc, occ.isRecurring, options)
    },
    [calendars, deleteEvent, t]
  )

  const confirmScope = async (scope: RecurringEditScope): Promise<void> => {
    if (!pendingScope || !window.xrncal?.events || saving.current) return
    const events = window.xrncal.events
    saving.current = true

    try {
      if (pendingScope.action === 'edit' && pendingScope.input) {
        // The input describes the occurrence it was made on; for the whole
        // series its times are carried over to the first date (seriesWideUpdate).
        const series = scope === 'all' ? await events.getById(pendingScope.eventId) : null
        await events.updateScope({
          masterEventId: pendingScope.eventId,
          originalStartUtc: pendingScope.occurrenceStartUtc,
          scope,
          updateInput: series
            ? seriesWideUpdate(pendingScope.input, pendingScope.occurrenceStartUtc, series)
            : pendingScope.input
        })
      } else if (pendingScope.action === 'delete') {
        const snapshot = await events.getById(pendingScope.eventId)
        await events.deleteScope({
          masterEventId: pendingScope.eventId,
          originalStartUtc: pendingScope.occurrenceStartUtc,
          scope
        })
        if (snapshot) {
          offerUndoDelete(undoForScopedDelete(events, snapshot, pendingScope.occurrenceStartUtc, scope))
        }
      }
      setPendingScope(null)
      await reload()
    } catch (err) {
      showFriendlyError(err, t('toast.recurringUpdateFailed'))
    } finally {
      saving.current = false
    }
  }

  /** A copy of one occurrence as an event of its own, opened in the editor to
   *  be moved or renamed. Out of a read-only calendar it lands in the default one. */
  const duplicateOccurrence = async (occ: ExpandedOccurrence): Promise<void> => {
    if (!window.xrncal?.events) return
    const events = window.xrncal.events
    const source = calendars.find((c) => c.id === occ.calendarId)
    const target = source?.isReadOnly ? defaultCalendarFor(calendars)?.id : occ.calendarId
    try {
      const copied = await events.copy({
        sourceEventId: occ.eventId,
        dtStartUtc: occ.startUtc,
        dtEndUtc: occ.endUtc,
        targetCalendarId: target,
        copyInstanceOnly: true,
        allDay: occ.allDay
      })
      pushUndo(() => events.delete(copied.id))
      await reload()
      // The copy sits where the original does.
      openEditor({ event: copied, initialClientX: clientXOf(occ.id) })
    } catch (err) {
      showFriendlyError(err, t('toast.copyFailed'))
    }
  }

  /** "Move" in the drop popover. `close` takes the popover down: on success, and
   *  when there is nothing left to retry - not after a failure worth retrying. */
  const dropMove = async (drop: PendingDropAction, close: () => void): Promise<void> => {
    if (!window.xrncal?.events) return
    const events = window.xrncal.events

    const targetCalId = drop.targetCalendarId || drop.occurrence.calendarId
    const targetCal = calendars.find((c) => c.id === targetCalId)
    const sourceCal = calendars.find((c) => c.id === drop.occurrence.calendarId)
    if (sourceCal?.isReadOnly || targetCal?.isReadOnly) {
      toast.error(t('toast.readOnlyTitle'), { description: t('toast.readOnlyMove') })
      close()
      return
    }

    try {
      if (drop.occurrence.isRecurring) {
        close()
        setPendingScope({
          action: 'edit',
          title: drop.occurrence.title,
          eventId: drop.occurrence.eventId,
          occurrenceStartUtc: drop.occurrence.originalStartUtc || drop.occurrence.startUtc,
          input: {
            dtStartUtc: drop.targetStart.toUTC().toISO()!,
            dtEndUtc: drop.targetEnd.toUTC().toISO()!,
            title: drop.occurrence.title
          }
        })
        return
      }

      await events.move({
        eventId: drop.occurrence.eventId,
        dtStartUtc: drop.targetStart.toUTC().toISO()!,
        dtEndUtc: drop.targetEnd.toUTC().toISO()!,
        targetCalendarId: targetCalId
      })
      const original = drop.occurrence
      pushUndo(() =>
        events.move({
          eventId: original.eventId,
          dtStartUtc: original.startUtc,
          dtEndUtc: original.endUtc,
          targetCalendarId: original.calendarId,
          allDay: original.allDay
        })
      )
      close()
      await reload()
    } catch (err) {
      if (isStaleEventError(err)) {
        await reload()
        toast.error(t('friendly.staleTitle'), { description: t('friendly.staleBody') })
        close()
        return
      }
      showFriendlyError(err, t('toast.moveFailed'))
    }
  }

  /** "Copy" in the drop popover; `close` as for `dropMove`. */
  const dropCopy = async (
    drop: PendingDropAction,
    copyInstanceOnly: boolean | undefined,
    close: () => void
  ): Promise<void> => {
    if (!window.xrncal?.events) return
    const events = window.xrncal.events
    try {
      // "Copy whole series" is asking for a duplicate, so it keeps everything.
      // Every other copy is a new event that shares a name: no recurrence, no
      // multi-day span, and none of the original's notes, location or link.
      const bare = copyInstanceOnly === true || !drop.occurrence.isRecurring
      const range = bare
        ? singleDayRange(drop.targetStart, drop.targetEnd, dragSnapMinutes)
        : { start: drop.targetStart, end: drop.targetEnd }

      const copied = await events.copy({
        sourceEventId: drop.occurrence.eventId,
        dtStartUtc: range.start.toUTC().toISO()!,
        dtEndUtc: range.end.toUTC().toISO()!,
        targetCalendarId: drop.targetCalendarId,
        copyInstanceOnly: copyInstanceOnly ?? bare,
        bare
      })
      pushUndo(() => events.delete(copied.id))
      close()
      await reload()
    } catch (err) {
      showFriendlyError(err, t('toast.copyFailed'))
    }
  }

  return {
    pendingScope,
    cancelScope: () => setPendingScope(null),
    confirmScope,
    moveOccurrence,
    saveEvent,
    deleteEvent,
    deleteOccurrence,
    duplicateOccurrence,
    dropMove,
    dropCopy
  }
}
