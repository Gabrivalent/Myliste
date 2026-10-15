const CACHE_NAME = 'kolekt-cache-v2';

// Elenco puntuale dei file locali dell'architettura modulare
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  
  // Fogli di stile CSS
  './css/base.css',
  './css/components.css',
  './css/modals.css',
  './css/responsive.css',

  // Moduli JS
  './js/config.js',
  './js/state.js',
  './js/supabase.js',
  './js/scanner.js',
  './js/shelf.js',
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

// Pulizia vecchie cache precedenti (es. versione monolitica v1)
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

// Strategia Network First con fallback su Cache (ottimale per collezioni e Supabase)
self.addEventListener('fetch', (event) => {
  // Ignora chiamate API/Supabase/CDN o richieste non GET
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