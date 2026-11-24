#!/usr/bin/env node
/* ============================================================
   EnRuta Delivery - Constructor del sitio para Cloudflare Pages
   ------------------------------------------------------------
   Copia a dist/ únicamente los archivos públicos. No incluye
   server/, tools/, db/ ni archivos de respaldo.

   Uso: node tools/construir-sitio.js
   ============================================================ */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { generarSeo } = require('./generar-seo.js');

const RAIZ = path.resolve(__dirname, '..');
const DIST = path.join(RAIZ, 'dist');

const ARCHIVOS = [
  'index.html',
  '404.html',
  'privacidad.html',
  'robots.txt',
  'sitemap.xml',
  'ads.txt',
  '163326e29cc11fbe5a4e77e7a84ffff1.txt',
  'googlee16045e689497aba.html',
  'manifest.webmanifest',
  'sw.js',
  '.well-known/security.txt',
  '_headers',
  '_routes.json'
];

const CARPETAS = ['admin', 'assets', 'css', 'js'];

const EXCLUIR = [/\.bak$/i, /\.map$/i, /^\./, /~$/i];

function debeExcluir(nombre) {
  return EXCLUIR.some((re) => re.test(nombre));
}

let archivos = 0;
let bytes = 0;

function copiarArchivo(origen, destino) {
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  fs.copyFileSync(origen, destino);
  archivos++;
  try {
    bytes += fs.statSync(destino).size;
  } catch {
    /* sin tamaño */
  }
}

function copiarCarpeta(origen, destino, filtro = null) {
  if (!fs.existsSync(origen)) return;
  for (const entrada of fs.readdirSync(origen, { withFileTypes: true })) {
    if (debeExcluir(entrada.name)) continue;
    const rutaOrigen = path.join(origen, entrada.name);
    const rutaDestino = path.join(destino, entrada.name);
    if (entrada.isDirectory()) {
      copiarCarpeta(rutaOrigen, rutaDestino, filtro);
    } else if (entrada.isFile()) {
      if (filtro && !filtro(entrada.name, rutaOrigen)) continue;
      copiarArchivo(rutaOrigen, rutaDestino);
    }
  }
}

function rutaEsbuild() {
  if (process.platform !== 'win32') return 'esbuild';
  const raiz = path.join(process.env.LOCALAPPDATA || '', 'npm-cache', '_npx');
  try {
    for (const dir of fs.readdirSync(raiz)) {
      const exe = path.join(raiz, dir, 'node_modules', '@esbuild', 'win32-x64', 'esbuild.exe');
      if (!fs.existsSync(exe)) continue;
      try {
        execFileSync(exe, ['--version'], { stdio: 'ignore', timeout: 20000 });
        return exe;
      } catch {
        /* copia dañada: probar la siguiente */
      }
    }
  } catch {
    /* sin cache */
  }
  return null;
}

function minificar() {
  const esbuild = rutaEsbuild();
  if (!esbuild) return { hechos: 0, ahorro: 0 };
  const objetivos = [
    'css/styles.css',
    'js/app.js',
    'js/arranque.js',
    'js/google.js',
    'js/google-config.js',
    'js/catalogo.js',
    'admin/admin.js',
    'admin/admin.css'
  ];
  let hechos = 0;
  let ahorro = 0;
  for (const rel of objetivos) {
    const archivo = path.join(DIST, rel);
    if (!fs.existsSync(archivo)) continue;
    const temporal = archivo + '.min';
    try {
      execFileSync(esbuild, [archivo, '--minify', '--outfile=' + temporal, '--log-level=error'], {
        stdio: 'ignore',
        timeout: 180000
      });
      const antes = fs.statSync(archivo).size;
      fs.copyFileSync(temporal, archivo);
      fs.unlinkSync(temporal);
      const despues = fs.statSync(archivo).size;
      if (despues > 0) {
        ahorro += Math.max(0, antes - despues);
        hechos++;
      }
    } catch {
      try { fs.unlinkSync(temporal); } catch { /* sin temporal */ }
    }
  }
  return { hechos, ahorro };
}

async function principal() {
  if (DIST === RAIZ || RAIZ.startsWith(DIST + path.sep)) {
    throw new Error('La carpeta dist no puede ser la raíz del proyecto.');
  }

  console.log('\nEnRuta Delivery · construyendo dist/');
  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(DIST, { recursive: true });

  for (const nombre of ARCHIVOS) {
    const origen = path.join(RAIZ, nombre);
    if (!fs.existsSync(origen)) {
      console.warn(' · Falta (se omite):', nombre);
      continue;
    }
    copiarArchivo(origen, path.join(DIST, nombre));
  }

  for (const nombre of CARPETAS) {
    copiarCarpeta(path.join(RAIZ, nombre), path.join(DIST, nombre));
  }

  // Solo las imágenes de data/: los JSON se sirven desde la API (D1).
  const soloImagenes = (nombre) => !/\.json$/i.test(nombre) && !/\.bak$/i.test(nombre);
  for (const nombre of ['locales', 'licores', 'primera-necesidad']) {
    copiarCarpeta(path.join(RAIZ, 'data', nombre), path.join(DIST, 'data', nombre), soloImagenes);
  }

  // Comprobaciones mínimas.
  const obligatorios = ['index.html', 'js/arranque.js', 'js/app.js', 'admin/index.html', '_routes.json'];
  const faltantes = obligatorios.filter((rel) => !fs.existsSync(path.join(DIST, rel)));
  if (faltantes.length) {
    throw new Error('Faltan archivos obligatorios en dist/: ' + faltantes.join(', '));
  }

  // Minificación de CSS y JS para que cargue más rápido.
  const min = minificar();
  if (min.hechos) {
    console.log('Minificados:', min.hechos, 'archivos · ahorro:', (min.ahorro / 1024).toFixed(0), 'KB');
  }

  // Páginas por local, directorio, sitemap y datos estructurados.
  const seo = await generarSeo(DIST);
  if (seo.ok) {
    console.log('SEO:', seo.locales, 'páginas de locales + directorio + sitemap.');
  } else {
    console.warn('SEO: no se pudieron generar las páginas de locales (sin conexión a la API).');
  }

  console.log('\nListo.');
  console.log('Archivos copiados:', archivos);
  console.log('Tamaño total:', (bytes / 1024 / 1024).toFixed(2), 'MB');
  console.log('Carpeta:', DIST);
  console.log('');
}

principal().catch((error) => {
  console.error('\nError:', error.message, '\n');
  process.exit(1);
});
