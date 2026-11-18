-- Reference copy. The applied version is MIGRATION_029_SQL in database.ts.
--
-- A holiday subscription carries its type, and only that finds it: by name,
-- any calendar called "International Holidays" or "Ngày lễ Việt Nam" had its
-- events replaced with generated holidays at start-up. The subscriptions made
-- before are read-only calendars of this computer with no feed behind them.
ALTER TABLE calendars ADD COLUMN holiday_type TEXT;

UPDATE calendars SET holiday_type = CASE name
    WHEN 'Ngày lễ Việt Nam' THEN 'vietnam'
    WHEN 'International Holidays' THEN 'international'
  END
WHERE name IN ('Ngày lễ Việt Nam', 'International Holidays')
  AND is_read_only = 1
  AND subscription_url IS NULL
  AND account_id IN (SELECT id FROM accounts WHERE type = 'local');
