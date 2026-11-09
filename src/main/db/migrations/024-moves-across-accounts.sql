-- Reference copy. The applied version is MIGRATION_024_SQL in database.ts.
--
-- Moves to another account's calendar, made before they were refused: the
-- account an event went to cannot reach its old copy, so each push failed.
-- Each such row becomes a new event in the calendar it was moved to; an
-- invitation from someone else goes without its guest list.
CREATE TEMP TABLE moved_across AS
SELECT e.id FROM events e
WHERE e.moved_from_calendar_id IS NOT NULL
  AND (SELECT account_id FROM calendars WHERE id = e.moved_from_calendar_id)
      IS NOT (SELECT account_id FROM calendars WHERE id = e.calendar_id);

UPDATE event_exceptions SET provider_instance_id = NULL, etag = NULL, dirty = 1
WHERE master_event_id IN (SELECT id FROM moved_across);

DELETE FROM attendees
WHERE event_id IN (SELECT id FROM moved_across)
  AND event_id IN (SELECT event_id FROM attendees WHERE is_self = 1 AND is_organizer = 0);

UPDATE events
SET provider_event_id = NULL, etag = NULL, moved_from_calendar_id = NULL, keep_mine = 0, has_conflict = 0, dirty = 1
WHERE id IN (SELECT id FROM moved_across);

DROP TABLE moved_across;
