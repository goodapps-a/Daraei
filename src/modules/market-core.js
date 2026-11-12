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

// محاسبه آستانه کهنگی (Stale) — فقط وقتی بیش از ۲۴ ساعت (۸۶۴۰۰ ثانیه) از آخرین قیمت بگذرد قدیمی محسوب می‌شود
export function getStaleThresholdSec(id, isCrypto, nowSec = Math.floor(Date.now() / 1000)) {
  return 86400;
}

export function isPriceItemStale(item, id, nowSec = Math.floor(Date.now() / 1000)) {
  if (!item || !(Number(item.price) > 0)) return true;
  if (item.upstreamStale === true) return true;
  const isCrypto = Boolean(item.crypto && id !== 'usdt' && item.unit === 'USDT');
  const refTs = Number(item.sourceTimestamp) > 0
    ? Number(item.sourceTimestamp)
    : (Number(item.t) > 0 ? Number(item.t) : Number(item.receivedAt) || 0);
  if (!(refTs > 0)) return true;
  const threshold = getStaleThresholdSec(id, isCrypto, nowSec);
  return (nowSec - refTs) > threshold;
}
