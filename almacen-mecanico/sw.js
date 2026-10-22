// Service Worker — Almacén Mecánico
// Estrategia: "network-first" con tiempo límite. Intenta cargar siempre la versión más reciente
// (sin usar la caché HTTP del navegador); si la red tarda más de 4 s o falla, usa la copia guardada.
// Las librerías externas (versiones fijas, con control de integridad) se guardan para poder abrir la app sin conexión.

const PREFIX = 'almacen-mecanico-';
const CACHE_NAME = PREFIX + 'v3';
const LEGACY_CACHE = 'almacen-mec-v2';
const NETWORK_TIMEOUT_MS = 4000;
const CDN_HOSTS = ['cdnjs.cloudflare.com', 'cdn.jsdelivr.net'];
const PRECACHE_URLS = [
  './index.html',
  './config.js',
  '../shared/app.js',
  '../shared/app.css',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/html5-qrcode/2.3.8/html5-qrcode.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js'
];

self.addEventListener('install', (event) => {
  // Un fichero que falle no debe impedir instalar el resto
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.allSettled(PRECACHE_URLS.map((u) => cache.add(u)))
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // Solo se borran las cachés de ESTE almacén (nunca las del otro almacén ni las de otras webs del mismo dominio)
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => (k.startsWith(PREFIX) && k !== CACHE_NAME) || k === LEGACY_CACHE)
          .map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Librerías externas: primero la copia guardada (las versiones no cambian)
  if (CDN_HOSTS.includes(url.hostname)) {
    event.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok && res.status === 200) {
          const copia = res.clone();
          event.waitUntil(caches.open(CACHE_NAME).then((c) => c.put(req, copia)).catch(() => {}));
        }
        return res;
      }))
    );
    return;
  }

  // Solo gestionamos peticiones de nuestro propio origen. Las llamadas a Supabase se dejan pasar tal cual.
  if (url.origin !== self.location.origin) return;

  const red = fetch(req, { cache: 'no-cache' }).then((res) => {
    // Solo se guardan respuestas correctas completas (nunca errores 4xx/5xx ni parciales)
    if (res.ok && res.status === 200) {
      const copia = res.clone();
      event.waitUntil(caches.open(CACHE_NAME).then((c) => c.put(req, copia)).catch(() => {}));
    }
    return res;
  });
  red.catch(() => {}); // evita avisos si la red falla después de usar la copia guardada
  const limite = new Promise((resolve) => setTimeout(() => resolve(null), NETWORK_TIMEOUT_MS));

  event.respondWith((async () => {
    try {
      const res = await Promise.race([red, limite]);
      if (res) return res;
      const hit = await caches.match(req, { ignoreSearch: true });
      if (hit) return hit;
      return await red;
    } catch (e) {
      const hit = await caches.match(req, { ignoreSearch: true });
      if (hit) return hit;
      if (req.mode === 'navigate') {
        const shell = await caches.match('./index.html', { ignoreSearch: true });
        if (shell) return shell;
      }
      return new Response('Sin conexión', { status: 503, statusText: 'Sin conexión' });
    }
  })());
});
