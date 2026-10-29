# دارایی من (Darayi) — Project Handoff

> **Read this first.** It is written for the next AI assistant / developer taking over. It explains who the user is, what the product is, how it got here, what is deployed, what is verified vs. not verified, and what to do next. Written by Claude (Anthropic) at the end of a long working session. Items marked **[UNVERIFIED]** were not confirmed on the real Cloudflare deployment.

---

## 0. TL;DR

- **Product:** a Persian (fa, RTL), **mobile-first** web app + PWA to track prices (Iranian toman rates for currencies/gold/coins, plus ~600 crypto coins), a personal portfolio (purchases ledger), watchlist, price alerts (with e-mail on trigger), and optional accounts (e-mail+password with 6-digit e-mail codes, plus Google login) so each user's data lives in their account.
- **Stack:** one **Cloudflare Worker** (API + cron + serves the page) + **D1** (SQLite) on the **FREE plan**. Frontend is a **single HTML file** (vanilla JS, no framework/build). E-mail is sent through a **Google Apps Script** web hook (Gmail), because Cloudflare e-mail sending needs a paid plan.
- **Deployed by the user (non-technical) through the Cloudflare dashboard** by pasting one file (`dist/worker.js`) — no CLI, no GitHub. Live URL the user gave: `https://darayi.clearworks.workers.dev`.
- **Audience:** the user and friends only (not public, no money to spend). Possible later: a paid price API for others (not done).
- **Latest state:** Claude delivered a final bundle (“fixed3”) that makes `/api/prices` resilient, adds multi-exchange crypto sources, 16 extra Iranian series, PWA, desktop layout, etc. **It is not confirmed that the user deployed it yet.** This project folder = that bundle + one extra fix (PBKDF2 default, see §10).

---

## 1. The user and how to work with them

- Persian speaker, based in **Iran**; **no programming knowledge**. Needs **exact click-by-click steps** (Cloudflare dashboard UI in English). Replies must be **in Persian**, short, step-wise. Mobile reading (screen ≈ 6–8 sentences).
- **Hard constraints:** pay nothing (no Workers Paid, no domain for now), only the user + friends use it, **mobile UI is top priority and must not change** when working on desktop, **“don't create new bugs, only fix”**.
- Likes: honest status, “say what you did / didn't verify”. Dislikes: waiting hours for prices, flickering/jumping UI, English labels where Persian fits, clutter.
- They work in the Cloudflare dashboard (Edit code → paste whole `worker.js` → Deploy). Anything that requires CLI/wrangler/GitHub is a bad fit.
- Iran-specific risks: `workers.dev`, Google Cloud, Apps Script may need a VPN during setup; Google login may not work for friends without VPN (e-mail+password path exists for that reason). Binance is geo-blocked/403 for the Worker.
- They also used **ChatGPT** for a while in the middle (see §8) and then came back with ChatGPT's modified files. Those modifications are in this codebase.

---

## 2. Product requirements (consolidated from the whole conversation)

**Core**
1. Home/dashboard: hero card (portfolio value, invested, P/L), “featured prices” grid, top gainers / top losers (horizontal-scroll strips, 8 each, **separate sections**), portfolio allocation donut, price alerts preview.
2. **Featured prices:** user can **drag & drop to reorder** (long-press on touch, immediate on mouse; auto-scroll; saved), can add/remove assets (✎ picker with search & checkboxes, **max 16**). Card shows: icon, Persian name, **Latin symbol right-aligned** (e.g. USD), big price, change chip (+/−, green/red, **no arrow**) and sparkline **as separate elements**, source line.
3. Market page: all assets, filters (all/currency/gold/crypto/global), search (Persian + Latin), pagination (“نمایش بیشتر”, 60 per page).
4. Watchlist: star toggle (★→☆ then removed; **no “remove” text button**), alerts list with edit + delete.
5. Portfolio (“سبد من”): ledger of purchases (“تاریخچهٔ معاملات”), editable; **no duplicate “my assets” list**; donut (slightly thinner/smaller than first version, centered, no heading text).
6. **Buy form = buy only** (no “type”, no wallets/transfer fields visible; hidden inputs keep the data model). Under the price field: link **“قیمت الان”** fills current price; segmented **تومان | دلار** toggle to enter price in USD (converted to toman at today's dollar rate and shown as “≈ … تومان”).
7. Alert form: asset picker identical to the buy form (searchable list), direction (above/below), target price. **Alert e-mail** when price crosses; one-shot; editing re-arms.
8. Detail modal per asset: chart with range tabs **placed under the chart and its caption/note** (1H, 1D, 3D, 1W, 1M, 1Y), buttons compact (buy / alert / watchlist) in one row.
9. **Settings page removed from the UI** (kept in DOM as `hidden` because old JS still references its elements). Only a **dark-mode icon (☾/☀) at the top of the dashboard**. Privacy icon (◉) hides amounts. Unit toman (rial option exists in code but has no UI).
10. Dashboard's three stat boxes (assets/trades/watchlist) removed (`.quick-grid{display:none}`).
11. All “no history” texts (“بدون تاریخچه”, “تاریخچه کافی نیست”) removed everywhere (empty chart ⇒ empty box, hidden by CSS `:empty`/`:has`).
12. Every asset has a **Persian name**; for coins without a known Persian name, the symbol is spelled in Persian letters (USDC → «یو اس دی سی»). Dictionary `FA_COIN` (~150 entries, from memory/Iranian-exchange conventions — **[UNVERIFIED]** against Nobitex/Wallex/etc.).
13. **Installable PWA** (phone + Windows): manifest, service worker, icons, install button (Chrome/Edge prompt; iOS shows “Add to Home Screen” instructions).
14. **Desktop UI** redesigned from scratch **without touching mobile**: media query ≥1100px → right sidebar nav, wide grids, centered dialog modals.

**Accounts**
- Login button on top of dashboard → modal: e-mail + password + “Login”; below it **Google button**; below that two links **“ثبت نام”** and **“فراموشی رمز عبور”**.
- **Register:** name, e-mail, password, repeat password → “تأیید” → 6-digit code e-mailed → enter → “تأیید” → account created + logged in.
- **Forgot password:** e-mail → “تأیید” → 6-digit code → enter → new password + repeat → saved in D1 (all old sessions revoked) → logged in.
- Each user's holdings/watchlist/alerts/featured/settings are stored server-side and synced; local-only mode still works when logged out.

**Data**
- Prices: Iranian toman rates + gold/coins (free API Nerkhsanj), crypto (~600+ coins) from exchange public APIs, converted to toman via the USDT/toman rate. “Do not take two hours for prices to show.” Live updates in-session (poll 15 s; cron every minute).
- History for charts: crypto from exchange klines; Iranian assets from own snapshots + Nerkhsanj daily archive **[archive part UNVERIFIED]**.
- Possible future: sell a public price API to others (`/v1/prices` with API keys exists; legal/ToS of upstream sources must be checked first).

---

## 3. Architecture

```
Browser (single HTML, PWA)  ──►  Cloudflare Worker (dist/worker.js)  ──►  D1 (SQLite)
   localStorage cache              • serves page + manifest + sw + icons        tables: see schema.sql
   polls /api/prices 15s           • /api/* JSON API, /v1/* public API
   WebSocket to Binance*           • cron: every minute prices+alerts; 03:17 UTC meta
                                   • outbound: Nerkhsanj, exchanges (KuCoin/OKX/Gate/Binance), Google OAuth,
                                     Apps Script e-mail web hook
```
\* The browser opens a Binance WebSocket for live ticks (added by ChatGPT). It is blocked in Iran, harmless but noisy; the app works without it.

### Files in this folder
| Path | What |
|---|---|
| `src/worker.js` | Worker source (API, auth, prices, alerts, cron, PWA static routes). **No page inside.** |
| `src/index.html` | The whole frontend (HTML+CSS+JS, ~135 KB, 89 top-level functions). |
| `scripts/build.mjs` | `node scripts/build.mjs` → **`dist/worker.js`** = `const APP_HTML = "<page>"` + `src/worker.js`. This is the **only file the user deploys**. |
| `dist/worker.js` | Built artifact (committed for convenience). |
| `schema.sql` | D1 schema (idempotent `CREATE TABLE IF NOT EXISTS`). User ran it in the dashboard Console. |
| `apps-script/Code.gs` | Gmail sender web hook (hardened by ChatGPT: lock, dedupe by `deliveryId`, quota check). |
| `scripts/make-icons.py` | Generates the PWA icons (PIL). Icons are base64-embedded in `src/worker.js`. |
| `tools/local-server.mjs` | Local test server (Node ≥ 22, `node:sqlite` as D1) with **mocked** upstreams. |
| `tools/ui-smoke-*.py` | Playwright smoke tests (mobile 390px / desktop 1440px) used for screenshots. |
| `docs/GUIDE-FA.md` | Persian deployment guide (written earlier; see §6 for needed corrections). |
| `legacy/modular-v1/` | **Older** multi-file implementation (src/index.js + 13 passing node tests for auth/OTP/alerts/prices). Diverged from the deployed code (ChatGPT rewrote parts). Useful as a reference/test source; not the source of truth. |
| `legacy/darayi-v8-original.html`, `legacy/darayi-v9-pre-backend.html` | The user's original file and the last local-only version. |

**Source of truth = `src/worker.js` + `src/index.html`.** Edit those, run the build, deploy `dist/worker.js`.

---

## 4. Backend details (`src/worker.js`)

### Environment (set in Cloudflare dashboard → Worker → Settings)
| Name | Type | Purpose |
|---|---|---|
| `DB` | D1 binding | database (binding name must be exactly `DB`) |
| `APP_URL` | text | public URL, used in links/redirects (e.g. `https://darayi.clearworks.workers.dev`) |
| `AUTH_SECRET` | secret | HMAC key for e-mail codes + admin; **required** for register/reset |
| `MAIL_WEBHOOK_URL`, `MAIL_WEBHOOK_SECRET` | secret | Apps Script web app URL + shared secret (free e-mail path) |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | text/secret | Google login (optional) |
| `PBKDF2_ITER` | text, optional | password hashing cost. **Default now 10000** (Free plan 10 ms CPU). Use 100000 only on Paid. |
| `MAX_COINS` | text, optional | cap on crypto coins (default 700) |
| `INLINE_REFRESH_S` | text, optional | staleness threshold before a page request triggers a background refresh (default 120) |
| `EMAIL` (send_email binding), `MAIL_FROM`, `RESEND_API_KEY` | optional | alternative mail paths (Cloudflare Email Sending = paid/beta; Resend needs a domain) |

Cron triggers to add: **`* * * * *`** (prices + alerts every minute) and **`17 3 * * *`** (daily meta: `refreshMeta`). (The older guide said `*/5`; every minute is what the code expects because crypto is “stale” after 150 s.)

### HTTP API
- Public: `GET /api/health` (`{ok,database,google,email}`), `GET /api/prices[?refresh=1]`, `GET /api/history?id=&range=1H|1D|3D|1W|1M|1Y`.
- Auth: `POST /api/auth/register/start|verify`, `/login`, `/reset/start|verify|finish`, `/logout`; `GET /api/auth/google/start|callback`; `GET /api/me`.
- Account (cookie session): `GET|PUT /api/me/data`, `/api/me/alerts/…` (ChatGPT addition used by the frontend), `DELETE /api/me`.
- Public API for third parties: `GET /v1/prices` with header `x-api-key` (hash in `api_keys`), 60 req/min per key. No admin UI to create keys (insert SHA-256 base64url hash manually; `legacy/modular-v1/scripts/make-key.mjs` shows how).
- PWA: `/manifest.webmanifest`, `/sw.js`, `/icons/*.png`, `/apple-touch-icon.png`, `/favicon.ico` (served from constants inside the Worker). Everything else non-API → the page (`APP_HTML`).

### Auth (all hand-written, no libraries)
- Sessions: random 256-bit id in `HttpOnly; SameSite=Lax; Secure` cookie `sid`, **only the SHA-256 hash stored** (`sessions`), 30 days.
- Passwords: PBKDF2-SHA256, salt per user, iteration count stored in the hash (`pbkdf2$<iter>$<salt>$<hash>`), so cost can be raised later. Login always runs PBKDF2 even for unknown users (no timing oracle); same error for unknown user/wrong password.
- E-mail codes: 6 digits, **HMAC-SHA256 with `AUTH_SECRET`** stored (not the code), 10 min expiry, **5 attempts** burned atomically (`UPDATE … RETURNING`), Persian digits accepted. Register stores `{name, password hash}` inside the pending code row. “Account exists” → a notice mail instead of a code (no enumeration). Reset: verify code → short-lived reset token → `reset/finish` sets password and **revokes all sessions**.
- Google: OAuth code flow + PKCE, state single-use in D1, id_token claims checked (iss/aud/exp/email_verified); links to an existing account by verified e-mail. Google-only accounts can set a password through “forgot password”.
- CSRF: state-changing requests require same `Origin` (or no cross-site `sec-fetch-site`). Rate limits in D1 (`rate_limits`, fixed windows) per e-mail and per IP.
- Input validation: `cleanData` caps sizes/counts (holdings ≤500, alerts ≤50, featured ≤16 …), asset ids must match `^[a-z0-9]{1,20}$`.

### Price pipeline (`refreshPrices`)
- Stored in D1 `kv` row `prices` as JSON `{updatedAt, checkedAt, items:{id:{price,change,t,src,unit,…}}, feeds:{domestic,crypto,histAt}}`.
- **Serving (`GET /api/prices`)**: returns stored data **immediately**; if older than threshold, refresh runs in the background via `ctx.waitUntil`; if empty or `?refresh=1`, it waits up to 9 s. **Never returns 500** (errors surface in `feeds.lastError`). A lease row `refresh-lock` in `kv` prevents concurrent refreshes (ChatGPT addition).
- **Domestic (Nerkhsanj)** `https://nerkh.jahankhahan.shop/data/live.json` (free, keyless, ≤1 request/min, **must credit “Nerkhsanj”**): `rates` + `change` maps. Key→asset map `NERKH` (dollar→usd, euro→eur, pound→gbp, aed, lira→try, gold→gold18, gold24, coin, half→halfcoin, tether→usdt, mesghal→gram (“طلای آب‌شده”)) + 16 extra series in `DOMESTIC_EXTRA` (yuan, cad, aud, chf, sar, qar, kwd, omr, iqd, afn, rub, inr, bahar, quarter, gram→`gramcoin`, silver→`silver999`). Timestamp from the Jalali `date`+`time` fields (`domesticTime`, pure arithmetic Jalali→Gregorian, Tehran = UTC+3:30; **do not use `Intl` persian calendar — it burns CPU**). Global silver ounce comes from `usd['silver-ounce']`. `sp500` has no live source (sample).
- **Crypto**: adapters in `SOURCES` = binance, okx, kucoin, gate (`tickers()` + `klines()`). Order: last working source first, then binance → okx → kucoin → gate. **Binance returns 403 from this Worker** (observed live on the user's deployment), so production runs on **KuCoin** (686 coins observed). Filters: USDT quote, 24h quote volume ≥ 5000, sort by volume, cap `MAX_COINS`. Prices stored in **USDT** (`unit:'USDT'`), the frontend converts to toman with the USDT/toman rate (`quoteToman`). Ids = lowercase symbol (non-ASCII → hashed `c…`). Core coins (btc/eth/sol/bnb/xrp/usdt) keep Persian names from `ASSETS`.
- Staleness: crypto 150 s, others 30 min (`CRYPTO_STALE_S`, `STALE_S`).
- Snapshots for history: every 300 s (`feeds.histAt`) into `price_history_v2` via **one multi-row INSERT per ≤30 rows** (D1 free: ≤100 bound params/statement, few queries/invocation).
- `GET /api/history`: crypto → klines via the item's source, then **all other exchanges** as fallback, last good answer cached in `kv` (`h:<id>:<range>`, deleted after 1 day by `refreshMeta`); domestic → own snapshots, plus Nerkhsanj archive `rates.json` (`series[].key`, `days:[[jalaliDate,value]]`) for ranges lacking data **[archive structure UNVERIFIED]**. Edge-cached 30 s.
- Save retry: if D1 rejects the big `prices` value, retry with the top-400 coins.

### Alerts & e-mail
- Alerts live in D1 (`alerts`, plus ChatGPT's `alert_delivery` leases, `alert_state`, `alert_units`, `mail_deliveries`). Cron `checkAlerts` after each price refresh: triggers when price crosses; `triggered_at` set atomically before sending, reverted for retry on failure (max attempts); skip when the price is stale; e-mail is Persian RTL HTML. Editing an alert (asset/direction/price) re-arms it.
- `sendMail` order: Apps Script web hook → Resend → Cloudflare `EMAIL` binding. Apps Script quota ≈ 100 mails/day for a consumer Gmail.

### D1 limits to respect (Free plan)
10 ms CPU per invocation (also cron), ≤50 D1 queries/invocation, ≤100 bound params/statement, 100k writes/day. Keep per-run work small. Measured (Node, not Cloudflare): password hash 100k iters ≈ 20 ms (too slow), 10k ≈ 3 ms; price refresh warm ≈ 3 ms JS.

---

## 5. Frontend details (`src/index.html`)

- Single file; sections `home, market, watchlist, portfolio, settings(hidden)`; bottom nav (mobile) becomes a right sidebar at ≥1100px.
- **State** `state` persisted in `localStorage['darayi-v5']` (holdings/ledger, watch, alerts, featured, theme, unit, privacy, filter…). Other keys: `darayi-assets` (cached dynamic assets), `darayi-valuations-v1` (portfolio snapshots for the hero chart), `darayi-prices-v2` (last prices so a reload isn't empty).
- **Assets:** `assets[]` seeded with 18 static ones (`usd,eur,gbp,aed,try,gold18,gold24,coin,halfcoin,gram,btc,eth,usdt,sol,bnb,xrp,silver,sp500`); the rest are created dynamically by `applyPrices` from `/api/prices` (`kind: 'crypto'|'domestic'`). Unknown ids never fall back to USD (placeholder object). Ids are validated by shape only (server doesn't whitelist) so dynamic coins survive reloads.
- **Prices:** `loadPrices()` → `applyPrices(items)` (+ `savePriceCache`, `loadPriceCache` at boot) → `softRender()` (re-render preserving scroll; skipped when nothing changed). Poll every 15 s; Binance WebSocket (ChatGPT) paints live ticks via `paintLivePrices` when reachable. `quoteToman(asset)` converts USDT-priced coins; `priceNum/money/fmtP` format (small prices keep 4 significant digits).
- **Charts:** `chartSVG/chartGeometry/smoothPath/paintChart`, `getHistory` (client cache; **never replace a good series with an empty one**), `loadChart/drawDetail` for the detail modal; hero/portfolio charts draw from own valuation snapshots.
- **Ledger model (ChatGPT):** `ledger()/safeLedger()` supports buy/sell/transfer with wallets and validates wallet balances; the buy form now always submits `side=buy`, wallet «اصلی».
- **Sync (ChatGPT + Claude):** `scheduleSync/pushRemote` (debounced PUT `/api/me/data`), `pollRemote`, `showConflict` (conflict modal), `afterLogin` (merge-or-use-server dialog), `mergeTriggered` (alert trigger flags). Auth UI: `authLogin/authRegister/authForgot/authOtp/authNewPass/loginForm`.
- **PWA:** manifest/sw/icons from the Worker; install button `#installBtn`; SW is network-first for `/` with offline fallback, never caches `/api/*`.
- **Desktop CSS:** the last `@media(min-width:1100px)` block ("/* v12 */") overrides earlier desktop rules. Phone CSS untouched.
- Known cosmetic: change chips on market cards still use arrows (only featured cards were asked to drop them).

---

## 6. Deploy / run

**Normal (what the user does):** `node scripts/build.mjs` (or take the prebuilt `dist/worker.js`) → Cloudflare dashboard → Workers & Pages → Worker `darayi` → Edit code → select all → paste → Deploy. D1 database `darayi` already exists and is bound as `DB`; run `schema.sql` in the D1 Console for new tables (idempotent). Corrections to `docs/GUIDE-FA.md`: use cron `* * * * *` (not `*/5`); `PBKDF2_ITER` default is now 10000.

**Local testing:** `node tools/local-server.mjs` (Node ≥ 22) → `http://localhost:8792`; mocks: Nerkhsanj (28 keys + archive), Binance = 403, OKX/KuCoin answer. `/__state?set={"okx":false}` flips OKX to 503 to test failover; `/__cron` runs the cron job. Then `python3 tools/ui-smoke-mobile.py` / `ui-smoke-desktop.py` (Playwright) produce screenshots.

**There is no automated unit test suite for the current code.** `legacy/modular-v1/test/e2e.test.mjs` (13 passing tests, Node `node:test`) targets the older modular worker; port/adapt it if you want regression tests (auth, OTP lockout, alerts, Google flow, price mapping).

---

## 7. Decisions and why

| Decision | Reason |
|---|---|
| Single HTML + single Worker file, pasted in dashboard | User is non-technical and refuses paid plans/CLI/GitHub |
| Apps Script (Gmail) for e-mail | Cloudflare Email Sending requires Workers Paid (public beta since Apr 2026); Resend needs a domain |
| Password hash cost 10 000 | Free plan 10 ms CPU; stored iteration count allows upgrade later |
| Exchange adapters with failover | Binance gives 403 from Cloudflare; any single exchange can be flaky per colo |
| Crypto stored in USDT, converted client-side | Avoids re-pricing everything when the USDT/toman rate moves; also needed for “enter price in USD” |
| Stale-while-revalidate for `/api/prices` | Intermittent 500s/timeouts made the whole UI empty |
| Jalali date by arithmetic | `Intl` persian calendar cost >10 ms CPU |
| Settings hidden, not deleted | Old JS dereferences those elements |
| Mobile CSS untouched, desktop in one media block | Explicit requirement |

---

## 8. How we got here (timeline)

1. **v8 single-file app (local only).** User asked: find and fix bugs, make featured-price cards draggable on the home page without bugs, UX review, mobile first, “don't introduce new bugs”. Fixed: stale search query after reload, duplicate SVG gradient ids (charts), buy-from-detail not preselecting the asset, unit toman/rial not applied everywhere, UTC date bug for Iran, import validation, `confirm()`/forms not working in sandboxed previews (replaced by in-app confirm and button handlers), etc. Implemented pointer-event drag & drop with long-press and auto-scroll.
2. **UI iterations** (donut thickness/position, movers split into winners/losers horizontal strips with 8 items, bigger prices, compact detail buttons, range tabs under chart, symbol alignment, star toggle in watchlist, edit-alert, alert asset picker like the buy picker).
3. **Accounts + backend plan.** User wanted real accounts, Google login, alerts e-mails, a price API to give others. Built a modular Cloudflare Worker + D1 (auth: magic link first, then e-mail+password+OTP as requested), cron for prices/alerts, 13 node tests, local Playwright integration tests. Free-plan limits discovered (10 ms CPU, no e-mail sending) → Apps Script mail, light refresh, dashboard-paste deployment, `GUIDE-FA.md`.
4. **First deploy attempts.** User deployed on Workers Free; prices didn't load. Claude reviewed code, found CPU-heavy parts and shipped a lighter worker.
5. **ChatGPT interlude (user-side).** The user continued with ChatGPT; it rewrote chunks (inline refresh in `/api/prices`, lease lock, `price_history_v2`, alert delivery tables, hardened Apps Script, browser Binance WebSocket, ledger with wallets/transfers/sell, trust/quality indicators, conflict modal). The user uploaded those files back. Claude only reviewed parts of them (price pipeline, route, auth tail) — **treat the rest as unreviewed**.
6. **Live diagnosis.** User gave their URL; `/api/prices` showed domestic OK, crypto `HTTP 403` (Binance blocked). Claude added exchange adapters (OKX/KuCoin/Gate), 16 more Iranian series, light symbol/ticker requests, history archive fallback, snapshot batching. KuCoin then served 686 coins.
7. **Stability + product polish (“fixed3”).** Intermittent `{"error":"خطای داخلی سرور"}` and vanishing prices/charts ⇒ stale-while-revalidate API, price cache in the browser, kv-cached klines with multi-exchange fallback. Plus all UI requests in §2 (PWA, desktop layout, Persian names, buy-form simplification, removals). Then this handoff.

---

## 9. Verification status

**Verified (local mocks + headless Chromium):** build output syntax; `/api/health`, `/api/prices` (633 items with OKX; failover to KuCoin when OKX is 503); `/api/history` for crypto and archive-style domestic data (mocked); `/api/prices` returns 200 even when D1 throws; manifest/sw/icons routes; mobile flows (theme toggle, nav without settings, crypto Persian names, buy form fields, “قیمت الان”, USD toggle, ledger row, no “بدون تاریخچه”, price cache after reload); desktop screenshots (dashboard, market, portfolio).
**Verified on the user's real deployment (observed by reading their `/api/prices`):** domestic feed OK, KuCoin feed OK with 686 coins, extra domestic series present, health OK.
**[UNVERIFIED]:** real Nerkhsanj `rates.json` shape (history for Iranian assets); OKX/Gate kline/ticker field details against live responses (written from API docs memory); whether the 10 ms CPU limit is met on cold starts in Cloudflare; Google OAuth with the real client; real e-mail delivery through Apps Script; PWA install on iOS/Windows; Persian coin-name dictionary accuracy; the cause of the earlier intermittent 500 (hypotheses: D1 hiccups, CPU, large `kv` value, upstream timeouts); desktop UI on real devices (only screenshots at 1440×900).

---

## 10. Known issues / TODO (suggested order)

1. **Redeploy and re-test password flows on the Free plan.** The version the user had from ChatGPT had `PBKDF2_DEFAULT = 100000` (≈20 ms CPU → likely Error 1102 on register/login). This folder sets it to **10000**; alternatively the user can add Text variable `PBKDF2_ITER=10000`.
2. If 500s persist, read `feeds.lastError` in `/api/prices` and Cloudflare Worker logs/metrics (Exceeded CPU?). Consider lowering `MAX_COINS` (e.g. 300).
3. Verify the Nerkhsanj archive structure and adjust `archiveHistory`; consider storing a bootstrap of daily closes.
4. Add real tests for the current worker (port from `legacy/modular-v1/test`).
5. Coin names: confirm Persian names against Iranian exchanges; add more.
6. Remove or guard the browser Binance WebSocket for users in Iran (noise/battery).
7. Optional: real custom domain (workers.dev may be filtered in Iran), proper favicon/branding, Google verification not needed while the OAuth app is in *Testing* (≤100 test users).
8. If a paid API for others is ever offered: check Nerkhsanj/exchange ToS first, add key management and usage limits UI.

---

## 11. Gotchas for whoever edits next

- `index.html` is embedded with `JSON.stringify` — **never edit `dist/worker.js` by hand**; edit `src/` and rebuild.
- Some JS in `index.html` was produced by earlier search/replace passes and contains template-literal strings with escaped quotes; patching by regex needs care (several “string not found” surprises happened). Prefer exact-string replacements with count assertions.
- Always ask the user to paste the **exact error text / URL output** (`/api/health`, `/api/prices`) — they can't read logs. `feeds` and `feeds.lastError` in `/api/prices` are the diagnostic channel.
- Keep per-invocation CPU tiny (Free plan). Avoid big JSON parses, `Intl` calendars, PBKDF2 > 10k, many D1 statements.
- Do not re-introduce Binance as the only crypto source; do not rely on `data-api.binance.vision` from Cloudflare.
- UI texts are Persian; keep digits Persian in the UI (`Intl.NumberFormat('fa-IR')`), Latin symbols right-aligned.
- Don't touch mobile layout when changing desktop; add desktop rules only inside `@media(min-width:1100px)`.
- Credit “Nerkhsanj” somewhere visible (their terms) — the source label is shown in the UI.
