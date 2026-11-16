/* ============================================================
   EnRuta Delivery - Imágenes nuevas servidas desde KV
   Ruta pública: /media/<...>
   ============================================================ */

import { json } from '../_lib/comun.js';

const TIPOS = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml'
};

function tipoPorNombre(nombre) {
  const ext = String(nombre).toLowerCase().split('.').pop();
  return TIPOS[ext] || 'application/octet-stream';
}

export async function onRequest(context) {
  const { request, env, params } = context;
  const metodo = request.method.toUpperCase();
  if (metodo !== 'GET' && metodo !== 'HEAD') {
    return json({ error: 'Metodo no permitido.' }, 405);
  }

  const partes = Array.isArray(params.ruta) ? params.ruta : [params.ruta].filter(Boolean);
  const clave = 'media/' + partes.map((p) => decodeURIComponent(String(p))).join('/');

  if (!clave || clave.includes('..')) {
    return json({ error: 'Ruta invalida.' }, 400);
  }

  try {
    const { value, metadata } = await env.IMAGENES.getWithMetadata(clave, 'arrayBuffer');
    if (!value) {
      return new Response('Imagen no encontrada.', {
        status: 404,
        headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }
      });
    }
    const tipo = (metadata && metadata.tipo) || tipoPorNombre(clave);
    return new Response(metodo === 'HEAD' ? null : value, {
      status: 200,
      headers: {
        'Content-Type': tipo,
        'Content-Length': String(value.byteLength),
        'Cache-Control': 'public, max-age=31536000, immutable',
        'X-Content-Type-Options': 'nosniff'
      }
    });
  } catch (error) {
    console.error('Error leyendo imagen de KV:', error && error.stack ? error.stack : error);
    return json({ error: 'No se pudo leer la imagen.' }, 500);
  }
}
