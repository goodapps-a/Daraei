// دارایی من (Darayi) — ماژول مشترک امنیت، هدرها، هش رمز عبور، اعتبارسنجی SSRF و تراکنش‌ها
// مشترک بین Cloudflare Worker (پروداکشن: src/worker.js) و سرور پیش‌نمایش (server.ts)

const enc = new TextEncoder();

export const SEC_HEADERS = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'SAMEORIGIN',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'strict-transport-security': 'max-age=31536000; includeSubDomains'
};

export const PROD_CSP = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: blob: https:; connect-src 'self' https: wss://stream.binance.com:443 wss://data-stream.binance.vision; frame-ancestors 'self'; base-uri 'self'; form-action 'self'";

export function buildHtmlCsp(allowPreviewFrame = false) {
  const frameAncestors = typeof allowPreviewFrame === 'string'
    ? allowPreviewFrame
    : (allowPreviewFrame
        ? "'self' https://aistudio.google.com https://*.aistudio.google.com https://*.googleusercontent.com https://*.google.com"
        : "'self'");
  return `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: blob: https:; worker-src 'self' blob:; connect-src 'self' https: wss://stream.binance.com:443 wss://data-stream.binance.vision; frame-ancestors ${frameAncestors}; base-uri 'self'; form-action 'self'`;
}

export const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const b64uDec = (s) => Uint8Array.from(atob(String(s || '').replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
export const teq = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
};

export const cleanEmail = (e) => String(e || '').trim().toLowerCase();
export const isEmail = (e) => typeof e === 'string' && e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
export const okPass = (p) => typeof p === 'string' && p.length >= 8 && p.length <= 128;
export const normCode = (c) => String(c ?? '').replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/\D/g, '');

// پیش‌فرض ۱۰,۰۰۰ iteration برای رعایت سقف ۱۰ms CPU پلن رایگان کلادفلر؛ قابل تنظیم با env.PBKDF2_ITER تا سقف ۱۰۰,۰۰۰
export const PBKDF2_DEFAULT = 10000;
export const iterOf = (env) => Math.min(100000, Math.max(1000, Number(env && env.PBKDF2_ITER) || PBKDF2_DEFAULT));

export async function pbkdf2(pw, salt, iter) {
  const key = await crypto.subtle.importKey('raw', enc.encode(String(pw)), 'PBKDF2', false, ['deriveBits']);
  return b64u(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, key, 256));
}

export function parsePbkdf2Hash(stored) {
  if (!stored || typeof stored !== 'string') return null;
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return null;
  const iter = Number(parts[1]);
  if (!Number.isFinite(iter) || iter < 1000 || iter > 1000000) return null;
  return { iter: Math.floor(iter), saltB64: parts[2], hashB64: parts[3] };
}

export async function hashPassword(pw, env) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const it = iterOf(env);
  return `pbkdf2$${it}$${b64u(salt)}$${await pbkdf2(pw, salt, it)}`;
}

export async function verifyPassword(pw, stored, env) {
  const parsed = parsePbkdf2Hash(stored);
  const targetIter = iterOf(env);
  if (!parsed) {
    // اجرای محاسبه ساختگی برای جلوگیری از نشت زمانی (Timing Side-Channel)
    await pbkdf2(String(pw || ''), new Uint8Array(16), targetIter);
    return false;
  }
  let saltBytes;
  try {
    saltBytes = b64uDec(parsed.saltB64);
  } catch {
    return false;
  }
  const got = await pbkdf2(String(pw || ''), saltBytes, parsed.iter);
  return teq(got, parsed.hashB64);
}

const WILDCARD_DNS_SUFFIXES = [
  'nip.io',
  'sslip.io',
  'xip.io',
  'localtest.me',
  'lvh.me',
  'traefik.me'
];

export function isNumericOrReservedHost(host) {
  const h = String(host || '').toLowerCase().replace(/\.$/, '');
  if (!h) return true;
  if (h.startsWith('[') || h.endsWith(']') || h.includes(':')) return true;
  // مسدودسازی کامل هرگونه IP عددی (دهدهی، هگزادسیمال، اکتال، IPv4 نقطه‌دار یا عدد صحیح)
  if (/^\d+$/.test(h) || /^0x[0-9a-f]+$/i.test(h) || /^0[0-7]+$/.test(h)) return true;
  const parts = h.split('.');
  if (parts.every((p) => /^\d+$/.test(p) || /^0x[0-9a-f]+$/i.test(p) || /^0[0-7]+$/.test(p))) {
    return true;
  }
  if (/^[0-9.]+$/.test(h)) return true;
  return false;
}

export function isSafePublicUrl(rawUrl) {
  try {
    const str = String(rawUrl || '').trim();
    if (!str || str.length > 512) return false;
    // بررسی خام رشته قبل از نرمال‌سازی URL برای تشخیص مبهم‌سازی هگز/اکتال/عدد صحیح در بخش host
    const rawHostMatch = /^[a-zA-Z]+:\/\/([^/?#]+)/.exec(str);
    if (rawHostMatch) {
      const rawHost = rawHostMatch[1].replace(/:\d+$/, '').toLowerCase().replace(/\.$/, '');
      if (isNumericOrReservedHost(rawHost)) return false;
    }
    const u = new URL(str);
    if (u.protocol !== 'https:' && u.protocol !== 'wss:') return false;
    if (u.username || u.password) return false;
    if (u.port && u.port !== '443') return false;
    const h = u.hostname.toLowerCase().replace(/\.$/, '');
    if (
      !h ||
      h === 'localhost' ||
      h.endsWith('.localhost') ||
      h.endsWith('.local') ||
      h.endsWith('.internal') ||
      h.endsWith('.arpa') ||
      h === 'metadata.google.internal' ||
      h === 'metadata' ||
      h === 'instance-data'
    ) {
      return false;
    }
    if (isNumericOrReservedHost(h)) return false;
    for (const suffix of WILDCARD_DNS_SUFFIXES) {
      if (h === suffix || h.endsWith('.' + suffix)) return false;
    }
    if (!h.includes('.')) return false;
    const tld = h.split('.').pop() || '';
    if (!/^[a-z]{2,24}$/.test(tld)) return false;
    return true;
  } catch {
    return false;
  }
}

const num = (v) => (typeof v === 'number' || typeof v === 'string') && v !== '' ? Number(v) : NaN;
const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');

export function cleanData(b) {
  const raw = b && typeof b === 'object' ? b : {};
  const known = (id) => typeof id === 'string' && /^[a-z0-9]{1,20}$/.test(id);
  const holdings = (Array.isArray(raw.holdings) ? raw.holdings : [])
    .slice(0, 500)
    .map((h) => {
      if (!h || typeof h !== 'object') return null;
      const side = ['buy', 'sell', 'transfer'].includes(h.side) ? h.side : 'buy';
      const bp = num(h.buyPrice);
      return {
        id: /^[A-Za-z0-9_-]{1,40}$/.test(h.id) ? h.id : '',
        assetId: h.assetId,
        qty: num(h.qty),
        buyPrice: side === 'transfer' && (bp === 0 || Number.isNaN(bp)) ? 0 : bp,
        fee: num(h.fee ?? 0),
        side,
        wallet: str(h.wallet, 60),
        toWallet: str(h.toWallet, 60),
        createdAt: num(h.createdAt) || 0,
        date: str(h.date, 10),
        note: str(h.note, 200)
      };
    })
    .filter((h) => {
      if (!h || !h.id || !known(h.assetId) || !(h.qty > 0) || !(h.fee >= 0)) return false;
      const priceOk = h.side === 'transfer' ? h.buyPrice >= 0 : h.buyPrice > 0;
      return priceOk && Number.isFinite(h.qty + h.buyPrice + h.fee);
    });
  const watch = [...new Set(Array.isArray(raw.watch) ? raw.watch : [])].filter(known).slice(0, 50);
  const featured = [...new Set(Array.isArray(raw.featured) ? raw.featured : [])].filter(known).slice(0, 24);
  const alerts = (Array.isArray(raw.alerts) ? raw.alerts : [])
    .slice(0, 50)
    .map((a) => a && ({
      id: /^[A-Za-z0-9_-]{1,40}$/.test(a.id) ? a.id : '',
      assetId: a.assetId,
      direction: a.direction,
      price: num(a.price),
      currency: ['USDT', 'USD', 'IRT'].includes(a.currency) ? a.currency : 'IRT',
      triggeredAt: num(a.triggeredAt) > 0 ? Math.floor(num(a.triggeredAt)) : null
    }))
    .filter((a) => a && a.id && known(a.assetId) && (a.direction === 'above' || a.direction === 'below') && a.price > 0 && Number.isFinite(a.price));
  const s = raw.settings && typeof raw.settings === 'object' ? raw.settings : {};
  const settings = {
    theme: s.theme === 'dark' ? 'dark' : 'light',
    unit: s.unit === 'rial' ? 'rial' : 'toman',
    privacy: !!s.privacy,
    filter: ['all', 'currency', 'gold', 'crypto', 'global'].includes(s.filter) ? s.filter : 'all'
  };
  return { holdings, watch, featured, alerts, settings };
}

export function validateTransactions(records) {
  const balances = new Map();
  const list = Array.isArray(records) ? records : [];
  for (const h of list.map((x, i) => ({ ...x, _i: i })).sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')) || (a.createdAt || a._i) - (b.createdAt || b._i))) {
    const walletName = h.wallet || 'اصلی';
    const key = h.assetId + ':' + walletName;
    const balance = balances.get(key) || 0;
    if (h.side === 'buy') {
      balances.set(key, balance + h.qty);
    } else {
      if (balance + 1e-10 < h.qty) {
        const err = new Error('موجودی کیف پول برای این معامله کافی نیست.');
        err.status = 400;
        throw err;
      }
      balances.set(key, balance - h.qty);
      if (h.side === 'transfer') {
        if (!h.toWallet || h.toWallet === walletName) {
          const err = new Error('کیف پول مقصد معتبر نیست.');
          err.status = 400;
          throw err;
        }
        const to = h.assetId + ':' + h.toWallet;
        balances.set(to, (balances.get(to) || 0) + h.qty);
      }
    }
  }
}
