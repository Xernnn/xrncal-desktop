-- Reference copy. The applied version is MIGRATION_023_SQL in database.ts.
--
-- "Keep mine" on a sync conflict, waiting to go out: the next push of the row
-- goes without If-Match. Resolving a conflict used to clear the etag instead,
-- which every engine reads as "never pushed", so Google and Outlook created
-- the event a second time and its guest list went out as if complete.
ALTER TABLE events ADD COLUMN keep_mine INTEGER NOT NULL DEFAULT 0;
