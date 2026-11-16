/* ============================================================
   EnRuta Delivery - Router de la API (Cloudflare Pages Functions)
   Réplica del contrato de server/lib/api.ps1 adaptada a D1/KV.
   ============================================================ */

import {
  HttpError,
  convertirAId,
  fechaHora,
  idAleatorio,
  ipCliente,
  json,
  leerJson,
  lanzar
} from '../_lib/comun.js';
import {
  actualizarPasswordUsuario,
  buscarUsuario,
  cerrarSesionResponse,
  crearRegistroUsuario,
  crearSesion,
  exigirAdmin,
  exigirLocalAsignado,
  guardarUsuarios,
  huellaClave,
  leerSesion,
  leerUsuarios,
  listarUsuariosSeguro,
  obtenerSal,
  requerirSesion,
  validarCsrf,
  verificarCredenciales
} from '../_lib/auth.js';
import { leerAuditoria, registrarAuditoria } from '../_lib/almacen.js';
import { construirCatalogo } from '../_lib/catalogo.js';
import {
  buscarCarpetaPorLocalId,
  cambiarEstadoPedido,
  cambiarEstadoServicio,
  duplicarLocal,
  eliminarLocal,
  eliminarProductosLocal,
  guardarCatalogo,
  guardarCategoriasLocales,
  guardarConfigPublica,
  guardarImagenBase64,
  guardarImportacion,
  guardarLocalCompleto,
  guardarPedidoPublico,
  guardarServicioPublico,
  listarImportacionesSeguro,
  normalizarProductoLocal,
  nuevoLocal,
  obtenerCatalogo,
  obtenerCategoriasLocales,
  obtenerConfigPublica,
  obtenerEstadisticasVentas,
  obtenerImportacion,
  obtenerLocalPorCarpeta,
  obtenerLocalesAdmin,
  obtenerPedidosAdmin,
  obtenerResumenAdmin,
  obtenerServiciosAdmin,
  procesarImportacionProductos
} from '../_lib/negocio.js';

/* ---------------- Utilidades ---------------- */

function establecerCampo(objeto, nombre, valor) {
  if (!objeto || typeof objeto !== 'object') return;
  objeto[nombre] = valor;
}

function leerCuerpo(cuerpo) {
  return cuerpo && typeof cuerpo === 'object' ? cuerpo : {};
}

function query(request, nombre, predeterminado = '') {
  const valor = new URL(request.url).searchParams.get(nombre);
  return valor === null ? predeterminado : valor;
}

function rutaNormalizada(request) {
  let ruta = decodeURIComponent(new URL(request.url).pathname);
  if (ruta.length > 1) ruta = ruta.replace(/\/+$/, '');
  return ruta;
}

function segmentos(ruta) {
  return ruta.split('/').filter(Boolean);
}

function coincidir(segmentosRuta, patron) {
  if (segmentosRuta.length !== patron.length) return null;
  const parametros = {};
  for (let i = 0; i < patron.length; i++) {
    const esperado = patron[i];
    if (esperado.startsWith(':')) {
      if (!segmentosRuta[i]) return null;
      parametros[esperado.slice(1)] = segmentosRuta[i];
    } else if (esperado !== segmentosRuta[i]) {
      return null;
    }
  }
  return parametros;
}

/* ---------------- Rutas públicas ---------------- */

async function apiEstado() {
  return json({
    ok: true,
    servicio: 'EnRuta Delivery',
    version: '2.0',
    hora: fechaHora(),
    motor: 'Cloudflare Pages',
    ocr: 'navegador'
  });
}

async function apiCatalogo(env) {
  const catalogo = await construirCatalogo(env);
  return json(catalogo, 200, { 'Cache-Control': 'public, max-age=30, s-maxage=60' });
}

/* ---------------- Autenticación ---------------- */

async function apiSal(env, request) {
  const cuerpo = leerCuerpo(await leerJson(request, 65536));
  const usuario = String(cuerpo.usuario || '').trim();
  if (!usuario) lanzar(400, 'Falta el usuario.');
  const datos = await obtenerSal(env, usuario);
  return json({ ok: true, salt: datos.salt, iteraciones: datos.iteraciones });
}

async function apiLogin(env, request) {
  const cuerpo = leerCuerpo(await leerJson(request, 65536));
  const usuario = String(cuerpo.usuario || '').trim();
  const clave = String(cuerpo.clave || '');
  if (!usuario || !clave) lanzar(400, 'Faltan credenciales.');

  const ip = ipCliente(request);
  const encontrado = await verificarCredenciales(env, usuario, clave);
  if (!encontrado) {
    await registrarAuditoria(env, {
      usuario,
      rol: 'desconocido',
      accion: 'auth.login-fallido',
      detalle: 'Usuario o clave incorrectos',
      ip
    });
    lanzar(401, 'Usuario o contrasena incorrectos.');
  }
  const sesion = await crearSesion(env, request, encontrado);
  await registrarAuditoria(env, {
    usuario: sesion.sesion.usuario,
    rol: sesion.sesion.rol,
    accion: 'auth.login',
    detalle: 'Inicio de sesion correcto',
    ip
  });
  return json({ ok: true, sesion: sesion.sesion }, 200, { 'Set-Cookie': sesion.cookie });
}

async function apiLogout(env, request) {
  const sesion = await leerSesion(env, request);
  if (sesion) {
    validarCsrf(request, sesion);
    await registrarAuditoria(env, {
      usuario: sesion.usuario,
      rol: sesion.rol,
      accion: 'auth.logout',
      detalle: 'Cierre de sesion',
      ip: ipCliente(request)
    });
  }
  const cabeceras = await cerrarSesionResponse(request);
  return json({ ok: true }, 200, cabeceras);
}

async function apiSesion(env, request) {
  const sesion = await leerSesion(env, request);
  if (!sesion) return json({ autenticado: false });
  return json({
    autenticado: true,
    usuario: sesion.usuario,
    nombre: sesion.nombre,
    rol: sesion.rol,
    localCarpeta: sesion.localCarpeta,
    csrf: sesion.csrf,
    expiraEn: sesion.expiraEn
  });
}

async function apiPassword(env, request) {
  const sesion = await requerirSesion(env, request);
  validarCsrf(request, sesion);
  const cuerpo = leerCuerpo(await leerJson(request, 65536));
  const actual = String(cuerpo.actual || '');
  if (!actual) lanzar(400, 'Falta la clave actual.');

  const ip = ipCliente(request);
  const verificado = await verificarCredenciales(env, sesion.usuario, actual);
  if (!verificado) lanzar(401, 'La contrasena actual no es correcta.');

  await actualizarPasswordUsuario(env, sesion.usuario, {
    clave: String(cuerpo.nueva || ''),
    salt: String(cuerpo.salt || ''),
    iteraciones: cuerpo.iteraciones
  });
  await registrarAuditoria(env, {
    usuario: sesion.usuario,
    rol: sesion.rol,
    accion: 'auth.password',
    detalle: 'Contrasena actualizada',
    ip
  });
  return json({ ok: true });
}

/* ---------------- Administración ---------------- */

async function manejarAdmin(env, request, ruta, seg, sesion) {
  const ip = ipCliente(request);
  const metodo = request.method.toUpperCase();

  if (ruta === '/api/admin/estado-sistema' && metodo === 'GET') {
    return json({
      ocr: true,
      ocrMensaje: 'El OCR se ejecuta en tu navegador (fase 2).',
      iaConfigurada: false,
      iaMensaje: 'No hay proveedor ni credenciales configuradas.',
      version: '2.0'
    });
  }

  if (ruta === '/api/admin/resumen' && metodo === 'GET') {
    return json(await obtenerResumenAdmin(env, sesion));
  }

  if (ruta === '/api/admin/estadisticas' && metodo === 'GET') {
    return json(
      await obtenerEstadisticasVentas(
        env,
        sesion,
        query(request, 'desde'),
        query(request, 'hasta'),
        query(request, 'local')
      )
    );
  }

  if (ruta === '/api/admin/config') {
    exigirAdmin(sesion);
    if (metodo === 'GET') {
      return json({ config: await obtenerConfigPublica(env) });
    }
    if (metodo === 'PUT') {
      const cuerpo = leerCuerpo(await leerJson(request, 262144));
      const config = cuerpo.config !== undefined && cuerpo.config !== null ? cuerpo.config : cuerpo;
      return json(await guardarConfigPublica(env, config, sesion.usuario, sesion.rol, ip));
    }
  }

  if (ruta === '/api/admin/auditoria' && metodo === 'GET') {
    exigirAdmin(sesion);
    return json({ registros: await leerAuditoria(env, 200) });
  }

  /* ----- Locales ----- */

  if (ruta === '/api/admin/locales' && metodo === 'GET') {
    let lista = await obtenerLocalesAdmin(env, query(request, 'q'));
    if (sesion.rol === 'local') {
      lista = lista.filter((l) => l.carpeta === String(sesion.localCarpeta));
    }
    return json({ locales: lista });
  }

  if (ruta === '/api/admin/locales' && metodo === 'POST') {
    exigirAdmin(sesion);
    const cuerpo = leerCuerpo(await leerJson(request));
    return json(await nuevoLocal(env, cuerpo, sesion.usuario, sesion.rol, ip), 201);
  }

  if (seg.length === 5 && seg[0] === 'api' && seg[1] === 'admin' && seg[2] === 'locales') {
    const carpeta = seg[3];
    const accion = seg[4];
    exigirLocalAsignado(sesion, carpeta);

    if (accion === 'duplicar' && metodo === 'POST') {
      exigirAdmin(sesion);
      return json(await duplicarLocal(env, carpeta, sesion.usuario, sesion.rol, ip));
    }

    if (accion === 'productos') {
      const item = await obtenerLocalPorCarpeta(env, carpeta);
      if (!item) lanzar(404, 'Local no encontrado.');

      if (metodo === 'PUT') {
        const cuerpo = leerCuerpo(await leerJson(request));
        const lista = Array.isArray(cuerpo.productos) ? cuerpo.productos : [];
        const ids = new Set();
        const normalizados = [];
        for (const p of lista) {
          if (!p) continue;
          normalizados.push(normalizarProductoLocal(p, String(item.local.id), ids));
        }
        return json(
          await guardarLocalCompleto(env, carpeta, item.local, normalizados, sesion.usuario, sesion.rol, ip)
        );
      }

      if (metodo === 'POST') {
        const cuerpo = leerCuerpo(await leerJson(request));
        const p = cuerpo.producto !== undefined && cuerpo.producto !== null ? cuerpo.producto : cuerpo;
        const ids = new Set(item.productos.map((x) => String(x.id)));
        const nuevo = normalizarProductoLocal(p, String(item.local.id), ids);
        const lista = [...item.productos, nuevo];
        return json(
          await guardarLocalCompleto(env, carpeta, item.local, lista, sesion.usuario, sesion.rol, ip),
          201
        );
      }
    }

    if (accion === 'eliminar' && metodo === 'POST') {
      const cuerpo = leerCuerpo(await leerJson(request));
      return json(
        await eliminarProductosLocal(env, carpeta, Array.isArray(cuerpo.ids) ? cuerpo.ids : [], sesion.usuario, sesion.rol, ip)
      );
    }
  }

  // /api/admin/locales/:carpeta/productos/:productoId
  if (
    seg.length === 6 &&
    seg[0] === 'api' && seg[1] === 'admin' && seg[2] === 'locales' &&
    seg[4] === 'productos'
  ) {
    const carpeta = seg[3];
    const productoId = String(seg[5]);
    exigirLocalAsignado(sesion, carpeta);
    const item = await obtenerLocalPorCarpeta(env, carpeta);
    if (!item) lanzar(404, 'Local no encontrado.');
    const indice = item.productos.findIndex((p) => String(p.id) === productoId);
    if (indice < 0) lanzar(404, 'Producto no encontrado.');

    if (metodo === 'PUT') {
      const cuerpo = leerCuerpo(await leerJson(request));
      const p = cuerpo.producto !== undefined && cuerpo.producto !== null ? cuerpo.producto : cuerpo;
      const ids = new Set(
        item.productos.filter((x) => String(x.id) !== productoId).map((x) => String(x.id))
      );
      const actualizado = normalizarProductoLocal(p, String(item.local.id), ids);
      actualizado.id = productoId;
      const lista = [...item.productos];
      lista[indice] = actualizado;
      return json(
        await guardarLocalCompleto(env, carpeta, item.local, lista, sesion.usuario, sesion.rol, ip)
      );
    }

    if (metodo === 'DELETE') {
      const lista = item.productos.filter((x) => String(x.id) !== productoId);
      const res = await guardarLocalCompleto(env, carpeta, item.local, lista, sesion.usuario, sesion.rol, ip);
      await registrarAuditoria(env, {
        usuario: sesion.usuario,
        rol: sesion.rol,
        accion: 'producto.eliminar',
        detalle: `Local ${carpeta} producto ${productoId}`,
        ip
      });
      return json(res);
    }
  }

  // /api/admin/locales/:carpeta
  if (seg.length === 4 && seg[0] === 'api' && seg[1] === 'admin' && seg[2] === 'locales') {
    const carpeta = seg[3];
    exigirLocalAsignado(sesion, carpeta);

    if (metodo === 'GET') {
      const item = await obtenerLocalPorCarpeta(env, carpeta);
      if (!item) lanzar(404, 'Local no encontrado.');
      return json({ carpeta, local: item.local, productos: item.productos });
    }

    if (metodo === 'PUT') {
      const cuerpo = leerCuerpo(await leerJson(request));
      const existente = await obtenerLocalPorCarpeta(env, carpeta);
      if (!existente) lanzar(404, 'Local no encontrado.');
      const local = cuerpo.local !== undefined && cuerpo.local !== null ? cuerpo.local : cuerpo;
      if (sesion.rol !== 'admin') {
        establecerCampo(local, 'publicado', existente.local.publicado);
        establecerCampo(local, 'id', existente.local.id);
        establecerCampo(local, 'esEjemplo', existente.local.esEjemplo);
      }
      const productos = Array.isArray(cuerpo.productos) ? cuerpo.productos : existente.productos;
      return json(
        await guardarLocalCompleto(env, carpeta, local, productos, sesion.usuario, sesion.rol, ip)
      );
    }

    if (metodo === 'DELETE') {
      exigirAdmin(sesion);
      return json(await eliminarLocal(env, carpeta, sesion.usuario, sesion.rol, ip));
    }
  }

  /* ----- Categorías de locales ----- */

  if (ruta === '/api/admin/categorias-locales') {
    if (metodo === 'GET') return json(await obtenerCategoriasLocales(env));
    if (metodo === 'PUT') {
      exigirAdmin(sesion);
      const cuerpo = leerCuerpo(await leerJson(request));
      return json(
        await guardarCategoriasLocales(
          env,
          Array.isArray(cuerpo.categorias) ? cuerpo.categorias : [],
          sesion.usuario,
          sesion.rol,
          ip
        )
      );
    }
  }

  /* ----- Catálogos globales ----- */

  if (seg.length === 4 && seg[0] === 'api' && seg[1] === 'admin' && seg[2] === 'catalogos') {
    exigirAdmin(sesion);
    const catalogoId = seg[3];
    if (metodo === 'GET') return json(await obtenerCatalogo(env, catalogoId));
    if (metodo === 'PUT') {
      const cuerpo = leerCuerpo(await leerJson(request));
      return json(
        await guardarCatalogo(
          env,
          catalogoId,
          Array.isArray(cuerpo.categorias) ? cuerpo.categorias : [],
          Array.isArray(cuerpo.productos) ? cuerpo.productos : [],
          sesion.usuario,
          sesion.rol,
          ip
        )
      );
    }
  }

  /* ----- Imágenes ----- */

  if (ruta === '/api/admin/imagenes' && metodo === 'POST') {
    const cuerpo = leerCuerpo(await leerJson(request, 14000000));
    const tipo = String(cuerpo.tipoDestino || '');
    const carpeta = String(cuerpo.carpeta || '');
    if (tipo === 'local') {
      exigirLocalAsignado(sesion, carpeta);
    } else if (tipo === 'catalogo') {
      exigirAdmin(sesion);
      if (!['licores', 'primera-necesidad'].includes(carpeta)) lanzar(400, 'Catalogo invalido.');
    } else {
      lanzar(400, 'Destino de imagen invalido.');
    }
    const res = await guardarImagenBase64(env, {
      tipo,
      carpeta,
      nombre: String(cuerpo.nombre || ''),
      base64: String(cuerpo.datosBase64 || ''),
      prefijo: String(cuerpo.prefijo || 'img')
    });
    await registrarAuditoria(env, {
      usuario: sesion.usuario,
      rol: sesion.rol,
      accion: 'imagen.subir',
      detalle: `${tipo}/${carpeta} -> ${res.ruta}`,
      ip
    });
    return json(res, 201);
  }

  /* ----- OCR ----- */

  if (ruta === '/api/admin/ocr/procesar' && metodo === 'POST') {
    lanzar(
      501,
      'El OCR se ejecuta en el navegador. Esta version del servidor no procesa archivos directamente.'
    );
  }

  if (ruta === '/api/admin/ocr/guardar' && metodo === 'POST') {
    const cuerpo = leerCuerpo(await leerJson(request, 26214400));
    const carpeta = String(cuerpo.localCarpeta || '');
    exigirLocalAsignado(sesion, carpeta);
    const item = await obtenerLocalPorCarpeta(env, carpeta);
    if (!item) lanzar(404, 'Local no encontrado.');

    const modo = String(cuerpo.modo) === 'publicar' ? 'publicar' : 'borrador';
    const idEntrante = String(cuerpo.importacionId || '');
    let importacion = null;
    if (idEntrante) {
      try {
        importacion = await obtenerImportacion(env, idEntrante, sesion);
      } catch {
        importacion = null;
      }
    }
    if (!importacion) {
      const sello = fechaHora().replace(/[-: ]/g, '').slice(0, 15);
      const id = 'imp-' + sello + '-' + idAleatorio(3).toLowerCase();
      importacion = {
        id,
        localCarpeta: carpeta,
        localId: String(item.local.id),
        localNombre: String(item.local.nombre),
        creadoEn: fechaHora(),
        creadoPor: sesion.usuario,
        estado: 'borrador',
        archivos: [],
        texto: '',
        productos: []
      };
    }
    if (Array.isArray(cuerpo.archivos)) {
      importacion.archivos = cuerpo.archivos.map((a) => ({
        nombre: String((a && a.nombre) || ''),
        paginas: Number((a && a.paginas) || 0) || 1
      }));
    }
    if (cuerpo.texto) importacion.texto = String(cuerpo.texto);

    const productos = Array.isArray(cuerpo.productos) ? cuerpo.productos : [];
    return json(
      await procesarImportacionProductos(env, carpeta, importacion, productos, modo, sesion, ip)
    );
  }

  if (ruta === '/api/admin/importaciones' && metodo === 'GET') {
    return json({ importaciones: await listarImportacionesSeguro(env, sesion, 60) });
  }

  if (seg.length === 5 && seg[0] === 'api' && seg[1] === 'admin' && seg[2] === 'importaciones' && seg[4] === 'publicar' && metodo === 'POST') {
    const imp = await obtenerImportacion(env, seg[3], sesion);
    const cuerpo = leerCuerpo(await leerJson(request, 26214400));
    const productos =
      Array.isArray(cuerpo.productos) && cuerpo.productos.length ? cuerpo.productos : imp.productos || [];
    const modo = String(cuerpo.modo) === 'borrador' ? 'borrador' : 'publicar';
    return json(
      await procesarImportacionProductos(env, String(imp.localCarpeta), imp, productos, modo, sesion, ip)
    );
  }

  if (seg.length === 4 && seg[0] === 'api' && seg[1] === 'admin' && seg[2] === 'importaciones' && metodo === 'GET') {
    return json(await obtenerImportacion(env, seg[3], sesion));
  }

  /* ----- Pedidos ----- */

  if (ruta === '/api/admin/pedidos' && metodo === 'GET') {
    return json({ pedidos: await obtenerPedidosAdmin(env, sesion, query(request, 'estado'), 200) });
  }

  if (seg.length === 4 && seg[0] === 'api' && seg[1] === 'admin' && seg[2] === 'pedidos' && metodo === 'PUT') {
    const cuerpo = leerCuerpo(await leerJson(request, 65536));
    return json(await cambiarEstadoPedido(env, seg[3], String(cuerpo.estado || ''), sesion, ip));
  }

  /* ----- Servicios ----- */

  if (ruta === '/api/admin/servicios' && metodo === 'GET') {
    return json({ servicios: await obtenerServiciosAdmin(env, query(request, 'tipo'), 300) });
  }

  if (ruta === '/api/admin/servicios/estado' && (metodo === 'POST' || metodo === 'PUT')) {
    const cuerpo = leerCuerpo(await leerJson(request, 65536));
    return json(
      await cambiarEstadoServicio(
        env,
        String(cuerpo.tipo || ''),
        String(cuerpo.id || ''),
        String(cuerpo.estado || ''),
        sesion,
        ip
      )
    );
  }

  /* ----- Usuarios ----- */

  if (ruta === '/api/admin/usuarios' && metodo === 'GET') {
    exigirAdmin(sesion);
    return json({ usuarios: listarUsuariosSeguro(await leerUsuarios(env)) });
  }

  if (ruta === '/api/admin/usuarios' && metodo === 'POST') {
    exigirAdmin(sesion);
    const cuerpo = leerCuerpo(await leerJson(request, 65536));
    if (String(cuerpo.rol) === 'local') {
      const item = await obtenerLocalPorCarpeta(env, String(cuerpo.localCarpeta || ''));
      if (!item) lanzar(400, 'El local asignado no existe.');
    }
    const u = await crearRegistroUsuario(env, {
      usuario: cuerpo.usuario,
      nombre: cuerpo.nombre,
      rol: cuerpo.rol,
      localCarpeta: cuerpo.localCarpeta,
      clave: cuerpo.clave,
      salt: cuerpo.salt,
      iteraciones: cuerpo.iteraciones
    });
    await registrarAuditoria(env, {
      usuario: sesion.usuario,
      rol: sesion.rol,
      accion: 'usuario.crear',
      detalle: `Usuario ${u.usuario} rol ${u.rol}`,
      ip
    });
    return json({ ok: true, usuario: u.usuario }, 201);
  }

  if (seg.length === 4 && seg[0] === 'api' && seg[1] === 'admin' && seg[2] === 'usuarios') {
    exigirAdmin(sesion);
    const objetivo = seg[3];
    const doc = await leerUsuarios(env);
    const encontrado = buscarUsuario(doc, objetivo);
    if (!encontrado) lanzar(404, 'Usuario no encontrado.');

    if (metodo === 'PUT') {
      const cuerpo = leerCuerpo(await leerJson(request, 65536));
      if (cuerpo.nombre !== undefined && cuerpo.nombre !== null) {
        encontrado.nombre = String(cuerpo.nombre).trim();
      }
      if (cuerpo.activo !== undefined && cuerpo.activo !== null) {
        if (objetivo === sesion.usuario && cuerpo.activo === false) {
          lanzar(400, 'No puedes desactivar tu propia cuenta.');
        }
        encontrado.activo = cuerpo.activo === true;
      }
      if (cuerpo.rol !== undefined && cuerpo.rol !== null && ['admin', 'local'].includes(String(cuerpo.rol))) {
        if (objetivo === sesion.usuario && String(cuerpo.rol) !== 'admin') {
          lanzar(400, 'No puedes quitarte el rol de administrador.');
        }
        encontrado.rol = String(cuerpo.rol);
      }
      if (cuerpo.localCarpeta !== undefined && cuerpo.localCarpeta !== null) {
        if (String(encontrado.rol) === 'local') {
          const item = await obtenerLocalPorCarpeta(env, String(cuerpo.localCarpeta));
          if (!item) lanzar(400, 'El local asignado no existe.');
          encontrado.localCarpeta = String(cuerpo.localCarpeta);
        }
      }
      if (cuerpo.clave) {
        const iteraciones = Number(cuerpo.iteraciones) || 120000;
        entregarPoliticaCliente(iteraciones);
        encontrado.passwordSalt = String(cuerpo.salt || '');
        encontrado.iteraciones = iteraciones;
        // La huella se calcula con el secreto del proyecto.
        encontrado.claveHash = await huellaClave(env, String(cuerpo.clave));
        encontrado.intentos = 0;
        encontrado.bloqueadoHasta = null;
      }
      await guardarUsuarios(env, doc);
      await registrarAuditoria(env, {
        usuario: sesion.usuario,
        rol: sesion.rol,
        accion: 'usuario.editar',
        detalle: `Usuario ${objetivo}`,
        ip
      });
      return json({ ok: true });
    }

    if (metodo === 'DELETE') {
      if (objetivo === sesion.usuario) lanzar(400, 'No puedes eliminar tu propia cuenta.');
      doc.usuarios = (doc.usuarios || []).filter((u) => String(u.usuario) !== objetivo);
      await guardarUsuarios(env, doc);
      await registrarAuditoria(env, {
        usuario: sesion.usuario,
        rol: sesion.rol,
        accion: 'usuario.eliminar',
        detalle: `Usuario ${objetivo}`,
        ip
      });
      return json({ ok: true });
    }
  }

  lanzar(404, 'Ruta de administracion no encontrada.');
}

/** Validación mínima de la clave derivada ya calculada en el navegador. */
function entregarPoliticaCliente(iteraciones) {
  if (iteraciones < 10000 || iteraciones > 500000) {
    lanzar(400, 'El numero de iteraciones no es valido.');
  }
}

/* ---------------- Router principal ---------------- */

export async function onRequest(context) {
  const { request, env } = context;
  const metodo = request.method.toUpperCase();
  const ruta = rutaNormalizada(request);
  const seg = segmentos(ruta);

  try {
    if (metodo === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Allow': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, X-CSRF-Token'
        }
      });
    }

    /* Público */
    if (ruta === '/api/estado' && metodo === 'GET') return await apiEstado();
    if (ruta === '/api/catalogo' && metodo === 'GET') return await apiCatalogo(env);

    if (ruta === '/api/pedidos' && metodo === 'POST') {
      const cuerpo = await leerJson(request, 1048576);
      if (!cuerpo) lanzar(400, 'Pedido vacio.');
      return json(await guardarPedidoPublico(env, request, cuerpo), 201);
    }

    if (ruta === '/api/envios' && metodo === 'POST') {
      const cuerpo = await leerJson(request, 65536);
      if (!cuerpo) lanzar(400, 'Solicitud vacia.');
      return json(await guardarServicioPublico(env, request, 'envio', cuerpo), 201);
    }

    if (ruta === '/api/taximotos' && metodo === 'POST') {
      const cuerpo = await leerJson(request, 65536);
      if (!cuerpo) lanzar(400, 'Solicitud vacia.');
      return json(await guardarServicioPublico(env, request, 'taximoto', cuerpo), 201);
    }

    /* Autenticación */
    if (ruta === '/api/auth/sal' && metodo === 'POST') return await apiSal(env, request);
    if (ruta === '/api/auth/login' && metodo === 'POST') return await apiLogin(env, request);
    if (ruta === '/api/auth/logout' && metodo === 'POST') return await apiLogout(env, request);
    if (ruta === '/api/auth/sesion' && metodo === 'GET') return await apiSesion(env, request);
    if (ruta === '/api/auth/password' && metodo === 'POST') return await apiPassword(env, request);

    /* Administración */
    if (ruta.startsWith('/api/admin/')) {
      const sesion = await requerirSesion(env, request);
      validarCsrf(request, sesion);
      return await manejarAdmin(env, request, ruta, seg, sesion);
    }

    lanzar(404, 'Ruta no encontrada.');
  } catch (error) {
    if (error instanceof HttpError) {
      return json({ error: error.message }, error.estado);
    }
    if (error && error.estado && Number.isInteger(error.estado)) {
      return json({ error: error.message || 'Error inesperado.' }, error.estado);
    }
    console.error('Error no controlado en la API:', error && error.stack ? error.stack : error);
    return json({ error: 'Ocurrio un error en el servidor. Intenta nuevamente.' }, 500);
  }
}
