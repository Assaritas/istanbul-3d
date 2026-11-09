// =============================================================================
//  sw.js — Service Worker: tüm uygulamayı ilk ziyarette önbelleğe alır (çevrimdışı)
//  İçerik güncellediğinizde VERSION değerini artırın (ör. v2), misafirler yeni sürümü alır.
// =============================================================================
const VERSION = 'v1';
const CACHE = `dijital-ikiz-${VERSION}`;

const CORE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/style.css',
  './js/config.js',
  './js/main.js',
  './js/terrain.js',
  './js/layers.js',
  './js/ui.js',
  './vendor/three.module.min.js',
  './vendor/addons/controls/OrbitControls.js',
  './data/data.js',
  './data/curated.js',
  './assets/yukseklik.png',
  './assets/harita_2048.jpg',
  './icons/icon-192.png',
  './icons/icon-512.png',
];
// Büyük doku: yalnızca masaüstünde kullanılır; arka planda indirilir, kurulumu engellemez
const OPTIONAL = ['./assets/harita_4096.jpg'];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await c.addAll(CORE);
    c.addAll(OPTIONAL).catch(() => {});
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;   // Vikipedi görselleri vb. ağdan
  e.respondWith((async () => {
    const c = await caches.open(CACHE);
    const hit = await c.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try {
      const res = await fetch(req);
      if (res.ok) c.put(req, res.clone());
      return res;
    } catch (err) {
      if (req.mode === 'navigate') return (await c.match('./index.html')) || Response.error();
      return Response.error();
    }
  })());
});
