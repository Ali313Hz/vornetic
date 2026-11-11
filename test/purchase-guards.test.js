// test/purchase-guards.test.js — what the server refuses to sell, whatever the browser sends:
// "coming soon" products, out-of-stock or coming-soon choices (a colour), combinations switched off, missing choices,
// and made-to-measure (EVO) products, which are requests and never an order.
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

test('made-to-measure (EVO) products are never an order: refused whatever is sent, no stock taken, nothing for the payment page', async () => {
  const srv = await setup();
  try {
    const p = await srv.product({ fitment: 'car' });
    const car = { brand: 'Seat', model: 'León', year: 2019 };
    const es = 'Artículo test no se pide en la tienda: envía una solicitud en la página del producto. Confirmamos que las alfombrillas encajan antes de cobrar nada.';
    const en = 'Test item is not ordered in the shop: send a request on the product page. We confirm that the mats fit before anything is charged.';
    for (const [why, item] of [
      ['with a valid vehicle', { id: p.id, qty: 1, car }],
      ['without a vehicle', { id: p.id, qty: 1 }],
      ['with a price from the browser', { id: p.id, qty: 1, car, unit_cents: 1, price_cents: 1 }],
    ]) {
      const a = await srv.buy([item], 'es'), b = await srv.buy([item], 'en');
      assert.deepStrictEqual([a.status, a.body.error, b.status, b.body.error], [400, es, 400, en], why);
    }
    // an EVO product with no stock (as in a shop made before requests) gives the same answer, not "out of stock"
    const none = await srv.product({ fitment: 'car', stock: 0 });
    const zero = await srv.buy([{ id: none.id, qty: 1, car }], 'en');
    assert.deepStrictEqual([zero.status, zero.body.error], [400, en]);
    // inside a bigger cart it refuses the whole order: nothing else is taken either
    const other = await srv.product({});
    const mixed = await srv.buy([{ id: other.id, qty: 1 }, { id: p.id, qty: 1, car }]);
    assert.strictEqual(mixed.status, 400);
    assert.deepStrictEqual([await srv.stock(p.id), await srv.stock(other.id)], [5, 5], 'nothing taken from stock');
    assert.strictEqual((await srv.admin('GET', '/api/admin/orders')).body.length, 0, 'no order was made');
  } finally { await srv.stop(); }
});
