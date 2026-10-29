import fs from 'node:fs';

const origHtml = fs.readFileSync('public/assets/aistudio/index_35b1796e.html', 'utf8');

let html = origHtml;

// 1. Sync head title & description
html = html.replace(/<title>.*?<\/title>/, '<title>دارایی من (Darayi)</title>');
html = html.replace(/<meta name="description" content=".*?">/, '<meta name="description" content="سامانه هوشمند و PWA رصد لحظه‌ای قیمت طلا، ارز، سکه و رمزارز و مدیریت سبد دارایی"><meta property="og:title" content="دارایی من (Darayi)"><meta property="og:description" content="سامانه هوشمند و PWA رصد لحظه‌ای قیمت طلا، ارز، سکه و رمزارز و مدیریت سبد دارایی">');
html = html.replace(/<meta name="theme-color" content=".*?">/, '<meta name="theme-color" content="#f6f8fb">');

// 2. Overhaul Color Palette in CSS (:root and :root[data-theme=dark])
const newCssPalette = `:root {
  color-scheme: light;
  --bg: #f6f8fb;
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
  --paper: #121927;
  --ink: #f8fafc;
  --muted: #94a3b8;
  --line: #1e293b;
  --lime: #10b981;
  --green: #34d399;
  --greenbg: rgba(16, 185, 129, 0.14);
  --red: #fb7185;
  --redbg: rgba(244, 63, 94, 0.14);
  --purple: #818cf8;
  --accent: #6366f1;
  --orange: #fbbf24;
  --blue: #38bdf8;
  --shadow: 0 8px 30px rgba(0, 0, 0, 0.55);
}`;

html = html.replace(/:root\s*\{[\s\S]*?:root\[data-theme=dark\]\s*\{[\s\S]*?--shadow:\s*0\s*25px[\s\S]*?\}/, newCssPalette);

// 3. Remove greeting block from Home view
html = html.replace(/<div class="intro"><div><h1>سلام، <span id="userName">[\s\S]*?<\/div><\/div>/, '<div style="display:none"><span id="userName"></span><span id="homePill"><span id="homePillText"></span></span></div>');

// 4. Remove Cloudflare button if any and add modern Dark Mode Moon SVG icon
const newMoonSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`;
html = html.replace(/<button class="icon-btn" id="themeBtn" aria-label="تغییر حالت تیره و روشن">.*?<\/button>/, `<button class="icon-btn" id="themeBtn" type="button" aria-label="حالت تیره / روشن">${newMoonSvg}</button>`);

// 5. Replace "ارزش کل سبد من" with "ارزش کل دارایی‌ها"
html = html.replace(/ارزش کل سبد من/g, 'ارزش کل دارایی‌ها');

// 6. Rename "سبد دارایی" to "دارایی" in topbar and navigation
html = html.replace(/<div>سبد دارایی<\/div>/g, '<div>دارایی</div>');
html = html.replace(/<button data-page="portfolio"><span class="nav-icon">▤<\/span>سبد من<\/button>/, '<button data-page="portfolio"><span class="nav-icon">▤</span>دارایی</button>');
html = html.replace(/جزئیات سبد/g, 'جزئیات دارایی');
html = html.replace(/سبد تو در یک نگاه/g, 'ترکیب دارایی‌ها');
html = html.replace(/تاریخچهٔ معاملات و انتقال‌ها/g, 'تاریخچه معاملات');
html = html.replace(/تاریخچهٔ معاملات/g, 'تاریخچه معاملات');
html = html.replace(/معامله \/ انتقال ثبت‌شده/g, 'معامله ثبت‌شده');

// 7. Remove Quality note and Daily brief text from portfolio hero
html = html.replace(/<div class="quality-note" id="homeQuality">.*?<\/div>/, '');
html = html.replace(/<div class="daily-brief" id="dailyBrief">.*?<\/div>/, '');
html = html.replace(/<div class="quality-note" id="portfolioQuality">.*?<\/div>/, '');

// 8. Fix bottom nav on mobile: 4 buttons, clean spacing, safe area
const mobileBottomNavCss = `
.bottom-nav {
  position: fixed;
  z-index: 40;
  bottom: 0;
  left: 0;
  right: 0;
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 4px;
  padding: 6px 10px calc(8px + env(safe-area-inset-bottom, 12px));
  min-height: calc(58px + env(safe-area-inset-bottom, 12px));
  background: var(--paper);
  border-top: 1px solid var(--line);
  box-shadow: 0 -4px 20px rgba(0, 0, 0, 0.05);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
}
.bottom-nav button {
  border: 0;
  background: transparent;
  color: var(--muted);
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  min-width: 0;
  height: 44px;
  padding: 4px 2px;
  font-size: 11px;
  font-weight: 700;
  transition: all 0.15s ease;
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;
}
.bottom-nav .nav-icon {
  display: grid;
  place-items: center;
  width: 32px;
  height: 26px;
  border-radius: 9px;
  font-size: 18px;
  line-height: 1;
}
.bottom-nav button.active {
  color: var(--ink);
  font-weight: 800;
}
.bottom-nav button.active .nav-icon {
  background: var(--greenbg);
  color: var(--green);
}
.main {
  padding-bottom: calc(88px + env(safe-area-inset-bottom, 16px)) !important;
}
`;

// Replace bottom-nav CSS
html = html.replace(/\.bottom-nav\s*\{[\s\S]*?\.bottom-nav button\.active \.nav-icon\s*\{[\s\S]*?\}/, mobileBottomNavCss);

// 9. Standardize price typography & inputs with currency toggle
const extraCss = `
/* Standardized Price Typography */
.price, .ticker-price, .holding-right b, .detail-price {
  font-family: 'Vazirmatn', sans-serif !important;
  font-variant-numeric: tabular-nums !important;
  font-feature-settings: 'tnum' 1;
  font-weight: 800 !important;
  direction: ltr !important;
  text-align: right !important;
  white-space: nowrap !important;
}
.ticker-price { font-size: 15px; margin-top: 8px; }
.market-card .price { font-size: 16px; margin-top: 10px; }
.detail-price { font-size: 26px; font-weight: 900; }

/* Price input with inside currency toggle */
.price-input-wrapper {
  position: relative;
  display: flex;
  align-items: center;
}
.price-input-wrapper input {
  padding-inline-end: 74px !important;
}
.cur-toggle-btn {
  position: absolute;
  inset-inline-end: 6px;
  top: 50%;
  transform: translateY(-50%);
  padding: 5px 12px;
  border-radius: 9px;
  border: 1px solid var(--line);
  background: var(--paper);
  color: var(--ink);
  font-weight: 800;
  font-size: 11px;
  cursor: pointer;
  transition: all 0.15s ease;
}
.cur-toggle-btn:hover { background: var(--line); }

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
`;

html = html.replace('</style>', extraCss + '\n</style>');

// 10. In JavaScript:
// Update Sun and Moon SVGs
const newSunSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>`;
html = html.replace(/const sunIcon = '.*?';/, `const sunIcon = '${newSunSvg}';`);
html = html.replace(/const moonIcon = '.*?';/, `const moonIcon = '${newMoonSvg}';`);

// 11. Normalize WebSocket matching so KuCoin/OKX pairs match Binance WebSocket ticker
const oldWsMatch = 'const a=assets.find(a=>a.pair===x.s);';
const newWsMatch = 'const a=assets.find(a=>a.pair===x.s || (a.symbol && (a.symbol+"USDT")===x.s) || (a.pair && a.pair.replace(/[-_]/g,"")===x.s));';
html = html.replace(oldWsMatch, newWsMatch);

// 12. Safe WebSocket backoff
const oldWsClose = 'ws.onclose=()=>{ws=null;wsTimer=setTimeout(connectPrices,Math.min(60000,1000*2**Math.min(wsAttempt++,6))+Math.random()*1000)}';
const newWsClose = 'ws.onclose=()=>{ws=null;if(wsAttempt>6)return;wsTimer=setTimeout(connectPrices,Math.min(60000,2000*2**Math.min(wsAttempt++,6))+Math.random()*1000)}';
html = html.replace(oldWsClose, newWsClose);

// 13. Excluded Stablecoins: ONLY Tether (USDT) is shown!
const comprehensiveStables = `const EXCLUDED_STABLES = new Set([
  'usdc','dai','fdusd','tusd','usdp','busd','pyusd','usdd','usds','usd1','usdg',
  'paxg','eurc','ustc','xaut','frax','usde','rlusd','lusd','gusd','crvusd',
  'fxusd','alusd','mim','bgt','usdn','usdx','ssv','susd','dola','deusd',
  'btcst','steth','wsteth','weeth','reth','cbeth','eeth','eurt','usdt0'
]);`;
html = html.replace(/const EXCLUDED_STABLES = new Set\(\[[^\]]*\]\);/, comprehensiveStables);

// In applyPrices, also filter out stables:
html = html.replace(
  /if\(!\/\^\[a-z0-9\]\{1,20\}\$\/\.test\(id\)\|\|!\(i\.price>0\)\)continue;/,
  "if(!/^[a-z0-9]{1,20}$/.test(id)||!(i.price>0)||EXCLUDED_STABLES.has(id)||EXCLUDED_STABLES.has(String(i.symbol||'').toLowerCase()))continue;"
);

// 14. Relative Date format & 12h staleness
const dateHelpers = `
function formatFaDate(dateStr) {
  if (!dateStr) return '';
  const now = new Date();
  const todayStr = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const yest = new Date(now);
  yest.setDate(yest.getDate() - 1);
  const yestStr = new Date(yest.getTime() - yest.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  if (dateStr === todayStr) return 'امروز';
  if (dateStr === yestStr) return 'دیروز';
  return dateStr;
}

function formatRelativeTime(ts) {
  if (!ts) return 'نامشخص';
  const d = new Date(ts * 1000), now = new Date();
  const timeStr = d.toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit', hour12: false });
  const isToday = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  const yest = new Date(now);
  yest.setDate(yest.getDate() - 1);
  const isYesterday = d.getFullYear() === yest.getFullYear() && d.getMonth() === yest.getMonth() && d.getDate() === yest.getDate();
  if (isToday) return 'امروز ' + timeStr;
  if (isYesterday) return 'دیروز ' + timeStr;
  return d.toLocaleDateString('fa-IR', { month: '2-digit', day: '2-digit' }) + ' ' + timeStr;
}

function isStale(a) {
  return !a.updatedAt || (Date.now() / 1000 - a.updatedAt > 43200);
}
`;

html = html.replace(/function isStale[\s\S]*?function quality/, dateHelpers + '\nfunction quality');

// 15. Remove "≈" icon entirely
html = html.replace(/\(approx\?'≈ ':'\)/g, "''");
html = html.replace(/\(approx\?'≈ ':'\s*'\)/g, "''");
html = html.replace(/approx\?'≈ ':''/g, "''");
html = html.replace(/≈/g, '');

// 16. Fix updateSummary and updateTrust to never crash on missing elements and never show stale texts
const safeUpdateSummary = `function updateSummary(){
  const positions=safeLedger().positions,v=totalValue(),p=pnl(),missing=positions.some(p=>!(asset(p.assetId).price>0)||asset(p.assetId).currency!=='IRT'&&!(asset('usdt').price>0));
  $('#homeValue').textContent=$('#portfolioValue').textContent=missing?'ارزش کامل در دسترس نیست':money(v);
  $('#homeCost').textContent=money(totalCost());
  $('#homePL').textContent=missing?'نامشخص':(p>=0?'+':'−')+money(Math.abs(p));
  $('#portfolioPL').textContent='سود/زیان: '+(missing?'نامشخص':(p>=0?'+':'−')+money(Math.abs(p)));
  $('#homeReturn').textContent=missing?'—':fmt.format(roi())+'٪';
  $('#portfolioROI').textContent=missing?'—':fmt.format(roi())+'٪ بازده';
  if($('#realizedPL')) $('#realizedPL').textContent='سود / زیان کل: '+(missing?'نامشخص':(p>=0?'+':'−')+money(Math.abs(p)));
  renderPositions();
}`;
html = html.replace(/function updateSummary\(\)\{[\s\S]*?renderPositions\(\);?\}/, safeUpdateSummary);

const safeUpdateTrust = `function updateTrust(){
  const fresh=assets.filter(a=>a.price>0&&!isStale(a)).length,any=assets.some(a=>a.price>0),allStale=!fresh;
  if($('#homePillText')) $('#homePillText').textContent=!any?'قیمت دریافت نشده':allStale?'دادهٔ قدیمی':'';
  if($('#homePill')) $('#homePill').classList.toggle('sample',allStale);
  if($('#storageStatus')) $('#storageStatus').textContent=state.user?.remote?(syncDirty?'تغییرات این دستگاه هنوز همگام نشده‌اند.':'معاملات با حساب همگام می‌شوند؛ نمودار ارزش سبد روی همین دستگاه ذخیره می‌شود.'):'اطلاعات فقط روی همین مرورگر ذخیره می‌شود؛ برای پشتیبان خروجی بگیر.';
  if(window.feedStatus){
    const f=window.feedStatus;
    if($('#syncStatus')) $('#syncStatus').textContent='رمزارز: '+(lastWs&&Date.now()-lastWs<15000?'اتصال لحظه‌ای':f.crypto?.ok?'دریافت دوره‌ای':'دریافت ناموفق')+' · داخلی: '+(f.domestic?.ok?'آخرین قیمت منتشرشده':'دریافت ناموفق');
  }
  document.querySelectorAll('[data-detail] .change').forEach(el=>{
    const a=asset(el.closest('[data-detail]').dataset.detail);
    if(!Number.isFinite(a.change))el.textContent='—';
  });
}`;
html = html.replace(/function updateTrust\(\)\{[\s\S]*?el\.textContent='—'\}\);?\}/, safeUpdateTrust);

// 17. Safe renderAll: never crash on userName or missing elements
html = html.replace(
  /\$\('#userName'\)\.textContent=state\.user\?\.name\|\|'سرمایه‌گذار';/,
  "if($('#userName')) $('#userName').textContent=state.user?.name||'سرمایه‌گذار';"
);

// 18. Featured picker limit 24
html = html.replace(/const MAX=16;/g, 'const MAX=24;');
html = html.replace(/حداکثر ۱۶ ارز/g, 'حداکثر ۲۴ ارز');
html = html.replace(/slice\(0,16\)/g, 'slice(0,24)');

// 19. Transaction item list in Portfolio:
// - No fee displayed
// - Show current price of asset
// - Show profit & loss
// - No "خرید" in front of asset name
const newHoldingRenderer = `el.innerHTML = state.holdings.map((h, i) => {
  const a = asset(h.assetId);
  const curUnit = quoteToman(a);
  const curVal = curUnit > 0 ? h.qty * curUnit : h.qty * h.buyPrice;
  const costTotal = h.qty * h.buyPrice + (h.fee || 0);
  const diff = curUnit > 0 ? (curVal - costTotal) : 0;
  const diffPct = costTotal > 0 && curUnit > 0 ? (diff / costTotal) * 100 : 0;
  const isUp = diff >= 0;
  return \`<article class="holding">
    <div>
      <div class="holding-left">
        \${assetIcon(a)}
        <div style="min-width:0">
          <div class="holding-title">\${a.name}</div>
          <div class="table-note">\${qtyFmt.format(h.qty)} واحد · \${formatFaDate(h.date)}</div>
          <div class="table-note" style="color:var(--muted)">قیمت الان: \${curUnit > 0 ? money(curUnit) : 'در دسترس نیست'}</div>
        </div>
      </div>
      <div class="holding-actions">
        <button class="small-btn" data-edit-holding="\${h.id}">ویرایش</button>
        <button class="small-btn" data-delete-holding="\${h.id}">حذف</button>
      </div>
    </div>
    <div class="holding-right">
      <b>\${curUnit > 0 ? money(curVal) : money(costTotal)}</b>
      <small style="color:\${isUp ? 'var(--green)' : 'var(--red)'};font-weight:800;display:block;margin-top:2px">
        \${curUnit > 0 ? ((isUp ? '+' : '−') + money(Math.abs(diff)) + ' (' + fmt.format(Math.abs(diffPct)) + '٪)') : 'در انتظار قیمت'}
      </small>
    </div>
  </article>\`;
}).join('')`;
html = html.replace(/el\.innerHTML=state\.holdings\.map\(\(h,i\)=>\{[\s\S]*?\}\)\.join\(''\)/, newHoldingRenderer);

// 20. buyForm with:
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

// 21. Interactive Chart Scrubbing & Tooltip
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
    const timeStr = formatRelativeTime(p[0]);
    const priceStr = formatter(p[1]);
    tip.innerHTML = '<span>' + timeStr + '</span> · <strong style=\"direction:ltr\">' + priceStr + '</strong>';
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

fs.writeFileSync('src/index.html', html, 'utf8');
console.log('Successfully rebuilt src/index.html! Length:', html.length);
