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
const workerContent = fs.readFileSync(workerJsPath, 'utf8');

// The single-file Cloudflare bundle prepends const APP_HTML = "...";
const bundled = `// دارایی من (Darayi) — Cloudflare Worker Full Single-File Bundle
// Build generated: ${new Date().toISOString()}
const APP_HTML = ${JSON.stringify(htmlContent)};

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

