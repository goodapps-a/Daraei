import fs from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();
const logosDir = path.join(rootDir, 'public', 'logos');
const cryptoDir = path.join(logosDir, 'crypto');
const flagsDir = path.join(logosDir, 'flags');
const manifestPath = path.join(logosDir, 'icons.json');

fs.mkdirSync(cryptoDir, { recursive: true });
fs.mkdirSync(flagsDir, { recursive: true });

const COUNTRY_CODES = [
  'us', 'eu', 'gb', 'ae', 'tr', 'cn', 'ca', 'au', 'ch', 'sa',
  'qa', 'kw', 'om', 'iq', 'af', 'ru', 'in', 'jp', 'ir', 'bh',
  'my', 'sg', 'th', 'kr', 'se', 'no', 'dk', 'nz', 'hk', 'br',
  'az', 'am', 'ge', 'kz', 'uz', 'tm', 'tj', 'kg'
];

const CURATED_CRYPTO_URLS = {
  goat: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/solana/assets/CzLSujWBLFsSjncfkh59rUFqvafWcY5tzedWJSuypump/logo.png',
  fartcoin: 'https://bin.bnbstatic.com/static/assets/logos/FARTCOIN.png',
  grass: 'https://bin.bnbstatic.com/static/assets/logos/GRASS.png',
  hype: 'https://bin.bnbstatic.com/static/assets/logos/HYPE.png',
  pengu: 'https://bin.bnbstatic.com/static/assets/logos/PENGU.png',
  moodeng: 'https://bin.bnbstatic.com/static/assets/logos/MOODENG.png',
  pnut: 'https://bin.bnbstatic.com/static/assets/logos/PNUT.png',
  neiro: 'https://bin.bnbstatic.com/static/assets/logos/NEIRO.png',
  neirocto: 'https://bin.bnbstatic.com/static/assets/logos/NEIRO.png',
  virtual: 'https://bin.bnbstatic.com/static/assets/logos/VIRTUAL.png',
  ai16z: 'https://bin.bnbstatic.com/static/assets/logos/AI16Z.png',
  popcat: 'https://bin.bnbstatic.com/static/assets/logos/POPCAT.png',
  brett: 'https://bin.bnbstatic.com/static/assets/logos/BRETT.png',
  trump: 'https://bin.bnbstatic.com/static/assets/logos/TRUMP.png',
  dogs: 'https://bin.bnbstatic.com/static/assets/logos/DOGS.png',
  hmstr: 'https://bin.bnbstatic.com/static/assets/logos/HMSTR.png',
  cats: 'https://bin.bnbstatic.com/static/assets/logos/CATS.png',
  wld: 'https://bin.bnbstatic.com/static/assets/logos/WLD.png',
  strk: 'https://bin.bnbstatic.com/static/assets/logos/STRK.png',
  morpho: 'https://bin.bnbstatic.com/static/assets/logos/MORPHO.png',
  ethfi: 'https://bin.bnbstatic.com/static/assets/logos/ETHFI.png',
  zk: 'https://bin.bnbstatic.com/static/assets/logos/ZK.png',
  w: 'https://bin.bnbstatic.com/static/assets/logos/W.png',
  jto: 'https://bin.bnbstatic.com/static/assets/logos/JTO.png',
  zro: 'https://bin.bnbstatic.com/static/assets/logos/ZRO.png',
  manta: 'https://bin.bnbstatic.com/static/assets/logos/MANTA.png',
  alt: 'https://bin.bnbstatic.com/static/assets/logos/ALT.png',
  pixel: 'https://bin.bnbstatic.com/static/assets/logos/PIXEL.png',
  portal: 'https://bin.bnbstatic.com/static/assets/logos/PORTAL.png',
  pyth: 'https://bin.bnbstatic.com/static/assets/logos/PYTH.png',
  core: 'https://bin.bnbstatic.com/static/assets/logos/CORE.png',
  beam: 'https://bin.bnbstatic.com/static/assets/logos/BEAM.png',
  jasmy: 'https://bin.bnbstatic.com/static/assets/logos/JASMY.png',
  om: 'https://bin.bnbstatic.com/static/assets/logos/OM.png',
  xmr: 'https://bin.bnbstatic.com/static/assets/logos/XMR.png',
  xdc: 'https://static.coinpaprika.com/coin/xdc-xdc-network/logo.png',
  bdx: 'https://static.coinpaprika.com/coin/bdx-beldex/logo.png',
  pump: 'https://bin.bnbstatic.com/static/assets/logos/PUMP.png',
  aster: 'https://bin.bnbstatic.com/static/assets/logos/ASTER.png',
  prom: 'https://bin.bnbstatic.com/static/assets/logos/PROM.png',
  sonic: 'https://cdn.arz.digital/cr-odin/img/assets/sonic/64x64.png',
  redstone: 'https://bin.bnbstatic.com/static/assets/logos/RED.png',
  ton: 'https://bin.bnbstatic.com/static/assets/logos/TON.png'
};

const REAL_X_CRYPTOS = new Set(['xrp','xlm','xmr','xdc','xtz','xch','xaut','xai','xem','xvg','xno','xec','xpl','xvs']);

async function fetchJson(url, timeoutMs = 12000) {
  const res = await fetch(url, {
    headers: { 'user-agent': 'Darayi-Logo-Sync/1.0', 'accept': 'application/json' },
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function detectImageExt(buf) {
  if (!buf || buf.length < 16) return null;
  // PNG: 89 50 4E 47
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return 'png';
  // JPEG: FF D8 FF
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return 'jpg';
  // WEBP: RIFF....WEBP
  if (buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return 'webp';
  // SVG
  const head = buf.subarray(0, 256).toString('utf8').trimStart();
  if (head.startsWith('<svg') || head.startsWith('<?xml')) {
    if (head.includes('<svg') || buf.toString('utf8', 0, Math.min(buf.length, 512)).includes('<svg')) return 'svg';
  }
  return null;
}

async function downloadImage(url, timeoutMs = 4000) {
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': 'Darayi-Logo-Sync/1.0' },
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (!res.ok) return null;
    const arr = await res.arrayBuffer();
    const buf = Buffer.from(arr);
    if (buf.length < 32 || buf.length > 512 * 1024) return null;
    const ext = detectImageExt(buf);
    if (!ext) return null;
    return { buf, ext };
  } catch {
    return null;
  }
}

async function runPool(items, concurrency, worker) {
  let idx = 0;
  const runners = Array.from({ length: concurrency }, async () => {
    while (idx < items.length) {
      const i = idx++;
      await worker(items[i], i);
    }
  });
  await Promise.all(runners);
}

async function main() {
  console.log('1/4 Downloading fiat country flags...');
  let flagCount = 0;
  await runPool(COUNTRY_CODES, 15, async (code) => {
    const target = path.join(flagsDir, `${code}.svg`);
    if (fs.existsSync(target) && fs.statSync(target).size > 32) {
      try {
        if (detectImageExt(fs.readFileSync(target)) === 'svg') {
          flagCount++;
          return;
        }
      } catch {}
    }
    const remoteCode = code === 'eu' ? 'european_union' : code;
    const img = await downloadImage(`https://cdn.jsdelivr.net/gh/HatScripts/circle-flags@gh-pages/flags/${remoteCode}.svg`, 5000);
    if (img && img.ext === 'svg') {
      fs.writeFileSync(target, img.buf);
      flagCount++;
    }
  });
  console.log(`Flags synced: ${flagCount}/${COUNTRY_CODES.length}`);

  console.log('2/4 Fetching exchange coin lists & icon registries...');
  const [cmc1, cmc2, cp, cg1, cg2, kucoin, okx, gate, bin, kcCur] = await Promise.allSettled([
    fetchJson('https://api.coinmarketcap.com/data-api/v3/cryptocurrency/listing?start=1&limit=4000&sortBy=market_cap&sortType=desc&convert=USD'),
    fetchJson('https://api.coinmarketcap.com/data-api/v3/cryptocurrency/listing?start=4001&limit=4500&sortBy=market_cap&sortType=desc&convert=USD'),
    fetchJson('https://api.coinpaprika.com/v1/coins'),
    fetchJson('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=1'),
    fetchJson('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=2'),
    fetchJson('https://api.kucoin.com/api/v1/market/allTickers'),
    fetchJson('https://www.okx.com/api/v5/market/tickers?instType=SPOT'),
    fetchJson('https://api.gateio.ws/api/v4/spot/tickers'),
    fetchJson('https://data-api.binance.vision/api/v3/ticker/24hr'),
    fetchJson('https://api.kucoin.com/api/v3/currencies')
  ]);

  const activeSyms = new Set();
  const nonCrypto = new Set(['usd','eur','gbp','try','cad','aed','cny','aud','chf','sar','qar','kwd','omr','iqd','afn','rub','inr','jpy','brl','aeur']);
  if (bin.status === 'fulfilled' && Array.isArray(bin.value)) {
    for (const t of bin.value) if (t.symbol?.endsWith('USDT')) activeSyms.add(t.symbol.slice(0, -4).toLowerCase());
  }
  if (kucoin.status === 'fulfilled') {
    for (const t of kucoin.value?.data?.ticker || []) if (t.symbol?.endsWith('-USDT')) activeSyms.add(t.symbol.slice(0, -5).toLowerCase());
  }
  if (okx.status === 'fulfilled') {
    for (const t of okx.value?.data || []) if (t.instId?.endsWith('-USDT')) activeSyms.add(t.instId.slice(0, -5).toLowerCase());
  }
  if (gate.status === 'fulfilled' && Array.isArray(gate.value)) {
    for (const t of gate.value) if (t.currency_pair?.endsWith('_USDT')) activeSyms.add(t.currency_pair.slice(0, -5).toLowerCase());
  }
  for (const nc of nonCrypto) activeSyms.delete(nc);
  activeSyms.add('usdt');
  for (const k of Object.keys(CURATED_CRYPTO_URLS)) activeSyms.add(k);

  const kcFullName = {};
  if (kcCur.status === 'fulfilled' && Array.isArray(kcCur.value?.data)) {
    for (const c of kcCur.value.data) {
      if (c.currency && c.fullName) kcFullName[String(c.currency).toLowerCase()] = c.fullName;
    }
  }

  const normName = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const cmcBySym = new Map();
  const cmcByName = new Map();
  const cmcTopSyms = [];
  for (const res of [cmc1, cmc2]) {
    if (res.status !== 'fulfilled') continue;
    for (const c of res.value?.data?.cryptoCurrencyList || []) {
      const s = String(c?.symbol || '').toLowerCase().trim();
      if (!s || !c?.id) continue;
      const url = `https://s2.coinmarketcap.com/static/img/coins/64x64/${c.id}.png`;
      if (!cmcBySym.has(s)) {
        cmcBySym.set(s, url);
        if (cmcTopSyms.length < 1500) cmcTopSyms.push(s);
      }
      const nn = normName(c.name);
      if (nn && !cmcByName.has(nn)) cmcByName.set(nn, url);
      const sl = normName(c.slug);
      if (sl && !cmcByName.has(sl)) cmcByName.set(sl, url);
    }
  }

  const cpBySym = new Map();
  const cpByName = new Map();
  if (cp.status === 'fulfilled' && Array.isArray(cp.value)) {
    const sorted = cp.value
      .filter((c) => c && c.is_active !== false && c.id && c.symbol)
      .sort((a, b) => ((a.rank > 0 ? a.rank : 999999) - (b.rank > 0 ? b.rank : 999999)));
    for (const c of sorted) {
      const s = String(c.symbol).toLowerCase().trim();
      const url = `https://static.coinpaprika.com/coin/${c.id}/logo.png`;
      if (s && !cpBySym.has(s)) cpBySym.set(s, url);
      const nn = normName(c.name);
      if (nn && !cpByName.has(nn)) cpByName.set(nn, url);
      const slugPart = normName(String(c.id).split('-').slice(1).join(''));
      if (slugPart && !cpByName.has(slugPart)) cpByName.set(slugPart, url);
    }
  }

  const cgBySym = new Map();
  const cgByName = new Map();
  for (const cgRes of [cg1, cg2]) {
    if (cgRes.status !== 'fulfilled' || !Array.isArray(cgRes.value)) continue;
    for (const c of cgRes.value) {
      const s = String(c?.symbol || '').toLowerCase().trim();
      if (s && c?.image && !cgBySym.has(s)) cgBySym.set(s, c.image);
      if (c?.image) {
        const nn = normName(c.name);
        if (nn && !cgByName.has(nn)) cgByName.set(nn, c.image);
      }
    }
  }

  const targetMap = new Map();
  const buildCandidates = (rawKey) => {
    const k = rawKey.toLowerCase().trim();
    if (!/^[a-z0-9]{1,20}$/.test(k)) return [];
    const stripped = k.replace(/^(1000+|1m)/, '');
    const alt = (stripped && stripped !== k) ? stripped : (k.startsWith('ok') && k.length > 3 ? k.slice(2) : '');
    const urls = [];
    const push = (u) => { if (u && !urls.includes(u)) urls.push(u); };
    if (CURATED_CRYPTO_URLS[k]) push(CURATED_CRYPTO_URLS[k]);
    if (alt && CURATED_CRYPTO_URLS[alt]) push(CURATED_CRYPTO_URLS[alt]);
    push(cmcBySym.get(k));
    if (alt) push(cmcBySym.get(alt));
    push(cgBySym.get(k));
    if (alt) push(cgBySym.get(alt));
    push(cpBySym.get(k));
    if (alt) push(cpBySym.get(alt));
    const kn = kcFullName[k] ? normName(kcFullName[k]) : '';
    if (kn) {
      push(cmcByName.get(kn));
      push(cgByName.get(kn));
      push(cpByName.get(kn));
    }
    push(cmcByName.get(k));
    push(cpByName.get(k));
    if (!REAL_X_CRYPTOS.has(k)) {
      const xm = /^x([a-z]{1,6})$/.exec(k);
      if (xm) {
        push(`https://assets.parqet.com/logos/symbol/${xm[1].toUpperCase()}?format=png`);
      }
    }
    if (!urls.length) {
      push(`https://bin.bnbstatic.com/static/assets/logos/${encodeURIComponent((alt || k).toUpperCase())}.png`);
    }
    return urls.slice(0, 3);
  };

  const allKeys = new Set([...activeSyms, ...cmcTopSyms]);
  for (const k of allKeys) {
    if (!/^[a-z0-9]{1,20}$/.test(k) || nonCrypto.has(k)) continue;
    const cands = buildCandidates(k);
    if (cands.length) targetMap.set(k, cands);
  }

  console.log(`3/4 Downloading logos for ${targetMap.size} symbols (existing files skipped)...`);
  const iconManifest = {};
  const existingFiles = new Map();
  for (const f of fs.readdirSync(cryptoDir)) {
    const m = /^([a-z0-9]{1,20})\.(png|svg|webp|jpg)$/.exec(f);
    if (m) existingFiles.set(m[1], f);
  }

  let downloaded = 0, reused = 0, failed = 0;
  const entries = [...targetMap.entries()];
  await runPool(entries, 40, async ([sym, candidates]) => {
    const existing = existingFiles.get(sym);
    if (existing) {
      const p = path.join(cryptoDir, existing);
      const expectedExt = path.extname(existing).slice(1).toLowerCase();
      if (fs.statSync(p).size > 32) {
        try {
          if (detectImageExt(fs.readFileSync(p)) === expectedExt) {
            iconManifest[sym] = `/logos/crypto/${existing}`;
            reused++;
            return;
          }
        } catch {}
      }
    }
    for (const url of candidates) {
      const img = await downloadImage(url);
      if (img) {
        const filename = `${sym}.${img.ext}`;
        fs.writeFileSync(path.join(cryptoDir, filename), img.buf);
        iconManifest[sym] = `/logos/crypto/${filename}`;
        downloaded++;
        return;
      }
    }
    failed++;
  });

  // Sort keys cleanly
  const sortedManifest = {};
  for (const k of Object.keys(iconManifest).sort()) {
    sortedManifest[k] = iconManifest[k];
  }
  fs.writeFileSync(manifestPath, JSON.stringify(sortedManifest), 'utf8');

  const pngs = [];
  const extra = {};
  for (const [k, v] of Object.entries(sortedManifest)) {
    if (v === `/logos/crypto/${k}.png`) pngs.push(k);
    else extra[k] = v;
  }
  const flagCodes = fs.readdirSync(flagsDir)
    .filter((f) => f.endsWith('.svg'))
    .map((f) => f.replace(/\.svg$/, ''))
    .sort();
  const localIconsJs =
    `// AUTO-GENERATED BY scripts/sync-logos.mjs — DO NOT EDIT MANUALLY\n` +
    `export const LOCAL_CRYPTO_PNG_LIST = ${JSON.stringify(pngs.join(','))};\n` +
    `export const LOCAL_CRYPTO_EXTRA_MAP = ${JSON.stringify(extra)};\n` +
    `export const LOCAL_FLAG_CODE_LIST = ${JSON.stringify(flagCodes.join(','))};\n` +
    `export function buildLocalCryptoIconsMap() {\n` +
    `  const map = {};\n` +
    `  if (LOCAL_CRYPTO_PNG_LIST) {\n` +
    `    for (const sym of LOCAL_CRYPTO_PNG_LIST.split(',')) {\n` +
    `      if (sym) map[sym] = '/logos/crypto/' + sym + '.png';\n` +
    `    }\n` +
    `  }\n` +
    `  for (const [k, v] of Object.entries(LOCAL_CRYPTO_EXTRA_MAP)) {\n` +
    `    map[k] = v;\n` +
    `  }\n` +
    `  return map;\n` +
    `}\n`;
  fs.writeFileSync(path.join(rootDir, 'src', 'modules', 'local-icons.js'), localIconsJs, 'utf8');

  const indexHtmlPath = path.join(rootDir, 'src', 'index.html');
  if (fs.existsSync(indexHtmlPath)) {
    const html = fs.readFileSync(indexHtmlPath, 'utf8');
    const block =
      `/* @LOCAL_ICONS_START */\n` +
      `const LOCAL_CRYPTO_PNG_LIST = ${JSON.stringify(pngs.join(','))};\n` +
      `const LOCAL_CRYPTO_EXTRA = ${JSON.stringify(extra)};\n` +
      `const LOCAL_FLAG_CODES = new Set(${JSON.stringify(flagCodes)});\n` +
      `/* @LOCAL_ICONS_END */`;
    const updatedHtml = html.replace(/\/\* @LOCAL_ICONS_START \*\/[\s\S]*?\/\* @LOCAL_ICONS_END \*\//, block);
    if (updatedHtml !== html) fs.writeFileSync(indexHtmlPath, updatedHtml, 'utf8');
  }

  let totalBytes = 0;
  for (const f of fs.readdirSync(cryptoDir)) totalBytes += fs.statSync(path.join(cryptoDir, f)).size;
  for (const f of fs.readdirSync(flagsDir)) totalBytes += fs.statSync(path.join(flagsDir, f)).size;

  console.log(`4/4 Done! Reused: ${reused}, Downloaded: ${downloaded}, Unavailable: ${failed}`);
  console.log(`Total bundled crypto logos: ${Object.keys(sortedManifest).length}, flags: ${flagCount}`);
  console.log(`Total size in public/logos: ${(totalBytes / (1024 * 1024)).toFixed(2)} MB`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
