-- Reference copy. The applied version is MIGRATION_026_SQL in database.ts.
--
-- Meeting links pushed to CalDAV before URL stopped being escaped as text came
-- back with "\," "\;" and "\\" in them, one layer more after each push. Each
-- such escape is taken off until none is left, and a writable CalDAV event so
-- repaired is pushed again, which corrects the server's copy.
CREATE TEMP TABLE repaired_links AS
WITH RECURSIVE pass(id, url) AS (
  SELECT id, meeting_url FROM events WHERE meeting_url GLOB '*\[\,;]*'
  UNION ALL
  SELECT id, REPLACE(REPLACE(REPLACE(url, '\\', '\'), '\,', ','), '\;', ';')
  FROM pass WHERE url GLOB '*\[\,;]*'
)
SELECT id, url FROM pass WHERE NOT url GLOB '*\[\,;]*';

UPDATE events
SET meeting_url = (SELECT url FROM repaired_links r WHERE r.id = events.id)
WHERE id IN (SELECT id FROM repaired_links);

UPDATE events SET dirty = 1
WHERE id IN (SELECT id FROM repaired_links)
  AND is_deleted = 0
  AND has_conflict = 0
  AND calendar_id IN (
    SELECT c.id FROM calendars c JOIN accounts a ON a.id = c.account_id
    WHERE a.type = 'caldav' AND c.is_read_only = 0
  );

DROP TABLE repaired_links;
