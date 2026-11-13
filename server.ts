import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  NERKHARA_MAP,
  DOMESTIC_META,
  ALL_DOMESTIC_IDS,
  D1_HISTORY_ASSET_IDS,
  KV_SNAPSHOT_VERSION,
  parseUtcTimestamp,
  isTehranMarketOpen,
  isPriceItemStale
} from './src/modules/market-core.js';

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

const rateBuckets = new Map<string, { n: number; reset: number }>();
function getClientIp(req: express.Request): string {
  const cf = req.headers['cf-connecting-ip'];
  if (typeof cf === 'string' && cf.trim()) return cf.trim().slice(0, 64);
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.trim()) return xff.split(',')[0].trim().slice(0, 64);
  return (req.socket?.remoteAddress || 'local').slice(0, 64);
}

function checkRateLimit(key: string, limit: number, windowSec: number): boolean {
  const now = Math.floor(Date.now() / 1000);
  if (rateBuckets.size > 5000) {
    for (const [k, v] of rateBuckets) {
      if (v.reset <= now) rateBuckets.delete(k);
    }
  }
  const cur = rateBuckets.get(key);
  if (!cur || cur.reset <= now) {
    rateBuckets.set(key, { n: 1, reset: now + windowSec });
    return true;
  }
  cur.n += 1;
  return cur.n <= limit;
}

function verifyCsrf(req: express.Request): boolean {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return true;
  const secFetchSite = String(req.headers['sec-fetch-site'] || '').toLowerCase();
  if (secFetchSite === 'cross-site') return false;
  const host = String(req.headers.host || '').toLowerCase();
  const origin = String(req.headers.origin || '').trim();
  const referer = String(req.headers.referer || '').trim();
  if (origin) {
    if (origin === 'null') return false;
    try {
      const u = new URL(origin);
      if (host && u.host.toLowerCase() !== host) return false;
    } catch {
      return false;
    }
  } else if (referer) {
    try {
      const u = new URL(referer);
      if (host && u.host.toLowerCase() !== host) return false;
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

function isSafePublicUrl(rawUrl: string): boolean {
  try {
    const str = String(rawUrl || '').trim();
    if (!str || str.length > 512) return false;
    const u = new URL(str);
    if (u.protocol !== 'https:' && u.protocol !== 'wss:') return false;
    if (u.username || u.password) return false;
    if (u.port && u.port !== '443') return false;
    const h = u.hostname.toLowerCase().replace(/\.$/, '');
    if (!h || h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.arpa') || h.includes(':')) return false;
    if (!h.includes('.')) return false;
    if (h === 'metadata.google.internal' || h === 'metadata' || h === 'instance-data') return false;
    if (/^[0-9.]+$/.test(h) || /^0x/i.test(h)) {
      const parts = h.split('.');
      if (parts.length !== 4) return false;
      const nums = parts.map(p => (p.length > 1 && p.startsWith('0')) ? NaN : Number(p));
      if (nums.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return false;
      const [a, b, c] = nums;
      if (a === 0 || a === 10 || a === 127) return false;
      if (a === 169 && b === 254) return false;
      if (a === 172 && b >= 16 && b <= 31) return false;
      if (a === 192 && b === 168) return false;
      if (a === 100 && b >= 64 && b <= 127) return false;
      if (a === 192 && b === 0 && (c === 0 || c === 2)) return false;
      if (a === 198 && (b === 18 || b === 19)) return false;
      if (a === 198 && b === 51 && c === 100) return false;
      if (a === 203 && b === 0 && c === 113) return false;
      if (a >= 224) return false;
    }
    return true;
  } catch {
    return false;
  }
}

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
      return (j.data || []).map((c: any) => [+c[0], +c[2]]);
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
      let all = rows1.map((c: any) => [Math.floor(+c[0] / 1000), +c[4]]);
      if (lim > 300 && rows1.length >= 200) {
        const oldestMs = rows1[rows1.length - 1]?.[0];
        if (oldestMs) {
          try {
            const remLimit = Math.min(300, lim - rows1.length + 10);
            const j2 = await fetchJSON(`https://www.okx.com/api/v5/market/candles?instId=${encodeURIComponent(pair)}&bar=${b}&after=${encodeURIComponent(oldestMs)}&limit=${remLimit}`, 5);
            if (Array.isArray(j2?.data) && j2.data.length) {
              all = all.concat(j2.data.map((c: any) => [Math.floor(+c[0] / 1000), +c[4]]));
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
      return Array.isArray(j) ? j.map((c: any) => [+c[0], +c[2]]) : [];
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
  { id: 'f_okx', name: 'OKX Market Feed', url: 'https://www.okx.com/api/v5/market/tickers', type: 'crypto', status: 'active', pingMs: 62, reliability: '99.8%', priority: 2 },
  { id: 'f_gate', name: 'Gate.io Engine', url: 'https://api.gateio.ws/api/v4/spot/tickers', type: 'crypto', status: 'active', pingMs: 55, reliability: '100%', priority: 3 },
  { id: 'f_binance_ws', name: 'Binance MiniTicker WS', url: 'wss://stream.binance.com:443/ws/!miniTicker@arr', type: 'websocket', status: 'active', pingMs: 24, reliability: '100%', priority: 4 },
  { id: 'f_nerkhara', name: 'NerkhAra Validated Feed', url: 'https://nerkhara.com/api/v1/latest.json', type: 'domestic', status: 'active', pingMs: 34, reliability: '99.9%', priority: 5 },
  { id: 'f_nerkh', name: 'TGJU / IranMarket Rate', url: 'https://iran-market.github.io/data/latest-toman.json', type: 'domestic', status: 'active', pingMs: 38, reliability: '99.6%', priority: 6 },
  { id: 'f_wallex', name: 'Wallex USDT/TMN Bridge', url: 'https://api.wallex.ir/v1/markets', type: 'tether', status: 'active', pingMs: 32, reliability: '100%', priority: 7 }
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
            .map((p: any) => [Math.floor(Number(p[0])), Math.round(Number(p[1]))] as [number, number]);
          if (valid.length) domesticIntradayTicks.set(id, valid);
        }
      }
    }
  }
} catch {}

function recordDomesticTick(id: string, ts: number, price: number) {
  if (!(price > 0) || !Number.isFinite(ts) || ts <= 1500000000) return;
  let arr = domesticIntradayTicks.get(id);
  if (!arr) {
    arr = [];
    domesticIntradayTicks.set(id, arr);
  }
  const rounded = Math.round(price);
  const cutoff = ts - 7 * 86400;
  while (arr.length && arr[0][0] < cutoff) arr.shift();
  const last = arr[arr.length - 1];
  if (!last || (ts - last[0] >= 180) || last[1] !== rounded) {
    if (last && last[0] === ts) {
      last[1] = rounded;
    } else if (!last || ts > last[0]) {
      arr.push([ts, rounded]);
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
      const effectiveT = validSrcTs || now;
      items[id] = {
        price,
        change: finalChange,
        t: effectiveT,
        sourceTimestamp: validSrcTs,
        receivedAt: now,
        checkedAt: now,
        src,
        unit,
        priceType: extra.priceType || 'last',
        upstreamStale: false,
        ...extra
      };
      if (unit === 'IRT') recordDomesticTick(id, now, price);
      freshCount++;
      return true;
    };

    // 1. Independent Tether & Per-Asset Domestic Rates (IranMarket + NerkhAra + Nerkhsanj + PersianToolbox)
    const domesticTask = async () => {
      const [imResult, naResult] = await Promise.allSettled([
        fetchJSON('https://iran-market.github.io/data/latest-toman.json', 5),
        fetchJSON('https://nerkhara.com/api/v1/latest.json', 5)
      ]);

      const imData: any = imResult.status === 'fulfilled' ? imResult.value : null;
      const naData: any = naResult.status === 'fulfilled' ? naResult.value : null;

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

      // B. Per-Asset Domestic Resolution (NerkhAra primary + unified USD/EUR source)
      const prevClosesMap = await getDomesticPrevCloses();
      const resolvedDomesticIds = new Set<string>();
      const sourcesSummary: Record<string, number> = {};
      const nerkharaHasUsdEur = Boolean(naDict.usd && naDict.eur);
      const iranMarketHasUsdEur = Boolean(imDict.USD && imDict.EUR);

      for (const id of ALL_DOMESTIC_IDS) {
        const meta = (DOMESTIC_META as any)[id];
        const imSym = (IRAN_MARKET_MAP[id] || [])[0];
        const naKey = (NERKHARA_MAP as any)[id];
        const imItem = imSym ? imDict[imSym] : null;
        const naItem = naKey ? naDict[naKey] : null;

        const buildNerkhara = (item: any) => ({
          src: 'nerkhara',
          price: Math.round(Number(item.price)),
          rawChg: item.change_pct,
          ts: item.srcTs,
          extra: {
            priceType: item.method || 'average',
            method: item.method,
            sourcesCount: Number(item.sources) || undefined,
            spreadPct: Number.isFinite(Number(item.spread_pct)) ? Number(item.spread_pct) : undefined
          }
        });
        const buildIranMarket = (item: any) => ({
          src: 'iran_market',
          price: Math.round(Number(item.price)),
          rawChg: item.change_pct,
          ts: item.srcTs,
          extra: { priceType: 'last' }
        });

        let chosen: any = null;
        if (id === 'usd' || id === 'eur') {
          if (nerkharaHasUsdEur && naItem) {
            chosen = buildNerkhara(naItem);
          } else if (iranMarketHasUsdEur && imItem) {
            chosen = buildIranMarket(imItem);
          } else if (naItem) {
            chosen = buildNerkhara(naItem);
          } else if (imItem) {
            chosen = buildIranMarket(imItem);
          }
        } else if (naItem) {
          chosen = buildNerkhara(naItem);
        } else if (imItem) {
          chosen = buildIranMarket(imItem);
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
              const v = Math.round(Number(j.rates[k]));
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
      const order = systemFeeds
        .filter(f => f.type === 'crypto' && f.status === 'active')
        .sort((a, b) => a.priority - b.priority)
        .map(f => f.id.replace('f_', ''))
        .filter(id => EXCHANGE_SOURCES[id]);
      if (!order.length) order.push('kucoin', 'okx', 'gate');
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

          for (const x of rows) {
            const base = String(x.base);
            const id = base.toLowerCase();
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
      checkedAt: now,
      items,
      feeds
    };
    lastFetchTime = now;

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

// Background scheduler (15-second interval)
setInterval(() => {
  updateAllPrices();
}, 15000);

// Initial immediate fetch
updateAllPrices(true);

// ---------- API Routes ----------

app.get('/api/health', (req, res) => {
  const now = Math.floor(Date.now() / 1000);
  res.json({
    ok: true,
    database: true,
    kv: 'local_file_snapshot',
    google: false,
    email: false,
    marketOpen: isTehranMarketOpen(now),
    feeds: cachedPrices.feeds || {},
    time: now
  });
});

app.get('/api/prices', async (req, res) => {
  const manual = req.query.refresh === '1';
  if (manual && !checkRateLimit('refresh:' + getClientIp(req), 6, 60)) {
    return res.status(429).json({ error: 'تعداد درخواست‌های به‌روزرسانی بیش از حد مجاز است. کمی صبر کنید.' });
  }
  const age = Math.floor(Date.now() / 1000) - lastFetchTime;

  if (manual || age > 15 || !Object.keys(cachedPrices.items || {}).length) {
    if (manual || !Object.keys(cachedPrices.items || {}).length) {
      await updateAllPrices(true);
    } else {
      updateAllPrices();
    }
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

  res.setHeader('Cache-Control', 'public, max-age=5, stale-while-revalidate=15');
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
  allowLiveAppend = true
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
  if (filtered.length < 2) return [];

  const isIntraday = range === '1H' || range === '1D';
  const graceWindow = isIntraday
    ? (range === '1H' ? 4500 : 88200)
    : (isDomestic ? Math.max(span * 1.5, 6 * 86400) : Math.max(span * 1.25, 7200));
  const minTs = now - graceWindow;
  let pts = filtered.filter((p) => p[0] >= minTs && p[0] <= now + 3600);
  if (!isIntraday && pts.length < 2) {
    pts = filtered.slice(-Math.min(filtered.length, range === '1Y' ? 365 : range === '1M' ? 35 : 48));
  }
  if (pts.length < 2) return [];

  if (allowLiveAppend && refPrice > 0) {
    const lastPt = pts[pts.length - 1];
    const diffRatio = Math.abs(lastPt[1] - refPrice) / refPrice;
    if (diffRatio <= 0.35 && now > lastPt[0]) {
      pts.push([now, refPrice]);
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
      dailyArchiveMemCache.set('im:' + sym, { at: now, im: j });
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
      dailyArchiveMemCache.set('na:' + naId, { at: now, na: j });
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

// Real history extraction with ZERO synthetic/interpolated points
async function archiveHistory(id: string, range: string, liveItem: any = null): Promise<[number, number][]> {
  const now = Math.floor(Date.now() / 1000);
  const span = RANGES_MAP[range] || 86400;
  const minTs = now - span - 4 * 86400;
  const maxSlice = range === '3D' ? 10 : range === '1W' ? 18 : range === '1M' ? 45 : 400;
  const curPrice = (liveItem && Number(liveItem.price) > 0 && !isPriceItemStale(liveItem, id, now))
    ? Math.round(Number(liveItem.price))
    : 0;
  const curTs = Number(liveItem?.sourceTimestamp) > 0
    ? Math.floor(Number(liveItem.sourceTimestamp))
    : (Number(liveItem?.receivedAt) > 0 ? Math.floor(Number(liveItem.receivedAt)) : now);

  // 1. For 1H and 1D: real recorded intraday ticks + genuine 24h boundary from daily archive when ticks don't span 24h yet
  if (range === '1H' || range === '1D') {
    const windowStart = now - span;
    const ticks = (domesticIntradayTicks.get(id) || []).filter((p) => p[0] >= windowStart && p[0] <= now + 60);
    const combined: [number, number][] = [...ticks];
    if (curPrice > 0 && curTs >= windowStart) {
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

      if (sym) {
        const j = await fetchIranMarketDailyRaw(sym);
        const records = Array.isArray(j?.data) ? j.data : j?.data?.records;
        const isToman = j?.meta?.unit === 'toman' || j?.meta?.currency === 'IRT';
        const div = isToman ? 1 : 10;
        if (Array.isArray(records) && records.length) {
          const recent = records.slice(-5);
          let prevCloseForWindow: number | null = null;
          for (const rec of recent) {
            const startTs = parseArchiveRecTs(rec);
            if (!startTs) continue;
            const openVal = Number(rec.open) > 0 ? Math.round(Number(rec.open) / div) : 0;
            const closeVal = Number(rec.close) > 0 ? Math.round(Number(rec.close) / div) : 0;
            if (startTs <= windowStart && (closeVal > 0 || openVal > 0)) {
              prevCloseForWindow = closeVal || openVal;
            }
            if (openVal > 0 && startTs >= windowStart && startTs < (deduped[0]?.[0] || curTs)) {
              anchorPoints.push([startTs, openVal]);
            }
            if (closeVal > 0) {
              const pubMs = typeof j?.meta?.published_at === 'string' ? Date.parse(j.meta.published_at) : NaN;
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

      if (!foundAnchorAtWindowStart && naId) {
        const nj = await fetchNerkharaDailyRaw(naId);
        const pts = nj?.points;
        if (Array.isArray(pts) && pts.length) {
          const recentNa = pts.slice(-4);
          let bestVal = 0;
          for (const row of recentNa) {
            if (!Array.isArray(row) || row.length < 2) continue;
            const dStr = String(row[0] || '').trim();
            const v = Math.round(Number(row[1]));
            if (!/^\d{4}-\d{2}-\d{2}$/.test(dStr) || !(v > 0)) continue;
            const ts = Math.floor(Date.parse(`${dStr}T12:00:00Z`) / 1000);
            if (ts <= windowStart + 43200) bestVal = v;
            if (ts >= windowStart && ts < (deduped[0]?.[0] || curTs)) {
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
        if (curPrice > 0 && curTs > (merged.at(-1)?.[0] || 0)) {
          merged.push([curTs, curPrice]);
        } else if (curPrice > 0 && merged.length && now > (merged.at(-1)?.[0] || 0)) {
          merged.push([now, curPrice]);
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
        if (finalOut.length >= 2) return finalOut;
      }
    }

    return deduped.length >= 2 ? deduped : [];
  }

  const recentIntraday = (range === '3D' || range === '1W')
    ? (domesticIntradayTicks.get(id) || []).filter((p) => p[0] >= now - span && p[0] <= now + 60)
    : [];

  // 2. Multi-day ranges (3D, 1W, 1M, 1Y): Primary iran-market daily archive
  const sym = id === 'usdt' ? 'USDT_IRR' : (IRAN_MARKET_MAP[id] || [])[0];
  if (sym) {
    try {
      const j = await fetchIranMarketDailyRaw(sym);
      const records = Array.isArray(j?.data) ? j.data : j?.data?.records;
      const isToman = j?.meta?.unit === 'toman' || j?.meta?.currency === 'IRT';
      const div = isToman ? 1 : 10;
      if (Array.isArray(records) && records.length >= 2) {
        const out: [number, number][] = [];
        for (const rec of records.slice(-maxSlice)) {
          const closeRaw = Number(rec.close);
          if (!(closeRaw > 0)) continue;
          const closeToman = Math.round(closeRaw / div);
          const baseTs = parseArchiveRecTs(rec);
          if (baseTs >= minTs && baseTs <= now + 3600) {
            out.push([baseTs, closeToman]);
          }
        }
        for (const pt of recentIntraday) out.push(pt);
        if (curPrice > 0) out.push([curTs, curPrice]);
        if (out.length >= 2) return out;
      }
    } catch {}
  }

  // Secondary multi-day source: NerkhAra daily history
  const naId = (NERKHARA_MAP as any)[id];
  if (naId) {
    try {
      const j = await fetchNerkharaDailyRaw(naId);
      const pts = j?.points;
      if (Array.isArray(pts) && pts.length >= 2) {
        const out: [number, number][] = [];
        for (const row of pts.slice(-maxSlice)) {
          if (!Array.isArray(row) || row.length < 2) continue;
          const dateStr = String(row[0] || '').trim();
          const val = Math.round(Number(row[1]));
          if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr) || !(val > 0)) continue;
          const ts = Math.floor(Date.parse(`${dateStr}T12:00:00Z`) / 1000);
          if (Number.isFinite(ts) && ts >= minTs && ts <= now + 3600) {
            out.push([ts, val]);
          }
        }
        for (const pt of recentIntraday) out.push(pt);
        if (curPrice > 0) out.push([curTs, curPrice]);
        if (out.length >= 2) return out;
      }
    } catch {}
  }

  // Tertiary multi-day source: Nerkhsanj rates.json
  const key = (NERKH[id] || [])[0] || (DOMESTIC_EXTRA[id] || [])[0];
  if (!key) return [];
  try {
    const text = await getRatesArchiveText();
    if (!text) return [];
    const marker = `"key":"${key}"`;
    const idx = text.indexOf(marker);
    if (idx === -1) return [];
    const daysIdx = text.indexOf('"days":', idx);
    const endDaysIdx = text.indexOf(']]', daysIdx);
    if (daysIdx === -1 || endDaysIdx === -1) return [];
    const days = JSON.parse(text.slice(daysIdx + 7, endDaysIdx + 2));
    const out: [number, number][] = [];
    for (const [d, v] of days.slice(-maxSlice)) {
      const m = /^(\d{4})\/(\d{2})\/(\d{2})$/.exec(d);
      if (!m || !(v > 0)) continue;
      const [gy, gm, gd] = jalaliToGregorian(+m[1], +m[2], +m[3]);
      const ts = Math.floor(Date.UTC(gy, gm - 1, gd, 12) / 1000) - 12600;
      if (ts >= minTs && ts <= now + 3600) {
        out.push([ts, Number(v)]);
      }
    }
    for (const pt of recentIntraday) out.push(pt);
    if (curPrice > 0) out.push([curTs, curPrice]);
    return out;
  } catch {
    return [];
  }
}

async function wallexHistory(symbol: string, range: string, refPrice = 0): Promise<[number, number][]> {
  const now = Math.floor(Date.now() / 1000);
  const cfg: Record<string, [string, number]> = {
    '1H': ['1', 3600],
    '1D': ['15', 86400],
    '3D': ['60', 259200],
    '1W': ['60', 604800],
    '1M': ['1D', 2592000],
    '1Y': ['1D', 31536000]
  };
  const [res, span] = cfg[range] || ['15', 86400];
  try {
    const j = await fetchJSON(`https://api.wallex.ir/v1/udf/history?symbol=${symbol}&resolution=${res}&from=${now - span}&to=${now}`, 5);
    if (j?.s === 'ok' && Array.isArray(j.t) && Array.isArray(j.c) && j.t.length >= 2) {
      const pts: [number, number][] = [];
      for (let i = 0; i < j.t.length; i++) {
        const ts = Number(j.t[i]), c = Number(j.c[i]);
        if (Number.isFinite(ts) && c > 0) {
          pts.push([ts, Math.round(c)]);
        }
      }
      return validateHistoryPoints(pts, range, now, true, refPrice, true);
    }
  } catch {}
  return [];
}

// Fast klines & historical archive (Real verified data only — zero synthetic charts)
app.get('/api/history', async (req, res) => {
  if (!checkRateLimit('hist:' + getClientIp(req), 120, 60)) {
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

  // 1. Crypto & Tether history
  if (item?.crypto || !isDomesticAsset) {
    if (id === 'usdt') {
      const refP = (item && !isPriceItemStale(item, 'usdt', now)) ? (item.price || 0) : 0;
      let pts = await wallexHistory('USDTTMN', range, refP);
      let srcUsed = 'wallex';
      if (pts.length < 2) {
        const arch = await archiveHistory('usdt', range, item);
        pts = validateHistoryPoints(arch, range, now, true, refP, range !== '1H' && range !== '1D');
        srcUsed = (range === '1H' || range === '1D') ? 'd1_intraday' : 'archive';
      }
      if (pts.length >= 2) {
        const payload = { id, range, currency: 'IRT', source: srcUsed, points: pts };
        historyMemCache.set(cacheKey, { at: now, data: payload });
        return res.json(payload);
      }
      return res.json({ id, range, currency: 'IRT', points: [], unavailable: true, reason: 'insufficient_real_points' });
    }
    const [iv, lim] = KL[range] || ['5m', 288];
    const base = (item?.sym || id).toUpperCase();
    const refP = (item && !isPriceItemStale(item, id, now)) ? (item.price || 0) : 0;
    const exchangeOrder = range === '1Y'
      ? [...new Set([item?.src !== 'okx' ? item?.src : null, 'kucoin', 'gate', 'okx'].filter(Boolean))]
      : [...new Set([item?.src, 'kucoin', 'okx', 'gate'].filter(Boolean))];
    for (const name of exchangeOrder) {
      const src = EXCHANGE_SOURCES[name];
      if (!src) continue;
      try {
        const pair = (item && name === item.src && item.pair) ? item.pair : name === 'gate' ? `${base}_USDT` : `${base}-USDT`;
        const rawPts = await src.klines(pair, iv, lim);
        const points = validateHistoryPoints(rawPts, range, now, false, refP, true);
        if (points.length >= 2) {
          const payload = { id, range, currency: 'USDT', source: name, points };
          historyMemCache.set(cacheKey, { at: now, data: payload });
          return res.json(payload);
        }
      } catch {}
    }
    return res.json({ id, range, currency: 'USDT', points: [], unavailable: true, reason: 'exchange_klines_unavailable' });
  }

  // 2. Domestic history (zero synthetic points)
  try {
    const curPrice = (item && !isPriceItemStale(item, id, now)) ? (item.price || 0) : 0;
    const isIntraday = range === '1H' || range === '1D';
    const rawPoints = await archiveHistory(id, range, item);
    const points = validateHistoryPoints(rawPoints, range, now, true, curPrice, !isIntraday);
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

    const payload = {
      id,
      range,
      currency: item?.unit || 'IRT',
      source: isIntraday ? 'd1_intraday' : 'archive',
      points
    };
    historyMemCache.set(cacheKey, { at: now, data: payload });
    return res.json(payload);
  } catch (e) {
    return res.json({ id, range, currency: item?.unit || 'IRT', points: [], unavailable: true });
  }
});

// Persistent user store & cryptographic session management
const ADMIN_EMAIL = 'a.h.sh.t1381@gmail.com';
const AUTH_SECRET = (process.env.AUTH_SECRET && process.env.AUTH_SECRET.trim().length >= 16)
  ? process.env.AUTH_SECRET.trim()
  : crypto.randomBytes(32).toString('hex');
const AUTH_SESSION_FILE = path.join(__dirname, '.auth-session.json');

function sha256Hex(input: string): string {
  return crypto.createHash('sha256').update(String(input)).digest('hex');
}

function hmacHex(secret: string, data: string): string {
  return crypto.createHmac('sha256', secret).update(String(data)).digest('hex');
}

function safeEqualStr(a: string, b: string): boolean {
  const bufA = Buffer.from(String(a || ''));
  const bufB = Buffer.from(String(b || ''));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function hashPasswordSync(password: string, saltHex?: string): string {
  const salt = saltHex || crypto.randomBytes(16).toString('hex');
  const derived = crypto.pbkdf2Sync(String(password), salt, 100000, 32, 'sha256').toString('hex');
  return `pbkdf2$${salt}$${derived}`;
}

function verifyPasswordSync(password: string, storedHash: string): boolean {
  if (!storedHash || typeof storedHash !== 'string') return false;
  if (storedHash.startsWith('pbkdf2$')) {
    const parts = storedHash.split('$');
    if (parts.length !== 3) return false;
    const [, salt, hash] = parts;
    const candidate = crypto.pbkdf2Sync(String(password), salt, 100000, 32, 'sha256').toString('hex');
    return safeEqualStr(candidate, hash);
  }
  return false;
}

function getConfiguredAdminPassword(): string | null {
  const raw = String(process.env.ADMIN_PASSWORD || '').trim();
  if (!raw || raw.length < 8) return null;
  if (raw.toLowerCase() === ADMIN_EMAIL.toLowerCase()) return null;
  return raw;
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

const initialAdminPass = getConfiguredAdminPassword();
let systemUsers: StoredUser[] = [
  {
    id: 'u_admin',
    name: 'مدیر کل دارایی',
    email: ADMIN_EMAIL,
    role: 'admin',
    status: 'active',
    registeredAt: '1403/01/15',
    holdingsCount: 16,
    alertsCount: 4,
    lastLogin: 'هم‌اکنون',
    passwordHash: initialAdminPass ? hashPasswordSync(initialAdminPass) : ''
  },
  { id: 'u_2', name: 'امیرحسین رضایی', email: 'amir.financial@yahoo.com', role: 'user', status: 'active', registeredAt: '1403/06/10', holdingsCount: 12, alertsCount: 3, lastLogin: '۲ ساعت قبل', passwordHash: hashPasswordSync('Amir#Secure2024') },
  { id: 'u_3', name: 'سارا تهرانی', email: 'sara.trader@gmail.com', role: 'user', status: 'active', registeredAt: '1403/08/22', holdingsCount: 5, alertsCount: 2, lastLogin: 'دیروز', passwordHash: hashPasswordSync('SaraTeh_Trade99') },
  { id: 'u_4', name: 'رضا کریمی', email: 'reza.crypto@outlook.com', role: 'user', status: 'active', registeredAt: '1403/09/04', holdingsCount: 28, alertsCount: 7, lastLogin: '۳ روز قبل', passwordHash: hashPasswordSync('RezaCrypto!442') },
  { id: 'u_5', name: 'مهدی زرگر', email: 'mehdi.gold@gmail.com', role: 'user', status: 'active', registeredAt: '1403/10/12', holdingsCount: 8, alertsCount: 1, lastLogin: '۱ هفته قبل', passwordHash: hashPasswordSync('MehdiGold*8821') }
];

function loadAuthSessionFromDisk() {
  try {
    if (fs.existsSync(AUTH_SESSION_FILE)) {
      const raw = JSON.parse(fs.readFileSync(AUTH_SESSION_FILE, 'utf8'));
      if (raw && typeof raw === 'object') {
        if (raw.userStore && typeof raw.userStore === 'object') {
          Object.assign(userStore, raw.userStore);
        }
        if (Array.isArray(raw.users)) {
          for (const savedUser of raw.users) {
            if (!savedUser || !savedUser.email) continue;
            const norm = String(savedUser.email).toLowerCase();
            const existing = systemUsers.find(u => u.email.toLowerCase() === norm);
            if (existing) {
              if (savedUser.passwordHash && String(savedUser.passwordHash).startsWith('pbkdf2$')) {
                existing.passwordHash = savedUser.passwordHash;
              }
              if (savedUser.status === 'suspended' && norm !== ADMIN_EMAIL.toLowerCase()) {
                existing.status = 'suspended';
              }
            } else if (savedUser.passwordHash && String(savedUser.passwordHash).startsWith('pbkdf2$')) {
              systemUsers.push({
                id: String(savedUser.id || 'u_' + Date.now()),
                name: String(savedUser.name || norm.split('@')[0]).slice(0, 80),
                email: norm,
                role: savedUser.role === 'admin' ? 'admin' : 'user',
                status: savedUser.status === 'suspended' ? 'suspended' : 'active',
                registeredAt: String(savedUser.registeredAt || 'هم‌اکنون'),
                holdingsCount: Number(savedUser.holdingsCount) || 0,
                alertsCount: Number(savedUser.alertsCount) || 0,
                lastLogin: String(savedUser.lastLogin || 'هم‌اکنون'),
                passwordHash: savedUser.passwordHash
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
    fs.writeFileSync(AUTH_SESSION_FILE, JSON.stringify({ userStore, users: safeUsers }, null, 2), { encoding: 'utf8', mode: 0o600 });
  } catch {}
}
loadAuthSessionFromDisk();

let systemAuditLogs = [
  { id: 1, time: 'هم‌اکنون', type: 'info', msg: 'وب‌سرویس بایننس و صرافی‌ها در حالت همگام‌سازی بلادرنگ هستند.' },
  { id: 2, time: '۲ دقیقه قبل', type: 'success', msg: 'فید قیمت‌های داخلی (طلا و ارز) بدون خطا به‌روز شد.' },
  { id: 3, time: '۱۰ دقیقه قبل', type: 'auth', msg: 'بررسی امنیتی نشست‌ها و توکن‌های احراز هویت انجام شد.' },
  { id: 4, time: '۳۵ دقیقه قبل', type: 'system', msg: 'بررسی سلامت کش قیمت‌ها و ارتباط با دیتابیس با موفقیت انجام شد.' }
];

function createSessionForUser(res: express.Response, req: express.Request, user: StoredUser) {
  const baseSid = crypto.randomBytes(32).toString('hex');
  const sig = hmacHex(AUTH_SECRET, baseSid);
  const signedToken = `${baseSid}.${sig}`;
  const sidHash = sha256Hex(baseSid);
  const ttlSec = 60 * 60 * 24 * 14;
  const nowSec = Math.floor(Date.now() / 1000);
  const isAdmin = user.role === 'admin' || user.email.toLowerCase() === ADMIN_EMAIL.toLowerCase();
  const sessionRec: SessionRecord = {
    sidHash,
    userId: user.id,
    email: user.email.toLowerCase(),
    name: user.name,
    role: isAdmin ? 'admin' : 'user',
    isAdmin,
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
    role: sessionRec.role,
    isAdmin
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

function resolveReqUser(req: express.Request) {
  const rawToken = extractRawSessionToken(req);
  if (!rawToken || !rawToken.includes('.')) return null;
  const dotIdx = rawToken.indexOf('.');
  const baseSid = rawToken.slice(0, dotIdx);
  const sig = rawToken.slice(dotIdx + 1);
  if (!baseSid || !sig) return null;
  const expectedSig = hmacHex(AUTH_SECRET, baseSid);
  if (!safeEqualStr(sig, expectedSig)) return null;

  const sidHash = sha256Hex(baseSid);
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

  return {
    id: sess.userId,
    name: usr?.name || sess.name,
    email: sess.email,
    role: sess.role,
    isAdmin: sess.isAdmin
  };
}

// Download endpoint for the final Cloudflare Worker bundle (Admin-only)
app.get('/api/download/worker.js', (req, res) => {
  const u = resolveReqUser(req);
  if (!u || !u.isAdmin) {
    return res.status(403).json({ error: 'دسترسی فقط برای مدیر سیستم مجاز است.' });
  }
  const candidatePaths = [
    path.join(process.cwd(), 'dist', 'worker.js'),
    path.join(__dirname, 'dist', 'worker.js'),
    path.join(process.cwd(), 'public', 'worker.js')
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

app.get('/api/me', (req, res) => {
  res.json({ user: resolveReqUser(req) });
});

app.post('/api/auth/check-email', (req, res) => {
  const ip = getClientIp(req);
  const normalizedEmail = String(req.body?.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) || normalizedEmail.length > 120) {
    return res.status(400).json({ error: 'ایمیل معتبر نیست.' });
  }
  if (!checkRateLimit(`check_email_ip:${ip}`, 25, 900) || !checkRateLimit(`check_email:${ip}:${normalizedEmail}`, 12, 900)) {
    return res.status(429).json({ error: 'تعداد درخواست‌ها بیش از حد مجاز است. لطفاً کمی صبر کنید.' });
  }
  const isAdmin = normalizedEmail === ADMIN_EMAIL.toLowerCase();
  const existing = systemUsers.find(u => u.email.toLowerCase() === normalizedEmail);
  const storeRec = userStore[normalizedEmail];
  if (existing || storeRec || isAdmin) {
    return res.json({
      ok: true,
      exists: true,
      hasPassword: Boolean(existing?.passwordHash || (isAdmin && getConfiguredAdminPassword())),
      hasGoogle: false
    });
  }
  return res.json({
    ok: true,
    exists: false,
    allowRegister: systemSettings.allowNewRegistrations !== false
  });
});

app.post('/api/auth/login', (req, res) => {
  const ip = getClientIp(req);
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'ایمیل و رمز عبور را وارد کنید.' });
  const normalizedEmail = String(email).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) || normalizedEmail.length > 120) {
    return res.status(400).json({ error: 'ایمیل معتبر نیست.' });
  }
  if (!checkRateLimit(`login:${ip}:${normalizedEmail}`, 8, 900) || !checkRateLimit(`login_ip:${ip}`, 20, 900)) {
    return res.status(429).json({ error: 'تعداد تلاش‌های ورود بیش از حد مجاز است. لطفاً ۱۵ دقیقه صبر کنید.' });
  }

  const passStr = String(password);
  if (passStr.length < 8 || passStr.length > 128) {
    return res.status(401).json({ error: 'ایمیل یا رمز عبور نادرست است.' });
  }

  const isAdmin = normalizedEmail === ADMIN_EMAIL.toLowerCase();
  const existing = systemUsers.find(u => u.email.toLowerCase() === normalizedEmail);

  if (isAdmin) {
    if (passStr.toLowerCase() === ADMIN_EMAIL.toLowerCase()) {
      return res.status(401).json({ error: 'استفاده از آدرس ایمیل به‌عنوان رمز عبور مدیر مجاز نیست.' });
    }
    const envAdminPass = getConfiguredAdminPassword();
    let adminAuthenticated = false;
    if (existing?.passwordHash && verifyPasswordSync(passStr, existing.passwordHash)) {
      adminAuthenticated = true;
    } else if (envAdminPass && safeEqualStr(passStr, envAdminPass)) {
      adminAuthenticated = true;
      if (existing) existing.passwordHash = hashPasswordSync(passStr);
    }
    if (!adminAuthenticated) {
      return res.status(401).json({ error: 'ایمیل یا رمز عبور نادرست است.' });
    }
  } else {
    if (!existing || !existing.passwordHash || !verifyPasswordSync(passStr, existing.passwordHash)) {
      return res.status(401).json({ error: 'ایمیل یا رمز عبور نادرست است.' });
    }
    if (existing.status === 'suspended') {
      return res.status(403).json({ error: 'حساب کاربری شما توسط مدیریت مسدود شده است.' });
    }
  }

  const targetUser = existing!;
  targetUser.lastLogin = 'هم‌اکنون';
  const sessionUser = createSessionForUser(res, req, targetUser);
  saveAuthSessionToDisk();

  systemAuditLogs.unshift({
    id: Date.now(),
    time: 'هم‌اکنون',
    type: 'auth',
    msg: `ورود موفق کاربر: ${sessionUser.email} (${isAdmin ? 'سطح دسترسی: مدیر ارشد' : 'کاربر'})`
  });
  if (systemAuditLogs.length > 40) systemAuditLogs.pop();
  res.json({ ok: true, user: sessionUser });
});

// Admin Panel APIs
app.use('/api/admin', (req, res, next) => {
  const ip = getClientIp(req);
  if (!checkRateLimit(`admin:${ip}`, 60, 60)) {
    return res.status(429).json({ error: 'تعداد درخواست‌های پنل مدیریت بیش از حد مجاز است.' });
  }
  const u = resolveReqUser(req);
  if (!u || !u.isAdmin) {
    return res.status(403).json({ error: 'دسترسی فقط برای مدیر سیستم مجاز است.' });
  }
  next();
});

app.get('/api/admin/overview', (req, res) => {
  const items = cachedPrices.items || {};
  const totalCrypto = Object.values(items).filter((i: any) => i.crypto).length;
  const totalDomestic = Object.values(items).filter((i: any) => i.kind === 'domestic').length;
  
  res.json({
    ok: true,
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
    feeds: [...systemFeeds].sort((a, b) => a.priority - b.priority),
    broadcast: broadcastMessage
  });
});

const formatFeedResponse = (f: SystemFeed) => ({
  ...f,
  active: f.status === 'active',
  protocol: f.type
});

app.get('/api/admin/feeds', (req, res) => {
  const sorted = [...systemFeeds].sort((a, b) => a.priority - b.priority).map(formatFeedResponse);
  res.json({ ok: true, feeds: sorted });
});

app.post('/api/admin/feeds/add', (req, res) => {
  const { name, url } = req.body || {};
  const type = req.body?.type || req.body?.protocol || 'crypto';
  if (!name || !url) return res.status(400).json({ error: 'نام و آدرس ایندپوینت الزامی است.' });
  if (!isSafePublicUrl(String(url))) return res.status(400).json({ error: 'فقط آدرس‌های عمومی و امن (https:// یا wss://) مجاز هستند.' });
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
  systemAuditLogs.unshift({
    id: Date.now(),
    time: 'هم‌اکنون',
    type: 'admin',
    msg: `فید وب‌سرویس جدید ${newFeed.name} با اولویت ${newFeed.priority} اضافه گردید.`
  });
  res.json({ ok: true, feed: formatFeedResponse(newFeed) });
});

app.post('/api/admin/feeds/:id/toggle', (req, res) => {
  const f = systemFeeds.find(x => x.id === req.params.id);
  if (!f) return res.status(404).json({ error: 'فید یافت نشد.' });
  f.status = f.status === 'active' ? 'inactive' : 'active';
  systemAuditLogs.unshift({
    id: Date.now(),
    time: 'هم‌اکنون',
    type: 'admin',
    msg: `وضعیت وب‌سرویس ${f.name} به ${f.status === 'active' ? 'فعال' : 'غیرفعال'} تغییر یافت.`
  });
  res.json({ ok: true, feed: formatFeedResponse(f) });
});

app.post('/api/admin/feeds/:id/move-up', (req, res) => {
  const sorted = [...systemFeeds].sort((a, b) => a.priority - b.priority);
  const idx = sorted.findIndex(x => x.id === req.params.id);
  if (idx > 0) {
    const prev = sorted[idx - 1];
    const curr = sorted[idx];
    const temp = prev.priority;
    prev.priority = curr.priority;
    curr.priority = temp;
    systemAuditLogs.unshift({
      id: Date.now(),
      time: 'هم‌اکنون',
      type: 'admin',
      msg: `اولویت فید ${curr.name} به رتبه ${curr.priority} ارتقا یافت.`
    });
  }
  const result = [...systemFeeds].sort((a, b) => a.priority - b.priority).map(formatFeedResponse);
  res.json({ ok: true, feeds: result });
});

app.post('/api/admin/feeds/:id/move-down', (req, res) => {
  const sorted = [...systemFeeds].sort((a, b) => a.priority - b.priority);
  const idx = sorted.findIndex(x => x.id === req.params.id);
  if (idx !== -1 && idx < sorted.length - 1) {
    const next = sorted[idx + 1];
    const curr = sorted[idx];
    const temp = next.priority;
    next.priority = curr.priority;
    curr.priority = temp;
    systemAuditLogs.unshift({
      id: Date.now(),
      time: 'هم‌اکنون',
      type: 'admin',
      msg: `اولویت فید ${curr.name} به رتبه ${curr.priority} تنزل یافت.`
    });
  }
  const result = [...systemFeeds].sort((a, b) => a.priority - b.priority).map(formatFeedResponse);
  res.json({ ok: true, feeds: result });
});

app.delete('/api/admin/feeds/:id', (req, res) => {
  const idx = systemFeeds.findIndex(x => x.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'فید یافت نشد.' });
  const [removed] = systemFeeds.splice(idx, 1);
  systemAuditLogs.unshift({
    id: Date.now(),
    time: 'هم‌اکنون',
    type: 'admin',
    msg: `فید وب‌سرویس ${removed.name} توسط مدیر حذف شد.`
  });
  res.json({ ok: true });
});

app.post('/api/admin/feeds/:id/test', async (req, res) => {
  const f = systemFeeds.find(x => x.id === req.params.id);
  if (!f) return res.status(404).json({ error: 'فید یافت نشد.' });
  if (!isSafePublicUrl(f.url)) {
    return res.status(400).json({ error: 'آدرس فید نامعتبر یا غیرمجاز است.' });
  }
  const start = performance.now();
  let ok = true;
  let status = 200;
  try {
    if (f.url.startsWith('https://')) {
      const resp = await fetch(f.url, { redirect: 'error', signal: AbortSignal.timeout(4000) });
      status = resp.status;
      ok = resp.ok;
    }
  } catch {
    ok = false;
    status = 0;
  }
  const ping = Math.round(performance.now() - start);
  f.pingMs = ping;
  res.json({ ok, pingMs: ping, httpStatus: status });
});

function sanitizeUserForAdmin(u: StoredUser) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
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

app.post('/api/admin/users/:id/toggle', (req, res) => {
  const u = systemUsers.find(x => x.id === req.params.id);
  if (!u) return res.status(404).json({ error: 'کاربر یافت نشد.' });
  if (u.email.toLowerCase() === ADMIN_EMAIL.toLowerCase()) {
    return res.status(400).json({ error: 'امکان تغییر وضعیت مدیر کل سیستم وجود ندارد.' });
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

app.get('/api/admin/logs', (req, res) => {
  res.json({ ok: true, logs: systemAuditLogs });
});

app.post('/api/admin/logs/clear', (req, res) => {
  systemAuditLogs = [
    { id: Date.now(), time: 'هم‌اکنون', type: 'system', msg: 'گزارش وقایع توسط مدیر سیستم پاکسازی شد.' }
  ];
  res.json({ ok: true });
});

app.post('/api/admin/users/add', (req, res) => {
  const { name, email, role, password } = req.body || {};
  if (!name || !email) return res.status(400).json({ error: 'نام و ایمیل الزامی است.' });
  const normalizedEmail = String(email).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) || normalizedEmail.length > 120) {
    return res.status(400).json({ error: 'ایمیل معتبر نیست.' });
  }
  if (systemUsers.some(u => u.email.toLowerCase() === normalizedEmail)) {
    return res.status(409).json({ error: 'این ایمیل قبلاً ثبت شده است.' });
  }
  const pass = String(password || '').trim();
  if (pass.length < 8 || pass.length > 128) {
    return res.status(400).json({ error: 'رمز عبور باید حداقل ۸ کاراکتر باشد.' });
  }
  if (pass.toLowerCase() === normalizedEmail) {
    return res.status(400).json({ error: 'رمز عبور نمی‌تواند برابر با آدرس ایمیل باشد.' });
  }
  const newUser: StoredUser = {
    id: 'u_' + Date.now(),
    name: String(name).trim().slice(0, 80),
    email: normalizedEmail,
    role: role === 'admin' && normalizedEmail === ADMIN_EMAIL.toLowerCase() ? 'admin' : 'user',
    status: 'active',
    registeredAt: 'هم‌اکنون',
    holdingsCount: 0,
    alertsCount: 0,
    lastLogin: 'تازه ثبت‌نام‌شده',
    passwordHash: hashPasswordSync(pass)
  };
  systemUsers.unshift(newUser);
  saveAuthSessionToDisk();
  systemAuditLogs.unshift({
    id: Date.now(),
    time: 'هم‌اکنون',
    type: 'admin',
    msg: `کاربر جدید با ایمیل ${newUser.email} توسط مدیر ایجاد شد.`
  });
  res.json({ ok: true, user: sanitizeUserForAdmin(newUser) });
});

app.post('/api/admin/password', (req, res) => {
  const newPassword = String(req.body?.newPassword || '');
  if (newPassword.length < 8 || newPassword.length > 128) {
    return res.status(400).json({ error: 'رمز عبور جدید باید بین ۸ تا ۱۲۸ کاراکتر باشد.' });
  }
  if (newPassword.toLowerCase() === ADMIN_EMAIL.toLowerCase()) {
    return res.status(400).json({ error: 'رمز عبور مدیر نمی‌تواند برابر با آدرس ایمیل باشد.' });
  }
  const adminUser = systemUsers.find(u => u.email.toLowerCase() === ADMIN_EMAIL.toLowerCase());
  if (adminUser) {
    adminUser.passwordHash = hashPasswordSync(newPassword);
    saveAuthSessionToDisk();
  }
  systemAuditLogs.unshift({
    id: Date.now(),
    time: 'هم‌اکنون',
    type: 'admin',
    msg: 'رمز عبور مدیر ارشد سامانه با موفقیت تغییر یافت.'
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
    baseCurrency: body.baseCurrency === 'usd' ? 'usd' : 'toman',
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

app.post('/api/admin/clear-cache', (req, res) => {
  cachedPrices.items = {};
  cachedPrices.updatedAt = 0;
  systemAuditLogs.unshift({
    id: Date.now(),
    time: 'هم‌اکنون',
    type: 'system',
    msg: 'حافظه موقت کش قیمت‌ها توسط مدیر تخلیه شد.'
  });
  res.json({ ok: true });
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

app.post('/api/auth/register/start', (req, res) => {
  if (!systemSettings.allowNewRegistrations) {
    return res.status(403).json({ error: 'ثبت‌نام کاربران جدید موقتاً توسط مدیریت غیرفعال شده است.' });
  }
  const ip = getClientIp(req);
  const { email, name, password } = req.body || {};
  if (!email || !name || !password) return res.status(400).json({ error: 'نام، ایمیل و رمز عبور را کامل وارد کنید.' });
  const normalizedEmail = String(email).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) || normalizedEmail.length > 120) {
    return res.status(400).json({ error: 'ایمیل معتبر نیست.' });
  }
  const cleanName = String(name).trim().slice(0, 80);
  const passStr = String(password);
  if (cleanName.length < 2) return res.status(400).json({ error: 'نام باید حداقل ۲ کاراکتر باشد.' });
  if (passStr.length < 8 || passStr.length > 128) return res.status(400).json({ error: 'رمز عبور باید حداقل ۸ کاراکتر باشد.' });
  if (normalizedEmail === ADMIN_EMAIL.toLowerCase() && passStr.toLowerCase() === ADMIN_EMAIL.toLowerCase()) {
    return res.status(400).json({ error: 'رمز عبور نمی‌تواند برابر با آدرس ایمیل باشد.' });
  }
  if (!checkRateLimit(`reg_start:${ip}:${normalizedEmail}`, 5, 900) || !checkRateLimit(`reg_ip:${ip}`, 15, 900)) {
    return res.status(429).json({ error: 'تعداد درخواست‌های ثبت‌نام بیش از حد مجاز است. کمی صبر کنید.' });
  }
  if (systemUsers.some(u => u.email.toLowerCase() === normalizedEmail)) {
    return res.status(409).json({ error: 'این ایمیل قبلاً ثبت شده است؛ وارد شوید.' });
  }

  const code = String(crypto.randomInt(100000, 1000000));
  pendingOtps[`register:${normalizedEmail}`] = {
    codeHash: sha256Hex(code),
    expires: Date.now() + 10 * 60 * 1000,
    attempts: 0,
    name: cleanName,
    passwordHash: hashPasswordSync(passStr)
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

app.post('/api/auth/register/verify', (req, res) => {
  const ip = getClientIp(req);
  const { email, code } = req.body || {};
  if (!email || !code) return res.status(400).json({ error: 'اطلاعات ناقص است.' });
  const normalizedEmail = String(email).trim().toLowerCase();
  const cleanCode = String(code).replace(/\D/g, '');
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
  if (cleanCode.length !== 6 || !safeEqualStr(sha256Hex(cleanCode), otpRec.codeHash)) {
    return res.status(400).json({ error: 'کد تأیید نادرست است.' });
  }

  delete pendingOtps[`register:${normalizedEmail}`];
  const isAdmin = normalizedEmail === ADMIN_EMAIL.toLowerCase();

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
      passwordHash: otpRec.passwordHash || hashPasswordSync(crypto.randomBytes(16).toString('hex'))
    };
    systemUsers.push(existing);
  }

  const sessionUser = createSessionForUser(res, req, existing);
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

app.post('/api/auth/reset/start', (req, res) => {
  const ip = getClientIp(req);
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: 'ایمیل را وارد کنید.' });
  const normalizedEmail = String(email).trim().toLowerCase();
  if (!checkRateLimit(`reset_start:${ip}:${normalizedEmail}`, 5, 900) || !checkRateLimit(`reset_ip:${ip}`, 15, 900)) {
    return res.status(429).json({ error: 'تعداد درخواست‌های بازیابی بیش از حد مجاز است. کمی صبر کنید.' });
  }
  const exists = systemUsers.some(u => u.email.toLowerCase() === normalizedEmail) || !!userStore[normalizedEmail];
  if (!exists) {
    return res.status(404).json({ error: 'user_not_found', message: 'این ایمیل در سامانه ثبت نشده است.' });
  }
  const code = String(crypto.randomInt(100000, 1000000));
  pendingOtps[`reset:${normalizedEmail}`] = {
    codeHash: sha256Hex(code),
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

app.post('/api/auth/reset/verify', (req, res) => {
  const ip = getClientIp(req);
  const { email, code } = req.body || {};
  if (!email || !code) return res.status(400).json({ error: 'اطلاعات ناقص است.' });
  const normalizedEmail = String(email).trim().toLowerCase();
  const cleanCode = String(code).replace(/\D/g, '');
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
  if (cleanCode.length !== 6 || !safeEqualStr(sha256Hex(cleanCode), otpRec.codeHash)) {
    return res.status(400).json({ error: 'کد تأیید نادرست است.' });
  }

  delete pendingOtps[`reset:${normalizedEmail}`];
  const rawResetToken = 'rst_' + crypto.randomBytes(24).toString('hex');
  pendingResets[normalizedEmail] = {
    tokenHash: sha256Hex(rawResetToken),
    expires: Date.now() + 10 * 60 * 1000
  };
  res.json({ ok: true, resetToken: rawResetToken });
});

app.post('/api/auth/reset/finish', (req, res) => {
  const ip = getClientIp(req);
  const { email, resetToken, password } = req.body || {};
  if (!email || !resetToken || !password) {
    return res.status(400).json({ error: 'اطلاعات بازیابی رمز عبور ناقص است.' });
  }
  const normalizedEmail = String(email).trim().toLowerCase();
  if (!checkRateLimit(`reset_finish:${ip}:${normalizedEmail}`, 5, 900)) {
    return res.status(429).json({ error: 'تعداد درخواست‌ها بیش از حد مجاز است.' });
  }
  const resetRec = pendingResets[normalizedEmail];
  if (!resetRec || resetRec.expires < Date.now() || !safeEqualStr(sha256Hex(String(resetToken)), resetRec.tokenHash)) {
    return res.status(400).json({ error: 'توکن بازیابی رمز عبور نامعتبر یا منقضی شده است.' });
  }

  const passStr = String(password);
  if (passStr.length < 8 || passStr.length > 128) {
    return res.status(400).json({ error: 'رمز عبور جدید باید حداقل ۸ کاراکتر باشد.' });
  }
  if (normalizedEmail === ADMIN_EMAIL.toLowerCase() && passStr.toLowerCase() === ADMIN_EMAIL.toLowerCase()) {
    return res.status(400).json({ error: 'رمز عبور مدیر نمی‌تواند برابر با آدرس ایمیل باشد.' });
  }

  delete pendingResets[normalizedEmail];
  const u = systemUsers.find(x => x.email.toLowerCase() === normalizedEmail);
  if (!u) {
    return res.status(404).json({ error: 'کاربر یافت نشد.' });
  }

  u.passwordHash = hashPasswordSync(passStr);
  revokeUserSessions(normalizedEmail);
  const sessionUser = createSessionForUser(res, req, u);
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

app.post('/api/auth/logout', (req, res) => {
  const rawToken = extractRawSessionToken(req);
  if (rawToken && rawToken.includes('.')) {
    const baseSid = rawToken.slice(0, rawToken.indexOf('.'));
    if (baseSid) {
      const sidHash = sha256Hex(baseSid);
      activeSessions.delete(sidHash);
      revokedSessions.add(sidHash);
    }
  }
  clearSessionCookie(res, req);
  res.json({ ok: true });
});

app.delete('/api/me', (req, res) => {
  const u = resolveReqUser(req);
  if (!u) {
    return res.status(401).json({ error: 'ابتدا وارد حساب کاربری خود شوید.' });
  }
  const email = u.email.toLowerCase();
  delete userStore[email];
  revokeUserSessions(email);
  const idx = systemUsers.findIndex(usr => usr.email.toLowerCase() === email && usr.email.toLowerCase() !== ADMIN_EMAIL.toLowerCase());
  if (idx !== -1) systemUsers.splice(idx, 1);
  saveAuthSessionToDisk();
  clearSessionCookie(res, req);
  res.json({ ok: true });
});

// Pre-populated mapping of official cryptocurrency logos
// Pre-populated mapping of official cryptocurrency logos
const CRYPTO_ICONS: Record<string, string> = {
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
  goat: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/solana/assets/CzLSujWBLFsSjncfkh59rUFqvafWcY5tzedWJSuypump/logo.png',
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
  fartcoin: 'https://bin.bnbstatic.com/static/assets/logos/FARTCOIN.png',
  grass: 'https://bin.bnbstatic.com/static/assets/logos/GRASS.png',
  hype: 'https://bin.bnbstatic.com/static/assets/logos/HYPE.png',
  pengu: 'https://bin.bnbstatic.com/static/assets/logos/PENGU.png',
  moodeng: 'https://bin.bnbstatic.com/static/assets/logos/MOODENG.png',
  pnut: 'https://bin.bnbstatic.com/static/assets/logos/PNUT.png',
  neiro: 'https://bin.bnbstatic.com/static/assets/logos/NEIRO.png',
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
  kcs: 'https://assets.coincap.io/assets/icons/kcs@2x.png',
  prom: 'https://bin.bnbstatic.com/static/assets/logos/PROM.png',
  rsr: 'https://assets.coincap.io/assets/icons/rsr@2x.png',
  gtc: 'https://assets.coincap.io/assets/icons/gtc@2x.png',
  lsk: 'https://assets.coincap.io/assets/icons/lsk@2x.png',
  sonic: 'https://cdn.arz.digital/cr-odin/img/assets/sonic/64x64.png'
};

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
  if (dynamicCryptoIconsCache && (now - dynamicCryptoIconsTime < 43200)) {
    return dynamicCryptoIconsCache;
  }
  if (dynamicCryptoIconsJob) return dynamicCryptoIconsJob;
  dynamicCryptoIconsJob = (async () => {
    const base: Record<string, string> = {};
    const [cmcRes, cpRes, cgRes] = await Promise.allSettled([
      fetchJsonQuick('https://api.coinmarketcap.com/data-api/v3/cryptocurrency/listing?start=1&limit=3500&sortBy=market_cap&sortType=desc&convert=USD', 6500),
      fetchJsonQuick('https://api.coinpaprika.com/v1/coins', 6500),
      fetchJsonQuick('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=1', 5500)
    ]);

    const cpMap: Record<string, string> = {};
    if (cpRes.status === 'fulfilled' && Array.isArray(cpRes.value)) {
      const sortedCp = cpRes.value
        .filter((c: any) => c && c.is_active !== false && c.id && c.symbol)
        .sort((a: any, b: any) => ((a.rank > 0 ? a.rank : 999999) - (b.rank > 0 ? b.rank : 999999)));
      for (const c of sortedCp) {
        const s = String(c.symbol).toLowerCase().trim();
        if (s && !cpMap[s]) cpMap[s] = `https://static.coinpaprika.com/coin/${c.id}/logo.png`;
      }
    }

    const cmcList = (cmcRes.status === 'fulfilled' && cmcRes.value?.data?.cryptoCurrencyList) || [];
    const cmcTop1500 = new Set<string>();
    for (let idx = 0; idx < cmcList.length; idx++) {
      const c = cmcList[idx];
      const s = String(c?.symbol || '').toLowerCase().trim();
      if (!s || !c?.id) continue;
      if (idx < 1500) cmcTop1500.add(s);
      if (!base[s]) base[s] = `https://s2.coinmarketcap.com/static/img/coins/64x64/${c.id}.png`;
    }

    if (cgRes.status === 'fulfilled' && Array.isArray(cgRes.value)) {
      const cgSeen = new Set<string>();
      for (const c of cgRes.value) {
        const s = String(c?.symbol || '').toLowerCase().trim();
        if (s && c?.image && !cgSeen.has(s)) {
          cgSeen.add(s);
          base[s] = c.image;
        }
      }
    }

    const activeKeys = new Set(Object.keys(cachedPrices?.items || {}).map(k => k.toLowerCase()));
    const out: Record<string, string> = {};
    for (const k of cmcTop1500) {
      if (base[k]) out[k] = base[k];
    }
    for (const k of activeKeys) {
      if (base[k]) out[k] = base[k];
      else if (cpMap[k]) out[k] = cpMap[k];
    }
    Object.assign(out, CRYPTO_ICONS);

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
    res.setHeader('Cache-Control', 'public, max-age=43200');
    res.json({ ok: true, icons });
  } catch {
    res.setHeader('Cache-Control', 'public, max-age=3600');
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
      rec.updatedAt = Math.floor(Date.now() / 1000);
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

app.get('/api/me/data', (req, res) => {
  const u = resolveReqUser(req);
  if (!u) {
    return res.status(401).json({ error: 'ابتدا وارد حساب کاربری خود شوید.' });
  }
  const email = u.email.toLowerCase();
  const target = userStore[email];
  if (target?.data?.alerts) {
    if (evaluateAlertsForRecord(target.data.alerts, email)) {
      target.updatedAt = Math.floor(Date.now() / 1000);
      target.revision = (Number(target.revision) || 1) + 1;
      saveAuthSessionToDisk();
    }
  }
  res.json(target || {
    exists: false,
    revision: 0,
    updatedAt: 0,
    data: {
      holdings: [],
      watch: [],
      featured: ['usd', 'gold18', 'btc', 'usdt', 'eur', 'sol'],
      alerts: [],
      settings: {}
    }
  });
});

app.put('/api/me/data', (req, res) => {
  const u = resolveReqUser(req);
  if (!u) {
    return res.status(401).json({ error: 'ابتدا وارد حساب کاربری خود شوید.' });
  }
  const body = req.body || {};
  if (Array.isArray(body.holdings)) {
    for (const h of body.holdings) {
      if (!h || !/^[a-z0-9]{1,20}$/.test(String(h.assetId || '')) || !(Number(h.qty) > 0) || !Number.isFinite(Number(h.qty)) || !(Number(h.buyPrice) >= 0) || !Number.isFinite(Number(h.buyPrice))) {
        return res.status(400).json({ error: 'اطلاعات معامله نامعتبر است (مقدار باید مثبت و معتبر باشد).' });
      }
    }
  }
  const email = u.email.toLowerCase();
  const prevRec = userStore[email];
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
    exists: true,
    revision: nextRev,
    updatedAt: Math.floor(Date.now() / 1000),
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

app.post('/api/me/alerts/:id/retry', (req, res) => {
  const u = resolveReqUser(req);
  if (!u) {
    return res.status(401).json({ error: 'ابتدا وارد حساب کاربری خود شوید.' });
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
    target.updatedAt = Math.floor(Date.now() / 1000);
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
    background_color: '#ffffff',
    theme_color: '#ffffff',
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

// Serve root PWA HTML directly with anti-cache & CSP headers
app.get(['/', '/index.html'], (req, res) => {
  const htmlPath = path.join(__dirname, 'src', 'index.html');
  if (fs.existsSync(htmlPath)) {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Surrogate-Control', 'no-store');
    const frameAncestors = isPreviewRequest(req)
      ? "frame-ancestors 'self' https://aistudio.google.com https://*.aistudio.google.com https://*.googleusercontent.com https://*.google.com;"
      : "frame-ancestors 'self';";
    res.setHeader(
      'Content-Security-Policy',
      `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: blob: https:; worker-src 'self' blob:; connect-src 'self' https: wss:; ${frameAncestors} base-uri 'self'; form-action 'self'`
    );
    return res.sendFile(htmlPath);
  }
  return res.status(404).send('HTML not found.');
});

// Serve public static files only (never expose /src directory)
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
});
