import re

# 1. Load the pristine JS code from /tmp/chk_1.js
with open('/tmp/chk_1.js', 'r', encoding='utf-8') as f:
    js_code = f.read()

# 2. Load the HTML structure from public/assets/aistudio/index_35b1796e.html as clean base template
with open('public/assets/aistudio/index_35b1796e.html', 'r', encoding='utf-8') as f:
    html = f.read()

print("Base HTML len:", len(html), "JS len:", len(js_code))

# Remove silver from seed assets in JS code
js_code = re.sub(r"\{id:'silver',name:'نقره جهانی',symbol:'XAG',cat:'global',icon:'◌',price:53000,change:\.54,color:'#9ca9b8'\},?", "", js_code)

# Update price formatting in JS code:
# quoteUnit, quote, quoteToman, money, formatEnPrice
price_helpers = """
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

function quoteToman(a) {
  if (!Number.isFinite(a.price)) return 0;
  if (a.currency === 'IRT') return a.price;
  const fx = asset('usdt');
  return fx.price > 0 ? a.price * fx.price : 0;
}
"""

# Replace existing quote / money / quoteUnit / quoteToman in JS code
js_code = re.sub(
    r'function quoteUnit\(a\)\{[\s\S]*?function quoteToman\(a\)\{[\s\S]*?return fx\.price>0\?a\.price\*fx\.price:0\}',
    price_helpers.strip(),
    js_code
)
# Also remove the old `const money=n=>...` definition in JS code
js_code = re.sub(r'const money=n=>fmtP\([^;]+;\s*', '/* money helper */ ', js_code)

# In paintLivePrices, ensure price uses .innerHTML instead of .textContent
js_code = js_code.replace("if(price)price.textContent=quote(a);", "if(price)price.innerHTML=quote(a);")
js_code = js_code.replace("if(price)price.textContent=quote(a);document.querySelectorAll('[data-detail-live]').forEach(el=>el.textContent=quote(a));", "if(price)price.innerHTML=quote(a);document.querySelectorAll('[data-detail-live]').forEach(el=>el.innerHTML=quote(a));")

# Detail modal: add equivalent price in Toman or USD/Global & remove watchlist btn
new_detail = """
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
js_code = re.sub(r'function detail\(id\)\{[\s\S]*?loadChart\(a,\'1D\'\)\}', new_detail.strip(), js_code)

# Holdings rendering in JS: only quantity in meta, bold price, subtle P/L
new_holdings_map = """
  el.innerHTML = state.holdings.map((h, i) => {
    const a = asset(h.assetId);
    const curUnit = a.currency === 'USDT' ? quoteToman(a) : a.price;
    const totalCost = (h.qty * h.buyPrice) + (h.fee || 0);
    const curVal = curUnit > 0 ? (h.qty * curUnit) : 0;
    const diff = curUnit > 0 ? (curVal - totalCost) : 0;
    const diffPct = (totalCost > 0) ? (diff / totalCost) * 100 : 0;
    const isUp = diff >= 0;
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
  }).join('');
"""

js_code = re.sub(
    r'el\.innerHTML\s*=\s*state\.holdings\.map\(\(h, i\)\s*=>\s*\{[\s\S]*?<\/article>`;\s*\}\)\.join\(\'\'\);',
    new_holdings_map.strip(),
    js_code
)

# Smooth Chart Tooltip (Price top, Date bottom)
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
js_code = re.sub(r'function paintChart\(box,points,color,formatter\)[\s\S]*?show\(index\);\s*\}', new_paint_chart.strip(), js_code)

# Portfolio chart interpolation
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
js_code = re.sub(r'function renderSnapshots\(box,range\)[\s\S]*?paintChart\(box,points,\'#a1ce4b\',money\);\}', new_render_snapshots.strip(), js_code)

# Safe renderAll
new_render_all = """
const SUN_SVG = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>`;
const MOON_SVG = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`;

function renderAll() {
  renderHome();
  renderMarket();
  if (typeof renderWatch === 'function') renderWatch();
  renderPortfolio();
  queueMicrotask(hydrateSparks);
  queueMicrotask(() => { updateSummary(); updateTrust(); });
  if ($('#themeSelect')) $('#themeSelect').value = state.theme;
  if ($('#unitSelect')) $('#unitSelect').value = state.unit;
  if ($('#privacySwitch')) $('#privacySwitch').classList.toggle('on', state.privacy);
  document.documentElement.dataset.theme = state.theme;
  if ($('#themeBtn')) $('#themeBtn').innerHTML = state.theme === 'dark' ? SUN_SVG : MOON_SVG;
  const tc = $('meta[name=theme-color]');
  if (tc) tc.content = state.theme === 'dark' ? '#090d16' : '#f8fafc';
  document.body.classList.toggle('hide-value', state.privacy);
  if ($('#userName')) $('#userName').textContent = state.user?.name || 'سرمایه‌گذار';
  if ($('#loginBtn')) $('#loginBtn').textContent = state.user ? state.user.name : 'ورود';
}
"""
js_code = re.sub(r'function renderAll\(\)\{[\s\S]*?loginBtn[\s\S]*?\}', new_render_all.strip(), js_code)

# Style switcher JS logic
switcher_js = """
// 5 Styles Switcher
function initStyleSwitcher() {
  const saved = localStorage.getItem('darayi-ui-style') || '1';
  setStyle(saved);
  document.addEventListener('click', e => {
    const btn = e.target.closest('[data-set-style]');
    if (btn) {
      setStyle(btn.dataset.setStyle);
    }
  });
}
function setStyle(id) {
  document.documentElement.dataset.uiStyle = id;
  try { localStorage.setItem('darayi-ui-style', id); } catch {}
  document.querySelectorAll('.style-num').forEach(b => {
    b.classList.toggle('active', b.dataset.setStyle === String(id));
  });
}
initStyleSwitcher();
"""
js_code = js_code.replace("checkSession();", switcher_js + "\ncheckSession();")

# -----------------------------------------------------------------
# 3. NOW EDIT BASE HTML TEMPLATE
# -----------------------------------------------------------------

# Remove silver from seed
html = re.sub(r"\{id:'silver',name:'نقره جهانی',symbol:'XAG',cat:'global',icon:'◌',price:53000,change:\.54,color:'#9ca9b8'\},?", "", html)

# Anti-cache head
anti_cache_head = """<meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate">
<meta http-equiv="Pragma" content="no-cache">
<meta http-equiv="Expires" content="0">
<script>
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then(function(regs) {
    for (var i = 0; i < regs.length; i++) regs[i].unregister();
  });
}
if ('caches' in window) {
  caches.keys().then(function(keys) {
    for (var i = 0; i < keys.length; i++) caches.delete(keys[i]);
  });
}
</script>"""
html = html.replace('<meta charset="utf-8">', '<meta charset="utf-8">\n' + anti_cache_head)

# Update title & theme color
html = re.sub(r'<title>.*?</title>', '<title>دارایی من (Darayi)</title>', html)
html = re.sub(r'<meta name="theme-color" content=".*?">', '<meta name="theme-color" content="#f8fafc">', html)

# Top 5-style switcher HTML
switcher_bar = """
<div class="style-switcher-bar">
  <span class="style-switcher-title">تم:</span>
  <div class="style-switcher-nums">
    <button type="button" class="style-num active" data-set-style="1" title="اسلیت فین‌تک">1</button>
    <button type="button" class="style-num" data-set-style="2" title="ابسیدین سایبر">2</button>
    <button type="button" class="style-num" data-set-style="3" title="تیتانیوم سوئیسی">3</button>
    <button type="button" class="style-num" data-set-style="4" title="آبی نپتون">4</button>
    <button type="button" class="style-num" data-set-style="5" title="زمردی ارگانیک">5</button>
  </div>
</div>
"""
html = re.sub(r'(<div class="app">\s*<main class="main">)', r'\1\n' + switcher_bar, html)

# Remove portfolio hero from Dashboard (home)
html = re.sub(r'<div class="portfolio-hero">[\s\S]*? جزئیات دارایی <span>←</span></button></div></div>', '', html)

# Dashboard quick grid: 2 cards only
new_quick_grid = """<div class="quick-grid" style="grid-template-columns: 1fr 1fr">
  <button class="quick-card" data-goto="market" type="button">
    <span class="qicon purple">⌁</span>
    <small>تعداد بازارها</small>
    <b id="assetCount">۰ بازار</b>
    <span class="quick-link">مشاهده بازارها ←</span>
  </button>
  <button class="quick-card" data-goto="portfolio" type="button">
    <span class="qicon orange">▤</span>
    <small>معاملات ثبت‌شده</small>
    <b id="tradeCount">۰ ثبت</b>
    <span class="quick-link">رفتن به دارایی ←</span>
  </button>
</div>"""
html = re.sub(r'<div class="quick-grid">[\s\S]*?</div>\s*</div>\s*</div>', new_quick_grid + '</div></div>', html)

# Clean featured head (remove texts, hyperlink, pencil -> ＋)
old_feat_head = re.search(r'<div class="section-head">\s*<div>\s*<h2>قیمت‌های منتخب</h2>[\s\S]*?</div>\s*</div>', html)
if old_feat_head:
    new_feat_head = """<div class="section-head" style="justify-content:flex-end;margin-bottom:8px">
  <button class="btn btn-soft" id="editFeatured" type="button" style="min-height:36px;padding:6px 14px;border-radius:12px;font-size:12px;gap:6px">
    <span style="font-size:16px;line-height:1;font-weight:900">＋</span> مدیریت ارزهای منتخب
  </button>
</div>"""
    html = html.replace(old_feat_head.group(0), new_feat_head)

# In topbar of home, remove privacyBtn (it goes to portfolio)
html = html.replace('<button class="icon-btn" id="privacyBtn" aria-label="پنهان کردن مبالغ">◉</button>', '')

# Remove Watchlist view section completely
html = re.sub(r'<section class="view" id="watchlist">[\s\S]*?</section>', '', html)

# In Market view: remove "جهانی" filter, remove intro text, remove marketPill
html = html.replace('<button class="filter" data-filter="global">جهانی</button>', '')
html = re.sub(r'<div class="intro"><div><h1>بازار رو کشف کن</h1><p>جست‌وجو کن، مقایسه کن، دنبال کن\.</p></div><span class="pill sample" id="marketPill">.*?</span></div>', '', html)

# In Portfolio view:
# 1. Add privacyBtn in header
old_port_top = re.search(r'<section class="view" id="portfolio"><header class="topbar"><div class="brand"><span class="brand-mark">▤</span><div><div>دارایی</div><div class="greeting">.*?</div></div></div><button class="icon-btn primary" id="addHolding">＋</button></header>', html)
if old_port_top:
    new_port_top = """<section class="view" id="portfolio"><header class="topbar"><div class="brand"><span class="brand-mark">▤</span><div><div style="font-weight:900;font-size:16px">دارایی</div><div class="greeting">مدیریت و عملکرد سرمایه‌گذاری</div></div></div><div class="top-actions"><button class="icon-btn" id="privacyBtn" type="button" aria-label="پنهان کردن مبالغ">◉</button><button class="icon-btn primary" id="addHolding" type="button" aria-label="ثبت معامله">＋</button></div></header>"""
    html = html.replace(old_port_top.group(0), new_port_top)

# 2. Remove intro in portfolio
html = re.sub(r'<div class="intro"><div><h1>سرمایه‌ات کجاست؟</h1><p>خریدها رو ثبت کن تا ارزش و عملکردت حساب بشه\.</p></div></div>', '', html)

# 3. Remove storageStatus in portfolio
html = re.sub(r'<p class="table-note"><span id="storageStatus">.*?</span></p>', '', html)

# -------------------------------------------------------------
# 4. BOTTOM NAV: 3 ICON-ONLY BUTTONS (LARGER 3D COIN IN CENTER)
# -------------------------------------------------------------
new_3button_nav = """<nav class="bottom-nav" aria-label="ناوبری اصلی">
  <button class="active nav-tab" data-page="home" type="button" aria-label="داشبورد" title="داشبورد">
    <span class="nav-icon">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/></svg>
    </span>
  </button>
  <button class="nav-tab nav-tab-coin" data-page="portfolio" type="button" aria-label="دارایی" title="دارایی">
    <span class="coin-3d-btn">
      <svg width="34" height="34" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
        <filter id="cShad" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="3" stdDeviation="2.5" flood-color="#b45309" flood-opacity="0.4"/>
        </filter>
        <circle cx="20" cy="20" r="17.5" fill="url(#cRim)" filter="url(#cShad)"/>
        <circle cx="20" cy="19.3" r="16.2" fill="url(#cEdge)"/>
        <circle cx="20" cy="20" r="14.2" fill="url(#cBody)"/>
        <circle cx="20" cy="20" r="11.8" stroke="url(#cRing)" stroke-width="0.8" stroke-dasharray="2 1.5" fill="none"/>
        <path d="M 9.5 13.8 A 14.2 14.2 0 0 1 30.5 13.8" stroke="#ffffff" stroke-width="1.2" stroke-linecap="round" opacity="0.75" fill="none"/>
        <path d="M 20 11.8 L 26.2 20 L 20 28.2 L 13.8 20 Z" fill="url(#cEmb)"/>
        <path d="M 20 13.2 L 24.6 20 L 20 26.8 L 15.4 20 Z" fill="#78350f" opacity="0.3"/>
        <circle cx="20" cy="20" r="2.2" fill="#ffffff" opacity="0.95"/>
        <defs>
          <linearGradient id="cRim" x1="6" y1="4" x2="34" y2="36" gradientUnits="userSpaceOnUse">
            <stop stop-color="#fbbf24"/>
            <stop offset="0.5" stop-color="#d97706"/>
            <stop offset="1" stop-color="#78350f"/>
          </linearGradient>
          <linearGradient id="cEdge" x1="8" y1="5" x2="32" y2="35" gradientUnits="userSpaceOnUse">
            <stop stop-color="#fef08a"/>
            <stop offset="0.5" stop-color="#f59e0b"/>
            <stop offset="1" stop-color="#b45309"/>
          </linearGradient>
          <linearGradient id="cBody" x1="10" y1="8" x2="30" y2="32" gradientUnits="userSpaceOnUse">
            <stop stop-color="#fde047"/>
            <stop offset="0.55" stop-color="#eab308"/>
            <stop offset="1" stop-color="#ca8a04"/>
          </linearGradient>
          <linearGradient id="cRing" x1="12" y1="10" x2="28" y2="30" gradientUnits="userSpaceOnUse">
            <stop stop-color="#fef9c3"/>
            <stop offset="1" stop-color="#a16207"/>
          </linearGradient>
          <linearGradient id="cEmb" x1="14" y1="12" x2="26" y2="28" gradientUnits="userSpaceOnUse">
            <stop stop-color="#ffffff"/>
            <stop offset="0.5" stop-color="#fef08a"/>
            <stop offset="1" stop-color="#b45309"/>
          </linearGradient>
        </defs>
      </svg>
    </span>
  </button>
  <button class="nav-tab" data-page="market" type="button" aria-label="بازار" title="بازار">
    <span class="nav-icon">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/></svg>
    </span>
  </button>
</nav>"""

html = re.sub(r'<nav class="bottom-nav"[\s\S]*?</nav>', new_3button_nav, html)

# -------------------------------------------------------------
# 5. CSS STYLES (CLEAN, ROBUST, 5 STYLES, BOTTOM BAR BOTH MOBILE & DESKTOP)
# -------------------------------------------------------------
master_css = """
/* ============================================================= */
/* MASTER UI STYLING & 5 PALETTES                                */
/* ============================================================= */

/* Top Style Switcher Bar */
.style-switcher-bar {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 8px 12px;
  background: var(--paper);
  border-bottom: 1px solid var(--line);
  position: sticky;
  top: 0;
  z-index: 45;
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
  width: 28px;
  height: 28px;
  border-radius: 8px;
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
  border-color: var(--primary);
  transform: translateY(-1px);
}
.style-num.active {
  background: var(--primary) !important;
  color: #ffffff !important;
  border-color: var(--primary) !important;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
}

/* Typography for Prices: English numerals & subtle unbolded unit */
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

/* Chart Tooltip: Price top, Date bottom */
.chart-tooltip {
  position: absolute;
  top: 8px;
  transform: translateX(-50%);
  min-width: 124px;
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

/* Compact Portfolio Summary in Assets */
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
  margin-top: 8px !important;
  padding-top: 8px !important;
}
.portfolio-history-chart {
  height: 68px !important;
  margin-top: 4px !important;
}

/* ------------------------------------------------------------- */
/* 3-BUTTON BOTTOM NAVIGATION (ICON-ONLY, PROMINENT 3D COIN)     */
/* ------------------------------------------------------------- */
.bottom-nav {
  position: fixed !important;
  z-index: 50 !important;
  bottom: 0 !important;
  left: 0 !important;
  right: 0 !important;
  top: auto !important;
  display: flex !important;
  align-items: center !important;
  justify-content: space-around !important;
  background: var(--paper) !important;
  border-top: 1px solid var(--line) !important;
  border-left: 0 !important;
  border-right: 0 !important;
  border-bottom: 0 !important;
  border-radius: 0 !important;
  padding: 4px 16px calc(6px + env(safe-area-inset-bottom, 0px)) !important;
  box-shadow: 0 -4px 25px rgba(0, 0, 0, 0.07) !important;
  margin: 0 !important;
  width: 100% !important;
  height: calc(62px + env(safe-area-inset-bottom, 0px)) !important;
  transform: none !important;
}
.bottom-nav::before {
  display: none !important;
}
.bottom-nav .nav-tab {
  border: 0 !important;
  background: transparent !important;
  color: var(--muted) !important;
  border-radius: 14px !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  width: 48px !important;
  height: 48px !important;
  padding: 0 !important;
  cursor: pointer !important;
  transition: all 0.15s ease !important;
  position: relative;
}
.bottom-nav .nav-tab .nav-icon {
  display: grid !important;
  place-items: center !important;
  width: 38px !important;
  height: 38px !important;
  border-radius: 12px !important;
}
.bottom-nav .nav-tab.active .nav-icon {
  background: var(--greenbg) !important;
  color: var(--primary) !important;
}

/* Center 3D Coin Button: LARGER & ELEVATED */
.bottom-nav .nav-tab-coin {
  width: 58px !important;
  height: 58px !important;
  border-radius: 50% !important;
  margin-top: -18px !important;
  background: radial-gradient(circle at 35% 30%, #fffbeb 0%, #fef08a 35%, #eab308 100%) !important;
  border: 3px solid var(--paper) !important;
  box-shadow: 0 8px 22px rgba(234, 179, 8, 0.45) !important;
  display: grid !important;
  place-items: center !important;
  transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1) !important;
}
.bottom-nav .nav-tab-coin:active {
  transform: scale(0.92) !important;
}
.bottom-nav .nav-tab-coin.active {
  box-shadow: 0 8px 26px rgba(234, 179, 8, 0.65), 0 0 0 3px var(--primary) !important;
  transform: translateY(-2px) !important;
}
.coin-3d-btn {
  display: grid;
  place-items: center;
}

/* Desktop layout: floating bottom nav bar (No sidebar!) */
@media(min-width: 768px) {
  .main {
    max-width: 1180px !important;
    margin: 0 auto !important;
    padding: 24px 20px 110px !important;
  }
  .bottom-nav {
    left: 50% !important;
    right: auto !important;
    bottom: 20px !important;
    transform: translateX(-50%) !important;
    width: min(380px, calc(100% - 32px)) !important;
    height: 66px !important;
    border: 1px solid var(--line) !important;
    border-radius: 24px !important;
    padding: 4px 20px !important;
    box-shadow: 0 14px 40px rgba(0, 0, 0, 0.15) !important;
  }
}

/* ------------------------------------------------------------- */
/* 5 THEMES (data-ui-style="1" through "5")                      */
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
}
"""

html = html.replace('</style>', master_css + '\n</style>')

# Replace the inner JavaScript in the HTML with our intact, improved js_code!
# Find the second <script> tag
script_matches = list(re.finditer(r'<script[^>]*>([\s\S]*?)</script>', html))
assert len(script_matches) >= 2, "Expected at least 2 script tags"
second_script = script_matches[1]

html = html[:second_script.start(1)] + "\n" + js_code + "\n" + html[second_script.end(1):]

with open('src/index.html', 'w', encoding='utf-8') as f:
    f.write(html)
with open('index.html', 'w', encoding='utf-8') as f:
    f.write(html)

print("Saved cleanly to src/index.html and index.html!")
