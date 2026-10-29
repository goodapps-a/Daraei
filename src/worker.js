// دارایی من (Darayi) — Cloudflare Worker (API + Cron + Static PWA)
// اصلاح‌شده و بهینه‌سازی‌شده برای پلن رایگان کلادفلر و رفع تمام باگ‌های دریافت قیمت

export const ASSETS = {
  usd: 'دلار آمریکا', eur: 'یورو', gbp: 'پوند انگلیس', aed: 'درهم امارات', try: 'لیر ترکیه',
  gold18: 'طلای ۱۸ عیار', gold24: 'طلای ۲۴ عیار', coin: 'سکه امامی', halfcoin: 'نیم‌سکه', gram: 'طلای آب‌شده',
  btc: 'بیت‌کوین', eth: 'اتریوم', usdt: 'تتر', sol: 'سولانا', bnb: 'بایننس کوین', xrp: 'ریپل',
  silver: 'نقره جهانی', sp500: 'شاخص S&P 500',
};
const SKIP_BASES = new Set('USDT USDC FDUSD TUSD USDP BUSD DAI AEUR EUR GBP TRY BRL ARS UAH PLN RON CZK JPY MXN COP ZAR NGN RUB BIDR IDRT USD1 USDE XUSD USDS RLUSD'.split(' '));
const NON_CRYPTO = new Set(['usd', 'eur', 'gbp', 'aed', 'try', 'gold18', 'gold24', 'coin', 'halfcoin', 'gram', 'silver', 'sp500', 'usdt']);
const KL = { '1H': ['1m', 60], '1D': ['5m', 288], '3D': ['1h', 72], '1W': ['4h', 42], '1M': ['1d', 30], '1Y': ['1d', 365] };
const BINANCE = 'https://data-api.binance.vision/api/v3';

// کلیدهای نرخ‌سنج برای ارزها و مسکوکات داخلی
const NERKH = {
  usd: ['dollar'], eur: ['euro'], gbp: ['pound', 'gbp'], aed: ['aed'], try: ['lira', 'try'],
  gold18: ['gold'], gold24: ['gold24'], gram: ['mesghal'], coin: ['coin'], halfcoin: ['half'], usdt: ['tether']
};
const DOMESTIC_EXTRA = {
  cny: ['yuan', 'یوان چین', 'CNY', 'currency'], cad: ['cad', 'دلار کانادا', 'CAD', 'currency'],
  aud: ['aud', 'دلار استرالیا', 'AUD', 'currency'], chf: ['chf', 'فرانک سوئیس', 'CHF', 'currency'],
  sar: ['sar', 'ریال عربستان', 'SAR', 'currency'], qar: ['qar', 'ریال قطر', 'QAR', 'currency'],
  kwd: ['kwd', 'دینار کویت', 'KWD', 'currency'], omr: ['omr', 'ریال عمان', 'OMR', 'currency'],
  iqd: ['iqd', 'دینار عراق', 'IQD', 'currency'], afn: ['afn', 'افغانی', 'AFN', 'currency'],
  rub: ['rub', 'روبل روسیه', 'RUB', 'currency'], inr: ['inr', 'روپیه هند', 'INR', 'currency'],
  bahar: ['bahar', 'سکه بهار آزادی', 'Bahar', 'gold'], quartercoin: ['quarter', 'ربع‌سکه', 'Quarter', 'gold'],
  gramcoin: ['gram', 'سکهٔ گرمی', 'Gram', 'gold'], silver999: ['silver', 'نقرهٔ ۹۹۹ (هر گرم)', 'Silver', 'gold'],
};
const EXCLUDED_STABLES = new Set([
  'usdc','dai','fdusd','tusd','usdp','busd','pyusd','usdd','usds','usd1','usdg',
  'paxg','eurc','ustc','xaut','frax','usde','rlusd','lusd','gusd','crvusd',
  'fxusd','alusd','mim','bgt','usdn','usdx','ssv','susd','dola','deusd',
  'btcst','steth','wsteth','weeth','reth','cbeth','eeth','eurt','usdt0'
]);
for (const id of Object.keys(DOMESTIC_EXTRA)) NON_CRYPTO.add(id);

const STALE_S = 12 * 3600; // نرخ‌های داخلی تا ۱۲ ساعت (به‌ویژه شب‌ها و تعطیلات بازار تهران) معتبر و استوار می‌مانند
const CRYPTO_STALE_S = 180;
const SESSION_S = 30 * 86400;
const RANGES = { '1H': 3600, '1D': 86400, '3D': 259200, '1W': 604800, '1M': 2592000, '1Y': 31536000 };

const enc = new TextEncoder();
const nowS = () => Math.floor(Date.now() / 1000);
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const rand = (n = 32) => b64u(crypto.getRandomValues(new Uint8Array(n)));
const sha256 = async (s) => b64u(await crypto.subtle.digest('SHA-256', enc.encode(s)));
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const json = (o, status = 200, h = {}) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...h } });
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const isEmail = (e) => typeof e === 'string' && e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

async function rateLimit(env, key, limit, windowS) {
  if (!env.DB) return;
  const win = Math.floor(nowS() / windowS);
  const r = await env.DB.prepare('INSERT INTO rate_limits(k,n,win) VALUES(?,1,?) ON CONFLICT(k) DO UPDATE SET n=CASE WHEN win=excluded.win THEN n+1 ELSE 1 END, win=excluded.win RETURNING n').bind(key, win).first();
  if (r && r.n > limit) throw new HttpError(429, 'تعداد درخواست‌ها زیاد است؛ کمی بعد دوباره تلاش کن.');
}

// ---------- ارسال ایمیل (Gmail Apps Script / Resend / Cloudflare) ----------
export async function sendMail(env, { to, subject, html, text, deliveryId }) {
  if (env.MAIL_WEBHOOK_URL && env.MAIL_WEBHOOK_SECRET) {
    const r = await fetch(env.MAIL_WEBHOOK_URL, { method: 'POST', signal: AbortSignal.timeout(15000), headers: { 'content-type': 'text/plain' }, body: JSON.stringify({ secret: env.MAIL_WEBHOOK_SECRET, to, subject, html, text, deliveryId }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) throw new Error('webhook_' + r.status + '_' + (j.error || ''));
    return;
  }
  if (env.RESEND_API_KEY && env.MAIL_FROM) {
    const r = await fetch('https://api.resend.com/emails', { method: 'POST', signal: AbortSignal.timeout(15000), headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json', ...(deliveryId ? { 'Idempotency-Key': deliveryId } : {}) }, body: JSON.stringify({ from: env.MAIL_FROM, to: [to], subject, html, text }) });
    if (!r.ok) throw new Error('resend_' + r.status);
    return;
  }
  if (env.EMAIL && env.MAIL_FROM) { await env.EMAIL.send({ from: env.MAIL_FROM, to, subject, html, text }); return; }
  throw new Error('email_not_configured');
}
const mailShell = (title, body) => `<!doctype html><html lang="fa" dir="rtl"><body style="margin:0;background:#f5f5f0;font-family:Tahoma,Arial,sans-serif"><div style="max-width:480px;margin:0 auto;padding:24px"><div style="background:#fff;border-radius:18px;padding:24px;border:1px solid #e4e4dc"><div style="font-size:13px;color:#7357ff;font-weight:700">دارایی من</div><h1 style="font-size:19px;margin:8px 0 14px;color:#17231e">${esc(title)}</h1>${body}</div><p style="font-size:11px;color:#8a8f88;text-align:center">اگر این ایمیل را تو درخواست نکرده‌ای، نادیده‌اش بگیر.</p></div></body></html>`;
const btn = (href, label) => `<p style="margin:20px 0"><a href="${esc(href)}" style="background:#d7ff61;color:#17231e;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:12px;display:inline-block">${esc(label)}</a></p>`;

// ---------- مدیریت نشست و کوکی‌ها ----------
const cookieOpts = (url, maxAge) => `Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${url.protocol === 'https:' ? '; Secure' : ''}`;
function getCookie(req, name) { const m = (req.headers.get('cookie') || '').split(/;\s*/).find((c) => c.startsWith(name + '=')); try { return m ? decodeURIComponent(m.slice(name.length + 1)) : null; } catch { return null; } }
async function currentUser(req, env) {
  if (!env.DB) return null;
  const sid = getCookie(req, 'sid'); if (!sid) return null;
  return env.DB.prepare('SELECT u.id,u.email,u.name FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id_hash=? AND s.expires_at>?').bind(await sha256(sid), nowS()).first();
}
async function sessionCookie(env, url, uid) {
  const sid = rand(32);
  if (env.DB) {
    await env.DB.prepare('INSERT INTO sessions(id_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)').bind(await sha256(sid), uid, nowS() + SESSION_S, nowS()).run();
  }
  return `sid=${sid}; ${cookieOpts(url, SESSION_S)}`;
}
async function upsertUser(env, { email, name, sub }) {
  email = email.toLowerCase();
  let u = sub ? await env.DB.prepare('SELECT * FROM users WHERE google_sub=?').bind(sub).first() : null;
  if (!u) u = await env.DB.prepare('SELECT * FROM users WHERE email=?').bind(email).first();
  if (u) {
    if (sub && !u.google_sub) await env.DB.prepare('UPDATE users SET google_sub=? WHERE id=?').bind(sub, u.id).run();
    if (name && !u.name) await env.DB.prepare('UPDATE users SET name=? WHERE id=?').bind(name, u.id).run();
    return u.id;
  }
  const id = rand(12);
  await env.DB.prepare('INSERT INTO users(id,email,name,google_sub,created_at) VALUES(?,?,?,?,?)').bind(id, email, name || email.split('@')[0], sub || null, nowS()).run();
  return id;
}

// ---------- احراز هویت با رمز عبور و کد یک‌بارمصرف ----------
const normCode = (c) => String(c ?? '').replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/\D/g, '');
const b64uDec = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const teq = (a, b) => { if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };
// عدد ۱۰,۰۰۰ برای پلن رایگان کلادفلر و محدودیت ۱۰ میلی‌ثانیه زمان CPU است
const PBKDF2_DEFAULT = 10000;
const iterOf = (env) => Math.min(100000, Math.max(1000, Number(env && env.PBKDF2_ITER) || PBKDF2_DEFAULT));
async function pbkdf2(pw, salt, iter) { const key = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']); return b64u(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, key, 256)); }
async function hashPassword(pw, env) { const salt = crypto.getRandomValues(new Uint8Array(16)), it = iterOf(env); return `pbkdf2$${it}$${b64u(salt)}$${await pbkdf2(pw, salt, it)}`; }
async function verifyPassword(pw, stored, env) { const [t, it, salt, h] = String(stored || `x$${iterOf(env)}$AAAAAAAAAAAAAAAAAAAAAA$x`).split('$'); const got = await pbkdf2(pw, b64uDec(salt), Number(it) || iterOf(env)); return !!stored && t === 'pbkdf2' && teq(got, h); }
async function hmac(env, msg) { if (!env.AUTH_SECRET) throw new HttpError(503, 'متغیر AUTH_SECRET در تنظیمات Worker مقداردهی نشده است.'); const k = await crypto.subtle.importKey('raw', enc.encode(env.AUTH_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']); return b64u(await crypto.subtle.sign('HMAC', k, enc.encode(msg))); }
const randInt = (n) => { const max = Math.floor(2 ** 32 / n) * n; let x; do { x = crypto.getRandomValues(new Uint32Array(1))[0]; } while (x >= max); return x % n; };

async function issueCode(env, email, purpose, payload) {
  const code = String(randInt(1e6)).padStart(6, '0');
  await env.DB.batch([
    env.DB.prepare('DELETE FROM otp_codes WHERE email=? AND purpose=?').bind(email, purpose),
    env.DB.prepare('INSERT INTO otp_codes(email,purpose,code_hash,payload,expires_at,created_at) VALUES(?,?,?,?,?,?)').bind(email, purpose, await hmac(env, `${email}:${purpose}:${code}`), payload ? JSON.stringify(payload) : null, nowS() + 600, nowS())
  ]);
  return code;
}
async function checkCode(env, email, purpose, code) {
  code = normCode(code);
  const row = await env.DB.prepare('UPDATE otp_codes SET attempts=attempts+1 WHERE email=? AND purpose=? AND expires_at>? AND attempts<5 RETURNING code_hash,payload').bind(email, purpose, nowS()).first();
  if (!row || code.length !== 6) throw new HttpError(400, 'کد نامعتبر یا منقضی شده است؛ کد جدید بگیر.');
  if (!teq(await hmac(env, `${email}:${purpose}:${code}`), row.code_hash)) throw new HttpError(400, 'کد اشتباه است.');
  const used = await env.DB.prepare('DELETE FROM otp_codes WHERE email=? AND purpose=? AND code_hash=? RETURNING email').bind(email, purpose, row.code_hash).first();
  if (!used) throw new HttpError(400, 'این کد قبلاً استفاده شده است.');
  return row.payload ? JSON.parse(row.payload) : {};
}
const codeMail = (title, intro, code) => mailShell(title, `<p style="color:#444;line-height:1.9">${esc(intro)}</p><p style="font-size:30px;letter-spacing:8px;font-weight:800;direction:ltr;text-align:center;background:#f5f5f0;border-radius:12px;padding:14px;margin:16px 0">${code}</p><p style="font-size:12px;color:#8a8f88">این کد ۱۰ دقیقه معتبر است. آن را با کسی به اشتراک نگذار.</p>`);
const mailCode = (env, to, subject, intro, code) => sendMail(env, { to, subject, text: `${intro}\n\n${code}\n\n(۱۰ دقیقه معتبر است)`, html: codeMail(subject, intro, code) });
const cleanEmail = (e) => String(e || '').trim().toLowerCase();
const okPass = (p) => typeof p === 'string' && p.length >= 8 && p.length <= 128;
const limits = async (req, env, email, kind, n) => { await rateLimit(env, `${kind}:${email}`, n, 900); await rateLimit(env, `ip:${kind}:${req.headers.get('cf-connecting-ip') || 'x'}`, 30, 900); };
const mailFailed = (e) => { if (e instanceof HttpError) return e; console.error('mail failed', e.message); return new HttpError(503, 'ارسال ایمیل فعال نیست یا سرویس پاسخ نداده است؛ تنظیمات ایمیل سرور را بررسی کن.'); };

async function registerStart(req, env) {
  const b = await readJson(req), email = cleanEmail(b.email), name = String(b.name || '').trim();
  if (name.length < 2 || name.length > 40) throw new HttpError(400, 'نام باید بین ۲ تا ۴۰ حرف باشد.');
  if (!isEmail(email)) throw new HttpError(400, 'ایمیل معتبر نیست.');
  if (!okPass(b.password)) throw new HttpError(400, 'رمز عبور باید حداقل ۸ کاراکتر باشد.');
  await limits(req, env, email, 'reg', 3);
  const ex = await env.DB.prepare('SELECT id FROM users WHERE email=?').bind(email).first();
  try {
    if (ex) await sendMail(env, { to: email, subject: 'حساب دارایی من از قبل وجود دارد', text: 'با این ایمیل قبلاً ثبت‌نام شده است. وارد شو یا از «فراموشی رمز عبور» استفاده کن.', html: mailShell('حساب از قبل وجود دارد', '<p style="color:#444;line-height:1.9">با این ایمیل قبلاً ثبت‌نام شده است. وارد شو یا اگر رمز را فراموش کرده‌ای از «فراموشی رمز عبور» استفاده کن.</p>') });
    else await mailCode(env, email, 'کد تأیید ثبت‌نام', 'برای تکمیل ثبت‌نام در دارایی من این کد را وارد کن.', await issueCode(env, email, 'register', { name, hash: await hashPassword(b.password, env) }));
  } catch (e) { throw mailFailed(e); }
  return json({ ok: true });
}
async function registerVerify(req, env, url) {
  const b = await readJson(req), email = cleanEmail(b.email);
  await limits(req, env, email, 'regv', 10);
  const p = await checkCode(env, email, 'register', b.code);
  if (await env.DB.prepare('SELECT 1 AS x FROM users WHERE email=?').bind(email).first()) throw new HttpError(409, 'این ایمیل قبلاً ثبت شده است.');
  const id = rand(12);
  await env.DB.prepare('INSERT INTO users(id,email,name,password_hash,created_at) VALUES(?,?,?,?,?)').bind(id, email, p.name, p.hash, nowS()).run();
  return json({ ok: true }, 200, { 'set-cookie': await sessionCookie(env, url, id) });
}
async function login(req, env, url) {
  const b = await readJson(req), email = cleanEmail(b.email);
  await limits(req, env, email, 'login', 10);
  const u = isEmail(email) ? await env.DB.prepare('SELECT id,password_hash FROM users WHERE email=?').bind(email).first() : null;
  const ok = await verifyPassword(String(b.password || '').slice(0, 128), u && u.password_hash, env);
  if (!u || !ok) throw new HttpError(401, 'ایمیل یا رمز عبور اشتباه است.');
  return json({ ok: true }, 200, { 'set-cookie': await sessionCookie(env, url, u.id) });
}
async function resetStart(req, env) {
  const email = cleanEmail((await readJson(req)).email);
  if (!isEmail(email)) throw new HttpError(400, 'ایمیل معتبر نیست.');
  await limits(req, env, email, 'rst', 3);
  const u = await env.DB.prepare('SELECT id FROM users WHERE email=?').bind(email).first();
  if (u) { try { await mailCode(env, email, 'کد بازیابی رمز عبور', 'برای تعیین رمز عبور جدید این کد را وارد کن.', await issueCode(env, email, 'reset', null)); } catch (e) { throw mailFailed(e); } }
  return json({ ok: true });
}
async function resetVerify(req, env) {
  const b = await readJson(req), email = cleanEmail(b.email);
  await limits(req, env, email, 'rstv', 10);
  await checkCode(env, email, 'reset', b.code);
  const token = rand(24);
  await env.DB.batch([env.DB.prepare("DELETE FROM otp_codes WHERE email=? AND purpose='reset_ok'").bind(email), env.DB.prepare("INSERT INTO otp_codes(email,purpose,code_hash,expires_at,created_at) VALUES(?,'reset_ok',?,?,?)").bind(email, await sha256(token), nowS() + 600, nowS())]);
  return json({ ok: true, resetToken: token });
}
async function resetFinish(req, env, url) {
  const b = await readJson(req), email = cleanEmail(b.email);
  if (!okPass(b.password)) throw new HttpError(400, 'رمز عبور باید حداقل ۸ کاراکتر باشد.');
  await limits(req, env, email, 'rstf', 10);
  const row = await env.DB.prepare("UPDATE otp_codes SET attempts=attempts+1 WHERE email=? AND purpose='reset_ok' AND expires_at>? AND attempts<5 RETURNING code_hash").bind(email, nowS()).first();
  if (!row || !teq(await sha256(String(b.resetToken || '')), row.code_hash)) throw new HttpError(400, 'مرحلهٔ بازیابی منقضی شده است؛ از اول شروع کن.');
  const u = await env.DB.prepare('SELECT id FROM users WHERE email=?').bind(email).first();
  if (!u) throw new HttpError(400, 'مرحلهٔ بازیابی منقضی شده است؛ از اول شروع کن.');
  const used = await env.DB.prepare("DELETE FROM otp_codes WHERE email=? AND purpose='reset_ok' AND code_hash=? RETURNING email").bind(email, row.code_hash).first();
  if (!used) throw new HttpError(400, 'این درخواست قبلاً استفاده شده است.');
  await env.DB.batch([env.DB.prepare('UPDATE users SET password_hash=? WHERE id=?').bind(await hashPassword(b.password, env), u.id), env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(u.id), env.DB.prepare("DELETE FROM otp_codes WHERE email=? AND purpose='reset_ok'").bind(email)]);
  return json({ ok: true }, 200, { 'set-cookie': await sessionCookie(env, url, u.id) });
}
async function googleStart(env, url) {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    return new Response(null, {
      status: 302,
      headers: { location: '/?auth_error=google_not_configured', 'cache-control': 'no-store' }
    });
  }
  const state = rand(24), verifier = rand(48);
  await env.DB.prepare('INSERT INTO oauth_states(state_hash,verifier,expires_at) VALUES(?,?,?)').bind(await sha256(state), verifier, nowS() + 600).run();
  const challenge = b64u(await crypto.subtle.digest('SHA-256', enc.encode(verifier)));
  const q = new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, redirect_uri: `${env.APP_URL || url.origin}/api/auth/google/callback`, response_type: 'code', scope: 'openid email profile', state, code_challenge: challenge, code_challenge_method: 'S256', prompt: 'select_account' });
  return new Response(null, { status: 302, headers: { location: 'https://accounts.google.com/o/oauth2/v2/auth?' + q, 'cache-control': 'no-store', 'set-cookie': `oauth_state=${state}; ${cookieOpts(url,600)}` } });
}
function decodeJwt(t) { const p = t.split('.')[1]; const bin = atob(p.replace(/-/g, '+').replace(/_/g, '/')); return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)))); }
async function googleCallback(env, url, req) {
  const fail = (code) => new Response(null, { status: 302, headers: { location: `/?auth_error=${code}`, 'cache-control': 'no-store' } });
  if (url.searchParams.get('error')) return fail('denied');
  const code = url.searchParams.get('code'), state = url.searchParams.get('state');
  if (!code || !state || !teq(getCookie(req, 'oauth_state'), state)) return fail('invalid');
  const st = await env.DB.prepare('DELETE FROM oauth_states WHERE state_hash=? AND expires_at>? RETURNING verifier').bind(await sha256(state), nowS()).first();
  if (!st) return fail('state');
  const redirect = `${env.APP_URL || url.origin}/api/auth/google/callback`;
  const tr = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, redirect_uri: redirect, grant_type: 'authorization_code', code_verifier: st.verifier }) });
  if (!tr.ok) return fail('token');
  const claims = decodeJwt((await tr.json()).id_token || '..');
  const okIss = ['https://accounts.google.com', 'accounts.google.com'].includes(claims.iss);
  if (!okIss || claims.aud !== env.GOOGLE_CLIENT_ID || (!Number.isFinite(claims.exp) || claims.exp < nowS()) || claims.email_verified !== true || typeof claims.sub !== 'string' || !isEmail(claims.email)) return fail('claims');
  const uid = await upsertUser(env, { email: claims.email, name: claims.name, sub: claims.sub });
  const response = new Response(null, { status: 302, headers: { location: '/', 'set-cookie': await sessionCookie(env, url, uid), 'cache-control': 'no-store' } });
  response.headers.append('set-cookie', `oauth_state=; ${cookieOpts(url, 0)}`);
  return response;
}

// ---------- داده‌های کاربر و مدیریت سبد ----------
async function readJson(req) {
  const reader = req.body?.getReader(); let text = '', size = 0; const decoder = new TextDecoder();
  if (reader) while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > 262144) { await reader.cancel(); throw new HttpError(413, 'حجم داده زیاد است.'); } text += decoder.decode(value, { stream: true }); }
  text += decoder.decode();
  try { const o = JSON.parse(text || '{}'); if (!o || typeof o !== 'object' || Array.isArray(o)) throw 0; return o; } catch { throw new HttpError(400, 'درخواست نامعتبر است.'); }
}
const num = (v) => (typeof v === 'number' || typeof v === 'string') && v !== '' ? Number(v) : NaN;
const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
export function cleanData(b) {
  const known = (id) => typeof id === 'string' && /^[a-z0-9]{1,20}$/.test(id);
  const holdings = (Array.isArray(b.holdings) ? b.holdings : []).slice(0, 500).map((h) => h && ({ id: /^[A-Za-z0-9_-]{1,40}$/.test(h.id) ? h.id : '', assetId: h.assetId, qty: num(h.qty), buyPrice: num(h.buyPrice), fee: num(h.fee ?? 0), side: ['buy', 'sell', 'transfer'].includes(h.side) ? h.side : 'buy', wallet: str(h.wallet, 60), toWallet: str(h.toWallet, 60), createdAt: num(h.createdAt) || 0, date: str(h.date, 10), note: str(h.note, 200) }))
    .filter((h) => h && h.id && known(h.assetId) && h.qty > 0 && h.buyPrice > 0 && h.fee >= 0 && Number.isFinite(h.qty + h.buyPrice + h.fee));
  const watch = [...new Set(Array.isArray(b.watch) ? b.watch : [])].filter(known).slice(0, 50);
  const featured = [...new Set(Array.isArray(b.featured) ? b.featured : [])].filter(known).slice(0, 24);
  const alerts = (Array.isArray(b.alerts) ? b.alerts : []).slice(0, 50).map((a) => a && ({ id: /^[A-Za-z0-9_-]{1,40}$/.test(a.id) ? a.id : '', assetId: a.assetId, direction: a.direction, price: num(a.price), currency: ['USDT', 'USD', 'IRT'].includes(a.currency) ? a.currency : 'IRT' }))
    .filter((a) => a && a.id && known(a.assetId) && (a.direction === 'above' || a.direction === 'below') && a.price > 0 && Number.isFinite(a.price));
  const s = b.settings && typeof b.settings === 'object' ? b.settings : {};
  const settings = { theme: s.theme === 'dark' ? 'dark' : 'light', unit: s.unit === 'rial' ? 'rial' : 'toman', privacy: !!s.privacy, filter: ['all', 'currency', 'gold', 'crypto', 'global'].includes(s.filter) ? s.filter : 'all' };
  return { holdings, watch, featured, alerts, settings };
}
async function loadData(env, uid) {
  if (!env.DB) return { exists: false, updatedAt: 0, data: { holdings: [], watch: [], featured: [], alerts: [], settings: {} } };
  const d = await env.DB.prepare('SELECT holdings,watch,featured,settings,updated_at FROM user_data WHERE user_id=?').bind(uid).first();
  const al = await env.DB.prepare(`SELECT a.id,asset_id,direction,price,triggered_at,a.attempts,COALESCE(c.currency,'IRT') AS currency FROM alerts a LEFT JOIN alert_units c ON c.alert_id=a.id WHERE user_id=? ORDER BY created_at,a.id`).bind(uid).all();
  const alerts = al.results.map((a) => ({ id: a.id.slice(uid.length + 1), assetId: a.asset_id, direction: a.direction, price: a.price, currency: a.currency, attempts: a.attempts, triggeredAt: a.triggered_at ? a.triggered_at * 1000 : null }));
  if (!d) return { exists: false, updatedAt: 0, data: { holdings: [], watch: [], featured: [], alerts, settings: {} } };
  return { exists: true, updatedAt: d.updated_at, data: { holdings: JSON.parse(d.holdings), watch: JSON.parse(d.watch), featured: JSON.parse(d.featured), alerts, settings: JSON.parse(d.settings) } };
}
function validateTransactions(records) {
  const balances = new Map();
  for (const h of records.map((x, i) => ({ ...x, _i: i })).sort((a, b) => a.date.localeCompare(b.date) || (a.createdAt || a._i) - (b.createdAt || b._i))) {
    const key = h.assetId + ':' + (h.wallet || 'اصلی'), balance = balances.get(key) || 0;
    if (h.side === 'buy') balances.set(key, balance + h.qty);
    else {
      if (balance + 1e-10 < h.qty) throw new HttpError(400, 'موجودی کیف پول برای این معامله کافی نیست.');
      balances.set(key, balance - h.qty);
      if (h.side === 'transfer') { if (!h.toWallet || h.toWallet === (h.wallet || 'اصلی')) throw new HttpError(400, 'کیف پول مقصد معتبر نیست.'); const to = h.assetId + ':' + h.toWallet; balances.set(to, (balances.get(to) || 0) + h.qty); }
    }
  }
}
async function saveData(env, uid, body) {
  if (!env.DB) throw new HttpError(503, 'دیتابیس در دسترس نیست.');
  const c = cleanData(body); validateTransactions(c.holdings); const base = Number(body.baseRevision), t = Date.now() * 1000 + randInt(1000);
  if (!Number.isSafeInteger(base) || base < 0) throw new HttpError(409, 'ابتدا اطلاعات حساب را دریافت کن.');
  if (c.holdings.length !== (body.holdings || []).length || c.alerts.length !== (body.alerts || []).length) throw new HttpError(400, 'بعضی رکوردها معتبر نیستند؛ داده ذخیره نشد.');
  if (new Set(c.holdings.map(x => x.id)).size !== c.holdings.length || new Set(c.alerts.map(x => x.id)).size !== c.alerts.length) throw new HttpError(400, 'شناسه تکراری است.');
  const guard = 'EXISTS(SELECT 1 FROM user_data WHERE user_id=? AND updated_at=?)';
  const stmts = [env.DB.prepare('INSERT INTO user_data(user_id,holdings,watch,featured,settings,updated_at) SELECT ?,?,?,?,?,? WHERE ?=0 ON CONFLICT(user_id) DO UPDATE SET holdings=excluded.holdings,watch=excluded.watch,featured=excluded.featured,settings=excluded.settings,updated_at=excluded.updated_at WHERE user_data.updated_at=?').bind(uid, JSON.stringify(c.holdings), JSON.stringify(c.watch), JSON.stringify(c.featured), JSON.stringify(c.settings), t, base, base)];
  if (base !== 0) stmts[0] = env.DB.prepare('UPDATE user_data SET holdings=?,watch=?,featured=?,settings=?,updated_at=? WHERE user_id=? AND updated_at=?').bind(JSON.stringify(c.holdings), JSON.stringify(c.watch), JSON.stringify(c.featured), JSON.stringify(c.settings), t, uid, base);
  const ids = c.alerts.map(a => uid + ':' + a.id);
  for (const table of ['alert_delivery', 'alert_units', 'alert_state']) stmts.push(env.DB.prepare(`DELETE FROM ${table} WHERE alert_id IN (SELECT id FROM alerts WHERE user_id=?${ids.length ? ' AND id NOT IN (' + ids.map(() => '?').join(',') + ')' : ''}) AND ${guard}`).bind(uid, ...ids, uid, t));
  stmts.push(env.DB.prepare(`DELETE FROM alerts WHERE user_id=? AND ${guard}${ids.length ? ' AND id NOT IN (' + ids.map(() => '?').join(',') + ')' : ''}`).bind(uid, uid, t, ...ids));
  for (const a of c.alerts) {
    const aid = uid + ':' + a.id;
    const changed = "NOT EXISTS(SELECT 1 FROM alerts a LEFT JOIN alert_units c ON c.alert_id=a.id WHERE a.id=? AND a.asset_id=? AND a.direction=? AND a.price=? AND COALESCE(c.currency,'IRT')=?)";
    stmts.push(env.DB.prepare(`INSERT INTO alert_state(alert_id,version) SELECT ?,? WHERE ${guard} ON CONFLICT(alert_id) DO UPDATE SET version=excluded.version WHERE ${changed}`).bind(aid, rand(16), uid, t, aid, a.assetId, a.direction, a.price, a.currency));
    stmts.push(env.DB.prepare(`UPDATE alerts SET triggered_at=NULL,attempts=0 WHERE id=? AND ${guard} AND ${changed}`).bind(aid, uid, t, aid, a.assetId, a.direction, a.price, a.currency));
    stmts.push(env.DB.prepare(`DELETE FROM alert_delivery WHERE alert_id=? AND ${guard} AND ${changed}`).bind(aid, uid, t, aid, a.assetId, a.direction, a.price, a.currency));
    stmts.push(env.DB.prepare(`INSERT INTO alert_units(alert_id,currency) SELECT ?,? WHERE ${guard} ON CONFLICT(alert_id) DO UPDATE SET currency=excluded.currency`).bind(aid, a.currency, uid, t));
    const same = 'alerts.asset_id=excluded.asset_id AND alerts.direction=excluded.direction AND alerts.price=excluded.price';
    stmts.push(env.DB.prepare(`INSERT INTO alerts(id,user_id,asset_id,direction,price,created_at) SELECT ?,?,?,?,?,? WHERE ${guard} ON CONFLICT(id) DO UPDATE SET triggered_at=CASE WHEN ${same} THEN alerts.triggered_at ELSE NULL END,attempts=CASE WHEN ${same} THEN alerts.attempts ELSE 0 END,asset_id=excluded.asset_id,direction=excluded.direction,price=excluded.price WHERE alerts.user_id=excluded.user_id`).bind(aid, uid, a.assetId, a.direction, a.price, nowS(), uid, t));
  }
  const out = await env.DB.batch(stmts);
  if (!out[0].meta.changes) throw new HttpError(409, 'اطلاعات روی دستگاه دیگری تغییر کرده است.');
  return loadData(env, uid);
}
async function deleteAccount(env, user) {
  if (!env.DB) return;
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(user.id), env.DB.prepare('DELETE FROM user_data WHERE user_id=?').bind(user.id),
    env.DB.prepare('DELETE FROM alerts WHERE user_id=?').bind(user.id), env.DB.prepare('DELETE FROM otp_codes WHERE email=?').bind(user.email),
    env.DB.prepare('DELETE FROM users WHERE id=?').bind(user.id),
  ]);
}

// ---------- خط‌لوله دریافت قیمت (قیمت‌های داخلی طلا و ارز + رمزارزها) ----------
const kvGet = async (env, k) => env.DB ? env.DB.prepare('SELECT v,updated_at FROM kv WHERE k=?').bind(k).first() : null;
const kvPut = async (env, k, v, t) => env.DB ? env.DB.prepare('INSERT INTO kv(k,v,updated_at) VALUES(?,?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v,updated_at=excluded.updated_at').bind(k, JSON.stringify(v), t).run() : null;
const getPrices = async (env) => {
  if (!env.DB) return { updatedAt: 0, items: {} };
  const row = await kvGet(env, 'prices');
  return JSON.parse(row?.v || '{"updatedAt":0,"items":{}}');
};

export function publicPrices(p) {
  const t = nowS(), items = {};
  for (const [id, i] of Object.entries(p.items || {})) {
    if (i.crypto && i.unit !== 'USDT') continue;
    items[id] = {
      price: i.price, change: i.change, updatedAt: i.t, receivedAt: i.receivedAt,
      stale: !i.t || t - i.t > (i.crypto ? CRYPTO_STALE_S : STALE_S), estimated: !!i.estimated,
      currency: i.unit || 'IRT', source: i.src,
      ...(i.crypto ? { kind: 'crypto', name: i.name, symbol: i.sym, volume: i.vol || 0, pair: i.pair }
        : i.kind === 'domestic' ? { kind: 'domestic', name: i.name, symbol: i.sym, cat: i.cat }
        : {})
    };
  }
  return { updatedAt: p.updatedAt || 0, checkedAt: p.checkedAt || 0, items, feeds: p.feeds || {} };
}

async function fetchJSON(url, seconds = 8) {
  const r = await fetch(url, {
    headers: { accept: 'application/json', 'cache-control': 'no-cache', 'user-agent': 'Darayi/1.0 (personal portfolio app)' },
    signal: AbortSignal.timeout(seconds * 1000)
  });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

async function binance(path) {
  let error;
  for (const host of [BINANCE, 'https://api.binance.com/api/v3']) {
    try {
      return await fetchJSON(host + path, 3);
    } catch (e) {
      error = e;
      if (e.message && e.message.includes('403')) break; // اگر مسدود بود وقت را تلف نکن
    }
  }
  throw error || new Error('Binance unreachable');
}

function jalaliToGregorian(jy, jm, jd) {
  jy += 1595; let days = -355668 + 365 * jy + ~~(jy / 33) * 8 + ~~(((jy % 33) + 3) / 4) + jd + (jm < 7 ? (jm - 1) * 31 : (jm - 7) * 30 + 186), gy = 400 * ~~(days / 146097); days %= 146097;
  if (days > 36524) { gy += 100 * ~~(--days / 36524); days %= 36524; if (days >= 365) days++; }
  gy += 4 * ~~(days / 1461); days %= 1461; if (days > 365) { gy += ~~((days - 1) / 365); days = (days - 1) % 365; }
  let gd = days + 1, gm; const sal = [0, 31, (gy % 4 === 0 && gy % 100 !== 0) || gy % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  for (gm = 0; gm < 13 && gd > sal[gm]; gm++) gd -= sal[gm]; return [gy, gm, gd];
}

export function domesticTime(j, now = Date.now()) {
  const d = /^(\d{4})\/(\d{2})\/(\d{2})$/.exec(j.date || ''), h = /^(\d{2}):(\d{2})$/.exec(j.time || ''); if (!d || !h) return Math.floor(now / 1000);
  const [gy, gm, gd] = jalaliToGregorian(+d[1], +d[2], +d[3]), t = (Date.UTC(gy, gm - 1, gd, +h[1], +h[2]) - 12600000) / 1000;
  return t <= now / 1000 + 3600 ? Math.floor(t) : Math.floor(now / 1000);
}

// منابع صرافی‌ها: کوکوین و اوکی‌ایکس اولویت اول هستند زیرا در کلادفلر و ایران پایدارند
const SOURCES = {
  kucoin: {
    async tickers() {
      const j = await fetchJSON('https://api.kucoin.com/api/v1/market/allTickers', 7);
      const list = j && j.data && j.data.ticker;
      if (!Array.isArray(list)) throw new Error('KuCoin bad ticker payload');
      const ts = Math.floor(+j.data.time / 1000);
      return list.filter(x => String(x.symbol).endsWith('-USDT')).map(x => {
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
    async klines(pair, iv, lim) {
      const sec = { '1m': 60, '5m': 300, '1h': 3600, '4h': 14400, '1d': 86400 }[iv];
      const type = { '1m': '1min', '5m': '5min', '1h': '1hour', '4h': '4hour', '1d': '1day' }[iv];
      const end = nowS();
      const j = await fetchJSON(`https://api.kucoin.com/api/v1/market/candles?type=${type}&symbol=${encodeURIComponent(pair)}&startAt=${end - sec * lim}&endAt=${end}`, 6);
      return (j.data || []).map(c => [+c[0], +c[2]]);
    }
  },
  okx: {
    async tickers() {
      const j = await fetchJSON('https://www.okx.com/api/v5/market/tickers?instType=SPOT', 6);
      if (j.code !== '0' || !Array.isArray(j.data)) throw new Error('OKX bad response ' + (j.msg || ''));
      return j.data.filter(x => String(x.instId).endsWith('-USDT')).map(x => ({
        base: x.instId.slice(0, -5),
        pair: x.instId,
        last: +x.last,
        open: +x.open24h,
        vol: +x.volCcy24h,
        ts: Math.floor(+x.ts / 1000)
      }));
    },
    async klines(pair, iv, lim) {
      const bar = { '1m': '1m', '5m': '5m', '1h': '1H', '4h': '4H', '1d': '1D' }[iv];
      const j = await fetchJSON(`https://www.okx.com/api/v5/market/candles?instId=${encodeURIComponent(pair)}&bar=${bar}&limit=${Math.min(lim, 300)}`, 6);
      return (j.data || []).map(c => [Math.floor(+c[0] / 1000), +c[4]]);
    }
  },
  gate: {
    async tickers() {
      const rows = await fetchJSON('https://api.gateio.ws/api/v4/spot/tickers', 7);
      if (!Array.isArray(rows)) throw new Error('Gate bad response');
      const ts = nowS();
      return rows.filter(x => String(x.currency_pair).endsWith('_USDT')).map(x => {
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
    async klines(pair, iv, lim) {
      const j = await fetchJSON(`https://api.gateio.ws/api/v4/spot/candlesticks?currency_pair=${encodeURIComponent(pair)}&interval=${iv}&limit=${lim}`, 6);
      return Array.isArray(j) ? j.map(c => [+c[0], +c[2]]) : [];
    }
  },
  binance: {
    async tickers() {
      const rows = await binance('/ticker/24hr?type=MINI');
      return rows.filter(x => String(x.symbol).endsWith('USDT')).map(x => ({
        base: String(x.symbol).slice(0, -4),
        pair: x.symbol,
        last: +x.lastPrice,
        open: +x.openPrice,
        vol: +x.quoteVolume,
        ts: Math.floor(+x.closeTime / 1000)
      }));
    },
    async klines(pair, iv, lim) {
      return (await binance(`/klines?symbol=${encodeURIComponent(pair)}&interval=${iv}&limit=${lim}`)).map(c => [Math.floor(Math.min(+c[6], Date.now()) / 1000), +c[4]]);
    }
  }
};

export async function refreshPrices(env, force = false) {
  const t = nowS(), owner = rand(16);
  let hasLock = false;
  if (env.DB) {
    try {
      const lease = await env.DB.prepare("INSERT INTO kv(k,v,updated_at) VALUES('refresh-lock',?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v,updated_at=excluded.updated_at WHERE kv.updated_at<? RETURNING k").bind(owner, t, t - 60).first();
      hasLock = !!lease;
      if (!hasLock && !force) {
        return { items: (await getPrices(env)).items || {}, updated: [], busy: true };
      }
    } catch {}
  }

  try {
    const prev = await getPrices(env);
    const items = { ...prev.items }, fresh = new Set(), feeds = { ...(prev.feeds || {}) };
    const put = (id, price, change, src, ts, unit = 'IRT', extra = {}) => {
      if (!(price > 0) || !Number.isFinite(price)) return;
      items[id] = { price, change: Number.isFinite(change) ? change : null, t: ts, receivedAt: t, src, unit, ...extra };
      fresh.add(id);
    };

    // ۱. دریافت نرخ‌های طلا، ارز و سکه از سرویس ایرانی نرخ‌سنج
    const domestic = async () => {
      if (!force && t - (feeds.domestic?.checkedAt || 0) < 60 && feeds.domestic?.ok) return;
      try {
        const j = await fetchJSON('https://nerkh.jahankhahan.shop/data/live.json', 7);
        const ts = domesticTime(j);
        let count = 0;
        for (const [id, keys] of Object.entries(NERKH)) {
          const k = keys.find(k => Number(j.rates?.[k]) > 0);
          if (k) {
            put(id, Number(j.rates[k]), Number(j.change?.[k]), 'nerkhsanj', ts, 'IRT', { kind: 'domestic' });
            count++;
          }
        }
        for (const [id, [key, name, sym, cat]] of Object.entries(DOMESTIC_EXTRA)) {
          const v = Number(j.rates?.[key]);
          if (v > 0) {
            put(id, v, Number(j.change?.[key]), 'nerkhsanj', ts, 'IRT', { kind: 'domestic', name, sym, cat });
            count++;
          }
        }
        if (Number(j.usd?.['silver-ounce']) > 0) {
          put('silver', Number(j.usd['silver-ounce']), NaN, 'nerkhsanj', ts, 'USD', { kind: 'domestic', name: 'انس نقره', sym: 'XAG' });
        }
        if (!count) throw new Error('empty domestic rates');
        feeds.domestic = { ok: true, checkedAt: t, sourceAt: ts, count };
      } catch (e) {
        feeds.domestic = { ...feeds.domestic, ok: false, checkedAt: t, error: String(e.message).slice(0, 100) };
      }
    };

    // ۲. دریافت رمزارزها از صرافی‌های معتبر با اولویت KuCoin و OKX
    const cryptoFeed = async () => {
      if (!force && t - (feeds.crypto?.checkedAt || 0) < 15 && feeds.crypto?.ok) return;
      const order = [...new Set([feeds.crypto?.source, 'kucoin', 'okx', 'gate', 'binance'].filter(Boolean))];
      const errors = [], cap = Math.max(50, Number(env.MAX_COINS) || 350);
      for (const name of order) {
        try {
          const rows = (await SOURCES[name].tickers()).filter(x => x.last > 0 && Number.isFinite(x.ts) && (x.vol || 0) >= 2000 && /^[\p{L}\p{N}]{1,30}$/u.test(String(x.base)) && !NON_CRYPTO.has(String(x.base).toLowerCase()) && !EXCLUDED_STABLES.has(String(x.base).toLowerCase())).sort((x, y) => y.vol - x.vol).slice(0, cap);
          if (rows.length < 15) throw new Error('insufficient pairs: ' + rows.length);
          const seen = new Set();
          for (const x of rows) {
            const base = String(x.base);
            const id = /^[A-Z0-9]{1,20}$/.test(base) ? base.toLowerCase() : 'c' + (await sha256(base)).replace(/[-_]/g, '').slice(0, 18).toLowerCase();
            put(id, x.last, x.open > 0 ? (x.last / x.open - 1) * 100 : NaN, name, Math.min(x.ts, t), 'USDT', {
              crypto: 1,
              name: ASSETS[id] || base,
              sym: base,
              pair: x.pair,
              vol: x.vol || 0
            });
            seen.add(id);
          }
          for (const id of Object.keys(items)) {
            if (items[id].crypto && !seen.has(id)) delete items[id];
          }
          feeds.crypto = { ok: true, checkedAt: t, count: rows.length, source: name };
          return;
        } catch (e) {
          errors.push(name + ': ' + String(e.message).slice(0, 60));
        }
      }
      feeds.crypto = { ...feeds.crypto, ok: false, checkedAt: t, error: errors.join(' | ').slice(0, 220) };
    };

    await Promise.allSettled([domestic(), cryptoFeed()]);

    const histDue = t - (feeds.histAt || 0) >= 300;
    if (histDue) feeds.histAt = t;
    const data = { items, feeds, updatedAt: fresh.size ? t : prev.updatedAt || t, checkedAt: t };

    if (env.DB) {
      const stmts = [env.DB.prepare("INSERT INTO kv(k,v,updated_at) VALUES('prices',?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v,updated_at=excluded.updated_at").bind(JSON.stringify(data), t)];
      if (histDue) {
        const ids = [...fresh].filter(id => !items[id].crypto && items[id].t);
        for (let i = 0; i < ids.length; i += 30) {
          const part = ids.slice(i, i + 30);
          stmts.push(env.DB.prepare('INSERT OR IGNORE INTO price_history_v2(asset_id,t,price) VALUES ' + part.map(() => '(?,?,?)').join(',')).bind(...part.flatMap(id => [id, items[id].t, items[id].price])));
        }
      }
      try {
        await env.DB.batch(stmts);
      } catch (e) {
        console.error('save batch failed, saving top items', e?.message);
        // بهینه‌سازی ذخیره‌سازی برای جلوگیری از رد شدن در D1
        const compactItems = {};
        for (const [id, val] of Object.entries(items)) {
          if (!val.crypto || (val.vol || 0) > 10000) compactItems[id] = val;
        }
        await env.DB.prepare("INSERT INTO kv(k,v,updated_at) VALUES('prices',?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v,updated_at=excluded.updated_at").bind(JSON.stringify({ ...data, items: compactItems }), t).run();
      }
    }
    return { items, updated: [...fresh] };
  } finally {
    if (env.DB && hasLock) {
      try { await env.DB.prepare("DELETE FROM kv WHERE k='refresh-lock' AND v=?").bind(owner).run(); } catch {}
    }
  }
}

// استخراج سریع و بهینه تاریخچه بدون بارگذاری ۲ مگابایت JSON در حافظه
async function archiveHistory(id, range) {
  const key = (NERKH[id] || [])[0] || (DOMESTIC_EXTRA[id] || [])[0];
  if (!key) return [];
  try {
    const r = await fetch('https://nerkh.jahankhahan.shop/data/rates.json', {
      headers: { accept: 'application/json', 'user-agent': 'Darayi/1.0 (personal portfolio app)' },
      signal: AbortSignal.timeout(8000),
      cf: { cacheTtl: 3600, cacheEverything: true }
    });
    if (!r.ok) return [];
    const text = await r.text();
    const marker = '"key":"' + key + '"';
    const idx = text.indexOf(marker);
    if (idx === -1) return [];
    const daysIdx = text.indexOf('"days":', idx);
    const endDaysIdx = text.indexOf(']]', daysIdx);
    if (daysIdx === -1 || endDaysIdx === -1) return [];
    const days = JSON.parse(text.slice(daysIdx + 7, endDaysIdx + 2));
    const n = { '1D': 3, '3D': 5, '1W': 8, '1M': 32, '1Y': 367 }[range] || 8;
    const out = [];
    for (const [d, v] of days.slice(-n)) {
      const m = /^(\d{4})\/(\d{2})\/(\d{2})$/.exec(d);
      if (!m || !(v > 0)) continue;
      const [gy, gm, gd] = jalaliToGregorian(+m[1], +m[2], +m[3]);
      out.push([Math.floor(Date.UTC(gy, gm - 1, gd, 12) / 1000) - 12600, Number(v)]);
    }
    return out;
  } catch (e) {
    console.error('archiveHistory extract failed:', e.message);
    return [];
  }
}

async function history(env, url) {
  const id = url.searchParams.get('id') || '', range = url.searchParams.get('range') || '1D';
  if (!/^[a-z0-9]{1,20}$/.test(id) || !Object.hasOwn(RANGES, range)) throw new HttpError(400, 'پارامتر نامعتبر است.');
  const prices = await getPrices(env);
  const it = prices.items?.[id];

  // ۱. تاریخچه رمزارزها
  if (it?.crypto) {
    const key = 'h:' + id + ':' + range;
    const row = await kvGet(env, key).catch(() => null);
    const t = nowS();
    if (row && t - row.updated_at < 90) return json({ id, range, currency: 'USDT', points: JSON.parse(row.v) });
    const [iv, lim] = KL[range], base = it.sym;
    for (const name of [...new Set([it.src, 'kucoin', 'okx', 'gate', 'binance'])]) {
      const src = SOURCES[name];
      if (!src) continue;
      try {
        const pair = name === it.src ? it.pair : name === 'binance' ? base + 'USDT' : name === 'gate' ? base + '_USDT' : base + '-USDT';
        const points = (await src.klines(pair, iv, lim)).filter(p => Number.isFinite(p[0]) && p[1] > 0).sort((a, b) => a[0] - b[0]);
        if (points.length >= 2) {
          await kvPut(env, key, points, t).catch(() => {});
          return json({ id, range, currency: 'USDT', source: name, points });
        }
      } catch {}
    }
    if (row) return json({ id, range, currency: 'USDT', points: JSON.parse(row.v), stale: true });
    return json({ id, range, currency: 'USDT', points: [], unavailable: true });
  }

  // ۲. تاریخچه طلا، سکه و ارزهای داخلی
  if (!Object.hasOwn(ASSETS, id) && !DOMESTIC_EXTRA[id]) throw new HttpError(400, 'پارامتر نامعتبر است.');
  const span = RANGES[range], bucket = Math.max(60, Math.floor(span / 288));
  let points = [];
  if (env.DB) {
    try {
      const r = await env.DB.prepare('SELECT MAX(t) AS t, AVG(price) AS price FROM price_history_v2 WHERE asset_id=? AND t>=? GROUP BY CAST(t*1.0/? AS INTEGER) ORDER BY t').bind(id, nowS() - span, bucket).all();
      points = r.results.map(p => [p.t, p.price]);
    } catch {}
  }
  if (range !== '1H' && (!points.length || points.at(-1)[0] - points[0][0] < span * 0.7)) {
    try {
      const old = await archiveHistory(id, range);
      if (old.length) points = [...old.filter(p => !points.length || p[0] < points[0][0]), ...points];
    } catch (e) {
      console.error('archive failed', e.message);
    }
  }
  return json({ id, range, currency: it?.unit || 'IRT', points });
}

// ---------- سیستم ارسال هشدارها ----------
export async function checkAlerts(env, items) {
  if (!env.DB) return 0;
  if (!(env.MAIL_WEBHOOK_URL && env.MAIL_WEBHOOK_SECRET || env.RESEND_API_KEY && env.MAIL_FROM || env.EMAIL && env.MAIL_FROM)) return 0;
  const t = nowS(); let sent = 0;
  const rows = (await env.DB.prepare(`SELECT a.id,a.asset_id,a.direction,a.price,a.attempts,COALESCE(c.currency,'IRT') AS currency,COALESCE(g.version,'legacy') AS version,u.email,u.name FROM alerts a LEFT JOIN alert_units c ON c.alert_id=a.id LEFT JOIN alert_state g ON g.alert_id=a.id JOIN users u ON u.id=a.user_id LEFT JOIN alert_delivery d ON d.alert_id=a.id WHERE a.triggered_at IS NULL AND a.attempts<5 AND COALESCE(d.retry_at,0)<=unixepoch() AND COALESCE(d.lease_until,0)<=unixepoch()`).all()).results;
  for (const a of rows) {
    let cur = items[a.asset_id];
    if (!cur || !cur.t || (cur.crypto && cur.unit !== 'USDT') || t - cur.t > (cur.crypto ? CRYPTO_STALE_S : STALE_S)) continue;
    if (a.currency === 'IRT' && cur.crypto) {
      const fx = items.usdt;
      if (!fx || !fx.t || t - fx.t > STALE_S) continue;
      cur = { ...cur, price: cur.price * fx.price, crypto: false, unit: 'IRT' };
    }
    if (!(a.direction === 'above' ? cur.price >= a.price : cur.price <= a.price)) continue;
    const claim = await env.DB.prepare('INSERT INTO alert_delivery(alert_id,lease_until,retry_at) VALUES(?,?,0) ON CONFLICT(alert_id) DO UPDATE SET lease_until=excluded.lease_until WHERE alert_delivery.lease_until<? AND alert_delivery.retry_at<=?').bind(a.id, t + 120, t, t).run();
    if (claim.meta.changes !== 1) continue;
    const unit = a.currency === 'USDT' ? 'USDT' : a.currency === 'USD' ? 'دلار' : 'تومان';
    const name = items[a.asset_id]?.name || ASSETS[a.asset_id] || a.asset_id.toUpperCase();
    const fa = (n) => Number(n).toLocaleString('fa-IR', { maximumSignificantDigits: 8 });
    const dir = a.direction === 'above' ? 'بالاتر از' : 'پایین‌تر از';
    try {
      await sendMail(env, {
        deliveryId: 'alert-' + await sha256(a.id + ':' + a.price + ':' + a.direction + ':' + a.currency + ':' + a.version),
        to: a.email,
        subject: `هشدار قیمت: ${name}`,
        text: `${name} به ${dir} ${fa(a.price)} ${unit} رسید. قیمت فعلی: ${fa(cur.price)} ${unit}.`,
        html: mailShell(`هشدار قیمت ${name}`, `<p style="color:#444;line-height:1.9">${esc(name)} <b>${dir} ${fa(a.price)} ${unit}</b> رسید.</p><p style="font-size:22px;font-weight:800;color:#17231e;margin:6px 0">${fa(cur.price)} <span style="font-size:13px">${unit}</span></p><p style="font-size:12px;color:#8a8f88">این هشدار فقط یک بار ارسال می‌شود. برای فعال‌سازی دوباره، آن را در برنامه ویرایش کن.</p>${btn(env.APP_URL || '#', 'باز کردن دارایی من')}`)
      });
      await env.DB.prepare("UPDATE alerts SET triggered_at=? WHERE id=? AND triggered_at IS NULL AND asset_id=? AND price=? AND direction=? AND COALESCE((SELECT version FROM alert_state WHERE alert_id=alerts.id),'legacy')=?").bind(t, a.id, a.asset_id, a.price, a.direction, a.version).run();
      sent++;
    } catch (e) {
      console.error('alert mail failed', e.message);
      await env.DB.batch([env.DB.prepare('UPDATE alerts SET attempts=attempts+1 WHERE id=?').bind(a.id), env.DB.prepare('UPDATE alert_delivery SET lease_until=0,retry_at=? WHERE alert_id=?').bind(t + Math.min(3600, 60 * 2 ** a.attempts), a.id)]);
    }
  }
  return sent;
}

export async function runCron(env) {
  const { items } = await refreshPrices(env);
  const sent = await checkAlerts(env, items);
  const t = nowS();
  if (env.DB) {
    try {
      await env.DB.batch([
        env.DB.prepare('DELETE FROM alert_delivery WHERE NOT EXISTS(SELECT 1 FROM alerts WHERE id=alert_id)'),
        env.DB.prepare('DELETE FROM alert_units WHERE NOT EXISTS(SELECT 1 FROM alerts WHERE id=alert_id)'),
        env.DB.prepare('DELETE FROM alert_state WHERE NOT EXISTS(SELECT 1 FROM alerts WHERE id=alert_id)'),
        env.DB.prepare('DELETE FROM sessions WHERE expires_at<?').bind(t),
        env.DB.prepare('DELETE FROM otp_codes WHERE expires_at<?').bind(t),
        env.DB.prepare('DELETE FROM oauth_states WHERE expires_at<?').bind(t),
        env.DB.prepare('DELETE FROM price_history_v2 WHERE t<?').bind(t - 400 * 86400),
        env.DB.prepare("DELETE FROM rate_limits WHERE ((k LIKE 'put:%' OR k LIKE 'key:%') AND win<?) OR ((k NOT LIKE 'put:%' AND k NOT LIKE 'key:%') AND win<?)").bind(Math.floor(t / 60) - 60, Math.floor(t / 900) - 4)
      ]);
    } catch {}
  }
  return { sent };
}

export async function refreshMeta(env) {
  if (env.DB) {
    try { await env.DB.prepare("DELETE FROM kv WHERE k LIKE 'h:%' AND updated_at<?").bind(nowS() - 86400).run(); } catch {}
  }
}

// ---------- مسیریابی درخواست‌ها ----------
async function route(req, env, url, ctx) {
  const p = url.pathname, m = req.method;

  if (p === '/api/health') {
    return json({
      ok: true,
      database: !!env.DB,
      google: !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
      email: !!(env.MAIL_WEBHOOK_URL && env.MAIL_WEBHOOK_SECRET || env.RESEND_API_KEY && env.MAIL_FROM),
      time: nowS()
    }, 200, { 'access-control-allow-origin': '*' });
  }

  // دریافت لحظه‌ای قیمت‌ها: در دسترس همیشگی، بدون پرتاب خطای ۵۰۰ یا ۵۰۳
  if (p === '/api/prices' && m === 'GET') {
    let prices = { updatedAt: 0, items: {}, feeds: {} };
    try { prices = await getPrices(env); } catch (e) { console.error('getPrices error:', e?.message); }

    const manual = url.searchParams.get('refresh') === '1';
    const age = nowS() - (prices.checkedAt || 0);
    const limit = manual ? 8 : Number(env.INLINE_REFRESH_S || 120);
    const empty = !Object.keys(prices.items || {}).length;

    if (empty || age >= limit) {
      const job = (async () => {
        try {
          await refreshPrices(env, manual);
        } catch (e) {
          console.error('refresh failed', e?.message);
          if (env.DB) {
            try { await kvPut(env, 'last-error', { m: String(e?.message).slice(0, 160) }, nowS()); } catch {}
          }
        }
      })();
      if (manual || empty) {
        await Promise.race([job, new Promise(r => setTimeout(r, 6500))]);
        try { prices = await getPrices(env); } catch {}
      } else if (ctx && ctx.waitUntil) {
        ctx.waitUntil(job);
      }
    }
    const out = publicPrices(prices);
    if (env.DB) {
      try {
        const le = await kvGet(env, 'last-error');
        if (le && nowS() - le.updated_at < 3600) out.feeds = { ...(out.feeds || {}), lastError: JSON.parse(le.v).m };
      } catch {}
    }
    return json(out, 200, { 'access-control-allow-origin': '*' });
  }

  if (p === '/api/health' && m === 'GET') {
    return json({
      ok: true,
      google: !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
      email: !!(env.MAIL_WEBHOOK_URL || env.RESEND_API_KEY || env.EMAIL),
      db: !!env.DB
    });
  }

  if (p === '/api/history' && m === 'GET') {
    return await history(env, url);
  }

  // سایر متدهای تغییر وضعیت
  if (m !== 'GET' && m !== 'HEAD') {
    const o = req.headers.get('origin');
    if (o && o !== url.origin && req.headers.get('sec-fetch-site') === 'cross-site') {
      throw new HttpError(403, 'Forbidden');
    }
  }

  if (p === '/api/auth/register/start' && m === 'POST') return registerStart(req, env);
  if (p === '/api/auth/register/verify' && m === 'POST') return registerVerify(req, env, url);
  if (p === '/api/auth/login' && m === 'POST') return login(req, env, url);
  if (p === '/api/auth/reset/start' && m === 'POST') return resetStart(req, env);
  if (p === '/api/auth/reset/verify' && m === 'POST') return resetVerify(req, env);
  if (p === '/api/auth/reset/finish' && m === 'POST') return resetFinish(req, env, url);
  if (p === '/api/auth/google/start' && m === 'GET') return googleStart(env, url);
  if (p === '/api/auth/google/callback' && m === 'GET') return googleCallback(env, url, req);
  if (p === '/api/auth/logout' && m === 'POST') {
    const sid = getCookie(req, 'sid');
    if (sid && env.DB) await env.DB.prepare('DELETE FROM sessions WHERE id_hash=?').bind(await sha256(sid)).run();
    return json({ ok: true }, 200, { 'set-cookie': `sid=; ${cookieOpts(url, 0)}` });
  }

  const user = await currentUser(req, env);
  if (p === '/api/me' && m === 'GET') return json({ user: user ? { email: user.email, name: user.name } : null });
  if (!user) throw new HttpError(401, 'برای ادامه وارد شو.');
  if (p === '/api/me' && m === 'DELETE') { await deleteAccount(env, user); return json({ ok: true }, 200, { 'set-cookie': `sid=; ${cookieOpts(url, 0)}` }); }
  if (p.startsWith('/api/me/alerts/') && p.endsWith('/retry') && m === 'POST') {
    await rateLimit(env, 'retry:' + user.id, 10, 900);
    const localId = p.slice('/api/me/alerts/'.length, -'/retry'.length);
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(localId)) throw new HttpError(400, 'شناسه نامعتبر است.');
    const id = user.id + ':' + localId;
    const row = await env.DB.prepare('SELECT id FROM alerts WHERE id=? AND user_id=?').bind(id, user.id).first();
    if (!row) throw new HttpError(404, 'هشدار پیدا نشد.');
    await env.DB.batch([
      env.DB.prepare('UPDATE alerts SET triggered_at=NULL,attempts=0 WHERE id=? AND user_id=?').bind(id, user.id),
      env.DB.prepare('DELETE FROM alert_delivery WHERE alert_id=?').bind(id),
      env.DB.prepare('INSERT INTO alert_state(alert_id,version) VALUES(?,?) ON CONFLICT(alert_id) DO UPDATE SET version=excluded.version').bind(id, rand(16))
    ]);
    return json({ ok: true });
  }
  if (p === '/api/me/data' && m === 'GET') return json(await loadData(env, user.id));
  if (p === '/api/me/data' && m === 'PUT') { await rateLimit(env, 'put:' + user.id, 120, 60); return json(await saveData(env, user.id, await readJson(req))); }
  throw new HttpError(404, 'Not found');
}

// آیکون‌های استاندارد PWA
const ICON192 = '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';
const ICON512 = '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';
const ICONM = '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';
const ICON180 = 'iVBORw0KGgoAAAANSUhEUgAAALQAAAC0CAYAAAA9zQYyAAAIi0lEQVR42u3d228cVwHH8d85OztrZ23S7KZJKmLHapQS2Q4SNBf1IiGlUv+B5gFcivKQFrUvIJKCKkG1kfoGETwj3hCREEFCVS7EViqUFhUCtEEQ+kyMRGzHJsReO+udmcPDxsZufFknu+7O2e/3OdIejT8+PtmZM8fsHHjSiciTLJeAAE0EaCJAEwGaAE0EaCJAEwGaCNAEaCJAEwGaCNBEgCZAEwGaCNBEgCYCNAGaCNBEgCYCNBGgCdBEgCYCNBGgiQBNgCYCNBGgiQBNBGgCNBGgiQBNBGgCNJE3BVyC5mespPvHmzqOOQV0qjEbqTKXyEnKhVbGgpolR0rLBEaTt+c1dKJXpR/1q1yO5FwNOTFDpw7z1MS8Xnltj0597yl1yiqqJiq9+Yny+YyMYaYGdMowD53oVel0v8pxpOmkqqFjvZIxKp28oXxXAOpmXPuuHdtKXIbmYnZWymSMZqNYhwcLKvbkNHJ+TNnQsvxgDZ0+zAtoM4HRVDSvoZd6VDozoPIMa2pApxTzsn8HakD7gBnUgPYOM6gB7R1mUAPaO8ygBrR3mEENaO8wgxrQ3mEGNaC9wwxqQHuHGdSA9g4zqAHtHWZQA9o7zKAGtHeYQQ1o7zCDGtDeYQb1Bq4RO1bSgXlxBrJLdr7szmnk/Dg7XwCdTsyroX7v0rjCMCO2JwJ6UzAniZNLJGNNQ1GXq7GePVBUNXS6cmFc3VsDJQmgS2BuHuY4ceq0GXXYjCpJImMajDqO9MyRou7MVHXt/SnluwO5NkZtwdw8zFHkVLCh/vTnKf3yV/9SwYaKowYuDIxkMkb3klil0/0aOtGrqYl5ZYL2XVAHYG4e5seCrD66cUff/ebfNDFWUWCNvvpSj6aixqEzpvbavHIcqXS6X5J09mc3VXi8wb88LDnA/Ncb/9Xr3/hI5ZlYXZ8LdPndW9rek9PhwYJmo1jWNhC1kapJoheP7tTk3Xld+6A9lx9tBfozwTwdqaMzI5c4ZUOr4fNjKoIa0GnGHMduEV02tBoBNaDTjnkpOlAD2gvMoAa0d5hBDWjvMIMa0KnGbKxktPLnL0XNV3qAbn3MRqrcSxRFThlragcIrYJ6+PyYtvfmdHBgG6gB3XqYM4HR7Yl5HX+jTy8NfV6X37216qOexkpBYPW74Qkd+kpBe5/Ig7qdQbci5qmJeX391T166/v79aX9W1XYHWrkwriy2RVQu9pb/p2Trlwa19PPFdS3awuo2xF0q2JeGM9cHGs6jnTkQHHN4yick4Ks1Ww51sjFMR18HtRtB7rVMa94xsoaO02ck8LQaq4caxjU7QU6LZgXxlPvThNQtyHotGFeqN6dJqBuI9BpxbwMdR07TUDdBqDTjrmmqCYpdm5dRKD2GLQXmJciUn2IQO0haGONJscrevnVPU3dnV3IhLpe1+3sRx/PSoj+cHVSW7oCffp/iiuh3rsrr7kkbtjG242MB9CPiLkyF+v463166wf7NRfHTcHcYTL68I9T+tZr11WeidfE3KjxLEX0wtEdqkSJrl+7oyC0q6OeTTR8cUxf+GK39uzeoqpLmoJ6vfG0YqnZ9e2ctK+/Sx2yqiZJ418C46TAGI2Ozur2rYpyHVZJ4jZlPOY+oA5Z7evvWvNA+yRxynVY3b5V0ejorIKFtUsjJ5ANjIcZ+mEu8P316uXf3FKxJ9SRA8WGrh8XZ90k0eHBgnb2daz93EWDxxNHTsVsTmfP3dTb376hznxGZrXZ00kz05He+cmgho716m5Slc009re73vEA+hFnjcVnh3c3/jHL2mfUbnwcGihoe09Ow6vcom7keOLIqRCEOntuVKVT/1C+O1iEuxLm8kyk02cG9LWF1yE0AXM94wF0o1H3NAf1srt5azx3sRrqcjWue8ZcxPPrUZVO3VC+a33MpTMDGmrwuz02Oh5AtwPqC+Mq7s7p2QNFleNIMmbNdfUyPCdbDPPJdGJOJeiWRZ21eu+3E6pmnJ45UlDsnJxW/uYDzIBOBeowtLpyaVx3piO9eHSnqkkiZ5ajBjOgU4PaSereGuja+1OavDv/AGowA7rlUC/99sNa88APP0mkfHegax8sR12Nk9pXYWAGdCuivnx+TBlrlAnsAwjcp1C/cHSHHstk9YtzN1V68xMwA7q1UB8aLOiJPR36/dVJVSu1lzCuhvrDq5OqxIn+PXlPb3+HmbnpDnYOPOnNS4Q3C0UUORWDUH/5+3/0xvGPNXM3Uuc6rzFwknKhlbFgZoZuwZm6HMXq25XXwecKGrk4prlyrHCFmVqSgtAoCAwzM6Bbf/nRt2uLDj5f0PBaqN1n+xelXTB7C7olUYMZ0L6iBjOgvUENZkB7gxrMgPYGtQRmQPuCejZRkLWama49nA9mQKca9ciFMU1NzOudHw/+f6cJmAHdFNQPsdNkI6j37srrqae79OUj2/TysV4wN/tn69Ot742idk4ql2OVftivV4716nZckbGmKYfXBzKaSaKG/iUAMzP0gzP1BnaaPNRMbYyqSaL5JGnK7mwwA/oB1PXsNHm0zzAyzMyA3qzW22nSaoEZ0Ou22k6TVkMNZkDXP1O3OGowA9ob1GAGtDeowQxob1CDGdDeoAYzoL1BDWZAe4MazID2BjWYAe0NajAD2hvUYAa0N6jBDGhvUIMZ0N6gBjOgvUENZkB7gxrMgPYGNZgB7Q1qMAPaG9T1nrFCgG551PWesUKPXsAlaE5x5FR4PNTPf/pPdW7JaN/+rtrZ2WBuam37oplNu8B1nLFCzNDpWX44KddpF4+lADOgvVhT0+ZkuQQEaCJAEwGaCNAEaCJAEwGaCNBEgCZAEwGaCNBEgCYCNAGaCNBEgCYCNBGgCdBEgCYCNBGgiQBNgCYCNBGgiQBNBGgCNBGgiQBNBGgiQBOgiQBNBGgiQBOgibzpf+nR3gaqjm8mAAAAAElFTkSuQmCC';
const MANIFEST = {
  name: 'دارایی من',
  short_name: 'دارایی من',
  description: 'پیگیری قیمت طلا، ارز و رمزارز و مدیریت سبد دارایی',
  lang: 'fa',
  dir: 'rtl',
  start_url: '/?source=pwa',
  scope: '/',
  display: 'standalone',
  background_color: '#f5f5f0',
  theme_color: '#172b22',
  icons: [
    { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
  ]
};
const SW_JS = `const V='darayi-v2';
self.addEventListener('install',e=>{e.waitUntil(caches.open(V).then(c=>c.addAll(['/','/manifest.webmanifest','/icons/icon-192.png','/icons/icon-512.png'])).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==V).map(x=>caches.delete(x)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{
  const r=e.request,u=new URL(r.url);
  if(r.method!=='GET'||u.origin!==location.origin||u.pathname.startsWith('/api/')||u.pathname.startsWith('/v1/'))return;
  if(r.mode==='navigate'){
    e.respondWith(fetch(r).then(res=>{const c=res.clone();caches.open(V).then(x=>x.put('/',c));return res}).catch(()=>caches.match('/')));
    return;
  }
  e.respondWith(caches.match(r).then(m=>m||fetch(r)));
});`;

const b64bytes = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
function staticResponse(path) {
  if (path === '/manifest.webmanifest') return new Response(JSON.stringify(MANIFEST), { headers: { 'content-type': 'application/manifest+json; charset=utf-8', 'cache-control': 'public, max-age=3600' } });
  if (path === '/sw.js') return new Response(SW_JS, { headers: { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-cache', 'service-worker-allowed': '/' } });
  const icon = { '/icons/icon-192.png': ICON192, '/icons/icon-512.png': ICON512, '/icons/maskable-512.png': ICONM, '/apple-touch-icon.png': ICON180, '/favicon.ico': ICON192 }[path];
  return icon ? new Response(b64bytes(icon), { headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=86400' } }) : null;
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);

    // پاسخ‌دهی به فایل‌های استاتیک PWA
    const st = staticResponse(url.pathname);
    if (st) return st;

    // مسیرهای API
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/v1/')) {
      try {
        return await route(req, env, url, ctx);
      } catch (e) {
        if (e instanceof HttpError) return json({ error: e.message }, e.status);
        console.error('unhandled route error:', e && e.stack || e);
        return json({ error: 'خطای سرور: ' + (e?.message || 'نامشخص') }, 500);
      }
    }

    // سرو صفحه اصلی PWA
    if (typeof APP_HTML === 'string') {
      return new Response(APP_HTML, {
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-cache',
          'x-content-type-options': 'nosniff'
        }
      });
    }

    return new Response('سایت بارگذاری نشد. فایل worker.js ساخته‌شده را استفاده کنید.', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  },
  scheduled(event, env, ctx) {
    ctx.waitUntil(event.cron === '17 3 * * *' ? refreshMeta(env) : runCron(env));
  }
};
