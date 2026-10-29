import re

with open('src/index.html', 'r', encoding='utf-8') as f:
    html = f.read()

print("Original length:", len(html))

# -------------------------------------------------------------
# 1. REMOVE SILVER FROM SEED ASSETS
# -------------------------------------------------------------
html = re.sub(r"\{id:'silver',name:'نقره جهانی',symbol:'XAG',cat:'global',icon:'◌',price:53000,change:\.54,color:'#9ca9b8'\},?", "", html)

# -------------------------------------------------------------
# 2. PRICE FORMATTING HELPERS
# -------------------------------------------------------------
# Add formatEnPrice and new quote / money / quoteText / moneyText
new_price_helpers = """
function formatEnPrice(n) {
  if (!Number.isFinite(n) || n === null || n === undefined) return '—';
  if (n === 0) return '0';
  const abs = Math.abs(n);
  if (abs >= 1000) {
    return n.toLocaleString('en-US', { minimumFractionDigits: abs % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 });
  } else if (abs >= 1) {
    return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  } else {
    return n.toLocaleString('en-US', { maximumSignificantDigits: 6 });
  }
}

function quoteUnit(a) {
  return a.currency === 'USDT' ? 'USDT' : a.currency === 'USD' ? 'USD' : rialOn() ? 'ریال' : 'تومان';
}

function quote(a, n = a.price) {
  if (!Number.isFinite(n) || n <= 0) return '<span class="p-num">—</span>';
  const val = n * (a.currency === 'IRT' && rialOn() ? 10 : 1);
  return `<span class="p-num">${formatEnPrice(val)}</span><span class="p-unit">${quoteUnit(a)}</span>`;
}

function quoteText(a, n = a.price) {
  if (!Number.isFinite(n) || n <= 0) return '—';
  const val = n * (a.currency === 'IRT' && rialOn() ? 10 : 1);
  return `${formatEnPrice(val)} ${quoteUnit(a)}`;
}

function money(n) {
  if (!Number.isFinite(n)) return `<span class="p-num">0</span><span class="p-unit">${rialOn() ? 'ریال' : 'تومان'}</span>`;
  const val = Number(n) * (rialOn() ? 10 : 1);
  const sign = val < 0 ? '−' : '';
  return `${sign}<span class="p-num">${formatEnPrice(Math.abs(val))}</span><span class="p-unit">${rialOn() ? 'ریال' : 'تومان'}</span>`;
}

function moneyText(n) {
  if (!Number.isFinite(n)) return `0 ${rialOn() ? 'ریال' : 'تومان'}`;
  const val = Number(n) * (rialOn() ? 10 : 1);
  const sign = val < 0 ? '−' : '';
  return `${sign}${formatEnPrice(Math.abs(val))} ${rialOn() ? 'ریال' : 'تومان'}`;
}
"""

# Replace existing quote / money / quoteUnit / quoteToman
html = re.sub(
    r'function quoteUnit\(a\)\{[\s\S]*?function quoteToman\(a\)\{[\s\S]*?return fx\.price>0\?a\.price\*fx\.price:0\}',
    new_price_helpers.strip() + """
function quoteToman(a) {
  if (!Number.isFinite(a.price)) return 0;
  if (a.currency === 'IRT') return a.price;
  const fx = asset('usdt');
  return fx.price > 0 ? a.price * fx.price : 0;
}""",
    html
)

# -------------------------------------------------------------
# 3. TOP STYLE SWITCHER BAR (1 - 2 - 3 - 4 - 5)
# -------------------------------------------------------------
switcher_html = """
<div class="style-switcher-bar">
  <span class="style-switcher-title">قالب:</span>
  <div class="style-switcher-nums">
    <button type="button" class="style-num active" data-style-id="1">1</button>
    <button type="button" class="style-num" data-style-id="2">2</button>
    <button type="button" class="style-num" data-style-id="3">3</button>
    <button type="button" class="style-num" data-style-id="4">4</button>
    <button type="button" class="style-num" data-style-id="5">5</button>
  </div>
</div>
"""

# Insert switcher at the top of <div class="app">
html = re.sub(r'(<div class="app">\s*<main class="main">)', r'\1\n' + switcher_html, html)

# -------------------------------------------------------------
# 4. REMOVE PORTFOLIO HERO FROM DASHBOARD (HOME)
# & CLEAN DASHBOARD HEADER
# -------------------------------------------------------------
# Remove portfolio-hero from home
html = re.sub(r'<div class="portfolio-hero">[\s\S]*? جزئیات دارایی <span>←</span></button></div></div>', '', html)

# In quick-grid, remove watchlist card so it only has 2 cards:
html = re.sub(r'<button class="quick-card" data-goto="watchlist"[\s\S]*?مدیریت واچ‌لیست ←</span></button>', '', html)

# Clean featured section header:
old_featured_head = re.search(r'<div class="section-head">\s*<div>\s*<h2>قیمت‌های منتخب</h2>[\s\S]*?</div>\s*</div>', html)
if old_featured_head:
    new_featured_head = """<div class="section-head" style="justify-content:flex-end;margin-bottom:8px">
  <button class="btn btn-soft" id="editFeatured" type="button" style="min-height:36px;padding:6px 14px;border-radius:12px;font-size:12px;gap:6px">
    <span style="font-size:16px;line-height:1;font-weight:900">＋</span> مدیریت ارزهای منتخب
  </button>
</div>"""
    html = html.replace(old_featured_head.group(0), new_featured_head)

# Also rename brand title on dashboard if needed
html = html.replace('<div>دارایی من</div><div class="greeting">نبض سرمایه‌ات، یک‌جا</div>', '<div>داشبورد</div><div class="greeting">نبض بازار در یک نگاه</div>')

# -------------------------------------------------------------
# 5. REMOVE WATCHLIST SECTION ENTIRELY
# -------------------------------------------------------------
html = re.sub(r'<section class="view" id="watchlist">[\s\S]*?</section>', '', html)

# -------------------------------------------------------------
# 6. UPDATE BOTTOM NAVIGATION TO 3 BUTTONS (داشبورد، دارایی با سکه، بازار)
# -------------------------------------------------------------
new_nav = """<nav class="bottom-nav" aria-label="ناوبری اصلی">
  <button class="active" data-page="home" type="button">
    <span class="nav-icon">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
    </span>
    <span>داشبورد</span>
  </button>
  <button data-page="portfolio" type="button">
    <span class="nav-icon nav-coin-icon">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="9.5" fill="url(#coinGrad)" stroke="#f59e0b" stroke-width="1.5"/>
        <circle cx="12" cy="12" r="7" stroke="#d97706" stroke-width="1" stroke-dasharray="2 2" fill="none"/>
        <text x="12" y="15.5" font-size="10" font-weight="900" fill="#78350f" text-anchor="middle" font-family="sans-serif">◈</text>
        <defs>
          <linearGradient id="coinGrad" x1="2" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse">
            <stop stop-color="#fef08a"/>
            <stop offset="0.5" stop-color="#eab308"/>
            <stop offset="1" stop-color="#ca8a04"/>
          </linearGradient>
        </defs>
      </svg>
    </span>
    <span style="color:var(--primary);font-weight:800">دارایی</span>
  </button>
  <button data-page="market" type="button">
    <span class="nav-icon">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg>
    </span>
    <span>بازار</span>
  </button>
</nav>"""

html = re.sub(r'<nav class="bottom-nav"[\s\S]*?</nav>', new_nav, html)

# -------------------------------------------------------------
# 7. MARKET VIEW: REMOVE "جهانی", REMOVE INTRO & PILL
# -------------------------------------------------------------
# Remove "جهانی" filter button
html = html.replace('<button class="filter" data-filter="global">جهانی</button>', '')

# Remove market intro
html = re.sub(r'<div class="intro"><div><h1>بازار رو کشف کن</h1><p>جست‌وجو کن، مقایسه کن، دنبال کن\.</p></div><span class="pill sample" id="marketPill">.*?</span></div>', '', html)

# -------------------------------------------------------------
# 8. PORTFOLIO VIEW: MOVE PRIVACY BTN TO PORTFOLIO, REMOVE INTRO & STORAGE STATUS
# -------------------------------------------------------------
# Move privacyBtn from home top-actions:
html = html.replace(
    '<button class="icon-btn" id="privacyBtn" aria-label="پنهان کردن مبالغ">◉</button>',
    ''
)

# In portfolio topbar, add privacyBtn
old_port_top = re.search(r'<section class="view" id="portfolio"><header class="topbar"><div class="brand"><span class="brand-mark">▤</span><div><div>دارایی</div><div class="greeting">.*?</div></div></div><button class="icon-btn primary" id="addHolding">＋</button></header>', html)
if old_port_top:
    new_port_top = """<section class="view" id="portfolio"><header class="topbar"><div class="brand"><span class="brand-mark">▤</span><div><div>دارایی</div><div class="greeting">مدیریت و عملکرد سرمایه‌گذاری</div></div></div><div class="top-actions"><button class="icon-btn" id="privacyBtn" type="button" aria-label="پنهان کردن مبالغ">◉</button><button class="icon-btn primary" id="addHolding" type="button" aria-label="ثبت معامله">＋</button></div></header>"""
    html = html.replace(old_port_top.group(0), new_port_top)

# Remove intro in portfolio
html = re.sub(r'<div class="intro"><div><h1>سرمایه‌ات کجاست؟</h1><p>خریدها رو ثبت کن تا ارزش و عملکردت حساب بشه\.</p></div></div>', '', html)

# Remove storageStatus note in portfolio
html = re.sub(r'<p class="table-note"><span id="storageStatus">.*?</span></p>', '', html)

# -------------------------------------------------------------
# 9. ASSET DETAIL: ADD EQUIVALENT TOMAN OR GLOBAL/USD PRICE & REMOVE WATCHLIST BTN
# -------------------------------------------------------------
new_detail_fn = """
function detail(id) {
  const a = asset(id);
  const fxUsdt = asset('usdt').price > 0 ? asset('usdt').price : (asset('usd').price > 0 ? asset('usd').price : 0);
  const fxUsd = asset('usd').price > 0 ? asset('usd').price : fxUsdt;
  
  let altLabel = '';
  let altVal = '';
  if (a.currency === 'USDT' || a.cat === 'crypto') {
    if (fxUsdt > 0 && a.price > 0) {
      altLabel = 'قیمت به ' + (rialOn() ? 'ریال' : 'تومان');
      const tomanVal = a.price * fxUsdt * (rialOn() ? 10 : 1);
      altVal = `<span class="p-num">${formatEnPrice(tomanVal)}</span><span class="p-unit">${rialOn() ? 'ریال' : 'تومان'}</span>`;
    }
  } else {
    if (fxUsd > 0 && a.price > 0) {
      altLabel = 'معادل دلاری / قیمت جهانی';
      const usdVal = a.price / fxUsd;
      altVal = `<span class="p-num">${formatEnPrice(usdVal)}</span><span class="p-unit">USD</span>`;
    }
  }

  openModal(a.name, `
    <div class="detail-hero">
      <div style="display:flex;align-items:center;gap:10px">
        ${assetIcon(a)}
        <div>
          <div class="eyebrow">${a.symbol} · ${catName(a.cat)}</div>
          <div class="detail-price">${quote(a)}</div>
          <span class="change ${a.change >= 0 ? 'up' : 'down'}">${a.change >= 0 ? '↗' : '↘'} ${pct.format(Math.abs(a.change))}٪</span>
        </div>
      </div>
      <div class="detail-chart" id="detailChart"></div>
      <div class="detail-chart-caption"><span id="detailRangeStart">ابتدای روز</span><span>اکنون</span></div>
      <div class="table-note" id="detailNote">در حال بارگذاری نمودار…</div>
      <div class="detail-range-tabs" id="detailRanges">
        <button data-detail-range="1H">۱ ساعته</button>
        <button class="active" data-detail-range="1D">۱ روزه</button>
        <button data-detail-range="3D">۳ روزه</button>
        <button data-detail-range="1W">۱ هفته</button>
        <button data-detail-range="1M">۱ ماه</button>
        <button data-detail-range="1Y">۱ سال</button>
      </div>
    </div>
    <div class="asset-detail-grid">
      <div class="detail-metric">
        <small>قیمت فعلی</small>
        <b data-detail-live>${quote(a)}</b>
      </div>
      <div class="detail-metric">
        <small>${altLabel || 'نرخ برابری'}</small>
        <b style="color:var(--primary)">${altVal || '—'}</b>
      </div>
      <div class="detail-metric">
        <small>تغییر روزانه</small>
        <b style="color:${a.change >= 0 ? 'var(--green)' : 'var(--red)'}">${a.change >= 0 ? '+' : ''}${fmt.format(a.change)}٪</b>
      </div>
      <div class="detail-metric">
        <small>دسته‌بندی</small>
        <b>${catName(a.cat)}</b>
      </div>
    </div>
    <div class="page-actions" style="margin-top:14px">
      <button class="btn btn-lime" id="detailBuy" style="flex:1">＋ ثبت معامله</button>
      <button class="btn btn-soft" id="detailAlert" style="flex:1">♧ هشدار قیمت</button>
    </div>
  `);
  
  $('#detailBuy').onclick = () => buyForm(null, id);
  $('#detailAlert').onclick = () => alertForm(id);
  $('#detailRanges').addEventListener('click', e => {
    const b = e.target.closest('[data-detail-range]');
    if (!b) return;
    $$('#detailRanges button').forEach(x => x.classList.toggle('active', x === b));
    loadChart(a, b.dataset.detailRange);
  });
  loadChart(a, '1D');
}
"""

html = re.sub(r'function detail\(id\)\{[\s\S]*?loadChart\(a,\'1D\'\)\}', new_detail_fn.strip(), html)

# -------------------------------------------------------------
# 10. HOLDINGS ROW: ONLY SHOW QUANTITY, BOLD PRICE, SUBTLE P/L
# -------------------------------------------------------------
new_holding_row = """
  return `<article class="holding">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;width:100%">
      <div class="holding-left">
        ${assetIcon(a)}
        <div style="min-width:0">
          <div class="holding-title" style="font-weight:800;font-size:14px">${a.name}</div>
          <div class="holding-meta" style="font-size:11px;color:var(--muted);margin-top:2px">
            <span class="p-num" style="font-weight:700">${formatEnPrice(h.qty)}</span> <span class="p-unit">${a.symbol}</span>
          </div>
        </div>
      </div>
      <div class="holding-right" style="text-align:left;display:flex;flex-direction:column;align-items:flex-end">
        <div style="font-size:15px;font-weight:900;direction:ltr">
          ${curUnit > 0 ? quote(a, curVal) : 'در انتظار قیمت'}
        </div>
        <small class="change ${isUp ? 'up' : 'down'}" style="font-size:11px;font-weight:600;opacity:0.85;display:inline-flex;gap:3px;direction:ltr;margin-top:2px">
          ${curUnit > 0 ? ((isUp ? '+' : '−') + moneyText(Math.abs(diff)) + ' (' + fmt.format(Math.abs(diffPct)) + '٪)') : '—'}
        </small>
      </div>
    </div>
    <div class="holding-foot" style="margin-top:8px;padding-top:6px;border-top:1px solid var(--line);display:flex;gap:8px;justify-content:flex-end">
      <button class="small-btn" data-edit-holding="${h.id}" type="button">ویرایش</button>
      <button class="small-btn" data-delete-holding="${h.id}" type="button">حذف</button>
    </div>
  </article>`;
"""

html = re.sub(r'return `<article class="holding">[\s\S]*?</article>`;', new_holding_row.strip(), html)

# -------------------------------------------------------------
# 11. TOOLTIP IN CHARTS: TWO LINES (PRICE TOP, DATE BOTTOM) & CONTINUOUS SCRUB
# -------------------------------------------------------------
new_paint_chart = """
function paintChart(box, points, color, formatter) {
  points = points.filter(p => Number.isFinite(p[0]) && Number.isFinite(p[1])).sort((a, b) => a[0] - b[0]);
  box.style.position = 'relative';
  box.style.direction = 'ltr';
  box.innerHTML = chartSVG(points, color);
  if (points.length < 2) return;
  
  const tip = document.createElement('div');
  tip.className = 'chart-tooltip';
  box.appendChild(tip);
  
  const geom = chartGeometry(points);
  const svg = box.querySelector('svg');
  const cross = box.querySelector('.crosshair');
  box.tabIndex = 0;
  
  const modalLive = document.querySelector('#modalBody [data-detail-live], #modalBody .detail-price');
  const origPriceHtml = modalLive ? modalLive.innerHTML : '';
  
  const show = i => {
    const idx = Math.max(0, Math.min(points.length - 1, i));
    const p = points[idx], xy = geom[idx];
    const timeStr = formatRelativeDate(p[0]);
    const priceStr = formatter ? formatter(p[1]) : formatEnPrice(p[1]);
    
    tip.innerHTML = `
      <div class="tip-price" style="direction:ltr;font-weight:800;font-size:13px">${priceStr}</div>
      <div class="tip-date" style="font-size:9.5px;color:var(--muted);margin-top:2px;direction:rtl">${timeStr}</div>
    `;
    tip.hidden = false;
    
    const rect = svg.getBoundingClientRect();
    const boxWidth = rect.width || 320;
    const pxX = (xy[0] / 640) * boxWidth;
    tip.style.left = Math.max(75, Math.min(boxWidth - 75, pxX)) + 'px';
    
    cross.setAttribute('visibility', 'visible');
    const line = cross.querySelector('line'), dot = cross.querySelector('circle');
    line.setAttribute('x1', xy[0]);
    line.setAttribute('x2', xy[0]);
    dot.setAttribute('cx', xy[0]);
    dot.setAttribute('cy', xy[1]);
    
    if (modalLive) modalLive.innerHTML = priceStr;
  };

  const move = e => {
    box.dataset.activeUntil = String(Date.now() + 3000);
    const rect = svg.getBoundingClientRect();
    const xRatio = Math.max(0, Math.min(1, (e.clientX - rect.left) / (rect.width || 1)));
    const targetX = xRatio * 640;
    
    let best = 0;
    let minDiff = Infinity;
    for (let i = 0; i < geom.length; i++) {
      const d = Math.abs(geom[i][0] - targetX);
      if (d < minDiff) {
        minDiff = d;
        best = i;
      }
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
    if (modalLive && origPriceHtml) modalLive.innerHTML = origPriceHtml;
  };
  
  show(points.length - 1);
}
"""

html = re.sub(r'function paintChart\(box, points, color, formatter\)[\s\S]*?show\(index\);\s*\}', new_paint_chart.strip(), html)

# -------------------------------------------------------------
# 12. PORTFOLIO CHART INTERPOLATION & COMPACT SNAPSHOTS
# -------------------------------------------------------------
new_render_snapshots = """
function renderSnapshots(box, range) {
  const span = ({'1D':86400,'3D':259200,'1W':604800,'1M':2592000,'1Y':31536000})[range] || 86400;
  const now = Math.floor(Date.now() / 1000);
  const curVal = totalValue();
  let points = snapshots.filter(p => now - p[0] <= span);
  
  if (points.length < 2) {
    const cost = totalCost() > 0 ? totalCost() : curVal * 0.98;
    points = [
      [now - span, cost],
      [now - Math.floor(span * 0.5), (cost + curVal) / 2],
      [now, curVal]
    ];
  } else {
    if (now - points.at(-1)[0] > 60) points.push([now, curVal]);
  }
  paintChart(box, points, 'var(--primary)', money);
}
"""

html = re.sub(r'function renderSnapshots\(box,range\)[\s\S]*?paintChart\(box,points,\'#a1ce4b\',money\);\}', new_render_snapshots.strip(), html)

# -------------------------------------------------------------
# 13. CSS: 5 DISTINCT STYLES & CLEAN SPEC CONSTITUTION
# -------------------------------------------------------------
styles_css = """
/* ------------------------------------------------------------- */
/* UI Styles Constitution (1, 2, 3, 4, 5)                         */
/* ------------------------------------------------------------- */

/* Style Switcher Bar */
.style-switcher-bar {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 8px 12px;
  background: var(--paper);
  border-bottom: 1px solid var(--line);
  position: sticky;
  top: 0;
  z-index: 40;
}
.style-switcher-title {
  font-size: 11px;
  font-weight: 800;
  color: var(--muted);
}
.style-switcher-nums {
  display: flex;
  gap: 6px;
}
.style-num {
  width: 30px;
  height: 30px;
  border-radius: 9px;
  border: 1px solid var(--line);
  background: var(--bg);
  color: var(--ink);
  font-size: 12px;
  font-weight: 900;
  display: grid;
  place-items: center;
  cursor: pointer;
  transition: all 0.15s ease;
}
.style-num:hover {
  transform: translateY(-1px);
  border-color: var(--primary);
}
.style-num.active {
  background: var(--primary) !important;
  color: #ffffff !important;
  border-color: var(--primary) !important;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
}

/* Base Price Typography */
.p-num {
  font-family: 'Vazirmatn', -apple-system, BlinkMacSystemFont, sans-serif !important;
  font-variant-numeric: tabular-nums;
  direction: ltr !important;
  font-weight: 800;
  display: inline-block;
}
.p-unit {
  font-size: 0.65em !important;
  font-weight: 500 !important;
  color: var(--muted) !important;
  margin-inline-start: 4px !important;
  display: inline-block !important;
  vertical-align: baseline !important;
  opacity: 0.85;
}

/* Compact Timestamp (● به‌روز · امروز، ۱۶:۵۹) */
.source, .card-bottom .source, .market-card .source {
  font-size: 9.5px !important;
  font-weight: 500 !important;
  color: var(--muted) !important;
  opacity: 0.75 !important;
  margin-top: 6px !important;
}

/* Tooltip Badge */
.chart-tooltip {
  position: absolute;
  top: 10px;
  transform: translateX(-50%);
  min-width: 120px;
  text-align: center;
  padding: 6px 12px;
  background: var(--paper);
  border: 1px solid var(--line);
  border-radius: 12px;
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.15);
  pointer-events: none;
  z-index: 30;
  white-space: nowrap;
}
.chart-tooltip[hidden] { display: none !important; }

/* Compact Portfolio Summary Card in Assets */
.portfolio-summary {
  background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%) !important;
  color: #f8fafc;
  border-radius: 20px !important;
  padding: 16px 18px !important;
  box-shadow: 0 12px 30px rgba(0, 0, 0, 0.12) !important;
  border: 1px solid rgba(255, 255, 255, 0.08) !important;
  position: relative;
  overflow: hidden;
}
.portfolio-summary .total {
  font-size: clamp(22px, 5vw, 29px) !important;
  font-weight: 900 !important;
  margin: 3px 0 6px !important;
}
.portfolio-range-chart {
  margin-top: 10px !important;
  padding-top: 8px !important;
}
.portfolio-history-chart {
  height: 72px !important;
  margin-top: 4px !important;
}

/* Navigation: Mobile at bottom, Desktop at bottom */
.bottom-nav {
  position: fixed !important;
  z-index: 50 !important;
  bottom: 0 !important;
  left: 0 !important;
  right: 0 !important;
  top: auto !important;
  display: grid !important;
  grid-template-columns: repeat(3, 1fr) !important;
  background: var(--paper) !important;
  border-top: 1px solid var(--line) !important;
  border-left: 0 !important;
  border-right: 0 !important;
  border-bottom: 0 !important;
  border-radius: 0 !important;
  padding: 6px 10px calc(6px + env(safe-area-inset-bottom, 0px)) !important;
  box-shadow: 0 -4px 25px rgba(0, 0, 0, 0.07) !important;
  margin: 0 !important;
  width: 100% !important;
  height: calc(62px + env(safe-area-inset-bottom, 0px)) !important;
  transform: none !important;
}
.bottom-nav::before {
  display: none !important;
}
.bottom-nav button {
  border: 0 !important;
  background: transparent !important;
  color: var(--muted) !important;
  border-radius: 12px !important;
  display: flex !important;
  flex-direction: column !important;
  align-items: center !important;
  justify-content: center !important;
  gap: 2px !important;
  padding: 4px 2px !important;
  font-size: 11px !important;
  font-weight: 700 !important;
  min-height: 48px !important;
  min-width: 0 !important;
  width: 100% !important;
  cursor: pointer !important;
  transition: all 0.15s ease !important;
}
.bottom-nav .nav-icon {
  display: grid !important;
  place-items: center !important;
  width: 32px !important;
  height: 26px !important;
  border-radius: 9px !important;
  font-size: 17px !important;
  line-height: 1 !important;
}
.bottom-nav button.active {
  color: var(--ink) !important;
}
.bottom-nav button.active .nav-icon {
  background: var(--greenbg) !important;
  color: var(--green) !important;
}

@media(min-width: 768px) {
  .main {
    max-width: 1180px !important;
    margin: 0 auto !important;
    padding: 28px 24px 110px !important;
  }
  .bottom-nav {
    left: 50% !important;
    right: auto !important;
    bottom: 18px !important;
    transform: translateX(-50%) !important;
    width: min(440px, calc(100% - 32px)) !important;
    height: 66px !important;
    border: 1px solid var(--line) !important;
    border-radius: 22px !important;
    padding: 6px 14px !important;
    box-shadow: 0 12px 35px rgba(0, 0, 0, 0.12) !important;
  }
}

/* ------------------------------------------------------------- */
/* 5 PALETTES (data-ui-style="1" through "5")                    */
/* ------------------------------------------------------------- */

/* Style 1: Modern Fintech Slate & Emerald (Default) */
html[data-ui-style="1"] {
  --bg: #f8fafc;
  --paper: #ffffff;
  --ink: #0f172a;
  --muted: #64748b;
  --line: #e2e8f0;
  --primary: #10b981;
  --green: #059669;
  --greenbg: #ecfdf5;
  --red: #e11d48;
  --redbg: #fff1f2;
  --radius: 18px;
}
html[data-ui-style="1"][data-theme="dark"] {
  --bg: #090d16;
  --paper: #111827;
  --ink: #f9fafb;
  --muted: #94a3b8;
  --line: #1e293b;
  --primary: #10b981;
  --green: #34d399;
  --greenbg: rgba(16, 185, 129, 0.16);
  --red: #fb7185;
  --redbg: rgba(251, 113, 133, 0.16);
}

/* Style 2: Deep Obsidian & Cyber Lime (Neon Tech) */
html[data-ui-style="2"] {
  --bg: #f1f5f9;
  --paper: #ffffff;
  --ink: #020617;
  --muted: #64748b;
  --line: #cbd5e1;
  --primary: #00c853;
  --green: #00c853;
  --greenbg: #e8f5e9;
  --red: #ff1744;
  --redbg: #ffebee;
  --radius: 12px;
}
html[data-ui-style="2"][data-theme="dark"] {
  --bg: #05070a;
  --paper: #0c1017;
  --ink: #ffffff;
  --muted: #718096;
  --line: #1e2638;
  --primary: #00ff88;
  --green: #00e676;
  --greenbg: rgba(0, 230, 118, 0.15);
  --red: #ff3366;
  --redbg: rgba(255, 51, 102, 0.15);
  --radius: 12px;
}

/* Style 3: Swiss Titanium & Champagne Amber (Minimal Luxury) */
html[data-ui-style="3"] {
  --bg: #f4f4f5;
  --paper: #ffffff;
  --ink: #18181b;
  --muted: #71717a;
  --line: #e4e4e7;
  --primary: #d97706;
  --green: #16a34a;
  --greenbg: #f0fdf4;
  --red: #dc2626;
  --redbg: #fef2f2;
  --radius: 8px;
}
html[data-ui-style="3"][data-theme="dark"] {
  --bg: #121214;
  --paper: #18181b;
  --ink: #fafafa;
  --muted: #a1a1aa;
  --line: #27272a;
  --primary: #f59e0b;
  --green: #22c55e;
  --greenbg: rgba(34, 197, 94, 0.14);
  --red: #ef4444;
  --redbg: rgba(239, 68, 68, 0.14);
  --radius: 8px;
}

/* Style 4: Midnight Sapphire & Cyan Wave (Crypto Indigo) */
html[data-ui-style="4"] {
  --bg: #f0f7ff;
  --paper: #ffffff;
  --ink: #0a192f;
  --muted: #4a5d78;
  --line: #d6e4f5;
  --primary: #0284c7;
  --green: #0d9488;
  --greenbg: #ccfbf1;
  --red: #e11d48;
  --redbg: #ffe4e6;
  --radius: 20px;
}
html[data-ui-style="4"][data-theme="dark"] {
  --bg: #070c18;
  --paper: #0e172a;
  --ink: #f1f5f9;
  --muted: #8292ab;
  --line: #1e2c47;
  --primary: #38bdf8;
  --green: #2dd4bf;
  --greenbg: rgba(45, 212, 191, 0.15);
  --red: #f43f5e;
  --redbg: rgba(244, 63, 94, 0.15);
  --radius: 20px;
}

/* Style 5: Soft Porcelain & Velvet Forest (Natural Prestige) */
html[data-ui-style="5"] {
  --bg: #f7f6f2;
  --paper: #ffffff;
  --ink: #192019;
  --muted: #6b776c;
  --line: #e2e1d9;
  --primary: #2d6a4f;
  --green: #2d6a4f;
  --greenbg: #e8f3ec;
  --red: #c94a4a;
  --redbg: #f9e8e8;
  --radius: 24px;
}
html[data-ui-style="5"][data-theme="dark"] {
  --bg: #0e1511;
  --paper: #16201a;
  --ink: #f0f4f1;
  --muted: #89978c;
  --line: #223027;
  --primary: #52b788;
  --green: #52b788;
  --greenbg: rgba(82, 183, 136, 0.18);
  --red: #e76f51;
  --redbg: rgba(231, 111, 81, 0.18);
  --radius: 24px;
}
"""

html = html.replace('</style>', styles_css + '\n</style>')

# -------------------------------------------------------------
# 14. JAVASCRIPT: WIRE STYLE SWITCHER & PERSISTENCE
# -------------------------------------------------------------
switcher_js = """
// Style Switcher Logic (1, 2, 3, 4, 5)
function initStyleSwitcher() {
  const saved = localStorage.getItem('darayi-ui-style') || '1';
  setStyle(saved);
  
  document.addEventListener('click', e => {
    const btn = e.target.closest('[data-style-id]');
    if (btn) {
      setStyle(btn.dataset.styleId);
    }
  });
}

function setStyle(id) {
  document.documentElement.dataset.uiStyle = id;
  try { localStorage.setItem('darayi-ui-style', id); } catch {}
  document.querySelectorAll('.style-num').forEach(b => {
    b.classList.toggle('active', b.dataset.styleId === String(id));
  });
}
initStyleSwitcher();
"""

html = html.replace('checkSession();', switcher_js + '\ncheckSession();')

with open('src/index.html', 'w', encoding='utf-8') as f:
    f.write(html)
with open('index.html', 'w', encoding='utf-8') as f:
    f.write(html)

print("Finished applying all requirements!")
