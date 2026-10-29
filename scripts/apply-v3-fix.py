import re
import os

with open('src/index.html', 'r', encoding='utf-8') as f:
    html = f.read()

print("Original len:", len(html))

# 1. Anti-cache meta & ServiceWorker unregister script in <head>
anti_cache_head = """<meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate">
<meta http-equiv="Pragma" content="no-cache">
<meta http-equiv="Expires" content="0">
<script>
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then(function(regs) {
    for (var i = 0; i < regs.length; i++) {
      regs[i].unregister();
    }
  });
}
if ('caches' in window) {
  caches.keys().then(function(keys) {
    for (var i = 0; i < keys.length; i++) {
      caches.delete(keys[i]);
    }
  });
}
</script>"""

if '<meta http-equiv="Cache-Control"' not in html:
    html = html.replace('<meta charset="utf-8">', '<meta charset="utf-8">' + anti_cache_head)

# 2. Modern Fintech Palette replacement
old_palette_pattern = r':root\{color-scheme:light;--bg:#f5f5f0;--paper:#fff;--ink:#17231e;--muted:#77827b;--line:#e5e9e1;--lime:#d7ff61;--green:#147c55;--greenbg:#e5f8ed;--red:#d84b55;--redbg:#ffebeb;--purple:#7357ff;--orange:#ff9851;--blue:#56c5e8;--shadow:0 12px 35px #17231e0b;--radius:23px\}:root\[data-theme=dark\]\{color-scheme:dark;--bg:#111713;--paper:#1b241e;--ink:#f4f7f0;--muted:#a3aea5;--line:#303a32;--greenbg:#193a2b;--redbg:#412326;--shadow:0 12px 35px #0003\}'

new_palette = """:root {
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
  --orange: #f59e0b;
  --blue: #0284c7;
  --shadow: 0 10px 30px -4px rgba(15, 23, 42, 0.08), 0 4px 10px -2px rgba(15, 23, 42, 0.04);
  --radius: 18px;
}
:root[data-theme=dark] {
  color-scheme: dark;
  --bg: #0b0f19;
  --paper: #111827;
  --ink: #f9fafb;
  --muted: #94a3b8;
  --line: #1e293b;
  --lime: #10b981;
  --green: #34d399;
  --greenbg: rgba(16, 185, 129, 0.16);
  --red: #fb7185;
  --redbg: rgba(251, 113, 133, 0.16);
  --purple: #818cf8;
  --orange: #fbbf24;
  --blue: #38bdf8;
  --shadow: 0 14px 40px rgba(0, 0, 0, 0.55);
}"""

if re.search(old_palette_pattern, html):
    html = re.sub(old_palette_pattern, new_palette, html)
    print("Palette replaced via pattern!")
else:
    print("Direct pattern search failed, attempting flexible root replace...")
    html = re.sub(r':root\s*\{color-scheme:light;.*?--radius:23px\}:root\[data-theme=dark\]\s*\{color-scheme:dark;.*?--shadow:0 12px 35px #0003\}', new_palette, html)

# 3. Enhance portfolio hero and summary card backgrounds
hero_style_fix = """
.portfolio-hero {
  position: relative;
  overflow: hidden;
  background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%) !important;
  color: #f8fafc;
  border-radius: 24px;
  padding: 22px 20px 19px;
  box-shadow: 0 18px 38px rgba(15, 23, 42, 0.18);
  border: 1px solid rgba(255, 255, 255, 0.08);
}
:root[data-theme=dark] .portfolio-hero {
  background: linear-gradient(135deg, #111827 0%, #1f2937 100%) !important;
  border: 1px solid rgba(255, 255, 255, 0.06);
}
.portfolio-summary {
  background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%) !important;
  color: #f8fafc;
  border-radius: 24px;
  padding: 20px;
  position: relative;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.08);
}
:root[data-theme=dark] .portfolio-summary {
  background: linear-gradient(135deg, #111827 0%, #1f2937 100%) !important;
  border: 1px solid rgba(255, 255, 255, 0.06);
}
.bottom-nav {
  position: fixed;
  z-index: 50;
  bottom: 0;
  left: 0;
  right: 0;
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  background: var(--paper);
  border-top: 1px solid var(--line);
  padding: 6px 8px calc(8px + env(safe-area-inset-bottom, 0px));
  box-shadow: 0 -4px 20px rgba(0, 0, 0, 0.05);
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
  gap: 3px;
  padding: 6px 2px;
  font-size: 11px;
  font-weight: 700;
  min-height: 48px;
}
.bottom-nav .nav-icon {
  display: grid;
  place-items: center;
  width: 32px;
  height: 28px;
  border-radius: 10px;
  font-size: 17px;
  line-height: 1;
}
.bottom-nav button.active {
  color: var(--ink);
}
.bottom-nav button.active .nav-icon {
  background: var(--greenbg);
  color: var(--green);
}
.price, .ticker-price, .row-price, .detail-price, .hero-value, .total, .holding-right b {
  font-family: 'Vazirmatn', -apple-system, BlinkMacSystemFont, Tahoma, sans-serif !important;
  font-variant-numeric: tabular-nums;
  direction: ltr !important;
  text-align: right;
}
#themeBtn svg { display: block; margin: auto; }
"""

html = html.replace('</style>', hero_style_fix + '\n</style>')

# 4. Remove service worker registration from JavaScript
html = re.sub(r"if\('serviceWorker' in navigator&&location\.protocol\.startsWith\('http'\)\)addEventListener\('load',\(.*?register\('/sw\.js'\)\.catch\(\(\)=>\{\}\)\)", "// service worker registration disabled", html)

# 5. Dark mode SVG icons
svg_code = """
const SUN_SVG = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>`;
const MOON_SVG = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`;
"""

# Replace themeBtn textContent toggle with innerHTML SVG toggle
html = html.replace(
    "$('#themeBtn').textContent=state.theme==='dark'?'☀':'☾';",
    "$('#themeBtn').innerHTML=state.theme==='dark'?SUN_SVG:MOON_SVG;"
)

# Insert the SVG definitions before renderAll
html = html.replace('function renderAll(){', svg_code + '\nfunction renderAll(){')

# 6. Make sure initial themeBtn has the SVG icon on first render
html = html.replace('<button class="icon-btn" id="themeBtn" type="button" aria-label="حالت تیره / روشن">☾</button>', '<button class="icon-btn" id="themeBtn" type="button" aria-label="حالت تیره / روشن"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg></button>')

# 7. Add version badge in settings view
version_badge = '<div style="text-align:center;font-size:11px;color:var(--muted);margin:20px 0 10px;font-weight:700">نسخهٔ ۳٫۰ (طراحی جدید و مدرن) · دارایی من</div>'
if 'نسخهٔ ۳٫۰' not in html:
    html = html.replace('</section>', version_badge + '\n</section>', 1) # put in settings or home

with open('src/index.html', 'w', encoding='utf-8') as f:
    f.write(html)
with open('index.html', 'w', encoding='utf-8') as f:
    f.write(html)

print("Updated src/index.html and index.html successfully!")
