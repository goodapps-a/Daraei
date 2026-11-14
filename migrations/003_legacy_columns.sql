-- دارایی من (Darayi) — Non-Destructive Legacy Column Upgrade Guide (003_legacy_columns.sql)
-- ویژه دیتابیس‌های قدیمی پروداکشن که پیش از انتشار نسخه جدید ایجاد شده‌اند.
-- نکته مهم SQLite/D1: دستور ALTER TABLE ADD COLUMN فاقد IF NOT EXISTS است و در صورت وجود قبلی ستون خطای duplicate column name می‌دهد.
-- پیش از اجرا، با دستورهای زیر ستون‌های موجود جدول را بررسی کنید و تنها دستور ستون‌های مفقود را اجرا نمایید:
--   PRAGMA table_info(rate_limits);
--   PRAGMA table_info(sessions);
--   PRAGMA table_info(alert_delivery);
--   PRAGMA table_info(alert_state);
--   PRAGMA table_info(alert_units);

-- ۱. ارتقای جدول rate_limits قدیمی (k, n, win) بدون حذف جدول یا داده‌های قبلی:
ALTER TABLE rate_limits ADD COLUMN count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE rate_limits ADD COLUMN reset_at INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_rate_limits_reset ON rate_limits(reset_at);

-- ۲. ارتقای جدول sessions قدیمی (در صورت نبود ستون created_at):
ALTER TABLE sessions ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0;

-- ۳. ارتقای جداول هشدارها در صورت قدیمی بودن ساختار:
ALTER TABLE alert_delivery ADD COLUMN lease_until INTEGER NOT NULL DEFAULT 0;
ALTER TABLE alert_delivery ADD COLUMN retry_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE alert_state ADD COLUMN version TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE alert_units ADD COLUMN currency TEXT NOT NULL DEFAULT 'IRT';

-- ۴. ثبت وضعیت اجرای مایگریشن 003 در جدول schema_migrations:
CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'applied',
  details TEXT NOT NULL DEFAULT '{}'
);

INSERT INTO schema_migrations (version, name, applied_at, status, details)
VALUES ('003_legacy_columns', 'Non-destructive legacy column additions for rate_limits, sessions, and alerts', CAST(strftime('%s', 'now') AS INTEGER), 'applied', '{"file":"003_legacy_columns.sql"}')
ON CONFLICT(version) DO UPDATE SET
  name = excluded.name,
  status = 'applied',
  applied_at = CASE WHEN schema_migrations.applied_at > 0 THEN schema_migrations.applied_at ELSE excluded.applied_at END;

