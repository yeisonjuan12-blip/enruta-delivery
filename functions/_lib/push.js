/* Web Push para Cloudflare Workers (RFC 8291 + VAPID/RFC 8292). */

export const VAPID_PUBLIC_KEY = 'BIza_2QgjuwESJaOdlG4nmd-yK7o-Fqk3CN85drSajjIkuP_Gvf4JsedG50P0SuOWm7pm6ijBjWdoL1H1ZexG4k';
const PREFIJO = 'push:subscription:';
const CONTACTO = 'mailto:enrutadelivery@gmail.com';

function b64urlBytes(texto) {
  const limpio = String(texto || '').replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(limpio + '='.repeat((4 - limpio.length % 4) % 4));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function aB64url(bytes) {
  let bin = '';
  for (const b of new Uint8Array(bytes)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function concatenar(...partes) {
  const longitud = partes.reduce((n, p) => n + p.length, 0);
  const salida = new Uint8Array(longitud);
  let offset = 0;
  for (const parte of partes) { salida.set(parte, offset); offset += parte.length; }
  return salida;
}

async function sha256(texto) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto)));
}

async function hmac(clave, datos) {
  const key = await crypto.subtle.importKey('raw', clave, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, datos));
}

async function hkdfExpand(prk, info, longitud) {
  const salida = [];
  let anterior = new Uint8Array(0);
  for (let contador = 1; salida.reduce((n, p) => n + p.length, 0) < longitud; contador++) {
    anterior = await hmac(prk, concatenar(anterior, info, new Uint8Array([contador])));
    salida.push(anterior);
  }
  return concatenar(...salida).slice(0, longitud);
}

async function derivarClave(sharedSecret, authSecret, salt, uaPublic, asPublic) {
  const prkKey = await hmac(authSecret, sharedSecret);
  const info = concatenar(new TextEncoder().encode('WebPush: info\0'), uaPublic, asPublic);
  const ikm = await hkdfExpand(prkKey, info, 32);
  const prk = await hmac(salt, ikm);
  const cek = await hkdfExpand(prk, new TextEncoder().encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdfExpand(prk, new TextEncoder().encode('Content-Encoding: nonce\0'), 12);
  return { cek, nonce };
}

async function importarVapid(env) {
  if (!env.VAPID_PRIVATE_KEY) throw new Error('VAPID no configurado');
  return crypto.subtle.importKey(
    'pkcs8', b64urlBytes(env.VAPID_PRIVATE_KEY),
    { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']
  );
}

async function vapidToken(endpoint, env) {
  const url = new URL(endpoint);
  const ahora = Math.floor(Date.now() / 1000);
  const header = aB64url(new TextEncoder().encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const payload = aB64url(new TextEncoder().encode(JSON.stringify({ aud: url.origin, exp: ahora + 12 * 60 * 60, sub: CONTACTO })));
  const data = new TextEncoder().encode(header + '.' + payload);
  const key = await importarVapid(env);
  const firma = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, data);
  return header + '.' + payload + '.' + aB64url(firma);
}

async function cifrarMensaje(subscription, mensaje) {
  const uaPublic = b64urlBytes(subscription.keys.p256dh);
  const authSecret = b64urlBytes(subscription.keys.auth);
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ephemeral = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', ephemeral.publicKey));
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, ephemeral.privateKey, 256));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const { cek, nonce } = await derivarClave(shared, authSecret, salt, uaPublic, asPublic);
  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const contenido = new TextEncoder().encode(JSON.stringify(mensaje));
  // 0x02 marca el único y último registro según RFC 8291.
  const plano = concatenar(contenido, new Uint8Array([2]));
  const cifrado = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, aes, plano));
  const rs = new Uint8Array([0, 0, 16, 0]); // 4096 bytes
  const idLen = new Uint8Array([asPublic.length]);
  return concatenar(salt, rs, idLen, asPublic, cifrado);
}

function endpointPermitido(endpoint) {
  try {
    const u = new URL(endpoint);
    if (u.protocol !== 'https:') return false;
    const host = u.hostname.toLowerCase();
    return host === 'fcm.googleapis.com' || host.endsWith('.push.services.mozilla.com') ||
      host === 'web.push.apple.com' || host === 'wns2-par02p.notify.windows.com' ||
      host.endsWith('.notify.windows.com');
  } catch { return false; }
}

async function idSuscripcion(endpoint) {
  return aB64url(await sha256(endpoint));
}

export function pushDisponible(env) {
  return Boolean(env.VAPID_PRIVATE_KEY && env.IMAGENES);
}

export async function guardarSuscripcion(env, datos) {
  if (!pushDisponible(env)) throw new Error('Las notificaciones aún no están configuradas.');
  const sub = datos && datos.subscription;
  if (!sub || !endpointPermitido(sub.endpoint) || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) {
    throw new Error('La suscripción del navegador no es válida.');
  }
  const clave = PREFIJO + await idSuscripcion(sub.endpoint);
  await env.IMAGENES.put(clave, JSON.stringify({ subscription: sub, creadoEn: new Date().toISOString() }));
  return { ok: true };
}

export async function quitarSuscripcion(env, datos) {
  const endpoint = String(datos && datos.endpoint || '');
  if (!endpointPermitido(endpoint)) return { ok: true };
  await env.IMAGENES.delete(PREFIJO + await idSuscripcion(endpoint));
  return { ok: true };
}

export async function enviarPushALista(env, mensaje) {
  if (!pushDisponible(env)) throw new Error('Las notificaciones aún no están configuradas.');
  const titulo = String(mensaje && mensaje.title || 'Novedades de EnRuta').trim().slice(0, 60);
  const body = String(mensaje && mensaje.body || 'Mira las promos de hoy en EnRuta Delivery.').trim().slice(0, 140);
  let url = String(mensaje && mensaje.url || '/').slice(0, 300);
  try {
    const destino = new URL(url, 'https://enrutadelivery.com');
    url = destino.origin === 'https://enrutadelivery.com' ? destino.pathname + destino.search + destino.hash : '/';
  } catch { url = '/'; }
  const payload = { title: titulo, body, url, icon: '/assets/app/icono-192.png', badge: '/assets/app/icono-192.png' };
  let cursor;
  let enviados = 0;
  let eliminados = 0;
  const errores = [];
  do {
    const pagina = await env.IMAGENES.list({ prefix: PREFIJO, cursor, limit: 100 });
    for (const item of pagina.keys || []) {
      try {
        const raw = await env.IMAGENES.get(item.name);
        if (!raw) { eliminados++; continue; }
        const registro = JSON.parse(raw);
        const sub = registro.subscription;
        if (!sub || !endpointPermitido(sub.endpoint)) { await env.IMAGENES.delete(item.name); eliminados++; continue; }
        const bodyBin = await cifrarMensaje(sub, payload);
        const token = await vapidToken(sub.endpoint, env);
        const respuesta = await fetch(sub.endpoint, {
          method: 'POST',
          headers: {
            Authorization: 'vapid t=' + token + ', k=' + VAPID_PUBLIC_KEY,
            'Content-Type': 'application/octet-stream',
            'Content-Encoding': 'aes128gcm',
            TTL: '86400',
            Urgency: 'normal'
          },
          body: bodyBin
        });
        if (respuesta.status === 201 || respuesta.status === 202) enviados++;
        else if (respuesta.status === 404 || respuesta.status === 410) { await env.IMAGENES.delete(item.name); eliminados++; }
        else errores.push(respuesta.status);
      } catch (e) {
        errores.push(String(e && e.message || 'error').slice(0, 60));
      }
    }
    cursor = pagina.list_complete ? undefined : pagina.cursor;
  } while (cursor);
  return { ok: true, enviados, eliminados, errores: errores.length, errorMuestra: errores.slice(0, 3) };
}
