import test from 'node:test';
import assert from 'node:assert/strict';
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
import { saveData } from './src/worker.js';

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
