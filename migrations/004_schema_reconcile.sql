-- دارایی من (Darayi) — Idempotent & Non-Destructive Schema Reconciliation Migration (004_schema_reconcile.sql)
-- هدف: همگام‌سازی کامل ساختار دیتابیس Cloudflare D1 با کد Worker بدون حذف یا بازنویسی هیچ رکوردی.
-- ویژگی‌ها:
--   ۱. کاملاً غیرمخرب (بدون DROP TABLE، بدون DROP COLUMN، بدون DELETE، بدون بازسازی جدول).
--   ۲. کاملاً تکرارپذیر (Idempotent): اجرای چندباره این فایل هیچ خطای جدول، ایندکس یا رکورد تکراری ایجاد نمی‌کند.
--   ۳. ثبت وضعیت اجرای مایگریشن‌ها در جدول schema_migrations جهت ردیابی و راستی‌آزمایی دقیق.

-- ============================================================================
-- بخش ۱: جدول ردیابی وضعیت مایگریشن‌ها (schema_migrations)
-- ============================================================================
CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'applied',
  details TEXT NOT NULL DEFAULT '{}'
);

-- ============================================================================
-- بخش ۲: تضمین وجود تمام جداول مورد استفاده در Worker (بدون تغییر جداول موجود)
-- ============================================================================
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  google_sub TEXT UNIQUE,
  password_hash TEXT,
  created_at INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sessions (
  id_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS otp_codes (
  email TEXT NOT NULL,
  purpose TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  payload TEXT,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT 0,
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
  updated_at INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS alerts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  direction TEXT NOT NULL,
  price REAL NOT NULL,
  triggered_at INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS alert_units (
  alert_id TEXT PRIMARY KEY,
  currency TEXT NOT NULL DEFAULT 'IRT' CHECK(currency IN ('IRT','USD','USDT'))
);

CREATE TABLE IF NOT EXISTS alert_delivery (
  alert_id TEXT PRIMARY KEY,
  lease_until INTEGER NOT NULL DEFAULT 0,
  retry_at INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS alert_state (
  alert_id TEXT PRIMARY KEY,
  version TEXT NOT NULL DEFAULT 'legacy'
);

CREATE TABLE IF NOT EXISTS kv (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT 0
);

-- حفظ جدول قدیمی price_history برای جلوگیری از حذف داده‌های تاریخی قدیمی
CREATE TABLE IF NOT EXISTS price_history (
  asset_id TEXT NOT NULL,
  t INTEGER NOT NULL,
  price REAL NOT NULL,
  PRIMARY KEY (asset_id, t)
);

-- جدول فعال تاریخچه قیمت‌ها (پشتیبانی هم‌زمان از حالت استاندارد rowid و حالت قدیمی WITHOUT ROWID در کد Worker)
CREATE TABLE IF NOT EXISTS price_history_v2 (
  asset_id TEXT NOT NULL,
  t INTEGER NOT NULL,
  price REAL NOT NULL,
  PRIMARY KEY (asset_id, t)
);

CREATE TABLE IF NOT EXISTS api_keys (
  key_hash TEXT PRIMARY KEY,
  label TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT 0
);

-- جدول محدودیت نرخ درخواست‌ها (در دیتابیس‌های قدیمی با ستون‌های k, n, win نیز توسط Worker و دستورات شرطی پشتیبانی می‌شود)
CREATE TABLE IF NOT EXISTS rate_limits (
  k TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  reset_at INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS mail_deliveries (
  delivery_id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS admin_roles (
  user_id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'secondary_admin',
  granted_by TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL DEFAULT 0
);

-- ============================================================================
-- بخش ۳: تضمین وجود تمام Indexهای مورد نیاز کوئری‌های Worker
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_ph2_t ON price_history_v2(t);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_otp_expires ON otp_codes(expires_at);
CREATE INDEX IF NOT EXISTS idx_oauth_expires ON oauth_states(expires_at);
CREATE INDEX IF NOT EXISTS idx_alerts_user ON alerts(user_id);
CREATE INDEX IF NOT EXISTS idx_alerts_active ON alerts(triggered_at);
CREATE INDEX IF NOT EXISTS idx_admin_roles_email ON admin_roles(email);
CREATE INDEX IF NOT EXISTS idx_rate_limits_reset ON rate_limits(reset_at);

-- ============================================================================
-- بخش ۴: ثبت وضعیت نهایی مایگریشن‌ها در جدول schema_migrations
-- ============================================================================
INSERT INTO schema_migrations (version, name, applied_at, status, details)
VALUES
  ('001_fix', 'Base tables, alert auxiliary tables, and core indexes', CAST(strftime('%s', 'now') AS INTEGER), 'applied', '{"reconciledBy":"004_schema_reconcile.sql"}'),
  ('002_admin_roles', 'Secondary and primary admin RBAC table and email index', CAST(strftime('%s', 'now') AS INTEGER), 'applied', '{"reconciledBy":"004_schema_reconcile.sql"}'),
  ('004_schema_reconcile', 'Idempotent schema, index, and migration tracking reconciliation', CAST(strftime('%s', 'now') AS INTEGER), 'applied', '{"file":"004_schema_reconcile.sql","destructive":false}')
ON CONFLICT(version) DO UPDATE SET
  name = excluded.name,
  status = 'applied',
  applied_at = CASE WHEN schema_migrations.applied_at > 0 THEN schema_migrations.applied_at ELSE excluded.applied_at END;
