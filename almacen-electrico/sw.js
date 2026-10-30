// Service Worker — Almacén Eléctrico
// Estrategia: "network-first" con tiempo límite. Intenta cargar siempre la versión más reciente
// (sin usar la caché HTTP del navegador); si la red tarda más de 4 s o falla, usa la copia guardada.
// Las librerías externas (versiones fijas, con control de integridad) se guardan para poder abrir la app sin conexión.

const PREFIX = 'almacen-electrico-';
const CACHE_NAME = PREFIX + 'v4'; // v4: descarta lo guardado antes de comprobar las huellas de las librerías externas
const LEGACY_CACHE = 'almacen-v2';
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

const PRECACHE_CRITICOS = ['./index.html', '../shared/app.js'];

// Huellas SRI fijadas de las librerías externas: las mismas que el atributo integrity de index.html y las constantes PDFJS_* de app.js
// (si se cambia una versión hay que cambiarlas en los tres sitios). Solo se guarda en caché una respuesta cuyo cuerpo coincida;
// si no, se sirve desde la red sin guardarla, así una respuesta alterada nunca queda guardada para siempre.
const CDN_SRI = {
  'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js': 'sha384-3zSEDfvllQohrq0PHL1fOXJuC/jSOO34H46t6UQfobFOmxE5BpjjaIJY5F2/bMnU',
  'https://cdnjs.cloudflare.com/ajax/libs/html5-qrcode/2.3.8/html5-qrcode.min.js': 'sha384-c9d8RFSL+u3exBOJ4Yp3HUJXS4znl9f+z66d1y54ig+ea249SpqR+w1wyvXz/lk+',
  'https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js': 'sha384-Pqp51FUN2/qzfxZxBCtF0stpc9ONI6MYZpVqmo8m20SoaQCzf+arZvACkLkirlPz',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js': 'sha384-JcnsjUPPylna1s1fvi1u12X5qjY5OL56iySh75FdtrwhO/SWXgMjoVqcKyIIWOLk',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js': 'sha384-fCAW/rDWORTbQXSiB7mOg0QtQ5c+r0f544y6XoKjuVva0nMBlCpNUjiFeG5iMdS3',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js': 'sha384-GFr3yTh5lJznCbZfpTtXnwboFsxqtTQoeTZCRHhE0579KrRmlCzen5AA8ohaB5ug',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js': 'sha384-/1qUCSGwTur9vjf/z9lmu/eCUYbpOTgSjmpbMQZ1/CtX2v/WcAIKqRv+U1DUCG6e',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js': 'sha384-SnzOobpRMLXZ52iJvZm/C0fYw0OQemTXzTjIsdsfMcrCtCEe9qgzxTd3RSklO5x2'
};

// ¿El cuerpo de la respuesta (se lee: pasar una copia) coincide con la huella fijada de esa URL? Sin huella conocida o sin poder calcularla: no.
async function huellaCoincide(res, url) {
  const esperada = CDN_SRI[url];
  if (!esperada || typeof crypto === 'undefined' || !crypto.subtle) return false;
  try {
    const h = new Uint8Array(await crypto.subtle.digest('SHA-384', await res.arrayBuffer()));
    let s = '';
    for (const b of h) s += String.fromCharCode(b);
    return 'sha384-' + btoa(s) === esperada;
  } catch (e) {
    return false;
  }
}

// Precarga de una librería externa: solo se guarda si la huella coincide (si no, falla y queda constancia en la consola)
async function guardarVerificada(cache, url) {
  const res = await fetch(url, { cache: 'reload' });
  if (!res.ok || res.status !== 200) throw new Error('HTTP ' + res.status);
  if (!(await huellaCoincide(res.clone(), url))) throw new Error('la huella no coincide con la fijada');
  await cache.put(url, res);
}

self.addEventListener('install', (event) => {
  // Un fichero secundario (librerías, iconos) que falle no impide instalar, pero se deja constancia en la consola.
  // Si faltan la página (index.html) o la app (app.js) la instalación FALLA: así no se activa una versión que luego no abre sin conexión
  // y el service worker anterior (si lo hay) sigue funcionando.
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.allSettled(PRECACHE_URLS.map((u) => (u.startsWith('http') ? guardarVerificada(cache, u) : cache.add(new Request(u, { cache: 'reload' })))))
    ).then((resultados) => {
      const fallidos = PRECACHE_URLS.filter((u, i) => resultados[i].status === 'rejected');
      if (fallidos.length) console.warn('SW: no se pudieron guardar para uso sin conexión:', fallidos.join(', '));
      const criticos = fallidos.filter((u) => PRECACHE_CRITICOS.includes(u));
      if (criticos.length) throw new Error('SW: faltan ficheros imprescindibles: ' + criticos.join(', '));
    })
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

  // Librerías externas: primero la copia guardada (las versiones no cambian). Lo que viene de la red solo se guarda si su huella coincide
  // con la fijada (CDN_SRI); si no coincide o no se conoce, se entrega igualmente (la página aplica su propio SRI) pero no se guarda.
  if (CDN_HOSTS.includes(url.hostname)) {
    event.respondWith(
      caches.match(req, { cacheName: CACHE_NAME }).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok && res.status === 200) {
          const paraHuella = res.clone(), paraGuardar = res.clone(); // se clonan ya, antes de que la página lea la respuesta
          event.waitUntil(
            huellaCoincide(paraHuella, req.url)
              .then((ok) => (ok ? caches.open(CACHE_NAME).then((c) => c.put(req, paraGuardar)) : undefined))
              .catch((e) => console.warn('SW: no se pudo guardar en caché', req.url, e))
          );
        }
        return res;
      }))
    );
    return;
  }

  // Solo gestionamos peticiones de nuestro propio origen. Las llamadas a Supabase se dejan pasar tal cual.
  if (url.origin !== self.location.origin) return;

  const red = fetch(req, { cache: 'no-cache' });
  // La copia en caché se actualiza siempre, aunque la respuesta llegue tarde (el evento espera a este proceso).
  // Solo se guardan respuestas correctas completas (nunca errores 4xx/5xx ni parciales).
  const refresco = red.then((res) => {
    if (res.ok && res.status === 200) {
      const copia = res.clone(); // se clona enseguida, antes de que nadie lea la respuesta
      return caches.open(CACHE_NAME).then((c) => c.put(req, copia)).catch((e) => console.warn('SW: no se pudo guardar en caché (¿sin espacio?)', req.url, e));
    }
  }).catch(() => {}); // fallo de red: lo gestiona la respuesta de abajo
  event.waitUntil(refresco);
  red.catch(() => {}); // evita avisos si la red falla después de usar la copia guardada
  const limite = new Promise((resolve) => setTimeout(() => resolve(null), NETWORK_TIMEOUT_MS));

  event.respondWith((async () => {
    try {
      const res = await Promise.race([red, limite]);
      if (res) return res;
      const hit = await caches.match(req, { ignoreSearch: true, cacheName: CACHE_NAME });
      if (hit) return hit;
      return await red;
    } catch (e) {
      const hit = await caches.match(req, { ignoreSearch: true, cacheName: CACHE_NAME });
      if (hit) return hit;
      if (req.mode === 'navigate') {
        const shell = await caches.match('./index.html', { ignoreSearch: true, cacheName: CACHE_NAME });
        if (shell) return shell;
      }
      return new Response('Sin conexión', { status: 503, statusText: 'Sin conexión' });
    }
  })());
});
