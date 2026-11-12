import fs from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();
const indexHtmlPath = path.join(rootDir, 'src', 'index.html');
const workerJsPath = path.join(rootDir, 'src', 'worker.js');
const distDir = path.join(rootDir, 'dist');
const distWorkerPath = path.join(distDir, 'worker.js');

if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

console.log('Reading src/index.html and src/worker.js...');
const htmlContent = fs.readFileSync(indexHtmlPath, 'utf8');
let workerContent = fs.readFileSync(workerJsPath, 'utf8');

// Inline local ES module imports from ./modules/*.js so dist/worker.js remains a self-contained single-file Worker bundle
workerContent = workerContent.replace(
  /import\s+\{[^}]+\}\s+from\s+['"](\.\/modules\/[^'"]+)['"];?/g,
  (_match, relPath) => {
    const modPath = path.resolve(path.dirname(workerJsPath), relPath);
    if (!fs.existsSync(modPath)) {
      throw new Error(`Module not found during build: ${modPath}`);
    }
    const modSource = fs.readFileSync(modPath, 'utf8');
    // Strip 'export ' prefix from inlined module declarations to avoid duplicate export collisions if needed, or keep top-level const/function
    return `// --- Inlined from ${relPath} ---\n` + modSource.replace(/^export\s+(const|let|function|async\s+function)\s+/gm, '$1 ') + `\n// --- End ${relPath} ---`;
  }
);

const splashJsPath = path.join(rootDir, 'public', 'coin-splash.js');
const facePngPath = path.join(rootDir, 'public', 'coin-face.png');
const splashJsContent = fs.existsSync(splashJsPath) ? fs.readFileSync(splashJsPath, 'utf8') : '';
const facePngBase64 = fs.existsSync(facePngPath) ? fs.readFileSync(facePngPath).toString('base64') : '';

// The single-file Cloudflare bundle prepends const APP_HTML, COIN_SPLASH_JS, COIN_FACE_PNG
const bundled = `// دارایی من (Darayi) — Cloudflare Worker Full Single-File Bundle
// Build generated: ${new Date().toISOString()}
const APP_HTML = ${JSON.stringify(htmlContent)};
const COIN_SPLASH_JS = ${JSON.stringify(splashJsContent)};
const COIN_FACE_PNG = ${JSON.stringify(facePngBase64)};

${workerContent}
`;

const publicDir = path.join(rootDir, 'public');
if (fs.existsSync(publicDir)) {
  fs.cpSync(publicDir, distDir, { recursive: true, force: true });
}

const rootIndexHtmlPath = path.join(rootDir, 'index.html');
fs.writeFileSync(rootIndexHtmlPath, htmlContent, 'utf8');

const publicWorkerPath = path.join(rootDir, 'public', 'worker.js');
fs.writeFileSync(distWorkerPath, bundled, 'utf8');
fs.writeFileSync(publicWorkerPath, bundled, 'utf8');
console.log(`Successfully built ${distWorkerPath} and ${publicWorkerPath} (${(bundled.length / 1024).toFixed(1)} KB)`);

