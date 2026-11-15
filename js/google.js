/* ============================================================
   ENRUTA DELIVERY · Google Analytics + AdSense + consentimiento
   ------------------------------------------------------------
   No edites este archivo. Configura tus IDs en js/google-config.js
   ============================================================ */

(function () {
  'use strict';

  var CFG = window.ENRUTA_GOOGLE || {};
  var CLAVE = 'enruta.consent.v1';
  var esHttp = /^https?:$/.test(window.location.protocol);

  var GA_ID = String(CFG.ga4 || '').trim();
  var ADS_ID = String(CFG.adsense || '').trim();
  var SLOTS = CFG.slots || {};

  var gaValido = /^G-[A-Z0-9]{6,}$/i.test(GA_ID);
  var adsValido = /^ca-pub-\d{10,}$/i.test(ADS_ID);

  var cargado = { ga: false, ads: false };
  var estado = { analytics: false, ads: false };

  /* ---------------- Consent Mode (por defecto denegado) ---------------- */
  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };
  window.gtag('consent', 'default', {
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
    analytics_storage: 'denied',
    functionality_storage: 'granted',
    security_storage: 'granted'
  });
  window.gtag('set', 'ads_data_redaction', true);

  /* ---------------- Utilidades ---------------- */
  function leerConsentimiento() {
    try {
      var raw = JSON.parse(localStorage.getItem(CLAVE) || 'null');
      if (raw && typeof raw === 'object') {
        return {
          analytics: raw.analytics === true,
          ads: raw.ads === true
        };
      }
    } catch (e) { /* almacenamiento no disponible */ }
    return null;
  }

  function guardarConsentimiento(c) {
    estado = { analytics: !!c.analytics, ads: !!c.ads };
    try {
      localStorage.setItem(CLAVE, JSON.stringify({
        v: 1,
        analytics: estado.analytics,
        ads: estado.ads,
        fecha: new Date().toISOString()
      }));
    } catch (e) { /* almacenamiento no disponible */ }

    window.gtag('consent', 'update', {
      ad_storage: estado.ads ? 'granted' : 'denied',
      ad_user_data: estado.ads ? 'granted' : 'denied',
      ad_personalization: estado.ads ? 'granted' : 'denied',
      analytics_storage: estado.analytics ? 'granted' : 'denied'
    });

    if (estado.analytics) cargarAnalytics();
    if (estado.ads) cargarAdsense();
  }

  /* ---------------- Google Analytics (GA4) ---------------- */
  function cargarAnalytics() {
    if (!esHttp || !gaValido || !estado.analytics || cargado.ga) return;
    cargado.ga = true;
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(GA_ID);
    document.head.appendChild(s);
    window.gtag('js', new Date());
    window.gtag('config', GA_ID, {
      anonymize_ip: true,
      send_page_view: true
    });
  }

  /* ---------------- Google AdSense ---------------- */
  function cargarAdsense() {
    if (!esHttp || !adsValido || !estado.ads || cargado.ads) return;
    cargado.ads = true;

    var meta = document.createElement('meta');
    meta.name = 'google-adsense-account';
    meta.content = ADS_ID;
    document.head.appendChild(meta);

    var s = document.createElement('script');
    s.async = true;
    s.crossOrigin = 'anonymous';
    s.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=' + encodeURIComponent(ADS_ID);
    s.addEventListener('load', activarBloques);
    document.head.appendChild(s);

    if (document.readyState === 'complete') activarBloques();
    else window.addEventListener('load', activarBloques);
    setTimeout(activarBloques, 2500);
  }

  function activarBloques() {
    if (!estado.ads || !adsValido) return;
    var bloques = document.querySelectorAll('ins.adsbygoogle[data-slot-key]');
    Array.prototype.forEach.call(bloques, function (ins) {
      var clave = ins.getAttribute('data-slot-key');
      var slot = String(SLOTS[clave] || '').trim();
      if (!slot || ins.getAttribute('data-ad-status') === 'done') return;
      ins.setAttribute('data-ad-client', ADS_ID);
      ins.setAttribute('data-ad-slot', slot);
      var contenedor = ins.closest ? ins.closest('.ad-wrap') : null;
      if (contenedor) contenedor.hidden = false;
      try {
        (window.adsbygoogle = window.adsbygoogle || []).push({});
      } catch (e) { /* AdSense todavía no listo */ }
    });
  }

  /* ---------------- Eventos de la tienda ---------------- */
  window.enrutaTrack = function (nombre, params) {
    if (!estado.analytics) return;
    try {
      window.gtag('event', String(nombre), params || {});
    } catch (e) { /* sin Analytics */ }
  };

  /* ---------------- Aviso de cookies ---------------- */
  var banner = null;

  function crearBanner() {
    if (banner) return banner;
    banner = document.createElement('div');
    banner.className = 'cookie-banner';
    banner.id = 'cookieBanner';
    banner.setAttribute('role', 'dialog');
    banner.setAttribute('aria-live', 'polite');
    banner.setAttribute('aria-label', 'Aviso de cookies y publicidad');
    banner.innerHTML =
      '<div class="cookie-inner">' +
        '<div class="cookie-text">' +
          '<strong>Cookies y publicidad</strong>' +
          '<p>Usamos almacenamiento propio para recordar tu carrito y tus datos de entrega. ' +
          'Si lo aceptas, también usamos cookies de Google para medir visitas y mostrar anuncios. ' +
          'Puedes cambiar tu elección cuando quieras.</p>' +
          '<a class="cookie-more" href="privacidad.html#cookies">Más información</a>' +
        '</div>' +
        '<div class="cookie-actions">' +
          '<button type="button" class="btn btn-brand" data-cookie="todo">Aceptar todo</button>' +
          '<button type="button" class="btn btn-ghost" data-cookie="necesarias">Solo necesarias</button>' +
          '<button type="button" class="link-mini" data-cookie="elegir" aria-expanded="false">Elegir</button>' +
        '</div>' +
        '<div class="cookie-config" hidden>' +
          '<label><input type="checkbox" data-cookie="analytics"> Estadísticas (Google Analytics)</label>' +
          '<label><input type="checkbox" data-cookie="ads"> Publicidad (Google AdSense)</label>' +
          '<button type="button" class="btn btn-brand btn-sm" data-cookie="guardar">Guardar selección</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(banner);

    banner.addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('[data-cookie]') : null;
      if (!btn) return;
      var accion = btn.getAttribute('data-cookie');
      if (accion === 'todo') cerrarBanner(guardarConsentimiento({ analytics: true, ads: true }));
      else if (accion === 'necesarias') cerrarBanner(guardarConsentimiento({ analytics: false, ads: false }));
      else if (accion === 'elegir') {
        var panel = banner.querySelector('.cookie-config');
        var abrir = panel.hidden;
        panel.hidden = !abrir;
        btn.setAttribute('aria-expanded', abrir ? 'true' : 'false');
      } else if (accion === 'guardar') {
        var a = banner.querySelector('[data-cookie="analytics"]');
        var p = banner.querySelector('[data-cookie="ads"]');
        cerrarBanner(guardarConsentimiento({ analytics: !!(a && a.checked), ads: !!(p && p.checked) }));
      }
    });

    return banner;
  }

  function cerrarBanner() {
    if (!banner) return;
    banner.classList.add('is-closing');
    setTimeout(function () {
      if (banner && banner.parentNode) banner.parentNode.removeChild(banner);
      banner = null;
    }, 260);
  }

  function mostrarBanner() {
    var b = crearBanner();
    b.hidden = false;
    b.classList.remove('is-closing');
    var actual = leerConsentimiento();
    if (actual) {
      var a = b.querySelector('[data-cookie="analytics"]');
      var p = b.querySelector('[data-cookie="ads"]');
      if (a) a.checked = actual.analytics;
      if (p) p.checked = actual.ads;
    }
    var primero = b.querySelector('[data-cookie="todo"]');
    if (primero) primero.focus();
  }

  window.enrutaCookies = {
    abrir: mostrarBanner,
    estado: function () { return { analytics: estado.analytics, ads: estado.ads }; }
  };

  document.addEventListener('click', function (e) {
    var abrir = e.target.closest ? e.target.closest('[data-cookie-open]') : null;
    if (!abrir) return;
    e.preventDefault();
    mostrarBanner();
  });

  /* ---------------- Arranque ---------------- */
  function iniciar() {
    var guardado = leerConsentimiento();
    if (guardado) {
      guardarConsentimiento(guardado);
      return;
    }
    if (CFG.avisoCookies === false) {
      guardarConsentimiento({ analytics: true, ads: true });
      return;
    }
    mostrarBanner();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', iniciar);
  } else {
    iniciar();
  }
})();
