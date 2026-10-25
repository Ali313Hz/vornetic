// test/admin-lang.test.js — the admin panel in Turkish or Spanish: the server answers admin
// messages in the panel's language (X-Admin-Lang, admin-i18n.js). Real server, throwaway data.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { startServer } = require('./helpers');
const { translate, MESSAGES } = require('../admin-i18n');
const ROOT = path.join(__dirname, '..');

test('admin messages follow X-Admin-Lang (es / tr); without it they are unchanged', async () => {
  const srv = await startServer();
  try {
    const as = (lang, method, url, body) => srv.call(method, url, body, { Cookie: srv.cookie, ...(lang && { 'X-Admin-Lang': lang }) });
    const login = lang => srv.call('POST', '/api/admin/login', { password: 'wrong-password' }, lang ? { 'X-Admin-Lang': lang } : {});
    assert.deepStrictEqual([(await login('es')).body.error, (await login('tr')).body.error, (await login()).body.error],
      ['Contraseña incorrecta', 'Şifre yanlış', 'Wrong password']);
    // a Turkish message from the code: Spanish for es, unchanged for tr
    const cat = (await srv.admin('GET', '/api/admin/categories')).body[0].slug;
    const p = (await srv.admin('POST', '/api/admin/products', { category: cat, name_en: 'Test item', name_es: 'Artículo test', price_cents: 1000, stock: 5 })).body.id;
    const bad = { category: cat, name_en: '', name_es: '' };
    assert.strictEqual((await as('es', 'PUT', '/api/admin/products/' + p, bad)).body.error, 'El nombre es obligatorio en los dos idiomas');
    assert.strictEqual((await as('tr', 'PUT', '/api/admin/products/' + p, bad)).body.error, 'İki dilde isim zorunlu');
    // finance import: row errors are translated too
    const csv = 'type;date;amount_eur;category\r\ngelir;2026-10-05;abc;Wallapop\r\n';
    const imp = (await as('es', 'POST', '/api/admin/finance/import', { csv, dry_run: true })).body;
    assert.deepStrictEqual(imp.errors.map(e => e.msg), ['Importe no reconocido: "abc" (ej. 12,50)']);
    // not logged in: "Not authorised" in the panel's language
    const out = await srv.call('GET', '/api/admin/orders', undefined, { 'X-Admin-Lang': 'es' });
    assert.deepStrictEqual([out.status, out.body.error], [401, 'La sesión ha caducado, vuelve a entrar']);
  } finally { await srv.stop(); }
});

test('patterns keep the values (product name, amounts, rows)', () => {
  assert.strictEqual(translate('Stok yetersiz: Xenon Bulb (stokta 1, gereken 2)', 'es'), 'Stock insuficiente: Xenon Bulb (hay 1, hacen falta 2)');
  assert.strictEqual(translate('İade, kalan tutarı aşamaz (en fazla 12.50 €)', 'es'), 'La devolución no puede superar lo que queda (máximo 12.50 €)');
  assert.strictEqual(translate('Bu kategoride 3 ürün var. Önce ürünleri başka kategoriye taşı.', 'es'), 'Esta categoría tiene 3 productos. Muévelos primero a otra categoría.');
  assert.strictEqual(translate('Something unknown', 'es'), 'Something unknown', 'unknown text goes out unchanged');
  assert.strictEqual(translate('Wrong password', 'xx'), 'Wrong password');
});

test('every fixed Turkish admin message in server.js and finance.js has a Spanish version', () => {
  const missing = [];
  for (const file of ['server.js', 'finance.js']) {
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
    // error: '…' / new Error('…') / fail('…') / msg: '…' / reason: '…' with Turkish letters and no ${…}
    for (const m of src.matchAll(/(?:error: |new Error\(|fail\(|msg: |reason: )(['`])((?:\\.|(?!\1)[^\\])*)\1/g)) {
      if (!/[çğışöüÇĞİŞÖÜ]/.test(m[2]) || m[2].includes('${')) continue;   // not Turkish, or a pattern with values (checked above)
      const text = m[2].replace(/\\'/g, "'");       // \' in the source is ' in the message
      if (translate(text, 'es') === text) missing.push(`${file}: ${text}`);
    }
  }
  assert.deepStrictEqual(missing, []);
  for (const [from, , es] of MESSAGES) assert.ok(es, `Spanish text for ${from}`);
});

test('admin panel: language switch and both languages for the tabs', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public/admin.html'), 'utf8');
  const js = fs.readFileSync(path.join(ROOT, 'public/js/admin.js'), 'utf8');
  assert.match(html, /id="lang"/);
  assert.match(js, /'X-Admin-Lang': LANG/);
  for (const w of ['Pedidos', 'Clientes', 'Productos', 'Finanzas', 'Ajustes', 'Siparişler', 'Ayarlar']) assert.ok(js.includes(`'${w}'`), w);
});

// ---------- language switch must not silently drop unsaved edits (Codex P2 on PR #24) ----------
function adminSource() { return fs.readFileSync(path.join(ROOT, 'public/js/admin.js'), 'utf8').replace(/\r\n/g, '\n'); }
function loadIsUnsaved() {
  const m = adminSource().match(/\nfunction isUnsaved\(el\) \{[\s\S]*?\n\}\n/);
  assert.ok(m, 'isUnsaved() found in admin.js');
  return new Function(`${m[0]}; return isUnsaved;`)();
}
// Just enough of a DOM element for isUnsaved(): what the page drew (default*) and what it holds now
const field = (o = {}) => ({ tagName: 'INPUT', type: 'text', disabled: false, closest: () => null, ...o });
const select = (defaults, selectedIndex) => ({
  tagName: 'SELECT', type: 'select-one', disabled: false, closest: () => null, selectedIndex,
  options: defaults.map(d => ({ defaultSelected: d })),
});

test('isUnsaved: typed, ticked or picked values count; untouched fields, filters and files do not', () => {
  const isUnsaved = loadIsUnsaved();
  // settings / category / customer password fields, the bulb list textarea
  assert.strictEqual(isUnsaved(field({ value: 'info@vornetic.com', defaultValue: 'info@vornetic.com' })), false);
  assert.strictEqual(isUnsaved(field({ value: 'info@vornetic.com x', defaultValue: 'info@vornetic.com' })), true);
  assert.strictEqual(isUnsaved(field({ tagName: 'TEXTAREA', type: 'textarea', value: 'BMW|3|E90\nH7', defaultValue: 'BMW|3|E90' })), true);
  assert.strictEqual(isUnsaved(field({ value: '', defaultValue: 'old' })), true, 'a cleared field is an edit too');
  // checkboxes (e.g. category "active", PayPal / Revolut switches)
  assert.strictEqual(isUnsaved(field({ type: 'checkbox', checked: true, defaultChecked: true })), false);
  assert.strictEqual(isUnsaved(field({ type: 'checkbox', checked: false, defaultChecked: true })), true);
  // selects (an order's status): drawn with "selected", or without (then the first option is shown)
  assert.strictEqual(isUnsaved(select([false, true, false], 1)), false);
  assert.strictEqual(isUnsaved(select([false, true, false], 2)), true);
  assert.strictEqual(isUnsaved(select([false, false], 0)), false);
  assert.strictEqual(isUnsaved(select([false, false], 1)), true);
  // not edits: search / filter boxes, file pickers (upload at once), disabled and hidden fields
  assert.strictEqual(isUnsaved(field({ value: 'maría', defaultValue: '', closest: s => s === '[data-nodirty]' })), false);
  assert.strictEqual(isUnsaved(field({ type: 'file', value: 'C:\fakepath\a.csv', defaultValue: '' })), false);
  assert.strictEqual(isUnsaved(field({ disabled: true, value: 'x', defaultValue: '' })), false);
  assert.strictEqual(isUnsaved(field({ type: 'hidden', value: 'x', defaultValue: '' })), false);
});

test('language switch asks before dropping edits on every screen; product and finance editors stay protected', () => {
  const js = adminSource();
  const handler = js.slice(js.indexOf("$('#lang').addEventListener('click'"));
  assert.match(handler.slice(0, 600), /hasUnsavedEdits\(\) && !confirm\(/, 'the switch checks every screen for unsaved edits');
  const guard = js.match(/const hasUnsavedEdits = \(\) =>[\s\S]*?;\n/)[0];
  assert.match(guard, /\$\('\.peditor'\) \|\| \$\('#ff'\)/, 'product editor and finance form still always ask');
  assert.match(guard, /\$\$\('input, textarea, select', root\)\.some\(isUnsaved\)/);
  // search and filter boxes are not edits (their state is kept in variables and redrawn)
  for (const id of ['os', 'of', 'cs', 'fm', 'fq']) assert.match(js, new RegExp(`id="${id}" data-nodirty`), id);
});
