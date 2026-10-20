// Service Worker — Almacén Mecánico
// Estrategia: "network-first". Siempre intenta cargar la versión más reciente
// de internet primero; solo si no hay conexión, usa la copia guardada.
// Así evitamos quedarnos con una versión antigua de la app "pegada" en el móvil.

const CACHE_NAME = 'almacen-mec-v2';
const PRECACHE_URLS = [
  './index.html',
  './config.js',
  '../shared/app.js',
  '../shared/app.css',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
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
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Solo gestionamos peticiones GET de nuestro propio origen (HTML, JS, CSS, manifest, iconos).
  // Las llamadas a Supabase y CDNs externos se dejan pasar tal cual (la app ya
  // tiene su propia lógica de sincronización/reintentos para eso).
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) {
    return;
  }

  event.respondWith(
    fetch(req)
      .then((res) => {
        // Solo se guardan respuestas correctas completas (nunca errores 4xx/5xx ni parciales)
        if (res.ok && res.status === 200) {
          const resClone = res.clone();
          event.waitUntil(
            caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone)).catch(() => {})
          );
        }
        return res;
      })
      .catch(async () => {
        const hit = await caches.match(req, { ignoreSearch: true });
        if (hit) return hit;
        if (req.mode === 'navigate') {
          const shell = await caches.match('./index.html', { ignoreSearch: true });
          if (shell) return shell;
        }
        return new Response('Sin conexión', { status: 503, statusText: 'Sin conexión' });
      })
  );
});
