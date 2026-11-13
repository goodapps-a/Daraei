CREATE INDEX IF NOT EXISTS idx_ph2_t ON price_history_v2(t);
DELETE FROM price_history_v2 WHERE t < strftime('%s','now') - 7*86400;
DROP TABLE IF EXISTS rate_limits;
CREATE TABLE IF NOT EXISTS rate_limits (
  k TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  reset_at INTEGER NOT NULL
);
