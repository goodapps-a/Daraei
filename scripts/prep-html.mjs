import fs from 'node:fs';

let html = fs.readFileSync('public/assets/aistudio/index_35b1796e.html', 'utf8');

// Fix 1: Normalize WebSocket matching so KuCoin/OKX pairs match Binance WebSocket ticker
const oldWsMatch = 'const a=assets.find(a=>a.pair===x.s);';
const newWsMatch = 'const a=assets.find(a=>a.pair===x.s || (a.symbol && (a.symbol+"USDT")===x.s) || (a.pair && a.pair.replace(/[-_]/g,"")===x.s));';
if (html.includes(oldWsMatch)) {
  html = html.replace(oldWsMatch, newWsMatch);
  console.log('Fixed WebSocket pair matching!');
}

// Fix 2: Safe WebSocket retry logic to avoid spamming if blocked in Iran
const oldWsClose = 'ws.onclose=()=>{ws=null;wsTimer=setTimeout(connectPrices,Math.min(60000,1000*2**Math.min(wsAttempt++,6))+Math.random()*1000)}';
const newWsClose = 'ws.onclose=()=>{ws=null;if(wsAttempt>6)return;wsTimer=setTimeout(connectPrices,Math.min(60000,2000*2**Math.min(wsAttempt++,6))+Math.random()*1000)}';
if (html.includes(oldWsClose)) {
  html = html.replace(oldWsClose, newWsClose);
  console.log('Fixed WebSocket backoff retry!');
}

// Fix 3: Add Cloudflare helper button in topbar
const oldTopActions = '<button class="login-btn" id="loginBtn" type="button">ورود</button>';
const newTopActions = '<button class="icon-btn" id="cfDeployBtn" type="button" title="کد و تنظیمات کلادفلر" style="font-size:15px;color:var(--purple);font-weight:900">☁</button><button class="login-btn" id="loginBtn" type="button">ورود</button>';
if (html.includes(oldTopActions)) {
  html = html.replace(oldTopActions, newTopActions);
  console.log('Added Cloudflare helper button!');
}

// Fix 4: Add Cloudflare Modal Trigger in JS
const scriptEnd = "api('/api/health').then(j=>{window.authConfig=j}).catch(()=>{});";
const cfModalCode = `api('/api/health').then(j=>{window.authConfig=j}).catch(()=>{});
const cfBtn=$('#cfDeployBtn');
if(cfBtn){
  cfBtn.onclick=()=>{
    openModal('تنظیمات و فایل Cloudflare Worker',\`
      <div style="font-size:13px;line-height:1.9;color:var(--ink)">
        <div style="padding:12px;background:var(--greenbg);border-radius:14px;border:1px solid #c0ebcf;margin-bottom:14px">
          <strong style="color:var(--green);display:block;margin-bottom:4px">✓ نسخه نهایی و رفع‌باگ‌شده آماده است</strong>
          تمام باگ‌های مسدود شدن در کلادفلر، قطعی بایننس، خطای ۱۰ میلی‌ثانیه CPU و توقف دریافت نرخ‌های داخلی رفع شده‌اند.
        </div>
        <div style="display:grid;gap:10px;margin-bottom:16px">
          <a class="btn btn-lime" href="/api/download/worker.js" download="worker.js" style="text-decoration:none;display:flex;align-items:center;justify-content:center;font-size:13px">
            ⬇ دانلود فایل آماده (worker.js)
          </a>
          <button class="btn btn-dark" type="button" id="copyWorkerBtn" style="font-size:13px">
            📋 کپی کردن کل کد worker.js
          </button>
        </div>
        <h3 style="margin:14px 0 6px;font-size:14px">مراحل استقرار در کلادفلر (۳ مرحله):</h3>
        <ol style="padding-inline-start:20px;margin:0;line-height:2">
          <li>در داشبورد کلادفلر وارد Worker فعلی خود شو و دکمه <b>Edit code</b> را بزن.</li>
          <li>تمام کد قبلی را پاک کن و کل محتوای <b>worker.js</b> دانلود شده یا کپی شده را قرار بده و <b>Deploy</b> را بزن.</li>
          <li>در بخش <b>Settings ← Triggers</b> زمان‌بندی Cron را روی <code>* * * * *</code> (هر دقیقه) قرار بده.</li>
        </ol>
      </div>
    \`);
    const cwb=$('#copyWorkerBtn');
    if(cwb){
      cwb.onclick=async()=>{
        cwb.disabled=true;
        cwb.textContent='در حال دریافت کد…';
        try{
          const res=await fetch('/api/download/worker.js');
          const code=await res.text();
          await navigator.clipboard.writeText(code);
          toast('کد worker.js با موفقیت کپی شد!');
          cwb.textContent='✓ کپی شد!';
        }catch(e){
          toast('امکان کپی خودکار نبود؛ فایل را دانلود کن.');
          cwb.textContent='دانلود کنید';
        }finally{
          setTimeout(()=>{cwb.disabled=false;cwb.textContent='📋 کپی کردن کل کد worker.js';},3000);
        }
      };
    }
  };
}`;
html = html.replace(scriptEnd, cfModalCode);

fs.writeFileSync('src/index.html', html, 'utf8');
console.log('src/index.html written successfully. Size:', (html.length / 1024).toFixed(1), 'KB');
