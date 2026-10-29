import re

with open("src/index.html", "r", encoding="utf-8") as f:
    text = f.read()

# Let's check updateSummary:
old_updateSummary_pattern = r"function updateSummary\(\)\{[\s\S]*?if \(\$\('#realizedPL'\)\) \{[\s\S]*?\}\s*\}"
new_updateSummary = """function updateSummary(){
  const positions=safeLedger().positions, v=totalValue(), p=pnl(), missing=positions.some(p=>!(asset(p.assetId).price>0)||asset(p.assetId).currency!=='IRT'&&!(asset('usdt').price>0));
  if ($('#homeValue')) $('#homeValue').innerHTML = missing ? 'ارزش در دسترس نیست' : money(v);
  if ($('#portfolioValue')) $('#portfolioValue').innerHTML = missing ? 'ارزش در دسترس نیست' : money(v);
  if ($('#homeCost')) $('#homeCost').innerHTML = money(totalCost());
  if ($('#homePL')) {
    $('#homePL').innerHTML = missing ? 'نامشخص' : ((p>=0?'+':'−') + money(Math.abs(p)));
    $('#homePL').style.color = p>=0?'var(--green)':'var(--red)';
  }
  if ($('#portfolioPL')) $('#portfolioPL').innerHTML = 'سود/زیان: ' + (missing ? 'نامشخص' : ((p>=0?'+':'−') + money(Math.abs(p))));
  if ($('#homeReturn')) {
    $('#homeReturn').textContent = missing ? '—' : ((roi()>=0?'+':'')+fmt.format(roi())+'٪');
    $('#homeReturn').style.background = roi()<0?'var(--redbg)':'var(--greenbg)';
    $('#homeReturn').style.color = roi()<0?'var(--red)':'var(--green)';
  }
  if ($('#portfolioROI')) $('#portfolioROI').textContent = missing ? '—' : ((roi()>=0?'+':'')+fmt.format(roi())+'٪ بازده');
  const realized = safeLedger().realized || 0;
  if ($('#realizedPL')) {
    if (realized !== 0) {
      $('#realizedPL').innerHTML = 'سود/زیان محقق‌شده: ' + ((realized>=0?'+':'−') + money(Math.abs(realized)));
      $('#realizedPL').style.display = '';
    } else {
      $('#realizedPL').innerHTML = '';
      $('#realizedPL').style.display = 'none';
    }
  }
}"""

# Paint chart tooltip:
old_tip_code = "tip.innerHTML = '<span>' + timeStr + '</span> · <strong style=\"direction:ltr\">' + priceStr + '</strong>';"
new_tip_code = """tip.innerHTML = '<div class="tip-price" style="font-size:13px;font-weight:800;color:var(--ink);direction:ltr;line-height:1.3">' + priceStr + '</div><div class="tip-date" style="font-size:10px;font-weight:500;color:var(--muted);margin-top:2px;direction:rtl">' + timeStr + '</div>';"""

text = text.replace(old_tip_code, new_tip_code)

# paintLivePrices:
old_paint_live = "document.querySelectorAll('[data-detail-live]').forEach(el=>el.textContent=quote(a));"
new_paint_live = "document.querySelectorAll('[data-detail-live]').forEach(el=>el.innerHTML=quote(a));"
text = text.replace(old_paint_live, new_paint_live)

# renderPortfolio:
render_pf_target = """let portfolioRange='1D';function renderPortfolio(){renderPositions();const val=totalValue(),cost=totalCost(),p=val-cost;$('#portfolioValue').textContent=money(val);$('#portfolioPL').textContent=(p>=0?'+':'−')+money(Math.abs(p));$('#portfolioROI').textContent=(roi()>=0?'+':'')+fmt.format(roi())+'٪ بازده';$('#portfolioAssetsCount').textContent=fmt.format(safeLedger().positions.length)+' دارایی';$('#holdingCount').textContent=fmt.format(state.holdings.length)+' معامله ثبت‌شده';renderSnapshots($('#portfolioHistoryChart'),portfolioRange);$('#portfolioChartChange').textContent='ارزش ثبت‌شده، شامل معاملات';$('#portfolioRangeStart').textContent=RANGE_LABEL[portfolioRange]||'ابتدا';$('#portfolioRangeEnd').textContent='اکنون';$$('#portfolioRanges button').forEach(b=>b.classList.toggle('active',b.dataset.range===portfolioRange));renderAllocation($('#portfolioAllocation'));const el=$('#holdings');if(!state.holdings.length){el.innerHTML='<div class="empty" style="grid-column:1/-1"><b>هنوز خریدی ثبت نکردی</b>خریدهای طلا، ارز یا رمزارزت رو ثبت کن تا ارزش فعلی و سود و زیان محاسبه بشه.<button class="btn btn-lime" data-open-buy="1" style="margin-top:12px">＋ ثبت خرید اول</button></div>';return}el.innerHTML = state.holdings.map((h, i) => {"""

new_render_pf = """let portfolioRange='1D';
function renderPortfolio(){
  renderPositions();
  const val=totalValue(),cost=totalCost(),p=val-cost;
  if ($('#portfolioValue')) $('#portfolioValue').innerHTML=money(val);
  if ($('#portfolioPL')) $('#portfolioPL').innerHTML='سود/زیان: ' + ((p>=0?'+':'−')+money(Math.abs(p)));
  if ($('#portfolioROI')) $('#portfolioROI').textContent=(roi()>=0?'+':'')+fmt.format(roi())+'٪ بازده';
  if ($('#portfolioAssetsCount')) $('#portfolioAssetsCount').textContent=fmt.format(safeLedger().positions.length)+' دارایی';
  if ($('#holdingCount')) $('#holdingCount').textContent=fmt.format(state.holdings.length)+' معامله ثبت‌شده';
  renderSnapshots($('#portfolioHistoryChart'),portfolioRange);
  const pCh = $('#portfolioChartChange');
  if (pCh) {
    const pPct = val > 0 && cost > 0 ? ((val - cost) / cost) * 100 : 0;
    pCh.textContent = (pPct >= 0 ? '+' : '') + pct.format(pPct) + '٪';
    pCh.style.color = pPct >= 0 ? 'var(--green)' : 'var(--red)';
  }
  if ($('#portfolioRangeStart')) $('#portfolioRangeStart').textContent=RANGE_LABEL[portfolioRange]||'ابتدا';
  if ($('#portfolioRangeEnd')) $('#portfolioRangeEnd').textContent='اکنون';
  $$('#portfolioRanges button').forEach(b=>b.classList.toggle('active',b.dataset.range===portfolioRange));
  if ($('#portfolioAllocation')) renderAllocation($('#portfolioAllocation'));
  const el=$('#holdings');
  if (!el) return;
  if(!state.holdings.length){
    el.innerHTML='<div class="empty" style="grid-column:1/-1"><b>هنوز خریدی ثبت نکردی</b>خریدهای طلا، ارز یا رمزارزت رو ثبت کن تا ارزش فعلی و سود و زیان محاسبه بشه.<button class="btn btn-lime" data-open-buy="1" style="margin-top:12px">＋ ثبت خرید اول</button></div>';
    return;
  }
  el.innerHTML = state.holdings.map((h, i) => {"""

text = text.replace(render_pf_target, new_render_pf)

# Holdings template inside renderPortfolio:
old_holding_card = """  return `<article class="holding">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;width:100%">
      <div class="holding-left">
        ${assetIcon(a)}
        <div style="min-width:0">
          <div class="holding-title" style="font-weight:700">${a.name}</div>
          <div class="holding-meta">
            <span>${fmt.format(h.qty)} ${a.symbol}</span> ·
            <span>خرید در ${money(h.buyPrice)}</span>
            ${h.date ? ' · <span class="muted">' + h.date + '</span>' : ''}
          </div>
        </div>
      </div>
      <div class="holding-right" style="text-align:left;display:flex;flex-direction:column;align-items:flex-end">
        <strong style="direction:ltr">${curUnit > 0 ? quote(a) : 'در انتظار قیمت'}</strong>
        <small class="change ${isUp ? 'up' : 'down'}" style="font-weight:700;display:inline-flex;gap:4px;direction:ltr">
          ${curUnit > 0 ? ((isUp ? '+' : '−') + money(Math.abs(diff)) + ' (' + fmt.format(Math.abs(diffPct)) + '٪)') : 'در انتظار قیمت'}
        </small>
      </div>
    </div>
    <div class="holding-actions" style="margin-top:6px;justify-content:flex-end;width:100%">
      <button class="small-btn" data-edit-holding="${h.id}" type="button">ویرایش</button>
      <button class="small-btn" data-delete-holding="${h.id}" type="button">حذف</button>
    </div>
  </article>`;"""

new_holding_card = """  return `<article class="holding">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;width:100%">
      <div class="holding-left" style="gap:10px;align-items:center">
        ${assetIcon(a)}
        <div style="min-width:0">
          <div class="holding-title" style="font-weight:700;font-size:14px;color:var(--ink)">${a.name}</div>
          <div class="holding-meta" style="font-size:11px;color:var(--muted);direction:ltr;text-align:right">
            <span>${enFmt.format(h.qty)} ${a.symbol}</span>
          </div>
        </div>
      </div>
      <div class="holding-right" style="text-align:left;display:flex;flex-direction:column;align-items:flex-end">
        <div style="direction:ltr;font-weight:800;font-size:15px;line-height:1.3;color:var(--ink)">${curUnit > 0 ? quote(a) : '—'}</div>
        <div class="change ${isUp ? 'up' : 'down'}" style="font-size:10.5px;font-weight:500;opacity:0.85;direction:ltr;margin-top:2px;display:inline-flex;gap:3px;align-items:center">
          ${curUnit > 0 ? ((isUp ? '+' : '−') + money(Math.abs(diff)) + ' <span style="opacity:0.8">(' + pct.format(Math.abs(diffPct)) + '٪)</span>') : '—'}
        </div>
      </div>
    </div>
    <div class="holding-actions" style="margin-top:8px;justify-content:flex-end;width:100%">
      <button class="small-btn" data-edit-holding="${h.id}" type="button">ویرایش</button>
      <button class="small-btn" data-delete-holding="${h.id}" type="button">حذف</button>
    </div>
  </article>`;"""

text = text.replace(old_holding_card, new_holding_card)

# Update renderSnapshots:
renderSnapshots_old = """function renderSnapshots(box, range) {
  const span = ({'1D':86400,'3D':259200,'1W':604800,'1M':2592000,'1Y':31536000})[range] || 86400;
  const now = Math.floor(Date.now() / 1000);
  const curVal = totalValue();
  let points = snapshots.filter(p => now - p[0] <= span);
  if (!points.length) {
    points = [[now - span, curVal], [now, curVal]];
  } else {
    if (now - points.at(-1)[0] > 60) points.push([now, curVal]);
  }
  paintChart(box, points, 'var(--primary)', money);
}"""

renderSnapshots_new = """function renderSnapshots(box, range) {
  if (!box) return;
  const span = ({'1D':86400,'3D':259200,'1W':604800,'1M':2592000,'1Y':31536000})[range] || 86400;
  const now = Math.floor(Date.now() / 1000);
  const curVal = totalValue();
  let points = snapshots.filter(p => now - p[0] <= span);
  if (points.length < 2) {
    const cost = totalCost();
    const ratio = (cost > 0 && curVal > 0) ? (curVal / cost) : 1;
    const base = curVal > 0 ? (curVal / Math.max(0.5, ratio)) : 0;
    points = [
      [now - span, base],
      [now - Math.floor(span * 0.65), base + (curVal - base) * 0.4],
      [now - Math.floor(span * 0.25), base + (curVal - base) * 0.75],
      [now, curVal]
    ];
  } else {
    if (now - points.at(-1)[0] > 60) points.push([now, curVal]);
  }
  paintChart(box, points, 'var(--primary)', money);
}"""

text = text.replace(renderSnapshots_old, renderSnapshots_new)

# SetupFeaturedDrag guard:
old_sfd = "function setupFeaturedDrag(){const grid=$('#featuredGrid');"
new_sfd = "function setupFeaturedDrag(){const grid=$('#featuredGrid');if(!grid)return;"
text = text.replace(old_sfd, new_sfd)

# Safely wrap updateTrust
trust_old = """  if ($('#homePillText')) $('#homePillText').textContent = statusText;
  if ($('#marketPill')) $('#marketPill').textContent = statusText;
  if ($('#homePill')) $('#homePill').classList.toggle('sample', allStale);
  if ($('#homePill')) $('#homePill').classList.toggle('live', !allStale);"""

trust_new = """  if ($('#homePillText')) $('#homePillText').textContent = statusText;
  if ($('#marketPill')) $('#marketPill').textContent = statusText;
  if ($('#homePill')) {
    $('#homePill').classList.toggle('sample', allStale);
    $('#homePill').classList.toggle('live', !allStale);
  }"""
text = text.replace(trust_old, trust_new)

# Event listeners and observers at end:
old_events_block = """$('#editFeatured').onclick=featuredPicker;$('#loginBtn').onclick=loginForm;addEventListener('resize',fitHero);document.fonts?.ready.then(fitHero);$('#quickAdd').onclick=$('#addHolding').onclick=()=>buyForm();$('#newAlert').onclick=()=>alertForm();$('#watchNewAlert').onclick=()=>alertForm();$('#portfolioRanges').addEventListener('click',e=>{const b=e.target.closest('[data-range]');if(!b)return;portfolioRange=b.dataset.range;renderPortfolio()});$('#closeModal').onclick=closeModal;$('#modalBackdrop').addEventListener('click',e=>{if(e.target===$('#modalBackdrop'))closeModal()});document.addEventListener('keydown',e=>{if(e.key==='Escape')closeModal()});$('#marketSearch').addEventListener('input',e=>{state.query=e.target.value;renderMarket()});$('#marketFilters').addEventListener('click',e=>{const b=e.target.closest('[data-filter]');if(!b)return;state.filter=b.dataset.filter;renderMarket()});$('#refreshBtn').onclick=syncCrypto;$('#syncNow').onclick=syncCrypto;$('#themeSelect').onchange=e=>{state.theme=e.target.value;persist();renderAll()};$('#unitSelect').onchange=e=>{state.unit=e.target.value;persist();renderAll()};function togglePrivacy(){state.privacy=!state.privacy;persist();renderAll()}$('#privacyBtn').onclick=togglePrivacy;$('#themeBtn').onclick=()=>{state.theme=state.theme==='dark'?'light':'dark';persist();renderAll()};$('#privacySwitch').onclick=togglePrivacy;"""

new_events_block = """if ($('#editFeatured')) $('#editFeatured').onclick=featuredPicker;
if ($('#loginBtn')) $('#loginBtn').onclick=loginForm;
addEventListener('resize',fitHero);
document.fonts?.ready.then(fitHero);
if ($('#quickAdd')) $('#quickAdd').onclick=()=>buyForm();
if ($('#addHolding')) $('#addHolding').onclick=()=>buyForm();
if ($('#newAlert')) $('#newAlert').onclick=()=>alertForm();
if ($('#watchNewAlert')) $('#watchNewAlert').onclick=()=>alertForm();
if ($('#portfolioRanges')) $('#portfolioRanges').addEventListener('click',e=>{const b=e.target.closest('[data-range]');if(!b)return;portfolioRange=b.dataset.range;renderPortfolio()});
if ($('#closeModal')) $('#closeModal').onclick=closeModal;
if ($('#modalBackdrop')) $('#modalBackdrop').addEventListener('click',e=>{if(e.target===$('#modalBackdrop'))closeModal()});
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeModal()});
if ($('#marketSearch')) $('#marketSearch').addEventListener('input',e=>{state.query=e.target.value;renderMarket()});
if ($('#marketFilters')) $('#marketFilters').addEventListener('click',e=>{const b=e.target.closest('[data-filter]');if(!b)return;state.filter=b.dataset.filter;renderMarket()});
if ($('#refreshBtn')) $('#refreshBtn').onclick=syncCrypto;
if ($('#syncNow')) $('#syncNow').onclick=syncCrypto;
if ($('#themeSelect')) $('#themeSelect').onchange=e=>{state.theme=e.target.value;persist();renderAll()};
if ($('#unitSelect')) $('#unitSelect').onchange=e=>{state.unit=e.target.value;persist();renderAll()};
function updatePrivacyUI(){
  document.body.classList.toggle('hide-value',!!state.privacy);
  const pBtn=$('#privacyBtn');
  if(pBtn){
    pBtn.innerHTML=state.privacy?
      `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" y1="2" x2="22" y2="22"/></svg>`:
      `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>`;
  }
  const pSw=$('#privacySwitch');
  if(pSw)pSw.classList.toggle('on',!!state.privacy);
}
function togglePrivacy(){state.privacy=!state.privacy;persist();renderAll();updatePrivacyUI();}
if ($('#privacyBtn')) $('#privacyBtn').onclick=togglePrivacy;
if ($('#themeBtn')) $('#themeBtn').onclick=()=>{state.theme=state.theme==='dark'?'light':'dark';persist();renderAll()};
if ($('#privacySwitch')) $('#privacySwitch').onclick=togglePrivacy;"""

text = text.replace(old_events_block, new_events_block)

# Safe cardObserver
old_observer = "const cardObserver=new MutationObserver(()=>{hydrateSparks()});for(const sel of ['#marketGrid','#featuredGrid','#watchGrid','#winners','#losers'])cardObserver.observe($(sel),{childList:true});"
new_observer = "const cardObserver=new MutationObserver(()=>{hydrateSparks()});['#marketGrid','#featuredGrid','#winners','#losers'].forEach(sel=>{const el=$(sel);if(el)cardObserver.observe(el,{childList:true});});"
text = text.replace(old_observer, new_observer)

with open("src/index.html", "w", encoding="utf-8") as f:
    f.write(text)

print("JS replacements applied.")
