/* ============================================================
   EnRuta Delivery - Arranque del sitio pÃºblico
   ------------------------------------------------------------
   Carga el catÃ¡logo desde /api/catalogo (D1 en Cloudflare) y,
   si falla, usa js/catalogo.js como respaldo. DespuÃ©s carga los
   scripts de la pÃ¡gina en el mismo orden de siempre.
   ============================================================ */

(function () {
  'use strict';

  var VERSION = '12';
  var SIGUIENTES = [
    'js/locales-prueba.js',
    'js/google-config.js',
    'js/google.js',
    'js/app.js'
  ];

  function cargar(src) {
    return new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      script.src = src + (src.indexOf('?') >= 0 ? '&' : '?') + 'v=' + VERSION;
      script.onload = function () { resolve(); };
      script.onerror = function () { reject(new Error('No se pudo cargar ' + src)); };
      document.head.appendChild(script);
    });
  }

  async function obtenerDatos() {
    try {
      var respuesta = await fetch('/api/catalogo', {
        headers: { Accept: 'application/json' },
        cache: 'no-store'
      });
      if (!respuesta.ok) throw new Error('HTTP ' + respuesta.status);
      var datos = await respuesta.json();
      if (!datos || !datos.config) throw new Error('CatÃ¡logo vacÃ­o');
      return datos;
    } catch (error) {
      console.warn('CatÃ¡logo en vivo no disponible; se usa el respaldo local.', error);
      await cargar('js/catalogo.js');
      return window.ENRUTA_DATA || null;
    }
  }

  (async function () {
    var datos = await obtenerDatos();
    if (datos) window.ENRUTA_DATA = datos;

    for (var i = 0; i < SIGUIENTES.length; i++) {
      try {
        await cargar(SIGUIENTES[i]);
      } catch (error) {
        console.error(error);
      }
    }
  })();
})();
