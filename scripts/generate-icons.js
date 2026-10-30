import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const publicDir = path.resolve('public');
const iconsDir = path.join(publicDir, 'icons');

if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

// Minimal 2D isometric black coin SVG
const coinSvg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <rect width="512" height="512" rx="112" fill="#f8fafc" />
  <g transform="translate(64, 64) scale(12)" stroke="#0f172a" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" fill="none">
    <ellipse cx="16" cy="11.5" rx="12" ry="6" fill="#0f172a" fill-opacity="0.15" />
    <path d="M 4 11.5 v 7.5 c 0 3.3 5.4 6 12 6 s 12 -2.7 12 -6 v -7.5" stroke="#0f172a" stroke-width="2.2" />
    <ellipse cx="16" cy="11.5" rx="7.5" ry="3.75" stroke="#0f172a" stroke-dasharray="2 1.5" stroke-width="1.6" />
    <path d="M 16 9.5 L 18.8 11.5 L 16 13.5 L 13.2 11.5 Z" fill="#0f172a" stroke="none" />
  </g>
</svg>
`.trim();

// Favicon SVG (transparent background)
const faviconSvg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32" fill="none" stroke="#0f172a" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
  <ellipse cx="16" cy="11.5" rx="12" ry="6" fill="#0f172a" fill-opacity="0.15"/>
  <path d="M 4 11.5 v 7.5 c 0 3.3 5.4 6 12 6 s 12 -2.7 12 -6 v -7.5"/>
  <ellipse cx="16" cy="11.5" rx="7.5" ry="3.75" stroke-dasharray="2 1.5" stroke-width="1.6"/>
  <path d="M 16 9.5 L 18.8 11.5 L 16 13.5 L 13.2 11.5 Z" fill="#0f172a" stroke-width="0"/>
</svg>
`.trim();

fs.writeFileSync(path.join(publicDir, 'favicon.svg'), faviconSvg);

// Generate PNG icons
const userUploadedIcon = path.join(publicDir, 'assets/aistudio/icon-512_099f2ce7.png');
const iconSrc = fs.existsSync(userUploadedIcon) ? userUploadedIcon : Buffer.from(coinSvg);

await sharp(iconSrc).resize(512, 512).png().toFile(path.join(iconsDir, 'icon-512.png'));
await sharp(iconSrc).resize(192, 192).png().toFile(path.join(iconsDir, 'icon-192.png'));
await sharp(iconSrc).resize(180, 180).png().toFile(path.join(publicDir, 'apple-touch-icon.png'));
await sharp(iconSrc).resize(512, 512).png().toFile(path.join(iconsDir, 'icon-maskable-512.png'));

// Maskable icon with safe-zone margin
const maskableSvg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <rect width="512" height="512" fill="#f8fafc" />
  <g transform="translate(102, 102) scale(9.6)" stroke="#0f172a" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" fill="none">
    <ellipse cx="16" cy="11.5" rx="12" ry="6" fill="#0f172a" fill-opacity="0.15" />
    <path d="M 4 11.5 v 7.5 c 0 3.3 5.4 6 12 6 s 12 -2.7 12 -6 v -7.5" stroke="#0f172a" stroke-width="2.2" />
    <ellipse cx="16" cy="11.5" rx="7.5" ry="3.75" stroke="#0f172a" stroke-dasharray="2 1.5" stroke-width="1.6" />
    <path d="M 16 9.5 L 18.8 11.5 L 16 13.5 L 13.2 11.5 Z" fill="#0f172a" stroke="none" />
  </g>
</svg>
`.trim();

await sharp(Buffer.from(maskableSvg)).resize(512, 512).png().toFile(path.join(iconsDir, 'icon-maskable-512.png'));

// Write manifest.webmanifest to public directory for static hosting / Cloudflare
const manifest = {
  name: 'دارایی من',
  short_name: 'دارایی من',
  description: 'پیگیری قیمت طلا، ارز و رمزارز و مدیریت سبد دارایی',
  lang: 'fa',
  dir: 'rtl',
  start_url: '/?source=pwa',
  scope: '/',
  display: 'standalone',
  orientation: 'portrait-primary',
  background_color: '#f8fafc',
  theme_color: '#0f2744',
  icons: [
    {
      src: '/icons/icon-192.png',
      sizes: '192x192',
      type: 'image/png',
      purpose: 'any'
    },
    {
      src: '/icons/icon-512.png',
      sizes: '512x512',
      type: 'image/png',
      purpose: 'any'
    },
    {
      src: '/icons/icon-maskable-512.png',
      sizes: '512x512',
      type: 'image/png',
      purpose: 'maskable'
    }
  ]
};

fs.writeFileSync(path.join(publicDir, 'manifest.webmanifest'), JSON.stringify(manifest, null, 2), 'utf8');

// Write static service worker sw.js to public directory for static hosting / Cloudflare
const swCode = `// Service Worker for Darayi PWA
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  // Always fetch fresh network data for real-time prices
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
`;

fs.writeFileSync(path.join(publicDir, 'sw.js'), swCode, 'utf8');

console.log('PWA icons and manifest created successfully!');
