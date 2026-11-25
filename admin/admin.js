/* ============================================================
   EnRuta Delivery · Panel de administración
   Vanilla JS, sin dependencias ni CDN.
   ============================================================ */
(() => {
  'use strict';

  /* ---------------- Utilidades ---------------- */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (v) => String(v === null || v === undefined ? '' : v).replace(/[&<>"']/g, (c) => ESC[c]);
  const money = (n) => 'S/ ' + (Number(n) || 0).toFixed(2);
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const fechaCorta = (v) => String(v || '').replace('T', ' ').slice(0, 16);
  const fechaISO = (d) => {
    const x = d instanceof Date ? d : new Date(d);
    return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0');
  };
  const soloDigitos = (v) => String(v || '').replace(/\D/g, '');
  const hoyISO = () => new Date().toISOString().slice(0, 10);

  function slugify(texto, max = 48) {
    const s = norm(texto).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return (s || 'item').slice(0, max).replace(/-+$/g, '');
  }
  function debounce(fn, ms = 280) {
    let t = null;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }
  function bytesTxt(n) {
    const b = Number(n) || 0;
    if (b < 1024) return b + ' B';
    if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
    return (b / 1024 / 1024).toFixed(1) + ' MB';
  }
  function descargarJson(nombre, datos) {
    const blob = new Blob([JSON.stringify(datos, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = nombre;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  function badgeEstado(publicado, disponible, revisar) {
    if (revisar) return '<span class="badge warn dot">Revisar</span>';
    if (!publicado) return '<span class="badge">Oculto</span>';
    if (disponible === false) return '<span class="badge danger dot">Agotado</span>';
    return '<span class="badge ok dot">Publicado</span>';
  }
  function imgUrlLocal(carpeta, valor) {
    if (!valor) return '';
    const v = String(valor).replace(/^\/+/, '');
    if (/^https?:/i.test(v)) return v;
    if (v.startsWith('media/')) return '/' + v;
    if (v.startsWith('data/')) return '/' + v;
    return '/data/locales/' + carpeta + '/' + v;
  }
  function imgUrlCatalogo(catalogo, valor) {
    if (!valor) return '';
    const v = String(valor).replace(/^\/+/, '');
    if (/^https?:/i.test(v)) return v;
    if (v.startsWith('media/')) return '/' + v;
    if (v.startsWith('data/')) return '/' + v;
    return '/data/' + catalogo + '/' + v;
  }

  /* ---------------- Contraseñas (PBKDF2 en el navegador) ----------------
     El servidor gratuito de Cloudflare solo dispone de 10 ms de CPU por
     petición. Por eso la clave se deriva aquí con PBKDF2-SHA256 y al
     servidor viaja únicamente la clave derivada (nunca la contraseña). */
  const PBKDF2_ITERACIONES = 120000;

  function bytesAB64(bytes) {
    let texto = '';
    for (let i = 0; i < bytes.length; i++) texto += String.fromCharCode(bytes[i]);
    return btoa(texto);
  }
  function b64ABytes(texto) {
    const binario = atob(String(texto || '').replace(/\s+/g, ''));
    const bytes = new Uint8Array(binario.length);
    for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
    return bytes;
  }
  function salAleatoria() {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return bytesAB64(bytes);
  }
  async function derivarClave(password, salt, iteraciones) {
    if (!window.crypto || !window.crypto.subtle) {
      throw new Error('Tu navegador no permite iniciar sesión de forma segura. Actualízalo o usa Chrome, Edge o Firefox.');
    }
    const codificador = new TextEncoder();
    const base = await crypto.subtle.importKey('raw', codificador.encode(String(password)), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt: b64ABytes(salt),
        iterations: Number(iteraciones) || PBKDF2_ITERACIONES,
        hash: 'SHA-256'
      },
      base,
      256
    );
    return bytesAB64(new Uint8Array(bits));
  }
  async function salDeUsuario(usuario) {
    const res = await api('/api/auth/sal', { method: 'POST', body: { usuario } });
    return {
      salt: String(res.salt || ''),
      iteraciones: Number(res.iteraciones) || PBKDF2_ITERACIONES
    };
  }
  async function credencialesPara(password) {
    const salt = salAleatoria();
    const clave = await derivarClave(password, salt, PBKDF2_ITERACIONES);
    return { clave, salt, iteraciones: PBKDF2_ITERACIONES };
  }

  const CATEGORIAS_SUGERIDAS = [
    'Hamburguesas', 'Pollo a la brasa', 'Salchipapas', 'Pizzas', 'Alitas', 'Broaster',
    'Parrillas', 'Carnes', 'Pescados y mariscos', 'Comida criolla', 'Sopas', 'Entradas',
    'Postres', 'Bebidas', 'Jugos', 'Cervezas', 'Licores', 'Vinos', 'Cócteles', 'Extras'
  ];
  const ESTADOS_PEDIDO = [
    { id: 'nuevo', nombre: 'Nuevo' },
    { id: 'confirmado', nombre: 'Confirmado' },
    { id: 'en-camino', nombre: 'En camino' },
    { id: 'entregado', nombre: 'Entregado' },
    { id: 'cancelado', nombre: 'Cancelado' }
  ];
  const ESTADOS_SERVICIO = [
    { id: 'pendiente', nombre: 'Pendiente' },
    { id: 'en camino', nombre: 'En camino' },
    { id: 'entregado', nombre: 'Entregado' }
  ];
  const TIPOS_SERVICIO = {
    envio: { vista: 'envios', titulo: 'Recojo y envío', singular: 'envío', icono: '📦' },
    taximoto: { vista: 'taximotos', titulo: 'Taximoto', singular: 'taximoto', icono: '🛵' }
  };

  const state = {
    sesion: null,
    vista: 'resumen',
    sistema: null,
    categorias: null,
    locales: [],
    localCarpeta: '',
    local: null,
    localTab: 'datos',
    filtroLocales: '',
    estadoLocales: 'todos',
    ocr: {
      carpeta: '', archivos: [], productos: [], texto: '', importacionId: null,
      procesando: false, resultado: null, ultimaImportacion: null
    },
    catalogos: { actual: 'licores', datos: null, filtro: '', categoria: '' },
    ventas: { desde: '', hasta: '', local: '', datos: null },
    config: null,
    statsLocal: null,
    pedidos: [],
    servicios: [],
    usuarios: [],
    auditoria: [],
    importaciones: []
  };

  /* ---------------- API ---------------- */
  async function api(ruta, opciones = {}) {
    const metodo = (opciones.method || 'GET').toUpperCase();
    const headers = Object.assign({}, opciones.headers || {});
    let cuerpo;
    if (opciones.body !== undefined && opciones.body !== null) {
      headers['Content-Type'] = 'application/json';
      cuerpo = JSON.stringify(opciones.body);
    }
    if (state.sesion && state.sesion.csrf && !['GET', 'HEAD', 'OPTIONS'].includes(metodo)) {
      headers['X-CSRF-Token'] = state.sesion.csrf;
    }
    let res;
    try {
      res = await fetch(ruta, { method: metodo, headers, body: cuerpo, credentials: 'same-origin' });
    } catch (e) {
      throw new Error('No se pudo conectar con el servidor. Revisa tu conexión e intenta nuevamente.');
    }
    const texto = await res.text();
    let datos = null;
    if (texto) {
      try { datos = JSON.parse(texto); } catch (e) { datos = { error: texto }; }
    }
    if (res.status === 401 && state.sesion) {
      state.sesion = null;
      mostrarLogin('Tu sesión terminó. Ingresa nuevamente.');
    }
    if (!res.ok) {
      let mensaje = (datos && (datos.error || datos.mensaje)) || ('Error ' + res.status);
      if (datos && Array.isArray(datos.errores) && datos.errores.length) mensaje = datos.errores.join('\n');
      const err = new Error(mensaje);
      err.status = res.status;
      err.datos = datos;
      throw err;
    }
    return datos || {};
  }

  /* ---------------- Avisos ---------------- */
  let toastTimer = null;
  function toast(texto, tipo = 'ok') {
    const el = $('#toast');
    if (!el) return;
    el.textContent = texto;
    el.classList.toggle('err', tipo === 'err');
    el.hidden = false;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.classList.remove('show'); setTimeout(() => { el.hidden = true; }, 220); }, 3200);
  }
  function avisarError(e) {
    console.error(e);
    toast(e && e.message ? e.message : 'Ocurrió un error.', 'err');
  }
  function bloquear(btn, activo = true) {
    if (!btn) return;
    btn.disabled = activo;
    if (activo) { btn.dataset.texto = btn.textContent; btn.textContent = 'Guardando…'; }
    else if (btn.dataset.texto) { btn.textContent = btn.dataset.texto; }
  }

  /* ---------------- Modal ---------------- */
  let modalCerrarCb = null;
  function abrirModal({ titulo, cuerpo, pie = '', ancho = '', alCerrar = null }) {
    const modal = $('#modal');
    $('#modalTitle').textContent = titulo;
    $('#modalBody').innerHTML = cuerpo;
    $('#modalFoot').innerHTML = pie;
    $('.modal-card', modal).className = 'modal-card ' + (ancho || '');
    modal.hidden = false;
    modalCerrarCb = alCerrar;
    document.body.style.overflow = 'hidden';
    setTimeout(() => {
      const first = $('#modalBody input:not([type=hidden]), #modalBody select, #modalBody textarea');
      if (first) first.focus();
    }, 30);
  }
  function cerrarModal() {
    const modal = $('#modal');
    if (!modal || modal.hidden) return;
    modal.hidden = true;
    document.body.style.overflow = '';
    $('#modalBody').innerHTML = '';
    $('#modalFoot').innerHTML = '';
    const cb = modalCerrarCb; modalCerrarCb = null;
    if (typeof cb === 'function') cb();
  }

  /* ---------------- Sesión ---------------- */
  function mostrarLogin(mensaje = '') {
    const app = $('#app');
    if (app) app.hidden = true;
    const login = $('#loginScreen');
    if (!login) return;
    login.hidden = false;
    const err = $('#loginError');
    if (err) {
      err.hidden = !mensaje;
      err.textContent = mensaje;
    }
    const pwd = $('#loginPassword');
    if (pwd) pwd.value = '';
    try {
      const sugerido = sessionStorage.getItem('enruta_usuario_sugerido');
      if (sugerido) {
        const u = $('#loginUsuario');
        if (u) u.value = sugerido;
        sessionStorage.removeItem('enruta_usuario_sugerido');
      }
    } catch (e) { /* sin almacenamiento */ }
    setTimeout(() => { const u = $('#loginUsuario'); if (u && !u.value) u.focus(); else if (pwd) pwd.focus(); }, 50);
  }
  function mostrarApp() {
    const login = $('#loginScreen');
    if (login) login.hidden = true;
    const app = $('#app');
    if (app) app.hidden = false;
    const s = state.sesion || {};
    const nombre = s.nombre || s.usuario || '—';
    $('#sideUser').textContent = nombre;
    $('#sideRol').textContent = s.rol === 'admin' ? 'Administrador' : 'Encargado de local';
    $('#userName').textContent = nombre;
    $('#userRol').textContent = s.rol === 'admin' ? 'Administrador' : 'Encargado de local';
    $('#avatar').textContent = (nombre || 'A').slice(0, 1).toUpperCase();
    $$('.solo-admin').forEach((el) => { el.hidden = s.rol !== 'admin'; });
    $$('.solo-local').forEach((el) => { el.hidden = s.rol === 'admin'; });
    const navLocal = $('.nav-item[data-vista="locales"]');
    if (navLocal) navLocal.innerHTML = s.rol === 'admin' ? '<span>▦</span> Locales' : '<span>▦</span> Mi local';
    // Un encargado de local no debe ver encomiendas ni taximotos.
    if (s.rol !== 'admin') {
      ['envios', 'taximotos'].forEach((v) => {
        const b = $('.nav-item[data-vista="' + v + '"]');
        if (b) b.hidden = true;
      });
      if (['envios', 'taximotos'].includes(hashActual().split('/')[0])) ir('resumen');
    }
  }

  async function iniciarSesion(ev) {
    ev.preventDefault();
    const err = $('#loginError');
    const btn = $('#loginBtn');
    const usuario = $('#loginUsuario').value.trim();
    const password = $('#loginPassword').value;
    if (err) { err.hidden = true; err.textContent = ''; }
    if (!usuario || !password) {
      if (err) { err.hidden = false; err.textContent = 'Escribe tu usuario y contraseña.'; }
      return;
    }
    bloquear(btn, true);
    try {
      const sal = await salDeUsuario(usuario);
      const clave = await derivarClave(password, sal.salt, sal.iteraciones);
      const res = await api('/api/auth/login', { method: 'POST', body: { usuario, clave } });
      state.sesion = res.sesion;
      mostrarApp();
      toast('Bienvenido, ' + (state.sesion.nombre || state.sesion.usuario));
      await cargarBase();
      renderRuta();
    } catch (e) {
      if (err) { err.hidden = false; err.textContent = e.message; }
    } finally {
      bloquear(btn, false);
    }
  }

  async function cerrarSesion() {
    try { await api('/api/auth/logout', { method: 'POST' }); } catch (e) { /* la sesión local ya no sirve */ }
    state.sesion = null;
    state.local = null;
    state.locales = [];
    history.replaceState(null, '', location.pathname);
    mostrarLogin();
  }

  /* ---------------- Navegación ---------------- */
  const TITULOS = {
    resumen: ['Resumen', 'Estado general del negocio'],
    locales: ['Locales', 'Catálogos independientes por establecimiento'],
    local: ['Detalle del local', 'Datos, productos, imágenes y carta'],
    ocr: ['Importar carta', 'Lectura de imágenes y PDF con revisión previa'],
    ventas: ['Ventas', 'Productos más vendidos e ingresos por fecha'],
    catalogos: ['Catálogos', 'Licores y primera necesidad'],
    pagina: ['Página', 'Marca, contacto, zonas y categorías de la web'],
    pedidos: ['Pedidos', 'Solicitudes recibidas desde la web'],
    envios: ['Recojo y envío', 'Solicitudes de recojo y entrega de productos'],
    taximotos: ['Taximoto', 'Solicitudes de transporte de personas'],
    usuarios: ['Usuarios', 'Accesos administrativos y de locales'],
    auditoria: ['Auditoría', 'Últimas acciones registradas'],
    cuenta: ['Mi cuenta', 'Seguridad y contraseña']
  };

  function hashActual() {
    return (location.hash || '').replace(/^#\/?/, '');
  }
  function ir(destino) {
    const h = '#/' + destino;
    if (location.hash === h) renderRuta();
    else location.hash = h;
  }
  function mostrarVista(nombre, activo) {
    state.vista = nombre;
    $$('.view').forEach((v) => { v.hidden = true; });
    const view = $('#view-' + nombre);
    if (view) view.hidden = false;
    $$('.nav-item').forEach((b) => {
      const v = b.dataset.vista;
      b.classList.toggle('activo', v === (activo || nombre));
    });
    const t = TITULOS[nombre] || TITULOS.resumen;
    $('#viewTitle').textContent = t[0];
    $('#viewSubtitle').textContent = t[1];
    cerrarSidebar();
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  async function renderRuta() {
    if (!state.sesion) return;
    const partes = hashActual().split('/').filter(Boolean);
    const vista = partes[0] || 'resumen';
    const param = partes.slice(1).join('/') || '';
    try {
      if (vista === 'local' && param) {
        await vistaLocalDetalle(param);
      } else if (vista === 'locales') {
        if (state.sesion.rol === 'local') {
          await vistaLocalDetalle(state.sesion.localCarpeta || '');
        } else {
          await vistaLocales();
        }
      } else if (vista === 'ocr') {
        await vistaOcr(param);
      } else if (vista === 'ventas') {
        await vistaVentas();
      } else if (vista === 'catalogos') {
        await vistaCatalogos(param || 'licores');
      } else if (vista === 'pagina') {
        if (state.sesion.rol !== 'admin') return ir('resumen');
        await vistaPagina();
      } else if (vista === 'pedidos') {
        await vistaPedidos();
      } else if (vista === 'envios') {
        if (state.sesion.rol !== 'admin') return ir('resumen');
        await vistaServicios('envio');
      } else if (vista === 'taximotos') {
        if (state.sesion.rol !== 'admin') return ir('resumen');
        await vistaServicios('taximoto');
      } else if (vista === 'usuarios') {
        if (state.sesion.rol !== 'admin') return ir('resumen');
        await vistaUsuarios();
      } else if (vista === 'auditoria') {
        if (state.sesion.rol !== 'admin') return ir('resumen');
        await vistaAuditoria();
      } else if (vista === 'cuenta') {
        vistaCuenta();
      } else {
        await vistaResumen();
      }
    } catch (e) {
      const cont = $('#view-' + (state.vista || 'resumen'));
      if (cont) cont.innerHTML = '<div class="panel"><div class="panel-body"><p class="form-error">' + esc(e.message) + '</p></div></div>';
      if (e.status === 403) setTimeout(() => ir('resumen'), 900);
    }
  }

  function cerrarSidebar() {
    const sb = $('#sidebar'); if (sb) sb.classList.remove('abierto');
    const bd = $('#backdrop'); if (bd) bd.hidden = true;
  }
  function abrirSidebar() {
    const sb = $('#sidebar'); if (sb) sb.classList.add('abierto');
    const bd = $('#backdrop'); if (bd) bd.hidden = false;
  }

  /* ---------------- Base compartida ---------------- */
  async function cargarBase() {
    const tareas = [
      api('/api/admin/locales').then((r) => { state.locales = r.locales || []; }),
      api('/api/admin/config').then((r) => { state.config = r.config || null; }).catch(() => { /* sin configuracion */ }),
      api('/api/admin/estado-sistema').then((r) => { state.sistema = r; }).catch(() => { state.sistema = null; })
    ];
    // También los usuarios de local necesitan las categorías para editar su ficha.
    tareas.push(api('/api/admin/categorias-locales').then((r) => { state.categorias = r; }).catch(() => { state.categorias = null; }));
    await Promise.all(tareas);
    if (!state.sistema) {
      state.sistema = { ocr: false, ocrMensaje: 'No se pudo consultar el estado del OCR.', iaConfigurada: false, iaMensaje: 'IA no disponible.' };
    }
  }

  function nombreLocal(carpeta) {
    const l = state.locales.find((x) => x.carpeta === carpeta);
    return l ? l.nombre : carpeta;
  }

  function opcionesZonas(seleccion) {
    const cfg = state.config || {};
    const zonas = Array.isArray(cfg.zonas) && cfg.zonas.length
      ? cfg.zonas
      : [{ id: 'nuevo-chimbote', nombre: 'Nuevo Chimbote' }];
    const actual = seleccion || cfg.zonaPrincipal || zonas[0].id;
    return zonas.map((z) => '<option value="' + esc(z.id) + '"' + (z.id === actual ? ' selected' : '') + '>' + esc(z.nombre) + '</option>').join('');
  }

  // La API devuelve una lista, pero algunas pantallas la guardan envuelta
  // en { categorias: [...] }. Esto acepta las dos formas.
  function listaCategorias() {
    const c = state.categorias;
    if (Array.isArray(c)) return c;
    if (c && Array.isArray(c.categorias)) return c.categorias;
    return [];
  }

  function opcionesCategorias(seleccion) {
    const cats = listaCategorias();
    if (!cats.length && seleccion) {
      return '<option value="' + esc(seleccion) + '" selected>' + esc(seleccion) + '</option>';
    }
    const existe = cats.some((c) => c.id === seleccion);
    const opciones = cats.map((c) =>
      '<option value="' + esc(c.id) + '"' + (c.id === seleccion ? ' selected' : '') + '>' + esc(c.nombre) + '</option>'
    ).join('');
    // Si la categoría guardada ya no existe, se muestra igual para no
    // cambiarla sin querer al guardar.
    return existe || !seleccion
      ? opciones
      : '<option value="' + esc(seleccion) + '" selected>' + esc(seleccion) + ' (actual)</option>' + opciones;
  }

  function avisoSistema() {
    const el = $('#systemNote');
    if (!el) return;
    const s = state.sistema;
    if (!s) { el.hidden = true; return; }
    const partes = [];
    if (!s.ocr) partes.push('<b>OCR no disponible:</b> ' + esc(s.ocrMensaje || 'revisa la configuración.'));
    if (!s.iaConfigurada) partes.push('<b>IA de refinamiento desactivada:</b> ' + esc(s.iaMensaje || 'sin credenciales configuradas.'));
    if (!partes.length) { el.hidden = true; return; }
    el.hidden = false;
    el.className = 'system-note info';
    el.innerHTML = partes.join('<br>');
  }

  /* ---------------- Carga inicial ---------------- */
  async function arrancar() {
    const form = $('#loginForm');
    if (form) form.addEventListener('submit', iniciarSesion);
    const logout = $('#logoutBtn');
    if (logout) logout.addEventListener('click', cerrarSesion);
    const menu = $('#menuBtn');
    if (menu) menu.addEventListener('click', abrirSidebar);
    const backdrop = $('#backdrop');
    if (backdrop) backdrop.addEventListener('click', cerrarSidebar);
    const modalClose = $('#modalClose');
    if (modalClose) modalClose.addEventListener('click', cerrarModal);
    const modal = $('#modal');
    if (modal) modal.addEventListener('click', (e) => { if (e.target === modal) cerrarModal(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') cerrarModal(); });
    $$('.nav-item').forEach((b) => b.addEventListener('click', () => ir(b.dataset.vista)));
    window.addEventListener('hashchange', renderRuta);

    try {
      const s = await api('/api/auth/sesion');
      if (s.autenticado) {
        state.sesion = s;
        mostrarApp();
        await cargarBase();
        avisoSistema();
        renderRuta();
      } else {
        mostrarLogin();
      }
    } catch (e) {
      mostrarLogin(e.status === 401 || /conectar/i.test(e.message) ? 'No se pudo consultar la sesión. Verifica que el servidor esté encendido.' : e.message);
    }
  }

  document.addEventListener('DOMContentLoaded', arrancar);

  /* ============================================================
     RESUMEN
     ============================================================ */
  async function vistaResumen() {
    mostrarVista('resumen');
    avisoSistema();
    const cont = $('#view-resumen');
    cont.innerHTML = '<div class="panel"><div class="panel-body muted">Cargando resumen…</div></div>';
    const [r, pedidosRes] = await Promise.all([
      api('/api/admin/resumen'),
      api('/api/admin/pedidos').catch(() => ({ pedidos: [] }))
    ]);
    const pedidos = (pedidosRes.pedidos || []).slice(0, 6);
    const locales = state.locales.slice(0, 5);
    const soloLocal = state.sesion.rol === 'local';
    const stats30 = soloLocal
      ? await api('/api/admin/estadisticas?local=' + encodeURIComponent(state.sesion.localCarpeta || '')).catch(() => null)
      : null;
    const resumen30 = (stats30 && stats30.resumen) || { ventas: 0, unidades: 0, pedidos: 0 };

    cont.innerHTML = `
      <div class="stats">
        <div class="stat brand">
          <div class="stat-label">Pedidos hoy</div>
          <div class="stat-value">${r.pedidosHoy || 0}</div>
          <div class="stat-meta">${r.pedidosNuevos || 0} sin atender · ${money(r.ventasHoy)}</div>
        </div>
        ${soloLocal ? `
        <div class="stat">
          <div class="stat-label">Ventas (30 días)</div>
          <div class="stat-value">${money(resumen30.ventas)}</div>
          <div class="stat-meta">${resumen30.pedidos || 0} pedidos · ${resumen30.unidades || 0} unidades</div>
        </div>` : `
        <div class="stat">
          <div class="stat-label">Locales</div>
          <div class="stat-value">${r.locales || 0}</div>
          <div class="stat-meta">Con catálogo propio</div>
        </div>`}
        <div class="stat">
          <div class="stat-label">${soloLocal ? 'Productos de mi local' : 'Productos de locales'}</div>
          <div class="stat-value">${r.productos || 0}</div>
          <div class="stat-meta">${r.publicados || 0} publicados · ${r.pendientes || 0} por revisar</div>
        </div>
        <div class="stat">
          <div class="stat-label">${soloLocal ? 'Mi local' : 'Catálogos EnRuta'}</div>
          <div class="stat-value">${soloLocal ? esc((state.locales[0] && state.locales[0].nombre) || '—') : (r.catalogoLicores || 0) + (r.catalogoNec || 0)}</div>
          <div class="stat-meta">${soloLocal ? 'Solo ves la información de tu establecimiento' : (r.catalogoLicores || 0) + ' licores · ' + (r.catalogoNec || 0) + ' primera necesidad'}</div>
        </div>
      </div>

      <div class="dash-grid">
        <div class="stack">
          <div class="panel">
            <div class="panel-head">
              <div><h2>Pedidos recientes</h2><p>Los últimos pedidos guardados desde la web.</p></div>
              <button class="btn btn-sm" data-ir="pedidos">Ver todos</button>
            </div>
            <div class="panel-body">
              ${pedidos.length ? `<div class="stack" style="gap:8px">${pedidos.map((p) => `
                <button class="quick-item" data-pedido="${esc(p.id)}">
                  <div>
                    <b>${esc(p.nombre)} · ${money(p.total)}</b>
                    <span>${esc(p.id)} · ${esc(fechaCorta(p.creadoEn))} · ${esc(p.zonaNombre || '')}</span>
                  </div>
                  <span class="badge ${p.estado === 'nuevo' ? 'brand' : p.estado === 'cancelado' ? 'danger' : 'ok'}">${esc(p.estado)}</span>
                </button>`).join('')}</div>` : '<div class="empty"><div class="big">🧾</div><h3>Sin pedidos todavía</h3><p>Los pedidos enviados desde la web aparecerán aquí.</p></div>'}
            </div>
          </div>

          <div class="panel">
            <div class="panel-head">
              <div><h2>${soloLocal ? 'Mi local' : 'Locales'}</h2><p>${soloLocal ? 'Acceso directo a tu catálogo.' : 'Accesos rápidos a cada catálogo.'}</p></div>
              <button class="btn btn-sm" data-ir="${soloLocal && state.locales[0] ? 'local/' + esc(state.locales[0].carpeta) : 'locales'}">${soloLocal ? 'Editar productos' : 'Gestionar'}</button>
            </div>
            <div class="panel-body">
              ${locales.length ? `<div class="stack" style="gap:8px">${locales.map((l) => `
                <button class="quick-item" data-local-ir="${esc(l.carpeta)}">
                  <div>
                    <b>${esc(l.nombre)}</b>
                    <span>${l.totalProductos} productos · ${l.publicados} publicados · ${l.pendientes} pendientes</span>
                  </div>
                  <em>${esc(l.emoji || '🏪')}</em>
                </button>`).join('')}</div>` : '<div class="empty"><div class="big">🏪</div><h3>Sin locales</h3><p>Crea el primer local para empezar a cargar su carta.</p></div>'}
            </div>
          </div>
        </div>

        <div class="stack">
          <div class="panel">
            <div class="panel-head"><div><h2>Acciones rápidas</h2><p>Lo más usado del día a día.</p></div></div>
            <div class="panel-body">
              <div class="quick-list">
                <button class="quick-item" data-ir="ventas"><div><b>Ver ventas</b><span>Qué producto sale más y cuánto genera</span></div><em>↗</em></button>
                <button class="quick-item" data-ir="ocr"><div><b>Importar carta</b><span>Foto o PDF con OCR y revisión</span></div><em>◫</em></button>
                <button class="quick-item" data-ir="${soloLocal ? 'local/' + esc(state.sesion.localCarpeta || '') : 'locales'}"><div><b>Editar productos</b><span>Precios, variantes y disponibilidad</span></div><em>▦</em></button>
                ${soloLocal ? '' : '<button class="quick-item" data-ir="catalogos"><div><b>Catálogos EnRuta</b><span>Licores y primera necesidad</span></div><em>▥</em></button>'}
                <button class="quick-item" data-ir="cuenta"><div><b>Mi cuenta</b><span>Cambiar contraseña</span></div><em>⚙</em></button>
              </div>
            </div>
          </div>

          <div class="panel">
            <div class="panel-head"><div><h2>Estado del sistema</h2><p>Servicios del servidor local.</p></div></div>
            <div class="panel-body">
              <div class="stack" style="gap:10px">
                <div class="row"><span class="badge ${state.sistema && state.sistema.ocr ? 'ok' : 'danger'}">${state.sistema && state.sistema.ocr ? 'OCR activo' : 'OCR inactivo'}</span><span class="small muted">Windows.Media.Ocr · es-ES</span></div>
                <div class="row"><span class="badge ${state.sistema && state.sistema.iaConfigurada ? 'ok' : 'warn'}">${state.sistema && state.sistema.iaConfigurada ? 'IA configurada' : 'IA desactivada'}</span><span class="small muted">Refinamiento opcional</span></div>
                <p class="small muted">Servidor local en el puerto 8780. Los datos se guardan en <code>server/datos</code> y el catálogo público se regenera al guardar.</p>
              </div>
            </div>
          </div>
        </div>
      </div>`;

    $$('[data-ir]', cont).forEach((b) => b.addEventListener('click', () => ir(b.dataset.ir)));
    $$('[data-local-ir]', cont).forEach((b) => b.addEventListener('click', () => ir('local/' + b.dataset.localIr)));
    $$('[data-pedido]', cont).forEach((b) => b.addEventListener('click', () => ir('pedidos')));
  }

  /* ============================================================
     LOCALES · LISTA
     ============================================================ */
  async function vistaLocales() {
    mostrarVista('locales');
    const cont = $('#view-locales');
    cont.innerHTML = '<div class="panel"><div class="panel-body muted">Cargando locales…</div></div>';
    try {
      const r = await api('/api/admin/locales');
      state.locales = r.locales || [];
    } catch (e) {
      cont.innerHTML = '<div class="panel"><div class="panel-body"><p class="form-error">' + esc(e.message) + '</p></div></div>';
      return;
    }
    pintarLocales();
  }

  function pintarLocales() {
    const cont = $('#view-locales');
    const q = norm(state.filtroLocales);
    const filtro = state.estadoLocales;
    const lista = state.locales.filter((l) => {
      if (q) {
        const texto = norm([l.nombre, l.id, l.direccion, l.categoriaId].join(' '));
        if (!texto.includes(q)) return false;
      }
      if (filtro === 'publicados' && !l.publicado) return false;
      if (filtro === 'ocultos' && l.publicado) return false;
      if (filtro === 'pendientes' && !l.pendientes) return false;
      return true;
    });
    const admin = state.sesion.rol === 'admin';

    cont.innerHTML = `
      <div class="page-head">
        <div>
          <h2>Locales</h2>
          <p>${state.locales.length} establecimientos con catálogo independiente.</p>
        </div>
        <div class="page-head-actions">
          ${admin ? '<button class="btn btn-primary" id="nuevoLocalBtn">+ Nuevo local</button>' : ''}
        </div>
      </div>

      <div class="toolbar">
        <div class="search"><input class="input" id="buscarLocal" type="search" placeholder="Buscar por nombre, dirección o categoría" value="${esc(state.filtroLocales)}"></div>
        <div class="chips" style="margin:0">
          ${[['todos', 'Todos'], ['publicados', 'Publicados'], ['ocultos', 'Ocultos'], ['pendientes', 'Con pendientes']].map(([id, txt]) => `
            <button class="chip ${filtro === id ? 'activo' : ''}" data-filtro="${id}">${txt}</button>`).join('')}
        </div>
      </div>

      ${lista.length ? `<div class="panel"><div class="table-wrap"><table class="table">
        <thead><tr>
          <th>Local</th><th>Categoría</th><th>Productos</th><th>Estado</th><th>Horario</th><th></th>
        </tr></thead>
        <tbody>
          ${lista.map((l) => `
            <tr class="${l.publicado ? '' : 'row-inactivo'}">
              <td>
                <div class="row" style="gap:9px;flex-wrap:nowrap">
                  <div class="local-logo" style="width:40px;height:40px;border-radius:10px;font-size:19px;flex:0 0 auto">
                    ${l.logo ? `<img src="${esc(imgUrlLocal(l.carpeta, l.logo))}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:10px">` : esc(l.emoji || '🏪')}
                  </div>
                  <div>
                    <div class="nombre">${esc(l.nombre)}</div>
                    <div class="sub">${esc(l.direccion || l.id)} · ${esc(l.carpeta)}</div>
                  </div>
                </div>
              </td>
              <td><span class="badge">${esc(l.categoriaId)}</span></td>
              <td>
                <b>${l.totalProductos}</b>
                <div class="sub">${l.publicados} publicados${l.pendientes ? ' · <span style="color:#925400">' + l.pendientes + ' pendientes</span>' : ''}</div>
              </td>
              <td>
                <div class="row" style="gap:5px">
                  <span class="badge ${l.publicado ? 'ok' : ''}">${l.publicado ? 'Publicado' : 'Oculto'}</span>
                  ${l.cerradoTemporal ? '<span class="badge danger">Cerrado</span>' : ''}
                  ${l.disponible ? '' : '<span class="badge warn">No disponible</span>'}
                </div>
              </td>
              <td class="small">${esc(l.horarioLocal || '—')}</td>
              <td>
                <div class="acciones">
                  <button class="btn btn-sm" data-abrir="${esc(l.carpeta)}">Abrir</button>
                  ${admin ? `<button class="link-btn" data-duplicar="${esc(l.carpeta)}" title="Crear una copia de este local">Duplicar</button>` : ''}
                  ${admin ? `<button class="link-btn" data-toggle-publicado="${esc(l.carpeta)}">${l.publicado ? 'Ocultar' : 'Publicar'}</button>` : ''}
                </div>
              </td>
            </tr>`).join('')}
        </tbody>
      </table></div></div>` : `<div class="panel"><div class="empty"><div class="big">🔎</div><h3>Sin resultados</h3><p>Prueba con otro término o crea un local nuevo.</p></div></div>`}
    `;

    const buscar = $('#buscarLocal');
    if (buscar) {
      buscar.addEventListener('input', debounce(() => { state.filtroLocales = buscar.value; pintarLocales(); const b = $('#buscarLocal'); if (b) { b.focus(); b.setSelectionRange(b.value.length, b.value.length); } }, 200));
    }
    $$('[data-filtro]', cont).forEach((b) => b.addEventListener('click', () => { state.estadoLocales = b.dataset.filtro; pintarLocales(); }));
    $$('[data-abrir]', cont).forEach((b) => b.addEventListener('click', () => ir('local/' + b.dataset.abrir)));
    $$('[data-duplicar]', cont).forEach((b) => b.addEventListener('click', () => confirmarDuplicarLocal(b.dataset.duplicar)));
    $$('[data-toggle-publicado]', cont).forEach((b) => b.addEventListener('click', () => cambiarPublicacionLocal(b.dataset.togglePublicado, b)));
    const nuevo = $('#nuevoLocalBtn');
    if (nuevo) nuevo.addEventListener('click', () => modalNuevoLocal());
  }

  function confirmarDuplicarLocal(carpeta) {
    const l = state.locales.find((x) => x.carpeta === carpeta);
    if (!l) return;
    abrirModal({
      titulo: 'Duplicar local',
      ancho: 'narrow',
      cuerpo: `<p>Se creará una copia de <b>${esc(l.nombre)}</b> con sus ${l.totalProductos} productos e imágenes.</p>
        <p class="small muted mt-8">La copia se llama <b>${esc(l.nombre)} (copia)</b>, se guarda como <code>${esc(l.carpeta)}</code> y queda <b>oculta</b> hasta que la publiques.</p>`,
      pie: `<button class="btn" data-cerrar>Cancelar</button><button class="btn btn-primary" id="confirmarDuplicarBtn">Duplicar local</button>`
    });
    $('[data-cerrar]').addEventListener('click', cerrarModal);
    $('#confirmarDuplicarBtn').addEventListener('click', async () => {
      const btn = $('#confirmarDuplicarBtn');
      try {
        bloquear(btn, true);
        const res = await api('/api/admin/locales/' + encodeURIComponent(carpeta) + '/duplicar', { method: 'POST', body: {} });
        cerrarModal();
        toast('Local duplicado como ' + (res.nombre || res.carpeta) + '.');
        state.locales = (await api('/api/admin/locales')).locales || [];
        await cargarBase();
        pintarLocales();
      } catch (e) {
        bloquear(btn, false);
        avisarError(e);
      }
    });
  }

  async function cambiarPublicacionLocal(carpeta, btn) {
    const l = state.locales.find((x) => x.carpeta === carpeta);
    if (!l) return;
    try {
      bloquear(btn, true);
      const detalle = await api('/api/admin/locales/' + encodeURIComponent(carpeta));
      const local = Object.assign({}, detalle.local, { publicado: !l.publicado });
      await api('/api/admin/locales/' + encodeURIComponent(carpeta), { method: 'PUT', body: { local, productos: detalle.productos } });
      toast(local.publicado ? 'Local publicado.' : 'Local oculto del catálogo público.');
      await cargarBase();
      pintarLocales();
    } catch (e) {
      avisarError(e);
    } finally {
      bloquear(btn, false);
    }
  }

  function camposLocal(l = {}) {
    const admin = state.sesion.rol === 'admin';
    const esNuevo = !l.carpeta;
    const colores = Array.isArray(l.colores) ? l.colores : ['#fdd303', '#111111'];
    return `
      <div class="form-grid">
        <label class="field"><span>Nombre del local *</span><input id="lfNombre" value="${esc(l.nombre || '')}" maxlength="120" required></label>
        <label class="field"><span>Identificador (slug) *</span><input id="lfId" value="${esc(l.id || '')}" ${admin ? '' : 'disabled'} placeholder="ej: brasa-don-pepe"><span class="hint">Minúsculas, números y guiones. No se puede repetir.</span></label>
        <label class="field"><span>Tipo *</span>
          <select id="lfTipo">
            <option value="comida" ${l.tipo === 'comida' ? 'selected' : ''}>Comida / restaurante</option>
            <option value="productos" ${l.tipo !== 'comida' ? 'selected' : ''}>Productos / bodega</option>
          </select>
        </label>
        <label class="field"><span>Categoría *</span><select id="lfCategoria">${opcionesCategorias(l.categoriaId)}</select></label>
        <label class="field"><span>Distrito *</span><select id="lfZona">${opcionesZonas(l.zonaId)}</select><span class="hint">Los clientes podrán filtrar los locales por distrito.</span></label>
        <label class="field full"><span>Descripción</span><textarea id="lfDescripcion" maxlength="400">${esc(l.descripcion || '')}</textarea></label>
        <label class="field full"><span>Dirección</span><input id="lfDireccion" value="${esc(l.direccion || '')}" maxlength="200"></label>
        <label class="field"><span>Teléfono / WhatsApp</span><input id="lfTelefono" value="${esc(l.telefono || '')}" maxlength="30"></label>
        <label class="field"><span>Horario</span><input id="lfHorario" value="${esc(l.horarioLocal || '')}" placeholder="11:00 – 23:00"></label>
        <label class="field"><span>Tiempo de entrega</span><input id="lfTiempo" value="${esc(l.tiempo || '')}" placeholder="30–45 min"></label>
        <label class="field"><span>Pedido mínimo (S/)</span><input id="lfMinimo" type="number" min="0" step="0.01" value="${esc(l.pedidoMinimo || 0)}"></label>
        <label class="field"><span>Emoji del local</span><input id="lfEmoji" value="${esc(l.emoji || '🏪')}" maxlength="8"></label>
        <label class="field"><span>Etiquetas (separadas por coma)</span><input id="lfEtiquetas" value="${esc((l.etiquetas || []).join(', '))}"></label>
        <label class="field"><span>Color principal</span><input id="lfColor1" type="color" value="${esc(colores[0] || '#fdd303')}" style="height:40px;padding:3px"></label>
        <label class="field"><span>Color secundario</span><input id="lfColor2" type="color" value="${esc(colores[1] || '#111111')}" style="height:40px;padding:3px"></label>
        <label class="field full"><span>Notas internas</span><textarea id="lfNotas" maxlength="500">${esc(l.notas || '')}</textarea></label>
      </div>
      <div class="form-section">
        <h3>Visibilidad</h3>
        <div class="row" style="gap:18px">
          <label class="check"><input id="lfPublicado" type="checkbox" ${l.publicado ? 'checked' : ''} ${admin ? '' : 'disabled'}> Publicado en la web</label>
          <label class="check"><input id="lfDisponible" type="checkbox" ${l.disponible !== false ? 'checked' : ''}> Aceptando pedidos</label>
          <label class="check"><input id="lfCerrado" type="checkbox" ${l.cerradoTemporal ? 'checked' : ''}> Cerrado temporalmente</label>
          <label class="check"><input id="lfNuevo" type="checkbox" ${l.nuevo ? 'checked' : ''}> Mostrar en Novedades</label>
        </div>
        ${admin ? '' : '<p class="hint mt-8">La publicación la controla un administrador. Tú puedes gestionar disponibilidad, productos y horarios.</p>'}
      </div>`;
  }

  function leerFormLocal(base = {}) {
    const colores = [$('#lfColor1').value, $('#lfColor2').value];
    const local = Object.assign({}, base, {
      nombre: $('#lfNombre').value.trim(),
      tipo: $('#lfTipo').value,
      categoriaId: $('#lfCategoria').value,
      zonaId: $('#lfZona') ? $('#lfZona').value : '',
      descripcion: $('#lfDescripcion').value.trim(),
      direccion: $('#lfDireccion').value.trim(),
      telefono: $('#lfTelefono').value.trim(),
      horarioLocal: $('#lfHorario').value.trim(),
      tiempo: $('#lfTiempo').value.trim(),
      pedidoMinimo: num($('#lfMinimo').value),
      emoji: $('#lfEmoji').value.trim() || '🏪',
      etiquetas: $('#lfEtiquetas').value.split(',').map((s) => s.trim()).filter(Boolean),
      notas: $('#lfNotas').value.trim(),
      colores,
      publicado: $('#lfPublicado').checked,
      disponible: $('#lfDisponible').checked,
      cerradoTemporal: $('#lfCerrado').checked,
      nuevo: $('#lfNuevo') ? $('#lfNuevo').checked : false
    });
    if (state.sesion.rol === 'admin') local.id = $('#lfId').value.trim();
    return local;
  }

  async function modalNuevoLocal() {
    if (!listaCategorias().length) {
      try { state.categorias = await api('/api/admin/categorias-locales'); } catch { /* sin categorías */ }
    }
    if (!state.config) {
      try { const cfg = await api('/api/admin/config'); state.config = cfg.config || null; } catch { /* sin zonas */ }
    }
    const base = { tipo: 'comida', publicado: false, disponible: true, emoji: '🏪', colores: ['#fdd303', '#111111'] };
    abrirModal({
      titulo: 'Nuevo local',
      ancho: 'wide',
      cuerpo: `<form id="formNuevoLocal">${camposLocal(base)}</form>`,
      pie: `<button class="btn" data-cerrar>Cancelar</button><button class="btn btn-primary" id="crearLocalBtn">Crear local</button>`
    });
    $('[data-cerrar]').addEventListener('click', cerrarModal);
    $('#lfNombre').addEventListener('input', () => {
      if (!$('#lfId').value.trim()) $('#lfId').value = slugify($('#lfNombre').value);
    });
    $('#crearLocalBtn').addEventListener('click', async () => {
      const btn = $('#crearLocalBtn');
      const local = leerFormLocal(base);
      if (!local.id) local.id = slugify(local.nombre);
      if (!local.nombre) return toast('Escribe el nombre del local.', 'err');
      try {
        bloquear(btn, true);
        const res = await api('/api/admin/locales', { method: 'POST', body: local });
        cerrarModal();
        toast('Local creado. Ahora agrega sus productos.');
        await cargarBase();
        ir('local/' + res.carpeta);
      } catch (e) {
        bloquear(btn, false);
        avisarError(e);
      }
    });
  }

  /* ============================================================
     LOCAL · DETALLE
     ============================================================ */
  async function vistaLocalDetalle(carpeta) {
    if (!carpeta) return ir('locales');
    mostrarVista('local', 'locales');
    state.localCarpeta = carpeta;
  seleccionProductos.clear();
    if (!['datos', 'productos', 'imagenes', 'acceso'].includes(state.localTab)) state.localTab = 'datos';
    if (state.sesion.rol !== 'admin' && state.localTab === 'acceso') state.localTab = 'datos';
    const cont = $('#view-local');
    cont.innerHTML = '<div class="panel"><div class="panel-body muted">Cargando local…</div></div>';
    // Si las categorías no cargaron al iniciar sesión, se piden aquí para
    // que el desplegable de categoría nunca quede vacío.
    if (!listaCategorias().length) {
      try { state.categorias = await api('/api/admin/categorias-locales'); } catch { /* se muestra el aviso */ }
    }
    if (!state.config) {
      try { const cfg = await api('/api/admin/config'); state.config = cfg.config || null; } catch { /* sin zonas */ }
    }
    // El formulario se pinta apenas llega el local. Las estadísticas se
    // cargan después, en segundo plano, para no bloquear la edición.
    const r = await api('/api/admin/locales/' + encodeURIComponent(carpeta));
    state.local = r;
    state.statsLocal = null;
    pintarLocalHead();
    api('/api/admin/estadisticas?local=' + encodeURIComponent(carpeta))
      .then((stats) => {
        if (state.localCarpeta !== carpeta) return;
        state.statsLocal = stats;
        if (state.localTab === 'productos') {
          const tab = $('#localTabContent');
          if (tab) renderTabProductos(tab);
        }
      })
      .catch(() => { /* las ventas son opcionales */ });
  }

  function pintarLocalHead() {
    const r = state.local;
    if (!r) return;
    const l = r.local;
    const cont = $('#view-local');
    cont.innerHTML = `
      <div class="panel mb-16">
        <div class="local-head">
          <div class="local-logo">
            ${l.logo ? `<img src="${esc(imgUrlLocal(r.carpeta, l.logo))}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:16px">` : esc(l.emoji || '🏪')}
          </div>
          <div class="local-head-info">
            <div class="row" style="gap:8px">
              <h2>${esc(l.nombre)}</h2>
              <span class="badge ${l.publicado ? 'ok' : ''}">${l.publicado ? 'Publicado' : 'Oculto'}</span>
              ${l.cerradoTemporal ? '<span class="badge danger">Cerrado temporalmente</span>' : ''}
            </div>
            <p>${esc(l.descripcion || 'Sin descripción')}</p>
            <p class="small muted">${esc(l.direccion || 'Sin dirección')} · ${esc(l.horarioLocal || 'Horario no definido')} · ${(r.productos || []).length} productos</p>
          </div>
          <div class="local-head-actions">
            ${state.sesion.rol === 'admin' ? '<button class="btn btn-sm" id="volverLocales">← Locales</button>' : ''}
            <button class="btn btn-sm btn-primary" id="importarCartaBtn">Importar carta</button>
          </div>
        </div>
        <div class="tabs" style="margin:0 16px">
          <button class="tab ${state.localTab === 'datos' ? 'activo' : ''}" data-tab="datos">Datos del local</button>
          <button class="tab ${state.localTab === 'productos' ? 'activo' : ''}" data-tab="productos">Productos <span class="badge" style="margin-left:4px">${(r.productos || []).length}</span></button>
          <button class="tab ${state.localTab === 'imagenes' ? 'activo' : ''}" data-tab="imagenes">Logo y portada</button>
          ${state.sesion.rol === 'admin' ? `<button class="tab ${state.localTab === 'acceso' ? 'activo' : ''}" data-tab="acceso">Acceso del local</button>` : ''}
        </div>
      </div>
      <div id="localTabContent"></div>`;

    const volver = $('#volverLocales');
    if (volver) volver.addEventListener('click', () => ir('locales'));
    $('#importarCartaBtn').addEventListener('click', () => ir('ocr/' + r.carpeta));
    $$('[data-tab]', cont).forEach((b) => b.addEventListener('click', () => {
      state.localTab = b.dataset.tab;
      $$('[data-tab]', cont).forEach((x) => x.classList.toggle('activo', x === b));
      renderLocalTab();
    }));
    renderLocalTab();
  }

  function renderLocalTab() {
    const cont = $('#localTabContent');
    if (!cont) return;
    if (state.localTab === 'productos') return renderTabProductos(cont);
    if (state.localTab === 'imagenes') return renderTabImagenes(cont);
    if (state.localTab === 'acceso') return renderTabAcceso(cont);
    return renderTabDatos(cont);
  }

  /* ---------- Pestaña datos ---------- */
  function renderTabDatos(cont) {
    const r = state.local;
    const l = r.local;
    cont.innerHTML = `
      <form class="panel" id="formDatosLocal">
        <div class="panel-head"><div><h2>Datos del establecimiento</h2><p>Esta información aparece en la web pública.</p></div></div>
        <div class="panel-body">${camposLocal(l)}</div>
        <div class="panel-foot">
          ${state.sesion.rol === 'admin' ? '<button class="btn btn-danger left" type="button" id="eliminarLocalBtn" style="margin-right:auto">Eliminar local</button>' : ''}
          <button class="btn btn-primary" type="submit" id="guardarDatosBtn">Guardar cambios</button>
        </div>
      </form>`;
    const form = $('#formDatosLocal');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = $('#guardarDatosBtn');
      const local = leerFormLocal(l);
      if (!local.nombre) return toast('El nombre es obligatorio.', 'err');
      if (!local.id) local.id = l.id;
      try {
        bloquear(btn, true);
        await api('/api/admin/locales/' + encodeURIComponent(r.carpeta), {
          method: 'PUT',
          body: { local, productos: r.productos || [] }
        });
        toast('Datos guardados y catálogo actualizado.');
        await cargarBase();
        const nuevo = await api('/api/admin/locales/' + encodeURIComponent(r.carpeta));
        state.local = nuevo;
        pintarLocalHead();
      } catch (err) {
        avisarError(err);
      } finally {
        bloquear(btn, false);
      }
    });
    const eliminar = $('#eliminarLocalBtn');
    if (eliminar) eliminar.addEventListener('click', () => confirmarEliminarLocal(r));
  }

  function confirmarEliminarLocal(r) {
    const l = r.local;
    abrirModal({
      titulo: 'Eliminar local',
      ancho: 'narrow',
      cuerpo: `<p>Vas a eliminar <b>${esc(l.nombre)}</b> y sus ${(r.productos || []).length} productos del catálogo público.</p>
        <p class="mt-8 small muted">Se guarda un respaldo en <code>server/datos/respaldos</code> antes de eliminar.</p>
        <label class="field mt-16"><span>Escribe <b>ELIMINAR</b> para confirmar</span><input id="confirmarEliminar"></label>`,
      pie: `<button class="btn" data-cerrar>Cancelar</button><button class="btn btn-danger" id="borrarLocalBtn">Eliminar definitivamente</button>`
    });
    $('[data-cerrar]').addEventListener('click', cerrarModal);
    $('#borrarLocalBtn').addEventListener('click', async () => {
      if ($('#confirmarEliminar').value.trim() !== 'ELIMINAR') return toast('Escribe ELIMINAR para confirmar.', 'err');
      const btn = $('#borrarLocalBtn');
      try {
        bloquear(btn, true);
        await api('/api/admin/locales/' + encodeURIComponent(r.carpeta), { method: 'DELETE' });
        cerrarModal();
        toast('Local eliminado. Respaldo guardado.');
        await cargarBase();
        ir('locales');
      } catch (e) {
        bloquear(btn, false);
        avisarError(e);
      }
    });
  }

  /* ---------- Pestaña imágenes ---------- */
  function renderTabImagenes(cont) {
    const r = state.local;
    const l = r.local;
    cont.innerHTML = `
      <div class="panel">
        <div class="panel-head"><div><h2>Imágenes del local</h2><p>JPG o PNG. Las fotos se reducen a 1600 px. WEBP se convierte en el navegador.</p></div></div>
        <div class="panel-body">
          <div class="stack" style="gap:22px">
            ${bloqueImagen('logo', 'Logo', l.logo, r.carpeta, false)}
            ${bloqueImagen('portada', 'Portada', l.portada, r.carpeta, true)}
            ${bloqueImagen('cartaOriginal', 'Carta original (referencia)', l.cartaOriginal, r.carpeta, true)}
          </div>
        </div>
        <div class="panel-foot"><span class="small muted" style="margin-right:auto">Los cambios se guardan al subir cada imagen.</span></div>
      </div>`;
    $$('[data-upload-image]', cont).forEach((input) => {
      input.addEventListener('change', async () => {
        const campo = input.dataset.uploadImage;
        const archivo = input.files && input.files[0];
        if (!archivo) return;
        const label = input.closest('.img-actions');
        try {
          toast('Subiendo imagen…');
          const res = await subirImagenArchivo(archivo, { tipoDestino: 'local', carpeta: r.carpeta, prefijo: campo });
          const actual = Object.assign({}, state.local.local);
          actual[campo] = res.ruta;
          await api('/api/admin/locales/' + encodeURIComponent(r.carpeta), {
            method: 'PUT',
            body: { local: actual, productos: state.local.productos || [] }
          });
          state.local.local = actual;
          toast('Imagen actualizada.');
          await cargarBase();
          renderTabImagenes(cont);
          pintarLocalHead();
        } catch (e) {
          avisarError(e);
        } finally {
          input.value = '';
          if (label) label.classList.remove('cargando');
        }
      });
    });
    $$('[data-quitar-image]', cont).forEach((b) => b.addEventListener('click', async () => {
      const campo = b.dataset.quitarImage;
      const actual = Object.assign({}, state.local.local);
      actual[campo] = null;
      try {
        await api('/api/admin/locales/' + encodeURIComponent(r.carpeta), {
          method: 'PUT',
          body: { local: actual, productos: state.local.productos || [] }
        });
        state.local.local = actual;
        toast('Imagen quitada.');
        await cargarBase();
        renderTabImagenes(cont);
        pintarLocalHead();
      } catch (e) { avisarError(e); }
    }));
  }

  /* ---------- Pestaña acceso del local ---------- */
  async function renderTabAcceso(cont) {
    const r = state.local;
    cont.innerHTML = '<div class="panel"><div class="panel-body muted">Cargando accesos del local…</div></div>';
    let usuarios = [];
    let todosUsuarios = [];
    try {
      const res = await api('/api/admin/usuarios');
      todosUsuarios = res.usuarios || [];
      usuarios = todosUsuarios.filter((u) => u.rol === 'local' && u.localCarpeta === r.carpeta);
    } catch (e) {
      cont.innerHTML = '<div class="panel"><div class="panel-body"><p class="form-error">' + esc(e.message) + '</p></div></div>';
      return;
    }
    cont.innerHTML = `
      <div class="panel">
        <div class="panel-head">
          <div><h2>Acceso del local</h2><p>El encargado solo verá este establecimiento: sus ventas, sus pedidos y su catálogo.</p></div>
          <button class="btn btn-primary btn-sm" id="crearAccesoBtn">+ Crear acceso</button>
        </div>
        <div class="panel-body">
          ${usuarios.length ? `<div class="stack" style="gap:8px">${usuarios.map((u) => `
            <div class="quick-item" style="cursor:default">
              <div>
                <b>${esc(u.nombre || u.usuario)}</b>
                <span>${esc(u.usuario)} · ${u.activo ? 'Activo' : 'Inactivo'} · Último acceso: ${esc(fechaCorta(u.ultimoAcceso) || 'nunca')}</span>
              </div>
              <div class="row" style="gap:6px">
                <button class="btn btn-sm" data-ventas-acceso="${esc(r.carpeta)}">Ver ventas</button>
                <button class="btn btn-sm" data-editar-acceso="${esc(u.usuario)}">Editar</button>
              </div>
            </div>`).join('')}</div>`
          : `<div class="empty"><div class="big">🔐</div><h3>Este local aún no tiene acceso</h3><p>Crea un usuario para que el encargado vea sus ventas y edite solo su catálogo.</p><button class="btn btn-primary" id="crearAccesoVacio">+ Crear acceso para ${esc(r.local.nombre)}</button></div>`}
        </div>
      </div>
      <p class="small muted mt-16">El navegador mantiene una sola sesión a la vez. Para entrar como encargado, primero pulsa <b>Cerrar sesión</b> y luego usa el usuario y la contraseña que creaste aquí.</p>
      <div class="panel mt-16">
        <div class="panel-head"><div><h2>Qué podrá hacer</h2><p>Permisos del rol Encargado de local.</p></div></div>
        <div class="panel-body">
          <div class="stack" style="gap:8px">
            <div class="row"><span class="badge ok">Sí</span><span>Ver ventas, productos más vendidos e ingresos de su local.</span></div>
            <div class="row"><span class="badge ok">Sí</span><span>Agregar, editar, ocultar y eliminar solo sus productos.</span></div>
            <div class="row"><span class="badge ok">Sí</span><span>Ver y actualizar el estado de sus pedidos.</span></div>
            <div class="row"><span class="badge danger">No</span><span>Ver otros locales, catálogos globales, usuarios, auditoría o la página pública.</span></div>
          </div>
        </div>
      </div>`;

    const base = slugify(r.local.nombre, 26) + '-admin';
    let sugerido = base;
    let n = 2;
    while (todosUsuarios.some((u) => u.usuario === sugerido)) { sugerido = base + '-' + n; n += 1; }
    const crear = () => modalUsuario(null, {
      rol: 'local',
      localCarpeta: r.carpeta,
      nombre: 'Encargado · ' + r.local.nombre,
      usuario: sugerido
    }, async (usuarioCreado) => {
      await renderTabAcceso(cont);
      modalAccesoCreado(usuarioCreado, r.local.nombre);
    });
    const btnCrear = $('#crearAccesoBtn') || $('#crearAccesoVacio');
    if (btnCrear) btnCrear.addEventListener('click', crear);
    $$('[data-editar-acceso]', cont).forEach((b) => b.addEventListener('click', () => {
      const u = usuarios.find((x) => x.usuario === b.dataset.editarAcceso);
      if (u) modalUsuario(u, null, () => renderTabAcceso(cont));
    }));
    $$('[data-ventas-acceso]', cont).forEach((b) => b.addEventListener('click', () => {
      state.ventas = state.ventas || { desde: '', hasta: '', local: '', datos: null };
      state.ventas.local = b.dataset.ventasAcceso;
      ir('ventas');
    }));
  }

  function modalAccesoCreado(usuario, nombreLocal) {
    if (!usuario) return;
    abrirModal({
      titulo: 'Acceso creado',
      ancho: 'narrow',
      cuerpo: `<p>El usuario <b>${esc(usuario)}</b> ya puede entrar al panel.</p>
        <p class="small muted mt-8">Verá únicamente <b>${esc(nombreLocal)}</b>: sus ventas, sus pedidos y su catálogo.</p>
        <div class="panel mt-16" style="box-shadow:none">
          <div class="panel-body">
            <b>Para probarlo ahora</b>
            <p class="small muted mt-8">El navegador mantiene una sola sesión. Al continuar se cerrará tu sesión de administrador y el login aparecerá con el usuario ya escrito.</p>
          </div>
        </div>`,
      pie: `<button class="btn" data-cerrar>Entendido</button><button class="btn btn-primary" id="probarAcceso">Cerrar sesión y entrar</button>`
    });
    $('[data-cerrar]').addEventListener('click', cerrarModal);
    $('#probarAcceso').addEventListener('click', async () => {
      try { sessionStorage.setItem('enruta_usuario_sugerido', usuario); } catch (e) { /* sin almacenamiento */ }
      try { await api('/api/auth/logout', { method: 'POST' }); } catch (e) { /* la sesión ya no sirve */ }
      cerrarModal();
      location.assign(location.pathname);
    });
  }

  function bloqueImagen(campo, titulo, valor, carpeta, ancho) {
    const url = valor ? imgUrlLocal(carpeta, valor) : '';
    return `
      <div class="img-manager">
        <div class="img-preview ${ancho ? 'wide' : ''}">${url ? `<img src="${esc(url)}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:12px">` : '🖼'}</div>
        <div class="img-actions">
          <b style="font-size:13px">${esc(titulo)}</b>
          <span class="small muted">${valor ? esc(valor) : 'Sin imagen'}</span>
          <div class="row" style="gap:6px">
            <label class="btn btn-sm" style="cursor:pointer">Subir imagen<input class="file-input" type="file" accept="image/jpeg,image/png,image/webp" data-upload-image="${campo}"></label>
            ${valor ? `<button class="btn btn-sm btn-danger" type="button" data-quitar-image="${campo}">Quitar</button>` : ''}
          </div>
        </div>
      </div>`;
  }

  /* ---------- Subida de imágenes ---------- */
  function leerArchivoBase64(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result || ''));
      fr.onerror = () => reject(new Error('No se pudo leer el archivo.'));
      fr.readAsDataURL(file);
    });
  }

  async function prepararImagen(file) {
    const mime = (file.type || '').toLowerCase();
    const esWebp = mime === 'image/webp' || /\.webp$/i.test(file.name || '');
    const esPng = mime === 'image/png' || /\.png$/i.test(file.name || '');
    if (!/^image\/(jpeg|jpg|png|webp)$/i.test(mime) && !/\.(jpe?g|png|webp)$/i.test(file.name || '')) {
      throw new Error('Formato no válido. Usa JPG, PNG o WEBP.');
    }
    const dataUrl = await leerArchivoBase64(file);
    if (!esWebp) {
      try {
        const img = await cargarImagen(dataUrl);
        if (img.width <= 2400 && img.height <= 2400) {
          return { dataUrl, mime: esPng ? 'image/png' : 'image/jpeg', nombre: file.name };
        }
        const conv = await convertirImagen(img, 2400, esPng ? 'image/png' : 'image/jpeg');
        return { dataUrl: conv, mime: esPng ? 'image/png' : 'image/jpeg', nombre: file.name };
      } catch (e) {
        return { dataUrl, mime: esPng ? 'image/png' : 'image/jpeg', nombre: file.name };
      }
    }
    const img = await cargarImagen(dataUrl);
    const conv = await convertirImagen(img, 2400, 'image/jpeg');
    return { dataUrl: conv, mime: 'image/jpeg', nombre: file.name.replace(/\.webp$/i, '.jpg') };
  }

  function cargarImagen(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('La imagen no se pudo decodificar.'));
      img.src = src;
    });
  }
  function convertirImagen(img, max, mime) {
    const ratio = Math.min(1, max / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * ratio));
    const h = Math.max(1, Math.round(img.height * ratio));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (mime === 'image/jpeg') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); }
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL(mime, 0.9);
  }

  async function subirImagenArchivo(file, { tipoDestino, carpeta, prefijo }) {
    const prep = await prepararImagen(file);
    return api('/api/admin/imagenes', {
      method: 'POST',
      body: {
        tipoDestino,
        carpeta,
        nombre: prep.nombre,
        tipoMime: prep.mime,
        datosBase64: prep.dataUrl,
        prefijo
      }
    });
  }

  /* ============================================================
     LOCAL · PRODUCTOS
     ============================================================ */
  let filtroProductos = { q: '', grupo: 'todos' };
  const seleccionProductos = new Set();
  let mapStatsProductos = new Map();

  function renderTabProductos(cont) {
    const r = state.local;
    const productos = r.productos || [];
    mapStatsProductos = new Map();
    const statsProd = (state.statsLocal && state.statsLocal.productos) || [];
    statsProd.forEach((s) => { mapStatsProductos.set(String(s.productoId), s); });
    const idsVigentes = new Set(productos.map((p) => String(p.id)));
    Array.from(seleccionProductos).forEach((id) => { if (!idsVigentes.has(String(id))) seleccionProductos.delete(id); });
    const grupos = Array.from(new Set(productos.map((p) => p.grupo || 'Carta'))).sort((a, b) => a.localeCompare(b, 'es'));
    const q = norm(filtroProductos.q);
    const fg = filtroProductos.grupo;
    const lista = productos.filter((p) => {
      if (fg !== 'todos' && (p.grupo || 'Carta') !== fg) return false;
      if (q) {
        const t = norm([p.nombre, p.descripcion, p.subcategoria, p.grupo].join(' '));
        if (!t.includes(q)) return false;
      }
      return true;
    });

    cont.innerHTML = `
      <div class="panel">
        <div class="panel-head">
          <div><h2>Productos del local</h2><p>${productos.length} en total · ${productos.filter((p) => p.publicado !== false).length} publicados.</p></div>
          <div class="row">
            <button class="btn btn-sm" id="exportarProductos">Exportar JSON</button>
            <button class="btn btn-danger btn-sm" id="borrarSeleccionados" disabled>Eliminar seleccionados</button>
            <button class="btn btn-primary btn-sm" id="nuevoProductoBtn">+ Nuevo producto</button>
          </div>
        </div>
        <div class="panel-body" style="padding-bottom:0">
          <div class="toolbar">
            <div class="search"><input class="input" id="buscarProducto" type="search" placeholder="Buscar producto" value="${esc(filtroProductos.q)}"></div>
            <select class="input" id="filtroGrupo" style="max-width:240px">
              <option value="todos">Todas las categorías</option>
              ${grupos.map((g) => `<option value="${esc(g)}" ${g === fg ? 'selected' : ''}>${esc(g)}</option>`).join('')}
            </select>
            <span class="small muted">${lista.length} visibles</span>
          </div>
        </div>
        <div class="table-wrap">
          ${lista.length ? `<table class="table">
            <thead><tr><th class="chk-col"><input type="checkbox" id="prodTodos" aria-label="Seleccionar todos los visibles"></th><th>Producto</th><th>Categoría</th><th>Precio</th><th>Vendidos (30 d)</th><th>Estado</th><th>Acciones</th></tr></thead>
            <tbody>
              ${lista.map((p) => filaProducto(p)).join('')}
            </tbody>
          </table>` : `<div class="empty"><div class="big">🍽</div><h3>Sin productos</h3><p>Agrega productos manualmente o importa una carta con OCR.</p><button class="btn btn-primary" id="nuevoProductoVacio">+ Nuevo producto</button></div>`}
        </div>
      </div>`;

    const buscar = $('#buscarProducto');
    if (buscar) buscar.addEventListener('input', debounce(() => {
      filtroProductos.q = buscar.value;
      renderTabProductos(cont);
      const b = $('#buscarProducto'); if (b) { b.focus(); b.setSelectionRange(b.value.length, b.value.length); }
    }, 180));
    const grupo = $('#filtroGrupo');
    if (grupo) grupo.addEventListener('change', () => { filtroProductos.grupo = grupo.value; renderTabProductos(cont); });
    const nuevo = $('#nuevoProductoBtn') || $('#nuevoProductoVacio');
    if (nuevo) nuevo.addEventListener('click', () => modalProducto(null));
    const exp = $('#exportarProductos');
    if (exp) exp.addEventListener('click', () => descargarJson('productos-' + r.carpeta + '.json', { localId: r.local.id, productos }));

    const btnBorrarSel = $('#borrarSeleccionados');
    const chkTodos = $('#prodTodos');
    function refrescarSeleccion() {
      const visibles = $$('[data-prod-check]', cont);
      const marcados = visibles.filter((c) => c.checked);
      if (btnBorrarSel) {
        btnBorrarSel.disabled = seleccionProductos.size === 0;
        btnBorrarSel.textContent = seleccionProductos.size
          ? 'Eliminar seleccionados (' + seleccionProductos.size + ')'
          : 'Eliminar seleccionados';
      }
      if (chkTodos) {
        chkTodos.checked = visibles.length > 0 && marcados.length === visibles.length;
        chkTodos.indeterminate = marcados.length > 0 && marcados.length < visibles.length;
      }
    }
    $$('[data-prod-check]', cont).forEach((chk) => chk.addEventListener('change', () => {
      const id = String(chk.dataset.prodCheck);
      if (chk.checked) seleccionProductos.add(id); else seleccionProductos.delete(id);
      chk.closest('tr').classList.toggle('row-seleccionado', chk.checked);
      refrescarSeleccion();
    }));
    if (chkTodos) chkTodos.addEventListener('change', () => {
      $$('[data-prod-check]', cont).forEach((chk) => {
        chk.checked = chkTodos.checked;
        const id = String(chk.dataset.prodCheck);
        if (chk.checked) seleccionProductos.add(id); else seleccionProductos.delete(id);
        chk.closest('tr').classList.toggle('row-seleccionado', chk.checked);
      });
      refrescarSeleccion();
    });
    refrescarSeleccion();
    if (btnBorrarSel) btnBorrarSel.addEventListener('click', confirmarBorrarSeleccionados);

    $$('[data-editar-producto]', cont).forEach((b) => b.addEventListener('click', () => {
      const p = productos.find((x) => String(x.id) === b.dataset.editarProducto);
      if (p) modalProducto(p);
    }));
    $$('[data-borrar-producto]', cont).forEach((b) => b.addEventListener('click', () => confirmarBorrarProducto(b.dataset.borrarProducto)));
    $$('[data-toggle-prod]', cont).forEach((b) => b.addEventListener('click', () => toggleProducto(b.dataset.toggleProd, b.dataset.campo, b)));
  }

  function filaProducto(p) {
    const imagen = p.imagen ? `<img class="mini-img" src="${esc(imgUrlLocal(state.localCarpeta, p.imagen))}" alt="">` : '<div class="thumb-empty">🍽</div>';
    const variantes = Array.isArray(p.variantes) && p.variantes.length
      ? `<div class="sub">${p.variantes.length} variante(s) desde ${money(Math.min(...p.variantes.map((v) => num(v.precio))))}</div>` : '';
    const extras = Array.isArray(p.extras) && p.extras.length ? `<div class="sub">${p.extras.length} extra(s)</div>` : '';
    const precio = p.precio ? money(p.precio) : '<span class="badge warn">Sin precio</span>';
    const stat = mapStatsProductos.get(String(p.id));
    const vendidos = stat
      ? `<b>${stat.unidades}</b><div class="sub">${money(stat.ventas)}</div>`
      : '<span class="muted">—</span>';
    const marcado = seleccionProductos.has(String(p.id));
    return `<tr class="${p.publicado === false ? 'row-inactivo' : ''}${marcado ? ' row-seleccionado' : ''}">
      <td class="chk-col"><input type="checkbox" class="prod-check" data-prod-check="${esc(p.id)}" ${marcado ? 'checked' : ''} aria-label="Seleccionar ${esc(p.nombre)}"></td>
      <td>
        <div class="row" style="gap:10px;flex-wrap:nowrap">
          ${imagen}
          <div>
            <div class="nombre">${esc(p.nombre)}</div>
            ${p.descripcion ? `<div class="sub">${esc(p.descripcion).slice(0, 90)}</div>` : ''}
            ${variantes}${extras}
          </div>
        </div>
      </td>
      <td><span class="badge">${esc(p.grupo || 'Carta')}</span>${p.subcategoria ? `<div class="sub">${esc(p.subcategoria)}</div>` : ''}</td>
      <td class="precio">${precio}</td>
      <td>${vendidos}</td>
      <td>
        <div class="stack" style="gap:4px;align-items:flex-start">
          ${badgeEstado(p.publicado !== false, p.disponible !== false, p.revisar === true)}
          ${p.origen === 'ocr' ? '<span class="badge info">OCR</span>' : ''}
        </div>
      </td>
      <td>
        <div class="acciones">
          <button class="btn btn-sm" data-editar-producto="${esc(p.id)}">Editar</button>
          <button class="link-btn" data-toggle-prod="${esc(p.id)}" data-campo="publicado">${p.publicado === false ? 'Publicar' : 'Ocultar'}</button>
          <button class="link-btn" data-toggle-prod="${esc(p.id)}" data-campo="disponible">${p.disponible === false ? 'Disponible' : 'Agotar'}</button>
          <button class="link-btn" style="color:#c62828" data-borrar-producto="${esc(p.id)}">Eliminar</button>
        </div>
      </td>
    </tr>`;
  }

  function nuevoProductoBase() {
    return {
      nombre: '', descripcion: '', precio: null, grupo: '', subcategoria: '',
      emoji: '', etiqueta: '', imagen: null, publicado: true, disponible: true,
      revisar: false, variantes: [], extras: []
    };
  }

  function variantesHtml(variantes) {
    const filas = (Array.isArray(variantes) ? variantes : []).map((v, i) => `
      <div class="variant-row" data-variante="${i}">
        <input type="text" placeholder="Nombre (ej. Personal)" value="${esc(v.nombre || '')}" data-var-nombre>
        <input type="number" min="0" step="0.01" placeholder="Precio" value="${esc(v.precio || '')}" data-var-precio>
        <button class="icon-btn" type="button" data-quitar-variante title="Quitar">✕</button>
      </div>`).join('');
    return filas || '<p class="small muted" data-sin-variantes>Sin variantes. Agrega una si el producto tiene tamaños o presentaciones.</p>';
  }
  function extrasHtml(extras) {
    const filas = (Array.isArray(extras) ? extras : []).map((e, i) => `
      <div class="extra-row" data-extra="${i}">
        <input type="text" placeholder="Nombre (ej. Queso adicional)" value="${esc(e.nombre || '')}" data-extra-nombre>
        <input type="number" min="0" step="0.01" placeholder="Precio" value="${esc(e.precio || '')}" data-extra-precio>
        <button class="icon-btn" type="button" data-quitar-extra title="Quitar">✕</button>
      </div>`).join('');
    return filas || '<p class="small muted" data-sin-extras>Sin extras. Úsalos para adicionales con precio propio.</p>';
  }

  function modalProducto(producto) {
    const esNuevo = !producto;
    const p = producto ? Object.assign({}, producto) : nuevoProductoBase();
    const r = state.local;
    const grupos = Array.from(new Set((r.productos || []).map((x) => x.grupo).filter(Boolean)));
    const sugeridas = Array.from(new Set([...grupos, ...CATEGORIAS_SUGERIDAS]));
    const imagenUrl = p.imagen ? imgUrlLocal(r.carpeta, p.imagen) : '';
    const pie = `<button class="btn" data-cerrar>Cancelar</button><button class="btn btn-primary" id="guardarProductoBtn">${esNuevo ? 'Agregar producto' : 'Guardar cambios'}</button>`;
    abrirModal({
      titulo: esNuevo ? 'Nuevo producto' : 'Editar producto',
      ancho: 'wide',
      pie,
      cuerpo: `
        <form id="formProducto">
          <div class="form-grid">
            <label class="field full"><span>Nombre *</span><input id="pfNombre" value="${esc(p.nombre || '')}" maxlength="140" required></label>
            <label class="field full"><span>Descripción</span><textarea id="pfDescripcion" maxlength="400">${esc(p.descripcion || '')}</textarea></label>
            <label class="field"><span>Precio (S/)</span><input id="pfPrecio" type="number" min="0" step="0.01" value="${esc(p.precio || '')}"><span class="hint">Si usas variantes, el precio base puede quedar vacío.</span></label>
            <label class="field"><span>Categoría / grupo *</span><input id="pfGrupo" list="listaGrupos" value="${esc(p.grupo || '')}" maxlength="60" placeholder="Ej. Hamburguesas"><datalist id="listaGrupos">${sugeridas.map((g) => `<option value="${esc(g)}">`).join('')}</datalist></label>
            <label class="field"><span>Subcategoría / sección</span><input id="pfSubcategoria" value="${esc(p.subcategoria || '')}" maxlength="60" placeholder="Ej. Combos"></label>
            <label class="field"><span>Etiqueta</span><input id="pfEtiqueta" value="${esc(p.etiqueta || '')}" maxlength="40" placeholder="Más vendido"></label>
            <label class="field"><span>Emoji</span><input id="pfEmoji" value="${esc(p.emoji || '')}" maxlength="8" placeholder="🍔"></label>
          </div>

          <div class="form-section">
            <h3>Imagen del producto</h3>
            <div class="img-manager">
              <div class="img-preview" id="prodImgPreview">${imagenUrl ? `<img src="${esc(imagenUrl)}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:12px">` : '🍽'}</div>
              <div class="img-actions">
                <span class="small muted" id="prodImgRuta">${p.imagen ? esc(p.imagen) : 'Sin imagen'}</span>
                <div class="row">
                  <label class="btn btn-sm" style="cursor:pointer">Subir imagen<input class="file-input" type="file" accept="image/jpeg,image/png,image/webp" id="prodImgFile"></label>
                  ${p.imagen ? '<button class="btn btn-sm btn-danger" type="button" id="prodImgQuitar">Quitar</button>' : ''}
                </div>
                <span class="hint">No inventes fotos del negocio. Si no tienes una foto real, deja el producto sin imagen.</span>
              </div>
            </div>
            <input type="hidden" id="pfImagen" value="${esc(p.imagen || '')}">
          </div>

          <div class="form-section">
            <h3>Variantes <span class="small muted">(tamaños o presentaciones con precio propio)</span></h3>
            <div id="variantesLista">${variantesHtml(p.variantes)}</div>
            <button class="btn btn-sm mt-8" type="button" id="addVariante">+ Agregar variante</button>
          </div>

          <div class="form-section">
            <h3>Extras <span class="small muted">(adicionales con precio)</span></h3>
            <div id="extrasLista">${extrasHtml(p.extras)}</div>
            <button class="btn btn-sm mt-8" type="button" id="addExtra">+ Agregar extra</button>
          </div>

          <div class="form-section">
            <h3>Estado</h3>
            <div class="row" style="gap:18px">
              <label class="check"><input id="pfPublicado" type="checkbox" ${p.publicado !== false ? 'checked' : ''}> Publicado</label>
              <label class="check"><input id="pfDisponible" type="checkbox" ${p.disponible !== false ? 'checked' : ''}> Disponible</label>
              <label class="check"><input id="pfRevisar" type="checkbox" ${p.revisar === true ? 'checked' : ''}> Marcar para revisión</label>
            </div>
          </div>
        </form>`
    });

    $('[data-cerrar]').addEventListener('click', cerrarModal);
    if (!$('#pfGrupo').value) $('#pfGrupo').value = 'Carta';

    function refrescarVariantes() {
      const lista = $('#variantesLista');
      lista.innerHTML = variantesHtml(leerVariantes());
      enlazarFilas();
    }
    function refrescarExtras() {
      const lista = $('#extrasLista');
      lista.innerHTML = extrasHtml(leerExtras());
      enlazarFilas();
    }
    function leerVariantes() {
      return $$('#variantesLista .variant-row').map((row, i) => ({
        id: p.variantes && p.variantes[i] ? (p.variantes[i].id || 'v' + (i + 1)) : 'v' + (i + 1),
        nombre: $('[data-var-nombre]', row).value.trim(),
        precio: num($('[data-var-precio]', row).value)
      })).filter((v) => v.nombre || v.precio > 0);
    }
    function leerExtras() {
      return $$('#extrasLista .extra-row').map((row) => ({
        nombre: $('[data-extra-nombre]', row).value.trim(),
        precio: num($('[data-extra-precio]', row).value)
      })).filter((e) => e.nombre);
    }
    function enlazarFilas() {
      $$('[data-quitar-variante]').forEach((b) => b.onclick = () => {
        const actuales = leerVariantes();
        const idx = Number(b.closest('.variant-row').dataset.variante);
        actuales.splice(idx, 1);
        $('#variantesLista').innerHTML = variantesHtml(actuales);
        enlazarFilas();
      });
      $$('[data-quitar-extra]').forEach((b) => b.onclick = () => {
        const actuales = leerExtras();
        const idx = Number(b.closest('.extra-row').dataset.extra);
        actuales.splice(idx, 1);
        $('#extrasLista').innerHTML = extrasHtml(actuales);
        enlazarFilas();
      });
    }
    enlazarFilas();
    $('#addVariante').addEventListener('click', () => {
      const actuales = leerVariantes();
      actuales.push({ id: 'v' + (actuales.length + 1), nombre: '', precio: 0 });
      $('#variantesLista').innerHTML = variantesHtml(actuales);
      enlazarFilas();
      const rows = $$('#variantesLista .variant-row');
      if (rows.length) $('[data-var-nombre]', rows[rows.length - 1]).focus();
    });
    $('#addExtra').addEventListener('click', () => {
      const actuales = leerExtras();
      actuales.push({ nombre: '', precio: 0 });
      $('#extrasLista').innerHTML = extrasHtml(actuales);
      enlazarFilas();
      const rows = $$('#extrasLista .extra-row');
      if (rows.length) $('[data-extra-nombre]', rows[rows.length - 1]).focus();
    });

    const fileInput = $('#prodImgFile');
    if (fileInput) fileInput.addEventListener('change', async () => {
      const archivo = fileInput.files && fileInput.files[0];
      if (!archivo) return;
      try {
        toast('Subiendo imagen…');
        const res = await subirImagenArchivo(archivo, { tipoDestino: 'local', carpeta: r.carpeta, prefijo: 'prod' });
        $('#pfImagen').value = res.ruta;
        $('#prodImgRuta').textContent = res.ruta;
        $('#prodImgPreview').innerHTML = `<img src="${esc(imgUrlLocal(r.carpeta, res.ruta))}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:12px">`;
        if (!$('#prodImgQuitar')) {
          const quitar = document.createElement('button');
          quitar.className = 'btn btn-sm btn-danger';
          quitar.type = 'button';
          quitar.id = 'prodImgQuitar';
          quitar.textContent = 'Quitar';
          fileInput.closest('.row').appendChild(quitar);
          quitar.addEventListener('click', () => quitarImagen());
        }
        toast('Imagen lista. Guarda el producto para publicarla.');
      } catch (e) {
        avisarError(e);
      } finally { fileInput.value = ''; }
    });
    function quitarImagen() {
      $('#pfImagen').value = '';
      $('#prodImgRuta').textContent = 'Sin imagen';
      $('#prodImgPreview').innerHTML = '🍽';
      const q = $('#prodImgQuitar'); if (q) q.remove();
    }
    const quitar = $('#prodImgQuitar');
    if (quitar) quitar.addEventListener('click', quitarImagen);

    $('#guardarProductoBtn').addEventListener('click', async () => {
      const btn = $('#guardarProductoBtn');
      const variantes = leerVariantes();
      const extras = leerExtras();
      const datos = {
        id: p.id || undefined,
        nombre: $('#pfNombre').value.trim(),
        descripcion: $('#pfDescripcion').value.trim(),
        precio: $('#pfPrecio').value === '' ? null : num($('#pfPrecio').value),
        grupo: $('#pfGrupo').value.trim() || 'Carta',
        subcategoria: $('#pfSubcategoria').value.trim(),
        etiqueta: $('#pfEtiqueta').value.trim(),
        emoji: $('#pfEmoji').value.trim(),
        imagen: $('#pfImagen').value || null,
        publicado: $('#pfPublicado').checked,
        disponible: $('#pfDisponible').checked,
        revisar: $('#pfRevisar').checked,
        variantes,
        extras
      };
      if (!datos.nombre) return toast('Escribe el nombre del producto.', 'err');
      if (datos.publicado && !(datos.precio > 0) && variantes.length === 0) {
        return toast('Un producto publicado necesita precio o al menos una variante con precio.', 'err');
      }
      const sinPrecio = variantes.find((v) => !(v.precio > 0));
      if (sinPrecio) return toast('La variante "' + (sinPrecio.nombre || '(sin nombre)') + '" necesita precio.', 'err');
      try {
        bloquear(btn, true);
        if (esNuevo) {
          await api('/api/admin/locales/' + encodeURIComponent(r.carpeta) + '/productos', { method: 'POST', body: { producto: datos } });
        } else {
          await api('/api/admin/locales/' + encodeURIComponent(r.carpeta) + '/productos/' + encodeURIComponent(p.id), { method: 'PUT', body: { producto: datos } });
        }
        cerrarModal();
        toast(esNuevo ? 'Producto agregado.' : 'Producto actualizado.');
        await recargarLocal();
      } catch (e) {
        bloquear(btn, false);
        avisarError(e);
      }
    });
  }

  async function recargarLocal() {
    const r = await api('/api/admin/locales/' + encodeURIComponent(state.localCarpeta));
    state.local = r;
    const tab = state.localTab;
    pintarLocalHead();
    state.localTab = tab;
    $$('#view-local [data-tab]').forEach((x) => x.classList.toggle('activo', x.dataset.tab === tab));
    renderLocalTab();
    cargarBase().catch(() => {});
  }

  async function toggleProducto(id, campo, btn) {
    const p = (state.local.productos || []).find((x) => String(x.id) === String(id));
    if (!p) return;
    const copia = Object.assign({}, p);
    if (campo === 'publicado') copia.publicado = p.publicado === false;
    else copia.disponible = p.disponible === false;
    try {
      bloquear(btn, true);
      await api('/api/admin/locales/' + encodeURIComponent(state.localCarpeta) + '/productos/' + encodeURIComponent(id), { method: 'PUT', body: { producto: copia } });
      await recargarLocal();
      toast('Producto actualizado.');
    } catch (e) {
      avisarError(e);
      bloquear(btn, false);
    }
  }

  function confirmarBorrarSeleccionados() {
    const ids = Array.from(seleccionProductos);
    if (!ids.length) { toast('Selecciona al menos un producto.', 'err'); return; }
    const productos = state.local.productos || [];
    const nombres = ids.map((id) => {
      const p = productos.find((x) => String(x.id) === String(id));
      return p ? p.nombre : id;
    });
    const listaHtml = nombres.slice(0, 12).map((n) => `<li>${esc(n)}</li>`).join('');
    const resto = nombres.length > 12 ? `<p class="small muted mt-8">y ${nombres.length - 12} más…</p>` : '';
    abrirModal({
      titulo: 'Eliminar ' + ids.length + ' producto' + (ids.length === 1 ? '' : 's'),
      ancho: 'narrow',
      cuerpo: `<p>Se quitarán del catálogo de <b>${esc(state.local.local.nombre)}</b>:</p>
        <ul class="lista-eliminar mt-8">${listaHtml}</ul>${resto}
        <p class="small muted mt-8">Se guarda un respaldo antes de aplicar el cambio y queda registrado en la auditoría.</p>`,
      pie: `<button class="btn" data-cerrar>Cancelar</button><button class="btn btn-danger" id="confirmarBorrarVarios">Eliminar ${ids.length}</button>`
    });
    $('[data-cerrar]').addEventListener('click', cerrarModal);
    $('#confirmarBorrarVarios').addEventListener('click', async () => {
      const btn = $('#confirmarBorrarVarios');
      try {
        bloquear(btn, true);
        const res = await api('/api/admin/locales/' + encodeURIComponent(state.localCarpeta) + '/productos/eliminar', { method: 'POST', body: { ids } });
        seleccionProductos.clear();
        cerrarModal();
        toast((res.eliminados || ids.length) + ' producto(s) eliminados.');
        await recargarLocal();
      } catch (e) {
        bloquear(btn, false);
        avisarError(e);
      }
    });
  }

  function confirmarBorrarProducto(id) {
    const p = (state.local.productos || []).find((x) => String(x.id) === String(id));
    if (!p) return;
    abrirModal({
      titulo: 'Eliminar producto',
      ancho: 'narrow',
      cuerpo: `<p>¿Eliminar <b>${esc(p.nombre)}</b> del catálogo?</p><p class="small muted mt-8">Esta acción queda registrada en la auditoría. El catálogo público se regenera al confirmar.</p>`,
      pie: `<button class="btn" data-cerrar>Cancelar</button><button class="btn btn-danger" id="confirmarBorrarProd">Eliminar</button>`
    });
    $('[data-cerrar]').addEventListener('click', cerrarModal);
    $('#confirmarBorrarProd').addEventListener('click', async () => {
      const btn = $('#confirmarBorrarProd');
      try {
        bloquear(btn, true);
        await api('/api/admin/locales/' + encodeURIComponent(state.localCarpeta) + '/productos/' + encodeURIComponent(id), { method: 'DELETE' });
        cerrarModal();
        toast('Producto eliminado.');
        await recargarLocal();
      } catch (e) {
        bloquear(btn, false);
        avisarError(e);
      }
    });
  }

  /* ============================================================
     OCR · IMPORTAR CARTA
     ============================================================ */
  let ocrKeySeq = 0;

  async function vistaOcr(carpeta) {
    mostrarVista('ocr');
    if (carpeta) state.ocr.carpeta = carpeta;
    if (!state.ocr.carpeta && state.sesion.rol === 'local') state.ocr.carpeta = state.sesion.localCarpeta || '';
    if (!state.ocr.carpeta && state.locales.length) state.ocr.carpeta = state.locales[0].carpeta;
    const cont = $('#view-ocr');
    const locales = state.locales;
    const ocrOk = state.sistema && state.sistema.ocr;

    cont.innerHTML = `
      <div class="ocr-layout">
        <div class="stack">
          <div class="panel">
            <div class="panel-head"><div><h2>1 · Elige el local y sube la carta</h2><p>Una imagen por página o un PDF con varias páginas.</p></div></div>
            <div class="panel-body">
              ${ocrOk ? '' : `<p class="form-error mb-16">El OCR de Windows no está disponible. ${esc((state.sistema && state.sistema.ocrMensaje) || '')}</p>`}
              <label class="field mb-16">
                <span>Local destino *</span>
                <select id="ocrLocal" class="input" ${locales.length ? '' : 'disabled'}>
                  ${locales.length ? locales.map((l) => `<option value="${esc(l.carpeta)}" ${l.carpeta === state.ocr.carpeta ? 'selected' : ''}>${esc(l.nombre)} (${l.totalProductos} productos)</option>`).join('') : '<option value="">No hay locales disponibles</option>'}
                </select>
              </label>

              <div class="dropzone" id="ocrDrop">
                <div class="big">📄</div>
                <b>Arrastra aquí tus cartas</b>
                <p>JPG, PNG, WEBP o PDF · hasta 15 MB por archivo</p>
                <label class="btn btn-primary" style="cursor:pointer">Elegir archivos<input class="file-input" id="ocrFileInput" type="file" multiple accept="image/jpeg,image/png,image/webp,application/pdf,.jpg,.jpeg,.png,.webp,.pdf" ${locales.length ? '' : 'disabled'}></label>
              </div>

              <ul class="file-list" id="ocrFileList"></ul>

              <div class="progress" id="ocrProgressWrap" hidden><div id="ocrProgress"></div></div>
              <p class="small muted" id="ocrProgressText" hidden></p>

              <div class="row mt-16">
                <button class="btn btn-primary" id="ocrProcesarBtn" disabled>Procesar cartas</button>
                <button class="btn" id="ocrLimpiarBtn" disabled>Limpiar</button>
              </div>
              <p class="small muted mt-8">Se procesa en este servidor local. Las fotos se reducen y WEBP se convierte antes de enviarse. El texto y los borradores quedan en <code>server/datos/importaciones</code>.</p>
            </div>
          </div>

          <div class="panel">
            <div class="panel-head"><div><h2>Importaciones guardadas</h2><p>Borra lo que no te sirva o retoma un borrador.</p></div></div>
            <div class="panel-body" id="ocrImportaciones"><p class="small muted">Cargando…</p></div>
          </div>
        </div>

        <div class="stack" id="ocrResultado">
          <div class="panel">
            <div class="empty">
              <div class="big">◫</div>
              <h3>Previsualización editable</h3>
              <p>Sube una o varias cartas y pulsa “Procesar cartas”. Aquí aparecerán los productos detectados para revisarlos antes de publicar.</p>
            </div>
          </div>
        </div>
      </div>`;

    $('#ocrLocal').addEventListener('change', (e) => {
      state.ocr.carpeta = e.target.value;
      history.replaceState(null, '', '#/ocr/' + state.ocr.carpeta);
      cargarImportacionesOcr();
    });
    const input = $('#ocrFileInput');
    input.addEventListener('change', () => { agregarArchivosOcr(input.files); input.value = ''; });
    const drop = $('#ocrDrop');
    ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('drag'); }));
    ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('drag'); }));
    drop.addEventListener('drop', (e) => { if (e.dataTransfer && e.dataTransfer.files) agregarArchivosOcr(e.dataTransfer.files); });
    $('#ocrProcesarBtn').addEventListener('click', procesarArchivosOcr);
    $('#ocrLimpiarBtn').addEventListener('click', limpiarOcr);

    pintarArchivosOcr();
    pintarResultadoOcr();
    cargarImportacionesOcr();
  }

  function agregarArchivosOcr(fileList) {
    const archivos = Array.from(fileList || []);
    if (!archivos.length) return;
    for (const f of archivos) {
      const ext = (f.name.split('.').pop() || '').toLowerCase();
      if (!['jpg', 'jpeg', 'png', 'webp', 'pdf'].includes(ext)) {
        toast('Archivo omitido: ' + f.name + ' (usa JPG, PNG, WEBP o PDF).', 'err');
        continue;
      }
      if (f.size > 15 * 1024 * 1024) {
        toast('Archivo omitido: ' + f.name + ' supera 15 MB.', 'err');
        continue;
      }
      if (state.ocr.archivos.length >= 20) { toast('Máximo 20 archivos por lote.', 'err'); break; }
      state.ocr.archivos.push({
        id: 'f' + (++ocrKeySeq), archivo: f, nombre: f.name, bytes: f.size,
        tipo: ext === 'pdf' ? 'pdf' : 'imagen', estado: 'listo', error: '', paginas: 0
      });
    }
    pintarArchivosOcr();
  }

  function pintarArchivosOcr() {
    const lista = $('#ocrFileList');
    if (!lista) return;
    lista.innerHTML = state.ocr.archivos.map((f) => {
      const icono = f.tipo === 'pdf' ? '📕' : '🖼';
      return `<li class="file-item ${f.estado === 'error' ? 'err' : ''}" data-archivo="${f.id}">
        <span style="font-size:20px">${icono}</span>
        <div class="fi-info">
          <b>${esc(f.nombre)}</b>
          <span>${bytesTxt(f.bytes)} · ${esc(f.estado)}${f.paginas ? ' · ' + f.paginas + ' pág.' : ''}${f.error ? ' · ' + esc(f.error) : ''}</span>
        </div>
        <button class="icon-btn" type="button" data-quitar-archivo="${f.id}" aria-label="Quitar" ${state.ocr.procesando ? 'disabled' : ''}>✕</button>
      </li>`;
    }).join('');
    $$('[data-quitar-archivo]', lista).forEach((b) => b.addEventListener('click', () => {
      state.ocr.archivos = state.ocr.archivos.filter((x) => x.id !== b.dataset.quitarArchivo);
      pintarArchivosOcr();
    }));
    const hay = state.ocr.archivos.length > 0;
    $('#ocrProcesarBtn').disabled = !hay || state.ocr.procesando || !state.ocr.carpeta;
    $('#ocrLimpiarBtn').disabled = state.ocr.procesando || (!hay && !state.ocr.productos.length);
  }

  function limpiarOcr() {
    if (state.ocr.procesando) return;
    const hayTrabajo = state.ocr.productos.length > 0;
    if (hayTrabajo && !confirm('¿Descartar los productos detectados que no has guardado?')) return;
    state.ocr.archivos = [];
    state.ocr.productos = [];
    state.ocr.texto = '';
    state.ocr.importacionId = null;
    state.ocr.resultado = null;
    pintarArchivosOcr();
    pintarResultadoOcr();
  }

  async function prepararArchivoOcr(f) {
    const ext = (f.nombre.split('.').pop() || '').toLowerCase();
    if (ext === 'pdf') {
      const dataUrl = await leerArchivoBase64(f.archivo);
      return { dataUrl, nombre: f.nombre, tipo: 'application/pdf' };
    }
    const prep = await prepararImagen(f.archivo);
    return { dataUrl: prep.dataUrl, nombre: ext === 'webp' ? f.nombre.replace(/\.webp$/i, '.jpg') : f.nombre, tipo: prep.mime };
  }

  async function procesarArchivosOcr() {
    if (state.ocr.procesando) return;
    if (!state.ocr.carpeta) return toast('Elige el local destino.', 'err');
    if (!state.ocr.archivos.length) return toast('Agrega al menos una imagen o PDF.', 'err');
    if (!(state.sistema && state.sistema.ocr)) return toast('El OCR no está disponible en el servidor.', 'err');

    state.ocr.procesando = true;
    state.ocr.productos = [];
    state.ocr.texto = '';
    state.ocr.importacionId = null;
    state.ocr.resultado = null;
    pintarResultadoOcr();
    pintarArchivosOcr();
    const wrap = $('#ocrProgressWrap');
    const barra = $('#ocrProgress');
    const txt = $('#ocrProgressText');
    if (wrap) wrap.hidden = false;
    if (txt) txt.hidden = false;

    const total = state.ocr.archivos.length;
    let completados = 0;
    let errores = 0;
    let paginasTotal = 0;
    const archivosMeta = [];

    for (const f of state.ocr.archivos) {
      f.estado = 'procesando'; f.error = '';
      pintarArchivosOcr();
      if (txt) txt.textContent = 'Procesando ' + f.nombre + ' (' + (completados + 1) + ' de ' + total + ')…';
      if (barra) barra.style.width = Math.round((completados / total) * 100) + '%';
      try {
        const prep = await prepararArchivoOcr(f);
        const res = await api('/api/admin/ocr/procesar', {
          method: 'POST',
          body: { localCarpeta: state.ocr.carpeta, nombre: prep.nombre, datosBase64: prep.dataUrl }
        });
        f.estado = 'ok';
        f.paginas = Number(res.totalPaginas) || 1;
        paginasTotal += f.paginas;
        archivosMeta.push({ nombre: f.nombre, paginas: f.paginas });
        const detectados = Array.isArray(res.productos) ? res.productos : [];
        detectados.forEach((p) => {
          p._key = 'ocr-' + (++ocrKeySeq);
          p._archivo = f.nombre;
          p._pagina = p.pagina || 1;
          p._seleccionado = p.accion !== 'omitir';
          p._dudoso = Array.isArray(p.camposDudosos) ? p.camposDudosos.slice() : [];
          p._imagenPreview = '';
          if (!p.accion) p.accion = 'revisar';
          state.ocr.productos.push(p);
        });
        if (res.texto) {
          state.ocr.texto += '\n\n===== ' + f.nombre + ' (' + (res.totalPaginas || 1) + ' pág.) =====\n' + res.texto;
        }
      } catch (e) {
        f.estado = 'error';
        f.error = e.message;
        errores++;
      }
      completados++;
      if (barra) barra.style.width = Math.round((completados / total) * 100) + '%';
      pintarArchivosOcr();
    }

    // Duplicados dentro del mismo lote: se marcan, no se eliminan.
    const vistos = new Map();
    for (const p of state.ocr.productos) {
      const clave = norm(p.nombre) + '|' + (Array.isArray(p.variantes) ? p.variantes.map((v) => norm(v.nombre) + ':' + num(v.precio)).sort().join(',') : '');
      if (!clave.trim() || clave === '|') continue;
      if (vistos.has(clave)) {
        p.revisar = true;
        p.accion = 'revisar';
        if (!p._dudoso.some((d) => /duplicado en el lote/i.test(d))) p._dudoso.push('posible duplicado en el mismo lote');
      } else {
        vistos.set(clave, p);
      }
    }

    state.ocr.procesando = false;
    state.ocr.archivosMeta = archivosMeta;
    state.ocr.paginasTotal = paginasTotal;
    if (txt) txt.textContent = 'Listo: ' + state.ocr.productos.length + ' productos detectados en ' + total + ' archivo(s)' + (errores ? '. ' + errores + ' archivo(s) con error.' : '. Revisa la tabla antes de publicar.');
    setTimeout(() => { if (wrap) wrap.hidden = true; if (txt) txt.hidden = true; }, 2600);
    pintarArchivosOcr();
    pintarResultadoOcr();
    if (!state.ocr.productos.length) {
      toast(errores ? 'No se pudo leer la carta. Revisa los errores.' : 'No se detectaron productos con precio. Prueba con una foto más nítida.', 'err');
    } else {
      toast('OCR terminado. Revisa los ' + state.ocr.productos.length + ' productos detectados.');
    }
  }

  /* ---------- Tabla editable de resultados ---------- */
  function ocrResumen() {
    const ps = state.ocr.productos;
    const total = ps.length;
    const seleccionados = ps.filter((p) => p._seleccionado !== false).length;
    const revisar = ps.filter((p) => p.revisar || p.accion === 'revisar').length;
    const conflictos = ps.filter((p) => p.coincidencia).length;
    const sinPrecio = ps.filter((p) => !(num(p.precio) > 0) && !(Array.isArray(p.variantes) && p.variantes.some((v) => num(v.precio) > 0))).length;
    return { total, seleccionados, revisar, conflictos, sinPrecio };
  }

  function pintarResultadoOcr() {
    const cont = $('#ocrResultado');
    if (!cont) return;
    const ps = state.ocr.productos;
    if (!ps.length) {
      cont.innerHTML = state.ocr.resultado ? panelResultadoOcr() : `
        <div class="panel"><div class="empty"><div class="big">◫</div><h3>Previsualización editable</h3><p>Sube una o varias cartas y pulsa “Procesar cartas”. Aquí aparecerán los productos detectados para revisarlos antes de publicar.</p></div></div>`;
      enlazarResultadoOcr();
      return;
    }

    const res = ocrResumen();
    const grupos = Array.from(new Set(ps.map((p) => p.grupo).filter(Boolean)));
    const sugeridas = Array.from(new Set([...grupos, ...CATEGORIAS_SUGERIDAS]));
    const conflictos = ps.filter((p) => p.coincidencia);

    cont.innerHTML = `
      <div class="panel">
        <div class="panel-head">
          <div><h2>Productos detectados</h2><p>${res.total} filas · ${res.seleccionados} seleccionadas · ${res.revisar} por revisar · ${res.conflictos} posible(s) duplicado(s)</p></div>
          <div class="row">
            <button class="btn btn-sm" id="ocrAgregarFila">+ Fila manual</button>
            <button class="btn btn-sm" id="ocrVerTexto">Ver texto OCR</button>
          </div>
        </div>
        <div class="panel-body" style="padding-bottom:0">
          ${state.ocr.resultado ? `<div class="form-ok mb-16">${esc(state.ocr.resultado)}</div>` : ''}
          ${conflictos.length ? `<div class="conflict-bar">
            <b>${conflictos.length} producto(s) coinciden con el catálogo actual.</b>
            <span class="small">Elige cómo resolverlos; nunca se sobrescribe sin tu decisión.</span>
            <button class="btn btn-sm" data-conflicto="actualizar">Actualizar coincidencias</button>
            <button class="btn btn-sm" data-conflicto="omitir">Solo nuevos</button>
            <button class="btn btn-sm" data-conflicto="mantener">Mantener anteriores</button>
            <button class="btn btn-sm" data-conflicto="revisar">Revisar conflictos</button>
          </div>` : ''}
          <div class="toolbar">
            <label class="check"><input type="checkbox" class="ocr-check" id="ocrSelTodos" ${ps.every((p) => p._seleccionado !== false) ? 'checked' : ''}> Seleccionar todos</label>
            <button class="btn btn-sm" data-sel="todos">Todos</button>
            <button class="btn btn-sm" data-sel="nuevos">Solo nuevos</button>
            <button class="btn btn-sm" data-sel="ninguno">Ninguno</button>
            <span class="small muted" style="margin-left:auto">Los campos dudosos están marcados en amarillo.</span>
          </div>
        </div>
        <div class="table-wrap">
          <table class="table ocr-table">
            <thead><tr>
              <th style="width:34px"></th><th>Nombre</th><th>Categoría</th><th>Descripción</th><th>Precio</th><th>Imagen</th><th>Estado</th><th>Acción</th><th></th>
            </tr></thead>
            <tbody>
              ${ps.map((p, i) => filaOcr(p, i, sugeridas)).join('')}
            </tbody>
          </table>
        </div>
        <div class="panel-foot" style="justify-content:space-between">
          <div class="row">
            <button class="btn" id="ocrCancelar">Cancelar</button>
            <button class="btn" id="ocrGuardarBorrador">Guardar borrador</button>
          </div>
          <div class="row">
            <span class="small muted" id="ocrPieResumen">${res.sinPrecio ? res.sinPrecio + ' fila(s) sin precio' : ''}</span>
            <button class="btn btn-primary" id="ocrPublicar">Publicar seleccionados</button>
          </div>
        </div>
      </div>`;

    enlazarResultadoOcr();
  }

  function filaOcr(p, i, sugeridas) {
    const key = p._key;
    const imagenUrl = p._imagenPreview || (p.imagen ? imgUrlLocal(state.ocr.carpeta, p.imagen) : '');
    const dudoso = p.revisar || p.accion === 'revisar';
    const dudosoTxt = (p._dudoso || p.camposDudosos || []).join(' · ');
    const coincidencia = p.coincidencia;
    const sinPrecio = !(num(p.precio) > 0) && !(Array.isArray(p.variantes) && p.variantes.some((v) => num(v.precio) > 0));
    const catId = 'cats-' + key;
    const accion = p.accion || 'revisar';
    const opciones = [
      ['nuevo', 'Nuevo'],
      ...(coincidencia ? [['actualizar', 'Actualizar existente'], ['mantener', 'Mantener anterior']] : []),
      ['revisar', 'Revisar'],
      ['omitir', 'Omitir'],
      ...(coincidencia || dudoso ? [['forzar', 'Publicar igual']] : [])
    ];
    return `<tr data-fila="${key}" class="${p._seleccionado === false ? 'row-inactivo' : ''}">
      <td><input type="checkbox" class="ocr-check" data-sel-fila="${key}" ${p._seleccionado !== false ? 'checked' : ''}></td>
      <td>
        <input type="text" data-campo="nombre" data-key="${key}" value="${esc(p.nombre || '')}" placeholder="Nombre del producto">
        ${p._archivo ? `<div class="tiny muted mt-8">${esc(p._archivo)} · pág. ${p._pagina || 1}</div>` : ''}
        ${Array.isArray(p.variantes) && p.variantes.length ? `<button class="link-btn tiny" type="button" data-editar-detalle="${key}">${p.variantes.length} variante(s)</button>` : ''}
        ${Array.isArray(p.extras) && p.extras.length ? `<button class="link-btn tiny" type="button" data-editar-detalle="${key}">${p.extras.length} extra(s)</button>` : ''}
      </td>
      <td>
        <input type="text" data-campo="grupo" data-key="${key}" list="${catId}" value="${esc(p.grupo || '')}" placeholder="Categoría">
        <datalist id="${catId}">${sugeridas.map((g) => `<option value="${esc(g)}">`).join('')}</datalist>
        <input type="text" data-campo="subcategoria" data-key="${key}" value="${esc(p.subcategoria || '')}" placeholder="Subcategoría" class="mt-8" style="font-size:11px">
      </td>
      <td class="desc"><input type="text" data-campo="descripcion" data-key="${key}" value="${esc(p.descripcion || '')}" placeholder="Descripción (opcional)"></td>
      <td>
        <input type="number" min="0" step="0.01" data-campo="precio" data-key="${key}" value="${esc(p.precio || '')}" placeholder="0.00">
        ${sinPrecio ? '<div class="tiny" style="color:#c62828;margin-top:3px">Falta precio</div>' : ''}
      </td>
      <td class="img-cell">
        <div data-img-preview="${key}">${imagenUrl ? `<img class="mini-img" src="${esc(imagenUrl)}" alt="">` : '<div class="thumb-empty">🖼</div>'}</div>
        <label class="link-btn tiny" style="cursor:pointer">Subir<input class="file-input" type="file" accept="image/jpeg,image/png,image/webp" data-img-ocr="${key}"></label>
      </td>
      <td>
        <div class="stack" style="gap:4px;align-items:flex-start">
          ${p.revisar || p.accion === 'revisar' ? `<span class="badge warn dot" title="${esc(dudosoTxt)}">Revisar</span>` : '<span class="badge ok dot">Listo</span>'}
          ${coincidencia ? `<span class="badge info" title="${esc('Coincide con ' + coincidencia.nombre + (coincidencia.mismoPrecio ? '' : ' (precio distinto)'))}">Duplicado</span>` : ''}
          ${p.confianza !== undefined && Number(p.confianza) < 0.75 ? `<span class="badge warn">Conf. ${Math.round(Number(p.confianza) * 100)}%</span>` : ''}
        </div>
        ${dudosoTxt ? `<div class="tiny muted" style="max-width:140px">${esc(dudosoTxt).slice(0, 70)}</div>` : ''}
        ${dudoso ? `<button class="link-btn tiny" type="button" data-revisado="${key}">Marcar revisado</button>` : ''}
      </td>
      <td class="accion-cell">
        <select data-accion="${key}">
          ${opciones.map(([v, t]) => `<option value="${v}" ${accion === v ? 'selected' : ''}>${t}</option>`).join('')}
        </select>
      </td>
      <td><button class="icon-btn" type="button" data-eliminar-fila="${key}" title="Quitar fila">✕</button></td>
    </tr>`;
  }

  function enlazarResultadoOcr() {
    const cont = $('#ocrResultado');
    if (!cont) return;
    const porKey = (k) => state.ocr.productos.find((p) => p._key === k);

    cont.oninput = (e) => {
      const el = e.target;
      if (el.matches('[data-campo]')) {
        const p = porKey(el.dataset.key);
        if (!p) return;
        const campo = el.dataset.campo;
        if (campo === 'precio') p.precio = el.value === '' ? null : num(el.value);
        else p[campo] = el.value;
      }
    };
    cont.onchange = (e) => {
      const el = e.target;
      if (el.matches('[data-accion]')) {
        const p = porKey(el.dataset.accion);
        if (!p) return;
        p.accion = el.value;
        if (el.value === 'actualizar' || el.value === 'mantener') p._seleccionado = true;
        if (el.value === 'omitir') p._seleccionado = false;
      }
      if (el.matches('[data-sel-fila]')) {
        const p = porKey(el.dataset.selFila);
        if (p) p._seleccionado = el.checked;
        el.closest('tr').classList.toggle('row-inactivo', !el.checked);
        actualizarPieOcr();
      }
      if (el.id === 'ocrSelTodos') {
        state.ocr.productos.forEach((p) => { p._seleccionado = el.checked; });
        $$('[data-sel-fila]', cont).forEach((c) => { c.checked = el.checked; c.closest('tr').classList.toggle('row-inactivo', !el.checked); });
        actualizarPieOcr();
      }
      if (el.matches('[data-img-ocr]')) {
        const p = porKey(el.dataset.imgOcr);
        const file = el.files && el.files[0];
        if (!p || !file) return;
        subirImagenArchivo(file, { tipoDestino: 'local', carpeta: state.ocr.carpeta, prefijo: 'ocr' }).then((res) => {
          p.imagen = res.ruta;
          p.imagenPendiente = false;
          p._imagenPreview = imgUrlLocal(state.ocr.carpeta, res.ruta);
          const celda = cont.querySelector('[data-img-preview="' + p._key + '"]');
          if (celda) celda.innerHTML = `<img class="mini-img" src="${esc(p._imagenPreview)}" alt="">`;
          toast('Imagen lista para publicar.');
        }).catch(avisarError);
      }
    };
    cont.onclick = (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.id === 'ocrAgregarFila') { agregarFilaOcr(); return; }
      if (b.id === 'ocrVerTexto') { modalTextoOcr(); return; }
      if (b.id === 'ocrNuevaImportacion') {
        state.ocr.resultado = null;
        state.ocr.productos = [];
        state.ocr.texto = '';
        state.ocr.importacionId = null;
        pintarResultadoOcr();
        return;
      }
      if (b.dataset.irLocal) { ir('local/' + b.dataset.irLocal); return; }
      if (b.id === 'ocrCancelar') { limpiarOcr(); return; }
      if (b.id === 'ocrGuardarBorrador') { guardarOcr('borrador'); return; }
      if (b.id === 'ocrPublicar') { guardarOcr('publicar'); return; }
      if (b.dataset.conflicto) { resolverConflictos(b.dataset.conflicto); return; }
      if (b.dataset.sel) {
        state.ocr.productos.forEach((p) => {
          if (b.dataset.sel === 'todos') p._seleccionado = true;
          else if (b.dataset.sel === 'ninguno') p._seleccionado = false;
          else if (b.dataset.sel === 'nuevos') p._seleccionado = !p.coincidencia;
        });
        pintarResultadoOcr();
        return;
      }
      if (b.dataset.eliminarFila) {
        state.ocr.productos = state.ocr.productos.filter((p) => p._key !== b.dataset.eliminarFila);
        pintarResultadoOcr();
        return;
      }
      if (b.dataset.revisado) {
        const p = porKey(b.dataset.revisado);
        if (p) { p.revisar = false; if (p.accion === 'revisar') p.accion = p.coincidencia ? 'actualizar' : 'nuevo'; pintarResultadoOcr(); }
        return;
      }
      if (b.dataset.editarDetalle) {
        modalDetalleOcr(porKey(b.dataset.editarDetalle));
      }
    };
  }

  function actualizarPieOcr() {
    const res = ocrResumen();
    const pie = $('#ocrPieResumen');
    if (pie) pie.textContent = res.sinPrecio ? res.sinPrecio + ' fila(s) sin precio' : '';
    const head = $('#ocrResultado .panel-head p');
    if (head) head.textContent = `${res.total} filas · ${res.seleccionados} seleccionadas · ${res.revisar} por revisar · ${res.conflictos} posible(s) duplicado(s)`;
  }

  function agregarFilaOcr() {
    state.ocr.productos.push({
      _key: 'ocr-' + (++ocrKeySeq), _archivo: 'Manual', _pagina: 1, _seleccionado: true,
      _dudoso: [], nombre: '', descripcion: '', precio: null, grupo: '', subcategoria: '',
      variantes: [], extras: [], imagen: null, revisar: false, accion: 'nuevo', confianza: 1,
      camposDudosos: [], origen: 'ocr'
    });
    pintarResultadoOcr();
    const filas = $$('#ocrResultado tbody tr');
    if (filas.length) $('[data-campo="nombre"]', filas[filas.length - 1]).focus();
  }

  function resolverConflictos(tipo) {
    const conflictos = state.ocr.productos.filter((p) => p.coincidencia);
    if (tipo === 'actualizar') {
      conflictos.forEach((p) => { p.accion = 'actualizar'; p._seleccionado = true; if (p.coincidencia.mismoPrecio) p.revisar = false; });
      toast('Se actualizarán los productos coincidentes.');
    } else if (tipo === 'omitir') {
      conflictos.forEach((p) => { p.accion = 'omitir'; p._seleccionado = false; });
      toast('Solo se agregarán los productos nuevos.');
    } else if (tipo === 'mantener') {
      conflictos.forEach((p) => { p.accion = 'mantener'; p._seleccionado = false; });
      toast('Se mantendrán los productos anteriores.');
    } else if (tipo === 'revisar') {
      conflictos.forEach((p) => { p.accion = 'revisar'; p._seleccionado = true; });
      toast('Revisa las filas marcadas como duplicado.');
    }
    pintarResultadoOcr();
    const primera = $('#ocrResultado tr [data-accion="revisar"]');
    if (tipo === 'revisar' && primera) primera.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function modalTextoOcr() {
    abrirModal({
      titulo: 'Texto reconocido por OCR',
      ancho: 'wide',
      cuerpo: `<p class="small muted mb-8">Copia de referencia. No se publica nada desde este texto.</p><pre class="ocr-text">${esc(state.ocr.texto || 'Sin texto guardado.')}</pre>`,
      pie: '<button class="btn" data-cerrar>Cerrar</button>'
    });
    $('[data-cerrar]').addEventListener('click', cerrarModal);
  }

  function leerFilasVariantesOcr() {
    return $$('#ocrDetalleVariantes .variant-row').map((row, i) => ({
      id: 'v' + (i + 1),
      nombre: $('[data-var-nombre]', row).value.trim(),
      precio: num($('[data-var-precio]', row).value)
    })).filter((v) => v.nombre || v.precio > 0);
  }
  function leerFilasExtrasOcr() {
    return $$('#ocrDetalleExtras .extra-row').map((row) => ({
      nombre: $('[data-extra-nombre]', row).value.trim(),
      precio: num($('[data-extra-precio]', row).value)
    })).filter((e) => e.nombre);
  }

  function modalDetalleOcr(p) {
    if (!p) return;
    abrirModal({
      titulo: 'Variantes y extras · ' + (p.nombre || 'producto'),
      ancho: 'wide',
      cuerpo: `
        <p class="small muted mb-16">Corrige las variantes y extras detectados. Los precios se conservan; no se inventan datos.</p>
        <div class="form-section" style="border-top:0;padding-top:0;margin-top:0">
          <h3>Variantes</h3>
          <div id="ocrDetalleVariantes">${variantesHtml(p.variantes)}</div>
          <button class="btn btn-sm mt-8" type="button" id="ocrAddVariante">+ Variante</button>
        </div>
        <div class="form-section">
          <h3>Extras</h3>
          <div id="ocrDetalleExtras">${extrasHtml(p.extras)}</div>
          <button class="btn btn-sm mt-8" type="button" id="ocrAddExtra">+ Extra</button>
        </div>
        <div class="form-section">
          <label class="check"><input type="checkbox" id="ocrDetalleRevisar" ${p.revisar ? 'checked' : ''}> Mantener marcado para revisión</label>
        </div>`,
      pie: `<button class="btn" data-cerrar>Cancelar</button><button class="btn btn-primary" id="ocrGuardarDetalle">Aplicar</button>`
    });
    $('[data-cerrar]').addEventListener('click', cerrarModal);
    function refrescar() {
      $('#ocrDetalleVariantes').innerHTML = variantesHtml(actualesV);
      $('#ocrDetalleExtras').innerHTML = extrasHtml(actualesE);
      enlazar();
    }
    let actualesV = Array.isArray(p.variantes) ? p.variantes.slice() : [];
    let actualesE = Array.isArray(p.extras) ? p.extras.slice() : [];
    function enlazar() {
      $$('#ocrDetalleVariantes [data-quitar-variante]').forEach((b) => b.onclick = () => {
        actualesV = leerFilasVariantesOcr(); actualesV.splice(Number(b.closest('.variant-row').dataset.variante), 1); refrescar();
      });
      $$('#ocrDetalleExtras [data-quitar-extra]').forEach((b) => b.onclick = () => {
        actualesE = leerFilasExtrasOcr(); actualesE.splice(Number(b.closest('.extra-row').dataset.extra), 1); refrescar();
      });
    }
    enlazar();
    $('#ocrAddVariante').addEventListener('click', () => { actualesV = leerFilasVariantesOcr(); actualesV.push({ id: 'v' + (actualesV.length + 1), nombre: '', precio: 0 }); refrescar(); });
    $('#ocrAddExtra').addEventListener('click', () => { actualesE = leerFilasExtrasOcr(); actualesE.push({ nombre: '', precio: 0 }); refrescar(); });
    $('#ocrGuardarDetalle').addEventListener('click', () => {
      p.variantes = leerFilasVariantesOcr();
      p.extras = leerFilasExtrasOcr();
      p.revisar = $('#ocrDetalleRevisar').checked;
      if (!p.variantes.some((v) => !v.nombre || !(v.precio > 0))) { /* ok */ }
      cerrarModal();
      pintarResultadoOcr();
    });
  }

  /* ---------- Guardar / publicar ---------- */
  async function guardarOcr(modo, forzarTodo = false) {
    if (state.ocr.procesando) return;
    const seleccionados = state.ocr.productos.filter((p) => p._seleccionado !== false);
    if (!seleccionados.length) return toast('Selecciona al menos un producto.', 'err');
    if (!state.ocr.carpeta) return toast('Elige el local destino.', 'err');

    if (modo === 'publicar') {
      const sinNombre = seleccionados.filter((p) => !String(p.nombre || '').trim());
      const sinPrecio = seleccionados.filter((p) => {
        const tiene = num(p.precio) > 0 || (Array.isArray(p.variantes) && p.variantes.some((v) => num(v.precio) > 0));
        return !tiene;
      });
      if (sinNombre.length || sinPrecio.length) {
        abrirModal({
          titulo: 'No se puede publicar todavía',
          ancho: 'narrow',
          cuerpo: `<p>Corrige estas filas antes de publicar:</p>
            <ul class="mt-8 small" style="padding-left:18px">
              ${sinNombre.slice(0, 8).map((p) => `<li>Fila sin nombre${p._archivo ? ' (' + esc(p._archivo) + ')' : ''}.</li>`).join('')}
              ${sinPrecio.slice(0, 8).map((p) => `<li><b>${esc(p.nombre || 'Sin nombre')}</b>: falta precio o variante con precio.</li>`).join('')}
            </ul>
            <p class="small muted mt-8">Un producto publicado no puede quedar sin nombre ni sin precio.</p>`,
          pie: '<button class="btn" data-cerrar>Entendido</button>'
        });
        $('[data-cerrar]').addEventListener('click', cerrarModal);
        return;
      }
      const dudosos = seleccionados.filter((p) => p.revisar || p.accion === 'revisar');
      if (dudosos.length && !forzarTodo) {
        abrirModal({
          titulo: 'Filas marcadas para revisión',
          ancho: 'narrow',
          cuerpo: `<p>${dudosos.length} producto(s) tienen baja confianza, datos dudosos o un posible duplicado con otro precio.</p>
            <ul class="mt-8 small" style="padding-left:18px;max-height:220px;overflow:auto">
              ${dudosos.slice(0, 12).map((p) => `<li><b>${esc(p.nombre || 'Sin nombre')}</b>${p._dudoso && p._dudoso.length ? ' · ' + esc(p._dudoso.join(', ')) : ''}</li>`).join('')}
            </ul>
            <p class="small muted mt-8">Puedes volver a la tabla, corregirlas y marcar “revisado”, o publicarlas de todos modos bajo tu responsabilidad.</p>`,
          pie: `<button class="btn" data-cerrar>Volver a revisar</button><button class="btn btn-primary" id="ocrForzarPublicar">Publicar de todos modos</button>`
        });
        $('[data-cerrar]').addEventListener('click', cerrarModal);
        $('#ocrForzarPublicar').addEventListener('click', () => { cerrarModal(); guardarOcr('publicar', true); });
        return;
      }
    }

    const productos = seleccionados.map((p) => ({
      id: p.id || undefined,
      nombre: String(p.nombre || '').trim(),
      descripcion: String(p.descripcion || '').trim(),
      precio: p.precio === '' ? null : p.precio,
      grupo: p.grupo || '',
      subcategoria: p.subcategoria || '',
      variantes: Array.isArray(p.variantes) ? p.variantes : [],
      extras: Array.isArray(p.extras) ? p.extras : [],
      imagen: p.imagen || null,
      disponible: p.disponible !== false,
      revisar: forzarTodo ? false : !!p.revisar,
      accion: forzarTodo && (p.revisar || p.accion === 'revisar') ? 'forzar' : (p.accion || 'revisar'),
      coincidencia: p.coincidencia || null,
      confianza: p.confianza,
      camposDudosos: p._dudoso || p.camposDudosos || [],
      origen: 'ocr'
    }));

    const boton = modo === 'publicar' ? $('#ocrPublicar') : $('#ocrGuardarBorrador');
    if (boton) { boton.disabled = true; boton.dataset.texto = boton.textContent; boton.textContent = modo === 'publicar' ? 'Publicando…' : 'Guardando…'; }
    try {
      const res = await api('/api/admin/ocr/guardar', {
        method: 'POST',
        body: {
          localCarpeta: state.ocr.carpeta,
          importacionId: state.ocr.importacionId,
          archivos: state.ocr.archivosMeta || state.ocr.archivos.map((f) => ({ nombre: f.nombre, paginas: f.paginas || 1 })),
          texto: state.ocr.texto,
          productos,
          modo
        }
      });
      if (res.ok === false) {
        const lista = Array.isArray(res.errores) ? res.errores.join('\n') : 'No se pudo guardar la importación.';
        abrirModal({ titulo: 'Revisa estos datos', ancho: 'narrow', cuerpo: `<p class="form-error" style="white-space:pre-line">${esc(lista)}</p>`, pie: '<button class="btn" data-cerrar>Volver</button>' });
        $('[data-cerrar]').addEventListener('click', cerrarModal);
        return;
      }
      state.ocr.importacionId = res.importacionId || state.ocr.importacionId;
      state.ocr.resultado = modo === 'publicar'
        ? `Publicado: ${res.publicados} productos · ${res.actualizados || 0} actualizados · ${res.omitidos || 0} omitidos.`
        : `Borrador guardado: ${res.borradores} productos · ${res.omitidos || 0} omitidos. No aparecen en la web hasta publicarlos.`;
      await cargarBase();
      cargarImportacionesOcr();
      toast(modo === 'publicar' ? 'Productos publicados en el catálogo del local.' : 'Borrador guardado. Puedes retomarlo luego.');
      pintarResultadoOcr();
      if (modo === 'publicar') toast(state.ocr.resultado);
    } catch (e) {
      avisarError(e);
    } finally {
      if (boton) { boton.disabled = false; boton.textContent = boton.dataset.texto || boton.textContent; }
    }
  }

  function panelResultadoOcr() {
    return `<div class="panel"><div class="panel-head"><div><h2>Importación guardada</h2><p>${esc(state.ocr.resultado || '')}</p></div></div>
      <div class="panel-body">
        <div class="row">
          <button class="btn btn-primary" data-ir-local="${esc(state.ocr.carpeta)}">Abrir el local</button>
          <button class="btn" id="ocrNuevaImportacion">Importar otra carta</button>
        </div>
      </div></div>`;
  }

  async function cargarImportacionesOcr() {
    const cont = $('#ocrImportaciones');
    if (!cont) return;
    try {
      const r = await api('/api/admin/importaciones');
      state.importaciones = (r.importaciones || []).filter((i) => !state.ocr.carpeta || i.localCarpeta === state.ocr.carpeta);
    } catch (e) {
      cont.innerHTML = '<p class="small muted">No se pudieron cargar las importaciones.</p>';
      return;
    }
    if (!state.importaciones.length) {
      cont.innerHTML = '<p class="small muted">No hay importaciones guardadas para este local.</p>';
      return;
    }
    cont.innerHTML = `<div class="stack" style="gap:8px">
      ${state.importaciones.slice(0, 12).map((i) => `
        <div class="quick-item" style="cursor:default">
          <div>
            <b>${esc(i.id)}</b>
            <span>${esc(i.localNombre)} · ${esc(fechaCorta(i.creadoEn))} · ${i.totalProductos} productos · ${esc(i.estado)}</span>
          </div>
          <div class="row" style="gap:6px">
            <button class="btn btn-sm" data-cargar-imp="${esc(i.id)}">Revisar</button>
          </div>
        </div>`).join('')}
    </div>`;
    $$('[data-cargar-imp]', cont).forEach((b) => b.addEventListener('click', () => cargarImportacionGuardada(b.dataset.cargarImp)));
  }

  async function cargarImportacionGuardada(id) {
    try {
      const imp = await api('/api/admin/importaciones/' + encodeURIComponent(id));
      state.ocr.carpeta = imp.localCarpeta;
      state.ocr.importacionId = imp.id;
      state.ocr.texto = imp.texto || '';
      state.ocr.archivos = [];
      state.ocr.archivosMeta = (imp.archivos || []).map((a) => ({ nombre: a.nombre, paginas: a.paginas || 1 }));
      state.ocr.productos = (imp.productos || []).map((p) => ({
        ...p,
        _key: 'ocr-' + (++ocrKeySeq),
        _archivo: (imp.archivos && imp.archivos[0] && imp.archivos[0].nombre) || 'Importación',
        _pagina: p.pagina || 1,
        _seleccionado: p.accion !== 'omitir',
        _dudoso: Array.isArray(p.camposDudosos) ? p.camposDudosos.slice() : [],
        _imagenPreview: '',
        accion: p.accion || (p.publicado ? 'actualizar' : 'revisar')
      }));
      state.ocr.resultado = null;
      const sel = $('#ocrLocal');
      if (sel) sel.value = imp.localCarpeta;
      history.replaceState(null, '', '#/ocr/' + imp.localCarpeta);
      pintarArchivosOcr();
      pintarResultadoOcr();
      toast('Importación cargada para revisión.');
    } catch (e) { avisarError(e); }
  }

  /* ============================================================
     VENTAS · ESTADÍSTICAS POR LOCAL Y PRODUCTO
     ============================================================ */
  function tablaTopProductos(lista) {
    if (!lista || !lista.length) {
      return '<div class="empty"><div class="big">📊</div><h3>Sin ventas en el periodo</h3><p>Prueba con otro rango de fechas.</p></div>';
    }
    const admin = state.sesion.rol === 'admin';
    return `<div class="table-wrap"><table class="table">
      <thead><tr><th>Producto</th>${admin ? '<th>Local</th>' : ''}<th>Vendidos</th><th>Ingresos</th></tr></thead>
      <tbody>${lista.map((p) => `<tr>
        <td><div class="nombre">${esc(p.nombre)}</div><div class="sub">${p.pedidos} pedido(s)</div></td>
        ${admin ? `<td class="small">${esc(p.localNombre)}</td>` : ''}
        <td><b>${p.unidades}</b></td>
        <td class="precio">${money(p.ventas)}</td>
      </tr>`).join('')}</tbody>
    </table></div>`;
  }

  async function vistaVentas() {
    mostrarVista('ventas');
    if (!state.ventas) state.ventas = { desde: '', hasta: '', local: '', datos: null };
    if (!state.ventas.hasta) {
      const hoy = new Date();
      state.ventas.hasta = fechaISO(hoy);
      state.ventas.desde = fechaISO(new Date(hoy.getTime() - 29 * 86400000));
    }
    const esAdmin = state.sesion.rol === 'admin';
    const miLocal = state.locales.find((l) => l.carpeta === state.sesion.localCarpeta);
    const cont = $('#view-ventas');
    cont.innerHTML = `
      <div class="page-head">
        <div>
          <h2>Ventas</h2>
          <p>${esAdmin ? 'Todos los locales o filtra uno solo. Los pedidos cancelados no se cuentan.' : 'Solo tu local: ' + esc(miLocal ? miLocal.nombre : state.sesion.localCarpeta)}</p>
        </div>
      </div>
      <div class="panel">
        <div class="panel-body">
          <div class="toolbar" style="margin:0;flex-wrap:wrap">
            <label class="field" style="max-width:170px"><span>Desde</span><input class="input" type="date" id="venDesde" value="${state.ventas.desde}"></label>
            <label class="field" style="max-width:170px"><span>Hasta</span><input class="input" type="date" id="venHasta" value="${state.ventas.hasta}"></label>
            ${esAdmin ? `<label class="field" style="max-width:260px"><span>Local</span><select class="input" id="venLocal">
              <option value="">Todos los locales</option>
              ${state.locales.map((l) => `<option value="${esc(l.carpeta)}" ${l.carpeta === state.ventas.local ? 'selected' : ''}>${esc(l.nombre)}</option>`).join('')}
            </select></label>` : ''}
            <button class="btn btn-primary" id="venAplicar" style="align-self:flex-end">Aplicar</button>
            <div class="row" style="align-self:flex-end;gap:6px">
              <button class="btn btn-sm" type="button" data-rango="7">7 días</button>
              <button class="btn btn-sm" type="button" data-rango="30">30 días</button>
              <button class="btn btn-sm" type="button" data-rango="90">90 días</button>
            </div>
          </div>
        </div>
      </div>
      <div id="ventasBody"><div class="panel"><div class="panel-body muted">Cargando ventas…</div></div></div>`;

    $('#venAplicar').addEventListener('click', () => {
      const desde = $('#venDesde').value;
      const hasta = $('#venHasta').value;
      if (!desde || !hasta) { toast('Elige el rango de fechas.', 'err'); return; }
      state.ventas.desde = desde;
      state.ventas.hasta = hasta;
      const sel = $('#venLocal');
      if (sel) state.ventas.local = sel.value;
      cargarVentas();
    });
    $$('[data-rango]', cont).forEach((b) => b.addEventListener('click', () => {
      const dias = Number(b.dataset.rango) || 30;
      const hoy = new Date();
      state.ventas.hasta = fechaISO(hoy);
      state.ventas.desde = fechaISO(new Date(hoy.getTime() - (dias - 1) * 86400000));
      $('#venDesde').value = state.ventas.desde;
      $('#venHasta').value = state.ventas.hasta;
      cargarVentas();
    }));
    const selLocal = $('#venLocal');
    if (selLocal) selLocal.addEventListener('change', () => {
      state.ventas.local = selLocal.value;
      cargarVentas();
    });

    await cargarVentas();
  }

  async function cargarVentas() {
    const body = $('#ventasBody');
    if (!body) return;
    body.innerHTML = '<div class="panel"><div class="panel-body muted">Calculando ventas…</div></div>';
    const q = '?desde=' + encodeURIComponent(state.ventas.desde) + '&hasta=' + encodeURIComponent(state.ventas.hasta) +
      (state.ventas.local ? '&local=' + encodeURIComponent(state.ventas.local) : '');
    let r;
    try {
      r = await api('/api/admin/estadisticas' + q);
      state.ventas.datos = r;
    } catch (e) {
      body.innerHTML = '<div class="panel"><div class="panel-body"><p class="form-error">' + esc(e.message) + '</p></div></div>';
      return;
    }
    const res = r.resumen || {};
    const dias = r.porDia || [];
    const maxDia = Math.max.apply(null, dias.map((d) => num(d.ventas)).concat([1]));
    const esAdmin = state.sesion.rol === 'admin';
    body.innerHTML = `
      <div class="stats">
        <div class="stat brand">
          <div class="stat-label">Ventas</div>
          <div class="stat-value">${money(res.ventas)}</div>
          <div class="stat-meta">${esc(r.desde)} → ${esc(r.hasta)}</div>
        </div>
        <div class="stat">
          <div class="stat-label">Pedidos</div>
          <div class="stat-value">${res.pedidos || 0}</div>
          <div class="stat-meta">${res.unidades || 0} unidades vendidas</div>
        </div>
        <div class="stat">
          <div class="stat-label">Ticket promedio</div>
          <div class="stat-value">${money(res.ticketPromedio)}</div>
          <div class="stat-meta">por pedido</div>
        </div>
        <div class="stat">
          <div class="stat-label">Productos vendidos</div>
          <div class="stat-value">${res.productosVendidos || 0}</div>
          <div class="stat-meta">distintos en el periodo</div>
        </div>
      </div>

      <div class="panel">
        <div class="panel-head"><div><h2>Ventas por día</h2><p>Altura proporcional al monto vendido.</p></div></div>
        <div class="panel-body">
          ${dias.length ? `<div class="chart">${dias.map((d) => `
            <div class="chart-col" title="${esc(d.fecha)}: ${money(d.ventas)} · ${d.pedidos} pedido(s)">
              <div class="chart-bar" style="height:${Math.max(2, Math.round(num(d.ventas) / maxDia * 100))}%"></div>
              <span>${esc(d.fecha.slice(5))}</span>
            </div>`).join('')}</div>` : '<p class="muted">Sin datos.</p>'}
        </div>
      </div>

      <div class="dash-grid">
        <div class="panel">
          <div class="panel-head"><div><h2>Más vendidos</h2><p>Ordenado por unidades.</p></div></div>
          <div class="panel-body">${tablaTopProductos(r.topUnidades)}</div>
        </div>
        <div class="panel">
          <div class="panel-head"><div><h2>Mayor ingreso</h2><p>Ordenado por monto vendido.</p></div></div>
          <div class="panel-body">${tablaTopProductos(r.topVentas)}</div>
        </div>
      </div>

      ${esAdmin && (r.locales || []).length ? `<div class="panel">
        <div class="panel-head"><div><h2>Ventas por local</h2><p>Comparativo del mismo periodo.</p></div></div>
        <div class="panel-body"><div class="table-wrap"><table class="table">
          <thead><tr><th>Local</th><th>Pedidos</th><th>Unidades</th><th>Ventas</th></tr></thead>
          <tbody>${r.locales.map((l) => `<tr>
            <td><b>${esc(l.nombre)}</b><div class="sub">${esc(l.carpeta)}</div></td>
            <td>${l.pedidos}</td>
            <td>${l.unidades}</td>
            <td class="precio">${money(l.ventas)}</td>
          </tr>`).join('')}</tbody>
        </table></div></div>
      </div>` : ''}`;
  }

  /* ============================================================
     PÁGINA · CONFIGURACIÓN EDITABLE DE LA WEB
     ============================================================ */
  async function vistaPagina() {
    mostrarVista('pagina');
    const cont = $('#view-pagina');
    cont.innerHTML = '<div class="panel"><div class="panel-body muted">Cargando configuración…</div></div>';
    let cfg;
    let cats;
    try {
      const [cfgRes, catRes] = await Promise.all([
        api('/api/admin/config'),
        api('/api/admin/categorias-locales').catch(() => ({ categorias: [] }))
      ]);
      cfg = cfgRes.config || {};
      cats = catRes || { categorias: [] };
      state.config = cfg;
      state.categorias = cats;
    } catch (e) {
      cont.innerHTML = '<div class="panel"><div class="panel-body"><p class="form-error">' + esc(e.message) + '</p></div></div>';
      return;
    }
    pintarPagina();
  }

  function diasSemanaHtml(dias) {
    const activos = Array.isArray(dias) ? dias.map(Number) : [0, 1, 2, 3, 4, 5, 6];
    const nombres = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
    return nombres.map((n, i) => `<label class="dia-check"><input type="checkbox" data-zona-dia="${i}" ${activos.includes(i) ? 'checked' : ''}> ${n}</label>`).join('');
  }

  function filaZonaHtml(z, i) {
    const zona = z || { id: '', nombre: '', horarioTexto: '', dias: [0, 1, 2, 3, 4, 5, 6], apertura: '11:00', cierre: '23:00', nota: '' };
    return `<div class="zona-card" data-zona-row>
      <div class="zona-head">
        <b>Zona ${i + 1}</b>
        <button class="link-btn" type="button" style="color:#c62828" data-quitar-zona>Quitar</button>
      </div>
      <div class="form-grid">
        <label class="field"><span>Nombre *</span><input data-zona-nombre value="${esc(zona.nombre || '')}" maxlength="60"></label>
        <label class="field"><span>Identificador</span><input data-zona-id value="${esc(zona.id || '')}" maxlength="48" placeholder="Se genera del nombre"></label>
        <label class="field"><span>Horario visible</span><input data-zona-horario value="${esc(zona.horarioTexto || '')}" maxlength="90" placeholder="Ej: 12:00 a. m. - 1:00 a. m."></label>
        <label class="field"><span>Apertura</span><input data-zona-apertura type="time" value="${esc(zona.apertura || '11:00')}"></label>
        <label class="field"><span>Cierre</span><input data-zona-cierre type="time" value="${esc(zona.cierre || '23:00')}"></label>
        <label class="field full"><span>Nota</span><input data-zona-nota value="${esc(zona.nota || '')}" maxlength="200"></label>
      </div>
      <div class="dias-row">${diasSemanaHtml(zona.dias)}</div>
    </div>`;
  }

  function pintarPagina() {
    const cont = $('#view-pagina');
    const cfg = state.config || {};
    const zonas = Array.isArray(cfg.zonas) && cfg.zonas.length ? cfg.zonas : [{ id: 'nuevo-chimbote', nombre: 'Nuevo Chimbote', dias: [0, 1, 2, 3, 4, 5, 6], apertura: '00:00', cierre: '01:00' }];
    const redes = cfg.redes || {};
    const tiktok = redes.tiktok || {};
    const instagram = redes.instagram || {};
    const delivery = cfg.delivery || {};
    const categorias = listaCategorias();
    const secciones = cfg.secciones || {};

    cont.innerHTML = `
      <div class="page-head">
        <div><h2>Página pública</h2><p>Lo que guardes aquí se publica al instante en la web. Los locales y productos se editan en sus propias secciones.</p></div>
        <div class="page-head-actions"><a class="btn" href="../index.html" target="_blank" rel="noopener">Ver web pública ↗</a></div>
      </div>

      <div class="panel">
        <div class="panel-head"><div><h2>Marca y contacto</h2><p>Nombre, ciudad, WhatsApp y correo que ve el cliente.</p></div></div>
        <div class="panel-body">
          <div class="form-grid">
            <label class="field"><span>Marca *</span><input id="pgMarca" value="${esc(cfg.marca || '')}" maxlength="60"></label>
            <label class="field"><span>Ciudad *</span><input id="pgCiudad" value="${esc(cfg.ciudad || '')}" maxlength="60"></label>
            <label class="field"><span>Moneda *</span><input id="pgMoneda" value="${esc(cfg.moneda || 'S/')}" maxlength="5"></label>
            <label class="field"><span>WhatsApp (con código de país, solo números) *</span><input id="pgWaNumero" value="${esc((cfg.whatsapp && cfg.whatsapp.numero) || '')}" maxlength="15"></label>
            <label class="field"><span>WhatsApp visible *</span><input id="pgWaVisible" value="${esc((cfg.whatsapp && cfg.whatsapp.visible) || '')}" maxlength="24"></label>
            <label class="field"><span>Correo</span><input id="pgEmail" type="email" value="${esc(cfg.email || '')}" maxlength="120"></label>
            <label class="field"><span>Zona principal</span><select id="pgZonaPrincipal">
              ${zonas.map((z) => `<option value="${esc(z.id)}" ${z.id === cfg.zonaPrincipal ? 'selected' : ''}>${esc(z.nombre)}</option>`).join('')}
            </select></label>
            <label class="check" style="align-self:flex-end"><input id="pgAvisoEjemplos" type="checkbox" ${cfg.avisoEjemplos ? 'checked' : ''}> Mostrar aviso de locales de ejemplo</label>
            <label class="check" style="align-self:flex-end"><input id="pgTaximoto" type="checkbox" ${cfg.servicios && cfg.servicios.taximoto ? 'checked' : ''}> Mostrar taximoto en la web <span class="hint">Aún no es un servicio oficial: actívalo solo cuando lo confirmes.</span></label>
          </div>
        </div>
      </div>

      <div class="panel">
        <div class="panel-head"><div><h2>Redes sociales</h2><p>Se muestran en el pie de la web.</p></div></div>
        <div class="panel-body">
          <div class="form-grid">
            <label class="field"><span>TikTok · usuario</span><input id="pgTikTokUsuario" value="${esc(tiktok.usuario || '')}" maxlength="60"></label>
            <label class="field"><span>TikTok · URL</span><input id="pgTikTokUrl" value="${esc(tiktok.url || '')}" maxlength="200" placeholder="https://www.tiktok.com/@..."></label>
            <label class="field"><span>Instagram · usuario</span><input id="pgInstagramUsuario" value="${esc(instagram.usuario || '')}" maxlength="60"></label>
            <label class="field"><span>Instagram · URL</span><input id="pgInstagramUrl" value="${esc(instagram.url || '')}" maxlength="200" placeholder="https://www.instagram.com/..."></label>
          </div>
        </div>
      </div>

      <div class="panel">
        <div class="panel-head">
          <div><h2>Zonas y horarios</h2><p>Definen el estado abierto/cerrado y el horario que ve el cliente.</p></div>
          <button class="btn btn-sm" type="button" id="pgAgregarZona">+ Agregar zona</button>
        </div>
        <div class="panel-body">
          <div id="pgZonas" class="stack">${zonas.map((z, i) => filaZonaHtml(z, i)).join('')}</div>
        </div>
      </div>

      <div class="panel">
        <div class="panel-head"><div><h2>Mensaje de delivery</h2><p>Se muestra al confirmar el pedido.</p></div></div>
        <div class="panel-body">
          <label class="field"><span>Mensaje</span><textarea id="pgDeliveryMensaje" rows="3" maxlength="800">${esc(delivery.mensaje || '')}</textarea></label>
          <label class="field mt-16"><span>Nota interna</span><input id="pgDeliveryNota" value="${esc(delivery.nota || '')}" maxlength="400"></label>
          <label class="check mt-16"><input id="pgDeliveryPendiente" type="checkbox" ${delivery.cotizacionPendiente !== false ? 'checked' : ''}> El delivery se cotiza después de recibir el pedido</label>
        </div>
      </div>

      <div class="row" style="justify-content:flex-end;gap:8px">
        <button class="btn btn-primary" type="button" id="pgGuardar">Guardar cambios de la página</button>
      </div>

      <div class="panel mt-16">
        <div class="panel-head">
          <div><h2>Categorías de locales</h2><p>Tipos de negocio que aparecen en los filtros de la web.</p></div>
          <button class="btn btn-sm" type="button" id="pgAgregarCategoria">+ Agregar categoría</button>
        </div>
        <div class="panel-body">
          <div id="pgCategorias" class="stack">
            ${categorias.map((c) => `<div class="categoria-row" data-cat-row>
              <input data-cat-id value="${esc(c.id)}" placeholder="id" maxlength="48">
              <input data-cat-nombre value="${esc(c.nombre)}" placeholder="Nombre visible" maxlength="60">
              <button class="icon-btn" type="button" data-quitar-categoria title="Quitar categoría">✕</button>
            </div>`).join('') || '<p class="small muted">Sin categorías.</p>'}
          </div>
          <div class="row mt-16" style="justify-content:flex-end"><button class="btn" type="button" id="pgGuardarCategorias">Guardar categorías</button></div>
        </div>
      </div>

      <div class="panel mt-16">
        <div class="panel-head">
          <div><h2>Promociones y novedades</h2><p>Todo aparece en una sola franja arriba en la web. Si dejas las listas vacías, se usan las tarjetas automáticas y los locales nuevos.</p></div>
        </div>
        <div class="panel-body">
          <div class="row" style="gap:18px;flex-wrap:wrap">
            <label class="check"><input id="pgDestacadosActiva" type="checkbox" ${!(secciones.novedades === false && secciones.promociones === false) ? 'checked' : ''}> Mostrar la franja de promos y novedades</label>
          </div>

          <div class="row mt-16" style="justify-content:space-between;align-items:center">
            <h3 style="margin:0">Promociones</h3>
            <button class="btn btn-sm" type="button" id="pgAgregarPromo">+ Agregar promo</button>
          </div>
          <div id="pgPromosLista" class="stack mt-8"></div>

          <div class="row mt-16" style="justify-content:space-between;align-items:center">
            <h3 style="margin:0">Novedades</h3>
            <button class="btn btn-sm" type="button" id="pgAgregarNovedad">+ Agregar novedad</button>
          </div>
          <div id="pgNovedadesLista" class="stack mt-8"></div>

          <div class="row mt-16" style="justify-content:flex-end">
            <button class="btn btn-primary" type="button" id="pgGuardarPromos">Guardar promos y novedades</button>
          </div>
          <div class="push-send-panel mt-16">
            <div><b>Enviar recomendación ahora</b><p>Solo llega a personas que activaron las notificaciones.</p></div>
            <input id="pgPushTitulo" maxlength="60" placeholder="Título del aviso" value="Promos de EnRuta para hoy">
            <input id="pgPushTexto" maxlength="140" placeholder="Mensaje corto" value="Mira las promos y locales recomendados de Nuevo Chimbote.">
            <button class="btn" type="button" id="pgEnviarNotificacion">🔔 Enviar aviso</button>
          </div>

          <div class="push-send-panel mt-16">
            <div><b>Recordar a quien no pide</b><p>Mensaje de antojo para clientes que ya aceptaron avisos.</p></div>
            <select id="pgPushPlantilla" aria-label="Mensaje de recordatorio">
              <option value="0">🍕 ¿Se te antoja una pizza?</option>
              <option value="1">🍗 Alitas, pizza o pollo</option>
              <option value="2">🍽️ Hoy no cocines</option>
              <option value="3">🌮 ¿Un antojo? Pide en EnRuta</option>
              <option value="4">✨ Promos y locales nuevos</option>
            </select>
            <button class="btn" type="button" id="pgEnviarRecordatorio">📣 Enviar recordatorio</button>
          </div>
        </div>
      </div>`;

    $('#pgAgregarZona').addEventListener('click', () => {
      const contZonas = $('#pgZonas');
      const i = $$('[data-zona-row]', contZonas).length;
      contZonas.insertAdjacentHTML('beforeend', filaZonaHtml(null, i));
      actualizarBotonesZona();
    });
    function actualizarBotonesZona() {
      $$('[data-quitar-zona]', $('#pgZonas')).forEach((b) => {
        b.onclick = () => {
          const filas = $$('[data-zona-row]', $('#pgZonas'));
          if (filas.length <= 1) return toast('Debe quedar al menos una zona.', 'err');
          b.closest('[data-zona-row]').remove();
        };
      });
    }
    actualizarBotonesZona();

    $('#pgAgregarCategoria').addEventListener('click', () => {
      const contCat = $('#pgCategorias');
      const vacio = contCat.querySelector('.small.muted');
      if (vacio) vacio.remove();
      contCat.insertAdjacentHTML('beforeend', `<div class="categoria-row" data-cat-row>
        <input data-cat-id placeholder="id" maxlength="48">
        <input data-cat-nombre placeholder="Nombre visible" maxlength="60">
        <button class="icon-btn" type="button" data-quitar-categoria title="Quitar categoría">✕</button>
      </div>`);
      actualizarBotonesCategoria();
    });
    function idDesdeNombre(texto) {
      return String(texto || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 48);
    }
    function actualizarBotonesCategoria() {
      $$('[data-quitar-categoria]', $('#pgCategorias')).forEach((b) => {
        b.onclick = () => b.closest('[data-cat-row]').remove();
      });
      // Al escribir el nombre de una categoría nueva, el identificador se
      // completa solo. Si ya existe, no se toca.
      $$('[data-cat-row]', $('#pgCategorias')).forEach((fila) => {
        const nombre = fila.querySelector('[data-cat-nombre]');
        const id = fila.querySelector('[data-cat-id]');
        if (!nombre || !id) return;
        nombre.addEventListener('input', () => {
          if (!id.value.trim()) id.value = idDesdeNombre(nombre.value);
        });
      });
    }
    actualizarBotonesCategoria();

    $('#pgGuardar').addEventListener('click', async () => {
      const btn = $('#pgGuardar');
      const cfgNueva = {
        marca: $('#pgMarca').value.trim(),
        ciudad: $('#pgCiudad').value.trim(),
        moneda: $('#pgMoneda').value.trim(),
        whatsapp: { numero: $('#pgWaNumero').value.trim(), visible: $('#pgWaVisible').value.trim() },
        email: $('#pgEmail').value.trim(),
        zonaPrincipal: $('#pgZonaPrincipal').value,
        avisoEjemplos: $('#pgAvisoEjemplos').checked,
        servicios: { taximoto: $('#pgTaximoto').checked },
        redes: {
          tiktok: { usuario: $('#pgTikTokUsuario').value.trim(), url: $('#pgTikTokUrl').value.trim() },
          instagram: { usuario: $('#pgInstagramUsuario').value.trim(), url: $('#pgInstagramUrl').value.trim() }
        },
        delivery: {
          cotizacionPendiente: $('#pgDeliveryPendiente').checked,
          mensaje: $('#pgDeliveryMensaje').value.trim(),
          nota: $('#pgDeliveryNota').value.trim()
        },
        zonas: $$('[data-zona-row]', $('#pgZonas')).map((fila) => ({
          id: fila.querySelector('[data-zona-id]').value.trim(),
          nombre: fila.querySelector('[data-zona-nombre]').value.trim(),
          horarioTexto: fila.querySelector('[data-zona-horario]').value.trim(),
          apertura: fila.querySelector('[data-zona-apertura]').value,
          cierre: fila.querySelector('[data-zona-cierre]').value,
          nota: fila.querySelector('[data-zona-nota]').value.trim(),
          dias: $$('[data-zona-dia]', fila).filter((c) => c.checked).map((c) => Number(c.dataset.zonaDia))
        })),
        // Se conservan tal como estén guardadas para no borrarlas al
        // guardar el resto de la página. Se editan en su propio panel.
        secciones: Object.assign({}, state.config && state.config.secciones),
        promociones: (state.config && Array.isArray(state.config.promociones)) ? state.config.promociones : [],
        novedades: (state.config && Array.isArray(state.config.novedades)) ? state.config.novedades : []
      };
      try {
        bloquear(btn, true);
        const res = await api('/api/admin/config', { method: 'PUT', body: { config: cfgNueva } });
        state.config = res.config || cfgNueva;
        toast('Página actualizada. La web pública ya muestra los cambios.');
        await cargarBase();
        pintarPagina();
      } catch (e) {
        avisarError(e);
        bloquear(btn, false);
      }
    });

    $('#pgGuardarCategorias').addEventListener('click', async () => {
      const btn = $('#pgGuardarCategorias');
      const categoriasNuevas = $$('[data-cat-row]', $('#pgCategorias')).map((fila) => {
        const nombre = fila.querySelector('[data-cat-nombre]').value.trim();
        const id = fila.querySelector('[data-cat-id]').value.trim() || idDesdeNombre(nombre);
        return { id, nombre };
      }).filter((c) => c.nombre);
      try {
        bloquear(btn, true);
        const res = await api('/api/admin/categorias-locales', { method: 'PUT', body: { categorias: categoriasNuevas } });
        state.categorias = res;
        toast('Categorías actualizadas.');
        pintarPagina();
      } catch (e) {
        avisarError(e);
        bloquear(btn, false);
      }
    });

    /* ---------- Promociones y novedades ---------- */
    function filaPromoHtml(p) {
      const item = p || {};
      const img = item.imagen
        ? '<img src="' + esc(item.imagen) + '" alt="" style="width:64px;height:48px;object-fit:cover;border-radius:8px">'
        : '<span class="small muted">Sin foto</span>';
      return '<div class="campaign-row" data-promo-row data-id="' + esc(item.id || '') + '">' +
        '<label class="check" title="Activa"><input type="checkbox" data-promo-activa ' + (item.activa !== false ? 'checked' : '') + '></label>' +
        '<div class="campaign-main">' +
          '<div class="campaign-fields">' +
            '<input data-promo-titulo value="' + esc(item.titulo || '') + '" placeholder="Título de la promo" maxlength="60">' +
            '<input data-promo-texto value="' + esc(item.texto || '') + '" placeholder="Texto corto / beneficio" maxlength="90">' +
            '<input data-promo-enlace value="' + esc(item.enlace || '') + '" placeholder="Destino: local:canton o https://…" maxlength="200">' +
          '</div>' +
          '<div class="campaign-tools">' +
            '<input data-promo-emoji value="' + esc(item.emoji || '🔥') + '" maxlength="8" title="Emoji" aria-label="Emoji de promo">' +
            '<input data-promo-etiqueta value="' + esc(item.etiqueta || 'RECOMENDADO') + '" placeholder="Etiqueta" maxlength="20" aria-label="Etiqueta de promo">' +
            '<select data-promo-color aria-label="Color de la promo">' +
              [['promo-amarillo','Amarillo'],['promo-negro','Negro'],['promo-verde','Verde'],['promo-naranja','Naranja']].map(([v,t]) => '<option value="' + v + '"' + ((item.color || 'promo-amarillo') === v ? ' selected' : '') + '>' + t + '</option>').join('') +
            '</select>' +
            '<select data-promo-foco aria-label="Encuadre de la foto">' +
              [['center','Centro'],['top','Arriba'],['bottom','Abajo']].map(([v,t]) => '<option value="' + v + '"' + ((item.foco || 'center') === v ? ' selected' : '') + '>' + t + '</option>').join('') +
            '</select>' +
            '<input data-promo-boton value="' + esc(item.boton || 'Ver promo') + '" placeholder="Texto del botón" maxlength="24">' +
            '<span class="campaign-image" data-promo-preview>' + img + '</span>' +
            '<label class="btn btn-sm campaign-upload">Cambiar foto<input class="file-input" type="file" accept="image/jpeg,image/png,image/webp" data-promo-archivo></label>' +
            '<input type="hidden" data-promo-imagen value="' + esc(item.imagen || '') + '">' +
          '</div>' +
        '</div>' +
        '<div class="campaign-actions"><button class="icon-btn" type="button" data-promo-subir title="Mover antes">↑</button><button class="icon-btn" type="button" data-promo-bajar title="Mover después">↓</button><button class="icon-btn" type="button" data-quitar-promo title="Quitar promo">✕</button></div>' +
      '</div>';
    }

    function filaNovedadHtml(n) {
      const item = n || {};
      const img = item.imagen
        ? '<img src="' + esc(item.imagen) + '" alt="" style="width:64px;height:48px;object-fit:cover;border-radius:8px">'
        : '<span class="small muted">Sin foto</span>';
      return '<div class="campaign-row" data-novedad-row data-id="' + esc(item.id || '') + '">' +
        '<label class="check" title="Activa"><input type="checkbox" data-novedad-activa ' + (item.activa !== false ? 'checked' : '') + '></label>' +
        '<div class="campaign-main"><div class="campaign-fields">' +
          '<input data-novedad-titulo value="' + esc(item.titulo || '') + '" placeholder="Título de la novedad" maxlength="60">' +
          '<input data-novedad-texto value="' + esc(item.texto || '') + '" placeholder="Texto corto" maxlength="90">' +
          '<input data-novedad-enlace value="' + esc(item.enlace || '') + '" placeholder="Destino: local:canton o https://…" maxlength="200">' +
        '</div><div class="campaign-tools">' +
          '<input data-novedad-etiqueta value="' + esc(item.etiqueta || 'NUEVO') + '" maxlength="20" title="Etiqueta">' +
          '<select data-novedad-color aria-label="Color de la novedad">' +
            [['promo-amarillo','Amarillo'],['promo-negro','Negro'],['promo-verde','Verde'],['promo-naranja','Naranja']].map(([v,t]) => '<option value="' + v + '"' + ((item.color || 'promo-amarillo') === v ? ' selected' : '') + '>' + t + '</option>').join('') +
          '</select>' +
          '<select data-novedad-foco aria-label="Encuadre de la foto">' +
            [['center','Centro'],['top','Arriba'],['bottom','Abajo']].map(([v,t]) => '<option value="' + v + '"' + ((item.foco || 'center') === v ? ' selected' : '') + '>' + t + '</option>').join('') +
          '</select>' +
          '<input data-novedad-boton value="' + esc(item.boton || 'Ver más') + '" placeholder="Texto del botón" maxlength="24">' +
          '<span class="campaign-image" data-novedad-preview>' + img + '</span>' +
          '<label class="btn btn-sm campaign-upload">Cambiar foto<input class="file-input" type="file" accept="image/jpeg,image/png,image/webp" data-novedad-archivo></label>' +
          '<input type="hidden" data-novedad-imagen value="' + esc(item.imagen || '') + '">' +
        '</div></div>' +
        '<div class="campaign-actions"><button class="icon-btn" type="button" data-novedad-subir title="Mover antes">↑</button><button class="icon-btn" type="button" data-novedad-bajar title="Mover después">↓</button><button class="icon-btn" type="button" data-quitar-novedad title="Quitar novedad">✕</button></div>' +
      '</div>';
    }

    const contPromosAdmin = $('#pgPromosLista');
    const contNovedadesAdmin = $('#pgNovedadesLista');
    const promosGuardadas = Array.isArray(cfg.promociones) ? cfg.promociones : [];
    const novedadesGuardadas = Array.isArray(cfg.novedades) ? cfg.novedades : [];
    contPromosAdmin.innerHTML = promosGuardadas.length
      ? promosGuardadas.map(filaPromoHtml).join('')
      : '<p class="small muted" data-vacio-promo>Sin promociones propias. Se muestran las tarjetas automáticas.</p>';
    contNovedadesAdmin.innerHTML = novedadesGuardadas.length
      ? novedadesGuardadas.map(filaNovedadHtml).join('')
      : '<p class="small muted" data-vacio-novedad>Sin novedades propias. Se muestran los locales nuevos.</p>';

    const primerDestacado = promosGuardadas.find((p) => p && p.activa !== false && p.titulo) ||
      novedadesGuardadas.find((n) => n && n.activa !== false && n.titulo);
    if (primerDestacado) {
      $('#pgPushTitulo').value = String(primerDestacado.titulo || '').slice(0, 60);
      $('#pgPushTexto').value = String(primerDestacado.texto || 'Mira esta recomendación en EnRuta Delivery.').slice(0, 140);
    }

    $('#pgAgregarPromo').addEventListener('click', () => {
      const vacio = contPromosAdmin.querySelector('[data-vacio-promo]');
      if (vacio) vacio.remove();
      contPromosAdmin.insertAdjacentHTML('beforeend', filaPromoHtml(null));
    });
    $('#pgAgregarNovedad').addEventListener('click', () => {
      const vacio = contNovedadesAdmin.querySelector('[data-vacio-novedad]');
      if (vacio) vacio.remove();
      contNovedadesAdmin.insertAdjacentHTML('beforeend', filaNovedadHtml(null));
    });

    async function subirImagenFila(input) {
      const esPromo = input.hasAttribute('data-promo-archivo');
      const fila = input.closest('[data-promo-row], [data-novedad-row]');
      if (!fila) return;
      const campo = fila.querySelector(esPromo ? '[data-promo-imagen]' : '[data-novedad-imagen]');
      const preview = fila.querySelector(esPromo ? '[data-promo-preview]' : '[data-novedad-preview]');
      const archivo = input.files && input.files[0];
      if (!archivo) return;
      try {
        toast('Subiendo imagen…');
        const res = await subirImagenArchivo(archivo, {
          tipoDestino: 'promo', carpeta: 'promos', prefijo: esPromo ? 'promo' : 'novedad'
        });
        campo.value = res.ruta;
        preview.innerHTML = '<img src="' + esc(res.ruta) + '" alt="" style="width:64px;height:48px;object-fit:cover;border-radius:8px">';
        toast('Imagen lista.');
      } catch (e) {
        avisarError(e);
      }
    }

    [contPromosAdmin, contNovedadesAdmin].forEach((cont) => {
      cont.addEventListener('change', (e) => {
        const input = e.target.closest('[data-promo-archivo], [data-novedad-archivo]');
        if (input) subirImagenFila(input);
      });
      cont.addEventListener('click', (e) => {
        const quitar = e.target.closest('[data-quitar-promo], [data-quitar-novedad]');
        if (quitar) quitar.closest('[data-promo-row], [data-novedad-row]').remove();
      });
    });

    $('#pgGuardarPromos').addEventListener('click', async () => {
      const btn = $('#pgGuardarPromos');
      const promociones = $$('[data-promo-row]', contPromosAdmin).map((fila) => {
        const titulo = fila.querySelector('[data-promo-titulo]').value.trim();
        return {
          id: fila.dataset.id || idDesdeNombre(titulo) || 'promo-' + Date.now(),
          activa: fila.querySelector('[data-promo-activa]').checked,
          emoji: fila.querySelector('[data-promo-emoji]').value.trim(),
          etiqueta: fila.querySelector('[data-promo-etiqueta]').value.trim(),
          color: fila.querySelector('[data-promo-color]').value,
          foco: fila.querySelector('[data-promo-foco]').value,
          titulo,
          texto: fila.querySelector('[data-promo-texto]').value.trim(),
          imagen: fila.querySelector('[data-promo-imagen]').value.trim(),
          enlace: fila.querySelector('[data-promo-enlace]').value.trim(),
          boton: fila.querySelector('[data-promo-boton]').value.trim()
        };
      }).filter((p) => p.titulo);
      const novedades = $$('[data-novedad-row]', contNovedadesAdmin).map((fila) => {
        const titulo = fila.querySelector('[data-novedad-titulo]').value.trim();
        return {
          id: fila.dataset.id || idDesdeNombre(titulo) || 'novedad-' + Date.now(),
          activa: fila.querySelector('[data-novedad-activa]').checked,
          etiqueta: fila.querySelector('[data-novedad-etiqueta]').value.trim(),
          color: fila.querySelector('[data-novedad-color]').value,
          foco: fila.querySelector('[data-novedad-foco]').value,
          boton: fila.querySelector('[data-novedad-boton]').value.trim(),
          titulo,
          texto: fila.querySelector('[data-novedad-texto]').value.trim(),
          imagen: fila.querySelector('[data-novedad-imagen]').value.trim(),
          enlace: fila.querySelector('[data-novedad-enlace]').value.trim()
        };
      }).filter((n) => n.titulo);

      const base = state.config || cfg;
      const activa = $('#pgDestacadosActiva').checked;
      const nuevas = Object.assign({}, base, {
        secciones: Object.assign({}, base.secciones, {
          novedades: activa,
          promociones: activa
        }),
        promociones,
        novedades
      });
      try {
        bloquear(btn, true);
        const res = await api('/api/admin/config', { method: 'PUT', body: { config: nuevas } });
        state.config = res.config || nuevas;
        toast('Promos y novedades actualizadas.');
      } catch (e) {
        avisarError(e);
      } finally {
        bloquear(btn, false);
      }
    });

    [contPromosAdmin, contNovedadesAdmin].forEach((cont) => {
      cont.addEventListener('click', (e) => {
        const arriba = e.target.closest('[data-promo-subir], [data-novedad-subir]');
        const abajo = e.target.closest('[data-promo-bajar], [data-novedad-bajar]');
        const mover = arriba || abajo;
        if (!mover) return;
        const fila = mover.closest('[data-promo-row], [data-novedad-row]');
        if (!fila) return;
        if (arriba && fila.previousElementSibling) cont.insertBefore(fila, fila.previousElementSibling);
        if (abajo && fila.nextElementSibling) cont.insertBefore(fila.nextElementSibling, fila);
      });
    });

    $('#pgEnviarNotificacion').addEventListener('click', async () => {
      const btn = $('#pgEnviarNotificacion');
      const title = $('#pgPushTitulo').value.trim();
      const body = $('#pgPushTexto').value.trim();
      if (!title || !body) return toast('Escribe el título y el mensaje del aviso.', 'err');
      if (!window.confirm('¿Enviar esta recomendación a quienes aceptaron recibir notificaciones?')) return;
      const primeraPromo = $$('[data-promo-row]', contPromosAdmin).find((fila) => fila.querySelector('[data-promo-activa]').checked);
      const destino = primeraPromo ? primeraPromo.querySelector('[data-promo-enlace]').value.trim() : '';
      let url = '/';
      if (destino.startsWith('local:')) url = '/?local=' + encodeURIComponent(destino.slice(6));
      else if (destino.startsWith('/') && !destino.startsWith('//')) url = destino;
      else if (/^https:\/\/enrutadelivery\.com\//i.test(destino)) url = new URL(destino).pathname + new URL(destino).search;
      try {
        bloquear(btn, true);
        const res = await api('/api/admin/push/enviar', { method: 'POST', body: { title, body, url } });
        toast('Aviso enviado a ' + (res.enviados || 0) + ' suscriptores.');
        if (!res.enviados) toast('Aún no hay suscriptores con notificaciones activadas.');
      } catch (e) {
        avisarError(e);
      } finally {
        bloquear(btn, false);
      }
    });

    const RECORDATORIOS = [
      { title: '¿Se te antoja una pizza? 🍕', body: 'Pide en EnRuta: pizzas, alitas y más en Nuevo Chimbote.' },
      { title: 'Alitas, pizza o pollo 🍗', body: 'Tus locales de Nuevo Chimbote están listos. Pide por EnRuta.' },
      { title: 'Hoy no cocines 🍽️', body: 'Elige tu local favorito y pide por WhatsApp con EnRuta.' },
      { title: '¿Un antojo? Pide en EnRuta', body: 'Chifa, parrillas, alitas, pizzas y postres con delivery.' },
      { title: 'Promos y locales nuevos', body: 'Entra a EnRuta y mira lo nuevo de Nuevo Chimbote.' }
    ];
    $('#pgEnviarRecordatorio').addEventListener('click', async () => {
      const btn = $('#pgEnviarRecordatorio');
      const indice = Number($('#pgPushPlantilla').value) || 0;
      const mensaje = RECORDATORIOS[indice] || RECORDATORIOS[0];
      if (!window.confirm('¿Enviar «' + mensaje.title + '» a quienes aceptaron avisos?')) return;
      try {
        bloquear(btn, true);
        const res = await api('/api/admin/push/enviar', { method: 'POST', body: { ...mensaje, url: '/' } });
        toast('Recordatorio enviado a ' + (res.enviados || 0) + ' suscriptores.');
        if (!res.enviados) toast('Aún no hay suscriptores. El botón «Recibir avisos» ya está en la web.');
      } catch (e) {
        avisarError(e);
      } finally {
        bloquear(btn, false);
      }
    });
  }

  /* ============================================================
     CATÁLOGOS GLOBALES
     ============================================================ */
  async function vistaCatalogos(param) {
    if (state.sesion.rol !== 'admin') return ir('resumen');
    mostrarVista('catalogos');
    const id = param === 'primera-necesidad' ? 'primera-necesidad' : 'licores';
    state.catalogos.actual = id;
    const cont = $('#view-catalogos');
    cont.innerHTML = '<div class="panel"><div class="panel-body muted">Cargando catálogo…</div></div>';
    try {
      state.catalogos.datos = await api('/api/admin/catalogos/' + id);
      state.catalogos.filtro = '';
      state.catalogos.categoria = '';
      pintarCatalogo();
    } catch (e) {
      cont.innerHTML = '<div class="panel"><div class="panel-body"><p class="form-error">' + esc(e.message) + '</p></div></div>';
    }
  }

  function pintarCatalogo() {
    const cont = $('#view-catalogos');
    const datos = state.catalogos.datos;
    if (!datos) return;
    const esLicores = state.catalogos.actual === 'licores';
    const cats = datos.categorias || [];
    const q = norm(state.catalogos.filtro);
    const fcat = state.catalogos.categoria;
    const productos = (datos.productos || []).filter((p) => {
      if (fcat && p.categoriaId !== fcat) return false;
      if (q) {
        const t = norm([p.nombre, p.marca, p.presentacion, p.categoriaId].join(' '));
        if (!t.includes(q)) return false;
      }
      return true;
    });
    const nombreCat = (cid) => (cats.find((c) => c.id === cid) || {}).nombre || cid;
    const publicados = (datos.productos || []).filter((p) => p.publicado !== false).length;

    cont.innerHTML = `
      <div class="page-head">
        <div>
          <h2>Catálogos EnRuta</h2>
          <p>Productos globales de ${esLicores ? 'licores' : 'primera necesidad'}. ${(datos.productos || []).length} productos · ${publicados} publicados.</p>
        </div>
        <div class="page-head-actions">
          <button class="btn" id="catCategoriasBtn">Categorías</button>
          <button class="btn" id="catExportarBtn">Exportar JSON</button>
          <button class="btn btn-primary" id="catNuevoBtn">+ Nuevo producto</button>
        </div>
      </div>

      <div class="tabs">
        <button class="tab ${esLicores ? 'activo' : ''}" data-catalogo="licores">Licores</button>
        <button class="tab ${!esLicores ? 'activo' : ''}" data-catalogo="primera-necesidad">Primera necesidad</button>
      </div>

      <div class="toolbar">
        <div class="search"><input class="input" id="catBuscar" type="search" placeholder="Buscar por nombre, marca o presentación" value="${esc(state.catalogos.filtro)}"></div>
        <select class="input" id="catFiltroCat" style="max-width:240px">
          <option value="">Todas las categorías</option>
          ${cats.map((c) => `<option value="${esc(c.id)}" ${c.id === fcat ? 'selected' : ''}>${esc(c.nombre)}</option>`).join('')}
        </select>
        <span class="small muted">${productos.length} visibles</span>
      </div>

      <div class="panel"><div class="table-wrap">
        ${productos.length ? `<table class="table">
          <thead><tr><th>Producto</th><th>Categoría</th><th>Presentación</th><th>Precio venta</th><th>Estado</th><th>Acciones</th></tr></thead>
          <tbody>
            ${productos.map((p) => filaCatalogo(p, nombreCat)).join('')}
          </tbody>
        </table>` : `<div class="empty"><div class="big">📦</div><h3>Sin productos</h3><p>No hay coincidencias en este catálogo.</p></div>`}
      </div></div>
      <p class="small muted mt-16">${esc((datos.avisoPrecios || 'Precios y disponibilidad sujetos a confirmación.'))} La fuente de cada producto se conserva al editar.</p>`;

    $$('[data-catalogo]', cont).forEach((b) => b.addEventListener('click', () => ir('catalogos/' + b.dataset.catalogo)));
    $('#catNuevoBtn').addEventListener('click', () => modalProductoCatalogo(null));
    $('#catCategoriasBtn').addEventListener('click', modalCategoriasCatalogo);
    $('#catExportarBtn').addEventListener('click', () => descargarJson('catalogo-' + state.catalogos.actual + '.json', datos));
    const buscar = $('#catBuscar');
    buscar.addEventListener('input', debounce(() => {
      state.catalogos.filtro = buscar.value;
      pintarCatalogo();
      const b = $('#catBuscar'); if (b) { b.focus(); b.setSelectionRange(b.value.length, b.value.length); }
    }, 180));
    $('#catFiltroCat').addEventListener('change', (e) => { state.catalogos.categoria = e.target.value; pintarCatalogo(); });
    $$('[data-editar-cat]', cont).forEach((b) => b.addEventListener('click', () => {
      const p = (state.catalogos.datos.productos || []).find((x) => String(x.id) === b.dataset.editarCat);
      if (p) modalProductoCatalogo(p);
    }));
    $$('[data-toggle-cat]', cont).forEach((b) => b.addEventListener('click', () => toggleProductoCatalogo(b.dataset.toggleCat, b.dataset.campo, b)));
    $$('[data-borrar-cat]', cont).forEach((b) => b.addEventListener('click', () => borrarProductoCatalogo(b.dataset.borrarCat)));
  }

  function filaCatalogo(p, nombreCat) {
    const img = p.imagen ? `<img class="mini-img" src="${esc(imgUrlCatalogo(state.catalogos.actual, p.imagen))}" alt="">` : '<div class="thumb-empty">📦</div>';
    return `<tr class="${p.publicado === false ? 'row-inactivo' : ''}">
      <td><div class="row" style="gap:10px;flex-wrap:nowrap">${img}<div>
        <div class="nombre">${esc(p.nombre)}</div>
        <div class="sub">${esc(p.marca || 'Sin marca')}${p.descripcion ? ' · ' + esc(p.descripcion).slice(0, 60) : ''}</div>
      </div></div></td>
      <td><span class="badge">${esc(nombreCat(p.categoriaId))}</span></td>
      <td class="small">${esc(p.presentacion || 'Unidad')}</td>
      <td class="precio">${money(p.precioVenta)}${p.precioReferencia && Number(p.precioReferencia) !== Number(p.precioVenta) ? `<div class="sub">Ref. ${money(p.precioReferencia)}</div>` : ''}</td>
      <td><div class="stack" style="gap:4px;align-items:flex-start">
        ${badgeEstado(p.publicado !== false, p.disponible !== false, false)}
        ${p.fuente && p.fuente.tienda ? `<span class="badge info">${esc(p.fuente.tienda)}</span>` : ''}
      </div></td>
      <td><div class="acciones">
        <button class="btn btn-sm" data-editar-cat="${esc(p.id)}">Editar</button>
        <button class="link-btn" data-toggle-cat="${esc(p.id)}" data-campo="publicado">${p.publicado === false ? 'Publicar' : 'Ocultar'}</button>
        <button class="link-btn" data-toggle-cat="${esc(p.id)}" data-campo="disponible">${p.disponible === false ? 'Disponible' : 'Agotar'}</button>
        <button class="link-btn" style="color:#c62828" data-borrar-cat="${esc(p.id)}">Eliminar</button>
      </div></td>
    </tr>`;
  }

  async function recargarCatalogo() {
    state.catalogos.datos = await api('/api/admin/catalogos/' + state.catalogos.actual);
    pintarCatalogo();
  }

  async function persistirCatalogo(productos, categorias) {
    const datos = state.catalogos.datos;
    const res = await api('/api/admin/catalogos/' + state.catalogos.actual, {
      method: 'PUT',
      body: { categorias: categorias || datos.categorias, productos }
    });
    await recargarCatalogo();
    return res;
  }

  function modalProductoCatalogo(producto) {
    const esNuevo = !producto;
    const datos = state.catalogos.datos;
    const cats = datos.categorias || [];
    const p = producto ? Object.assign({}, producto) : {
      nombre: '', marca: '', presentacion: 'Unidad', categoriaId: (cats[0] || {}).id || '',
      precioVenta: null, precioReferencia: null, imagen: null, publicado: true, disponible: true, descripcion: ''
    };
    const catActual = state.catalogos.actual;
    const imgUrl = p.imagen ? imgUrlCatalogo(catActual, p.imagen) : '';
    abrirModal({
      titulo: esNuevo ? 'Nuevo producto de catálogo' : 'Editar producto de catálogo',
      ancho: 'wide',
      cuerpo: `
        <form id="formCatProducto">
          <div class="form-grid">
            <label class="field full"><span>Nombre *</span><input id="cpNombre" value="${esc(p.nombre || '')}" maxlength="150" required></label>
            <label class="field"><span>Marca</span><input id="cpMarca" value="${esc(p.marca || '')}" maxlength="80"></label>
            <label class="field"><span>Presentación</span><input id="cpPresentacion" value="${esc(p.presentacion || '')}" maxlength="80" placeholder="Botella 700 ml"></label>
            <label class="field"><span>Categoría *</span><select id="cpCategoria">${cats.map((c) => `<option value="${esc(c.id)}" ${c.id === p.categoriaId ? 'selected' : ''}>${esc(c.nombre)}</option>`).join('')}</select></label>
            <label class="field"><span>Precio de venta (S/) *</span><input id="cpPrecio" type="number" min="0" step="0.01" value="${esc(p.precioVenta || '')}"></label>
            <label class="field"><span>Precio de referencia (S/)</span><input id="cpReferencia" type="number" min="0" step="0.01" value="${esc(p.precioReferencia || '')}"><span class="hint">El precio de referencia es informativo; el de venta es el que ve el cliente.</span></label>
            <label class="field"><span>Descripción breve</span><input id="cpDescripcion" value="${esc(p.descripcion || '')}" maxlength="200"></label>
          </div>
          <div class="form-section">
            <h3>Imagen</h3>
            <div class="img-manager">
              <div class="img-preview" id="cpImgPreview">${imgUrl ? `<img src="${esc(imgUrl)}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:12px">` : '📦'}</div>
              <div class="img-actions">
                <span class="small muted" id="cpImgRuta">${p.imagen ? esc(p.imagen) : 'Sin imagen'}</span>
                <div class="row">
                  <label class="btn btn-sm" style="cursor:pointer">Subir imagen<input class="file-input" type="file" accept="image/jpeg,image/png,image/webp" id="cpImgFile"></label>
                  ${p.imagen ? '<button class="btn btn-sm btn-danger" type="button" id="cpImgQuitar">Quitar</button>' : ''}
                </div>
                <span class="hint">Usa una foto real del producto. No se presentan ilustraciones como fotos oficiales.</span>
              </div>
            </div>
            <input type="hidden" id="cpImagen" value="${esc(p.imagen || '')}">
          </div>
          <div class="form-section">
            <h3>Publicación</h3>
            <div class="row" style="gap:18px">
              <label class="check"><input id="cpPublicado" type="checkbox" ${p.publicado !== false ? 'checked' : ''}> Publicado</label>
              <label class="check"><input id="cpDisponible" type="checkbox" ${p.disponible !== false ? 'checked' : ''}> Disponible</label>
            </div>
            ${p.fuente ? `<p class="small muted mt-8">Fuente: ${esc(p.fuente.tienda || '—')} · ${esc(p.fuente.fechaVerificacion || '')} · ${esc(p.fuente.metodo || '')}</p>` : ''}
          </div>
        </form>`,
      pie: `<button class="btn" data-cerrar>Cancelar</button><button class="btn btn-primary" id="cpGuardar">${esNuevo ? 'Agregar producto' : 'Guardar cambios'}</button>`
    });
    $('[data-cerrar]').addEventListener('click', cerrarModal);
    const file = $('#cpImgFile');
    file.addEventListener('change', async () => {
      const f = file.files && file.files[0];
      if (!f) return;
      try {
        toast('Subiendo imagen…');
        const res = await subirImagenArchivo(f, { tipoDestino: 'catalogo', carpeta: catActual, prefijo: 'cat' });
        $('#cpImagen').value = res.ruta;
        $('#cpImgRuta').textContent = res.ruta;
        $('#cpImgPreview').innerHTML = `<img src="${esc(imgUrlCatalogo(catActual, res.ruta))}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:12px">`;
        if (!$('#cpImgQuitar')) {
          const q = document.createElement('button');
          q.className = 'btn btn-sm btn-danger'; q.type = 'button'; q.id = 'cpImgQuitar'; q.textContent = 'Quitar';
          file.closest('.row').appendChild(q);
          q.addEventListener('click', quitar);
        }
        toast('Imagen subida. Guarda el producto para aplicarla.');
      } catch (e) { avisarError(e); } finally { file.value = ''; }
    });
    function quitar() {
      $('#cpImagen').value = '';
      $('#cpImgRuta').textContent = 'Sin imagen';
      $('#cpImgPreview').innerHTML = '📦';
      const q = $('#cpImgQuitar'); if (q) q.remove();
    }
    const q = $('#cpImgQuitar'); if (q) q.addEventListener('click', quitar);

    $('#cpGuardar').addEventListener('click', async () => {
      const btn = $('#cpGuardar');
      const nuevo = {
        ...p,
        nombre: $('#cpNombre').value.trim(),
        marca: $('#cpMarca').value.trim(),
        presentacion: $('#cpPresentacion').value.trim() || 'Unidad',
        categoriaId: $('#cpCategoria').value,
        precioVenta: $('#cpPrecio').value === '' ? null : num($('#cpPrecio').value),
        precioReferencia: $('#cpReferencia').value === '' ? null : num($('#cpReferencia').value),
        descripcion: $('#cpDescripcion').value.trim(),
        imagen: $('#cpImagen').value || null,
        publicado: $('#cpPublicado').checked,
        disponible: $('#cpDisponible').checked
      };
      if (!nuevo.nombre) return toast('Escribe el nombre del producto.', 'err');
      if (nuevo.publicado && !(nuevo.precioVenta > 0)) return toast('Un producto publicado necesita precio de venta.', 'err');
      if (!nuevo.id) nuevo.id = 'cat-' + slugify(nuevo.nombre);
      const lista = (datos.productos || []).slice();
      if (esNuevo) lista.push(nuevo);
      else {
        const idx = lista.findIndex((x) => String(x.id) === String(p.id));
        if (idx >= 0) lista[idx] = nuevo;
      }
      try {
        bloquear(btn, true);
        await persistirCatalogo(lista, datos.categorias);
        cerrarModal();
        toast(esNuevo ? 'Producto agregado al catálogo.' : 'Producto actualizado.');
      } catch (e) {
        bloquear(btn, false);
        avisarError(e);
      }
    });
  }

  async function toggleProductoCatalogo(id, campo, btn) {
    const datos = state.catalogos.datos;
    const p = (datos.productos || []).find((x) => String(x.id) === String(id));
    if (!p) return;
    const copia = Object.assign({}, p);
    if (campo === 'publicado') copia.publicado = p.publicado === false;
    else copia.disponible = p.disponible === false;
    const lista = datos.productos.map((x) => String(x.id) === String(id) ? copia : x);
    try {
      bloquear(btn, true);
      await persistirCatalogo(lista, datos.categorias);
      toast('Producto actualizado.');
    } catch (e) { avisarError(e); bloquear(btn, false); }
  }

  function borrarProductoCatalogo(id) {
    const datos = state.catalogos.datos;
    const p = (datos.productos || []).find((x) => String(x.id) === String(id));
    if (!p) return;
    abrirModal({
      titulo: 'Eliminar producto del catálogo',
      ancho: 'narrow',
      cuerpo: `<p>¿Eliminar <b>${esc(p.nombre)}</b> del catálogo ${esc(state.catalogos.actual)}?</p><p class="small muted mt-8">Se guarda respaldo antes de aplicar el cambio.</p>`,
      pie: `<button class="btn" data-cerrar>Cancelar</button><button class="btn btn-danger" id="confBorrarCat">Eliminar</button>`
    });
    $('[data-cerrar]').addEventListener('click', cerrarModal);
    $('#confBorrarCat').addEventListener('click', async () => {
      const btn = $('#confBorrarCat');
      try {
        bloquear(btn, true);
        await persistirCatalogo((datos.productos || []).filter((x) => String(x.id) !== String(id)), datos.categorias);
        cerrarModal();
        toast('Producto eliminado.');
      } catch (e) { bloquear(btn, false); avisarError(e); }
    });
  }

  function modalCategoriasCatalogo() {
    const datos = state.catalogos.datos;
    let cats = (datos.categorias || []).map((c) => Object.assign({}, c));
    abrirModal({
      titulo: 'Categorías del catálogo',
      ancho: '',
      cuerpo: `<p class="small muted mb-16">El identificador no se puede editar porque los productos lo usan. Renombra con cuidado.</p>
        <div id="catsLista" class="stack" style="gap:8px"></div>
        <button class="btn btn-sm mt-8" type="button" id="addCatBtn">+ Agregar categoría</button>`,
      pie: `<button class="btn" data-cerrar>Cancelar</button><button class="btn btn-primary" id="guardarCatsBtn">Guardar categorías</button>`
    });
    $('[data-cerrar]').addEventListener('click', cerrarModal);
    function pintar() {
      $('#catsLista').innerHTML = cats.map((c, i) => `
        <div class="row" data-cat-fila="${i}" style="flex-wrap:nowrap">
          <input class="input" value="${esc(c.id)}" disabled style="max-width:160px;font-family:var(--mono);font-size:12px">
          <input class="input" value="${esc(c.nombre)}" data-cat-nombre="${i}" placeholder="Nombre de categoría">
          <button class="icon-btn" type="button" data-cat-quitar="${i}">✕</button>
        </div>`).join('') || '<p class="small muted">Sin categorías.</p>';
      $$('[data-cat-nombre]').forEach((inp) => inp.addEventListener('input', () => { cats[Number(inp.dataset.catNombre)].nombre = inp.value; }));
      $$('[data-cat-quitar]').forEach((b) => b.addEventListener('click', () => { cats.splice(Number(b.dataset.catQuitar), 1); pintar(); }));
    }
    pintar();
    $('#addCatBtn').addEventListener('click', () => {
      const nombre = prompt('Nombre de la nueva categoría:');
      if (!nombre || !nombre.trim()) return;
      const idBase = slugify(nombre);
      let id = idBase; let n = 2;
      while (cats.some((c) => c.id === id)) id = idBase + '-' + (n++);
      cats.push({ id, nombre: nombre.trim() });
      pintar();
    });
    $('#guardarCatsBtn').addEventListener('click', async () => {
      const btn = $('#guardarCatsBtn');
      const limpias = cats.map((c) => ({ id: c.id, nombre: (c.nombre || '').trim() })).filter((c) => c.nombre);
      if (!limpias.length) return toast('El catálogo necesita al menos una categoría.', 'err');
      try {
        bloquear(btn, true);
        await persistirCatalogo(datos.productos || [], limpias);
        cerrarModal();
        toast('Categorías guardadas.');
      } catch (e) { bloquear(btn, false); avisarError(e); }
    });
  }

  /* ============================================================
     PEDIDOS
     ============================================================ */
  let filtroPedido = '';

  async function vistaPedidos() {
    mostrarVista('pedidos');
    const cont = $('#view-pedidos');
    cont.innerHTML = '<div class="panel"><div class="panel-body muted">Cargando pedidos…</div></div>';
    try {
      const r = await api('/api/admin/pedidos');
      state.pedidos = r.pedidos || [];
    } catch (e) {
      cont.innerHTML = '<div class="panel"><div class="panel-body"><p class="form-error">' + esc(e.message) + '</p></div></div>';
      return;
    }
    pintarPedidos();
  }

  function pintarPedidos() {
    const cont = $('#view-pedidos');
    const lista = state.pedidos.filter((p) => !filtroPedido || p.estado === filtroPedido);
    const cuenta = (estado) => state.pedidos.filter((p) => p.estado === estado).length;
    cont.innerHTML = `
      <div class="page-head">
        <div><h2>Pedidos</h2><p>${state.pedidos.length} pedidos guardados desde la web. El WhatsApp sigue siendo el canal de confirmación.</p></div>
        <div class="page-head-actions"><button class="btn" id="refrescarPedidos">Actualizar</button></div>
      </div>
      <div class="chips">
        <button class="chip ${filtroPedido === '' ? 'activo' : ''}" data-estado-pedido="">Todos (${state.pedidos.length})</button>
        ${ESTADOS_PEDIDO.map((e) => `<button class="chip ${filtroPedido === e.id ? 'activo' : ''}" data-estado-pedido="${e.id}">${e.nombre} (${cuenta(e.id)})</button>`).join('')}
      </div>
      ${lista.length ? `<div class="panel"><div class="table-wrap"><table class="table">
        <thead><tr><th>Pedido</th><th>Cliente</th><th>Entrega</th><th>Total</th><th>Estado</th><th></th></tr></thead>
        <tbody>${lista.map((p) => `
          <tr>
            <td><div class="nombre">${esc(p.id)}</div><div class="sub">${esc(fechaCorta(p.creadoEn))}</div></td>
            <td><div>${esc(p.nombre)}</div><div class="sub">${esc(p.telefono)}</div></td>
            <td class="small">${esc(p.zonaNombre || p.zonaId)}<div class="sub">${esc(p.direccion || '').slice(0, 60)}</div></td>
            <td class="precio">${money(p.total)}<div class="sub">${p.unidades || 0} unid.</div></td>
            <td><span class="badge ${p.estado === 'nuevo' ? 'brand' : p.estado === 'cancelado' ? 'danger' : p.estado === 'entregado' ? 'ok' : 'info'}">${esc(p.estado)}</span></td>
            <td><div class="acciones"><button class="btn btn-sm" data-ver-pedido="${esc(p.id)}">Ver detalle</button></div></td>
          </tr>`).join('')}</tbody>
      </table></div></div>` : `<div class="panel"><div class="empty"><div class="big">🧾</div><h3>Sin pedidos en este estado</h3><p>Los pedidos aparecen aquí cuando un cliente envía su solicitud desde la web.</p></div></div>`}`;

    $$('[data-estado-pedido]', cont).forEach((b) => b.addEventListener('click', () => { filtroPedido = b.dataset.estadoPedido; pintarPedidos(); }));
    $('#refrescarPedidos').addEventListener('click', vistaPedidos);
    $$('[data-ver-pedido]', cont).forEach((b) => b.addEventListener('click', () => verPedido(b.dataset.verPedido)));
  }

  function verPedido(id) {
    const p = state.pedidos.find((x) => String(x.id) === String(id));
    if (!p) return;
    const estados = ESTADOS_PEDIDO.map((e) => `<option value="${e.id}" ${p.estado === e.id ? 'selected' : ''}>${e.nombre}</option>`).join('');
    const grupos = Array.isArray(p.items) ? p.items : [];
    abrirModal({
      titulo: 'Pedido ' + p.id,
      ancho: 'wide',
      cuerpo: `
        <div class="detail-grid">
          <div class="detail-box">
            <h4>Cliente</h4>
            <p><b>${esc(p.nombre)}</b></p>
            <p>${esc(p.telefono)}</p>
            <p class="mt-8">${esc(p.direccion)}</p>
            ${p.referencia ? `<p class="small muted">Referencia: ${esc(p.referencia)}</p>` : ''}
            <p class="small muted">${esc(p.zonaNombre || p.zonaId)} · ${esc(p.cuandoTexto || 'Lo antes posible')}</p>
            ${p.nota ? `<div class="detail-box mt-8"><h4>Nota del cliente</h4><p>${esc(p.nota)}</p></div>` : ''}
          </div>
          <div class="detail-box">
            <h4>Resumen</h4>
            <div class="order-totals">
              <div><span>Productos</span><span>${money(p.subtotal)}</span></div>
              <div><span>Empaquetado</span><span>${money(p.empaquetado)}</span></div>
              <div class="total"><span>Total</span><span>${money(p.total)}</span></div>
            </div>
            <p class="small muted mt-8">Delivery por cotizar. Creado: ${esc(fechaCorta(p.creadoEn))}.</p>
            <label class="field mt-16"><span>Estado del pedido</span><select id="pedidoEstado">${estados}</select></label>
            <button class="btn btn-primary mt-8" id="guardarEstadoPedido">Guardar estado</button>
          </div>
        </div>
        <div class="form-section">
          <h3>Productos</h3>
          <div class="order-items">
            ${grupos.map((g) => `<div class="order-group">
              <div class="order-group-head"><span>${esc(g.nombre)}</span><span>${money(g.subtotal + (g.empaquetadoMonto || 0))}</span></div>
              ${(g.items || []).map((it) => `<div class="order-line"><span>${it.cantidad}× ${esc(it.nombre)}</span><span>${money(it.subtotal)}</span></div>`).join('')}
              ${g.empaquetadoMonto ? `<div class="order-line"><span>Empaquetado</span><span>${money(g.empaquetadoMonto)}</span></div>` : ''}
            </div>`).join('')}
          </div>
        </div>`,
      pie: `<a class="btn" style="margin-right:auto" href="https://wa.me/${esc(soloDigitos(p.telefono).length === 9 ? '51' + soloDigitos(p.telefono) : soloDigitos(p.telefono))}" target="_blank" rel="noopener">Abrir WhatsApp del cliente</a>
        <button class="btn" data-cerrar>Cerrar</button>`
    });
    $('[data-cerrar]').addEventListener('click', cerrarModal);
    $('#guardarEstadoPedido').addEventListener('click', async () => {
      const btn = $('#guardarEstadoPedido');
      try {
        bloquear(btn, true);
        await api('/api/admin/pedidos/' + encodeURIComponent(p.id), { method: 'PUT', body: { estado: $('#pedidoEstado').value } });
        cerrarModal();
        toast('Estado del pedido actualizado.');
        await vistaPedidos();
      } catch (e) { bloquear(btn, false); avisarError(e); }
    });
  }

  /* ============================================================
     SERVICIOS: RECOJO/ENVÍO Y TAXIMOTO
     ============================================================ */
  let filtroServicio = '';

  async function vistaServicios(tipo) {
    const cfg = TIPOS_SERVICIO[tipo];
    mostrarVista(cfg.vista);
    const cont = $('#view-' + cfg.vista);
    cont.innerHTML = '<div class="panel"><div class="panel-body muted">Cargando solicitudes…</div></div>';
    try {
      const r = await api('/api/admin/servicios?tipo=' + encodeURIComponent(tipo));
      state.servicios = (r.servicios || []).filter((s) => !s.tipo || s.tipo === tipo);
    } catch (e) {
      cont.innerHTML = '<div class="panel"><div class="panel-body"><p class="form-error">' + esc(e.message) + '</p></div></div>';
      return;
    }
    filtroServicio = '';
    pintarServicios(tipo);
  }

  function badgeServicio(estado) {
    const clase = estado === 'entregado' ? 'ok' : estado === 'en camino' ? 'info' : 'brand';
    return '<span class="badge ' + clase + '">' + esc(estado) + '</span>';
  }

  function pintarServicios(tipo) {
    const cfg = TIPOS_SERVICIO[tipo];
    const cont = $('#view-' + cfg.vista);
    const todos = state.servicios;
    const lista = todos.filter((s) => !filtroServicio || s.estado === filtroServicio);
    const cuenta = (estado) => todos.filter((s) => s.estado === estado).length;
    const esEnvio = tipo === 'envio';
    const filas = lista.map((s) => `
      <tr>
        <td><div class="nombre">${esc(s.id)}</div><div class="sub">${esc(fechaCorta(s.creadoEn))}</div></td>
        <td class="small"><div><b>De:</b> ${esc(s.origen)}</div><div><b>A:</b> ${esc(s.destino)}</div></td>
        <td>${esEnvio
          ? `<div>${esc(s.nombreEnvia)} <span class="sub">envía</span></div><div class="sub">${esc(s.telefonoEnvia)}</div><div>${esc(s.nombreRecibe)} <span class="sub">recibe</span></div><div class="sub">${esc(s.telefonoRecibe)}</div>`
          : `<div>${esc(s.nombreCliente)}</div><div class="sub">${esc(s.telefono || 'Sin teléfono')}</div>`}</td>
        <td class="small">${esc(s.cuandoTexto || s.cuando || '')}</td>
        <td>${badgeServicio(s.estado)}</td>
        <td><div class="acciones"><button class="btn btn-sm" data-ver-servicio="${esc(s.id)}">Ver detalle</button></div></td>
      </tr>`).join('');
    cont.innerHTML = `
      <div class="page-head">
        <div><h2>${cfg.titulo}</h2><p>${todos.length} solicitudes guardadas. Cambia el estado cuando avances con el servicio.</p></div>
        <div class="page-head-actions"><button class="btn" id="refrescarServicios">Actualizar</button></div>
      </div>
      <div class="chips">
        <button class="chip ${filtroServicio === '' ? 'activo' : ''}" data-estado-servicio="">Todas (${todos.length})</button>
        ${ESTADOS_SERVICIO.map((e) => `<button class="chip ${filtroServicio === e.id ? 'activo' : ''}" data-estado-servicio="${e.id}">${e.nombre} (${cuenta(e.id)})</button>`).join('')}
      </div>
      ${lista.length ? `<div class="panel"><div class="table-wrap"><table class="table">
        <thead><tr><th>Solicitud</th><th>Ruta</th><th>${esEnvio ? 'Personas' : 'Cliente'}</th><th>Cuándo</th><th>Estado</th><th></th></tr></thead>
        <tbody>${filas}</tbody></table></div></div>`
        : `<div class="panel"><div class="empty"><div class="big">${cfg.icono}</div><h3>Sin solicitudes en este estado</h3><p>Las solicitudes aparecen aquí cuando un cliente las envía desde la web.</p></div></div>`}`;

    $$('[data-estado-servicio]', cont).forEach((b) => b.addEventListener('click', () => { filtroServicio = b.dataset.estadoServicio; pintarServicios(tipo); }));
    const refrescar = $('#refrescarServicios');
    if (refrescar) refrescar.addEventListener('click', () => vistaServicios(tipo));
    $$('[data-ver-servicio]', cont).forEach((b) => b.addEventListener('click', () => verServicio(tipo, b.dataset.verServicio)));
  }

  function verServicio(tipo, id) {
    const cfg = TIPOS_SERVICIO[tipo];
    const s = state.servicios.find((x) => String(x.id) === String(id));
    if (!s) return;
    const estados = ESTADOS_SERVICIO.map((e) => `<option value="${e.id}" ${s.estado === e.id ? 'selected' : ''}>${e.nombre}</option>`).join('');
    const esEnvio = tipo === 'envio';
    const contacto = esEnvio
      ? `<div class="detail-box"><h4>Personas</h4>
          <p><b>Envía:</b> ${esc(s.nombreEnvia)}</p><p>${esc(s.telefonoEnvia)}</p>
          <p class="mt-8"><b>Recibe:</b> ${esc(s.nombreRecibe)}</p><p>${esc(s.telefonoRecibe)}</p></div>
        <div class="detail-box"><h4>Producto</h4><p>${esc(s.descripcion)}</p>
          ${s.observaciones ? `<p class="small muted mt-8">Observaciones: ${esc(s.observaciones)}</p>` : ''}</div>`
      : `<div class="detail-box"><h4>Cliente</h4><p><b>${esc(s.nombreCliente)}</b></p><p>${esc(s.telefono || 'No indicó teléfono')}</p>${s.referencia ? `<p class="small muted mt-8">Referencia: ${esc(s.referencia)}</p>` : ''}</div>`;
    abrirModal({
      titulo: (esEnvio ? 'Envío ' : 'Taximoto ') + s.id,
      ancho: 'wide',
      cuerpo: `
        <div class="detail-grid">
          <div class="detail-box"><h4>Ruta</h4>
            <p><b>Origen:</b> ${esc(s.origen)}</p>
            <p class="mt-8"><b>Destino:</b> ${esc(s.destino)}</p>
            <p class="small muted mt-8">${esc(s.cuandoTexto || '')}</p>
            <p class="small muted">Creado: ${esc(fechaCorta(s.creadoEn))}</p>
          </div>
          ${contacto}
        </div>
        <label class="field mt-16"><span>Estado del servicio</span><select id="servicioEstado">${estados}</select></label>
        <button class="btn btn-primary mt-8" id="guardarEstadoServicio">Guardar estado</button>`,
      pie: '<button class="btn" data-cerrar>Cerrar</button>'
    });
    $('[data-cerrar]').addEventListener('click', cerrarModal);
    $('#guardarEstadoServicio').addEventListener('click', async () => {
      const btn = $('#guardarEstadoServicio');
      try {
        bloquear(btn, true);
        await api('/api/admin/servicios/estado', { method: 'POST', body: { tipo: tipo, id: s.id, estado: $('#servicioEstado').value } });
        cerrarModal();
        toast('Estado de la solicitud actualizado.');
        await vistaServicios(tipo);
      } catch (e) { bloquear(btn, false); avisarError(e); }
    });
  }

  /* ============================================================
     USUARIOS
     ============================================================ */
  async function vistaUsuarios() {
    mostrarVista('usuarios');
    const cont = $('#view-usuarios');
    cont.innerHTML = '<div class="panel"><div class="panel-body muted">Cargando usuarios…</div></div>';
    try {
      const r = await api('/api/admin/usuarios');
      state.usuarios = r.usuarios || [];
    } catch (e) {
      cont.innerHTML = '<div class="panel"><div class="panel-body"><p class="form-error">' + esc(e.message) + '</p></div></div>';
      return;
    }
    pintarUsuarios();
  }

  function pintarUsuarios() {
    const cont = $('#view-usuarios');
    const nombreLocal = (carpeta) => {
      const l = state.locales.find((x) => x.carpeta === carpeta);
      return l ? l.nombre : (carpeta || '—');
    };
    cont.innerHTML = `
      <div class="page-head">
        <div><h2>Usuarios del panel</h2><p>Los permisos se validan en el servidor. Los usuarios de local solo ven su establecimiento.</p></div>
        <div class="page-head-actions"><button class="btn btn-primary" id="nuevoUsuarioBtn">+ Nuevo usuario</button></div>
      </div>
      <div class="panel"><div class="table-wrap"><table class="table">
        <thead><tr><th>Usuario</th><th>Nombre</th><th>Rol</th><th>Local</th><th>Activo</th><th>Último acceso</th><th></th></tr></thead>
        <tbody>
          ${state.usuarios.map((u) => `<tr class="${u.activo ? '' : 'row-inactivo'}">
            <td><div class="nombre">${esc(u.usuario)}</div><div class="sub">Creado: ${esc(fechaCorta(u.creadoEn))}</div></td>
            <td>${esc(u.nombre || '—')}</td>
            <td><span class="badge ${u.rol === 'admin' ? 'dark' : 'info'}">${u.rol === 'admin' ? 'Administrador' : 'Local'}</span></td>
            <td class="small">${esc(u.rol === 'admin' ? 'Todos' : nombreLocal(u.localCarpeta))}</td>
            <td><span class="badge ${u.activo ? 'ok' : 'danger'}">${u.activo ? 'Sí' : 'No'}</span></td>
            <td class="small">${esc(fechaCorta(u.ultimoAcceso) || 'Nunca')}</td>
            <td><div class="acciones">
              ${u.rol === 'local' ? `<button class="btn btn-sm" data-ventas-usuario="${esc(u.localCarpeta)}">Ventas</button>` : ''}
              <button class="btn btn-sm" data-editar-usuario="${esc(u.usuario)}">Editar</button>
              <button class="link-btn" style="color:#c62828" data-borrar-usuario="${esc(u.usuario)}">Eliminar</button>
            </div></td>
          </tr>`).join('') || '<tr><td colspan="7"><div class="empty"><div class="big">👤</div><h3>Sin usuarios</h3><p>Crea un acceso para administrar el panel.</p></div></td></tr>'}
        </tbody>
      </table></div></div>
      <p class="small muted mt-16">Recomendación: una cuenta por persona, contraseña de al menos 10 caracteres con letras y números. No compartas claves.</p>`;

    $('#nuevoUsuarioBtn').addEventListener('click', () => modalUsuario(null));
    $$('[data-editar-usuario]', cont).forEach((b) => b.addEventListener('click', () => {
      const u = state.usuarios.find((x) => x.usuario === b.dataset.editarUsuario);
      if (u) modalUsuario(u);
    }));
    $$('[data-borrar-usuario]', cont).forEach((b) => b.addEventListener('click', () => borrarUsuario(b.dataset.borrarUsuario)));
    $$('[data-ventas-usuario]', cont).forEach((b) => b.addEventListener('click', () => {
      state.ventas = state.ventas || { desde: '', hasta: '', local: '', datos: null };
      state.ventas.local = b.dataset.ventasUsuario;
      ir('ventas');
    }));
  }

  function modalUsuario(usuario, preset, onDone) {
    const esNuevo = !usuario;
    const u = usuario || Object.assign({ usuario: '', nombre: '', rol: 'local', localCarpeta: '', activo: true }, preset || {});
    const locales = state.locales;
    abrirModal({
      titulo: esNuevo ? 'Nuevo usuario' : 'Editar usuario',
      ancho: '',
      cuerpo: `
        <div class="form-grid">
          <label class="field"><span>Usuario *</span><input id="ufUsuario" value="${esc(u.usuario)}" ${esNuevo ? '' : 'disabled'} maxlength="40" autocomplete="off"><span class="hint">Minúsculas, sin espacios. Ej: brasa-admin</span></label>
          <label class="field"><span>Nombre visible *</span><input id="ufNombre" value="${esc(u.nombre || '')}" maxlength="80"></label>
          <label class="field"><span>Rol *</span><select id="ufRol">
            <option value="local" ${u.rol === 'local' ? 'selected' : ''}>Encargado de local</option>
            <option value="admin" ${u.rol === 'admin' ? 'selected' : ''}>Administrador</option>
          </select></label>
          <label class="field" id="ufLocalWrap"><span>Local asignado (solo verá ese local)</span><select id="ufLocal">
            <option value="">— Elegir local —</option>
            ${locales.map((l) => `<option value="${esc(l.carpeta)}" ${l.carpeta === u.localCarpeta ? 'selected' : ''}>${esc(l.nombre)} (${esc(l.carpeta)})</option>`).join('')}
          </select></label>
          <label class="field full"><span>${esNuevo ? 'Contraseña *' : 'Nueva contraseña (opcional)'}</span><input id="ufPassword" type="password" autocomplete="new-password" placeholder="${esNuevo ? 'Mínimo 10 caracteres, letras y números' : 'Dejar vacío para conservar la actual'}"><span class="hint">Mínimo 10 caracteres, con letras y números. Se guarda hasheada en el servidor.</span></label>
          ${esNuevo ? '' : `<label class="check"><input id="ufActivo" type="checkbox" ${u.activo ? 'checked' : ''}> Cuenta activa</label>`}
        </div>
        <p class="form-error mt-16" id="ufError" hidden></p>`,
      pie: `<button class="btn" data-cerrar>Cancelar</button><button class="btn btn-primary" id="ufGuardar">${esNuevo ? 'Crear usuario' : 'Guardar cambios'}</button>`
    });
    $('[data-cerrar]').addEventListener('click', cerrarModal);
    function actualizarRol() {
      $('#ufLocalWrap').hidden = $('#ufRol').value !== 'local';
    }
    $('#ufRol').addEventListener('change', actualizarRol);
    actualizarRol();
    $('#ufGuardar').addEventListener('click', async () => {
      const btn = $('#ufGuardar');
      const err = $('#ufError');
      err.hidden = true;
      const datos = {
        usuario: $('#ufUsuario').value.trim().toLowerCase(),
        nombre: $('#ufNombre').value.trim(),
        rol: $('#ufRol').value,
        localCarpeta: $('#ufRol').value === 'local' ? $('#ufLocal').value : '',
        password: $('#ufPassword').value
      };
      if (!datos.usuario || !/^[a-z0-9._-]{3,40}$/.test(datos.usuario)) {
        err.hidden = false; err.textContent = 'Usuario inválido: 3 a 40 caracteres, minúsculas, números, punto, guion o guion bajo.';
        return;
      }
      if (!datos.nombre) { err.hidden = false; err.textContent = 'Escribe el nombre visible.'; return; }
      if (datos.rol === 'local' && !datos.localCarpeta) { err.hidden = false; err.textContent = 'Elige el local asignado.'; return; }
      if ((esNuevo || datos.password) && datos.password.length < 10) { err.hidden = false; err.textContent = 'La contraseña debe tener al menos 10 caracteres.'; return; }
      if ((esNuevo || datos.password) && (!/[A-Za-z]/.test(datos.password) || !/[0-9]/.test(datos.password))) {
        err.hidden = false; err.textContent = 'La contraseña debe combinar letras y números.'; return;
      }
      try {
        bloquear(btn, true);
        if (esNuevo) {
          const cred = await credencialesPara(datos.password);
          await api('/api/admin/usuarios', {
            method: 'POST',
            body: {
              usuario: datos.usuario,
              nombre: datos.nombre,
              rol: datos.rol,
              localCarpeta: datos.localCarpeta,
              clave: cred.clave,
              salt: cred.salt,
              iteraciones: cred.iteraciones
            }
          });
        } else {
          const cuerpo = { nombre: datos.nombre, rol: datos.rol, localCarpeta: datos.localCarpeta };
          if (!$('#ufActivo').checked) cuerpo.activo = false; else cuerpo.activo = true;
          if (datos.password) {
            const cred = await credencialesPara(datos.password);
            cuerpo.clave = cred.clave;
            cuerpo.salt = cred.salt;
            cuerpo.iteraciones = cred.iteraciones;
          }
          await api('/api/admin/usuarios/' + encodeURIComponent(u.usuario), { method: 'PUT', body: cuerpo });
        }
        cerrarModal();
        toast(esNuevo ? 'Usuario creado.' : 'Usuario actualizado.');
        if (typeof onDone === 'function') await onDone(datos.usuario);
        else await vistaUsuarios();
      } catch (e) {
        err.hidden = false; err.textContent = e.message;
        bloquear(btn, false);
      }
    });
  }

  function borrarUsuario(nombreUsuario) {
    if (nombreUsuario === state.sesion.usuario) return toast('No puedes eliminar tu propia cuenta.', 'err');
    abrirModal({
      titulo: 'Eliminar usuario',
      ancho: 'narrow',
      cuerpo: `<p>¿Eliminar el acceso de <b>${esc(nombreUsuario)}</b>?</p><p class="small muted mt-8">Sus sesiones dejarán de ser válidas. Esta acción queda en auditoría.</p>`,
      pie: `<button class="btn" data-cerrar>Cancelar</button><button class="btn btn-danger" id="confBorrarUsuario">Eliminar</button>`
    });
    $('[data-cerrar]').addEventListener('click', cerrarModal);
    $('#confBorrarUsuario').addEventListener('click', async () => {
      const btn = $('#confBorrarUsuario');
      try {
        bloquear(btn, true);
        await api('/api/admin/usuarios/' + encodeURIComponent(nombreUsuario), { method: 'DELETE' });
        cerrarModal();
        toast('Usuario eliminado.');
        await vistaUsuarios();
      } catch (e) { bloquear(btn, false); avisarError(e); }
    });
  }

  /* ============================================================
     AUDITORÍA
     ============================================================ */
  let filtroAuditoria = '';
  async function vistaAuditoria() {
    mostrarVista('auditoria');
    const cont = $('#view-auditoria');
    cont.innerHTML = '<div class="panel"><div class="panel-body muted">Cargando auditoría…</div></div>';
    try {
      const r = await api('/api/admin/auditoria');
      state.auditoria = r.registros || [];
    } catch (e) {
      cont.innerHTML = '<div class="panel"><div class="panel-body"><p class="form-error">' + esc(e.message) + '</p></div></div>';
      return;
    }
    pintarAuditoria();
  }

  function pintarAuditoria() {
    const cont = $('#view-auditoria');
    const q = norm(filtroAuditoria);
    const lista = state.auditoria.filter((r) => !q || norm([r.usuario, r.rol, r.accion, r.detalle, r.fecha].join(' ')).includes(q));
    cont.innerHTML = `
      <div class="page-head"><div><h2>Auditoría</h2><p>Últimas 200 acciones del panel. Solo administradores.</p></div></div>
      <div class="toolbar"><div class="search"><input class="input" id="buscarAuditoria" type="search" placeholder="Filtrar por usuario, acción o detalle" value="${esc(filtroAuditoria)}"></div></div>
      <div class="panel"><div class="table-wrap"><table class="table">
        <thead><tr><th>Fecha</th><th>Usuario</th><th>Rol</th><th>Acción</th><th>Detalle</th><th>IP</th></tr></thead>
        <tbody>${lista.map((r) => `<tr>
          <td class="small nowrap">${esc(fechaCorta(r.fecha))}</td>
          <td class="nombre">${esc(r.usuario)}</td>
          <td><span class="badge ${r.rol === 'admin' ? 'dark' : ''}">${esc(r.rol)}</span></td>
          <td><span class="badge info">${esc(r.accion)}</span></td>
          <td class="small">${esc(r.detalle)}</td>
          <td class="small muted">${esc(r.ip || '—')}</td>
        </tr>`).join('') || '<tr><td colspan="6"><div class="empty"><div class="big">≡</div><h3>Sin registros</h3><p>Las acciones aparecerán aquí.</p></div></td></tr>'}</tbody>
      </table></div></div>`;
    const buscar = $('#buscarAuditoria');
    buscar.addEventListener('input', debounce(() => {
      filtroAuditoria = buscar.value;
      pintarAuditoria();
      const b = $('#buscarAuditoria'); if (b) { b.focus(); b.setSelectionRange(b.value.length, b.value.length); }
    }, 200));
  }

  /* ============================================================
     MI CUENTA
     ============================================================ */
  function vistaCuenta() {
    mostrarVista('cuenta');
    const s = state.sesion;
    const cont = $('#view-cuenta');
    cont.innerHTML = `
      <div class="dash-grid">
        <div class="panel">
          <div class="panel-head"><div><h2>Datos de la cuenta</h2><p>Información de la sesión actual.</p></div></div>
          <div class="panel-body">
            <div class="detail-grid">
              <div class="detail-box"><h4>Usuario</h4><p><b>${esc(s.usuario)}</b></p></div>
              <div class="detail-box"><h4>Nombre</h4><p>${esc(s.nombre || '—')}</p></div>
              <div class="detail-box"><h4>Rol</h4><p>${s.rol === 'admin' ? 'Administrador' : 'Encargado de local'}</p></div>
              <div class="detail-box"><h4>Local</h4><p>${esc(s.rol === 'admin' ? 'Todos los locales' : (nombreLocal(s.localCarpeta) || 'Sin asignar'))}</p></div>
            </div>
            <p class="small muted mt-16">La sesión se valida en el servidor con cookie HttpOnly, SameSite=Strict y token CSRF. La contraseña nunca se envía al navegador.</p>
          </div>
        </div>
        <div class="panel">
          <div class="panel-head"><div><h2>Cambiar contraseña</h2><p>Mínimo 10 caracteres, con letras y números.</p></div></div>
          <div class="panel-body">
            <form id="formPassword">
              <label class="field"><span>Contraseña actual *</span><input id="passActual" type="password" autocomplete="current-password"></label>
              <label class="field mt-8"><span>Nueva contraseña *</span><input id="passNueva" type="password" autocomplete="new-password"></label>
              <label class="field mt-8"><span>Repetir nueva contraseña *</span><input id="passRepetir" type="password" autocomplete="new-password"></label>
              <p class="form-error mt-16" id="passError" hidden></p>
              <button class="btn btn-primary mt-16" type="submit" id="passBtn">Actualizar contraseña</button>
            </form>
          </div>
        </div>
      </div>`;
    $('#formPassword').addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = $('#passError');
      const btn = $('#passBtn');
      err.hidden = true;
      const actual = $('#passActual').value;
      const nueva = $('#passNueva').value;
      if (!actual) { err.hidden = false; err.textContent = 'Escribe tu contraseña actual.'; return; }
      if (nueva.length < 10) { err.hidden = false; err.textContent = 'La nueva contraseña debe tener al menos 10 caracteres.'; return; }
      if (!/[A-Za-z]/.test(nueva) || !/[0-9]/.test(nueva)) { err.hidden = false; err.textContent = 'La nueva contraseña debe combinar letras y números.'; return; }
      if (nueva !== $('#passRepetir').value) { err.hidden = false; err.textContent = 'Las contraseñas nuevas no coinciden.'; return; }
      try {
        bloquear(btn, true);
        const sal = await salDeUsuario(state.sesion.usuario);
        const actualDerivada = await derivarClave(actual, sal.salt, sal.iteraciones);
        const nuevaCred = await credencialesPara(nueva);
        await api('/api/auth/password', {
          method: 'POST',
          body: {
            actual: actualDerivada,
            nueva: nuevaCred.clave,
            salt: nuevaCred.salt,
            iteraciones: nuevaCred.iteraciones
          }
        });
        $('#formPassword').reset();
        toast('Contraseña actualizada.');
      } catch (ex) {
        err.hidden = false; err.textContent = ex.message;
      } finally { bloquear(btn, false); }
    });
  }

})();
