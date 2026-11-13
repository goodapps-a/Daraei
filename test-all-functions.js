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
  normCode
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


