const CACHE_NAME = 'kolekt-cache-v3';

// Elenco puntuale degli asset reali presenti nel progetto
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  
  // Fogli di stile CSS
  './css/base.css',
  './css/components.css',
  './css/modals.css',
  './css/responsive.css',

  // Moduli JS effettivi
  './js/ui.js',
  './js/supabase.js',
  './js/scanner.js',
  './js/main.js'
];

// Installazione Service Worker e caching asset locali
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    }).then(() => self.skipWaiting())
  );
});

// Pulizia vecchie cache precedenti
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Strategia Network First con fallback su Cache
self.addEventListener('fetch', (event) => {
  // Ignora chiamate non GET o verso domini esterni (Supabase, Worker, CDN)
  if (event.request.method !== 'GET' || !event.request.url.startsWith(self.location.origin)) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      })
      .catch(() => caches.match(event.request))
  );
});
