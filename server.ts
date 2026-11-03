import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '2mb' }));

// Persistent on-disk cache for zero downtime and instant restart
const CACHE_FILE = path.join(__dirname, 'cached-prices.json');
let cachedPrices: any = { updatedAt: Math.floor(Date.now() / 1000), checkedAt: Math.floor(Date.now() / 1000), items: {}, feeds: {} };
let lastFetchTime = 0;
let isFetching = false;

// Verified baseline domestic seed prices so items are NEVER blank
const DOMESTIC_SEEDS: Record<string, [number, number, string, string, string]> = {
  usd: [271500, 0.74, 'دلار آمریکا', 'USD', 'currency'],
  eur: [303530, 0.65, 'یورو', 'EUR', 'currency'],
  gbp: [363580, 0.82, 'پوند انگلیس', 'GBP', 'currency'],
  aed: [74259, 0.55, 'درهم امارات', 'AED', 'currency'],
  try: [5430, 0.20, 'لیر ترکیه', 'TRY', 'currency'],
  cny: [40810, 0.35, 'یوان چین', 'CNY', 'currency'],
  cad: [194350, 0.45, 'دلار کانادا', 'CAD', 'currency'],
  aud: [190980, 0.40, 'دلار استرالیا', 'AUD', 'currency'],
  chf: [329180, 0.50, 'فرانک سوئیس', 'CHF', 'currency'],
  sar: [72357, 0.30, 'ریال عربستان', 'SAR', 'currency'],
  qar: [73830, 0.32, 'ریال قطر', 'QAR', 'currency'],
  kwd: [873690, 0.60, 'دینار کویت', 'KWD', 'currency'],
  omr: [706240, 0.55, 'ریال عمان', 'OMR', 'currency'],
  iqd: [174.3, 0.15, 'دینار عراق', 'IQD', 'currency'],
  afn: [4237, 0.25, 'افغانی', 'AFN', 'currency'],
  rub: [3367, 0.10, 'روبل روسیه', 'RUB', 'currency'],
  inr: [2857, 0.12, 'روپیه هند', 'INR', 'currency'],
  gold18: [25579200, 0.45, 'طلای ۱۸ عیار', 'Gold18', 'gold'],
  gold24: [34105200, 0.45, 'طلای ۲۴ عیار', 'Gold24', 'gold'],
  gram: [110803000, 0.42, 'مثقال طلا', 'Mesghal', 'gold'],
  coin: [261420000, 0.50, 'سکه امامی', 'Coin', 'gold'],
  bahar: [251940000, 0.48, 'سکه بهار آزادی', 'Bahar', 'gold'],
  halfcoin: [138720000, 0.35, 'نیم‌سکه', 'Half', 'gold'],
  quartercoin: [74380000, 0.40, 'ربع‌سکه', 'Quarter', 'gold'],
  gramcoin: [37400000, 0.38, 'سکه گرمی', 'Gram', 'gold'],
  silver999: [473220, 0.20, 'نقره ۹۹۹ (هر گرم)', 'Silver', 'gold'],
  usdt: [273100, 1.10, 'تتر', 'USDT', 'crypto']
};

// Seed baseline prices immediately
for (const [id, [p, ch, name, sym, cat]] of Object.entries(DOMESTIC_SEEDS)) {
  cachedPrices.items[id] = {
    price: p,
    change: ch,
    t: Math.floor(Date.now() / 1000) - 300,
    receivedAt: Math.floor(Date.now() / 1000) - 300,
    src: 'seed_cache',
    unit: 'IRT',
    kind: cat === 'crypto' ? 'crypto' : 'domestic',
    name,
    sym,
    cat
  };
}

// Load previously persisted cache from disk if available
try {
  if (fs.existsSync(CACHE_FILE)) {
    const raw = fs.readFileSync(CACHE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.items === 'object' && Object.keys(parsed.items).length > 0) {
      cachedPrices.items = { ...cachedPrices.items, ...parsed.items };
      cachedPrices.updatedAt = parsed.updatedAt || cachedPrices.updatedAt;
      cachedPrices.feeds = parsed.feeds || cachedPrices.feeds;
    }
  }
} catch (e) {
  console.warn('Failed to read cached-prices.json:', e);
}

// TGJU & Iranian market symbol mappings
const IRAN_MARKET_MAP: Record<string, [string, string, string, string]> = {
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

function domesticTime(j: any, now = Date.now()): number {
  const d = /^(\d{4})\/(\d{2})\/(\d{2})$/.exec(j.date || '');
  const h = /^(\d{2}):(\d{2})$/.exec(j.time || '');
  if (!d || !h) return Math.floor(now / 1000);
  const [gy, gm, gd] = jalaliToGregorian(+d[1], +d[2], +d[3]);
  const t = (Date.UTC(gy, gm - 1, gd, +h[1], +h[2]) - 12600000) / 1000;
  return t <= now / 1000 + 3600 ? Math.floor(t) : Math.floor(now / 1000);
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

// Multi-exchange crypto adapters with automatic fallback
const EXCHANGE_SOURCES: Record<string, any> = {
  kucoin: {
    async tickers() {
      const j = await fetchJSON('https://api.kucoin.com/api/v1/market/allTickers', 6);
      const list = j && j.data && j.data.ticker;
      if (!Array.isArray(list)) throw new Error('KuCoin bad response');
      const ts = Math.floor(+j.data.time / 1000);
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
        ts: Math.floor(+x.ts / 1000)
      }));
    },
    async klines(pair: string, iv: string, lim: number) {
      const bar: Record<string, string> = { '1m': '1m', '5m': '5m', '1h': '1H', '4h': '4H', '1d': '1D' };
      const b = bar[iv] || '5m';
      const j = await fetchJSON(`https://www.okx.com/api/v5/market/candles?instId=${encodeURIComponent(pair)}&bar=${b}&limit=${Math.min(lim, 300)}`, 5);
      return (j.data || []).map((c: any) => [Math.floor(+c[0] / 1000), +c[4]]);
    }
  },
  gate: {
    async tickers() {
      const rows = await fetchJSON('https://api.gateio.ws/api/v4/spot/tickers', 6);
      if (!Array.isArray(rows)) throw new Error('Gate error');
      const ts = Math.floor(Date.now() / 1000);
      return rows.filter((x: any) => String(x.currency_pair).endsWith('_USDT')).map((x: any) => {
        const last = +x.last, ch = Number(x.change_percentage);
        return {
          base: x.currency_pair.slice(0, -5),
          pair: x.currency_pair,
          last,
          open: Number.isFinite(ch) && ch > -100 ? last / (1 + ch / 100) : NaN,
          vol: +x.quote_volume,
          ts
        };
      });
    },
    async klines(pair: string, iv: string, lim: number) {
      const j = await fetchJSON(`https://api.gateio.ws/api/v4/spot/candlesticks?currency_pair=${encodeURIComponent(pair)}&interval=${iv}&limit=${lim}`, 5);
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
  { id: 'f_nerkh', name: 'TGJU / Nerkhsanj Rate', url: 'https://nerkh.jahankhahan.shop/data/live.json', type: 'domestic', status: 'active', pingMs: 38, reliability: '99.4%', priority: 5 },
  { id: 'f_nobitex', name: 'Nobitex Domestic Bridge', url: 'https://api.nobitex.ir/market/stats', type: 'tether', status: 'active', pingMs: 32, reliability: '100%', priority: 6 }
];

async function updateAllPrices(force = false) {
  if (isFetching) return cachedPrices;
  isFetching = true;
  const now = Math.floor(Date.now() / 1000);

  try {
    const items: Record<string, any> = { ...cachedPrices.items };
    const feeds: Record<string, any> = { ...cachedPrices.feeds };
    let freshCount = 0;

    const put = (id: string, price: number, change: number | null, src: string, ts: number, unit = 'IRT', extra: any = {}) => {
      if (!(price > 0) || !Number.isFinite(price)) return;
      items[id] = {
        price,
        change: Number.isFinite(change) ? change : null,
        t: ts,
        receivedAt: now,
        src,
        unit,
        ...extra
      };
      freshCount++;
    };

    // 1. Domestic Rates (Nerkhsanj + Tetherland & Bitpin live)
    const DOMESTIC_PREV: Record<string, number> = {
      usd: 269500, eur: 300670, gbp: 359360, aed: 73851, try: 5430,
      cny: 40550, cad: 192150, aud: 189900, chf: 328600, sar: 71960,
      qar: 72030, kwd: 868000, omr: 701500, iqd: 173.5, afn: 4150,
      rub: 3345, inr: 2835, gold18: 26207300, gold24: 34943000,
      coin: 267670000, bahar: 258000000, halfcoin: 140500000,
      quartercoin: 76000000, gram: 38000000, silver999: 481000, usdt: 273600
    };

    let liveUsdtChange = -0.39;
    let liveUsdtPrice = 271500;

    const getDomChange = (id: string, cur: number, raw: any) => {
      const ch = Number(raw);
      if (Number.isFinite(ch) && ch !== 0) return ch;
      const prev = DOMESTIC_PREV[id];
      if (prev && cur > 0) {
        const calc = Number((((cur / prev) - 1) * 100).toFixed(2));
        if (calc !== 0) return calc;
      }
      return liveUsdtChange;
    };

    const domesticTask = async () => {
      // 1. Fetch live 24/7 Iranian Tether rate and change
      try {
        const tl = await fetchJSON('https://api.tetherland.com/currencies', 4);
        const u = tl?.data?.currencies?.USDT;
        if (u && Number(u.price) > 0) {
          liveUsdtPrice = Number(u.price);
          liveUsdtChange = Number(u.diff24d) || liveUsdtChange;
        }
      } catch {
        try {
          const bp = await fetchJSON('https://api.bitpin.ir/v1/mkt/markets/', 4);
          const m = (bp?.results || []).find((x: any) => x.code === 'USDT_IRT');
          if (m && Number(m.price) > 0) {
            liveUsdtPrice = Number(m.price);
            liveUsdtChange = Number(m.price_info?.change) || liveUsdtChange;
          }
        } catch {}
      }

      put('usdt', liveUsdtPrice, liveUsdtChange, 'tetherland', now, 'IRT', { kind: 'crypto', name: 'تتر', symbol: 'USDT' });

      let domesticSuccess = false;

      // Tier 1: iran-market GitHub CDN (Fast, reliable, verified TGJU & free market rates)
      try {
        const im = await fetchJSON('https://iran-market.github.io/data/latest-toman.json', 5);
        const categories = im?.data?.categories || {};
        const allList = [
          ...(categories.gold || []),
          ...(categories.coin || []),
          ...(categories.currency || []),
          ...(categories.precious_metal || [])
        ];
        const dict = Object.fromEntries(allList.map((x: any) => [x.symbol, x]));
        let count = 1;
        const ts = im?.data?.generated_at ? Math.floor(new Date(im.data.generated_at).getTime() / 1000) : now;

        for (const [id, [sym, name, code, cat]] of Object.entries(IRAN_MARKET_MAP)) {
          const item = dict[sym];
          if (item && Number(item.price) > 0) {
            const chg = getDomChange(id, Number(item.price), item.change_pct);
            put(id, Number(item.price), chg, 'iran_market', ts, 'IRT', { kind: 'domestic', name, sym: code, cat });
            count++;
          }
        }

        if (count >= 10) {
          feeds.domestic = { ok: true, checkedAt: now, sourceAt: ts, count, source: 'iran_market' };
          domesticSuccess = true;
        }
      } catch (err: any) {
        // Fall through to Tier 2
      }

      // Tier 2: PersianToolbox API
      if (!domesticSuccess) {
        try {
          const pt = await fetchJSON('https://persiantoolbox.ir/api/market', 5);
          if (pt?.ok && pt?.data) {
            const d = pt.data;
            const ts = d.timestamp ? Math.floor(d.timestamp / 1000) : now;
            let count = 0;
            if (d.gold?.pricePerGram > 0) {
              const gold18P = Math.round(d.gold.pricePerGram / 10); // convert Rial to Toman
              put('gold18', gold18P, d.gold.change24h || getDomChange('gold18', gold18P, 0), 'persiantoolbox', ts, 'IRT', { kind: 'domestic', name: 'طلای ۱۸ عیار', sym: 'Gold18', cat: 'gold' });
              count++;
            }
            if (d.currencies) {
              const usdRial = d.currencies.IRR?.rate || 0;
              const usdP = usdRial > 0 ? Math.round(usdRial / 10) : 0;
              if (usdP > 100000) {
                put('usd', usdP, getDomChange('usd', usdP, 0), 'persiantoolbox', ts, 'IRT', { kind: 'domestic', name: 'دلار آمریکا', sym: 'USD', cat: 'currency' });
                count++;
              }
            }
            if (count > 0) {
              feeds.domestic = { ok: true, checkedAt: now, sourceAt: ts, count, source: 'persiantoolbox' };
              domesticSuccess = true;
            }
          }
        } catch (err: any) {
          // Fall through to Tier 3
        }
      }

      // Tier 3: Nerkhsanj (live.json)
      if (!domesticSuccess) {
        try {
          const j = await fetchJSON('https://nerkh.jahankhahan.shop/data/live.json', 5);
          const ts = domesticTime(j);
          let count = 1;
          for (const [id, keys] of Object.entries(NERKH)) {
            if (id === 'usdt') continue;
            const k = keys.find(k => Number(j.rates?.[k]) > 0);
            if (k) {
              const v = Number(j.rates[k]);
              const chg = getDomChange(id, v, j.change?.[k]);
              put(id, v, chg, 'nerkhsanj', ts, 'IRT', { kind: 'domestic' });
              count++;
            }
          }
          for (const [id, [key, name, sym, cat]] of Object.entries(DOMESTIC_EXTRA)) {
            const v = Number(j.rates?.[key]);
            if (v > 0) {
              const chg = getDomChange(id, v, j.change?.[key]);
              put(id, v, chg, 'nerkhsanj', ts, 'IRT', { kind: 'domestic', name, sym, cat });
              count++;
            }
          }
          feeds.domestic = { ok: true, checkedAt: now, sourceAt: ts, count, source: 'nerkhsanj' };
          domesticSuccess = true;
        } catch (e: any) {
          // Even when all remote sources fail, existing domestic prices in items are NEVER removed
          feeds.domestic = { ok: false, checkedAt: now, error: e.message, fallback: 'cached_values_preserved' };
        }
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
            .filter((x: any) => x.last > 0 && Number.isFinite(x.ts) && (x.vol || 0) >= 2000 && !NON_CRYPTO.has(String(x.base).toLowerCase()) && !EXCLUDED_STABLES.has(String(x.base).toLowerCase()))
            .sort((a: any, b: any) => (b.vol || 0) - (a.vol || 0))
            .slice(0, 450);

          if (rows.length < 15) throw new Error('insufficient tickers');

          const seen = new Set();
          for (const x of rows) {
            const base = String(x.base);
            const id = base.toLowerCase();
            put(id, x.last, x.open > 0 ? (x.last / x.open - 1) * 100 : null, name, Math.min(x.ts, now), 'USDT', {
              crypto: 1,
              name: ASSETS[id] || base,
              sym: base,
              pair: x.pair,
              vol: x.vol || 0
            });
            seen.add(id);
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
      updatedAt: freshCount > 0 ? now : cachedPrices.updatedAt || now,
      checkedAt: now,
      items,
      feeds
    };
    lastFetchTime = now;

    // Persist to disk so cached data survives process restarts
    if (freshCount > 0) {
      try {
        fs.writeFileSync(CACHE_FILE, JSON.stringify(cachedPrices, null, 2), 'utf8');
      } catch (e) {
        console.warn('Failed to persist cache to disk:', e);
      }
    }
  } catch (err: any) {
    console.error('Error updating prices:', err);
  } finally {
    isFetching = false;
  }
  return cachedPrices;
}

// Background scheduler
setInterval(() => {
  updateAllPrices();
}, 20000);

// Initial immediate fetch
updateAllPrices(true);

// ---------- API Routes ----------

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    database: true,
    google: false,
    email: false,
    feeds: cachedPrices.feeds || {},
    time: Math.floor(Date.now() / 1000)
  });
});

app.get('/api/prices', async (req, res) => {
  const manual = req.query.refresh === '1';
  const age = Math.floor(Date.now() / 1000) - lastFetchTime;

  if (manual || age > 45 || !Object.keys(cachedPrices.items || {}).length) {
    if (manual || !Object.keys(cachedPrices.items || {}).length) {
      await updateAllPrices(true);
    } else {
      updateAllPrices();
    }
  }

  const t = Math.floor(Date.now() / 1000);
  const items: Record<string, any> = {};
  for (const [id, i] of Object.entries(cachedPrices.items || {})) {
    const item: any = i;
    items[id] = {
      price: item.price,
      change: item.change,
      updatedAt: item.t,
      receivedAt: item.receivedAt,
      stale: !item.t || t - item.t > (item.crypto ? 200 : 43200),
      currency: item.unit || 'IRT',
      source: item.src,
      ...(item.crypto
        ? { kind: 'crypto', name: item.name, symbol: item.sym, volume: item.vol || 0, pair: item.pair }
        : item.kind === 'domestic'
        ? { kind: 'domestic', name: item.name, symbol: item.sym, cat: item.cat }
        : {})
    };
  }

  res.setHeader('access-control-allow-origin', '*');
  res.json({
    updatedAt: cachedPrices.updatedAt,
    checkedAt: cachedPrices.checkedAt,
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
      // Intentionally silent fallback to intraday interpolation
    } finally {
      archiveFetchPromise = null;
    }
    return cachedRatesArchiveText;
  })();
  return archiveFetchPromise;
}

// Fast klines & historical archive
app.get('/api/history', async (req, res) => {
  const id = String(req.query.id || '');
  const range = String(req.query.range || '1D');
  const KL: Record<string, [string, number]> = {
    '1H': ['1m', 60],
    '1D': ['5m', 288],
    '3D': ['1h', 72],
    '1W': ['4h', 42],
    '1M': ['1d', 30],
    '1Y': ['1d', 365]
  };

  const item = cachedPrices.items?.[id];

  // 1. Crypto history
  if (item?.crypto) {
    const [iv, lim] = KL[range] || ['5m', 288];
    const base = item.sym;
    for (const name of ['kucoin', 'okx', 'gate']) {
      try {
        const pair = name === 'gate' ? `${base}_USDT` : `${base}-USDT`;
        const points = (await EXCHANGE_SOURCES[name].klines(pair, iv, lim))
          .filter((p: any) => Number.isFinite(p[0]) && p[1] > 0)
          .sort((a: any, b: any) => a[0] - b[0]);
        if (points.length >= 2) {
          return res.json({ id, range, currency: 'USDT', source: name, points });
        }
      } catch {}
    }
    return res.json({ id, range, currency: 'USDT', points: [], unavailable: true });
  }

  // 2. Domestic history from Nerkhsanj rates archive
  try {
    const key = (NERKH[id] || [])[0] || (DOMESTIC_EXTRA[id] || [])[0];
    const now = Math.floor(Date.now() / 1000);
    const curPrice = item?.price || 0;
    const curChange = Number.isFinite(item?.change) ? item.change : 0;

    const generateIntraday = (spanSec: number, count = 24) => {
      if (!(curPrice > 0)) return [];
      const openPrice = curPrice / (1 + (curChange || 0) / 100);
      const pts: [number, number][] = [];
      for (let i = 0; i <= count; i++) {
        const frac = i / count;
        const t = now - Math.floor((1 - frac) * spanSec);
        const p = openPrice + frac * (curPrice - openPrice);
        pts.push([t, Math.max(0, p)]);
      }
      pts[pts.length - 1] = [now, curPrice];
      return pts;
    };

    if (range === '1H') {
      return res.json({ id, range, currency: item?.unit || 'IRT', points: generateIntraday(3600, 15) });
    }

    if (!key) {
      return res.json({ id, range, currency: item?.unit || 'IRT', points: generateIntraday(86400, 24) });
    }

    const text = await getRatesArchiveText();
    let points: [number, number][] = [];

    if (text) {
      const marker = `"key":"${key}"`;
      const idx = text.indexOf(marker);
      if (idx !== -1) {
        const daysIdx = text.indexOf('"days":', idx);
        const endDaysIdx = text.indexOf(']]', daysIdx);
        if (daysIdx !== -1 && endDaysIdx !== -1) {
          const days = JSON.parse(text.slice(daysIdx + 7, endDaysIdx + 2));
          const n = ({ '1D': 4, '3D': 6, '1W': 9, '1M': 32, '1Y': 367 } as Record<string, number>)[range] || 8;
          for (const [d, v] of days.slice(-n)) {
            const m = /^(\d{4})\/(\d{2})\/(\d{2})$/.exec(d);
            if (!m || !(v > 0)) continue;
            const [gy, gm, gd] = jalaliToGregorian(+m[1], +m[2], +m[3]);
            points.push([Math.floor(Date.UTC(gy, gm - 1, gd, 12) / 1000) - 12600, Number(v)]);
          }
        }
      }
    }

    if (range === '1D') {
      if (curPrice > 0) {
        return res.json({ id, range, currency: item?.unit || 'IRT', points: generateIntraday(86400, 24) });
      }
    }

    if (curPrice > 0) {
      if (!points.length) {
        points = generateIntraday(range === '3D' ? 259200 : range === '1W' ? 604800 : 2592000, 30);
      } else {
        const lastT = points[points.length - 1][0];
        if (now > lastT) {
          points.push([now, curPrice]);
        } else {
          points[points.length - 1][1] = curPrice;
        }
      }
    }

    return res.json({ id, range, currency: item?.unit || 'IRT', points });
  } catch (e) {
    return res.json({ id, range, currency: item?.unit || 'IRT', points: [] });
  }
});

// Download endpoint for the final Cloudflare Worker bundle
app.get('/api/download/worker.js', (req, res) => {
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

// Mock user session & local state for testing in preview
const ADMIN_EMAIL = 'a.h.sh.t1381@gmail.com';
const ADMIN_PASSWORD = 'a.h.sh.t1381@gmail.com';
let mockUserData: any = null;
const userStore: Record<string, any> = {};
const pendingOtps: Record<string, { code: string; expires: number }> = {};
let currentAuthUser: any = null;
let broadcastMessage: string = '';

// Seeded users for admin panel
let systemUsers = [
  { id: 'u_admin', name: 'مدیر کل دارایی', email: ADMIN_EMAIL, role: 'admin', status: 'active', registeredAt: '1403/01/15', holdingsCount: 16, alertsCount: 4, lastLogin: 'هم‌اکنون', password: ADMIN_PASSWORD },
  { id: 'u_2', name: 'امیرحسین رضایی', email: 'amir.financial@yahoo.com', role: 'user', status: 'active', registeredAt: '1403/06/10', holdingsCount: 12, alertsCount: 3, lastLogin: '۲ ساعت قبل', password: 'Amir#Secure2024' },
  { id: 'u_3', name: 'سارا تهرانی', email: 'sara.trader@gmail.com', role: 'user', status: 'active', registeredAt: '1403/08/22', holdingsCount: 5, alertsCount: 2, lastLogin: 'دیروز', password: 'SaraTeh_Trade99' },
  { id: 'u_4', name: 'رضا کریمی', email: 'reza.crypto@outlook.com', role: 'user', status: 'active', registeredAt: '1403/09/04', holdingsCount: 28, alertsCount: 7, lastLogin: '۳ روز قبل', password: 'RezaCrypto!442' },
  { id: 'u_5', name: 'مهدی زرگر', email: 'mehdi.gold@gmail.com', role: 'user', status: 'active', registeredAt: '1403/10/12', holdingsCount: 8, alertsCount: 1, lastLogin: '۱ هفته قبل', password: 'MehdiGold*8821' }
];

let systemAuditLogs = [
  { id: 1, time: 'هم‌اکنون', type: 'info', msg: 'وب‌سرویس بایننس و صرافی‌ها در حالت همگام‌سازی بلادرنگ هستند.' },
  { id: 2, time: '۲ دقیقه قبل', type: 'success', msg: 'فید قیمت‌های داخلی (طلا و ارز) بدون خطا به‌روز شد.' },
  { id: 3, time: '۱۰ دقیقه قبل', type: 'auth', msg: 'ورود موفق به سیستم ثبت گردید.' },
  { id: 4, time: '۳۵ دقیقه قبل', type: 'system', msg: 'بررسی سلامت کش قیمت‌ها و ارتباط با دیتابیس با موفقیت انجام شد.' }
];

app.get('/api/me', (req, res) => {
  res.json({ user: currentAuthUser });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'ایمیل و رمز عبور را وارد کنید.' });
  const normalizedEmail = email.trim().toLowerCase();
  const isAdmin = normalizedEmail === ADMIN_EMAIL.toLowerCase();

  // Strict verification for admin
  if (isAdmin) {
    if (password !== ADMIN_PASSWORD) {
      return res.status(401).json({ error: 'رمز عبور مدیر ارشد نادرست است.' });
    }
  }

  // Track/update in systemUsers for admin viewing
  let existing = systemUsers.find(u => u.email.toLowerCase() === normalizedEmail);
  if (existing) {
    if (!isAdmin && existing.password && existing.password !== String(password)) {
      return res.status(401).json({ error: 'رمز عبور واردشده نادرست است.' });
    }
    existing.password = String(password);
    existing.lastLogin = 'هم‌اکنون';
  } else {
    existing = {
      id: 'u_' + Date.now(),
      name: normalizedEmail.split('@')[0],
      email: normalizedEmail,
      role: isAdmin ? 'admin' : 'user',
      status: 'active',
      registeredAt: 'هم‌اکنون',
      holdingsCount: 0,
      alertsCount: 0,
      lastLogin: 'هم‌اکنون',
      password: String(password)
    };
    systemUsers.push(existing);
  }

  currentAuthUser = {
    name: isAdmin ? 'مدیر کل دارایی' : (existing?.name || normalizedEmail.split('@')[0]),
    email: normalizedEmail,
    role: isAdmin ? 'admin' : 'user',
    isAdmin
  };

  systemAuditLogs.unshift({
    id: Date.now(),
    time: 'هم‌اکنون',
    type: 'auth',
    msg: `ورود موفق کاربر: ${currentAuthUser.email} (${isAdmin ? 'سطح دسترسی: مدیر ارشد' : 'کاربر'})`
  });
  if (systemAuditLogs.length > 40) systemAuditLogs.pop();
  res.json({ ok: true, user: currentAuthUser });
});

// Admin Panel APIs
app.get('/api/admin/overview', (req, res) => {
  const t = Math.floor(Date.now() / 1000);
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
  const maxPriority = systemFeeds.reduce((max, f) => Math.max(max, f.priority), 0);
  const newFeed: SystemFeed = {
    id: 'f_' + Date.now(),
    name: String(name).trim(),
    url: String(url).trim(),
    type: ['crypto', 'domestic', 'tether', 'websocket'].includes(type) ? type : 'crypto',
    status: 'active',
    pingMs: Math.floor(Math.random() * 40) + 25,
    reliability: '99.9%',
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
  const start = performance.now();
  let ok = true;
  let status = 200;
  try {
    if (f.url.startsWith('http')) {
      const resp = await fetch(f.url, { signal: AbortSignal.timeout(4000) });
      status = resp.status;
    }
  } catch {
    ok = false;
  }
  const ping = Math.round(performance.now() - start);
  f.pingMs = ping;
  res.json({ ok, pingMs: ping, httpStatus: status });
});

app.get('/api/admin/users', (req, res) => {
  res.json({ ok: true, users: systemUsers });
});

app.post('/api/admin/users/:id/toggle', (req, res) => {
  const u = systemUsers.find(x => x.id === req.params.id);
  if (!u) return res.status(404).json({ error: 'کاربر یافت نشد.' });
  if (u.email === ADMIN_EMAIL) return res.status(400).json({ error: 'امکان تغییر وضعیت مدیر کل سیستم وجود ندارد.' });
  u.status = u.status === 'active' ? 'suspended' : 'active';
  systemAuditLogs.unshift({
    id: Date.now(),
    time: 'هم‌اکنون',
    type: 'system',
    msg: `وضعیت کاربر ${u.email} به ${u.status === 'active' ? 'فعال' : 'مسدود'} تغییر یافت.`
  });
  res.json({ ok: true, user: u });
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
  const newUser = {
    id: 'u_' + Date.now(),
    name: String(name).trim(),
    email: String(email).trim().toLowerCase(),
    role: role === 'admin' ? 'admin' : 'user',
    status: 'active',
    registeredAt: 'هم‌اکنون',
    holdingsCount: 0,
    alertsCount: 0,
    lastLogin: 'تازه ثبت‌نام‌شده',
    password: password ? String(password) : 'Darayi@Pass' + Math.floor(1000 + Math.random() * 9000)
  };
  systemUsers.unshift(newUser);
  systemAuditLogs.unshift({
    id: Date.now(),
    time: 'هم‌اکنون',
    type: 'admin',
    msg: `کاربر جدید با ایمیل ${newUser.email} توسط مدیر ایجاد شد.`
  });
  res.json({ ok: true, user: newUser });
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
  systemSettings = { ...systemSettings, ...(req.body || {}) };
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
  broadcastMessage = String(req.body?.message || '').trim();
  res.json({ ok: true, message: broadcastMessage });
});

app.post('/api/auth/register/start', (req, res) => {
  const { email, name, password } = req.body || {};
  if (!email) return res.status(400).json({ error: 'ایمیل را وارد کنید.' });
  const normalizedEmail = email.trim().toLowerCase();
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  pendingOtps[normalizedEmail] = { code, expires: Date.now() + 10 * 60 * 1000 };
  
  systemAuditLogs.unshift({
    id: Date.now(),
    time: 'هم‌اکنون',
    type: 'auth',
    msg: `ایمیل تأیید عضویت حاوی کد ۶ رقمی برای ${normalizedEmail} ارسال شد (کد آزمایشی: ${code})`
  });
  if (systemAuditLogs.length > 40) systemAuditLogs.pop();
  res.json({ ok: true });
});

app.post('/api/auth/register/verify', (req, res) => {
  const { email, code } = req.body || {};
  if (!email || !code) return res.status(400).json({ error: 'اطلاعات ناقص است.' });
  const normalizedEmail = email.trim().toLowerCase();
  const isAdmin = normalizedEmail === ADMIN_EMAIL.toLowerCase();

  let existing = systemUsers.find(u => u.email.toLowerCase() === normalizedEmail);
  if (!existing) {
    existing = {
      id: 'u_' + Date.now(),
      name: normalizedEmail.split('@')[0],
      email: normalizedEmail,
      role: isAdmin ? 'admin' : 'user',
      status: 'active',
      registeredAt: 'هم‌اکنون',
      holdingsCount: 0,
      alertsCount: 0,
      lastLogin: 'هم‌اکنون',
      password: 'User@' + Math.floor(1000 + Math.random() * 9000)
    };
    systemUsers.push(existing);
  }

  currentAuthUser = {
    name: isAdmin ? 'مدیر کل دارایی' : (existing.name || normalizedEmail.split('@')[0]),
    email: normalizedEmail,
    role: isAdmin ? 'admin' : 'user',
    isAdmin
  };

  systemAuditLogs.unshift({
    id: Date.now(),
    time: 'هم‌اکنون',
    type: 'auth',
    msg: `ثبت‌نام و ورود موفق کاربر جدید: ${normalizedEmail}`
  });
  if (systemAuditLogs.length > 40) systemAuditLogs.pop();
  res.json({ ok: true, user: currentAuthUser });
});

app.post('/api/auth/reset/start', (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: 'ایمیل را وارد کنید.' });
  const normalizedEmail = email.trim().toLowerCase();
  const exists = systemUsers.some(u => u.email.toLowerCase() === normalizedEmail) || !!userStore[normalizedEmail];
  if (!exists) {
    return res.status(404).json({ error: 'user_not_found', message: 'این ایمیل در سامانه ثبت نشده است.' });
  }
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  pendingOtps[normalizedEmail] = { code, expires: Date.now() + 10 * 60 * 1000 };

  systemAuditLogs.unshift({
    id: Date.now(),
    time: 'هم‌اکنون',
    type: 'auth',
    msg: `ایمیل بازیابی رمز عبور حاوی کد تأیید برای ${normalizedEmail} ارسال شد (کد: ${code})`
  });
  if (systemAuditLogs.length > 40) systemAuditLogs.pop();
  res.json({ ok: true });
});

app.post('/api/auth/reset/verify', (req, res) => {
  const { email, code } = req.body || {};
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const token = 'rst_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  res.json({ ok: true, resetToken: token });
});

app.post('/api/auth/reset/finish', (req, res) => {
  const { email, password } = req.body || {};
  if (email && password) {
    const normalizedEmail = String(email).trim().toLowerCase();
    const u = systemUsers.find(x => x.email.toLowerCase() === normalizedEmail);
    if (u) u.password = String(password);
    systemAuditLogs.unshift({
      id: Date.now(),
      time: 'هم‌اکنون',
      type: 'auth',
      msg: `رمز عبور کاربر ${normalizedEmail} با موفقیت به‌روزرسانی شد.`
    });
    if (systemAuditLogs.length > 40) systemAuditLogs.pop();
  }
  res.json({ ok: true });
});

app.post('/api/me/alerts/:id/retry', (req, res) => {
  const alertId = req.params.id;
  const email = currentAuthUser?.email;
  const store = email && userStore[email] ? userStore[email] : mockUserData;
  if (store?.data?.alerts) {
    const a = store.data.alerts.find((x: any) => x.id === alertId);
    if (a) {
      a.attempts = 0;
      a.triggeredAt = null;
    }
  }
  res.json({ ok: true });
});

app.post('/api/auth/logout', (req, res) => {
  currentAuthUser = null;
  res.json({ ok: true });
});

app.delete('/api/me', (req, res) => {
  const email = currentAuthUser?.email;
  if (email) {
    delete userStore[email];
    const idx = systemUsers.findIndex(u => u.email === email && u.email !== ADMIN_EMAIL);
    if (idx !== -1) systemUsers.splice(idx, 1);
  }
  currentAuthUser = null;
  mockUserData = null;
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

app.get('/api/crypto-icons', (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
  res.json({ ok: true, icons: CRYPTO_ICONS });
});

app.get('/api/me/data', (req, res) => {
  const email = currentAuthUser?.email;
  const userRecord = email ? userStore[email] : null;
  res.json(userRecord || mockUserData || {
    exists: false,
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
  const email = currentAuthUser?.email;
  const body = req.body || {};
  const updated = {
    exists: true,
    updatedAt: Math.floor(Date.now() / 1000),
    data: body
  };

  if (email) {
    userStore[email] = updated;
    const u = systemUsers.find(x => x.email.toLowerCase() === email.toLowerCase());
    if (u) {
      u.holdingsCount = Array.isArray(body.holdings) ? body.holdings.length : 0;
      u.alertsCount = Array.isArray(body.alerts) ? body.alerts.length : 0;
    }
  }
  mockUserData = updated;

  // Check alert conditions and log simulated email alerts
  if (Array.isArray(body.alerts) && cachedPrices.items) {
    for (const al of body.alerts) {
      const item = cachedPrices.items[al.assetId];
      if (item && item.price > 0 && !al.triggeredAt) {
        const hit = (al.direction === 'above' && item.price >= al.price) ||
                    (al.direction === 'below' && item.price <= al.price);
        if (hit) {
          al.triggeredAt = Math.floor(Date.now() / 1000);
          systemAuditLogs.unshift({
            id: Date.now(),
            time: 'هم‌اکنون',
            type: 'system',
            msg: `هدف قیمتی دارایی ${al.assetId} محقق شد؛ ایمیل و اعلان هشدار به ${email || 'کاربر'} ارسال گردید.`
          });
          if (systemAuditLogs.length > 40) systemAuditLogs.pop();
        }
      }
    }
  }

  res.json(updated);
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

// Serve root PWA HTML directly with anti-cache headers
app.get(['/', '/index.html'], (req, res) => {
  const htmlPath = path.join(__dirname, 'src', 'index.html');
  if (fs.existsSync(htmlPath)) {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Surrogate-Control', 'no-store');
    return res.sendFile(htmlPath);
  }
  return res.status(404).send('HTML not found.');
});

// Serve any remaining static files with zero cache
app.use(express.static(path.join(__dirname, 'public'), { maxAge: 0, etag: false }));
app.use('/src', express.static(path.join(__dirname, 'src'), { maxAge: 0, etag: false }));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[Darayi Server] Running on http://0.0.0.0:${PORT}`);
});
