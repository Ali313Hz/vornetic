// test/purchase-guards.test.js — what the server refuses to sell, whatever the browser sends:
// "coming soon" products (e.g. EVO before launch), out-of-stock or coming-soon choices (a colour),
// combinations switched off, missing choices, and made-to-measure products without a valid car.
// Real server, throwaway data.
const { test } = require('node:test');
const assert = require('node:assert');
const { startServer, CUSTOMER } = require('./helpers');
const catalog = require('../catalog');

const COLOUR = {
  id: 'col', es: 'Color', en: 'Colour', values: [
    { id: 'blk', es: 'Negro', en: 'Black' },
    { id: 'red', es: 'Rojo', en: 'Red', out: true },
    { id: 'blu', es: 'Azul', en: 'Blue', soon: true },
    { id: 'grn', es: 'Verde', en: 'Green' },
  ],
};

async function setup() {
  const srv = await startServer();
  const cat = (await srv.admin('GET', '/api/admin/categories')).body[0].slug;
  srv.product = async fields => {
    const r = await srv.admin('POST', '/api/admin/products', { category: cat, name_en: 'Test item', name_es: 'Artículo test', price_cents: 1000, stock: 5, ...fields });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    return r.body;
  };
  let ip = 10;
  // an order in the given language from its own IP (the order route allows 10 per IP)
  srv.buy = (items, lang = 'es') => srv.call('POST', '/api/orders', { ...CUSTOMER, lang, payment_method: 'contact', items },
    { 'X-Forwarded-For': `198.51.100.${ip++}` });
  // the order's lines as the admin panel gets them (a JSON text)
  srv.lines = async ref => JSON.parse((await srv.orderByRef(ref)).items);
  srv.stock = async id => (await srv.admin('GET', '/api/admin/products')).body.find(p => p.id === id).stock;
  return srv;
}

test('a "coming soon" product (EVO before launch) cannot be bought, and no stock is taken', async () => {
  const srv = await setup();
  try {
    const p = await srv.product({ status: 'soon', fitment: 'car' });
    assert.strictEqual((await srv.call('GET', '/api/products/' + p.slug)).body.status, 'soon');
    const r = await srv.buy([{ id: p.id, qty: 1 }]);
    assert.deepStrictEqual([r.status, r.body.error], [400, 'Un producto de tu carrito ya no está disponible']);
    assert.strictEqual(await srv.stock(p.id), 5);
    // switched to "available", it can be bought (with a car: see the car test below)
    const ok = await srv.product({ status: 'available' });
    assert.strictEqual((await srv.buy([{ id: ok.id, qty: 1 }])).status, 200);
  } finally { await srv.stop(); }
});

test('an out-of-stock colour shows as such and cannot be bought; other colours can', async () => {
  const srv = await setup();
  try {
    const p = await srv.product({ options: [COLOUR], combos: { grn: { off: true } } });
    const pub = (await srv.call('GET', '/api/products/' + p.slug)).body;
    const red = pub.options[0].values.find(v => v.id === 'red');
    assert.deepStrictEqual([red.out, red.soon], [true, false], 'the shop page gets the out-of-stock flag');

    const buy = (colour, lang) => srv.buy([{ id: p.id, qty: 1, options: colour ? { col: colour } : {} }], lang);
    const refused = async (colour, es, en) => {
      const a = await buy(colour, 'es'), b = await buy(colour, 'en');
      assert.deepStrictEqual([a.status, a.body.error, b.status, b.body.error], [400, es, 400, en], colour);
    };
    await refused('red', 'Agotado: Artículo test (Rojo)', 'Out of stock: Test item (Red)');
    await refused('blu', 'Artículo test no está disponible con las opciones elegidas', 'Test item is not available with the options you chose');
    await refused('grn', 'Artículo test no está disponible con las opciones elegidas', 'Test item is not available with the options you chose');
    await refused(null, 'Elige todas las opciones de Artículo test', 'Please choose all the options for Test item');
    await refused('xyz', 'Elige todas las opciones de Artículo test', 'Please choose all the options for Test item');
    assert.strictEqual(await srv.stock(p.id), 5, 'nothing taken from stock');

    const ok = await buy('blk', 'es');
    assert.strictEqual(ok.status, 200, JSON.stringify(ok.body));
    assert.deepStrictEqual((await srv.lines(ok.body.ref)).map(i => i.options), [['Colour: Black']]);
    assert.strictEqual(await srv.stock(p.id), 4);
  } finally { await srv.stop(); }
});

test('a value is never both "coming soon" and "out of stock"; out of stock wins', () => {
  const [o] = catalog.cleanOptions([{ id: 'col', es: 'Color', en: 'Colour', values: [{ id: 'red', es: 'Rojo', en: 'Red', soon: true, out: true }] }]);
  assert.deepStrictEqual([o.values[0].soon, o.values[0].out], [false, true]);
});

test('made-to-measure (car) products need a real car from the list, checked by the server', async () => {
  const srv = await setup();
  try {
    const p = await srv.product({ fitment: 'car' });
    const cars = (await srv.call('GET', '/api/cars')).body;
    const brand = Object.keys(cars)[0], model = Object.keys(cars[brand])[0], g = cars[brand][model][0];
    const car = { brand, model, gen: g.gen, year: g.from };
    const buy = c => srv.buy([{ id: p.id, qty: 1, car: c }]);
    const msg = 'Elige tu coche para Artículo test';
    for (const [why, c] of [
      ['no car', undefined],
      ['unknown brand', { ...car, brand: 'Notabrand' }],
      ['unknown model', { ...car, model: 'Nomodel' }],
      ['unknown generation', { ...car, gen: 'X99' }],
      ['year before the generation', { ...car, year: g.from - 1 }],
      ['year after the generation', { ...car, year: g.to + 1 }],
      ['engine not in the list', g.engines.length ? { ...car, engine: 'Not an engine' } : { ...car, year: 'abc' }],
    ]) {
      const r = await buy(c);
      assert.deepStrictEqual([r.status, r.body.error], [400, msg], why);
    }
    assert.strictEqual(await srv.stock(p.id), 5);
    const ok = await buy(car);
    assert.strictEqual(ok.status, 200, JSON.stringify(ok.body));
    assert.strictEqual((await srv.lines(ok.body.ref))[0].car, `${brand} ${model} ${g.gen} · ${g.from}`);
  } finally { await srv.stop(); }
});
