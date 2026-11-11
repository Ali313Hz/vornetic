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

test('made-to-measure (car) products need the vehicle typed by the customer (brand, model, year), checked by the server', async () => {
  const srv = await setup();
  try {
    const p = await srv.product({ fitment: 'car' });
    const car = { brand: 'Seat', model: 'León', year: 2019 };
    const buy = c => srv.buy([{ id: p.id, qty: 1, car: c }]);
    const msg = 'Escribe la marca, el modelo y el año de tu vehículo para Artículo test';
    const thisYear = new Date().getFullYear();
    for (const [why, c] of [
      ['no vehicle', undefined],
      ['not an object', 'Seat León 2019'],
      ['no brand', { ...car, brand: '' }],
      ['blank brand', { ...car, brand: '   ' }],
      ['no model', { ...car, model: undefined }],
      ['no year', { ...car, year: '' }],
      ['year with letters', { ...car, year: '20l9' }],
      ['year with 2 digits', { ...car, year: '19' }],
      ['year with 5 digits', { ...car, year: 20190 }],
      ['year before 1950', { ...car, year: 1949 }],
      ['year too far ahead', { ...car, year: thisYear + 2 }],
      ['brand too long', { ...car, brand: 'x'.repeat(41) }],
      ['model too long', { ...car, model: 'x'.repeat(61) }],
      ['brand without a letter or number', { ...car, brand: '---' }],
    ]) {
      const r = await buy(c);
      assert.deepStrictEqual([r.status, r.body.error], [400, msg], why);
    }
    assert.strictEqual(await srv.stock(p.id), 5, 'nothing taken from stock');

    // any real vehicle can be typed (it does not have to be in the shop's car list); the order keeps it as one clean line
    const typed = await buy({ brand: '  Seat\n', model: '  León   FR  <b>1.5</b>', year: String(thisYear + 1) });
    assert.strictEqual(typed.status, 200, JSON.stringify(typed.body));
    assert.strictEqual((await srv.lines(typed.body.ref))[0].car, `Seat León FR b 1.5 /b · ${thisYear + 1}`);
    const old = await buy({ brand: 'Seat', model: 'León', gen: 'KL', engine: 'whatever', year: 1950 });
    assert.strictEqual(old.status, 200, 'an older cart with a generation is still accepted; the extra fields are dropped');
    assert.strictEqual((await srv.lines(old.body.ref))[0].car, 'Seat León · 1950');
    assert.strictEqual(await srv.stock(p.id), 3);
  } finally { await srv.stop(); }
});
