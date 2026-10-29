import re

with open("src/index.html", "r", encoding="utf-8") as f:
    html = f.read()

# 1. Remove style switcher bar
html = re.sub(r'<div class="style-switcher-bar">[\s\S]*?</div>\s*</div>', '', html)

# 2. Remove intro greeting from #home ("سلام، سرمایه‌گذار! ...")
html = re.sub(r'<div class="intro">[\s\S]*?</div>\s*</div>', '', html)

# 3. Clean up the 24h market movers section: split into two separate full-width sections
old_movers = re.search(r'<div class="section" style="margin-top:24px">[\s\S]*?id="losers"[\s\S]*?</div>\s*</div>\s*</div>', html)
if old_movers:
    new_movers = """<div class="section" style="margin-top:24px">
    <div class="section-head">
      <div><h2>بیشترین سود (صعودی‌های ۲۴ ساعت)</h2></div>
    </div>
    <div class="market-strip" id="winners"></div>
  </div>

  <div class="section" style="margin-top:20px">
    <div class="section-head">
      <div><h2>بیشترین ضرر (نزولی‌های ۲۴ ساعت)</h2></div>
    </div>
    <div class="market-strip" id="losers"></div>
  </div>"""
    html = html[:old_movers.start()] + new_movers + html[old_movers.end():]
    print("Market movers split into two separate scrollable sections.")

# 4. Move range tabs in #portfolio below the chart
old_pf_range = re.search(r'<div class="portfolio-range-chart" style="margin-top:12px;padding-top:10px">[\s\S]*?id="portfolioRangeEnd">اکنون</span></div>\s*</div>', html)
if old_pf_range:
    new_pf_range = """<div class="portfolio-range-chart" style="margin-top:12px;padding-top:10px">
      <div class="portfolio-chart-top" style="display:flex;justify-content:space-between;align-items:center">
        <small>روند ارزش سبد</small>
        <strong id="portfolioChartChange" style="font-size:12px;color:var(--lime)">+۰٫۰٪</strong>
      </div>
      <div id="portfolioHistoryChart" class="portfolio-history-chart" style="height:95px;margin:8px 0 4px"></div>
      <div class="portfolio-chart-axis" style="display:flex;justify-content:space-between;color:var(--muted);font-size:9.5px;margin-bottom:8px">
        <span id="portfolioRangeStart">ابتدا</span>
        <span id="portfolioRangeEnd">اکنون</span>
      </div>
      <div class="range-tabs" id="portfolioRanges" style="display:flex;justify-content:center;gap:6px">
        <button class="active" data-range="1D">۱ روز</button>
        <button data-range="3D">۳ روز</button>
        <button data-range="1W">۱ هفته</button>
        <button data-range="1M">۱ ماه</button>
        <button data-range="1Y">۱ سال</button>
      </div>
    </div>"""
    html = html[:old_pf_range.start()] + new_pf_range + html[old_pf_range.end():]
    print("Portfolio range tabs moved below chart.")

with open("src/index.html", "w", encoding="utf-8") as f:
    f.write(html)
