/**
 * Type-safe IPC channels, payloads, and API signatures for xrncal
 */

import type {
  Calendar,
  CalendarAccount,
  CalendarEvent,
  EventException,
  RsvpResponse,
  ExpandedOccurrence,
  CreateEventInput,
  UpdateEventInput,
  MoveEventInput,
  CopyEventInput,
  UpdateRecurringScopeInput,
  DeleteRecurringScopeInput,
  MaterializeLunarInput,
  DetachLunarInput,
  SyncStatus,
  SyncResult,
  SyncConflict
} from './event-model'
import type { SuggestTitlesOptions, TitleSuggestion } from './title-suggestions'
import type { AppSettings } from './settings-contract'
import type { OAuthClientForm, OAuthClientInfo, OAuthProvider } from './oauth-client'

export const IPC_CHANNELS = {
  APP: {
    GET_VERSION: 'xrncal:app:get-version',
    GET_LOCALE: 'xrncal:app:get-locale',
    SET_LOCALE: 'xrncal:app:set-locale',
    GET_PLATFORM: 'xrncal:app:get-platform',
    PICK_BACKGROUND_IMAGE: 'xrncal:app:pick-background-image',
    BACKUP_DATABASE: 'xrncal:app:backup-database',
    RESTORE_DATABASE: 'xrncal:app:restore-database',
    SHOW_LOG_FILE: 'xrncal:app:show-log-file',
    QUIT: 'xrncal:app:quit'
  },
  SETTINGS: {
    GET_ALL: 'xrncal:settings:get-all',
    GET: 'xrncal:settings:get',
    SET: 'xrncal:settings:set'
  },
  AUTH: {
    CONNECT_GOOGLE: 'xrncal:auth:connect-google',
    DISCONNECT_GOOGLE: 'xrncal:auth:disconnect-google',
    CONNECT_MICROSOFT: 'xrncal:auth:connect-microsoft',
    DISCONNECT_MICROSOFT: 'xrncal:auth:disconnect-microsoft',
    CONNECT_CALDAV: 'xrncal:auth:connect-caldav',
    DISCONNECT_CALDAV: 'xrncal:auth:disconnect-caldav',
    LIST_ACCOUNTS: 'xrncal:auth:list-accounts',
    DETACH_ACCOUNT: 'xrncal:auth:detach-account',
    PROVIDER_STATUS: 'xrncal:auth:provider-status',
    GET_OAUTH_CLIENT: 'xrncal:auth:get-oauth-client',
    SAVE_OAUTH_CLIENT: 'xrncal:auth:save-oauth-client',
    CLEAR_OAUTH_CLIENT: 'xrncal:auth:clear-oauth-client'
  },
  SYNC: {
    TRIGGER_NOW: 'xrncal:sync:trigger-now',
    GET_STATUS: 'xrncal:sync:get-status',
    /** main -> renderer, one of the two push channels (with REMINDERS.CHANGED);
     *  everything else is invoke/handle. Sent after a background sync that
     *  actually changed rows. */
    CHANGED: 'xrncal:sync:changed'
  },
  REMINDERS: {
    LIST_ACTIVE: 'xrncal:reminders:list-active',
    DISMISS: 'xrncal:reminders:dismiss',
    SNOOZE: 'xrncal:reminders:snooze',
    /** main -> renderer, carrying the new list: a reminder rang, or one was
     *  dismissed, snoozed or ran out. */
    CHANGED: 'xrncal:reminders:changed'
  },
  CALENDAR: {
    LIST: 'xrncal:calendar:list',
    CREATE: 'xrncal:calendar:create',
    UPDATE: 'xrncal:calendar:update',
    DELETE: 'xrncal:calendar:delete'
  },
  EVENT: {
    QUERY_RANGE: 'xrncal:event:query-range',
    GET_BY_ID: 'xrncal:event:get-by-id',
    CREATE: 'xrncal:event:create',
    UPDATE: 'xrncal:event:update',
    DELETE: 'xrncal:event:delete',
    MOVE: 'xrncal:event:move',
    COPY: 'xrncal:event:copy',
    UPDATE_SCOPE: 'xrncal:event:update-scope',
    DELETE_SCOPE: 'xrncal:event:delete-scope',
    UPSERT_EXCEPTION: 'xrncal:event:upsert-exception',
    MATERIALIZE_LUNAR: 'xrncal:event:materialize-lunar',
    DETACH_LUNAR: 'xrncal:event:detach-lunar',
    SEARCH: 'xrncal:event:search',
    SUGGEST_TITLES: 'xrncal:event:suggest-titles',
    SHARE_ICS: 'xrncal:event:share-ics',
    LIST_CONFLICTS: 'xrncal:event:list-conflicts',
    RESOLVE_CONFLICT: 'xrncal:event:resolve-conflict',
    RESPOND: 'xrncal:event:respond',
    RESTORE: 'xrncal:event:restore'
  },
  ICS: {
    IMPORT: 'xrncal:ics:import',
    EXPORT: 'xrncal:ics:export',
    /** Files the OS asked xrncal to open ("Open with", a double-click, a drop
     *  on the launcher), waiting for the renderer to collect them. */
    TAKE_OPENED: 'xrncal:ics:take-opened',
    /** Main -> renderer: an opened file is waiting. */
    FILE_OPENED: 'xrncal:ics:file-opened'
  },
  PRINT: {
    SAVE_PDF: 'xrncal:print:save-pdf',
    PRINT: 'xrncal:print:print',
    SHOW_SAVED: 'xrncal:print:show-saved'
  },
  MINI: {
    OPEN_MAIN: 'xrncal:mini:open-main',
    TOGGLE: 'xrncal:mini:toggle',
    GET_UPCOMING: 'xrncal:mini:get-upcoming',
    SET_ALWAYS_ON_TOP: 'xrncal:mini:set-always-on-top'
  },
  HOLIDAYS: {
    SUBSCRIBE: 'xrncal:holidays:subscribe',
    UNSUBSCRIBE: 'xrncal:holidays:unsubscribe'
  },
  SUBSCRIPTIONS: {
    ADD: 'xrncal:subscriptions:add',
    REFRESH: 'xrncal:subscriptions:refresh'
  }
} as const

export type AppLocale = 'vi' | 'en'

export interface DetachAccountResult {
  success: boolean
  /** Calendars converted to local ownership. */
  calendarCount: number
  /** Events kept (none are deleted by detaching). */
  eventCount: number
  message?: string
}

export interface BackupResult {
  success: boolean
  /** Absolute path of the snapshot that was written. */
  filePath?: string
  /** Size of the snapshot in bytes. */
  byteSize?: number
  message?: string
}

export interface IcsImportResult {
  success: boolean
  importedCount: number
  errorCount: number
  message?: string
}

/** Printing prints the window's print sheet (`.gc-print-host`); the rest of the window is hidden for print. */
export interface PdfExportResult {
  saved: boolean
  /** The name it was saved under (the folder is not handed back). */
  fileName?: string
}

export interface PrintResult {
  printed: boolean
  /** Why it did not print; absent when the dialog was cancelled. */
  error?: string
}

export interface IcsExportResult {
  success: boolean
  /** Where the calendar was saved. */
  filePath?: string
  /** 'cancelled' when the save dialog was dismissed. */
  message?: string
}

/** An .ics file the OS handed to xrncal, read and waiting to be imported. */
export interface OpenedIcsFile {
  name: string
  content: string
}

export interface RestoreResult {
  success: boolean
  /** 'cancelled', or why the file was refused: 'notDatabase' (not a readable
   *  SQLite file), 'notXrncal' (no xrncal tables) or 'newer' (made by a newer
   *  xrncal than this one). On success the app restarts instead of answering. */
  message?: string
}

/** Whether this build can sign in to Google and Microsoft: an official build
 *  carries the OAuth client ids, a build from source needs its own. */
export interface ProviderStatus {
  google: boolean
  microsoft: boolean
}

/** A reminder that has rung and is still waiting for the user. */
export interface ActiveReminder {
  /** The occurrence id: one entry per occurrence, however many reminders it has. */
  key: string
  occurrence: ExpandedOccurrence
}

export interface ConnectCalDavInput {
  provider: 'nextcloud' | 'icloud' | 'synology' | 'generic'
  serverUrl?: string
  username: string
  password: string
  name?: string
}

export interface XrncalAPI {
  app: {
    getVersion: () => Promise<string>
    getLocale: () => Promise<AppLocale>
    setLocale: (locale: AppLocale) => Promise<boolean>
    getPlatform: () => Promise<string>
    pickBackgroundImage: () => Promise<{ dataUrl: string } | null>
    /** Write a consistent snapshot of the whole database to a file the user picks. */
    backupDatabase: () => Promise<BackupResult>
    /** Replace the database with a backup the user picks, then restart. The
     *  current data is saved next to it first. */
    restoreDatabase: () => Promise<RestoreResult>
    /** Show the main process's log file in the file manager (its folder when
     *  nothing has been logged yet). False when there is no log to show. */
    showLogFile: () => Promise<boolean>
    /** Quit for real - closing the window only hides xrncal in the tray. */
    quit: () => Promise<void>
  }
  settings: {
    getAll: () => Promise<AppSettings>
    get: <K extends keyof AppSettings>(key: K) => Promise<AppSettings[K]>
    set: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => Promise<boolean>
  }
  auth: {
    connectGoogle: () => Promise<{ success: boolean; account?: CalendarAccount; message?: string }>
    disconnectGoogle: (accountId: string) => Promise<boolean>
    connectMicrosoft: () => Promise<{ success: boolean; account?: CalendarAccount; message?: string }>
    disconnectMicrosoft: (accountId: string) => Promise<boolean>
    connectCalDav: (input: ConnectCalDavInput) => Promise<{ success: boolean; account?: CalendarAccount; message?: string }>
    disconnectCalDav: (accountId: string) => Promise<boolean>
    listAccounts: () => Promise<CalendarAccount[]>
    /** Keep this account's calendars and events but sever the provider link,
     *  turning them into ordinary local data. */
    detachAccount: (accountId: string) => Promise<DetachAccountResult>
    providerStatus: () => Promise<ProviderStatus>
    /** What the renderer may know of a provider's client; never its secret. */
    oauthClient: (provider: OAuthProvider) => Promise<OAuthClientInfo>
    /** Throws when the details are invalid or there is no keyring to encrypt them with. */
    saveOAuthClient: (provider: OAuthProvider, client: OAuthClientForm) => Promise<void>
    clearOAuthClient: (provider: OAuthProvider) => Promise<void>
  }
  sync: {
    triggerNow: () => Promise<SyncResult>
    getStatus: () => Promise<SyncStatus>
    /** Fires when a background sync changed the database. Returns an unsubscribe. */
    onChanged: (callback: () => void) => () => void
  }
  reminders: {
    listActive: () => Promise<ActiveReminder[]>
    dismiss: (key: string) => Promise<void>
    /** Take it off screen and ring it again in `minutes`. */
    snooze: (key: string, minutes: number) => Promise<void>
    onChanged: (callback: (active: ActiveReminder[]) => void) => () => void
  }
  calendars: {
    list: () => Promise<Calendar[]>
    create: (data: { name: string; color: string }) => Promise<Calendar>
    update: (id: string, data: Partial<Pick<Calendar, 'name' | 'color' | 'isVisible'>>) => Promise<Calendar>
    delete: (id: string) => Promise<boolean>
  }
  events: {
    queryRange: (calendarIds: string[], startUtc: string, endUtc: string) => Promise<ExpandedOccurrence[]>
    getById: (id: string) => Promise<{ event: CalendarEvent; exceptions: EventException[] } | null>
    create: (input: CreateEventInput) => Promise<CalendarEvent>
    update: (id: string, input: UpdateEventInput) => Promise<CalendarEvent>
    delete: (id: string) => Promise<boolean>
    move: (input: MoveEventInput) => Promise<CalendarEvent>
    copy: (input: CopyEventInput) => Promise<CalendarEvent>
    updateScope: (input: UpdateRecurringScopeInput) => Promise<boolean>
    deleteScope: (input: DeleteRecurringScopeInput) => Promise<boolean>
    upsertException: (exception: Omit<EventException, 'id' | 'createdAt' | 'updatedAt'>) => Promise<EventException>
    materializeLunar: (input: MaterializeLunarInput) => Promise<{ count: number }>
    detachLunar: (input: DetachLunarInput) => Promise<{ count: number }>
    search: (query: string, limit?: number) => Promise<CalendarEvent[]>
    /** Ranked title autocomplete for the event editor, with the calendar each
     *  title normally lives on. */
    suggestTitles: (options: SuggestTitlesOptions) => Promise<TitleSuggestion[]>
    shareIcs: (eventId: string) => Promise<{ success: boolean; filePath?: string; icsContent?: string; message?: string }>
    listConflicts: () => Promise<SyncConflict[]>
    resolveConflict: (eventId: string, resolution: 'keepMine' | 'keepTheirs') => Promise<boolean>
    /** Answer an invitation; the reply reaches the organizer on the next sync. */
    respond: (eventId: string, response: RsvpResponse) => Promise<CalendarEvent>
    /** Undo a delete from a snapshot taken by `getById` before it. With
     *  `occurrenceStartUtc`, only that one deleted occurrence comes back. */
    restore: (
      snapshot: { event: CalendarEvent; exceptions: EventException[] },
      occurrenceStartUtc?: string
    ) => Promise<CalendarEvent>
  }
  ics: {
    importIcs: (targetCalendarId: string, icsContent: string) => Promise<IcsImportResult>
    /** Save a calendar as an .ics file where the user picks. */
    exportIcs: (calendarId: string) => Promise<IcsExportResult>
    /** Collect the .ics files the OS opened xrncal with since the last call. */
    takeOpenedFiles: () => Promise<OpenedIcsFile[]>
    /** Fires when an opened file is waiting. Returns an unsubscribe. */
    onFileOpened: (callback: () => void) => () => void
  },
  print: {
    /** Save the print sheet as an A4 landscape PDF where the user picks. */
    savePdf: (suggestedName: string) => Promise<PdfExportResult>
    /** The system print dialog, for the print sheet. */
    print: () => Promise<PrintResult>
    /** Show the PDF saved last in the file manager. False when there is none. */
    showSaved: () => Promise<boolean>
  }
  mini: {
    openMain: () => Promise<void>
    toggle: () => Promise<void>
    getUpcoming: (limit?: number) => Promise<{ occurrences: ExpandedOccurrence[] }>
    setAlwaysOnTop: (flag: boolean) => Promise<boolean>
  },
  holidays: {
    subscribe: (type: 'vietnam' | 'international') => Promise<{ calendarId: string; count: number }>
    unsubscribe: (type: 'vietnam' | 'international') => Promise<boolean>
  }
  /** Calendars subscribed to by .ics / webcal link. Removing one is deleting
   *  the calendar (`calendars.delete`). */
  subscriptions: {
    add: (url: string, name?: string) => Promise<Calendar>
    /** Fetch the feed now; resolves to how many events it stored. */
    refresh: (calendarId: string) => Promise<number>
  }
}
