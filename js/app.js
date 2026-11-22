/* ============================================================
   ENRUTA DELIVERY · Lógica de la página
   ------------------------------------------------------------
   Los datos vienen de js/catalogo.js (generado por
   tools/importar.ps1 a partir de data/*.json).
   No edites este archivo para cambiar precios o productos.
   ============================================================ */

(function () {
  'use strict';

  const DATA = window.ENRUTA_DATA;

  if (!DATA) {
    document.body.insertAdjacentHTML('afterbegin',
      '<div style="padding:18px;background:#fee;color:#900;font:14px system-ui">' +
      'No se pudo cargar el catálogo. Ejecuta <b>tools\\importar.ps1</b> y vuelve a cargar la página.</div>');
    return;
  }

  /* ---------------- Utilidades ---------------- */
  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
  const nf = new Intl.NumberFormat('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const money = (n) => CONFIG.moneda + ' ' + nf.format(Number(n) || 0);
  const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const onlyDigits = (s) => String(s || '').replace(/\D/g, '');
  const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

  const CONFIG = DATA.config || {};
  const PRUEBA = window.ENRUTA_LOCALES_PRUEBA || { categorias: [], locales: [] };

  // Los locales ficticios de js/locales-prueba.js se fusionan solo para
  // mostrar la página. Para retirarlos, borra ese archivo y su <script>.
  const CATEGORIAS_LOCALES = (DATA.categoriasLocales || []).concat(PRUEBA.categorias || []);
  const LOCALES = (DATA.locales || []).concat(PRUEBA.locales || [])
    .filter((l) => l.publicado !== false)
    .map((l) => {
      if (l.categoriaNombre) return l;
      const cat = CATEGORIAS_LOCALES.find((c) => c.id === l.categoriaId);
      return Object.assign({}, l, { categoriaNombre: cat ? cat.nombre : '' });
    });
  const CATALOGOS = DATA.catalogos || [];
  const ZONAS = CONFIG.zonas || [];

  const localesPorId = new Map(LOCALES.map((l) => [l.id, l]));
  const catalogosPorId = new Map(CATALOGOS.map((c) => [c.id, c]));

  const waNumero = onlyDigits(CONFIG.whatsapp && CONFIG.whatsapp.numero);
  const waBase = 'https://wa.me/' + waNumero;
  const waLink = (texto) => waBase + '?text=' + encodeURIComponent(texto);
  const waSimple = (texto) => waLink(texto);

  const CART_KEY = 'enruta.cart.v1';
  const CLIENTE_KEY = 'enruta.cliente.v1';
  const CLIENTE_OPTOUT_KEY = 'enruta.cliente.optout';
  const MAX_QTY = 99;
  const MAX_DIRECCIONES = 8;

  const state = {
    tab: 'todo',
    catLocal: 'todo',
    zonaLocal: 'todo',
    marketTab: 'licores',
    resTab: 'locales',
    catCatalogos: {},
    q: '',
    cart: [],
    activeLocal: null,
    cliente: null,
    enviando: false,
    apiDisponible: true,
    apiComprobada: false,
    paso: 'productos',
    expandidos: {},
    servicioTipo: null,
    servicioFoco: null
  };
  CATALOGOS.forEach((c) => { state.catCatalogos[c.id] = 'todo'; });

  /* Catálogos: cuántos productos se muestran por categoría antes de "Ver más".
     En celular la grilla tiene 2 columnas, así que 6 productos son 3 filas. */
  const LIMITE_CATEGORIA = 8;
  function limiteCategoria() {
    return window.matchMedia('(max-width: 720px)').matches ? 6 : LIMITE_CATEGORIA;
  }

  /* Lista manual de más vendidos (orden de prioridad dentro de cada categoría).
     Cuando exista un contador real de ventas en el backend, este orden se
     reemplazará por las unidades vendidas que devuelva la API. */
  const DESTACADOS = {
    licores: [
      'lic-007', 'lic-004', 'lic-005', 'lic-001', 'lic-006', 'lic-008',
      'tambo-nNmZGZ3gQkozoRJ5R', 'tambo-5bxM4LCFLY7E69xqt',
      'tambo-KYWYwqsW4CDbrfHyY', 'tambo-HjJjtatprwZKJHsHb'
    ],
    'primera-necesidad': [
      'nec-001', 'nec-003', 'nec-004', 'nec-006', 'nec-005', 'nec-010',
      'nec-007', 'nec-008', 'nec-009', 'tambo-EvmNeKNwgAfLfAzEz',
      'tambo-9XTsKLd47m7frEXcj', 'tambo-7u4WyxnbRhEvvkGy8',
      'tambo-5JCamvwwcPtuShvrv', 'tambo-ze5B9yM3zJtXPzK3m',
      'tambo-QEfSa9KtSwCgBnJ7S'
    ]
  };
  const VENTAS_KEY = 'enruta.ventas.v1';

  // Envía eventos a Google Analytics solo si el visitante dio su consentimiento.
  function track(nombre, params) {
    try {
      if (window.enrutaTrack) window.enrutaTrack(nombre, params || {});
    } catch (e) { /* Analytics no disponible */ }
  }

  /* ---------------- Acceso a datos ---------------- */
  function color(v, fallback) {
    return /^#[0-9a-f]{3,8}$/i.test(String(v || '')) ? v : fallback;
  }

  function gradiente(local) {
    const c1 = color(local.colores && local.colores[0], '#fdd303');
    const c2 = color(local.colores && local.colores[1], '#f59e0b');
    return 'linear-gradient(135deg, ' + c1 + ', ' + c2 + ')';
  }

  function categoriaLocal(id) {
    const c = CATEGORIAS_LOCALES.find((x) => x.id === id);
    return c ? c.nombre : '';
  }

  function categoriaCatalogo(cat, id) {
    const c = (cat.categorias || []).find((x) => x.id === id);
    return c ? c.nombre : '';
  }

  function fechaCorta(iso) {
    if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '';
    const p = iso.split('-');
    return p[2] + '/' + p[1] + '/' + p[0];
  }

  function fechaHora(date) {
    return new Intl.DateTimeFormat('es-PE', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    }).format(date);
  }

  function coincide(texto) {
    const consulta = norm(state.q).trim();
    if (!consulta) return true;
    const contenido = norm(texto);
    // Coincide si todas las palabras buscadas aparecen, sin importar tildes
    // ni el orden (por ejemplo "pollo brasa" encuentra "Pollo a la brasa").
    return consulta.split(/\s+/).every((parte) => contenido.includes(parte));
  }

  function localCoincide(l) {
    if (!state.q) return true;
    return coincide([
      l.id,
      l.nombre,
      l.categoriaNombre,
      l.descripcion,
      (l.etiquetas || []).join(' '),
      (l.productos || []).map((p) => p.nombre + ' ' + (p.descripcion || '') + ' ' + (p.etiqueta || '')).join(' ')
    ].join(' '));
  }

  function productoCatalogoCoincide(cat, p) {
    return coincide([
      p.id, p.nombre, p.marca, p.presentacion,
      categoriaCatalogo(cat, p.categoriaId), p.descripcion, p.estado
    ].join(' '));
  }

  /* ---------------- Horario (incluye cruce de medianoche) ---------------- */
  function minutosDe(hora) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(hora || ''));
    if (!m) return null;
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (h > 23 || min > 59) return null;
    return h * 60 + min;
  }

  function zonaAbierta(zona, ahora) {
    const ahoraDate = ahora || new Date();
    if (!zona) return false;
    const abre = minutosDe(zona.apertura);
    const cierra = minutosDe(zona.cierre);
    if (abre == null || cierra == null || abre === cierra) return false;
    const minutos = ahoraDate.getHours() * 60 + ahoraDate.getMinutes();
    const hoy = ahoraDate.getDay();
    const ayer = (hoy + 6) % 7;
    const dias = (zona.dias || []).map(Number);

    if (abre < cierra) {
      return dias.includes(hoy) && minutos >= abre && minutos < cierra;
    }
    // Horario que cruza la medianoche (ej. 22:00 a 01:00).
    if (minutos >= abre && dias.includes(hoy)) return true;
    if (minutos < cierra && dias.includes(ayer)) return true;
    return false;
  }

  function zonaPrincipal() {
    return ZONAS.find((z) => z.id === CONFIG.zonaPrincipal) || ZONAS[0] || null;
  }

  /* ---------------- Carrito ---------------- */
  function variantesValidas(p) {
    return (Array.isArray(p && p.variantes) ? p.variantes : [])
      .filter((v) => v && v.nombre && Number(v.precio) > 0);
  }

  function extrasValidos(p) {
    return (Array.isArray(p && p.extras) ? p.extras : [])
      .filter((e) => e && e.nombre && Number(e.precio) >= 0);
  }

  function nombreExtraNormalizado(nombre) {
    return norm(nombre).trim();
  }

  function extrasDeItem(item, p) {
    const disponibles = extrasValidos(p);
    const seleccionados = [];
    const vistos = new Set();
    (Array.isArray(item && item.extras) ? item.extras : []).forEach((nombre) => {
      const clave = nombreExtraNormalizado(nombre);
      if (!clave || vistos.has(clave)) return;
      const e = disponibles.find((x) => nombreExtraNormalizado(x.nombre) === clave);
      if (!e) return;
      vistos.add(clave);
      seleccionados.push({ nombre: e.nombre, precio: Number(e.precio) || 0 });
    });
    return seleccionados;
  }

  function itemKey(item) {
    const extras = (Array.isArray(item && item.extras) ? item.extras : [])
      .map(nombreExtraNormalizado)
      .filter(Boolean)
      .sort()
      .join('|');
    return [
      item.tipo,
      item.localId || '',
      item.catalogoId || '',
      item.productoId,
      item.varianteId || '',
      extras
    ].join('::');
  }

  function resolverItem(item) {
    if (!item || !item.productoId) return null;
    let local = null;
    let cat = null;
    let p = null;
    let tipo = '';

    if (item.tipo === 'local') {
      local = localesPorId.get(item.localId);
      if (!local || local.disponible === false) return null;
      p = (local.productos || []).find((x) => x.id === item.productoId);
      if (!p || p.publicado === false || p.disponible === false) return null;
      tipo = 'local';
    } else {
      cat = catalogosPorId.get(item.catalogoId);
      if (!cat) return null;
      p = (cat.productos || []).find((x) => x.id === item.productoId);
      if (!p) return null;
      tipo = 'catalogo';
    }

    const variantes = variantesValidas(p);
    let variante = null;
    if (item.varianteId) {
      variante = variantes.find((v) => String(v.id) === String(item.varianteId)) || null;
      if (!variante) return null;
    }
    const base = variante ? Number(variante.precio) : Number(tipo === 'local' ? p.precio : p.precioVenta);
    if (!(base > 0)) return null;

    const extras = extrasDeItem(item, p);
    const extrasPrecio = round2(extras.reduce((s, e) => s + Number(e.precio || 0), 0));
    const precio = round2(base + extrasPrecio);
    if (!(precio > 0)) return null;

    return {
      tipo,
      localId: local ? local.id : null,
      catalogoId: cat ? cat.id : null,
      productoId: p.id,
      nombre: p.nombre,
      descripcion: tipo === 'local' ? (p.descripcion || '') : (p.presentacion || ''),
      precio,
      precioBase: round2(base),
      varianteId: variante ? String(variante.id) : null,
      varianteNombre: variante ? variante.nombre : '',
      extras,
      extrasPrecio,
      emoji: p.emoji || '',
      imagen: p.imagen || null,
      presentacion: tipo === 'local' ? (p.descripcion || '') : (p.presentacion || ''),
      groupKey: tipo === 'local' ? 'local:' + local.id : 'cat:' + cat.id,
      groupNombre: tipo === 'local' ? local.nombre : cat.nombre,
      groupEtiqueta: tipo === 'local' ? 'Local' : 'Catálogo EnRuta',
      empaquetado: tipo === 'local' ? (local.empaquetado || null) : null,
      cuando: tipo === 'local' ? (local.horarioLocal || '') : ''
    };
  }

  function cargarCarrito() {
    let guardado = [];
    try {
      guardado = JSON.parse(localStorage.getItem(CART_KEY) || '[]');
    } catch (e) {
      guardado = [];
    }
    if (!Array.isArray(guardado)) guardado = [];

    const mapa = new Map();
    guardado.forEach((raw) => {
      if (!raw || typeof raw !== 'object') return;
      const tipo = raw.tipo === 'local' ? 'local' : 'catalogo';
      const extras = [];
      const vistos = new Set();
      (Array.isArray(raw.extras) ? raw.extras : []).forEach((nombre) => {
        const texto = String(nombre || '').trim();
        const clave = nombreExtraNormalizado(texto);
        if (!clave || vistos.has(clave)) return;
        vistos.add(clave);
        extras.push(texto);
      });
      const base = {
        tipo,
        localId: tipo === 'local' ? String(raw.localId || '') : null,
        catalogoId: tipo === 'catalogo' ? String(raw.catalogoId || '') : null,
        productoId: String(raw.productoId || ''),
        varianteId: raw.varianteId ? String(raw.varianteId) : null,
        extras,
        cantidad: Math.max(1, Math.min(MAX_QTY, parseInt(raw.cantidad, 10) || 1))
      };
      const r = resolverItem(base);
      if (!r) return;
      const k = itemKey(base);
      if (mapa.has(k)) {
        mapa.get(k).cantidad = Math.min(MAX_QTY, mapa.get(k).cantidad + base.cantidad);
      } else {
        mapa.set(k, base);
      }
    });
    state.cart = Array.from(mapa.values());
    guardarCarrito();
  }

  function guardarCarrito() {
    try {
      localStorage.setItem(CART_KEY, JSON.stringify(state.cart));
    } catch (e) {
      /* almacenamiento no disponible (modo privado o file://) */
    }
  }

  function cantidadEnCarrito(ids) {
    const key = itemKey(ids);
    const it = state.cart.find((x) => itemKey(x) === key);
    return it ? it.cantidad : 0;
  }

  function ajustarCantidad(ids, delta) {
    const extras = Array.isArray(ids.extras) ? ids.extras.map((x) => String(x.nombre || x)).filter(Boolean) : [];
    const base = {
      tipo: ids.tipo,
      localId: ids.localId || null,
      catalogoId: ids.catalogoId || null,
      productoId: ids.productoId,
      varianteId: ids.varianteId || null,
      extras,
      cantidad: 1
    };
    const key = itemKey(base);
    const idx = state.cart.findIndex((x) => itemKey(x) === key);
    if (delta > 0) {
      const resuelto = resolverItem(base);
      if (!resuelto) return;
      if (idx >= 0) {
        state.cart[idx].cantidad = Math.min(MAX_QTY, state.cart[idx].cantidad + delta);
      } else {
        state.cart.push(base);
      }
      track('add_to_cart', {
        currency: 'PEN',
        value: round2(resuelto.precio * delta),
        items: [{
          item_id: resuelto.productoId,
          item_name: resuelto.nombre,
          item_category: resuelto.groupEtiqueta,
          price: resuelto.precio,
          quantity: delta
        }]
      });
    } else if (idx >= 0) {
      state.cart[idx].cantidad += delta;
      if (state.cart[idx].cantidad <= 0) state.cart.splice(idx, 1);
    }
    guardarCarrito();
  }

  function quitarItem(key) {
    state.cart = state.cart.filter((x) => itemKey(x) !== key);
    guardarCarrito();
  }

  function vaciarCarrito() {
    state.cart = [];
    guardarCarrito();
    renderCart();
    renderCategorias();
    if (state.activeLocal) renderModal(false);
    mostrarToast('Carrito vacío');
  }

  function calcularDetalle() {
    const grupos = [];
    let subtotal = 0;
    let empaquetado = 0;
    let unidades = 0;

    state.cart.forEach((item) => {
      const r = resolverItem(item);
      if (!r) return;
      let grupo = grupos.find((g) => g.key === r.groupKey);
      if (!grupo) {
        grupo = {
          key: r.groupKey,
          tipo: r.tipo,
          nombre: r.groupNombre,
          etiqueta: r.groupEtiqueta,
          empaquetado: r.empaquetado,
          items: [],
          unidades: 0,
          subtotal: 0,
          empaquetadoMonto: 0
        };
        grupos.push(grupo);
      }
      const sub = round2(r.precio * item.cantidad);
      grupo.items.push(Object.assign({}, r, { cantidad: item.cantidad, subtotal: sub }));
      grupo.unidades += item.cantidad;
      grupo.subtotal = round2(grupo.subtotal + sub);
      subtotal = round2(subtotal + sub);
      unidades += item.cantidad;
    });

    grupos.forEach((g) => {
      const e = g.empaquetado;
      if (e && e.aplica && Number(e.monto) > 0) {
        g.empaquetadoMonto = e.porUnidad
          ? round2(Number(e.monto) * g.unidades)
          : round2(Number(e.monto));
      }
      empaquetado = round2(empaquetado + g.empaquetadoMonto);
    });

    return {
      grupos,
      subtotal,
      empaquetado,
      total: round2(subtotal + empaquetado),
      unidades
    };
  }

  /* ---------------- Render: contacto y configuración ---------------- */
  function aplicarConfig() {
    const ciudad = CONFIG.ciudad || 'Nuevo Chimbote';
    $$('#cityLabel, #cityLabel2').forEach((el) => { el.textContent = ciudad; });

    const principal = zonaPrincipal();

    const textos = {
      support: 'Hola EnRuta Delivery, necesito ayuda con un pedido.',
      custom: 'Hola EnRuta Delivery, quiero pedir un producto que no aparece en el catálogo.',
      general: 'Hola EnRuta Delivery, quiero hacer un pedido.',
      about: 'Hola EnRuta Delivery, quisiera más información sobre el servicio.'
    };

    const setWa = (id, texto) => {
      const el = document.getElementById(id);
      if (el) el.href = waSimple(texto);
    };
    setWa('supportLink', textos.support);
    setWa('customWa', textos.custom);
    setWa('aboutWa', textos.about);
    setWa('contactWa', textos.general);
    setWa('footerWa', textos.general);

    const tel = 'tel:+' + waNumero;
    const telefonoVisible = (CONFIG.whatsapp && CONFIG.whatsapp.visible) || '922 504 223';
    ['aboutPhone', 'footerPhone', 'contactPhone'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) { el.href = tel; el.textContent = telefonoVisible; }
    });

    const mail = 'mailto:' + (CONFIG.email || 'enrutadelivery@gmail.com');
    ['aboutEmail', 'footerEmail', 'contactEmail'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) { el.href = mail; el.textContent = CONFIG.email || 'enrutadelivery@gmail.com'; }
    });

    const redes = CONFIG.redes || {};
    const tiktok = redes.tiktok || {};
    const instagram = redes.instagram || {};
    const setSocial = (id, red, fallback) => {
      const el = document.getElementById(id);
      if (!el) return;
      const url = red.url || fallback;
      if (url) {
        el.href = url;
      } else {
        el.removeAttribute('href');
        el.style.opacity = '.55';
      }
    };
    setSocial('aboutTiktok', tiktok, 'https://www.tiktok.com/@EnRutaDelivery0');
    setSocial('footerTiktok', tiktok, 'https://www.tiktok.com/@EnRutaDelivery0');
    setSocial('aboutInstagram', instagram, 'https://www.instagram.com/EnRutaDelivery0/');
    setSocial('footerInstagram', instagram, 'https://www.instagram.com/EnRutaDelivery0/');

    const horas = principal ? principal.horarioTexto : '';
    $$('#hoursLabel, #aboutHours').forEach((el) => { if (el && horas) el.textContent = horas; });

    const stat = document.getElementById('statLocals');
    if (stat) stat.textContent = String(LOCALES.length);

    const year = document.getElementById('year');
    if (year) year.textContent = String(new Date().getFullYear());

    const footZones = document.getElementById('footerZones');
    if (footZones) {
      footZones.innerHTML = ZONAS.map((z) => {
        return '<p class="footer-text"><b>' + esc(z.nombre) + '</b><br>' +
          esc(z.horarioTexto || '') +
          (z.nota ? '<br><span class="small">' + esc(z.nota) + '</span>' : '') +
          '</p>';
      }).join('');
    }

    const select = document.getElementById('fZone');
    if (select) {
      select.innerHTML = ZONAS.map((z) =>
        '<option value="' + esc(z.id) + '">' + esc(z.nombre) + (z.horarioTexto ? ' · ' + esc(z.horarioTexto) : '') + '</option>'
      ).join('');
    }
  }

  function actualizarEstadoZona() {
    const el = document.getElementById('zoneStatus');
    if (!el) return;
    const z = zonaPrincipal();
    if (!z) { el.textContent = ''; return; }
    const abierto = zonaAbierta(z);
    el.textContent = abierto
      ? 'Abierto ahora · ' + z.nombre
      : 'Cerrado ahora · ' + (z.horarioTexto || '');
    el.classList.toggle('is-open', abierto);
    el.classList.toggle('is-closed', !abierto);
    el.title = z.nota || '';
  }

  /* ---------------- Datos del cliente (solo en este dispositivo) ---------------- */
  function perfilVacio() {
    return {
      version: 1,
      nombre: '',
      telefono: '',
      nota: '',
      direcciones: [],
      ultimaDireccionId: null
    };
  }

  function leerClienteGuardado() {
    let raw = null;
    try {
      raw = JSON.parse(localStorage.getItem(CLIENTE_KEY) || 'null');
    } catch (e) {
      raw = null;
    }
    const perfil = perfilVacio();
    if (!raw || typeof raw !== 'object') return perfil;
    perfil.nombre = String(raw.nombre || '').slice(0, 120);
    perfil.telefono = String(raw.telefono || '').slice(0, 30);
    perfil.nota = String(raw.nota || '').slice(0, 600);
    const vistas = new Set();
    (Array.isArray(raw.direcciones) ? raw.direcciones : []).forEach((d) => {
      if (!d || typeof d !== 'object') return;
      const direccion = String(d.direccion || '').trim().slice(0, 240);
      const zonaId = String(d.zonaId || '').trim();
      if (!direccion || !zonaId || !ZONAS.some((z) => z.id === zonaId) || vistas.has(direccion + '|' + zonaId)) return;
      vistas.add(direccion + '|' + zonaId);
      perfil.direcciones.push({
        id: String(d.id || ('d' + (perfil.direcciones.length + 1))),
        etiqueta: String(d.etiqueta || '').slice(0, 70),
        zonaId,
        direccion,
        referencia: String(d.referencia || '').slice(0, 240)
      });
    });
    perfil.direcciones = perfil.direcciones.slice(0, MAX_DIRECCIONES);
    if (raw.ultimaDireccionId && perfil.direcciones.some((d) => d.id === String(raw.ultimaDireccionId))) {
      perfil.ultimaDireccionId = String(raw.ultimaDireccionId);
    }
    return perfil;
  }

  function persistirCliente() {
    if (!state.clienteGuardado) return;
    try {
      localStorage.setItem(CLIENTE_KEY, JSON.stringify(state.cliente));
    } catch (e) {
      /* almacenamiento no disponible */
    }
  }

  function etiquetaDireccion(zonaId, direccion) {
    const zona = ZONAS.find((z) => z.id === zonaId);
    const nombre = zona ? zona.nombre : zonaId;
    const texto = direccion.replace(/\s+/g, ' ').trim();
    return (nombre + ' · ' + texto).slice(0, 70);
  }

  function sincronizarPerfilDesdeFormulario() {
    if (!state.clienteGuardado) return;
    if (!state.cliente) state.cliente = perfilVacio();
    const nombre = document.getElementById('fName');
    const telefono = document.getElementById('fPhone');
    const nota = document.getElementById('fNote');
    if (nombre) state.cliente.nombre = nombre.value.trim().slice(0, 120);
    if (telefono) state.cliente.telefono = telefono.value.trim().slice(0, 30);
    if (nota) state.cliente.nota = nota.value.trim().slice(0, 600);
    persistirCliente();
  }

  function renderLibreta() {
    const select = document.getElementById('addrSelect');
    if (!select) return;
    const perfil = state.cliente || perfilVacio();
    select.innerHTML = '<option value="">Nueva dirección…</option>' +
      perfil.direcciones.map((d) =>
        '<option value="' + esc(d.id) + '">' + esc(d.etiqueta || etiquetaDireccion(d.zonaId, d.direccion)) + '</option>'
      ).join('');
    const actual = perfil.direcciones.some((d) => d.id === perfil.ultimaDireccionId)
      ? perfil.ultimaDireccionId : '';
    select.value = actual;
    const borrar = document.getElementById('addrDelete');
    if (borrar) borrar.hidden = !actual;
    const pista = document.getElementById('addrHint');
    if (pista) {
      pista.textContent = perfil.direcciones.length
        ? perfil.direcciones.length + ' de ' + MAX_DIRECCIONES + ' direcciones guardadas en este dispositivo.'
        : 'Puedes guardar hasta ' + MAX_DIRECCIONES + ' direcciones en este dispositivo.';
    }
  }

  function aplicarDireccion(direccionId) {
    const perfil = state.cliente || perfilVacio();
    const d = perfil.direcciones.find((x) => x.id === direccionId);
    if (!d) return;
    const zona = document.getElementById('fZone');
    const dir = document.getElementById('fAddress');
    const ref = document.getElementById('fRef');
    if (zona) zona.value = d.zonaId;
    if (dir) dir.value = d.direccion;
    if (ref) ref.value = d.referencia || '';
    perfil.ultimaDireccionId = d.id;
    persistirCliente();
    renderLibreta();
  }

  function aplicarPerfil() {
    const perfil = state.cliente || perfilVacio();
    const nombre = document.getElementById('fName');
    const telefono = document.getElementById('fPhone');
    const nota = document.getElementById('fNote');
    if (nombre && !nombre.value) nombre.value = perfil.nombre;
    if (telefono && !telefono.value) telefono.value = perfil.telefono;
    if (nota && !nota.value) nota.value = perfil.nota;
    if (perfil.ultimaDireccionId) aplicarDireccion(perfil.ultimaDireccionId);
    renderLibreta();
  }

  function guardarDireccionActual() {
    if (!state.clienteGuardado) {
      mostrarToast('Activa “Recordar mis datos” para guardar direcciones.');
      return;
    }
    const zona = document.getElementById('fZone');
    const dir = document.getElementById('fAddress');
    const ref = document.getElementById('fRef');
    const direccion = dir ? dir.value.trim() : '';
    const zonaId = zona ? zona.value : '';
    if (!zonaId || !ZONAS.some((z) => z.id === zonaId)) {
      mostrarToast('Elige una zona antes de guardar la dirección.');
      if (zona) zona.focus();
      return;
    }
    if (direccion.length < 8) {
      mostrarToast('Escribe calle y número antes de guardar la dirección.');
      if (dir) dir.focus();
      return;
    }
    const perfil = state.cliente || perfilVacio();
    const select = document.getElementById('addrSelect');
    const idActual = select && select.value ? select.value : '';
    const datos = {
      etiqueta: etiquetaDireccion(zonaId, direccion),
      zonaId,
      direccion: direccion.slice(0, 240),
      referencia: ref ? ref.value.trim().slice(0, 240) : ''
    };
    let d = perfil.direcciones.find((x) => x.id === idActual);
    if (d) {
      Object.assign(d, datos);
    } else {
      const repetida = perfil.direcciones.find((x) => x.zonaId === datos.zonaId && norm(x.direccion) === norm(datos.direccion));
      if (repetida) {
        d = repetida;
        Object.assign(d, datos);
      } else {
        if (perfil.direcciones.length >= MAX_DIRECCIONES) {
          mostrarToast('Ya tienes ' + MAX_DIRECCIONES + ' direcciones. Elimina una para agregar otra.');
          return;
        }
        d = Object.assign({ id: 'd' + Date.now().toString(36) + Math.floor(Math.random() * 1000) }, datos);
        perfil.direcciones.push(d);
      }
    }
    perfil.ultimaDireccionId = d.id;
    state.cliente = perfil;
    persistirCliente();
    renderLibreta();
    sincronizarPerfilDesdeFormulario();
    mostrarToast('Dirección guardada en este dispositivo.');
  }

  function eliminarDireccionActual() {
    const select = document.getElementById('addrSelect');
    const id = select && select.value ? select.value : '';
    if (!id) return;
    const perfil = state.cliente || perfilVacio();
    const d = perfil.direcciones.find((x) => x.id === id);
    if (!d) return;
    if (!window.confirm('¿Eliminar la dirección “' + (d.etiqueta || d.direccion) + '” de este dispositivo?')) return;
    perfil.direcciones = perfil.direcciones.filter((x) => x.id !== id);
    perfil.ultimaDireccionId = null;
    state.cliente = perfil;
    persistirCliente();
    renderLibreta();
    mostrarToast('Dirección eliminada.');
  }

  function borrarDatosGuardados() {
    if (!window.confirm('¿Borrar tu nombre, celular y direcciones guardadas en este dispositivo?')) return;
    try {
      localStorage.removeItem(CLIENTE_KEY);
      localStorage.setItem(CLIENTE_OPTOUT_KEY, '1');
    } catch (e) { /* sin almacenamiento */ }
    state.cliente = perfilVacio();
    state.clienteGuardado = false;
    const guardar = document.getElementById('saveData');
    if (guardar) guardar.checked = false;
    renderLibreta();
    mostrarToast('Datos guardados borrados.');
  }

  /* ---------------- Render: locales ---------------- */
  function logoHTML(local, clase) {
    const c = clase || 'local-logo';
    if (local.logo) {
      return '<span class="' + c + '"><img src="' + esc(local.logo) + '" alt="Logo de ' + esc(local.nombre) + '" loading="lazy" decoding="async"></span>';
    }
    const inicial = (local.nombre || '?').trim().charAt(0).toUpperCase();
    return '<span class="' + c + ' logo-fallback" style="background:' + gradiente(local) + '">' +
      esc(local.emoji || inicial) + '</span>';
  }

  function portadaHTML(local, clase) {
    const c = clase || 'local-cover';
    if (local.portada) {
      return '<div class="' + c + ' has-img" style="--c1:' + color(local.colores && local.colores[0], '#fdd303') +
        ';--c2:' + color(local.colores && local.colores[1], '#f59e0b') + '">' +
        '<img src="' + esc(local.portada) + '" alt="Portada de ' + esc(local.nombre) + '" loading="lazy" decoding="async">' +
        '</div>';
    }
    return '<div class="' + c + '" style="--c1:' + color(local.colores && local.colores[0], '#fdd303') +
      ';--c2:' + color(local.colores && local.colores[1], '#f59e0b') + '">' +
      '<span class="local-emoji" aria-hidden="true">' + esc(local.emoji || '🛍️') + '</span>' +
      '</div>';
  }

  function empaquetadoTexto(emp) {
    if (!emp || !emp.aplica || !(Number(emp.monto) > 0)) return 'Sin recargo de empaquetado';
    return 'Empaquetado: ' + money(emp.monto) + (emp.porUnidad ? ' por unidad' : ' por pedido');
  }

  function tarjetaLocal(local) {
    const disponible = local.disponible !== false;
    const categoria = local.categoriaNombre || categoriaLocal(local.categoriaId);
    const etiquetas = (local.etiquetas || []).slice(0, 3);
    return '<article class="local-card" data-local="' + esc(local.id) + '" role="button" tabindex="0" aria-label="Ver la carta de ' + esc(local.nombre) + '">' +
      portadaHTML(local, 'local-cover') +
      '<span class="type-pill">' + esc(categoria) + '</span>' +
      '<div class="local-body">' +
        '<div class="local-brand">' +
          logoHTML(local) +
          '<div class="local-brand-text">' +
            '<h3>' + esc(local.nombre) + '</h3>' +
            '<p class="local-rubro">' + esc(categoria || 'Local') + '</p>' +
          '</div>' +
        '</div>' +
        '<p class="local-desc">' + esc(local.descripcion || '') + '</p>' +
        '<p class="local-meta">' +
          '<span class="avail ' + (disponible ? 'on' : 'off') + '"><span class="open-dot"></span>' +
          (disponible ? 'Disponible' : 'No disponible') + '</span>' +
          (local.tiempo ? ' · ⏱ ' + esc(local.tiempo) : '') +
          (local.pedidoMinimo ? ' · Mín. ' + money(local.pedidoMinimo) : '') +
        '</p>' +
        (etiquetas.length ? '<div class="local-tags">' + etiquetas.map((t) => '<span class="tag">' + esc(t) + '</span>').join('') + '</div>' : '') +
        '<div class="local-foot">' +
          '<span class="local-min">' + esc(empaquetadoTexto(local.empaquetado)) + '</span>' +
          '<span class="local-link">Ver carta ' +
            '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>' +
          '</span>' +
        '</div>' +
      '</div>' +
    '</article>';
  }

  /* ---------------- Filtro por distrito ---------------- */
  function renderChipsZona() {
    const cont = document.getElementById('chipsZona');
    if (!cont) return;
    const zonas = [];
    for (const l of LOCALES) {
      if (!l.zonaId) continue;
      if (!zonas.some((z) => z.id === l.zonaId)) {
        zonas.push({ id: l.zonaId, nombre: l.zonaNombre || l.zonaId });
      }
    }
    if (zonas.length < 2) {
      cont.hidden = true;
      cont.innerHTML = '';
      state.zonaLocal = 'todo';
      return;
    }
    if (state.zonaLocal !== 'todo' && !zonas.some((z) => z.id === state.zonaLocal)) {
      state.zonaLocal = 'todo';
    }
    cont.hidden = false;
    const chips = [{ id: 'todo', nombre: 'Todos los distritos' }].concat(zonas);
    cont.innerHTML = chips.map((z) =>
      '<button type="button" class="chip' + (state.zonaLocal === z.id ? ' is-active' : '') + '" data-zona="' + esc(z.id) + '">' + esc(z.nombre) + '</button>'
    ).join('');
  }

  function renderChipsLocales() {
    const cont = document.getElementById('chips');
    if (!cont) return;

    const visibles = LOCALES.filter((l) => state.tab === 'todo' || l.tipo === state.tab);
    const usadas = new Set(visibles.map((l) => l.categoriaId));
    const categorias = CATEGORIAS_LOCALES.filter((c) => usadas.has(c.id));

    if (state.catLocal !== 'todo' && !categorias.some((c) => c.id === state.catLocal)) {
      state.catLocal = 'todo';
    }

    const chips = [{ id: 'todo', nombre: 'Todos' }].concat(categorias);
    const chipActivo = state.q ? 'todo' : state.catLocal;
    cont.innerHTML = chips.map((c) =>
      '<button type="button" class="chip' + (chipActivo === c.id ? ' is-active' : '') + '" data-cat="' + esc(c.id) + '">' + esc(c.nombre) + '</button>'
    ).join('');
  }

  /* Oculta el taximoto mientras no esté activado desde el panel. */
  function aplicarServiciosActivos() {
    const cfg = (DATA && DATA.config) || {};
    const taxiActivo = !!(cfg.servicios && cfg.servicios.taximoto === true);
    const card = document.querySelector('.service-taxi');
    if (card && !taxiActivo) card.remove();
    const cont = document.querySelector('.services');
    if (cont) cont.classList.toggle('services-solo', !taxiActivo);
    const titulo = document.querySelector('.services-head h2');
    if (titulo && !taxiActivo) titulo.textContent = 'Envíos y encomiendas';
  }

  function renderLocales() {
    const grid = document.getElementById('localsGrid');
    const vacio = document.getElementById('localsEmpty');
    const contador = document.getElementById('localsCount');
    if (!grid) return;

    renderChipsZona();
    renderChipsLocales();

    $$('.tab').forEach((t) => {
      const activo = !state.q && t.dataset.tab === state.tab;
      t.classList.toggle('is-active', activo);
      t.setAttribute('aria-selected', activo ? 'true' : 'false');
    });

    // Al buscar se ignoran la pestaña y la categoría: el buscador recorre
    // todos los locales y todos sus productos.
    const lista = LOCALES.filter((l) => {
      if (state.zonaLocal !== 'todo' && l.zonaId !== state.zonaLocal) return false;
      if (!state.q) {
        if (state.tab !== 'todo' && l.tipo !== state.tab) return false;
        if (state.catLocal !== 'todo' && l.categoriaId !== state.catLocal) return false;
      }
      return localCoincide(l);
    });

    grid.innerHTML = lista.map(tarjetaLocal).join('');
    if (contador) contador.textContent = lista.length + (lista.length === 1 ? ' local' : ' locales');
    if (vacio) vacio.hidden = lista.length > 0;

  }

  /* ---------------- Render: catálogos ---------------- */
  const SECCIONES = [
    { id: 'licores', grid: 'licoresGrid', chips: 'chipsLicores', count: 'licoresCount', empty: 'licoresEmpty', fecha: 'licoresFecha' },
    { id: 'primera-necesidad', grid: 'necGrid', chips: 'chipsNec', count: 'necCount', empty: 'necEmpty', fecha: 'necFecha' }
  ];

  function fechaMaxima(cat) {
    const fechas = (cat.productos || [])
      .map((p) => p.fuente && p.fuente.fechaVerificacion)
      .filter((f) => /^\d{4}-\d{2}-\d{2}$/.test(f || ''))
      .sort();
    return fechas.length ? fechaCorta(fechas[fechas.length - 1]) : '';
  }

  function imagenProducto(p, clase) {
    if (p.imagen) {
      return '<img class="' + clase + '" src="' + esc(p.imagen) + '" alt="' + esc(p.nombre) + '" loading="lazy" decoding="async">';
    }
    const inicial = (p.nombre || '?').trim().charAt(0).toUpperCase();
    return '<span class="' + clase + ' img-fallback" aria-hidden="true">' + esc(inicial) + '</span>';
  }

  function attrsOpciones(ids) {
    let attrs = '';
    if (ids.varianteId) attrs += ' data-variante="' + esc(ids.varianteId) + '"';
    const extras = (Array.isArray(ids.extras) ? ids.extras : [])
      .map((e) => (typeof e === 'string' ? e : e && e.nombre))
      .filter(Boolean);
    if (extras.length) attrs += ' data-extras="' + esc(JSON.stringify(extras)) + '"';
    return attrs;
  }

  function controlCantidad(tipo, ids, cantidad, clase) {
    const attrs = ' data-add data-tipo="' + tipo + '"' +
      (ids.localId ? ' data-local="' + esc(ids.localId) + '"' : '') +
      (ids.catalogoId ? ' data-catalogo="' + esc(ids.catalogoId) + '"' : '') +
      ' data-producto="' + esc(ids.productoId) + '"' +
      attrsOpciones(ids);

    if (!cantidad) {
      return '<button type="button" class="btn-add"' + attrs + ' data-delta="1">Agregar</button>';
    }
    return '<div class="stepper ' + (clase || 'sm') + '">' +
      '<button type="button"' + attrs + ' data-delta="-1" aria-label="Quitar una unidad">−</button>' +
      '<span>' + cantidad + '</span>' +
      '<button type="button"' + attrs + ' data-delta="1" aria-label="Agregar una unidad">+</button>' +
    '</div>';
  }

  function tarjetaCatalogo(cat, p) {
    const ids = { tipo: 'catalogo', catalogoId: cat.id, productoId: p.id };
    const cantidad = cantidadEnCarrito(ids);
    const fecha = p.fuente && p.fuente.fechaVerificacion ? fechaCorta(p.fuente.fechaVerificacion) : '';
    const tienda = (p.fuente && p.fuente.tienda) || 'Plaza Vea';
    const urlFuente = p.fuente && /^https:\/\//i.test(p.fuente.url || '') ? p.fuente.url : '';
    const esReferencia = p.estado === 'referencia-tambo';
    const tiendaHtml = urlFuente
      ? '<a href="' + esc(urlFuente) + '" target="_blank" rel="noopener noreferrer">' + esc(tienda) + '</a>'
      : esc(tienda);
    let referencia;
    if (esReferencia) {
      referencia = 'Fuente: ' + tiendaHtml + (fecha ? ' · ' + fecha : '');
    } else if (p.precioReferencia != null) {
      referencia = 'Ref. ' + tiendaHtml + ' ' + money(p.precioReferencia) + (fecha ? ' · ' + fecha : '');
    } else {
      referencia = 'Referencia no disponible';
    }
    const categoria = categoriaCatalogo(cat, p.categoriaId);
    const estado = !esReferencia && p.estado !== 'verificado'
      ? '<span class="c-state">' + esc(p.estado || '') + '</span>'
      : (esReferencia ? '<span class="c-state">Ref. Tambo</span>' : '');

    return '<article class="c-card">' +
      '<div class="c-img">' + imagenProducto(p, 'c-img-el') + estado + '</div>' +
      '<div class="c-body">' +
        '<p class="c-brand">' + esc(p.marca || '') + (categoria ? ' · ' + esc(categoria) : '') + '</p>' +
        '<h4>' + esc(p.nombre) + '</h4>' +
        '<p class="c-pres">' + esc(p.presentacion || '') + '</p>' +
        '<p class="c-ref">' + referencia + '</p>' +
        '<div class="c-foot">' +
          '<div class="c-price"><small>' + (esReferencia ? 'Precio referencial' : 'Precio EnRuta') + '</small><b>' + money(p.precioVenta) + '</b></div>' +
          controlCantidad('catalogo', ids, cantidad, 'sm') +
        '</div>' +
      '</div>' +
    '</article>';
  }

  /* Contador local de ventas por producto (se usa como "más vendidos"
     mientras el backend no entregue estadísticas reales). */
  function leerVentas() {
    try {
      const datos = JSON.parse(localStorage.getItem(VENTAS_KEY) || '{}');
      return datos && typeof datos === 'object' ? datos : {};
    } catch (e) {
      return {};
    }
  }

  function registrarVenta(items) {
    if (!Array.isArray(items) || !items.length) return;
    const ventas = leerVentas();
    items.forEach((it) => {
      const catalogoId = it.catalogoId;
      if (!catalogoId || !it.productoId) return;
      const clave = catalogoId + '|' + it.productoId;
      ventas[clave] = (Number(ventas[clave]) || 0) + (Number(it.cantidad) || 1);
    });
    try { localStorage.setItem(VENTAS_KEY, JSON.stringify(ventas)); } catch (e) { /* sin almacenamiento */ }
  }

  function ordenarProductos(catalogoId, lista) {
    const ventas = leerVentas();
    const manual = new Map((DESTACADOS[catalogoId] || []).map((id, i) => [id, i]));
    return lista.map((p, i) => ({ p, i })).sort((a, b) => {
      const va = Number(ventas[catalogoId + '|' + a.p.id]) || 0;
      const vb = Number(ventas[catalogoId + '|' + b.p.id]) || 0;
      if (va !== vb) return vb - va;
      const ma = manual.has(a.p.id) ? manual.get(a.p.id) : 9999;
      const mb = manual.has(b.p.id) ? manual.get(b.p.id) : 9999;
      if (ma !== mb) return ma - mb;
      return a.i - b.i;
    }).map((x) => x.p);
  }

  function bloqueCategoria(sec, cat, categoria, items) {
    const catId = categoria ? categoria.id : 'otros';
    const abierto = !!(state.expandidos[sec.id] && state.expandidos[sec.id][catId]);
    const limite = limiteCategoria();
    const visibles = abierto ? items : items.slice(0, limite);
    const total = items.length;
    const restantes = total - visibles.length;
    return '<div class="cat-band">' +
        '<h4>' + esc(categoria ? categoria.nombre : 'Otros productos') + '</h4>' +
        '<span>' + total + (total === 1 ? ' producto' : ' productos') + '</span>' +
      '</div>' +
      visibles.map((p) => tarjetaCatalogo(cat, p)).join('') +
      (restantes > 0
        ? '<div class="cat-more"><button type="button" class="btn btn-ghost" data-cat-more="' + esc(catId) + '" data-sec="' + esc(sec.id) + '">Ver más · ' + total + ' productos</button></div>'
        : (abierto && total > limite
          ? '<div class="cat-more"><button type="button" class="btn btn-ghost" data-cat-more="' + esc(catId) + '" data-sec="' + esc(sec.id) + '">Ver menos</button></div>'
          : ''));
  }

  function renderCatalogo(sec) {
    const cat = catalogosPorId.get(sec.id);
    const grid = document.getElementById(sec.grid);
    const cont = document.getElementById(sec.chips);
    const contador = document.getElementById(sec.count);
    const vacio = document.getElementById(sec.empty);
    if (!cat || !grid) return;

    const seleccion = state.catCatalogos[sec.id] || 'todo';
    const chipsActivo = state.q ? 'todo' : seleccion;

    if (cont) {
      const chips = [{ id: 'todo', nombre: 'Todos' }].concat(cat.categorias || []);
      // Los packs (six pack, four pack, twelve pack) ya vienen con su
      // precio real de Tambo; este filtro los reúne sin alterar el resto.
      if (sec.id === 'licores') chips.splice(1, 0, { id: 'packs', nombre: '🍻 Packs' });
      cont.innerHTML = chips.map((c) =>
        '<button type="button" class="chip' + (chipsActivo === c.id ? ' is-active' : '') + '" data-cat="' + esc(c.id) + '">' + esc(c.nombre) + '</button>'
      ).join('');
    }

    const esPacks = seleccion === 'packs';
    const lista = (cat.productos || []).filter((p) => {
      if (state.q) return productoCatalogoCoincide(cat, p);
      if (esPacks) return /pack/i.test(String(p.nombre || '')) && productoCatalogoCoincide(cat, p);
      if (seleccion !== 'todo' && p.categoriaId !== seleccion) return false;
      return productoCatalogoCoincide(cat, p);
    });

    if (state.q) {
      // Resultados de búsqueda: lista plana completa en todas las categorías.
      grid.innerHTML = ordenarProductos(sec.id, lista).map((p) => tarjetaCatalogo(cat, p)).join('');
    } else if (seleccion !== 'todo') {
      const categoria = esPacks
        ? { id: 'packs', nombre: 'Packs' }
        : (cat.categorias || []).find((c) => c.id === seleccion) || null;
      grid.innerHTML = bloqueCategoria(sec, cat, categoria, ordenarProductos(sec.id, lista));
    } else {
      const categorias = (cat.categorias || []).filter((c) => lista.some((p) => p.categoriaId === c.id));
      const usadas = new Set(categorias.map((c) => c.id));
      let html = categorias.map((c) =>
        bloqueCategoria(sec, cat, c, ordenarProductos(sec.id, lista.filter((p) => p.categoriaId === c.id)))
      ).join('');
      const otros = lista.filter((p) => !usadas.has(p.categoriaId));
      if (otros.length) html += bloqueCategoria(sec, cat, null, ordenarProductos(sec.id, otros));
      grid.innerHTML = html;
    }

    if (contador) contador.textContent = lista.length + (lista.length === 1 ? ' producto' : ' productos');
    if (vacio) vacio.hidden = lista.length > 0;

    const fechaEl = sec.fecha ? document.getElementById(sec.fecha) : null;
    const fecha = fechaMaxima(cat);
    if (fechaEl && fecha) fechaEl.textContent = fecha;
  }

  function renderCategorias() {
    SECCIONES.forEach(renderCatalogo);
    actualizarEstadoBusqueda();
  }

  function actualizarEstadoBusqueda() {
    const el = document.getElementById('searchStatus');
    if (!el) return;
    const panel = document.getElementById('resultadosBusqueda');
    if (panel && !panel.hidden) { el.hidden = true; el.innerHTML = ''; return; }
    const q = String(state.q || '').trim();
    if (!q) {
      el.hidden = true;
      el.innerHTML = '';
      return;
    }
    const locales = LOCALES.filter(localCoincide).length;
    let productos = 0;
    CATALOGOS.forEach((c) => {
      productos += (c.productos || []).filter((p) => productoCatalogoCoincide(c, p)).length;
    });
    const total = locales + productos;
    el.hidden = false;
    el.innerHTML = total
      ? '<span><b>' + total + '</b> ' + (total === 1 ? 'resultado' : 'resultados') + ' para «' + esc(q) + '» · ' + locales + ' locales · ' + productos + ' productos</span>' +
        '<button type="button" class="link-mini" id="searchClear">Limpiar búsqueda</button>'
      : '<span>No encontramos resultados para «' + esc(q) + '». Prueba con otra palabra o escríbenos por WhatsApp.</span>' +
        '<button type="button" class="link-mini" id="searchClear">Limpiar búsqueda</button>';
  }

  function limpiarBusqueda() {
    state.q = '';
    const input = document.getElementById('searchInput');
    if (input) input.value = '';
    renderTodo();
  }

  function renderTodo() {
    renderLocales();
    renderCategorias();
    renderResultados();
    renderCart();
  }

  /* ---------------- Render: modal de local ---------------- */
  function filaProducto(local, p) {
    const ids = { tipo: 'local', localId: local.id, productoId: p.id };
    const cantidad = cantidadEnCarrito(ids);
    const puedePedir = local.disponible !== false && p.disponible !== false && p.publicado !== false;
    const variantes = variantesValidas(p);
    const extras = extrasValidos(p);
    const conOpciones = variantes.length > 0 || extras.length > 0;
    const precioBase = Number(p.precio) > 0 ? Number(p.precio)
      : (variantes.length ? Math.min.apply(null, variantes.map((v) => Number(v.precio))) : 0);
    const precioVisible = variantes.length
      ? 'Desde ' + money(Math.min.apply(null, variantes.map((v) => Number(v.precio))))
      : money(precioBase);

    let opciones = '';
    if (puedePedir && conOpciones) {
      let selector = '';
      if (variantes.length) {
        selector = '<label class="opt-line"><span>Presentación</span>' +
          '<select data-op-variante>' +
            variantes.map((v) => '<option value="' + esc(v.id) + '" data-precio="' + esc(v.precio) + '">' +
              esc(v.nombre) + ' · ' + money(v.precio) + '</option>').join('') +
          '</select></label>';
      }
      const extrasHtml = extras.length
        ? '<div class="opt-extras">' + extras.map((e, i) =>
            '<label class="opt-check"><input type="checkbox" data-op-extra="' + i + '" data-precio="' + esc(e.precio) + '">' +
            '<span>' + esc(e.nombre) + '</span><b>' + (Number(e.precio) > 0 ? '+' + money(e.precio) : 'Gratis') + '</b></label>'
          ).join('') + '</div>'
        : '';
      const inicial = variantes.length ? Number(variantes[0].precio) : precioBase;
      opciones = '<div class="menu-opts" data-op-local="' + esc(local.id) + '" data-op-producto="' + esc(p.id) + '">' +
        selector + extrasHtml +
        '<div class="menu-opts-foot">' +
          '<button type="button" class="btn-add" data-add-options data-tipo="local" data-local="' + esc(local.id) + '" data-producto="' + esc(p.id) + '">' +
            'Agregar <b data-op-total>' + money(inicial) + '</b>' +
          '</button>' +
        '</div>' +
      '</div>';
    }

    return '<div class="menu-row' + (conOpciones ? ' menu-row-opts' : '') + '">' +
      '<div class="menu-emoji">' + (p.imagen ? '<img src="' + esc(p.imagen) + '" alt="" loading="lazy" decoding="async">' : esc(p.emoji || '🍽️')) + '</div>' +
      '<div class="menu-main">' +
        '<div class="menu-name">' + esc(p.nombre) +
          (p.etiqueta ? ' <span class="tag tag-sm">' + esc(p.etiqueta) + '</span>' : '') +
        '</div>' +
        (p.descripcion ? '<p>' + esc(p.descripcion) + '</p>' : '') +
        '<strong>' + precioVisible + '</strong>' +
        opciones +
      '</div>' +
      (!puedePedir ? '<span class="no-stock">No disponible</span>'
        : (conOpciones ? '' : controlCantidad('local', ids, cantidad, 'sm'))) +
    '</div>';
  }

  function renderModal(resetScroll) {
    const local = localesPorId.get(state.activeLocal);
    const cont = document.getElementById('modalContent');
    const modal = document.getElementById('modal');
    const barra = document.getElementById('modalBar');
    if (!local || !cont || !modal) return;

    const categoria = local.categoriaNombre || categoriaLocal(local.categoriaId);
    const productos = local.productos || [];
    const puedePedir = local.disponible !== false;
    const tieneCarta = !!local.cartaOriginal;
    const notaEmp = empaquetadoTexto(local.empaquetado);

    let cuerpo = '';
    if (local.portada) {
      cuerpo += '<div class="modal-cover has-img" style="--c1:' + color(local.colores && local.colores[0], '#fdd303') +
        ';--c2:' + color(local.colores && local.colores[1], '#f59e0b') + '">' +
        '<img src="' + esc(local.portada) + '" alt="Portada de ' + esc(local.nombre) + '" decoding="async"></div>';
    } else {
      cuerpo += '<div class="modal-cover" style="--c1:' + color(local.colores && local.colores[0], '#fdd303') +
        ';--c2:' + color(local.colores && local.colores[1], '#f59e0b') + '">' +
        '<span class="modal-emoji" aria-hidden="true">' + esc(local.emoji || '🛍️') + '</span></div>';
    }

    cuerpo += '<div class="modal-body">' +
      '<div class="modal-head">' +
        '<div class="modal-brand">' +
          logoHTML(local, 'modal-logo') +
          '<div>' +
            '<span class="type-pill type-pill-static">' + esc(categoria || 'Local') + '</span>' +
            '<h2 id="modalTitle">' + esc(local.nombre) + '</h2>' +
            '<p class="modal-meta">' +
              '<span class="avail ' + (puedePedir ? 'on' : 'off') + '"><span class="open-dot"></span>' + (puedePedir ? 'Disponible' : 'No disponible') + '</span>' +
              (local.tiempo ? ' · ⏱ ' + esc(local.tiempo) : '') +
              (local.pedidoMinimo ? ' · Mín. ' + money(local.pedidoMinimo) : '') +
            '</p>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<p class="modal-desc">' + esc(local.descripcion || '') + '</p>' +
      (local.etiquetas && local.etiquetas.length ? '<div class="modal-info">' + local.etiquetas.map((t) => '<span>' + esc(t) + '</span>').join('') + '</div>' : '') +
      '<p class="modal-note">' + esc(notaEmp) + ' · Se muestra aparte del precio de cada producto. El delivery se cotiza por WhatsApp.</p>';

    if (!puedePedir) {
      cuerpo += '<p class="modal-note modal-warn">Este local no está disponible en este momento. Puedes revisar la carta, pero no agregar productos.</p>';
    }

    cuerpo += '<div class="modal-menu-head"><h3>Menú digital</h3><span class="count">' + productos.length + ' productos</span></div>';

    if (productos.length) {
      cuerpo += '<div class="menu">' + productos.map((p) => filaProducto(local, p)).join('') + '</div>';
      if (tieneCarta) {
        cuerpo += '<a class="carta-link" href="' + esc(local.cartaOriginal) + '" target="_blank" rel="noopener">Ver carta original (imagen)</a>';
      }
    } else if (tieneCarta) {
      cuerpo += '<div class="carta-block">' +
        '<p>Este local todavía no tiene productos cargados. La carta original está disponible como referencia.</p>' +
        '<a href="' + esc(local.cartaOriginal) + '" target="_blank" rel="noopener"><img src="' + esc(local.cartaOriginal) + '" alt="Carta original de ' + esc(local.nombre) + '" loading="lazy" decoding="async"></a>' +
      '</div>';
    } else {
      cuerpo += '<div class="carta-block carta-empty">' +
        '<div class="empty-emoji" aria-hidden="true">📋</div>' +
        '<h4>Carta en revisión</h4>' +
        '<p>Este local aún no tiene su menú digital publicado. Escríbenos y te compartimos la carta actualizada y disponibilidad.</p>' +
        '<a class="btn btn-wa" href="' + esc(waSimple('Hola EnRuta Delivery, quiero consultar la carta de ' + local.nombre + '.')) + '" target="_blank" rel="noopener">Consultar por WhatsApp</a>' +
      '</div>';
    }

    cuerpo += '<p class="modal-note">Los precios y la disponibilidad los confirma el local al recibir tu pedido. El delivery se cotiza aparte.</p>' +
      '</div>';

    const scrollPrevio = resetScroll ? 0 : cont.scrollTop;
    cont.innerHTML = cuerpo;

    const titulo = document.getElementById('modalTitle');
    if (titulo) modal.setAttribute('aria-labelledby', 'modalTitle');

    if (barra) {
      const propios = state.cart.map((it) => ({ it, r: resolverItem(it) }))
        .filter((x) => x.r && x.r.tipo === 'local' && x.r.localId === local.id);
      const unidades = propios.reduce((s, x) => s + x.it.cantidad, 0);
      const sub = propios.reduce((s, x) => s + x.r.precio * x.it.cantidad, 0);
      const info = document.getElementById('modalBarInfo');
      const verPedido = document.getElementById('modalBarCart');
      if (info) {
        info.innerHTML = unidades > 0
          ? '<b>' + unidades + '</b> en tu pedido · ' + money(sub)
          : 'Elige tus productos y vuelve cuando quieras.';
      }
      if (verPedido) verPedido.hidden = unidades === 0;
    }

    const tituloBarra = document.getElementById('modalTopTitle');
    if (tituloBarra) tituloBarra.textContent = local.nombre;

    // innerHTML reinicia el scroll del contenedor: lo restauramos al
    // actualizar cantidades para no devolver al usuario al inicio del menú.
    cont.scrollTop = scrollPrevio;
  }

  function abrirLocal(id) {
    const local = localesPorId.get(id);
    if (!local) return;
    state.activeLocal = id;
    renderModal(true);
    const modal = document.getElementById('modal');
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
    const overlay = document.getElementById('overlay');
    if (overlay) { overlay.hidden = false; overlay.classList.add('show'); }
    document.body.classList.add('no-scroll');
    const cerrar = document.getElementById('modalClose');
    if (cerrar) cerrar.focus({ preventScroll: true });
  }

  function cerrarModal() {
    const modal = document.getElementById('modal');
    if (!modal) return;
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
    state.activeLocal = null;
    sincronizarOverlay();
    actualizarBloqueoScroll();
  }

  /* ---------------- Render: carrito ---------------- */
  function renderCart() {
    const detalle = calcularDetalle();
    const cont = document.getElementById('cartItems');
    const vacio = document.getElementById('cartEmpty');
    const form = document.getElementById('orderForm');
    const pie = document.getElementById('cartFoot');
    const totales = document.getElementById('cartTotals');
    const nota = document.getElementById('deliveryNote');
    const subtitulo = document.getElementById('cartSubtitle');
    const count = document.getElementById('cartCount');
    if (!cont || !vacio || !form || !pie || !totales) return;

    const unidades = detalle.unidades;

    if (count) {
      count.textContent = String(unidades);
      count.hidden = unidades === 0;
    }

    if (!unidades) {
      cont.innerHTML = '';
      vacio.hidden = false;
      form.hidden = true;
      pie.hidden = true;
      state.paso = 'productos';
      const pasosVacio = document.getElementById('cartSteps');
      const reviewVacio = document.getElementById('cartReview');
      if (pasosVacio) pasosVacio.hidden = true;
      if (reviewVacio) { reviewVacio.hidden = true; reviewVacio.innerHTML = ''; }
      if (nota) nota.hidden = true;
      if (subtitulo) subtitulo.textContent = 'Todavía no agregaste nada';
      return;
    }

    vacio.hidden = true;
    pie.hidden = false;
    if (nota) nota.hidden = false;
    if (subtitulo) {
      subtitulo.textContent = unidades + (unidades === 1 ? ' producto' : ' productos') +
        ' · ' + detalle.grupos.length + (detalle.grupos.length === 1 ? ' origen' : ' orígenes');
    }

    cont.innerHTML = detalle.grupos.map((g) => {
      const items = g.items.map((it) => {
        const key = itemKey(it);
        const ids = ' data-add data-tipo="' + it.tipo + '"' +
          (it.localId ? ' data-local="' + esc(it.localId) + '"' : '') +
          (it.catalogoId ? ' data-catalogo="' + esc(it.catalogoId) + '"' : '') +
          ' data-producto="' + esc(it.productoId) + '"' +
          attrsOpciones(it);
        const opciones = [];
        if (it.varianteNombre) opciones.push('Presentación: ' + it.varianteNombre);
        if (it.extras && it.extras.length) opciones.push('Extras: ' + it.extras.map((e) => e.nombre).join(', '));
        return '<div class="ci">' +
          '<div class="ci-emoji">' + (it.imagen ? '<img src="' + esc(it.imagen) + '" alt="" loading="lazy" decoding="async">' : esc(it.emoji || (it.nombre || '?').charAt(0))) + '</div>' +
          '<div class="ci-main">' +
            '<div class="ci-name">' + esc(it.nombre) + '</div>' +
            (it.descripcion ? '<div class="ci-local">' + esc(it.descripcion) + '</div>' : '') +
            (opciones.length ? '<div class="ci-opt">' + opciones.map(esc).join(' · ') + '</div>' : '') +
            '<div class="ci-price">' + money(it.precio) + ' c/u' +
              (it.extrasPrecio > 0 ? ' · incluye ' + money(it.extrasPrecio) + ' en extras' : '') +
            '</div>' +
          '</div>' +
          '<div class="ci-right">' +
            '<div class="stepper sm">' +
              '<button type="button"' + ids + ' data-delta="-1" aria-label="Quitar una unidad de ' + esc(it.nombre) + '">−</button>' +
              '<span>' + it.cantidad + '</span>' +
              '<button type="button"' + ids + ' data-delta="1" aria-label="Agregar una unidad de ' + esc(it.nombre) + '">+</button>' +
            '</div>' +
            '<div class="ci-total">' + money(it.subtotal) + '</div>' +
            '<button type="button" class="ci-del" data-remove="' + esc(key) + '" aria-label="Quitar ' + esc(it.nombre) + ' del pedido">Quitar</button>' +
          '</div>' +
        '</div>';
      }).join('');

      const emp = g.empaquetado;
      const detalleEmp = g.empaquetadoMonto > 0
        ? (emp.porUnidad ? emp.concepto + ' · ' + g.unidades + ' × ' + money(emp.monto) : emp.concepto)
        : 'Sin recargo';
      return '<section class="cart-group">' +
        '<header class="cart-group-head">' +
          '<span class="cg-kind">' + esc(g.etiqueta) + '</span>' +
          '<h3>' + esc(g.nombre) + '</h3>' +
        '</header>' +
        items +
        '<div class="cart-group-foot">' +
          '<div class="cart-group-pack">Empaquetado <span>' + esc(detalleEmp) + '</span><b>' + money(g.empaquetadoMonto) + '</b></div>' +
          '<div class="cart-group-sub">Productos <b>' + money(g.subtotal) + '</b></div>' +
        '</div>' +
      '</section>';
    }).join('');

    totales.innerHTML =
      '<div class="trow"><span>Productos</span><b>' + money(detalle.subtotal) + '</b></div>' +
      '<div class="trow"><span>Empaquetado</span><b>' + money(detalle.empaquetado) + '</b></div>' +
      '<div class="trow total"><span>Productos + empaquetado</span><b>' + money(detalle.total) + '</b></div>' +
      '<div class="trow quote"><span>Delivery</span><b>Por cotizar</b></div>';

    actualizarAppbar();
    actualizarPasoCarrito();
  }

  function resumenPedidoHTML() {
    const valor = (id) => {
      const el = document.getElementById(id);
      return el ? String(el.value || '').trim() : '';
    };
    const zonaEl = document.getElementById('fZone');
    const zona = zonaEl && zonaEl.selectedIndex >= 0
      ? String(zonaEl.options[zonaEl.selectedIndex].textContent || '').trim()
      : '';
    const programado = document.getElementById('whenScheduled') && document.getElementById('whenScheduled').checked;
    const fecha = valor('fWhen');
    const cuando = programado && fecha ? 'Programado: ' + fechaHora(new Date(fecha)) : 'Lo antes posible';
    const detalle = calcularDetalle();
    return '<h3>Revisa y envía</h3>' +
      '<div class="cart-review-card">' +
        '<div class="row"><span>Nombre</span><span>' + esc(valor('fName')) + '</span></div>' +
        '<div class="row"><span>WhatsApp</span><span>' + esc(valor('fPhone')) + '</span></div>' +
        '<div class="row"><span>Zona</span><span>' + esc(zona) + '</span></div>' +
        '<div class="row"><span>Dirección</span><span>' + esc(valor('fAddress')) + '</span></div>' +
        (valor('fRef') ? '<div class="row"><span>Referencia</span><span>' + esc(valor('fRef')) + '</span></div>' : '') +
        '<div class="row"><span>Entrega</span><span>' + esc(cuando) + '</span></div>' +
        (valor('fNote') ? '<div class="row"><span>Nota</span><span>' + esc(valor('fNote')) + '</span></div>' : '') +
        '<div class="row"><span>Total</span><span>' + money(detalle.total) + '</span></div>' +
      '</div>' +
      '<p class="cart-review-note">El delivery se cotiza por WhatsApp. Al enviar se abre el chat con el pedido escrito.</p>';
  }

  function actualizarPasoCarrito() {
    const paso = state.paso === 'datos' || state.paso === 'enviar' ? state.paso : 'productos';
    state.paso = paso;
    const pasos = document.getElementById('cartSteps');
    const productos = document.getElementById('cartStepProducts');
    const form = document.getElementById('orderForm');
    const review = document.getElementById('cartReview');
    const next = document.getElementById('cartNext');
    const send = document.getElementById('sendOrder');
    const mini = document.getElementById('sendMini');
    const back = document.getElementById('cartBack');

    if (pasos) {
      pasos.hidden = false;
      $$('.cart-step', pasos).forEach((el) => {
        const clave = el.dataset.stepLabel;
        const orden = { productos: 1, datos: 2, enviar: 3 };
        el.classList.toggle('is-active', clave === paso);
        el.classList.toggle('is-done', orden[clave] < orden[paso]);
      });
    }
    if (productos) productos.hidden = paso !== 'productos';
    if (form) form.hidden = paso !== 'datos';
    if (review) {
      review.hidden = paso !== 'enviar';
      if (paso === 'enviar') review.innerHTML = resumenPedidoHTML();
    }
    if (next) {
      next.hidden = paso === 'enviar';
      next.textContent = paso === 'productos' ? 'Continuar con mis datos' : 'Revisar pedido';
    }
    if (send) send.hidden = paso !== 'enviar';
    if (mini) mini.hidden = paso !== 'enviar';
    if (back) {
      back.hidden = paso === 'productos';
      back.textContent = paso === 'enviar' ? '← Editar datos de entrega' : '← Volver a productos';
    }
  }

  function irPasoCarrito(paso, validar) {
    if (paso === 'enviar' && validar) {
      const pedido = leerPedido();
      if (!pedido) return;
    }
    state.paso = paso;
    renderCart();
    const drawer = document.getElementById('cartDrawer');
    const cuerpo = drawer ? drawer.querySelector('.drawer-body') : null;
    if (cuerpo) cuerpo.scrollTop = 0;
  }

  /* ---------------- Drawer ---------------- */
  function abrirCarrito() {
    cerrarModal();
    const drawer = document.getElementById('cartDrawer');
    if (!drawer) return;
    renderCart();
    drawer.classList.add('open');
    drawer.setAttribute('aria-hidden', 'false');
    document.getElementById('cartBtn').setAttribute('aria-expanded', 'true');
    const overlay = document.getElementById('overlay');
    if (overlay) { overlay.hidden = false; overlay.classList.add('show'); }
    document.body.classList.add('no-scroll');
    const cerrar = document.getElementById('cartClose');
    if (cerrar) cerrar.focus({ preventScroll: true });
    const detalle = calcularDetalle();
    if (detalle.unidades) {
      track('begin_checkout', {
        currency: 'PEN',
        value: detalle.total,
        items: detalle.unidades
      });
    }
  }

  function cerrarCarrito() {
    const drawer = document.getElementById('cartDrawer');
    if (!drawer) return;
    drawer.classList.remove('open');
    drawer.setAttribute('aria-hidden', 'true');
    const btn = document.getElementById('cartBtn');
    if (btn) btn.setAttribute('aria-expanded', 'false');
    sincronizarOverlay();
    actualizarBloqueoScroll();
  }

  function sincronizarOverlay() {
    const drawer = document.getElementById('cartDrawer');
    const modal = document.getElementById('modal');
    const sheet = document.getElementById('serviceSheet');
    const overlay = document.getElementById('overlay');
    if (!overlay) return;
    const abierto = (drawer && drawer.classList.contains('open')) ||
      (modal && modal.classList.contains('open')) ||
      (sheet && sheet.classList.contains('open'));
    overlay.classList.toggle('show', !!abierto);
    overlay.hidden = !abierto;
  }

  function actualizarBloqueoScroll() {
    const drawer = document.getElementById('cartDrawer');
    const modal = document.getElementById('modal');
    const sheet = document.getElementById('serviceSheet');
    const abierto = (drawer && drawer.classList.contains('open')) ||
      (modal && modal.classList.contains('open')) ||
      (sheet && sheet.classList.contains('open'));
    document.body.classList.toggle('no-scroll', !!abierto);
  }

  function cerrarTodo() {
    cerrarCarrito();
    cerrarModal();
    cerrarSheet();
  }

  /* ---------------- Validación y mensaje de WhatsApp ---------------- */
  function limpiarError(input, err) {
    if (input) input.classList.remove('invalid');
    if (err) { err.textContent = ''; err.classList.remove('show'); }
  }

  function marcarError(input, err, mensaje) {
    if (input) input.classList.add('invalid');
    if (err) { err.textContent = mensaje; err.classList.add('show'); }
  }

  function valorLocalInput(date) {
    const p = (n) => String(n).padStart(2, '0');
    return date.getFullYear() + '-' + p(date.getMonth() + 1) + '-' + p(date.getDate()) +
      'T' + p(date.getHours()) + ':' + p(date.getMinutes());
  }

  function leerPedido() {
    const nombre = document.getElementById('fName');
    const telefono = document.getElementById('fPhone');
    const zona = document.getElementById('fZone');
    const direccion = document.getElementById('fAddress');
    const referencia = document.getElementById('fRef');
    const nota = document.getElementById('fNote');
    const programado = document.getElementById('whenScheduled') && document.getElementById('whenScheduled').checked;
    const fecha = document.getElementById('fWhen');

    const eNombre = document.getElementById('errName');
    const eTel = document.getElementById('errPhone');
    const eZona = document.getElementById('errZone');
    const eDir = document.getElementById('errAddress');
    const eFecha = document.getElementById('errWhen');

    [ [nombre, eNombre], [telefono, eTel], [zona, eZona], [direccion, eDir], [fecha, eFecha] ]
      .forEach(([input, err]) => limpiarError(input, err));

    let primero = null;
    const fallar = (input, err, msg) => {
      marcarError(input, err, msg);
      if (!primero) primero = input;
    };

    const nombreVal = (nombre.value || '').trim();
    if (nombreVal.length < 3) fallar(nombre, eNombre, 'Escribe tu nombre completo.');

    const telDigitos = onlyDigits(telefono.value);
    if (telDigitos.length < 9 || telDigitos.length > 15) {
      fallar(telefono, eTel, 'Escribe un celular válido (9 dígitos).');
    }

    if (!zona.value || !ZONAS.some((z) => z.id === zona.value)) {
      fallar(zona, eZona, 'Elige una zona de entrega.');
    }

    const dirVal = (direccion.value || '').trim();
    if (dirVal.length < 8) fallar(direccion, eDir, 'Escribe calle, número y referencia.');

    let fechaVal = null;
    if (programado) {
      if (!fecha.value) {
        fallar(fecha, eFecha, 'Elige la fecha y la hora.');
      } else {
        fechaVal = new Date(fecha.value);
        if (isNaN(fechaVal.getTime()) || fechaVal.getTime() < Date.now() - 60000) {
          fallar(fecha, eFecha, 'Elige una fecha y hora futuras.');
        }
      }
    }

    if (primero) {
      primero.focus({ preventScroll: false });
      return null;
    }

    const z = ZONAS.find((x) => x.id === zona.value);
    return {
      nombre: nombreVal,
      telefono: (telefono.value || '').trim(),
      zonaId: zona.value,
      zonaNombre: z ? z.nombre : zona.value,
      direccion: dirVal,
      referencia: (referencia.value || '').trim(),
      nota: (nota.value || '').trim(),
      programado: !!programado,
      fecha: fechaVal,
      cuandoTexto: programado && fechaVal
        ? 'Programado: ' + fechaHora(fechaVal)
        : 'Lo antes posible',
      creado: new Date()
    };
  }

  function construirMensaje(pedido, detalle, numeroPedido) {
    const l = [];
    const sep = '--------------------------------';

    l.push('*NUEVO PEDIDO · EnRuta Delivery*');
    if (numeroPedido) l.push('Pedido web: ' + numeroPedido);
    l.push('Fecha: ' + fechaHora(pedido.creado));
    l.push('Zona: ' + pedido.zonaNombre);
    l.push('Entrega: ' + pedido.cuandoTexto);
    l.push('');
    l.push('*DATOS DEL CLIENTE*');
    l.push('Nombre: ' + pedido.nombre);
    l.push('WhatsApp: ' + pedido.telefono);
    l.push('Dirección: ' + pedido.direccion);
    if (pedido.referencia) l.push('Referencia: ' + pedido.referencia);

    detalle.grupos.forEach((g) => {
      l.push('');
      l.push(sep);
      l.push('*' + g.nombre + '*' + (g.tipo === 'catalogo' ? ' · EnRuta Delivery' : ''));
      g.items.forEach((it) => {
        l.push('- ' + it.cantidad + '× ' + it.nombre + ' — ' + money(it.precio) + ' c/u = ' + money(it.subtotal));
        const opciones = [];
        if (it.varianteNombre) opciones.push('presentación: ' + it.varianteNombre);
        if (it.extras && it.extras.length) opciones.push('extras: ' + it.extras.map((e) => e.nombre).join(', '));
        if (opciones.length) l.push('   (' + opciones.join(' · ') + ')');
      });
      l.push('Productos: ' + money(g.subtotal));
      if (g.tipo === 'local') {
        const emp = g.empaquetado;
        const detalleEmp = g.empaquetadoMonto > 0
          ? (emp.porUnidad ? emp.concepto + ' (' + g.unidades + ' × ' + money(emp.monto) + ')' : emp.concepto)
          : 'sin recargo';
        l.push('Empaquetado: ' + money(g.empaquetadoMonto) + ' · ' + detalleEmp);
      } else {
        l.push('Empaquetado: no aplica');
      }
      l.push('Subtotal: ' + money(round2(g.subtotal + g.empaquetadoMonto)));
    });

    l.push('');
    l.push(sep);
    l.push('*RESUMEN*');
    l.push('Productos: ' + money(detalle.subtotal));
    l.push('Empaquetado: ' + money(detalle.empaquetado));
    l.push('*Total productos + empaquetado: ' + money(detalle.total) + '*');
    l.push('*Delivery: POR COTIZAR*');

    if (pedido.nota) {
      l.push('');
      l.push('*Nota:* ' + pedido.nota);
    }

    l.push('');
    l.push('El costo del delivery se cotiza y confirma por este mismo chat antes de la entrega.');
    l.push('Quedo atento(a) a la confirmación. ¡Gracias!');

    return l.join('\n');
  }

  function abrirWhatsApp(url) {
    const ventana = window.open(url, '_blank', 'noopener');
    if (!ventana) window.location.href = url;
    return !!ventana;
  }

  function itemsParaServidor() {
    return state.cart.map((item) => ({
      tipo: item.tipo === 'local' ? 'local' : 'catalogo',
      localId: item.localId || null,
      catalogoId: item.catalogoId || null,
      productoId: item.productoId,
      varianteId: item.varianteId || null,
      extras: (Array.isArray(item.extras) ? item.extras : [])
        .map((e) => (typeof e === 'string' ? e : e && e.nombre))
        .filter(Boolean),
      cantidad: item.cantidad
    }));
  }

  let promesaServicios = null;

  // Comprueba si el backend está disponible. En un hosting solo estático
  // (por ejemplo GitHub Pages) se oculta el acceso al panel y el pedido
  // se envía directamente por WhatsApp, sin mostrar errores.
  function comprobarServicios(forzar) {
    if (forzar) promesaServicios = null;
    if (promesaServicios) return promesaServicios;
    var metaEntorno = document.querySelector('meta[name="enruta-backend"]');
    if (metaEntorno && String(metaEntorno.content || '').toLowerCase() === 'none') {
      state.apiDisponible = false;
      state.apiComprobada = true;
      $$('.btn-admin, .footer-admin, .admin-dot').forEach((el) => { el.hidden = true; });
      promesaServicios = Promise.resolve(false);
      return promesaServicios;
    }
    promesaServicios = (async () => {
      let disponible = false;
      try {
        const control = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const temporizador = control ? setTimeout(() => control.abort(), 4000) : null;
        const respuesta = await fetch('/api/estado', {
          headers: { Accept: 'application/json' },
          cache: 'no-store',
          signal: control ? control.signal : undefined
        });
        if (temporizador) clearTimeout(temporizador);
        if (respuesta.ok) {
          try {
            const datos = await respuesta.json();
            disponible = !!(datos && datos.ok === true);
          } catch (e) {
            disponible = false;
          }
        }
      } catch (e) {
        disponible = false;
      }
      state.apiDisponible = disponible;
      state.apiComprobada = true;
      if (!disponible) {
        $$('.btn-admin, .footer-admin, .admin-dot').forEach((el) => { el.hidden = true; });
      }
      return disponible;
    })();
    return promesaServicios;
  }

  // Acceso oculto al panel: 5 toques seguidos en el logo (cabecera o pie)
  // con un máximo de 3 segundos entre toques. Funciona con mouse y con
  // pantalla táctil (pointerup). Si el backend no responde se avisa al usuario.
  const SEGUNDOS_ENTRE_TOQUES = 3000;
  let toquesLogo = 0;
  let temporizadorLogo = null;

  async function abrirPanelOculto() {
    toquesLogo = 0;
    if (temporizadorLogo) {
      clearTimeout(temporizadorLogo);
      temporizadorLogo = null;
    }
    const metaEntorno = document.querySelector('meta[name="enruta-backend"]');
    if (metaEntorno && String(metaEntorno.content || '').toLowerCase() === 'none') {
      mostrarToast('El panel de administración requiere el servidor local de EnRuta.');
      return;
    }
    // Se fuerza una comprobación nueva: el servidor pudo arrancar después
    // de cargar la página y la comprobación anterior quedó en falso.
    const disponible = await comprobarServicios(true);
    if (disponible) {
      window.location.href = 'admin/';
      return;
    }
    mostrarToast('No se pudo conectar con el panel. Verifica que el servidor esté encendido.');
  }

  function activarAccesoOculto() {
    const evento = ('PointerEvent' in window) ? 'pointerup' : 'click';
    $$('.brand').forEach((logo) => {
      logo.addEventListener(evento, (e) => {
        // Ignora los toques que forman parte de un desplazamiento.
        toquesLogo += 1;
        if (temporizadorLogo) clearTimeout(temporizadorLogo);
        temporizadorLogo = setTimeout(() => { toquesLogo = 0; }, SEGUNDOS_ENTRE_TOQUES);
        if (toquesLogo >= 5) {
          if (e.cancelable) e.preventDefault();
          abrirPanelOculto();
        }
      });
    });

    const punto = document.getElementById('adminDot');
    if (punto) {
      punto.addEventListener('click', (e) => {
        e.preventDefault();
        abrirPanelOculto();
      });
    }
  }

  async function registrarPedido(pedido) {
    if (!/^https?:$/.test(window.location.protocol)) {
      throw new Error('La página no se abrió desde el servidor local.');
    }
    const control = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const temporizador = control ? setTimeout(() => control.abort(), 15000) : null;
    try {
      const respuesta = await fetch('/api/pedidos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nombre: pedido.nombre,
          telefono: pedido.telefono,
          zonaId: pedido.zonaId,
          direccion: pedido.direccion,
          referencia: pedido.referencia,
          nota: pedido.nota,
          programado: pedido.programado,
          fecha: pedido.programado && pedido.fecha ? valorLocalInput(pedido.fecha) : null,
          cuandoTexto: pedido.cuandoTexto,
          items: itemsParaServidor()
        }),
        signal: control ? control.signal : undefined
      });
      let datos = null;
      try { datos = await respuesta.json(); } catch (e) { datos = null; }
      if (!respuesta.ok) {
        const detalle = datos && datos.error;
        if (detalle) throw new Error(detalle);
        if (respuesta.status === 502 || respuesta.status === 503 || respuesta.status === 504) {
          throw new Error('El servidor no está disponible en este momento.');
        }
        throw new Error('No se pudo registrar el pedido (HTTP ' + respuesta.status + ').');
      }
      if (!datos || !datos.ok) {
        throw new Error((datos && datos.error) || 'El servidor no confirmó el pedido.');
      }
      return datos;
    } catch (error) {
      if (error && error.name === 'AbortError') {
        throw new Error('El servidor tardó demasiado en responder.');
      }
      if (error instanceof TypeError) {
        throw new Error('No se pudo conectar con el servidor local.');
      }
      throw error;
    } finally {
      if (temporizador) clearTimeout(temporizador);
    }
  }

  async function procesarPedido(evento) {
    evento.preventDefault();
    if (state.enviando) return;
    const detalle = calcularDetalle();
    if (!detalle.unidades) {
      mostrarToast('Agrega al menos un producto');
      return;
    }
    const pedido = leerPedido();
    if (!pedido) return;

    const boton = document.getElementById('sendOrder');
    const textoOriginal = boton ? boton.innerHTML : '';
    state.enviando = true;
    if (boton) {
      boton.disabled = true;
      boton.textContent = 'Registrando pedido…';
    }

    await comprobarServicios();

    let registro = null;
    let errorRegistro = null;
    if (state.apiDisponible) {
      try {
        registro = await registrarPedido(pedido);
      } catch (error) {
        errorRegistro = error;
      }
    }

    const mensajeBase = construirMensaje(pedido, detalle, registro && registro.pedidoId);
    const mensaje = registro && registro.total != null
      ? mensajeBase + '\n\nTotal registrado en EnRuta: ' + money(registro.total)
      : mensajeBase;

    track('pedido_whatsapp', {
      currency: 'PEN',
      value: detalle.total,
      items: detalle.unidades
    });

    if (state.clienteGuardado) {
      sincronizarPerfilDesdeFormulario();
      guardarDireccionActual();
    }

    const abierto = abrirWhatsApp(waLink(mensaje));
    registrarVenta(state.cart);
    state.cart = [];
    guardarCarrito();
    state.paso = 'productos';
    renderCart();
    renderCategorias();
    const nota = document.getElementById('fNote');
    if (nota) nota.value = '';
    if (state.clienteGuardado) {
      state.cliente.nota = '';
      persistirCliente();
    }

    const mini = document.getElementById('sendMini');
    if (registro) {
      if (mini) mini.textContent = 'Pedido ' + registro.pedidoId + ' registrado. Se abrió WhatsApp para confirmarlo.';
      mostrarToast(abierto ? 'Pedido registrado. Revisa WhatsApp.' : 'Pedido registrado. Abriendo WhatsApp…');
    } else if (!state.apiDisponible) {
      if (mini) mini.textContent = 'Abrimos WhatsApp con tu pedido. Ahí confirmamos disponibilidad y costo de delivery.';
      mostrarToast(abierto ? 'Pedido enviado a WhatsApp.' : 'Abriendo WhatsApp…');
    } else {
      const motivo = (errorRegistro && errorRegistro.message ? errorRegistro.message : 'sin conexión con el servidor').replace(/\.+$/, '');
      if (mini) mini.textContent = 'No se pudo registrar en línea (' + motivo + '). Enviamos el pedido por WhatsApp para confirmarlo.';
      mostrarToast('Pedido enviado a WhatsApp. No se pudo registrar en línea.');
    }

    state.enviando = false;
    if (boton) {
      boton.disabled = false;
      boton.innerHTML = textoOriginal;
    }
    setTimeout(cerrarTodo, 700);
  }

  /* ---------------- Toast ---------------- */
  let toastTimer = null;
  function mostrarToast(texto) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = texto;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
  }

  /* ---------------- Interacción ---------------- */
  function refrescarTrasCarrito(desdeCarrito) {
    renderCart();
    renderCategorias();
    if (state.activeLocal) renderModal(false);
    if (!desdeCarrito) mostrarToast('Agregado a tu pedido');
  }

  function manejarAdd(btn) {
    const delta = parseInt(btn.dataset.delta || '1', 10);
    const tipo = btn.dataset.tipo === 'local' ? 'local' : 'catalogo';
    let extras = [];
    if (btn.dataset.extras) {
      try {
        const parseados = JSON.parse(btn.dataset.extras);
        if (Array.isArray(parseados)) extras = parseados.map(String).filter(Boolean);
      } catch (e) {
        extras = [];
      }
    }
    const ids = {
      tipo,
      localId: btn.dataset.local || null,
      catalogoId: btn.dataset.catalogo || null,
      productoId: btn.dataset.producto,
      varianteId: btn.dataset.variante || null,
      extras
    };
    ajustarCantidad(ids, delta);
    const desdeCarrito = !!btn.closest('#cartItems');
    refrescarTrasCarrito(desdeCarrito);
  }

  function actualizarTotalOpciones(contenedor) {
    if (!contenedor) return;
    const selector = contenedor.querySelector('[data-op-variante]');
    let total = 0;
    if (selector) {
      const opcion = selector.options[selector.selectedIndex];
      total = Number(opcion && opcion.dataset.precio) || 0;
    } else {
      const local = localesPorId.get(contenedor.dataset.opLocal);
      const p = local && (local.productos || []).find((x) => x.id === contenedor.dataset.opProducto);
      total = p ? Number(p.precio) || 0 : 0;
    }
    $$('[data-op-extra]:checked', contenedor).forEach((chk) => {
      total += Number(chk.dataset.precio) || 0;
    });
    const etiqueta = contenedor.querySelector('[data-op-total]');
    if (etiqueta) etiqueta.textContent = money(total);
  }

  function manejarAddOpciones(btn) {
    const contenedor = btn.closest('.menu-opts');
    if (!contenedor) return;
    const local = localesPorId.get(contenedor.dataset.opLocal);
    if (!local) return;
    const producto = (local.productos || []).find((x) => x.id === contenedor.dataset.opProducto);
    if (!producto) return;
    const selector = contenedor.querySelector('[data-op-variante]');
    const extrasDisponibles = extrasValidos(producto);
    const extras = $$('[data-op-extra]:checked', contenedor)
      .map((chk) => extrasDisponibles[Number(chk.dataset.opExtra)])
      .filter(Boolean)
      .map((e) => e.nombre);
    ajustarCantidad({
      tipo: 'local',
      localId: local.id,
      catalogoId: null,
      productoId: producto.id,
      varianteId: selector ? selector.value : null,
      extras
    }, 1);
    refrescarTrasCarrito(false);
  }

  /* ---------------- Recojo/envío y taximoto ---------------- */
  function telefonoServicioValido(valor) {
    const digitos = onlyDigits(valor);
    return digitos.length >= 9 && digitos.length <= 15;
  }

  function valorCampo(id) {
    const el = document.getElementById(id);
    return el ? String(el.value || '').trim() : '';
  }

  function marcarCampoServicio(inputId, errId, mensaje) {
    const input = document.getElementById(inputId);
    const err = document.getElementById(errId);
    if (input) input.classList.toggle('invalid', !!mensaje);
    if (err) {
      err.textContent = mensaje || '';
      err.classList.toggle('show', !!mensaje);
    }
  }

  function requeridoServicio(inputId, errId, minimo, mensaje) {
    const valor = valorCampo(inputId);
    if (valor.length < minimo) {
      marcarCampoServicio(inputId, errId, mensaje);
      return '';
    }
    marcarCampoServicio(inputId, errId, '');
    return valor;
  }

  function telefonoServicioRequerido(inputId, errId, mensaje) {
    const valor = valorCampo(inputId);
    if (!telefonoServicioValido(valor)) {
      marcarCampoServicio(inputId, errId, mensaje);
      return '';
    }
    marcarCampoServicio(inputId, errId, '');
    return valor;
  }

  function leerCuandoServicio(nombre) {
    let cuando = 'urgente';
    $$('input[name="' + nombre + '"]').forEach((r) => { if (r.checked) cuando = r.value; });
    const fechaId = nombre === 'envioCuando' ? 'eFecha' : 'tFecha';
    return {
      cuando: cuando === 'programado' ? 'programado' : 'urgente',
      fecha: cuando === 'programado' ? valorCampo(fechaId) : ''
    };
  }

  function textoCuandoServicio(info) {
    if (info.cuando !== 'programado') return 'Urgente (lo antes posible)';
    const fecha = new Date(info.fecha);
    return isNaN(fecha.getTime()) ? 'Programado' : 'Programado: ' + fechaHora(fecha);
  }

  function validarCuandoServicio(info, inputId, errId) {
    if (info.cuando !== 'programado') {
      marcarCampoServicio(inputId, errId, '');
      return true;
    }
    if (!info.fecha) {
      marcarCampoServicio(inputId, errId, 'Elige la fecha y hora.');
      return false;
    }
    const fecha = new Date(info.fecha);
    if (isNaN(fecha.getTime()) || fecha.getTime() < Date.now() - 5 * 60 * 1000) {
      marcarCampoServicio(inputId, errId, 'La fecha y hora deben ser futuras.');
      return false;
    }
    marcarCampoServicio(inputId, errId, '');
    return true;
  }

  function actualizarCuandoServicio(tipo) {
    const nombre = tipo === 'envio' ? 'envioCuando' : 'taximotoCuando';
    const field = document.getElementById(tipo === 'envio' ? 'eFechaField' : 'tFechaField');
    if (!field) return;
    let programado = false;
    $$('input[name="' + nombre + '"]').forEach((r) => { if (r.checked && r.value === 'programado') programado = true; });
    field.hidden = !programado;
  }

  async function registrarServicio(tipo, datos) {
    const url = tipo === 'envio' ? '/api/envios' : '/api/taximotos';
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(datos)
    });
    const texto = await res.text();
    let info = null;
    if (texto) { try { info = JSON.parse(texto); } catch (e) { info = { error: texto }; } }
    if (!res.ok) {
      throw new Error((info && (info.error || info.mensaje)) || 'No se pudo guardar la solicitud.');
    }
    return info || {};
  }

  function mensajeEnvioServicio(d, registro) {
    return '*Recojo y envío · EnRuta Delivery*\n' +
      (registro && registro.servicioId ? 'Solicitud: ' + registro.servicioId + '\n' : '') +
      '\n*Qué se recoge:* ' + d.descripcion + '\n' +
      '*Recojo:* ' + d.origen + '\n' +
      '*Entrega:* ' + d.destino + '\n' +
      '*Contacto:* ' + d.nombre + ' · ' + d.telefono + '\n' +
      (d.observaciones ? '*Observaciones:* ' + d.observaciones + '\n' : '') +
      '*Cuándo:* ' + textoCuandoServicio(d) + '\n' +
      '\nQuedo atento a la confirmación del costo y del tiempo.';
  }

  function mensajeTaximoto(d, registro) {
    return '*Taximoto · EnRuta Delivery*\n' +
      (registro && registro.servicioId ? 'Solicitud: ' + registro.servicioId + '\n' : '') +
      '\n*Recojo:* ' + d.origen + '\n' +
      '*Destino:* ' + d.destino + '\n' +
      (d.referencia ? '*Referencia:* ' + d.referencia + '\n' : '') +
      '*Cuándo:* ' + textoCuandoServicio(d) + '\n' +
      '\nQuedo atento a la confirmación de la unidad y del costo.';
  }

  async function procesarServicio(evento, tipo) {
    evento.preventDefault();
    const form = evento.currentTarget;
    const esEnvio = tipo === 'envio';
    const prefijo = esEnvio ? 'envio' : 'taximoto';
    const err = document.getElementById(prefijo + 'Error');
    const ok = document.getElementById(prefijo + 'Ok');
    const btn = document.getElementById(prefijo + 'Btn');
    if (btn && btn.disabled) return;
    if (err) { err.hidden = true; err.textContent = ''; }
    if (ok) { ok.hidden = true; ok.textContent = ''; }

    let valido = true;
    const datos = {};
    if (esEnvio) {
      datos.descripcion = requeridoServicio('eDescripcion', 'errEDescripcion', 3, 'Escribe qué se recoge.');
      datos.origen = requeridoServicio('eOrigen', 'errEOrigen', 6, 'Escribe la dirección de recojo.');
      datos.destino = requeridoServicio('eDestino', 'errEDestino', 6, 'Escribe la dirección de entrega.');
      datos.nombre = requeridoServicio('eNombre', 'errENombre', 3, 'Escribe tu nombre.');
      datos.telefono = telefonoServicioRequerido('eTelefono', 'errETelefono', 'Teléfono inválido (9 a 15 dígitos).');
      datos.observaciones = valorCampo('eObservaciones');
      if (datos.descripcion.length > 400) {
        marcarCampoServicio('eDescripcion', 'errEDescripcion', 'Máximo 400 caracteres.');
        datos.descripcion = '';
      }
      if (datos.observaciones.length > 600) {
        marcarCampoServicio('eObservaciones', 'errEObservaciones', 'Máximo 600 caracteres.');
        datos.observaciones = '';
      }
      if (!datos.descripcion || !datos.origen || !datos.destino || !datos.nombre || !datos.telefono) valido = false;
    } else {
      datos.origen = requeridoServicio('tOrigen', 'errTOrigen', 6, 'Escribe el punto de recojo.');
      datos.destino = requeridoServicio('tDestino', 'errTDestino', 6, 'Escribe el destino.');
      datos.referencia = valorCampo('tReferencia');
      if (datos.referencia.length > 240) {
        marcarCampoServicio('tReferencia', 'errTReferencia', 'Máximo 240 caracteres.');
        valido = false;
      } else {
        marcarCampoServicio('tReferencia', 'errTReferencia', '');
      }
      if (!datos.origen || !datos.destino) valido = false;
    }

    const cuandoInfo = leerCuandoServicio(esEnvio ? 'envioCuando' : 'taximotoCuando');
    const fechaInput = esEnvio ? 'eFecha' : 'tFecha';
    const fechaErr = esEnvio ? 'errEFecha' : 'errTFecha';
    if (!validarCuandoServicio(cuandoInfo, fechaInput, fechaErr)) valido = false;
    datos.cuando = cuandoInfo.cuando;
    datos.fecha = cuandoInfo.fecha || null;

    if (!valido) {
      if (err) {
        err.textContent = 'Revisa los campos marcados antes de enviar.';
        err.hidden = false;
      }
      return;
    }

    const textoOriginal = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = 'Enviando…'; }

    await comprobarServicios();

    let registro = null;
    let fallo = null;
    const paraServidor = esEnvio
      ? {
          origen: datos.origen,
          destino: datos.destino,
          nombreEnvia: datos.nombre,
          telefonoEnvia: datos.telefono,
          nombreRecibe: datos.nombre,
          telefonoRecibe: datos.telefono,
          descripcion: datos.descripcion,
          observaciones: datos.observaciones,
          cuando: datos.cuando,
          fecha: datos.fecha
        }
      : {
          origen: datos.origen,
          destino: datos.destino,
          referencia: datos.referencia,
          cuando: datos.cuando,
          fecha: datos.fecha
        };
    if (state.apiDisponible) {
      try {
        registro = await registrarServicio(tipo, paraServidor);
      } catch (e) {
        fallo = e;
      }
    }

    const mensaje = esEnvio ? mensajeEnvioServicio(datos, registro) : mensajeTaximoto(datos, registro);
    const abierto = abrirWhatsApp(waLink(mensaje));

    if (ok) {
      if (registro && registro.servicioId) {
        ok.textContent = 'Solicitud ' + registro.servicioId + ' registrada. Se abrió WhatsApp para confirmar disponibilidad y costo.';
      } else if (!state.apiDisponible) {
        ok.textContent = 'Abrimos WhatsApp con tu solicitud. Ahí confirmamos disponibilidad y costo.';
      } else {
        ok.textContent = 'No pudimos guardar la solicitud en el servidor' +
          (fallo && fallo.message ? ' (' + fallo.message + ')' : '') +
          ', pero abrimos WhatsApp con todos los datos.';
      }
      ok.hidden = false;
      try { ok.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (e) { /* sin scroll suave */ }
    }
    track('service_request', { service: tipo, registered: !!(registro && registro.servicioId) });
    mostrarToast(abierto ? 'Solicitud lista. Revisa WhatsApp.' : 'Abriendo WhatsApp…');

    if (form) form.reset();
    actualizarCuandoServicio(tipo);
    if (btn) { btn.disabled = false; btn.textContent = textoOriginal; }
  }

  const SERVICIO_TEXTOS = {
    taximoto: { titulo: 'Taximoto', kicker: 'Servicio de transporte' },
    envio: { titulo: 'Recojo y envío', kicker: 'Servicio de entregas' }
  };

  function limpiarEstadoFormulario(form) {
    if (!form) return;
    const err = form.querySelector('.form-error');
    const ok = form.querySelector('.form-ok');
    if (err) { err.hidden = true; err.textContent = ''; }
    if (ok) { ok.hidden = true; ok.textContent = ''; }
    $$('.err', form).forEach((el) => { el.textContent = ''; el.classList.remove('show'); });
    $$('.invalid', form).forEach((el) => el.classList.remove('invalid'));
  }

  function abrirSheet(tipo) {
    const cfg = SERVICIO_TEXTOS[tipo];
    if (!cfg) return;
    cerrarCarrito();
    cerrarModal();
    state.servicioTipo = tipo;
    state.servicioFoco = document.activeElement;

    $$('.sheet-form').forEach((form) => {
      const activo = form.dataset.serviceForm === tipo;
      form.hidden = !activo;
      if (activo) limpiarEstadoFormulario(form);
    });

    const titulo = document.getElementById('sheetTitle');
    if (titulo) titulo.textContent = cfg.titulo;
    const kicker = document.getElementById('sheetKicker');
    if (kicker) kicker.textContent = cfg.kicker;

    const sheet = document.getElementById('serviceSheet');
    if (!sheet) return;
    sheet.classList.add('open');
    sheet.setAttribute('aria-hidden', 'false');
    const overlay = document.getElementById('overlay');
    if (overlay) { overlay.hidden = false; overlay.classList.add('show'); }
    document.body.classList.add('no-scroll');
    actualizarCuandoServicio(tipo);

    const card = sheet.querySelector('.sheet-card');
    if (card) {
      requestAnimationFrame(() => card.focus({ preventScroll: true }));
    }
    track('service_open', { service: tipo });
  }

  function cerrarSheet() {
    const sheet = document.getElementById('serviceSheet');
    if (!sheet || !sheet.classList.contains('open')) return;
    sheet.classList.remove('open');
    sheet.setAttribute('aria-hidden', 'true');
    state.servicioTipo = null;
    sincronizarOverlay();
    actualizarBloqueoScroll();
    const foco = state.servicioFoco;
    state.servicioFoco = null;
    if (foco && typeof foco.focus === 'function' && document.contains(foco)) {
      try { foco.focus({ preventScroll: true }); } catch (e) { foco.focus(); }
    }
  }

  function programarTaximoto(horas) {
    const radio = document.getElementById('tProgramado');
    if (radio) radio.checked = true;
    const fecha = new Date(Date.now() + horas * 60 * 60 * 1000);
    const pad = (n) => String(n).padStart(2, '0');
    const valor = fecha.getFullYear() + '-' + pad(fecha.getMonth() + 1) + '-' + pad(fecha.getDate()) +
      'T' + pad(fecha.getHours()) + ':' + pad(fecha.getMinutes());
    const input = document.getElementById('tFecha');
    if (input) input.value = valor;
    const err = document.getElementById('errTFecha');
    if (err) err.textContent = '';
    actualizarCuandoServicio('taximoto');
  }

  function activarServicios() {
    const envioForm = document.getElementById('envioForm');
    if (envioForm) envioForm.addEventListener('submit', (e) => procesarServicio(e, 'envio'));
    const taximotoForm = document.getElementById('taximotoForm');
    if (taximotoForm) taximotoForm.addEventListener('submit', (e) => procesarServicio(e, 'taximoto'));

    $$('input[name="envioCuando"]').forEach((r) => r.addEventListener('change', () => actualizarCuandoServicio('envio')));
    $$('input[name="taximotoCuando"]').forEach((r) => r.addEventListener('change', () => actualizarCuandoServicio('taximoto')));

    const unaHora = document.getElementById('tEnUnaHora');
    if (unaHora) unaHora.addEventListener('click', () => programarTaximoto(1));
    const dosHoras = document.getElementById('tEnDosHoras');
    if (dosHoras) dosHoras.addEventListener('click', () => programarTaximoto(2));

    $$('[data-service-open]').forEach((btn) => {
      btn.addEventListener('click', () => abrirSheet(btn.dataset.serviceOpen));
    });

    const sheetClose = document.getElementById('sheetClose');
    if (sheetClose) sheetClose.addEventListener('click', cerrarSheet);
    const sheet = document.getElementById('serviceSheet');
    if (sheet) {
      sheet.addEventListener('click', (e) => {
        if (e.target === sheet) cerrarSheet();
      });
    }

    $$('#taximotoForm input, #envioForm input, #envioForm textarea').forEach((input) => {
      input.addEventListener('input', () => {
        input.classList.remove('invalid');
        const err = input.parentElement ? input.parentElement.querySelector('.err') : null;
        if (err) { err.textContent = ''; err.classList.remove('show'); }
      });
    });
  }

  function enlazarEventos() {
    const grid = document.getElementById('localsGrid');
    if (grid) {
      grid.addEventListener('click', (e) => {
        const card = e.target.closest('[data-local]');
        if (card) abrirLocal(card.dataset.local);
      });
      grid.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        const card = e.target.closest('[data-local]');
        if (!card) return;
        e.preventDefault();
        abrirLocal(card.dataset.local);
      });
    }

    $$('.tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        state.tab = tab.dataset.tab || 'todo';
        state.catLocal = 'todo';
        renderLocales();
      });
    });

    const chipsZona = document.getElementById('chipsZona');
    if (chipsZona) {
      chipsZona.addEventListener('click', (e) => {
        const chip = e.target.closest('.chip');
        if (!chip) return;
        state.zonaLocal = chip.dataset.zona || 'todo';
        renderLocales();
      });
    }

    const chips = document.getElementById('chips');
    if (chips) {
      chips.addEventListener('click', (e) => {
        const chip = e.target.closest('.chip');
        if (!chip) return;
        state.catLocal = chip.dataset.cat || 'todo';
        renderLocales();
      });
    }

    SECCIONES.forEach((sec) => {
      const cont = document.getElementById(sec.chips);
      if (!cont) return;
      cont.addEventListener('click', (e) => {
        const chip = e.target.closest('.chip');
        if (!chip) return;
        state.catCatalogos[sec.id] = chip.dataset.cat || 'todo';
        renderCatalogo(sec);
      });
    });

    const reset = document.getElementById('resetFilters');
    if (reset) {
      reset.addEventListener('click', () => {
        state.tab = 'todo';
        state.catLocal = 'todo';
        state.q = '';
        Object.keys(state.catCatalogos).forEach((k) => { state.catCatalogos[k] = 'todo'; });
        const input = document.getElementById('searchInput');
        if (input) input.value = '';
        renderTodo();
      });
    }

    const search = document.getElementById('searchInput');
    if (search) {
      let timer = null;
      search.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          state.q = search.value.trim();
          renderLocales();
          renderCategorias();
          renderResultados();
        }, 140);
      });
    }
    const buscar = () => {
      state.q = search.value.trim();
      renderLocales();
      renderCategorias();
      renderResultados();
      if (state.q) track('search', { search_term: state.q });
    };
    const searchGo = document.getElementById('searchGo');
    if (searchGo && search) {
      searchGo.addEventListener('click', buscar);
      search.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          buscar();
        }
      });
    }

    document.addEventListener('click', (e) => {
      const more = e.target.closest('[data-cat-more]');
      if (!more) return;
      const sec = SECCIONES.find((s) => s.id === more.dataset.sec);
      if (!sec) return;
      const catId = more.dataset.catMore || 'otros';
      state.expandidos[sec.id] = state.expandidos[sec.id] || {};
      state.expandidos[sec.id][catId] = !state.expandidos[sec.id][catId];
      renderCatalogo(sec);
    });

    const status = document.getElementById('searchStatus');
    if (status) {
      status.addEventListener('click', (e) => {
        if (e.target.closest('#searchClear')) limpiarBusqueda();
      });
    }

    document.addEventListener('change', (e) => {
      if (e.target.closest('[data-op-variante], [data-op-extra]')) {
        actualizarTotalOpciones(e.target.closest('.menu-opts'));
      }
    });

    document.addEventListener('click', (e) => {
      const addOptions = e.target.closest('[data-add-options]');
      if (addOptions) {
        e.preventDefault();
        manejarAddOpciones(addOptions);
        return;
      }
      const add = e.target.closest('[data-add]');
      if (add) {
        e.preventDefault();
        manejarAdd(add);
        return;
      }
      const remove = e.target.closest('[data-remove]');
      if (remove) {
        e.preventDefault();
        quitarItem(remove.dataset.remove);
        refrescarTrasCarrito(true);
        mostrarToast('Producto quitado');
        return;
      }
      if (e.target.closest('[data-open-cart]')) {
        e.preventDefault();
        cerrarModal();
        abrirCarrito();
      }
    });

    const cartBtn = document.getElementById('cartBtn');
    if (cartBtn) cartBtn.addEventListener('click', abrirCarrito);
    const cartClose = document.getElementById('cartClose');
    if (cartClose) cartClose.addEventListener('click', cerrarCarrito);
    const cartNext = document.getElementById('cartNext');
    if (cartNext) {
      cartNext.addEventListener('click', () => {
        if (state.paso === 'productos') irPasoCarrito('datos');
        else irPasoCarrito('enviar', true);
      });
    }
    const cartBack = document.getElementById('cartBack');
    if (cartBack) {
      cartBack.addEventListener('click', () => {
        irPasoCarrito(state.paso === 'enviar' ? 'datos' : 'productos');
      });
    }
    const modalClose = document.getElementById('modalClose');
    if (modalClose) modalClose.addEventListener('click', cerrarModal);
    const modalBack = document.getElementById('modalBack');
    if (modalBack) modalBack.addEventListener('click', cerrarModal);
    const modalEl = document.getElementById('modal');
    if (modalEl) {
      modalEl.addEventListener('click', (e) => {
        if (e.target === modalEl) cerrarModal();
      });
    }

    const overlay = document.getElementById('overlay');
    if (overlay) overlay.addEventListener('click', cerrarTodo);

    const emptyCta = document.getElementById('emptyCta');
    if (emptyCta) {
      emptyCta.addEventListener('click', () => {
        cerrarCarrito();
        const destino = document.getElementById('locales');
        if (destino) destino.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }

    const clear = document.getElementById('clearCart');
    if (clear) clear.addEventListener('click', vaciarCarrito);

    const form = document.getElementById('orderForm');
    if (form) {
      form.addEventListener('submit', procesarPedido);
    }

    const addrSelect = document.getElementById('addrSelect');
    if (addrSelect) {
      addrSelect.addEventListener('change', () => {
        const id = addrSelect.value;
        if (id) {
          aplicarDireccion(id);
        } else {
          state.cliente.ultimaDireccionId = null;
          persistirCliente();
          const dir = document.getElementById('fAddress');
          const ref = document.getElementById('fRef');
          if (dir) dir.value = '';
          if (ref) ref.value = '';
          renderLibreta();
        }
      });
    }
    const addrSave = document.getElementById('addrSave');
    if (addrSave) addrSave.addEventListener('click', guardarDireccionActual);
    const addrDelete = document.getElementById('addrDelete');
    if (addrDelete) addrDelete.addEventListener('click', eliminarDireccionActual);
    const clearSaved = document.getElementById('clearSavedData');
    if (clearSaved) clearSaved.addEventListener('click', borrarDatosGuardados);

    const saveData = document.getElementById('saveData');
    if (saveData) {
      saveData.addEventListener('change', () => {
        if (saveData.checked) {
          try { localStorage.removeItem(CLIENTE_OPTOUT_KEY); } catch (e) { /* sin almacenamiento */ }
          state.clienteGuardado = true;
          sincronizarPerfilDesdeFormulario();
          persistirCliente();
          mostrarToast('Recordaremos tus datos en este dispositivo.');
        } else {
          try {
            localStorage.removeItem(CLIENTE_KEY);
            localStorage.setItem(CLIENTE_OPTOUT_KEY, '1');
          } catch (e) { /* sin almacenamiento */ }
          state.clienteGuardado = false;
          mostrarToast('No guardaremos tus datos en este dispositivo.');
        }
      });
    }

    let timerPerfil = null;
    ['fName', 'fPhone', 'fNote'].forEach((id) => {
      const input = document.getElementById(id);
      if (!input) return;
      input.addEventListener('input', () => {
        if (!state.clienteGuardado) return;
        clearTimeout(timerPerfil);
        timerPerfil = setTimeout(sincronizarPerfilDesdeFormulario, 450);
      });
    });

    const programado = document.getElementById('whenScheduled');
    const asap = document.getElementById('whenAsap');
    const campo = document.getElementById('scheduledField');
    const fecha = document.getElementById('fWhen');
    function actualizarCuando() {
      const esProgramado = !!(programado && programado.checked);
      if (campo) campo.hidden = !esProgramado;
      if (fecha && esProgramado && !fecha.min) fecha.min = valorLocalInput(new Date());
    }
    if (programado) programado.addEventListener('change', actualizarCuando);
    if (asap) asap.addEventListener('change', actualizarCuando);
    actualizarCuando();

    [['fName', 'errName'], ['fPhone', 'errPhone'], ['fAddress', 'errAddress'], ['fZone', 'errZone']].forEach(([i, e]) => {
      const input = document.getElementById(i);
      const err = document.getElementById(e);
      if (!input) return;
      const evento = input.tagName === 'SELECT' ? 'change' : 'input';
      input.addEventListener(evento, () => limpiarError(input, err));
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') cerrarTodo();
    });
  }

  /* ---------------- Arranque ---------------- */
  /* ---------------- Barra inferior tipo app ---------------- */
function actualizarAppbar() {
  const cont = document.getElementById('appbarCount');
  if (!cont) return;
  const unidades = state.cart.reduce((s, it) => s + (Number(it.cantidad) || 0), 0);
  cont.textContent = String(unidades);
  cont.hidden = unidades === 0;
}

/* ---------------- Resultados en vivo bajo la barra ---------------- */
function filaResumenLocal(l) {
  return '<button type="button" class="res-item" data-local="' + esc(l.id) + '">' +
    '<span class="res-thumb">' + esc(l.emoji || '🏪') + '</span>' +
    '<span class="res-info"><b>' + esc(l.nombre) + '</b><small>' + esc(l.categoriaNombre || 'Local') + '</small></span>' +
    '<span class="res-ir">Ver carta →</span>' +
    '</button>';
}

function filaResumenProducto(par) {
  const p = par.p;
  const ids = { tipo: 'catalogo', catalogoId: par.c.id, productoId: p.id };
  const cantidad = cantidadEnCarrito(ids);
  const seccion = par.c.id === 'licores' ? 'Licores' : 'Primera necesidad';
  const miniatura = p.imagen
    ? '<span class="res-thumb res-thumb-img"><img src="' + esc(p.imagen) + '" alt="" loading="lazy" decoding="async"></span>'
    : '<span class="res-thumb">' + esc(p.emoji || '🛒') + '</span>';
  return '<div class="res-item res-prod">' +
    miniatura +
    '<span class="res-info"><b>' + esc(p.nombre) + '</b><small>' + esc(seccion) + (p.presentacion ? ' · ' + esc(p.presentacion) : '') + '</small></span>' +
    '<span class="res-precio">' + money(p.precioVenta) + '</span>' +
    controlCantidad('catalogo', ids, cantidad, 'sm') +
    '</div>';
}

function renderResultados() {
  const caja = document.getElementById('resultadosBusqueda');
  if (!caja) return;
  const consulta = String(state.q || '').trim();
  if (!consulta) { caja.hidden = true; return; }

  const locales = LOCALES.filter(localCoincide);
  const productos = [];
  CATALOGOS.forEach((c) => {
    (c.productos || []).forEach((p) => {
      if (productoCatalogoCoincide(c, p)) productos.push({ c, p });
    });
  });

  const lista = document.getElementById('resLista');
  if (lista) {
    let html = '';
    if (productos.length) {
      html += '<p class="res-sub">🏪 En Ruta Market · ' + productos.length + '</p>' +
        productos.slice(0, 7).map(filaResumenProducto).join('');
      if (productos.length > 7) html += '<p class="res-mas">+' + (productos.length - 7) + ' productos en En Ruta Market</p>';
    }
    if (locales.length) {
      html += '<p class="res-sub">Locales · ' + locales.length + '</p>' +
        locales.slice(0, 4).map(filaResumenLocal).join('');
      if (locales.length > 4) html += '<p class="res-mas">+' + (locales.length - 4) + ' locales en la sección Locales</p>';
    }
    if (!html) html = '<p class="res-vacio">No encontramos «' + esc(consulta) + '». Prueba con otra palabra o escríbenos por WhatsApp.</p>';
    lista.innerHTML = html;
  }

  caja.hidden = false;
  const estado = document.getElementById('searchStatus');
  if (estado) estado.hidden = true;
}

/* ---------------- Pestañas de En Ruta Market ---------------- */
function activarMarket(tab) {
  state.marketTab = tab === 'despensa' ? 'despensa' : 'licores';
  const panelLicores = document.getElementById('panelLicores');
  const panelNec = document.getElementById('panelNec');
  if (panelLicores) panelLicores.hidden = state.marketTab !== 'licores';
  if (panelNec) panelNec.hidden = state.marketTab !== 'despensa';
  $$('#tabsMarket .tab').forEach((b) => {
    const activo = b.dataset.market === state.marketTab;
    b.classList.toggle('is-active', activo);
    b.setAttribute('aria-selected', activo ? 'true' : 'false');
  });
}

function iniciarMarket() {
  const tabs = document.getElementById('tabsMarket');
  if (tabs) {
    tabs.addEventListener('click', (e) => {
      const b = e.target.closest('.tab');
      if (b) activarMarket(b.dataset.market);
    });
  }
  $$('[data-market-link]').forEach((a) => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      activarMarket(a.dataset.marketLink);
      const market = document.getElementById('market');
      if (market) market.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
  const caja = document.getElementById('resultadosBusqueda');
  if (caja) {
    caja.addEventListener('click', (e) => {
      const local = e.target.closest('[data-local]');
      if (local) { abrirLocal(local.dataset.local); return; }
      if (e.target.closest('#resLimpiar')) { limpiarBusqueda(); return; }
    });
  }
  activarMarket(state.marketTab);
}

/* ---------------- Instalar como app ---------------- */
let promptInstalar = null;

function iniciarInstalacion() {
  const caja = document.getElementById('instalarApp');
  if (!caja) return;
  const independiente = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  if (independiente) return;

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    promptInstalar = e;
    caja.hidden = false;
  });

  const cerrar = document.getElementById('instalarCerrar');
  if (cerrar) cerrar.addEventListener('click', () => { caja.hidden = true; });

  const boton = document.getElementById('instalarBtn');
  if (boton) {
    boton.addEventListener('click', async () => {
      if (!promptInstalar) {
        caja.hidden = true;
        return;
      }
      promptInstalar.prompt();
      try { await promptInstalar.userChoice; } catch (e) { /* sin eleccion */ }
      promptInstalar = null;
      caja.hidden = true;
    });
  }
}

function iniciarAppbar() {
  const pedido = document.getElementById('appbarPedido');
  if (pedido) {
    pedido.addEventListener('click', () => {
      const btn = document.getElementById('cartBtn');
      if (btn) btn.click();
    });
  }

  const botones = $$('.appbar-btn[data-appbar]');
  const secciones = [
    ['inicio', document.body],
    ['locales', document.getElementById('locales')]
  ].filter((par) => par[1]);
  if (!botones.length) {
    actualizarAppbar();
    return;
  }

  const marcar = (id) => {
    botones.forEach((b) => b.classList.toggle('is-active', b.dataset.appbar === id));
  };
  const margen = () => {
    const cabecera = document.querySelector('.header');
    return (cabecera ? cabecera.offsetHeight : 64) + 10;
  };

  const activaSegunScroll = () => {
    const marketEl = document.getElementById('market');
    if (marketEl) {
      const arribaMarket = marketEl.getBoundingClientRect().top + window.scrollY;
      if (arribaMarket <= window.scrollY + margen() + Math.min(window.innerHeight * 0.35, 220)) {
        return state.marketTab === 'despensa' ? 'despensa' : 'licores';
      }
    }
    const limite = window.scrollY + margen() + Math.min(window.innerHeight * 0.35, 220);
    let activa = 'inicio';
    for (const [id, el] of secciones) {
      const arriba = el.getBoundingClientRect().top + window.scrollY;
      if (arriba <= limite) activa = id;
    }
    return activa;
  };

  let pendiente = false;
  window.addEventListener('scroll', () => {
    if (pendiente) return;
    pendiente = true;
    requestAnimationFrame(() => {
      pendiente = false;
      marcar(activaSegunScroll());
    });
  }, { passive: true });

  botones.forEach((b) => {
    b.addEventListener('click', (e) => {
      const id = b.dataset.appbar;
      e.preventDefault();
      if (id === 'licores' || id === 'despensa') {
        activarMarket(id);
        const marketEl = document.getElementById('market');
        if (marketEl) {
          const y = marketEl.getBoundingClientRect().top + window.scrollY - margen();
          window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
        }
      } else {
        const destino = secciones.find((par) => par[0] === id);
        if (!destino) return;
        const y = destino[1].getBoundingClientRect().top + window.scrollY - margen();
        window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
      }
      marcar(id);
      history.replaceState(null, '', '#' + id);
    });
  });

  marcar(activaSegunScroll());
  actualizarAppbar();
}

function init() {
    aplicarConfig();
    state.cliente = leerClienteGuardado();
    try {
      state.clienteGuardado = localStorage.getItem(CLIENTE_OPTOUT_KEY) !== '1';
    } catch (e) {
      state.clienteGuardado = true;
    }
    const guardar = document.getElementById('saveData');
    if (guardar) guardar.checked = state.clienteGuardado;
    aplicarServiciosActivos();
    aplicarPerfil();
    cargarCarrito();
    renderChipsLocales();
    renderLocales();
    renderCategorias();
    renderCart();
    enlazarEventos();
    iniciarAppbar();
    iniciarMarket();
    iniciarInstalacion();
    activarServicios();
    activarAccesoOculto();
    actualizarEstadoZona();
    setInterval(actualizarEstadoZona, 60000);
    comprobarServicios();
  }

  init();
})();
