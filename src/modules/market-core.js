// ماژول هسته بازار دارایی (Darayi Market Core)
// شامل نگاشت منابع (ایران‌مارکت، نرخ‌آرا، نرخ‌سنج، والکس)، اعتبارسنجی زمان و تشخیص هوشمند باز/بسته بودن بازار تهران

export const NERKHARA_MAP = {
  usdt: 'usdt',
  usd: 'usd',
  eur: 'eur',
  gbp: 'gbp',
  aed: 'aed',
  try: 'try',
  cny: 'cny',
  cad: 'cad',
  aud: 'aud',
  chf: 'chf',
  sar: 'sar',
  qar: 'qar',
  kwd: 'kwd',
  omr: 'omr',
  iqd: 'iqd',
  afn: 'afn',
  rub: 'rub',
  inr: 'inr',
  gold18: 'gold-18k',
  gold24: 'gold-24k',
  gram: 'gold-mesghal',
  coin: 'coin-emami',
  bahar: 'coin-bahar-azadi',
  halfcoin: 'coin-half',
  quartercoin: 'coin-quarter',
  gramcoin: 'coin-gram',
  silver999: 'silver-999'
};

export const BONBAST_MAP = {
  usd: ['usd1', 1],
  eur: ['eur1', 1],
  gbp: ['gbp1', 1],
  aed: ['aed1', 1],
  try: ['try1', 1],
  cny: ['cny1', 1],
  cad: ['cad1', 1],
  aud: ['aud1', 1],
  chf: ['chf1', 1],
  sar: ['sar1', 1],
  qar: ['qar1', 1],
  kwd: ['kwd1', 1],
  omr: ['omr1', 1],
  iqd: ['iqd1', 100],
  afn: ['afn1', 1],
  rub: ['rub1', 1],
  inr: ['inr1', 1],
  gold18: ['gol18', 1],
  gram: ['mithqal', 1],
  coin: ['emami1', 1],
  bahar: ['azadi1', 1],
  halfcoin: ['azadi1_2', 1],
  quartercoin: ['azadi1_4', 1],
  gramcoin: ['azadi1g', 1]
};

export function preservePricePrecision(rawVal) {
  const num = Number(rawVal);
  if (!Number.isFinite(num) || num <= 0) return 0;
  return num < 1 ? Number(num.toFixed(8)) : Number(num.toFixed(4));
}

export function parseBonbastPayload(data, nowSec = Math.floor(Date.now() / 1000)) {
  if (!data || typeof data !== 'object' || data.reset) {
    return { dict: {}, ts: null };
  }
  const rawLastMod = typeof data.last_modified === 'string' ? data.last_modified.trim() : '';
  const ts = rawLastMod
    ? (parseUtcTimestamp(/\b(?:UTC|GMT|Z)\b/i.test(rawLastMod) ? rawLastMod : `${rawLastMod} UTC`, nowSec) || parseUtcTimestamp(rawLastMod, nowSec))
    : null;
  if (ts && (nowSec - ts) > 72 * 3600) {
    return { dict: {}, ts };
  }
  const dict = {};
  for (const [id, [key, scale]] of Object.entries(BONBAST_MAP)) {
    const raw = Number(String(data[key] ?? '').replace(/,/g, ''));
    if (!Number.isFinite(raw) || raw <= 0) continue;
    const price = scale > 1 ? preservePricePrecision(raw / scale) : preservePricePrecision(raw);
    if (Number.isFinite(price) && price > 0) {
      dict[id] = { price, srcTs: ts };
    }
  }
  return { dict, ts };
}

export const DOMESTIC_META = {
  usd: { name: 'دلار آمریکا', sym: 'USD', cat: 'currency' },
  eur: { name: 'یورو', sym: 'EUR', cat: 'currency' },
  gbp: { name: 'پوند انگلیس', sym: 'GBP', cat: 'currency' },
  aed: { name: 'درهم امارات', sym: 'AED', cat: 'currency' },
  try: { name: 'لیر ترکیه', sym: 'TRY', cat: 'currency' },
  cny: { name: 'یوان چین', sym: 'CNY', cat: 'currency' },
  cad: { name: 'دلار کانادا', sym: 'CAD', cat: 'currency' },
  aud: { name: 'دلار استرالیا', sym: 'AUD', cat: 'currency' },
  chf: { name: 'فرانک سوئیس', sym: 'CHF', cat: 'currency' },
  sar: { name: 'ریال عربستان', sym: 'SAR', cat: 'currency' },
  qar: { name: 'ریال قطر', sym: 'QAR', cat: 'currency' },
  kwd: { name: 'دینار کویت', sym: 'KWD', cat: 'currency' },
  omr: { name: 'ریال عمان', sym: 'OMR', cat: 'currency' },
  iqd: { name: 'دینار عراق', sym: 'IQD', cat: 'currency' },
  afn: { name: 'افغانی', sym: 'AFN', cat: 'currency' },
  rub: { name: 'روبل روسیه', sym: 'RUB', cat: 'currency' },
  inr: { name: 'روپیه هند', sym: 'INR', cat: 'currency' },
  gold18: { name: 'طلای ۱۸ عیار', sym: 'Gold18', cat: 'gold' },
  gold24: { name: 'طلای ۲۴ عیار', sym: 'Gold24', cat: 'gold' },
  gram: { name: 'مثقال طلا', sym: 'Mesghal', cat: 'gold' },
  coin: { name: 'سکه امامی', sym: 'Coin', cat: 'gold' },
  bahar: { name: 'سکه بهار آزادی', sym: 'Bahar', cat: 'gold' },
  halfcoin: { name: 'نیم‌سکه', sym: 'Half', cat: 'gold' },
  quartercoin: { name: 'ربع‌سکه', sym: 'Quarter', cat: 'gold' },
  gramcoin: { name: 'سکه گرمی', sym: 'Gram', cat: 'gold' },
  silver999: { name: 'نقره ۹۹۹ (هر گرم)', sym: 'Silver', cat: 'gold' }
};

export const ALL_DOMESTIC_IDS = Object.keys(DOMESTIC_META);
export const D1_HISTORY_ASSET_IDS = ['usdt', ...ALL_DOMESTIC_IDS];

export const KV_SNAPSHOT_KEY = 'prices:snapshot:v1';
export const KV_SNAPSHOT_VERSION = 1;

// تبدیل رشته زمانی UTC (مانند خروجی NerkhAra یا ISO) به ثانیه یونیکس معتبر
export function parseUtcTimestamp(raw, nowSec = Math.floor(Date.now() / 1000)) {
  if (!raw) return null;
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const sec = raw > 1e11 ? Math.floor(raw / 1000) : Math.floor(raw);
    return (sec > 1500000000 && sec <= nowSec + 600) ? sec : null;
  }
  const s = String(raw).trim();
  if (!s) return null;
  // اگر رشته ISO بدون پسوند منطقه زمانی باشد (مانند "2026-11-12T15:04:43")، آن را UTC در نظر بگیر
  const normalized = (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?$/.test(s)) ? `${s}Z` : s;
  const ms = Date.parse(normalized);
  if (!Number.isFinite(ms)) return null;
  const sec = Math.floor(ms / 1000);
  return (sec > 1500000000 && sec <= nowSec + 600) ? sec : null;
}

// بررسی باز بودن بازار فیزیکی طلا و ارز تهران (شنبه تا چهارشنبه ۱۰ الی ۱۹، پنجشنبه ۱۰ الی ۱۵ به وقت تهران)
export function isTehranMarketOpen(nowSec = Math.floor(Date.now() / 1000)) {
  // تهران: UTC + 3:30 (12600 ثانیه)
  const tehranEpochMs = (nowSec + 12600) * 1000;
  const d = new Date(tehranEpochMs);
  const dow = d.getUTCDay(); // 0=Sun, 1=Mon, ..., 4=Thu, 5=Fri, 6=Sat
  if (dow === 5) return false; // جمعه تعطیل رسمی بازار طلا و ارز
  const hour = d.getUTCHours() + d.getUTCMinutes() / 60;
  if (dow === 4) {
    return hour >= 10 && hour <= 15.5;
  }
  return hour >= 10 && hour <= 19.5;
}

const DOMESTIC_MAJOR_IDS = new Set(['usd', 'eur', 'gold18', 'gold24', 'coin', 'gram']);

// محاسبه آستانه کهنگی (Stale) بر اساس نوع دارایی و ساعات واقعی بازار تهران/جهانی
export function getStaleThresholdSec(id, isCrypto, nowSec = Math.floor(Date.now() / 1000)) {
  const normId = String(id || '').toLowerCase();
  if (normId === 'usdt') return 1800; // تتر: صرافی‌های داخلی ۲۴/۷ هستند (حداکثر ۳۰ دقیقه بدون آپدیت)
  if (isCrypto) return 900; // رمزارزهای اسپات ۲۴/۷: حداکثر ۱۵ دقیقه (پوشش ۳ چرخه کران ۵ دقیقه‌ای)

  if (normId === 'sp500' || normId === 'silver') {
    const d = new Date(nowSec * 1000);
    const utcDow = d.getUTCDay(); // 0=Sun..5=Fri, 6=Sat
    const utcHour = d.getUTCHours() + d.getUTCMinutes() / 60;
    const isGlobalWeekend = (utcDow === 5 && utcHour >= 22) || utcDow === 6 || utcDow === 0 || (utcDow === 1 && utcHour < 2);
    return isGlobalWeekend ? 64 * 3600 : 14400;
  }

  // دارایی‌های داخلی (طلا، سکه، ارز): وقت تهران (UTC+3:30)
  const tehranEpochMs = (nowSec + 12600) * 1000;
  const d = new Date(tehranEpochMs);
  const dow = d.getUTCDay(); // 0=Sun..4=Thu, 5=Fri, 6=Sat
  const hour = d.getUTCHours() + d.getUTCMinutes() / 60;

  // پنجره تعطیلی پایان هفته: بعد از بسته شدن پنجشنبه (۱۵:۳۰)، کل جمعه و تا ۱.۵ ساعت بعد از بازگشایی شنبه (۱۱:۳۰)
  if ((dow === 4 && hour > 15.5) || dow === 5 || (dow === 6 && hour < 11.5)) {
    return 52 * 3600;
  }
  // پنجره شبانه بین روزهای کاری یا ۱.۵ ساعت ابتدای بازگشایی بازار در یکشنبه تا پنجشنبه
  if (!isTehranMarketOpen(nowSec) || hour < 11.5) {
    return 20 * 3600;
  }
  // ساعات فعال روزانه بازار تهران
  return DOMESTIC_MAJOR_IDS.has(normId) ? 14400 : 21600;
}

export function isPriceItemStale(item, id, nowSec = Math.floor(Date.now() / 1000)) {
  if (!item || !(Number(item.price) > 0)) return true;
  if (item.upstreamStale === true) return true;
  const normId = String(id || '').toLowerCase();
  const isCrypto = Boolean((item.crypto || item.kind === 'crypto' || item.unit === 'USDT') && normId !== 'usdt');
  const refTs = Number(item.sourceTimestamp) > 0
    ? Number(item.sourceTimestamp)
    : (Number(item.t) > 0 ? Number(item.t) : Number(item.receivedAt) || 0);
  if (!(refTs > 0)) return true;
  const threshold = getStaleThresholdSec(normId, isCrypto, nowSec);
  return (nowSec - refTs) > threshold;
}

export const CHART_RANGES = {
  '1H': 3600,
  '1D': 86400,
  '3D': 259200,
  '1W': 604800,
  '1M': 2592000,
  '1Y': 31536000
};

export const CHART_KLINE_CONFIG = {
  '1H': ['1m', 60],
  '1D': ['5m', 288],
  '3D': ['1h', 72],
  '1W': ['4h', 42],
  '1M': ['1d', 30],
  '1Y': ['1d', 365]
};

// نرمال‌سازی یکسان زمان شروع کندل (openTime) بر حسب ثانیه در همه صرافی‌ها (بایننس، کوکوین، اوکی‌ایکس، گیت)
export function normalizeCandleOpenTimeSec(rawTs) {
  const n = Number(rawTs);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n > 1e11 ? Math.floor(n / 1000) : Math.floor(n);
}

// پارس کندل بایننس بر پایه c[0] (openTime) و c[4] (close) — هرگز از closeTime (c[6]) استفاده نمی‌شود
export function parseBinanceKlineEntry(candle) {
  if (!Array.isArray(candle) || candle.length < 5) return null;
  const openSec = normalizeCandleOpenTimeSec(candle[0]);
  const closePrice = Number(candle[4]);
  if (!(openSec > 1500000000) || !(closePrice > 0) || !Number.isFinite(closePrice)) return null;
  return [openSec, closePrice];
}

// فیلتر سخت‌گیرانه بازه زمانی نمودارها (به‌ویژه طلا و ارز): هیچ نقطه‌ای خارج از [now - span, now + maxLeadSec] مجاز نیست
export function filterPointsStrictlyInRange(points, range, nowSec = Math.floor(Date.now() / 1000), maxLeadSec = 3600) {
  const span = CHART_RANGES[range];
  if (!span || !Array.isArray(points) || !points.length) return [];
  const minTs = nowSec - span;
  const maxTs = nowSec + Math.max(0, Number(maxLeadSec) || 0);
  return points.filter((p) => Array.isArray(p) && p.length >= 2 && Number(p[0]) >= minTs && Number(p[0]) <= maxTs && Number(p[1]) > 0);
}

export function computeRangeChangePct(points) {
  if (!Array.isArray(points) || points.length < 2) return null;
  const first = Number(points[0]?.[1]);
  const last = Number(points[points.length - 1]?.[1]);
  if (!(first > 0) || !Number.isFinite(last) || last <= 0) return null;
  return ((last - first) / first) * 100;
}

export function resolveHistoryResolution(range, source, isDomestic) {
  const src = String(source || '').toLowerCase();
  if (src === 'wallex' || src === 'wallex_cache') {
    return { '1H': '1m', '1D': '15m', '3D': '1h', '1W': '1h', '1M': '1d', '1Y': '1d' }[range] || '15m';
  }
  if (src === 'd1_intraday') return '5m';
  if (src === 'archive' || src === 'iran_market' || src === 'nerkhara' || src === 'nerkhsanj') return '1d';
  if (isDomestic) return (range === '1H' || range === '1D') ? '5m' : '1d';
  return (CHART_KLINE_CONFIG[range] && CHART_KLINE_CONFIG[range][0]) || '5m';
}

export function resolveHistoryDataStatus({ range, source, isDomestic, liveItem, nowSec = Math.floor(Date.now() / 1000) }) {
  const src = String(source || '').toLowerCase();
  const isIntraday = range === '1H' || range === '1D';
  if (src === 'archive' || src === 'iran_market' || src === 'nerkhara' || src === 'nerkhsanj' || src === 'wallex_cache') {
    return 'archived';
  }
  if (isDomestic) {
    if (!isIntraday) return 'archived';
    const pt = String(liveItem?.priceType || '').toLowerCase();
    if (!isTehranMarketOpen(nowSec) || pt === 'published' || pt === 'sell' || pt === 'average') {
      return 'published';
    }
    return liveItem && !isPriceItemStale(liveItem, liveItem.id || '', nowSec) ? 'live' : 'published';
  }
  return 'live';
}

export function buildHistoryMetadata({ id, range, source, points, liveItem, nowSec = Math.floor(Date.now() / 1000), isDomestic = false }) {
  const lastPtTs = Array.isArray(points) && points.length ? Number(points[points.length - 1]?.[0] || 0) : 0;
  const itemSrcTs = Number(liveItem?.sourceTimestamp || 0);
  const itemT = Number(liveItem?.t || 0);
  const candidates = [lastPtTs, itemSrcTs > 0 ? itemSrcTs : itemT].filter((x) => Number.isFinite(x) && x > 1500000000 && x <= nowSec + 43200);
  const lastDataAt = candidates.length ? Math.max(...candidates) : null;
  const priceSource = (liveItem && (liveItem.src || liveItem.source)) ? (liveItem.src || liveItem.source) : (source || null);
  const resolution = resolveHistoryResolution(range, source, isDomestic);
  const dataStatus = resolveHistoryDataStatus({ range, source, isDomestic, liveItem, nowSec });
  return {
    source: source || null,
    priceSource,
    lastDataAt,
    resolution,
    dataStatus,
    isDomestic: !!isDomestic
  };
}

export function normalizeCryptoIconName(val) {
  return String(val || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

// نگاشت لوگوی رمزارز بر اساس شناسه یکتای دارایی (ID -> Slug/Name -> Symbol غیرتکراری)
export function resolveCryptoIconByAssetId(asset, maps = {}) {
  if (!asset) return '';
  const id = String(asset.id || '').toLowerCase().trim();
  const sym = String(asset.symbol || asset.sym || '').toLowerCase().trim();
  const nameNorm = normalizeCryptoIconName(asset.name || asset.en || '');
  const {
    localIcons = {},
    curatedIcons = {},
    idMap = {},
    nameMap = {},
    symbolMap = {},
    symbolCounts = {},
    realXCryptos = new Set()
  } = maps;

  // ۱. تطبیق دقیق با شناسه یکتای دارایی (ID) در فایل‌های محلی و نگاشت‌های صریح
  if (id) {
    if (localIcons[id]) return localIcons[id];
    if (curatedIcons[id]) return curatedIcons[id];
    if (idMap[id]) return idMap[id];
  }

  // ۲. تطبیق با نام یکتا / slug دارایی پیش از Symbol
  if (nameNorm) {
    if (idMap[nameNorm]) return idMap[nameNorm];
    if (nameMap[nameNorm]) return nameMap[nameNorm];
  }
  if (id) {
    const idNorm = normalizeCryptoIconName(id);
    if (idNorm && nameMap[idNorm]) return nameMap[idNorm];
  }

  // ۳. پیشوندهای ضریب‌دار (1000PEPE, 1MBABYDOGE) یا جفت‌ارزهای بایننس/اوکی‌ایکس در صورتی که نماد مقصد تکراری نباشد
  const stripped = id ? id.replace(/^(1000+|1m)/, '') : '';
  const alt = (stripped && stripped !== id) ? stripped : (id.startsWith('ok') && id.length > 3 ? id.slice(2) : '');
  const isSymAmbiguous = Boolean(sym && Number(symbolCounts[sym] || 0) > 1);

  if (alt && !isSymAmbiguous) {
    if (localIcons[alt]) return localIcons[alt];
    if (curatedIcons[alt]) return curatedIcons[alt];
    if (idMap[alt]) return idMap[alt];
    if (symbolMap[alt]) return symbolMap[alt];
  }

  // ۴. استفاده از Symbol فقط زمانی که نماد بین دارایی‌های فعال تکراری نباشد (جلوگیری از لوگوی اشتباه برای نمادهای همنام)
  if (sym && !isSymAmbiguous) {
    if (localIcons[sym] && (!id || sym === id || !id.includes('-'))) return localIcons[sym];
    if (curatedIcons[sym] && (!id || sym === id || !id.includes('-'))) return curatedIcons[sym];
    if (symbolMap[sym]) return symbolMap[sym];
  }

  // ۵. توکن‌های سهام x-stock واقعی نه رمزارزهای واقعی با حرف x
  if (id && !realXCryptos.has(id) && !isSymAmbiguous) {
    const xm = /^x([a-z]{1,6})$/.exec(id);
    if (xm) return `https://financialmodelingprep.com/image-stock/${xm[1].toUpperCase()}.png`;
  }

  return '';
}

// حذف اسپایک‌های تک‌نقطه‌ای پرت (فقط نقطه‌ای که هر دو همسایه مجاورش در روند عادی هم‌سطح باشند اما خودش جهش/سقوط لحظه‌ای غیرعادی داشته باشد)
export function filterIsolatedHistorySpikes(points, isDomestic = false) {
  if (!Array.isArray(points) || points.length < 3) return Array.isArray(points) ? points : [];
  const neighborTol = isDomestic ? 0.08 : 0.14;
  const upRatio = isDomestic ? 1.18 : 1.30;
  const downRatio = isDomestic ? 0.84 : 0.74;
  const out = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const prevVal = Number(out[out.length - 1]?.[1]);
    const curVal = Number(points[i]?.[1]);
    const nextVal = Number(points[i + 1]?.[1]);
    if (!(prevVal > 0) || !(curVal > 0) || !(nextVal > 0)) continue;
    const minSide = Math.min(prevVal, nextVal);
    const maxSide = Math.max(prevVal, nextVal);
    const neighborsClose = ((maxSide - minSide) / minSide) <= neighborTol;
    const isOutlier = (curVal >= maxSide * upRatio) || (curVal <= minSide * downRatio);
    if (neighborsClose && isOutlier) {
      continue;
    }
    out.push(points[i]);
  }
  out.push(points[points.length - 1]);
  return out;
}

// تفکیک سگمنت‌های نمودار روی شکاف‌های واقعی زمانی تا بازه‌های قطع‌شده با خط مستقیم به هم وصل نشوند
export function splitHistoryGapSegments(points, range = '1D', isDomestic = false) {
  if (!Array.isArray(points) || !points.length) return [];
  const gapThresholds = {
    '1H': 900,
    '1D': isDomestic ? 64800 : 7200,
    '3D': isDomestic ? 86400 : 21600,
    '1W': isDomestic ? 216000 : 86400,
    '1M': 432000,
    '1Y': 864000
  };
  const maxGap = gapThresholds[range] || (isDomestic ? 64800 : 7200);
  const firstTs = Number(points[0]?.[0] || 0);
  // برای نمودارهای شاخص‌محور بدون مهر زمان یونیکس، شکاف زمانی اعمال نمی‌شود
  if (!(firstTs > 1500000000)) return [points];
  const segments = [[points[0]]];
  for (let i = 1; i < points.length; i++) {
    const prevTs = Number(points[i - 1]?.[0] || 0);
    const curTs = Number(points[i]?.[0] || 0);
    if (curTs - prevTs > maxGap) {
      segments.push([points[i]]);
    } else {
      segments[segments.length - 1].push(points[i]);
    }
  }
  return segments;
}

// حذف رمزارزهای قدیمی و منقضی‌شده از Snapshot فقط زمانی که فید صرافی با موفقیت تازه دریافت شده باشد
export function pruneStaleCryptoItems(items, freshCryptoIds) {
  if (!items || typeof items !== 'object' || !(freshCryptoIds instanceof Set) || freshCryptoIds.size < 15) {
    return 0;
  }
  let removed = 0;
  for (const id of Object.keys(items)) {
    if (id === 'usdt') continue;
    const it = items[id];
    if (it && (it.crypto || it.kind === 'crypto' || it.unit === 'USDT') && !freshCryptoIds.has(id)) {
      delete items[id];
      removed++;
    }
  }
  return removed;
}

// نگهداری کش حافظه با سقف تعداد مشخص برای جلوگیری از رشد بی‌رویه حافظه ایزوله Worker/Node
export function setBoundedMapEntry(map, key, value, maxEntries = 400) {
  if (!map || typeof map.set !== 'function') return;
  if (map.has(key)) map.delete(key);
  map.set(key, value);
  while (map.size > maxEntries) {
    const oldestKey = map.keys().next().value;
    if (oldestKey === undefined) break;
    map.delete(oldestKey);
  }
}


