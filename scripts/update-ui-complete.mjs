import fs from 'node:fs';

const htmlPath = 'src/index.html';
let html = fs.readFileSync(htmlPath, 'utf8');

// Replace CSS with modern, ultra-sleek, clean fintech theme
const oldStyleStart = '<style>';
const oldStyleEnd = '</style>';
const sIdx = html.indexOf(oldStyleStart);
const eIdx = html.indexOf(oldStyleEnd);

const newStyle = `<style>
:root {
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
  --blue: #0ea5e9;
  --shadow: 0 4px 20px -2px rgba(15, 23, 42, 0.05), 0 2px 6px -1px rgba(15, 23, 42, 0.03);
  --radius: 18px;
}
:root[data-theme=dark] {
  color-scheme: dark;
  --bg: #090d16;
  --paper: #111827;
  --ink: #f8fafc;
  --muted: #94a3b8;
  --line: #1e293b;
  --lime: #10b981;
  --green: #34d399;
  --greenbg: rgba(16, 185, 129, 0.12);
  --red: #fb7185;
  --redbg: rgba(244, 63, 94, 0.12);
  --purple: #818cf8;
  --orange: #fbbf24;
  --blue: #38bdf8;
  --shadow: 0 4px 20px -2px rgba(0, 0, 0, 0.5);
}

* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--ink);
  font: 14px/1.6 Vazirmatn, Tahoma, sans-serif;
  letter-spacing: -0.2px;
}
button, input, select { font: inherit; }
button { cursor: pointer; }
button:focus-visible, input:focus-visible, select:focus-visible { outline: 2px solid var(--purple); outline-offset: 2px; }
button:disabled { opacity: 0.45; cursor: not-allowed; }

.app { min-height: 100dvh; }
.main {
  max-width: 1200px;
  margin: auto;
  padding: 18px 16px calc(88px + env(safe-area-inset-bottom));
}

.view { display: none; animation: enter 0.2s ease; }
.view.active { display: block; }
@keyframes enter { from { opacity: 0.6; transform: translateY(4px); } to { opacity: 1; transform: none; } }

.topbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  margin-bottom: 20px;
}
.brand { display: flex; align-items: center; gap: 10px; font-weight: 900; font-size: 17px; }
.brand-mark {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  border-radius: 13px;
  background: var(--green);
  color: #fff;
  font-size: 20px;
  box-shadow: 0 4px 12px rgba(16, 185, 129, 0.25);
}
.greeting { font-size: 11px; color: var(--muted); margin-top: 1px; font-weight: 500; }
.top-actions { display: flex; gap: 8px; align-items: center; }

.icon-btn {
  width: 42px;
  height: 42px;
  border: 1px solid var(--line);
  background: var(--paper);
  color: var(--ink);
  border-radius: 13px;
  display: grid;
  place-items: center;
  transition: all 0.15s ease;
}
.icon-btn:hover { background: var(--line); }
.icon-btn.primary { background: var(--ink); color: var(--paper); border-color: var(--ink); }

h1, h2, h3, p { margin-top: 0; }
h1 { font-size: 24px; font-weight: 900; margin-bottom: 6px; }
h2 { font-size: 17px; font-weight: 800; margin-bottom: 3px; }
h3 { font-size: 14px; font-weight: 800; margin-bottom: 4px; }
.muted { color: var(--muted); }
.eyebrow { font-size: 11px; font-weight: 700; color: var(--muted); }

.section { margin-top: 24px; }
.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 12px;
}
.section-head p { margin: 2px 0 0; font-size: 11px; color: var(--muted); }
.text-btn { border: 0; background: transparent; color: var(--purple); font-weight: 800; font-size: 12px; padding: 6px 0; }

.btn {
  border: 0;
  border-radius: 12px;
  padding: 10px 16px;
  font-weight: 800;
  font-size: 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  transition: all 0.15s ease;
  min-height: 42px;
}
.btn:active { transform: scale(0.97); }
.btn-dark { background: var(--ink); color: var(--paper); }
.btn-lime { background: var(--green); color: #fff; }
.btn-soft { background: var(--paper); border: 1px solid var(--line); color: var(--ink); }
.btn-purple { background: var(--purple); color: #fff; }
.btn-danger { background: var(--redbg); color: var(--red); }

/* Portfolio Hero Card */
.portfolio-hero {
  position: relative;
  overflow: hidden;
  background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
  color: #f8fafc;
  border-radius: 24px;
  padding: 24px 22px 20px;
  box-shadow: 0 10px 30px rgba(15, 23, 42, 0.15);
  border: 1px solid rgba(255, 255, 255, 0.08);
}
.hero-top { position: relative; z-index: 1; display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
.hero-top .eyebrow { color: #94a3b8; font-weight: 600; }
.hero-value {
  font-size: clamp(26px, 5.5vw, 38px);
  font-weight: 900;
  letter-spacing: -0.5px;
  line-height: 1.4;
  font-variant-numeric: tabular-nums;
  margin-top: 4px;
}
.hero-gain {
  padding: 6px 12px;
  border-radius: 10px;
  background: rgba(16, 185, 129, 0.2);
  color: #34d399;
  font-weight: 800;
  font-size: 12px;
  white-space: nowrap;
  direction: ltr;
}
.hero-chart { height: 90px; position: relative; z-index: 1; margin: 10px -4px 4px; }
.hero-chart svg { width: 100%; height: 100%; overflow: visible; }
.hero-bottom {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  position: relative;
  z-index: 1;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  padding-top: 14px;
  margin-top: 8px;
}
.hero-metric span { display: block; font-size: 10px; color: #94a3b8; font-weight: 600; }
.hero-metric b { font-size: 13px; font-weight: 800; font-variant-numeric: tabular-nums; }
.hero-cta { display: flex; align-items: center; gap: 6px; color: #34d399; font-size: 11px; font-weight: 800; border: 0; background: none; padding: 0; }

/* Tickers & Strips */
.market-strip {
  display: flex;
  gap: 10px;
  overflow-x: auto;
  padding: 4px 1px 8px;
  scroll-snap-type: x mandatory;
  scrollbar-width: none;
}
.market-strip::-webkit-scrollbar { display: none; }
.ticker {
  scroll-snap-align: start;
  min-width: 160px;
  flex: 0 0 auto;
  padding: 13px;
  border-radius: 16px;
  background: var(--paper);
  border: 1px solid var(--line);
  position: relative;
  overflow: hidden;
  transition: transform 0.15s ease, border-color 0.15s ease;
}
.ticker-top { display: flex; align-items: center; gap: 8px; }
.asset-icon {
  width: 36px;
  height: 36px;
  border-radius: 12px;
  display: grid;
  place-items: center;
  background: var(--iconbg, #f1f5f9);
  color: var(--iconcolor, #6366f1);
  font-size: 17px;
  font-weight: 800;
  flex: none;
}
.ticker-name { font-size: 12px; font-weight: 800; line-height: 1.3; }
.ticker-symbol { font-size: 10px; color: var(--muted); direction: ltr; }
.ticker-price {
  font-size: 16px;
  font-weight: 800;
  margin-top: 10px;
  direction: ltr;
  text-align: right;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.ticker-foot { display: flex; justify-content: space-between; align-items: center; gap: 5px; margin-top: 6px; }

/* Market Grid Cards */
.market-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.market-card {
  padding: 14px;
  border: 1px solid var(--line);
  border-radius: 18px;
  background: var(--paper);
  min-width: 0;
  position: relative;
  overflow: hidden;
  cursor: pointer;
  transition: transform 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;
}
.market-card:active { transform: scale(0.98); }
.market-card .card-top { display: flex; align-items: center; gap: 8px; }
.market-card .asset-name { font-size: 12px; font-weight: 800; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.market-card .asset-symbol { font-size: 10px; color: var(--muted); direction: ltr; }
.market-card .price {
  font-size: clamp(15px, 3.4vw, 19px);
  font-weight: 800;
  margin-top: 12px;
  direction: ltr;
  text-align: right;
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}
.market-card .card-bottom { display: flex; justify-content: space-between; align-items: center; gap: 4px; margin-top: 6px; }
.market-card .source { font-size: 10px; color: var(--muted); margin-top: 8px; }

.change {
  font-size: 11px;
  font-weight: 800;
  direction: ltr;
  white-space: nowrap;
  padding: 3px 6px;
  border-radius: 6px;
}
.change.up { color: var(--green); background: var(--greenbg); }
.change.down { color: var(--red); background: var(--redbg); }
.spark { width: 56px; height: 22px; flex: none; }
.spark svg { width: 100%; height: 100%; }

/* Controls and Inputs */
.controls { display: grid; gap: 9px; margin-bottom: 14px; }
.search {
  width: 100%;
  height: 46px;
  border: 1px solid var(--line);
  border-radius: 14px;
  padding: 0 14px;
  background: var(--paper);
  color: var(--ink);
  font-weight: 600;
}
.filter-row { display: flex; gap: 6px; overflow-x: auto; padding-bottom: 2px; scrollbar-width: none; }
.filter {
  border: 1px solid var(--line);
  border-radius: 99px;
  background: var(--paper);
  color: var(--muted);
  font-size: 11px;
  font-weight: 700;
  padding: 7px 14px;
  white-space: nowrap;
}
.filter.active { background: var(--ink); color: var(--paper); border-color: var(--ink); }

/* Holdings list */
.holdings { display: grid; gap: 10px; }
.holding {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 12px;
  align-items: center;
  padding: 14px;
  border-radius: 16px;
  border: 1px solid var(--line);
  background: var(--paper);
}
.holding-left { display: flex; gap: 10px; align-items: center; min-width: 0; }
.holding-title { font-size: 14px; font-weight: 800; line-height: 1.3; }
.table-note { font-size: 11px; color: var(--muted); margin-top: 3px; font-weight: 500; }
.holding-right { text-align: left; }
.holding-right b { font-size: 15px; font-weight: 800; font-variant-numeric: tabular-nums; display: block; }
.holding-actions { display: flex; gap: 6px; margin-top: 6px; }
.small-btn {
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 4px 10px;
  font-size: 11px;
  font-weight: 700;
  background: var(--paper);
  color: var(--ink);
}

/* Portfolio Summary */
.portfolio-summary {
  background: linear-gradient(135deg, #0f172a, #1e293b);
  color: #fff;
  border-radius: 22px;
  padding: 22px 20px;
  margin-bottom: 16px;
}
.portfolio-summary .eyebrow { color: #94a3b8; font-weight: 600; }
.portfolio-summary .total { font-size: 28px; font-weight: 900; font-variant-numeric: tabular-nums; margin-top: 4px; }
.summary-row { display: flex; gap: 8px; margin-top: 12px; flex-wrap: wrap; }
.summary-chip { padding: 6px 10px; border-radius: 10px; background: rgba(255, 255, 255, 0.1); font-size: 11px; font-weight: 700; }

/* Chart Cards */
.chart-card { background: var(--paper); border: 1px solid var(--line); border-radius: 20px; padding: 16px; }
.detail-hero { padding: 16px; border-radius: 18px; background: var(--bg); margin-bottom: 14px; }
.detail-price { font-size: 26px; font-weight: 900; direction: ltr; text-align: right; font-variant-numeric: tabular-nums; }
.detail-chart { height: 160px; position: relative; direction: ltr; }
.detail-chart-caption { display: flex; justify-content: space-between; font-size: 10px; color: var(--muted); direction: ltr; margin-top: 4px; }
.detail-range-tabs { display: flex; gap: 6px; overflow-x: auto; margin: 12px 0 4px; scrollbar-width: none; }
.detail-range-tabs button {
  border: 1px solid var(--line);
  background: var(--paper);
  color: var(--muted);
  border-radius: 10px;
  padding: 6px 12px;
  font-size: 11px;
  font-weight: 700;
  white-space: nowrap;
}
.detail-range-tabs button.active { background: var(--ink); color: var(--paper); border-color: var(--ink); }

/* Floating HUD Chart Tooltip */
.chart-tooltip {
  position: absolute;
  top: 8px;
  left: 50%;
  transform: translateX(-50%);
  padding: 6px 14px;
  background: var(--paper);
  color: var(--ink);
  border: 1px solid var(--line);
  border-radius: 99px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
  font-size: 11px;
  font-weight: 700;
  pointer-events: none;
  direction: rtl;
  z-index: 15;
  white-space: nowrap;
  backdrop-filter: blur(8px);
}
.chart-tooltip[hidden] { display: none; }

/* Mobile Bottom Navigation (4 buttons evenly spaced) */
.bottom-nav {
  position: fixed;
  z-index: 40;
  bottom: 0;
  left: 0;
  right: 0;
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 4px;
  padding: 6px 10px calc(8px + env(safe-area-inset-bottom));
  background: var(--paper);
  border-top: 1px solid var(--line);
  box-shadow: 0 -4px 20px rgba(0, 0, 0, 0.04);
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
  padding: 6px 2px;
  font-size: 11px;
  font-weight: 700;
  transition: all 0.15s ease;
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
.bottom-nav button.active { color: var(--ink); }
.bottom-nav button.active .nav-icon { background: var(--greenbg); color: var(--green); }

/* Modals */
.modal-backdrop {
  display: none;
  position: fixed;
  inset: 0;
  z-index: 50;
  background: rgba(15, 23, 42, 0.6);
  backdrop-filter: blur(6px);
  padding: 16px;
  align-items: flex-end;
  justify-content: center;
}
.modal-backdrop.open { display: flex; }
.modal {
  width: min(100%, 500px);
  max-height: min(88dvh, 760px);
  overflow: auto;
  background: var(--paper);
  border-radius: 24px 24px 20px 20px;
  padding: 22px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
  animation: sheet 0.2s ease;
}
@keyframes sheet { from { opacity: 0.6; transform: translateY(12px); } to { opacity: 1; transform: none; } }
.modal-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 16px; }
.modal-head h2 { margin: 0; font-size: 18px; font-weight: 900; }
.close { border: 0; background: var(--bg); color: var(--ink); width: 38px; height: 38px; border-radius: 12px; font-size: 20px; }

/* Forms & Price Input with Embedded Currency Button */
.form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.field { display: grid; gap: 6px; min-width: 0; }
.field.full { grid-column: 1 / -1; }
.field label { font-size: 11px; font-weight: 800; }
.field input, .field select {
  width: 100%;
  min-width: 0;
  height: 46px;
  padding: 0 12px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--bg);
  color: var(--ink);
  font-weight: 700;
}
.field input { direction: ltr; text-align: left; }

.price-input-wrapper {
  position: relative;
  display: flex;
  align-items: center;
}
.price-input-wrapper input {
  padding-inline-end: 74px;
}
.cur-toggle-btn {
  position: absolute;
  inset-inline-end: 6px;
  top: 50%;
  transform: translateY(-50%);
  padding: 6px 12px;
  border-radius: 9px;
  border: 1px solid var(--line);
  background: var(--paper);
  color: var(--ink);
  font-weight: 800;
  font-size: 11px;
  transition: all 0.15s ease;
}
.cur-toggle-btn:hover { background: var(--line); }
.field-help { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-top: 2px; min-height: 24px; }
.field-help #priceHint { font-size: 11px; color: var(--muted); font-weight: 700; }

.edit-asset-badge {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border-radius: 14px;
  background: var(--bg);
  border: 1px solid var(--line);
  margin-bottom: 6px;
}

.toast {
  position: fixed;
  z-index: 80;
  bottom: calc(84px + env(safe-area-inset-bottom));
  left: 50%;
  transform: translate(-50%, 14px);
  opacity: 0;
  pointer-events: none;
  background: var(--ink);
  color: var(--paper);
  padding: 10px 18px;
  border-radius: 14px;
  font-size: 12px;
  font-weight: 800;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.2);
  transition: opacity 0.2s, transform 0.2s;
  white-space: nowrap;
}
.toast.show { opacity: 1; transform: translate(-50%, 0); }

/* Asset Picker */
.asset-picker { border: 1px solid var(--line); border-radius: 14px; background: var(--bg); padding: 10px; }
.asset-picker-search { width: 100%; height: 42px; border: 1px solid var(--line); border-radius: 10px; background: var(--paper); color: var(--ink); padding: 0 12px; margin-bottom: 8px; }
.asset-picker-list { display: grid; gap: 4px; max-height: 220px; overflow: auto; }
.asset-option {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  border: 1px solid transparent;
  background: var(--paper);
  color: var(--ink);
  padding: 8px 10px;
  border-radius: 10px;
  text-align: right;
}
.asset-option[aria-checked=true] { border-color: var(--green); background: var(--greenbg); }
.asset-option .option-copy { flex: 1; min-width: 0; }
.asset-option strong { display: block; font-size: 12px; }
.asset-option small { display: block; color: var(--muted); font-size: 10px; }

/* Desktop adjustments */
@media(min-width: 1100px) {
  body { font-size: 14px; }
  .main { max-width: none; margin: 0; padding: 34px 280px 60px 44px; }
  .bottom-nav {
    position: fixed;
    inset: 0 0 0 auto;
    width: 230px;
    height: 100dvh;
    border-radius: 0;
    border: 0;
    border-inline-start: 1px solid var(--line);
    display: flex;
    flex-direction: column;
    justify-content: flex-start;
    gap: 8px;
    padding: 90px 14px 24px;
    box-shadow: none;
    background: var(--paper);
  }
  .bottom-nav::before {
    content: "◈  دارایی";
    position: absolute;
    top: 28px;
    right: 22px;
    font-size: 18px;
    font-weight: 900;
    color: var(--ink);
  }
  .bottom-nav button {
    flex: none;
    flex-direction: row;
    justify-content: flex-start;
    gap: 12px;
    min-height: 48px;
    padding: 8px 14px;
    font-size: 14px;
    border-radius: 12px;
  }
  .home-layout { display: grid; grid-template-columns: minmax(0, 1fr) 360px; gap: 24px; }
  .market-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .modal-backdrop { align-items: center; }
  .modal { border-radius: 24px; }
  .toast { bottom: 28px; }
}

[hidden] { display: none !important; }
.quick-grid { display: none !important; }
</style>`;

html = html.slice(0, sIdx) + newStyle + html.slice(eIdx + oldStyleEnd.length);
console.log('Styles replaced successfully.');

// Now replace buyForm implementation:
const buyFormStart = 'function buyForm(edit=null,presetId=null){';
const buyFormEnd = 'function groupedValue(';
const bStartIdx = html.indexOf(buyFormStart);
const bEndIdx = html.indexOf(buyFormEnd, bStartIdx);

const newBuyForm = `function buyForm(edit=null,presetId=null){
  const h=edit?state.holdings.find(x=>x.id===edit):null;
  const a=h?asset(h.assetId):null;
  let cur='IRT';
  const usdRate=()=>asset('usd').price>0?asset('usd').price:0;

  const headerAssetHtml=h?\`
    <div class="edit-asset-badge">
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

  openModal(h?'ویرایش معامله':'ثبت خرید',\`
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
            <input id="buyPrice" inputmode="decimal" placeholder="قیمت خرید" value="\${h?groupedValue(String(h.buyPrice)):''}" \${h?'data-touched="1"':''} required>
            <button type="button" class="cur-toggle-btn" id="curToggleBtn">تومان</button>
          </div>
          <div class="field-help">
            <button type="button" class="link-btn" id="priceNow">قیمت الان</button>
            <span id="priceHint"></span>
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

  if(!h)wireAssetPicker();
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
      qty,
      buyPrice:price,
      fee,
      side:$('#tradeSide').value,
      wallet:$('#wallet').value.trim()||'اصلی',
      toWallet:$('#toWallet').value.trim(),
      createdAt:h?.createdAt||Date.now(),
      date:$('#buyDate').value
    };
    const next=h?state.holdings.map(x=>x.id===h.id?data:x):[...state.holdings,data];
    try{ledger(next);}catch(e){toast(e.message);return;}
    state.holdings=next;
    persist();
    renderAll();
    closeModal();
    toast(h?'معامله ویرایش شد':'معامله ثبت شد');
  };

  $('#buySubmit').onclick=doBuy;
  $('#buyForm').addEventListener('keydown',e=>{
    if(e.key==='Enter'&&e.target.tagName==='INPUT'&&e.target.type!=='search'){
      e.preventDefault();
      doBuy();
    }
  });
}
`;

html = html.slice(0, bStartIdx) + newBuyForm + html.slice(bEndIdx);
console.log('buyForm replaced successfully.');

// Now let's update paintChart to have a clean, sleek floating tooltip
const oldPaintChartStart = 'function paintChart(box,points,color,formatter){';
const oldPaintChartEnd = 'function currentValue(';
const pStartIdx = html.indexOf(oldPaintChartStart);
const pEndIdx = html.indexOf(oldPaintChartEnd, pStartIdx);

const newPaintChart = `function paintChart(box,points,color,formatter){
  points=points.filter(p=>Number.isFinite(p[0])&&Number.isFinite(p[1])).sort((a,b)=>a[0]-b[0]);
  box.style.position='relative';
  box.style.direction='ltr';
  box.innerHTML=chartSVG(points,color);
  if(points.length<2)return;
  const tip=document.createElement('div');
  tip.className='chart-tooltip';
  box.appendChild(tip);
  const geom=chartGeometry(points),svg=box.querySelector('svg'),cross=box.querySelector('.crosshair');
  box.tabIndex=0;
  let index=points.length-1;
  const show=i=>{
    index=Math.max(0,Math.min(points.length-1,i));
    const p=points[index],xy=geom[index];
    const timeStr=formatRelativeTime(p[0]);
    tip.innerHTML=\`<span>\${timeStr}</span> &nbsp;|&nbsp; <strong style="direction:ltr">\${formatter(p[1])}</strong>\`;
    tip.hidden=false;
    cross.setAttribute('visibility','visible');
    const line=cross.querySelector('line'),dot=cross.querySelector('circle');
    line.setAttribute('x1',xy[0]);
    line.setAttribute('x2',xy[0]);
    dot.setAttribute('cx',xy[0]);
    dot.setAttribute('cy',xy[1]);
  };
  const move=e=>{
    box.dataset.activeUntil=String(Date.now()+3000);
    const rect=svg.getBoundingClientRect(),x=(e.clientX-rect.left)/rect.width*640;
    let best=0;
    for(let i=1;i<geom.length;i++)if(Math.abs(geom[i][0]-x)<Math.abs(geom[best][0]-x))best=i;
    show(best);
  };
  box.onpointermove=move;
  box.onpointerdown=e=>{move(e);if(e.pointerType==='touch')box.setPointerCapture(e.pointerId);};
  box.onpointerleave=()=>{tip.hidden=true;cross.setAttribute('visibility','hidden');};
  show(index);
}
`;

html = html.slice(0, pStartIdx) + newPaintChart + html.slice(pEndIdx);
console.log('paintChart replaced successfully.');

fs.writeFileSync(htmlPath, html, 'utf8');
console.log('UI completely updated.');
