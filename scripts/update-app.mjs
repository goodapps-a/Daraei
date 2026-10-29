import fs from 'node:fs';

const htmlPath = 'src/index.html';
let html = fs.readFileSync(htmlPath, 'utf8');

console.log('Original src/index.html lines:', html.split('\n').length);

// 1. Remove greeting & subtitle from home view
// Remove any "سلام، سرمایه‌گذار! ..." or "امروز دارایی‌هات چه حال‌وهوایی دارن؟"
html = html.replace(/<div class="intro">[\s\S]*?<\/div>/g, (match) => {
  if (match.includes('سلام') || match.includes('حال‌وهوا')) {
    return '';
  }
  return match;
});

// Also remove "زمان قیمت‌ها متفاوت است" from updateTrust or pill texts
html = html.replace(/'زمان قیمت‌ها متفاوت است'/g, "''");
html = html.replace(/"زمان قیمت‌ها متفاوت است"/g, '""');
html = html.replace(/<span class="pill sample" id="homePill">[\s\S]*?<\/span>/, '<span class="pill sample" id="homePill" style="display:none"><span class="dot"></span><span id="homePillText"></span></span>');

// 2. Remove Cloudflare button from topbar
html = html.replace(/<button class="icon-btn" id="cfDeployBtn"[\s\S]*?<\/button>/g, '');
html = html.replace(/const cfBtn=\$?\('#cfDeployBtn'\);[\s\S]*?cwb\.textContent='📋 کپی کردن کل کد worker\.js';},3000\);\s*}\s*};\s*}/g, '');

// 3. Modern Dark Mode Sun & Moon SVGs and styling
const newSunIcon = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>`;
const newMoonIcon = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`;

html = html.replace(/const sunIcon = '[\s\S]*?';/, `const sunIcon = '${newSunIcon}';`);
html = html.replace(/const moonIcon = '[\s\S]*?';/, `const moonIcon = '${newMoonIcon}';`);
html = html.replace(/<button class="icon-btn" id="themeBtn"[\s\S]*?<\/button>/, `<button class="icon-btn" id="themeBtn" type="button" aria-label="حالت تیره / روشن">${newMoonIcon}</button>`);

// 4. Overhaul Color Palette in CSS (:root and :root[data-theme=dark])
const newCssPalette = `:root {
  color-scheme: light;
  --bg: #f6f8fb;
  --paper: #ffffff;
  --paper-elevated: #ffffff;
  --ink: #0f172a;
  --ink-secondary: #475569;
  --muted: #64748b;
  --line: #e2e8f0;
  --line-strong: #cbd5e1;
  --lime: #10b981;
  --green: #059669;
  --greenbg: #ecfdf5;
  --green-border: #a7f3d0;
  --red: #e11d48;
  --redbg: #fff1f2;
  --red-border: #fecdd3;
  --purple: #6366f1;
  --accent: #4f46e5;
  --orange: #f59e0b;
  --blue: #0284c7;
  --shadow-sm: 0 1px 3px rgba(15, 23, 42, 0.05);
  --shadow: 0 4px 16px -2px rgba(15, 23, 42, 0.06), 0 2px 6px -1px rgba(15, 23, 42, 0.03);
  --shadow-lg: 0 12px 32px -4px rgba(15, 23, 42, 0.08);
  --radius: 18px;
  --radius-sm: 12px;
}
:root[data-theme=dark] {
  color-scheme: dark;
  --bg: #0b0f19;
  --paper: #121927;
  --paper-elevated: #1a2336;
  --ink: #f8fafc;
  --ink-secondary: #cbd5e1;
  --muted: #8b9bb4;
  --line: #1e293b;
  --line-strong: #334155;
  --lime: #10b981;
  --green: #34d399;
  --greenbg: rgba(16, 185, 129, 0.14);
  --green-border: rgba(52, 211, 153, 0.25);
  --red: #fb7185;
  --redbg: rgba(244, 63, 94, 0.14);
  --red-border: rgba(251, 113, 133, 0.25);
  --purple: #818cf8;
  --accent: #6366f1;
  --orange: #fbbf24;
  --blue: #38bdf8;
  --shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.4);
  --shadow: 0 6px 20px -2px rgba(0, 0, 0, 0.5);
  --shadow-lg: 0 16px 40px -4px rgba(0, 0, 0, 0.7);
}`;

html = html.replace(/:root\s*\{[\s\S]*?:root\[data-theme=dark\]\s*\{[\s\S]*?--shadow:\s*0\s*4px\s*20px[\s\S]*?\}/, newCssPalette);

// 5. Standardize Typography and Price styling across all views
const priceAndBottomNavCss = `
/* Standardized Typography & Modern Cards */
* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--ink);
  font: 14px/1.6 'Vazirmatn', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  letter-spacing: -0.2px;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
button, input, select { font: inherit; }
button { cursor: pointer; }
button:focus-visible, input:focus-visible, select:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
button:disabled { opacity: 0.45; cursor: not-allowed; }

.app { min-height: 100dvh; display: flex; flex-direction: column; }
.main {
  flex: 1;
  width: 100%;
  max-width: 1100px;
  margin: 0 auto;
  padding: 16px 16px calc(88px + env(safe-area-inset-bottom, 14px));
}

.topbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 6px 0 14px;
}
.brand { display: flex; align-items: center; gap: 10px; font-weight: 900; font-size: 17px; }
.brand-mark {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border-radius: 11px;
  background: var(--paper);
  border: 1px solid var(--line);
  color: var(--green);
  font-size: 19px;
  box-shadow: var(--shadow-sm);
}
.top-actions { display: flex; align-items: center; gap: 8px; }
.login-btn {
  border: 1px solid var(--line);
  background: var(--paper);
  color: var(--ink);
  border-radius: 11px;
  height: 38px;
  padding: 0 14px;
  font-size: 12px;
  font-weight: 800;
  box-shadow: var(--shadow-sm);
  transition: all 0.15s ease;
}
.login-btn:hover { background: var(--line); }
.icon-btn {
  border: 1px solid var(--line);
  background: var(--paper);
  color: var(--ink);
  width: 38px;
  height: 38px;
  border-radius: 11px;
  display: grid;
  place-items: center;
  font-size: 16px;
  box-shadow: var(--shadow-sm);
  transition: all 0.15s ease;
}
.icon-btn:hover { background: var(--line); }
.icon-btn.primary { background: var(--green); color: #ffffff; border-color: var(--green); }
.icon-btn.primary:hover { opacity: 0.92; }

/* Standardized Price Typography */
.price, .ticker-price, .detail-price, .holding-price {
  font-family: 'Vazirmatn', sans-serif !important;
  font-variant-numeric: tabular-nums !important;
  font-feature-settings: 'tnum' 1;
  font-weight: 800 !important;
  direction: ltr !important;
  text-align: right !important;
  white-space: nowrap !important;
}
.ticker-price {
  font-size: 15px;
  margin-top: 8px;
}
.market-card .price {
  font-size: 16px;
  margin-top: 10px;
}
.detail-price {
  font-size: 26px;
  font-weight: 900;
  letter-spacing: -0.5px;
}

/* Polished Bottom Navigation for Mobile */
.bottom-nav {
  position: fixed;
  z-index: 50;
  bottom: 0;
  left: 0;
  right: 0;
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 4px;
  padding: 6px 12px calc(8px + env(safe-area-inset-bottom, 10px));
  min-height: calc(58px + env(safe-area-inset-bottom, 10px));
  background: var(--paper);
  border-top: 1px solid var(--line);
  box-shadow: 0 -4px 20px rgba(0, 0, 0, 0.05);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  align-items: center;
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
  width: 100%;
  height: 44px;
  padding: 2px 4px;
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;
  transition: all 0.15s ease;
}
.bottom-nav .nav-icon {
  display: grid;
  place-items: center;
  width: 32px;
  height: 24px;
  border-radius: 8px;
  font-size: 18px;
  line-height: 1;
  transition: all 0.15s ease;
}
.bottom-nav button.active {
  color: var(--ink);
  font-weight: 800;
}
.bottom-nav button.active .nav-icon {
  background: var(--greenbg);
  color: var(--green);
  transform: translateY(-1px);
}

/* Floating interactive chart tooltip */
.chart-tooltip {
  position: absolute;
  top: 6px;
  transform: translateX(-50%);
  padding: 5px 12px;
  background: var(--paper);
  color: var(--ink);
  border: 1px solid var(--line);
  border-radius: 10px;
  box-shadow: var(--shadow);
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
`;

// Insert the updated styles
html = html.replace(/\* \{ box-sizing: border-box; \}[\s\S]*?\/\* Modals \*\//, priceAndBottomNavCss + '\n/* Modals */');

// 6. Rename "ارزش کل سبد من" -> "ارزش کل دارایی‌ها"
html = html.replace(/ارزش کل سبد من/g, 'ارزش کل دارایی‌ها');

// 7. Rename "سبد تو در یک نگاه" -> "ترکیب دارایی‌ها"
html = html.replace(/سبد تو در یک نگاه/g, 'ترکیب دارایی‌ها');

// 8. Rename "سبد دارایی" -> "دارایی" in topbar
html = html.replace(/<div>سبد دارایی<\/div>/g, '<div>دارایی</div>');

// 9. Rename "تاریخچهٔ معاملات" and "تاریخچه معاملات و انتقال‌ها" -> "تاریخچه معاملات"
html = html.replace(/تاریخچهٔ معاملات و انتقال‌ها/g, 'تاریخچه معاملات');
html = html.replace(/تاریخچهٔ معاملات/g, 'تاریخچه معاملات');
html = html.replace(/معامله \/ انتقال ثبت‌شده/g, 'معامله ثبت‌شده');

// 10. Remove "خرید" in front of asset name:
// In holding items or cards, ensure only `${a.name}` is shown.
html = html.replace(/\$\{a\.name\} · خرید/g, '${a.name}');

// 11. Remove note from purchase form (نوت راهنمای قیمت را به تومان یا دلار وارد کن...)
html = html.replace(/قیمت را به تومان یا دلار وارد کن[\s\S]*?کارمزد به تومان است\./g, '');

// 12. Remove the two texts from total portfolio card:
// "محاسبه با ۱ قیمت قدیمی / تأخیردار."
// "نیاز به توجه: ۰ هشدار در محدوده هدف · ۰ دارایی با نوسان حداقل ۵٪"
// In HTML hero bottom or home-layout, check if there are #homeQuality or #dailyBrief
html = html.replace(/<div class="quality-note" id="homeQuality">[\s\S]*?<\/div>/g, '');
html = html.replace(/<div class="daily-brief" id="dailyBrief">[\s\S]*?<\/div>/g, '');

// 13. Remove "≈" icon from price displays (approximate)
html = html.replace(/\(approx\?'≈ ':'\)/g, "''");
html = html.replace(/\(approx\?'≈ ':'\s*'\)/g, "''");
html = html.replace(/approx\?'≈ ':''/g, "''");
html = html.replace(/≈/g, '');

// 14. Fix realized PnL always 0 in updateSummary
// Replace the misleading 0 with total open PnL or overall profit/loss
html = html.replace(/\$\('#realizedPL'\)\.textContent='سود\/زیان محقق‌شده: '\+money\(safeLedger\(\)\.realized\);/, "$('#realizedPL') && ($('#realizedPL').textContent='سود / زیان کل: '+(missing?'نامشخص':(p>=0?'+':'−')+money(Math.abs(p))));");

// 15. Comprehensive Stablecoin filtering: Only Tether (usdt) allowed!
const stablesRegex = /const EXCLUDED_STABLES = new Set\(\[[^\]]*\]\);/;
const comprehensiveStables = `const EXCLUDED_STABLES = new Set([
  'usdc','dai','fdusd','tusd','usdp','busd','pyusd','usdd','usds','usd1','usdg',
  'paxg','eurc','ustc','xaut','frax','usde','rlusd','lusd','gusd','crvusd',
  'fxusd','alusd','mim','bgt','usdn','usdx','ssv','susd','dola','deusd',
  'btcst','steth','wsteth','weeth','reth','cbeth','eeth','eurt','usdt0'
]);`;
html = html.replace(stablesRegex, comprehensiveStables);

// 16. Relative Date & 12-hour staleness logic
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
  // Data within the past 12 hours (43200 seconds) is considered fresh and reliable
  return !a.updatedAt || (Date.now() / 1000 - a.updatedAt > 43200);
}
`;

html = html.replace(/function isStale[\s\S]*?function quality/, dateHelpers + '\nfunction quality');

// 17. In updateTrust, remove quality/stale note insertion into #homeQuality and #dailyBrief
html = html.replace(/\$\('#homeQuality'\)\.textContent=[\s\S]*?\$\('#portfolioQuality'\)\.textContent=positions\.length\?note:'برای شروع یک خرید ثبت کن\勃;/, '');
html = html.replace(/\$\('#dailyBrief'\)\.textContent='نیاز به توجه: '[\s\S]*?;\s*/, '');

// 18. Improve interactive Chart Scrubbing & Tooltip
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

// 19. Ensure in renderPortfolio that transaction items show:
// - Date formatted as امروز / دیروز
// - Current price of that asset
// - Profit & Loss (میزان سود و ضرر)
// - NO fee (کارمزد)
const holdingItemRenderer = `el.innerHTML = state.holdings.map((h, i) => {
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

html = html.replace(/el\.innerHTML=state\.holdings\.map\(\(h,i\)=>\{[\s\S]*?\}\)\.join\(''\)\}/, holdingItemRenderer + ';}');

// 20. Ensure buyForm in edit mode ONLY shows amount, unit price, fee, date (no other assets, no notes)
// Check buyForm implementation
console.log('Processed all replacements. Writing to src/index.html...');
fs.writeFileSync(htmlPath, html, 'utf8');
console.log('Successfully updated src/index.html! New line count:', html.split('\n').length);
