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
    const price = scale > 1 ? Number((raw / scale).toFixed(2)) : Math.round(raw);
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
