import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import {
  cleanData,
  validateTransactions,
  isSafePublicUrl,
  hashPassword,
  verifyPassword,
  parsePbkdf2Hash,
  iterOf,
  normCode,
  getAdminEmails,
  getPrimaryAdminEmail,
  isEmailAdmin
} from './src/modules/security.js';
import { D1_HISTORY_ASSET_IDS, KV_SNAPSHOT_KEY, getStaleThresholdSec, isPriceItemStale } from './src/modules/market-core.js';
import worker, {
  loadData,
  saveData,
  rateLimit,
  writePricesKvSnapshot,
  getPrices,
  recordD1DomesticHistory,
  checkAlerts,
  refreshMeta,
  history,
  __resetWorkerStateForTests,
  __ageUserDataCacheForTests
} from './src/worker.js';

test('normCode converts Persian and Arabic digits to ASCII digits and strips non-digits', () => {
  assert.equal(normCode('۱۲۳۴۵۶'), '123456');
  assert.equal(normCode('١٢٣٤٥٦'), '123456');
  assert.equal(normCode(' ۱ ۲ - ۳ ۴ ۵ ۶ '), '123456');
  assert.equal(normCode('abc۹۰def'), '90');
});

test('cleanData sanitizes holdings, watch, featured, alerts, and settings', () => {
  const raw = {
    holdings: [
      { id: 'tx_1', assetId: 'btc', qty: '0.5', buyPrice: '65000', fee: '2', side: 'buy', wallet: 'کیف اصلی', date: '1403/08/01' },
      { id: 'bad_id_$$$', assetId: 'btc', qty: 1, buyPrice: 100 },
      { id: 'tx_neg', assetId: 'usd', qty: -5, buyPrice: 50000 }
    ],
    watch: ['usd', 'gold18', 'usd', 'INVALID_ID_$$$'],
    featured: ['btc', 'eth', 'btc'],
    alerts: [
      { id: 'al_1', assetId: 'usd', direction: 'above', price: '70000', currency: 'IRT' },
      { id: 'al_bad', assetId: 'usd', direction: 'sideways', price: 70000 }
    ],
    settings: { theme: 'dark', unit: 'rial', privacy: 1, filter: 'gold' }
  };

  const cleaned = cleanData(raw);
  assert.equal(cleaned.holdings.length, 1);
  assert.equal(cleaned.holdings[0].id, 'tx_1');
  assert.equal(cleaned.holdings[0].qty, 0.5);
  assert.deepEqual(cleaned.watch, ['usd', 'gold18']);
  assert.deepEqual(cleaned.featured, ['btc', 'eth']);
  assert.equal(cleaned.alerts.length, 1);
  assert.equal(cleaned.alerts[0].id, 'al_1');
  assert.deepEqual(cleaned.settings, { theme: 'dark', unit: 'rial', privacy: true, filter: 'gold' });
});

test('validateTransactions enforces wallet balances and valid transfer destinations', () => {
  // Valid buy -> sell -> transfer sequence
  assert.doesNotThrow(() => {
    validateTransactions([
      { id: '1', assetId: 'usd', side: 'buy', qty: 100, buyPrice: 60000, wallet: 'اصلی', date: '1403/01/01', createdAt: 1 },
      { id: '2', assetId: 'usd', side: 'sell', qty: 40, buyPrice: 62000, wallet: 'اصلی', date: '1403/01/02', createdAt: 2 },
      { id: '3', assetId: 'usd', side: 'transfer', qty: 60, buyPrice: 60000, wallet: 'اصلی', toWallet: 'صندوق', date: '1403/01/03', createdAt: 3 },
      { id: '4', assetId: 'usd', side: 'sell', qty: 60, buyPrice: 63000, wallet: 'صندوق', date: '1403/01/04', createdAt: 4 }
    ]);
  });

  // Insufficient balance throws
  assert.throws(
    () => {
      validateTransactions([
        { id: '1', assetId: 'usd', side: 'buy', qty: 50, buyPrice: 60000, wallet: 'اصلی', date: '1403/01/01', createdAt: 1 },
        { id: '2', assetId: 'usd', side: 'sell', qty: 80, buyPrice: 62000, wallet: 'اصلی', date: '1403/01/02', createdAt: 2 }
      ]);
    },
    /موجودی کیف پول/
  );

  // Transfer to same wallet throws
  assert.throws(
    () => {
      validateTransactions([
        { id: '1', assetId: 'usd', side: 'buy', qty: 50, buyPrice: 60000, wallet: 'اصلی', date: '1403/01/01', createdAt: 1 },
        { id: '2', assetId: 'usd', side: 'transfer', qty: 20, buyPrice: 60000, wallet: 'اصلی', toWallet: 'اصلی', date: '1403/01/02', createdAt: 2 }
      ]);
    },
    /کیف پول مقصد/
  );
});

test('isSafePublicUrl blocks SSRF vectors (numeric IPs, IPv6, octal/hex, nip.io, sslip.io, localhost)', () => {
  // Allowed public HTTPS / WSS endpoints
  assert.equal(isSafePublicUrl('https://api.kucoin.com/api/v1/market/allTickers'), true);
  assert.equal(isSafePublicUrl('https://nerkhara.com/api/v1/latest.json'), true);
  assert.equal(isSafePublicUrl('wss://stream.binance.com:443/ws/!miniTicker@arr'), true);

  // Blocked schemes, ports, credentials
  assert.equal(isSafePublicUrl('http://api.kucoin.com/api/v1/market/allTickers'), false);
  assert.equal(isSafePublicUrl('https://api.kucoin.com:8443/api'), false);
  assert.equal(isSafePublicUrl('https://user:pass@api.kucoin.com/'), false);

  // Blocked localhost & internal hostnames
  assert.equal(isSafePublicUrl('https://localhost/api'), false);
  assert.equal(isSafePublicUrl('https://sub.localhost/api'), false);
  assert.equal(isSafePublicUrl('https://service.internal/api'), false);
  assert.equal(isSafePublicUrl('https://metadata.google.internal/computeMetadata/v1/'), false);

  // Blocked all numeric IPs (dotted decimal, public IP, private IP, decimal int, hex, octal, IPv6)
  assert.equal(isSafePublicUrl('https://127.0.0.1/'), false);
  assert.equal(isSafePublicUrl('https://169.254.169.254/latest/meta-data/'), false);
  assert.equal(isSafePublicUrl('https://1.1.1.1/dns-query'), false);
  assert.equal(isSafePublicUrl('https://2130706433/'), false);
  assert.equal(isSafePublicUrl('https://0x7f000001/'), false);
  assert.equal(isSafePublicUrl('https://0177.0.0.1/'), false);
  assert.equal(isSafePublicUrl('https://[::1]/'), false);
  assert.equal(isSafePublicUrl('https://[2606:4700:4700::1111]/'), false);

  // Blocked wildcard DNS rebinding domains
  assert.equal(isSafePublicUrl('https://127.0.0.1.nip.io/'), false);
  assert.equal(isSafePublicUrl('https://169-254-169-254.sslip.io/'), false);
  assert.equal(isSafePublicUrl('https://10.0.0.1.xip.io/'), false);
  assert.equal(isSafePublicUrl('https://app.localtest.me/'), false);
  assert.equal(isSafePublicUrl('https://lvh.me/'), false);
});

test('hashPassword, verifyPassword, and PBKDF2_ITER clamping work and detect older iterations', async () => {
  assert.equal(iterOf({}), 10000);
  assert.equal(iterOf({ PBKDF2_ITER: '500' }), 1000);
  assert.equal(iterOf({ PBKDF2_ITER: '250000' }), 100000);
  assert.equal(iterOf({ PBKDF2_ITER: '15000' }), 15000);

  const lowEnv = { PBKDF2_ITER: '4000' };
  const highEnv = { PBKDF2_ITER: '12000' };
  const hashLow = await hashPassword('MyStrongPass!99', lowEnv);
  const parsed = parsePbkdf2Hash(hashLow);
  assert.ok(parsed);
  assert.equal(parsed.iter, 4000);

  assert.equal(await verifyPassword('MyStrongPass!99', hashLow, highEnv), true);
  assert.equal(await verifyPassword('WrongPass!99', hashLow, highEnv), false);
  assert.equal(parsed.iter < iterOf(highEnv), true);
});

test('saveData throws 409 Conflict with latest data when baseRevision does not match D1 updated_at', async () => {
  const storedRow = {
    holdings: JSON.stringify([{ id: 'tx_server', assetId: 'usd', qty: 10, buyPrice: 60000, fee: 0, side: 'buy', wallet: 'اصلی', toWallet: '', createdAt: 100, date: '1403/01/01', note: '' }]),
    watch: JSON.stringify(['usd', 'gold18']),
    featured: JSON.stringify(['usd']),
    settings: JSON.stringify({ theme: 'dark', unit: 'toman', privacy: false, filter: 'all' }),
    updated_at: 5000
  };

  const mockEnv = {
    DB: {
      prepare(sql) {
        return {
          bind(..._args) {
            return {
              async first() {
                if (sql.includes('SELECT updated_at FROM user_data')) {
                  return { updated_at: storedRow.updated_at };
                }
                if (sql.includes('SELECT holdings,watch,featured,settings,updated_at FROM user_data')) {
                  return storedRow;
                }
                return null;
              },
              async all() {
                return { results: [] };
              }
            };
          }
        };
      }
    }
  };

  await assert.rejects(
    async () => {
      await saveData(mockEnv, 'u_test_1', {
        baseRevision: 4999, // Stale revision! Server is at 5000
        holdings: [],
        watch: ['btc'],
        featured: ['btc'],
        alerts: [],
        settings: { theme: 'light', unit: 'toman', privacy: false, filter: 'all' }
      });
    },
    (err) => {
      assert.equal(err.status, 409);
      assert.equal(err.extra.updatedAt, 5000);
      assert.equal(err.extra.data.holdings.length, 1);
      assert.equal(err.extra.data.holdings[0].id, 'tx_server');
      return true;
    }
  );
});

function createSqliteD1Wrapper(db) {
  const stats = { reads: 0, writes: 0, queries: [] };
  const makeBound = (sql, args = []) => ({
    sql,
    args,
    async first() {
      stats.queries.push(sql);
      if (/^\s*SELECT/i.test(sql)) stats.reads++;
      else stats.writes++;
      const stmt = db.prepare(sql);
      return stmt.get(...args) || null;
    },
    async all() {
      stats.queries.push(sql);
      if (/^\s*SELECT/i.test(sql)) stats.reads++;
      else stats.writes++;
      const stmt = db.prepare(sql);
      return { results: stmt.all(...args) };
    },
    async run() {
      stats.queries.push(sql);
      stats.writes++;
      const stmt = db.prepare(sql);
      const res = stmt.run(...args);
      return { meta: { changes: Number(res.changes || 0) } };
    }
  });

  return {
    stats,
    DB: {
      prepare(sql) {
        return {
          bind(...args) {
            return makeBound(sql, args);
          },
          first() {
            return makeBound(sql, []).first();
          },
          all() {
            return makeBound(sql, []).all();
          },
          run() {
            return makeBound(sql, []).run();
          }
        };
      },
      async batch(stmts) {
        const out = [];
        for (const s of stmts) {
          if (/^\s*SELECT/i.test(s.sql)) {
            out.push(await s.all());
          } else {
            out.push(await s.run());
          }
        }
        return out;
      }
    }
  };
}

test('rateLimit persists to standard rate_limits(k, count, reset_at) and non-destructively upgrades legacy rate_limits(k, n, win)', async () => {
  __resetWorkerStateForTests();

  // Part A: Standard schema from schema.sql
  const dbStd = new DatabaseSync(':memory:');
  dbStd.exec('CREATE TABLE rate_limits (k TEXT PRIMARY KEY, count INTEGER NOT NULL DEFAULT 0, reset_at INTEGER NOT NULL DEFAULT 0);');
  const { DB: d1Std } = createSqliteD1Wrapper(dbStd);

  await rateLimit({ DB: d1Std }, 'login:test@example.com', 2, 900, true);
  await rateLimit({ DB: d1Std }, 'login:test@example.com', 2, 900, true);
  await assert.rejects(
    () => rateLimit({ DB: d1Std }, 'login:test@example.com', 2, 900, true),
    (err) => err.status === 429
  );

  // Part B: Legacy production schema rate_limits(k, n, win) with pre-existing rows
  __resetWorkerStateForTests();
  const dbLeg = new DatabaseSync(':memory:');
  dbLeg.exec('CREATE TABLE rate_limits (k TEXT PRIMARY KEY, n INTEGER NOT NULL, win INTEGER NOT NULL);');
  dbLeg.prepare('INSERT INTO rate_limits(k, n, win) VALUES (?, ?, ?)').run('legacy_row_preserved', 7, 123456);
  const { DB: d1Leg } = createSqliteD1Wrapper(dbLeg);

  await rateLimit({ DB: d1Leg }, 'otp:user@example.com', 2, 900, true);
  await rateLimit({ DB: d1Leg }, 'otp:user@example.com', 2, 900, true);
  // Simulate a second isolate hitting D1 when in-memory map is empty
  __resetWorkerStateForTests();
  await assert.rejects(
    () => rateLimit({ DB: d1Leg }, 'otp:user@example.com', 2, 900, true),
    (err) => err.status === 429
  );

  // Verify legacy row was preserved intact and its n/win were never overwritten or deleted
  const preserved = dbLeg.prepare('SELECT k, n, win, count, reset_at FROM rate_limits WHERE k = ?').get('legacy_row_preserved');
  assert.equal(preserved.k, 'legacy_row_preserved');
  assert.equal(preserved.n, 7);
  assert.equal(preserved.win, 123456);
  assert.equal(preserved.count, 0);
  assert.equal(preserved.reset_at, 0);
});

test('KV snapshot reads, writes, unchanged-snapshot write suppression, and D1 fallback work accurately', async () => {
  __resetWorkerStateForTests();

  const kvStore = new Map();
  let kvWriteCount = 0;
  let kvReadCount = 0;
  const mockKv = {
    async get(k, opts) {
      kvReadCount++;
      const raw = kvStore.get(k);
      if (!raw) return null;
      return opts?.type === 'json' ? JSON.parse(raw) : raw;
    },
    async put(k, v) {
      kvWriteCount++;
      kvStore.set(k, v);
    }
  };

  const now = Math.floor(Date.now() / 1000);
  const sampleData = {
    updatedAt: now,
    checkedAt: now,
    items: {
      usd: { price: 85000, change: 1.2, unit: 'IRT', t: now },
      btc: { price: 92000, change: 2.5, unit: 'USDT', crypto: 1, t: now }
    },
    feeds: { domestic: { ok: true, checkedAt: now } }
  };

  // First write succeeds
  const w1 = await writePricesKvSnapshot({ PRICES_KV: mockKv }, sampleData, true);
  assert.equal(w1, true);
  assert.equal(kvWriteCount, 1);

  // Immediate repeat cron write with identical prices is suppressed (prevents redundant 5m KV writes)
  const w2 = await writePricesKvSnapshot({ PRICES_KV: mockKv }, sampleData, true);
  assert.equal(w2, false);
  assert.equal(kvWriteCount, 1);

  // Changing a price triggers a new KV write immediately when forceWrite=true
  sampleData.items.usd = { ...sampleData.items.usd, price: 85200 };
  const w3 = await writePricesKvSnapshot({ PRICES_KV: mockKv }, sampleData, true);
  assert.equal(w3, true);
  assert.equal(kvWriteCount, 2);

  // Cold start loads from PRICES_KV without touching D1
  __resetWorkerStateForTests();
  const db = new DatabaseSync(':memory:');
  db.exec(fs.readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
  const { DB, stats } = createSqliteD1Wrapper(db);

  const loaded = await getPrices({ PRICES_KV: mockKv, DB });
  assert.equal(loaded.items.usd.price, 85200);
  assert.equal(kvReadCount, 1);
  assert.equal(stats.reads, 0);

  // Fallback to D1 kv table when PRICES_KV is unbound
  __resetWorkerStateForTests();
  db.prepare('INSERT INTO kv(k, v, updated_at) VALUES (?, ?, ?)').run(
    KV_SNAPSHOT_KEY,
    JSON.stringify({ updatedAt: now, checkedAt: now, items: { usd: { price: 84900, unit: 'IRT' } }, feeds: {} }),
    now
  );
  const loadedFromD1 = await getPrices({ DB });
  assert.equal(loadedFromD1.items.usd.price, 84900);
  assert.equal(stats.reads, 1);
});

test('Cold-start recordD1DomesticHistory hydrates from KV snapshot with 0 D1 reads and deduplicates unchanged prices', async () => {
  __resetWorkerStateForTests();

  const db = new DatabaseSync(':memory:');
  db.exec(fs.readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
  const { DB, stats } = createSqliteD1Wrapper(db);

  const now = Math.floor(Date.now() / 1000);
  const items = {};
  const lastHistory = {};
  for (const id of D1_HISTORY_ASSET_IDS) {
    items[id] = { price: 80000, change: 0.5, unit: 'IRT', t: now, receivedAt: now, sourceTimestamp: now - 30 };
    lastHistory[id] = [80000, now - 120]; // recorded 2 minutes ago with same price
  }

  const kvStore = new Map([
    [KV_SNAPSHOT_KEY, JSON.stringify({ version: 1, updatedAt: now - 120, checkedAt: now - 120, items, feeds: {}, lastHistory })]
  ]);
  const mockKv = {
    async get(k, opts) {
      const raw = kvStore.get(k);
      return raw && opts?.type === 'json' ? JSON.parse(raw) : raw;
    },
    async put(k, v) {
      kvStore.set(k, v);
    }
  };

  // Cold start: recordD1DomesticHistory hydrates lastHistory from KV snapshot -> 0 D1 reads AND 0 D1 writes when prices are unchanged!
  const writtenUnchanged = await recordD1DomesticHistory({ DB, PRICES_KV: mockKv }, items, now, true);
  assert.equal(writtenUnchanged, 0);
  assert.equal(stats.reads, 0, 'Expected 0 D1 reads on cold start when KV snapshot contains lastHistory');
  assert.equal(stats.writes, 0, 'Expected 0 D1 writes when prices have not changed within 15 minutes');

  // Now change usd and gold18 prices -> only those 2 rows are inserted into price_history_v2, still 0 D1 reads!
  items.usd = { ...items.usd, price: 81500 };
  items.gold18 = { ...items.gold18, price: 4650000 };
  const writtenChanged = await recordD1DomesticHistory({ DB, PRICES_KV: mockKv }, items, now + 300, true);
  assert.equal(writtenChanged, 2);
  assert.equal(stats.reads, 0);
  const countInDb = db.prepare('SELECT COUNT(*) AS c FROM price_history_v2').get().c;
  assert.equal(countInDb, 2);
});

test('refreshMeta performs bounded batch retention cleanup and preserves legacy rate_limits rows with reset_at = 0', async () => {
  __resetWorkerStateForTests();

  const db = new DatabaseSync(':memory:');
  db.exec(fs.readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
  const { DB } = createSqliteD1Wrapper(db);

  const now = Math.floor(Date.now() / 1000);
  db.prepare('INSERT INTO price_history_v2(asset_id, t, price) VALUES (?, ?, ?)').run('usd', now - 10 * 86400, 75000);
  db.prepare('INSERT INTO price_history_v2(asset_id, t, price) VALUES (?, ?, ?)').run('usd', now - 3600, 85000);
  db.prepare('INSERT INTO rate_limits(k, count, reset_at) VALUES (?, ?, ?)').run('legacy_zero', 0, 0);
  db.prepare('INSERT INTO rate_limits(k, count, reset_at) VALUES (?, ?, ?)').run('expired_row', 3, now - 600);
  db.prepare('INSERT INTO rate_limits(k, count, reset_at) VALUES (?, ?, ?)').run('active_row', 1, now + 600);

  await refreshMeta({ DB, PRICE_HISTORY_DAYS: 7 });

  const remainingPh = db.prepare('SELECT t, price FROM price_history_v2').all();
  assert.equal(remainingPh.length, 1);
  assert.equal(remainingPh[0].price, 85000);

  const remainingRl = db.prepare('SELECT k FROM rate_limits ORDER BY k').all().map((r) => r.k);
  assert.deepEqual(remainingRl, ['active_row', 'legacy_zero']);
});

test('history endpoint coalesces concurrent in-flight requests and serves subsequent requests from cache with 0 extra D1 reads', async () => {
  __resetWorkerStateForTests();

  const db = new DatabaseSync(':memory:');
  db.exec(fs.readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
  const { DB, stats } = createSqliteD1Wrapper(db);

  const now = Math.floor(Date.now() / 1000);
  for (let i = 10; i >= 1; i--) {
    db.prepare('INSERT INTO price_history_v2(asset_id, t, price) VALUES (?, ?, ?)').run('usd', now - i * 300, 84000 + i * 50);
  }

  const kvStore = new Map([
    [
      KV_SNAPSHOT_KEY,
      JSON.stringify({
        version: 1,
        updatedAt: now,
        checkedAt: now,
        items: { usd: { price: 84600, change: 0.8, unit: 'IRT', kind: 'domestic', t: now, receivedAt: now } },
        feeds: {}
      })
    ]
  ]);
  const mockKv = {
    async get(k, opts) {
      const raw = kvStore.get(k);
      return raw && opts?.type === 'json' ? JSON.parse(raw) : raw;
    },
    async put(k, v) {
      kvStore.set(k, v);
    }
  };

  const url = new URL('https://darayi.example/api/history?id=usd&range=1H');
  const [res1, res2, res3] = await Promise.all([
    history({ DB, PRICES_KV: mockKv }, url),
    history({ DB, PRICES_KV: mockKv }, url),
    history({ DB, PRICES_KV: mockKv }, url)
  ]);

  const j1 = await res1.json();
  const j2 = await res2.json();
  const j3 = await res3.json();
  assert.ok(j1.points.length >= 2);
  assert.equal(j1.points.length, j2.points.length);
  assert.equal(j2.points.length, j3.points.length);
  assert.equal(stats.reads, 1, 'Expected 3 concurrent 1H history requests to coalesce into 1 D1 read');

  // Subsequent warm cache call performs 0 additional D1 reads
  const res4 = await history({ DB, PRICES_KV: mockKv }, url);
  const j4 = await res4.json();
  assert.equal(j4.points.length, j1.points.length);
  assert.equal(stats.reads, 1);
});

test('SQLite EXPLAIN QUERY PLAN verifies all critical queries use PK or secondary indexes without full table scans', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(fs.readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));

  const explain = (sql) =>
    db
      .prepare(`EXPLAIN QUERY PLAN ${sql}`)
      .all()
      .map((r) => r.detail)
      .join(' | ');

  const planPhLatest = explain('SELECT asset_id,t,price FROM price_history_v2 WHERE asset_id=? ORDER BY t DESC LIMIT 1');
  assert.match(planPhLatest, /SEARCH price_history_v2 USING INDEX sqlite_autoindex_price_history_v2_1/);
  assert.doesNotMatch(planPhLatest, /\bSCAN\b/);

  const planPhRange = explain('SELECT t, price FROM price_history_v2 WHERE asset_id = ? AND t >= ? ORDER BY t ASC LIMIT 600');
  assert.match(planPhRange, /SEARCH price_history_v2 USING INDEX sqlite_autoindex_price_history_v2_1/);
  assert.doesNotMatch(planPhRange, /\bSCAN\b/);

  const planPhCleanup = explain('SELECT rowid FROM price_history_v2 WHERE t < ? LIMIT 5000');
  assert.match(planPhCleanup, /SEARCH price_history_v2 USING COVERING INDEX idx_ph2_t/);
  assert.doesNotMatch(planPhCleanup, /\bSCAN\b/);

  const planSessionsUser = explain('DELETE FROM sessions WHERE user_id=?');
  assert.match(planSessionsUser, /SEARCH sessions USING INDEX idx_sessions_user/);
  assert.doesNotMatch(planSessionsUser, /\bSCAN\b/);

  const planAlertsActive = explain('SELECT 1 FROM alerts WHERE triggered_at IS NULL LIMIT 1');
  assert.match(planAlertsActive, /SEARCH alerts USING COVERING INDEX idx_alerts_active/);
  assert.doesNotMatch(planAlertsActive, /\bSCAN\b/);

  const planAlertsUser = explain('SELECT id FROM alerts WHERE user_id=?');
  assert.match(planAlertsUser, /SEARCH alerts USING INDEX idx_alerts_user/);
  assert.doesNotMatch(planAlertsUser, /\bSCAN\b/);
});

test('migrations/001_fix.sql aligns alert_units, alert_delivery, and alert_state schema with Worker queries', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT, password_hash TEXT, google_sub TEXT, created_at INTEGER NOT NULL);
    CREATE TABLE sessions (id_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at INTEGER NOT NULL);
    CREATE TABLE user_data (user_id TEXT PRIMARY KEY, holdings TEXT NOT NULL DEFAULT '[]', watch TEXT NOT NULL DEFAULT '[]', featured TEXT NOT NULL DEFAULT '[]', settings TEXT NOT NULL DEFAULT '{}', updated_at INTEGER NOT NULL);
    CREATE TABLE alerts (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, asset_id TEXT NOT NULL, direction TEXT NOT NULL, price REAL NOT NULL, triggered_at INTEGER, attempts INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
    CREATE TABLE price_history_v2 (asset_id TEXT NOT NULL, t INTEGER NOT NULL, price REAL NOT NULL, PRIMARY KEY (asset_id, t)) WITHOUT ROWID;
    CREATE TABLE rate_limits (k TEXT PRIMARY KEY, n INTEGER NOT NULL, win INTEGER NOT NULL);
  `);
  const migSql = fs.readFileSync(new URL('./migrations/001_fix.sql', import.meta.url), 'utf8');
  db.exec(migSql);

  const colsOf = (table) => db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  assert.deepEqual(colsOf('alert_units'), ['alert_id', 'currency']);
  assert.deepEqual(colsOf('alert_delivery'), ['alert_id', 'lease_until', 'retry_at']);
  assert.deepEqual(colsOf('alert_state'), ['alert_id', 'version']);

  // Verify alert retry SQL works against migrated schema
  db.prepare(`INSERT INTO alerts(id,user_id,asset_id,direction,price,triggered_at,attempts,created_at) VALUES('u1:a1','u1','usd','above',90000,1000,3,1000)`).run();
  db.prepare(`INSERT INTO alert_units(alert_id) VALUES('u1:a1')`).run();
  assert.equal(db.prepare(`SELECT currency FROM alert_units WHERE alert_id='u1:a1'`).get().currency, 'IRT');
  db.prepare(`INSERT INTO alert_delivery(alert_id,lease_until,retry_at) VALUES('u1:a1',10,20)`).run();
  db.prepare(`INSERT INTO alert_state(alert_id,version) VALUES('u1:a1','v1') ON CONFLICT(alert_id) DO UPDATE SET version=excluded.version`).run();
});

test('admin user inheriting admin_root user_data can save without hitting a 409 conflict loop', async () => {
  __resetWorkerStateForTests();
  const db = new DatabaseSync(':memory:');
  db.exec(fs.readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
  const { DB } = createSqliteD1Wrapper(db);

  const adminEmail = 'boss@example.com';
  const adminUid = 'AdMiN_RaNdOm_99';
  const env = { DB, ADMIN_EMAIL: adminEmail, AUTH_SECRET: 'test-auth-secret-key-minimum-32-chars!!' };

  db.prepare('INSERT INTO users(id,email,name,created_at) VALUES(?,?,?,?)').run(adminUid, adminEmail, 'Boss', 1000);
  db.prepare(`INSERT INTO user_data(user_id,holdings,watch,featured,settings,updated_at) VALUES('admin_root','[]','["usd"]','["usd"]','{}',5000)`).run();
  db.prepare(`INSERT INTO alerts(id,user_id,asset_id,direction,price,created_at) VALUES('admin_root:al1','admin_root','usd','above',95000,1000)`).run();

  const initial = await loadData(env, adminUid);
  assert.equal(initial.exists, true);
  assert.equal(initial.updatedAt, 5000);
  assert.deepEqual(initial.data.watch, ['usd']);
  assert.equal(initial.data.alerts.length, 1);
  assert.equal(initial.data.alerts[0].id, 'al1');

  const saved = await saveData(env, adminUid, {
    baseRevision: initial.updatedAt,
    holdings: [],
    watch: ['usd', 'btc'],
    featured: ['usd'],
    alerts: initial.data.alerts,
    settings: { theme: 'dark', unit: 'toman', privacy: false, filter: 'all' }
  });
  assert.equal(saved.exists, true);
  assert.ok(saved.updatedAt > 5000);
  assert.deepEqual(saved.data.watch, ['usd', 'btc']);
});

test('recordD1DomesticHistory rolls back timestamp and avoids cache poisoning when DB.batch fails', async () => {
  __resetWorkerStateForTests();
  const now = Math.floor(Date.now() / 1000);
  let failBatch = true;
  const db = new DatabaseSync(':memory:');
  db.exec(fs.readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
  const { DB: baseDB } = createSqliteD1Wrapper(db);

  const flakyDB = {
    prepare: (sql) => baseDB.prepare(sql),
    async batch(stmts) {
      if (failBatch && stmts.some((s) => /INSERT/i.test(s.sql))) {
        throw new Error('simulated_d1_transient_failure');
      }
      return baseDB.batch(stmts);
    }
  };

  const items = {
    usd: { price: 82000, change: 0.5, unit: 'IRT', kind: 'domestic', t: now, receivedAt: now }
  };

  // First attempt fails during batch write -> must return 0 and NOT suppress immediate retry or write to DB
  const res1 = await recordD1DomesticHistory({ DB: flakyDB }, items, now, false);
  assert.equal(res1, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM price_history_v2').get().c, 0);

  // Immediate retry (+5s, within 260s window) succeeds because lastD1HistoryWriteTime and lastD1RecordedMap were rolled back
  failBatch = false;
  const res2 = await recordD1DomesticHistory({ DB: flakyDB }, items, now + 5, false);
  assert.equal(res2, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM price_history_v2').get().c, 1);
});

test('history endpoint immediately rejects unknown asset IDs without triggering external API calls', async () => {
  __resetWorkerStateForTests();
  const now = Math.floor(Date.now() / 1000);
  const kvStore = new Map();
  const mockKv = {
    async get(k, opts) {
      const raw = kvStore.get(k);
      return raw && opts?.type === 'json' ? JSON.parse(raw) : raw || null;
    },
    async put(k, v) {
      kvStore.set(k, v);
    }
  };
  const okWrite = await writePricesKvSnapshot(
    { PRICES_KV: mockKv, DB: null },
    {
      updatedAt: now,
      checkedAt: now,
      items: { usd: { price: 84000, change: 0.5, unit: 'IRT', kind: 'domestic', t: now, receivedAt: now } },
      feeds: {}
    },
    true
  );
  assert.equal(okWrite, true);

  let fetchCalled = 0;
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    fetchCalled++;
    throw new Error('should_not_fetch_unknown_asset');
  };
  try {
    const res = await history({ PRICES_KV: mockKv }, new URL('https://darayi.example/api/history?id=totallyunknown999&range=1D'));
    const body = await res.json();
    assert.equal(body.unavailable, true);
    assert.equal(body.reason, 'unknown_asset');
    assert.equal(fetchCalled, 0);
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('admin user toggle blocks suspending admin accounts, revokes mixed-case D1 sessions, and DELETE /api/me handles missing optional tables', async () => {
  __resetWorkerStateForTests();
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT, password_hash TEXT, google_sub TEXT, created_at INTEGER NOT NULL);
    CREATE TABLE sessions (id_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at INTEGER NOT NULL);
    CREATE TABLE user_data (user_id TEXT PRIMARY KEY, holdings TEXT NOT NULL DEFAULT '[]', watch TEXT NOT NULL DEFAULT '[]', featured TEXT NOT NULL DEFAULT '[]', settings TEXT NOT NULL DEFAULT '{}', updated_at INTEGER NOT NULL);
    CREATE TABLE alerts (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, asset_id TEXT NOT NULL, direction TEXT NOT NULL, price REAL NOT NULL, triggered_at INTEGER, attempts INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
    CREATE TABLE otp_codes (email TEXT NOT NULL, purpose TEXT NOT NULL, code_hash TEXT NOT NULL, payload TEXT, expires_at INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, PRIMARY KEY (email, purpose));
    CREATE TABLE kv (k TEXT PRIMARY KEY, v TEXT NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TABLE rate_limits (k TEXT PRIMARY KEY, count INTEGER NOT NULL DEFAULT 0, reset_at INTEGER NOT NULL DEFAULT 0);
  `);
  const { DB } = createSqliteD1Wrapper(db);

  const secret = 'test-auth-secret-key-minimum-32-chars!!';
  const adminEmail = 'boss@example.com';
  const env = { DB, ADMIN_EMAIL: adminEmail, AUTH_SECRET: secret };
  const passHash = await hashPassword('SecretPass123!', env);

  const adminId = 'Adm_Mixed_1';
  const userId = 'Usr_MixedCase_99';
  const userEmail = 'member@example.com';
  db.prepare('INSERT INTO users(id,email,name,password_hash,created_at) VALUES(?,?,?,?,?)').run(adminId, adminEmail, 'Admin', passHash, 1000);
  db.prepare('INSERT INTO users(id,email,name,password_hash,created_at) VALUES(?,?,?,?,?)').run(userId, userEmail, 'Member', passHash, 1000);

  const post = (url, body, bearer) =>
    worker.fetch(
      new Request(url, {
        method: 'POST',
        headers: {
          origin: 'https://darayi.example',
          'content-type': 'application/json',
          'x-requested-with': 'XMLHttpRequest',
          ...(bearer ? { authorization: `Bearer ${bearer}` } : {})
        },
        body: JSON.stringify(body || {})
      }),
      env
    );

  // Sign in both admin and member
  const adminLogin = await (await post('https://darayi.example/api/auth/login', { email: adminEmail, password: 'SecretPass123!' })).json();
  const userLogin = await (await post('https://darayi.example/api/auth/login', { email: userEmail, password: 'SecretPass123!' })).json();
  assert.ok(adminLogin.token);
  assert.ok(userLogin.token);

  // Admin cannot be suspended even via mixed-case ID
  const selfToggle = await post(`https://darayi.example/api/admin/users/${adminId}/toggle`, {}, adminLogin.token);
  assert.equal(selfToggle.status, 400);

  // Suspending normal member revokes their D1 session (exact mixed-case user_id match)
  const toggleRes = await post(`https://darayi.example/api/admin/users/${userId}/toggle`, {}, adminLogin.token);
  assert.equal(toggleRes.status, 200);
  const toggleBody = await toggleRes.json();
  assert.equal(toggleBody.status, 'suspended');
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM sessions WHERE user_id=?').get(userId).c, 0);

  // Unsuspend member, sign back in, test maintenance mode, then delete account cleanly without alert_units/alert_state/alert_delivery tables
  await post(`https://darayi.example/api/admin/users/${userId}/toggle`, {}, adminLogin.token);
  const userLogin2 = await (await post('https://darayi.example/api/auth/login', { email: userEmail, password: 'SecretPass123!' })).json();

  const maintRes = await post('https://darayi.example/api/admin/settings', { maintenance: true }, adminLogin.token);
  assert.equal(maintRes.status, 200);

  const blockedSave = await worker.fetch(
    new Request('https://darayi.example/api/me/data', {
      method: 'PUT',
      headers: {
        origin: 'https://darayi.example',
        'content-type': 'application/json',
        'x-requested-with': 'XMLHttpRequest',
        authorization: `Bearer ${userLogin2.token}`
      },
      body: JSON.stringify({ holdings: [], watch: ['usd'], featured: ['usd'], alerts: [], settings: {} })
    }),
    env
  );
  assert.equal(blockedSave.status, 503);

  // Disable maintenance mode, then verify DELETE /api/me works even when optional alert tables are absent
  await post('https://darayi.example/api/admin/settings', { maintenance: false }, adminLogin.token);
  const delRes = await worker.fetch(
    new Request('https://darayi.example/api/me', {
      method: 'DELETE',
      headers: {
        origin: 'https://darayi.example',
        'content-type': 'application/json',
        'x-requested-with': 'XMLHttpRequest',
        authorization: `Bearer ${userLogin2.token}`
      }
    }),
    env
  );
  assert.equal(delRes.status, 200);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM users WHERE id=?').get(userId).c, 0);
});

test('loadData throws 503 on missing DB or D1 read failure instead of returning exists: false', async () => {
  __resetWorkerStateForTests();

  // Missing DB must fail closed (503) rather than falsely impersonating an empty account
  await assert.rejects(
    () => loadData({}, 'u_no_db'),
    (err) => err.status === 503
  );

  // Failing D1 query must also fail closed (503)
  const brokenDB = {
    prepare() {
      return {
        bind() {
          return {
            async first() { throw new Error('d1_io_timeout'); },
            async all() { throw new Error('d1_io_timeout'); }
          };
        }
      };
    }
  };
  await assert.rejects(
    () => loadData({ DB: brokenDB }, 'u_db_err'),
    (err) => err.status === 503
  );

  // Clean empty DB account returns explicit ok: true, status: 'empty', exists: false
  const db = new DatabaseSync(':memory:');
  db.exec(fs.readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
  const { DB } = createSqliteD1Wrapper(db);
  const emptyRes = await loadData({ DB }, 'u_truly_empty');
  assert.equal(emptyRes.ok, true);
  assert.equal(emptyRes.status, 'empty');
  assert.equal(emptyRes.exists, false);
  assert.equal(emptyRes.updatedAt, 0);
});

test('currentUser fails closed on missing/revoked D1 sessions or D1 failure without falling back to signed token payload', async () => {
  __resetWorkerStateForTests();
  const db = new DatabaseSync(':memory:');
  db.exec(fs.readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
  const { DB } = createSqliteD1Wrapper(db);

  const env = { DB, AUTH_SECRET: 'test-auth-secret-key-minimum-32-chars!!' };
  const passHash = await hashPassword('StrongPass!123', env);
  db.prepare('INSERT INTO users(id,email,name,password_hash,created_at) VALUES(?,?,?,?,?)')
    .run('u_rev_1', 'rev@example.com', 'RevTest', passHash, 1000);

  const loginRes = await worker.fetch(
    new Request('https://darayi.example/api/auth/login', {
      method: 'POST',
      headers: {
        origin: 'https://darayi.example',
        'content-type': 'application/json',
        'x-requested-with': 'XMLHttpRequest'
      },
      body: JSON.stringify({ email: 'rev@example.com', password: 'StrongPass!123' })
    }),
    env
  );
  const loginJson = await loginRes.json();
  assert.ok(loginJson.token);

  const getMe = (bearer, customEnv = env) =>
    worker.fetch(
      new Request('https://darayi.example/api/me', {
        headers: { authorization: `Bearer ${bearer}` }
      }),
      customEnv
    );
  const getData = (bearer, customEnv = env) =>
    worker.fetch(
      new Request('https://darayi.example/api/me/data', {
        headers: { authorization: `Bearer ${bearer}` }
      }),
      customEnv
    );

  // Active session succeeds
  assert.equal((await (await getMe(loginJson.token)).json()).user?.email, 'rev@example.com');
  assert.equal((await getData(loginJson.token)).status, 200);

  // D1 throws error on fresh isolate -> fail closed (null user on /api/me, 401 on /api/me/data)
  __resetWorkerStateForTests();
  const failingEnv = {
    AUTH_SECRET: env.AUTH_SECRET,
    DB: {
      prepare() {
        return {
          bind() {
            return {
              async first() { throw new Error('d1_unavailable'); },
              async all() { throw new Error('d1_unavailable'); }
            };
          }
        };
      }
    }
  };
  assert.equal((await (await getMe(loginJson.token, failingEnv)).json()).user, null);
  assert.equal((await getData(loginJson.token, failingEnv)).status, 401);

  // Session deleted in D1 (revoked on another device/isolate) -> rejected even with valid HMAC signature
  __resetWorkerStateForTests();
  db.prepare('DELETE FROM sessions WHERE user_id=?').run('u_rev_1');
  assert.equal((await (await getMe(loginJson.token)).json()).user, null);
  assert.equal((await getData(loginJson.token)).status, 401);
});

test('loadData invalidates stale userDataCache across isolates via single PK revision check and checkAlerts bumps updated_at', async () => {
  __resetWorkerStateForTests();
  const db = new DatabaseSync(':memory:');
  db.exec(fs.readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
  const { DB, stats } = createSqliteD1Wrapper(db);
  const env = { DB, AUTH_SECRET: 'test-auth-secret-key-minimum-32-chars!!' };
  const now = Math.floor(Date.now() / 1000);

  db.prepare('INSERT INTO users(id,email,name,created_at) VALUES(?,?,?,?)').run('u_sync_1', 'sync1@example.com', 'Sync1', now);
  db.prepare(`INSERT INTO user_data(user_id,holdings,watch,featured,settings,updated_at) VALUES('u_sync_1','[]','["usd"]','["usd"]','{}',10000)`).run();

  // Warm cache on Isolate B
  const firstLoad = await loadData(env, 'u_sync_1');
  assert.deepEqual(firstLoad.data.watch, ['usd']);
  assert.equal(firstLoad.updatedAt, 10000);

  // After >5s, unchanged DB row only executes 1 PK read (SELECT updated_at) and skips alerts/blob reload
  stats.reads = 0;
  __ageUserDataCacheForTests(10);
  const unchangedLoad = await loadData(env, 'u_sync_1');
  assert.equal(unchangedLoad.updatedAt, 10000);
  assert.equal(stats.reads, 1, 'Expected 1 PK updated_at read when DB revision is unchanged');

  // Device A writes directly in D1 (simulating another Worker isolate updating user_data)
  db.prepare(`UPDATE user_data SET watch='["usd","btc"]', updated_at=20000 WHERE user_id='u_sync_1'`).run();
  __ageUserDataCacheForTests(10);
  const freshLoad = await loadData(env, 'u_sync_1');
  assert.equal(freshLoad.updatedAt, 20000);
  assert.deepEqual(freshLoad.data.watch, ['usd', 'btc']);

  // Triggering an alert in checkAlerts bumps user_data.updated_at so polling clients detect triggered alerts across isolates
  db.prepare(`INSERT INTO alerts(id,user_id,asset_id,direction,price,created_at) VALUES('u_sync_1:al_trig','u_sync_1','usd','above',80000,?)`).run(now);
  const sent = await checkAlerts(env, {
    usd: { price: 85000, unit: 'IRT', kind: 'domestic', t: now, receivedAt: now, sourceTimestamp: now }
  });
  assert.equal(sent, 1);
  const bumpedRow = db.prepare('SELECT updated_at FROM user_data WHERE user_id=?').get('u_sync_1');
  assert.ok(Number(bumpedRow.updated_at) > 20000);
});

test('migrations/001_fix.sql succeeds cleanly on a completely empty DB and refreshMeta cleans up legacy WITHOUT ROWID price_history_v2', async () => {
  // Part A: Empty DB executes migrations/001_fix.sql cleanly without index-before-table errors
  const emptyDb = new DatabaseSync(':memory:');
  const migSql = fs.readFileSync(new URL('./migrations/001_fix.sql', import.meta.url), 'utf8');
  assert.doesNotThrow(() => emptyDb.exec(migSql));
  const phPlan = emptyDb
    .prepare('EXPLAIN QUERY PLAN SELECT rowid FROM price_history_v2 WHERE t < ? LIMIT 5000')
    .all()
    .map((r) => r.detail)
    .join(' | ');
  assert.match(phPlan, /USING COVERING INDEX idx_ph2_t/);

  // Part B: Legacy production table created WITH WITHOUT ROWID still cleans up expired rows in refreshMeta without throwing
  __resetWorkerStateForTests();
  const legacyDb = new DatabaseSync(':memory:');
  legacyDb.exec(`
    CREATE TABLE sessions (id_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at INTEGER NOT NULL);
    CREATE TABLE otp_codes (email TEXT NOT NULL, purpose TEXT NOT NULL, code_hash TEXT NOT NULL, expires_at INTEGER NOT NULL, PRIMARY KEY(email, purpose));
    CREATE TABLE oauth_states (state_hash TEXT PRIMARY KEY, verifier TEXT NOT NULL, expires_at INTEGER NOT NULL);
    CREATE TABLE rate_limits (k TEXT PRIMARY KEY, count INTEGER NOT NULL DEFAULT 0, reset_at INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE kv (k TEXT PRIMARY KEY, v TEXT NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TABLE price_history_v2 (asset_id TEXT NOT NULL, t INTEGER NOT NULL, price REAL NOT NULL, PRIMARY KEY (asset_id, t)) WITHOUT ROWID;
    CREATE INDEX idx_ph2_t ON price_history_v2(t);
  `);
  const now = Math.floor(Date.now() / 1000);
  legacyDb.prepare('INSERT INTO price_history_v2(asset_id, t, price) VALUES (?, ?, ?)').run('usd', now - 10 * 86400, 70000);
  legacyDb.prepare('INSERT INTO price_history_v2(asset_id, t, price) VALUES (?, ?, ?)').run('usd', now - 1800, 86000);
  const { DB } = createSqliteD1Wrapper(legacyDb);

  await refreshMeta({ DB, PRICE_HISTORY_DAYS: 7 });
  const rows = legacyDb.prepare('SELECT price FROM price_history_v2').all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].price, 86000);
});

test('getStaleThresholdSec and isPriceItemStale distinguish 24/7 crypto/USDT from Tehran weekend & overnight domestic hours', () => {
  // Active Tehran Tuesday midday: 2026-11-10 10:30 UTC == 14:00 Tehran Time (Tue)
  const tueMidday = Math.floor(Date.parse('2026-11-10T10:30:00Z') / 1000);
  assert.equal(getStaleThresholdSec('btc', true, tueMidday), 900);
  assert.equal(getStaleThresholdSec('usdt', false, tueMidday), 1800);
  assert.equal(getStaleThresholdSec('usd', false, tueMidday), 14400);
  assert.equal(getStaleThresholdSec('try', false, tueMidday), 21600);

  // 20-minute-old BTC quote is stale; 10-minute-old BTC quote is fresh
  assert.equal(isPriceItemStale({ price: 90000, crypto: 1, unit: 'USDT', t: tueMidday - 1200 }, 'btc', tueMidday), true);
  assert.equal(isPriceItemStale({ price: 90000, crypto: 1, unit: 'USDT', t: tueMidday - 600 }, 'btc', tueMidday), false);

  // 5-hour-old major domestic USD quote during active Tuesday market hours is stale; 5-hour-old secondary TRY is still within 6h threshold
  assert.equal(isPriceItemStale({ price: 85000, unit: 'IRT', kind: 'domestic', t: tueMidday - 5 * 3600 }, 'usd', tueMidday), true);
  assert.equal(isPriceItemStale({ price: 2400, unit: 'IRT', kind: 'domestic', t: tueMidday - 5 * 3600 }, 'try', tueMidday), false);

  // Friday Tehran afternoon: 2026-11-13 12:00 UTC == 15:30 Tehran Time (Fri closed)
  // Valid Thursday 15:00 Tehran quote (~24.5h old) MUST remain fresh on Friday!
  const friAfternoon = Math.floor(Date.parse('2026-11-13T12:00:00Z') / 1000);
  const thuClose = friAfternoon - Math.floor(24.5 * 3600);
  assert.ok(getStaleThresholdSec('gold18', false, friAfternoon) >= 52 * 3600);
  assert.equal(isPriceItemStale({ price: 4500000, unit: 'IRT', kind: 'domestic', sourceTimestamp: thuClose }, 'gold18', friAfternoon), false);

  // Overnight Tuesday 04:00 Tehran (00:30 UTC): Monday 19:00 Tehran close (~9h old) remains fresh
  const tueNight = Math.floor(Date.parse('2026-11-10T00:30:00Z') / 1000);
  const monClose = tueNight - 9 * 3600;
  assert.equal(isPriceItemStale({ price: 85000, unit: 'IRT', kind: 'domestic', sourceTimestamp: monClose }, 'usd', tueNight), false);
});

test('multi-admin config parser handles ADMIN_EMAILS, legacy ADMIN_EMAIL, whitespace, case, and deduplication', () => {
  const env1 = { ADMIN_EMAILS: ' Admin1@Example.com , boss@example.com ; admin1@example.com \n not-an-email ' };
  assert.deepEqual(getAdminEmails(env1), ['admin1@example.com', 'boss@example.com']);
  assert.equal(getPrimaryAdminEmail(env1), 'admin1@example.com');
  assert.equal(isEmailAdmin(env1, ' BOSS@EXAMPLE.COM '), true);
  assert.equal(isEmailAdmin(env1, 'user@example.com'), false);

  // Backward compatibility: legacy ADMIN_EMAIL remains primary when both exist
  const env2 = { ADMIN_EMAIL: 'Primary@Example.com', ADMIN_EMAILS: 'Secondary@Example.com, primary@example.com' };
  assert.deepEqual(getAdminEmails(env2), ['secondary@example.com', 'primary@example.com']);
  assert.equal(getPrimaryAdminEmail(env2), 'primary@example.com');
  assert.equal(isEmailAdmin(env2, 'secondary@example.com'), true);
});

test('multi-admin isolation, live admin revocation, /api/admin/password isolation, IDOR & privilege escalation protection', async () => {
  __resetWorkerStateForTests();
  const db = new DatabaseSync(':memory:');
  db.exec(fs.readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
  const { DB, stats } = createSqliteD1Wrapper(db);

  const secret = 'test-auth-secret-key-minimum-32-chars!!';
  const admin1 = 'boss1@example.com';
  const admin2 = 'boss2@example.com';
  const normalEmail = 'member@example.com';
  const env = {
    DB,
    ADMIN_EMAIL: admin1,
    ADMIN_EMAILS: `${admin1}, ${admin2}`,
    ADMIN_PASSWORD: 'InitAdminPassword!1',
    AUTH_SECRET: secret
  };

  // Seed legacy admin_root data belonging to legacy/primary admin
  db.prepare(`INSERT INTO user_data(user_id,holdings,watch,featured,settings,updated_at) VALUES('admin_root','[]','["usd","gold18"]','["usd"]','{}',5000)`).run();
  db.prepare(`INSERT INTO alerts(id,user_id,asset_id,direction,price,triggered_at,attempts,created_at) VALUES('admin_root:legacy_al','admin_root','usd','above',90000,1000,1,1000)`).run();

  const callApi = (path, { method = 'GET', body, token } = {}, customEnv = env) =>
    worker.fetch(
      new Request(`https://darayi.example${path}`, {
        method,
        headers: {
          origin: 'https://darayi.example',
          ...(body ? { 'content-type': 'application/json' } : {}),
          'x-requested-with': 'XMLHttpRequest',
          ...(token ? { authorization: `Bearer ${token}` } : {})
        },
        ...(body ? { body: JSON.stringify(body) } : {})
      }),
      customEnv
    );

  // Both admins log in using configured ADMIN_PASSWORD
  const r1 = await callApi('/api/auth/login', { method: 'POST', body: { email: admin1, password: 'InitAdminPassword!1' } });
  const j1 = await r1.json();
  assert.equal(r1.status, 200);
  assert.equal(j1.user.isAdmin, true);

  const r2 = await callApi('/api/auth/login', { method: 'POST', body: { email: admin2, password: 'InitAdminPassword!1' } });
  const j2 = await r2.json();
  assert.equal(r2.status, 200);
  assert.equal(j2.user.isAdmin, true);
  assert.notEqual(j1.user.id, j2.user.id);

  // Primary admin sees inherited admin_root data, while secondary admin MUST NOT inherit admin_root!
  const d1 = await (await callApi('/api/me/data?fresh=1', { token: j1.token })).json();
  assert.equal(d1.exists, true);
  assert.deepEqual(d1.data.watch, ['usd', 'gold18']);

  const d2 = await (await callApi('/api/me/data?fresh=1', { token: j2.token })).json();
  assert.equal(d2.exists, false);
  assert.deepEqual(d2.data.watch, []);

  // Secondary admin cannot retry primary admin's alert (IDOR -> 404)
  const crossRetry = await callApi('/api/me/alerts/legacy_al/retry', { method: 'POST', token: j2.token });
  assert.equal(crossRetry.status, 404);

  // Primary admin CAN retry their inherited legacy alert cleanly
  const ownRetry = await callApi('/api/me/alerts/legacy_al/retry', { method: 'POST', token: j1.token });
  assert.equal(ownRetry.status, 200);

  // Secondary admin changes their own password via /api/admin/password -> MUST NOT overwrite primary admin's password or revoke primary admin's session
  const pwRes = await callApi('/api/admin/password', {
    method: 'POST',
    token: j2.token,
    body: { password: 'NewAdmin2Pass!99' }
  });
  assert.equal(pwRes.status, 200);
  const pwJson = await pwRes.json();
  assert.ok(pwJson.token);

  // Primary admin's existing session MUST still be valid and able to hit /api/admin/overview
  const ov1 = await callApi('/api/admin/overview', { token: j1.token });
  assert.equal(ov1.status, 200);
  const ovBody = await ov1.json();
  assert.equal(ovBody.ok, true);
  assert.ok(ovBody.stats.totalUsers >= 2);

  // Secondary admin's old password (ADMIN_PASSWORD) MUST NO LONGER bypass their updated D1 password_hash
  const oldPwLogin2 = await callApi('/api/auth/login', { method: 'POST', body: { email: admin2, password: 'InitAdminPassword!1' } });
  assert.equal(oldPwLogin2.status, 401);
  const newPwLogin2 = await callApi('/api/auth/login', { method: 'POST', body: { email: admin2, password: 'NewAdmin2Pass!99' } });
  assert.equal(newPwLogin2.status, 200);
  const freshTok2 = (await newPwLogin2.json()).token;

  // Privilege escalation protection: secondary admin cannot create an admin (403); primary creating regular user stays role:'user'
  const secEscalateRes = await callApi('/api/admin/users/add', {
    method: 'POST',
    token: freshTok2,
    body: { email: 'escalate@example.com', name: 'Blocked Admin', password: 'MemberPass!123', role: 'admin' }
  });
  assert.equal(secEscalateRes.status, 403);

  const addUserRes = await callApi('/api/admin/users/add', {
    method: 'POST',
    token: j1.token,
    body: { email: normalEmail, name: 'Regular Member', password: 'MemberPass!123', role: 'user' }
  });
  assert.equal(addUserRes.status, 200);
  const addUserJson = await addUserRes.json();
  assert.equal(addUserJson.user.role, 'user');

  const memberLogin = await (await callApi('/api/auth/login', { method: 'POST', body: { email: normalEmail, password: 'MemberPass!123' } })).json();
  assert.equal(memberLogin.user.isAdmin, false);
  const memberAdminHit = await callApi('/api/admin/users', { token: memberLogin.token });
  assert.equal(memberAdminHit.status, 403);

  // Live admin revocation: removing admin2 from ADMIN_EMAILS immediately blocks their active session/token from /api/admin/* -> 403!
  const revokedEnv = { ...env, ADMIN_EMAILS: admin1 };
  const afterRevokeHit = await callApi('/api/admin/overview', { token: freshTok2 }, revokedEnv);
  assert.equal(afterRevokeHit.status, 403);
  const afterRevokeMe = await (await callApi('/api/me', { token: freshTok2 }, revokedEnv)).json();
  assert.equal(afterRevokeMe.user.isAdmin, false);
  assert.equal(afterRevokeMe.user.role, 'user');

  // Verify /api/admin/overview and /api/admin/users succeed cleanly
  const usersRes = await callApi('/api/admin/users', { token: j1.token });
  assert.equal(usersRes.status, 200);
  const usersJson = await usersRes.json();
  assert.ok(usersJson.users.some((u) => u.email === admin1 && u.role === 'admin'));
  assert.ok(usersJson.users.some((u) => u.email === normalEmail && u.role === 'user'));

  // Verify cleanData preserves transfer transactions with buyPrice = 0
  stats.reads = 0;
  const txSave = await saveData(env, memberLogin.user.id, {
    holdings: [
      { id: 't1', assetId: 'usd', side: 'buy', qty: 100, buyPrice: 80000, wallet: 'اصلی', date: '1403/01/01', createdAt: 1 },
      { id: 't2', assetId: 'usd', side: 'transfer', qty: 40, buyPrice: 0, wallet: 'اصلی', toWallet: 'صندوق', date: '1403/01/02', createdAt: 2 }
    ],
    watch: ['usd'],
    featured: ['usd'],
    alerts: [],
    settings: { theme: 'light', unit: 'toman', privacy: false, filter: 'all' }
  });
  assert.equal(txSave.data.holdings.length, 2);
});

test('suspended user lookup, /api/auth/check-email, and /api/admin/users fail closed (503) on D1 error', async () => {
  __resetWorkerStateForTests();
  const brokenDB = {
    prepare() {
      return {
        bind() {
          return {
            async first() { throw new Error('d1_down'); },
            async all() { throw new Error('d1_down'); },
            async run() { throw new Error('d1_down'); }
          };
        },
        async first() { throw new Error('d1_down'); },
        async all() { throw new Error('d1_down'); }
      };
    },
    async batch() {
      throw new Error('d1_down');
    }
  };
  const secret = 'test-auth-secret-key-minimum-32-chars!!';
  const adminEmail = 'boss@example.com';
  const env = { DB: brokenDB, ADMIN_EMAIL: adminEmail, AUTH_SECRET: secret };

  // check-email must fail closed with 503 instead of returning { exists: false }
  const chkRes = await worker.fetch(
    new Request('https://darayi.example/api/auth/check-email', {
      method: 'POST',
      headers: { origin: 'https://darayi.example', 'content-type': 'application/json', 'x-requested-with': 'XMLHttpRequest' },
      body: JSON.stringify({ email: 'user@example.com' })
    }),
    env
  );
  assert.equal(chkRes.status, 503);

  // Malformed JSON in suspended_users KV row must fail closed with 503 on login
  const db = new DatabaseSync(':memory:');
  db.exec(fs.readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
  const passHash = await hashPassword('Pass12345!', { AUTH_SECRET: secret });
  db.prepare('INSERT INTO users(id,email,name,password_hash,created_at) VALUES(?,?,?,?,?)').run('u1', 'user@example.com', 'U', passHash, 1000);
  db.prepare("INSERT INTO kv(k,v,updated_at) VALUES('suspended_users','{corrupt_json',1000)").run();
  const { DB } = createSqliteD1Wrapper(db);
  const badSuspEnv = { DB, ADMIN_EMAIL: adminEmail, AUTH_SECRET: secret };
  const loginRes = await worker.fetch(
    new Request('https://darayi.example/api/auth/login', {
      method: 'POST',
      headers: { origin: 'https://darayi.example', 'content-type': 'application/json', 'x-requested-with': 'XMLHttpRequest' },
      body: JSON.stringify({ email: 'user@example.com', password: 'Pass12345!' })
    }),
    badSuspEnv
  );
  assert.equal(loginRes.status, 503);
});

test('EXPLAIN QUERY PLAN verifies new expiration cleanup indexes avoid full table scans', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(fs.readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));

  const explain = (sql) =>
    db
      .prepare(`EXPLAIN QUERY PLAN ${sql}`)
      .all()
      .map((r) => r.detail)
      .join(' | ');

  assert.match(explain('SELECT id_hash FROM sessions WHERE expires_at < ?'), /USING (?:COVERING )?INDEX idx_sessions_expires/);
  assert.doesNotMatch(explain('SELECT id_hash FROM sessions WHERE expires_at < ?'), /\bSCAN\b/);

  assert.match(explain('SELECT email FROM otp_codes WHERE expires_at < ?'), /USING (?:COVERING )?INDEX idx_otp_expires/);
  assert.doesNotMatch(explain('SELECT email FROM otp_codes WHERE expires_at < ?'), /\bSCAN\b/);

  assert.match(explain('SELECT state_hash FROM oauth_states WHERE expires_at < ?'), /USING (?:COVERING )?INDEX idx_oauth_expires/);
  assert.doesNotMatch(explain('SELECT state_hash FROM oauth_states WHERE expires_at < ?'), /\bSCAN\b/);

  assert.match(explain('SELECT k FROM rate_limits WHERE reset_at > 0 AND reset_at < ?'), /USING (?:COVERING )?INDEX idx_rate_limits_reset/);
  assert.doesNotMatch(explain('SELECT k FROM rate_limits WHERE reset_at > 0 AND reset_at < ?'), /\bSCAN\b/);

  assert.match(explain('SELECT user_id FROM admin_roles WHERE email = ?'), /USING (?:COVERING )?INDEX idx_admin_roles_email/);
  assert.doesNotMatch(explain('SELECT user_id FROM admin_roles WHERE email = ?'), /\bSCAN\b/);
});

test('DB-backed secondary admin lifecycle: promotion, RBAC limits, live revocation, suspension, and personal data preservation', async () => {
  __resetWorkerStateForTests();
  const db = new DatabaseSync(':memory:');
  db.exec(fs.readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
  const { DB } = createSqliteD1Wrapper(db);

  const secret = 'test-auth-secret-key-minimum-32-chars!!';
  const primaryEmail = 'owner@example.com';
  const secEmail = 'helper@example.com';
  const sec2Email = 'helper2@example.com';
  const env = {
    DB,
    ADMIN_EMAIL: primaryEmail,
    ADMIN_PASSWORD: 'OwnerMasterPassword!1',
    AUTH_SECRET: secret
  };

  const callApi = (path, { method = 'GET', body, token } = {}, customEnv = env) =>
    worker.fetch(
      new Request(`https://darayi.example${path}`, {
        method,
        headers: {
          origin: 'https://darayi.example',
          ...(body ? { 'content-type': 'application/json' } : {}),
          'x-requested-with': 'XMLHttpRequest',
          ...(token ? { authorization: `Bearer ${token}` } : {})
        },
        ...(body ? { body: JSON.stringify(body) } : {})
      }),
      customEnv
    );

  // 1. Primary Admin logs in and gets isPrimaryAdmin: true
  const pLogin = await (await callApi('/api/auth/login', { method: 'POST', body: { email: primaryEmail, password: 'OwnerMasterPassword!1' } })).json();
  assert.equal(pLogin.user.isAdmin, true);
  assert.equal(pLogin.user.isPrimaryAdmin, true);
  assert.equal(pLogin.user.adminTier, 'primary');

  // 2. Primary creates a normal user and a DB-backed secondary admin
  const createNormal = await callApi('/api/admin/users/add', {
    method: 'POST',
    token: pLogin.token,
    body: { email: secEmail, name: 'Helper User', password: 'HelperPass!123', role: 'user' }
  });
  assert.equal(createNormal.status, 200);
  const helperId = (await createNormal.json()).user.id;

  const createSec2 = await callApi('/api/admin/users/add', {
    method: 'POST',
    token: pLogin.token,
    body: { email: sec2Email, name: 'Second Helper', password: 'Helper2Pass!123', role: 'admin' }
  });
  assert.equal(createSec2.status, 200);
  const sec2Json = await createSec2.json();
  assert.equal(sec2Json.user.role, 'admin');
  assert.equal(sec2Json.user.adminTier, 'secondary');
  assert.equal(sec2Json.user.isPrimaryAdmin, false);

  // 3. Helper saves personal user_data + alert before promotion
  const helperLogin = await (await callApi('/api/auth/login', { method: 'POST', body: { email: secEmail, password: 'HelperPass!123' } })).json();
  assert.equal(helperLogin.user.isAdmin, false);
  const saveHelperData = await callApi('/api/me/data', {
    method: 'PUT',
    token: helperLogin.token,
    body: {
      holdings: [{ id: 'h1', assetId: 'usd', side: 'buy', qty: 50, buyPrice: 80000, wallet: 'اصلی', date: '1403/01/01', createdAt: 1 }],
      watch: ['usd', 'btc'],
      featured: ['usd'],
      alerts: [{ id: 'al_h1', assetId: 'usd', direction: 'above', price: 95000, currency: 'IRT' }],
      settings: { theme: 'light', unit: 'toman', privacy: false, filter: 'all' }
    }
  });
  assert.equal(saveHelperData.status, 200);

  // Regular user cannot promote anyone (403)
  const nonAdminPromote = await callApi(`/api/admin/users/${helperId}/role`, {
    method: 'POST',
    token: helperLogin.token,
    body: { role: 'admin' }
  });
  assert.equal(nonAdminPromote.status, 403);

  // 4. Primary promotes existing helper user to Secondary Admin without touching env vars
  const promoteRes = await callApi(`/api/admin/users/${helperId}/role`, {
    method: 'POST',
    token: pLogin.token,
    body: { role: 'admin' }
  });
  assert.equal(promoteRes.status, 200);
  const promoteJson = await promoteRes.json();
  assert.equal(promoteJson.user.role, 'admin');
  assert.equal(promoteJson.user.adminTier, 'secondary');

  // Helper's existing active token IMMEDIATELY reflects secondary admin role on /api/me and /api/admin/*
  const helperMeAfterPromote = await (await callApi('/api/me', { token: helperLogin.token })).json();
  assert.equal(helperMeAfterPromote.user.isAdmin, true);
  assert.equal(helperMeAfterPromote.user.isPrimaryAdmin, false);
  assert.equal(helperMeAfterPromote.user.adminTier, 'secondary');
  assert.equal((await callApi('/api/admin/overview', { token: helperLogin.token })).status, 200);

  // Secondary admin CANNOT login with Primary's ADMIN_PASSWORD
  const masterPwBypass = await callApi('/api/auth/login', {
    method: 'POST',
    body: { email: secEmail, password: 'OwnerMasterPassword!1' }
  });
  assert.equal(masterPwBypass.status, 401);

  // 5. Secondary admin RBAC protections: cannot promote/demote, cannot create admin, cannot suspend Primary or another secondary admin, cannot delete Primary account
  assert.equal((await callApi(`/api/admin/users/${sec2Json.user.id}/role`, { method: 'POST', token: helperLogin.token, body: { role: 'user' } })).status, 403);
  assert.equal((await callApi('/api/admin/users/add', { method: 'POST', token: helperLogin.token, body: { email: 'sneaky@example.com', name: 'Sneaky', password: 'Password!123', role: 'admin' } })).status, 403);
  assert.equal((await callApi(`/api/admin/users/${pLogin.user.id}/toggle`, { method: 'POST', token: helperLogin.token })).status, 400);
  assert.equal((await callApi(`/api/admin/users/${sec2Json.user.id}/toggle`, { method: 'POST', token: helperLogin.token })).status, 403);
  assert.equal((await callApi(`/api/admin/users/${pLogin.user.id}/role`, { method: 'POST', token: pLogin.token, body: { role: 'user' } })).status, 400);
  assert.equal((await callApi('/api/me', { method: 'DELETE', token: pLogin.token })).status, 403);

  // 6. Primary demotes Helper back to user -> active session IMMEDIATELY loses admin access & preserves personal data/alerts!
  const demoteRes = await callApi(`/api/admin/users/${helperId}/role`, {
    method: 'POST',
    token: pLogin.token,
    body: { role: 'user' }
  });
  assert.equal(demoteRes.status, 200);
  assert.equal((await callApi('/api/admin/overview', { token: helperLogin.token })).status, 403);
  const helperMeAfterDemote = await (await callApi('/api/me', { token: helperLogin.token })).json();
  assert.equal(helperMeAfterDemote.user.isAdmin, false);
  assert.equal(helperMeAfterDemote.user.role, 'user');

  const helperPersonalAfterDemote = await (await callApi('/api/me/data?fresh=1', { token: helperLogin.token })).json();
  assert.equal(helperPersonalAfterDemote.exists, true);
  assert.equal(helperPersonalAfterDemote.data.holdings.length, 1);
  assert.equal(helperPersonalAfterDemote.data.alerts.length, 1);

  // 7. Primary suspends sec2, verifies session rejected, unsuspends, and verifies sec2 keeps admin/user role & personal data intact
  await callApi('/api/me/data', {
    method: 'PUT',
    token: (await (await callApi('/api/auth/login', { method: 'POST', body: { email: sec2Email, password: 'Helper2Pass!123' } })).json()).token,
    body: { holdings: [{ id: 's2h', assetId: 'btc', side: 'buy', qty: 1, buyPrice: 90000, wallet: 'اصلی', date: '1403/01/01', createdAt: 1 }], watch: ['btc'], featured: ['btc'], alerts: [], settings: { theme: 'light', unit: 'toman', privacy: false, filter: 'all' } }
  });
  assert.equal((await callApi(`/api/admin/users/${sec2Json.user.id}/toggle`, { method: 'POST', token: pLogin.token })).status, 200);
  const sec2SuspendedLogin = await callApi('/api/auth/login', { method: 'POST', body: { email: sec2Email, password: 'Helper2Pass!123' } });
  assert.equal(sec2SuspendedLogin.status, 403);
  // Unsuspend
  assert.equal((await callApi(`/api/admin/users/${sec2Json.user.id}/toggle`, { method: 'POST', token: pLogin.token })).status, 200);
  const sec2BackLogin = await (await callApi('/api/auth/login', { method: 'POST', body: { email: sec2Email, password: 'Helper2Pass!123' } })).json();
  const sec2Data = await (await callApi('/api/me/data?fresh=1', { token: sec2BackLogin.token })).json();
  assert.equal(sec2Data.exists, true);
  assert.equal(sec2Data.data.holdings.length, 1);
});

test('fail-closed auth when DB binding is missing even with warm sessionUserCache', async () => {
  __resetWorkerStateForTests();
  const db = new DatabaseSync(':memory:');
  db.exec(fs.readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
  const { DB } = createSqliteD1Wrapper(db);
  const env = { DB, AUTH_SECRET: 'test-auth-secret-key-minimum-32-chars!!' };
  const passHash = await hashPassword('FailClosed!123', env);
  db.prepare('INSERT INTO users(id,email,name,password_hash,created_at) VALUES(?,?,?,?,?)').run('u_fc', 'fc@example.com', 'FC', passHash, 1000);

  const loginRes = await worker.fetch(
    new Request('https://darayi.example/api/auth/login', {
      method: 'POST',
      headers: { origin: 'https://darayi.example', 'content-type': 'application/json', 'x-requested-with': 'XMLHttpRequest' },
      body: JSON.stringify({ email: 'fc@example.com', password: 'FailClosed!123' })
    }),
    env
  );
  const token = (await loginRes.json()).token;
  assert.ok(token);

  // Even with warm sessionUserCache on same isolate, missing env.DB MUST fail closed (401 on /api/me/data, null on /api/me)
  const noDbData = await worker.fetch(
    new Request('https://darayi.example/api/me/data', { headers: { authorization: `Bearer ${token}` } }),
    { AUTH_SECRET: env.AUTH_SECRET }
  );
  assert.equal(noDbData.status, 401);

  const noDbMe = await (
    await worker.fetch(
      new Request('https://darayi.example/api/me', { headers: { authorization: `Bearer ${token}` } }),
      { AUTH_SECRET: env.AUTH_SECRET }
    )
  ).json();
  assert.equal(noDbMe.user, null);
});

test('migrations/002_admin_roles.sql is idempotent and 003_legacy_columns.sql + checkAlerts/refreshMeta handle legacy pre-migration schemas cleanly', async () => {
  __resetWorkerStateForTests();
  const db = new DatabaseSync(':memory:');
  db.exec(fs.readFileSync(new URL('./migrations/001_fix.sql', import.meta.url), 'utf8'));
  const mig002 = fs.readFileSync(new URL('./migrations/002_admin_roles.sql', import.meta.url), 'utf8');
  assert.doesNotThrow(() => db.exec(mig002));
  assert.doesNotThrow(() => db.exec(mig002)); // Idempotent repeat execution

  // Legacy DB missing newer columns in rate_limits, sessions, alert_delivery, alert_state, alert_units
  const legacyDb = new DatabaseSync(':memory:');
  const now = Math.floor(Date.now() / 1000);
  legacyDb.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL DEFAULT '', password_hash TEXT, google_sub TEXT UNIQUE, created_at INTEGER NOT NULL);
    CREATE TABLE sessions (id_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at INTEGER NOT NULL);
    CREATE TABLE otp_codes (email TEXT NOT NULL, purpose TEXT NOT NULL, code_hash TEXT NOT NULL, expires_at INTEGER NOT NULL, PRIMARY KEY(email, purpose));
    CREATE TABLE oauth_states (state_hash TEXT PRIMARY KEY, verifier TEXT NOT NULL, expires_at INTEGER NOT NULL);
    CREATE TABLE rate_limits (k TEXT PRIMARY KEY, n INTEGER NOT NULL DEFAULT 0, win INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE kv (k TEXT PRIMARY KEY, v TEXT NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TABLE user_data (user_id TEXT PRIMARY KEY, holdings TEXT NOT NULL DEFAULT '[]', watch TEXT NOT NULL DEFAULT '[]', featured TEXT NOT NULL DEFAULT '[]', settings TEXT NOT NULL DEFAULT '{}', updated_at INTEGER NOT NULL);
    CREATE TABLE alerts (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, asset_id TEXT NOT NULL, direction TEXT NOT NULL, price REAL NOT NULL, triggered_at INTEGER, attempts INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
    CREATE TABLE alert_units (alert_id TEXT PRIMARY KEY);
    CREATE TABLE alert_state (alert_id TEXT PRIMARY KEY);
    CREATE TABLE alert_delivery (alert_id TEXT PRIMARY KEY);
    CREATE TABLE price_history_v2 (asset_id TEXT NOT NULL, t INTEGER NOT NULL, price REAL NOT NULL, PRIMARY KEY (asset_id, t));
  `);

  // Run 003_legacy_columns.sql to upgrade old columns without losing rows
  legacyDb.prepare('INSERT INTO users(id,email,name,created_at) VALUES(?,?,?,?)').run('u_leg', 'leg@example.com', 'Legacy', now);
  legacyDb.prepare('INSERT INTO rate_limits(k,n,win) VALUES(?,?,?)').run('old_k', 3, now - 100);
  const mig003 = fs.readFileSync(new URL('./migrations/003_legacy_columns.sql', import.meta.url), 'utf8');
  assert.doesNotThrow(() => legacyDb.exec(mig003));
  assert.equal(legacyDb.prepare("SELECT n FROM rate_limits WHERE k='old_k'").get().n, 3);

  // Also test runtime self-heal in checkAlerts & refreshMeta on an unmigrated legacy DB
  __resetWorkerStateForTests();
  const unmigratedDb = new DatabaseSync(':memory:');
  unmigratedDb.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL);
    CREATE TABLE sessions (id_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at INTEGER NOT NULL);
    CREATE TABLE otp_codes (email TEXT NOT NULL, purpose TEXT NOT NULL, code_hash TEXT NOT NULL, expires_at INTEGER NOT NULL, PRIMARY KEY(email, purpose));
    CREATE TABLE oauth_states (state_hash TEXT PRIMARY KEY, verifier TEXT NOT NULL, expires_at INTEGER NOT NULL);
    CREATE TABLE rate_limits (k TEXT PRIMARY KEY, n INTEGER NOT NULL DEFAULT 0, win INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE kv (k TEXT PRIMARY KEY, v TEXT NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TABLE user_data (user_id TEXT PRIMARY KEY, holdings TEXT NOT NULL DEFAULT '[]', watch TEXT NOT NULL DEFAULT '[]', featured TEXT NOT NULL DEFAULT '[]', settings TEXT NOT NULL DEFAULT '{}', updated_at INTEGER NOT NULL);
    CREATE TABLE alerts (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, asset_id TEXT NOT NULL, direction TEXT NOT NULL, price REAL NOT NULL, triggered_at INTEGER, attempts INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
    CREATE TABLE price_history_v2 (asset_id TEXT NOT NULL, t INTEGER NOT NULL, price REAL NOT NULL, PRIMARY KEY (asset_id, t));
  `);
  unmigratedDb.prepare('INSERT INTO users(id,email,name,created_at) VALUES(?,?,?,?)').run('u_unmig', 'unmig@example.com', 'Unmig', now);
  unmigratedDb.prepare("INSERT INTO alerts(id,user_id,asset_id,direction,price,created_at) VALUES('u_unmig:al1','u_unmig','usd','above',80000,?)").run(now);
  const { DB } = createSqliteD1Wrapper(unmigratedDb);

  const sentCount = await checkAlerts({ DB }, { usd: { price: 85000, unit: 'IRT', kind: 'domestic', t: now, receivedAt: now, sourceTimestamp: now } });
  assert.equal(sentCount, 1);
  await refreshMeta({ DB, PRICE_HISTORY_DAYS: 7 });
  const cols = unmigratedDb.prepare('PRAGMA table_info(rate_limits)').all().map((c) => c.name);
  assert.ok(cols.includes('reset_at'));
});


