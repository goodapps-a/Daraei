// فقط پیش‌نمایش AI Studio — پروداکشن = src/worker.js
import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  NERKHARA_MAP,
  BONBAST_MAP,
  parseBonbastPayload,
  preservePricePrecision,
  DOMESTIC_META,
  ALL_DOMESTIC_IDS,
  D1_HISTORY_ASSET_IDS,
  KV_SNAPSHOT_VERSION,
  parseUtcTimestamp,
  isTehranMarketOpen,
  isPriceItemStale,
  normalizeCandleOpenTimeSec,
  parseBinanceKlineEntry,
  buildHistoryMetadata,
  normalizeCryptoIconName,
  resolveCryptoIconByAssetId,
  filterIsolatedHistorySpikes,
  pruneStaleCryptoItems,
  setBoundedMapEntry
} from './src/modules/market-core.js';
import { buildLocalCryptoIconsMap } from './src/modules/local-icons.js';
import {
  buildHtmlCsp,
  extractInlineScriptBodies,
  teq,
  sha256Hex,
  hmacHex,
  createMemoryRateLimiter,
  cleanEmail,
  isEmail,
  okPass,
  normCode,
  getAdminEmails,
  getPrimaryAdminEmail,
  isEmailAdmin as isEnvAdminEmail,
  getConfiguredAdminPassword as getSharedAdminPassword,
  getAdminSecret,
  hashPassword,
  verifyPassword,
  parsePbkdf2Hash,
  iterOf,
  isSafePublicUrl,
  cleanData,
  validateTransactions
} from './src/modules/security.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

app.disable('x-powered-by');
app.use(express.json({ limit: '256kb' }));
function isPreviewRequest(req: express.Request): boolean {
  const host = String(req.headers.host || '').toLowerCase();
  const origin = String(req.headers.origin || req.headers.referer || '').toLowerCase();
  return (
    host.includes('.run.app') ||
    host.startsWith('localhost') ||
    host.startsWith('127.0.0.1') ||
    origin.includes('aistudio.google.com') ||
    origin.includes('.googleusercontent.com')
  );
}

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (!isPreviewRequest(req)) {
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  }
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  if (req.path.startsWith('/api/me') || req.path.startsWith('/api/auth') || req.path.startsWith('/api/admin') || req.path.startsWith('/api/download')) {
    res.setHeader('Cache-Control', 'no-store, no-cache, private, must-revalidate, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  next();
});

const memRateLimiter = createMemoryRateLimiter(5000);
function getClientIp(req: express.Request): string {
  const cf = req.headers['cf-connecting-ip'];
  if (typeof cf === 'string' && cf.trim()) return cf.trim().slice(0, 64);
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.trim()) return xff.split(',')[0].trim().slice(0, 64);
  return (req.socket?.remoteAddress || 'local').slice(0, 64);
}

function checkRateLimit(key: string, limit: number, windowSec: number): boolean {
  return memRateLimiter.check(key, limit, windowSec).allowed;
}

function verifyCsrf(req: express.Request): boolean {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return true;
  const secFetchSite = String(req.headers['sec-fetch-site'] || '').toLowerCase();
  if (secFetchSite === 'cross-site') return false;
  const rawHost = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim().toLowerCase();
  const allowedHosts = new Set([rawHost, String(req.headers.host || '').trim().toLowerCase()].filter(Boolean));
  const origin = String(req.headers.origin || '').trim();
  const referer = String(req.headers.referer || '').trim();
  if (origin) {
    if (origin === 'null') return false;
    try {
      const u = new URL(origin);
      if (allowedHosts.size && !allowedHosts.has(u.host.toLowerCase())) return false;
    } catch {
      return false;
    }
  } else if (referer) {
    try {
      const u = new URL(referer);
      if (allowedHosts.size && !allowedHosts.has(u.host.toLowerCase())) return false;
    } catch {
      return false;
    }
  }
  const ct = String(req.headers['content-type'] || '').toLowerCase();
  const xrw = String(req.headers['x-requested-with'] || '').toLowerCase();
  if (!ct.includes('application/json') && xrw !== 'xmlhttprequest') return false;
  return true;
}

app.use('/api', (req, res, next) => {
  if (!verifyCsrf(req)) {
    return res.status(403).json({ error: 'درخواست نامعتبر است (CSRF محافظت‌شده).' });
  }
  next();
});

// Persistent on-disk cache for genuine fetched prices (never seeded with fake data)
const CACHE_FILE = path.join(__dirname, 'cached-prices.json');
const INTRADAY_HISTORY_FILE = path.join(__dirname, 'cached-intraday-history.json');
let cachedPrices: any = { version: KV_SNAPSHOT_VERSION, updatedAt: 0, checkedAt: 0, items: {}, feeds: {} };
let lastFetchTime = 0;
let isFetching = false;

// Load previously persisted real cache from disk if available (filtering out any legacy seed_cache entries)
try {
  if (fs.existsSync(CACHE_FILE)) {
    const raw = fs.readFileSync(CACHE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.items === 'object') {
      const cleanItems: Record<string, any> = {};
      for (const [id, item] of Object.entries(parsed.items)) {
        const it: any = item;
        if (it && it.price > 0 && it.src && it.src !== 'seed_cache') {
          cleanItems[id] = it;
        }
      }
      cachedPrices.items = cleanItems;
      cachedPrices.updatedAt = parsed.updatedAt || 0;
      cachedPrices.checkedAt = parsed.checkedAt || parsed.updatedAt || 0;
      cachedPrices.feeds = parsed.feeds || {};
    }
  }
} catch (e) {
  console.warn('Failed to read cached-prices.json:', e);
}

// TGJU & Iranian market symbol mappings
const IRAN_MARKET_MAP: Record<string, [string, string, string, string]> = {
  usdt: ['USDT_IRR', 'تتر', 'USDT', 'crypto'],
  usd: ['USD_IRR_FREE', 'دلار آمریکا', 'USD', 'currency'],
  eur: ['EUR_IRR_FREE', 'یورو', 'EUR', 'currency'],
  gbp: ['GBP_IRR_FREE', 'پوند انگلیس', 'GBP', 'currency'],
  aed: ['AED_IRR_FREE', 'درهم امارات', 'AED', 'currency'],
  try: ['TRY_IRR_FREE', 'لیر ترکیه', 'TRY', 'currency'],
  cny: ['CNY_IRR_FREE', 'یوان چین', 'CNY', 'currency'],
  cad: ['CAD_IRR_FREE', 'دلار کانادا', 'CAD', 'currency'],
  aud: ['AUD_IRR_FREE', 'دلار استرالیا', 'AUD', 'currency'],
  chf: ['CHF_IRR_FREE', 'فرانک سوئیس', 'CHF', 'currency'],
  sar: ['SAR_IRR_FREE', 'ریال عربستان', 'SAR', 'currency'],
  qar: ['QAR_IRR_FREE', 'ریال قطر', 'QAR', 'currency'],
  kwd: ['KWD_IRR_FREE', 'دینار کویت', 'KWD', 'currency'],
  omr: ['OMR_IRR_FREE', 'ریال عمان', 'OMR', 'currency'],
  iqd: ['IQD_IRR_FREE', 'دینار عراق', 'IQD', 'currency'],
  afn: ['AFN_IRR_FREE', 'افغانی', 'AFN', 'currency'],
  rub: ['RUB_IRR_FREE', 'روبل روسیه', 'RUB', 'currency'],
  inr: ['INR_IRR_FREE', 'روپیه هند', 'INR', 'currency'],
  gold18: ['GOLD_18K_IRR', 'طلای ۱۸ عیار', 'Gold18', 'gold'],
  gold24: ['GOLD_24K_IRR', 'طلای ۲۴ عیار', 'Gold24', 'gold'],
  gram: ['GOLD_MESGHAL_IRR', 'مثقال طلا', 'Mesghal', 'gold'],
  coin: ['COIN_EMAMI_IRR', 'سکه امامی', 'Coin', 'gold'],
  bahar: ['COIN_BAHAR_IRR', 'سکه بهار آزادی', 'Bahar', 'gold'],
  halfcoin: ['COIN_HALF_IRR', 'نیم‌سکه', 'Half', 'gold'],
  quartercoin: ['COIN_QUARTER_IRR', 'ربع‌سکه', 'Quarter', 'gold'],
  gramcoin: ['COIN_GRAMI_IRR', 'سکه گرمی', 'Gram', 'gold'],
  silver999: ['SILVER_999_IRR', 'نقره ۹۹۹ (هر گرم)', 'Silver', 'gold']
};

// Domestic rate keys
const NERKH: Record<string, string[]> = {
  usd: ['dollar'], eur: ['euro'], gbp: ['pound', 'gbp'], aed: ['aed'], try: ['lira', 'try'],
  gold18: ['gold'], gold24: ['gold24'], gram: ['mesghal'], coin: ['coin'], halfcoin: ['half'], usdt: ['tether']
};
const DOMESTIC_EXTRA: Record<string, [string, string, string, string]> = {
  cny: ['yuan', 'یوان چین', 'CNY', 'currency'], cad: ['cad', 'دلار کانادا', 'CAD', 'currency'],
  aud: ['aud', 'دلار استرالیا', 'AUD', 'currency'], chf: ['chf', 'فرانک سوئیس', 'CHF', 'currency'],
  sar: ['sar', 'ریال عربستان', 'SAR', 'currency'], qar: ['qar', 'ریال قطر', 'QAR', 'currency'],
  kwd: ['kwd', 'دینار کویت', 'KWD', 'currency'], omr: ['omr', 'ریال عمان', 'OMR', 'currency'],
  iqd: ['iqd', 'دینار عراق', 'IQD', 'currency'], afn: ['afn', 'افغانی', 'AFN', 'currency'],
  rub: ['rub', 'روبل روسیه', 'RUB', 'currency'], inr: ['inr', 'روپیه هند', 'INR', 'currency'],
  bahar: ['bahar', 'سکه بهار آزادی', 'Bahar', 'gold'], quartercoin: ['quarter', 'ربع‌سکه', 'Quarter', 'gold'],
  gramcoin: ['gram', 'سکهٔ گرمی', 'Gram', 'gold'], silver999: ['silver', 'نقرهٔ ۹۹۹ (هر گرم)', 'Silver', 'gold'],
};
const ASSETS: Record<string, string> = {
  usd: 'دلار آمریکا', eur: 'یورو', gbp: 'پوند انگلیس', aed: 'درهم امارات', try: 'لیر ترکیه',
  gold18: 'طلای ۱۸ عیار', gold24: 'طلای ۲۴ عیار', coin: 'سکه امامی', halfcoin: 'نیم‌سکه', gram: 'طلای آب‌شده',
  btc: 'بیت‌کوین', eth: 'اتریوم', usdt: 'تتر', sol: 'سولانا', bnb: 'بایننس کوین', xrp: 'ریپل',
  sp500: 'شاخص S&P 500',
};
const NON_CRYPTO = new Set(['usd', 'eur', 'gbp', 'aed', 'try', 'gold18', 'gold24', 'coin', 'halfcoin', 'gram', 'sp500', 'usdt', ...Object.keys(DOMESTIC_EXTRA), ...Object.keys(IRAN_MARKET_MAP)]);

function jalaliToGregorian(jy: number, jm: number, jd: number): [number, number, number] {
  jy += 1595;
  let days = -355668 + 365 * jy + Math.trunc(jy / 33) * 8 + Math.trunc(((jy % 33) + 3) / 4) + jd + (jm < 7 ? (jm - 1) * 31 : (jm - 7) * 30 + 186);
  let gy = 400 * Math.trunc(days / 146097);
  days %= 146097;
  if (days > 36524) {
    gy += 100 * Math.trunc(--days / 36524);
    days %= 36524;
    if (days >= 365) days++;
  }
  gy += 4 * Math.trunc(days / 1461);
  days %= 1461;
  if (days > 365) {
    gy += Math.trunc((days - 1) / 365);
    days = (days - 1) % 365;
  }
  let gd = days + 1;
  const sal = [0, 31, (gy % 4 === 0 && gy % 100 !== 0) || gy % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let gm = 0;
  for (gm = 0; gm < 13 && gd > sal[gm]; gm++) gd -= sal[gm];
  return [gy, gm, gd];
}

function domesticTime(j: any, now = Date.now()): number | null {
  const d = /^(\d{4})\/(\d{2})\/(\d{2})$/.exec(j?.date || '');
  const h = /^(\d{2}):(\d{2})$/.exec(j?.time || '');
  if (!d || !h) return null;
  const [gy, gm, gd] = jalaliToGregorian(+d[1], +d[2], +d[3]);
  const t = (Date.UTC(gy, gm - 1, gd, +h[1], +h[2]) - 12600000) / 1000;
  return (t > 1500000000 && t <= now / 1000 + 3600) ? Math.floor(t) : null;
}

async function fetchJSON(url: string, seconds = 7) {
  const res = await fetch(url, {
    headers: {
      accept: 'application/json',
      'user-agent': 'Darayi/1.0 (personal portfolio app)'
    },
    signal: AbortSignal.timeout(seconds * 1000)
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// Multi-exchange crypto adapters with automatic fallback and OKX multi-page pagination
const EXCHANGE_SOURCES: Record<string, any> = {
  kucoin: {
    async tickers() {
      const j = await fetchJSON('https://api.kucoin.com/api/v1/market/allTickers', 6);
      const list = j && j.data && j.data.ticker;
      if (!Array.isArray(list)) throw new Error('KuCoin bad response');
      const ts = Number(j.data.time) > 0 ? Math.floor(+j.data.time / 1000) : null;
      return list.filter((x: any) => String(x.symbol).endsWith('-USDT')).map((x: any) => {
        const last = +x.last, cr = Number(x.changeRate);
        return {
          base: x.symbol.slice(0, -5),
          pair: x.symbol,
          last,
          open: Number.isFinite(cr) && cr > -1 ? last / (1 + cr) : NaN,
          vol: +x.volValue,
          ts
        };
      });
    },
    async klines(pair: string, iv: string, lim: number) {
      const sec: Record<string, number> = { '1m': 60, '5m': 300, '1h': 3600, '4h': 14400, '1d': 86400 };
      const type: Record<string, string> = { '1m': '1min', '5m': '5min', '1h': '1hour', '4h': '4hour', '1d': '1day' };
      const end = Math.floor(Date.now() / 1000);
      const s = sec[iv] || 300;
      const t = type[iv] || '5min';
      const j = await fetchJSON(`https://api.kucoin.com/api/v1/market/candles?type=${t}&symbol=${encodeURIComponent(pair)}&startAt=${end - s * lim}&endAt=${end}`, 5);
      return (j.data || []).map((c: any) => [normalizeCandleOpenTimeSec(c[0]), +c[2]]);
    }
  },
  okx: {
    async tickers() {
      const j = await fetchJSON('https://www.okx.com/api/v5/market/tickers?instType=SPOT', 6);
      if (j.code !== '0' || !Array.isArray(j.data)) throw new Error('OKX error');
      return j.data.filter((x: any) => String(x.instId).endsWith('-USDT')).map((x: any) => ({
        base: x.instId.slice(0, -5),
        pair: x.instId,
        last: +x.last,
        open: +x.open24h,
        vol: +x.volCcy24h,
        ts: Number(x.ts) > 0 ? Math.floor(+x.ts / 1000) : null
      }));
    },
    async klines(pair: string, iv: string, lim: number) {
      const bar: Record<string, string> = { '1m': '1m', '5m': '5m', '1h': '1H', '4h': '4H', '1d': '1D' };
      const b = bar[iv] || '5m';
      const firstLimit = Math.min(lim, 300);
      const j1 = await fetchJSON(`https://www.okx.com/api/v5/market/candles?instId=${encodeURIComponent(pair)}&bar=${b}&limit=${firstLimit}`, 5);
      const rows1 = Array.isArray(j1?.data) ? j1.data : [];
      let all = rows1.map((c: any) => [normalizeCandleOpenTimeSec(c[0]), +c[4]]);
      if (lim > 300 && rows1.length >= 200) {
        const oldestMs = rows1[rows1.length - 1]?.[0];
        if (oldestMs) {
          try {
            const remLimit = Math.min(300, lim - rows1.length + 10);
            const j2 = await fetchJSON(`https://www.okx.com/api/v5/market/candles?instId=${encodeURIComponent(pair)}&bar=${b}&after=${encodeURIComponent(oldestMs)}&limit=${remLimit}`, 5);
            if (Array.isArray(j2?.data) && j2.data.length) {
              all = all.concat(j2.data.map((c: any) => [normalizeCandleOpenTimeSec(c[0]), +c[4]]));
            }
          } catch {}
        }
      }
      return all;
    }
  },
  gate: {
    async tickers() {
      const rows = await fetchJSON('https://api.gateio.ws/api/v4/spot/tickers', 6);
      if (!Array.isArray(rows)) throw new Error('Gate error');
      return rows.filter((x: any) => String(x.currency_pair).endsWith('_USDT')).map((x: any) => {
        const last = +x.last, ch = Number(x.change_percentage);
        return {
          base: x.currency_pair.slice(0, -5),
          pair: x.currency_pair,
          last,
          open: Number.isFinite(ch) && ch > -100 ? last / (1 + ch / 100) : NaN,
          vol: +x.quote_volume,
          ts: null
        };
      });
    },
    async klines(pair: string, iv: string, lim: number) {
      const j = await fetchJSON(`https://api.gateio.ws/api/v4/spot/candlesticks?currency_pair=${encodeURIComponent(pair)}&interval=${iv}&limit=${Math.min(lim, 999)}`, 5);
      return Array.isArray(j) ? j.map((c: any) => [normalizeCandleOpenTimeSec(c[0]), +c[2]]) : [];
    }
  },
  binance: {
    async tickers() {
      const rows = await fetchJSON('https://data-api.binance.vision/api/v3/ticker/24hr?type=MINI', 5);
      if (!Array.isArray(rows)) throw new Error('Binance error');
      return rows.filter((x: any) => String(x.symbol).endsWith('USDT')).map((x: any) => ({
        base: String(x.symbol).slice(0, -4),
        pair: x.symbol,
        last: +x.lastPrice,
        open: +x.openPrice,
        vol: +x.quoteVolume,
        ts: Number(x.closeTime) > 0 ? Math.floor(+x.closeTime / 1000) : null
      }));
    },
    async klines(pair: string, iv: string, lim: number) {
      const rows = await fetchJSON(`https://data-api.binance.vision/api/v3/klines?symbol=${encodeURIComponent(pair)}&interval=${iv}&limit=${Math.min(lim, 1000)}`, 5);
      return Array.isArray(rows) ? rows.map(parseBinanceKlineEntry).filter(Boolean) : [];
    }
  }
};

const EXCLUDED_STABLES = new Set([
  'usdc','dai','fdusd','tusd','usdp','busd','pyusd','usdd','usds','usd1','usdg',
  'paxg','eurc','ustc','xaut','frax','usde','rlusd','lusd','gusd','crvusd',
  'fxusd','alusd','mim','bgt','usdn','usdx','ssv','susd','dola','deusd',
  'btcst','steth','wsteth','weeth','reth','cbeth','eeth','eurt','usdt0'
]);
const SKIP_BASES = new Set('USDT USDC FDUSD TUSD USDP BUSD DAI AEUR EUR GBP TRY BRL ARS UAH PLN RON CZK JPY MXN COP ZAR NGN RUB BIDR IDRT USD1 USDE XUSD USDS RLUSD CAD AUD CHF SAR QAR KWD OMR IQD AFN INR CNY'.split(' '));

export interface SystemFeed {
  id: string;
  name: string;
  url: string;
  type: 'crypto' | 'domestic' | 'tether' | 'websocket';
  status: 'active' | 'inactive';
  pingMs: number;
  reliability: string;
  priority: number;
  custom?: boolean;
}

let systemFeeds: SystemFeed[] = [
  { id: 'f_kucoin', name: 'KuCoin Tickers API', url: 'https://api.kucoin.com/api/v1/market/allTickers', type: 'crypto', status: 'active', pingMs: 48, reliability: '100%', priority: 1 },
  { id: 'f_okx', name: 'OKX Market Feed', url: 'https://www.okx.com/api/v5/market/tickers?instType=SPOT', type: 'crypto', status: 'active', pingMs: 62, reliability: '99.8%', priority: 2 },
  { id: 'f_gate', name: 'Gate.io Engine', url: 'https://api.gateio.ws/api/v4/spot/tickers', type: 'crypto', status: 'active', pingMs: 55, reliability: '100%', priority: 3 },
  { id: 'f_binance_rest', name: 'Binance Public REST API', url: 'https://data-api.binance.vision/api/v3/ticker/24hr', type: 'crypto', status: 'active', pingMs: 44, reliability: '99.9%', priority: 4 },
  { id: 'f_nerkhara', name: 'NerkhAra Validated Feed', url: 'https://nerkhara.com/api/v1/latest.json', type: 'domestic', status: 'active', pingMs: 34, reliability: '99.9%', priority: 5 },
  { id: 'f_bonbast', name: 'Bonbast Market Rate', url: 'https://www.bonbast.com', type: 'domestic', status: 'active', pingMs: 42, reliability: '99.7%', priority: 6 },
  { id: 'f_nerkh', name: 'TGJU / IranMarket Rate', url: 'https://iran-market.github.io/data/latest-toman.json', type: 'domestic', status: 'active', pingMs: 38, reliability: '99.6%', priority: 7 },
  { id: 'f_wallex', name: 'Wallex USDT/TMN Bridge', url: 'https://api.wallex.ir/v1/markets', type: 'tether', status: 'active', pingMs: 32, reliability: '100%', priority: 8 },
  { id: 'f_nobitex_ws', name: 'Nobitex USDT/IRT WebSocket', url: 'wss://ws.nobitex.ir/connection/websocket', type: 'tether', status: 'active', pingMs: 24, reliability: '99.9%', priority: 9 }
];

let domesticPrevCloseCache: Record<string, number[]> | null = null;
let domesticPrevCloseTime = 0;

async function getDomesticPrevCloses(): Promise<Record<string, number[]>> {
  const now = Math.floor(Date.now() / 1000);
  if (domesticPrevCloseCache && now - domesticPrevCloseTime < 1800) {
    return domesticPrevCloseCache;
  }
  try {
    const text = await getRatesArchiveText();
    if (!text) return domesticPrevCloseCache || {};
    const map: Record<string, number[]> = {};
    const allIds = [...new Set([...Object.keys(NERKH), ...Object.keys(DOMESTIC_EXTRA)])];
    for (const id of allIds) {
      if (id === 'usdt') continue;
      const key = (NERKH[id] || [])[0] || (DOMESTIC_EXTRA[id] || [])[0];
      if (!key) continue;
      const idx = text.indexOf(`"key":"${key}"`);
      if (idx === -1) continue;
      const daysIdx = text.indexOf('"days":', idx);
      const endDaysIdx = text.indexOf(']]', daysIdx);
      if (daysIdx === -1 || endDaysIdx === -1) continue;
      const days = JSON.parse(text.slice(daysIdx + 7, endDaysIdx + 2));
      if (Array.isArray(days) && days.length >= 2) {
        map[id] = days.slice(-6).map((x: any) => Number(x[1])).filter((v: number) => v > 0);
      }
    }
    if (Object.keys(map).length) {
      domesticPrevCloseCache = map;
      domesticPrevCloseTime = now;
    }
    return map;
  } catch {
    return domesticPrevCloseCache || {};
  }
}

function resolveDomesticChange(
  id: string,
  price: number,
  rawChange: any,
  prevClosesMap: Record<string, number[]>,
  prevItem: any
): number | null {
  const ch = Number(rawChange);
  if (Number.isFinite(ch) && Math.abs(ch) > 0.0001) return +ch.toFixed(2);
  const recent = prevClosesMap && prevClosesMap[id];
  if (Array.isArray(recent) && recent.length) {
    for (let i = recent.length - 1; i >= 0; i--) {
      const pClose = recent[i];
      if (pClose > 0 && Math.abs(price - pClose) / pClose > 0.0001 && Math.abs(price - pClose) / pClose < 0.25) {
        return +(((price - pClose) / pClose) * 100).toFixed(2);
      }
    }
  }
  if (prevItem && prevItem.price === price && Number.isFinite(prevItem.change) && Math.abs(prevItem.change) > 0.0001) {
    return prevItem.change;
  }
  return Number.isFinite(ch) ? +ch.toFixed(2) : null;
}

const domesticIntradayTicks = new Map<string, [number, number][]>();
let lastIntradayDiskFlush = 0;

// Load persisted real intraday history points (corresponding to D1 price_history_v2 in Cloudflare)
try {
  if (fs.existsSync(INTRADAY_HISTORY_FILE)) {
    const raw = JSON.parse(fs.readFileSync(INTRADAY_HISTORY_FILE, 'utf8'));
    const cutoff = Math.floor(Date.now() / 1000) - 7 * 86400;
    if (raw && typeof raw === 'object') {
      for (const [id, pts] of Object.entries(raw)) {
        if (Array.isArray(pts)) {
          const valid = pts
            .filter((p: any) => Array.isArray(p) && p.length === 2 && Number(p[0]) >= cutoff && Number(p[1]) > 0)
            .map((p: any) => [Math.floor(Number(p[0])), preservePricePrecision(p[1])] as [number, number]);
          if (valid.length) domesticIntradayTicks.set(id, valid);
        }
      }
    }
  }
} catch {}

function recordDomesticTick(id: string, ts: number, price: number) {
  if (!(price > 0) || !Number.isFinite(ts) || ts <= 1500000000) return;
  const exactPrice = preservePricePrecision(price);
  if (!(exactPrice > 0)) return;
  let arr = domesticIntradayTicks.get(id);
  if (!arr) {
    arr = [];
    domesticIntradayTicks.set(id, arr);
  }
  const cutoff = ts - 7 * 86400;
  while (arr.length && arr[0][0] < cutoff) arr.shift();
  const last = arr[arr.length - 1];
  if (!last || (ts - last[0] >= 180) || last[1] !== exactPrice) {
    if (last && last[0] === ts) {
      last[1] = exactPrice;
    } else if (!last || ts > last[0]) {
      arr.push([ts, exactPrice]);
    }
    if (arr.length > 600) arr.shift();
  }
}

function flushIntradayHistoryToDisk(nowSec: number) {
  if (nowSec - lastIntradayDiskFlush < 60) return;
  lastIntradayDiskFlush = nowSec;
  try {
    const out: Record<string, [number, number][]> = {};
    for (const [id, arr] of domesticIntradayTicks.entries()) {
      if (arr.length) out[id] = arr;
    }
    fs.writeFileSync(INTRADAY_HISTORY_FILE, JSON.stringify(out), 'utf8');
  } catch {}
}

async function fetchBonbastData(nowSec = Math.floor(Date.now() / 1000)) {
  try {
    const pageRes = await fetch('https://www.bonbast.com/', {
      headers: {
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
      },
      signal: AbortSignal.timeout(5000)
    });
    if (!pageRes.ok) return { dict: {}, ts: null };
    const html = await pageRes.text();
    const paramMatch = /param\s*:\s*["']([^"']+)["']/.exec(html) || /param\s*=\s*["']([^"']+)["']/.exec(html);
    const param = paramMatch && paramMatch[1];
    if (!param) return { dict: {}, ts: null };

    const setCookies = typeof pageRes.headers.getSetCookie === 'function'
      ? pageRes.headers.getSetCookie()
      : (pageRes.headers.get('set-cookie') ? [pageRes.headers.get('set-cookie') as string] : []);
    const cookieHeader = setCookies
      .map((c) => String(c).split(';')[0].trim())
      .filter(Boolean)
      .join('; ');

    const postRes = await fetch('https://www.bonbast.com/json', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
        origin: 'https://www.bonbast.com',
        referer: 'https://www.bonbast.com/',
        'x-requested-with': 'XMLHttpRequest',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        ...(cookieHeader ? { cookie: cookieHeader } : {})
      },
      body: 'param=' + encodeURIComponent(param),
      signal: AbortSignal.timeout(5000)
    });
    if (!postRes.ok) return { dict: {}, ts: null };
    const data = await postRes.json();
    return parseBonbastPayload(data, nowSec);
  } catch {
    return { dict: {}, ts: null };
  }
}

async function updateAllPrices(force = false) {
  if (isFetching) return cachedPrices;
  isFetching = true;
  const now = Math.floor(Date.now() / 1000);

  try {
    const items: Record<string, any> = { ...cachedPrices.items };
    const feeds: Record<string, any> = { ...cachedPrices.feeds };
    let freshCount = 0;

    const put = (
      id: string,
      price: number,
      change: number | null,
      src: string,
      sourceTimestamp: number | null,
      unit = 'IRT',
      extra: any = {}
    ): boolean => {
      if (!(price > 0) || !Number.isFinite(price)) return false;
      const old = items[id];
      const validSrcTs = (Number(sourceTimestamp) > 1500000000 && Number(sourceTimestamp) <= now + 600)
        ? Math.floor(Number(sourceTimestamp))
        : null;
      const finalChange = Number.isFinite(change)
        ? +Number(change).toFixed(2)
        : (old && old.price === price && Number.isFinite(old.change) ? old.change : null);
      const sameUnchangedPrice = Boolean(!validSrcTs && old && old.price === price && Number(old.t) > 1500000000);
      const effectiveT = validSrcTs || (sameUnchangedPrice ? Math.floor(Number(old.t)) : now);
      const preservedSrcTs = validSrcTs || (sameUnchangedPrice && Number(old?.sourceTimestamp) > 1500000000 ? Math.floor(Number(old.sourceTimestamp)) : null);
      items[id] = {
        price,
        change: finalChange,
        t: effectiveT,
        sourceTimestamp: preservedSrcTs,
        receivedAt: sameUnchangedPrice && Number(old?.receivedAt) > 1500000000 ? Math.floor(Number(old.receivedAt)) : now,
        checkedAt: now,
        src,
        unit,
        priceType: extra.priceType || 'last',
        upstreamStale: false,
        ...extra
      };
      if (unit === 'IRT') recordDomesticTick(id, effectiveT, price);
      freshCount++;
      return true;
    };

    // 1. Independent Tether & Per-Asset Domestic Rates (NerkhAra -> Bonbast -> IranMarket -> Nerkhsanj -> PersianToolbox)
    const domesticTask = async () => {
      const feedActiveMap = new Map(systemFeeds.map((f) => [f.id, f.status === 'active']));
      const feedPriorityMap = new Map(systemFeeds.map((f, idx) => [f.id, Number(f.priority) || (idx + 1)]));
      const isFeedOn = (id: string) => (feedActiveMap.has(id) ? feedActiveMap.get(id) : true);
      const feedPrio = (id: string, fallbackPrio: number) => (feedPriorityMap.has(id) ? (feedPriorityMap.get(id) as number) : fallbackPrio);
      const domesticFeedOrder = [
        { key: 'nerkhara', id: 'f_nerkhara', prio: feedPrio('f_nerkhara', 5) },
        { key: 'bonbast', id: 'f_bonbast', prio: feedPrio('f_bonbast', 6) },
        { key: 'iran_market', id: 'f_nerkh', prio: feedPrio('f_nerkh', 7) }
      ]
        .filter((x) => isFeedOn(x.id))
        .sort((a, b) => a.prio - b.prio)
        .map((x) => x.key);

      const [imResult, naResult, bbResult] = await Promise.allSettled([
        isFeedOn('f_nerkh') ? fetchJSON('https://iran-market.github.io/data/latest-toman.json', 5) : Promise.resolve(null),
        isFeedOn('f_nerkhara') ? fetchJSON('https://nerkhara.com/api/v1/latest.json', 5) : Promise.resolve(null),
        isFeedOn('f_bonbast') ? fetchBonbastData(now) : Promise.resolve({ dict: {}, ts: null })
      ]);

      const imData: any = imResult.status === 'fulfilled' ? imResult.value : null;
      const naData: any = naResult.status === 'fulfilled' ? naResult.value : null;
      const bbDict: Record<string, any> = (bbResult.status === 'fulfilled' && bbResult.value && bbResult.value.dict) ? bbResult.value.dict : {};

      const naDict: Record<string, any> = {};
      if (naData && naData.stale !== true && Array.isArray(naData.items)) {
        for (const it of naData.items) {
          if (it && it.id && it.stale !== true && it.unit === 'IRT' && Number(it.price) > 0) {
            const srcTs = parseUtcTimestamp(it.updated_utc || naData.generated_utc, now);
            if (!srcTs || (now - srcTs <= 72 * 3600)) {
              naDict[it.id] = { ...it, srcTs };
            }
          }
        }
      }

      const imDict: Record<string, any> = {};
      let imGenTs: number | null = null;
      if (imData && imData.data && imData.data.categories) {
        imGenTs = parseUtcTimestamp(imData.data.generated_at, now);
        const cats = imData.data.categories;
        const allList = [
          ...(cats.gold || []),
          ...(cats.coin || []),
          ...(cats.currency || []),
          ...(cats.crypto || []),
          ...(cats.precious_metal || [])
        ];
        for (const x of allList) {
          if (x && x.symbol && Number(x.price) > 0) {
            const itemTs = parseUtcTimestamp(x.timestamp, now) || imGenTs;
            imDict[x.symbol] = { ...x, srcTs: itemTs };
          }
        }
      }

      // A. Independent Tether (USDT/IRT)
      let usdtResolved = false;
      let usdtSourceUsed: string | null = null;

      try {
        const wx = await fetchJSON('https://api.wallex.ir/v1/markets', 4);
        const u = wx?.result?.symbols?.USDTTMN;
        const lastP = Number(u?.stats?.lastPrice);
        if (lastP > 10000) {
          const chg = Number.isFinite(Number(u?.stats?.['24h_ch'])) ? Number(u?.stats?.['24h_ch']) : null;
          put('usdt', Math.round(lastP), chg, 'wallex', null, 'IRT', {
            kind: 'crypto', name: 'تتر', symbol: 'USDT', priceType: 'last'
          });
          usdtResolved = true;
          usdtSourceUsed = 'wallex';
        }
      } catch {}

      if (!usdtResolved && naDict.usdt) {
        const nu = naDict.usdt;
        put('usdt', Math.round(Number(nu.price)), Number.isFinite(Number(nu.change_pct)) ? Number(nu.change_pct) : null, 'nerkhara', nu.srcTs, 'IRT', {
          kind: 'crypto', name: 'تتر', symbol: 'USDT',
          priceType: nu.method || 'volume-weighted',
          method: nu.method || 'volume-weighted',
          sourcesCount: Number(nu.sources) || undefined,
          spreadPct: Number.isFinite(Number(nu.spread_pct)) ? Number(nu.spread_pct) : undefined
        });
        usdtResolved = true;
        usdtSourceUsed = 'nerkhara';
      }

      if (!usdtResolved && imDict.USDT_IRR) {
        const iu = imDict.USDT_IRR;
        put('usdt', Math.round(Number(iu.price)), Number.isFinite(Number(iu.change_pct)) ? Number(iu.change_pct) : null, 'nobitex', iu.srcTs, 'IRT', {
          kind: 'crypto', name: 'تتر', symbol: 'USDT', priceType: 'last'
        });
        usdtResolved = true;
        usdtSourceUsed = 'nobitex';
      }

      if (!usdtResolved) {
        try {
          const tl = await fetchJSON('https://api.tetherland.com/currencies', 4);
          const u = tl?.data?.currencies?.USDT;
          if (u && Number(u.price) > 10000) {
            const chg = Number.isFinite(Number(u.diff24d)) ? Number(u.diff24d) : null;
            put('usdt', Math.round(Number(u.price)), chg, 'tetherland', null, 'IRT', {
              kind: 'crypto', name: 'تتر', symbol: 'USDT', priceType: 'last'
            });
            usdtResolved = true;
            usdtSourceUsed = 'tetherland';
          }
        } catch {}
      }

      if (!usdtResolved) {
        try {
          const bp = await fetchJSON('https://api.bitpin.ir/v1/mkt/markets/', 4);
          const m = (bp?.results || []).find((x: any) => x.code === 'USDT_IRT');
          if (m && Number(m.price) > 10000) {
            const chg = Number.isFinite(Number(m.price_info?.change)) ? Number(m.price_info?.change) : null;
            put('usdt', Math.round(Number(m.price)), chg, 'bitpin', null, 'IRT', {
              kind: 'crypto', name: 'تتر', symbol: 'USDT', priceType: 'last'
            });
            usdtResolved = true;
            usdtSourceUsed = 'bitpin';
          }
        } catch {}
      }

      if (!usdtResolved) {
        try {
          const wd = await fetchJSON('https://api.wallex.ir/v1/depth?symbol=USDTTMN', 3);
          const bestBid = Number(wd?.result?.bid?.[0]?.price);
          const bestAsk = Number(wd?.result?.ask?.[0]?.price);
          const mid = bestBid > 0 && bestAsk > 0 ? Math.round((bestBid + bestAsk) / 2) : (bestBid || bestAsk);
          if (mid > 10000) {
            put('usdt', mid, null, 'wallex_depth_mid', null, 'IRT', {
              kind: 'crypto', name: 'تتر', symbol: 'USDT', priceType: 'mid', method: 'orderbook_mid'
            });
            usdtResolved = true;
            usdtSourceUsed = 'wallex_depth_mid';
          }
        } catch {}
      }

      feeds.tether = { ok: usdtResolved, checkedAt: now, source: usdtSourceUsed || feeds.tether?.source || null };

      // B. Per-Asset Domestic Resolution (NerkhAra -> Bonbast -> IranMarket)
      const prevClosesMap = await getDomesticPrevCloses();
      const resolvedDomesticIds = new Set<string>();
      const sourcesSummary: Record<string, number> = {};
      const nerkharaHasUsdEur = Boolean(naDict.usd && naDict.eur);
      const bonbastHasUsdEur = Boolean(bbDict.usd && bbDict.eur);
      const iranMarketHasUsdEur = Boolean(imDict.USD_IRR_FREE && imDict.EUR_IRR_FREE);

      for (const id of ALL_DOMESTIC_IDS) {
        const meta = (DOMESTIC_META as any)[id];
        const imSym = (IRAN_MARKET_MAP[id] || [])[0];
        const naKey = (NERKHARA_MAP as any)[id];
        const imItem = imSym ? imDict[imSym] : null;
        const naItem = naKey ? naDict[naKey] : null;
        const bbItem = (BONBAST_MAP as any)[id] ? bbDict[id] : null;

        const buildNerkhara = (item: any) => ({
          src: 'nerkhara',
          price: preservePricePrecision(item.price),
          rawChg: item.change_pct,
          ts: item.srcTs,
          extra: {
            priceType: item.method || 'average',
            method: item.method,
            sourcesCount: Number(item.sources) || undefined,
            spreadPct: Number.isFinite(Number(item.spread_pct)) ? Number(item.spread_pct) : undefined
          }
        });
        const buildBonbast = (item: any) => ({
          src: 'bonbast',
          price: preservePricePrecision(item.price),
          rawChg: null,
          ts: item.srcTs,
          extra: { priceType: 'sell' }
        });
        const buildIranMarket = (item: any) => ({
          src: 'iran_market',
          price: preservePricePrecision(item.price),
          rawChg: item.change_pct,
          ts: item.srcTs,
          extra: { priceType: 'last' }
        });

        const builders: Record<string, (() => any) | null> = {
          nerkhara: naItem ? () => buildNerkhara(naItem) : null,
          bonbast: bbItem ? () => buildBonbast(bbItem) : null,
          iran_market: imItem ? () => buildIranMarket(imItem) : null
        };
        const usdEurReady: Record<string, boolean> = {
          nerkhara: nerkharaHasUsdEur,
          bonbast: bonbastHasUsdEur,
          iran_market: iranMarketHasUsdEur
        };
        const effectiveOrder = domesticFeedOrder.length ? domesticFeedOrder : ['nerkhara', 'bonbast', 'iran_market'];

        let chosen: any = null;
        if (id === 'usd' || id === 'eur') {
          for (const srcKey of effectiveOrder) {
            if (usdEurReady[srcKey] && builders[srcKey]) {
              chosen = builders[srcKey]!();
              break;
            }
          }
          if (!chosen) {
            for (const srcKey of effectiveOrder) {
              if (builders[srcKey]) {
                chosen = builders[srcKey]!();
                break;
              }
            }
          }
        } else {
          for (const srcKey of effectiveOrder) {
            if (builders[srcKey]) {
              chosen = builders[srcKey]!();
              break;
            }
          }
        }

        if (chosen && chosen.price > 0) {
          const chg = resolveDomesticChange(id, chosen.price, chosen.rawChg, prevClosesMap, cachedPrices.items?.[id]);
          if (put(id, chosen.price, chg, chosen.src, chosen.ts, 'IRT', {
            kind: 'domestic', name: meta.name, sym: meta.sym, cat: meta.cat, ...chosen.extra
          })) {
            resolvedDomesticIds.add(id);
            sourcesSummary[chosen.src] = (sourcesSummary[chosen.src] || 0) + 1;
          }
        }
      }

      const missingIds = ALL_DOMESTIC_IDS.filter((id: string) => !resolvedDomesticIds.has(id));
      if (missingIds.length > 0) {
        try {
          const j = await fetchJSON('https://nerkh.jahankhahan.shop/data/live.json', 5);
          const nsTs = domesticTime(j);
          for (const id of missingIds) {
            if (resolvedDomesticIds.has(id)) continue;
            const meta = (DOMESTIC_META as any)[id];
            const keys = NERKH[id] || (DOMESTIC_EXTRA[id] ? [DOMESTIC_EXTRA[id][0]] : []);
            const k = keys.find((key: string) => Number(j?.rates?.[key]) > 0);
            if (k) {
              const v = preservePricePrecision(j.rates[k]);
              const chg = resolveDomesticChange(id, v, j?.change?.[k], prevClosesMap, cachedPrices.items?.[id]);
              if (put(id, v, chg, 'nerkhsanj', nsTs, 'IRT', {
                kind: 'domestic', name: meta.name, sym: meta.sym, cat: meta.cat, priceType: 'published'
              })) {
                resolvedDomesticIds.add(id);
                sourcesSummary.nerkhsanj = (sourcesSummary.nerkhsanj || 0) + 1;
              }
            }
          }
        } catch {}
      }

      if (!resolvedDomesticIds.has('gold18') || !resolvedDomesticIds.has('usd')) {
        try {
          const pt = await fetchJSON('https://persiantoolbox.ir/api/market', 4);
          if (pt?.ok && pt?.data) {
            const d = pt.data;
            const ptTs = parseUtcTimestamp(d.timestamp, now);
            if (!resolvedDomesticIds.has('gold18') && d.gold?.pricePerGram > 0) {
              const gold18P = Math.round(d.gold.pricePerGram / 10);
              const chg = resolveDomesticChange('gold18', gold18P, d.gold.change24h, prevClosesMap, cachedPrices.items?.gold18);
              if (put('gold18', gold18P, chg, 'persiantoolbox', ptTs, 'IRT', { kind: 'domestic', name: 'طلای ۱۸ عیار', sym: 'Gold18', cat: 'gold', priceType: 'published' })) {
                resolvedDomesticIds.add('gold18');
                sourcesSummary.persiantoolbox = (sourcesSummary.persiantoolbox || 0) + 1;
              }
            }
            if (!resolvedDomesticIds.has('usd') && d.currencies?.IRR?.rate > 0) {
              const usdP = Math.round(d.currencies.IRR.rate / 10);
              if (usdP > 10000) {
                const chg = resolveDomesticChange('usd', usdP, d.currencies.IRR?.change24h, prevClosesMap, cachedPrices.items?.usd);
                if (put('usd', usdP, chg, 'persiantoolbox', ptTs, 'IRT', { kind: 'domestic', name: 'دلار آمریکا', sym: 'USD', cat: 'currency', priceType: 'published' })) {
                  resolvedDomesticIds.add('usd');
                  sourcesSummary.persiantoolbox = (sourcesSummary.persiantoolbox || 0) + 1;
                }
              }
            }
          }
        } catch {}
      }

      if (resolvedDomesticIds.size > 0) {
        const primarySrc = Object.entries(sourcesSummary).sort((a, b) => b[1] - a[1])[0]?.[0] || 'multi';
        feeds.domestic = { ok: true, checkedAt: now, count: resolvedDomesticIds.size, source: primarySrc, sources: sourcesSummary };
      } else {
        feeds.domestic = { ok: false, checkedAt: now, error: 'no_fresh_domestic_source', fallback: 'cached_values_preserved' };
      }
    };

    // 2. Crypto Rates according to active feeds and prioritized order
    const cryptoTask = async () => {
      const mapFeedId = (fid: string) => {
        if (fid === 'f_kucoin') return 'kucoin';
        if (fid === 'f_okx') return 'okx';
        if (fid === 'f_gate') return 'gate';
        if (fid === 'f_binance_rest' || fid === 'f_binance') return 'binance';
        return fid.replace(/^f_/, '');
      };
      const order = [...new Set(
        systemFeeds
          .filter(f => f.type === 'crypto' && f.status === 'active')
          .sort((a, b) => a.priority - b.priority)
          .map(f => mapFeedId(f.id))
          .filter(id => EXCHANGE_SOURCES[id])
      )];
      if (!order.length) order.push('kucoin', 'okx', 'gate', 'binance');
      const errors: string[] = [];
      for (const name of order) {
        try {
          const rows = (await EXCHANGE_SOURCES[name].tickers())
            .filter((x: any) =>
              x.last > 0 &&
              (x.vol || 0) >= 2000 &&
              !SKIP_BASES.has(String(x.base).toUpperCase()) &&
              !NON_CRYPTO.has(String(x.base).toLowerCase()) &&
              !EXCLUDED_STABLES.has(String(x.base).toLowerCase()) &&
              !/(?:3L|3S|2L|2S|5L|5S|UP|DOWN|BEAR|BULL)$/i.test(String(x.base))
            )
            .sort((a: any, b: any) => (b.vol || 0) - (a.vol || 0))
            .slice(0, 450);

          if (rows.length < 15) throw new Error('insufficient tickers');

          const freshCryptoIds = new Set<string>();
          for (const x of rows) {
            const base = String(x.base);
            const id = base.toLowerCase();
            freshCryptoIds.add(id);
            const srcTs = (Number.isFinite(x.ts) && x.ts > 1500000000 && x.ts <= now + 300) ? Math.floor(x.ts) : null;
            put(id, x.last, x.open > 0 ? (x.last / x.open - 1) * 100 : null, name, srcTs, 'USDT', {
              crypto: 1,
              name: ASSETS[id] || base,
              sym: base,
              pair: x.pair,
              vol: x.vol || 0,
              priceType: 'last'
            });
          }
          pruneStaleCryptoItems(items, freshCryptoIds);
          feeds.crypto = { ok: true, checkedAt: now, count: rows.length, source: name };
          return;
        } catch (e: any) {
          errors.push(`${name}: ${e.message}`);
        }
      }
      feeds.crypto = { ok: false, checkedAt: now, error: errors.join(' | ') };
    };

    await Promise.allSettled([domesticTask(), cryptoTask()]);

    cachedPrices = {
      version: KV_SNAPSHOT_VERSION,
      updatedAt: freshCount > 0 ? now : cachedPrices.updatedAt || 0,
      checkedAt: freshCount > 0 ? now : cachedPrices.checkedAt || 0,
      items,
      feeds
    };
    if (freshCount > 0) {
      lastFetchTime = now;
    }

    if (freshCount > 0) {
      try {
        fs.writeFileSync(CACHE_FILE, JSON.stringify(cachedPrices, null, 2), 'utf8');
      } catch (e) {
        console.warn('Failed to persist cache to disk:', e);
      }
      flushIntradayHistoryToDisk(now);
      evaluateAllStoredAlerts();
    }
  } catch (err: any) {
    console.error('Error updating prices:', err);
  } finally {
    isFetching = false;
  }
  return cachedPrices;
}

const PREVIEW_PRICE_FRESHNESS_S = Math.min(90, Math.max(15, Number(process.env.INLINE_REFRESH_S || 60)));

function startPriceRefreshScheduler() {
  setInterval(() => {
    updateAllPrices().catch((err) => console.error('Scheduled price refresh error:', err));
  }, PREVIEW_PRICE_FRESHNESS_S * 1000);
  setTimeout(() => {
    updateAllPrices(true).catch((err) => console.error('Initial price refresh error:', err));
  }, 200);
}

// ---------- API Routes ----------

app.get('/api/health', (_req, res) => {
  const now = Math.floor(Date.now() / 1000);
  res.json({ ok: true, time: now });
});

app.get('/api/auth/config', (_req, res) => {
  res.json({
    ok: true,
    google: false,
    canClaimPrimaryAdmin: Boolean(!getResolvedPrimaryAdminEmail() && getAdminSecret(process.env))
  });
});

app.get('/api/prices', async (req, res) => {
  const manual = req.query.refresh === '1';
  if (manual && !checkRateLimit('refresh:' + getClientIp(req), 6, 60)) {
    return res.status(429).json({ error: 'تعداد درخواست‌های به‌روزرسانی بیش از حد مجاز است. کمی صبر کنید.' });
  }
  const ageNow = Math.floor(Date.now() / 1000) - (cachedPrices.checkedAt || lastFetchTime || 0);

  if (manual || ageNow >= PREVIEW_PRICE_FRESHNESS_S || !Object.keys(cachedPrices.items || {}).length) {
    await updateAllPrices(manual || !Object.keys(cachedPrices.items || {}).length);
  }

  const t = Math.floor(Date.now() / 1000);
  const checkedAt = cachedPrices.checkedAt || cachedPrices.updatedAt || t;
  const marketOpen = isTehranMarketOpen(t);
  const items: Record<string, any> = {};
  for (const [id, i] of Object.entries(cachedPrices.items || {})) {
    const item: any = i;
    if (!item || !(Number(item.price) > 0)) continue;
    const sourceTimestamp = Number(item.sourceTimestamp) > 0 ? Number(item.sourceTimestamp) : null;
    const receivedAt = Number(item.receivedAt) > 0 ? Number(item.receivedAt) : (Number(item.t) > 0 ? Number(item.t) : checkedAt);
    const effectiveUpdatedAt = sourceTimestamp || (Number(item.t) > 0 ? Number(item.t) : receivedAt);
    items[id] = {
      price: item.price,
      change: item.change,
      updatedAt: effectiveUpdatedAt,
      sourceTimestamp,
      receivedAt,
      checkedAt: Number(item.checkedAt) > 0 ? Number(item.checkedAt) : checkedAt,
      stale: isPriceItemStale(item, id, t),
      estimated: false,
      currency: item.unit || 'IRT',
      source: item.src || item.source || null,
      priceType: item.priceType || 'last',
      ...(item.method ? { method: item.method } : {}),
      ...(Number.isFinite(item.spreadPct) ? { spreadPct: item.spreadPct } : {}),
      ...(Number.isFinite(item.sourcesCount) ? { sourcesCount: item.sourcesCount } : {}),
      ...(item.crypto
        ? { kind: 'crypto', name: item.name, symbol: item.sym, volume: item.vol || 0, pair: item.pair }
        : item.kind === 'domestic'
        ? { kind: 'domestic', name: item.name, symbol: item.sym, cat: item.cat, marketOpen }
        : {})
    };
  }

  const snapAge = Math.max(0, t - checkedAt);
  const remainingTtl = snapAge < PREVIEW_PRICE_FRESHNESS_S
    ? Math.max(5, Math.min(PREVIEW_PRICE_FRESHNESS_S, PREVIEW_PRICE_FRESHNESS_S - snapAge))
    : 10;
  if (manual || !Object.keys(items).length) {
    res.setHeader('Cache-Control', 'no-store, no-cache, private, must-revalidate');
    res.setHeader('CDN-Cache-Control', 'no-store');
  } else {
    res.setHeader('Cache-Control', `public, max-age=${remainingTtl}, s-maxage=${remainingTtl}, stale-while-revalidate=15`);
    res.setHeader('CDN-Cache-Control', `public, max-age=${remainingTtl}, stale-while-revalidate=15`);
    res.setHeader('Cloudflare-CDN-Cache-Control', `public, max-age=${remainingTtl}, stale-while-revalidate=15`);
    res.setHeader('Vary', 'Accept-Encoding');
  }
  res.json({
    version: KV_SNAPSHOT_VERSION,
    updatedAt: cachedPrices.updatedAt,
    checkedAt,
    marketOpen,
    items,
    feeds: cachedPrices.feeds || {}
  });
});

let cachedRatesArchiveText = '';
let cachedRatesArchiveTime = 0;
let archiveFetchPromise: Promise<string> | null = null;

async function getRatesArchiveText(): Promise<string> {
  const now = Date.now();
  if (cachedRatesArchiveText && now - cachedRatesArchiveTime < 1800000) {
    return cachedRatesArchiveText;
  }
  if (archiveFetchPromise) {
    return archiveFetchPromise;
  }
  archiveFetchPromise = (async () => {
    try {
      const archiveRes = await fetch('https://nerkh.jahankhahan.shop/data/rates.json', {
        headers: { accept: 'application/json', 'user-agent': 'Darayi/1.0' },
        signal: AbortSignal.timeout(12000)
      });
      if (archiveRes.ok) {
        cachedRatesArchiveText = await archiveRes.text();
        cachedRatesArchiveTime = Date.now();
        return cachedRatesArchiveText;
      }
    } catch {
      // Ignore network errors
    } finally {
      archiveFetchPromise = null;
    }
    return cachedRatesArchiveText;
  })();
  return archiveFetchPromise;
}

const RANGES_MAP: Record<string, number> = {
  '1H': 3600,
  '1D': 86400,
  '3D': 259200,
  '1W': 604800,
  '1M': 2592000,
  '1Y': 31536000
};

function validateHistoryPoints(
  rawPoints: any[],
  range: string,
  now: number,
  isDomestic: boolean,
  refPrice = 0,
  allowLiveAppend = true,
  refTs = 0
): [number, number][] {
  const span = RANGES_MAP[range];
  if (!span || !Array.isArray(rawPoints) || rawPoints.length < 2) return [];

  const cleaned: [number, number][] = [];
  for (const p of rawPoints) {
    if (!Array.isArray(p) || p.length < 2) continue;
    let ts = Math.floor(Number(p[0]));
    if (ts > 100000000000) ts = Math.floor(ts / 1000);
    const val = Number(p[1]);
    if (Number.isFinite(ts) && ts > 1500000000 && ts <= now + 86400 && Number.isFinite(val) && val > 0) {
      cleaned.push([ts, val]);
    }
  }
  if (cleaned.length < 2) return [];
  cleaned.sort((a, b) => a[0] - b[0]);

  const deduped: [number, number][] = [];
  for (const pt of cleaned) {
    if (deduped.length && deduped[deduped.length - 1][0] === pt[0]) {
      deduped[deduped.length - 1][1] = pt[1];
    } else {
      deduped.push(pt);
    }
  }
  if (deduped.length < 2) return [];

  const minRatio = isDomestic ? 0.35 : 0.05;
  const maxRatio = isDomestic ? 2.85 : 20.0;
  const filtered: [number, number][] = [deduped[0]];
  for (let i = 1; i < deduped.length; i++) {
    const prev = filtered[filtered.length - 1][1];
    const cur = deduped[i][1];
    const ratio = cur / prev;
    if (ratio >= minRatio && ratio <= maxRatio) {
      filtered.push(deduped[i]);
    }
  }
  const despiked = filterIsolatedHistorySpikes(filtered, isDomestic);
  if (despiked.length < 2) return [];

  const isIntraday = range === '1H' || range === '1D';
  const cryptoBucketLead = isIntraday ? 300 : 86400;
  const minTs = isDomestic ? (now - span) : (now - span - cryptoBucketLead);
  const maxTs = now + (isIntraday ? 60 : 3600);
  const pts = despiked.filter((p) => p[0] >= minTs && p[0] <= maxTs);
  if (pts.length < 2) return [];

  const validRefTs = Number(refTs) > 1500000000 ? Math.floor(Number(refTs)) : 0;
  if (allowLiveAppend && refPrice > 0 && validRefTs >= minTs && validRefTs <= now + 60) {
    const lastPt = pts[pts.length - 1];
    const diffRatio = Math.abs(lastPt[1] - refPrice) / refPrice;
    if (diffRatio <= 0.35 && validRefTs > lastPt[0]) {
      pts.push([validRefTs, refPrice]);
    }
  }

  return pts;
}

const historyMemCache = new Map<string, { at: number; data: any }>();
const dailyArchiveMemCache = new Map<string, { at: number; im?: any; na?: any }>();

async function fetchIranMarketDailyRaw(sym: string): Promise<any | null> {
  const now = Math.floor(Date.now() / 1000);
  const hit = dailyArchiveMemCache.get('im:' + sym);
  if (hit && now - hit.at < 900) return hit.im;
  try {
    const j = await fetchJSON(`https://iran-market.github.io/data/history/${encodeURIComponent(sym)}.json`, 7);
    if (j) {
      setBoundedMapEntry(dailyArchiveMemCache, 'im:' + sym, { at: now, im: j }, 120);
      return j;
    }
  } catch {}
  return hit?.im || null;
}

async function fetchNerkharaDailyRaw(naId: string): Promise<any | null> {
  const now = Math.floor(Date.now() / 1000);
  const hit = dailyArchiveMemCache.get('na:' + naId);
  if (hit && now - hit.at < 900) return hit.na;
  try {
    const j = await fetchJSON(`https://nerkhara.com/api/v1/history/${encodeURIComponent(naId)}.json`, 7);
    if (j) {
      setBoundedMapEntry(dailyArchiveMemCache, 'na:' + naId, { at: now, na: j }, 120);
      return j;
    }
  } catch {}
  return hit?.na || null;
}

function parseArchiveRecTs(rec: any): number {
  if (!rec) return 0;
  if (typeof rec.t === 'number' && Number.isFinite(rec.t)) {
    return rec.t > 1e12 ? Math.floor(rec.t / 1000) : Math.floor(rec.t);
  }
  if (typeof rec.t === 'string' && rec.t.trim()) {
    const ms = Date.parse(rec.t);
    if (Number.isFinite(ms) && ms > 1500000000000) return Math.floor(ms / 1000);
  }
  if (typeof rec.date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(rec.date)) {
    const ms = Date.parse(rec.date.slice(0, 10) + 'T12:00:00Z');
    if (Number.isFinite(ms)) return Math.floor(ms / 1000);
  }
  return 0;
}

// Real history extraction with ZERO synthetic/interpolated points and strict selected-range boundaries
async function archiveHistory(id: string, range: string, liveItem: any = null): Promise<{ points: [number, number][]; source: string }> {
  const now = Math.floor(Date.now() / 1000);
  const span = RANGES_MAP[range] || 86400;
  const minTs = now - span;
  const maxSlice = range === '3D' ? 10 : range === '1W' ? 18 : range === '1M' ? 45 : 400;
  const curPrice = (liveItem && Number(liveItem.price) > 0 && !isPriceItemStale(liveItem, id, now))
    ? preservePricePrecision(liveItem.price)
    : 0;
  const curTs = Number(liveItem?.sourceTimestamp) > 0
    ? Math.floor(Number(liveItem.sourceTimestamp))
    : (Number(liveItem?.t) > 1500000000 ? Math.floor(Number(liveItem.t)) : (Number(liveItem?.receivedAt) > 1500000000 ? Math.floor(Number(liveItem.receivedAt)) : 0));

  // 1. For 1H and 1D: real recorded intraday ticks + genuine 24h boundary from daily archive when ticks don't span 24h yet
  if (range === '1H' || range === '1D') {
    const windowStart = now - span;
    const ticks = (domesticIntradayTicks.get(id) || []).filter((p) => p[0] >= windowStart && p[0] <= now + 60);
    const combined: [number, number][] = [...ticks];
    if (curPrice > 0 && curTs >= windowStart && curTs <= now + 60) {
      combined.push([curTs, curPrice]);
    }
    combined.sort((a, b) => a[0] - b[0]);
    const deduped: [number, number][] = [];
    for (const pt of combined) {
      if (deduped.length && deduped[deduped.length - 1][0] === pt[0]) {
        deduped[deduped.length - 1][1] = pt[1];
      } else {
        deduped.push(pt);
      }
    }

    if (range === '1D' && (!deduped.length || deduped[0][0] > windowStart + 3600)) {
      const sym = id === 'usdt' ? 'USDT_IRR' : (IRAN_MARKET_MAP[id] || [])[0];
      const naId = (NERKHARA_MAP as any)[id];
      const anchorPoints: [number, number][] = [];
      let foundAnchorAtWindowStart = false;

      const [imAnchorSettled, naAnchorSettled] = await Promise.allSettled([
        sym ? fetchIranMarketDailyRaw(sym) : Promise.resolve(null),
        naId ? fetchNerkharaDailyRaw(naId) : Promise.resolve(null)
      ]);
      const jIm = imAnchorSettled.status === 'fulfilled' ? imAnchorSettled.value : null;
      const nj = naAnchorSettled.status === 'fulfilled' ? naAnchorSettled.value : null;

      if (jIm) {
        const records = Array.isArray(jIm?.data) ? jIm.data : jIm?.data?.records;
        const isToman = jIm?.meta?.unit === 'toman' || jIm?.meta?.currency === 'IRT';
        const div = isToman ? 1 : 10;
        if (Array.isArray(records) && records.length) {
          const recent = records.slice(-5);
          let prevCloseForWindow: number | null = null;
          for (const rec of recent) {
            const startTs = parseArchiveRecTs(rec);
            if (!startTs) continue;
            const openVal = Number(rec.open) > 0 ? preservePricePrecision(Number(rec.open) / div) : 0;
            const closeVal = Number(rec.close) > 0 ? preservePricePrecision(Number(rec.close) / div) : 0;
            if (startTs <= windowStart && (closeVal > 0 || openVal > 0)) {
              prevCloseForWindow = closeVal || openVal;
            }
            if (openVal > 0 && startTs >= windowStart && startTs < (deduped[0]?.[0] || (curTs > windowStart ? curTs : now))) {
              anchorPoints.push([startTs, openVal]);
            }
            if (closeVal > 0) {
              const pubMs = typeof jIm?.meta?.published_at === 'string' ? Date.parse(jIm.meta.published_at) : NaN;
              const recEndTs = (rec === recent[recent.length - 1] && Number.isFinite(pubMs))
                ? Math.floor(pubMs / 1000)
                : (startTs + 45000);
              if (recEndTs >= windowStart && recEndTs <= now && (!deduped.length || recEndTs < deduped[0][0] - 300)) {
                anchorPoints.push([recEndTs, closeVal]);
              }
            }
          }
          if (prevCloseForWindow && prevCloseForWindow > 0) {
            anchorPoints.unshift([windowStart, prevCloseForWindow]);
            foundAnchorAtWindowStart = true;
          }
        }
      }

      if (!foundAnchorAtWindowStart && nj) {
        const pts = nj?.points;
        if (Array.isArray(pts) && pts.length) {
          const recentNa = pts.slice(-4);
          let bestVal = 0;
          for (const row of recentNa) {
            if (!Array.isArray(row) || row.length < 2) continue;
            const dStr = String(row[0] || '').trim();
            const v = preservePricePrecision(row[1]);
            if (!/^\d{4}-\d{2}-\d{2}$/.test(dStr) || !(v > 0)) continue;
            const ts = Math.floor(Date.parse(`${dStr}T12:00:00Z`) / 1000);
            if (ts <= windowStart + 43200) bestVal = v;
            if (ts >= windowStart && ts < (deduped[0]?.[0] || (curTs > windowStart ? curTs : now))) {
              anchorPoints.push([ts, v]);
            }
          }
          if (bestVal > 0) {
            anchorPoints.unshift([windowStart, bestVal]);
            foundAnchorAtWindowStart = true;
          }
        }
      }

      if (anchorPoints.length) {
        const merged = [...anchorPoints, ...deduped];
        if (curPrice > 0 && curTs >= windowStart && curTs <= now + 60 && curTs > (merged.at(-1)?.[0] || 0)) {
          merged.push([curTs, curPrice]);
        }
        merged.sort((a, b) => a[0] - b[0]);
        const finalOut: [number, number][] = [];
        for (const pt of merged) {
          if (finalOut.length && finalOut[finalOut.length - 1][0] === pt[0]) {
            finalOut[finalOut.length - 1][1] = pt[1];
          } else {
            finalOut.push(pt);
          }
        }
        if (finalOut.length >= 2) return { points: finalOut, source: 'd1_intraday' };
      }
    }

    return { points: deduped.length >= 2 ? deduped : [], source: 'd1_intraday' };
  }

  const recentIntraday = (range === '3D' || range === '1W')
    ? (domesticIntradayTicks.get(id) || []).filter((p) => p[0] >= minTs && p[0] <= now + 60)
    : [];

  // 2. Multi-day ranges (3D, 1W, 1M, 1Y): fetch iran-market and NerkhAra in parallel (prefer iran-market)
  const sym = id === 'usdt' ? 'USDT_IRR' : (IRAN_MARKET_MAP[id] || [])[0];
  const naId = (NERKHARA_MAP as any)[id];
  const [imMultiSettled, naMultiSettled] = await Promise.allSettled([
    sym ? fetchIranMarketDailyRaw(sym) : Promise.resolve(null),
    naId ? fetchNerkharaDailyRaw(naId) : Promise.resolve(null)
  ]);

  if (sym && imMultiSettled.status === 'fulfilled' && imMultiSettled.value) {
    try {
      const j = imMultiSettled.value;
      const records = Array.isArray(j?.data) ? j.data : j?.data?.records;
      const isToman = j?.meta?.unit === 'toman' || j?.meta?.currency === 'IRT';
      const div = isToman ? 1 : 10;
      if (Array.isArray(records) && records.length >= 2) {
        const parsedOut: [number, number][] = [];
        for (const rec of records) {
          const closeRaw = Number(rec.close);
          if (!(closeRaw > 0)) continue;
          const closeToman = preservePricePrecision(closeRaw / div);
          const baseTs = parseArchiveRecTs(rec);
          if (baseTs >= minTs && baseTs <= now + 3600) {
            parsedOut.push([baseTs, closeToman]);
          }
        }
        parsedOut.sort((a, b) => a[0] - b[0]);
        const out = parsedOut.slice(-maxSlice);
        for (const pt of recentIntraday) out.push(pt);
        if (curPrice > 0 && curTs >= minTs && curTs <= now + 3600 && curTs > (out.at(-1)?.[0] || 0)) {
          out.push([curTs, curPrice]);
        }
        if (out.length >= 2) return { points: out, source: 'iran_market' };
      }
    } catch {}
  }

  if (naId && naMultiSettled.status === 'fulfilled' && naMultiSettled.value) {
    try {
      const j = naMultiSettled.value;
      const pts = j?.points;
      if (Array.isArray(pts) && pts.length >= 2) {
        const parsedOut: [number, number][] = [];
        for (const row of pts) {
          if (!Array.isArray(row) || row.length < 2) continue;
          const dateStr = String(row[0] || '').trim();
          const val = preservePricePrecision(row[1]);
          if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr) || !(val > 0)) continue;
          const ts = Math.floor(Date.parse(`${dateStr}T12:00:00Z`) / 1000);
          if (Number.isFinite(ts) && ts >= minTs && ts <= now + 3600) {
            parsedOut.push([ts, val]);
          }
        }
        parsedOut.sort((a, b) => a[0] - b[0]);
        const out = parsedOut.slice(-maxSlice);
        for (const pt of recentIntraday) out.push(pt);
        if (curPrice > 0 && curTs >= minTs && curTs <= now + 3600 && curTs > (out.at(-1)?.[0] || 0)) {
          out.push([curTs, curPrice]);
        }
        if (out.length >= 2) return { points: out, source: 'nerkhara' };
      }
    } catch {}
  }

  // Tertiary multi-day source: Nerkhsanj rates.json
  const key = (NERKH[id] || [])[0] || (DOMESTIC_EXTRA[id] || [])[0];
  if (!key) return { points: [], source: 'archive' };
  try {
    const text = await getRatesArchiveText();
    if (!text) return { points: [], source: 'archive' };
    const marker = `"key":"${key}"`;
    const idx = text.indexOf(marker);
    if (idx === -1) return { points: [], source: 'archive' };
    const daysIdx = text.indexOf('"days":', idx);
    const endDaysIdx = text.indexOf(']]', daysIdx);
    if (daysIdx === -1 || endDaysIdx === -1) return { points: [], source: 'archive' };
    const days = JSON.parse(text.slice(daysIdx + 7, endDaysIdx + 2));
    const parsedOut: [number, number][] = [];
    for (const [d, v] of days) {
      const m = /^(\d{4})\/(\d{2})\/(\d{2})$/.exec(d);
      if (!m || !(v > 0)) continue;
      const [gy, gm, gd] = jalaliToGregorian(+m[1], +m[2], +m[3]);
      const ts = Math.floor(Date.UTC(gy, gm - 1, gd, 12) / 1000) - 12600;
      if (ts >= minTs && ts <= now + 3600) {
        parsedOut.push([ts, Number(v)]);
      }
    }
    parsedOut.sort((a, b) => a[0] - b[0]);
    const out = parsedOut.slice(-maxSlice);
    for (const pt of recentIntraday) out.push(pt);
    if (curPrice > 0 && curTs >= minTs && curTs <= now + 3600 && curTs > (out.at(-1)?.[0] || 0)) {
      out.push([curTs, curPrice]);
    }
    return { points: out, source: 'nerkhsanj' };
  } catch {
    return { points: [], source: 'archive' };
  }
}

async function wallexHistory(symbol: string, range: string, refPrice = 0): Promise<[number, number][]> {
  const now = Math.floor(Date.now() / 1000);
  const cfg: Record<string, [string, number, number]> = {
    '1H': ['1', 3600, 60],
    '1D': ['15', 86400, 900],
    '3D': ['60', 259200, 3600],
    '1W': ['60', 604800, 3600],
    '1M': ['1D', 2592000, 86400],
    '1Y': ['1D', 31536000, 86400]
  };
  const [res, span, bucket] = cfg[range] || ['15', 86400, 900];
  const endTs = Math.floor(now / bucket) * bucket;
  const startTs = endTs - span;
  try {
    const j = await fetchJSON(`https://api.wallex.ir/v1/udf/history?symbol=${symbol}&resolution=${res}&from=${startTs}&to=${endTs}`, 5);
    if (j?.s === 'ok' && Array.isArray(j.t) && Array.isArray(j.c) && j.t.length >= 2) {
      const raw: [number, number][] = [];
      for (let i = 0; i < j.t.length; i++) {
        const ts = Number(j.t[i]), c = Number(j.c[i]);
        if (Number.isFinite(ts) && c > 0) {
          const bTs = Math.floor(ts / bucket) * bucket;
          raw.push([bTs, Math.round(c)]);
        }
      }
      const deduped: [number, number][] = [];
      for (const pt of raw) {
        if (deduped.length && deduped[deduped.length - 1][0] === pt[0]) {
          deduped[deduped.length - 1][1] = pt[1];
        } else {
          deduped.push(pt);
        }
      }
      let clean = deduped;
      if (deduped.length >= 5) {
        const vals = deduped.map(p => p[1]).slice().sort((a, b) => a - b);
        const med = vals[Math.floor(vals.length / 2)] || 0;
        if (med > 0) {
          clean = deduped.filter((p, idx) => {
            if (Math.abs(p[1] - med) / med <= 0.15) return true;
            const prev = idx > 0 ? deduped[idx - 1][1] : p[1];
            const next = idx < deduped.length - 1 ? deduped[idx + 1][1] : p[1];
            return Math.abs(p[1] - prev) / (prev || med) <= 0.04 && Math.abs(p[1] - next) / (next || med) <= 0.04;
          });
        }
      }
      return validateHistoryPoints(clean.length >= 2 ? clean : deduped, range, now, true, refPrice, true);
    }
  } catch {}
  return [];
}

// Fast klines & historical archive (Real verified data only — zero synthetic charts)
app.get('/api/history', async (req, res) => {
  if (!checkRateLimit('hist:' + getClientIp(req), 450, 60)) {
    return res.status(429).json({ error: 'تعداد درخواست‌های نمودار بیش از حد مجاز است.' });
  }
  const id = String(req.query.id || '');
  const range = String(req.query.range || '1D');
  if (!/^[a-z0-9]{1,20}$/.test(id) || !Object.prototype.hasOwnProperty.call(RANGES_MAP, range)) {
    return res.status(400).json({ error: 'پارامتر نامعتبر است.' });
  }
  res.setHeader('Cache-Control', 'public, max-age=30, stale-while-revalidate=60');
  const cacheKey = `${id}:${range}`;
  const now = Math.floor(Date.now() / 1000);
  const ttlSec = (range === '1H' || range === '1D') ? 60 : 300;
  const mem = historyMemCache.get(cacheKey);
  if (mem && (now - mem.at < ttlSec) && mem.data?.points?.length >= 2) {
    return res.json(mem.data);
  }

  const KL: Record<string, [string, number]> = {
    '1H': ['1m', 60],
    '1D': ['5m', 288],
    '3D': ['1h', 72],
    '1W': ['4h', 42],
    '1M': ['1d', 30],
    '1Y': ['1d', 365]
  };

  if (!Object.keys(cachedPrices.items || {}).length) {
    try { await updateAllPrices(true); } catch {}
  }

  const item = cachedPrices.items?.[id];
  const isDomesticAsset = id !== 'usdt' && (Boolean(NERKH[id]) || Boolean(DOMESTIC_EXTRA[id]) || Boolean(IRAN_MARKET_MAP[id]) || Boolean((DOMESTIC_META as any)[id]) || item?.kind === 'domestic');
  if (Object.keys(cachedPrices.items || {}).length > 0 && !item && id !== 'usdt' && !isDomesticAsset && !ASSETS[id]) {
    res.setHeader('Cache-Control', 'public, max-age=60');
    return res.json({ id, range, currency: 'USDT', points: [], unavailable: true, reason: 'unknown_asset' });
  }

  const liveRefTs = item
    ? (Number(item.sourceTimestamp) > 1500000000 ? Math.floor(Number(item.sourceTimestamp)) : (Number(item.t) > 1500000000 ? Math.floor(Number(item.t)) : 0))
    : 0;

  // 1. Crypto & Tether history
  if (item?.crypto || !isDomesticAsset) {
    if (id === 'usdt') {
      const refP = (item && !isPriceItemStale(item, 'usdt', now)) ? (item.price || 0) : 0;
      let pts = await wallexHistory('USDTTMN', range, refP);
      let srcUsed = 'wallex';
      if (pts.length < 2) {
        const archRes = await archiveHistory('usdt', range, item);
        pts = validateHistoryPoints(archRes.points, range, now, true, refP, range !== '1H' && range !== '1D', liveRefTs);
        srcUsed = archRes.source || ((range === '1H' || range === '1D') ? 'd1_intraday' : 'archive');
      }
      if (pts.length >= 2) {
        if (refP > 0 && liveRefTs > 1500000000 && liveRefTs <= now + 60) {
          const lastPt = pts[pts.length - 1];
          const roundedRef = Math.round(refP);
          if (lastPt && Math.abs(roundedRef - lastPt[1]) / (lastPt[1] || roundedRef) <= 0.15) {
            if (liveRefTs > lastPt[0]) {
              pts = [...pts, [liveRefTs, roundedRef]];
            } else if (liveRefTs === lastPt[0]) {
              pts = pts.slice();
              pts[pts.length - 1] = [lastPt[0], roundedRef];
            }
          }
        }
        const meta = buildHistoryMetadata({ id, range, source: srcUsed, points: pts, liveItem: item, nowSec: now, isDomestic: true });
        const payload = { id, range, currency: 'IRT', ...meta, points: pts };
        setBoundedMapEntry(historyMemCache, cacheKey, { at: now, data: payload }, 400);
        return res.json(payload);
      }
      return res.json({ id, range, currency: 'IRT', points: [], unavailable: true, reason: 'insufficient_real_points' });
    }
    const [iv, lim] = KL[range] || ['5m', 288];
    const base = (item?.sym || id).toUpperCase();
    const refP = (item && !isPriceItemStale(item, id, now)) ? (item.price || 0) : 0;
    const exchangeOrder = range === '1Y'
      ? [...new Set([item?.src !== 'okx' ? item?.src : null, 'kucoin', 'gate', 'okx', 'binance'].filter(Boolean))]
      : [...new Set([item?.src, 'kucoin', 'okx', 'gate', 'binance'].filter(Boolean))];
    const tryExchangeKlines = async (name: string) => {
      const src = EXCHANGE_SOURCES[name];
      if (!src) throw new Error('missing_source');
      const pair = (item && name === item.src && item.pair)
        ? item.pair
        : name === 'gate' ? `${base}_USDT` : name === 'binance' ? `${base}USDT` : `${base}-USDT`;
      const rawPts = await src.klines(pair, iv, lim);
      const points = validateHistoryPoints(rawPts, range, now, false, refP, true, liveRefTs);
      if (points.length >= 2) return { name, points };
      throw new Error('insufficient_points');
    };
    if (exchangeOrder.length) {
      try {
        const firstHit = await tryExchangeKlines(exchangeOrder[0]);
        const meta = buildHistoryMetadata({ id, range, source: firstHit.name, points: firstHit.points, liveItem: item, nowSec: now, isDomestic: false });
        const payload = { id, range, currency: 'USDT', ...meta, points: firstHit.points };
        setBoundedMapEntry(historyMemCache, cacheKey, { at: now, data: payload }, 400);
        return res.json(payload);
      } catch {}
      if (exchangeOrder.length > 1) {
        try {
          const raceHit = await Promise.any(exchangeOrder.slice(1).map((name) => tryExchangeKlines(name)));
          const meta = buildHistoryMetadata({ id, range, source: raceHit.name, points: raceHit.points, liveItem: item, nowSec: now, isDomestic: false });
          const payload = { id, range, currency: 'USDT', ...meta, points: raceHit.points };
          setBoundedMapEntry(historyMemCache, cacheKey, { at: now, data: payload }, 400);
          return res.json(payload);
        } catch {}
      }
    }
    return res.json({ id, range, currency: 'USDT', points: [], unavailable: true, reason: 'exchange_klines_unavailable' });
  }

  // 2. Domestic history (zero synthetic points, strict range bounds)
  try {
    const curPrice = (item && !isPriceItemStale(item, id, now)) ? (item.price || 0) : 0;
    const isIntraday = range === '1H' || range === '1D';
    const archRes = await archiveHistory(id, range, item);
    const points = validateHistoryPoints(archRes.points, range, now, true, curPrice, !isIntraday, liveRefTs);
    if (points.length < 2) {
      return res.json({
        id,
        range,
        currency: item?.unit || 'IRT',
        points: [],
        unavailable: true,
        reason: isIntraday ? 'insufficient_intraday_history' : 'archive_unavailable'
      });
    }

    const srcUsed = archRes.source || (isIntraday ? 'd1_intraday' : 'archive');
    const meta = buildHistoryMetadata({ id, range, source: srcUsed, points, liveItem: item, nowSec: now, isDomestic: true });
    const payload = {
      id,
      range,
      currency: item?.unit || 'IRT',
      ...meta,
      points
    };
    setBoundedMapEntry(historyMemCache, cacheKey, { at: now, data: payload }, 400);
    return res.json(payload);
  } catch (e) {
    return res.json({ id, range, currency: item?.unit || 'IRT', points: [], unavailable: true });
  }
});

// Persistent user store & cryptographic session management
function isEmailAdmin(email: string): boolean {
  return isEnvAdminEmail(process.env, email);
}
const AUTH_SECRET = (process.env.AUTH_SECRET && process.env.AUTH_SECRET.trim().length >= 16)
  ? process.env.AUTH_SECRET.trim()
  : crypto.randomBytes(32).toString('hex');
const AUTH_SESSION_FILE = path.join(__dirname, '.auth-session.json');

async function verifyStoredPassword(password: string, storedHash: string): Promise<boolean> {
  if (!storedHash || typeof storedHash !== 'string') return false;
  if (parsePbkdf2Hash(storedHash)) {
    return verifyPassword(password, storedHash, process.env);
  }
  // پشتیبانی موقت از فرمت قدیمی ۳بخشی ذخیره‌شده در .auth-session.json و ارتقای خودکار هنگام ورود
  const parts = storedHash.split('$');
  if (parts.length === 3 && parts[0] === 'pbkdf2') {
    const [, salt, hash] = parts;
    const candidate = crypto.pbkdf2Sync(String(password), salt, 100000, 32, 'sha256').toString('hex');
    return teq(candidate, hash);
  }
  return false;
}

function shouldUpgradeStoredHash(storedHash: string): boolean {
  const parsed = parsePbkdf2Hash(storedHash);
  if (!parsed) return Boolean(storedHash && storedHash.startsWith('pbkdf2$'));
  return parsed.iter < iterOf(process.env);
}

interface StoredUser {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'user';
  status: 'active' | 'suspended';
  registeredAt: string;
  holdingsCount: number;
  alertsCount: number;
  lastLogin: string;
  passwordHash: string;
}

interface SessionRecord {
  sidHash: string;
  userId: string;
  email: string;
  name: string;
  role: 'admin' | 'user';
  isAdmin: boolean;
  expiresAt: number;
}

const userStore: Record<string, any> = {};
const pendingOtps: Record<string, { codeHash: string; expires: number; attempts: number; name?: string; passwordHash?: string }> = {};
const pendingResets: Record<string, { tokenHash: string; expires: number }> = {};
const activeSessions = new Map<string, SessionRecord>();
const revokedSessions = new Set<string>();
let broadcastMessage: string = '';

const initialAdminPass = getSharedAdminPassword(process.env);
const initialAdminPassHash = initialAdminPass ? await hashPassword(initialAdminPass, process.env) : '';
const configuredAdminList = getAdminEmails(process.env);
const primaryAdminEmail = getPrimaryAdminEmail(process.env);
let systemUsers: StoredUser[] = [
  ...configuredAdminList.map((admEmail, idx) => ({
    id: admEmail === primaryAdminEmail ? 'u_admin' : `u_admin_${idx + 1}`,
    name: admEmail === primaryAdminEmail ? 'مدیر کل دارایی' : admEmail.split('@')[0],
    email: admEmail,
    role: 'admin' as const,
    status: 'active' as const,
    registeredAt: '1403/01/15',
    holdingsCount: 0,
    alertsCount: 0,
    lastLogin: 'هم‌اکنون',
    passwordHash: initialAdminPassHash
  })),
  { id: 'u_2', name: 'امیرحسین رضایی', email: 'amir.financial@yahoo.com', role: 'user', status: 'active', registeredAt: '1403/06/10', holdingsCount: 12, alertsCount: 3, lastLogin: '۲ ساعت قبل', passwordHash: '' },
  { id: 'u_3', name: 'سارا تهرانی', email: 'sara.trader@gmail.com', role: 'user', status: 'active', registeredAt: '1403/08/22', holdingsCount: 5, alertsCount: 2, lastLogin: 'دیروز', passwordHash: '' },
  { id: 'u_4', name: 'رضا کریمی', email: 'reza.crypto@outlook.com', role: 'user', status: 'active', registeredAt: '1403/09/04', holdingsCount: 28, alertsCount: 7, lastLogin: '۳ روز قبل', passwordHash: '' },
  { id: 'u_5', name: 'مهدی زرگر', email: 'mehdi.gold@gmail.com', role: 'user', status: 'active', registeredAt: '1403/10/12', holdingsCount: 8, alertsCount: 1, lastLogin: '۱ هفته قبل', passwordHash: '' }
];

let claimedPrimaryAdminEmail = '';

function getResolvedPrimaryAdminEmail(): string {
  return getPrimaryAdminEmail(process.env) || claimedPrimaryAdminEmail || '';
}

function getAdminRoleMeta(email: string, storedRole?: string) {
  const norm = cleanEmail(email);
  const primary = getResolvedPrimaryAdminEmail();
  const isPrimaryAdmin = Boolean(norm && primary && norm === primary);
  const isAdmin = isPrimaryAdmin || storedRole === 'admin';
  return {
    isAdmin,
    isPrimaryAdmin,
    adminTier: isAdmin ? (isPrimaryAdmin ? 'primary' : 'secondary') : null,
    envPinned: isPrimaryAdmin,
    role: (isAdmin ? 'admin' : 'user') as 'admin' | 'user'
  };
}

function loadAuthSessionFromDisk() {
  try {
    if (fs.existsSync(AUTH_SESSION_FILE)) {
      const raw = JSON.parse(fs.readFileSync(AUTH_SESSION_FILE, 'utf8'));
      if (raw && typeof raw === 'object') {
        if (typeof raw.claimedPrimaryAdminEmail === 'string' && isEmail(cleanEmail(raw.claimedPrimaryAdminEmail))) {
          claimedPrimaryAdminEmail = cleanEmail(raw.claimedPrimaryAdminEmail);
        }
        if (raw.userStore && typeof raw.userStore === 'object') {
          Object.assign(userStore, raw.userStore);
        }
        if (Array.isArray(raw.users)) {
          for (const savedUser of raw.users) {
            if (!savedUser || !savedUser.email) continue;
            const norm = cleanEmail(savedUser.email);
            const existing = systemUsers.find(u => u.email.toLowerCase() === norm);
            const isPrim = norm === getResolvedPrimaryAdminEmail();
            const resolvedRole = (isPrim || savedUser.role === 'admin') ? 'admin' : 'user';
            if (existing) {
              if (savedUser.name) existing.name = String(savedUser.name).slice(0, 80);
              if (savedUser.passwordHash && String(savedUser.passwordHash).startsWith('pbkdf2$')) {
                existing.passwordHash = savedUser.passwordHash;
              }
              if (savedUser.status === 'suspended' && !isPrim) {
                existing.status = 'suspended';
              }
              existing.role = resolvedRole;
            } else if ((savedUser.passwordHash && String(savedUser.passwordHash).startsWith('pbkdf2$')) || resolvedRole === 'admin') {
              systemUsers.push({
                id: String(savedUser.id || 'u_' + Date.now()),
                name: String(savedUser.name || norm.split('@')[0]).slice(0, 80),
                email: norm,
                role: resolvedRole,
                status: savedUser.status === 'suspended' && !isPrim ? 'suspended' : 'active',
                registeredAt: String(savedUser.registeredAt || 'هم‌اکنون'),
                holdingsCount: Number(savedUser.holdingsCount) || 0,
                alertsCount: Number(savedUser.alertsCount) || 0,
                lastLogin: String(savedUser.lastLogin || 'انتخاب‌شده در پنل'),
                passwordHash: savedUser.passwordHash && String(savedUser.passwordHash).startsWith('pbkdf2$') ? savedUser.passwordHash : ''
              });
            }
          }
        }
      }
    }
  } catch {}
}

function saveAuthSessionToDisk() {
  try {
    const safeUsers = systemUsers.map(u => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      status: u.status,
      registeredAt: u.registeredAt,
      holdingsCount: u.holdingsCount,
      alertsCount: u.alertsCount,
      lastLogin: u.lastLogin,
      passwordHash: u.passwordHash
    }));
    fs.writeFileSync(AUTH_SESSION_FILE, JSON.stringify({ userStore, users: safeUsers, claimedPrimaryAdminEmail }, null, 2), { encoding: 'utf8', mode: 0o600 });
  } catch {}
}
loadAuthSessionFromDisk();

let systemAuditLogs = [
  { id: 1, time: 'هم‌اکنون', type: 'info', msg: 'وب‌سرویس بایننس و صرافی‌ها در حالت همگام‌سازی بلادرنگ هستند.' },
  { id: 2, time: '۲ دقیقه قبل', type: 'success', msg: 'فید قیمت‌های داخلی (طلا و ارز) بدون خطا به‌روز شد.' },
  { id: 3, time: '۱۰ دقیقه قبل', type: 'auth', msg: 'بررسی امنیتی نشست‌ها و توکن‌های احراز هویت انجام شد.' },
  { id: 4, time: '۳۵ دقیقه قبل', type: 'system', msg: 'بررسی سلامت کش قیمت‌ها و ارتباط با دیتابیس با موفقیت انجام شد.' }
];

async function createSessionForUser(res: express.Response, req: express.Request, user: StoredUser) {
  const baseSid = crypto.randomBytes(32).toString('hex');
  const sig = await hmacHex(AUTH_SECRET, baseSid);
  const signedToken = `${baseSid}.${sig}`;
  const sidHash = await sha256Hex(baseSid);
  const ttlSec = 60 * 60 * 24 * 14;
  const nowSec = Math.floor(Date.now() / 1000);
  const meta = getAdminRoleMeta(user.email, user.role);
  const sessionRec: SessionRecord = {
    sidHash,
    userId: user.id,
    email: user.email.toLowerCase(),
    name: user.name,
    role: meta.role,
    isAdmin: meta.isAdmin,
    expiresAt: nowSec + ttlSec
  };
  activeSessions.set(sidHash, sessionRec);
  const isSecure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  const sameSiteAttr = (isSecure && isPreviewRequest(req)) ? 'SameSite=None; Secure' : `SameSite=Lax${isSecure ? '; Secure' : ''}`;
  res.setHeader(
    'Set-Cookie',
    `sid=${signedToken}; Path=/; Max-Age=${ttlSec}; HttpOnly; ${sameSiteAttr}`
  );
  return {
    id: user.id,
    name: user.name,
    email: user.email.toLowerCase(),
    role: meta.role,
    isAdmin: meta.isAdmin,
    isPrimaryAdmin: meta.isPrimaryAdmin,
    adminTier: meta.adminTier
  };
}

function clearSessionCookie(res: express.Response, req: express.Request) {
  const isSecure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  const sameSiteAttr = (isSecure && isPreviewRequest(req)) ? 'SameSite=None; Secure' : `SameSite=Lax${isSecure ? '; Secure' : ''}`;
  res.setHeader(
    'Set-Cookie',
    `sid=; Path=/; Max-Age=0; HttpOnly; ${sameSiteAttr}`
  );
}

function revokeUserSessions(email: string) {
  const norm = String(email || '').toLowerCase();
  for (const [sidHash, sess] of activeSessions.entries()) {
    if (sess.email === norm) {
      activeSessions.delete(sidHash);
      revokedSessions.add(sidHash);
    }
  }
}

function extractRawSessionToken(req: express.Request): string {
  const cookieHeader = String(req.headers.cookie || '');
  const match = cookieHeader.match(/(?:^|;\s*)sid=([^;]+)/);
  if (match && match[1]) return decodeURIComponent(match[1].trim());
  const authHeader = String(req.headers.authorization || '');
  if (authHeader.startsWith('Bearer ')) return authHeader.slice(7).trim();
  return '';
}

async function resolveReqUser(req: express.Request) {
  const rawToken = extractRawSessionToken(req);
  if (!rawToken || !rawToken.includes('.')) return null;
  const dotIdx = rawToken.indexOf('.');
  const baseSid = rawToken.slice(0, dotIdx);
  const sig = rawToken.slice(dotIdx + 1);
  if (!baseSid || !sig) return null;
  const expectedSig = await hmacHex(AUTH_SECRET, baseSid);
  if (!teq(sig, expectedSig)) return null;

  const sidHash = await sha256Hex(baseSid);
  if (revokedSessions.has(sidHash)) return null;

  const sess = activeSessions.get(sidHash);
  if (!sess) return null;
  const nowSec = Math.floor(Date.now() / 1000);
  if (sess.expiresAt <= nowSec) {
    activeSessions.delete(sidHash);
    return null;
  }

  const usr = systemUsers.find(u => u.email.toLowerCase() === sess.email);
  if (usr && usr.status === 'suspended') {
    activeSessions.delete(sidHash);
    revokedSessions.add(sidHash);
    return null;
  }

  const meta = getAdminRoleMeta(sess.email, usr?.role);
  return {
    id: sess.userId,
    name: usr?.name || sess.name,
    email: sess.email,
    role: meta.role,
    isAdmin: meta.isAdmin,
    isPrimaryAdmin: meta.isPrimaryAdmin,
    adminTier: meta.adminTier
  };
}

// Download endpoint for the final Cloudflare Worker bundle (Admin-only)
app.get('/api/download/worker.js', async (req, res) => {
  const u = await resolveReqUser(req);
  if (!u || !u.isAdmin) {
    return res.status(403).json({ error: 'دسترسی فقط برای مدیر سیستم مجاز است.' });
  }
  const candidatePaths = [
    path.join(process.cwd(), 'dist', 'worker.js'),
    path.join(__dirname, 'dist', 'worker.js')
  ];
  for (const p of candidatePaths) {
    if (fs.existsSync(p)) {
      res.setHeader('content-disposition', 'attachment; filename="worker.js"');
      res.setHeader('content-type', 'application/javascript; charset=utf-8');
      return res.sendFile(p);
    }
  }
  return res.status(404).send('Worker file not built yet.');
});

app.get('/api/me', async (req, res) => {
  res.json({ user: await resolveReqUser(req) });
});

app.post('/api/auth/check-email', (req, res) => {
  const ip = getClientIp(req);
  const normalizedEmail = cleanEmail(req.body?.email);
  if (!isEmail(normalizedEmail) || normalizedEmail.length > 120) {
    return res.status(400).json({ error: 'ایمیل معتبر نیست.' });
  }
  if (!checkRateLimit(`check_email_ip:${ip}`, 25, 900) || !checkRateLimit(`check_email:${ip}:${normalizedEmail}`, 12, 900)) {
    return res.status(429).json({ error: 'تعداد درخواست‌ها بیش از حد مجاز است. لطفاً کمی صبر کنید.' });
  }
  const isEnvAdm = isEmailAdmin(normalizedEmail);
  const isPrimAdm = normalizedEmail === getResolvedPrimaryAdminEmail();
  const existing = systemUsers.find(u => u.email.toLowerCase() === normalizedEmail);
  const storeRec = userStore[normalizedEmail];
  const hasActiveAccount = Boolean((existing && existing.passwordHash) || storeRec || isEnvAdm || isPrimAdm);
  if (hasActiveAccount) {
    return res.json({
      ok: true,
      exists: true,
      hasPassword: Boolean(existing?.passwordHash || (isEnvAdm && getSharedAdminPassword(process.env))),
      hasGoogle: false
    });
  }
  return res.json({
    ok: true,
    exists: false,
    allowRegister: existing?.role === 'admin' || systemSettings.allowNewRegistrations !== false
  });
});

app.post('/api/auth/login', async (req, res) => {
  const ip = getClientIp(req);
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'ایمیل و رمز عبور را وارد کنید.' });
  const normalizedEmail = cleanEmail(email);
  if (!isEmail(normalizedEmail) || normalizedEmail.length > 120) {
    return res.status(400).json({ error: 'ایمیل معتبر نیست.' });
  }
  if (!checkRateLimit(`login:${ip}:${normalizedEmail}`, 8, 900) || !checkRateLimit(`login_ip:${ip}`, 20, 900)) {
    return res.status(429).json({ error: 'تعداد تلاش‌های ورود بیش از حد مجاز است. لطفاً ۱۵ دقیقه صبر کنید.' });
  }

  const passStr = String(password);
  if (!okPass(passStr)) {
    return res.status(401).json({ error: 'ایمیل یا رمز عبور نادرست است.' });
  }

  let existing = systemUsers.find(u => u.email.toLowerCase() === normalizedEmail);
  const meta = getAdminRoleMeta(normalizedEmail, existing?.role);

  if (existing && existing.status === 'suspended' && !meta.isPrimaryAdmin && !meta.envPinned) {
    return res.status(403).json({ error: 'حساب کاربری شما توسط مدیریت مسدود شده است.' });
  }

  if (meta.envPinned && !claimedPrimaryAdminEmail && isEmailAdmin(normalizedEmail)) {
    if (cleanEmail(passStr) === normalizedEmail) {
      return res.status(401).json({ error: 'استفاده از آدرس ایمیل به‌عنوان رمز عبور مدیر مجاز نیست.' });
    }
    const envAdminPass = getSharedAdminPassword(process.env);
    let adminAuthenticated = false;
    if (existing?.passwordHash && await verifyStoredPassword(passStr, existing.passwordHash)) {
      adminAuthenticated = true;
      if (shouldUpgradeStoredHash(existing.passwordHash)) {
        existing.passwordHash = await hashPassword(passStr, process.env);
      }
    } else if ((!existing || !existing.passwordHash) && envAdminPass && teq(passStr, envAdminPass)) {
      adminAuthenticated = true;
      const newHash = await hashPassword(passStr, process.env);
      if (!existing) {
        const isPrimary = normalizedEmail === getResolvedPrimaryAdminEmail();
        existing = {
          id: isPrimary && !systemUsers.some(u => u.id === 'u_admin') ? 'u_admin' : ('u_adm_' + crypto.randomBytes(6).toString('hex')),
          name: isPrimary ? 'مدیر کل دارایی' : normalizedEmail.split('@')[0],
          email: normalizedEmail,
          role: 'admin',
          status: 'active',
          registeredAt: 'هم‌اکنون',
          holdingsCount: 0,
          alertsCount: 0,
          lastLogin: 'هم‌اکنون',
          passwordHash: newHash
        };
        systemUsers.unshift(existing);
      } else {
        existing.passwordHash = newHash;
      }
    }
    if (!adminAuthenticated) {
      return res.status(401).json({ error: 'ایمیل یا رمز عبور نادرست است.' });
    }
  } else {
    if (!existing || !existing.passwordHash || !(await verifyStoredPassword(passStr, existing.passwordHash))) {
      return res.status(401).json({ error: 'ایمیل یا رمز عبور نادرست است.' });
    }
    if (shouldUpgradeStoredHash(existing.passwordHash)) {
      existing.passwordHash = await hashPassword(passStr, process.env);
    }
  }

  const targetUser = existing!;
  targetUser.lastLogin = 'هم‌اکنون';
  const sessionUser = await createSessionForUser(res, req, targetUser);
  saveAuthSessionToDisk();

  systemAuditLogs.unshift({
    id: Date.now(),
    time: 'هم‌اکنون',
    type: 'auth',
    msg: `ورود موفق کاربر: ${sessionUser.email} (${sessionUser.isAdmin ? 'سطح دسترسی: مدیر ارشد' : 'کاربر'})`
  });
  if (systemAuditLogs.length > 40) systemAuditLogs.pop();
  res.json({ ok: true, user: sessionUser });
});

app.post('/api/auth/claim-admin', async (req, res) => {
  const ip = getClientIp(req);
  if (!checkRateLimit(`claim_admin:${ip}`, 10, 900)) {
    return res.status(429).json({ error: 'تعداد تلاش‌ها بیش از حد مجاز است. کمی صبر کنید.' });
  }
  const configuredSecret = getAdminSecret(process.env);
  if (!configuredSecret) {
    return res.status(403).json({ error: 'سیکرت مدیر کل روی سرور تنظیم نشده است.' });
  }
  const { secret, email, password, name } = req.body || {};
  const secretStr = String(secret || '').trim();
  if (!secretStr || !teq(secretStr, configuredSecret)) {
    return res.status(401).json({ error: 'سیکرت ادمین کل نامعتبر است.' });
  }
  if (getResolvedPrimaryAdminEmail()) {
    return res.status(409).json({ error: 'مدیر اصلی سیستم قبلاً انتخاب شده است. ادمین‌های بعدی فقط از داخل پنل مدیریت تعریف می‌شوند.' });
  }
  const normalizedEmail = cleanEmail(email);
  if (!isEmail(normalizedEmail) || normalizedEmail.length > 120) {
    return res.status(400).json({ error: 'ایمیل معتبر نیست.' });
  }
  const rawName = String(name || '').trim().slice(0, 40);
  if (rawName && rawName.length < 2) {
    return res.status(400).json({ error: 'نام باید حداقل ۲ کاراکتر باشد.' });
  }
  const passStr = String(password || '').slice(0, 128);
  if (!okPass(passStr)) {
    return res.status(400).json({ error: 'رمز عبور باید حداقل ۸ کاراکتر باشد.' });
  }
  if (cleanEmail(passStr) === normalizedEmail) {
    return res.status(400).json({ error: 'رمز عبور نمی‌تواند برابر با آدرس ایمیل باشد.' });
  }

  let target = systemUsers.find(u => u.email.toLowerCase() === normalizedEmail);
  if (target && target.status === 'suspended') {
    return res.status(403).json({ error: 'حساب کاربری شما مسدود شده است.' });
  }
  const passHash = await hashPassword(passStr, process.env);
  claimedPrimaryAdminEmail = normalizedEmail;
  if (target) {
    target.name = rawName || target.name || 'مدیر کل دارایی';
    target.role = 'admin';
    target.status = 'active';
    target.passwordHash = passHash;
    target.lastLogin = 'هم‌اکنون';
  } else {
    target = {
      id: !systemUsers.some(u => u.id === 'u_admin') ? 'u_admin' : ('u_adm_' + crypto.randomBytes(6).toString('hex')),
      name: rawName || 'مدیر کل دارایی',
      email: normalizedEmail,
      role: 'admin',
      status: 'active',
      registeredAt: 'هم‌اکنون',
      holdingsCount: 0,
      alertsCount: 0,
      lastLogin: 'هم‌اکنون',
      passwordHash: passHash
    };
    systemUsers.unshift(target);
  }
  const sessionUser = await createSessionForUser(res, req, target);
  saveAuthSessionToDisk();

  systemAuditLogs.unshift({
    id: Date.now(),
    time: 'هم‌اکنون',
    type: 'admin',
    msg: `مدیر اصلی سیستم (${normalizedEmail}) با سیکرت فعال شد.`
  });
  if (systemAuditLogs.length > 40) systemAuditLogs.pop();
  res.json({ ok: true, user: sessionUser });
});

// Admin Panel APIs
app.use('/api/admin', async (req, res, next) => {
  const ip = getClientIp(req);
  if (!checkRateLimit(`admin:${ip}`, 60, 60)) {
    return res.status(429).json({ error: 'تعداد درخواست‌های پنل مدیریت بیش از حد مجاز است.' });
  }
  const u = await resolveReqUser(req);
  if (!u || !u.isAdmin) {
    return res.status(403).json({ error: 'دسترسی فقط برای مدیر سیستم مجاز است.' });
  }
  next();
});

const formatFeedResponse = (f: SystemFeed) => ({
  ...f,
  active: f.status === 'active',
  protocol: f.type
});

app.get('/api/admin/overview', (_req, res) => {
  const now = Math.floor(Date.now() / 1000);
  const items = cachedPrices.items || {};
  const totalCrypto = Object.values(items).filter((i: any) => i.crypto).length;
  const totalDomestic = Object.values(items).filter((i: any) => i.kind === 'domestic').length;
  
  res.json({
    ok: true,
    system: {
      database: true,
      kv: 'local_file_snapshot',
      google: false,
      email: false,
      marketOpen: isTehranMarketOpen(now)
    },
    stats: {
      totalUsers: systemUsers.length,
      activeUsers: systemUsers.filter(u => u.status === 'active').length,
      trackedHoldings: systemUsers.reduce((s, u) => s + u.holdingsCount, 0),
      totalAlerts: systemUsers.reduce((s, u) => s + u.alertsCount, 0),
      uptimeSeconds: process.uptime(),
      memoryMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      totalMarkets: Object.keys(items).length,
      totalCrypto,
      totalDomestic,
      lastSyncTime: lastFetchTime ? new Date(lastFetchTime * 1000).toLocaleTimeString('fa-IR') : '—'
    },
    feeds: [...systemFeeds].sort((a, b) => a.priority - b.priority).map(formatFeedResponse),
    broadcast: broadcastMessage
  });
});

const normalizeServerFeeds = () => {
  systemFeeds.sort((a, b) => a.priority - b.priority);
  systemFeeds.forEach((f, idx) => { f.priority = idx + 1; });
};

app.get('/api/admin/feeds', (req, res) => {
  normalizeServerFeeds();
  const sorted = [...systemFeeds].map(formatFeedResponse);
  res.json({ ok: true, feeds: sorted });
});

app.post('/api/admin/feeds/add', (req, res) => {
  const { name, url } = req.body || {};
  const type = req.body?.type || req.body?.protocol || 'crypto';
  if (!name || !url) return res.status(400).json({ error: 'نام و آدرس ایندپوینت الزامی است.' });
  if (!isSafePublicUrl(String(url))) return res.status(400).json({ error: 'فقط آدرس‌های عمومی و امن (https:// یا wss://) مجاز هستند.' });
  normalizeServerFeeds();
  const maxPriority = systemFeeds.reduce((max, f) => Math.max(max, f.priority), 0);
  const newFeed: SystemFeed = {
    id: 'f_' + Date.now(),
    name: String(name).trim().slice(0, 80),
    url: String(url).trim().slice(0, 300),
    type: ['crypto', 'domestic', 'tether', 'websocket'].includes(type) ? type : 'crypto',
    status: 'active',
    pingMs: 0,
    reliability: '100%',
    priority: maxPriority + 1,
    custom: true
  };
  systemFeeds.push(newFeed);
  normalizeServerFeeds();
  systemAuditLogs.unshift({
    id: Date.now(),
    time: 'هم‌اکنون',
    type: 'admin',
    msg: `فید وب‌سرویس جدید ${newFeed.name} با اولویت ${newFeed.priority} اضافه گردید.`
  });
  res.json({ ok: true, feed: formatFeedResponse(newFeed), feeds: systemFeeds.map(formatFeedResponse) });
});

app.post('/api/admin/feeds/:id/toggle', (req, res) => {
  normalizeServerFeeds();
  const f = systemFeeds.find(x => x.id === req.params.id);
  if (!f) return res.status(404).json({ error: 'فید یافت نشد.' });
  f.status = f.status === 'active' ? 'inactive' : 'active';
  lastFetchTime = 0;
  if (cachedPrices) cachedPrices.checkedAt = 0;
  systemAuditLogs.unshift({
    id: Date.now(),
    time: 'هم‌اکنون',
    type: 'admin',
    msg: `وضعیت وب‌سرویس ${f.name} به ${f.status === 'active' ? 'فعال' : 'غیرفعال'} تغییر یافت.`
  });
  res.json({ ok: true, feed: formatFeedResponse(f), feeds: systemFeeds.map(formatFeedResponse) });
});

app.post('/api/admin/feeds/:id/move-up', (req, res) => {
  normalizeServerFeeds();
  const idx = systemFeeds.findIndex(x => x.id === req.params.id);
  if (idx > 0) {
    [systemFeeds[idx - 1], systemFeeds[idx]] = [systemFeeds[idx], systemFeeds[idx - 1]];
    normalizeServerFeeds();
    lastFetchTime = 0;
    if (cachedPrices) cachedPrices.checkedAt = 0;
    systemAuditLogs.unshift({
      id: Date.now(),
      time: 'هم‌اکنون',
      type: 'admin',
      msg: `اولویت فید ${systemFeeds[idx - 1].name} به رتبه ${systemFeeds[idx - 1].priority} ارتقا یافت.`
    });
  }
  const result = systemFeeds.map(formatFeedResponse);
  res.json({ ok: true, feeds: result });
});

app.post('/api/admin/feeds/:id/move-down', (req, res) => {
  normalizeServerFeeds();
  const idx = systemFeeds.findIndex(x => x.id === req.params.id);
  if (idx !== -1 && idx < systemFeeds.length - 1) {
    [systemFeeds[idx], systemFeeds[idx + 1]] = [systemFeeds[idx + 1], systemFeeds[idx]];
    normalizeServerFeeds();
    lastFetchTime = 0;
    if (cachedPrices) cachedPrices.checkedAt = 0;
    systemAuditLogs.unshift({
      id: Date.now(),
      time: 'هم‌اکنون',
      type: 'admin',
      msg: `اولویت فید ${systemFeeds[idx + 1].name} به رتبه ${systemFeeds[idx + 1].priority} تنزل یافت.`
    });
  }
  const result = systemFeeds.map(formatFeedResponse);
  res.json({ ok: true, feeds: result });
});

app.delete('/api/admin/feeds/:id', (req, res) => {
  const idx = systemFeeds.findIndex(x => x.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'فید یافت نشد.' });
  const [removed] = systemFeeds.splice(idx, 1);
  normalizeServerFeeds();
  lastFetchTime = 0;
  if (cachedPrices) cachedPrices.checkedAt = 0;
  systemAuditLogs.unshift({
    id: Date.now(),
    time: 'هم‌اکنون',
    type: 'admin',
    msg: `فید وب‌سرویس ${removed.name} توسط مدیر حذف شد.`
  });
  res.json({ ok: true, feeds: systemFeeds.map(formatFeedResponse) });
});

app.post('/api/admin/feeds/:id/test', async (req, res) => {
  const f = systemFeeds.find(x => x.id === req.params.id);
  if (!f) return res.status(404).json({ error: 'فید یافت نشد.' });
  if (!isSafePublicUrl(f.url)) {
    return res.status(400).json({ error: 'آدرس فید نامعتبر یا غیرمجاز است.' });
  }
  const start = performance.now();
  let ok = false;
  let status = 0;
  const pingUrlSafe = async (targetUrl: string) => {
    let cur = targetUrl;
    for (let hop = 0; hop < 4; hop++) {
      if (!isSafePublicUrl(cur)) return { ok: false, status: 0 };
      const ctrl = new AbortController();
      const tid = setTimeout(() => ctrl.abort(), 5000);
      try {
        const resp = await fetch(cur, {
          method: 'GET',
          headers: {
            'cache-control': 'no-cache',
            'pragma': 'no-cache',
            'user-agent': 'Mozilla/5.0 (compatible; Darayi/1.0)',
            'accept': 'application/json, text/plain, text/html;q=0.9, */*;q=0.8'
          },
          redirect: 'manual',
          signal: ctrl.signal
        });
        if (resp.status >= 300 && resp.status < 400) {
          const loc = resp.headers.get('location');
          try { await resp.body?.cancel?.(); } catch {}
          if (!loc) return { ok: false, status: resp.status };
          cur = new URL(loc, cur).href;
          continue;
        }
        const st = resp.status;
        const isOk = resp.ok;
        try {
          const reader = resp.body?.getReader?.();
          if (reader) {
            await reader.read();
            await reader.cancel().catch(() => {});
          }
        } catch {}
        return { ok: isOk, status: st };
      } finally {
        clearTimeout(tid);
      }
    }
    return { ok: false, status: 0 };
  };
  try {
    if (f.url.startsWith('https://')) {
      const r = await pingUrlSafe(f.url);
      ok = r.ok;
      status = r.status;
    } else if (f.url.startsWith('wss://')) {
      const probeHttps = 'https://' + new URL(f.url).host + '/';
      const r = await pingUrlSafe(probeHttps);
      status = r.status > 0 ? r.status : 101;
      ok = r.status > 0 && r.status < 500;
    }
  } catch {
    ok = false;
    status = 0;
  }
  const rawPing = Math.round(performance.now() - start);
  const timerLimited = rawPing <= 0;
  const ping = rawPing > 0 ? rawPing : null;
  if (ping !== null) f.pingMs = ping;
  res.json({ ok, pingMs: ping, timerLimited, httpStatus: status });
});

function sanitizeUserForAdmin(u: StoredUser) {
  const meta = getAdminRoleMeta(u.email, u.role);
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: meta.role,
    isPrimaryAdmin: meta.isPrimaryAdmin,
    adminTier: meta.adminTier,
    envPinned: meta.envPinned,
    status: u.status,
    registeredAt: u.registeredAt,
    holdingsCount: u.holdingsCount,
    alertsCount: u.alertsCount,
    lastLogin: u.lastLogin
  };
}

app.get('/api/admin/users', (req, res) => {
  res.json({ ok: true, users: systemUsers.map(sanitizeUserForAdmin) });
});

app.post('/api/admin/users/:id/toggle', async (req, res) => {
  const reqAdmin = await resolveReqUser(req);
  const u = systemUsers.find(x => x.id === req.params.id);
  if (!u) return res.status(404).json({ error: 'کاربر یافت نشد.' });
  const meta = getAdminRoleMeta(u.email, u.role);
  if (meta.isPrimaryAdmin || meta.envPinned || (reqAdmin && u.id === reqAdmin.id)) {
    return res.status(400).json({ error: 'امکان تغییر وضعیت مدیر اصلی یا ادمین‌های ثابت وجود ندارد.' });
  }
  if (meta.isAdmin && !reqAdmin?.isPrimaryAdmin) {
    return res.status(403).json({ error: 'فقط مدیر اصلی سیستم می‌تواند وضعیت ادمین‌های ثانویه را تغییر دهد.' });
  }
  u.status = u.status === 'active' ? 'suspended' : 'active';
  if (u.status === 'suspended') {
    revokeUserSessions(u.email);
  }
  saveAuthSessionToDisk();
  systemAuditLogs.unshift({
    id: Date.now(),
    time: 'هم‌اکنون',
    type: 'system',
    msg: `وضعیت کاربر ${u.email} به ${u.status === 'active' ? 'فعال' : 'مسدود'} تغییر یافت.`
  });
  res.json({ ok: true, user: sanitizeUserForAdmin(u) });
});

app.post('/api/admin/users/:id/role', async (req, res) => {
  const reqAdmin = await resolveReqUser(req);
  if (!reqAdmin || !reqAdmin.isPrimaryAdmin) {
    return res.status(403).json({ error: 'تغییر سطح دسترسی ادمین فقط توسط مدیر اصلی سیستم مجاز است.' });
  }
  const u = systemUsers.find(x => x.id === req.params.id || x.email.toLowerCase() === decodeURIComponent(req.params.id).toLowerCase());
  if (!u) return res.status(404).json({ error: 'کاربر یافت نشد.' });
  const nextRole = req.body?.role === 'admin' ? 'admin' : req.body?.role === 'user' ? 'user' : '';
  if (!nextRole) return res.status(400).json({ error: 'نقش درخواستی نامعتبر است.' });
  const meta = getAdminRoleMeta(u.email, u.role);
  if (meta.isPrimaryAdmin || u.id === reqAdmin.id) {
    return res.status(400).json({ error: 'نقش مدیر اصلی سیستم قابل تغییر نیست.' });
  }
  if (meta.envPinned && nextRole === 'user') {
    return res.status(400).json({ error: 'این ادمین از طریق تنظیمات محیطی سرور تعریف شده است و از پنل قابل لغو نیست.' });
  }
  if (nextRole === 'admin' && u.status === 'suspended') {
    return res.status(400).json({ error: 'ابتدا حساب کاربر را از حالت مسدود خارج کنید.' });
  }
  u.role = nextRole;
  const normEmail = cleanEmail(u.email);
  for (const sess of activeSessions.values()) {
    if (sess.email === normEmail) {
      sess.role = nextRole;
      sess.isAdmin = nextRole === 'admin';
    }
  }
  saveAuthSessionToDisk();
  systemAuditLogs.unshift({
    id: Date.now(),
    time: 'هم‌اکنون',
    type: 'admin',
    msg: `نقش کاربر ${u.email} به ${nextRole === 'admin' ? 'ادمین ثانویه' : 'کاربر عادی'} تغییر یافت.`
  });
  res.json({ ok: true, user: sanitizeUserForAdmin(u) });
});

app.get('/api/admin/logs', (req, res) => {
  res.json({ ok: true, logs: systemAuditLogs });
});

app.post('/api/admin/logs/clear', (req, res) => {
  systemAuditLogs = [
    { id: Date.now(), time: 'هم‌اکنون', type: 'system', msg: 'گزارش وقایع توسط مدیر سیستم پاکسازی شد.' }
  ];
  res.json({ ok: true });
});

app.post('/api/admin/users/add', async (req, res) => {
  const reqAdmin = await resolveReqUser(req);
  const { name, email, password, role } = req.body || {};
  if (!email) return res.status(400).json({ error: 'ایمیل الزامی است.' });
  const normalizedEmail = cleanEmail(email);
  if (!isEmail(normalizedEmail) || normalizedEmail.length > 120) {
    return res.status(400).json({ error: 'ایمیل معتبر نیست.' });
  }
  const requestedAdmin = role === 'admin';
  if (requestedAdmin && !reqAdmin?.isPrimaryAdmin) {
    return res.status(403).json({ error: 'فقط مدیر اصلی سیستم می‌تواند ادمین جدید در داشبورد انتخاب کند.' });
  }
  const pass = String(password || '').trim();
  if (!requestedAdmin && !okPass(pass)) {
    return res.status(400).json({ error: 'رمز عبور باید حداقل ۸ کاراکتر باشد.' });
  }
  if (pass && !okPass(pass)) {
    return res.status(400).json({ error: 'در صورت وارد کردن رمز عبور، طول آن باید حداقل ۸ کاراکتر باشد.' });
  }
  if (pass && cleanEmail(pass) === normalizedEmail) {
    return res.status(400).json({ error: 'رمز عبور نمی‌تواند برابر با آدرس ایمیل باشد.' });
  }
  const existing = systemUsers.find(u => u.email.toLowerCase() === normalizedEmail);
  if (existing && !requestedAdmin) {
    return res.status(409).json({ error: 'این ایمیل قبلاً ثبت شده است.' });
  }
  if (existing && requestedAdmin) {
    if (name && String(name).trim()) {
      existing.name = String(name).trim().slice(0, 80);
    }
    if (pass) {
      existing.passwordHash = await hashPassword(pass, process.env);
    }
    existing.role = 'admin';
    existing.status = 'active';
    for (const sess of activeSessions.values()) {
      if (sess.email === normalizedEmail) {
        sess.role = 'admin';
        sess.isAdmin = true;
      }
    }
    saveAuthSessionToDisk();
    systemAuditLogs.unshift({
      id: Date.now(),
      time: 'هم‌اکنون',
      type: 'admin',
      msg: `کاربر ${existing.email} توسط مدیر اصلی به ادمین ثانویه ارتقا یافت.`
    });
    return res.json({ ok: true, user: sanitizeUserForAdmin(existing) });
  }
  const finalName = String(name || '').trim().slice(0, 80) || normalizedEmail.split('@')[0];
  const newUser: StoredUser = {
    id: 'u_' + Date.now(),
    name: finalName,
    email: normalizedEmail,
    role: (requestedAdmin || isEmailAdmin(normalizedEmail)) ? 'admin' : 'user',
    status: 'active',
    registeredAt: 'هم‌اکنون',
    holdingsCount: 0,
    alertsCount: 0,
    lastLogin: requestedAdmin && !pass ? 'انتخاب‌شده در پنل' : 'تازه ثبت‌نام‌شده',
    passwordHash: pass ? await hashPassword(pass, process.env) : ''
  };
  systemUsers.unshift(newUser);
  saveAuthSessionToDisk();
  systemAuditLogs.unshift({
    id: Date.now(),
    time: 'هم‌اکنون',
    type: 'admin',
    msg: requestedAdmin
      ? `ادمین ثانویه جدید (${newUser.email}) توسط مدیر اصلی در داشبورد انتخاب شد.`
      : `کاربر جدید با ایمیل ${newUser.email} توسط مدیر ایجاد شد.`
  });
  res.json({ ok: true, user: sanitizeUserForAdmin(newUser) });
});

const previewTransferBackups: Record<string, any> = {};

app.post('/api/admin/users/transfer-assets', async (req, res) => {
  const reqAdmin = await resolveReqUser(req);
  if (!reqAdmin || !reqAdmin.isPrimaryAdmin) {
    return res.status(403).json({ error: 'انتقال امن دارایی بین حساب‌ها فقط توسط مدیر اصلی سیستم مجاز است.' });
  }
  const rawSource = String(req.body?.source || '').trim();
  const rawTarget = String(req.body?.target || '').trim();
  const dryRun = Boolean(req.body?.dryRun);
  if (!rawSource || !rawTarget) {
    return res.status(400).json({ error: 'شناسه یا ایمیل حساب مبدا و حساب مقصد الزامی است.' });
  }

  const resolvePreviewAccount = (rawRef: string, roleLabel: 'source' | 'target') => {
    const cleanRef = rawRef.trim();
    const lowerRef = cleanRef.toLowerCase();
    const matchedUser = systemUsers.find(
      (u) => u.id.toLowerCase() === lowerRef || u.email.toLowerCase() === lowerRef
    );
    if (matchedUser) {
      return {
        userId: matchedUser.id,
        storeKey: matchedUser.email.toLowerCase(),
        email: matchedUser.email.toLowerCase(),
        name: matchedUser.name || ''
      };
    }
    if (userStore[lowerRef]) {
      return {
        userId: cleanRef,
        storeKey: lowerRef,
        email: lowerRef.includes('@') ? lowerRef : '',
        name: ''
      };
    }
    return {
      error: roleLabel === 'source' ? 'حساب مبدا یافت نشد.' : 'حساب مقصد یافت نشد.'
    };
  };

  const srcAcct = resolvePreviewAccount(rawSource, 'source');
  if ('error' in srcAcct) return res.status(404).json({ error: srcAcct.error });
  const tgtAcct = resolvePreviewAccount(rawTarget, 'target');
  if ('error' in tgtAcct) return res.status(404).json({ error: tgtAcct.error });
  if (srcAcct.storeKey === tgtAcct.storeKey) {
    return res.status(400).json({ error: 'حساب مبدا و مقصد نمی‌توانند یکسان باشند.' });
  }

  const srcRec = userStore[srcAcct.storeKey]?.data || { holdings: [], watch: [], featured: [], alerts: [], settings: {} };
  const tgtRec = userStore[tgtAcct.storeKey]?.data || { holdings: [], watch: [], featured: [], alerts: [], settings: {} };

  const holdingSig = (h: any) => [
    String(h?.assetId || '').trim().toLowerCase(),
    String(h?.side || 'buy').trim().toLowerCase(),
    Number(h?.qty) || 0,
    Number(h?.buyPrice) || 0,
    String(h?.wallet || '').trim(),
    String(h?.date || '').trim(),
    Number(h?.fee) || 0,
    String(h?.note || '').trim()
  ].join('|');

  const srcHoldings = Array.isArray(srcRec.holdings) ? srcRec.holdings : [];
  const tgtHoldings = Array.isArray(tgtRec.holdings) ? tgtRec.holdings : [];
  const seenIds = new Set(tgtHoldings.map((h: any) => String(h?.id || '').trim()).filter(Boolean));
  const seenSigs = new Set(tgtHoldings.map(holdingSig));
  const mergedHoldings = [...tgtHoldings];
  let addedHoldings = 0;
  let skippedDuplicateHoldings = 0;

  for (const h of srcHoldings) {
    if (!h || typeof h !== 'object') continue;
    const hId = String(h.id || '').trim();
    const sig = holdingSig(h);
    if ((hId && seenIds.has(hId)) || seenSigs.has(sig)) {
      skippedDuplicateHoldings++;
      continue;
    }
    const finalId = hId || `tr_${crypto.randomBytes(4).toString('hex')}`;
    seenIds.add(finalId);
    seenSigs.add(sig);
    mergedHoldings.push({ ...h, id: finalId });
    addedHoldings++;
  }

  const srcWatch = Array.isArray(srcRec.watch) ? srcRec.watch : [];
  const tgtWatch = Array.isArray(tgtRec.watch) ? tgtRec.watch : [];
  const seenWatch = new Set(tgtWatch.map((w: any) => String(w || '').trim().toLowerCase()).filter(Boolean));
  const mergedWatch = [...tgtWatch];
  let addedWatch = 0;
  for (const w of srcWatch) {
    const cw = String(w || '').trim();
    if (!cw || seenWatch.has(cw.toLowerCase())) continue;
    seenWatch.add(cw.toLowerCase());
    mergedWatch.push(cw);
    addedWatch++;
  }

  const srcFeatured = Array.isArray(srcRec.featured) ? srcRec.featured : [];
  const tgtFeatured = Array.isArray(tgtRec.featured) ? tgtRec.featured : [];
  const adoptedFeatured = tgtFeatured.length === 0 && srcFeatured.length > 0;
  const mergedFeatured = adoptedFeatured ? [...srcFeatured] : [...tgtFeatured];

  const srcSettings = (srcRec.settings && typeof srcRec.settings === 'object') ? srcRec.settings : {};
  const tgtSettings = (tgtRec.settings && typeof tgtRec.settings === 'object') ? tgtRec.settings : {};
  const mergedSettings = { ...tgtSettings };
  let mergedSettingsKeys = 0;
  for (const [k, v] of Object.entries(srcSettings)) {
    if (!Object.hasOwn(mergedSettings, k)) {
      mergedSettings[k] = v;
      mergedSettingsKeys++;
    }
  }

  const srcAlerts = Array.isArray(srcRec.alerts) ? srcRec.alerts : [];
  const tgtAlerts = Array.isArray(tgtRec.alerts) ? tgtRec.alerts : [];
  const alertSig = (a: any) => [
    String(a?.assetId || '').trim().toLowerCase(),
    String(a?.direction || '').trim().toLowerCase(),
    Number(a?.price) || 0,
    String(a?.currency || 'IRT').trim().toUpperCase()
  ].join('|');
  const seenAlertSigs = new Set(tgtAlerts.map(alertSig));
  const mergedAlerts = [...tgtAlerts];
  let addedAlerts = 0;
  let skippedDuplicateAlerts = 0;
  for (const a of srcAlerts) {
    if (!a || typeof a !== 'object') continue;
    const sig = alertSig(a);
    if (seenAlertSigs.has(sig)) {
      skippedDuplicateAlerts++;
      continue;
    }
    seenAlertSigs.add(sig);
    mergedAlerts.push({ ...a, id: `tr_${String(a.id || crypto.randomBytes(4).toString('hex'))}` });
    addedAlerts++;
  }

  const wouldChange = Boolean(
    addedHoldings > 0 ||
    addedWatch > 0 ||
    adoptedFeatured ||
    mergedSettingsKeys > 0 ||
    addedAlerts > 0
  );

  const summary = {
    sourceHoldings: srcHoldings.length,
    targetHoldingsBefore: tgtHoldings.length,
    targetHoldingsAfter: mergedHoldings.length,
    addedHoldings,
    skippedDuplicateHoldings,
    addedWatch,
    adoptedFeatured,
    mergedSettingsKeys,
    sourceAlerts: srcAlerts.length,
    addedAlerts,
    skippedDuplicateAlerts,
    wouldChange
  };

  if (dryRun) {
    return res.json({
      ok: true,
      dryRun: true,
      backupKey: null,
      source: { userId: srcAcct.userId, email: srcAcct.email, name: srcAcct.name },
      target: { userId: tgtAcct.userId, email: tgtAcct.email, name: tgtAcct.name },
      summary
    });
  }

  const now = Math.floor(Date.now() / 1000);
  const backupKey = `backup:asset_transfer:${tgtAcct.userId}:${now}:${crypto.randomBytes(2).toString('hex')}`;
  previewTransferBackups[backupKey] = {
    createdAt: now,
    source: srcAcct,
    target: tgtAcct,
    sourceSnapshot: srcRec,
    targetSnapshotBefore: tgtRec
  };

  if (wouldChange) {
    const prevObj = userStore[tgtAcct.storeKey];
    const currentRev = Number(prevObj?.updatedAt) || 0;
    const nextRev = (Number(prevObj?.revision) || 0) + 1;
    userStore[tgtAcct.storeKey] = {
      ok: true,
      status: 'loaded',
      exists: true,
      revision: nextRev,
      updatedAt: Math.max(Date.now() * 1000, currentRev + 1),
      data: {
        holdings: mergedHoldings,
        watch: mergedWatch,
        featured: mergedFeatured,
        alerts: mergedAlerts,
        settings: mergedSettings
      }
    };
    const usr = systemUsers.find(x => x.email.toLowerCase() === tgtAcct.storeKey);
    if (usr) {
      usr.holdingsCount = mergedHoldings.length;
      usr.alertsCount = mergedAlerts.length;
    }
    saveAuthSessionToDisk();
  }

  systemAuditLogs.unshift({
    id: Date.now(),
    time: 'هم‌اکنون',
    type: 'admin',
    msg: `انتقال امن دارایی از ${srcAcct.email || srcAcct.userId} به ${tgtAcct.email || tgtAcct.userId} (${addedHoldings} رکورد جدید، پشتیبان ${backupKey})`
  });

  res.json({
    ok: true,
    dryRun: false,
    backupKey,
    source: { userId: srcAcct.userId, email: srcAcct.email, name: srcAcct.name },
    target: { userId: tgtAcct.userId, email: tgtAcct.email, name: tgtAcct.name },
    summary
  });
});

app.post('/api/admin/password', async (req, res) => {
  const reqAdmin = await resolveReqUser(req);
  if (!reqAdmin || !reqAdmin.isAdmin) {
    return res.status(403).json({ error: 'دسترسی فقط برای مدیر سیستم مجاز است.' });
  }
  const newPassword = String(req.body?.newPassword || req.body?.password || '').trim();
  if (!okPass(newPassword)) {
    return res.status(400).json({ error: 'رمز عبور جدید باید بین ۸ تا ۱۲۸ کاراکتر باشد.' });
  }
  const targetEmail = cleanEmail(reqAdmin.email);
  if (targetEmail && cleanEmail(newPassword) === targetEmail) {
    return res.status(400).json({ error: 'رمز عبور مدیر نمی‌تواند برابر با آدرس ایمیل باشد.' });
  }
  const adminUser = systemUsers.find(u => u.email.toLowerCase() === targetEmail);
  if (adminUser) {
    adminUser.passwordHash = await hashPassword(newPassword, process.env);
    revokeUserSessions(adminUser.email);
    await createSessionForUser(res, req, adminUser);
    saveAuthSessionToDisk();
  } else if (targetEmail) {
    revokeUserSessions(targetEmail);
  }
  systemAuditLogs.unshift({
    id: Date.now(),
    time: 'هم‌اکنون',
    type: 'admin',
    msg: `رمز عبور مدیر (${targetEmail}) با موفقیت تغییر یافت و نشست‌های قبلی باطل شدند.`
  });
  res.json({ ok: true });
});

let systemSettings = {
  maintenance: false,
  baseCurrency: 'toman',
  pollIntervalSec: 15,
  defaultFeePct: 0.1,
  allowNewRegistrations: true
};

app.get('/api/admin/settings', (req, res) => {
  res.json({ ok: true, settings: systemSettings });
});

app.post('/api/admin/settings', (req, res) => {
  const body = req.body || {};
  systemSettings = {
    maintenance: Boolean(body.maintenance ?? systemSettings.maintenance),
    baseCurrency: body.baseCurrency === 'rial' ? 'rial' : 'toman',
    pollIntervalSec: Math.min(300, Math.max(5, Number(body.pollIntervalSec) || 15)),
    defaultFeePct: Math.min(10, Math.max(0, Number(body.defaultFeePct) || 0)),
    allowNewRegistrations: Boolean(body.allowNewRegistrations ?? systemSettings.allowNewRegistrations)
  };
  systemAuditLogs.unshift({
    id: Date.now(),
    time: 'هم‌اکنون',
    type: 'system',
    msg: 'تنظیمات کلان سامانه توسط مدیر به‌روزرسانی شد.'
  });
  res.json({ ok: true, settings: systemSettings });
});

app.post('/api/admin/clear-cache', async (req, res) => {
  const reqAdmin = await resolveReqUser(req);
  if (!reqAdmin || !reqAdmin.isAdmin) {
    return res.status(403).json({ error: 'دسترسی فقط برای مدیر سیستم مجاز است.' });
  }
  cachedPrices = { version: KV_SNAPSHOT_VERSION, items: {}, updatedAt: 0, checkedAt: 0, feeds: {} };
  lastFetchTime = 0;
  historyMemCache.clear();
  dailyArchiveMemCache.clear();
  domesticIntradayTicks.clear();
  domesticPrevCloseCache = null;
  domesticPrevCloseTime = 0;
  dynamicCryptoIconsCache = null;
  dynamicCryptoIconsTime = 0;
  dynamicCryptoIconsJob = null;
  try {
    if (fs.existsSync(CACHE_FILE)) fs.unlinkSync(CACHE_FILE);
  } catch {}
  systemAuditLogs.unshift({
    id: Date.now(),
    time: 'هم‌اکنون',
    type: 'system',
    msg: 'تمام لایه‌های کش موقت قیمت، نمودار و آیکون‌ها توسط مدیر تخلیه شد.'
  });
  res.json({ ok: true });
});

app.get('/api/admin/migrations', async (req, res) => {
  const reqAdmin = await resolveReqUser(req);
  if (!reqAdmin || !reqAdmin.isAdmin) {
    return res.status(403).json({ error: 'دسترسی فقط برای مدیر سیستم مجاز است.' });
  }
  res.json({
    ok: true,
    healthy: true,
    preview: true,
    missingTables: [],
    missingColumns: [],
    missingIndexes: [],
    migrations: [
      { version: '001_fix', status: 'applied' },
      { version: '002_admin_roles', status: 'applied' },
      { version: '003_legacy_columns', status: 'applied' },
      { version: '004_schema_reconcile', status: 'applied' }
    ]
  });
});

app.post('/api/admin/migrations/run', async (req, res) => {
  const reqAdmin = await resolveReqUser(req);
  if (!reqAdmin || !reqAdmin.isPrimaryAdmin) {
    return res.status(403).json({ error: 'اجرای دستی Migration فقط توسط مدیر اصلی سیستم مجاز است.' });
  }
  const status = {
    ok: true,
    healthy: true,
    preview: true,
    missingTables: [],
    missingColumns: [],
    missingIndexes: [],
    migrations: [
      { version: '001_fix', status: 'applied' },
      { version: '002_admin_roles', status: 'applied' },
      { version: '003_legacy_columns', status: 'applied' },
      { version: '004_schema_reconcile', status: 'applied' }
    ]
  };
  res.json({
    ok: true,
    preview: true,
    runResult: { ok: true, healthy: true, createdTables: [], addedColumns: [], createdIndexes: [], errors: [] },
    status
  });
});

app.post('/api/admin/refresh-prices', async (req, res) => {
  await updateAllPrices(true);
  systemAuditLogs.unshift({
    id: Date.now(),
    time: 'هم‌اکنون',
    type: 'system',
    msg: 'به‌روزرسانی اجباری کلیه فیدهای قیمت توسط مدیر انجام شد.'
  });
  res.json({ ok: true, updatedAt: cachedPrices.updatedAt });
});

app.get('/api/broadcast', (req, res) => {
  res.json({ message: broadcastMessage });
});

app.post('/api/admin/broadcast', (req, res) => {
  broadcastMessage = String(req.body?.message || '').trim().slice(0, 500);
  res.json({ ok: true, message: broadcastMessage });
});

app.post('/api/auth/register/start', async (req, res) => {
  if (systemSettings.maintenance) {
    return res.status(503).json({ error: 'سامانه موقتاً در حال بروزرسانی و نگهداری است.' });
  }
  const ip = getClientIp(req);
  const { email, name, password } = req.body || {};
  if (!email || !name || !password) return res.status(400).json({ error: 'نام، ایمیل و رمز عبور را کامل وارد کنید.' });
  const normalizedEmail = cleanEmail(email);
  if (!isEmail(normalizedEmail) || normalizedEmail.length > 120) {
    return res.status(400).json({ error: 'ایمیل معتبر نیست.' });
  }
  const existingPre = systemUsers.find(u => u.email.toLowerCase() === normalizedEmail);
  const isPreSelectedAdmin = isEmailAdmin(normalizedEmail) || (existingPre?.role === 'admin' && !existingPre?.passwordHash);
  if (!systemSettings.allowNewRegistrations && !isPreSelectedAdmin) {
    return res.status(403).json({ error: 'ثبت‌نام کاربران جدید موقتاً توسط مدیریت غیرفعال شده است.' });
  }
  const cleanName = String(name).trim().slice(0, 80);
  const passStr = String(password);
  if (cleanName.length < 2) return res.status(400).json({ error: 'نام باید حداقل ۲ کاراکتر باشد.' });
  if (!okPass(passStr)) return res.status(400).json({ error: 'رمز عبور باید حداقل ۸ کاراکتر باشد.' });
  if (cleanEmail(passStr) === normalizedEmail) {
    return res.status(400).json({ error: 'رمز عبور نمی‌تواند برابر با آدرس ایمیل باشد.' });
  }
  if (!checkRateLimit(`reg_start:${ip}:${normalizedEmail}`, 5, 900) || !checkRateLimit(`reg_ip:${ip}`, 15, 900) || !checkRateLimit(`otp_hour:${normalizedEmail}`, 5, 3600)) {
    return res.status(429).json({ error: 'تعداد درخواست‌های ثبت‌نام بیش از حد مجاز است. کمی صبر کنید.' });
  }
  if (existingPre && existingPre.passwordHash) {
    return res.json({ ok: true });
  }

  const code = String(crypto.randomInt(100000, 1000000));
  pendingOtps[`register:${normalizedEmail}`] = {
    codeHash: await sha256Hex(code),
    expires: Date.now() + 10 * 60 * 1000,
    attempts: 0,
    name: cleanName,
    passwordHash: await hashPassword(passStr, process.env)
  };
  
  systemAuditLogs.unshift({
    id: Date.now(),
    time: 'هم‌اکنون',
    type: 'auth',
    msg: `کد تأیید عضویت برای ${normalizedEmail} صادر شد.`
  });
  if (systemAuditLogs.length > 40) systemAuditLogs.pop();
  res.json({ ok: true });
});

app.post('/api/auth/register/verify', async (req, res) => {
  if (systemSettings.maintenance) {
    return res.status(503).json({ error: 'سامانه موقتاً در حال بروزرسانی و نگهداری است.' });
  }
  const ip = getClientIp(req);
  const { email, code } = req.body || {};
  if (!email || !code) return res.status(400).json({ error: 'اطلاعات ناقص است.' });
  const normalizedEmail = cleanEmail(email);
  const existingPre = systemUsers.find(u => u.email.toLowerCase() === normalizedEmail);
  const isPreSelectedAdmin = isEmailAdmin(normalizedEmail) || (existingPre?.role === 'admin' && !existingPre?.passwordHash);
  if (!systemSettings.allowNewRegistrations && !isPreSelectedAdmin) {
    return res.status(403).json({ error: 'ثبت‌نام کاربران جدید موقتاً توسط مدیریت غیرفعال شده است.' });
  }
  const cleanCode = normCode(code);
  if (!checkRateLimit(`reg_verify:${ip}:${normalizedEmail}`, 8, 900)) {
    return res.status(429).json({ error: 'تلاش‌های ناموفق بیش از حد مجاز است. لطفاً کمی صبر کنید.' });
  }

  const otpRec = pendingOtps[`register:${normalizedEmail}`];
  if (!otpRec || otpRec.expires < Date.now()) {
    delete pendingOtps[`register:${normalizedEmail}`];
    return res.status(400).json({ error: 'کد تأیید منقضی شده یا نامعتبر است.' });
  }
  otpRec.attempts += 1;
  if (otpRec.attempts > 5) {
    delete pendingOtps[`register:${normalizedEmail}`];
    return res.status(400).json({ error: 'تعداد تلاش‌های مجاز برای این کد به پایان رسید. کد جدید دریافت کنید.' });
  }
  if (cleanCode.length !== 6 || !teq(await sha256Hex(cleanCode), otpRec.codeHash)) {
    return res.status(400).json({ error: 'کد تأیید نادرست است.' });
  }

  delete pendingOtps[`register:${normalizedEmail}`];
  const isAdmin = isEmailAdmin(normalizedEmail);

  let existing = systemUsers.find(u => u.email.toLowerCase() === normalizedEmail);
  if (!existing) {
    existing = {
      id: 'u_' + Date.now(),
      name: otpRec.name || normalizedEmail.split('@')[0],
      email: normalizedEmail,
      role: isAdmin ? 'admin' : 'user',
      status: 'active',
      registeredAt: 'هم‌اکنون',
      holdingsCount: 0,
      alertsCount: 0,
      lastLogin: 'هم‌اکنون',
      passwordHash: otpRec.passwordHash || await hashPassword(crypto.randomBytes(16).toString('hex'), process.env)
    };
    systemUsers.push(existing);
  }

  const sessionUser = await createSessionForUser(res, req, existing);
  saveAuthSessionToDisk();

  systemAuditLogs.unshift({
    id: Date.now(),
    time: 'هم‌اکنون',
    type: 'auth',
    msg: `ثبت‌نام و ورود موفق کاربر جدید: ${normalizedEmail}`
  });
  if (systemAuditLogs.length > 40) systemAuditLogs.pop();
  res.json({ ok: true, user: sessionUser });
});

app.post('/api/auth/reset/start', async (req, res) => {
  if (systemSettings.maintenance) {
    return res.status(503).json({ error: 'سامانه موقتاً در حال بروزرسانی و نگهداری است.' });
  }
  const ip = getClientIp(req);
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: 'ایمیل را وارد کنید.' });
  const normalizedEmail = cleanEmail(email);
  if (!isEmail(normalizedEmail)) return res.status(400).json({ error: 'ایمیل معتبر نیست.' });
  if (!checkRateLimit(`reset_start:${ip}:${normalizedEmail}`, 5, 900) || !checkRateLimit(`reset_ip:${ip}`, 15, 900) || !checkRateLimit(`otp_hour:${normalizedEmail}`, 5, 3600)) {
    return res.status(429).json({ error: 'تعداد درخواست‌های بازیابی بیش از حد مجاز است. کمی صبر کنید.' });
  }
  const existingUser = systemUsers.find(u => u.email.toLowerCase() === normalizedEmail);
  const exists = !!existingUser || !!userStore[normalizedEmail];
  if (!exists || existingUser?.status === 'suspended') {
    return res.json({ ok: true });
  }
  const code = String(crypto.randomInt(100000, 1000000));
  pendingOtps[`reset:${normalizedEmail}`] = {
    codeHash: await sha256Hex(code),
    expires: Date.now() + 10 * 60 * 1000,
    attempts: 0
  };

  systemAuditLogs.unshift({
    id: Date.now(),
    time: 'هم‌اکنون',
    type: 'auth',
    msg: `درخواست بازیابی رمز عبور برای ${normalizedEmail} ثبت شد.`
  });
  if (systemAuditLogs.length > 40) systemAuditLogs.pop();
  res.json({ ok: true });
});

app.post('/api/auth/reset/verify', async (req, res) => {
  if (systemSettings.maintenance) {
    return res.status(503).json({ error: 'سامانه موقتاً در حال بروزرسانی و نگهداری است.' });
  }
  const ip = getClientIp(req);
  const { email, code } = req.body || {};
  if (!email || !code) return res.status(400).json({ error: 'اطلاعات ناقص است.' });
  const normalizedEmail = cleanEmail(email);
  const cleanCode = normCode(code);
  if (!checkRateLimit(`reset_verify:${ip}:${normalizedEmail}`, 8, 900)) {
    return res.status(429).json({ error: 'تلاش‌های ناموفق بیش از حد مجاز است.' });
  }

  const otpRec = pendingOtps[`reset:${normalizedEmail}`];
  if (!otpRec || otpRec.expires < Date.now()) {
    delete pendingOtps[`reset:${normalizedEmail}`];
    return res.status(400).json({ error: 'کد بازیابی منقضی شده یا نامعتبر است.' });
  }
  otpRec.attempts += 1;
  if (otpRec.attempts > 5) {
    delete pendingOtps[`reset:${normalizedEmail}`];
    return res.status(400).json({ error: 'تعداد تلاش‌های مجاز برای این کد به پایان رسید.' });
  }
  if (cleanCode.length !== 6 || !teq(await sha256Hex(cleanCode), otpRec.codeHash)) {
    return res.status(400).json({ error: 'کد تأیید نادرست است.' });
  }

  delete pendingOtps[`reset:${normalizedEmail}`];
  const resetUser = systemUsers.find(x => x.email.toLowerCase() === normalizedEmail);
  if (resetUser?.status === 'suspended') {
    return res.status(403).json({ error: 'حساب کاربری شما مسدود شده است.' });
  }
  const rawResetToken = 'rst_' + crypto.randomBytes(24).toString('hex');
  pendingResets[normalizedEmail] = {
    tokenHash: await sha256Hex(rawResetToken),
    expires: Date.now() + 10 * 60 * 1000
  };
  res.json({ ok: true, resetToken: rawResetToken });
});

app.post('/api/auth/reset/finish', async (req, res) => {
  if (systemSettings.maintenance) {
    return res.status(503).json({ error: 'سامانه موقتاً در حال بروزرسانی و نگهداری است.' });
  }
  const ip = getClientIp(req);
  const { email, resetToken, password } = req.body || {};
  if (!email || !resetToken || !password) {
    return res.status(400).json({ error: 'اطلاعات بازیابی رمز عبور ناقص است.' });
  }
  const normalizedEmail = cleanEmail(email);
  if (!checkRateLimit(`reset_finish:${ip}:${normalizedEmail}`, 5, 900)) {
    return res.status(429).json({ error: 'تعداد درخواست‌ها بیش از حد مجاز است.' });
  }
  const resetRec = pendingResets[normalizedEmail];
  if (!resetRec || resetRec.expires < Date.now() || !teq(await sha256Hex(String(resetToken)), resetRec.tokenHash)) {
    return res.status(400).json({ error: 'توکن بازیابی رمز عبور نامعتبر یا منقضی شده است.' });
  }

  const passStr = String(password);
  if (!okPass(passStr)) {
    return res.status(400).json({ error: 'رمز عبور جدید باید حداقل ۸ کاراکتر باشد.' });
  }
  if (cleanEmail(passStr) === normalizedEmail) {
    return res.status(400).json({ error: 'رمز عبور نمی‌تواند برابر با آدرس ایمیل باشد.' });
  }

  delete pendingResets[normalizedEmail];
  const u = systemUsers.find(x => x.email.toLowerCase() === normalizedEmail);
  if (!u) {
    return res.status(404).json({ error: 'کاربر یافت نشد.' });
  }
  if (u.status === 'suspended') {
    return res.status(403).json({ error: 'حساب کاربری شما مسدود شده است.' });
  }

  u.passwordHash = await hashPassword(passStr, process.env);
  revokeUserSessions(normalizedEmail);
  const sessionUser = await createSessionForUser(res, req, u);
  saveAuthSessionToDisk();

  systemAuditLogs.unshift({
    id: Date.now(),
    time: 'هم‌اکنون',
    type: 'auth',
    msg: `رمز عبور کاربر ${normalizedEmail} با موفقیت بازنشانی شد.`
  });
  if (systemAuditLogs.length > 40) systemAuditLogs.pop();
  res.json({ ok: true, user: sessionUser });
});

app.post('/api/auth/logout', async (req, res) => {
  const rawToken = extractRawSessionToken(req);
  if (rawToken && rawToken.includes('.')) {
    const baseSid = rawToken.slice(0, rawToken.indexOf('.'));
    if (baseSid) {
      const sidHash = await sha256Hex(baseSid);
      activeSessions.delete(sidHash);
      revokedSessions.add(sidHash);
    }
  }
  clearSessionCookie(res, req);
  res.json({ ok: true });
});

app.delete('/api/me', async (req, res) => {
  const u = await resolveReqUser(req);
  if (!u) {
    return res.status(401).json({ error: 'ابتدا وارد حساب کاربری خود شوید.' });
  }
  if (u.isPrimaryAdmin || u.id === 'u_admin' || cleanEmail(u.email) === getResolvedPrimaryAdminEmail()) {
    return res.status(403).json({ error: 'حساب مدیر اصلی سیستم قابل حذف نیست.' });
  }
  if (systemSettings.maintenance && !u.isAdmin && !isEmailAdmin(u.email)) {
    return res.status(503).json({ error: 'سامانه موقتاً در حال بروزرسانی و نگهداری است.' });
  }
  const email = u.email.toLowerCase();
  delete userStore[email];
  revokeUserSessions(email);
  const idx = systemUsers.findIndex(usr => usr.email.toLowerCase() === email);
  if (idx !== -1) systemUsers.splice(idx, 1);
  saveAuthSessionToDisk();
  clearSessionCookie(res, req);
  res.json({ ok: true });
});

// Pre-populated mapping of official cryptocurrency logos
// Pre-populated mapping of official cryptocurrency logos
const LEGACY_COINCAP_ICONS: Record<string, string> = {
  btc: 'https://assets.coincap.io/assets/icons/btc@2x.png',
  eth: 'https://assets.coincap.io/assets/icons/eth@2x.png',
  usdt: 'https://assets.coincap.io/assets/icons/usdt@2x.png',
  sol: 'https://assets.coincap.io/assets/icons/sol@2x.png',
  bnb: 'https://assets.coincap.io/assets/icons/bnb@2x.png',
  xrp: 'https://assets.coincap.io/assets/icons/xrp@2x.png',
  doge: 'https://assets.coincap.io/assets/icons/doge@2x.png',
  ada: 'https://assets.coincap.io/assets/icons/ada@2x.png',
  trx: 'https://assets.coincap.io/assets/icons/trx@2x.png',
  avax: 'https://assets.coincap.io/assets/icons/avax@2x.png',
  link: 'https://assets.coincap.io/assets/icons/link@2x.png',
  sui: 'https://assets.coincap.io/assets/icons/sui@2x.png',
  ton: 'https://assets.coincap.io/assets/icons/ton@2x.png',
  shib: 'https://assets.coincap.io/assets/icons/shib@2x.png',
  dot: 'https://assets.coincap.io/assets/icons/dot@2x.png',
  near: 'https://assets.coincap.io/assets/icons/near@2x.png',
  pepe: 'https://assets.coincap.io/assets/icons/pepe@2x.png',
  ltc: 'https://assets.coincap.io/assets/icons/ltc@2x.png',
  matic: 'https://assets.coincap.io/assets/icons/matic@2x.png',
  pol: 'https://assets.coincap.io/assets/icons/matic@2x.png',
  uni: 'https://assets.coincap.io/assets/icons/uni@2x.png',
  atom: 'https://assets.coincap.io/assets/icons/atom@2x.png',
  xlm: 'https://assets.coincap.io/assets/icons/xlm@2x.png',
  bch: 'https://assets.coincap.io/assets/icons/bch@2x.png',
  etc: 'https://assets.coincap.io/assets/icons/etc@2x.png',
  fil: 'https://assets.coincap.io/assets/icons/fil@2x.png',
  arb: 'https://assets.coincap.io/assets/icons/arb@2x.png',
  op: 'https://assets.coincap.io/assets/icons/op@2x.png',
  apt: 'https://assets.coincap.io/assets/icons/apt@2x.png',
  inj: 'https://assets.coincap.io/assets/icons/inj@2x.png',
  render: 'https://assets.coincap.io/assets/icons/render@2x.png',
  rndr: 'https://assets.coincap.io/assets/icons/rndr@2x.png',
  kas: 'https://assets.coincap.io/assets/icons/kas@2x.png',
  tia: 'https://assets.coincap.io/assets/icons/tia@2x.png',
  fet: 'https://assets.coincap.io/assets/icons/fet@2x.png',
  algo: 'https://assets.coincap.io/assets/icons/algo@2x.png',
  stx: 'https://assets.coincap.io/assets/icons/stx@2x.png',
  vet: 'https://assets.coincap.io/assets/icons/vet@2x.png',
  icp: 'https://assets.coincap.io/assets/icons/icp@2x.png',
  ftm: 'https://assets.coincap.io/assets/icons/ftm@2x.png',
  dai: 'https://assets.coincap.io/assets/icons/dai@2x.png',
  usdc: 'https://assets.coincap.io/assets/icons/usdc@2x.png',
  fdusd: 'https://assets.coincap.io/assets/icons/fdusd@2x.png',
  wbtc: 'https://assets.coincap.io/assets/icons/wbtc@2x.png',
  floki: 'https://assets.coincap.io/assets/icons/floki@2x.png',
  bonk: 'https://assets.coincap.io/assets/icons/bonk@2x.png',
  wif: 'https://assets.coincap.io/assets/icons/wif@2x.png',
  not: 'https://assets.coincap.io/assets/icons/not@2x.png',
  ena: 'https://assets.coincap.io/assets/icons/ena@2x.png',
  sei: 'https://assets.coincap.io/assets/icons/sei@2x.png',
  jup: 'https://assets.coincap.io/assets/icons/jup@2x.png',
  ondo: 'https://assets.coincap.io/assets/icons/ondo@2x.png',
  pendle: 'https://assets.coincap.io/assets/icons/pendle@2x.png',
  bgb: 'https://assets.coincap.io/assets/icons/bgb@2x.png',
  hbar: 'https://assets.coincap.io/assets/icons/hbar@2x.png',
  cro: 'https://assets.coincap.io/assets/icons/cro@2x.png',
  mkr: 'https://assets.coincap.io/assets/icons/mkr@2x.png',
  aave: 'https://assets.coincap.io/assets/icons/aave@2x.png',
  tao: 'https://assets.coincap.io/assets/icons/tao@2x.png',
  sand: 'https://assets.coincap.io/assets/icons/sand@2x.png',
  mana: 'https://assets.coincap.io/assets/icons/mana@2x.png',
  cake: 'https://assets.coincap.io/assets/icons/cake@2x.png',
  gala: 'https://assets.coincap.io/assets/icons/gala@2x.png',
  chz: 'https://assets.coincap.io/assets/icons/chz@2x.png',
  axs: 'https://assets.coincap.io/assets/icons/axs@2x.png',
  eos: 'https://assets.coincap.io/assets/icons/eos@2x.png',
  xtz: 'https://assets.coincap.io/assets/icons/xtz@2x.png',
  egld: 'https://assets.coincap.io/assets/icons/egld@2x.png',
  qnt: 'https://assets.coincap.io/assets/icons/qnt@2x.png',
  flow: 'https://assets.coincap.io/assets/icons/flow@2x.png',
  neo: 'https://assets.coincap.io/assets/icons/neo@2x.png',
  iota: 'https://assets.coincap.io/assets/icons/iota@2x.png',
  mina: 'https://assets.coincap.io/assets/icons/mina@2x.png',
  crv: 'https://assets.coincap.io/assets/icons/crv@2x.png',
  snx: 'https://assets.coincap.io/assets/icons/snx@2x.png',
  enj: 'https://assets.coincap.io/assets/icons/enj@2x.png',
  bat: 'https://assets.coincap.io/assets/icons/bat@2x.png',
  comp: 'https://assets.coincap.io/assets/icons/comp@2x.png',
  '1inch': 'https://assets.coincap.io/assets/icons/1inch@2x.png',
  kava: 'https://assets.coincap.io/assets/icons/kava@2x.png',
  celo: 'https://assets.coincap.io/assets/icons/celo@2x.png',
  zil: 'https://assets.coincap.io/assets/icons/zil@2x.png',
  dydx: 'https://assets.coincap.io/assets/icons/dydx@2x.png',
  woo: 'https://assets.coincap.io/assets/icons/woo@2x.png',
  kcs: 'https://assets.coincap.io/assets/icons/kcs@2x.png',
  rsr: 'https://assets.coincap.io/assets/icons/rsr@2x.png',
  gtc: 'https://assets.coincap.io/assets/icons/gtc@2x.png',
  lsk: 'https://assets.coincap.io/assets/icons/lsk@2x.png'
};

const CURATED_CRYPTO_ICONS: Record<string, string> = {
  goat: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/solana/assets/CzLSujWBLFsSjncfkh59rUFqvafWcY5tzedWJSuypump/logo.png',
  fartcoin: 'https://bin.bnbstatic.com/static/assets/logos/FARTCOIN.png',
  grass: 'https://bin.bnbstatic.com/static/assets/logos/GRASS.png',
  hype: 'https://bin.bnbstatic.com/static/assets/logos/HYPE.png',
  pengu: 'https://bin.bnbstatic.com/static/assets/logos/PENGU.png',
  moodeng: 'https://bin.bnbstatic.com/static/assets/logos/MOODENG.png',
  pnut: 'https://bin.bnbstatic.com/static/assets/logos/PNUT.png',
  neiro: 'https://bin.bnbstatic.com/static/assets/logos/NEIRO.png',
  neirocto: 'https://bin.bnbstatic.com/static/assets/logos/NEIRO.png',
  virtual: 'https://bin.bnbstatic.com/static/assets/logos/VIRTUAL.png',
  ai16z: 'https://bin.bnbstatic.com/static/assets/logos/AI16Z.png',
  popcat: 'https://bin.bnbstatic.com/static/assets/logos/POPCAT.png',
  brett: 'https://bin.bnbstatic.com/static/assets/logos/BRETT.png',
  trump: 'https://bin.bnbstatic.com/static/assets/logos/TRUMP.png',
  dogs: 'https://bin.bnbstatic.com/static/assets/logos/DOGS.png',
  hmstr: 'https://bin.bnbstatic.com/static/assets/logos/HMSTR.png',
  cats: 'https://bin.bnbstatic.com/static/assets/logos/CATS.png',
  wld: 'https://bin.bnbstatic.com/static/assets/logos/WLD.png',
  strk: 'https://bin.bnbstatic.com/static/assets/logos/STRK.png',
  morpho: 'https://bin.bnbstatic.com/static/assets/logos/MORPHO.png',
  ethfi: 'https://bin.bnbstatic.com/static/assets/logos/ETHFI.png',
  zk: 'https://bin.bnbstatic.com/static/assets/logos/ZK.png',
  w: 'https://bin.bnbstatic.com/static/assets/logos/W.png',
  jto: 'https://bin.bnbstatic.com/static/assets/logos/JTO.png',
  zro: 'https://bin.bnbstatic.com/static/assets/logos/ZRO.png',
  manta: 'https://bin.bnbstatic.com/static/assets/logos/MANTA.png',
  alt: 'https://bin.bnbstatic.com/static/assets/logos/ALT.png',
  pixel: 'https://bin.bnbstatic.com/static/assets/logos/PIXEL.png',
  portal: 'https://bin.bnbstatic.com/static/assets/logos/PORTAL.png',
  pyth: 'https://bin.bnbstatic.com/static/assets/logos/PYTH.png',
  core: 'https://bin.bnbstatic.com/static/assets/logos/CORE.png',
  beam: 'https://bin.bnbstatic.com/static/assets/logos/BEAM.png',
  jasmy: 'https://bin.bnbstatic.com/static/assets/logos/JASMY.png',
  om: 'https://bin.bnbstatic.com/static/assets/logos/OM.png',
  xmr: 'https://bin.bnbstatic.com/static/assets/logos/XMR.png',
  xdc: 'https://static.coinpaprika.com/coin/xdc-xdc-network/logo.png',
  bdx: 'https://static.coinpaprika.com/coin/bdx-beldex/logo.png',
  pump: 'https://bin.bnbstatic.com/static/assets/logos/PUMP.png',
  aster: 'https://bin.bnbstatic.com/static/assets/logos/ASTER.png',
  prom: 'https://bin.bnbstatic.com/static/assets/logos/PROM.png',
  sonic: 'https://cdn.arz.digital/cr-odin/img/assets/sonic/64x64.png',
  redstone: 'https://bin.bnbstatic.com/static/assets/logos/RED.png',
  ton: 'https://bin.bnbstatic.com/static/assets/logos/TON.png'
};

const CRYPTO_ICONS: Record<string, string> = { ...LEGACY_COINCAP_ICONS, ...CURATED_CRYPTO_ICONS };
const REAL_X_CRYPTOS = new Set(['xrp','xlm','xmr','xdc','xtz','xch','xaut','xai','xem','xvg','xno','xec','xpl','xvs']);

let dynamicCryptoIconsCache: Record<string, string> | null = null;
let dynamicCryptoIconsTime = 0;
let dynamicCryptoIconsJob: Promise<Record<string, string>> | null = null;

async function fetchJsonQuick(url: string, timeoutMs = 5500): Promise<any> {
  const res = await fetch(url, {
    headers: { accept: 'application/json', 'user-agent': 'Darayi/1.0' },
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function getDynamicCryptoIcons(): Promise<Record<string, string>> {
  const now = Math.floor(Date.now() / 1000);
  const memTtl = (dynamicCryptoIconsCache && Object.keys(dynamicCryptoIconsCache).length >= 300) ? 43200 : 60;
  if (dynamicCryptoIconsCache && (now - dynamicCryptoIconsTime < memTtl)) {
    return dynamicCryptoIconsCache;
  }
  if (dynamicCryptoIconsJob) return dynamicCryptoIconsJob;
  dynamicCryptoIconsJob = (async () => {
    const localIcons: Record<string, string> = buildLocalCryptoIconsMap();
    const pricesItems = cachedPrices?.items || {};
    const activeKeysInit = new Set(Object.keys(pricesItems).map(k => k.toLowerCase()));
    const symbolCounts: Record<string, number> = {};
    for (const [k, item] of Object.entries(pricesItems)) {
      if (!item || !(item as any).crypto) continue;
      const sym = String((item as any).sym || (item as any).symbol || k).toLowerCase().trim();
      if (sym) symbolCounts[sym] = (symbolCounts[sym] || 0) + 1;
    }
    const hasLocalCover = (k: string) => {
      if (localIcons[k]) return true;
      const stripped = k.replace(/^(1000+|1m)/, '');
      if (stripped && stripped !== k && localIcons[stripped]) return true;
      if (k.startsWith('ok') && k.length > 3 && localIcons[k.slice(2)]) return true;
      return Boolean(CURATED_CRYPTO_ICONS[k]);
    };
    const missingActive = [...activeKeysInit].filter(k => pricesItems?.[k]?.crypto && !hasLocalCover(k));
    if (Object.keys(localIcons).length >= 1000 && activeKeysInit.size > 0 && missingActive.length === 0) {
      const mergedLocal = { ...LEGACY_COINCAP_ICONS, ...CURATED_CRYPTO_ICONS, ...localIcons };
      for (const [k, item] of Object.entries(pricesItems)) {
        if (!item || !(item as any).crypto) continue;
        const resolved = resolveCryptoIconByAssetId(
          { id: k, sym: (item as any).sym, name: (item as any).name },
          { localIcons, curatedIcons: CURATED_CRYPTO_ICONS, symbolMap: LEGACY_COINCAP_ICONS, symbolCounts, realXCryptos: REAL_X_CRYPTOS }
        );
        if (resolved) mergedLocal[k.toLowerCase()] = resolved;
      }
      dynamicCryptoIconsCache = mergedLocal;
      dynamicCryptoIconsTime = now;
      return mergedLocal;
    }
    const symbolMap: Record<string, string> = {};
    const idMap: Record<string, string> = {};
    const nameMap: Record<string, string> = {};
    const [cmcRes, cpRes, cg1Res, cg2Res] = await Promise.allSettled([
      fetchJsonQuick('https://api.coinmarketcap.com/data-api/v3/cryptocurrency/listing?start=1&limit=3500&sortBy=market_cap&sortType=desc&convert=USD', 6500),
      fetchJsonQuick('https://api.coinpaprika.com/v1/coins', 6500),
      fetchJsonQuick('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=1', 5500),
      fetchJsonQuick('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=2', 5500)
    ]);

    const cmcList = (cmcRes.status === 'fulfilled' && cmcRes.value?.data?.cryptoCurrencyList) || [];
    const cmcTop1500 = new Set<string>();
    for (let idx = 0; idx < cmcList.length; idx++) {
      const c = cmcList[idx];
      const s = String(c?.symbol || '').toLowerCase().trim();
      if (!s || !c?.id) continue;
      const url = `https://s2.coinmarketcap.com/static/img/coins/64x64/${c.id}.png`;
      if (idx < 1500) cmcTop1500.add(s);
      if (!symbolMap[s]) symbolMap[s] = url;
      const slug = String(c.slug || '').toLowerCase().trim();
      if (slug && !idMap[slug]) idMap[slug] = url;
      const nn = normalizeCryptoIconName(c.name);
      if (nn && !nameMap[nn]) nameMap[nn] = url;
      const sl = normalizeCryptoIconName(c.slug);
      if (sl && !nameMap[sl]) nameMap[sl] = url;
    }

    for (const cgRes of [cg1Res, cg2Res]) {
      if (cgRes.status === 'fulfilled' && Array.isArray(cgRes.value)) {
        for (const c of cgRes.value) {
          const s = String(c?.symbol || '').toLowerCase().trim();
          if (!c?.image) continue;
          const cgId = String(c.id || '').toLowerCase().trim();
          if (cgId && !idMap[cgId]) idMap[cgId] = c.image;
          const nn = normalizeCryptoIconName(c.name);
          if (nn && !nameMap[nn]) nameMap[nn] = c.image;
          const idn = normalizeCryptoIconName(c.id);
          if (idn && !nameMap[idn]) nameMap[idn] = c.image;
          if (s && !symbolMap[s]) symbolMap[s] = c.image;
        }
      }
    }

    const cpSymbolMap: Record<string, string> = {};
    if (cpRes.status === 'fulfilled' && Array.isArray(cpRes.value)) {
      const sortedCp = cpRes.value
        .filter((c: any) => c && c.is_active !== false && c.id && c.symbol)
        .sort((a: any, b: any) => ((a.rank > 0 ? a.rank : 999999) - (b.rank > 0 ? b.rank : 999999)));
      for (const c of sortedCp) {
        const s = String(c.symbol).toLowerCase().trim();
        const url = `https://static.coinpaprika.com/coin/${c.id}/logo.png`;
        const cpId = String(c.id).toLowerCase().trim();
        if (cpId && !idMap[cpId]) idMap[cpId] = url;
        const nn = normalizeCryptoIconName(c.name);
        if (nn && !nameMap[nn]) nameMap[nn] = url;
        const slugPart = normalizeCryptoIconName(String(c.id).split('-').slice(1).join(''));
        if (slugPart && !nameMap[slugPart]) nameMap[slugPart] = url;
        if (s && !cpSymbolMap[s]) cpSymbolMap[s] = url;
      }
    }

    const fullSymbolMap = { ...LEGACY_COINCAP_ICONS, ...cpSymbolMap, ...symbolMap };
    const out: Record<string, string> = {};
    for (const k of cmcTop1500) {
      if (symbolMap[k] && !(symbolCounts[k] > 1)) out[k] = symbolMap[k];
    }
    for (const k of activeKeysInit) {
      const item = pricesItems[k];
      const found = resolveCryptoIconByAssetId(
        { id: k, sym: (item as any)?.sym, name: (item as any)?.name },
        {
          localIcons,
          curatedIcons: CURATED_CRYPTO_ICONS,
          idMap,
          nameMap,
          symbolMap: fullSymbolMap,
          symbolCounts,
          realXCryptos: REAL_X_CRYPTOS
        }
      );
      if (found) out[k] = found;
    }
    for (const [k, u] of Object.entries(idMap)) {
      if (!out[k]) out[k] = u;
    }
    for (const [k, u] of Object.entries(symbolMap)) {
      if (!out[k] && !(symbolCounts[k] > 1)) out[k] = u;
    }
    let cpAdded = 0;
    for (const [k, u] of Object.entries(cpSymbolMap)) {
      if (!out[k] && !(symbolCounts[k] > 1) && (activeKeysInit.has(k) || cpAdded < 2500)) {
        out[k] = u;
        cpAdded++;
      }
    }
    for (const [k, u] of Object.entries(LEGACY_COINCAP_ICONS)) {
      if (!out[k] && !(symbolCounts[k] > 1)) out[k] = u;
    }
    Object.assign(out, CURATED_CRYPTO_ICONS, localIcons);

    dynamicCryptoIconsCache = out;
    dynamicCryptoIconsTime = now;
    return out;
  })().finally(() => {
    dynamicCryptoIconsJob = null;
  });
  return dynamicCryptoIconsJob;
}

app.get('/api/crypto-icons', async (req, res) => {
  try {
    const icons = await getDynamicCryptoIcons();
    const maxAge = Object.keys(icons).length >= 300 ? 43200 : 60;
    res.setHeader('Cache-Control', `public, max-age=${maxAge}`);
    res.json({ ok: true, icons });
  } catch {
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.json({ ok: true, icons: CRYPTO_ICONS });
  }
});

function evaluateAlertsForRecord(alerts: any[], ownerEmail?: string): boolean {
  if (!Array.isArray(alerts) || !cachedPrices.items) return false;
  let changed = false;
  const usdtIrt = Number(cachedPrices.items.usdt?.price) || 0;
  for (const al of alerts) {
    if (!al || !al.assetId || !(al.price > 0) || al.triggeredAt) continue;
    const item = cachedPrices.items[al.assetId];
    if (!item || !(item.price > 0)) continue;
    let cur = Number(item.price);
    const itemCur = item.unit || 'IRT';
    const targetCur = al.currency || 'IRT';
    if (targetCur === 'IRT' && itemCur === 'USDT') {
      if (!(usdtIrt > 0)) continue;
      cur = cur * usdtIrt;
    } else if (targetCur === 'USD' && itemCur === 'IRT') {
      if (!(usdtIrt > 0)) continue;
      cur = cur / usdtIrt;
    }
    const hit = (al.direction === 'above' && cur >= al.price) ||
                (al.direction === 'below' && cur <= al.price);
    if (hit) {
      al.triggeredAt = Date.now();
      changed = true;
      systemAuditLogs.unshift({
        id: Date.now(),
        time: 'هم‌اکنون',
        type: 'system',
        msg: `هدف قیمتی دارایی ${al.assetId} محقق شد؛ اعلان هشدار به ${ownerEmail || 'کاربر'} ارسال گردید.`
      });
      if (systemAuditLogs.length > 40) systemAuditLogs.pop();
    }
  }
  return changed;
}

function evaluateAllStoredAlerts() {
  let anyChanged = false;
  for (const [email, rec] of Object.entries(userStore)) {
    if (rec?.data?.alerts && evaluateAlertsForRecord(rec.data.alerts, email)) {
      rec.updatedAt = Math.max(Date.now() * 1000, (Number(rec.updatedAt) || 0) + 1);
      rec.revision = (Number(rec.revision) || 1) + 1;
      anyChanged = true;
    }
  }
  if (anyChanged) saveAuthSessionToDisk();
}

function cleanUserData(raw: any, prevAlerts: any[] = []) {
  const prevMap = new Map(Array.isArray(prevAlerts) ? prevAlerts.map((a: any) => [a.id, a]) : []);
  const holdings = Array.isArray(raw?.holdings)
    ? raw.holdings
        .filter((x: any) => x && /^[a-z0-9]{1,20}$/.test(String(x.assetId || '')) && Number(x.qty) > 0 && Number.isFinite(Number(x.qty)) && Number(x.buyPrice) >= 0 && Number.isFinite(Number(x.buyPrice)))
        .slice(0, 500)
        .map((x: any) => {
          const side = x.side === 'sell' ? 'sell' : x.side === 'transfer' ? 'transfer' : 'buy';
          return {
            id: String(x.id || crypto.randomBytes(6).toString('hex')).slice(0, 40),
            assetId: String(x.assetId),
            side,
            qty: Number(x.qty),
            buyPrice: side === 'transfer' ? 0 : Number(x.buyPrice),
            fee: Math.max(0, Number(x.fee) || 0),
            wallet: String(x.wallet || 'کیف پول اصلی').slice(0, 40),
            toWallet: side === 'transfer' ? String(x.toWallet || '').slice(0, 40) : '',
            date: String(x.date || '').slice(0, 24),
            note: String(x.note || '').slice(0, 140),
            createdAt: Number(x.createdAt) > 0 ? Number(x.createdAt) : 0
          };
        })
    : [];
  const watch = Array.isArray(raw?.watch)
    ? [...new Set(raw.watch.map((x: any) => String(x)).filter((x: string) => /^[a-z0-9]{1,20}$/.test(x)))].slice(0, 200)
    : [];
  const featured = Array.isArray(raw?.featured)
    ? [...new Set(raw.featured.map((x: any) => String(x)).filter((x: string) => /^[a-z0-9]{1,20}$/.test(x)))].slice(0, 20)
    : ['usd', 'gold18', 'btc', 'usdt', 'eur', 'sol'];
  const alerts = Array.isArray(raw?.alerts)
    ? raw.alerts
        .filter((x: any) => x && /^[a-z0-9]{1,20}$/.test(String(x.assetId || '')) && (x.direction === 'above' || x.direction === 'below') && Number(x.price) > 0 && Number.isFinite(Number(x.price)))
        .slice(0, 100)
        .map((x: any) => {
          const id = String(x.id || crypto.randomBytes(6).toString('hex')).slice(0, 40);
          const prev: any = prevMap.get(id);
          const sameRule = prev && prev.assetId === x.assetId && prev.direction === x.direction && Number(prev.price) === Number(x.price) && (prev.currency || 'IRT') === (x.currency || 'IRT');
          return {
            id,
            assetId: String(x.assetId),
            direction: x.direction,
            price: Number(x.price),
            currency: x.currency === 'USD' ? 'USD' : 'IRT',
            triggeredAt: sameRule ? (prev.triggeredAt || x.triggeredAt || null) : (x.triggeredAt || null),
            attempts: sameRule ? (prev.attempts || 0) : 0
          };
        })
    : [];
  const s = raw?.settings || {};
  const settings = {
    theme: s.theme === 'dark' ? 'dark' : 'light',
    unit: s.unit === 'rial' ? 'rial' : 'toman',
    privacy: Boolean(s.privacy),
    filter: ['all', 'gold', 'currency', 'crypto', 'watch'].includes(s.filter) ? s.filter : 'all'
  };
  return { holdings, watch, featured, alerts, settings };
}

function validateHoldingsLedger(holdings: any[]): string | null {
  const sorted = [...holdings].sort((a, b) => {
    const da = String(a.date || ''), db = String(b.date || '');
    if (da && db && da !== db) return da.localeCompare(db);
    return (Number(a.createdAt) || 0) - (Number(b.createdAt) || 0);
  });
  const wallets = new Map<string, number>();
  for (const tx of sorted) {
    const w = tx.wallet || 'کیف پول اصلی';
    const key = `${tx.assetId}::${w}`;
    const cur = wallets.get(key) || 0;
    if (tx.side === 'buy') {
      wallets.set(key, cur + tx.qty);
    } else if (tx.side === 'sell') {
      if (tx.qty > cur + 1e-9) {
        return `موجودی کیف پول «${w}» برای فروش دارایی ${tx.assetId} کافی نیست.`;
      }
      wallets.set(key, Math.max(0, cur - tx.qty));
    } else if (tx.side === 'transfer') {
      if (!tx.toWallet || tx.toWallet === w) {
        return 'کیف پول مقصد در انتقال باید متفاوت از کیف پول مبدأ باشد.';
      }
      if (tx.qty > cur + 1e-9) {
        return `موجودی کیف پول «${w}» برای انتقال دارایی ${tx.assetId} کافی نیست.`;
      }
      wallets.set(key, Math.max(0, cur - tx.qty));
      const toKey = `${tx.assetId}::${tx.toWallet}`;
      wallets.set(toKey, (wallets.get(toKey) || 0) + tx.qty);
    }
  }
  return null;
}

app.get('/api/me/data', async (req, res) => {
  const u = await resolveReqUser(req);
  if (!u) {
    return res.status(401).json({ error: 'ابتدا وارد حساب کاربری خود شوید.' });
  }
  const email = u.email.toLowerCase();
  const target = userStore[email];
  if (target?.data?.alerts) {
    if (evaluateAlertsForRecord(target.data.alerts, email)) {
      target.updatedAt = Math.max(Date.now() * 1000, (Number(target.updatedAt) || 0) + 1);
      target.revision = (Number(target.revision) || 1) + 1;
      saveAuthSessionToDisk();
    }
  }
  const clientRev = req.query?.rev;
  if (target && clientRev !== undefined && Number(target.updatedAt) > 0 && String(target.updatedAt) === String(clientRev)) {
    return res.json({
      ok: true,
      status: 'unchanged',
      unchanged: true,
      exists: true,
      updatedAt: target.updatedAt
    });
  }
  if (target) {
    return res.json({
      ok: true,
      status: 'loaded',
      ...target
    });
  }
  res.json({
    ok: true,
    status: 'empty',
    exists: false,
    revision: 0,
    updatedAt: 0,
    data: {
      holdings: [],
      watch: [],
      featured: [],
      alerts: [],
      settings: {}
    }
  });
});

app.put('/api/me/data', async (req, res) => {
  const u = await resolveReqUser(req);
  if (!u) {
    return res.status(401).json({ error: 'ابتدا وارد حساب کاربری خود شوید.' });
  }
  if (systemSettings.maintenance && !u.isAdmin && !isEmailAdmin(u.email)) {
    return res.status(503).json({ error: 'سامانه موقتاً در حال بروزرسانی و نگهداری است.' });
  }
  const body = req.body || {};
  const email = u.email.toLowerCase();
  const prevRec = userStore[email];
  const currentRev = Number(prevRec?.updatedAt) || 0;
  const hasBaseRev = body.baseRevision !== undefined && body.baseRevision !== null;
  if (hasBaseRev && Number(body.baseRevision) !== currentRev) {
    return res.status(409).json({
      error: 'نسخه داده‌های شما قدیمی است؛ اطلاعات جدید دریافت شد.',
      data: prevRec?.data || { holdings: [], watch: [], featured: [], alerts: [], settings: {} },
      updatedAt: currentRev
    });
  }

  const c = cleanData(body);
  try {
    validateTransactions(c.holdings);
  } catch (err: any) {
    return res.status(400).json({ error: err?.message || 'معامله معتبر نیست.' });
  }
  const cleaned = cleanUserData(body, prevRec?.data?.alerts || []);
  const ledgerErr = validateHoldingsLedger(cleaned.holdings);
  if (ledgerErr) {
    return res.status(400).json({ error: ledgerErr });
  }

  const nextRev = (Number(prevRec?.revision) || 0) + 1;
  if (Array.isArray(cleaned.alerts)) {
    evaluateAlertsForRecord(cleaned.alerts, email);
  }

  const updated = {
    ok: true,
    status: 'loaded',
    exists: true,
    revision: nextRev,
    updatedAt: Math.max(Date.now() * 1000, currentRev + 1),
    data: cleaned
  };

  userStore[email] = updated;
  const usr = systemUsers.find(x => x.email.toLowerCase() === email);
  if (usr) {
    usr.holdingsCount = cleaned.holdings.length;
    usr.alertsCount = cleaned.alerts.length;
  }
  saveAuthSessionToDisk();

  res.json(updated);
});

app.post('/api/me/alerts/:id/retry', async (req, res) => {
  const u = await resolveReqUser(req);
  if (!u) {
    return res.status(401).json({ error: 'ابتدا وارد حساب کاربری خود شوید.' });
  }
  if (systemSettings.maintenance && !u.isAdmin && !isEmailAdmin(u.email)) {
    return res.status(503).json({ error: 'سامانه موقتاً در حال بروزرسانی و نگهداری است.' });
  }
  const email = u.email.toLowerCase();
  const alertId = String(req.params.id || '');
  const target = userStore[email];
  if (target?.data?.alerts && Array.isArray(target.data.alerts)) {
    for (const al of target.data.alerts) {
      if (String(al.id) === alertId) {
        al.triggeredAt = null;
        al.attempts = 0;
      }
    }
    evaluateAlertsForRecord(target.data.alerts, email);
    target.updatedAt = Math.max(Date.now() * 1000, (Number(target.updatedAt) || 0) + 1);
    target.revision = (Number(target.revision) || 1) + 1;
    saveAuthSessionToDisk();
  }
  res.json({ ok: true });
});

// PWA Static Assets
app.get('/manifest.webmanifest', (req, res) => {
  res.setHeader('content-type', 'application/manifest+json; charset=utf-8');
  res.json({
    name: 'دارایی من',
    short_name: 'دارایی من',
    description: 'پیگیری قیمت طلا، ارز و رمزارز و مدیریت سبد دارایی',
    lang: 'fa',
    dir: 'rtl',
    start_url: '/?source=pwa',
    scope: '/',
    display: 'standalone',
    background_color: '#0b0d11',
    theme_color: '#0b0d11',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
    ]
  });
});

app.get('/sw.js', (req, res) => {
  res.setHeader('content-type', 'text/javascript; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.send(`
self.addEventListener('install', () => {
  self.skipWaiting();
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
      .then(() => self.registration.unregister())
      .then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', () => {
  // Pass-through to network, never cache
});
`);
});

// Serve root PWA HTML directly with anti-cache & strict hash-based CSP headers
let cachedHtmlMeta: { mtimeMs: number; html: string; hashes: string[] } | null = null;
function getServedHtmlAndHashes(htmlPath: string): { html: string; hashes: string[] } | null {
  if (!fs.existsSync(htmlPath)) return null;
  const stat = fs.statSync(htmlPath);
  if (cachedHtmlMeta && cachedHtmlMeta.mtimeMs === stat.mtimeMs) {
    return { html: cachedHtmlMeta.html, hashes: cachedHtmlMeta.hashes };
  }
  const html = fs.readFileSync(htmlPath, 'utf8');
  const hashes = extractInlineScriptBodies(html).map(
    (body) => `sha256-${crypto.createHash('sha256').update(body, 'utf8').digest('base64')}`
  );
  cachedHtmlMeta = { mtimeMs: stat.mtimeMs, html, hashes };
  return { html, hashes };
}

app.get(['/', '/index.html'], (req, res) => {
  const htmlPath = path.join(__dirname, 'src', 'index.html');
  const loaded = getServedHtmlAndHashes(htmlPath);
  if (loaded) {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Surrogate-Control', 'no-store');
    res.setHeader('Content-Security-Policy', buildHtmlCsp(isPreviewRequest(req), loaded.hashes));
    return res.send(loaded.html);
  }
  return res.status(404).send('HTML not found.');
});

// Serve public static files only (never expose /src directory)
app.use('/logos', express.static(path.join(__dirname, 'public', 'logos'), {
  maxAge: '1d',
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
  }
}));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: 0, etag: false }));

// Global error handler — never expose internal stack traces
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ error: 'حجم داده‌های ارسالی بیش از حد مجاز است.' });
  }
  if (err instanceof SyntaxError) {
    return res.status(400).json({ error: 'فرمت JSON ارسالی نامعتبر است.' });
  }
  return res.status(500).json({ error: 'خطای داخلی سرور رخ داده است.' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[Darayi Server] Running on http://0.0.0.0:${PORT}`);
  startPriceRefreshScheduler();
});
