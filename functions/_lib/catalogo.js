/* ============================================================
   EnRuta Delivery - Catálogo público
   Genera la misma forma que window.ENRUTA_DATA a partir de D1.
   ============================================================ */

import { cargarMapaDocs } from './almacen.js';
import { convertirNumero, fechaIsoLocal } from './comun.js';

function empaquetadoSalida(local) {
  const emp = local && local.empaquetado;
  if (!emp) {
    return { aplica: false, monto: 0, porUnidad: false, concepto: 'Sin recargo' };
  }
  const porUnidad = emp.porUnidad === true;
  let monto = convertirNumero(emp.monto);
  if (monto === null) monto = 0;
  if (emp.aplica === true) {
    return {
      aplica: monto > 0,
      monto,
      porUnidad,
      concepto: emp.concepto ? String(emp.concepto) : 'Empaquetado'
    };
  }
  return { aplica: false, monto: 0, porUnidad: false, concepto: 'Sin recargo' };
}

/* Las imágenes de cada local se guardan con ruta relativa a su carpeta
   (img/...). Aquí se convierten a la ruta pública que usa el navegador. */
function rutaImagenLocal(valor, carpeta) {
  if (!valor) return null;
  const v = String(valor).replace(/^\/+/, '');
  if (/^https?:/i.test(v)) return v;
  if (v.startsWith('media/') || v.startsWith('data/')) return '/' + v;
  return '/data/locales/' + carpeta + '/' + v;
}

/* Las imágenes de licores y primera necesidad se guardan relativas a su
   catálogo (img/...). Se resuelven a data/<catálogo>/img/... */
function rutaImagenCatalogo(valor, catalogoId) {
  if (!valor) return null;
  const v = String(valor).replace(/^\/+/, '');
  if (/^https?:/i.test(v)) return v;
  if (v.startsWith('media/') || v.startsWith('data/')) return '/' + v;
  return '/data/' + catalogoId + '/' + v;
}

function productosDelLocal(productosRaw, carpeta) {
  const salida = [];
  for (const p of productosRaw || []) {
    if (!p || !p.id || !p.nombre) continue;

    const disponible = p.disponible !== false;
    const publicado = p.publicado !== false;
    const precio = convertirNumero(p.precio);
    const precioValido = precio !== null && precio > 0;

    const variantes = [];
    for (const v of p.variantes || []) {
      if (!v || !v.nombre) continue;
      const pv = convertirNumero(v.precio);
      if (pv === null || pv <= 0) continue;
      variantes.push({
        id: v.id ? String(v.id) : 'v' + (variantes.length + 1),
        nombre: String(v.nombre),
        precio: pv
      });
    }

    const extras = [];
    for (const e of p.extras || []) {
      if (!e || !e.nombre) continue;
      const pe = convertirNumero(e.precio);
      extras.push({ nombre: String(e.nombre), precio: pe === null ? 0 : pe });
    }

    if (publicado && !precioValido && variantes.length === 0) continue;
    if (!publicado || !disponible) continue;

    salida.push({
      id: p.id,
      nombre: p.nombre,
      descripcion: p.descripcion,
      precio: precioValido ? precio : 0,
      grupo: p.grupo,
      subcategoria: p.subcategoria,
      emoji: p.emoji,
      etiqueta: p.etiqueta,
      imagen: rutaImagenLocal(p.imagen, carpeta),
      variantes,
      extras,
      origen: p.origen
    });
  }
  return salida;
}

function catalogoSalida(id, nombre, categoriasRaw, productosRaw) {
  const categorias = [];
  const mapa = new Map();
  for (const c of categoriasRaw || []) {
    if (!c || !c.id || !c.nombre) continue;
    if (mapa.has(c.id)) continue;
    mapa.set(c.id, c.nombre);
    categorias.push({ id: c.id, nombre: c.nombre });
  }

  const productos = [];
  for (const p of productosRaw || []) {
    if (!p || !p.id || !p.nombre) continue;
    if (!p.categoriaId || !mapa.has(p.categoriaId)) continue;
    if (!p.fuente || !p.fuente.url) continue;
    if (p.publicado === false || p.disponible === false) continue;
    if (p.precioVenta === null || p.precioVenta === undefined) continue;
    const precioVenta = convertirNumero(p.precioVenta);
    if (precioVenta === null || precioVenta <= 0) continue;
    const precioReferencia = convertirNumero(p.precioReferencia);
    productos.push({
      id: p.id,
      nombre: p.nombre,
      marca: p.marca,
      categoriaId: p.categoriaId,
      presentacion: p.presentacion,
      imagen: rutaImagenCatalogo(p.imagen, id),
      precioVenta,
      precioReferencia,
      fuente: {
        tienda: p.fuente.tienda,
        url: p.fuente.url,
        productoId: p.fuente.productoId !== null && p.fuente.productoId !== undefined ? String(p.fuente.productoId) : '',
        fechaVerificacion: p.fuente.fechaVerificacion
      },
      estado: p.estado
    });
  }

  return { id, nombre, categorias, productos };
}

export async function construirCatalogo(env) {
  const mapa = await cargarMapaDocs(env);
  const config = mapa.get('config') || {};
  const categoriasLocales = mapa.get('categoriasLocales') || [];
  const indice = mapa.get('indiceLocales') || [];

  const mapaCategorias = new Map();
  for (const c of categoriasLocales) {
    if (c && c.id) mapaCategorias.set(c.id, c.nombre);
  }

  const mapaZonas = new Map();
  for (const z of config.zonas || []) {
    if (z && z.id) mapaZonas.set(String(z.id), z.nombre);
  }
  const zonaPorDefecto = String(config.zonaPrincipal || (config.zonas && config.zonas[0] && config.zonas[0].id) || '');

  const resumen = {
    locales: 0,
    localesPublicados: 0,
    localesEjemplo: 0,
    productosLocales: 0,
    licores: 0,
    primeraNecesidad: 0
  };

  const locales = [];
  for (const carpeta of indice) {
    const local = mapa.get('local:' + carpeta);
    if (!local) continue;
    const productos = productosDelLocal(mapa.get('local:' + carpeta + ':productos') || [], carpeta);

    resumen.locales++;
    resumen.productosLocales += productos.length;
    if (local.publicado === true) resumen.localesPublicados++;
    if (local.esEjemplo === true) resumen.localesEjemplo++;

    const zonaId = String(local.zonaId || zonaPorDefecto);
    locales.push({
      id: local.id,
      nombre: local.nombre,
      tipo: local.tipo === 'comida' ? 'comida' : 'productos',
      categoriaId: local.categoriaId,
      categoriaNombre: mapaCategorias.get(local.categoriaId) || local.categoriaId || '',
      zonaId,
      zonaNombre: mapaZonas.get(zonaId) || zonaId,
      descripcion: local.descripcion,
      publicado: local.publicado === true,
      disponible: local.disponible !== false,
      esEjemplo: local.esEjemplo === true,
      emoji: local.emoji,
      colores: local.colores || [],
      logo: rutaImagenLocal(local.logo, carpeta),
      portada: rutaImagenLocal(local.portada, carpeta),
      cartaOriginal: rutaImagenLocal(local.cartaOriginal, carpeta),
      tiempo: local.tiempo,
      pedidoMinimo: local.pedidoMinimo,
      horarioLocal: local.horarioLocal,
      etiquetas: local.etiquetas || [],
      nuevo: local.nuevo === true,
      empaquetado: empaquetadoSalida(local),
      notas: local.notas,
      productos
    });
  }

  const licores = catalogoSalida(
    'licores',
    'Licores',
    mapa.get('catalogo:licores:categorias') || [],
    mapa.get('catalogo:licores:productos') || []
  );
  const primeraNecesidad = catalogoSalida(
    'primera-necesidad',
    'Primera necesidad',
    mapa.get('catalogo:primera-necesidad:categorias') || [],
    mapa.get('catalogo:primera-necesidad:productos') || []
  );
  resumen.licores = licores.productos.length;
  resumen.primeraNecesidad = primeraNecesidad.productos.length;

  return {
    generadoEn: fechaIsoLocal(),
    config,
    categoriasLocales: categoriasLocales.map((c) => ({ id: c.id, nombre: c.nombre })),
    locales,
    catalogos: [licores, primeraNecesidad],
    resumen
  };
}
