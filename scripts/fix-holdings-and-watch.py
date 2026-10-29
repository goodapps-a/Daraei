with open("src/index.html", "r", encoding="utf-8") as f:
    text = f.read()

# 1. Neutralize renderWatch completely:
idx_rw = text.find("function renderWatch(){")
if idx_rw != -1:
    end_rw = text.find("function renderAllocation(", idx_rw)
    if end_rw != -1:
        text = text[:idx_rw] + "function renderWatch(){}\n" + text[end_rw:]
        print("Neutralized renderWatch completely.")

# 2. In renderAll, remove renderWatch call:
text = text.replace("if (typeof renderWatch === 'function') renderWatch();", "// renderWatch removed")
text = text.replace("renderWatch();", "")

# 3. Replace the holdings map block:
holdings_start = text.find("el.innerHTML = state.holdings.map((h, i) => {")
if holdings_start != -1:
    holdings_end = text.find("function renderAll() {", holdings_start)
    if holdings_end != -1:
        new_holdings_code = """el.innerHTML = state.holdings.map((h, i) => {
    const a = asset(h.assetId);
    const curUnit = a.currency === 'USDT' ? quoteToman(a) : a.price;
    const totalCost = (h.qty * h.buyPrice) + (h.fee || 0);
    const curVal = curUnit > 0 ? (h.qty * curUnit) : 0;
    const diff = curUnit > 0 ? (curVal - totalCost) : 0;
    const diffPct = (totalCost > 0) ? (diff / totalCost) * 100 : 0;
    const isUp = diff >= 0;
    return `<article class="holding">
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
    </article>`;
  }).join('');
}

"""
        text = text[:holdings_start] + new_holdings_code + text[holdings_end:]
        print("Holdings card template replaced successfully.")

# Save src/index.html and copy to index.html
with open("src/index.html", "w", encoding="utf-8") as f:
    f.write(text)

with open("index.html", "w", encoding="utf-8") as f:
    f.write(text)

print("Both src/index.html and index.html saved.")
