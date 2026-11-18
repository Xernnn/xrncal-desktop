-- Reference copy. The applied version is MIGRATION_028_SQL in database.ts.
--
-- The id a new event's create goes out with (Google's event id, Outlook's
-- transactionId), kept until the provider has the event, so a create whose
-- answer was lost is neither read back in as a second event nor made again.
ALTER TABLE events ADD COLUMN create_id TEXT;
CREATE INDEX idx_events_create_id ON events(calendar_id, create_id) WHERE create_id IS NOT NULL;
