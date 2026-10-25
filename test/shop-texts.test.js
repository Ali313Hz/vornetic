// test/shop-texts.test.js — order errors in the checkout language, Stripe item names per language,
// the legal owner (Titular) and the bank BIC. Real server, throwaway database, fake Stripe and
// fake SMTP on 127.0.0.1, fake customers and a fake IBAN: no real payments, data or mail.
const { test } = require('node:test');
const assert = require('node:assert');
const { startServer, fakeSmtp, fakeStripe, CUSTOMER } = require('./helpers');

async function shop() {
  const smtp = await fakeSmtp();
  const stripe = await fakeStripe();
  let srv;
  try { srv = await startServer({ ...smtp.env, ...stripe.env }); } catch (e) { await smtp.close(); await stripe.close(); throw e; }
  const cat = (await srv.admin('GET', '/api/admin/categories')).body[0].slug;
  const product = async (extra = {}) => (await srv.admin('POST', '/api/admin/products',
    { category: cat, name_en: 'Test item', name_es: 'Artículo test', price_cents: 1000, stock: 10, ...extra })).body.id;
  // each order comes from its own (documentation-range) client address, so the 10-per-IP order limit stays out of the way
  let ip = 0;
  const order = (lang, items, extra = {}) => srv.call('POST', '/api/orders',
    { ...CUSTOMER, lang, payment_method: 'transfer', items, ...extra }, { 'X-Forwarded-For': `198.51.100.${++ip}` });
  await srv.admin('PUT', '/api/admin/settings', { iban: 'ES00 0000 0000 0000 0000 0000', shop_email: 'shop@example.test' });
  return { srv, smtp, stripe, product, order, async close() { await srv.stop(); await smtp.close(); await stripe.close(); } };
}

test('order errors come in the checkout language (ES and EN)', async () => {
  const s = await shop();
  try {
    const p = await s.product();
    const none = await s.product({ stock: 0 });
    const car = await s.product({ fitment: 'car' });
    const few = await s.product({ stock: 2 });
    const cases = [
      [{ items: [{ id: p, qty: 1 }], extra: { customer_name: '' } }, 'Rellena todos los campos obligatorios', 'Please fill in all required fields'],
      [{ items: [{ id: p, qty: 1 }], extra: { email: 'not-an-email' } }, 'El email no es válido', 'Invalid email'],
      [{ items: [] }, 'Tu carrito está vacío', 'Your cart is empty'],
      [{ items: [{ id: p, qty: 1 }], extra: { payment_method: 'bizum' } }, 'Este método de pago no está disponible', 'Payment method not available'],
      [{ items: [{ id: 999999, qty: 1 }] }, 'Un producto de tu carrito ya no está disponible', 'A product in your cart is no longer available'],
      [{ items: [{ id: none, qty: 1 }] }, 'Agotado: Artículo test', 'Out of stock: Test item'],
      [{ items: [{ id: car, qty: 1 }] }, 'Elige tu coche para Artículo test', 'Please choose your car for Test item'],
      [{ items: [{ id: few, qty: 5 }] }, 'No hay stock suficiente: Artículo test (quedan 2, has pedido 5)', 'Not enough stock: Test item (only 2 left, you asked for 5)'],
    ];
    for (const [c, es, en] of cases) {
      const a = await s.order('es', c.items, c.extra);
      const b = await s.order('en', c.items, c.extra);
      assert.deepStrictEqual([a.status, a.body.error], [400, es], JSON.stringify(c));
      assert.deepStrictEqual([b.status, b.body.error], [400, en], JSON.stringify(c));
    }
  } finally { await s.close(); }
});

test('card: when Stripe fails the message is in the checkout language', async () => {
  const s = await shop();
  try {
    s.stripe.state.failCreate = true;
    const p = await s.product();
    const es = await s.order('es', [{ id: p, qty: 1 }], { payment_method: 'card' });
    const en = await s.order('en', [{ id: p, qty: 1 }], { payment_method: 'card' });
    assert.match(es.body.error, /^El pago con tarjeta no está disponible en este momento/);
    assert.match(en.body.error, /^Card payment is not available right now/);
  } finally { await s.close(); }
});

test('Stripe payment page shows the product name in the checkout language', async () => {
  const s = await shop();
  try {
    const p = await s.product();
    const name = l => l.params['line_items[0][price_data][product_data][name]'];
    assert.strictEqual((await s.order('es', [{ id: p, qty: 1 }], { payment_method: 'card' })).status, 200);
    assert.strictEqual((await s.order('en', [{ id: p, qty: 1 }], { payment_method: 'card', email: 'other@example.test' })).status, 200);
    const [a, b] = Object.values(s.stripe.state.sessions);
    assert.deepStrictEqual([name(a), name(b)], ['Artículo test', 'Test item']);
  } finally { await s.close(); }
});

test('legal owner (Titular) and BIC: saved in settings, shown in config, payment details and e-mail', async () => {
  const s = await shop();
  try {
    const r = await s.srv.admin('PUT', '/api/admin/settings', {
      company_name: 'Shop Trade Name', company_holder: 'Test Owner', company_nif: 'X0000000T', company_address: 'Calle Test 1, Madrid',
      iban_holder: 'Test Owner', iban_bic: 'TESTESMMXXX',
    });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    const cfg = (await s.srv.call('GET', '/api/config')).body;
    assert.deepStrictEqual(cfg.company, { name: 'Shop Trade Name', holder: 'Test Owner', nif: 'X0000000T', address: 'Calle Test 1, Madrid' });
    const p = await s.product();
    const o = await s.order('es', [{ id: p, qty: 1 }]);
    assert.strictEqual(o.status, 200, JSON.stringify(o.body));
    assert.deepStrictEqual([o.body.iban_holder, o.body.iban_bic], ['Test Owner', 'TESTESMMXXX']);
    await s.smtp.waitFor(1);
    const mail = s.smtp.text(0);
    assert.match(mail, /Test Owner · BIC TESTESMMXXX/);
  } finally { await s.close(); }
});
