import { fetchWithTimeout, describeError, describeHttpFailure, isRetryableStatus } from './http'
import type { ISqliteDatabase } from '../db/sqlite-driver'
import { MicrosoftOAuthManager } from '../oauth/microsoft-oauth'
import {
  mapGraphEventToDomain,
  mapDomainEventToGraph,
  graphAttendeesToDomain,
  graphOccurrenceOverrides,
  type GraphSeriesOccurrences,
  type MicrosoftGraphApiEvent
} from './microsoft-event-mapper'
import { log } from '../log'
import { AccountsRepo } from '../db/repos/accounts-repo'
import { EventsRepo, type EventRow } from '../db/repos/events-repo'
import { mergePulledReminders, parseRemindersJson, serializeReminders } from '@shared/reminders'
import { SyncStateRepo } from '../db/repos/sync-state-repo'
import type { RsvpResponse, SyncResult } from '@shared/event-model'

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0'
/** Events requested per page. */
const PAGE_SIZE = 250
/** Safety stop so a pathological calendar cannot spin forever. */
const MAX_SYNC_PAGES = 200

/**
 * How often a calendar is listed in full. Graph has no change token for a
 * calendar's series masters - its delta query only covers an expanded
 * calendarView, which this app does not model - so only a full listing shows
 * what was deleted. Polls in between ask for what changed since the last one.
 */
const FULL_LISTING_INTERVAL_MS = 10 * 60 * 1000

/**
 * A series' changed and cancelled occurrences are read from its master, one
 * request per series (see `GraphSeriesOccurrences`). A series is read when a
 * pull finds its master changed - Exchange keeps exceptions inside the master,
 * so editing one changes it - and every series of a calendar is read again
 * this often in case a change did not show on the master.
 */
const OVERRIDES_REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000
/** Series read per poll; the rest wait for the next one, 20 s later. */
const OVERRIDES_PER_POLL = 40
const OVERRIDES_QUERY =
  '$select=subject,body,start,end,isAllDay,location,originalStart,occurrenceId,exceptionOccurrences,cancelledOccurrences' +
  '&$expand=exceptionOccurrences'

/** Graph answers an invitation through one action per reply. */
const RSVP_ACTION: Record<RsvpResponse, string> = {
  accepted: 'accept',
  tentative: 'tentativelyAccept',
  declined: 'decline'
}

/** Kept as JSON in `sync_state.sync_token`, which Graph has no other use for. */
interface GraphPullState {
  /** Newest `lastModifiedDateTime` seen; the next incremental poll starts here. */
  since?: string
  /** When the calendar was last listed in full. */
  fullAt?: string
  /** Series (local ids) whose occurrences are still to be read. */
  overridesPending?: string[]
  /** When every series of the calendar was last queued for that. */
  overridesAt?: string
}

/** One page of an events listing; the rest is behind `@odata.nextLink`. */
interface GraphEventsPage {
  value?: MicrosoftGraphApiEvent[]
  '@odata.nextLink'?: string
}

interface PageWalk {
  touched: number
  listedIds: Set<string>
  /** Series masters the walk wrote: their occurrences may have changed. */
  writtenSeries: string[]
  latestModified?: string
  /** False when the walk stopped at MAX_SYNC_PAGES rather than the last page. */
  complete: boolean
}

export class MicrosoftSyncEngine {
  private oauthManager: MicrosoftOAuthManager
  private eventsRepo: EventsRepo
  private syncStateRepo: SyncStateRepo

  constructor(private db: ISqliteDatabase) {
    this.oauthManager = new MicrosoftOAuthManager(db)
    this.eventsRepo = new EventsRepo(db)
    this.syncStateRepo = new SyncStateRepo(db)
  }

  /**
   * Sync calendars list from Microsoft Graph
   */
  async syncCalendarList(accountId: string, accessToken: string): Promise<string[]> {
    const res = await fetchWithTimeout(`${GRAPH_BASE}/me/calendars`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    })

    if (!res.ok) {
      throw new Error(`Failed to fetch Microsoft calendars: ${await res.text()}`)
    }

    const data = await res.json()
    const items = data.value || []
    const now = new Date().toISOString()
    const syncedCalIds: string[] = []

    for (const item of items) {
      const isReadOnly = item.canEdit === false
      const isDefault = item.isDefaultCalendar === true
      const color = item.hexColor || '#0078d4'
      const name = item.name || 'Outlook Calendar'

      const existing = this.db
        .prepare('SELECT id FROM calendars WHERE id = ?')
        .get<{ id: string }>(item.id)

      if (!existing) {
        this.db
          .prepare(
            `INSERT INTO calendars (id, account_id, name, color, is_visible, is_read_only, is_default, created_at, updated_at)
             VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)`
          )
          .run(item.id, accountId, name, color, isReadOnly ? 1 : 0, isDefault ? 1 : 0, now, now)
      } else {
        this.db
          .prepare(
            // Colour is local-only: the provider seeds it when the calendar is
            // first discovered and never overwrites it again, so what you pick
            // here stays picked.
            `UPDATE calendars
             SET name = ?, is_read_only = ?, updated_at = ?
             WHERE id = ?`
          )
          .run(name, isReadOnly ? 1 : 0, now, item.id)
      }

      syncedCalIds.push(item.id)
    }

    return syncedCalIds
  }

  /**
   * Pull events for a Microsoft calendar.
   *
   * This used to list the whole calendar on every poll - every 20 seconds while
   * the window had focus - and rewrite every row it got back, which re-indexed
   * each one in FTS and told the renderer to reload. It also never noticed an
   * event deleted in Outlook: the listing simply stopped mentioning it, and the
   * row stayed here for good. Now unchanged rows are skipped by etag, a full
   * listing every FULL_LISTING_INTERVAL_MS removes what is gone, and the polls
   * in between ask only for what was modified since the last one.
   */
  async pullCalendarEvents(
    calendarId: string,
    accessToken: string,
    /** The account's address, to find its own entry in each guest list. */
    selfEmail?: string
  ): Promise<{ pulledCount: number }> {
    const state = this.readPullState(calendarId)
    const base = `${GRAPH_BASE}/me/calendars/${encodeURIComponent(calendarId)}/events?$top=${PAGE_SIZE}`
    const lastFull = state.fullAt ? Date.parse(state.fullAt) : NaN
    const fullDue =
      !state.since || Number.isNaN(lastFull) || Date.now() - lastFull >= FULL_LISTING_INTERVAL_MS
    // With no state - a calendar's first sync, or after a migration cleared the
    // positions so stored rows would be read again - every row is rewritten,
    // unchanged etag or not.
    const skipUnchanged = Boolean(state.fullAt)

    if (!fullDue) {
      const filter = encodeURIComponent(`lastModifiedDateTime ge ${state.since}`)
      const changed = await this.walkPages(`${base}&$filter=${filter}`, calendarId, accessToken, true, {
        selfEmail,
        skipUnchanged
      })
      if (changed) {
        const overrides = await this.pullOccurrenceOverrides(calendarId, accessToken, state, changed.writtenSeries)
        this.savePullState(calendarId, {
          since: changed.latestModified ?? state.since,
          fullAt: state.fullAt,
          ...overrides.state
        })
        return { pulledCount: changed.touched + overrides.pulled }
      }
      // Graph refused the filter; a full listing still works.
    }

    const listing = (await this.walkPages(base, calendarId, accessToken, false, { selfEmail, skipUnchanged }))!
    let pulledCount = listing.touched
    // A listing cut short at MAX_SYNC_PAGES says nothing about the rest.
    if (listing.complete) pulledCount += this.pruneUnlisted(calendarId, listing.listedIds)
    const overrides = await this.pullOccurrenceOverrides(calendarId, accessToken, state, listing.writtenSeries)
    this.savePullState(calendarId, {
      // An empty calendar has no server timestamp to start from, so the next poll
      // lists it in full again - cheap, and immune to this machine's clock.
      since: listing.latestModified,
      fullAt: new Date().toISOString(),
      ...overrides.state
    })
    return { pulledCount: pulledCount + overrides.pulled }
  }

  /**
   * Read the changed and cancelled occurrences of the series that need it -
   * those a pull just wrote, those left over from the last poll, and every
   * series each OVERRIDES_REFRESH_INTERVAL_MS - at most OVERRIDES_PER_POLL of
   * them. A series that cannot be read now (the network, throttling) stays
   * queued; one Graph refuses for good is dropped until the next refresh.
   */
  private async pullOccurrenceOverrides(
    calendarId: string,
    accessToken: string,
    state: GraphPullState,
    changedSeries: readonly string[]
  ): Promise<{ pulled: number; state: Pick<GraphPullState, 'overridesPending' | 'overridesAt'> }> {
    const pending = new Set([...(state.overridesPending ?? []), ...changedSeries])
    let overridesAt = state.overridesAt
    const lastAll = overridesAt ? Date.parse(overridesAt) : NaN
    if (Number.isNaN(lastAll) || Date.now() - lastAll >= OVERRIDES_REFRESH_INTERVAL_MS) {
      for (const id of this.eventsRepo.listSyncedSeriesIds(calendarId)) pending.add(id)
      overridesAt = new Date().toISOString()
    }

    let pulled = 0
    let read = 0
    for (const masterId of [...pending]) {
      if (read >= OVERRIDES_PER_POLL) break
      const master = this.eventsRepo.getEventById(masterId)?.event
      if (!master?.rrule) {
        // Deleted, or no longer a series.
        pending.delete(masterId)
        continue
      }
      read++
      let series: GraphSeriesOccurrences
      try {
        const res = await fetchWithTimeout(
          `${GRAPH_BASE}/me/events/${encodeURIComponent(master.providerEventId || master.id)}?${OVERRIDES_QUERY}`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              Prefer: 'outlook.timezone="UTC", outlook.body-content-type="text"'
            }
          }
        )
        if (res.status === 404 || res.status === 410) {
          // Gone from Outlook; the next full listing removes it here.
          pending.delete(masterId)
          continue
        }
        if (!res.ok) {
          if (isRetryableStatus(res.status)) break
          log('warn', `Outlook series occurrences could not be read: HTTP ${res.status}`)
          pending.delete(masterId)
          continue
        }
        series = await res.json()
      } catch {
        // The network: everything after this would fail the same way.
        break
      }
      pulled += this.eventsRepo.applyPulledOverrides(masterId, graphOccurrenceOverrides(master, series))
      pending.delete(masterId)
    }

    return { pulled, state: { overridesPending: [...pending], overridesAt } }
  }

  /**
   * Walk every page: Graph caps a response at $top and returns the rest behind
   * @odata.nextLink. Reading one page and stopping capped each calendar at
   * PAGE_SIZE events, silently dropping everything past it.
   *
   * Returns null only when `filtered` and Graph rejects the query outright.
   */
  private async walkPages(
    firstUrl: string,
    calendarId: string,
    accessToken: string,
    filtered: boolean,
    options: { selfEmail?: string; skipUnchanged: boolean }
  ): Promise<PageWalk | null> {
    const walk: PageWalk = { touched: 0, listedIds: new Set(), writtenSeries: [], complete: false }
    let nextUrl: string | undefined = firstUrl
    let pages = 0

    while (nextUrl) {
      const res = await fetchWithTimeout(nextUrl, {
        // Plain-text bodies in full: `bodyPreview` stops at 255 characters, and
        // notes read from it were pushed back cut short.
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Prefer: 'outlook.timezone="UTC", outlook.body-content-type="text"'
        }
      })

      if (!res.ok) {
        if (filtered && pages === 0 && res.status === 400) return null
        throw new Error(`Microsoft event pull failed for ${calendarId}: ${await res.text()}`)
      }

      const data: GraphEventsPage = await res.json()
      const page = this.applyPulledPage(calendarId, data, options)
      walk.touched += page.touched
      for (const id of page.listedIds) walk.listedIds.add(id)
      walk.writtenSeries.push(...page.writtenSeries)
      if (page.latestModified && (!walk.latestModified || page.latestModified > walk.latestModified)) {
        walk.latestModified = page.latestModified
      }

      // nextLink is an absolute URL carrying its own paging state.
      nextUrl = data['@odata.nextLink']
      if (!nextUrl) {
        walk.complete = true
        break
      }
      if (++pages >= MAX_SYNC_PAGES) break
    }

    return walk
  }

  /**
   * Delete rows that have been on the server and were missing from a complete
   * listing - deleted in Outlook or on another device. Unsent edits, conflicts,
   * rows that never reached the server and lunar masters (local by design) stay.
   */
  private pruneUnlisted(calendarId: string, listedIds: Set<string>): number {
    const synced = this.db
      .prepare(
        `SELECT id FROM events
         WHERE calendar_id = ? AND dirty = 0 AND has_conflict = 0 AND lunar_rule IS NULL
           AND (etag IS NOT NULL OR provider_event_id IS NOT NULL)`
      )
      .all<{ id: string }>(calendarId)

    let removed = 0
    this.db.transaction(() => {
      for (const row of synced) {
        if (listedIds.has(row.id)) continue
        this.db.prepare('DELETE FROM events WHERE id = ?').run(row.id)
        removed++
      }
    })()
    return removed
  }

  private readPullState(calendarId: string): GraphPullState {
    const raw = this.syncStateRepo.getSyncToken(calendarId)
    if (!raw) return {}
    try {
      const parsed = JSON.parse(raw)
      return parsed && typeof parsed === 'object' ? parsed : {}
    } catch {
      return {}
    }
  }

  private savePullState(calendarId: string, state: GraphPullState): void {
    this.syncStateRepo.saveSyncToken(calendarId, JSON.stringify(state))
  }

  /** Apply one page of listing results: how many rows it changed, which local
   *  rows it named, and the newest modification time on it. */
  private applyPulledPage(
    calendarId: string,
    data: GraphEventsPage,
    { selfEmail, skipUnchanged }: { selfEmail?: string; skipUnchanged: boolean }
  ): { touched: number; listedIds: string[]; writtenSeries: string[]; latestModified?: string } {
    const items = data.value || []
    const listedIds: string[] = []
    const writtenSeries: string[] = []
    let latestModified: string | undefined
    let pulledCount = 0

    this.db.transaction(() => {
      // A locally created event keeps its own id, so the provider's id no longer
      // finds it by primary key; without this the next pull inserts a duplicate.
      const localIdFor = (providerId: string): string =>
        this.db
          .prepare('SELECT id FROM events WHERE calendar_id = ? AND provider_event_id = ?')
          .get<{ id: string }>(calendarId, providerId)?.id ?? providerId

      for (const gEvent of items) {
        if (gEvent.lastModifiedDateTime && (!latestModified || gEvent.lastModifiedDateTime > latestModified)) {
          latestModified = gEvent.lastModifiedDateTime
        }
        const mapped = mapGraphEventToDomain(gEvent, calendarId, selfEmail)

        if (mapped.isException && mapped.exception) {
          const exc = mapped.exception
          const now = new Date().toISOString()
          const masterLocalId = localIdFor(exc.masterEventId)
          const excId = `exc_${masterLocalId}_${exc.originalStartUtc.replace(/[:.]/g, '')}`

          this.db
            .prepare(
              `INSERT INTO event_exceptions (
                id, master_event_id, original_start_utc, is_cancelled,
                title, notes, location, dtstart_utc, dtend_utc, tzid, all_day, color,
                created_at, updated_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(master_event_id, original_start_utc) DO UPDATE SET
                is_cancelled = excluded.is_cancelled,
                title = excluded.title,
                notes = excluded.notes,
                location = excluded.location,
                dtstart_utc = excluded.dtstart_utc,
                dtend_utc = excluded.dtend_utc,
                tzid = excluded.tzid,
                all_day = excluded.all_day,
                color = COALESCE(excluded.color, event_exceptions.color),
                updated_at = excluded.updated_at
              WHERE event_exceptions.dirty = 0`
            )
            .run(
              excId,
              masterLocalId,
              exc.originalStartUtc,
              exc.isCancelled ? 1 : 0,
              exc.title || null,
              exc.notes || null,
              exc.location || null,
              exc.dtStartUtc || null,
              exc.dtEndUtc || null,
              exc.tzid || null,
              exc.allDay === undefined ? null : exc.allDay ? 1 : 0,
              exc.color || null,
              now,
              now
            )
          pulledCount++
        } else if (mapped.event) {
          const evt = mapped.event
          const now = new Date().toISOString()
          const localId = localIdFor(evt.id)
          listedIds.push(localId)

          // Same etag, same event: Graph changes the etag on every modification.
          const stored = this.db
            .prepare(
              'SELECT etag, is_deleted, reminders, rsvp_pending, attendees_synced FROM events WHERE id = ?'
            )
            .get<{
              etag: string | null
              is_deleted: number
              reminders: string | null
              rsvp_pending: string | null
              attendees_synced: number
            }>(localId)
          // A row whose guest list has never been read is read again even with
          // an unchanged etag - otherwise it would wait for its next edit.
          if (
            skipUnchanged &&
            stored &&
            evt.etag &&
            stored.etag === evt.etag &&
            stored.is_deleted === (evt.isDeleted ? 1 : 0) &&
            stored.attendees_synced === 1
          ) {
            continue
          }
          const reminders = mergePulledReminders(
            'graph',
            stored ? parseRemindersJson(stored.reminders) : undefined,
            evt.reminders ?? undefined
          )

          const applied = this.db
            .prepare(
              `INSERT INTO events (
                id, provider_event_id, calendar_id, uid, title, notes, location,
                dtstart_utc, dtend_utc, tzid, all_day, rrule, color,
                meeting_url, reminders, etag, dirty, is_deleted, attendees_synced, created_at, updated_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 1, ?, ?)
              ON CONFLICT(id) DO UPDATE SET
                provider_event_id = excluded.provider_event_id,
                title = excluded.title,
                notes = excluded.notes,
                location = excluded.location,
                dtstart_utc = excluded.dtstart_utc,
                dtend_utc = excluded.dtend_utc,
                tzid = excluded.tzid,
                all_day = excluded.all_day,
                rrule = excluded.rrule,
                -- Graph has no event colour; one set here stays.
                color = COALESCE(excluded.color, events.color),
                meeting_url = excluded.meeting_url,
                reminders = excluded.reminders,
                etag = excluded.etag,
                dirty = 0,
                is_deleted = excluded.is_deleted,
                attendees_synced = 1,
                updated_at = excluded.updated_at
              WHERE events.dirty = 0 AND events.has_conflict = 0`
            )
            .run(
              localId,
              evt.id,
              evt.calendarId,
              evt.uid || `${evt.id}@outlook.com`,
              evt.title,
              evt.notes || null,
              evt.location || null,
              evt.dtStartUtc,
              evt.dtEndUtc,
              evt.tzid || 'UTC',
              evt.allDay ? 1 : 0,
              evt.rrule || null,
              evt.color || null,
              evt.meetingUrl || null,
              serializeReminders(reminders),
              evt.etag || null,
              evt.isDeleted ? 1 : 0,
              now,
              now
            )
          // A reply still on its way would be overwritten by the old answer.
          if (applied.changes > 0 && !stored?.rsvp_pending) {
            this.eventsRepo.replaceAttendees(localId, evt.attendees)
          }
          if (applied.changes > 0 && evt.rrule) writtenSeries.push(localId)
          pulledCount++
        }
      }
    })()

    return { touched: pulledCount, listedIds, writtenSeries, latestModified }
  }

  /**
   * Push local dirty events to Microsoft Graph
   */
  async pushDirtyEvents(
    calendarId: string,
    accessToken: string,
    selfEmail?: string
  ): Promise<{ pushedCount: number; errorCount: number; lastError: string | null }> {
    const dirtyRows = this.db
      .prepare('SELECT * FROM events WHERE calendar_id = ? AND dirty = 1 AND has_conflict = 0')
      .all<EventRow>(calendarId)

    let pushedCount = 0
    let errorCount = 0
    let lastError: string | null = null

    for (const row of dirtyRows) {
      try {
        const isDeleted = row.is_deleted === 1
        // Graph's id, not ours; identical only for rows that synced before the
        // two were separated.
        const eventId = row.provider_event_id || row.id

        if (isDeleted) {
          const delRes = await fetchWithTimeout(`${GRAPH_BASE}/me/events/${encodeURIComponent(eventId)}`, {
            method: 'DELETE',
            headers: row.etag
              ? { Authorization: `Bearer ${accessToken}`, 'if-match': row.etag }
              : { Authorization: `Bearer ${accessToken}` }
          })
          if (delRes.ok || delRes.status === 404) {
            this.eventsRepo.forgetPushedDelete(row.id, row.updated_at)
            pushedCount++
          } else if (delRes.status === 412) {
            this.db.prepare('UPDATE events SET has_conflict = 1 WHERE id = ?').run(row.id)
            errorCount++
          } else {
            const detail = await describeHttpFailure(delRes)
            lastError = detail
            errorCount++
          }
        } else {
          const payload = mapDomainEventToGraph({
            id: row.id,
            calendarId: row.calendar_id,
            uid: row.uid,
            title: row.title,
            notes: row.notes ?? undefined,
            location: row.location ?? undefined,
            dtStartUtc: row.dtstart_utc,
            dtEndUtc: row.dtend_utc,
            tzid: row.tzid,
            allDay: row.all_day === 1,
            rrule: row.rrule ?? undefined,
            reminders: parseRemindersJson(row.reminders),
            // Only a list known to be complete; see mapDomainEventToGraph.
            attendees:
              row.attendees_synced === 1 || !row.etag
                ? this.eventsRepo.getEventById(row.id)?.event.attendees ?? []
                : undefined
          })

          let res: Response
          if (row.etag) {
            // PATCH existing
            res = await fetchWithTimeout(`${GRAPH_BASE}/me/events/${encodeURIComponent(eventId)}`, {
              method: 'PATCH',
              headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
                // Graph honours the precondition only as a header; without it
                // the 412 branch below is unreachable.
                'if-match': row.etag
              },
              body: JSON.stringify(payload)
            })
          } else {
            // POST new event to calendar
            res = await fetchWithTimeout(`${GRAPH_BASE}/me/calendars/${encodeURIComponent(calendarId)}/events`, {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify(payload)
            })
          }

          if (res.ok) {
            const resJson = await res.json()
            // Ours stays ours; only the provider's id is recorded.
            const unchanged = this.eventsRepo.markEventPushed(row.id, {
              providerEventId: resJson.id || eventId,
              etag: resJson['@odata.etag'] || row.etag,
              sentUpdatedAt: row.updated_at
            })
            // The response is the event as Graph now holds it, guests and all -
            // but a guest list edited while the request was out is newer than that.
            if (Array.isArray(resJson.attendees)) {
              if (unchanged && !row.rsvp_pending) {
                this.eventsRepo.replaceAttendees(row.id, graphAttendeesToDomain(resJson, selfEmail))
              }
              this.db.prepare('UPDATE events SET attendees_synced = 1 WHERE id = ?').run(row.id)
            }
            pushedCount++
          } else if (res.status === 412) {
            this.db.prepare('UPDATE events SET has_conflict = 1 WHERE id = ?').run(row.id)
            errorCount++
          } else {
            const detail = await describeHttpFailure(res)
            lastError = detail
            errorCount++
          }
        }
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err)
        errorCount++
      }
    }

    const excRes = await this.pushDirtyExceptions(calendarId, accessToken)
    return {
      lastError,
      pushedCount: pushedCount + excRes.pushedCount,
      errorCount: errorCount + excRes.errorCount
    }
  }

  /**
   * Push per-occurrence overrides and cancellations.
   *
   * Graph exposes the occurrences of a series through the master's /instances
   * collection, each with its own event id. A cancelled occurrence is a DELETE
   * on that instance; an edited one is a PATCH - patching the master carries no
   * occurrence information at all.
   */
  private async pushDirtyExceptions(
    calendarId: string,
    accessToken: string
  ): Promise<{ pushedCount: number; errorCount: number }> {
    const pending = this.eventsRepo.listDirtyExceptions(calendarId)
    let pushedCount = 0
    let errorCount = 0

    for (const { exception, master, providerInstanceId } of pending) {
      try {
        let instanceId = providerInstanceId
        if (!instanceId) {
          instanceId = await this.findInstanceId(
            // The /instances collection is the provider's, so it wants the
            // provider's id for the series.
            master.providerEventId || master.id,
            exception.originalStartUtc,
            accessToken
          )
        }
        if (!instanceId) {
          errorCount++
          continue
        }

        let res: Response
        if (exception.isCancelled) {
          res = await fetchWithTimeout(
            `${GRAPH_BASE}/me/events/${encodeURIComponent(instanceId)}`,
            { method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}` } }
          )
        } else {
          const tz = exception.tzid || master.tzid || 'UTC'
          const startIso = exception.dtStartUtc || exception.originalStartUtc
          const endIso = exception.dtEndUtc || master.dtEndUtc
          res = await fetchWithTimeout(
            `${GRAPH_BASE}/me/events/${encodeURIComponent(instanceId)}`,
            {
              method: 'PATCH',
              headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                subject: exception.title || master.title,
                body: {
                  contentType: 'text',
                  content: exception.notes ?? master.notes ?? ''
                },
                location: { displayName: exception.location ?? master.location ?? '' },
                start: { dateTime: startIso, timeZone: tz },
                end: { dateTime: endIso, timeZone: tz }
              })
            }
          )
        }

        // A cancelled instance that is already gone counts as delivered.
        if (res.ok || res.status === 204 || res.status === 404) {
          this.eventsRepo.markExceptionSynced(exception.id, instanceId, null, exception.updatedAt)
          pushedCount++
        } else {
          errorCount++
        }
      } catch {
        errorCount++
      }
    }

    return { pushedCount, errorCount }
  }

  /**
   * Deliver replies to invitations through Graph's accept / tentativelyAccept /
   * decline actions, which also tell the organizer. They return no body, so
   * the event is read back for its new etag - without it the next edit's
   * If-Match would fail on a change that was our own. Outlook takes a declined
   * meeting off the calendar; a 404 on that read means it is gone here too.
   */
  async pushRsvps(
    calendarId: string,
    accessToken: string
  ): Promise<{ pushedCount: number; errorCount: number }> {
    let pushedCount = 0
    let errorCount = 0

    for (const { event, response } of this.eventsRepo.listPendingRsvps(calendarId)) {
      try {
        const eventUrl = `${GRAPH_BASE}/me/events/${encodeURIComponent(event.providerEventId || event.id)}`
        const res = await fetchWithTimeout(`${eventUrl}/${RSVP_ACTION[response]}`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ sendResponse: true })
        })
        if (res.status === 404 || res.status === 410) {
          // Cancelled before the reply went; the next full listing removes
          // it. Retrying would fail on every poll.
          this.eventsRepo.markRsvpSent(event.id)
          continue
        }
        if (!res.ok) {
          errorCount++
          if (!isRetryableStatus(res.status)) {
            // Refused for good. Forgetting the guest list makes the next pull
            // read it again, so the answer shown is the one Outlook has.
            this.eventsRepo.markRsvpSent(event.id)
            this.db.prepare('UPDATE events SET attendees_synced = 0 WHERE id = ?').run(event.id)
          }
          continue
        }

        const after = await fetchWithTimeout(eventUrl, { headers: { Authorization: `Bearer ${accessToken}` } })
        if (after.status === 404) {
          this.db.prepare('DELETE FROM events WHERE id = ?').run(event.id)
        } else {
          const json = after.ok ? await after.json() : null
          this.eventsRepo.markRsvpSent(event.id, json?.['@odata.etag'] ?? null)
        }
        pushedCount++
      } catch {
        errorCount++
      }
    }

    return { pushedCount, errorCount }
  }

  /** Resolve a master + original start time to Graph's own id for that instance. */
  private async findInstanceId(
    masterEventId: string,
    originalStartUtc: string,
    accessToken: string
  ): Promise<string | null> {
    const origin = new Date(originalStartUtc)
    const from = new Date(origin.getTime() - 1000).toISOString()
    const to = new Date(origin.getTime() + 1000).toISOString()

    const res = await fetchWithTimeout(
      `${GRAPH_BASE}/me/events/${encodeURIComponent(masterEventId)}/instances` +
        `?startDateTime=${encodeURIComponent(from)}&endDateTime=${encodeURIComponent(to)}&$top=10`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Prefer: 'outlook.timezone="UTC"'
        }
      }
    )
    if (!res.ok) return null

    const data = await res.json()
    const items: MicrosoftGraphApiEvent[] = data.value || []
    const targetMs = origin.getTime()

    for (const item of items) {
      const raw = item.start?.dateTime
      if (!raw) continue
      // Graph returns a zone-less local string alongside the requested timeZone.
      const parsed = new Date(raw.endsWith('Z') ? raw : `${raw}Z`)
      if (Math.abs(parsed.getTime() - targetMs) < 1000) return item.id
    }
    return items[0]?.id ?? null
  }

  /**
   * Sync all Microsoft Graph accounts
   */
  async syncAll(clientId?: string, clientSecret?: string): Promise<SyncResult> {
    const activeAccounts = new AccountsRepo(this.db).listActive('graph')

    if (activeAccounts.length === 0) {
      return { success: true, pulledCount: 0, pushedCount: 0, errorCount: 0, message: 'No Microsoft accounts connected' }
    }

    let totalPulled = 0
    let totalPushed = 0
    let totalErrors = 0
    const accountErrors: Record<string, string> = {}

    for (const acc of activeAccounts) {
      try {
        const token = await this.oauthManager.getValidAccessToken(acc.id, clientId || '', clientSecret)
        const calendarIds = await this.syncCalendarList(acc.id, token)

        for (const calId of calendarIds) {
          // Isolate each calendar. Some entries the calendar list returns are not
          // real event collections (Google's "Tasks" pseudo-calendar, for one) and
          // reject the events endpoint; without this, the first such calendar threw
          // and every remaining calendar on the account was silently skipped.
          try {
            const rsvpRes = await this.pushRsvps(calId, token)
            totalPushed += rsvpRes.pushedCount
            totalErrors += rsvpRes.errorCount

            const pushRes = await this.pushDirtyEvents(calId, token, acc.email || undefined)
            totalPushed += pushRes.pushedCount
            totalErrors += pushRes.errorCount

            const pullRes = await this.pullCalendarEvents(calId, token, acc.email || undefined)
            totalPulled += pullRes.pulledCount

            // A calendar that pulled cleanly but could not push is not "ok".
            if (pushRes.errorCount > 0) {
              this.syncStateRepo.recordFailure(
                calId,
                `push failed for ${pushRes.errorCount} event(s): ${pushRes.lastError ?? 'unknown error'}`
              )
            } else {
              this.syncStateRepo.recordSuccess(calId, pullRes.pulledCount)
            }
          } catch (calErr) {
            this.syncStateRepo.recordFailure(calId, calErr)
            totalErrors++
          }
        }
      } catch (err) {
        // The sign-in or the calendar list failed, so nothing on the account synced.
        accountErrors[acc.id] = describeError(err)
        totalErrors++
      }
    }

    return {
      success: totalErrors === 0,
      pulledCount: totalPulled,
      pushedCount: totalPushed,
      errorCount: totalErrors,
      message: `Microsoft sync finished: pulled ${totalPulled}, pushed ${totalPushed}`,
      accountErrors
    }
  }
}
