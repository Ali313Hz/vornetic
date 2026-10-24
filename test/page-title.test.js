// test/page-title.test.js — the browser tab title follows the shop language. The home page (and any
// page without its own title) used a fixed English title, also on the Spanish shop.
// The texts and setTitle are loaded straight from public/js/app.js (browser code).
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { startServer } = require('./helpers');

const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app.js'), 'utf8');
const grab = re => { const m = src.match(re); assert.ok(m, 'not found in app.js: ' + re); return m[0]; };
const T = new Function(grab(/^const T = \{[\s\S]*?^\};\r?$/m) + '\nreturn T;')();
// setTitle as the page runs it, for one language
const titleIn = (lang, page) => {
  const doc = { title: '' };
  const t = k => T[lang][k] ?? T.en[k] ?? k;
  new Function('document', 't', grab(/^const setTitle = .*$/m) + '\nsetTitle(arguments[2]);')(doc, t, page);
  return doc.title;
};

test('the home page title is in the shop language', () => {
  assert.strictEqual(titleIn('en', ''), 'Vornetic — Car Lighting & Mats');
  assert.strictEqual(titleIn('es', ''), 'Vornetic — Bombillas xenón, LED y alfombrillas para coche');
  // pages with their own title are unchanged
  assert.strictEqual(titleIn('es', 'Carrito'), 'Carrito — Vornetic');
});

test('the Spanish home title is the one the server sends with the page (no change of title once the page runs)', async () => {
  const srv = await startServer();
  try {
    const html = await (await fetch(srv.base + '/')).text();
    const served = html.match(/<title>([^<]*)<\/title>/)[1].replace(/&amp;/g, '&');
    assert.strictEqual(served, titleIn('es', ''));
  } finally { await srv.stop(); }
});
