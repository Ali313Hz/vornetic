// test/stripe-methods.test.js — PayPal and Revolut Pay on the Stripe payment page (admin switches).
// Real server, throwaway database, fake Stripe on 127.0.0.1, fake customers: no real payments.
const { test } = require('node:test');
const assert = require('node:assert');
const { startServer, fakeStripe, CUSTOMER } = require('./helpers');

async function shop({ stripeOn = true } = {}) {
  const stripe = await fakeStripe();
  let srv;
  try { srv = await startServer(stripeOn ? stripe.env : {}); } catch (e) { await stripe.close(); throw e; }
  const cat = (await srv.admin('GET', '/api/admin/categories')).body[0].slug;
  const product = (await srv.admin('POST', '/api/admin/products', { category: cat, name_en: 'Test item', name_es: 'Artículo test', price_cents: 1000, stock: 10 })).body.id;
  let ip = 0;   // each order from its own (documentation-range) address: the 10-per-IP order limit stays out of the way
  const order = (payment_method = 'card') => srv.call('POST', '/api/orders',
    { ...CUSTOMER, payment_method, items: [{ id: product, qty: 1 }] }, { 'X-Forwarded-For': `198.51.100.${++ip}` });
  const types = sess => Object.keys(sess.params).filter(k => k.startsWith('payment_method_types[')).sort().map(k => sess.params[k]);
  const sessions = () => Object.values(stripe.state.sessions);
  return { srv, stripe, order, types, sessions, async close() { await srv.stop(); await stripe.close(); } };
}

test('by default the Stripe page offers cards only', async () => {
  const s = await shop();
  try {
    assert.deepStrictEqual((await s.srv.call('GET', '/api/config')).body.card_methods, ['card']);
    assert.strictEqual((await s.order()).status, 200);
    assert.deepStrictEqual(s.types(s.sessions()[0]), ['card']);
  } finally { await s.close(); }
});

test('PayPal and Revolut Pay switched on: the Stripe page offers card, paypal, revolut_pay; the order is still a card order', async () => {
  const s = await shop();
  try {
    assert.strictEqual((await s.srv.admin('PUT', '/api/admin/settings', { stripe_paypal: '1', stripe_revolut: '1' })).status, 200);
    assert.deepStrictEqual((await s.srv.call('GET', '/api/config')).body.card_methods, ['card', 'paypal', 'revolut_pay']);
    const r = await s.order();
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.deepStrictEqual(s.types(s.sessions()[0]), ['card', 'paypal', 'revolut_pay']);
    const o = (await s.srv.admin('GET', '/api/admin/orders')).body.find(x => x.ref === r.body.ref);
    assert.strictEqual(o.payment_method, 'card');
    // only one switch on
    await s.srv.admin('PUT', '/api/admin/settings', { stripe_paypal: '0' });
    assert.strictEqual((await s.order()).status, 200);
    assert.deepStrictEqual(s.types(s.sessions()[1]), ['card', 'revolut_pay']);
  } finally { await s.close(); }
});

test('Stripe refuses PayPal (not on in the Dashboard): the customer still gets a card-only page', async () => {
  const s = await shop();
  try {
    await s.srv.admin('PUT', '/api/admin/settings', { stripe_paypal: '1' });
    s.stripe.state.refuseMethods = ['paypal'];
    const r = await s.order();
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual(s.stripe.state.refused, 1);
    assert.strictEqual(s.sessions().length, 1, 'one payment page');
    assert.deepStrictEqual(s.types(s.sessions()[0]), ['card']);
    assert.match(s.srv.log, /retrying with card only/);
  } finally { await s.close(); }
});

test('a Stripe server error is not retried (the first page may exist): no order', async () => {
  const s = await shop();
  try {
    await s.srv.admin('PUT', '/api/admin/settings', { stripe_paypal: '1' });
    s.stripe.state.failCreate = true;
    const r = await s.order();
    assert.strictEqual(r.status, 400);
    assert.match(r.body.error, /El pago con tarjeta no está disponible/);
    assert.strictEqual(s.stripe.state.createsStarted, 1, 'asked Stripe once');
  } finally { await s.close(); }
});

test('PayPal / Revolut Pay are never order methods of their own, and need Stripe', async () => {
  const s = await shop({ stripeOn: false });
  try {
    await s.srv.admin('PUT', '/api/admin/settings', { stripe_paypal: '1', stripe_revolut: '1' });
    const cfg = (await s.srv.call('GET', '/api/config')).body;
    assert.deepStrictEqual([cfg.card_methods, cfg.payments.card], [[], false]);
    for (const m of ['paypal', 'revolut_pay']) {
      const r = await s.order(m);
      assert.deepStrictEqual([r.status, r.body.error], [400, 'Este método de pago no está disponible']);
    }
  } finally { await s.close(); }
});
