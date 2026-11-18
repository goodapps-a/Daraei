import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { DatabaseSync } from 'node:sqlite';
import {
  cleanData,
  validateTransactions,
  isSafePublicUrl,
  hashPassword,
  verifyPassword,
  parsePbkdf2Hash,
  iterOf,
  PBKDF2_DEFAULT,
  normCode,
  getAdminEmails,
  getPrimaryAdminEmail,
  isEmailAdmin,
  getConfiguredAdminPassword,
  getAdminSecret,
  extractInlineScriptBodies,
  buildHtmlCsp,
  PROD_CSP,
  sha256Hex,
  hmacHex,
  createMemoryRateLimiter
} from './src/modules/security.js';
import crypto from 'node:crypto';
import {
  D1_HISTORY_ASSET_IDS,
  KV_SNAPSHOT_KEY,
  CHART_RANGES,
  getStaleThresholdSec,
  isPriceItemStale,
  parseBonbastPayload,
  preservePricePrecision,
  normalizeCandleOpenTimeSec,
  parseBinanceKlineEntry,
  filterPointsStrictlyInRange,
  computeRangeChangePct,
  buildHistoryMetadata,
  resolveCryptoIconByAssetId
} from './src/modules/market-core.js';
import worker, {
  PriceCoordinator,
  getPriceFreshnessS,
  loadData,
  saveData,
  transferUserAssetsSafely,
  runCron,
  rateLimit,
  writePricesKvSnapshot,
  getPrices,
  refreshPrices,
  recordD1DomesticHistory,
  checkAlerts,
  refreshMeta,
  ensureDatabaseMigrations,
  getDatabaseMigrationStatus,
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
  assert.equal(PBKDF2_DEFAULT, 25000);
  assert.equal(iterOf({}), 25000);
  assert.equal(iterOf({ PBKDF2_ITER: '500' }), 1000);
  assert.equal(iterOf({ PBKDF2_ITER: '250000' }), 100000);
  assert.equal(iterOf({ PBKDF2_ITER: '15000' }), 15000);

  const legacyEnv = { PBKDF2_ITER: '10000' };
  const hashLegacy = await hashPassword('MyStrongPass!99', legacyEnv);
  const parsed = parsePbkdf2Hash(hashLegacy);
  assert.ok(parsed);
  assert.equal(parsed.iter, 10000);

  // Legacy 10k hash still verifies cleanly under the 25k default and is flagged for lazy re-hash on login
  assert.equal(await verifyPassword('MyStrongPass!99', hashLegacy, {}), true);
  assert.equal(await verifyPassword('WrongPass!99', hashLegacy, {}), false);
  assert.equal(parsed.iter < iterOf({}), true);
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

test('primary admin email secret parser resolves only the single primary admin from ADMIN_EMAIL or ADMIN_SECRET', () => {
  const env1 = { ADMIN_EMAIL: ' Primary@Example.com ' };
  assert.equal(getPrimaryAdminEmail(env1), 'primary@example.com');
  assert.deepEqual(getAdminEmails(env1), ['primary@example.com']);
  assert.equal(isEmailAdmin(env1, ' PRIMARY@EXAMPLE.COM '), true);
  assert.equal(isEmailAdmin(env1, 'second@example.com'), false);

  // If primary admin email is provided via ADMIN_SECRET, it resolves as the primary admin email
  const envSecretEmail = { ADMIN_SECRET: 'OwnerSecretEmail@Example.com' };
  assert.equal(getPrimaryAdminEmail(envSecretEmail), 'ownersecretemail@example.com');
  assert.deepEqual(getAdminEmails(envSecretEmail), ['ownersecretemail@example.com']);
  assert.equal(isEmailAdmin(envSecretEmail, 'ownersecretemail@example.com'), true);

  // Even if legacy ADMIN_EMAILS has multiple emails, only the first/primary admin comes from env; secondary admins are strictly DB-managed in the dashboard
  const env2 = { ADMIN_EMAIL: 'Primary@Example.com', ADMIN_EMAILS: 'Secondary@Example.com, primary@example.com' };
  assert.equal(getPrimaryAdminEmail(env2), 'primary@example.com');
  assert.deepEqual(getAdminEmails(env2), ['primary@example.com']);
  assert.equal(isEmailAdmin(env2, 'primary@example.com'), true);
  assert.equal(isEmailAdmin(env2, 'secondary@example.com'), false);
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

  // Primary admin logs in using configured ADMIN_EMAIL + ADMIN_PASSWORD
  const r1 = await callApi('/api/auth/login', { method: 'POST', body: { email: admin1, password: 'InitAdminPassword!1' } });
  const j1 = await r1.json();
  assert.equal(r1.status, 200);
  assert.equal(j1.user.isAdmin, true);
  assert.equal(j1.user.isPrimaryAdmin, true);

  // Primary admin selects/adds admin2 from the dashboard (no secret needed for secondary admin)
  const addAdm2Res = await callApi('/api/admin/users/add', {
    method: 'POST',
    token: j1.token,
    body: { email: admin2, name: 'Second Boss', password: 'InitAdmin2Password!1', role: 'admin' }
  });
  assert.equal(addAdm2Res.status, 200);
  const adm2Created = (await addAdm2Res.json()).user;
  assert.equal(adm2Created.role, 'admin');
  assert.equal(adm2Created.envPinned, false);

  const r2 = await callApi('/api/auth/login', { method: 'POST', body: { email: admin2, password: 'InitAdmin2Password!1' } });
  const j2 = await r2.json();
  assert.equal(r2.status, 200);
  assert.equal(j2.user.isAdmin, true);
  assert.equal(j2.user.isPrimaryAdmin, false);
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

  // Secondary admin's old password MUST NO LONGER work
  const oldPwLogin2 = await callApi('/api/auth/login', { method: 'POST', body: { email: admin2, password: 'InitAdmin2Password!1' } });
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

  // Live admin revocation from dashboard: primary admin revokes admin2 via /api/admin/users/:id/role -> immediately blocks active session from /api/admin/* -> 403!
  const revokeRes = await callApi(`/api/admin/users/${adm2Created.id}/role`, {
    method: 'POST',
    token: j1.token,
    body: { role: 'user' }
  });
  assert.equal(revokeRes.status, 200);
  const afterRevokeHit = await callApi('/api/admin/overview', { token: freshTok2 });
  assert.equal(afterRevokeHit.status, 403);
  const afterRevokeMe = await (await callApi('/api/me', { token: freshTok2 })).json();
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

test('src/index.html has 6 inline scripts covered by hash-based CSP, narrow connect-src, single escapeHtml, and zero inline event handlers', () => {
  const html = fs.readFileSync(new URL('./src/index.html', import.meta.url), 'utf8');
  const bodies = extractInlineScriptBodies(html);
  assert.equal(bodies.length, 6, `Expected 6 inline <script> blocks in src/index.html, got ${bodies.length}`);

  const hashes = bodies.map((b) => `sha256-${crypto.createHash('sha256').update(b, 'utf8').digest('base64')}`);
  const csp = buildHtmlCsp(false, hashes);

  const scriptSrcMatch = /script-src\s+([^;]+)/.exec(csp);
  assert.ok(scriptSrcMatch);
  assert.doesNotMatch(scriptSrcMatch[1], /'unsafe-inline'/);
  for (const h of hashes) {
    assert.ok(scriptSrcMatch[1].includes(`'${h}'`), `Missing hash ${h} in script-src`);
  }

  const connectSrcMatch = /connect-src\s+([^;]+)/.exec(csp);
  assert.ok(connectSrcMatch);
  assert.equal(connectSrcMatch[1].trim(), "'self'");
  assert.match(PROD_CSP, /connect-src\s+'self';/);
  assert.equal(/new\s+WebSocket\s*\(/.test(html), false, 'src/index.html must not open direct browser WebSockets');
  assert.equal(/stream\.binance\.com|data-stream\.binance\.vision/.test(html), false, 'src/index.html must not reference Binance WebSocket endpoints');

  // Exactly one escapeHtml definition (using ??'')
  const escapeMatches = html.match(/function\s+escapeHtml\s*\(/g) || [];
  assert.equal(escapeMatches.length, 1);
  assert.match(html, /function\s+escapeHtml\s*\(\s*s\s*\)\s*\{\s*return\s+String\s*\(\s*s\s*\?\?\s*''\s*\)/);

  // Zero inline onerror= / onsubmit= attributes in HTML/template strings
  assert.equal(/\bon(?:error|submit)\s*=\s*["']/.test(html), false);
});

test('shared security helpers: sha256Hex, hmacHex, createMemoryRateLimiter, getConfiguredAdminPassword', async () => {
  const h = await sha256Hex('darayi');
  assert.equal(h.length, 64);
  assert.equal(h, crypto.createHash('sha256').update('darayi').digest('hex'));

  const mac = await hmacHex('secret-key', 'payload');
  assert.equal(mac.length, 64);
  assert.equal(mac, crypto.createHmac('sha256', 'secret-key').update('payload').digest('hex'));

  const rl = createMemoryRateLimiter(10);
  const now = 1700000000;
  assert.equal(rl.check('k1', 2, 60, now).allowed, true);
  assert.equal(rl.check('k1', 2, 60, now + 1).allowed, true);
  assert.equal(rl.check('k1', 2, 60, now + 2).allowed, false);
  assert.equal(rl.check('k1', 2, 60, now + 61).allowed, true);

  assert.equal(getConfiguredAdminPassword({ ADMIN_EMAIL: 'admin@example.com', ADMIN_PASSWORD: 'StrongAdminPassword!' }), 'StrongAdminPassword!');
  assert.equal(getConfiguredAdminPassword({ ADMIN_EMAIL: 'admin@example.com', ADMIN_PASSWORD: 'admin@example.com' }), null);

  assert.equal(getAdminSecret({ ADMIN_SECRET: 'RootSecret!2025' }), 'RootSecret!2025');
  assert.equal(getAdminSecret({ ADMIN_PASSWORD: 'LegacySecret!2025' }), 'LegacySecret!2025');
  assert.equal(getAdminSecret({ ADMIN_SECRET: 'short' }), null);
  assert.equal(getAdminSecret({ ADMIN_EMAIL: 'root@example.com', ADMIN_SECRET: 'root@example.com' }), null);
});

test('first admin is claimed with ADMIN_SECRET while subsequent admins are managed in panel without secrets', async () => {
  __resetWorkerStateForTests();
  const db = new DatabaseSync(':memory:');
  db.exec(fs.readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
  const { DB } = createSqliteD1Wrapper(db);

  const env = {
    DB,
    AUTH_SECRET: 'test-auth-secret-key-minimum-32-chars!!',
    ADMIN_SECRET: 'InitialRootSecret#2025'
  };

  const get = (url, bearer) =>
    worker.fetch(
      new Request(url, {
        method: 'GET',
        headers: bearer ? { authorization: `Bearer ${bearer}` } : {}
      }),
      env
    );
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

  // Before claim: canClaimPrimaryAdmin is true
  const cfgBefore = await (await get('https://darayi.example/api/auth/config')).json();
  assert.equal(cfgBefore.canClaimPrimaryAdmin, true);

  // Wrong secret is rejected with 401
  const badClaim = await post('https://darayi.example/api/auth/claim-admin', {
    email: 'owner@example.com',
    name: 'مدیر اول',
    secret: 'wrong-secret',
    password: 'OwnerPass!123'
  });
  assert.equal(badClaim.status, 401);

  // Valid claim succeeds and promotes first admin
  const okClaim = await post('https://darayi.example/api/auth/claim-admin', {
    email: 'owner@example.com',
    name: 'مدیر اول',
    secret: 'InitialRootSecret#2025',
    password: 'OwnerPass!123'
  });
  assert.equal(okClaim.status, 200);
  const claimBody = await okClaim.json();
  assert.equal(claimBody.user.isAdmin, true);
  assert.equal(claimBody.user.isPrimaryAdmin, true);
  assert.ok(claimBody.token);

  // Config now locks claim endpoint
  const cfgAfter = await (await get('https://darayi.example/api/auth/config')).json();
  assert.equal(cfgAfter.canClaimPrimaryAdmin, false);

  // Second claim attempt fails closed with 409 even with valid secret
  const secondClaim = await post('https://darayi.example/api/auth/claim-admin', {
    email: 'attacker@example.com',
    secret: 'InitialRootSecret#2025',
    password: 'AttackPass!123'
  });
  assert.equal(secondClaim.status, 409);

  // Primary admin creates a secondary admin directly in the panel (no secret needed)
  const addSecRes = await post('https://darayi.example/api/admin/users/add', {
    email: 'co-admin@example.com',
    name: 'ادمین دوم',
    password: 'SecondAdminPass!1',
    role: 'admin'
  }, claimBody.token);
  assert.equal(addSecRes.status, 200);
  const addSecBody = await addSecRes.json();
  assert.equal(addSecBody.user.role, 'admin');
  assert.equal(addSecBody.user.isPrimaryAdmin, false);

  // Secondary admin cannot log in with ADMIN_SECRET; must use personal password
  const secBadLogin = await post('https://darayi.example/api/auth/login', {
    email: 'co-admin@example.com',
    password: 'InitialRootSecret#2025'
  });
  assert.equal(secBadLogin.status, 401);

  const secOkLogin = await post('https://darayi.example/api/auth/login', {
    email: 'co-admin@example.com',
    password: 'SecondAdminPass!1'
  });
  assert.equal(secOkLogin.status, 200);
  const secLoginBody = await secOkLogin.json();
  assert.equal(secLoginBody.user.isAdmin, true);
  assert.equal(secLoginBody.user.isPrimaryAdmin, false);

  // Primary admin creates a normal user and promotes them via /role without any secret
  const addUserRes = await post('https://darayi.example/api/admin/users/add', {
    email: 'member2@example.com',
    name: 'کاربر عادی',
    password: 'MemberPass!123',
    role: 'user'
  }, claimBody.token);
  assert.equal(addUserRes.status, 200);
  const memberId = (await addUserRes.json()).user.id;

  const promoteRes = await post(`https://darayi.example/api/admin/users/${memberId}/role`, { role: 'admin' }, claimBody.token);
  assert.equal(promoteRes.status, 200);
  assert.equal((await promoteRes.json()).user.role, 'admin');
});

test('parseBonbastPayload & refreshPrices enforce NerkhAra -> Bonbast -> IranMarket domestic API priority', async () => {
  __resetWorkerStateForTests();
  const nowSec = Math.floor(Date.now() / 1000);

  // parseBonbastPayload validates reset, staleness, comma formatting, and iqd1 (/100)
  assert.deepEqual(parseBonbastPayload({ reset: 1, usd1: '85000' }, nowSec).dict, {});
  assert.deepEqual(parseBonbastPayload({ usd1: '85000', last_modified: '2020-01-01 00:00:00' }, nowSec).dict, {});

  const parsedBb = parseBonbastPayload({
    usd1: '85,200',
    eur1: '92,100',
    gbp1: '108,500',
    iqd1: '6,525',
    emami1: '68,000,000',
    gol18: '5,900,000',
    last_modified: new Date((nowSec - 60) * 1000).toISOString().replace('T', ' ').slice(0, 19)
  }, nowSec);
  assert.equal(parsedBb.dict.usd.price, 85200);
  assert.equal(parsedBb.dict.eur.price, 92100);
  assert.equal(parsedBb.dict.iqd.price, 65.25);
  assert.equal(parsedBb.dict.gold18.price, 5900000);
  assert.equal(parsedBb.dict.coin.price, 68000000);

  // refreshPrices priority: NerkhAra (1st) -> Bonbast (2nd) -> IranMarket (3rd)
  const origFetch = globalThis.fetch;
  const isoNow = new Date(nowSec * 1000).toISOString();
  const bbLastMod = isoNow.replace('T', ' ').slice(0, 19);

  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input?.url || '';
    if (url === 'https://nerkhara.com/api/v1/latest.json') {
      // NerkhAra provides usd/eur/gold18, omits gbp so Bonbast should provide gbp before IranMarket
      return new Response(JSON.stringify({
        stale: false,
        generated_utc: isoNow,
        items: [
          { id: 'usd', price: 85100, unit: 'IRT', updated_utc: isoNow },
          { id: 'eur', price: 92000, unit: 'IRT', updated_utc: isoNow },
          { id: 'gold18', price: 5910000, unit: 'IRT', updated_utc: isoNow }
        ]
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url === 'https://www.bonbast.com/') {
      return new Response('<script>var param = "test_param_token_123";</script>', {
        status: 200,
        headers: { 'content-type': 'text/html', 'set-cookie': 'sessionid=bb_sess_1; Path=/' }
      });
    }
    if (url === 'https://www.bonbast.com/json') {
      return new Response(JSON.stringify({
        usd1: '86000',
        eur1: '93000',
        gbp1: '108900',
        sekkeh1: '68500000',
        emami1: '69500000',
        last_modified: bbLastMod
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url === 'https://iran-market.github.io/data/latest-toman.json') {
      return new Response(JSON.stringify({
        data: {
          generated_at: isoNow,
          categories: {
            currency: [
              { symbol: 'GBP_IRR_FREE', price: 105000, timestamp: isoNow },
              { symbol: 'CHF_IRR_FREE', price: 96500, timestamp: isoNow }
            ]
          }
        }
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({}), { status: 404 });
  };

  try {
    const res = await refreshPrices({}, true, true);
    assert.equal(res.items.usd.src, 'nerkhara');
    assert.equal(res.items.usd.price, 85100);
    assert.equal(res.items.eur.src, 'nerkhara');
    // GBP was omitted by NerkhAra, so Bonbast wins over IranMarket
    assert.equal(res.items.gbp.src, 'bonbast');
    assert.equal(res.items.gbp.price, 108900);
    // CHF was omitted by both NerkhAra and Bonbast, so IranMarket provides it
    assert.equal(res.items.chf.src, 'iran_market');
    assert.equal(res.items.chf.price, 96500);
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('CoinSplash v3 supports white background in light mode and black background in dark mode', () => {
  const splashJs = fs.readFileSync(new URL('./public/coin-splash.js', import.meta.url), 'utf8');
  const html = fs.readFileSync(new URL('./src/index.html', import.meta.url), 'utf8');

  for (const source of [splashJs, html]) {
    assert.ok(source.includes("dark?'#000':'#fff'") || (source.includes('#000') && source.includes('#fff')), 'Dark mode black (#000) and light mode white (#fff) backgrounds should be present');
    assert.ok(source.includes('gl_FragColor=vec4(uCl,uA*exp(-2.6*dot(d,d)))'), 'Gold halo shader FH should be present');
  }
  assert.ok(html.includes("mode: document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'"));
});

test('004_schema_reconcile.sql, ensureDatabaseMigrations, and getDatabaseMigrationStatus are idempotent, non-destructive, and preserve all legacy data', async () => {
  __resetWorkerStateForTests();
  const migFiles = [
    './migrations/001_fix.sql',
    './migrations/002_admin_roles.sql',
    './migrations/003_legacy_columns.sql',
    './migrations/004_schema_reconcile.sql'
  ];

  // 1. Verify no migration file contains destructive statements (DROP TABLE, DROP COLUMN, TRUNCATE, DELETE FROM)
  for (const relPath of migFiles) {
    const rawSql = fs.readFileSync(new URL(relPath, import.meta.url), 'utf8');
    const codeOnly = rawSql
      .split(/\r?\n/)
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n');
    assert.equal(/\b(?:DROP\s+TABLE|DROP\s+COLUMN|TRUNCATE|DELETE\s+FROM)\b/i.test(codeOnly), false, `Destructive SQL found in ${relPath}`);
  }

  // 2. Verify 004_schema_reconcile.sql is idempotent when executed multiple times on an empty DB
  const emptyDb = new DatabaseSync(':memory:');
  const mig004 = fs.readFileSync(new URL('./migrations/004_schema_reconcile.sql', import.meta.url), 'utf8');
  assert.doesNotThrow(() => emptyDb.exec(mig004));
  assert.doesNotThrow(() => emptyDb.exec(mig004));
  assert.doesNotThrow(() => emptyDb.exec(mig004));
  const trackedInEmpty = emptyDb.prepare('SELECT version, status FROM schema_migrations ORDER BY version').all();
  assert.ok(trackedInEmpty.some((r) => r.version === '004_schema_reconcile' && r.status === 'applied'));

  // 3. Verify legacy DB with pre-existing users, holdings, alerts, price_history, price_history_v2, kv, and legacy rate_limits(k, n, win)
  // is upgraded conditionally by ensureDatabaseMigrations without duplicate column errors or data loss
  const legacyDb = new DatabaseSync(':memory:');
  const now = Math.floor(Date.now() / 1000);
  legacyDb.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL);
    CREATE TABLE sessions (id_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at INTEGER NOT NULL);
    CREATE TABLE otp_codes (email TEXT NOT NULL, purpose TEXT NOT NULL, code_hash TEXT NOT NULL, expires_at INTEGER NOT NULL, PRIMARY KEY(email, purpose));
    CREATE TABLE oauth_states (state_hash TEXT PRIMARY KEY, verifier TEXT NOT NULL, expires_at INTEGER NOT NULL);
    CREATE TABLE rate_limits (k TEXT PRIMARY KEY, n INTEGER NOT NULL, win INTEGER NOT NULL);
    CREATE TABLE kv (k TEXT PRIMARY KEY, v TEXT NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TABLE user_data (user_id TEXT PRIMARY KEY, holdings TEXT NOT NULL DEFAULT '[]', watch TEXT NOT NULL DEFAULT '[]', featured TEXT NOT NULL DEFAULT '[]', settings TEXT NOT NULL DEFAULT '{}', updated_at INTEGER NOT NULL);
    CREATE TABLE alerts (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, asset_id TEXT NOT NULL, direction TEXT NOT NULL, price REAL NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE alert_units (alert_id TEXT PRIMARY KEY);
    CREATE TABLE alert_state (alert_id TEXT PRIMARY KEY);
    CREATE TABLE alert_delivery (alert_id TEXT PRIMARY KEY);
    CREATE TABLE price_history (asset_id TEXT NOT NULL, t INTEGER NOT NULL, price REAL NOT NULL, PRIMARY KEY (asset_id, t));
    CREATE TABLE price_history_v2 (asset_id TEXT NOT NULL, t INTEGER NOT NULL, price REAL NOT NULL, PRIMARY KEY (asset_id, t)) WITHOUT ROWID;
  `);

  legacyDb.prepare('INSERT INTO users(id,email,name,created_at) VALUES(?,?,?,?)').run('u_keep', 'keep@example.com', 'نگهداری کاربر', now);
  legacyDb.prepare('INSERT INTO user_data(user_id,holdings,watch,featured,settings,updated_at) VALUES(?,?,?,?,?,?)').run(
    'u_keep',
    JSON.stringify([{ id: 'tx_keep', assetId: 'gold18', side: 'buy', qty: 10, buyPrice: 4500000, wallet: 'اصلی', date: '1403/09/01' }]),
    JSON.stringify(['gold18', 'usd']),
    JSON.stringify(['gold18']),
    JSON.stringify({ theme: 'dark', unit: 'toman' }),
    now
  );
  legacyDb.prepare('INSERT INTO alerts(id,user_id,asset_id,direction,price,created_at) VALUES(?,?,?,?,?,?)').run('u_keep:al1', 'u_keep', 'gold18', 'above', 5000000, now);
  legacyDb.prepare('INSERT INTO price_history(asset_id,t,price) VALUES(?,?,?)').run('usd', now - 7200, 81000);
  legacyDb.prepare('INSERT INTO price_history_v2(asset_id,t,price) VALUES(?,?,?)').run('usd', now - 3600, 82500);
  legacyDb.prepare('INSERT INTO rate_limits(k,n,win) VALUES(?,?,?)').run('legacy_rl_key', 4, now + 600);
  legacyDb.prepare('INSERT INTO kv(k,v,updated_at) VALUES(?,?,?)').run('admin_settings', JSON.stringify({ maintenance: false, baseCurrency: 'toman' }), now);

  const { DB } = createSqliteD1Wrapper(legacyDb);

  // First run of ensureDatabaseMigrations adds missing columns and creates missing tables/indexes
  const firstRun = await ensureDatabaseMigrations({ DB }, { force: true });
  assert.equal(firstRun.ok, true);
  assert.equal(firstRun.rateLimitSchemaMode, 'legacy_altered');
  assert.ok(firstRun.addedColumns.includes('rate_limits.count'));
  assert.ok(firstRun.addedColumns.includes('rate_limits.reset_at'));
  assert.ok(firstRun.addedColumns.includes('sessions.created_at'));
  assert.ok(firstRun.addedColumns.includes('otp_codes.payload'));
  assert.ok(firstRun.addedColumns.includes('otp_codes.attempts'));
  assert.ok(firstRun.addedColumns.includes('otp_codes.created_at'));
  assert.ok(firstRun.addedColumns.includes('alerts.triggered_at'));
  assert.ok(firstRun.addedColumns.includes('alerts.attempts'));
  assert.ok(firstRun.addedColumns.includes('alert_units.currency'));
  assert.ok(firstRun.addedColumns.includes('alert_delivery.lease_until'));
  assert.ok(firstRun.addedColumns.includes('alert_delivery.retry_at'));
  assert.ok(firstRun.addedColumns.includes('alert_state.version'));
  assert.ok(firstRun.addedColumns.includes('users.password_hash'));
  assert.ok(firstRun.addedColumns.includes('users.google_sub'));

  // Second forced run is 100% idempotent: 0 columns added, no duplicate column errors
  const secondRun = await ensureDatabaseMigrations({ DB }, { force: true });
  assert.equal(secondRun.ok, true);
  assert.deepEqual(secondRun.addedColumns, []);

  // Running 004_schema_reconcile.sql after ensureDatabaseMigrations is also 100% idempotent
  assert.doesNotThrow(() => legacyDb.exec(mig004));

  // Verify migration status report
  const status = await getDatabaseMigrationStatus({ DB });
  assert.equal(status.healthy, true);
  assert.deepEqual(status.missingTables, []);
  assert.deepEqual(status.missingIndexes, []);
  assert.equal(status.migrations.length, 4);

  // Verify 100% of pre-existing user, holdings, alert, price history, kv, and rate_limits data was preserved
  const keptUser = legacyDb.prepare("SELECT email, name FROM users WHERE id='u_keep'").get();
  assert.equal(keptUser.email, 'keep@example.com');
  assert.equal(keptUser.name, 'نگهداری کاربر');

  const keptData = legacyDb.prepare("SELECT holdings, watch, settings FROM user_data WHERE user_id='u_keep'").get();
  assert.equal(JSON.parse(keptData.holdings)[0].id, 'tx_keep');
  assert.deepEqual(JSON.parse(keptData.watch), ['gold18', 'usd']);
  assert.equal(JSON.parse(keptData.settings).theme, 'dark');

  const keptAlert = legacyDb.prepare("SELECT price, attempts FROM alerts WHERE id='u_keep:al1'").get();
  assert.equal(keptAlert.price, 5000000);
  assert.equal(keptAlert.attempts, 0);

  const keptPh1 = legacyDb.prepare("SELECT price FROM price_history WHERE asset_id='usd'").get();
  assert.equal(keptPh1.price, 81000);
  const keptPh2 = legacyDb.prepare("SELECT price FROM price_history_v2 WHERE asset_id='usd'").get();
  assert.equal(keptPh2.price, 82500);

  const keptRl = legacyDb.prepare("SELECT n, win, count, reset_at FROM rate_limits WHERE k='legacy_rl_key'").get();
  assert.equal(keptRl.n, 4);
  assert.equal(keptRl.win, now + 600);
  assert.equal(keptRl.count, 0);
  assert.equal(keptRl.reset_at, 0);
});

test('bun.lock is tracked with lockfileVersion 1 (no configVersion) and package.json pins packageManager for Cloudflare compatibility', () => {
  const gitignore = fs.readFileSync(new URL('./.gitignore', import.meta.url), 'utf8');
  assert.equal(/\bbun\.lock\b/.test(gitignore), false, 'bun.lock must NOT be in .gitignore so GitHub sync overwrites any old v2 lockfile');
  const pkg = JSON.parse(fs.readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.packageManager, 'bun@1.4.4');
  const bunLockRaw = fs.readFileSync(new URL('./bun.lock', import.meta.url), 'utf8');
  assert.match(bunLockRaw, /"lockfileVersion"\s*:\s*1\b/);
  assert.doesNotMatch(bunLockRaw, /"lockfileVersion"\s*:\s*2\b/);
  assert.doesNotMatch(bunLockRaw, /"configVersion"/);
});

test('migration health check detects missing columns across all tables, reports D1 errors without false positives, and uses 1-query Cold Start fast-path', async () => {
  __resetWorkerStateForTests();

  // 1. Missing column on users table (e.g. password_hash) MUST report healthy: false and list users.password_hash in missingColumns
  const incompleteDb = new DatabaseSync(':memory:');
  incompleteDb.exec(fs.readFileSync(new URL('./migrations/004_schema_reconcile.sql', import.meta.url), 'utf8'));
  incompleteDb.exec(`
    DROP TABLE users;
    CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT, created_at INTEGER NOT NULL DEFAULT 0);
  `);
  const { DB: incDB } = createSqliteD1Wrapper(incompleteDb);
  const incStatus = await getDatabaseMigrationStatus({ DB: incDB });
  assert.equal(incStatus.healthy, false, 'Health check must be false when users table is missing password_hash and google_sub');
  assert.deepEqual(incStatus.missingTables, []);
  assert.ok(incStatus.missingColumns.includes('users.password_hash'));
  assert.ok(incStatus.missingColumns.includes('users.google_sub'));

  // 2. False-positive prevention: if D1 throws an error during ensureDatabaseMigrations, ok MUST be false and schemaMigrationsEnsured MUST remain false
  __resetWorkerStateForTests();
  const brokenD1 = {
    prepare(sql) {
      return {
        bind() { return this; },
        async first() { throw new Error('d1_disk_io_error'); },
        async all() { throw new Error('d1_disk_io_error'); },
        async run() { throw new Error('d1_disk_io_error: ' + sql.slice(0, 24)); }
      };
    }
  };
  const failedRun = await ensureDatabaseMigrations({ DB: brokenD1 });
  assert.equal(failedRun.ok, false, 'ensureDatabaseMigrations must not report ok: true when D1 queries fail');
  assert.equal(failedRun.healthy, false);
  assert.ok(Array.isArray(failedRun.errors) && failedRun.errors.length > 0);

  // 3. Cold Start Fast-Path: after a verified migration, a new Worker Isolate (__resetWorkerStateForTests) executes only 1 PK read and 0 writes
  __resetWorkerStateForTests();
  const prodDb = new DatabaseSync(':memory:');
  const { DB: prodD1, stats } = createSqliteD1Wrapper(prodDb);
  const initialMig = await ensureDatabaseMigrations({ DB: prodD1 });
  assert.equal(initialMig.ok, true);
  assert.equal(initialMig.healthy, true);
  assert.equal(initialMig.fastPath, false);

  // Simulate new Worker Isolate cold start
  __resetWorkerStateForTests();
  stats.reads = 0;
  stats.writes = 0;
  const coldStartMig = await ensureDatabaseMigrations({ DB: prodD1 });
  assert.equal(coldStartMig.ok, true);
  assert.equal(coldStartMig.healthy, true);
  assert.equal(coldStartMig.fastPath, true, 'Cold start on already-migrated D1 should use 1-query fastPath');
  assert.equal(stats.reads, 1, 'Expected exactly 1 PK SELECT on schema_migrations during cold start');
  assert.equal(stats.writes, 0, 'Expected 0 D1 writes during cold start fast-path');
});

test('primary admin can select secondary admin by email in dashboard without password or secret, and promote existing user via /api/admin/users/add', async () => {
  __resetWorkerStateForTests();
  const db = new DatabaseSync(':memory:');
  db.exec(fs.readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
  const { DB } = createSqliteD1Wrapper(db);

  const env = {
    DB,
    ADMIN_EMAIL: 'chief@example.com',
    ADMIN_PASSWORD: 'ChiefMasterPassword!1',
    AUTH_SECRET: 'test-auth-secret-key-minimum-32-chars!!'
  };

  const callApi = (path, { method = 'GET', body, token } = {}) =>
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
      env
    );

  const chiefLogin = await (await callApi('/api/auth/login', { method: 'POST', body: { email: 'chief@example.com', password: 'ChiefMasterPassword!1' } })).json();
  assert.equal(chiefLogin.user.isPrimaryAdmin, true);

  // 1. Primary admin selects a secondary admin by email ONLY (no password, no secret)
  const addEmailOnly = await callApi('/api/admin/users/add', {
    method: 'POST',
    token: chiefLogin.token,
    body: { email: 'selected.admin@example.com', role: 'admin' }
  });
  assert.equal(addEmailOnly.status, 200);
  const addEmailBody = await addEmailOnly.json();
  assert.equal(addEmailBody.user.role, 'admin');
  assert.equal(addEmailBody.user.adminTier, 'secondary');
  assert.equal(addEmailBody.user.envPinned, false);

  // When selected.admin@example.com checks email on login screen, exists is false & allowRegister is true so they can set their password via OTP
  const chkSelected = await (await callApi('/api/auth/check-email', { method: 'POST', body: { email: 'selected.admin@example.com' } })).json();
  assert.equal(chkSelected.exists, false);
  assert.equal(chkSelected.allowRegister, true);

  // 2. If an existing regular user's email is submitted in /api/admin/users/add with role: 'admin', they are promoted cleanly instead of 409
  const addNormal = await callApi('/api/admin/users/add', {
    method: 'POST',
    token: chiefLogin.token,
    body: { email: 'existing.user@example.com', name: 'Existing User', password: 'ExistingUserPass!1', role: 'user' }
  });
  assert.equal(addNormal.status, 200);

  const promoteViaAdd = await callApi('/api/admin/users/add', {
    method: 'POST',
    token: chiefLogin.token,
    body: { email: 'existing.user@example.com', role: 'admin' }
  });
  assert.equal(promoteViaAdd.status, 200);
  const promotedUser = (await promoteViaAdd.json()).user;
  assert.equal(promotedUser.role, 'admin');
  assert.equal(promotedUser.adminTier, 'secondary');
});

test('wrangler.toml sets keep_vars = true and dark mode viewport styling + SW v12 are configured cleanly', () => {
  const wrangler = fs.readFileSync(new URL('./wrangler.toml', import.meta.url), 'utf8');
  assert.match(wrangler, /^\s*keep_vars\s*=\s*true\b/m);

  const html = fs.readFileSync(new URL('./src/index.html', import.meta.url), 'utf8');
  assert.ok(html.includes('<meta name="color-scheme" id="colorSchemeMeta" content="light">'));
  assert.ok(html.includes(':root[data-theme=dark],html[data-theme=dark]'));
  assert.ok(html.includes('document.body.style.backgroundColor'));
  assert.ok(html.includes('/sw.js?v=14'));

  const swFile = fs.readFileSync(new URL('./public/sw.js', import.meta.url), 'utf8');
  assert.ok(swFile.includes("darayi-shell-v14"));
  const workerSrc = fs.readFileSync(new URL('./src/worker.js', import.meta.url), 'utf8');
  assert.ok(workerSrc.includes("darayi-shell-v14"));
});

test('shared Promises eliminated in worker.js while concurrent refreshPrices still coalesces without cross-request Promise sharing', async () => {
  __resetWorkerStateForTests();
  const workerSrc = fs.readFileSync(new URL('./src/worker.js', import.meta.url), 'utf8');
  assert.equal(/\binFlightRefreshJob\s*=\s*\(\s*async/.test(workerSrc), false);
  assert.equal(/\bhistoryInFlight\.set\([^,]+,\s*(?:p|run)\b/.test(workerSrc), false);

  const nowSec = Math.floor(Date.now() / 1000);
  const isoNow = new Date(nowSec * 1000).toISOString();
  let domesticFetchCount = 0;
  const origFetch = globalThis.fetch;

  globalThis.fetch = async (input) => {
    const url = typeof input === 'string' ? input : input?.url || '';
    if (url === 'https://nerkhara.com/api/v1/latest.json') {
      domesticFetchCount++;
      await new Promise((r) => setTimeout(r, 35));
      return new Response(JSON.stringify({
        stale: false,
        generated_utc: isoNow,
        items: [{ id: 'usd', price: 86400, unit: 'IRT', updated_utc: isoNow }]
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({}), { status: 404 });
  };

  try {
    const [r1, r2, r3] = await Promise.all([
      refreshPrices({}, true, true),
      refreshPrices({}, true, true),
      refreshPrices({}, true, true)
    ]);
    assert.equal(domesticFetchCount, 1, 'Expected concurrent refreshPrices calls to coalesce onto one network fetch via coordination state');
    assert.equal(r1.items.usd.price, 86400);
    assert.equal(r2.items.usd.price, 86400);
    assert.equal(r3.items.usd.price, 86400);
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('runCron automatically ensures D1 schema_migrations and missing indexes non-destructively', async () => {
  __resetWorkerStateForTests();
  const now = Math.floor(Date.now() / 1000);
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL DEFAULT '', password_hash TEXT, google_sub TEXT UNIQUE, created_at INTEGER NOT NULL);
    CREATE TABLE sessions (id_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE otp_codes (email TEXT NOT NULL, purpose TEXT NOT NULL, code_hash TEXT NOT NULL, payload TEXT NOT NULL DEFAULT '{}', attempts INTEGER NOT NULL DEFAULT 0, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(email, purpose));
    CREATE TABLE oauth_states (state_hash TEXT PRIMARY KEY, verifier TEXT NOT NULL, expires_at INTEGER NOT NULL);
    CREATE TABLE rate_limits (k TEXT PRIMARY KEY, count INTEGER NOT NULL DEFAULT 0, reset_at INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE kv (k TEXT PRIMARY KEY, v TEXT NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TABLE user_data (user_id TEXT PRIMARY KEY, holdings TEXT NOT NULL DEFAULT '[]', watch TEXT NOT NULL DEFAULT '[]', featured TEXT NOT NULL DEFAULT '[]', settings TEXT NOT NULL DEFAULT '{}', updated_at INTEGER NOT NULL);
    CREATE TABLE alerts (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, asset_id TEXT NOT NULL, direction TEXT NOT NULL, price REAL NOT NULL, triggered_at INTEGER, attempts INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
    CREATE TABLE alert_units (alert_id TEXT PRIMARY KEY, currency TEXT NOT NULL DEFAULT 'IRT');
    CREATE TABLE alert_state (alert_id TEXT PRIMARY KEY, version TEXT NOT NULL DEFAULT '');
    CREATE TABLE alert_delivery (alert_id TEXT PRIMARY KEY, lease_until INTEGER NOT NULL DEFAULT 0, retry_at INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE price_history (asset_id TEXT NOT NULL, t INTEGER NOT NULL, price REAL NOT NULL, PRIMARY KEY (asset_id, t));
    CREATE TABLE price_history_v2 (asset_id TEXT NOT NULL, t INTEGER NOT NULL, price REAL NOT NULL, PRIMARY KEY (asset_id, t)) WITHOUT ROWID;
    CREATE TABLE admin_roles (user_id TEXT PRIMARY KEY, email TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'admin', granted_by TEXT NOT NULL DEFAULT '', granted_at INTEGER NOT NULL);
  `);
  db.prepare('INSERT INTO users(id,email,name,created_at) VALUES(?,?,?,?)').run('u_cron', 'cron@example.com', 'Cron Keep', now);

  const { DB } = createSqliteD1Wrapper(db);
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('{}', { status: 404 });
  try {
    await runCron({ DB });
  } finally {
    globalThis.fetch = origFetch;
  }

  const status = await getDatabaseMigrationStatus({ DB });
  assert.equal(status.healthy, true);
  assert.deepEqual(status.missingIndexes, []);
  const migRows = db.prepare('SELECT version, status FROM schema_migrations').all();
  assert.ok(migRows.some((r) => r.version === '004_schema_reconcile' && r.status === 'applied'));
  assert.equal(db.prepare("SELECT email FROM users WHERE id='u_cron'").get().email, 'cron@example.com');
});

test('transferUserAssetsSafely and /api/admin/users/transfer-assets enforce RBAC, backup before write, deduplicate, and preserve both accounts', async () => {
  __resetWorkerStateForTests();
  const now = Math.floor(Date.now() / 1000);
  const db = new DatabaseSync(':memory:');
  db.exec(fs.readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
  const { DB } = createSqliteD1Wrapper(db);

  const kvStore = new Map();
  const mockKv = {
    async get(k, opts) {
      const raw = kvStore.get(k);
      return raw && opts?.type === 'json' ? JSON.parse(raw) : raw;
    },
    async put(k, v) {
      kvStore.set(k, v);
    }
  };

  const primaryEmail = 'owner@example.com';
  const secEmail = 'sec@example.com';
  const env = {
    DB,
    PRICES_KV: mockKv,
    ADMIN_EMAIL: primaryEmail,
    ADMIN_PASSWORD: 'OwnerMasterPassword!1',
    AUTH_SECRET: 'test-auth-secret-key-minimum-32-chars!!'
  };

  const callApi = (path, { method = 'GET', body, token } = {}) =>
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
      env
    );

  // Pre-seed Primary Admin with their own user ID ('u_primary_1', separate from legacy 'admin_root')
  const ownerPassHash = await hashPassword('OwnerMasterPassword!1', env);
  db.prepare('INSERT INTO users(id,email,name,password_hash,created_at) VALUES(?,?,?,?,?)').run('u_primary_1', primaryEmail, 'Primary Owner', ownerPassHash, now - 500);

  // Login Primary Admin & create Primary user_data with 1 existing holding (so admin_root is no longer auto-inherited)
  const pLogin = await (await callApi('/api/auth/login', { method: 'POST', body: { email: primaryEmail, password: 'OwnerMasterPassword!1' } })).json();
  assert.equal(pLogin.user.id, 'u_primary_1');
  const existingTargetHolding = { id: 'tgt_h1', assetId: 'btc', side: 'buy', qty: 0.1, buyPrice: 90000, wallet: 'اصلی', date: '1403/10/01', createdAt: now };
  await callApi('/api/me/data', {
    method: 'PUT',
    token: pLogin.token,
    body: {
      holdings: [existingTargetHolding],
      watch: ['btc'],
      featured: ['btc'],
      alerts: [],
      settings: { theme: 'dark', unit: 'toman', privacy: false, filter: 'all' }
    }
  });

  // Seed legacy source account ('admin_root') with 2 holdings, extra watch, alert, and setting
  const oldHoldings = [
    { id: 'old_h1', assetId: 'gold18', side: 'buy', qty: 5, buyPrice: 5200000, wallet: 'صندوق', date: '1403/05/10', createdAt: now - 500 },
    { id: 'old_h2', assetId: 'usd', side: 'buy', qty: 200, buyPrice: 72000, wallet: 'کیف', date: '1403/06/15', createdAt: now - 300 }
  ];
  db.prepare('INSERT INTO user_data(user_id,holdings,watch,featured,settings,updated_at) VALUES(?,?,?,?,?,?)').run(
    'admin_root',
    JSON.stringify(oldHoldings),
    JSON.stringify(['gold18', 'usd', 'btc']),
    JSON.stringify(['usd', 'gold18']),
    JSON.stringify({ theme: 'light', lang: 'fa' }),
    now - 100
  );
  db.prepare('INSERT INTO alerts(id,user_id,asset_id,direction,price,created_at) VALUES(?,?,?,?,?,?)').run(
    'admin_root:old_al1', 'admin_root', 'gold18', 'above', 6500000, now - 100
  );
  db.prepare('INSERT INTO alert_units(alert_id,currency) VALUES(?,?)').run('admin_root:old_al1', 'IRT');

  // Create secondary admin -> MUST be forbidden (403) from calling transfer-assets
  await callApi('/api/admin/users/add', {
    method: 'POST',
    token: pLogin.token,
    body: { email: secEmail, name: 'Sec Admin', password: 'SecAdminPass!1', role: 'admin' }
  });
  const secLogin = await (await callApi('/api/auth/login', { method: 'POST', body: { email: secEmail, password: 'SecAdminPass!1' } })).json();
  const forbiddenRes = await callApi('/api/admin/users/transfer-assets', {
    method: 'POST',
    token: secLogin.token,
    body: { source: 'admin_root', target: primaryEmail, dryRun: true }
  });
  assert.equal(forbiddenRes.status, 403);

  // 1. Dry-run preview returns exact diff without writing backup or mutating D1
  const dryRes = await callApi('/api/admin/users/transfer-assets', {
    method: 'POST',
    token: pLogin.token,
    body: { source: 'admin_root', target: primaryEmail, dryRun: true }
  });
  assert.equal(dryRes.status, 200);
  const dryBody = await dryRes.json();
  assert.equal(dryBody.dryRun, true);
  assert.equal(dryBody.backupKey, null);
  assert.equal(dryBody.summary.sourceHoldings, 2);
  assert.equal(dryBody.summary.targetHoldingsBefore, 1);
  assert.equal(dryBody.summary.targetHoldingsAfter, 3);
  assert.equal(dryBody.summary.addedHoldings, 2);
  assert.equal(dryBody.summary.addedWatch, 2);
  assert.equal(dryBody.summary.addedAlerts, 1);
  assert.equal(dryBody.summary.adoptedFeatured, false); // Target already had ['btc']
  assert.equal(dryBody.summary.mergedSettingsKeys, 1); // Only 'lang' was missing; 'theme' preserved as 'dark'

  // 2. Real transfer writes backup BEFORE updating target, preserves source & existing target records
  const execRes = await callApi('/api/admin/users/transfer-assets', {
    method: 'POST',
    token: pLogin.token,
    body: { source: 'admin_root', target: primaryEmail, dryRun: false }
  });
  assert.equal(execRes.status, 200);
  const execBody = await execRes.json();
  assert.equal(execBody.dryRun, false);
  assert.match(execBody.backupKey, /^backup:asset_transfer:/);
  assert.equal(execBody.summary.addedHoldings, 2);

  // Verify backup exists in BOTH D1 kv table and PRICES_KV
  const d1Backup = db.prepare('SELECT v FROM kv WHERE k=?').get(execBody.backupKey);
  assert.ok(d1Backup);
  assert.ok(kvStore.has(execBody.backupKey));
  const parsedBackup = JSON.parse(d1Backup.v);
  assert.equal(parsedBackup.source.userId, 'admin_root');
  assert.equal(JSON.parse(parsedBackup.targetSnapshotBefore.userData.holdings).length, 1);

  // Verify primary account now has all 3 holdings, merged watch, preserved dark theme, and imported alert
  const meAfter = await (await callApi('/api/me/data?fresh=1', { token: pLogin.token })).json();
  assert.equal(meAfter.data.holdings.length, 3);
  assert.deepEqual(meAfter.data.watch, ['btc', 'gold18', 'usd']);
  assert.deepEqual(meAfter.data.featured, ['btc']);
  assert.equal(meAfter.data.settings.theme, 'dark');
  assert.equal(meAfter.data.settings.lang, 'fa');
  assert.equal(meAfter.data.alerts.length, 1);
  assert.equal(meAfter.data.alerts[0].assetId, 'gold18');

  // Verify source ('admin_root') was NOT deleted
  const srcAfter = db.prepare("SELECT holdings FROM user_data WHERE user_id='admin_root'").get();
  assert.equal(JSON.parse(srcAfter.holdings).length, 2);

  // 3. Re-running transfer is idempotent (0 duplicates added)
  const repeatBody = await (await callApi('/api/admin/users/transfer-assets', {
    method: 'POST',
    token: pLogin.token,
    body: { source: 'admin_root', target: primaryEmail, dryRun: false }
  })).json();
  assert.equal(repeatBody.summary.addedHoldings, 0);
  assert.equal(repeatBody.summary.skippedDuplicateHoldings, 2);
  assert.equal(repeatBody.summary.addedAlerts, 0);
  assert.equal(repeatBody.summary.skippedDuplicateAlerts, 1);
  assert.equal(repeatBody.summary.wouldChange, false);

  // 4. Fail-closed if backup insert fails: target untouched
  const failingDb = {
    prepare(sql) {
      if (/INSERT INTO kv/i.test(sql)) {
        return {
          bind() { return this; },
          async run() { throw new Error('kv_write_failed'); }
        };
      }
      return DB.prepare(sql);
    },
    batch: (stmts) => DB.batch(stmts)
  };
  await assert.rejects(
    () => transferUserAssetsSafely({ DB: failingDb }, { source: 'admin_root', target: secEmail, dryRun: false }),
    (err) => err?.status === 500
  );
  assert.equal(db.prepare('SELECT user_id FROM user_data WHERE user_id=(SELECT id FROM users WHERE email=?)').get(secEmail), undefined);
});

test('history endpoint races fallback exchanges in parallel and UI prioritizes detail chart over background sparks', async () => {
  __resetWorkerStateForTests();
  const now = Math.floor(Date.now() / 1000);
  const kvStore = new Map([
    [
      KV_SNAPSHOT_KEY,
      JSON.stringify({
        version: 1,
        updatedAt: now,
        checkedAt: now,
        items: { btc: { price: 95000, change: 1.5, unit: 'USDT', crypto: true, src: 'kucoin', pair: 'BTC-USDT', sym: 'BTC', t: now, receivedAt: now } },
        feeds: {}
      })
    ]
  ]);
  const mockKv = {
    async get(k, opts) {
      const raw = kvStore.get(k);
      return raw && opts?.type === 'json' ? JSON.parse(raw) : raw;
    },
    async put(k, v) { kvStore.set(k, v); }
  };

  const origFetch = globalThis.fetch;
  const startedUrls = [];
  globalThis.fetch = async (input) => {
    const url = typeof input === 'string' ? input : input?.url || '';
    startedUrls.push(url);
    if (url.includes('api.kucoin.com')) {
      return new Response('{}', { status: 500 });
    }
    if (url.includes('okx.com')) {
      // Slow OKX should not block fast Gate response
      await new Promise((r) => setTimeout(r, 120));
      return new Response(JSON.stringify({ code: '1', data: [] }), { status: 200 });
    }
    if (url.includes('gateio.ws')) {
      return new Response(JSON.stringify([
        [String(now - 600), '0', '94800'],
        [String(now - 300), '0', '94950']
      ]), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.includes('binance.vision')) {
      await new Promise((r) => setTimeout(r, 120));
      return new Response('[]', { status: 200 });
    }
    return new Response('{}', { status: 404 });
  };

  try {
    const t0 = Date.now();
    const res = await history({ PRICES_KV: mockKv }, new URL('https://darayi.example/api/history?id=btc&range=1D'));
    const body = await res.json();
    const elapsed = Date.now() - t0;
    assert.equal(body.source, 'gate');
    assert.ok(body.points.length >= 2);
    assert.ok(elapsed < 110, `Expected parallel fallback race to resolve before slow 120ms upstreams, took ${elapsed}ms`);
  } finally {
    globalThis.fetch = origFetch;
  }

  const html = fs.readFileSync(new URL('./src/index.html', import.meta.url), 'utf8');
  assert.ok(html.includes('let detailChartInFlight = 0;'));
  assert.ok(html.includes('function hydrateLateCryptoIcons()'));
  assert.ok(html.includes('darayi-crypto-icons-v6'));
});

test('local bundled crypto logos & flags skip external icon CDN calls when covered and card sparklines match 1D modal chart', async () => {
  __resetWorkerStateForTests();
  const iconsManifest = JSON.parse(fs.readFileSync(new URL('./public/logos/icons.json', import.meta.url), 'utf8'));
  const manifestKeys = Object.keys(iconsManifest);
  assert.ok(manifestKeys.length >= 2000, `Expected >=2000 local crypto logos, got ${manifestKeys.length}`);
  assert.equal(iconsManifest.btc, '/logos/crypto/btc.png');
  assert.equal(iconsManifest.eth, '/logos/crypto/eth.png');
  assert.ok(fs.existsSync(new URL('./public/logos/flags/us.svg', import.meta.url)));

  const now = Math.floor(Date.now() / 1000);
  const kvStore = new Map([
    [
      KV_SNAPSHOT_KEY,
      JSON.stringify({
        version: 1,
        updatedAt: now,
        checkedAt: now,
        items: {
          btc: { price: 95000, change: 1.5, unit: 'USDT', crypto: true, src: 'kucoin', pair: 'BTC-USDT', sym: 'BTC', t: now, receivedAt: now },
          eth: { price: 3200, change: -0.8, unit: 'USDT', crypto: true, src: 'kucoin', pair: 'ETH-USDT', sym: 'ETH', t: now, receivedAt: now }
        },
        feeds: {}
      })
    ]
  ]);
  const mockKv = {
    async get(k, opts) {
      const raw = kvStore.get(k);
      return raw && opts?.type === 'json' ? JSON.parse(raw) : raw;
    },
    async put(k, v) { kvStore.set(k, v); }
  };

  const origFetch = globalThis.fetch;
  let externalFetchCalls = 0;
  globalThis.fetch = async () => {
    externalFetchCalls++;
    return new Response('{}', { status: 500 });
  };
  try {
    const res = await worker.fetch(new Request('https://darayi.example/api/crypto-icons'), { PRICES_KV: mockKv });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.icons.btc, '/logos/crypto/btc.png');
    assert.equal(body.icons.eth, '/logos/crypto/eth.png');
    assert.equal(externalFetchCalls, 0, 'Expected /api/crypto-icons to skip external APIs when active coins are covered locally');
  } finally {
    globalThis.fetch = origFetch;
  }

  const html = fs.readFileSync(new URL('./src/index.html', import.meta.url), 'utf8');
  assert.ok(html.includes('LOCAL_CRYPTO_PNG_LIST = "'), 'Expected populated LOCAL_CRYPTO_PNG_LIST in src/index.html');
  assert.ok(html.includes('LOCAL_FLAG_CODES = new Set(["'), 'Expected populated LOCAL_FLAG_CODES in src/index.html');
  assert.ok(html.includes("const targetRange='1D';"), 'Expected all card sparklines to target 1D');
  assert.ok(html.includes('function renderSparkFromPoints(id, rawPts, usedRange'), 'Expected unified sparkline renderer');
  assert.ok(html.includes("if(range==='1D'){\n    renderSparkFromPoints(a.id,detailState.points,'1D');"), 'Expected modal 1D drawDetail to sync card sparkline');
});

test('PriceCoordinator Durable Object coalesces concurrent refreshes onto one upstream fetch and respects 60s freshness', async () => {
  __resetWorkerStateForTests();
  const wrangler = fs.readFileSync(new URL('./wrangler.toml', import.meta.url), 'utf8');
  assert.match(wrangler, /class_name\s*=\s*"PriceCoordinator"/);
  assert.match(wrangler, /new_sqlite_classes\s*=\s*\["PriceCoordinator"\]/);
  assert.match(wrangler, /INLINE_REFRESH_S\s*=\s*"60"/);
  assert.match(wrangler, /crons\s*=\s*\["\*\/5 \* \* \* \*",\s*"17 3 \* \* \*"\]/);

  const doStorage = new Map();
  const state = {
    storage: {
      async get(k) { return doStorage.get(k); },
      async put(k, v) { doStorage.set(k, structuredClone(v)); },
      async delete(k) { doStorage.delete(k); }
    },
    waitUntil() {}
  };
  let coordInstance = null;
  const env = {
    INLINE_REFRESH_S: '60',
    PRICE_COORDINATOR: {
      idFromName(name) { return name; },
      get() {
        if (!coordInstance) coordInstance = new PriceCoordinator(state, env);
        return { fetch: (input, init) => coordInstance.fetch(new Request(input, init)) };
      }
    }
  };

  let domesticFetches = 0;
  let kucoinFetches = 0;
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const u = typeof input === 'string' ? input : input?.url || '';
    if (u === 'https://nerkhara.com/api/v1/latest.json') {
      domesticFetches++;
      await new Promise((r) => setTimeout(r, 30));
      const iso = new Date().toISOString();
      return new Response(JSON.stringify({
        stale: false,
        generated_utc: iso,
        items: [{ id: 'usd', price: 89500, unit: 'IRT', updated_utc: iso }]
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (u === 'https://api.kucoin.com/api/v1/market/allTickers') {
      kucoinFetches++;
      await new Promise((r) => setTimeout(r, 30));
      const ticker = [];
      for (let i = 0; i < 16; i++) {
        const sym = i === 0 ? 'BTC-USDT' : `COIN${i}-USDT`;
        ticker.push({ symbol: sym, last: String(90000 + i), changeRate: '0.01', volValue: '500000' });
      }
      return new Response(JSON.stringify({ data: { time: Date.now(), ticker } }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response('{}', { status: 404 });
  };

  try {
    const [a, b, c] = await Promise.all([
      refreshPrices(env, false, true),
      refreshPrices(env, false, true),
      refreshPrices(env, false, true)
    ]);
    assert.equal(domesticFetches, 1, 'Expected DO to trigger only one domestic fetch across concurrent refreshes');
    assert.equal(kucoinFetches, 1, 'Expected DO to trigger only one crypto fetch across concurrent refreshes');
    assert.equal(a.items.usd.price, 89500);
    assert.equal(b.items.btc.price, 90000);
    assert.equal(c.items.btc.price, 90000);

    // Subsequent non-forced refresh within 60s must reuse DO snapshot without external fetches
    const cachedFollowup = await refreshPrices(env, false, true);
    assert.equal(cachedFollowup.cached, true);
    assert.equal(domesticFetches, 1);
    assert.equal(kucoinFetches, 1);
    assert.ok(doStorage.has(KV_SNAPSHOT_KEY), 'Expected DO SQLite storage to persist price snapshot');
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('/api/prices uses per-PoP Workers Cache (caches.default, ~60s) with remaining-TTL headers isolated from auth/admin/user endpoints', async () => {
  __resetWorkerStateForTests();
  const mockEdgeStore = new Map();
  const origCaches = globalThis.caches;
  const origFetch = globalThis.fetch;

  const mockDefaultCache = {
    async match(key) {
      const url = typeof key === 'string' ? key : key?.url;
      const entry = mockEdgeStore.get(url);
      return entry ? entry.clone() : undefined;
    },
    async put(key, response) {
      const url = typeof key === 'string' ? key : key?.url;
      mockEdgeStore.set(url, response.clone());
    },
    async delete(key) {
      const url = typeof key === 'string' ? key : key?.url;
      return mockEdgeStore.delete(url);
    }
  };
  Object.defineProperty(globalThis, 'caches', { configurable: true, writable: true, value: { default: mockDefaultCache } });

  const env = { INLINE_REFRESH_S: '60' };
  let kucoinCalls = 0;
  globalThis.fetch = async (input) => {
    const u = typeof input === 'string' ? input : input?.url || '';
    if (u === 'https://nerkhara.com/api/v1/latest.json') {
      const iso = new Date().toISOString();
      return new Response(JSON.stringify({
        stale: false,
        generated_utc: iso,
        items: [{ id: 'usd', price: 88200, unit: 'IRT', updated_utc: iso }]
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (u === 'https://api.kucoin.com/api/v1/market/allTickers') {
      kucoinCalls++;
      const ticker = [];
      for (let i = 0; i < 16; i++) {
        const sym = i === 0 ? 'BTC-USDT' : `TK${i}-USDT`;
        ticker.push({ symbol: sym, last: String(91000 + i), changeRate: '0.02', volValue: '800000' });
      }
      return new Response(JSON.stringify({ data: { time: Date.now(), ticker } }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response('{}', { status: 404 });
  };

  const pendingWaitUntils = [];
  const ctx = { waitUntil(p) { pendingWaitUntils.push(Promise.resolve(p)); } };

  try {
    assert.equal(getPriceFreshnessS(env), 60);
    const res1 = await worker.fetch(new Request('https://darayi.example/api/prices'), env, ctx);
    await Promise.all(pendingWaitUntils.splice(0));
    assert.equal(res1.status, 200);
    const cc1 = res1.headers.get('cache-control') || '';
    const cdnCc1 = res1.headers.get('cdn-cache-control') || '';
    const cfCdnCc1 = res1.headers.get('cloudflare-cdn-cache-control') || '';
    assert.match(cc1, /public,\s*max-age=\d+,\s*s-maxage=\d+/);
    assert.match(cdnCc1, /public,\s*max-age=\d+/);
    assert.match(cfCdnCc1, /public,\s*max-age=\d+/);
    assert.equal(res1.headers.get('set-cookie'), null);
    assert.ok(mockEdgeStore.has('https://edge.darayi.local/api/prices'), 'Expected /api/prices written to per-PoP Workers Cache');

    // Second request in same PoP hits caches.default with 0 upstream calls and bounded remaining TTL <= 60s
    const res2 = await worker.fetch(new Request('https://darayi.example/api/prices'), env, ctx);
    assert.equal(res2.status, 200);
    const maxAgeMatch = (res2.headers.get('cache-control') || '').match(/max-age=(\d+)/);
    assert.ok(maxAgeMatch && Number(maxAgeMatch[1]) >= 1 && Number(maxAgeMatch[1]) <= 60);
    const body2 = await res2.json();
    assert.equal(body2.items.btc.price, 91000);
    assert.equal(kucoinCalls, 1);

    // Auth / user / admin endpoints must NEVER enter global cache and must return strict private no-store headers
    const authRes = await worker.fetch(new Request('https://darayi.example/api/auth/config'), env, ctx);
    assert.match(authRes.headers.get('cache-control') || '', /no-store/);
    assert.match(authRes.headers.get('cache-control') || '', /private/);
    assert.equal(authRes.headers.get('cdn-cache-control'), 'no-store');
    assert.equal(authRes.headers.get('cloudflare-cdn-cache-control'), 'no-store');

    const meRes = await worker.fetch(new Request('https://darayi.example/api/me/data'), env, ctx);
    assert.equal(meRes.status, 401);
    assert.match(meRes.headers.get('cache-control') || '', /private/);
    assert.match(meRes.headers.get('cache-control') || '', /no-store/);
    assert.equal(meRes.headers.get('cdn-cache-control'), 'no-store');

    const adminRes = await worker.fetch(new Request('https://darayi.example/api/admin/overview'), env, ctx);
    assert.equal(adminRes.status, 401);
    assert.match(adminRes.headers.get('cache-control') || '', /no-store/);
    assert.equal(adminRes.headers.get('cdn-cache-control'), 'no-store');

    assert.equal(mockEdgeStore.size, 1, 'Expected ONLY /api/prices in global edge cache');
  } finally {
    globalThis.fetch = origFetch;
    Object.defineProperty(globalThis, 'caches', { configurable: true, writable: true, value: origCaches });
  }
});

test('Worker isolate memory cache expires after 60s, ignores older KV snapshots, and preserves values on upstream failure', async () => {
  __resetWorkerStateForTests();
  const now = Math.floor(Date.now() / 1000);
  const oldKvSnap = {
    version: 1,
    updatedAt: now - 400,
    checkedAt: now - 400,
    items: {
      usd: { price: 80000, unit: 'IRT', sym: 'USD', name: 'دلار', kind: 'domestic', t: now - 400 }
    },
    feeds: {}
  };
  let kvPuts = 0;
  const mockKv = {
    async get() { return structuredClone(oldKvSnap); },
    async put() { kvPuts++; }
  };

  // Seed a newer snapshot via upstream refresh at t = now
  let failAll = false;
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    if (failAll) return new Response('{}', { status: 503 });
    const u = typeof input === 'string' ? input : input?.url || '';
    if (u === 'https://nerkhara.com/api/v1/latest.json') {
      const iso = new Date(now * 1000).toISOString();
      return new Response(JSON.stringify({
        stale: false,
        generated_utc: iso,
        items: [{ id: 'usd', price: 87000, unit: 'IRT', updated_utc: iso }]
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response('{}', { status: 503 });
  };

  try {
    const res1 = await refreshPrices({ PRICES_KV: mockKv, INLINE_REFRESH_S: '60' }, true, true);
    assert.equal(res1.items.usd.price, 87000);

    // Even forcing getPrices against an older KV snapshot must NOT overwrite the fresher in-memory price (87000)
    const afterForceKvRead = await getPrices({ PRICES_KV: mockKv, INLINE_REFRESH_S: '60' }, { force: true });
    assert.equal(afterForceKvRead.items.usd.price, 87000, 'Older KV snapshot must never clobber fresher snapshot');

    // KV backup writes remain throttled (>=280s) for Cloudflare Free Plan 1000 writes/day limit
    await writePricesKvSnapshot({ PRICES_KV: mockKv }, afterForceKvRead, false);
    await writePricesKvSnapshot({ PRICES_KV: mockKv }, { ...afterForceKvRead, items: { usd: { price: 87100, unit: 'IRT' } } }, false);
    assert.equal(kvPuts, 1, 'Expected KV backup write throttle to suppress rapid non-forced KV writes');

    // If all upstreams fail now, existing price (87000) is preserved AND checkedAt does NOT falsely jump ahead
    failAll = true;
    const prevChecked = afterForceKvRead.checkedAt;
    const failedOutcome = await refreshPrices({ PRICES_KV: mockKv, INLINE_REFRESH_S: '60' }, true, true);
    assert.equal(failedOutcome.updated.length, 0);
    assert.equal(failedOutcome.items.usd.price, 87000);
    assert.equal(failedOutcome.snapshot.checkedAt, prevChecked, 'Total upstream failure must preserve previous checkedAt');
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('strict chart range filtering drops out-of-range points and excludes them from percentage change across domestic history', async () => {
  __resetWorkerStateForTests();
  const now = Math.floor(Date.now() / 1000);
  const span3D = CHART_RANGES['3D'];

  // Out-of-range point from 10 days ago with extreme low price (10000) must NOT distort 3D % change
  const rawPts = [
    [now - 10 * 86400, 10000],
    [now - span3D - 60, 20000], // 1 minute before 3D boundary -> must be dropped
    [now - span3D + 60, 80000], // inside 3D boundary -> first point
    [now - 3600, 84000],
    [now + 7200, 999999]        // too far in future -> dropped
  ];
  const filtered = filterPointsStrictlyInRange(rawPts, '3D', now, 3600);
  assert.equal(filtered.length, 2);
  assert.deepEqual(filtered, [[now - span3D + 60, 80000], [now - 3600, 84000]]);
  const pct = computeRangeChangePct(filtered);
  assert.ok(Math.abs(pct - 5) < 1e-6, `Expected +5% from in-range points only, got ${pct}`);

  // Also test /api/history domestic response for gold18 on 3D rejects points older than 3D
  const kvStore = new Map([[
    KV_SNAPSHOT_KEY,
    JSON.stringify({
      version: 1,
      updatedAt: now - 120,
      checkedAt: now - 10,
      items: {
        gold18: {
          price: 6500000,
          unit: 'IRT',
          kind: 'domestic',
          sym: 'Gold18',
          name: 'طلای ۱۸ عیار',
          src: 'nerkhara',
          t: now - 120,
          sourceTimestamp: now - 120,
          receivedAt: now - 10
        }
      },
      feeds: {}
    })
  ]]);
  const mockKv = {
    async get(k, opts) {
      const raw = kvStore.get(k);
      return raw && opts?.type === 'json' ? JSON.parse(raw) : raw;
    },
    async put(k, v) { kvStore.set(k, v); }
  };

  const d10 = new Date((now - 10 * 86400) * 1000).toISOString().slice(0, 10);
  const d2 = new Date((now - 2 * 86400) * 1000).toISOString().slice(0, 10);
  const d1 = new Date((now - 1 * 86400) * 1000).toISOString().slice(0, 10);
  const d0 = new Date(now * 1000).toISOString().slice(0, 10);
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const u = typeof input === 'string' ? input : input?.url || '';
    if (u.includes('iran-market.github.io')) {
      return new Response(JSON.stringify({
        meta: { unit: 'toman' },
        data: [
          { date: d10, close: 3000000 }, // 10 days ago — outside 3D!
          { date: d2, close: 6200000 },
          { date: d1, close: 6400000 },
          { date: d0, close: 6500000 }
        ]
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response('{}', { status: 404 });
  };

  try {
    const res = await history({ PRICES_KV: mockKv }, new URL('https://darayi.example/api/history?id=gold18&range=3D'));
    const body = await res.json();
    assert.ok(body.points.length >= 2);
    for (const [ptTs, ptVal] of body.points) {
      assert.ok(ptTs >= now - span3D - 60, `Found point older than 3D span: ${ptTs}`);
      assert.notEqual(ptVal, 3000000, '10-day-old point must never leak into 3D domestic chart');
    }
    assert.ok(body.priceSource);
    assert.ok(body.lastDataAt > 1500000000);
    assert.ok(body.resolution);
    assert.ok(['live', 'archived', 'published'].includes(body.dataStatus));
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('candle timestamps standardize on openTime across Binance and other exchanges', async () => {
  __resetWorkerStateForTests();
  const baseSec = Math.floor(Date.now() / 1000) - 3600;
  const openMs1 = baseSec * 1000;
  const closeMs1 = openMs1 + 299999; // closeTime is +5m later; must NOT be used!
  const parsed = parseBinanceKlineEntry([openMs1, '90000', '90500', '89900', '90200', '10', closeMs1]);
  assert.deepEqual(parsed, [baseSec, 90200]);
  assert.equal(normalizeCandleOpenTimeSec(String(openMs1)), baseSec);
  assert.equal(normalizeCandleOpenTimeSec(String(baseSec)), baseSec);

  const mockKv = {
    async get() { return null; },
    async put() {}
  };
  const openSecA = baseSec - 600;
  const openSecB = baseSec - 300;
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const u = typeof input === 'string' ? input : input?.url || '';
    if (u.includes('kucoin.com/api/v1/market/candles')) {
      // Simulate Binance-only fallback test by letting binance answer when others return empty
      return new Response(JSON.stringify({ code: '200000', data: [] }), { status: 200 });
    }
    if (u.includes('okx.com') || u.includes('gateio.ws')) {
      return new Response('[]', { status: 200 });
    }
    if (u.includes('binance.vision/api/v3/klines')) {
      return new Response(JSON.stringify([
        [openSecA * 1000, '91000', '91100', '90900', '91050', '5', (openSecA + 299) * 1000],
        [openSecB * 1000, '91050', '91200', '91000', '91180', '8', (openSecB + 299) * 1000]
      ]), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response('{}', { status: 404 });
  };

  try {
    const res = await history({ PRICES_KV: mockKv }, new URL('https://darayi.example/api/history?id=eth&range=1D'));
    const body = await res.json();
    assert.equal(body.source, 'binance');
    assert.deepEqual(body.points, [[openSecA, 91050], [openSecB, 91180]]);
    assert.equal(body.resolution, '5m');
    assert.equal(body.dataStatus, 'live');
    assert.equal(body.lastDataAt, openSecB);
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('recordD1DomesticHistory preserves real sourceTimestamp for old/unchanged prices without stamping now', async () => {
  __resetWorkerStateForTests();
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE price_history_v2 (asset_id TEXT NOT NULL, t INTEGER NOT NULL, price INTEGER NOT NULL, PRIMARY KEY (asset_id, t))');
  const mockD1 = {
    prepare(sql) {
      const stmt = db.prepare(sql);
      return {
        bind(...args) {
          return {
            _stmt: stmt,
            _args: args,
            async first() { return stmt.get(...args) ?? null; },
            async all() { return { results: stmt.all(...args) }; },
            async run() { return stmt.run(...args); }
          };
        }
      };
    },
    async batch(boundList) {
      return boundList.map((b) => {
        if (/^\s*SELECT/i.test(b._stmt.sourceSQL || '')) {
          return { results: b._stmt.all(...b._args) };
        }
        b._stmt.run(...b._args);
        return { success: true };
      });
    }
  };

  const now = Math.floor(Date.now() / 1000);
  const realUpstreamTs = now - 600; // 10 minutes earlier, still fresh
  const items = {
    usd: {
      price: 89000,
      unit: 'IRT',
      kind: 'domestic',
      t: realUpstreamTs,
      sourceTimestamp: realUpstreamTs,
      receivedAt: now
    }
  };

  const inserted1 = await recordD1DomesticHistory({ DB: mockD1 }, items, now, true);
  assert.equal(inserted1, 1);
  const rows1 = db.prepare('SELECT asset_id, t, price FROM price_history_v2 WHERE asset_id = ?').all('usd');
  assert.equal(rows1.length, 1);
  assert.equal(rows1[0].t, realUpstreamTs, 'Must record real sourceTimestamp instead of synthetic now');
  assert.equal(rows1[0].price, 89000);

  // Calling again later with the SAME unchanged sourceTimestamp & price must NOT stamp a duplicate point with now
  const laterNow = now + 300;
  const inserted2 = await recordD1DomesticHistory({ DB: mockD1 }, items, laterNow, true);
  assert.equal(inserted2, 0);
  const rows2 = db.prepare('SELECT asset_id, t, price FROM price_history_v2 WHERE asset_id = ?').all('usd');
  assert.equal(rows2.length, 1);
  assert.equal(rows2[0].t, realUpstreamTs);

  // Also test buildHistoryMetadata keeps source/lastDataAt/resolution/dataStatus coherent
  const meta = buildHistoryMetadata({
    id: 'usd',
    range: '1D',
    source: 'd1_intraday',
    points: [[realUpstreamTs, 89000]],
    liveItem: { ...items.usd, src: 'nerkhara', priceType: 'published' },
    nowSec: laterNow,
    isDomestic: true
  });
  assert.equal(meta.priceSource, 'nerkhara');
  assert.equal(meta.lastDataAt, realUpstreamTs);
  assert.equal(meta.resolution, '5m');
  assert.equal(meta.dataStatus, 'published');
});

test('crypto icon mapping resolves by unique asset id/slug first and blocks wrong colliding-symbol fallbacks', async () => {
  __resetWorkerStateForTests();
  const maps = {
    localIcons: { btc: '/logos/crypto/btc.png' },
    idMap: { 'cat-coin': 'https://cdn.example/cat-coin.png', 'simon-cat': 'https://cdn.example/simon-cat.png' },
    nameMap: { catcoin: 'https://cdn.example/cat-coin.png' },
    symbolMap: { btc: 'https://wrong.example/btc.png', cat: 'https://cdn.example/wrong-cat.png', uniq: 'https://cdn.example/uniq.png' },
    symbolCounts: { btc: 1, cat: 2, uniq: 1 }
  };

  // 1. Exact ID match beats symbolMap
  assert.equal(resolveCryptoIconByAssetId({ id: 'btc', sym: 'BTC' }, maps), '/logos/crypto/btc.png');
  assert.equal(resolveCryptoIconByAssetId({ id: 'cat-coin', sym: 'CAT', name: 'Cat Coin' }, maps), 'https://cdn.example/cat-coin.png');
  assert.equal(resolveCryptoIconByAssetId({ id: 'simon-cat', sym: 'CAT', name: 'Simon Cat' }, maps), 'https://cdn.example/simon-cat.png');

  // 2. Unmapped asset sharing colliding symbol CAT must NOT inherit the wrong CAT logo
  assert.equal(resolveCryptoIconByAssetId({ id: 'unknown-cat', sym: 'CAT', name: 'Unknown Cat' }, maps), '');

  // 3. Unique non-colliding symbol can still resolve via symbolMap when ID/name absent
  assert.equal(resolveCryptoIconByAssetId({ id: 'unique-asset', sym: 'UNIQ', name: 'Unique Asset' }, maps), 'https://cdn.example/uniq.png');

  // 4. Verify src/index.html client getCryptoIcon & detail source metadata element are wired cleanly
  const html = fs.readFileSync(new URL('./src/index.html', import.meta.url), 'utf8');
  assert.ok(html.includes('function getClientCryptoSymbolCounts()'));
  assert.ok(html.includes('id="detailSourceMeta"'));
  assert.ok(html.includes('منبع قیمت'));
  assert.ok(html.includes('آخرین داده واقعی'));
  assert.ok(html.includes('دقت نمونه‌برداری'));
  assert.ok(html.includes('وضعیت داده'));
});

test('filterIsolatedHistorySpikes removes single-point glitch while preserving real drops/rallies, and splitHistoryGapSegments breaks genuine gaps', async () => {
  const { filterIsolatedHistorySpikes, splitHistoryGapSegments } = await import('./src/modules/market-core.js');
  const t0 = 1700000000;

  // Single-tick outlier glitch (100 -> 145 -> 101): neighbors within 1%, middle spikes +44% -> removed
  const withSpike = [
    [t0, 100],
    [t0 + 300, 101],
    [t0 + 600, 145],
    [t0 + 900, 101.5],
    [t0 + 1200, 102]
  ];
  const cleaned = filterIsolatedHistorySpikes(withSpike, true);
  assert.deepEqual(cleaned.map(p => p[1]), [100, 101, 101.5, 102]);

  // Genuine crash/trend (100 -> 70 -> 68): neighbors differ widely (32%), NOT removed
  const genuineCrash = [
    [t0, 100],
    [t0 + 300, 70],
    [t0 + 600, 68]
  ];
  assert.deepEqual(filterIsolatedHistorySpikes(genuineCrash, false).map(p => p[1]), [100, 70, 68]);

  // Gap segmentation breaks across real outage gap (>7200s for 1D crypto) while keeping domestic overnight closure connected
  const gapped = [
    [t0, 100],
    [t0 + 300, 101],
    [t0 + 10800, 105],
    [t0 + 11100, 106]
  ];
  const segs = splitHistoryGapSegments(gapped, '1D', false);
  assert.equal(segs.length, 2);
  assert.equal(segs[0].length, 2);
  assert.equal(segs[1].length, 2);
  assert.equal(splitHistoryGapSegments(gapped, '1D', true).length, 1);
  assert.equal(splitHistoryGapSegments([[t0, 100], [t0 + 80000, 105]], '1D', true).length, 2);
});

test('pruneStaleCryptoItems drops delisted/stale crypto coins on healthy feed while preserving on failed/partial feed', async () => {
  const { pruneStaleCryptoItems } = await import('./src/modules/market-core.js');
  const sampleItems = {
    usd: { price: 89000, kind: 'domestic' },
    usdt: { price: 90000, kind: 'domestic' },
    btc: { price: 95000, kind: 'crypto' },
    eth: { price: 3200, kind: 'crypto' },
    deadcoin: { price: 0.4, kind: 'crypto' }
  };
  const smallFeed = new Set(['btc', 'eth']);
  assert.equal(pruneStaleCryptoItems(sampleItems, smallFeed), 0);
  assert.ok(sampleItems.deadcoin, 'Partial feed must not prune snapshot items');

  const fullFreshIds = new Set(Array.from({ length: 18 }, (_, idx) => idx === 0 ? 'btc' : idx === 1 ? 'eth' : `coin${idx}`));
  const pruned = pruneStaleCryptoItems(sampleItems, fullFreshIds);
  assert.equal(pruned, 1);
  assert.equal(sampleItems.deadcoin, undefined);
  assert.ok(sampleItems.btc && sampleItems.eth && sampleItems.usd && sampleItems.usdt);
});

test('POST /api/admin/clear-cache clears KV, D1 kv, edge cache, and isolate memory while preserving user accounts and price_history_v2', async () => {
  __resetWorkerStateForTests();
  const now = Math.floor(Date.now() / 1000);
  const db = new DatabaseSync(':memory:');
  db.exec(fs.readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
  const { DB } = createSqliteD1Wrapper(db);

  const kvStore = new Map([
    [KV_SNAPSHOT_KEY, '{"ts":1,"items":{}}'],
    ['hist_cache:usdt:1D', '{"points":[]}'],
    ['backup:asset_transfer:keep', '{"keep":true}']
  ]);
  const deletedKvKeys = [];
  const mockKv = {
    async get(k, opts) {
      const raw = kvStore.get(k);
      return raw && opts?.type === 'json' ? JSON.parse(raw) : raw;
    },
    async put(k, v) { kvStore.set(k, v); },
    async delete(k) { deletedKvKeys.push(k); kvStore.delete(k); }
  };

  db.prepare('INSERT INTO kv(k,v,updated_at) VALUES(?,?,?)').run('prices', '{"items":{}}', now);
  db.prepare('INSERT INTO kv(k,v,updated_at) VALUES(?,?,?)').run('backup:keep_me', '{"ok":1}', now);
  db.prepare('INSERT INTO price_history_v2(asset_id,t,price) VALUES(?,?,?)').run('usd', now - 600, 89000);

  const ownerEmail = 'owner-clear@example.com';
  const env = {
    DB,
    PRICES_KV: mockKv,
    ADMIN_EMAIL: ownerEmail,
    ADMIN_PASSWORD: 'OwnerClearPass!123',
    AUTH_SECRET: 'test-auth-secret-key-minimum-32-chars!!'
  };
  const ownerPassHash = await hashPassword('OwnerClearPass!123', env);
  db.prepare('INSERT INTO users(id,email,name,password_hash,created_at) VALUES(?,?,?,?,?)').run('u_clear', ownerEmail, 'Owner', ownerPassHash, now - 100);

  const callApi = (path, { method = 'GET', body, token } = {}) =>
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
      env
    );

  const login = await (await callApi('/api/auth/login', { method: 'POST', body: { email: ownerEmail, password: 'OwnerClearPass!123' } })).json();
  const clearRes = await callApi('/api/admin/clear-cache', { method: 'POST', token: login.token });
  assert.equal(clearRes.status, 200);
  const clearBody = await clearRes.json();
  assert.equal(clearBody.ok, true);

  assert.equal(kvStore.has(KV_SNAPSHOT_KEY), false);
  assert.equal(kvStore.has('hist_cache:usdt:1D'), false);
  assert.equal(kvStore.has('backup:asset_transfer:keep'), true);
  assert.equal(db.prepare("SELECT k FROM kv WHERE k='prices'").get(), undefined);
  assert.equal(db.prepare("SELECT k FROM kv WHERE k='backup:keep_me'").get().k, 'backup:keep_me');
  assert.equal(db.prepare('SELECT price FROM price_history_v2 WHERE asset_id=?').get('usd').price, 89000);
});

test('All local crypto logos, 38 fiat SVG flags, and PWA manifest maskable paths exist cleanly without missing files', () => {
  const iconsIndex = JSON.parse(fs.readFileSync(new URL('./public/logos/icons.json', import.meta.url), 'utf8'));
  const iconKeys = Object.keys(iconsIndex);
  assert.ok(iconKeys.length >= 2000, `Expected >=2000 local crypto logos, found ${iconKeys.length}`);
  for (const sym of ['btc', 'eth', 'usdt', 'sol', 'xrp', 'doge', 'pepe', 'ton']) {
    const rel = iconsIndex[sym];
    assert.ok(rel && fs.existsSync(new URL(`./public${rel}`, import.meta.url)), `Missing critical local logo for ${sym}`);
  }

  const expectedFlags = ['ae','af','am','au','az','bh','br','ca','ch','cn','dk','eu','gb','ge','hk','in','iq','ir','jp','kg','kr','kw','kz','my','no','nz','om','qa','ru','sa','se','sg','th','tj','tm','tr','us','uz'];
  for (const code of expectedFlags) {
    const p = new URL(`./public/logos/flags/${code}.svg`, import.meta.url);
    assert.ok(fs.existsSync(p) && fs.statSync(p).size > 80, `Missing or empty flag SVG: ${code}.svg`);
  }

  const pubManifest = JSON.parse(fs.readFileSync(new URL('./public/manifest.webmanifest', import.meta.url), 'utf8'));
  const pubMaskable = pubManifest.icons.find(ic => String(ic.purpose || '').includes('maskable'));
  const workerSrc = fs.readFileSync(new URL('./src/worker.js', import.meta.url), 'utf8');
  assert.equal(pubMaskable.src, '/icons/icon-maskable-512.png');
  assert.ok(workerSrc.includes("src: '/icons/icon-maskable-512.png'"));
  assert.ok(fs.existsSync(new URL('./public/icons/icon-maskable-512.png', import.meta.url)));

  // Verify index.html keeps exact 6 inline <script> blocks and zero inline on*= handlers
  const html = fs.readFileSync(new URL('./src/index.html', import.meta.url), 'utf8');
  const scriptMatches = html.match(/<script\b[^>]*>/gi) || [];
  assert.equal(scriptMatches.length, 6, `Expected 6 <script> tags in src/index.html for CSP parity, got ${scriptMatches.length}`);
  assert.equal(/\bon(?:error|submit|click|load|change|input)\s*=\s*["']/.test(html), false, 'Inline on*= attribute violates strict CSP');
});

test('Admin API feed priority changes persist across isolates, control upstream fetch order, and report timerLimited vs real pingMs', async () => {
  __resetWorkerStateForTests();
  const now = Math.floor(Date.now() / 1000);
  const db = new DatabaseSync(':memory:');
  db.exec(fs.readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
  const { DB } = createSqliteD1Wrapper(db);

  const adminEmail = 'feed-admin@example.com';
  const env = {
    DB,
    ADMIN_EMAIL: adminEmail,
    ADMIN_PASSWORD: 'FeedAdminPass!123',
    AUTH_SECRET: 'test-auth-secret-key-minimum-32-chars!!'
  };
  const passHash = await hashPassword('FeedAdminPass!123', env);
  db.prepare('INSERT INTO users(id,email,name,password_hash,created_at) VALUES(?,?,?,?,?)')
    .run('u_feed_adm', adminEmail, 'FeedAdmin', passHash, now - 100);

  const callApi = (path, { method = 'GET', body, token } = {}) =>
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
      env
    );

  const login = await (await callApi('/api/auth/login', {
    method: 'POST',
    body: { email: adminEmail, password: 'FeedAdminPass!123' }
  })).json();
  assert.ok(login.token);

  // Move f_okx up twice so it sits ahead of f_kucoin in crypto priority
  let r1 = await (await callApi('/api/admin/feeds/f_okx/move-up', { method: 'POST', token: login.token })).json();
  assert.equal(r1.ok, true);
  r1 = await (await callApi('/api/admin/feeds/f_okx/move-up', { method: 'POST', token: login.token })).json();
  assert.equal(r1.ok, true);

  // Move f_bonbast above f_nerkhara in domestic priority
  const bonbastIdx = r1.feeds.findIndex(f => f.id === 'f_bonbast');
  const nerkharaIdx = r1.feeds.findIndex(f => f.id === 'f_nerkhara');
  assert.ok(bonbastIdx > nerkharaIdx);
  for (let s = bonbastIdx; s > nerkharaIdx; s--) {
    await callApi('/api/admin/feeds/f_bonbast/move-up', { method: 'POST', token: login.token });
  }

  // Simulate cold worker isolate reading persisted system_feeds from D1
  __resetWorkerStateForTests();
  const afterCold = await (await callApi('/api/admin/feeds', { token: login.token })).json();
  const okxRank = afterCold.feeds.findIndex(f => f.id === 'f_okx');
  const kucoinRank = afterCold.feeds.findIndex(f => f.id === 'f_kucoin');
  const bonRank = afterCold.feeds.findIndex(f => f.id === 'f_bonbast');
  const nerkhRank = afterCold.feeds.findIndex(f => f.id === 'f_nerkhara');
  assert.ok(okxRank < kucoinRank, `Expected OKX (${okxRank}) ahead of KuCoin (${kucoinRank}) after D1 reload`);
  assert.ok(bonRank < nerkhRank, `Expected Bonbast (${bonRank}) ahead of NerkhAra (${nerkhRank}) after D1 reload`);

  // Verify refreshPrices consults OKX first (succeeds without hitting KuCoin) and prefers Bonbast over NerkhAra for USD when Bonbast has higher admin priority
  const calledUrls = [];
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const u = typeof input === 'string' ? input : input?.url || '';
    calledUrls.push(u);
    if (u.includes('nerkhara.com')) {
      const iso = new Date(now * 1000).toISOString();
      return new Response(JSON.stringify({
        stale: false,
        generated_utc: iso,
        items: [
          { id: 'usd', price: 85000, unit: 'IRT', updated_utc: iso },
          { id: 'eur', price: 92000, unit: 'IRT', updated_utc: iso }
        ]
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (u.includes('bonbast.com/json')) {
      return new Response(JSON.stringify({ usd1: 89100, eur1: 96000, gbp1: 112000, try1: 2550 }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
    if (u.includes('bonbast.com')) {
      return new Response('<script>var param = "mock_bonbast_param";</script>', {
        status: 200,
        headers: { 'content-type': 'text/html' }
      });
    }
    if (u.includes('okx.com/api/v5/market/tickers')) {
      const data = Array.from({ length: 16 }, (_, i) => ({
        instId: i === 0 ? 'BTC-USDT' : `OKX${i}-USDT`,
        last: String(93000 + i),
        open24h: String(92000 + i),
        volCcy24h: '1200000'
      }));
      return new Response(JSON.stringify({ code: '0', data }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
    return new Response('{}', { status: 404 });
  };

  try {
    const refRes = await refreshPrices(env, true, true);
    assert.equal(refRes.items.btc.price, 93000);
    assert.equal(refRes.items.btc.src, 'okx');
    assert.ok(calledUrls.some(u => u.includes('okx.com')), 'Expected OKX to be fetched first');
    assert.equal(calledUrls.some(u => u.includes('kucoin.com')), false, 'KuCoin should not be called when higher-priority OKX succeeds');
    assert.ok(calledUrls.some(u => u.includes('bonbast.com')), 'Expected Bonbast to be queried');
    assert.equal(refRes.items.usd.src, 'bonbast', 'Expected USD to use Bonbast price when Bonbast is prioritized above NerkhAra');
    assert.equal(refRes.items.usd.price, 89100);

    // Ping test with simulated real delay (>0ms) reports accurate pingMs and saves it
    const origPerfNow = performance.now;
    let fakeNow = 1000;
    performance.now = () => fakeNow;
    globalThis.fetch = async () => {
      fakeNow += 42;
      return new Response('{"code":"0"}', { status: 200 });
    };
    const realPingRes = await (await callApi('/api/admin/feeds/f_okx/test', { method: 'POST', token: login.token })).json();
    assert.equal(realPingRes.ok, true);
    assert.equal(realPingRes.pingMs, 42);
    assert.equal(realPingRes.timerLimited, false);

    // Ping test when runtime freezes clock (0ms delta) returns pingMs: null & timerLimited: true (never fake 1 ms!)
    globalThis.fetch = async () => new Response('{"code":"0"}', { status: 200 });
    const zeroPingRes = await (await callApi('/api/admin/feeds/f_okx/test', { method: 'POST', token: login.token })).json();
    assert.equal(zeroPingRes.ok, true);
    assert.equal(zeroPingRes.pingMs, null);
    assert.equal(zeroPingRes.timerLimited, true);
    performance.now = origPerfNow;
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('Portfolio gray pre-purchase chart split, clean converter naming, centered #editFeatured icon, and scroll preload are properly wired', () => {
  const html = fs.readFileSync(new URL('./src/index.html', import.meta.url), 'utf8');

  // 1. Centered 3-dot SVG icon for #editFeatured
  assert.match(html, /<button class="icon-btn" id="editFeatured"[^>]*><svg[^>]*viewBox="0 0 24 24"/);
  assert.doesNotMatch(html, /id="editFeatured"[^>]*>⋮<\/button>/);

  // 2. Converter uses clean displayName and does NOT append targetUnit twice inside #convValue
  assert.ok(html.includes('function convDisplayName('));
  assert.ok(html.includes('valEl.textContent = formatEnPrice(targetVal, isDomesticTarget ? 0 : undefined);'));
  assert.doesNotMatch(html, /valEl\.textContent\s*=\s*formatEnPrice\([^)]+\)\s*\+\s*' '\s*\+\s*targetUnit/);

  // 3. Portfolio chart defines positionsAtTimeStrict, splitTs pre/post separation, and renders gray + colored SVG phases
  assert.ok(html.includes('function positionsAtTimeStrict('));
  assert.ok(html.includes('data-chart-phase="pre"'));
  assert.ok(html.includes('data-chart-phase="post"'));
  assert.ok(html.includes('#94a3b8'));

  // 4. Ahead-of-scroll sparkline preloading restored cleanly
  assert.ok(html.includes("rootMargin:'900px 0px'"));
  assert.ok(html.includes('r.top < vh + 950'));
  assert.ok(html.includes('while(sparkActive<3&&sparkQueue.length)'));
});

test('IQD fractional history precision, chartGeometry vertical scaling on 177-178 (0.56%), and dynamic isDomestic detection work accurately', async () => {
  __resetWorkerStateForTests();

  // 1. Decimal precision helper preserves fractional domestic rates without IEEE noise
  assert.equal(preservePricePrecision(177.25), 177.25);
  assert.equal(preservePricePrecision(1774 / 10), 177.4);
  assert.equal(preservePricePrecision(89500), 89500);

  // 2. recordD1DomesticHistory & /api/history preserve decimal prices in D1 without rewriting existing rows
  const db = new DatabaseSync(':memory:');
  db.exec(fs.readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
  const { DB } = createSqliteD1Wrapper(db);
  const now = Math.floor(Date.now() / 1000);
  const legacyTs = now - 85000;
  const ts1 = now - 3600;
  const ts2 = now - 1800;

  // Seed legacy row — must never be altered or rewritten
  db.prepare('INSERT INTO price_history_v2 (asset_id, t, price) VALUES (?, ?, ?)').run('iqd', legacyTs, 177);

  const kvStore = new Map();
  const mockKv = {
    async get(k, opts) {
      const raw = kvStore.get(k);
      return raw && opts?.type === 'json' ? JSON.parse(raw) : raw;
    },
    async put(k, v) {
      kvStore.set(k, typeof v === 'string' ? v : JSON.stringify(v));
    }
  };

  const env = { DB, PRICES_KV: mockKv };
  await recordD1DomesticHistory(env, {
    iqd: { price: 177.25, unit: 'IRT', kind: 'domestic', t: ts1, sourceTimestamp: ts1, receivedAt: ts1 }
  }, ts1, true);
  await recordD1DomesticHistory(env, {
    iqd: { price: 177.8, unit: 'IRT', kind: 'domestic', t: ts2, sourceTimestamp: ts2, receivedAt: ts2 }
  }, ts2, true);

  const d1Rows = db.prepare('SELECT t, price FROM price_history_v2 WHERE asset_id = ? ORDER BY t ASC').all('iqd');
  assert.equal(d1Rows.length, 3);
  assert.deepEqual(d1Rows.map(r => [r.t, r.price]), [
    [legacyTs, 177],
    [ts1, 177.25],
    [ts2, 177.8]
  ]);

  kvStore.set(KV_SNAPSHOT_KEY, JSON.stringify({
    version: 1,
    updatedAt: ts2,
    checkedAt: now - 5,
    items: {
      iqd: { price: 177.8, unit: 'IRT', kind: 'domestic', sym: 'IQD', name: 'دینار عراق', src: 'bonbast', t: ts2, sourceTimestamp: ts2, receivedAt: now - 5 }
    },
    feeds: {}
  }));

  const histRes = await history(env, new URL('https://darayi.example/api/history?id=iqd&range=1D'), { waitUntil() {} });
  const histJson = await histRes.json();
  assert.equal(histRes.status, 200);
  assert.equal(histJson.isDomestic, true);
  assert.deepEqual(histJson.points, [
    [legacyTs, 177],
    [ts1, 177.25],
    [ts2, 177.8]
  ]);

  // 3. Evaluate actual chart functions from src/index.html for IQD 177 & 178 (0.56% move)
  const html = fs.readFileSync(new URL('./src/index.html', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /paintChart\(box,\s*pts,\s*chartColor,\s*valFormatter,\s*\{\s*isDaily:\s*res\.isDaily,\s*range:\s*res\.apiRange \|\| range,\s*isDomestic:\s*false/);
  assert.ok(html.includes('paintChart(box,pts,chartColor,(n,dec)=>quote(a,n,dec),{isDaily:isDailyTooltip,range,isDomestic});'));

  const fnStart = html.indexOf('function isDomesticMarketAsset(');
  const fnEnd = html.indexOf('function paintChart(');
  assert.ok(fnStart > 0 && fnEnd > fnStart);
  const fmtStart = html.indexOf('function countDecimals(');
  const fmtEnd = html.indexOf('function quoteUnit(');
  assert.ok(fmtStart > 0 && fmtEnd > fmtStart);

  let seq = 0;
  const ctx = {
    Number, Math, Array, Boolean, Infinity,
    uid: () => String(++seq),
    histories: new Map(),
    asset: (id) => id === 'iqd' ? { id: 'iqd', cat: 'currency', currency: 'IRT' } : { id, cat: 'crypto', currency: 'USDT' },
    withCurrent: (p) => p,
    escapeHtml: (s) => String(s),
    document: { querySelectorAll: () => [] }
  };
  vm.createContext(ctx);
  vm.runInContext(html.slice(fmtStart, fmtEnd) + '\n' + html.slice(fnStart, fnEnd), ctx);

  // Flat price (0% move) stays strictly horizontal line
  const flatGeom = ctx.chartGeometry([[now - 3600, 177], [now - 1800, 177], [now, 177]]);
  assert.equal(Math.max(...flatGeom.map(p => p[1])) - Math.min(...flatGeom.map(p => p[1])), 0);

  // Restored original chartGeometry & sparkline scaling map [min..max] cleanly across active height without artificial flattening or extra grid/y-label overlays
  const iqdPts = [
    [now - 3600 * 4, 177],
    [now - 3600 * 3, 178],
    [now - 3600 * 2, 177],
    [now - 3600 * 1, 178]
  ];
  const geomIqd = ctx.chartGeometry(iqdPts);
  const ysIqd = geomIqd.map(pt => pt[1]);
  assert.equal(Math.max(...ysIqd) - Math.min(...ysIqd), 140);
  const rawPct = ((178 - 177) / 177) * 100;
  assert.ok(Math.abs(rawPct - 0.56497) < 0.001);

  const detailSvg = ctx.chartSVG(iqdPts, '#10b981', true, false, '1D', true);
  assert.equal(detailSvg.includes('class="chart-grid"'), false);
  assert.equal(detailSvg.includes('class="chart-baseline"'), false);

  const sparkSvg = ctx.chartSVG(iqdPts, '#10b981', true, true, '1D', true);
  const pathMatch = /<path d="M([^"]+)" fill="none"/.exec(sparkSvg);
  assert.ok(pathMatch, 'Expected sparkline stroke path in SVG');
  const sparkYs = pathMatch[1].split(' L').map(pair => Number(pair.split(',')[1])).filter(Number.isFinite);
  assert.equal(Math.max(...sparkYs) - Math.min(...sparkYs), 34);

  // Unsorted / duplicate / invalid points are normalized deterministically
  const messyNorm = ctx.normalizeChartPoints([[now - 100, 178], [now - 200, 177], [now - 100, 177.6], [now - 50, -5], [now - 30, NaN]]);
  assert.deepEqual(Array.from(messyNorm, p => [p[0], p[1]]), [[now - 200, 177], [now - 100, 177.6]]);

  // Asset-type detection & gap thresholds
  assert.equal(ctx.isDomesticMarketAsset({ id: 'iqd', cat: 'currency', currency: 'IRT' }), true);
  assert.equal(ctx.isDomesticMarketAsset({ id: 'gold18', cat: 'gold', currency: 'IRT' }), true);
  assert.equal(ctx.isDomesticMarketAsset({ id: 'btc', cat: 'crypto', currency: 'USDT' }), false);
  assert.equal(ctx.isDomesticMarketAsset({ id: 'usdt', cat: 'crypto', currency: 'IRT' }, { isDomestic: true }), false);
  assert.equal(ctx.isDomesticMarketAsset({ id: 'custom', cat: 'crypto' }, { isDomestic: true }), true);
  // 14h overnight Tehran gap stays connected for domestic (18h threshold), splits for crypto (2h threshold)
  const overnightPts = [[now - 15 * 3600, 177], [now - 14 * 3600, 177.2], [now, 177.8]];
  assert.equal(ctx.splitClientChartGapSegments(overnightPts, '1D', true).length, 1);
  assert.equal(ctx.splitClientChartGapSegments(overnightPts, '1D', false).length, 2);

  // Format helper preserves exact decimals when dec is passed (Tooltip) while rounding when maxDec=0 (Card display)
  assert.equal(ctx.formatEnPrice(177.45, 2), '177.45');
  assert.equal(ctx.formatEnPrice(177, 2), '177');
  assert.equal(ctx.formatEnPrice(177.45, 0), '177');
});

test('Logo system: cached symbol counts, lazy-by-default 30x30 icons, progressive pickers, SWR cache headers, and <=50KB crypto logos', () => {
  const html = fs.readFileSync(new URL('./src/index.html', import.meta.url), 'utf8');
  const headersTxt = fs.readFileSync(new URL('./public/_headers', import.meta.url), 'utf8');
  const serverTxt = fs.readFileSync(new URL('./server.ts', import.meta.url), 'utf8');

  // 1. /logos/* headers use stale-while-revalidate (no immutable on mutable filenames)
  assert.match(headersTxt, /\/logos\/\*\r?\n\s+Cache-Control:\s*public,\s*max-age=86400,\s*stale-while-revalidate=604800/);
  assert.doesNotMatch(headersTxt, /\/logos\/\*\r?\n[^\n]*immutable/);
  assert.equal(serverTxt.includes("app.use('/logos'") && serverTxt.includes('immutable: true'), false);
  assert.ok(serverTxt.includes('public, max-age=86400, stale-while-revalidate=604800'));

  // 2. All files in public/logos/crypto are <= 50KB and have valid magic bytes matching extension
  const cryptoDir = new URL('./public/logos/crypto/', import.meta.url);
  for (const name of fs.readdirSync(cryptoDir)) {
    const p = new URL(name, cryptoDir);
    const stat = fs.statSync(p);
    assert.ok(stat.size <= 50 * 1024, `Crypto logo exceeds 50KB budget: ${name} (${stat.size} bytes)`);
    const buf = fs.readFileSync(p);
    const ext = name.split('.').pop().toLowerCase();
    if (ext === 'png') {
      assert.ok(buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47, `Invalid PNG magic bytes: ${name}`);
    } else if (ext === 'jpg') {
      assert.ok(buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF, `Invalid JPG magic bytes: ${name}`);
    }
  }

  // 3. Extract icon helper + converter + picker code cleanly and verify via VM
  const iconSliceStart = html.indexOf('function normalizeClientCryptoIconName(');
  const iconSliceEnd = html.indexOf('const AUTH_TOKEN_KEY=');
  assert.ok(iconSliceStart > 0 && iconSliceEnd > iconSliceStart);

  const convStart = html.indexOf('function convDisplayName(');
  const convEnd = html.indexOf('function calculateConversion(');
  assert.ok(convStart > 0 && convEnd > convStart);

  const pickerStart = html.indexOf('function renderAssetPickerRow(');
  const pickerEnd = html.indexOf('function buyForm(');
  assert.ok(pickerStart > 0 && pickerEnd > pickerStart);

  const syntheticAssets = [
    { id: 'usd', name: 'دلار آمریکا', symbol: 'USD', cat: 'currency', price: 90000, currency: 'IRT' },
    { id: 'gold18', name: 'طلای ۱۸ عیار', symbol: 'GOLD18', cat: 'gold', price: 6500000, currency: 'IRT' },
    ...Array.from({ length: 140 }, (_, i) => ({
      id: i === 130 ? 'doge' : `coin${i}`,
      name: i === 130 ? 'دوج کوین' : `Coin ${i}`,
      en: i === 130 ? 'Dogecoin' : `Coin ${i}`,
      symbol: i === 130 ? 'DOGE' : `C${i}`,
      cat: 'crypto',
      price: 1 + i,
      currency: 'USDT',
      vol: 100000 - i
    }))
  ];

  const sandbox = {
    window: {},
    document: { querySelectorAll: () => [] },
    LOCAL_CRYPTO_ICONS: { btc: '/logos/crypto/btc.png', doge: '/logos/crypto/doge.png', coin0: '/logos/crypto/btc.png' },
    ARZ_DIGITAL_ICONS: {},
    cryptoIcons: { btc: '/logos/crypto/btc.png', doge: '/logos/crypto/doge.png', coin0: '/logos/crypto/btc.png' },
    LOCAL_FLAG_CODES: new Set(['us', 'ir', 'tr', 'gb']),
    REAL_X_CRYPTOS_CLIENT: new Set(['xrp']),
    PORTFOLIO_UNIT_NAMES: {},
    FA_COIN: {},
    assets: syntheticAssets,
    state: { featured: ['usd', 'gold18'] },
    fd: null,
    fmt: new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }),
    pct: new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    escapeHtml: (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    safeImgUrl: (u) => (/^https:\/\//i.test(String(u || '')) || String(u || '').startsWith('/')) ? String(u) : '',
    safeColor: (c, def = '#7357ff') => String(c || def),
    getBadgeColors: () => ['#3b82f6', '#1d4ed8'],
    assetTitles: (a) => ({ title: a.symbol || a.name, sub: a.name, isCrypto: a.cat === 'crypto' }),
    getCryptoFullName: (a) => a.en || a.name || '',
    cleanDisplayName: (_s, n) => n,
    normFa: (s) => String(s || '').toLowerCase().replace(/\s+/g, ''),
    sortAssetsStandard: (arr) => arr.slice(),
    quote: () => '100',
    spark: () => '',
    isAdminUser: () => false,
    quality: () => 'live',
    $: () => null,
    $$: () => [],
    openModal: () => {},
    closeModal: () => {},
    toast: () => {},
    persist: () => {},
    Set, Map, Array, String, Number, Object, Boolean, Math
  };
  sandbox.window.cryptoIcons = sandbox.cryptoIcons;
  vm.createContext(sandbox);

  const prefix = html.slice(iconSliceStart, iconSliceEnd)
    + '\n' + html.slice(convStart, convEnd)
    + '\n' + html.slice(pickerStart, pickerEnd);
  vm.runInContext(prefix, sandbox);

  // A. Cached symbol counts memoize across calls and recompute when assets change
  const c1 = sandbox.getClientCryptoSymbolCounts();
  const c2 = sandbox.getClientCryptoSymbolCounts();
  assert.equal(c1, c2, 'Expected memoized object identity while assets array unchanged');
  assert.equal(c1.doge, 1);

  sandbox.assets.push({ id: 'doge2', name: 'Fake Doge', symbol: 'DOGE', cat: 'crypto', price: 0.1, currency: 'USDT' });
  const c3 = sandbox.getClientCryptoSymbolCounts();
  assert.notEqual(c3, c1, 'Expected recomputation when assets length changes');
  assert.equal(c3.doge, 2);

  // B. assetIcon defaults to loading="lazy" + width="30" height="30" + decoding="async", and supports eager override
  const lazyCryptoImg = sandbox.assetIcon({ id: 'doge', symbol: 'DOGE', name: 'Dogecoin', cat: 'crypto' });
  assert.ok(lazyCryptoImg.includes('loading="lazy"'));
  assert.ok(lazyCryptoImg.includes('width="30" height="30"'));
  assert.ok(lazyCryptoImg.includes('decoding="async"'));
  const eagerFlagImg = sandbox.assetIcon({ id: 'usd', symbol: 'USD', name: 'دلار', cat: 'currency' }, { loading: 'eager' });
  assert.ok(eagerFlagImg.includes('loading="eager"'));
  assert.ok(eagerFlagImg.includes('width="30" height="30"'));

  // C. Converter uses getCountryFlag cleanly for toman/rial with width/height/loading
  const tomanData = sandbox.convAssetData('toman');
  assert.ok(tomanData.iconHtml.includes('/logos/flags/ir.svg'));
  assert.ok(tomanData.iconHtml.includes('width="30" height="30"'));
  assert.ok(tomanData.iconHtml.includes('loading="lazy"'));

  // D. assetPicker renders only initial batch (<= 61 rows) while still including deep selected item beyond index 60
  const pickerHtml = sandbox.assetPicker('doge', 'alertAsset');
  const renderedButtons = (pickerHtml.match(/data-pick-asset=/g) || []).length;
  assert.equal(renderedButtons, 61, `Expected 60 batch items + 1 deep selected item, got ${renderedButtons}`);
  assert.ok(pickerHtml.includes('aria-checked="true" data-pick-asset="doge"'));
  assert.equal(pickerHtml.includes('loading="eager"'), false, 'Picker rows must never use eager image loading');
});


