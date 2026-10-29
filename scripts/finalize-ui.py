import re

with open('src/index.html', 'r', encoding='utf-8') as f:
    html = f.read()

# 1. Update renderAll with safety checks
old_render_all = re.search(r'function renderAll\(\)\{[\s\S]*?loginBtn[\s\S]*?\}', html)
if old_render_all:
    safe_render_all = """function renderAll(){
  renderHome();
  renderMarket();
  renderWatch();
  renderPortfolio();
  queueMicrotask(hydrateSparks);
  queueMicrotask(()=>{updateSummary();updateTrust()});
  if($('#themeSelect')) $('#themeSelect').value=state.theme;
  if($('#unitSelect')) $('#unitSelect').value=state.unit;
  if($('#privacySwitch')) $('#privacySwitch').classList.toggle('on',state.privacy);
  document.documentElement.dataset.theme=state.theme;
  if($('#themeBtn')) $('#themeBtn').innerHTML=state.theme==='dark'?SUN_SVG:MOON_SVG;
  const tc=$('meta[name=theme-color]');
  if(tc) tc.content=state.theme==='dark'?'#0b0f19':'#f8fafc';
  document.body.classList.toggle('hide-value',state.privacy);
  if($('#userName')) $('#userName').textContent=state.user?.name||'سرمایه‌گذار';
  if($('#loginBtn')) $('#loginBtn').textContent=state.user?state.user.name:'ورود';
}"""
    html = html.replace(old_render_all.group(0), safe_render_all)
    print("Updated renderAll with safe checks!")

# 2. Clean and standardize navigation CSS
# Remove the old snippet we appended at the end of style if present
nav_clean_css = """
/* Responsive Navigation Constitution */
.bottom-nav {
  position: fixed !important;
  z-index: 60 !important;
  bottom: 0 !important;
  left: 0 !important;
  right: 0 !important;
  top: auto !important;
  display: grid !important;
  grid-template-columns: repeat(4, 1fr) !important;
  background: var(--paper) !important;
  border-top: 1px solid var(--line) !important;
  border-left: 0 !important;
  border-right: 0 !important;
  border-bottom: 0 !important;
  border-radius: 0 !important;
  padding: 6px 8px calc(6px + env(safe-area-inset-bottom, 0px)) !important;
  box-shadow: 0 -4px 20px rgba(0, 0, 0, 0.06) !important;
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
  min-height: 46px !important;
  min-width: 0 !important;
  width: 100% !important;
  cursor: pointer !important;
  transition: color 0.15s, background 0.15s !important;
}
.bottom-nav .nav-icon {
  display: grid !important;
  place-items: center !important;
  width: 32px !important;
  height: 24px !important;
  border-radius: 8px !important;
  font-size: 16px !important;
  line-height: 1 !important;
}
.bottom-nav button.active {
  color: var(--ink) !important;
}
.bottom-nav button.active .nav-icon {
  background: var(--greenbg) !important;
  color: var(--green) !important;
}

@media(max-width: 767px) {
  .main {
    padding: 16px 14px calc(86px + env(safe-area-inset-bottom, 0px)) !important;
  }
}

@media(min-width: 768px) and (max-width: 1024px) {
  .main {
    padding: 24px 24px 110px !important;
    max-width: 900px;
    margin: 0 auto;
  }
  .bottom-nav {
    left: 50% !important;
    right: auto !important;
    bottom: 16px !important;
    transform: translateX(-50%) !important;
    width: min(520px, calc(100% - 32px)) !important;
    height: 66px !important;
    border: 1px solid var(--line) !important;
    border-radius: 22px !important;
    padding: 6px 12px !important;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.12) !important;
  }
}

@media(min-width: 1025px) {
  .main {
    max-width: 1500px !important;
    margin: 0 !important;
    padding: 34px 280px 60px 44px !important;
  }
  .bottom-nav {
    position: fixed !important;
    inset: 0 0 0 auto !important;
    top: 0 !important;
    right: 0 !important;
    bottom: 0 !important;
    left: auto !important;
    transform: none !important;
    width: 240px !important;
    height: 100dvh !important;
    border-radius: 0 !important;
    border: 0 !important;
    border-inline-start: 1px solid var(--line) !important;
    display: flex !important;
    flex-direction: column !important;
    justify-content: flex-start !important;
    gap: 6px !important;
    padding: 96px 14px 24px !important;
    box-shadow: none !important;
    background: var(--paper) !important;
  }
  .bottom-nav::before {
    content: "◈  دارایی من" !important;
    position: absolute !important;
    top: 30px !important;
    right: 24px !important;
    font-size: 20px !important;
    font-weight: 900 !important;
    color: var(--ink) !important;
    display: block !important;
  }
  .bottom-nav button {
    flex: none !important;
    flex-direction: row !important;
    justify-content: flex-start !important;
    gap: 12px !important;
    min-height: 50px !important;
    padding: 10px 16px !important;
    font-size: 15px !important;
    border-radius: 14px !important;
    width: 100% !important;
    text-align: right !important;
  }
  .bottom-nav button:hover {
    background: var(--bg) !important;
  }
  .bottom-nav button.active {
    background: var(--greenbg) !important;
    color: var(--green) !important;
  }
  .bottom-nav .nav-icon {
    width: 34px !important;
    height: 34px !important;
    font-size: 19px !important;
  }
}
"""

# Replace any existing /* Responsive Navigation Constitution */ block or append right before </style>
if '/* Responsive Navigation Constitution */' in html:
    html = re.sub(r'/\* Responsive Navigation Constitution \*/[\s\S]*?(?=(?:/\*|</style>))', nav_clean_css + '\n', html)
else:
    html = html.replace('</style>', nav_clean_css + '\n</style>')

with open('src/index.html', 'w', encoding='utf-8') as f:
    f.write(html)
with open('index.html', 'w', encoding='utf-8') as f:
    f.write(html)

print("Updated and verified!")
