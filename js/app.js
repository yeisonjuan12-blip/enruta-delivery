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
  const LOCALES = (DATA.locales || []).filter((l) => l.publicado !== false);
  const CATALOGOS = DATA.catalogos || [];
  const CATEGORIAS_LOCALES = DATA.categoriasLocales || [];
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
    catCatalogos: {},
    q: '',
    cart: [],
    activeLocal: null,
    cliente: null,
    enviando: false,
    apiDisponible: true,
    apiComprobada: false
  };
  CATALOGOS.forEach((c) => { state.catCatalogos[c.id] = 'todo'; });

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
    if (!state.q) return true;
    return norm(texto).includes(norm(state.q));
  }

  function localCoincide(l) {
    if (!state.q) return true;
    return coincide([
      l.nombre,
      l.categoriaNombre,
      l.descripcion,
      (l.etiquetas || []).join(' '),
      (l.productos || []).map((p) => p.nombre + ' ' + (p.descripcion || '')).join(' ')
    ].join(' '));
  }

  function productoCatalogoCoincide(cat, p) {
    return coincide([p.nombre, p.marca, p.presentacion, categoriaCatalogo(cat, p.categoriaId), p.descripcion].join(' '));
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
    const statCat = document.getElementById('statCatalogos');
    if (statCat) statCat.textContent = String(CATALOGOS.length);

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
      (local.esEjemplo ? '<span class="demo-badge demo-float">Ejemplo</span>' : '') +
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
    cont.innerHTML = chips.map((c) =>
      '<button type="button" class="chip' + (state.catLocal === c.id ? ' is-active' : '') + '" data-cat="' + esc(c.id) + '">' + esc(c.nombre) + '</button>'
    ).join('');
  }

  function renderLocales() {
    const grid = document.getElementById('localsGrid');
    const vacio = document.getElementById('localsEmpty');
    const contador = document.getElementById('localsCount');
    if (!grid) return;

    renderChipsLocales();

    $$('.tab').forEach((t) => {
      const activo = t.dataset.tab === state.tab;
      t.classList.toggle('is-active', activo);
      t.setAttribute('aria-selected', activo ? 'true' : 'false');
    });

    const lista = LOCALES.filter((l) => {
      if (state.tab !== 'todo' && l.tipo !== state.tab) return false;
      if (state.catLocal !== 'todo' && l.categoriaId !== state.catLocal) return false;
      return localCoincide(l);
    });

    grid.innerHTML = lista.map(tarjetaLocal).join('');
    if (contador) contador.textContent = lista.length + (lista.length === 1 ? ' local' : ' locales');
    if (vacio) vacio.hidden = lista.length > 0;

    const demo = LOCALES.some((l) => l.esEjemplo);
    const banner = document.getElementById('demoBanner');
    if (banner) banner.hidden = !demo;
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

  function renderCatalogo(sec) {
    const cat = catalogosPorId.get(sec.id);
    const grid = document.getElementById(sec.grid);
    const cont = document.getElementById(sec.chips);
    const contador = document.getElementById(sec.count);
    const vacio = document.getElementById(sec.empty);
    if (!cat || !grid) return;

    if (cont) {
      cont.innerHTML = [{ id: 'todo', nombre: 'Todos' }].concat(cat.categorias || []).map((c) =>
        '<button type="button" class="chip' + (state.catCatalogos[sec.id] === c.id ? ' is-active' : '') + '" data-cat="' + esc(c.id) + '">' + esc(c.nombre) + '</button>'
      ).join('');
    }

    const lista = (cat.productos || []).filter((p) => {
      if (state.catCatalogos[sec.id] !== 'todo' && p.categoriaId !== state.catCatalogos[sec.id]) return false;
      return productoCatalogoCoincide(cat, p);
    });

    grid.innerHTML = lista.map((p) => tarjetaCatalogo(cat, p)).join('');
    if (contador) contador.textContent = lista.length + (lista.length === 1 ? ' producto' : ' productos');
    if (vacio) vacio.hidden = lista.length > 0;

    const fechaEl = sec.fecha ? document.getElementById(sec.fecha) : null;
    const fecha = fechaMaxima(cat);
    if (fechaEl && fecha) fechaEl.textContent = fecha;
  }

  function renderCategorias() {
    SECCIONES.forEach(renderCatalogo);
  }

  function renderTodo() {
    renderLocales();
    renderCategorias();
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
        (local.esEjemplo ? '<span class="demo-badge">Local de ejemplo</span>' : '') +
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
      if (unidades > 0) {
        barra.hidden = false;
        barra.innerHTML = '<div class="modal-bar-in">' +
          '<span><b>' + unidades + '</b> en tu pedido · ' + money(sub) + '</span>' +
          '<button type="button" class="btn btn-brand" data-open-cart>Ver pedido</button>' +
        '</div>';
      } else {
        barra.hidden = true;
        barra.innerHTML = '';
      }
    }

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
      if (nota) nota.hidden = true;
      if (subtitulo) subtitulo.textContent = 'Todavía no agregaste nada';
      return;
    }

    vacio.hidden = true;
    form.hidden = false;
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
  }

  /* ---------------- Drawer ---------------- */
  function abrirCarrito() {
    cerrarModal();
    const drawer = document.getElementById('cartDrawer');
    if (!drawer) return;
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
    const overlay = document.getElementById('overlay');
    if (!overlay) return;
    const abierto = (drawer && drawer.classList.contains('open')) || (modal && modal.classList.contains('open'));
    overlay.classList.toggle('show', !!abierto);
    overlay.hidden = !abierto;
  }

  function actualizarBloqueoScroll() {
    const drawer = document.getElementById('cartDrawer');
    const modal = document.getElementById('modal');
    const abierto = (drawer && drawer.classList.contains('open')) || (modal && modal.classList.contains('open'));
    document.body.classList.toggle('no-scroll', !!abierto);
  }

  function cerrarTodo() {
    cerrarCarrito();
    cerrarModal();
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
  function comprobarServicios() {
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
  // o un clic en el punto casi invisible del pie. Solo navega si el backend
  // está disponible; en la copia estática no lleva a una página inexistente.
  let toquesLogo = 0;
  let temporizadorLogo = null;

  async function abrirPanelOculto() {
    toquesLogo = 0;
    if (temporizadorLogo) {
      clearTimeout(temporizadorLogo);
      temporizadorLogo = null;
    }
    const disponible = await comprobarServicios();
    if (disponible) window.location.href = 'admin/';
  }

  function activarAccesoOculto() {
    $$('.brand').forEach((logo) => {
      logo.addEventListener('click', () => {
        toquesLogo += 1;
        if (temporizadorLogo) clearTimeout(temporizadorLogo);
        temporizadorLogo = setTimeout(() => { toquesLogo = 0; }, 1800);
        if (toquesLogo >= 5) abrirPanelOculto();
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
    state.cart = [];
    guardarCarrito();
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
        }, 140);
      });
    }
    const buscar = () => {
      state.q = search.value.trim();
      renderLocales();
      renderCategorias();
      if (state.q) track('search', { search_term: state.q });
      const destinoId = document.querySelectorAll('#localsGrid .local-card').length ? 'locales'
        : document.querySelectorAll('#licoresGrid .c-card').length ? 'licores'
        : document.querySelectorAll('#necGrid .c-card').length ? 'primera-necesidad'
        : 'locales';
      const destino = document.getElementById(destinoId);
      if (destino) destino.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
    const modalClose = document.getElementById('modalClose');
    if (modalClose) modalClose.addEventListener('click', cerrarModal);

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
    aplicarPerfil();
    cargarCarrito();
    renderChipsLocales();
    renderLocales();
    renderCategorias();
    renderCart();
    enlazarEventos();
    activarAccesoOculto();
    actualizarEstadoZona();
    setInterval(actualizarEstadoZona, 60000);
    comprobarServicios();
  }

  init();
})();
