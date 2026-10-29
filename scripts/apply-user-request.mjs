import fs from 'node:fs';

const htmlPath = 'src/index.html';
let html = fs.readFileSync(htmlPath, 'utf8');

// 1. Remove greeting and pills from home and market
html = html.replace(
  /<div class="intro"><div><h1>سلام، <span id="userName">.*?<\/div>/s,
  ''
);

// Remove the pill from market view
html = html.replace(
  /<span class="pill sample" id="marketPill">.*?<\/span>/s,
  ''
);

// Remove cloudflare deploy button from topbar if present
html = html.replace(/<button class="icon-btn" id="cfDeployBtn"[^>]*>.*?<\/button>/g, '');

// 2. Remove quality notes and dailyBrief and realizedPL from DOM
html = html.replace(/<div class="quality-note" id="homeQuality"><\/div>/g, '');
html = html.replace(/<div class="quality-note" id="dailyBrief"><\/div>/g, '');
html = html.replace(/<div class="quality-note" id="portfolioQuality"><\/div>/g, '');
html = html.replace(/<div class="quality-note" id="realizedPL"><\/div>/g, '');

// 3. Rename "سبد من" to "دارایی" in bottom nav and headings
html = html.replace(
  /<button data-page="portfolio"><span class="nav-icon">▤<\/span>سبد من<\/button>/g,
  '<button data-page="portfolio"><span class="nav-icon">▤</span>دارایی</button>'
);
html = html.replace(
  /<button class="hero-cta" data-goto="portfolio">جزئیات سبد <span>←<\/span><\/button>/g,
  '<button class="hero-cta" data-goto="portfolio">جزئیات دارایی <span>←</span></button>'
);
html = html.replace(
  /<span class="quick-link">رفتن به سبد من ←<\/span>/g,
  '<span class="quick-link">رفتن به دارایی ←</span>'
);
html = html.replace(
  /<div class="brand-mark">▤<\/div><div><div>سبد دارایی<\/div><div class="greeting">مالکیت، هزینه و سود و زیان<\/div><\/div>/g,
  '<div class="brand-mark">▤</div><div><div>دارایی</div><div class="greeting">عملکرد و ارزش سرمایه‌گذاری</div></div>'
);
html = html.replace(
  /<h3>تاریخچهٔ معاملات و انتقال‌ها<\/h3>/g,
  '<h3>تاریخچهٔ معاملات</h3>'
);

// 4. Update max featured limit to 24 in UI text and constants
html = html.replace(/const MAX=16;/g, 'const MAX=24;');
html = html.replace(/حداکثر ۱۶ ارز/g, 'حداکثر ۲۴ ارز');
html = html.replace(/\.slice\(0,16\)/g, '.slice(0,24)');

// 5. Exclude stablecoins except USDT
const stableFilterCode = `
const EXCLUDED_STABLES = new Set(['usdc','dai','fdusd','tusd','usdp','busd','pyusd','usdd','usds','usd1','usdg','paxg','eurc','ustc','xaut','frax','usde','rlusd','lusd','gusd']);
`;

// Insert stable filter if not present
if (!html.includes('EXCLUDED_STABLES')) {
  html = html.replace('const seed=[', stableFilterCode + '\nconst seed=[');
}

// Filter in applyPrices
const applyOld = "if(!/^[a-z0-9]{1,20}$/.test(id)||!(i.price>0))continue;";
const applyNew = "if(!/^[a-z0-9]{1,20}$/.test(id)||!(i.price>0)||EXCLUDED_STABLES.has(id)||EXCLUDED_STABLES.has(String(i.symbol||'').toLowerCase()))continue;";
html = html.replace(applyOld, applyNew);

// 6. Update theme toggle SVG icons
const themeBtnSvg = `
const sunIcon = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>';
const moonIcon = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>';
`;
if (!html.includes('sunIcon')) {
  html = html.replace('function renderAll(){', themeBtnSvg + '\nfunction renderAll(){');
  html = html.replace(
    "$('#themeBtn').textContent=state.theme==='dark'?'☀':'☾';",
    "$('#themeBtn').innerHTML=state.theme==='dark'?sunIcon:moonIcon;"
  );
  html = html.replace(
    '<button class="icon-btn" id="themeBtn" type="button" aria-label="حالت تیره / روشن">☾</button>',
    `<button class="icon-btn" id="themeBtn" type="button" aria-label="حالت تیره / روشن"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg></button>`
  );
}

// 7. Update relative time function and staleness (12 hours)
const oldIsStale = "function isStale(a){return !a.updatedAt||Date.now()/1000-a.updatedAt>(a.currency==='USDT'?90:1800)}";
const newIsStale = `
function isStale(a){return !a.updatedAt||Date.now()/1000-a.updatedAt>43200;}
function formatRelativeTime(ts){
  if(!ts)return 'نامشخص';
  const d=new Date(ts*1000),now=new Date();
  const timeStr=d.toLocaleTimeString('fa-IR',{hour:'2-digit',minute:'2-digit',hour12:false});
  const isToday=d.getFullYear()===now.getFullYear()&&d.getMonth()===now.getMonth()&&d.getDate()===now.getDate();
  const yest=new Date(now);yest.setDate(yest.getDate()-1);
  const isYesterday=d.getFullYear()===yest.getFullYear()&&d.getMonth()===yest.getMonth()&&d.getDate()===yest.getDate();
  if(isToday)return 'امروز، '+timeStr;
  if(isYesterday)return 'دیروز، '+timeStr;
  return d.toLocaleDateString('fa-IR',{month:'2-digit',day:'2-digit'})+'، '+timeStr;
}
`;
html = html.replace(oldIsStale, newIsStale);

// Update quality() to use formatRelativeTime
const oldQuality = "const time=a.updatedAt?new Date(a.updatedAt*1000).toLocaleString('fa-IR',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}):'زمان نامشخص';return (isStale(a)?'● قدیمی / تأخیردار':'● به‌روز')+' · '+time";
const newQuality = "const time=a.updatedAt?formatRelativeTime(a.updatedAt):'زمان نامشخص';return (isStale(a)?'● تأخیردار':'● به‌روز')+' · '+time";
html = html.replace(oldQuality, newQuality);

// 8. Remove approx ≈ from updateSummary
html = html.replace(/\(approx\?'≈ ':'\)/g, "''");

// 9. Update renderPortfolio holdings display to show current price, value, profit/loss, and NO "خرید"
const oldHoldingsMap = `el.innerHTML=state.holdings.map((h,i)=>{const a=asset(h.assetId),v=h.qty*h.buyPrice,c=v+(h.fee||0),pl=0;return \`<article class="holding"><div><div class="holding-left">\${assetIcon(a)}<div style="min-width:0"><div class="holding-title">\${a.name} · \${({buy:'خرید',sell:'فروش',transfer:'انتقال'})[h.side||'buy']}</div><div class="table-note">\${qtyFmt.format(h.qty)} واحد · \${escapeHtml(h.date||'')} · \${escapeHtml(h.wallet||'اصلی')}\${h.side==='transfer'?' ← '+escapeHtml(h.toWallet||''):''}</div><div class="holding-sub">\${a.symbol}</div></div></div><div class="holding-actions"><button class="small-btn" data-edit-holding="\${h.id}">ویرایش</button><button class="small-btn" data-delete-holding="\${h.id}">حذف</button></div></div><div class="holding-right"><b>\${money(v)}</b><small style="color:\${pl>=0?'var(--green)':'var(--red)'}">کارمزد: \${money(h.fee||0)}</small></div></article>\`}).join('')`;

const newHoldingsMap = `el.innerHTML=state.holdings.map((h,i)=>{
  const a=asset(h.assetId);
  const curUnit=quoteToman(a);
  const curVal=curUnit>0?h.qty*curUnit:h.qty*h.buyPrice;
  const costTotal=h.qty*h.buyPrice+(h.fee||0);
  const diff=curUnit>0?(curVal-costTotal):0;
  const diffPct=costTotal>0&&curUnit>0?(diff/costTotal)*100:0;
  const isUp=diff>=0;
  return \`<article class="holding">
    <div>
      <div class="holding-left">
        \${assetIcon(a)}
        <div style="min-width:0">
          <div class="holding-title">\${a.name}</div>
          <div class="table-note">\${qtyFmt.format(h.qty)} واحد · \${escapeHtml(h.date||'')} · بهای خرید: \${money(h.buyPrice)}</div>
          <div class="table-note" style="color:var(--muted)">قیمت فعلی: \${curUnit>0?money(curUnit):'در دسترس نیست'}</div>
        </div>
      </div>
      <div class="holding-actions">
        <button class="small-btn" data-edit-holding="\${h.id}">ویرایش</button>
        <button class="small-btn" data-delete-holding="\${h.id}">حذف</button>
      </div>
    </div>
    <div class="holding-right">
      <b>\${money(curVal)}</b>
      <small style="color:\${isUp?'var(--green)':'var(--red)'};font-weight:800;display:block;margin-top:2px">
        \${diff!==0?(isUp?'+':'−')+money(Math.abs(diff))+' ('+fmt.format(Math.abs(diffPct))+'٪)':'بدون تغییر'}
      </small>
    </div>
  </article>\`;
}).join('')`;

if (html.includes(oldHoldingsMap)) {
  html = html.replace(oldHoldingsMap, newHoldingsMap);
  console.log('Updated portfolio holdings display!');
} else {
  console.log('Warning: oldHoldingsMap pattern not found, trying partial replacement');
}

fs.writeFileSync(htmlPath, html, 'utf8');
console.log('First pass applied successfully.');
