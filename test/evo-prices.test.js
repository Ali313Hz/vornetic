// test/evo-prices.test.js — the made-to-measure EVO mats follow the shop's price list
// (evo-prices.js): what a new catalogue contains, what the server charges, and what the
// "Prices" tab of the product page shows. Real server, throwaway data.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, CUSTOMER } = require('./helpers');
const catalog = require('../catalog');
const EVO = require('../evo-prices');

// The price list, written out here on its own (euros: Standard, Premium) so a slip in evo-prices.js shows
const LIST = {
  'car5|set4': [40, 50], 'car5|boot': [50, 60], 'car5|pack': [85, 105],
  'big|set4': [50, 60], 'big|boot': [60, 70], 'big|pack': [105, 125],
  'big|set4r3': [65, 80], 'big|packr3': [120, 145],          // third row: +15 € / +20 € on the set or the pack
};

const evoRow = (over = {}) => ({
  id: 1, slug: 'evo-custom-mats', category: 'mats', name_en: EVO.product.name_en, name_es: EVO.product.name_es,
  desc_en: '', desc_es: '', price_cents: EVO.product.price_cents, stock: 5, status: 'available', fitment: 'car',
  opts: JSON.stringify(EVO.product.options), combos: JSON.stringify(EVO.product.combos), media: '[]',
  prices_en: EVO.product.prices_en, prices_es: EVO.product.prices_es, ...over,
});

test('every combination costs what the price list says; packs save 5 €; no third row for 5-seat cars', () => {
  const row = evoRow();
  const sold = {};
  for (const v of EVO.VEHICLES) for (const s of EVO.SETS) EVO.MATERIALS.forEach((m, i) => {
    const key = `${v.id}|${s.id}`;
    try {
      const euros = catalog.priceForSelection(row, { veh: v.id, set: s.id, mat: m.id }).unit / 100;
      (sold[key] = sold[key] || [])[i] = euros;
    } catch (e) { assert.strictEqual(e.code, 'unavailable', key); }
  });
  assert.deepStrictEqual(sold, LIST);
  for (const v of ['car5', 'big']) [0, 1].forEach(i =>
    assert.strictEqual(LIST[`${v}|pack`][i], LIST[`${v}|set4`][i] + LIST[`${v}|boot`][i] - 5, `${v} pack`));
  const pub = catalog.publicProduct(row);
  assert.deepStrictEqual([pub.price_cents, pub.from], [4000, true], '"from 40 €"');
});

test('a new catalogue has the EVO mats from the price list, as "coming soon"', async () => {
  const srv = await startServer();
  try {
    const p = (await srv.call('GET', '/api/products/evo-custom-mats')).body;
    assert.deepStrictEqual([p.status, p.price_cents, p.from, p.fitment], ['soon', 4000, true, 'car']);
    assert.deepStrictEqual(p.options.map(o => [o.id, o.values.map(v => v.id)]),
      [['veh', ['car5', 'big']], ['set', ['set4', 'boot', 'pack', 'set4r3', 'packr3']], ['mat', ['std', 'prem']]]);
    assert.match(p.prices.es, /^# Furgonetas · juego de cabina \| Estándar \| Premium\n/);
    assert.match(p.prices.en, /^# Vans · cabin set \| Standard \| Premium\n/);
    assert.strictEqual((await srv.call('GET', '/api/products')).body.length, 9, 'the other products are still there');
  } finally { await srv.stop(); }
});

test('the server charges the list price for the chosen vehicle, set and material', async () => {
  const srv = await startServer();
  try {
    const list = (await srv.admin('GET', '/api/admin/products')).body;
    const evo = list.find(p => p.slug === 'evo-custom-mats');
    // the owner switches it on (a new catalogue has it as "coming soon")
    const soon = await srv.call('POST', '/api/orders', { ...CUSTOMER, payment_method: 'contact',
      items: [{ id: evo.id, qty: 1, options: { veh: 'car5', set: 'set4', mat: 'std' } }] });
    assert.strictEqual(soon.status, 400, 'coming soon: not sold');
    assert.strictEqual((await srv.admin('PUT', '/api/admin/products/' + evo.id, { ...evo, status: 'available', stock: 20 })).status, 200);

    const cars = (await srv.call('GET', '/api/cars')).body;
    const brand = Object.keys(cars)[0], model = Object.keys(cars[brand])[0], g = cars[brand][model][0];
    const car = { brand, model, gen: g.gen, year: g.from };          // no engine: the shop no longer asks for it
    let ip = 20;
    const buy = (options, lang = 'es') => srv.call('POST', '/api/orders', { ...CUSTOMER, lang, payment_method: 'contact',
      items: [{ id: evo.id, qty: 1, car, options }] }, { 'X-Forwarded-For': `198.51.100.${ip++}` });
    for (const [options, euros] of [
      [{ veh: 'car5', set: 'set4', mat: 'std' }, 40], [{ veh: 'car5', set: 'pack', mat: 'prem' }, 105],
      [{ veh: 'big', set: 'boot', mat: 'std' }, 60], [{ veh: 'big', set: 'packr3', mat: 'prem' }, 145],
    ]) {
      const r = await buy(options);
      assert.strictEqual(r.status, 200, JSON.stringify(r.body));
      const o = await srv.orderByRef(r.body.ref);
      const line = JSON.parse(o.items)[0];
      assert.deepStrictEqual([line.unit_cents, line.car], [euros * 100, `${brand} ${model} ${g.gen} · ${g.from}`], JSON.stringify(options));
    }
    // not on the list: a third row for a 5-seat car; a price sent by the browser is ignored
    const no = await buy({ veh: 'car5', set: 'set4r3', mat: 'std' });
    assert.deepStrictEqual([no.status, no.body.error], [400, 'Alfombrillas EVO a medida no está disponible con las opciones elegidas']);
    const cheat = await srv.call('POST', '/api/orders', { ...CUSTOMER, payment_method: 'contact',
      items: [{ id: evo.id, qty: 1, car, options: { veh: 'big', set: 'pack', mat: 'prem' }, unit_cents: 100, price_cents: 100 }] },
    { 'X-Forwarded-For': '198.51.100.90' });
    assert.strictEqual(JSON.parse((await srv.orderByRef(cheat.body.ref)).items)[0].unit_cents, 12500);
  } finally { await srv.stop(); }
});

test('the extra price list is saved from the panel, shown in the shop language, and limited in length', async () => {
  const srv = await startServer();
  try {
    const cat = (await srv.admin('GET', '/api/admin/categories')).body[0].slug;
    const made = await srv.admin('POST', '/api/admin/products', { category: cat, name_en: 'Test item', name_es: 'Artículo test', price_cents: 1000, stock: 5,
      prices_es: '# Tabla | A | B\nFila · detalle | 1 € | 2 €\nUna nota', prices_en: 'x'.repeat(5000) });
    assert.strictEqual(made.status, 200, JSON.stringify(made.body));
    const p = (await srv.call('GET', '/api/products/' + made.body.slug)).body;
    assert.strictEqual(p.prices.es, '# Tabla | A | B\nFila · detalle | 1 € | 2 €\nUna nota');
    assert.strictEqual(p.prices.en.length, 4000);
    const mine = (await srv.admin('GET', '/api/admin/products')).body.find(x => x.id === made.body.id);
    assert.strictEqual(mine.prices_es, p.prices.es);
    // a product saved without the field keeps an empty list (old panel pages, other tools)
    const plain = await srv.newProduct(3);
    const pid = plain.id ?? plain;
    assert.deepStrictEqual((await srv.admin('GET', '/api/admin/products')).body.find(x => x.id === pid).prices_es, '');
  } finally { await srv.stop(); }
});

// ---------- the "Prices" tab (browser code, loaded straight from public/js/app.js) ----------
const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app.js'), 'utf8').replace(/\r\n/g, '\n');
const grab = name => { const m = src.match(new RegExp(`\\nfunction ${name}\\([\\s\\S]*?\\n\\}\\n`)); assert.ok(m, name + ' found in app.js'); return m[0]; };
function tabCode(lang) {
  const L = obj => (obj && (obj[lang] || obj.en)) || '';
  const eur = c => `${c / 100} €`;
  return new Function('L', 'eur', `${grab('comboPrice')}${grab('comboSellable')}${grab('priceTables')}${grab('optionTables')}
    return { priceTables, optionTables };`)(L, eur);
}

test('"Prices" tab: one table per vehicle size with the prices the cart charges; choices not sold are left out', () => {
  const p = catalog.publicProduct(evoRow());
  const tables = tabCode('es').optionTables(p);
  assert.deepStrictEqual(tables.map(tb => [tb.title, tb.cols]), [
    ['Turismo o SUV · 5 plazas', ['Estándar', 'Premium']], ['SUV grande o monovolumen', ['Estándar', 'Premium']]]);
  assert.deepStrictEqual(tables[0].rows, [
    ['Juego de 4 piezas', '40 €', '50 €'], ['Alfombra de maletero', '50 €', '60 €'], ['Pack · juego de 4 piezas + maletero', '85 €', '105 €']]);
  assert.deepStrictEqual(tables[1].rows, [
    ['Juego de 4 piezas', '50 €', '60 €'], ['Alfombra de maletero', '60 €', '70 €'], ['Pack · juego de 4 piezas + maletero', '105 €', '125 €'],
    ['Juego de 4 piezas + tercera fila (7 plazas)', '65 €', '80 €'], ['Pack + tercera fila (7 plazas)', '120 €', '145 €']]);
  assert.strictEqual(tabCode('en').optionTables(p)[0].title, 'Car or SUV · 5 seats');

  // it follows the product, not a copy of the list: a price changed in the panel, a value out of stock
  const combos = { ...EVO.product.combos, 'car5|set4|std': { price: 4500 } };
  const options = JSON.parse(JSON.stringify(EVO.product.options));
  options[2].values[1].out = true;                                  // Premium out of stock
  const changed = tabCode('es').optionTables(catalog.publicProduct(evoRow({ combos: JSON.stringify(combos), opts: JSON.stringify(options) })));
  assert.deepStrictEqual(changed[0].rows[0], ['Juego de 4 piezas', '45 €', '—']);

  // one option: a simple list; two options: one table; no options: nothing
  const one = { base_cents: 1000, combos: {}, options: [{ id: 'c', en: 'Colour', values: [{ id: 'a', en: 'Black', delta: 0 }, { id: 'b', en: 'Grey', delta: 200, soon: true }] }] };
  assert.deepStrictEqual(tabCode('en').optionTables(one), [{ title: 'Colour', cols: [], rows: [['Black', '10 €']] }]);
  assert.deepStrictEqual(tabCode('en').optionTables({ base_cents: 1000, combos: {}, options: [] }), []);
});

test('"Prices" tab: the extra list (vans) is read as tables and notes', () => {
  const { tables, notes } = tabCode('es').priceTables(EVO.product.prices_es);
  assert.deepStrictEqual(tables.map(tb => [tb.title, tb.cols, tb.rows.length]), [
    ['Furgonetas · juego de cabina', ['Estándar', 'Premium'], 4], ['Furgonetas · suelo de la zona de carga', ['Estándar', 'Premium'], 6]]);
  const cells = tb => tb.rows.map(r => r.slice(1).join(' / '));
  assert.deepStrictEqual(cells(tables[0]), ['40 € / 50 €', '50 € / 60 €', '50 € / 60 €', '+25 € / +30 €']);
  assert.deepStrictEqual(cells(tables[1]), ['90 € / 110 €', '130 € / 160 €', '150 € / 180 €', '180 € / 220 €', '210 € / 250 €', '240 € / 290 €']);
  assert.strictEqual(notes.length, 3);
  assert.match(notes[0], /10 € de descuento/);
  // the English list has the same numbers
  const en = tabCode('en').priceTables(EVO.product.prices_en);
  const nums = t => t.tables.flatMap(tb => tb.rows.map(r => r.slice(1).map(c => c.replace(/[^\d+]/g, '')).join('/')));
  assert.deepStrictEqual(nums(en), nums({ tables }));
  // free text: rows before any title make a table without a heading; empty text gives nothing
  assert.deepStrictEqual(tabCode('es').priceTables('A | 1 €\n\nnota'), { tables: [{ title: '', cols: [], rows: [['A', '1 €']] }], notes: ['nota'] });
  assert.deepStrictEqual(tabCode('es').priceTables(''), { tables: [], notes: [] });
});

test('the car finder asks for brand, model, generation and year only (no engine)', () => {
  assert.match(src, /root\.innerHTML = \['brand', 'model', 'gen', 'year'\]\.map\(/);
  assert.ok(!src.includes('choose_engine'));
});
