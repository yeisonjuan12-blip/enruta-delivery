/* ============================================================
   EnRuta Delivery - Acceso a D1
   ------------------------------------------------------------
   D1 limita el tamaño de cada sentencia SQL (100 KB). Los
   documentos JSON grandes (catálogos con cientos de productos)
   se guardan en trozos de 24 000 caracteres:

     clave                 -> {"__enrutatrozos": 4}
     clave#0001 ... #0004  -> fragmentos de texto JSON

   leerDoc() y cargarMapaDocs() los unen de forma transparente.
   ============================================================ */

import { fechaHora } from './comun.js';

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
    // No partir un par surrogado (emojis).
    if (fin < texto.length) {
      const codigo = texto.charCodeAt(fin - 1);
      if (codigo >= 0xd800 && codigo <= 0xdbff) fin--;
    }
    trozos.push(texto.slice(inicio, fin));
    inicio = fin;
  }
  return trozos.length ? trozos : [''];
}

function unirTrozos(clave, cantidad, crudos) {
  let texto = '';
  for (let i = 1; i <= cantidad; i++) {
    const trozo = crudos.get(nombreTrozo(clave, i));
    if (typeof trozo !== 'string') return null;
    texto += trozo;
  }
  try {
    return JSON.parse(texto);
  } catch {
    return null;
  }
}

function esManifiesto(valor) {
  return valor && typeof valor === 'object' && Number.isInteger(valor[MARCA]) && valor[MARCA] > 0;
}

export async function leerDoc(env, clave, predeterminado = null) {
  const fila = await env.DB.prepare('SELECT json FROM docs WHERE clave = ?1').bind(clave).first();
  if (!fila || typeof fila.json !== 'string') return predeterminado;

  let valor;
  try {
    valor = JSON.parse(fila.json);
  } catch {
    return predeterminado;
  }

  if (esManifiesto(valor)) {
    const cantidad = valor[MARCA];
    const claves = [];
    for (let i = 1; i <= cantidad; i++) claves.push(nombreTrozo(clave, i));
    const marcadores = claves.map((_, i) => '?' + (i + 1)).join(', ');
    const partes = await env.DB.prepare(`SELECT clave, json FROM docs WHERE clave IN (${marcadores})`)
      .bind(...claves)
      .all();
    const crudos = new Map();
    for (const p of partes.results || []) crudos.set(p.clave, p.json);
    const unido = unirTrozos(clave, cantidad, crudos);
    return unido === null ? predeterminado : unido;
  }

  return valor;
}

export async function guardarDoc(env, clave, valor) {
  const texto = JSON.stringify(valor);
  const ahora = fechaHora();
  const sentencias = [];
  const patronTrozos = clave + '#%';

  if (texto.length <= LARGO_TROZO) {
    sentencias.push(
      env.DB.prepare(
        `INSERT INTO docs (clave, json, actualizadoEn) VALUES (?1, ?2, ?3)
         ON CONFLICT(clave) DO UPDATE SET json = excluded.json, actualizadoEn = excluded.actualizadoEn`
      ).bind(clave, texto, ahora)
    );
    sentencias.push(env.DB.prepare('DELETE FROM docs WHERE clave LIKE ?1').bind(patronTrozos));
  } else {
    const trozos = dividirTexto(texto);
    sentencias.push(
      env.DB.prepare(
        `INSERT INTO docs (clave, json, actualizadoEn) VALUES (?1, ?2, ?3)
         ON CONFLICT(clave) DO UPDATE SET json = excluded.json, actualizadoEn = excluded.actualizadoEn`
      ).bind(clave, JSON.stringify({ [MARCA]: trozos.length }), ahora)
    );
    for (let i = 0; i < trozos.length; i++) {
      sentencias.push(
        env.DB.prepare(
          `INSERT INTO docs (clave, json, actualizadoEn) VALUES (?1, ?2, ?3)
           ON CONFLICT(clave) DO UPDATE SET json = excluded.json, actualizadoEn = excluded.actualizadoEn`
        ).bind(nombreTrozo(clave, i + 1), trozos[i], ahora)
      );
    }
    // Borra trozos sobrantes de una versión anterior más larga.
    sentencias.push(
      env.DB.prepare('DELETE FROM docs WHERE clave LIKE ?1 AND clave > ?2').bind(
        patronTrozos,
        nombreTrozo(clave, trozos.length)
      )
    );
  }

  await env.DB.batch(sentencias);
}

export async function borrarDoc(env, clave) {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM docs WHERE clave = ?1').bind(clave),
    env.DB.prepare('DELETE FROM docs WHERE clave LIKE ?1').bind(clave + '#%')
  ]);
}

/**
 * Carga en memoria todos los documentos que forman el catálogo público.
 * Es una sola consulta: con ~30 documentos el costo es mínimo.
 */
export async function cargarMapaDocs(env) {
  const resultado = await env.DB.prepare(
    `SELECT clave, json FROM docs
     WHERE clave <> 'usuarios' AND clave NOT LIKE 'importacion:%'`
  ).all();

  const crudos = new Map();
  for (const fila of resultado.results || []) {
    if (typeof fila.json === 'string') crudos.set(fila.clave, fila.json);
  }

  const mapa = new Map();
  for (const [clave, crudo] of crudos) {
    if (clave.includes('#')) continue;
    let valor;
    try {
      valor = JSON.parse(crudo);
    } catch {
      continue;
    }
    if (esManifiesto(valor)) {
      valor = unirTrozos(clave, valor[MARCA], crudos);
      if (valor === null) continue;
    }
    mapa.set(clave, valor);
  }
  return mapa;
}

export async function registrarAuditoria(env, { usuario, rol, accion, detalle, ip }) {
  try {
    await env.DB.prepare(
      'INSERT INTO auditoria (fecha, usuario, rol, accion, detalle, ip) VALUES (?1, ?2, ?3, ?4, ?5, ?6)'
    )
      .bind(fechaHora(), String(usuario || ''), String(rol || ''), String(accion || ''), String(detalle || ''), String(ip || ''))
      .run();
  } catch (e) {
    console.error('No se pudo escribir auditoria:', e);
  }
}

export async function leerAuditoria(env, limite = 100) {
  const tope = Math.max(1, Math.min(500, Number(limite) || 100));
  const resultado = await env.DB.prepare(
    'SELECT fecha, usuario, rol, accion, detalle, ip FROM auditoria ORDER BY id DESC LIMIT ?1'
  )
    .bind(tope)
    .all();
  return resultado.results || [];
}

export async function listarImportaciones(env, { rol, localCarpeta, limite = 60 } = {}) {
  const tope = Math.max(1, Math.min(200, Number(limite) || 60));
  const resultado = await env.DB.prepare(
    `SELECT clave, json FROM docs
     WHERE clave LIKE 'importacion:%'
     ORDER BY actualizadoEn DESC
     LIMIT ?1`
  )
    .bind(tope)
    .all();
  const salida = [];
  for (const fila of resultado.results || []) {
    let imp;
    try {
      imp = JSON.parse(fila.json);
    } catch {
      continue;
    }
    if (rol === 'local' && String(imp.localCarpeta) !== String(localCarpeta)) continue;
    salida.push({
      id: imp.id,
      localCarpeta: imp.localCarpeta,
      localNombre: imp.localNombre,
      creadoEn: imp.creadoEn,
      creadoPor: imp.creadoPor,
      estado: imp.estado,
      archivos: (imp.archivos || []).map((a) => a.nombre),
      totalProductos: (imp.productos || []).length,
      publicados: imp.publicados
    });
  }
  return salida;
}
