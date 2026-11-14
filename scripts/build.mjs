import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { extractInlineScriptBodies } from '../src/modules/security.js';

const rootDir = process.cwd();
const indexHtmlPath = path.join(rootDir, 'src', 'index.html');
const workerJsPath = path.join(rootDir, 'src', 'worker.js');
const distDir = path.join(rootDir, 'dist');
const distWorkerPath = path.join(distDir, 'worker.js');
const bunLockPath = path.join(rootDir, 'bun.lock');

if (fs.existsSync(bunLockPath)) {
  const rawBunLock = fs.readFileSync(bunLockPath, 'utf8');
  const normalizedBunLock = rawBunLock
    .replace(/"lockfileVersion"\s*:\s*\d+/, '"lockfileVersion": 1')
    .replace(/\n\s*"configVersion"\s*:\s*\d+\s*,?/g, '');
  if (normalizedBunLock !== rawBunLock) {
    fs.writeFileSync(bunLockPath, normalizedBunLock, 'utf8');
    console.log('Normalized bun.lock to lockfileVersion: 1 for Cloudflare bun@1.2.15 compatibility.');
  }
}

if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

console.log('Reading src/index.html and src/worker.js...');
const htmlContent = fs.readFileSync(indexHtmlPath, 'utf8');
let workerContent = fs.readFileSync(workerJsPath, 'utf8');

// Inline local ES module imports from ./modules/*.js so dist/worker.js remains a self-contained single-file Worker bundle
workerContent = workerContent.replace(
  /import\s+\{([\s\S]*?)\}\s+from\s+['"](\.\/modules\/[^'"]+)['"];?/g,
  (_match, specifiersRaw, relPath) => {
    const modPath = path.resolve(path.dirname(workerJsPath), relPath);
    if (!fs.existsSync(modPath)) {
      throw new Error(`Module not found during build: ${modPath}`);
    }
    const modSource = fs.readFileSync(modPath, 'utf8');
    const exportedNames = new Set();
    const exportRegex = /^export\s+(?:async\s+)?(?:const|let|var|function|class)\s+([A-Za-z_$][A-Za-z0-9_$]*)/gm;
    let m;
    while ((m = exportRegex.exec(modSource)) !== null) {
      exportedNames.add(m[1]);
    }
    const requested = specifiersRaw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => s.split(/\s+as\s+/)[0].trim());
    for (const sym of requested) {
      if (!exportedNames.has(sym)) {
        throw new Error(`Symbol "${sym}" imported from ${relPath} is not exported by ${modPath}`);
      }
    }
    return (
      `// --- Inlined from ${relPath} ---\n` +
      modSource.replace(/^export\s+(const|let|var|function|async\s+function|class)\s+/gm, '$1 ') +
      `\n// --- End ${relPath} ---`
    );
  }
);

const splashJsPath = path.join(rootDir, 'public', 'coin-splash.js');
const facePngPath = path.join(rootDir, 'public', 'coin-face.png');
const splashJsContent = fs.existsSync(splashJsPath) ? fs.readFileSync(splashJsPath, 'utf8') : '';
const facePngBase64 = fs.existsSync(facePngPath) ? fs.readFileSync(facePngPath).toString('base64') : '';

const inlineScripts = extractInlineScriptBodies(htmlContent);
if (inlineScripts.length === 0) {
  throw new Error('No inline <script> blocks found in src/index.html');
}
const appScriptHashes = inlineScripts.map(
  (body) => `sha256-${crypto.createHash('sha256').update(body, 'utf8').digest('base64')}`
);
console.log(`Computed CSP hashes for ${appScriptHashes.length} inline <script> blocks.`);

const bundled = `// دارایی من (Darayi) — Cloudflare Worker Full Single-File Bundle
// Build generated: ${new Date().toISOString()}
const APP_HTML = ${JSON.stringify(htmlContent)};
const APP_SCRIPT_HASHES = ${JSON.stringify(appScriptHashes)};
const COIN_SPLASH_JS = ${JSON.stringify(splashJsContent)};
const COIN_FACE_PNG = ${JSON.stringify(facePngBase64)};

${workerContent}
`;

// Verify no duplicate top-level declarations exist in the generated bundle
{
  const topDeclRegex = /^(?:export\s+)?(?:async\s+)?(const|let|var|function|class)\s+([A-Za-z_$][A-Za-z0-9_$]*)/;
  const seenDecls = new Map();
  const lines = bundled.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const match = topDeclRegex.exec(lines[i]);
    if (match) {
      const name = match[2];
      const lineNo = i + 1;
      if (seenDecls.has(name)) {
        throw new Error(
          `Duplicate top-level symbol "${name}" in dist/worker.js at line ${lineNo} (previously declared at line ${seenDecls.get(name)})`
        );
      }
      seenDecls.set(name, lineNo);
    }
  }
}

function shouldCopyPublicEntry(srcPath) {
  const rel = path.relative(path.join(rootDir, 'public'), srcPath).replace(/\\/g, '/');
  if (!rel) return true;
  const base = path.basename(rel);
  if (rel === 'worker.js' || base === 'worker.js') return false;
  if (rel === 'assets/aistudio' || rel.startsWith('assets/aistudio/')) return false;
  if (base.endsWith('.md') || base.endsWith('.zip')) return false;
  if (base.startsWith('Screenshot_')) return false;
  return true;
}

const publicDir = path.join(rootDir, 'public');
if (fs.existsSync(publicDir)) {
  fs.cpSync(publicDir, distDir, {
    recursive: true,
    force: true,
    filter: (src) => shouldCopyPublicEntry(src)
  });
}

// Ensure no leaked files remain in dist/ from previous builds
const leakedInDist = [
  path.join(distDir, 'assets', 'aistudio')
];
for (const p of leakedInDist) {
  if (fs.existsSync(p)) {
    fs.rmSync(p, { recursive: true, force: true });
  }
}

const autoHeader = '<!-- AUTO-GENERATED FROM src/index.html BY scripts/build.mjs — DO NOT EDIT MANUALLY -->\n';
const rootIndexHtmlPath = path.join(rootDir, 'index.html');
const distIndexHtmlPath = path.join(distDir, 'index.html');
fs.writeFileSync(rootIndexHtmlPath, autoHeader + htmlContent, 'utf8');
fs.writeFileSync(distIndexHtmlPath, htmlContent, 'utf8');

fs.writeFileSync(distWorkerPath, bundled, 'utf8');
console.log(`Successfully built ${distWorkerPath} (${(bundled.length / 1024).toFixed(1)} KB)`);
