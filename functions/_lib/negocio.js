/* ============================================================
   EnRuta Delivery - Reglas de negocio sobre D1
   Locales, productos, catálogos, pedidos, servicios, imágenes,
   estadísticas e importaciones.
   ============================================================ */

import {
  borrarDoc,
  guardarDoc,
  leerDoc,
  listarImportaciones,
  registrarAuditoria
} from './almacen.js';
import { huellaClave, validarFormatoClave, buscarUsuario } from './auth.js';
import {
  convertirAId,
  convertirNumero,
  esTexto,
  fechaCorta,
  fechaHora,
  idAleatorio,
  lanzar,
  normalizarTexto,
  redondear2
} from './comun.js';

const RE_CARPETA = /^local-[0-9]{3,4}$/;
const CATALOGOS = ['licores', 'primera-necesidad'];

export function carpetaValida(carpeta) {
  return RE_CARPETA.test(String(carpeta || ''));
}

function plano(valor) {
  return valor === null || valor === undefined ? valor : JSON.parse(JSON.stringify(valor));
}

/* ============================================================
   Locales
   ============================================================ */

export async function leerIndiceLocales(env) {
  const doc = await leerDoc(env, 'indiceLocales', []);
  if (Array.isArray(doc)) return doc;
  if (doc && Array.isArray(doc.locales)) return doc.locales;
  return [];
}

export async function guardarIndiceLocales(env, carpetas) {
  await guardarDoc(env, 'indiceLocales', carpetas);
}

export async function obtenerLocalPorCarpeta(env, carpeta) {
  if (!carpetaValida(carpeta)) return null;
  const [local, productos] = await Promise.all([
    leerDoc(env, 'local:' + carpeta, null),
    leerDoc(env, 'local:' + carpeta + ':productos', null)
  ]);
  if (!local || !Array.isArray(productos)) return null;
  return { carpeta, local, productos };
}

export async function buscarCarpetaPorLocalId(env, localId) {
  const indice = await leerIndiceLocales(env);
  for (const carpeta of indice) {
    const item = await obtenerLocalPorCarpeta(env, carpeta);
    if (item && String(item.local.id) === String(localId)) return item;
  }
  return null;
}

export async function obtenerLocalesAdmin(env, busqueda = '') {
  const indice = await leerIndiceLocales(env);
  const q = normalizarTexto(busqueda);
  const salida = [];
  for (const carpeta of indice) {
    const item = await obtenerLocalPorCarpeta(env, carpeta);
    if (!item) continue;
    const productos = item.productos;
    const publicados = productos.filter((p) => p && p.publicado !== false).length;
    const pendientes = productos.filter((p) => p && (p.revisar === true || p.publicado === false)).length;
    const local = item.local;
    if (q) {
      const texto = normalizarTexto(
        [local.nombre, local.descripcion, local.id, local.categoriaId, local.direccion, local.telefono].join(' ')
      );
      if (!texto.includes(q)) continue;
    }
    salida.push({
      carpeta,
      id: String(local.id || ''),
      nombre: String(local.nombre || ''),
      tipo: String(local.tipo || ''),
      categoriaId: String(local.categoriaId || ''),
      descripcion: String(local.descripcion || ''),
      publicado: local.publicado === true,
      disponible: local.disponible !== false,
      cerradoTemporal: local.cerradoTemporal === true,
      esEjemplo: local.esEjemplo === true,
      emoji: String(local.emoji || ''),
      logo: local.logo || null,
      portada: local.portada || null,
      direccion: String(local.direccion || ''),
      telefono: String(local.telefono || ''),
      horarioLocal: String(local.horarioLocal || ''),
      totalProductos: productos.length,
      publicados,
      pendientes
    });
  }
  return salida;
}

export async function obtenerCategoriasLocales(env) {
  const doc = await leerDoc(env, 'categoriasLocales', []);
  if (Array.isArray(doc)) return doc;
  if (doc && Array.isArray(doc.categorias)) return doc.categorias;
  return [];
}

function validarLocal(categorias, local) {
  const errores = [];
  if (!esTexto(String(local.nombre || ''))) errores.push('El nombre del local es obligatorio.');
  if (!esTexto(String(local.id || ''))) errores.push('El identificador (slug) es obligatorio.');
  else if (!/^[a-z0-9][a-z0-9-]{1,48}$/.test(String(local.id))) {
    errores.push('El slug solo admite minusculas, numeros y guiones (2 a 49 caracteres).');
  }
  if (!esTexto(String(local.categoriaId || ''))) errores.push('Elige una categoria para el local.');
  else if (!categorias.some((c) => c.id === local.categoriaId)) {
    errores.push('La categoria del local no existe.');
  }
  if (!['comida', 'producto', 'productos'].includes(String(local.tipo))) {
    errores.push('El tipo de local debe ser comida o productos.');
  }
  return errores;
}

function validarProductoLocal(producto, ids) {
  const errores = [];
  const id = String(producto.id || '');
  if (!esTexto(id)) errores.push('Hay un producto sin identificador.');
  else if (ids.has(id)) errores.push('Identificador de producto duplicado: ' + id);
  else ids.add(id);

  if (!esTexto(String(producto.nombre || ''))) errores.push(`Producto '${id}': falta el nombre.`);

  const publicado = producto.publicado !== false;
  const precio = convertirNumero(producto.precio);
  const precioValido = precio !== null && precio > 0;
  let variantesValidas = 0;

  for (const v of producto.variantes || []) {
    if (!v) continue;
    if (!esTexto(String(v.nombre || ''))) errores.push(`Producto '${id}': variante sin nombre.`);
    const pv = convertirNumero(v.precio);
    if (pv === null || pv <= 0) {
      errores.push(`Producto '${id}': la variante '${v.nombre}' necesita precio mayor a 0.`);
    } else {
      variantesValidas++;
    }
  }

  if (publicado && !precioValido && variantesValidas === 0) {
    if (producto.precio === null || producto.precio === undefined || String(producto.precio).trim() === '') {
      errores.push(`Producto '${id}': un producto publicado necesita precio o una variante con precio.`);
    } else {
      errores.push(`Producto '${id}': el precio debe ser mayor a 0 o tener una variante con precio.`);
    }
  }

  for (const e of producto.extras || []) {
    if (!e) continue;
    if (!esTexto(String(e.nombre || ''))) errores.push(`Producto '${id}': extra sin nombre.`);
    if (e.precio !== null && e.precio !== undefined && String(e.precio).trim() !== '') {
      const pe = convertirNumero(e.precio);
      if (pe === null || pe < 0) {
        errores.push(`Producto '${id}': el extra '${e.nombre}' tiene precio invalido.`);
      }
    }
  }
  return errores;
}

export function normalizarProductoLocal(p, localId, ids) {
  const nombre = String(p.nombre || '').trim();
  let id = String(p.id || '');
  if (!id.trim()) id = localId + '-' + convertirAId(nombre, 'prod');
  const base = id;
  let sufijo = 2;
  while (ids.has(id)) {
    id = base + '-' + sufijo;
    sufijo++;
  }
  ids.add(id);

  const numero = convertirNumero(p.precio);
  const precio = numero !== null && numero > 0 ? redondear2(numero) : null;

  const variantes = [];
  let i = 0;
  for (const v of p.variantes || []) {
    if (!v) continue;
    i++;
    const pv = convertirNumero(v.precio);
    if (pv === null || pv <= 0) continue;
    variantes.push({
      id: v.id ? String(v.id) : 'v' + i,
      nombre: String(v.nombre || '').trim(),
      precio: redondear2(pv)
    });
  }

  const extras = [];
  for (const e of p.extras || []) {
    if (!e || !esTexto(String(e.nombre || ''))) continue;
    let pe = convertirNumero(e.precio);
    if (pe === null) pe = 0;
    extras.push({ nombre: String(e.nombre).trim(), precio: redondear2(pe) });
  }

  return {
    id,
    nombre,
    descripcion: String(p.descripcion || '').trim(),
    precio,
    grupo: p.grupo ? String(p.grupo).trim() : 'Carta',
    subcategoria: String(p.subcategoria || '').trim(),
    emoji: String(p.emoji || '').trim(),
    etiqueta: String(p.etiqueta || '').trim(),
    imagen: p.imagen ? String(p.imagen) : null,
    publicado: p.publicado === true,
    disponible: p.disponible !== false,
    revisar: p.revisar === true,
    variantes,
    extras,
    origen: p.origen ? String(p.origen) : 'manual',
    camposDudosos: Array.isArray(p.camposDudosos) ? p.camposDudosos : []
  };
}

export async function guardarLocalCompleto(env, carpeta, local, productos, usuario, rol, ip) {
  if (!carpetaValida(carpeta)) lanzar(400, 'Carpeta de local invalida.');
  const existente = await obtenerLocalPorCarpeta(env, carpeta);
  if (!existente) lanzar(404, 'El local no existe.');

  const datos = plano(local);
  const categorias = await obtenerCategoriasLocales(env);

  const indice = await leerIndiceLocales(env);
  for (const otra of indice) {
    if (String(otra) === String(carpeta)) continue;
    const item = await obtenerLocalPorCarpeta(env, otra);
    if (item && String(item.local.id) === String(datos.id)) {
      lanzar(409, `El identificador '${datos.id}' ya lo usa el local ${item.local.nombre}.`);
    }
  }

  const errores = validarLocal(categorias, datos);
  const ids = new Set();
  const limpios = [];
  for (const p of productos || []) {
    if (!p) continue;
    errores.push(...validarProductoLocal(p, ids));
    limpios.push(p);
  }
  if (errores.length) lanzar(400, errores.join(' '));

  datos.id = String(datos.id);
  datos.publicado = datos.publicado === true;
  datos.disponible = datos.disponible !== false;
  datos.cerradoTemporal = datos.cerradoTemporal === true;
  datos.zonaId = String(datos.zonaId || '');

  await guardarDoc(env, 'local:' + carpeta, datos);
  await guardarDoc(env, 'local:' + carpeta + ':productos', limpios);

  await registrarAuditoria(env, {
    usuario,
    rol,
    accion: 'local.guardar',
    detalle: `Local ${carpeta} (${datos.nombre}) con ${limpios.length} productos`,
    ip
  });

  return { ok: true, carpeta, productos: limpios.length };
}

export async function eliminarProductosLocal(env, carpeta, ids, usuario, rol, ip) {
  if (!carpetaValida(carpeta)) lanzar(400, 'Carpeta de local invalida.');
  const item = await obtenerLocalPorCarpeta(env, carpeta);
  if (!item) lanzar(404, 'Local no encontrado.');

  const objetivos = new Set((ids || []).map((id) => String(id)).filter(Boolean));
  if (!objetivos.size) lanzar(400, 'No se indico ningun producto para eliminar.');

  const borrados = item.productos.filter((p) => objetivos.has(String(p.id)));
  if (!borrados.length) lanzar(404, 'Ninguno de los productos indicados existe en este local.');
  const restantes = item.productos.filter((p) => !objetivos.has(String(p.id)));

  const res = await guardarLocalCompleto(env, carpeta, item.local, restantes, usuario, rol, ip);
  const nombres = borrados.map((p) => String(p.nombre)).join(', ');
  await registrarAuditoria(env, {
    usuario,
    rol,
    accion: 'producto.eliminar',
    detalle: `Local ${carpeta} (${item.local.nombre}): ${borrados.length} producto(s) eliminados: ${nombres}`,
    ip
  });
  return {
    ok: true,
    eliminados: borrados.length,
    restantes: restantes.length,
    ids: borrados.map((p) => String(p.id)),
    ...res
  };
}

export async function nuevoLocal(env, local, usuario, rol, ip) {
  const indice = await leerIndiceLocales(env);
  let max = 0;
  for (const c of indice) {
    const m = String(c).match(/^local-([0-9]+)$/);
    if (m) max = Math.max(max, Number(m[1]));
  }
  const carpeta = 'local-' + String(max + 1).padStart(3, '0');

  const categorias = await obtenerCategoriasLocales(env);
  const errores = validarLocal(categorias, local);
  if (errores.length) lanzar(400, errores.join(' '));

  for (const otro of indice) {
    const item = await obtenerLocalPorCarpeta(env, otro);
    if (item && String(item.local.id) === String(local.id)) {
      lanzar(409, `El identificador '${local.id}' ya existe.`);
    }
  }

  const pedidoMinimo = convertirNumero(local.pedidoMinimo);
  const emp = local.empaquetado || {};
  const montoEmp = convertirNumero(emp.monto);
  const localFinal = {
    id: String(local.id),
    nombre: String(local.nombre),
    tipo: local.tipo === 'comida' ? 'comida' : 'productos',
    categoriaId: String(local.categoriaId),
    descripcion: String(local.descripcion || ''),
    publicado: local.publicado === true,
    disponible: local.disponible !== false,
    cerradoTemporal: local.cerradoTemporal === true,
    esEjemplo: false,
    emoji: local.emoji ? String(local.emoji) : '🍔',
    colores: Array.isArray(local.colores) && local.colores.length ? local.colores : ['#fdd303', '#111111'],
    logo: null,
    portada: null,
    cartaOriginal: null,
    tiempo: String(local.tiempo || ''),
    pedidoMinimo: pedidoMinimo !== null ? pedidoMinimo : 0,
    horarioLocal: String(local.horarioLocal || ''),
    direccion: String(local.direccion || ''),
    telefono: String(local.telefono || ''),
    zonaId: String(local.zonaId || ''),
    etiquetas: Array.isArray(local.etiquetas) ? local.etiquetas : [],
    nuevo: local.nuevo === true,
    empaquetado: {
      porUnidad: emp.porUnidad === true,
      aplica: emp.aplica === true,
      monto: montoEmp !== null ? montoEmp : 0,
      concepto: emp.concepto ? String(emp.concepto) : 'Empaquetado'
    },
    notas: String(local.notas || '')
  };

  await guardarDoc(env, 'local:' + carpeta, localFinal);
  await guardarDoc(env, 'local:' + carpeta + ':productos', []);
  await guardarIndiceLocales(env, [...indice, carpeta]);

  await registrarAuditoria(env, {
    usuario,
    rol,
    accion: 'local.crear',
    detalle: `Local ${carpeta} (${localFinal.nombre})`,
    ip
  });
  return { ok: true, carpeta, local: localFinal };
}

export async function eliminarLocal(env, carpeta, usuario, rol, ip) {
  if (!carpetaValida(carpeta)) lanzar(400, 'Carpeta de local invalida.');
  const indice = await leerIndiceLocales(env);
  if (!indice.includes(carpeta)) lanzar(404, 'El local no existe.');
  const item = await obtenerLocalPorCarpeta(env, carpeta);

  await guardarIndiceLocales(env, indice.filter((c) => c !== carpeta));
  await borrarDoc(env, 'local:' + carpeta);
  await borrarDoc(env, 'local:' + carpeta + ':productos');

  await registrarAuditoria(env, {
    usuario,
    rol,
    accion: 'local.eliminar',
    detalle: `Local ${carpeta} (${item ? item.local.nombre : carpeta})`,
    ip
  });
  return { ok: true };
}

export async function duplicarLocal(env, carpeta, usuario, rol, ip) {
  if (!carpetaValida(carpeta)) lanzar(400, 'Carpeta de local invalida.');
  const indice = await leerIndiceLocales(env);
  if (!indice.includes(carpeta)) lanzar(404, 'El local no existe.');
  const origen = await obtenerLocalPorCarpeta(env, carpeta);
  if (!origen) lanzar(404, 'No se pudo leer el local.');

  let maxNum = 0;
  for (const c of indice) {
    const m = String(c).match(/^local-([0-9]+)$/);
    if (m) maxNum = Math.max(maxNum, Number(m[1]));
  }
  const nuevaCarpeta = 'local-' + String(maxNum + 1).padStart(3, '0');

  const idsUsados = new Set();
  for (const c of indice) {
    const item = await obtenerLocalPorCarpeta(env, c);
    if (!item) continue;
    for (const p of item.productos) if (p && p.id) idsUsados.add(String(p.id));
  }
  for (const cat of CATALOGOS) {
    const prods = await leerDoc(env, `catalogo:${cat}:productos`, []);
    for (const p of prods || []) if (p && p.id) idsUsados.add(String(p.id));
  }

  const localNuevo = plano(origen.local);
  localNuevo.id = nuevaCarpeta;
  localNuevo.nombre = String(localNuevo.nombre || '').trim() + ' (copia)';
  localNuevo.publicado = false;
  localNuevo.esEjemplo = false;

  const productosNuevos = [];
  for (const p of origen.productos) {
    if (!p) continue;
    const clon = plano(p);
    const base = convertirAId(String(p.nombre || ''), 'prod');
    let nuevoId = base;
    let sufijo = 2;
    while (idsUsados.has(nuevoId)) {
      nuevoId = base + '-' + sufijo;
      sufijo++;
    }
    idsUsados.add(nuevoId);
    clon.id = nuevoId;
    productosNuevos.push(clon);
  }

  await guardarDoc(env, 'local:' + nuevaCarpeta, localNuevo);
  await guardarDoc(env, 'local:' + nuevaCarpeta + ':productos', productosNuevos);
  await guardarIndiceLocales(env, [...indice, nuevaCarpeta]);

  await registrarAuditoria(env, {
    usuario,
    rol,
    accion: 'local.duplicar',
    detalle: `Local ${carpeta} duplicado a ${nuevaCarpeta} con ${productosNuevos.length} productos`,
    ip
  });
  return {
    ok: true,
    carpeta: nuevaCarpeta,
    nuevaCarpeta,
    nombre: localNuevo.nombre,
    productos: productosNuevos.length
  };
}

/* ============================================================
   Categorías de locales
   ============================================================ */

export async function guardarCategoriasLocales(env, categorias, usuario, rol, ip) {
  const ids = new Set();
  const limpias = [];
  for (const c of categorias || []) {
    const id = convertirAId(String(c.id || ''), 'cat');
    const nombre = String(c.nombre || '').trim();
    if (!nombre) lanzar(400, 'Cada categoria necesita nombre.');
    if (ids.has(id)) lanzar(400, 'Categoria duplicada: ' + id);
    ids.add(id);
    limpias.push({ id, nombre });
  }

  const usadas = [];
  for (const carpeta of await leerIndiceLocales(env)) {
    const item = await obtenerLocalPorCarpeta(env, carpeta);
    if (item && item.local.categoriaId) usadas.push(String(item.local.categoriaId));
  }
  for (const u of usadas) {
    if (!ids.has(u)) lanzar(400, `No puedes eliminar la categoria '${u}' porque hay locales que la usan.`);
  }

  await guardarDoc(env, 'categoriasLocales', limpias);
  await registrarAuditoria(env, {
    usuario,
    rol,
    accion: 'categorias.guardar',
    detalle: `${limpias.length} categorias`,
    ip
  });
  return { ok: true, categorias: limpias };
}

/* ============================================================
   Configuración pública
   ============================================================ */

export async function obtenerConfigPublica(env) {
  const config = await leerDoc(env, 'config', null);
  if (!config) lanzar(404, 'No se encontro data/config.json.');
  return config;
}

export async function guardarConfigPublica(env, config, usuario, rol, ip) {
  if (!config) lanzar(400, 'Faltan los datos de configuracion.');
  const actual = await leerDoc(env, 'config', null);
  if (!actual) lanzar(404, 'No se encontro data/config.json.');

  const marca = String(config.marca || '').trim();
  if (marca.length < 2 || marca.length > 60) lanzar(400, 'La marca debe tener entre 2 y 60 caracteres.');
  const ciudad = String(config.ciudad || '').trim();
  if (ciudad.length < 2 || ciudad.length > 60) lanzar(400, 'La ciudad debe tener entre 2 y 60 caracteres.');
  const moneda = String(config.moneda || '').trim();
  if (moneda.length < 1 || moneda.length > 5) lanzar(400, 'La moneda debe tener entre 1 y 5 caracteres.');

  const waNumero = String((config.whatsapp && config.whatsapp.numero) || '').replace(/\D/g, '');
  if (waNumero.length < 9 || waNumero.length > 15) {
    lanzar(400, 'El numero de WhatsApp debe tener entre 9 y 15 digitos (con codigo de pais).');
  }
  const waVisible = String((config.whatsapp && config.whatsapp.visible) || '').trim();
  if (waVisible.length < 6 || waVisible.length > 24) lanzar(400, 'El numero visible de WhatsApp no es valido.');

  const email = String(config.email || '').trim();
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) lanzar(400, 'El correo electronico no es valido.');

  const redes = {};
  for (const clave of ['tiktok', 'instagram']) {
    const entrada = config.redes ? config.redes[clave] : null;
    const usuarioRed = String((entrada && entrada.usuario) || '').trim();
    const urlRed = String((entrada && entrada.url) || '').trim();
    if (urlRed && !/^https?:\/\//i.test(urlRed)) {
      lanzar(400, `La URL de ${clave} debe iniciar con http:// o https://.`);
    }
    redes[clave] = {
      usuario: usuarioRed,
      url: urlRed,
      verificado: Boolean(entrada && entrada.verificado === true),
      nota: entrada ? String(entrada.nota || '') : ''
    };
  }

  const zonasEntrada = Array.isArray(config.zonas) ? config.zonas : [];
  if (!zonasEntrada.length) lanzar(400, 'Debe existir al menos una zona de entrega.');

  const zonas = [];
  const idsZona = new Set();
  for (const z of zonasEntrada) {
    if (!z) continue;
    let idZona = convertirAId(String(z.id || ''), '');
    if (!idZona) idZona = convertirAId(String(z.nombre || ''), 'zona');
    if (idsZona.has(idZona)) lanzar(400, 'Zona duplicada: ' + idZona);
    idsZona.add(idZona);

    const nombreZona = String(z.nombre || '').trim();
    if (nombreZona.length < 2 || nombreZona.length > 60) {
      lanzar(400, 'Cada zona necesita un nombre de 2 a 60 caracteres.');
    }
    const apertura = String(z.apertura || '').trim();
    const cierre = String(z.cierre || '').trim();
    if (!/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(apertura)) {
      lanzar(400, `Hora de apertura invalida en ${nombreZona} (usa HH:mm).`);
    }
    if (!/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(cierre)) {
      lanzar(400, `Hora de cierre invalida en ${nombreZona} (usa HH:mm).`);
    }
    let dias = [];
    for (const dia of Array.isArray(z.dias) ? z.dias : []) {
      const n = convertirNumero(dia);
      if (n !== null && n >= 0 && n <= 6) dias.push(Math.trunc(n));
    }
    dias = [...new Set(dias)].sort((a, b) => a - b);
    if (!dias.length) dias = [0, 1, 2, 3, 4, 5, 6];

    zonas.push({
      id: idZona,
      nombre: nombreZona,
      horarioTexto: String(z.horarioTexto || '').trim(),
      dias,
      apertura,
      cierre,
      nota: String(z.nota || '').trim()
    });
  }
  if (!zonas.length) lanzar(400, 'Debe existir al menos una zona de entrega valida.');

  let zonaPrincipal = String(config.zonaPrincipal || '').trim();
  if (!idsZona.has(zonaPrincipal)) zonaPrincipal = zonas[0].id;

  const delivery = config.delivery !== undefined && config.delivery !== null ? config.delivery : actual.delivery;
  const mensajeDelivery = delivery ? String(delivery.mensaje || '').trim() : '';
  if (mensajeDelivery.length > 800) lanzar(400, 'El mensaje de delivery es demasiado largo.');
  const notaDelivery = delivery ? String(delivery.nota || '').trim() : '';
  if (notaDelivery.length > 400) lanzar(400, 'La nota de delivery es demasiado larga.');

  const nueva = {
    version: 1,
    marca,
    ciudad,
    zonaPrincipal,
    moneda,
    whatsapp: { numero: waNumero, visible: waVisible },
    email,
    redes,
    zonas,
    delivery: {
      cotizacionPendiente: !delivery || delivery.cotizacionPendiente !== false,
      mensaje: mensajeDelivery,
      nota: notaDelivery
    },
    avisoEjemplos: config.avisoEjemplos === true,
    servicios: {
      taximoto: !!(config.servicios && config.servicios.taximoto === true)
    },
    plazavea: actual.plazavea
  };

  await guardarDoc(env, 'config', nueva);
  await registrarAuditoria(env, {
    usuario,
    rol,
    accion: 'config.guardar',
    detalle: `Configuracion publica actualizada (${marca}, ${ciudad}, ${zonas.length} zonas)`,
    ip
  });
  return { ok: true, config: nueva };
}

/* ============================================================
   Catálogos globales
   ============================================================ */

export function rutaCatalogo(id) {
  return CATALOGOS.includes(String(id)) ? String(id) : null;
}

export async function obtenerCatalogo(env, id) {
  const catalogoId = rutaCatalogo(id);
  if (!catalogoId) lanzar(404, 'Catalogo no encontrado.');
  const [categorias, productos] = await Promise.all([
    leerDoc(env, `catalogo:${catalogoId}:categorias`, []),
    leerDoc(env, `catalogo:${catalogoId}:productos`, [])
  ]);
  return {
    id: catalogoId,
    carpeta: catalogoId,
    categorias: Array.isArray(categorias) ? categorias : [],
    productos: Array.isArray(productos) ? productos : []
  };
}

function validarProductoCatalogo(producto, categorias, ids) {
  const errores = [];
  const id = String(producto.id || '');
  if (!esTexto(id)) errores.push('Producto sin identificador.');
  else if (ids.has(id)) errores.push('Producto duplicado: ' + id);
  else ids.add(id);

  if (!esTexto(String(producto.nombre || ''))) errores.push(`Producto '${id}' sin nombre.`);
  if (!esTexto(String(producto.categoriaId || '')) || !categorias.has(String(producto.categoriaId))) {
    errores.push(`Producto '${id}' con categoria invalida.`);
  }
  if (!producto.fuente || !esTexto(String(producto.fuente.url || ''))) {
    errores.push(`Producto '${id}' necesita el bloque de fuente.`);
  }
  if (producto.publicado !== false) {
    const precio = convertirNumero(producto.precioVenta);
    if (precio === null || precio <= 0) errores.push(`Producto '${id}' publicado sin precio de venta valido.`);
  }
  return errores;
}

export async function guardarCatalogo(env, id, categorias, productos, usuario, rol, ip) {
  const catalogoId = rutaCatalogo(id);
  if (!catalogoId) lanzar(404, 'Catalogo no encontrado.');

  const mapa = new Map();
  const limpias = [];
  for (const c of categorias || []) {
    const catId = convertirAId(String(c.id || ''), 'cat');
    const nombre = String(c.nombre || '').trim();
    if (!nombre) lanzar(400, 'Cada categoria necesita nombre.');
    if (mapa.has(catId)) lanzar(400, 'Categoria duplicada: ' + catId);
    mapa.set(catId, nombre);
    limpias.push({ id: catId, nombre });
  }
  if (!limpias.length) lanzar(400, 'El catalogo necesita al menos una categoria.');

  const ids = new Set();
  const errores = [];
  const limpios = [];
  const hoy = fechaCorta();
  for (const p of productos || []) {
    if (!p) continue;
    if (!esTexto(String(p.id || ''))) p.id = convertirAId(String(p.nombre || ''), 'prod');
    if (!p.fuente || !esTexto(String(p.fuente.url || ''))) {
      p.fuente = {
        tienda: 'EnRuta Delivery',
        url: 'https://wa.me/51922504223',
        productoId: String(p.id),
        fechaVerificacion: hoy,
        metodo: 'Alta manual en panel'
      };
    }
    if (!esTexto(String(p.presentacion || ''))) p.presentacion = 'Unidad';
    if (!esTexto(String(p.marca || ''))) p.marca = 'Sin marca';
    errores.push(...validarProductoCatalogo(p, mapa, ids));
    limpios.push(p);
  }
  if (errores.length) lanzar(400, errores.join(' '));

  await guardarDoc(env, `catalogo:${catalogoId}:categorias`, limpias);
  await guardarDoc(env, `catalogo:${catalogoId}:productos`, limpios);

  await registrarAuditoria(env, {
    usuario,
    rol,
    accion: 'catalogo.guardar',
    detalle: `Catalogo ${catalogoId} con ${limpios.length} productos`,
    ip
  });
  return { ok: true, productos: limpios.length };
}

/* ============================================================
   Imágenes (KV)
   ============================================================ */

function extensionImagen(bytes) {
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return { ext: 'png', tipo: 'image/png' };
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8) return { ext: 'jpg', tipo: 'image/jpeg' };
  if (
    bytes.length > 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) return { ext: 'webp', tipo: 'image/webp' };
  return null;
}

export async function guardarImagenBase64(env, { tipo, carpeta, nombre, base64, prefijo }) {
  if (!esTexto(base64)) lanzar(400, 'No se recibio la imagen.');
  if (String(base64).length > 12000000) lanzar(413, 'La imagen supera el limite de 8 MB.');

  let limpio = String(base64);
  if (/^data:[^;]+;base64,/i.test(limpio)) limpio = limpio.slice(limpio.indexOf(',') + 1);

  let bytes;
  try {
    const binario = atob(limpio.replace(/\s+/g, ''));
    bytes = new Uint8Array(binario.length);
    for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  } catch {
    lanzar(400, 'La imagen no es base64 valido.');
  }
  if (bytes.length > 9000000) lanzar(413, 'La imagen supera el limite de 8 MB.');

  const formato = extensionImagen(bytes);
  if (!formato) lanzar(400, 'Formato de imagen no permitido. Usa JPG, PNG o WEBP.');

  let base = convertirAId(String(nombre || '').replace(/\.[^.]+$/, ''), 'imagen');
  if (base.length > 40) base = base.slice(0, 40);
  const sello = fechaHora().replace(/[-: ]/g, '');
  const archivo = `${prefijo || 'img'}-${sello}-${base}.${formato.ext}`;

  let ruta;
  if (tipo === 'local') {
    if (!carpetaValida(carpeta)) lanzar(400, 'Carpeta de local invalida.');
    ruta = `media/local/${carpeta}/${archivo}`;
  } else if (tipo === 'catalogo') {
    if (!CATALOGOS.includes(String(carpeta))) lanzar(400, 'Catalogo invalido.');
    ruta = `media/catalogo/${carpeta}/${archivo}`;
  } else {
    lanzar(400, 'Destino de imagen invalido.');
  }

  const datos = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  await env.IMAGENES.put(ruta, datos, { metadata: { tipo: formato.tipo } });

  return { ok: true, ruta, url: '/' + ruta, nombre: archivo };
}

/* ============================================================
   Pedidos
   ============================================================ */

export async function buscarProductoParaPedido(env, tipo, localId, catalogoId, productoId) {
  if (tipo === 'local') {
    const item = await buscarCarpetaPorLocalId(env, localId);
    if (!item) return null;
    const local = item.local;
    if (local.publicado !== true || local.disponible === false || local.cerradoTemporal === true) return null;
    const producto = item.productos.find((p) => String(p.id) === String(productoId));
    if (!producto || producto.publicado === false) return null;
    return {
      tipo: 'local',
      localId: String(local.id),
      localCarpeta: String(item.carpeta),
      localNombre: String(local.nombre),
      producto,
      empaquetado: local.empaquetado
    };
  }

  const cat = await obtenerCatalogo(env, catalogoId);
  const producto = cat.productos.find((p) => String(p.id) === String(productoId));
  if (!producto || producto.publicado === false || producto.disponible === false) return null;
  return {
    tipo: 'catalogo',
    catalogoId: String(catalogoId),
    producto,
    empaquetado: null
  };
}

export function precioProductoPedido(producto, varianteId, extrasSolicitados = []) {
  let precioBase = convertirNumero(producto.precio);
  if (precioBase === null) precioBase = 0;
  let varianteNombre = '';
  let varianteIdSalida = null;

  if (varianteId) {
    const v = (producto.variantes || []).find((x) => x && String(x.id) === String(varianteId));
    if (!v) lanzar(400, 'La variante elegida ya no esta disponible.');
    precioBase = convertirNumero(v.precio);
    if (precioBase === null) precioBase = 0;
    varianteNombre = String(v.nombre);
    varianteIdSalida = String(v.id);
  }
  if (precioBase <= 0) {
    lanzar(400, `El producto "${producto.nombre}" no tiene un precio valido. Elige una variante disponible.`);
  }

  const extras = [];
  let extrasPrecio = 0;
  const vistos = new Set();
  for (const solicitado of extrasSolicitados || []) {
    if (solicitado === null || solicitado === undefined) continue;
    const nombre = String(solicitado).trim();
    if (!nombre) continue;
    const clave = normalizarTexto(nombre);
    if (vistos.has(clave)) continue;
    const e = (producto.extras || []).find((x) => x && normalizarTexto(String(x.nombre)) === clave);
    if (!e) lanzar(400, `El extra "${nombre}" ya no esta disponible para este producto.`);
    let precioExtra = convertirNumero(e.precio);
    if (precioExtra === null) precioExtra = 0;
    extras.push({ nombre: String(e.nombre), precio: redondear2(precioExtra) });
    extrasPrecio += precioExtra;
    vistos.add(clave);
  }
  if (extras.length > 20) lanzar(400, 'Demasiados extras en un producto.');

  const precioTotal = redondear2(precioBase + extrasPrecio);
  if (precioTotal <= 0) lanzar(400, 'El precio del producto no es valido.');
  return {
    precio: precioTotal,
    precioBase: redondear2(precioBase),
    varianteId: varianteIdSalida,
    variante: varianteNombre,
    extras,
    extrasPrecio: redondear2(extrasPrecio)
  };
}

export async function calcularPedidoServidor(env, items) {
  if (!Array.isArray(items) || items.length > 200) lanzar(400, 'El pedido tiene demasiadas lineas.');

  const grupos = new Map();
  const localCarpetas = [];
  let totalUnidades = 0;

  for (const raw of items) {
    if (!raw) continue;
    const tipo = raw.tipo === 'local' ? 'local' : 'catalogo';
    const cantidadNum = convertirNumero(raw.cantidad);
    if (cantidadNum === null) lanzar(400, 'Cantidad invalida en el pedido.');
    const cantidad = Math.round(cantidadNum);
    if (cantidad < 1 || cantidad > 99) lanzar(400, 'Cantidad invalida en el pedido.');

    const encontrado = await buscarProductoParaPedido(env, tipo, raw.localId, raw.catalogoId, raw.productoId);
    if (!encontrado) lanzar(400, 'Un producto del pedido ya no esta disponible.');

    const extrasSolicitados = [];
    for (const extraRaw of raw.extras || []) {
      if (!extraRaw) continue;
      if (typeof extraRaw === 'string') extrasSolicitados.push(extraRaw);
      else if (extraRaw.nombre !== null && extraRaw.nombre !== undefined) extrasSolicitados.push(String(extraRaw.nombre));
    }

    const p = encontrado.producto;
    const precioInfo = precioProductoPedido(p, raw.varianteId, extrasSolicitados);
    let nombre = String(p.nombre);
    if (precioInfo.variante) nombre += ' · ' + precioInfo.variante;
    const nombresExtras = precioInfo.extras.map((e) => String(e.nombre));
    if (nombresExtras.length) nombre += ' + ' + nombresExtras.join(', ');

    const clave = tipo === 'local' ? 'local:' + encontrado.localId : 'cat:' + encontrado.catalogoId;
    if (!grupos.has(clave)) {
      grupos.set(clave, {
        clave,
        tipo,
        localId: encontrado.localId,
        localCarpeta: encontrado.localCarpeta,
        catalogoId: encontrado.catalogoId,
        nombre: tipo === 'local' ? encontrado.localNombre : String(encontrado.catalogoId),
        etiqueta: tipo === 'local' ? 'Local' : 'Catalogo EnRuta',
        empaquetado: encontrado.empaquetado,
        items: [],
        subtotal: 0,
        unidades: 0
      });
    }
    const grupo = grupos.get(clave);
    const item = {
      tipo,
      productoId: String(p.id),
      nombre,
      varianteId: precioInfo.varianteId,
      variante: precioInfo.variante,
      extras: precioInfo.extras,
      precioBase: precioInfo.precioBase,
      precioExtras: precioInfo.extrasPrecio,
      precio: precioInfo.precio,
      cantidad,
      subtotal: redondear2(precioInfo.precio * cantidad)
    };
    grupo.items.push(item);
    grupo.subtotal += item.subtotal;
    grupo.unidades += cantidad;
    totalUnidades += cantidad;

    if (tipo === 'local' && !localCarpetas.includes(encontrado.localCarpeta)) {
      localCarpetas.push(String(encontrado.localCarpeta));
    }
  }
  if (!grupos.size) lanzar(400, 'El pedido esta vacio.');

  let empaquetadoTotal = 0;
  const gruposSalida = [];
  for (const g of grupos.values()) {
    const emp = g.empaquetado;
    let monto = 0;
    let montoBase = emp ? convertirNumero(emp.monto) : null;
    if (montoBase === null) montoBase = 0;
    if (emp && emp.aplica === true && montoBase > 0) {
      monto = emp.porUnidad === true ? montoBase * g.unidades : montoBase;
    }
    g.empaquetadoMonto = redondear2(monto);
    empaquetadoTotal += monto;
    g.subtotal = redondear2(g.subtotal);
    gruposSalida.push(g);
  }

  let subtotal = 0;
  for (const g of gruposSalida) subtotal += g.subtotal;

  return {
    grupos: gruposSalida,
    unidades: totalUnidades,
    subtotal: redondear2(subtotal),
    empaquetado: redondear2(empaquetadoTotal),
    total: redondear2(subtotal + empaquetadoTotal),
    localCarpetas
  };
}

export async function guardarPedidoPublico(env, request, datos) {
  const nombre = String(datos.nombre || '').trim();
  const telefono = String(datos.telefono || '').trim();
  const direccion = String(datos.direccion || '').trim();
  const zonaId = String(datos.zonaId || '').trim();
  const referencia = String(datos.referencia || '').trim();
  const nota = String(datos.nota || '').trim();

  if (nombre.length < 3 || nombre.length > 120) lanzar(400, 'Nombre invalido.');
  const soloDigitos = telefono.replace(/\D/g, '');
  if (soloDigitos.length < 9 || soloDigitos.length > 15) lanzar(400, 'Celular invalido.');
  if (direccion.length < 8 || direccion.length > 240) lanzar(400, 'Direccion invalida.');
  if (nota.length > 600 || referencia.length > 240) lanzar(400, 'Texto demasiado largo.');

  const config = await leerDoc(env, 'config', null);
  let zonaNombre = zonaId;
  if (config) {
    const zona = (config.zonas || []).find((z) => String(z.id) === zonaId);
    if (!zona) lanzar(400, 'Zona de entrega invalida.');
    zonaNombre = String(zona.nombre);
  }

  const calculo = await calcularPedidoServidor(env, datos.items);
  const id = 'PED-' + fechaCorta().replace(/-/g, '') + '-' + idAleatorio(4).toUpperCase();

  const pedido = {
    id,
    creadoEn: fechaHora(),
    estado: 'nuevo',
    nombre,
    telefono,
    zonaId,
    zonaNombre,
    direccion,
    referencia,
    nota,
    programado: datos.programado === true,
    fechaEntrega: datos.fecha ? String(datos.fecha) : null,
    cuandoTexto: String(datos.cuandoTexto || ''),
    localCarpetas: calculo.localCarpetas,
    items: calculo.grupos,
    unidades: calculo.unidades,
    subtotal: calculo.subtotal,
    empaquetado: calculo.empaquetado,
    total: calculo.total,
    origen: 'web',
    ip: request.headers.get('cf-connecting-ip') || 'desconocida',
    userAgent: String(request.headers.get('user-agent') || '')
  };

  await env.DB.prepare(
    'INSERT INTO pedidos (id, creadoEn, estado, total, unidades, localCarpetas, json) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)'
  )
    .bind(id, pedido.creadoEn, pedido.estado, pedido.total, pedido.unidades, JSON.stringify(pedido.localCarpetas), JSON.stringify(pedido))
    .run();

  await registrarAuditoria(env, {
    usuario: 'cliente-web',
    rol: 'publico',
    accion: 'pedido.crear',
    detalle: `Pedido ${id} por ${calculo.total} con ${calculo.unidades} unidades`,
    ip: pedido.ip
  });
  return { ok: true, pedidoId: id, total: calculo.total, unidades: calculo.unidades };
}

export async function obtenerPedidosAdmin(env, sesion, estado = '', limite = 200) {
  const tope = Math.max(1, Math.min(1000, Number(limite) || 200));
  const condiciones = [];
  const valores = [];
  if (estado) {
    condiciones.push('estado = ?' + (valores.length + 1));
    valores.push(estado);
  }
  if (sesion.rol === 'local') {
    condiciones.push('localCarpetas LIKE ?' + (valores.length + 1));
    valores.push(`%${JSON.stringify(String(sesion.localCarpeta))}%`);
  }
  const sql =
    'SELECT json FROM pedidos' +
    (condiciones.length ? ' WHERE ' + condiciones.join(' AND ') : '') +
    ' ORDER BY creadoEn DESC LIMIT ?' + (valores.length + 1);
  valores.push(tope);
  const resultado = await env.DB.prepare(sql).bind(...valores).all();
  const salida = [];
  for (const fila of resultado.results || []) {
    try {
      salida.push(JSON.parse(fila.json));
    } catch {
      /* ignorar */
    }
  }
  return salida;
}

export async function cambiarEstadoPedido(env, id, estado, sesion, ip) {
  const validos = ['nuevo', 'confirmado', 'en-camino', 'entregado', 'cancelado'];
  if (!validos.includes(estado)) lanzar(400, 'Estado invalido.');

  const fila = await env.DB.prepare('SELECT json FROM pedidos WHERE id = ?1').bind(id).first();
  if (!fila) lanzar(404, 'Pedido no encontrado.');
  const pedido = JSON.parse(fila.json);
  if (sesion.rol === 'local' && !(pedido.localCarpetas || []).includes(String(sesion.localCarpeta))) {
    lanzar(403, 'Ese pedido no pertenece a tu local.');
  }
  pedido.estado = estado;
  pedido.actualizadoEn = fechaHora();

  await env.DB.prepare('UPDATE pedidos SET estado = ?1, json = ?2, actualizadoEn = ?3 WHERE id = ?4')
    .bind(estado, JSON.stringify(pedido), pedido.actualizadoEn, id)
    .run();

  await registrarAuditoria(env, {
    usuario: sesion.usuario,
    rol: sesion.rol,
    accion: 'pedido.estado',
    detalle: `Pedido ${id} -> ${estado}`,
    ip
  });
  return { ok: true, pedido };
}

/* ============================================================
   Servicios: recojo/envío y taximoto
   ============================================================ */

function validarTelefonoServicio(telefono, campo) {
  const digitos = String(telefono || '').replace(/\D/g, '');
  if (digitos.length < 9 || digitos.length > 15) lanzar(400, 'Telefono invalido: ' + campo + '.');
  return String(telefono).trim();
}

function validarCuandoServicio(datos) {
  let cuando = String(datos.cuando || '').trim().toLowerCase();
  if (cuando !== 'programado') cuando = 'urgente';

  let fecha = null;
  if (cuando === 'programado') {
    const texto = String(datos.fecha || '').trim();
    if (!texto) lanzar(400, 'Indica la fecha y hora del servicio.');
    fecha = new Date(texto);
    if (!Number.isFinite(fecha.getTime())) lanzar(400, 'La fecha y hora no son validas.');
    if (fecha.getTime() < Date.now() - 5 * 60 * 1000) lanzar(400, 'La fecha y hora deben ser futuras.');
  }

  if (cuando === 'urgente') {
    return { cuando, fecha: null, cuandoTexto: 'Urgente (lo antes posible)' };
  }
  const fh = fechaHora(fecha);
  return {
    cuando,
    fecha: fh.slice(0, 16).replace(' ', 'T'),
    cuandoTexto: `Programado: ${fh.slice(0, 10).split('-').reverse().join('/')} ${fh.slice(11, 16)}`
  };
}

export async function guardarServicioPublico(env, request, tipo, datos) {
  if (!datos) lanzar(400, 'Solicitud vacia.');
  if (!['envio', 'taximoto'].includes(tipo)) lanzar(400, 'Tipo de servicio invalido.');

  if (tipo === 'taximoto') {
    const config = await leerDoc(env, 'config', null);
    const activo = !!(config && config.servicios && config.servicios.taximoto === true);
    if (!activo) lanzar(403, 'El servicio de taximoto todavia no esta disponible.');
  }

  const cuando = validarCuandoServicio(datos);
  const origen = String(datos.origen || '').trim();
  const destino = String(datos.destino || '').trim();
  if (origen.length < 6 || origen.length > 240) lanzar(400, 'Direccion de origen invalida.');
  if (destino.length < 6 || destino.length > 240) lanzar(400, 'Direccion de destino invalida.');

  const prefijo = tipo === 'taximoto' ? 'TAX' : 'ENV';
  const id = prefijo + '-' + fechaCorta().replace(/-/g, '') + '-' + idAleatorio(4).toUpperCase();
  const servicio = {
    id,
    tipo,
    creadoEn: fechaHora(),
    estado: 'pendiente',
    origen,
    destino,
    cuando: cuando.cuando,
    fecha: cuando.fecha,
    cuandoTexto: cuando.cuandoTexto,
    origenSolicitud: 'web',
    ip: request.headers.get('cf-connecting-ip') || 'desconocida',
    userAgent: String(request.headers.get('user-agent') || '')
  };

  if (tipo === 'taximoto') {
    const nombre = String(datos.nombreCliente || '').trim();
    if (nombre.length > 0 && (nombre.length < 3 || nombre.length > 120)) lanzar(400, 'Nombre del cliente invalido.');
    let telefono = String(datos.telefono || '').trim();
    if (telefono.length > 0) telefono = validarTelefonoServicio(telefono, 'del cliente');
    const referencia = String(datos.referencia || '').trim();
    if (referencia.length > 240) lanzar(400, 'La referencia es demasiado larga.');
    servicio.nombreCliente = nombre.length > 0 ? nombre : 'Cliente web';
    servicio.telefono = telefono;
    servicio.referencia = referencia;
  } else {
    const nombreEnvia = String(datos.nombreEnvia || '').trim();
    if (nombreEnvia.length < 3 || nombreEnvia.length > 120) lanzar(400, 'Nombre de quien envia invalido.');
    const telefonoEnvia = validarTelefonoServicio(datos.telefonoEnvia, 'de quien envia');
    const nombreRecibe = String(datos.nombreRecibe || '').trim();
    if (nombreRecibe.length < 3 || nombreRecibe.length > 120) lanzar(400, 'Nombre de quien recibe invalido.');
    const telefonoRecibe = validarTelefonoServicio(datos.telefonoRecibe, 'de quien recibe');
    const descripcion = String(datos.descripcion || '').trim();
    if (descripcion.length < 3 || descripcion.length > 400) lanzar(400, 'Describe el producto que se envia.');
    const observaciones = String(datos.observaciones || '').trim();
    if (observaciones.length > 600) lanzar(400, 'Las observaciones son demasiado largas.');

    servicio.nombreEnvia = nombreEnvia;
    servicio.telefonoEnvia = telefonoEnvia;
    servicio.nombreRecibe = nombreRecibe;
    servicio.telefonoRecibe = telefonoRecibe;
    servicio.descripcion = descripcion;
    servicio.observaciones = observaciones;
  }

  await env.DB.prepare(
    'INSERT INTO servicios (id, tipo, creadoEn, estado, json) VALUES (?1, ?2, ?3, ?4, ?5)'
  )
    .bind(id, tipo, servicio.creadoEn, servicio.estado, JSON.stringify(servicio))
    .run();

  await registrarAuditoria(env, {
    usuario: 'cliente-web',
    rol: 'publico',
    accion: tipo + '.crear',
    detalle: `${tipo === 'taximoto' ? 'Taximoto' : 'Envio'} ${id} de ${origen} a ${destino}`,
    ip: servicio.ip
  });
  return { ok: true, servicioId: id, tipo };
}

export async function obtenerServiciosAdmin(env, tipo = '', limite = 300) {
  const tope = Math.max(1, Math.min(1000, Number(limite) || 300));
  let sql = 'SELECT json FROM servicios';
  const valores = [];
  if (tipo === 'envio' || tipo === 'taximoto') {
    sql += ' WHERE tipo = ?1';
    valores.push(tipo);
  }
  sql += ' ORDER BY creadoEn DESC LIMIT ?' + (valores.length + 1);
  valores.push(tope);
  const resultado = await env.DB.prepare(sql).bind(...valores).all();
  const salida = [];
  for (const fila of resultado.results || []) {
    try {
      salida.push(JSON.parse(fila.json));
    } catch {
      /* ignorar */
    }
  }
  return salida;
}

export async function cambiarEstadoServicio(env, tipo, id, estado, sesion, ip) {
  if (!['envio', 'taximoto'].includes(tipo)) lanzar(400, 'Tipo de servicio invalido.');
  const validos = ['pendiente', 'en camino', 'entregado'];
  if (!validos.includes(estado)) lanzar(400, 'Estado invalido.');

  const fila = await env.DB.prepare('SELECT json FROM servicios WHERE id = ?1 AND tipo = ?2').bind(id, tipo).first();
  if (!fila) lanzar(404, 'Solicitud no encontrada.');
  const servicio = JSON.parse(fila.json);
  servicio.estado = estado;
  servicio.actualizadoEn = fechaHora();

  await env.DB.prepare('UPDATE servicios SET estado = ?1, json = ?2, actualizadoEn = ?3 WHERE id = ?4 AND tipo = ?5')
    .bind(estado, JSON.stringify(servicio), servicio.actualizadoEn, id, tipo)
    .run();

  await registrarAuditoria(env, {
    usuario: sesion.usuario,
    rol: sesion.rol,
    accion: tipo + '.estado',
    detalle: `Solicitud ${id} -> ${estado}`,
    ip
  });
  return { ok: true, servicio };
}

/* ============================================================
   Resumen y estadísticas
   ============================================================ */

export async function obtenerResumenAdmin(env, sesion) {
  let locales = await obtenerLocalesAdmin(env);
  if (sesion.rol === 'local') {
    locales = locales.filter((l) => l.carpeta === String(sesion.localCarpeta));
  }
  const pedidos = await obtenerPedidosAdmin(env, sesion, '', 1000);
  const hoy = fechaCorta();
  const pedidosHoy = pedidos.filter((p) => String(p.creadoEn || '').startsWith(hoy));

  let totalProductos = 0;
  let publicados = 0;
  let pendientes = 0;
  for (const l of locales) {
    totalProductos += Number(l.totalProductos) || 0;
    publicados += Number(l.publicados) || 0;
    pendientes += Number(l.pendientes) || 0;
  }

  const catL = await obtenerCatalogo(env, 'licores');
  const catN = await obtenerCatalogo(env, 'primera-necesidad');

  return {
    locales: locales.length,
    productos: totalProductos,
    publicados,
    pendientes,
    pedidosHoy: pedidosHoy.length,
    pedidosNuevos: pedidos.filter((p) => String(p.estado) === 'nuevo').length,
    ventasHoy: redondear2(pedidosHoy.reduce((s, p) => s + (Number(p.total) || 0), 0)),
    catalogoLicores: catL.productos.length,
    catalogoNec: catN.productos.length,
    generadoEn: fechaHora()
  };
}

function sumarDias(fechaTexto, dias) {
  const d = new Date(fechaTexto + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

export async function obtenerEstadisticasVentas(env, sesion, desde = '', hasta = '', local = '') {
  const hoy = fechaCorta();
  let dHasta = /^\d{4}-\d{2}-\d{2}$/.test(hasta) ? hasta : hoy;
  let dDesde = /^\d{4}-\d{2}-\d{2}$/.test(desde) ? desde : sumarDias(hoy, -29);
  if (dDesde > dHasta) [dDesde, dHasta] = [dHasta, dDesde];
  if ((new Date(dHasta + 'T00:00:00Z') - new Date(dDesde + 'T00:00:00Z')) / 86400000 > 366) {
    dDesde = sumarDias(dHasta, -366);
  }

  let filtroLocal = String(local || '');
  if (sesion.rol === 'local') filtroLocal = String(sesion.localCarpeta || '');

  const nombresLocales = {};
  for (const l of await obtenerLocalesAdmin(env)) nombresLocales[l.carpeta] = l.nombre;

  const porDia = new Map();
  for (let f = dDesde; f <= dHasta; f = sumarDias(f, 1)) {
    porDia.set(f, { fecha: f, pedidos: 0, unidades: 0, ventas: 0 });
    if (porDia.size > 400) break;
  }

  const porProducto = new Map();
  const porLocal = new Map();
  let pedidosTotal = 0;
  let unidadesTotal = 0;
  let ventasTotal = 0;

  const resultado = await env.DB.prepare(
    `SELECT json FROM pedidos
     WHERE estado <> 'cancelado' AND creadoEn >= ?1 AND creadoEn <= ?2
     ORDER BY creadoEn ASC`
  )
    .bind(dDesde + ' 00:00:00', dHasta + ' 23:59:59')
    .all();

  for (const fila of resultado.results || []) {
    let p;
    try {
      p = JSON.parse(fila.json);
    } catch {
      continue;
    }
    const fecha = String(p.creadoEn || '').slice(0, 10);
    if (!fecha || fecha < dDesde || fecha > dHasta) continue;

    const localesDelPedido = new Set();
    let pedidoCuenta = false;
    let ventasPedido = 0;
    let unidadesPedido = 0;

    for (const g of p.items || []) {
      if (!g) continue;
      let carpeta = String(g.localCarpeta || '');
      if (!carpeta && String(g.tipo) === 'catalogo') carpeta = 'catalogo:' + String(g.catalogoId);
      if (!carpeta) continue;
      if (filtroLocal && carpeta !== filtroLocal) continue;

      let nombreLocal;
      if (nombresLocales[carpeta]) nombreLocal = nombresLocales[carpeta];
      else if (carpeta.startsWith('catalogo:')) nombreLocal = 'Catalogo EnRuta (' + carpeta.slice(9) + ')';
      else nombreLocal = carpeta;

      const ventaGrupo = (Number(g.subtotal) || 0) + (Number(g.empaquetadoMonto) || 0);
      const unidadesGrupo = Number(g.unidades) || 0;

      if (!porLocal.has(carpeta)) {
        porLocal.set(carpeta, { carpeta, nombre: nombreLocal, pedidos: 0, unidades: 0, ventas: 0 });
      }
      porLocal.get(carpeta).unidades += unidadesGrupo;
      porLocal.get(carpeta).ventas += ventaGrupo;

      for (const it of g.items || []) {
        if (!it) continue;
        const clave = carpeta + '|' + String(it.productoId);
        if (!porProducto.has(clave)) {
          porProducto.set(clave, {
            productoId: String(it.productoId),
            nombre: String(it.nombre),
            tipo: String(g.tipo),
            localCarpeta: carpeta,
            localNombre: nombreLocal,
            unidades: 0,
            ventas: 0,
            pedidos: new Set()
          });
        }
        const x = porProducto.get(clave);
        x.unidades += Number(it.cantidad) || 0;
        x.ventas += Number(it.subtotal) || 0;
        x.pedidos.add(String(p.id));
      }

      localesDelPedido.add(carpeta);
      pedidoCuenta = true;
      ventasPedido += ventaGrupo;
      unidadesPedido += unidadesGrupo;
    }

    if (!pedidoCuenta) continue;
    pedidosTotal++;
    unidadesTotal += unidadesPedido;
    ventasTotal += ventasPedido;
    if (porDia.has(fecha)) {
      const d = porDia.get(fecha);
      d.pedidos++;
      d.unidades += unidadesPedido;
      d.ventas += ventasPedido;
    }
    for (const c of localesDelPedido) {
      if (porLocal.has(c)) porLocal.get(c).pedidos++;
    }
  }

  const productosSalida = [];
  for (const x of porProducto.values()) {
    productosSalida.push({
      productoId: x.productoId,
      nombre: x.nombre,
      tipo: x.tipo,
      localCarpeta: x.localCarpeta,
      localNombre: x.localNombre,
      unidades: x.unidades,
      ventas: redondear2(x.ventas),
      pedidos: x.pedidos.size
    });
  }
  productosSalida.sort((a, b) => b.unidades - a.unidades || b.ventas - a.ventas);
  const porVentas = [...productosSalida].sort((a, b) => b.ventas - a.ventas || b.unidades - a.unidades);

  const localesSalida = [...porLocal.values()]
    .map((x) => ({ carpeta: x.carpeta, nombre: x.nombre, pedidos: x.pedidos, unidades: x.unidades, ventas: redondear2(x.ventas) }))
    .sort((a, b) => b.ventas - a.ventas);

  const diasSalida = [...porDia.values()].map((d) => ({
    fecha: d.fecha,
    pedidos: d.pedidos,
    unidades: d.unidades,
    ventas: redondear2(d.ventas)
  }));

  const ticket = pedidosTotal > 0 ? redondear2(ventasTotal / pedidosTotal) : 0;

  return {
    ok: true,
    desde: dDesde,
    hasta: dHasta,
    local: filtroLocal,
    resumen: {
      pedidos: pedidosTotal,
      unidades: unidadesTotal,
      ventas: redondear2(ventasTotal),
      ticketPromedio: ticket,
      productosVendidos: productosSalida.length
    },
    porDia: diasSalida,
    productos: productosSalida,
    topUnidades: productosSalida.slice(0, 10),
    topVentas: porVentas.slice(0, 10),
    locales: localesSalida
  };
}

/* ============================================================
   Importaciones (OCR en el navegador)
   ============================================================ */

const RE_IMPORTACION = /^imp-[a-z0-9-]{4,40}$/;

export async function obtenerImportacion(env, id, sesion) {
  if (!RE_IMPORTACION.test(String(id))) lanzar(404, 'Importacion no encontrada.');
  const imp = await leerDoc(env, 'importacion:' + id, null);
  if (!imp) lanzar(404, 'Importacion no encontrada.');
  if (sesion.rol === 'local' && String(imp.localCarpeta) !== String(sesion.localCarpeta)) {
    lanzar(403, 'Esa importacion no pertenece a tu local.');
  }
  return imp;
}

export async function guardarImportacion(env, imp) {
  if (!RE_IMPORTACION.test(String(imp.id))) lanzar(400, 'Identificador de importacion invalido.');
  await guardarDoc(env, 'importacion:' + imp.id, imp);
}

export async function procesarImportacionProductos(env, carpeta, importacion, entrantes, modo, sesion, ip) {
  const item = await obtenerLocalPorCarpeta(env, carpeta);
  if (!item) lanzar(404, 'El local no existe.');

  const existentes = item.productos;
  const porId = new Map(existentes.map((e) => [String(e.id), e]));
  const ids = new Set(existentes.map((e) => String(e.id)));
  const finales = new Map(existentes.map((e) => [String(e.id), e]));

  const errores = [];
  let publicados = 0;
  let borradores = 0;
  let omitidos = 0;
  let actualizados = 0;
  let nuevos = 0;

  for (const p of entrantes || []) {
    if (!p) continue;
    let accion = String(p.accion || '');
    if (!accion.trim()) accion = 'revisar';
    if (accion === 'omitir' || accion === 'mantener') {
      omitidos++;
      continue;
    }

    const nombre = String(p.nombre || '').trim();
    let precio = convertirNumero(p.precio);
    let tienePrecio = precio !== null && precio > 0;
    if (!tienePrecio) {
      for (const v of p.variantes || []) {
        if (!v) continue;
        const pv = convertirNumero(v.precio);
        if (pv !== null && pv > 0) {
          tienePrecio = true;
          break;
        }
      }
    }

    if (modo === 'publicar') {
      if (!nombre) {
        errores.push('Hay un producto sin nombre.');
        continue;
      }
      if (!tienePrecio) {
        errores.push(`El producto '${nombre}' no tiene precio valido.`);
        continue;
      }
      if ((p.revisar === true || accion === 'revisar') && accion !== 'forzar') {
        errores.push(`El producto '${nombre}' esta marcado para revision. Corrigelo o usa 'Publicar de todos modos'.`);
        continue;
      }
    }

    let idDestino = null;
    if ((accion === 'actualizar' || accion === 'forzar') && p.coincidencia && p.coincidencia.productoId) {
      idDestino = String(p.coincidencia.productoId);
    } else if (p.id && porId.has(String(p.id))) {
      idDestino = String(p.id);
    }

    const registro = normalizarProductoLocal(p, String(item.local.id), ids);
    if (modo === 'publicar') {
      registro.publicado = true;
      if (accion !== 'revisar') registro.revisar = false;
      publicados++;
    } else {
      registro.publicado = false;
      registro.revisar = true;
      borradores++;
    }
    registro.origen = 'ocr';

    if (idDestino && porId.has(idDestino)) {
      const anterior = porId.get(idDestino);
      registro.id = idDestino;
      if (modo === 'borrador' && anterior.publicado !== false) registro.publicado = anterior.publicado;
      if (modo === 'publicar' && anterior.publicado !== false) registro.publicado = true;
      finales.set(idDestino, registro);
      actualizados++;
    } else {
      finales.set(registro.id, registro);
      nuevos++;
    }
  }

  if (errores.length) {
    return { ok: false, errores, publicados: 0, borradores: 0 };
  }

  const lista = [...finales.values()];
  await guardarLocalCompleto(env, carpeta, item.local, lista, sesion.usuario, sesion.rol, ip);

  if (importacion) {
    importacion.estado = modo === 'publicar' ? 'publicado' : 'borrador';
    importacion.publicados = publicados;
    importacion.borradores = borradores;
    importacion.productos = entrantes;
    importacion.guardadoEn = fechaHora();
    await guardarImportacion(env, importacion);
  }

  await registrarAuditoria(env, {
    usuario: sesion.usuario,
    rol: sesion.rol,
    accion: 'ocr.' + modo,
    detalle: `Local ${carpeta}: ${publicados} publicados, ${borradores} borradores, ${omitidos} omitidos`,
    ip
  });

  return {
    ok: true,
    modo,
    importacionId: importacion ? String(importacion.id) : null,
    publicados,
    borradores,
    omitidos,
    actualizados,
    nuevos,
    total: lista.length
  };
}

export async function listarImportacionesSeguro(env, sesion, limite = 60) {
  return listarImportaciones(env, { rol: sesion.rol, localCarpeta: sesion.localCarpeta, limite });
}

export { huellaClave, validarFormatoClave, buscarUsuario, esTexto };
