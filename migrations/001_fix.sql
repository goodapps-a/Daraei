-- دارایی من (Darayi) — Safe Non-Destructive D1 Migration (001_fix.sql)
-- قوانين سخت: بدون DROP TABLE، بدون DROP COLUMN، بدون بازسازی جدول و بدون حذف دسته‌جمعی رکوردها (Bulk DELETE).
-- تمام داده‌های قبلی حفظ می‌شوند و ستون‌های جدید با مقدار پیش‌فرض امن اضافه می‌گردند.

-- ۱. ایندکس‌های ضروری برای حذف اسکن کامل جدول (Full Table Scan)
CREATE INDEX IF NOT EXISTS idx_ph2_t ON price_history_v2(t);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_alerts_user ON alerts(user_id);
CREATE INDEX IF NOT EXISTS idx_alerts_active ON alerts(triggered_at);

-- ۲. ایجاد جدول rate_limits در صورت عدم وجود (برای نصب‌های جدید)
CREATE TABLE IF NOT EXISTS rate_limits (
  k TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  reset_at INTEGER NOT NULL DEFAULT 0
);

-- ۳. ارتقای غیرمخرب جدول قدیمی rate_limits(k, n, win) در پروداکشن بدون حذف جدول یا حدس زدن مقادیر قدیمی n و win:
-- (در صورتی که جدول از قبل دارای ستون‌های count و reset_at باشد، اجرای خطوط ALTER در کنسول D1 نیاز نیست)
ALTER TABLE rate_limits ADD COLUMN count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE rate_limits ADD COLUMN reset_at INTEGER NOT NULL DEFAULT 0;
