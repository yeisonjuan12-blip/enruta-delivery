const fs = require('fs');
const path = require('path');
const raiz = path.resolve(__dirname, '..');
const texto = fs.readFileSync(path.join(raiz, 'js', 'catalogo.js'), 'utf8');
let json = texto.slice(texto.indexOf('{'));
json = json.replace(/;\s*$/, '');
const d = JSON.parse(json);
const out = {
  claves: Object.keys(d),
  resumen: d.resumen,
  localClaves: Object.keys(d.locales[0] || {}),
  localEjemplo: d.locales[0],
  catalogoClaves: Object.keys(d.catalogos[0] || {}),
  catalogoResumen: d.catalogos.map((c) => ({ id: c.id, categorias: c.categorias.length, productos: c.productos.length, claves: Object.keys(c) })),
  configClaves: Object.keys(d.config || {}),
  categoriasLocales: d.categoriasLocales,
};
console.log(JSON.stringify(out, null, 2));
