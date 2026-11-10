-- Reference copy. The applied version is MIGRATION_025_SQL in database.ts.
--
-- A CalDAV invitation to one or a few dates of someone else's series arrives
-- as a resource holding only RECURRENCE-ID components. Each date is now an
-- event of its own, and recurrence_id is the date it stands for, so a push
-- answers it inside the server's copy. The dates share their resource's href,
-- so the unique index on the provider's id counts the date too.
ALTER TABLE events ADD COLUMN recurrence_id TEXT;

DROP INDEX IF EXISTS idx_events_provider_id;
CREATE UNIQUE INDEX idx_events_provider_id
  ON events(calendar_id, provider_event_id, COALESCE(recurrence_id, ''))
  WHERE provider_event_id IS NOT NULL;
