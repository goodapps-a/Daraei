import fs from 'node:fs';

const origHtml = fs.readFileSync('public/assets/aistudio/index_35b1796e.html', 'utf8');
let html = origHtml;

// 1. Title and SEO meta
html = html.replace(/<title>.*?<\/title>/, '<title>دارایی من (Darayi)</title>');
html = html.replace(/<meta name="description" content=".*?">/, '<meta name="description" content="سامانه هوشمند و PWA رصد لحظه‌ای قیمت طلا، ارز، سکه و رمزارز و مدیریت سبد دارایی"><meta property="og:title" content="دارایی من (Darayi)"><meta property="og:description" content="سامانه هوشمند و PWA رصد لحظه‌ای قیمت طلا، ارز، سکه و رمزارز و مدیریت سبد دارایی">');
html = html.replace(/<meta name="theme-color" content=".*?">/, '<meta name="theme-color" content="#f8fafc">');

// 2. High-end modern Fintech Color Palette (CSS)
const newCssPalette = `:root {
  color-scheme: light;
  --bg: #f8fafc;
  --paper: #ffffff;
  --ink: #0f172a;
  --muted: #64748b;
  --line: #e2e8f0;
  --lime: #10b981;
  --green: #059669;
  --greenbg: #ecfdf5;
  --red: #e11d48;
  --redbg: #fff1f2;
  --purple: #6366f1;
  --accent: #4f46e5;
  --orange: #f59e0b;
  --blue: #0284c7;
  --shadow: 0 4px 20px -2px rgba(15, 23, 42, 0.05), 0 2px 6px -1px rgba(15, 23, 42, 0.03);
  --radius: 18px;
}
:root[data-theme=dark] {
  color-scheme: dark;
  --bg: #0b0f19;
  --paper: #111827;
  --ink: #f9fafb;
  --muted: #94a3b8;
  --line: #1f2937;
  --lime: #10b981;
  --green: #34d399;
  --greenbg: rgba(16, 185, 129, 0.15);
  --red: #fb7185;
  --redbg: rgba(251, 113, 133, 0.15);
  --purple: #818cf8;
  --accent: #6366f1;
  --orange: #fbbf24;
  --blue: #38bdf8;
  --shadow: 0 8px 30px rgba(0, 0, 0, 0.55);
}`;

html = html.replace(/:root\s*\{[\s\S]*?:root\[data-theme=dark\]\s*\{[\s\S]*?--shadow:\s*0\s*25px[\s\S]*?\}/, newCssPalette);

// 3. Modern Dark Mode SVGs
const sunSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>`;
const moonSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`;

html = html.replace(/<button class="icon-btn" id="themeBtn" aria-label="تغییر حالت تیره و روشن">.*?<\/button>/, `<button class="icon-btn" id="themeBtn" type="button" aria-label="حالت تیره / روشن">${moonSvg}</button>`);

// 4. Clean Intro replacement: Remove greetings and keep hidden state anchors
const origIntro = `<div class="intro"><div><h1>سلام، <span id="userName">سرمایه‌گذار</span>! <span style="color:var(--purple)">✳</span></h1><p>امروز دارایی‌هات چه حال‌وهوایی دارن؟</p></div><span class="pill sample" id="homePill"><span class="dot"></span><span id="homePillText">در انتظار قیمت</span></span></div>`;
if (!html.includes(origIntro)) {
  console.error('ERROR: origIntro not found in original HTML!');
  process.exit(1);
}
html = html.replace(origIntro, '<div style="display:none"><span id="userName"></span><span id="homePill"><span id="homePillText"></span></span></div>');

// 5. Replace labels
html = html.replace(/ارزش کل سبد من/g, 'ارزش کل دارایی‌ها');
html = html.replace(/<div>سبد دارایی<\/div>/g, '<div>دارایی</div>');
html = html.replace(/<button data-page="portfolio"><span class="nav-icon">▤<\/span>سبد من<\/button>/, '<button data-page="portfolio"><span class="nav-icon">▤</span>دارایی</button>');
html = html.replace(/جزئیات سبد/g, 'جزئیات دارایی');
html = html.replace(/سبد تو در یک نگاه/g, 'ترکیب دارایی‌ها');
html = html.replace(/تاریخچهٔ معاملات و انتقال‌ها/g, 'تاریخچه معاملات');
html = html.replace(/تاریخچهٔ معاملات/g, 'تاریخچه معاملات');
html = html.replace(/معامله \/ انتقال ثبت‌شده/g, 'معامله ثبت‌شده');

// 6. Extra CSS for standardized price fonts, mobile navigation, embedded currency toggle, and tooltips
const extraCss = `
/* Standardized Price Typography */
.price, .ticker-price, .holding-right strong, .detail-price, .alert-price, .hero-value, #portfolioValue, .chart-tooltip strong {
  font-family: 'Vazirmatn', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
  font-variant-numeric: tabular-nums !important;
  direction: ltr !important;
  text-align: left;
  letter-spacing: -0.01em;
}
.price { font-size: 15px; font-weight: 700; color: var(--ink); margin: 6px 0; }
.ticker-price { font-size: 14px; font-weight: 700; color: var(--ink); margin: 4px 0; }
.holding-right strong { font-size: 15px; font-weight: 700; color: var(--ink); }
.detail-price { font-size: 26px; font-weight: 800; color: var(--ink); }

/* Currency Toggle inside Price Input */
.price-input-wrapper {
  position: relative;
  display: flex;
  align-items: center;
  width: 100%;
}
.price-input-wrapper input {
  padding-inline-end: 72px !important;
  width: 100% !important;
  font-variant-numeric: tabular-nums;
  direction: ltr;
  text-align: left;
}
.cur-toggle-btn {
  position: absolute;
  left: 8px;
  top: 50%;
  transform: translateY(-50%);
  height: 28px;
  padding: 0 10px;
  border-radius: 8px;
  border: 1px solid var(--line);
  background: var(--bg);
  color: var(--ink);
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
  transition: all .15s ease;
  user-select: none;
}
.cur-toggle-btn:hover {
  background: var(--paper);
  border-color: var(--muted);
}

/* Mobile Bottom Navigation - 4 Buttons Perfectly Balanced */
.bottom-nav {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  height: 64px;
  background: var(--paper);
  border-top: 1px solid var(--line);
  display: flex;
  align-items: center;
  justify-content: space-around;
  padding: 0 8px max(10px, env(safe-area-inset-bottom));
  z-index: 90;
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
}
@media (min-width: 820px) {
  .bottom-nav { display: none; }
}
.bottom-nav button {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  border: none;
  background: transparent;
  color: var(--muted);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  padding: 6px 0;
  border-radius: 12px;
  transition: all .15s ease;
}
.bottom-nav button.active {
  color: var(--green);
}
.bottom-nav .nav-icon {
  font-size: 18px;
  line-height: 1;
}

/* Floating HUD Chart Tooltip */
.chart-tooltip {
  position: absolute;
  top: 8px;
  transform: translateX(-50%);
  padding: 5px 12px;
  background: var(--paper);
  color: var(--ink);
  border: 1px solid var(--line);
  border-radius: 99px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
  font-size: 11px;
  font-weight: 700;
  pointer-events: none;
  direction: rtl;
  z-index: 15;
  white-space: nowrap;
  backdrop-filter: blur(10px);
}
.chart-tooltip strong {
  color: var(--green);
  font-family: 'Vazirmatn', sans-serif;
  font-variant-numeric: tabular-nums;
  margin-inline-start: 6px;
}
.chart-tooltip[hidden] { display: none; }

/* Hide redundant notes from portfolio cards */
#homeQuality, #dailyBrief, #portfolioQuality { display: none !important; }
`;

html = html.replace('</style>', extraCss + '\n</style>');

// 7. Standardize SVG Icons in JS
html = html.replace(/const sunIcon = '.*?';/, `const sunIcon = '${sunSvg}';`);
html = html.replace(/const moonIcon = '.*?';/, `const moonIcon = '${moonSvg}';`);

// 8. Filter stablecoins except USDT
const comprehensiveStables = `const EXCLUDED_STABLES = new Set(['usdc','dai','busd','tusd','usdd','fdusd','pyusd','usde','frax','usdp','eurs','ust','gusd','lusd','susd']);`;
html = html.replace(/const EXCLUDED_STABLES = new Set\(\[[^\]]*\]\);/, comprehensiveStables);

html = html.replace(
  /function applyPrices\(raw\)\{/,
  `function applyPrices(raw){\n  if(Array.isArray(raw)) raw = raw.filter(x => x.id === 'usdt' || (!EXCLUDED_STABLES.has(x.id) && !EXCLUDED_STABLES.has((x.symbol||'').toLowerCase())));`
);

// 9. Relative Dates (امروز / دیروز) & 12-Hour Staleness threshold
const dateHelpers = `function isStale(a){
  return !a.updatedAt || ((Date.now() / 1000 - a.updatedAt) > 12 * 3600);
}
function formatRelativeDate(ts){
  if (!ts) return 'زمان نامشخص';
  const d = new Date(ts * 1000);
  const now = new Date();
  const timeStr = d.toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' });
  const dStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const nowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const diffDays = Math.round((nowStart - dStart) / 86400000);
  if (diffDays === 0) return 'امروز، ' + timeStr;
  if (diffDays === 1) return 'دیروز، ' + timeStr;
  return d.toLocaleDateString('fa-IR', { month: '2-digit', day: '2-digit' }) + '، ' + timeStr;
}
function quality(a){
  if (!(a.price > 0)) return 'قیمت در دسترس نیست';
  return (isStale(a) ? '● قدیمی' : '● به‌روز') + ' · ' + formatRelativeDate(a.updatedAt);
}`;

html = html.replace(/function isStale\(a\)[\s\S]*?function quality\(a\)[\s\S]*?\}\s*function spark/, dateHelpers + '\nfunction spark');

// 10. Remove "≈" approximation sign completely
html = html.replace(/\(approx\?'≈ ':'\)/g, "''");
html = html.replace(/\(approx\?'≈ ':'\s*'\)/g, "''");
html = html.replace(/approx\?'≈ ':''/g, "''");
html = html.replace(/≈/g, '');

// 11. Replace updateSummary with null-safe version & remove 0 realized PnL
const safeUpdateSummary = `function updateSummary(){
  const positions=safeLedger().positions, v=totalValue(), p=pnl(), missing=positions.some(p=>!(asset(p.assetId).price>0)||asset(p.assetId).currency!=='IRT'&&!(asset('usdt').price>0));
  if ($('#homeValue')) $('#homeValue').textContent = missing ? 'ارزش کامل در دسترس نیست' : money(v);
  if ($('#portfolioValue')) $('#portfolioValue').textContent = missing ? 'ارزش کامل در دسترس نیست' : money(v);
  if ($('#homeCost')) $('#homeCost').textContent = money(totalCost());
  if ($('#homePL')) {
    $('#homePL').textContent = missing ? 'نامشخص' : (p>=0?'+':'−')+money(Math.abs(p));
    $('#homePL').style.color = p>=0?'var(--green)':'var(--red)';
  }
  if ($('#portfolioPL')) $('#portfolioPL').textContent = 'سود/زیان: ' + (missing ? 'نامشخص' : (p>=0?'+':'−')+money(Math.abs(p)));
  if ($('#homeReturn')) {
    $('#homeReturn').textContent = missing ? '—' : ((roi()>=0?'+':'')+fmt.format(roi())+'٪');
    $('#homeReturn').style.background = roi()<0?'var(--redbg)':'var(--greenbg)';
    $('#homeReturn').style.color = roi()<0?'var(--red)':'var(--green)';
  }
  if ($('#portfolioROI')) $('#portfolioROI').textContent = missing ? '—' : ((roi()>=0?'+':'')+fmt.format(roi())+'٪ بازده');
  const realized = safeLedger().realized || 0;
  if ($('#realizedPL')) {
    if (realized !== 0) {
      $('#realizedPL').textContent = 'سود/زیان محقق‌شده: ' + (realized>=0?'+':'−') + money(Math.abs(realized));
      $('#realizedPL').style.display = '';
    } else {
      $('#realizedPL').textContent = '';
      $('#realizedPL').style.display = 'none';
    }
  }
  renderPositions();
}`;
html = html.replace(/function updateSummary\(\)\{[\s\S]*?renderPositions\(\);?\}/, safeUpdateSummary);

// 12. Replace updateTrust: Never output "زمان قیمت‌ها متفاوت است" or stale/target alert text
const safeUpdateTrust = `function updateTrust(){
  const positions=safeLedger().positions;
  if ($('#homeQuality')) { $('#homeQuality').textContent = ''; $('#homeQuality').style.display = 'none'; }
  if ($('#portfolioQuality')) { $('#portfolioQuality').textContent = ''; $('#portfolioQuality').style.display = 'none'; }
  if ($('#dailyBrief')) { $('#dailyBrief').textContent = ''; $('#dailyBrief').style.display = 'none'; }
  const fresh = assets.filter(a => a.price > 0 && !isStale(a)).length, any = assets.some(a => a.price > 0), allStale = !fresh;
  const statusText = !any ? 'قیمت دریافت نشده' : allStale ? 'دادهٔ قدیمی' : 'به‌روز';
  if ($('#homePillText')) $('#homePillText').textContent = statusText;
  if ($('#marketPill')) $('#marketPill').textContent = statusText;
  if ($('#homePill')) $('#homePill').classList.toggle('sample', allStale);
  if ($('#marketPill')) $('#marketPill').classList.toggle('sample', allStale);
  if ($('#storageStatus')) $('#storageStatus').textContent = state.user?.remote ? (syncDirty ? 'تغییرات این دستگاه هنوز همگام نشده‌اند.' : 'معاملات با حساب همگام می‌شوند.') : 'اطلاعات فقط روی همین مرورگر ذخیره می‌شود.';
  if (window.feedStatus && $('#syncStatus')) {
    const f = window.feedStatus;
    $('#syncStatus').textContent = 'رمزارز: ' + (lastWs && Date.now() - lastWs < 15000 ? 'اتصال لحظه‌ای' : f.crypto?.ok ? 'دریافت دوره‌ای' : 'دریافت ناموفق') + ' · داخلی: ' + (f.domestic?.ok ? 'آخرین قیمت منتشرشده' : 'دریافت ناموفق');
  }
  document.querySelectorAll('[data-detail] .change').forEach(el => {
    const a = asset(el.closest('[data-detail]')?.dataset?.detail);
    if (a && !Number.isFinite(a.change)) el.textContent = '—';
  });
}`;
html = html.replace(/function updateTrust\(\)\{[\s\S]*?el\.textContent='—'\}\);?\}/, safeUpdateTrust);

// 13. Replace renderHome with 100% null-safe version
const safeRenderHome = `function renderHome(){
  const val = totalValue(), cost = totalCost(), profit = pnl();
  if ($('#homeValue')) $('#homeValue').textContent = money(val);
  if ($('#homeReturn')) {
    $('#homeReturn').textContent = (roi() >= 0 ? '+' : '') + fmt.format(roi()) + '٪';
    $('#homeReturn').style.background = roi() < 0 ? 'var(--redbg)' : 'var(--greenbg)';
    $('#homeReturn').style.color = roi() < 0 ? 'var(--red)' : 'var(--green)';
  }
  if ($('#homeCost')) $('#homeCost').textContent = money(cost);
  if ($('#homePL')) {
    $('#homePL').textContent = (profit >= 0 ? '+' : '−') + money(Math.abs(profit));
    $('#homePL').style.color = profit >= 0 ? 'var(--green)' : 'var(--red)';
  }
  if ($('#assetCount')) $('#assetCount').textContent = fmt.format(assets.length) + ' بازار';
  if ($('#tradeCount')) $('#tradeCount').textContent = fmt.format(state.holdings.length) + ' ثبت';
  if ($('#watchCount')) $('#watchCount').textContent = fmt.format(new Set([...state.watch, ...state.alerts.map(x => x.assetId)]).size) + ' دارایی زیرنظر';
  if ($('#homeChart')) renderSnapshots($('#homeChart'), '1D');
  renderFeatured();
  renderMarketMovers();
  if ($('#homeAllocation')) renderAllocation($('#homeAllocation'));
  fitHero();
  renderAlertsPreview();
}`;
html = html.replace(/function renderHome\(\)\{[\s\S]*?renderAlertsPreview\(\);?\}/, safeRenderHome);

// 14. Replace renderAll with 100% null-safe version
const safeRenderAll = `function renderAll(){
  renderHome();
  renderMarket();
  renderWatch();
  renderPortfolio();
  queueMicrotask(hydrateSparks);
  queueMicrotask(() => { updateSummary(); updateTrust(); });
  if ($('#themeSelect')) $('#themeSelect').value = state.theme;
  if ($('#unitSelect')) $('#unitSelect').value = state.unit;
  if ($('#privacySwitch')) $('#privacySwitch').classList.toggle('on', state.privacy);
  document.documentElement.dataset.theme = state.theme;
  if ($('#themeBtn')) $('#themeBtn').innerHTML = state.theme === 'dark' ? sunSvg : moonSvg;
  const themeMeta = $('meta[name=theme-color]');
  if (themeMeta) themeMeta.content = state.theme === 'dark' ? '#0b0f19' : '#f8fafc';
  document.body.classList.toggle('hide-value', state.privacy);
  if ($('#userName')) $('#userName').textContent = state.user?.name || 'سرمایه‌گذار';
  if ($('#loginBtn')) $('#loginBtn').textContent = state.user ? state.user.name : 'ورود';
}`;
html = html.replace(/function renderAll\(\)\{[\s\S]*?\$'#loginBtn'\)\.textContent=state\.user\?state\.user\.name:'ورود';?\}/, safeRenderAll);
if (!html.includes('safeRenderAll') && html.includes('function renderAll(){')) {
  // alternative regex replace
  html = html.replace(/function renderAll\(\)\{[\s\S]*?\$'#loginBtn'\)[\s\S]*?\}/, safeRenderAll);
}

// 15. Increase featured picker limit to 24
html = html.replace(/const MAX=16;/g, 'const MAX=24;');
html = html.replace(/حداکثر ۱۶ ارز/g, 'حداکثر ۲۴ ارز');
html = html.replace(/slice\(0,16\)/g, 'slice(0,24)');

// 16. Transaction item list in Portfolio:
// - No fee displayed
// - Show current price of asset
// - Show profit & loss with % and badge
// - No "خرید" in front of asset name
const newHoldingRenderer = `el.innerHTML = state.holdings.map((h, i) => {
  const a = asset(h.assetId);
  const curUnit = a.currency === 'USDT' ? quoteToman(a) : a.price;
  const totalCost = (h.qty * h.buyPrice) + (h.fee || 0);
  const curVal = curUnit > 0 ? (h.qty * curUnit) : 0;
  const diff = curUnit > 0 ? (curVal - totalCost) : 0;
  const diffPct = (totalCost > 0) ? (diff / totalCost) * 100 : 0;
  const isUp = diff >= 0;
  return \`<article class="holding">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;width:100%">
      <div class="holding-left">
        \${assetIcon(a)}
        <div style="min-width:0">
          <div class="holding-title" style="font-weight:700">\${a.name}</div>
          <div class="holding-meta">
            <span>\${fmt.format(h.qty)} \${a.symbol}</span> ·
            <span>خرید در \${money(h.buyPrice)}</span>
            \${h.date ? ' · <span class="muted">' + h.date + '</span>' : ''}
          </div>
        </div>
      </div>
      <div class="holding-right" style="text-align:left;display:flex;flex-direction:column;align-items:flex-end">
        <strong style="direction:ltr">\${curUnit > 0 ? quote(a) : 'در انتظار قیمت'}</strong>
        <small class="change \${isUp ? 'up' : 'down'}" style="font-weight:700;display:inline-flex;gap:4px;direction:ltr">
          \${curUnit > 0 ? ((isUp ? '+' : '−') + money(Math.abs(diff)) + ' (' + fmt.format(Math.abs(diffPct)) + '٪)') : 'در انتظار قیمت'}
        </small>
      </div>
    </div>
    <div class="holding-foot" style="margin-top:8px;padding-top:6px;border-top:1px solid var(--line);display:flex;gap:8px;justify-content:flex-end">
      <button class="small-btn" data-edit-holding="\${h.id}" type="button">ویرایش</button>
      <button class="small-btn" data-delete-holding="\${h.id}" type="button">حذف</button>
    </div>
  </article>\`;
}).join('')`;

html = html.replace(/el\.innerHTML=state\.holdings\.map\(\(h,i\)=>\{[\s\S]*?\}\)\.join\(''\)/, newHoldingRenderer);

// 17. buyForm with:
// - In edit mode: NO other assets picker! Only 4 fields: مقدار, قیمت هر واحد (with تومان/USD inside), کارمزد, تاریخ خرید.
// - "یادداشت" completely removed!
// - Explanation note removed!
const newBuyForm = `function buyForm(edit=null,presetId=null){
  const h=edit?state.holdings.find(x=>x.id===edit):null;
  const a=h?asset(h.assetId):null;
  let cur='IRT';
  const usdRate=()=>asset('usd').price>0?asset('usd').price:0;
  const headerAssetHtml=h?\`
    <div class="edit-asset-badge" style="display:flex;align-items:center;gap:10px;padding:12px;border:1px solid var(--line);border-radius:14px;background:var(--bg);margin-bottom:8px">
      \${assetIcon(a)}
      <div style="flex:1;min-width:0">
        <strong style="font-size:14px;display:block">\${a.name}</strong>
        <span class="muted" style="font-size:11px">\${a.symbol}</span>
      </div>
    </div>
    <input id="buyAsset" type="hidden" value="\${h.assetId}">
  \`:\`
    <div class="field full">
      <label>انتخاب دارایی</label>
      \${assetPicker(presetId||"gold18")}
    </div>
  \`;
  openModal(h?'ویرایش معامله':'ثبت معامله',\`
    <div id="buyForm">
      <div class="form-grid">
        \${headerAssetHtml}
        <input id="tradeSide" type="hidden" value="\${h?.side||'buy'}">
        <input id="wallet" type="hidden" value="\${escapeHtml(h?.wallet||'اصلی')}">
        <input id="toWallet" type="hidden" value="\${escapeHtml(h?.toWallet||'')}">
        <div class="field">
          <label for="buyQty">مقدار</label>
          <input id="buyQty" inputmode="decimal" placeholder="مثلاً ۰٫۵" value="\${h?.qty??''}" required>
        </div>
        <div class="field">
          <label for="buyPrice">قیمت هر واحد</label>
          <div class="price-input-wrapper">
            <input id="buyPrice" inputmode="decimal" placeholder="قیمت هر واحد" value="\${h?groupedValue(String(h.buyPrice)):''}" \${h?'data-touched="1"':''} required>
            <button type="button" class="cur-toggle-btn" id="curToggleBtn">تومان</button>
          </div>
          <div class="field-help" style="display:flex;justify-content:space-between;align-items:center;margin-top:4px">
            <button type="button" class="link-btn" id="priceNow">قیمت الان</button>
            <span id="priceHint" style="font-size:11px;color:var(--muted)"></span>
          </div>
        </div>
        <div class="field">
          <label for="buyFee">کارمزد (تومان)</label>
          <input id="buyFee" inputmode="decimal" value="\${h?.fee??0}" placeholder="۰">
        </div>
        <div class="field">
          <label for="buyDate">تاریخ خرید</label>
          <input id="buyDate" type="date" value="\${h?.date||new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,10)}">
        </div>
      </div>
      <div class="form-actions" style="margin-top:18px">
        <button class="btn btn-dark" type="button" id="buySubmit">\${h?'ذخیره تغییرات':'ثبت معامله'}</button>
        <button class="btn btn-soft" type="button" id="cancelBuy">انصراف</button>
      </div>
    </div>
  \`);
  if(!h) wireAssetPicker();
  wireGroupedInputs($('#buyForm'));
  const setHint=()=>{
    const v=parseValue($('#buyPrice').value);
    $('#priceHint').textContent=cur==='USD'&&v>0&&usdRate()?'معادل '+money(v*usdRate()):'';
  };
  $('#buyPrice').addEventListener('input',e=>{e.target.dataset.touched='1';setHint();});
  $('#curToggleBtn').onclick=()=>{
    const prev=cur;
    cur=prev==='IRT'?'USD':'IRT';
    $('#curToggleBtn').textContent=cur==='IRT'?'تومان':'USD';
    const v=parseValue($('#buyPrice').value),rate=usdRate();
    if(v>0&&rate){
      $('#buyPrice').value=groupedValue(String(cur==='USD'?+(v/rate).toPrecision(6):Math.round(v*rate)));
    }
    setHint();
  };
  const nowIn=()=>{
    const currentAsset=asset($('#buyAsset').value),tm=quoteToman(currentAsset);
    return cur==='USD'?(currentAsset.currency==='USDT'?currentAsset.price:(usdRate()&&tm?tm/usdRate():0)):tm;
  };
  $('#priceNow').onclick=()=>{
    const v=nowIn();
    if(!(v>0)){toast('قیمت فعلی در دسترس نیست.');return;}
    $('#buyPrice').value=groupedValue(String(cur==='USD'&&v<1000?+v.toPrecision(6):Math.round(v)));
    $('#buyPrice').dataset.touched='1';
    setHint();
  };
  $('#cancelBuy').onclick=closeModal;
  const doBuy=()=>{
    if(cur==='USD'&&!usdRate()){toast('نرخ دلار در دسترس نیست؛ قیمت را به تومان وارد کن.');return;}
    const qty=parseValue($('#buyQty').value);
    const price=parseValue($('#buyPrice').value)*(cur==='USD'?usdRate():1);
    const fee=parseValue($('#buyFee').value);
    if(!(qty>0&&price>0&&fee>=0)){
      toast('مقدار و قیمت باید بیشتر از صفر باشند.');
      return;
    }
    const data={
      id:h?.id||uid(),
      assetId:$('#buyAsset').value,
      side:'buy',
      wallet:'اصلی',
      qty,
      buyPrice:price,
      fee,
      date:$('#buyDate').value
    };
    const next=h?state.holdings.map(x=>x.id===h.id?data:x):[...state.holdings,data];
    try{ledger(next)}catch(e){toast(e.message);return;}
    state.holdings=next;
    persist();
    renderAll();
    closeModal();
    toast(h?'معامله ویرایش شد':'معامله ذخیره شد');
  };
  $('#buySubmit').onclick=doBuy;
  $('#buyForm').addEventListener('keydown',e=>{
    if(e.key==='Enter'&&e.target.tagName==='INPUT'&&e.target.type!=='search'){
      e.preventDefault();
      doBuy();
    }
  });
}`;

html = html.replace(/function buyForm\(edit=null,presetId=null\)\{[\s\S]*?doBuy\(\)\}\}\);?\}/, newBuyForm);

// 18. Interactive Chart Scrubbing & Tooltip
const improvedPaintChart = `function paintChart(box, points, color, formatter) {
  points = points.filter(p => Number.isFinite(p[0]) && Number.isFinite(p[1])).sort((a, b) => a[0] - b[0]);
  box.style.position = 'relative';
  box.style.direction = 'ltr';
  box.innerHTML = chartSVG(points, color);
  if (points.length < 2) return;
  const tip = document.createElement('div');
  tip.className = 'chart-tooltip';
  box.appendChild(tip);
  const geom = chartGeometry(points), svg = box.querySelector('svg'), cross = box.querySelector('.crosshair');
  box.tabIndex = 0;
  let index = points.length - 1;
  const modalLive = document.querySelector('#modalBody [data-detail-live], #modalBody .detail-price');
  const origPriceText = modalLive ? modalLive.textContent : '';
  const show = i => {
    index = Math.max(0, Math.min(points.length - 1, i));
    const p = points[index], xy = geom[index];
    const timeStr = formatRelativeDate(p[0]);
    const priceStr = formatter(p[1]);
    tip.innerHTML = '<span>' + timeStr + '</span> · <strong style="direction:ltr">' + priceStr + '</strong>';
    tip.hidden = false;
    tip.style.left = Math.max(65, Math.min(575, xy[0])) + 'px';
    cross.setAttribute('visibility', 'visible');
    const line = cross.querySelector('line'), dot = cross.querySelector('circle');
    line.setAttribute('x1', xy[0]);
    line.setAttribute('x2', xy[0]);
    dot.setAttribute('cx', xy[0]);
    dot.setAttribute('cy', xy[1]);
    if (modalLive) {
      modalLive.textContent = priceStr;
    }
  };
  const move = e => {
    box.dataset.activeUntil = String(Date.now() + 3000);
    const rect = svg.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width * 640;
    let best = 0;
    for (let i = 1; i < geom.length; i++) {
      if (Math.abs(geom[i][0] - x) < Math.abs(geom[best][0] - x)) best = i;
    }
    show(best);
  };
  box.onpointermove = move;
  box.onpointerdown = e => {
    move(e);
    if (e.pointerType === 'touch') box.setPointerCapture(e.pointerId);
  };
  box.onpointerleave = () => {
    tip.hidden = true;
    cross.setAttribute('visibility', 'hidden');
    if (modalLive && origPriceText) {
      modalLive.textContent = origPriceText;
    }
  };
  show(index);
}`;

html = html.replace(/function paintChart\(box,points,color,formatter\)[\s\S]*?function currentValue/, improvedPaintChart + '\nfunction currentValue');

// Write out to src/index.html and index.html
fs.writeFileSync('src/index.html', html, 'utf8');
fs.writeFileSync('index.html', html, 'utf8');
console.log('Successfully written src/index.html and index.html! Length:', html.length);
