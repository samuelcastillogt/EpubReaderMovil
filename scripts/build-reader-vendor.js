/*
 * Genera src/reader/vendor.generated.ts con JSZip y epub.js embebidos.
 * Asi el lector funciona sin conexion y con versiones fijas (ver package.json).
 * Uso: npm run vendor:reader
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, 'node_modules', rel), 'utf8');
const safe = (src) => JSON.stringify(src.replace(/<\/script/gi, '<\\/script'));

const jszip = read('jszip/dist/jszip.min.js');
const epubjs = read('epubjs/dist/epub.min.js');
const jszipVersion = require(path.join(root, 'node_modules/jszip/package.json')).version;
const epubVersion = require(path.join(root, 'node_modules/epubjs/package.json')).version;

const out = `// Archivo generado por scripts/build-reader-vendor.js. No editar a mano.
// jszip@${jszipVersion} · epubjs@${epubVersion}
/* eslint-disable */
export const JSZIP_VERSION = ${JSON.stringify(jszipVersion)};
export const EPUBJS_VERSION = ${JSON.stringify(epubVersion)};
export const JSZIP_SOURCE: string = ${safe(jszip)};
export const EPUBJS_SOURCE: string = ${safe(epubjs)};
`;

fs.writeFileSync(path.join(root, 'src/reader/vendor.generated.ts'), out);
console.log(`vendor.generated.ts listo (jszip ${jszipVersion}, epubjs ${epubVersion}, ${(out.length / 1024).toFixed(0)} KB)`);
