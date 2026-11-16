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

function principal() {
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

  // Datos públicos necesarios para el respaldo del catálogo.
  copiarArchivo(path.join(RAIZ, 'data', 'config.json'), path.join(DIST, 'data', 'config.json'));
  for (const nombre of ['locales', 'licores', 'primera-necesidad']) {
    copiarCarpeta(path.join(RAIZ, 'data', nombre), path.join(DIST, 'data', nombre));
  }

  // Comprobaciones mínimas.
  const obligatorios = ['index.html', 'js/arranque.js', 'js/app.js', 'admin/index.html', '_routes.json'];
  const faltantes = obligatorios.filter((rel) => !fs.existsSync(path.join(DIST, rel)));
  if (faltantes.length) {
    throw new Error('Faltan archivos obligatorios en dist/: ' + faltantes.join(', '));
  }

  console.log('\nListo.');
  console.log('Archivos copiados:', archivos);
  console.log('Tamaño total:', (bytes / 1024 / 1024).toFixed(2), 'MB');
  console.log('Carpeta:', DIST);
  console.log('');
}

try {
  principal();
} catch (error) {
  console.error('\nError:', error.message, '\n');
  process.exit(1);
}
