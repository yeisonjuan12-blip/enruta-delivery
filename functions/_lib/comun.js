/* ============================================================
   EnRuta Delivery - Utilidades comunes (Cloudflare Pages Functions)
   ============================================================ */

const codificador = new TextEncoder();

export class HttpError extends Error {
  constructor(estado, mensaje) {
    super(mensaje);
    this.estado = estado;
  }
}

export function lanzar(estado, mensaje) {
  throw new HttpError(estado, mensaje);
}

export function json(datos, estado = 200, cabeceras = {}) {
  return new Response(JSON.stringify(datos), {
    status: estado,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...cabeceras
    }
  });
}

export async function leerTexto(request, maximoBytes = 26214400) {
  const declarado = Number(request.headers.get('content-length') || 0);
  if (declarado > maximoBytes) lanzar(413, 'La peticion es demasiado grande.');
  const texto = await request.text();
  if (texto.length > maximoBytes) lanzar(413, 'La peticion es demasiado grande.');
  return texto;
}

export async function leerJson(request, maximoBytes = 26214400) {
  const texto = await leerTexto(request, maximoBytes);
  if (!texto || !texto.trim()) return null;
  try {
    return JSON.parse(texto);
  } catch {
    lanzar(400, 'El cuerpo de la peticion no es JSON valido.');
  }
}

export function normalizarTexto(texto) {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function convertirAId(texto, prefijo = 'item') {
  let n = normalizarTexto(texto).replace(/\s+/g, '-');
  if (n.length > 48) n = n.slice(0, 48).replace(/-+$/, '');
  return n || prefijo;
}

export function convertirNumero(valor) {
  if (valor === null || valor === undefined || typeof valor === 'boolean') return null;
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : null;
  let texto = String(valor).trim();
  if (!texto) return null;
  texto = texto.replace(/s\/\s*/i, '').replace(/[^0-9,.\-+]/g, '');
  if (!texto || texto === '-' || texto === '+' || texto === '.' || texto === ',') return null;

  const comas = (texto.match(/,/g) || []).length;
  const puntos = (texto.match(/\./g) || []).length;
  if (comas > 0 && puntos > 0) {
    if (texto.lastIndexOf(',') > texto.lastIndexOf('.')) {
      texto = texto.replace(/\./g, '').replace(/,/g, '.');
    } else {
      texto = texto.replace(/,/g, '');
    }
  } else if (comas > 0) {
    texto = comas > 1 ? texto.replace(/,/g, '') : texto.replace(/,/g, '.');
  } else if (puntos > 1) {
    texto = texto.replace(/\./g, '');
  }
  const n = Number(texto);
  return Number.isFinite(n) ? n : null;
}

export function redondear2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

export function esTexto(valor) {
  return typeof valor === 'string' && valor.trim().length > 0;
}

const formateadorLima = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Lima',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false
});

function partesLima(fecha = new Date()) {
  const partes = formateadorLima.formatToParts(fecha);
  const salida = {};
  for (const p of partes) salida[p.type] = p.value;
  return salida;
}

/** Fecha local de Perú: yyyy-MM-dd HH:mm:ss */
export function fechaHora(fecha = new Date()) {
  const p = partesLima(fecha);
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

/** Fecha local de Perú: yyyy-MM-dd */
export function fechaCorta(fecha = new Date()) {
  const p = partesLima(fecha);
  return `${p.year}-${p.month}-${p.day}`;
}

/** Fecha local de Perú en formato ISO corto: yyyy-MM-ddTHH:mm:ss */
export function fechaIsoLocal(fecha = new Date()) {
  const p = partesLima(fecha);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
}

export function bytesAB64url(bytes) {
  let texto = '';
  for (const b of bytes) texto += String.fromCharCode(b);
  return btoa(texto).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function bytesAB64(bytes) {
  let texto = '';
  for (const b of bytes) texto += String.fromCharCode(b);
  return btoa(texto);
}

export function textoAB64url(texto) {
  return bytesAB64url(codificador.encode(String(texto)));
}

export function b64urlABytes(texto) {
  const limpio = String(texto).replace(/-/g, '+').replace(/_/g, '/');
  const relleno = limpio + '='.repeat((4 - (limpio.length % 4 || 4)) % 4);
  const binario = atob(relleno);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  return bytes;
}

export function b64urlATexto(texto) {
  return new TextDecoder().decode(b64urlABytes(texto));
}

export function deB64(texto) {
  const limpio = String(texto).replace(/\s+/g, '');
  const binario = atob(limpio);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  return bytes;
}

export function bytesAleatorios(cantidad = 32) {
  const bytes = new Uint8Array(cantidad);
  crypto.getRandomValues(bytes);
  return bytes;
}

export function idAleatorio(bytes = 4) {
  return bytesAB64url(bytesAleatorios(bytes));
}

export function hex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function sha256Bytes(texto) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', codificador.encode(String(texto))));
}

export async function hmacBytes(secreto, texto) {
  const clave = await crypto.subtle.importKey(
    'raw',
    codificador.encode(String(secreto)),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', clave, codificador.encode(String(texto))));
}

export function compararTiempoConstante(a, b) {
  const ba = codificador.encode(String(a ?? ''));
  const bb = codificador.encode(String(b ?? ''));
  if (ba.length !== bb.length) return false;
  let diferencia = 0;
  for (let i = 0; i < ba.length; i++) diferencia |= ba[i] ^ bb[i];
  return diferencia === 0;
}

export function ipCliente(request) {
  return request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || 'desconocida';
}
