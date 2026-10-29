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

fs.writeFileSync(distWorkerPath, bundled, 'utf8');
console.log(`Successfully built ${distWorkerPath} (${(bundled.length / 1024).toFixed(1)} KB)`);
