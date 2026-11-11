// test/evo-prices.test.js — the made-to-measure EVO mats: the shop's price list (evo-prices.js), what a new
// catalogue contains, what the server charges, the "Prices" tab, the vehicle typed by the customer and the
// 3D picture of the type of vehicle. Real server, throwaway data.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { startServer } = require('./helpers');
const catalog = require('../catalog');
const EVO = require('../evo-prices');

// The price list, written out here on its own (euros: Standard, Premium) so a slip in evo-prices.js shows.
// Compact, sedan, estate and SUV (5 seats) cost the same, as do the large SUV and the MPV.
const CAR5 = { set4: [40, 50], boot: [50, 60], pack: [85, 105] };
const BIG = { set4: [50, 60], boot: [60, 70], pack: [105, 125], set4r3: [65, 80], packr3: [120, 145] };   // third row: +15 / +20 € on the set or the pack
const LIST = {
  sedan: CAR5, hatch: CAR5, wagon: CAR5, suv: CAR5, suvbig: BIG, mpv: BIG,
  vansmall: { cab: [40, 50], cab2: [65, 80] }, vanmedium: { cab: [50, 60], cab2: [75, 90] }, vanlarge: { cab: [50, 60], cab2: [75, 90] },   // second row: +25 / +30 €
};

const evoRow = (over = {}) => ({
  id: 1, slug: 'evo-custom-mats', category: 'mats', name_en: EVO.product.name_en, name_es: EVO.product.name_es,
  desc_en: '', desc_es: '', price_cents: EVO.product.price_cents, stock: 5, status: 'available', fitment: 'car',
  opts: JSON.stringify(EVO.product.options), combos: JSON.stringify(EVO.product.combos), media: '[]',
  prices_en: EVO.product.prices_en, prices_es: EVO.product.prices_es, ...over,
});

test('every combination costs what the price list says; packs save 5 €; a set a vehicle does not have is not sold', () => {
  const row = evoRow();
  const sold = {};
  for (const v of EVO.VEHICLES) for (const s of EVO.SETS) EVO.MATERIALS.forEach((m, i) => {
    try {
      const euros = catalog.priceForSelection(row, { veh: v.id, set: s.id, mat: m.id }).unit / 100;
      ((sold[v.id] = sold[v.id] || {})[s.id] = (sold[v.id][s.id] || []))[i] = euros;
    } catch (e) { assert.strictEqual(e.code, 'unavailable', `${v.id}|${s.id}`); }
  });
  assert.deepStrictEqual(sold, LIST);
  for (const k of ['car5', 'big']) {
    const t = k === 'car5' ? CAR5 : BIG;
    [0, 1].forEach(i => assert.strictEqual(t.pack[i], t.set4[i] + t.boot[i] - 5, `${k} pack`));
  }
  const pub = catalog.publicProduct(row);
  assert.deepStrictEqual([pub.price_cents, pub.from], [4000, true], '"from 40 €"');
});

test('a new catalogue has the EVO mats from the price list, available (not "coming soon"), with the vehicle types', async () => {
  const srv = await startServer();
  try {
    const p = (await srv.call('GET', '/api/products/evo-custom-mats')).body;
    assert.deepStrictEqual([p.status, p.price_cents, p.from, p.fitment], ['available', 4000, true, 'car']);
    assert.deepStrictEqual(p.options.map(o => [o.id, o.values.map(v => v.id)]), [
      ['veh', ['sedan', 'hatch', 'wagon', 'suv', 'suvbig', 'mpv', 'vansmall', 'vanmedium', 'vanlarge']],
      ['set', ['set4', 'boot', 'pack', 'set4r3', 'packr3', 'cab', 'cab2']],
      ['mat', ['std', 'prem']]]);
    assert.strictEqual(p.options[0].es, 'Tipo de vehículo');
    assert.match(p.prices.es, /^# Furgonetas · suelo de la zona de carga \| Estándar \| Premium\n/);
    assert.match(p.prices.en, /^# Vans · load-area floor \| Standard \| Premium\n/);
    assert.strictEqual((await srv.call('GET', '/api/products')).body.length, 9, 'the other products are still there');
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

// ---------- the product page (browser code, loaded straight from public/js/app.js) ----------
const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app.js'), 'utf8').replace(/\r\n/g, '\n');
const grab = name => { const m = src.match(new RegExp(`\\nfunction ${name}\\([\\s\\S]*?\\n\\}\\n`)); assert.ok(m, name + ' found in app.js'); return m[0]; };
function tabCode(lang) {
  const L = obj => (obj && (obj[lang] || obj.en)) || '';
  const eur = c => `${c / 100} €`;
  return new Function('L', 'eur', `${grab('comboPrice')}${grab('comboSellable')}${grab('priceTables')}${grab('optionTables')}
    return { priceTables, optionTables };`)(L, eur);
}

test('"Prices" tab: vehicle types with the same prices share a table; the prices are the ones the cart charges', () => {
  const p = catalog.publicProduct(evoRow());
  const tables = tabCode('es').optionTables(p);
  // the medium and the large van cost the same, so they share a table
  assert.deepStrictEqual(tables.map(tb => [tb.title, tb.rows.length]), [
    ['Berlina / Compacto / Familiar / SUV · 5 plazas', 3],
    ['SUV grande / Monovolumen', 5],
    ['Furgoneta pequeña · Berlingo, Caddy, Kangoo…', 2],
    ['Furgoneta mediana · Vito, Trafic, Transit Custom… / Furgón grande · Sprinter, Ducato, Crafter…', 2]]);
  assert.deepStrictEqual(tables[0].cols, ['Estándar', 'Premium']);
  assert.deepStrictEqual(tables[0].rows, [
    ['Juego de 4 piezas', '40 €', '50 €'], ['Alfombra de maletero', '50 €', '60 €'], ['Pack · juego de 4 piezas + maletero', '85 €', '105 €']]);
  assert.deepStrictEqual(tables[1].rows.map(r => r.join(' / ')), [
    'Juego de 4 piezas / 50 € / 60 €', 'Alfombra de maletero / 60 € / 70 €', 'Pack · juego de 4 piezas + maletero / 105 € / 125 €',
    'Juego de 4 piezas + tercera fila (7 plazas) / 65 € / 80 €', 'Pack + tercera fila (7 plazas) / 120 € / 145 €']);
  assert.deepStrictEqual(tables[2].rows.map(r => r.join(' / ')), ['Juego de cabina / 40 € / 50 €', 'Juego de cabina + segunda fila (doble cabina) / 65 € / 80 €']);
  assert.deepStrictEqual(tables[3].rows.map(r => r.join(' / ')), ['Juego de cabina / 50 € / 60 €', 'Juego de cabina + segunda fila (doble cabina) / 75 € / 90 €']);
  assert.strictEqual(tabCode('en').optionTables(p)[0].title, 'Sedan / Compact / hatchback / Estate / SUV · 5 seats');

  // it follows the product, not a copy of the list: a price changed in the panel, a value out of stock
  const combos = { ...EVO.product.combos, 'sedan|set4|std': { price: 4500 } };
  const options = JSON.parse(JSON.stringify(EVO.product.options));
  options[2].values[1].out = true;                                  // Premium out of stock
  const changed = tabCode('es').optionTables(catalog.publicProduct(evoRow({ combos: JSON.stringify(combos), opts: JSON.stringify(options) })));
  assert.deepStrictEqual(changed[0].title, 'Berlina', 'a changed price makes the sedan table different from the others');
  assert.deepStrictEqual(changed[0].rows[0], ['Juego de 4 piezas', '45 €', '—']);
  assert.strictEqual(changed[1].title, 'Compacto / Familiar / SUV · 5 plazas');

  // one option: a simple list; no options: nothing
  const one = { base_cents: 1000, combos: {}, options: [{ id: 'c', en: 'Colour', values: [{ id: 'a', en: 'Black', delta: 0 }, { id: 'b', en: 'Grey', delta: 200, soon: true }] }] };
  assert.deepStrictEqual(tabCode('en').optionTables(one), [{ title: 'Colour', cols: [], rows: [['Black', '10 €']] }]);
  assert.deepStrictEqual(tabCode('en').optionTables({ base_cents: 1000, combos: {}, options: [] }), []);
});

test('"Prices" tab: the extra list (van load-area floors) is read as a table and notes', () => {
  const { tables, notes } = tabCode('es').priceTables(EVO.product.prices_es);
  assert.deepStrictEqual(tables.map(tb => [tb.title, tb.cols, tb.rows.length]), [['Furgonetas · suelo de la zona de carga', ['Estándar', 'Premium'], 6]]);
  assert.deepStrictEqual(tables[0].rows.map(r => r.slice(1).join(' / ')), ['90 € / 110 €', '130 € / 160 €', '150 € / 180 €', '180 € / 220 €', '210 € / 250 €', '240 € / 290 €']);
  assert.strictEqual(notes.length, 3);
  assert.match(notes[0], /se pide por mensaje/);
  assert.match(notes[1], /10 € de descuento/);
  // the English list has the same numbers
  const en = tabCode('en').priceTables(EVO.product.prices_en);
  const nums = t => t.tables.flatMap(tb => tb.rows.map(r => r.slice(1).map(c => c.replace(/[^\d+]/g, '')).join('/')));
  assert.deepStrictEqual(nums(en), nums({ tables }));
  // free text: rows before any title make a table without a heading; empty text gives nothing
  assert.deepStrictEqual(tabCode('es').priceTables('A | 1 €\n\nnota'), { tables: [{ title: '', cols: [], rows: [['A', '1 €']] }], notes: ['nota'] });
  assert.deepStrictEqual(tabCode('es').priceTables(''), { tables: [], notes: [] });
});

test('the EVO page has no car list: the customer types brand, model and year, with a note; the finder has no engine', () => {
  const page = src.slice(src.indexOf('async function viewProduct('), src.indexOf('/* ================= reviews'));
  assert.ok(!page.includes('mountCarSelect') && !page.includes("myCar.get() : null"), 'a made-to-measure product does not use the car list or the saved car');
  for (const id of ['vBrand', 'vModel', 'vYear']) assert.ok(page.includes(`id="${id}"`), id + ' input');
  assert.match(page, /t\('veh_note'\)/, 'a note tells the customer to write the vehicle');
  // the made-to-measure category page no longer shows the car finder
  assert.ok(!/hasCarFit/.test(src));
  // texts in both languages
  for (const k of ['veh_title', 'veh_note', 'veh_missing', 'veh_year_bad', 'v3d_note', 'v3d_top']) assert.strictEqual((src.match(new RegExp(`\\b${k}:`, 'g')) || []).length, 2, k);
  assert.match(src, /root\.innerHTML = \['brand', 'model', 'gen', 'year'\]\.map\(/);
  assert.ok(!src.includes('choose_engine'));
});

// ---------- the 3D picture ----------
// ---------- step by step choice of the EVO mats ----------
function viewCode() {
  const lines = ['valOf', 'comboKey', 'combosCache', 'fitsSel'].map(n => { const m = src.match(new RegExp(`^const ${n} = .*$`, 'm')); assert.ok(m, n); return m[0]; }).join('\n');
  return new Function(`${lines}\n${grab('allCombos')}${grab('comboPrice')}${grab('comboSellable')}${grab('valueState')}${grab('optionView')}\nreturn { optionView, valueState };`)();
}

test('EVO choices go step by step; the type of vehicle can always be changed, and a set that no longer fits is dropped', () => {
  const { optionView } = viewCode();
  const p = catalog.publicProduct(evoRow());
  const shown = (view, gi) => Object.entries(view[gi].values).filter(([, v]) => !v.hidden).map(([id]) => id);

  // nothing chosen: all vehicle types; the set and the material wait
  let v = optionView(p, {}, true);
  assert.deepStrictEqual(v.map(g => g.hidden), [false, true, true]);
  assert.strictEqual(shown(v, 0).length, 9);
  // a sedan: only the sets of a car, then the material appears
  v = optionView(p, { veh: 'sedan' }, true);
  assert.deepStrictEqual(shown(v, 1), ['set4', 'boot', 'pack']);
  assert.deepStrictEqual(v.map(g => g.hidden), [false, false, true]);
  v = optionView(p, { veh: 'sedan', set: 'pack' }, true);
  assert.deepStrictEqual([v[2].hidden, shown(v, 2)], [false, ['std', 'prem']]);
  // the vehicle types stay all there and enabled, whatever the set is: a customer can change their mind
  for (const sel of [{ veh: 'sedan', set: 'pack' }, { veh: 'suvbig', set: 'packr3', mat: 'prem' }]) {
    v = optionView(p, sel, true);
    assert.strictEqual(shown(v, 0).length, 9, JSON.stringify(sel));
    assert.ok(Object.values(v[0].values).every(x => x.state === 'ok'), JSON.stringify(sel));
  }
  // a large SUV has the third row sets; a van only the cabin sets
  assert.deepStrictEqual(shown(optionView(p, { veh: 'suvbig' }, true), 1), ['set4', 'boot', 'pack', 'set4r3', 'packr3']);
  assert.deepStrictEqual(shown(optionView(p, { veh: 'vanmedium' }, true), 1), ['cab', 'cab2']);
  // other products show everything at once, with not-sold values struck through (disabled) as before
  const other = optionView(p, {}, false);
  assert.deepStrictEqual(other.map(g => g.hidden), [false, false, false]);
  assert.ok(Object.values(optionView(p, { veh: 'sedan' }, false)[1].values).some(x => x.state === 'off' && !x.hidden));
});
