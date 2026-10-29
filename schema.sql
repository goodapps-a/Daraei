-- دارایی من (Darayi) — Cloudflare D1 Schema
-- Execute in Cloudflare Dashboard: Workers & Pages > D1 > your-db > Console
-- Or via CLI: npx wrangler d1 execute darayi-db --file=schema.sql

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  google_sub TEXT UNIQUE,
  password_hash TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS otp_codes (
  email TEXT NOT NULL,
  purpose TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  payload TEXT,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (email, purpose)
);

CREATE TABLE IF NOT EXISTS oauth_states (
  state_hash TEXT PRIMARY KEY,
  verifier TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS user_data (
  user_id TEXT PRIMARY KEY,
  holdings TEXT NOT NULL DEFAULT '[]',
  watch TEXT NOT NULL DEFAULT '[]',
  featured TEXT NOT NULL DEFAULT '[]',
  settings TEXT NOT NULL DEFAULT '{}',
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS alerts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  direction TEXT NOT NULL,
  price REAL NOT NULL,
  triggered_at INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_alerts_user ON alerts(user_id);
CREATE INDEX IF NOT EXISTS idx_alerts_active ON alerts(triggered_at);

CREATE TABLE IF NOT EXISTS kv (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS price_history (
  asset_id TEXT NOT NULL,
  t INTEGER NOT NULL,
  price REAL NOT NULL,
  PRIMARY KEY (asset_id, t)
);

CREATE TABLE IF NOT EXISTS api_keys (
  key_hash TEXT PRIMARY KEY,
  label TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS rate_limits (
  k TEXT PRIMARY KEY,
  n INTEGER NOT NULL,
  win INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS alert_delivery (
  alert_id TEXT PRIMARY KEY,
  lease_until INTEGER NOT NULL DEFAULT 0,
  retry_at INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS mail_deliveries (
  delivery_id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS alert_units (
  alert_id TEXT PRIMARY KEY,
  currency TEXT NOT NULL DEFAULT 'IRT'
);

CREATE TABLE IF NOT EXISTS alert_state (
  alert_id TEXT PRIMARY KEY,
  version TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS price_history_v2 (
  asset_id TEXT NOT NULL,
  t INTEGER NOT NULL,
  price REAL NOT NULL,
  PRIMARY KEY (asset_id, t)
);
