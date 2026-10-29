import re
import subprocess

with open("src/index.html", "r", encoding="utf-8") as f:
    content = f.read()

# 1. Update <main class="main"> contents:
main_start = content.find('<div class="app"><main class="main">')
main_end = content.find('</main></div>')

if main_start == -1 or main_end == -1:
    print("Error: Could not locate main tag in src/index.html")
    exit(1)

new_main = """<div class="app"><main class="main">

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

<!-- ===================== VIEW 1: HOME (داشبورد) ===================== -->
<section class="view active" id="home">
  <header class="topbar">
    <div class="brand">
      <span class="brand-mark">◈</span>
      <div>
        <div>دارایی من</div>
        <div class="greeting">نبض سرمایه‌ات، یک‌جا</div>
      </div>
    </div>
    <div class="top-actions">
      <button class="login-btn" id="loginBtn" type="button">ورود</button>
      <button class="icon-btn" id="installBtn" type="button" hidden aria-label="نصب برنامه">⤓</button>
      <button class="icon-btn" id="themeBtn" type="button" aria-label="حالت تیره / روشن">☾</button>
      <button class="icon-btn primary" id="quickAdd" aria-label="ثبت خرید">＋</button>
    </div>
  </header>

  <div class="intro">
    <div>
      <h1>سلام، <span id="userName">سرمایه‌گذار</span>! <span style="color:var(--primary)">✳</span></h1>
      <p>امروز بازارها چه وضعیتی دارند؟</p>
    </div>
  </div>

  <div class="section" style="margin-top:14px">
    <div class="section-head" style="margin-bottom:8px">
      <div style="flex:1"></div>
      <button class="icon-btn" id="editFeatured" type="button" aria-label="انتخاب ارزها" title="انتخاب ارزها" style="width:38px;height:38px;font-size:18px;border-radius:12px">＋</button>
    </div>
    <div class="market-grid" id="featuredGrid"></div>
  </div>

  <div class="section" style="margin-top:24px">
    <div class="section-head">
      <div><h2>بیشترین تغییرات ۲۴ ساعت</h2></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div>
        <div style="font-size:11px;font-weight:800;color:var(--green);margin-bottom:6px">▲ بیشترین صعود</div>
        <div class="market-strip" id="winners" style="padding:0"></div>
      </div>
      <div>
        <div style="font-size:11px;font-weight:800;color:var(--red);margin-bottom:6px">▼ بیشترین افت</div>
        <div class="market-strip" id="losers" style="padding:0"></div>
      </div>
    </div>
  </div>

  <div class="section" style="margin-top:24px">
    <div class="section-head">
      <div><h2>هشدارهای قیمت</h2><p>چشم از قیمت هدف برندار</p></div>
      <button class="text-btn" id="newAlert">＋ هشدار</button>
    </div>
    <div id="alertPreview" class="chart-card">
      <div class="muted" style="font-size:11px">هنوز هشداری تنظیم نشده.</div>
    </div>
  </div>
</section>

<!-- ===================== VIEW 2: MARKETS (بازار) ===================== -->
<section class="view" id="market">
  <header class="topbar">
    <div class="brand">
      <span class="brand-mark">⌁</span>
      <div>
        <div>بازارها</div>
        <div class="greeting">همه‌چیز دربارهٔ قیمت‌ها</div>
      </div>
    </div>
    <button class="icon-btn primary" id="refreshBtn" aria-label="به‌روزرسانی">↻</button>
  </header>

  <div class="controls">
    <input id="marketSearch" class="search" placeholder="جست‌وجوی طلا، دلار، بیت‌کوین…" aria-label="جست‌وجوی دارایی">
    <div class="filter-row" id="marketFilters">
      <button class="filter active" data-filter="all">همه</button>
      <button class="filter" data-filter="currency">ارز</button>
      <button class="filter" data-filter="gold">طلا و سکه</button>
      <button class="filter" data-filter="crypto">رمزارز</button>
    </div>
  </div>
  <div class="market-grid" id="marketGrid"></div>
  <p class="table-note">رمزارزها با USDT نمایش داده می‌شوند؛ تتر داخلی، ارز و طلا به تومان یا ریال. وضعیت و زمان هر قیمت روی کارت مشخص است.</p>
</section>

<!-- ===================== VIEW 3: ASSETS (دارایی) ===================== -->
<section class="view" id="portfolio">
  <header class="topbar">
    <div class="brand">
      <span class="brand-mark">▤</span>
      <div>
        <div>سبد دارایی</div>
        <div class="greeting">مالکیت، هزینه و سود و زیان</div>
      </div>
    </div>
    <div class="top-actions">
      <button class="icon-btn" id="privacyBtn" type="button" aria-label="پنهان کردن مبالغ" title="پنهان کردن مبالغ">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
      </button>
      <button class="icon-btn primary" id="addHolding" aria-label="ثبت معامله" title="ثبت معامله">＋</button>
    </div>
  </header>

  <div class="portfolio-summary">
    <div class="eyebrow">ارزش فعلی دارایی‌ها</div>
    <div class="total" id="portfolioValue">۰ تومان</div>
    <div class="summary-row" style="margin-top:6px">
      <span class="summary-chip" id="portfolioPL">سود/زیان: ۰</span>
      <span class="summary-chip" id="portfolioROI">بازده: ۰٪</span>
      <span class="summary-chip" id="portfolioAssetsCount">۰ دارایی</span>
    </div>
    <div class="portfolio-range-chart" style="margin-top:12px;padding-top:10px">
      <div class="portfolio-chart-top">
        <small id="portfolioChartChange">+۰٫۰٪</small>
        <div class="range-tabs" id="portfolioRanges">
          <button class="active" data-range="1D">۱روز</button>
          <button data-range="3D">۳روز</button>
          <button data-range="1W">۱هفته</button>
          <button data-range="1M">۱ماه</button>
          <button data-range="1Y">۱سال</button>
        </div>
      </div>
      <div id="portfolioHistoryChart" class="portfolio-history-chart" style="height:90px"></div>
      <div class="portfolio-chart-axis"><span id="portfolioRangeStart">ابتدا</span><span id="portfolioRangeEnd">اکنون</span></div>
    </div>
  </div>

  <div class="section">
    <div class="section-head">
      <div><h2>دارایی‌های من</h2><p id="holdingCount">۰ معامله</p></div>
      <button class="text-btn" id="exportBtn">خروجی JSON ↓</button>
    </div>
    <div class="chart-card allocation-card" style="margin-bottom:10px">
      <div class="allocation" id="portfolioAllocation"></div>
    </div>
    <div id="positions" hidden></div>
    <h3 style="margin-top:18px">تاریخچهٔ معاملات</h3>
    <div class="holdings" id="holdings"></div>
  </div>
</section>

<!-- ===================== VIEW 4: SETTINGS (تنظیمات) ===================== -->
<section class="view" id="settings" hidden>
  <header class="topbar">
    <div class="brand"><span class="brand-mark">⚙</span><div><div>تنظیمات</div><div class="greeting">شخصی‌سازی و داده‌ها</div></div></div>
  </header>
  <div class="settings-card">
    <h3>ظاهر برنامه</h3>
    <div class="setting"><div><strong>حالت نمایش</strong><small>روشن یا تیره</small></div><select id="themeSelect"><option value="light">روشن</option><option value="dark">تیره</option></select></div>
    <div class="setting"><div><strong>واحد قیمت</strong><small>نمایش نرخ‌ها با تومان یا ریال</small></div><select id="unitSelect"><option value="toman">تومان</option><option value="rial">ریال</option></select></div>
    <div class="setting"><div><strong>پنهان کردن مبالغ</strong><small>حریم خصوصی هنگام نمایش صفحه</small></div><button class="switch" id="privacySwitch" aria-label="پنهان کردن مبالغ"></button></div>
  </div>
  <div class="settings-card">
    <h3>داده‌ها و پشتیبان‌گیری</h3>
    <div class="setting"><div><strong>به‌روزرسانی قیمت‌ها</strong><small id="syncStatus">در انتظار دریافت قیمت</small></div><button class="btn btn-soft" id="syncNow">↻ دریافت قیمت</button></div>
    <div class="setting"><div><strong>خروجی گرفتن از اطلاعات</strong><small>پشتیبان خریدها و هشدارها</small></div><button class="btn btn-soft" id="backupBtn">دانلود پشتیبان</button></div>
    <div class="setting"><div><strong>بازیابی اطلاعات</strong><small>بارگذاری فایل پشتیبان JSON</small></div><button class="btn btn-soft" id="importBtn">انتخاب فایل</button><input id="importFile" type="file" accept="application/json,.json" hidden></div>
  </div>
  <div class="settings-card">
    <h3>مدیریت داده‌ها</h3>
    <p class="muted" style="font-size:11px">حذف داده‌ها برگشت‌پذیر نیست؛ قبلش از اطلاعاتت پشتیبان بگیر.</p>
    <button class="btn btn-danger" id="clearData">حذف همهٔ داده‌های این دستگاه</button>
  </div>
</section>
"""

content = content[:main_start] + new_main + content[main_end:]

# 2. Update the bottom-nav HTML:
nav_start = content.find('<nav class="bottom-nav"')
nav_end = content.find('</nav>', nav_start) + 6

new_nav = """<nav class="bottom-nav" aria-label="ناوبری اصلی">
  <button class="active nav-tab" data-page="home" type="button" aria-label="داشبورد" title="داشبورد">
    <span class="nav-icon">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/></svg>
    </span>
  </button>
  <button class="nav-tab nav-tab-coin" data-page="portfolio" type="button" aria-label="دارایی" title="دارایی">
    <span class="coin-3d-btn">
      <svg width="38" height="38" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
        <filter id="cShad" x="-25%" y="-25%" width="150%" height="150%">
          <feDropShadow dx="0" dy="4" stdDeviation="3" flood-color="#78350f" flood-opacity="0.45"/>
        </filter>
        <circle cx="20" cy="20" r="18" fill="url(#cRim)" filter="url(#cShad)"/>
        <circle cx="20" cy="19.2" r="16.5" fill="url(#cEdge)"/>
        <circle cx="20" cy="20" r="14.4" fill="url(#cBody)"/>
        <circle cx="20" cy="20" r="12" stroke="url(#cRing)" stroke-width="0.9" stroke-dasharray="2 1.5" fill="none"/>
        <path d="M 9.5 13.8 A 14.4 14.4 0 0 1 30.5 13.8" stroke="#ffffff" stroke-width="1.3" stroke-linecap="round" opacity="0.8" fill="none"/>
        <path d="M 20 11.5 L 26.5 20 L 20 28.5 L 13.5 20 Z" fill="url(#cEmb)"/>
        <path d="M 20 13 L 25 20 L 20 27 L 15 20 Z" fill="#78350f" opacity="0.28"/>
        <circle cx="20" cy="20" r="2.4" fill="#ffffff" opacity="0.95"/>
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

content = content[:nav_start] + new_nav + content[nav_end:]

with open("src/index.html", "w", encoding="utf-8") as f:
    f.write(content)

print("Main structure & nav updated successfully.")
