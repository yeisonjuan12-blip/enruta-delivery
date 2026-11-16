/* ============================================================
   EnRuta Delivery - Autenticación sin estado
   ------------------------------------------------------------
   La contraseña se deriva en el navegador con PBKDF2-SHA256
   (120000 iteraciones) y al servidor solo llega la clave
   derivada. El servidor guarda HMAC(secreto, claveDerivada),
   de modo que una copia de la base no permite iniciar sesión
   sin el secreto del proyecto.

   La sesión es una cookie firmada con HMAC-SHA256: no necesita
   tabla de sesiones y se valida en cada petición.
   ============================================================ */

import { leerDoc, guardarDoc, registrarAuditoria } from './almacen.js';
import {
  lanzar,
  bytesAB64 as b64,
  b64urlATexto,
  bytesAB64url,
  bytesAleatorios,
  compararTiempoConstante,
  deB64,
  esTexto,
  fechaHora,
  hmacBytes,
  ipCliente,
  normalizarTexto,
  textoAB64url
} from './comun.js';

export const COOKIE_SESION = 'enruta_sesion';
export const ITERACIONES_PBKDF2 = 120000;
export const SESION_MINUTOS_DEFECTO = 480;

const CLAVE_USUARIOS = 'usuarios';

export function secreto(env) {
  const valor = env && env.ENRUTA_SECRET;
  if (!valor || String(valor).length < 24) {
    lanzar(500, 'Falta configurar el secreto ENRUTA_SECRET del servidor.');
  }
  return String(valor);
}

export async function leerUsuarios(env) {
  const doc = await leerDoc(env, CLAVE_USUARIOS, null);
  if (!doc || !Array.isArray(doc.usuarios)) {
    return { version: 1, sesionMinutos: SESION_MINUTOS_DEFECTO, usuarios: [] };
  }
  if (!doc.sesionMinutos) doc.sesionMinutos = SESION_MINUTOS_DEFECTO;
  return doc;
}

export async function guardarUsuarios(env, doc) {
  await guardarDoc(env, CLAVE_USUARIOS, doc);
}

export function buscarUsuario(doc, nombre) {
  const buscado = normalizarTexto(nombre);
  return (doc.usuarios || []).find((u) => normalizarTexto(u.usuario) === buscado) || null;
}

/** HMAC del secreto sobre la clave derivada. Se usa como huella en la base. */
export async function huellaClave(env, claveDerivada) {
  return b64(await hmacBytes(secreto(env), 'clave:' + String(claveDerivada)));
}

/** Sal ficticia y estable para no revelar si un usuario existe. */
export async function salFicticia(env, usuario) {
  const bytes = await hmacBytes(secreto(env), 'sal:' + normalizarTexto(usuario));
  return b64(bytes.slice(0, 16));
}

export async function obtenerSal(env, usuario) {
  const doc = await leerUsuarios(env);
  const u = buscarUsuario(doc, usuario);
  if (!u || u.activo === false) {
    return { salt: await salFicticia(env, usuario), iteraciones: ITERACIONES_PBKDF2 };
  }
  return {
    salt: String(u.passwordSalt || ''),
    iteraciones: Number(u.iteraciones) || ITERACIONES_PBKDF2
  };
}

export function validarFormatoClave(clave, salt, iteraciones) {
  if (!esTexto(clave) || String(clave).length < 20) {
    lanzar(400, 'La clave derivada no es valida.');
  }
  try {
    if (deB64(clave).length !== 32) lanzar(400, 'La clave derivada no es valida.');
  } catch {
    lanzar(400, 'La clave derivada no es valida.');
  }
  if (!esTexto(salt)) lanzar(400, 'Falta la sal de la contraseña.');
  try {
    const bytes = deB64(salt);
    if (bytes.length < 8 || bytes.length > 64) lanzar(400, 'La sal de la contraseña no es valida.');
  } catch {
    lanzar(400, 'La sal de la contraseña no es valida.');
  }
  const iter = Number(iteraciones) || ITERACIONES_PBKDF2;
  if (iter < 10000 || iter > 500000) lanzar(400, 'El numero de iteraciones no es valido.');
  return iter;
}

export async function verificarCredenciales(env, usuario, clave) {
  const doc = await leerUsuarios(env);
  const u = buscarUsuario(doc, usuario);
  const huellaCalculada = await huellaClave(env, clave);

  if (!u) {
    // Comparación contra una huella ficticia para no filtrar por tiempo.
    compararTiempoConstante(huellaCalculada, await huellaClave(env, 'usuario-inexistente'));
    return null;
  }
  if (u.activo === false) return null;

  if (u.bloqueadoHasta) {
    const hasta = Date.parse(u.bloqueadoHasta);
    if (Number.isFinite(hasta) && hasta > Date.now()) {
      lanzar(429, 'Demasiados intentos fallidos. Espera unos minutos antes de volver a intentar.');
    }
  }

  if (!compararTiempoConstante(huellaCalculada, String(u.claveHash || ''))) {
    u.intentos = (Number(u.intentos) || 0) + 1;
    if (u.intentos >= 5) {
      u.bloqueadoHasta = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      u.intentos = 0;
    }
    await guardarUsuarios(env, doc);
    return null;
  }

  u.intentos = 0;
  u.bloqueadoHasta = null;
  u.ultimoAcceso = fechaHora();
  await guardarUsuarios(env, doc);
  return u;
}

/* ---------------- Sesión firmada ---------------- */

function minutosSesion(docUsuarios) {
  let minutos = Number(docUsuarios && docUsuarios.sesionMinutos) || SESION_MINUTOS_DEFECTO;
  if (minutos < 15) minutos = 15;
  if (minutos > 1440) minutos = 1440;
  return minutos;
}

async function firmarPayload(env, payload) {
  const cuerpo = textoAB64url(JSON.stringify(payload));
  const firma = await hmacBytes(secreto(env), cuerpo);
  return cuerpo + '.' + bytesAB64url(firma);
}

async function leerPayload(env, token) {
  if (!esTexto(token)) return null;
  const punto = token.lastIndexOf('.');
  if (punto <= 0) return null;
  const cuerpo = token.slice(0, punto);
  const firma = token.slice(punto + 1);
  const esperada = bytesAB64url(await hmacBytes(secreto(env), cuerpo));
  if (!compararTiempoConstante(firma, esperada)) return null;
  let payload;
  try {
    payload = JSON.parse(b64urlATexto(cuerpo));
  } catch {
    return null;
  }
  if (!payload || !payload.u || !payload.e) return null;
  if (Number(payload.e) * 1000 <= Date.now()) return null;
  return payload;
}

function leerCookie(request, nombre) {
  const cabecera = request.headers.get('cookie') || '';
  for (const parte of cabecera.split(';')) {
    const trozo = parte.trim();
    const igual = trozo.indexOf('=');
    if (igual < 0) continue;
    if (trozo.slice(0, igual) === nombre) return trozo.slice(igual + 1);
  }
  return null;
}

function cookieSesion(request, valor, maxAge) {
  const seguro = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${COOKIE_SESION}=${valor}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${seguro}`;
}

export async function crearSesion(env, request, usuarioRegistro) {
  const doc = await leerUsuarios(env);
  const minutos = minutosSesion(doc);
  const csrf = bytesAB64url(bytesAleatorios(24));
  const expira = Math.floor(Date.now() / 1000) + minutos * 60;
  const token = await firmarPayload(env, {
    u: String(usuarioRegistro.usuario),
    c: csrf,
    e: expira
  });
  return {
    cookie: cookieSesion(request, token, minutos * 60),
    sesion: {
      usuario: String(usuarioRegistro.usuario),
      nombre: String(usuarioRegistro.nombre || ''),
      rol: String(usuarioRegistro.rol || 'local'),
      localCarpeta: usuarioRegistro.localCarpeta ? String(usuarioRegistro.localCarpeta) : '',
      csrf,
      expiraEn: new Date(expira * 1000).toISOString()
    }
  };
}

export async function leerSesion(env, request) {
  const token = leerCookie(request, COOKIE_SESION);
  if (!token) return null;
  const payload = await leerPayload(env, token);
  if (!payload) return null;
  const doc = await leerUsuarios(env);
  const u = buscarUsuario(doc, payload.u);
  if (!u || u.activo === false) return null;
  return {
    usuario: String(u.usuario),
    nombre: String(u.nombre || ''),
    rol: String(u.rol || 'local'),
    localCarpeta: u.localCarpeta ? String(u.localCarpeta) : '',
    csrf: String(payload.c || ''),
    expiraEn: new Date(Number(payload.e) * 1000).toISOString()
  };
}

export async function requerirSesion(env, request, roles = ['admin', 'local']) {
  const sesion = await leerSesion(env, request);
  if (!sesion) lanzar(401, 'Debes iniciar sesion.');
  if (roles && !roles.includes(sesion.rol)) {
    lanzar(403, 'No tienes permisos para esta operacion.');
  }
  return sesion;
}

export function validarCsrf(request, sesion) {
  const metodo = request.method.toUpperCase();
  if (['GET', 'HEAD', 'OPTIONS'].includes(metodo)) return;
  const enviado = request.headers.get('x-csrf-token') || '';
  if (!enviado || !compararTiempoConstante(enviado, String(sesion.csrf || ''))) {
    lanzar(403, 'Token CSRF invalido o ausente. Recarga la pagina.');
  }
}

export function exigirAdmin(sesion) {
  if (sesion.rol !== 'admin') {
    lanzar(403, 'Solo un administrador puede realizar esta operacion.');
  }
}

export function testAccesoLocal(sesion, carpeta) {
  if (sesion.rol === 'admin') return true;
  return String(sesion.localCarpeta || '') === String(carpeta || '');
}

export function exigirLocalAsignado(sesion, carpeta) {
  if (!testAccesoLocal(sesion, carpeta)) lanzar(403, 'No tienes acceso a ese local.');
}

export async function cerrarSesionResponse(request) {
  return {
    'Set-Cookie': cookieSesion(request, '', 0)
  };
}

export function politicaPassword(password) {
  if (typeof password !== 'string' || password.length < 10) {
    lanzar(400, 'La contrasena debe tener al menos 10 caracteres.');
  }
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    lanzar(400, 'La contrasena debe combinar letras y numeros.');
  }
}

export async function crearRegistroUsuario(env, datos) {
  const usuario = normalizarTexto(datos.usuario);
  if (!/^[a-z0-9._-]{3,40}$/.test(usuario)) {
    lanzar(400, 'El usuario debe tener entre 3 y 40 caracteres: letras, numeros, punto, guion o guion bajo.');
  }
  const rol = String(datos.rol || 'local');
  if (!['admin', 'local'].includes(rol)) lanzar(400, 'Rol invalido.');
  const localCarpeta = String(datos.localCarpeta || '').trim();
  if (rol === 'local' && !localCarpeta) {
    lanzar(400, 'Un usuario de local necesita un local asignado.');
  }

  const iteraciones = validarFormatoClave(datos.clave, datos.salt, datos.iteraciones);
  const doc = await leerUsuarios(env);
  if (buscarUsuario(doc, usuario)) lanzar(409, 'Ese usuario ya existe.');

  const registro = {
    usuario,
    nombre: esTexto(datos.nombre) ? String(datos.nombre).trim() : usuario,
    rol,
    localCarpeta: rol === 'local' ? localCarpeta : null,
    passwordSalt: String(datos.salt),
    claveHash: await huellaClave(env, datos.clave),
    iteraciones,
    creadoEn: fechaHora(),
    activo: true,
    intentos: 0,
    bloqueadoHasta: null,
    ultimoAcceso: null
  };
  doc.usuarios = [...(doc.usuarios || []), registro];
  await guardarUsuarios(env, doc);
  return registro;
}

export async function actualizarPasswordUsuario(env, usuario, datos) {
  const iteraciones = validarFormatoClave(datos.clave, datos.salt, datos.iteraciones);
  const doc = await leerUsuarios(env);
  const u = buscarUsuario(doc, usuario);
  if (!u) lanzar(404, 'Usuario no encontrado.');
  u.passwordSalt = String(datos.salt);
  u.claveHash = await huellaClave(env, datos.clave);
  u.iteraciones = iteraciones;
  u.intentos = 0;
  u.bloqueadoHasta = null;
  await guardarUsuarios(env, doc);
  return u;
}

export function listarUsuariosSeguro(doc) {
  return (doc.usuarios || []).map((u) => ({
    usuario: u.usuario,
    nombre: u.nombre,
    rol: u.rol,
    localCarpeta: u.localCarpeta,
    activo: u.activo !== false,
    creadoEn: u.creadoEn,
    ultimoAcceso: u.ultimoAcceso
  }));
}

export { ipCliente, registrarAuditoria };
