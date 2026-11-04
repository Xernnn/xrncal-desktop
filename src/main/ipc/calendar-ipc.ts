import { ipcMain, app, shell, dialog, BrowserWindow } from 'electron'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { IPC_CHANNELS, type IcsExportResult, type IcsImportResult } from '@shared/ipc-contract'
import type {
  CreateEventInput,
  UpdateEventInput,
  EventException,
  MoveEventInput,
  CopyEventInput,
  UpdateRecurringScopeInput,
  DeleteRecurringScopeInput,
  MaterializeLunarInput,
  DetachLunarInput,
  RsvpResponse,
  CalendarEvent
} from '@shared/event-model'
import type { SuggestTitlesOptions, TitleSuggestion } from '@shared/title-suggestions'
import { rankTitleSuggestions } from '@shared/title-suggestions'
import { DateTime } from 'luxon'
import { CalendarsRepo } from '../db/repos/calendars-repo'
import { EventsRepo, ReadOnlyCalendarError } from '../db/repos/events-repo'
import { getDatabase } from '../db/database'
import { parseIcsContent } from '../ics/parse-ics'
import { generateIcs } from '../ics/write-ics'
import { getSyncWorker } from './auth-sync-ipc'
import { takeOpenedFiles } from '../opened-ics-files'
import { writeSharedIcs } from '../share-ics-file'
import { describeError } from '../sync/http'

/** Fire-and-forget an immediate push/pull right after a local write, instead of waiting for the next poll. */
function nudgeSync(): void {
  getSyncWorker()?.triggerSync().catch(() => {})
}

export function registerCalendarIpcHandlers(): void {
  const db = getDatabase()
  const calendarsRepo = new CalendarsRepo(db)
  const eventsRepo = new EventsRepo(db)

  // Clear existing handlers for idempotency
  ipcMain.removeHandler(IPC_CHANNELS.CALENDAR.LIST)
  ipcMain.removeHandler(IPC_CHANNELS.CALENDAR.CREATE)
  ipcMain.removeHandler(IPC_CHANNELS.CALENDAR.UPDATE)
  ipcMain.removeHandler(IPC_CHANNELS.CALENDAR.DELETE)

  ipcMain.removeHandler(IPC_CHANNELS.EVENT.QUERY_RANGE)
  ipcMain.removeHandler(IPC_CHANNELS.EVENT.GET_BY_ID)
  ipcMain.removeHandler(IPC_CHANNELS.EVENT.CREATE)
  ipcMain.removeHandler(IPC_CHANNELS.EVENT.UPDATE)
  ipcMain.removeHandler(IPC_CHANNELS.EVENT.DELETE)
  ipcMain.removeHandler(IPC_CHANNELS.EVENT.MOVE)
  ipcMain.removeHandler(IPC_CHANNELS.EVENT.COPY)
  ipcMain.removeHandler(IPC_CHANNELS.EVENT.UPDATE_SCOPE)
  ipcMain.removeHandler(IPC_CHANNELS.EVENT.DELETE_SCOPE)
  ipcMain.removeHandler(IPC_CHANNELS.EVENT.UPSERT_EXCEPTION)
  ipcMain.removeHandler(IPC_CHANNELS.EVENT.MATERIALIZE_LUNAR)
  ipcMain.removeHandler(IPC_CHANNELS.EVENT.DETACH_LUNAR)
  ipcMain.removeHandler(IPC_CHANNELS.EVENT.SEARCH)
  ipcMain.removeHandler(IPC_CHANNELS.EVENT.SUGGEST_TITLES)
  ipcMain.removeHandler(IPC_CHANNELS.EVENT.SHARE_ICS)
  ipcMain.removeHandler(IPC_CHANNELS.EVENT.LIST_CONFLICTS)
  ipcMain.removeHandler(IPC_CHANNELS.EVENT.RESOLVE_CONFLICT)
  ipcMain.removeHandler(IPC_CHANNELS.EVENT.RESPOND)
  ipcMain.removeHandler(IPC_CHANNELS.EVENT.RESTORE)

  ipcMain.removeHandler(IPC_CHANNELS.ICS.IMPORT)
  ipcMain.removeHandler(IPC_CHANNELS.ICS.EXPORT)
  ipcMain.removeHandler(IPC_CHANNELS.ICS.TAKE_OPENED)

  // 1. Calendar handlers
  ipcMain.handle(IPC_CHANNELS.CALENDAR.LIST, () => {
    return calendarsRepo.listCalendars()
  })

  ipcMain.handle(
    IPC_CHANNELS.CALENDAR.CREATE,
    (_event, data: { name: string; color: string }) => {
      return calendarsRepo.createCalendar({
        name: data.name,
        color: data.color
      })
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.CALENDAR.UPDATE,
    (_event, id: string, data: { name?: string; color?: string; isVisible?: boolean }) => {
      return calendarsRepo.updateCalendar(id, data)
    }
  )

  ipcMain.handle(IPC_CHANNELS.CALENDAR.DELETE, (_event, id: string) => {
    return calendarsRepo.deleteCalendar(id)
  })

  // 2. Event handlers
  ipcMain.handle(
    IPC_CHANNELS.EVENT.QUERY_RANGE,
    (_event, calendarIds: string[], startUtc: string, endUtc: string) => {
      return eventsRepo.queryEventsByRange(calendarIds, startUtc, endUtc)
    }
  )

  ipcMain.handle(IPC_CHANNELS.EVENT.GET_BY_ID, (_event, id: string) => {
    return eventsRepo.getEventById(id)
  })

  ipcMain.handle(IPC_CHANNELS.EVENT.CREATE, (_event, input: CreateEventInput) => {
    try {
      const created = eventsRepo.createEvent(input)
      nudgeSync()
      return created
    } catch (err) {
      if (err instanceof ReadOnlyCalendarError) {
        throw new Error(`Write rejected: ${err.message}`, { cause: err })
      }
      throw err
    }
  })

  ipcMain.handle(IPC_CHANNELS.EVENT.UPDATE, (_event, id: string, input: UpdateEventInput) => {
    try {
      const updated = eventsRepo.updateEvent(id, input)
      nudgeSync()
      return updated
    } catch (err) {
      if (err instanceof ReadOnlyCalendarError) {
        throw new Error(`Write rejected: ${err.message}`, { cause: err })
      }
      throw err
    }
  })

  ipcMain.handle(IPC_CHANNELS.EVENT.DELETE, (_event, id: string) => {
    try {
      const result = eventsRepo.deleteEvent(id)
      nudgeSync()
      return result
    } catch (err) {
      if (err instanceof ReadOnlyCalendarError) {
        throw new Error(`Delete rejected: ${err.message}`, { cause: err })
      }
      throw err
    }
  })

  ipcMain.handle(
    IPC_CHANNELS.EVENT.UPSERT_EXCEPTION,
    (_event, exception: Omit<EventException, 'id' | 'createdAt' | 'updatedAt'>) => {
      try {
        const result = eventsRepo.upsertException(exception)
        nudgeSync()
        return result
      } catch (err) {
        if (err instanceof ReadOnlyCalendarError) {
          throw new Error(`Exception write rejected: ${err.message}`, { cause: err })
        }
        throw err
      }
    }
  )

  ipcMain.handle(IPC_CHANNELS.EVENT.MOVE, (_event, input: MoveEventInput) => {
    try {
      const result = eventsRepo.moveEvent(input)
      nudgeSync()
      return result
    } catch (err) {
      if (err instanceof ReadOnlyCalendarError) {
        throw new Error(`Move rejected: ${err.message}`, { cause: err })
      }
      throw err
    }
  })

  ipcMain.handle(IPC_CHANNELS.EVENT.COPY, (_event, input: CopyEventInput) => {
    try {
      const result = eventsRepo.copyEvent(input)
      nudgeSync()
      return result
    } catch (err) {
      if (err instanceof ReadOnlyCalendarError) {
        throw new Error(`Copy rejected: ${err.message}`, { cause: err })
      }
      throw err
    }
  })

  ipcMain.handle(IPC_CHANNELS.EVENT.UPDATE_SCOPE, (_event, input: UpdateRecurringScopeInput) => {
    try {
      const result = eventsRepo.updateRecurringScope(input)
      nudgeSync()
      return result
    } catch (err) {
      if (err instanceof ReadOnlyCalendarError) {
        throw new Error(`Recurring update rejected: ${err.message}`, { cause: err })
      }
      throw err
    }
  })

  ipcMain.handle(IPC_CHANNELS.EVENT.DELETE_SCOPE, (_event, input: DeleteRecurringScopeInput) => {
    try {
      const result = eventsRepo.deleteRecurringScope(input)
      nudgeSync()
      return result
    } catch (err) {
      if (err instanceof ReadOnlyCalendarError) {
        throw new Error(`Recurring delete rejected: ${err.message}`, { cause: err })
      }
      throw err
    }
  })

  ipcMain.handle(IPC_CHANNELS.EVENT.MATERIALIZE_LUNAR, (_event, input: MaterializeLunarInput) => {
    try {
      return eventsRepo.materializeLunarEvent(input)
    } catch (err) {
      if (err instanceof ReadOnlyCalendarError) {
        throw new Error(`Materialize rejected: ${err.message}`, { cause: err })
      }
      throw err
    }
  })

  ipcMain.handle(IPC_CHANNELS.EVENT.DETACH_LUNAR, (_event, input: DetachLunarInput) => {
    try {
      return eventsRepo.detachLunarMaterialized(input)
    } catch (err) {
      if (err instanceof ReadOnlyCalendarError) {
        throw new Error(`Detach rejected: ${err.message}`, { cause: err })
      }
      throw err
    }
  })

  ipcMain.handle(IPC_CHANNELS.EVENT.SEARCH, (_event, query: string, limit?: number) => {
    return eventsRepo.searchEvents(query, limit)
  })

  ipcMain.handle(
    IPC_CHANNELS.EVENT.SUGGEST_TITLES,
    (_event, options: SuggestTitlesOptions): TitleSuggestion[] => {
      // The window is wide on the past side so a yearly event still registers,
      // and short on the future side so a calendar full of scheduled work does
      // not crowd out what was actually done recently.
      const now = DateTime.utc()
      const samples = eventsRepo.listTitleSamples(
        now.minus({ days: 365 }).toISO()!,
        now.plus({ days: 90 }).toISO()!
      )
      return rankTitleSuggestions(samples, { ...options, now })
    }
  )

  ipcMain.handle(IPC_CHANNELS.EVENT.SHARE_ICS, async (_event, eventId: string) => {
    try {
      const res = eventsRepo.getEventById(eventId)
      if (!res) {
        return { success: false, message: 'Event not found' }
      }
      const cal = calendarsRepo.getCalendarById(res.event.calendarId)
      if (!cal) {
        return { success: false, message: 'Calendar not found' }
      }

      const icsContent = generateIcs(cal, [res.event], res.exceptions)
      const filePath = writeSharedIcs(res.event.title, icsContent)
      shell.showItemInFolder(filePath)

      return { success: true, filePath, icsContent }
    } catch (err) {
      return { success: false, message: describeError(err) }
    }
  })

  ipcMain.handle(IPC_CHANNELS.EVENT.LIST_CONFLICTS, () => {
    return eventsRepo.listConflicts()
  })

  ipcMain.handle(
    IPC_CHANNELS.EVENT.RESOLVE_CONFLICT,
    (_event, eventId: string, resolution: 'keepMine' | 'keepTheirs') => {
      const resolved = eventsRepo.resolveConflict(eventId, resolution)
      if (resolved) nudgeSync()
      return resolved
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.EVENT.RESTORE,
    (_event, snapshot: { event: CalendarEvent; exceptions: EventException[] }, occurrenceStartUtc?: string) => {
      try {
        let restored: CalendarEvent
        if (typeof occurrenceStartUtc === 'string') {
          eventsRepo.restoreOccurrence(
            snapshot.event.id,
            occurrenceStartUtc,
            snapshot.exceptions.find((ex) => ex.originalStartUtc === occurrenceStartUtc)
          )
          restored = eventsRepo.getEventById(snapshot.event.id)!.event
        } else {
          restored = eventsRepo.restoreEvent(snapshot)
        }
        nudgeSync()
        return restored
      } catch (err: unknown) {
        if (err instanceof ReadOnlyCalendarError) {
          throw new Error(`Write rejected: ${err.message}`, { cause: err })
        }
        throw err
      }
    }
  )

  ipcMain.handle(IPC_CHANNELS.EVENT.RESPOND, (_event, eventId: string, response: RsvpResponse) => {
    if (response !== 'accepted' && response !== 'tentative' && response !== 'declined') {
      throw new Error(`Not a reply: ${String(response)}`)
    }
    try {
      const updated = eventsRepo.respondToInvite(eventId, response)
      nudgeSync()
      return updated
    } catch (err) {
      if (err instanceof ReadOnlyCalendarError) {
        throw new Error(`Reply rejected: ${err.message}`, { cause: err })
      }
      throw err
    }
  })

  // 3. ICS Import / Export handlers
  ipcMain.handle(
    IPC_CHANNELS.ICS.IMPORT,
    (_event, targetCalendarId: string, icsContent: string): IcsImportResult => {
      try {
        const cal = calendarsRepo.getCalendarById(targetCalendarId)
        if (!cal) {
          return { success: false, importedCount: 0, errorCount: 0, message: 'Calendar not found' }
        }
        if (cal.isReadOnly) {
          return {
            success: false,
            importedCount: 0,
            errorCount: 0,
            message: 'Cannot import events into a read-only calendar'
          }
        }

        const parsed = parseIcsContent(icsContent, targetCalendarId)
        let importedCount = 0
        let errorCount = 0

        const uidToEventId = new Map<string, string>()

        // Insert events in a transaction
        db.transaction(() => {
          for (const ev of parsed.events) {
            try {
              // An import is a copy, not the meeting: with its guest list a
              // synced calendar would make this account the organizer and
              // (on Microsoft) send every guest a fresh invitation.
              const created = eventsRepo.createEvent({ ...ev, attendees: undefined })
              if (ev.uid) {
                uidToEventId.set(ev.uid, created.id)
              }
              importedCount++
            } catch {
              errorCount++
            }
          }

          for (const ex of parsed.exceptions) {
            const masterId = ex.masterUid ? uidToEventId.get(ex.masterUid) : undefined
            if (masterId) {
              try {
                eventsRepo.upsertException({
                  ...ex,
                  masterEventId: masterId
                })
              } catch {
                // An override that will not import leaves its series without that one change.
              }
            }
          }
        })()

        if (importedCount > 0) nudgeSync()

        return {
          success: true,
          importedCount,
          errorCount,
          message: `Successfully imported ${importedCount} events (${errorCount} errors)`
        }
      } catch (err) {
        return {
          success: false,
          importedCount: 0,
          errorCount: 1,
          message: `ICS import failed: ${describeError(err)}`
        }
      }
    }
  )

  // A whole calendar as one .ics file, saved where the user picks - to move it
  // to another app, or to keep.
  ipcMain.handle(IPC_CHANNELS.ICS.EXPORT, async (_event, calendarId: string): Promise<IcsExportResult> => {
    const cal = calendarsRepo.getCalendarById(calendarId)
    if (!cal) {
      throw new Error(`Calendar not found: ${calendarId}`)
    }

    const masterEvents = eventsRepo.queryEventsByCalendar(calendarId)
    const exceptions: EventException[] = []
    for (const me of masterEvents) {
      exceptions.push(...eventsRepo.getExceptionsForEvent(me.id))
    }
    const content = generateIcs(cal, masterEvents, exceptions)

    const safeName = cal.name.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'calendar'
    const win = BrowserWindow.getFocusedWindow()
    const options: Electron.SaveDialogOptions = {
      defaultPath: join(app.getPath('documents'), `${safeName}.ics`),
      filters: [{ name: 'iCalendar', extensions: ['ics'] }]
    }
    const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return { success: false, message: 'cancelled' }
    writeFileSync(result.filePath, content, 'utf8')
    return { success: true, filePath: result.filePath }
  })

  ipcMain.handle(IPC_CHANNELS.ICS.TAKE_OPENED, () => takeOpenedFiles())
}
