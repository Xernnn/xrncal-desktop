-- Reference copy. The applied version is MIGRATION_027_SQL in database.ts.
--
-- The Google pull now reads a series' EXDATE and RDATE lines. Series stored
-- before have neither, so the next sync lists every Google event once.
UPDATE sync_state SET sync_token = NULL
WHERE calendar_id IN (
  SELECT c.id FROM calendars c JOIN accounts a ON a.id = c.account_id WHERE a.type = 'google'
);
