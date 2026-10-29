import re

with open("src/index.html", "r", encoding="utf-8") as f:
    html = f.read()

# 1. Clean up legacy conflicting media queries for bottom-nav in CSS:
# In line 24:
html = html.replace("grid-template-columns:repeat(5,minmax(0,1fr))", "grid-template-columns:repeat(3,minmax(0,1fr))")
# In line 25:
html = re.sub(r'@media\(min-width:650px\)\{\.main\{padding:28px 28px 50px\}\.bottom-nav\{[^}]+\}', '@media(min-width:650px){.main{padding:28px 28px 90px}', html)
# In line 128:
html = html.replace("padding:34px 250px 60px 42px", "padding:24px 20px 90px")
html = re.sub(r'\.bottom-nav\{inset:0 0 0 auto;transform:none;width:208px;height:100vh;border-radius:0;border:0;border-left:1px solid var(--line);display:flex;flex-direction:column;justify-content:flex-start;padding:100px 16px 24px;gap:10px;box-shadow:none\}\.bottom-nav button\{[^}]+\}\.bottom-nav button\.active\{background:var\(--greenbg\)\}', '', html)

# 2. Permanent Style 1 variables:
style_vars = """
:root{color-scheme:light;--bg:#f8fafc;--paper:#ffffff;--ink:#0f172a;--muted:#64748b;--line:#e2e8f0;--lime:#10b981;--primary:#10b981;--green:#059669;--greenbg:#ecfdf5;--red:#e11d48;--redbg:#fff1f2;--purple:#7357ff;--orange:#ff9851;--blue:#56c5e8;--shadow:0 12px 35px rgba(15,23,42,0.06);--radius:20px}
:root[data-theme=dark]{color-scheme:dark;--bg:#090d16;--paper:#111827;--ink:#f8fafc;--muted:#94a3b8;--line:#1e293b;--lime:#10b981;--primary:#10b981;--green:#34d399;--greenbg:rgba(16,185,129,0.16);--red:#f43f5e;--redbg:rgba(244,63,94,0.16);--shadow:0 12px 35px rgba(0,0,0,0.4)}
"""
html = re.sub(r':root\{color-scheme:light;[^}]+}\s*:root\[data-theme=dark\]\{[^}]+}', style_vars.strip(), html, count=1)

# Remove the temporary 5 styles CSS rules:
html = re.sub(r'/\* -+\s*\*/\s*/\* 5 THEMES[\s\S]*?</style>', '</style>', html)

# 3. Dedicated clean bottom-nav CSS:
bottom_nav_css = """
/* ROCK-SOLID BOTTOM NAVIGATION */
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
  padding: 4px 20px calc(8px + env(safe-area-inset-bottom, 0px)) !important;
  box-shadow: 0 -4px 25px rgba(0, 0, 0, 0.06) !important;
  margin: 0 !important;
  width: 100% !important;
  height: calc(64px + env(safe-area-inset-bottom, 0px)) !important;
  transform: none !important;
}
.bottom-nav .nav-tab {
  border: 0 !important;
  background: transparent !important;
  color: var(--muted) !important;
  border-radius: 14px !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  width: 44px !important;
  height: 44px !important;
  padding: 0 !important;
  cursor: pointer !important;
  transition: all 0.15s ease !important;
}
.bottom-nav .nav-tab .nav-icon {
  display: grid !important;
  place-items: center !important;
  width: 38px !important;
  height: 38px !important;
  border-radius: 12px !important;
  transition: all 0.15s ease !important;
}
.bottom-nav .nav-tab.active .nav-icon {
  background: var(--greenbg) !important;
  color: var(--primary) !important;
}

/* Center Isometric Coin Button: Prominent & Elevated */
.bottom-nav .nav-tab-coin {
  width: 54px !important;
  height: 54px !important;
  border-radius: 50% !important;
  margin-top: -16px !important;
  background: var(--paper) !important;
  border: 2px solid var(--primary) !important;
  color: var(--primary) !important;
  box-shadow: 0 8px 24px rgba(16, 185, 129, 0.22) !important;
  display: grid !important;
  place-items: center !important;
  cursor: pointer !important;
  transition: transform 0.18s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.18s ease !important;
}
.bottom-nav .nav-tab-coin:hover {
  transform: translateY(-2px) !important;
  box-shadow: 0 10px 28px rgba(16, 185, 129, 0.35) !important;
}
.bottom-nav .nav-tab-coin:active {
  transform: scale(0.93) !important;
}
.bottom-nav .nav-tab-coin.active {
  background: var(--primary) !important;
  color: #ffffff !important;
  box-shadow: 0 8px 26px rgba(16, 185, 129, 0.45) !important;
}
.coin-isometric-btn {
  display: grid;
  place-items: center;
}

/* Fixed Tooltip Dimensions: Rock-solid, NO sizing changes on hover */
.chart-tooltip {
  position: absolute !important;
  top: 8px !important;
  transform: translateX(-50%) !important;
  width: 144px !important;
  min-width: 144px !important;
  max-width: 144px !important;
  box-sizing: border-box !important;
  text-align: center !important;
  padding: 6px 10px !important;
  background: var(--paper) !important;
  border: 1px solid var(--line) !important;
  border-radius: 12px !important;
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.15) !important;
  pointer-events: none !important;
  z-index: 30 !important;
  overflow: hidden !important;
}
.chart-tooltip .tip-price {
  font-size: 13px !important;
  font-weight: 800 !important;
  color: var(--ink) !important;
  direction: ltr !important;
  line-height: 1.3 !important;
  white-space: nowrap !important;
  overflow: hidden !important;
  text-overflow: ellipsis !important;
}
.chart-tooltip .tip-date {
  font-size: 10px !important;
  font-weight: 500 !important;
  color: var(--muted) !important;
  margin-top: 2px !important;
  direction: rtl !important;
  white-space: nowrap !important;
}

/* Form inputs & alignment */
.input-with-button {
  position: relative;
  width: 100%;
  display: flex;
  align-items: center;
}
.inner-cur-btn {
  position: absolute;
  left: 6px;
  top: 50%;
  transform: translateY(-50%);
  background: var(--paper);
  border: 1px solid var(--line);
  color: var(--ink);
  font-size: 10.5px;
  font-weight: 700;
  padding: 3px 9px;
  border-radius: 8px;
  cursor: pointer;
  z-index: 2;
  transition: all 0.15s ease;
}
.inner-cur-btn:hover {
  background: var(--bg);
  border-color: var(--primary);
  color: var(--primary);
}

/* Alert Row Styling */
.alert-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--line);
}
.alert-row:last-child { border-bottom: 0; }
.alert-meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.alert-asset-name { font-size: 13px; font-weight: 800; color: var(--ink); }
.alert-condition { font-size: 10.5px; color: var(--muted); }
.alert-target { font-size: 11px; font-weight: 700; color: var(--primary); direction: ltr; }
.alert-btns { display: flex; gap: 6px; align-items: center; }

/* Desktop Floating Pill Nav & Alerts Enhancement */
@media(min-width: 768px) {
  .main {
    max-width: 1180px !important;
    margin: 0 auto !important;
    padding: 24px 20px 100px !important;
  }
  .bottom-nav {
    left: 50% !important;
    right: auto !important;
    bottom: 20px !important;
    transform: translateX(-50%) !important;
    width: 320px !important;
    height: 64px !important;
    border: 1px solid var(--line) !important;
    border-radius: 24px !important;
    padding: 0 18px !important;
    box-shadow: 0 14px 40px rgba(0, 0, 0, 0.12) !important;
  }
  /* Desktop Alert: Name first, then target price directly next to it */
  .alert-meta {
    flex-direction: row !important;
    align-items: center !important;
    gap: 10px !important;
  }
  .alert-asset-name {
    font-size: 14px !important;
    font-weight: 800 !important;
  }
  .alert-condition {
    font-size: 12px !important;
    color: var(--muted) !important;
  }
  .alert-target {
    font-size: 14px !important;
    font-weight: 800 !important;
    color: var(--ink) !important;
    direction: ltr !important;
  }
}
"""

html = html.replace('</style>', bottom_nav_css + '\n</style>')

# 4. Replace the bottom-nav markup with clean Isometric 2D coin
new_nav_markup = """<nav class="bottom-nav" aria-label="ناوبری اصلی">
  <button class="active nav-tab" data-page="home" type="button" aria-label="داشبورد" title="داشبورد">
    <span class="nav-icon">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/></svg>
    </span>
  </button>
  <button class="nav-tab nav-tab-coin" data-page="portfolio" type="button" aria-label="دارایی" title="دارایی">
    <span class="coin-isometric-btn">
      <svg width="26" height="26" viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <ellipse cx="16" cy="11.5" rx="12" ry="6" fill="currentColor" fill-opacity="0.12"/>
        <path d="M 4 11.5 v 7.5 c 0 3.3 5.4 6 12 6 s 12 -2.7 12 -6 v -7.5"/>
        <ellipse cx="16" cy="11.5" rx="7.5" ry="3.75" stroke-dasharray="2 1.5" stroke-width="1.6"/>
        <path d="M 16 9.5 L 18.8 11.5 L 16 13.5 L 13.2 11.5 Z" fill="currentColor" stroke-width="0"/>
      </svg>
    </span>
  </button>
  <button class="nav-tab" data-page="market" type="button" aria-label="بازار" title="بازار">
    <span class="nav-icon">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/></svg>
    </span>
  </button>
</nav>"""

nav_search = re.search(r'<nav class="bottom-nav"[\s\S]*?</nav>', html)
if nav_search:
    html = html[:nav_search.start()] + new_nav_markup + html[nav_search.end():]
    print("Bottom nav markup replaced with Isometric 2D coin.")

with open("src/index.html", "w", encoding="utf-8") as f:
    f.write(html)

print("CSS and nav markup updated.")
