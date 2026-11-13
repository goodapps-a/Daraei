-- دارایی من (Darayi) — Idempotent Migration 002: Secondary Admins RBAC (002_admin_roles.sql)
-- کاملاً ایمن، غیرمخرب و قابل اجرای مکرر (Idempotent) روی دیتابیس‌های جدید و قدیمی.
-- بدون تغییر ساختار جدول users و بدون نیاز به بازسازی یا حذف داده.

CREATE TABLE IF NOT EXISTS admin_roles (
  user_id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'secondary_admin',
  granted_by TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_admin_roles_email ON admin_roles(email);
