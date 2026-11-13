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
import { D1_HISTORY_ASSET_IDS, KV_SNAPSHOT_KEY } from './src/modules/market-core.js';
import {
  saveData,
  rateLimit,
  writePricesKvSnapshot,
  getPrices,
  recordD1DomesticHistory,
  refreshMeta,
  history,
  __resetWorkerStateForTests
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

