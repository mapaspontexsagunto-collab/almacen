// Service Worker — Almacén Eléctrico
// Estrategia: "network-first". Siempre intenta cargar la versión más reciente
// de internet primero; solo si no hay conexión, usa la copia guardada.
// Así evitamos quedarnos con una versión antigua de la app "pegada" en el móvil.

const CACHE_NAME = 'almacen-v1';
const PRECACHE_URLS = [
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
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

  // Solo gestionamos peticiones GET de nuestro propio origen (HTML, manifest, iconos).
  // Las llamadas a Supabase y CDNs externos se dejan pasar tal cual (la app ya
  // tiene su propia lógica de sincronización/reintentos para eso).
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) {
    return;
  }

  event.respondWith(
    fetch(req)
      .then((res) => {
        const resClone = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));
        return res;
      })
      .catch(() => caches.match(req))
  );
});
