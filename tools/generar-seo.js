'use strict';
/* ============================================================
   EnRuta Delivery · Generador de SEO
   ------------------------------------------------------------
   Crea en dist/:
   - local/<id>.html  una página por local con su carta y precios
   - locales.html     directorio de todos los locales
   - sitemap.xml      con la home y todas las fichas
   Y agrega datos estructurados (JSON-LD) a la home para Google.
   ============================================================ */

const fs = require('fs');
const path = require('path');

const BASE = 'https://enrutadelivery.com';
const GEO = { lat: -9.1219, lng: -78.5123 };

function esc(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}
function abs(p) {
  if (!p) return BASE + '/assets/marca.jpg';
  return /^https?:/i.test(p) ? p : BASE + (p.startsWith('/') ? '' : '/') + p;
}
function money(n) {
  const v = Number(n) || 0;
  return 'S/ ' + v.toFixed(2);
}
function hoyISO() {
  return new Date().toISOString().slice(0, 10);
}
function telefonoDigitos(config) {
  const n = String((config && config.whatsapp && config.whatsapp.numero) || '51922504223').replace(/\D/g, '');
  return n || '51922504223';
}
function enlaceWa(config, texto) {
  return 'https://wa.me/' + telefonoDigitos(config) + '?text=' + encodeURIComponent(texto);
}
function mapsLocal(nombre) {
  return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(nombre + ', Nuevo Chimbote, Áncash, Perú');
}

const ORDEN_GRUPOS = ['Entradas', 'Sopas y caldos', 'Platos de fondo', 'Pollo', 'Carnes', 'Mariscos', 'Pizzas y pastas', 'Postres', 'Bebidas'];

function gruposDe(productos) {
  const mapa = new Map();
  for (const p of productos || []) {
    const g = String(p.grupo || 'Carta').trim() || 'Carta';
    if (!mapa.has(g)) mapa.set(g, []);
    mapa.get(g).push(p);
  }
  const nombres = [...mapa.keys()].sort((a, b) => {
    const ia = ORDEN_GRUPOS.indexOf(a);
    const ib = ORDEN_GRUPOS.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  return nombres.map((n) => ({ nombre: n, productos: mapa.get(n) }));
}

function rangoPrecios(productos) {
  const precios = (productos || []).map((p) => Number(p.precio)).filter((n) => n > 0);
  if (!precios.length) return 'S/';
  return 'S/ ' + Math.min(...precios).toFixed(0) + ' - S/ ' + Math.max(...precios).toFixed(0);
}

function horarioSchema(horario) {
  const m = String(horario || '').match(/(\d{1,2}:\d{2}).*?(\d{1,2}:\d{2})/);
  if (!m) return undefined;
  return 'Mo-Su ' + m[1].padStart(5, '0') + '-' + m[2].padStart(5, '0');
}

const CSS = `
:root { --tinta:#17140c; --amarillo:#fdd303; --fondo:#f8f4ec; --linea:#eadfce; --suave:#6f6557; }
* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body { margin:0; background:var(--fondo); color:var(--tinta); font-family: system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif; line-height:1.5; }
a { color: inherit; }
img { max-width:100%; display:block; }
.top { position:sticky; top:0; z-index:5; background:rgba(17,17,17,.96); color:#fff; backdrop-filter: blur(8px); }
.top-in { max-width:980px; margin:auto; padding:10px 16px; display:flex; align-items:center; justify-content:space-between; gap:12px; }
.marca { display:flex; align-items:center; gap:9px; text-decoration:none; font-weight:900; letter-spacing:-.02em; }
.marca img { width:34px; height:34px; border-radius:9px; }
.marca span { color:#fff; }
.marca b { color:var(--amarillo); }
.top-wa { background:var(--amarillo); color:#17140c; text-decoration:none; font-weight:800; font-size:13px; padding:9px 14px; border-radius:999px; white-space:nowrap; }
main { max-width:980px; margin:auto; padding:0 16px 40px; }
.hero { position:relative; margin:16px 0 14px; border-radius:20px; overflow:hidden; background:#222; min-height:240px; box-shadow:0 18px 40px rgba(35,28,16,.18); }
.hero > img { width:100%; height:100%; min-height:240px; max-height:380px; object-fit:cover; position:absolute; inset:0; }
.hero::after { content:""; position:absolute; inset:0; background:linear-gradient(180deg, rgba(0,0,0,.05) 20%, rgba(0,0,0,.82) 100%); }
.hero-txt { position:relative; z-index:1; padding:24px 18px; margin-top:130px; color:#fff; }
.kicker { display:inline-block; background:var(--amarillo); color:#17140c; font-size:11px; font-weight:900; letter-spacing:.1em; text-transform:uppercase; padding:4px 9px; border-radius:999px; }
h1 { margin:8px 0 4px; font-size:clamp(28px, 6vw, 42px); line-height:1.05; letter-spacing:-.03em; }
.hero-txt p { margin:0; opacity:.9; font-size:14px; max-width:640px; }
.meta { display:flex; flex-wrap:wrap; gap:8px 16px; margin-top:12px; font-size:13px; font-weight:600; }
.acciones { display:flex; flex-wrap:wrap; gap:9px; margin:16px 0 24px; }
.btn { display:inline-flex; align-items:center; justify-content:center; gap:7px; min-height:46px; padding:0 20px; border-radius:999px; font-weight:800; font-size:14px; text-decoration:none; }
.btn-wa { background:#1faa53; color:#fff; }
.btn-brand { background:var(--amarillo); color:#17140c; }
.btn-ghost { background:#fff; border:1px solid var(--linea); color:var(--tinta); }
h2 { font-size:clamp(21px, 4.4vw, 27px); letter-spacing:-.03em; margin:26px 0 4px; }
.sub { color:var(--suave); font-size:13.5px; margin:0 0 14px; }
.grupo { background:#fff; border:1px solid var(--linea); border-radius:16px; padding:4px 16px 8px; margin:12px 0; box-shadow:0 8px 20px rgba(35,28,16,.05); }
.grupo h3 { display:flex; align-items:center; gap:8px; margin:0; padding:12px 0 8px; font-size:12px; letter-spacing:.07em; text-transform:uppercase; color:#6b5a2e; border-bottom:1px solid var(--linea); }
.grupo h3 small { margin-left:auto; color:var(--suave); font-size:11px; font-weight:700; letter-spacing:0; text-transform:none; }
.grupo ul { list-style:none; margin:0; padding:0; }
.grupo li { display:flex; align-items:baseline; gap:12px; padding:9px 0; border-bottom:1px dashed #eee1d3; font-size:14px; }
.grupo li:last-child { border-bottom:0; }
.grupo li span { flex:1; min-width:0; }
.grupo li b { white-space:nowrap; font-size:14.5px; }
.carta-link { display:inline-block; margin:10px 0; color:#7a5f00; font-weight:700; }
.pie { max-width:980px; margin:auto; padding:20px 16px 40px; color:var(--suave); font-size:12.5px; }
.pie a { color:#6b5a2e; }
.grid { display:grid; grid-template-columns:repeat(2, minmax(0,1fr)); gap:12px; }
@media (min-width:720px) { .grid { grid-template-columns:repeat(3, minmax(0,1fr)); } }
.card { background:#fff; border:1px solid var(--linea); border-radius:16px; overflow:hidden; text-decoration:none; box-shadow:0 8px 20px rgba(35,28,16,.06); transition:transform .2s ease, box-shadow .2s ease; }
.card:hover { transform:translateY(-3px); box-shadow:0 16px 32px rgba(35,28,16,.14); }
.card-img { height:120px; background:#efe7da; }
.card-img img { width:100%; height:100%; object-fit:cover; }
.card-txt { padding:10px 11px 12px; }
.card-txt b { display:block; font-size:14px; line-height:1.2; }
.card-txt small { display:block; margin-top:3px; color:var(--suave); font-size:11.5px; }
.volver { display:inline-block; margin-top:16px; font-size:13px; font-weight:700; color:#7a5f00; }
@media (max-width:520px) { .hero-txt { margin-top:110px; } .top-wa span { display:none; } }
`;

function head({ titulo, descripcion, url, imagen, tipo = 'website' }) {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(titulo)}</title>
<meta name="description" content="${esc(descripcion)}">
<meta name="robots" content="index, follow">
<link rel="canonical" href="${esc(url)}">
<meta property="og:type" content="${esc(tipo)}">
<meta property="og:site_name" content="EnRuta Delivery">
<meta property="og:title" content="${esc(titulo)}">
<meta property="og:description" content="${esc(descripcion)}">
<meta property="og:url" content="${esc(url)}">
<meta property="og:image" content="${esc(imagen)}">
<meta property="og:locale" content="es_PE">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#111111">
<link rel="icon" type="image/jpeg" href="/assets/marca.jpg">
<link rel="apple-touch-icon" href="/assets/app/icono-192.png">
<style>${CSS}</style>
</head>`;
}

function cabecera(config) {
  return `<header class="top"><div class="top-in">
  <a class="marca" href="/"><img src="/assets/marca.jpg" alt="EnRuta Delivery"><span>EnRuta <b>Delivery</b></span></a>
  <a class="top-wa" href="${esc(enlaceWa(config, 'Hola, quiero hacer un pedido por EnRuta Delivery.'))}" target="_blank" rel="noopener">WhatsApp <span>922 504 223</span></a>
</div></header>`;
}

function paginaLocal(local, config) {
  const url = BASE + '/local/' + local.id + '.html';
  const imagen = abs(local.portada);
  const categoria = local.categoriaNombre || 'Local';
  const descripcion = (local.descripcion || '') + ' Carta con precios y pedido por WhatsApp en Nuevo Chimbote.';
  const grupos = gruposDe(local.productos);
  const wa = enlaceWa(config, 'Hola, quiero pedir en ' + local.nombre + ' (EnRuta Delivery).');
  const telefono = local.telefono || '';
  const direccion = local.direccion || 'Nuevo Chimbote';

  const menuHtml = grupos.map((g) => `
    <section class="grupo">
      <h3>${esc(g.nombre)} <small>${g.productos.length}</small></h3>
      <ul>${g.productos.map((p) => `<li><span>${esc(p.nombre)}</span><b>${money(p.precio)}</b></li>`).join('')}</ul>
    </section>`).join('');

  const menuSchema = grupos.map((g) => ({
    '@type': 'MenuSection',
    name: g.nombre,
    hasMenuItem: g.productos.map((p) => ({
      '@type': 'MenuItem',
      name: p.nombre,
      offers: { '@type': 'Offer', price: Number(p.precio).toFixed(2), priceCurrency: 'PEN' }
    }))
  }));

  const schema = {
    '@context': 'https://schema.org',
    '@type': 'Restaurant',
    '@id': url + '#restaurante',
    name: local.nombre,
    image: [imagen],
    url,
    telephone: telefono || '+51 922 504 223',
    servesCuisine: categoria,
    priceRange: rangoPrecios(local.productos),
    address: {
      '@type': 'PostalAddress',
      streetAddress: direccion,
      addressLocality: 'Nuevo Chimbote',
      addressRegion: 'Áncash',
      addressCountry: 'PE'
    },
    geo: { '@type': 'GeoCoordinates', latitude: GEO.lat, longitude: GEO.lng },
    hasMap: mapsLocal(local.nombre),
    openingHours: horarioSchema(local.horarioLocal),
    hasMenu: { '@type': 'Menu', hasMenuSection: menuSchema },
    acceptsReservations: 'False',
    potentialAction: {
      '@type': 'OrderAction',
      target: wa,
      deliveryMethod: 'http://purl.org/goodrelations/v1#DeliveryModeOwnFleet'
    }
  };

  return `${head({
    titulo: local.nombre + ' · Carta y delivery en Nuevo Chimbote | EnRuta Delivery',
    descripcion,
    url,
    imagen,
    tipo: 'restaurant.restaurant'
  })}
<body>
${cabecera(config)}
<main>
  <div class="hero">
    <img src="${esc(imagen)}" alt="${esc(local.nombre)}" fetchpriority="high">
    <div class="hero-txt">
      <span class="kicker">${esc(categoria)}</span>
      <h1>${esc(local.nombre)}</h1>
      <p>${esc(local.descripcion || 'Carta completa con precios en Nuevo Chimbote.')}</p>
      <div class="meta">
        ${local.tiempo ? `<span>⏱ ${esc(local.tiempo)}</span>` : ''}
        <span>📍 ${esc(direccion)}</span>
        ${local.horarioLocal ? `<span>🕒 ${esc(local.horarioLocal)}</span>` : ''}
      </div>
    </div>
  </div>

  <div class="acciones">
    <a class="btn btn-wa" href="${esc(wa)}" target="_blank" rel="noopener">Pedir por WhatsApp</a>
    <a class="btn btn-brand" href="/?local=${encodeURIComponent(local.id)}">Ver en la app</a>
    <a class="btn btn-ghost" href="${esc(mapsLocal(local.nombre))}" target="_blank" rel="noopener">Cómo llegar</a>
  </div>

  <h2>Menú y precios</h2>
  <p class="sub">${(local.productos || []).length} platos y bebidas. Los precios son los publicados por el local y pueden cambiar.</p>
  ${menuHtml || '<p class="sub">Este local todavía no tiene su carta cargada.</p>'}
  ${local.cartaOriginal ? `<a class="carta-link" href="${esc(abs(local.cartaOriginal))}" target="_blank" rel="noopener">Ver carta original (imagen)</a>` : ''}
  <a class="volver" href="/locales.html">← Ver todos los locales</a>
</main>
<footer class="pie">
  <p><a href="/">EnRuta Delivery</a> · <a href="/locales.html">Directorio de locales</a> · <a href="/privacidad.html">Privacidad</a></p>
  <p>Delivery en Nuevo Chimbote, Áncash. Los precios, la disponibilidad y el costo de envío se confirman por WhatsApp.</p>
</footer>
<script type="application/ld+json">${JSON.stringify(schema).replace(/</g, '\\u003c')}</script>
</body>
</html>`;
}

function paginaDirectorio(locales, config) {
  const url = BASE + '/locales.html';
  const descripcion = 'Directorio de restaurantes, licorerías y tiendas con delivery en Nuevo Chimbote. Cartas, precios y pedido por WhatsApp.';
  const tarjetas = locales.map((l) => `
    <a class="card" href="/local/${encodeURIComponent(l.id)}.html">
      <div class="card-img"><img src="${esc(abs(l.portada))}" alt="${esc(l.nombre)}" loading="lazy" decoding="async"></div>
      <div class="card-txt"><b>${esc(l.nombre)}</b><small>${esc(l.categoriaNombre || 'Local')}${l.tiempo ? ' · ' + esc(l.tiempo) : ''}</small></div>
    </a>`).join('');

  const schema = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: 'Locales con delivery en Nuevo Chimbote',
    numberOfItems: locales.length,
    itemListElement: locales.map((l, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: l.nombre,
      url: BASE + '/local/' + l.id + '.html'
    }))
  };

  return `${head({
    titulo: 'Locales con delivery en Nuevo Chimbote | EnRuta Delivery',
    descripcion,
    url,
    imagen: BASE + '/assets/marca.jpg'
  })}
<body>
${cabecera(config)}
<main>
  <h1 style="margin-top:22px">Locales en Nuevo Chimbote</h1>
  <p class="sub">${locales.length} restaurantes, licorerías y tiendas. Entra a la ficha de cada local para ver su carta y precios.</p>
  <div class="grid">${tarjetas}</div>
  <a class="volver" href="/">← Volver a EnRuta Delivery</a>
</main>
<footer class="pie">
  <p><a href="/">EnRuta Delivery</a> · <a href="/privacidad.html">Privacidad</a></p>
  <p>Delivery en Nuevo Chimbote, Áncash.</p>
</footer>
<script type="application/ld+json">${JSON.stringify(schema).replace(/</g, '\\u003c')}</script>
</body>
</html>`;
}

function sitemap(locales) {
  const hoy = hoyISO();
  const urls = [
    { loc: BASE + '/', p: '1.0', f: 'daily' },
    { loc: BASE + '/locales.html', p: '0.9', f: 'daily' },
    ...locales.map((l) => ({ loc: BASE + '/local/' + l.id + '.html', p: '0.8', f: 'weekly' })),
    { loc: BASE + '/privacidad.html', p: '0.2', f: 'yearly' }
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url>
    <loc>${esc(u.loc)}</loc>
    <lastmod>${hoy}</lastmod>
    <changefreq>${u.f}</changefreq>
    <priority>${u.p}</priority>
  </url>`).join('\n')}
</urlset>
`;
}

function jsonLdHome(locales, config) {
  const redes = (config && config.redes) || {};
  const sameAs = [redes.tiktok && redes.tiktok.url, redes.instagram && redes.instagram.url].filter(Boolean);
  const negocio = {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    '@id': BASE + '/#negocio',
    name: 'EnRuta Delivery',
    description: 'Delivery de comida, licores y primera necesidad en Nuevo Chimbote. Pedidos por WhatsApp.',
    url: BASE + '/',
    image: BASE + '/assets/marca.jpg',
    logo: BASE + '/assets/marca.jpg',
    telephone: '+51 922 504 223',
    email: (config && config.email) || 'enrutadelivery@gmail.com',
    priceRange: 'S/',
    currenciesAccepted: 'PEN',
    paymentAccepted: 'Efectivo, Yape, Plin',
    address: {
      '@type': 'PostalAddress',
      addressLocality: 'Nuevo Chimbote',
      addressRegion: 'Áncash',
      addressCountry: 'PE'
    },
    geo: { '@type': 'GeoCoordinates', latitude: GEO.lat, longitude: GEO.lng },
    hasMap: 'https://www.google.com/maps/search/?api=1&query=EnRuta+Delivery+Nuevo+Chimbote',
    areaServed: { '@type': 'City', name: 'Nuevo Chimbote' },
    openingHoursSpecification: [{
      '@type': 'OpeningHoursSpecification',
      dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
      opens: '08:00',
      closes: '23:00'
    }],
    sameAs
  };
  const sitio = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    '@id': BASE + '/#web',
    url: BASE + '/',
    name: 'EnRuta Delivery',
    inLanguage: 'es-PE',
    publisher: { '@id': BASE + '/#negocio' }
  };
  const lista = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: 'Locales con delivery en Nuevo Chimbote',
    numberOfItems: locales.length,
    itemListElement: locales.map((l, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: l.nombre,
      url: BASE + '/local/' + l.id + '.html'
    }))
  };
  return [negocio, sitio, lista]
    .map((o) => `<script type="application/ld+json">${JSON.stringify(o).replace(/</g, '\\u003c')}</script>`)
    .join('\n');
}

async function obtenerCatalogo() {
  const urls = [BASE + '/api/catalogo?build=' + Date.now(), BASE + '/api/catalogo'];
  for (const url of urls) {
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json' }, cache: 'no-store' });
      if (!res.ok) continue;
      const datos = await res.json();
      if (datos && Array.isArray(datos.locales)) return datos;
    } catch (e) { /* sin red: se omite el SEO de locales */ }
  }
  return null;
}

async function generarSeo(DIST) {
  const datos = await obtenerCatalogo();
  if (!datos) return { ok: false, locales: 0 };

  const config = datos.config || {};
  const locales = (datos.locales || [])
    .filter((l) => l && l.id && l.publicado !== false && l.nombre)
    .sort((a, b) => String(a.nombre).localeCompare(String(b.nombre), 'es'));

  if (!locales.length) return { ok: false, locales: 0 };

  const dirLocal = path.join(DIST, 'local');
  fs.mkdirSync(dirLocal, { recursive: true });
  let escritos = 0;
  for (const local of locales) {
    const archivo = path.join(dirLocal, local.id + '.html');
    fs.writeFileSync(archivo, paginaLocal(local, config), 'utf8');
    escritos++;
  }

  fs.writeFileSync(path.join(DIST, 'locales.html'), paginaDirectorio(locales, config), 'utf8');
  fs.writeFileSync(path.join(DIST, 'sitemap.xml'), sitemap(locales), 'utf8');

  // JSON-LD en la home.
  const rutaIndex = path.join(DIST, 'index.html');
  if (fs.existsSync(rutaIndex)) {
    let html = fs.readFileSync(rutaIndex, 'utf8');
    const bloque = '\n  ' + jsonLdHome(locales, config) + '\n';
    if (html.includes('</head>')) {
      html = html.replace('</head>', bloque + '</head>');
      fs.writeFileSync(rutaIndex, html, 'utf8');
    }
  }

  return { ok: true, locales: escritos };
}

module.exports = { generarSeo };
