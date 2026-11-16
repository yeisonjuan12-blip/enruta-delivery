#!/usr/bin/env node
/* ============================================================
   EnRuta Delivery - Generador de db/seed.sql para D1
   ------------------------------------------------------------
   Lee data/*.json y server/datos/*.json y produce las sentencias
   SQL que cargan D1 con el catálogo, la configuración, los
   usuarios y el historial existente.

   Uso:
     node tools/sembrar-d1.js --secreto=...   (o ENRUTA_SECRET)
     node tools/sembrar-d1.js --secreto=... --admin-clave=Nueva12345
     node tools/sembrar-d1.js --secreto=... --salida=db/seed.sql

   IMPORTANTE: db/seed.sql contiene datos personales y huellas de
   contraseñas. No debe subirse a Git (ver .gitignore).
   ============================================================ */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const RAIZ = path.resolve(__dirname, '..');
const DATA = path.join(RAIZ, 'data');
const DATOS_SERVIDOR = path.join(RAIZ, 'server', 'datos');
const SALIDA_POR_DEFECTO = path.join(RAIZ, 'db', 'seed.sql');

function argumento(nombre) {
  const prefijo = '--' + nombre + '=';
  const encontrado = process.argv.find((a) => a.startsWith(prefijo));
  return encontrado ? encontrado.slice(prefijo.length) : '';
}

function leerJson(ruta, predeterminado = null) {
  try {
    const texto = fs.readFileSync(ruta, 'utf8').replace(/^\uFEFF/, '');
    return JSON.parse(texto);
  } catch (error) {
    if (predeterminado !== null) return predeterminado;
    throw new Error(`No se pudo leer ${ruta}: ${error.message}`);
  }
}

function existe(ruta) {
  try {
    return fs.statSync(ruta).isFile();
  } catch {
    return false;
  }
}

function listarCarpetas(ruta) {
  try {
    return fs.readdirSync(ruta, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return [];
  }
}

function sql(valor) {
  if (valor === null || valor === undefined) return 'NULL';
  return "'" + String(valor).replace(/'/g, "''") + "'";
}

function numero(valor, predeterminado = 0) {
  const n = Number(valor);
  return Number.isFinite(n) ? n : predeterminado;
}

function jsonSeguro(valor) {
  return sql(JSON.stringify(valor === undefined ? null : valor));
}

/* ---------------- Troceado de documentos ----------------
   D1 rechaza sentencias SQL de más de ~100 KB. Los documentos
   grandes se guardan igual que en functions/_lib/almacen.js:
     clave                -> {"__enrutatrozos":N}
     clave#0001 ... #00NN  -> trozos de texto de 24000 caracteres
   --------------------------------------------------------- */

const LARGO_TROZO = 24000;
const MARCA = '__enrutatrozos';

function nombreTrozo(clave, indice) {
  return clave + '#' + String(indice).padStart(4, '0');
}

function dividirTexto(texto) {
  const trozos = [];
  let inicio = 0;
  while (inicio < texto.length) {
    let fin = Math.min(texto.length, inicio + LARGO_TROZO);
    if (fin < texto.length) {
      const codigo = texto.charCodeAt(fin - 1);
      if (codigo >= 0xd800 && codigo <= 0xdbff) fin--;
    }
    trozos.push(texto.slice(inicio, fin));
    inicio = fin;
  }
  return trozos.length ? trozos : [''];
}

function insertarDoc(clave, texto, ahora) {
  return (
    `INSERT INTO docs (clave, json, actualizadoEn) VALUES (${sql(clave)}, ${sql(texto)}, ${sql(ahora)})` +
    ` ON CONFLICT(clave) DO UPDATE SET json = excluded.json, actualizadoEn = excluded.actualizadoEn;`
  );
}

function sentenciasDocumento(clave, valor, ahora) {
  const texto = JSON.stringify(valor === undefined ? null : valor);
  const salida = [`DELETE FROM docs WHERE clave LIKE ${sql(clave + '#%')};`];
  if (texto.length <= LARGO_TROZO) {
    salida.push(insertarDoc(clave, texto, ahora));
    return salida;
  }
  const trozos = dividirTexto(texto);
  salida.push(insertarDoc(clave, JSON.stringify({ [MARCA]: trozos.length }), ahora));
  for (let i = 0; i < trozos.length; i++) {
    salida.push(insertarDoc(nombreTrozo(clave, i + 1), trozos[i], ahora));
  }
  return salida;
}

function hmacClave(secreto, claveDerivada) {
  return crypto.createHmac('sha256', secreto).update('clave:' + String(claveDerivada)).digest('base64');
}

function pbkdf2Clave(password, saltBytes, iteraciones) {
  return crypto.pbkdf2Sync(String(password), saltBytes, Number(iteraciones) || 120000, 32, 'sha256').toString('base64');
}

/* ---------------- Recolección ---------------- */

const documentos = [];
function documento(clave, valor) {
  documentos.push({ clave, valor });
}

function principal() {
  const secreto = argumento('secreto') || process.env.ENRUTA_SECRET || '';
  if (!secreto || secreto.length < 24) {
    console.error('\nFalta el secreto ENRUTA_SECRET (mínimo 24 caracteres).');
    console.error('Ejemplo: node tools/sembrar-d1.js --secreto="..."\n');
    process.exit(1);
  }
  const salida = argumento('salida') ? path.resolve(RAIZ, argumento('salida')) : SALIDA_POR_DEFECTO;
  const adminClave = argumento('admin-clave') || process.env.ENRUTA_ADMIN_CLAVE || '';

  const avisos = [];
  const resumen = { documentos: 0, locales: 0, productosLocales: 0, licores: 0, primeraNecesidad: 0, usuarios: 0, pedidos: 0, servicios: 0, importaciones: 0 };

  /* Configuración */
  const config = leerJson(path.join(DATA, 'config.json'));
  documento('config', config);

  /* Categorías e índice de locales */
  const categoriasDoc = leerJson(path.join(DATA, 'locales', 'categorias.json'), { categorias: [] });
  documento('categoriasLocales', Array.isArray(categoriasDoc.categorias) ? categoriasDoc.categorias : []);

  const indiceDoc = leerJson(path.join(DATA, 'locales', 'locales.json'), { locales: [] });
  const indice = [];
  const carpetas = listarCarpetas(path.join(DATA, 'locales')).filter((c) => /^local-[0-9]{3,4}$/.test(c));
  for (const carpeta of carpetas) {
    const rutaLocal = path.join(DATA, 'locales', carpeta, 'local.json');
    const rutaProductos = path.join(DATA, 'locales', carpeta, 'productos.json');
    if (!existe(rutaLocal)) {
      avisos.push(`Se omite ${carpeta}: no tiene local.json`);
      continue;
    }
    const local = leerJson(rutaLocal);
    const productos = existe(rutaProductos) ? leerJson(rutaProductos, { productos: [] }) : { productos: [] };
    const lista = Array.isArray(productos.productos) ? productos.productos : [];
    documento('local:' + carpeta, local);
    documento('local:' + carpeta + ':productos', lista);
    indice.push(carpeta);
    resumen.locales++;
    resumen.productosLocales += lista.length;
  }
  documento('indiceLocales', indice);

  /* Catálogos globales */
  for (const [id, etiqueta] of [['licores', 'licores'], ['primera-necesidad', 'primeraNecesidad']]) {
    const categorias = leerJson(path.join(DATA, id, 'categorias.json'), { categorias: [] });
    const productos = leerJson(path.join(DATA, id, 'productos.json'), { productos: [] });
    const listaCat = Array.isArray(categorias.categorias) ? categorias.categorias : [];
    const listaProd = Array.isArray(productos.productos) ? productos.productos : [];
    documento(`catalogo:${id}:categorias`, listaCat);
    documento(`catalogo:${id}:productos`, listaProd);
    resumen[etiqueta] = listaProd.length;
  }

  /* Usuarios */
  const usuariosDoc = leerJson(path.join(DATOS_SERVIDOR, 'usuarios.json'), { version: 1, sesionMinutos: 480, usuarios: [] });
  const usuarios = [];
  for (const u of usuariosDoc.usuarios || []) {
    const iteraciones = Math.min(500000, Math.max(10000, Number(u.iteraciones) || 120000));
    let passwordSalt = String(u.passwordSalt || '');
    let claveOriginal = String(u.passwordHash || u.claveHash || '');
    let claveHash;

    const esAdminObjetivo = adminClave && String(u.usuario).toLowerCase() === 'admin';
    if (esAdminObjetivo) {
      const salBytes = crypto.randomBytes(16);
      passwordSalt = salBytes.toString('base64');
      claveOriginal = pbkdf2Clave(adminClave, salBytes, iteraciones);
      claveHash = hmacClave(secreto, claveOriginal);
      avisos.push('La contraseña del usuario admin fue reemplazada por la indicada con --admin-clave.');
    } else if (claveOriginal) {
      // El hash original ya es Base64(PBKDF2-SHA256(password, salt, iteraciones)).
      // El navegador calcula exactamente lo mismo, así que se conserva el acceso.
      claveHash = hmacClave(secreto, claveOriginal);
    } else {
      avisos.push(`El usuario ${u.usuario} no tiene contraseña utilizable; se omite.`);
      continue;
    }

    usuarios.push({
      usuario: String(u.usuario).trim().toLowerCase(),
      nombre: String(u.nombre || u.usuario || ''),
      rol: u.rol === 'admin' ? 'admin' : 'local',
      localCarpeta: u.rol === 'local' ? String(u.localCarpeta || '') || null : null,
      passwordSalt,
      claveHash,
      iteraciones,
      creadoEn: String(u.creadoEn || ''),
      activo: u.activo !== false,
      intentos: 0,
      bloqueadoHasta: null,
      ultimoAcceso: u.ultimoAcceso || null
    });
    resumen.usuarios++;
  }
  documento('usuarios', { version: 1, sesionMinutos: Number(usuariosDoc.sesionMinutos) || 480, usuarios });

  /* Pedidos */
  const pedidosDoc = leerJson(path.join(DATOS_SERVIDOR, 'pedidos.json'), { pedidos: [] });
  const pedidos = Array.isArray(pedidosDoc.pedidos) ? pedidosDoc.pedidos : [];

  /* Servicios */
  const serviciosDoc = leerJson(path.join(DATOS_SERVIDOR, 'servicios.json'), { envios: [], taximotos: [] });
  const servicios = [];
  for (const tipo of ['envio', 'taximoto']) {
    const clave = tipo === 'envio' ? 'envios' : 'taximotos';
    for (const s of serviciosDoc[clave] || []) {
      servicios.push({ ...s, tipo: s.tipo || tipo, estado: s.estado || 'pendiente' });
    }
  }

  /* Importaciones OCR */
  const carpetaImportaciones = path.join(DATOS_SERVIDOR, 'importaciones');
  const importaciones = [];
  if (fs.existsSync(carpetaImportaciones)) {
    for (const archivo of fs.readdirSync(carpetaImportaciones)) {
      if (!/^imp-[a-z0-9-]+\.json$/i.test(archivo)) continue;
      const imp = leerJson(path.join(carpetaImportaciones, archivo), null);
      if (!imp || !imp.id) continue;
      documento('importacion:' + imp.id, imp);
      importaciones.push(imp.id);
    }
  }

  /* ---------------- SQL ---------------- */

  const lineas = [];
  lineas.push('-- EnRuta Delivery · datos iniciales para D1');
  lineas.push('-- Generado por tools/sembrar-d1.js el ' + new Date().toISOString());
  lineas.push('-- NO SUBIR A GIT: contiene datos personales y huellas de contraseñas.');
  lineas.push('');
  lineas.push('PRAGMA foreign_keys = ON;');
  lineas.push('');

  const ahora = new Date().toISOString().slice(0, 19).replace('T', ' ');
  for (const { clave, valor } of documentos) {
    for (const sentencia of sentenciasDocumento(clave, valor, ahora)) lineas.push(sentencia);
  }
  lineas.push('');

  for (const p of pedidos) {
    const carpetas = Array.isArray(p.localCarpetas) ? p.localCarpetas : [];
    lineas.push(
      `INSERT INTO pedidos (id, creadoEn, estado, total, unidades, localCarpetas, json)` +
        ` VALUES (${sql(p.id)}, ${sql(p.creadoEn || '')}, ${sql(p.estado || 'nuevo')}, ${numero(p.total)}, ${numero(p.unidades)}, ${jsonSeguro(carpetas)}, ${jsonSeguro(p)})` +
        ` ON CONFLICT(id) DO UPDATE SET estado = excluded.estado, json = excluded.json;`
    );
  }
  lineas.push('');

  for (const s of servicios) {
    lineas.push(
      `INSERT INTO servicios (id, tipo, creadoEn, estado, json)` +
        ` VALUES (${sql(s.id)}, ${sql(s.tipo)}, ${sql(s.creadoEn || '')}, ${sql(s.estado)}, ${jsonSeguro(s)})` +
        ` ON CONFLICT(id) DO UPDATE SET estado = excluded.estado, json = excluded.json;`
    );
  }
  lineas.push('');

  fs.mkdirSync(path.dirname(salida), { recursive: true });
  fs.writeFileSync(salida, lineas.join('\n') + '\n', 'utf8');

  resumen.documentos = documentos.length;
  resumen.pedidos = pedidos.length;
  resumen.servicios = servicios.length;
  resumen.importaciones = importaciones.length;

  console.log('\nEnRuta Delivery · seed generado');
  console.log('Archivo:', salida);
  console.log('Documentos:', resumen.documentos);
  console.log('Locales:', resumen.locales, '· productos de locales:', resumen.productosLocales);
  console.log('Licores:', resumen.licores, '· primera necesidad:', resumen.primeraNecesidad);
  console.log('Usuarios:', resumen.usuarios);
  console.log('Pedidos:', resumen.pedidos, '· servicios:', resumen.servicios, '· importaciones:', resumen.importaciones);
  console.log('Tamaño:', (fs.statSync(salida).size / 1024).toFixed(1), 'KB');
  if (avisos.length) {
    console.log('\nAvisos:');
    for (const a of avisos) console.log(' -', a);
  }
  console.log('');
}

try {
  principal();
} catch (error) {
  console.error('\nError:', error.message, '\n');
  process.exit(1);
}
