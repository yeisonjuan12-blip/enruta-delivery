/* ============================================================
   EnRuta Delivery - Middleware de Pages Functions
   Añade cabeceras de seguridad a las respuestas dinámicas
   (/api/* y /media/*) y captura errores no controlados.
   ============================================================ */

const CABECERAS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains'
};

export async function onRequest(context) {
  try {
    const respuesta = await context.next();
    const salida = new Response(respuesta.body, respuesta);
    for (const [nombre, valor] of Object.entries(CABECERAS)) {
      if (!salida.headers.has(nombre)) salida.headers.set(nombre, valor);
    }
    return salida;
  } catch (error) {
    console.error('Error en middleware:', error && error.stack ? error.stack : error);
    return new Response(JSON.stringify({ error: 'Error interno del servidor.' }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        ...CABECERAS
      }
    });
  }
}
