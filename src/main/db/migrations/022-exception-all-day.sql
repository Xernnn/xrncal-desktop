-- Reference copy. The applied version is MIGRATION_022_SQL in database.ts.
--
-- Moved occurrences pulled over CalDAV had no all-day flag of their own, so a
-- week of an all-day series moved to a time of day inherited the series' flag.
UPDATE event_exceptions
SET all_day = 0
WHERE all_day IS NULL
  AND is_cancelled = 0
  AND dtstart_utc IS NOT NULL
  AND dtend_utc IS NOT NULL
  AND master_event_id IN (SELECT id FROM events WHERE all_day = 1)
  AND NOT (dtstart_utc LIKE '%T00:00:00.000Z' AND dtend_utc LIKE '%T23:59:59.999Z');
