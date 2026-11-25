/* ============================================================
   EnRuta Delivery - Service Worker (app instalable)
   ------------------------------------------------------------
   Guarda el armazón del sitio para que abra rápido y muestre algo
   aunque la conexión falle. Los datos del catálogo y las imágenes
   se piden primero a la red y, si no hay, se usa la copia guardada.
   ============================================================ */

const VERSION = 'enruta-v36';
const ARMAZON = [
  '/',
  '/index.html',
  '/css/styles.css?v=46',
  '/js/arranque.js?v=40',
  '/js/app.js?v=40',
  '/js/catalogo.js',
  '/assets/marca.jpg',
  '/assets/app/icono-192.png?v=2',
  '/assets/app/icono-512.png?v=2',
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

  // Páginas: red primero (para que los cambios salgan al instante),
  // copia guardada solo si no hay conexión.
  evento.respondWith(
    fetch(peticion)
      .then((respuesta) => {
        if (respuesta.ok && (peticion.mode === 'navigate' || url.pathname === '/index.html')) {
          const copia = respuesta.clone();
          caches.open(VERSION).then((cache) => cache.put('/index.html', copia));
        }
        return respuesta;
      })
      .catch(() => caches.match(peticion).then((guardada) => guardada || caches.match('/index.html')))
  );
});

// Notificaciones de promociones: solo llegan a quien activó las alertas.
self.addEventListener('push', (evento) => {
  let datos = {};
  try { datos = evento.data ? evento.data.json() : {}; } catch (e) {
    datos = { body: evento.data ? evento.data.text() : '' };
  }
  const titulo = String(datos.title || 'Novedades de EnRuta');
  const opciones = {
    body: String(datos.body || 'Mira las promos de hoy en EnRuta Delivery.'),
    icon: datos.icon || '/assets/app/icono-192.png',
    badge: datos.badge || '/assets/app/icono-192.png',
    tag: 'enruta-promociones',
    renotify: false,
    data: { url: datos.url || '/' }
  };
  evento.waitUntil(self.registration.showNotification(titulo, opciones));
});

self.addEventListener('notificationclick', (evento) => {
  evento.notification.close();
  const destino = new URL(evento.notification.data && evento.notification.data.url || '/', self.location.origin).href;
  evento.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then((ventanas) => {
    for (const ventana of ventanas) {
      if (ventana.url.startsWith(self.location.origin) && 'focus' in ventana) {
        ventana.navigate(destino);
        return ventana.focus();
      }
    }
    return clients.openWindow(destino);
  }));
});
