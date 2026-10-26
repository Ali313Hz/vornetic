// test/static-assets.test.js — the shop loads nothing from other websites (pre-launch PR 6).
// The privacy policy says so: no font, script, style or image is fetched from Google or anyone else
// (a visitor's IP address would go to them). Fonts are served by the shop itself.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { startServer } = require('./helpers');

const PUB = path.join(__dirname, '..', 'public');
const read = f => fs.readFileSync(path.join(PUB, f), 'utf8');
// The two font files and their published sha256 (@fontsource-variable/inter 5.3.0)
const FONTS = {
  'inter-latin-wght-normal.woff2': 'MQDndehhbNJhG+7PojpCY9cDdYZ4m0PwNSNqLm+9TGI=',
  'inter-latin-ext-wght-normal.woff2': 'NLnFBMq3pz43t0Y0OkSRMuVs97VIGvLLgdx03P8lyVY=',
};

test('the pages load nothing from other websites (no Google Fonts, scripts, styles or images)', () => {
  for (const page of ['index.html', 'admin.html']) {
    const html = read(page);
    // every resource the page itself loads: <link href>, <script src>, <img src>, <source src>
    const loads = [...html.matchAll(/<(link|script|img|source|iframe)\b[^>]*\b(?:href|src)\s*=\s*["']([^"']+)["']/gi)].map(m => m[2]);
    assert.ok(loads.length > 0, page);
    for (const url of loads) assert.ok(!/^(https?:)?\/\//i.test(url), `${page} loads ${url} from another website`);
    assert.doesNotMatch(html, /fonts\.googleapis|fonts\.gstatic/, page);
  }
  const css = read('css/styles.css');
  for (const m of css.matchAll(/url\(\s*['"]?([^'")]+)/g)) assert.ok(!/^(https?:)?\/\//i.test(m[1]), `styles.css loads ${m[1]}`);
  assert.doesNotMatch(css, /@import/);
});

test('the font is served by the shop: files present, unchanged, licensed, used by the CSS and preloaded', async () => {
  const css = read('css/styles.css');
  for (const [file, sha] of Object.entries(FONTS)) {
    const bytes = fs.readFileSync(path.join(PUB, 'fonts', file));
    assert.strictEqual(crypto.createHash('sha256').update(bytes).digest('base64'), sha, `${file} is the verified file`);
    assert.ok(css.includes(`url('/fonts/${file}')`), `styles.css uses ${file}`);
  }
  assert.match(fs.readFileSync(path.join(PUB, 'fonts', 'OFL-Inter.txt'), 'utf8'), /SIL Open Font License, Version 1\.1/, 'licence shipped with the font');
  assert.match(read('index.html'), /<link rel="preload" href="\/fonts\/inter-latin-wght-normal\.woff2" as="font" type="font\/woff2" crossorigin>/);
  const srv = await startServer();
  try {
    for (const [file, sha] of Object.entries(FONTS)) {
      const r = await fetch(srv.base + '/fonts/' + file);
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.headers.get('content-type'), 'font/woff2');
      assert.strictEqual(crypto.createHash('sha256').update(Buffer.from(await r.arrayBuffer())).digest('base64'), sha);
    }
  } finally { await srv.stop(); }
});

test('the privacy policy matches what the site does (ES and EN)', () => {
  const js = read('js/app.js');
  for (const s of [
    'Our hosting provider (the server this shop runs on) and the storage where we keep encrypted backups',
    'does not load fonts or other content from other websites',
    'Your cart, your language and the delivery details you entered at checkout',
    'Nuestro proveedor de alojamiento (el servidor donde funciona la tienda) y el almacenamiento donde guardamos copias de seguridad cifradas',
    'no carga fuentes ni otros contenidos de otras webs',
    'Tu carrito, tu idioma y los datos de envío que escribiste al hacer el pedido',
  ]) assert.ok(js.includes(s), s);
  // what the text says is kept in the browser is what the shop keeps there
  assert.match(js, /CheckoutAttempt\.rememberAddress\(browserStorage\(\), CheckoutAttempt\.ownerOf\(ME\), addr\)/, 'delivery details are indeed saved in the browser');
});
