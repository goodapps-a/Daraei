-- دارایی من (Darayi) — Safe Non-Destructive D1 Migration (001_fix.sql)
-- قوانين سخت: بدون DROP TABLE، بدون DROP COLUMN، بدون بازسازی جدول و بدون حذف دسته‌جمعی رکوردها (Bulk DELETE).
-- تمام داده‌های قبلی حفظ می‌شوند و ستون‌های جدید با مقدار پیش‌فرض امن اضافه می‌گردند.

-- ۱. ایندکس‌های ضروری برای حذف اسکن کامل جدول (Full Table Scan)
CREATE INDEX IF NOT EXISTS idx_ph2_t ON price_history_v2(t);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_alerts_user ON alerts(user_id);
CREATE INDEX IF NOT EXISTS idx_alerts_active ON alerts(triggered_at);

-- ۲. ایجاد جداول مکمل در صورت عدم وجود (بدون دستکاری داده‌های فعلی)
CREATE TABLE IF NOT EXISTS price_history_v2 (
  asset_id TEXT NOT NULL,
  t INTEGER NOT NULL,
  price REAL NOT NULL,
  PRIMARY KEY (asset_id, t)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS alert_units (
  alert_id TEXT PRIMARY KEY,
  currency TEXT NOT NULL DEFAULT 'IRT' CHECK(currency IN ('IRT','USD','USDT'))
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS alert_delivery (
  alert_id TEXT PRIMARY KEY,
  lease_until INTEGER NOT NULL DEFAULT 0,
  retry_at INTEGER NOT NULL DEFAULT 0
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS alert_state (
  alert_id TEXT PRIMARY KEY,
  version TEXT NOT NULL DEFAULT 'legacy'
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS rate_limits (
  k TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  reset_at INTEGER NOT NULL DEFAULT 0
);

-- ۳. ارتقای غیرمخرب جداول قدیمی در پروداکشن بدون حذف جدول یا ستون و بدون از دست رفتن داده‌ها:
-- (در صورتی که جدول قدیمی از قبل وجود داشته باشد و فاقد این ستون‌ها باشد، دستور مربوطه را به‌صورت دستی روی D1 اجرا کنید)
-- ALTER TABLE rate_limits ADD COLUMN count INTEGER NOT NULL DEFAULT 0;
-- ALTER TABLE rate_limits ADD COLUMN reset_at INTEGER NOT NULL DEFAULT 0;
-- ALTER TABLE alert_delivery ADD COLUMN lease_until INTEGER NOT NULL DEFAULT 0;
-- ALTER TABLE alert_delivery ADD COLUMN retry_at INTEGER NOT NULL DEFAULT 0;
-- ALTER TABLE alert_state ADD COLUMN version TEXT NOT NULL DEFAULT 'legacy';
