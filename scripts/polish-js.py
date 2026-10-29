import re
with open("src/index.html", "r", encoding="utf-8") as f:
    text = f.read()

# 1. Add Persian normalization helper:
norm_helper = """
function normFa(s) {
  return String(s || '')
    .replace(/[آاأإء]/g, 'ا')
    .replace(/[يی]/g, 'ی')
    .replace(/[كک]/g, 'ک')
    .replace(/[ةه]/g, 'ه')
    .replace(/[‌\\s]/g, '')
    .toLowerCase();
}
"""

if "function normFa(" not in text:
    text = text.replace("const uid=()=>crypto.randomUUID();", "const uid=()=>crypto.randomUUID();" + norm_helper)
    print("Added normFa helper.")

# 2. Update renderMarket to use normFa:
old_render_mkt = "const q=state.query.trim().toLocaleLowerCase('fa'),key=state.filter+'|'+q;if(key!==marketKey){marketKey=key;marketLimit=60}\nconst ranked=[...assets.filter(a=>!a.vol),...assets.filter(a=>a.vol).sort((x,y)=>y.vol-x.vol)];\nconst all=ranked.filter(a=>(state.filter==='all'||a.cat===state.filter)&&(!q||(a.name+' '+a.symbol+' '+(a.en||'')).toLocaleLowerCase('fa').includes(q)));"

new_render_mkt = """const rawQ = state.query.trim(), q = normFa(rawQ), key = state.filter + '|' + q;
if (key !== marketKey) { marketKey = key; marketLimit = 60; }
const ranked = [...assets.filter(a => !a.vol), ...assets.filter(a => a.vol).sort((x, y) => y.vol - x.vol)];
const all = ranked.filter(a =>
  (state.filter === 'all' || a.cat === state.filter) &&
  (!q || normFa(a.name + ' ' + a.symbol + ' ' + (a.en || '')).includes(q))
);"""

if old_render_mkt in text:
    text = text.replace(old_render_mkt, new_render_mkt)
    print("renderMarket search updated with normFa.")
else:
    # Try more flexible replacement:
    idx = text.find("function renderMarket(){")
    if idx != -1:
        end_idx = text.find("const list=all.slice(0,marketLimit);", idx)
        if end_idx != -1:
            text = text[:idx + len("function renderMarket(){")] + "\n" + new_render_mkt + "\n" + text[end_idx:]
            print("renderMarket replaced via slicing.")

# 3. Update wireAssetPicker search with normFa:
old_wap_search = "const q=search.value.trim().toLocaleLowerCase('fa');list.querySelectorAll('[data-pick-asset]').forEach(row=>{row.hidden=!(row.textContent+' '+row.dataset.pickAsset).toLocaleLowerCase('fa').includes(q)})"
new_wap_search = "const q=normFa(search.value.trim());list.querySelectorAll('[data-pick-asset]').forEach(row=>{row.hidden=!(normFa(row.textContent+' '+row.dataset.pickAsset).includes(q))})"
text = text.replace(old_wap_search, new_wap_search)

# 4. Update featuredPicker search with normFa:
old_fp_search = "const q=e.target.value.trim().toLocaleLowerCase('fa');$$('#featList [data-feat]').forEach(r=>{r.hidden=!(r.textContent+' '+r.dataset.feat).toLocaleLowerCase('fa').includes(q)})"
new_fp_search = "const q=normFa(e.target.value.trim());$$('#featList [data-feat]').forEach(r=>{r.hidden=!(normFa(r.textContent+' '+r.dataset.feat).includes(q))})"
text = text.replace(old_fp_search, new_fp_search)

# 5. Silky continuous paintChart:
paint_chart_target = "function paintChart(box, points, color, formatter) {"
paint_chart_end = text.find("function currentValue(h){", text.find(paint_chart_target))

new_paint_chart = """function paintChart(box, points, color, formatter) {
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
  const modalLive = document.querySelector('#modalBody [data-detail-live], #modalBody .detail-price');
  const origPriceText = modalLive ? modalLive.innerHTML : '';

  const showAtX = (rawX) => {
    if (!geom.length) return;
    const minX = geom[0][0], maxX = geom[geom.length - 1][0];
    const clampedX = Math.max(minX, Math.min(maxX, rawX));
    
    // Find segment [i, i+1]
    let i = 0;
    while (i < geom.length - 2 && geom[i + 1][0] < clampedX) {
      i++;
    }
    const p1 = points[i], p2 = points[i + 1] || p1;
    const g1 = geom[i], g2 = geom[i + 1] || g1;
    const denom = (g2[0] - g1[0]) || 1;
    const frac = Math.max(0, Math.min(1, (clampedX - g1[0]) / denom));
    
    const curY = g1[1] + frac * (g2[1] - g1[1]);
    const curVal = p1[1] + frac * (p2[1] - p1[1]);
    const curTime = p1[0] + frac * (p2[0] - p1[0]);
    
    const timeStr = formatRelativeDate(curTime);
    const priceStr = formatter(curVal);
    
    tip.innerHTML = '<div class="tip-price">' + priceStr + '</div><div class="tip-date">' + timeStr + '</div>';
    tip.hidden = false;
    
    const rect = svg.getBoundingClientRect();
    const pxX = (clampedX / 640) * (rect.width || 340);
    const halfTip = 72;
    tip.style.left = Math.max(halfTip, Math.min((rect.width || 340) - halfTip, pxX)) + 'px';
    
    cross.setAttribute('visibility', 'visible');
    const line = cross.querySelector('line'), dot = cross.querySelector('circle');
    line.setAttribute('x1', clampedX);
    line.setAttribute('x2', clampedX);
    dot.setAttribute('cx', clampedX);
    dot.setAttribute('cy', curY);
    
    if (modalLive) {
      modalLive.innerHTML = priceStr;
    }
  };

  const move = e => {
    box.dataset.activeUntil = String(Date.now() + 3000);
    const rect = svg.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / (rect.width || 1)) * 640;
    showAtX(x);
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
      modalLive.innerHTML = origPriceText;
    }
  };
  showAtX(geom[geom.length - 1][0]);
  tip.hidden = true;
  cross.setAttribute('visibility', 'hidden');
}
"""

if paint_chart_end != -1:
    text = text[:text.find(paint_chart_target)] + new_paint_chart + text[paint_chart_end:]
    print("Replaced paintChart with continuous smooth interpolation.")

# 6. Silky renderSnapshots with point densification:
rs_start = text.find("function renderSnapshots(box, range) {")
if rs_start != -1:
    rs_end = text.find("function renderPositions(){", rs_start)
    if rs_end != -1:
        new_rs = """function renderSnapshots(box, range) {
  if (!box) return;
  const span = ({'1D':86400,'3D':259200,'1W':604800,'1M':2592000,'1Y':31536000})[range] || 86400;
  const now = Math.floor(Date.now() / 1000);
  const curVal = totalValue();
  let points = snapshots.filter(p => now - p[0] <= span);
  
  if (points.length < 2) {
    const cost = totalCost() > 0 ? totalCost() : curVal * 0.98;
    const count = 40;
    points = [];
    for (let i = 0; i <= count; i++) {
      const t = (now - span) + Math.floor((i / count) * span);
      const ratio = i / count;
      const ease = (1 - Math.cos(ratio * Math.PI)) / 2;
      const v = cost + ease * (curVal - cost);
      points.push([t, v]);
    }
  } else if (points.length < 30) {
    const dense = [];
    for (let i = 0; i < points.length - 1; i++) {
      const p1 = points[i], p2 = points[i + 1];
      const steps = Math.max(2, Math.floor(36 / points.length));
      for (let s = 0; s < steps; s++) {
        const r = s / steps;
        dense.push([Math.round(p1[0] + r * (p2[0] - p1[0])), p1[1] + r * (p2[1] - p1[1])]);
      }
    }
    dense.push(points[points.length - 1]);
    points = dense;
  }
  if (now - points.at(-1)[0] > 60) points.push([now, curVal]);
  paintChart(box, points, 'var(--primary)', money);
}
"""
        text = text[:rs_start] + new_rs + text[rs_end:]
        print("renderSnapshots updated with point densification.")

# 7. Update renderAlertsPreview:
ap_start = text.find("function renderAlertsPreview(){")
if ap_start != -1:
    ap_end = text.find("let portfolioRange='1D';", ap_start)
    if ap_end != -1:
        new_ap = """function renderAlertsPreview(){
  const el=$('#alertPreview');
  if(!el) return;
  if(!state.alerts.length){
    el.innerHTML='<div class="muted" style="font-size:11px;padding:8px">هنوز هشداری تنظیم نشده.</div>';
    return;
  }
  el.innerHTML=state.alerts.slice(0,6).map((al,i)=>{
    const a = asset(al.assetId);
    return `<div class="alert-row">
      <div class="alert-meta">
        <strong class="alert-asset-name">${a.name}</strong>
        <span class="alert-condition">${al.direction==='above'?'بالاتر از':'پایین‌تر از'}</span>
        <span class="alert-target">${alertQuote(al)}</span>
      </div>
      <div class="alert-btns">
        ${al.attempts>=5?`<button class="small-btn" data-retry-alert="${escapeHtml(al.id)}" type="button">تلاش مجدد</button>`:''}
        <button class="small-btn" data-edit-alert="${i}" type="button">ویرایش</button>
        <button class="small-btn" data-del-alert="${i}" type="button">حذف</button>
      </div>
    </div>`;
  }).join('');
}
"""
        text = text[:ap_start] + new_ap + text[ap_end:]
        print("renderAlertsPreview updated.")

# 8. Update buyForm HTML for perfect alignment and inner currency button:
bf_form_start = text.find("<div id=\"buyForm\">")
if bf_form_start != -1:
    bf_form_end = text.find("if(!h) wireAssetPicker();", bf_form_start)
    if bf_form_end != -1:
        # replace the fields inside
        text = re.sub(
            r'<div class="field">\s*<label for="buyQty">[\s\S]*?<div class="form-actions"',
            """<div class="field">
          <label for="buyQty">مقدار</label>
          <input id="buyQty" inputmode="decimal" placeholder="مثلاً ۰٫۵" value="${h?.qty??''}" required>
          <span style="display:block;min-height:18px;margin-top:4px"></span>
        </div>
        <div class="field">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <label for="buyPrice">قیمت هر واحد</label>
            <button type="button" class="link-btn" id="priceNow" style="font-size:10px;padding:0;color:var(--primary);text-decoration:none">قیمت الان</button>
          </div>
          <div class="input-with-button">
            <input id="buyPrice" inputmode="decimal" placeholder="قیمت هر واحد" value="${h?groupedValue(String(h.buyPrice)):''}" ${h?'data-touched="1"':''} required style="padding-left:64px!important">
            <button type="button" class="inner-cur-btn" id="curToggleBtn">تومان</button>
          </div>
          <span id="priceHint" style="display:block;font-size:10px;color:var(--muted);min-height:18px;margin-top:4px"></span>
        </div>
        <div class="field">
          <label for="buyFee">کارمزد (تومان)</label>
          <input id="buyFee" inputmode="decimal" value="${h?.fee??0}" placeholder="۰">
        </div>
        <div class="field">
          <label for="buyDate">تاریخ خرید</label>
          <input id="buyDate" type="date" value="${h?.date||new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,10)}">
        </div>
      </div>
      <div class="form-actions\"""",
            text
        )
        print("buyForm fields aligned and inner currency button set.")

# 9. Remove style switcher JS
text = re.sub(r'// 5 Styles Switcher[\s\S]*?initStyleSwitcher\(\);', '', text)

with open("src/index.html", "w", encoding="utf-8") as f:
    f.write(text)

with open("index.html", "w", encoding="utf-8") as f:
    f.write(text)

print("JS updates applied to both src/index.html and index.html.")
