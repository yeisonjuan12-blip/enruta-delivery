/* ============================================================
   EnRuta Delivery - Service Worker (app instalable)
   ------------------------------------------------------------
   Guarda el armazón del sitio para que abra rápido y muestre algo
   aunque la conexión falle. Los datos del catálogo y las imágenes
   se piden primero a la red y, si no hay, se usa la copia guardada.
   ============================================================ */

const VERSION = 'enruta-v6';
const ARMAZON = [
  '/',
  '/index.html',
  '/css/styles.css?v=24',
  '/js/arranque.js?v=18',
  '/js/app.js?v=16',
  '/js/catalogo.js',
  '/assets/marca.jpg',
  '/assets/app/icono-192.png',
  '/assets/app/icono-512.png',
  '/manifest.webmanifest'
];

self.addEventListener('install', (evento) => {
  evento.waitUntil(
    caches.open(VERSION).then((cache) => cache.addAll(ARMAZON).catch(() => undefined)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    caches.keys().then((claves) => Promise.all(claves.filter((c) => c !== VERSION).map((c) => caches.delete(c)))).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (evento) => {
  const peticion = evento.request;
  if (peticion.method !== 'GET') return;
  const url = new URL(peticion.url);
  if (url.origin !== self.location.origin) return;

  // Datos: red primero, copia guardada si falla.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/media/') || url.pathname.startsWith('/data/')) {
    evento.respondWith(
      fetch(peticion)
        .then((respuesta) => {
          if (respuesta.ok) {
            const copia = respuesta.clone();
            caches.open(VERSION).then((cache) => cache.put(peticion, copia));
          }
          return respuesta;
        })
        .catch(() => caches.match(peticion))
    );
    return;
  }

  // Páginas y archivos: copia guardada primero, red después.
  evento.respondWith(
    caches.match(peticion).then((guardada) => {
      if (guardada) return guardada;
      return fetch(peticion)
        .then((respuesta) => {
          if (respuesta.ok) {
            const copia = respuesta.clone();
            caches.open(VERSION).then((cache) => cache.put(peticion, copia));
          }
          return respuesta;
        })
        .catch(() => {
          if (peticion.mode === 'navigate') return caches.match('/index.html');
          return new Response('', { status: 504 });
        });
    })
  );
});
