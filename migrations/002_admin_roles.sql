-- دارایی من (Darayi) — Idempotent Migration 002: Secondary Admins RBAC (002_admin_roles.sql)
-- کاملاً ایمن، غیرمخرب و قابل اجرای مکرر (Idempotent) روی دیتابیس‌های جدید و قدیمی.
-- بدون تغییر ساختار جدول users و بدون نیاز به بازسازی یا حذف داده.

CREATE TABLE IF NOT EXISTS admin_roles (
  user_id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'secondary_admin',
  granted_by TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_admin_roles_email ON admin_roles(email);

CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'applied',
  details TEXT NOT NULL DEFAULT '{}'
);

INSERT INTO schema_migrations (version, name, applied_at, status, details)
VALUES ('002_admin_roles', 'Secondary and primary admin RBAC table and email index', CAST(strftime('%s', 'now') AS INTEGER), 'applied', '{"file":"002_admin_roles.sql"}')
ON CONFLICT(version) DO UPDATE SET
  name = excluded.name,
  status = 'applied',
  applied_at = CASE WHEN schema_migrations.applied_at > 0 THEN schema_migrations.applied_at ELSE excluded.applied_at END;

