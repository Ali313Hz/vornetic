// test/checkout.test.js — one checkout attempt makes one order (pre-launch PR 4).
// Real server, throwaway database, fake Stripe and fake SMTP on 127.0.0.1, fake customers.
const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { startServer, fakeSmtp, fakeStripe, CUSTOMER } = require('./helpers');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const newId = () => crypto.randomUUID();

// A server with card (fake Stripe), Bizum and transfer switched on, plus one product with 10 in stock
async function shop() {
  const smtp = await fakeSmtp();
  const stripe = await fakeStripe();
  let srv;
  try { srv = await startServer({ ...smtp.env, ...stripe.env }); } catch (e) { await smtp.close(); await stripe.close(); throw e; }
  await srv.admin('PUT', '/api/admin/settings', { bizum_phone: '600000000', iban: 'ES00 0000 0000 0000 0000 0000', shop_email: 'shop@example.test' });
  const cat = (await srv.admin('GET', '/api/admin/categories')).body[0].slug;
  const product = (await srv.admin('POST', '/api/admin/products', { category: cat, name_en: 'Test item', name_es: 'Artículo test', price_cents: 1000, stock: 10 })).body.id;
  const q = (sql, ...a) => { const d = new DatabaseSync(path.join(srv.dataDir, 'store.db')); try { return d.prepare(sql).all(...a); } finally { d.close(); } };
  const ctx = {
    srv, smtp, stripe, q,
    stock: () => q('SELECT stock FROM products WHERE id = ?', product)[0].stock,
    orders: () => q('SELECT ref, status, payment_method, checkout_id FROM orders ORDER BY id'),
    // what the shop page sends: the cart, the form, and (now) the checkout attempt's ID
    place: (payment_method, { qty = 1, checkout_id, email = CUSTOMER.email } = {}) =>
      srv.call('POST', '/api/orders', { ...CUSTOMER, email, payment_method, items: [{ id: product, qty }], ...(checkout_id !== undefined && { checkout_id }) }),
    async close() { await srv.stop(); await smtp.close(); await stripe.close(); },
  };
  await smtp.waitFor(0);
  return ctx;
}
async function settled(s) { let n; do { n = s.smtp.messages.length; await sleep(400); } while (s.smtp.messages.length !== n); return n; }

test('Bizum: the same checkout sent twice (double click, refresh) → one order, stock taken once, e-mails once', async () => {
  const s = await shop();
  try {
    const id = newId();
    const a = await s.place('bizum', { qty: 2, checkout_id: id });
    const b = await s.place('bizum', { qty: 2, checkout_id: id });
    assert.deepStrictEqual([a.status, b.status], [200, 200]);
    assert.strictEqual(b.body.ref, a.body.ref, 'the same order');
    assert.deepStrictEqual([b.body.bizum_phone, b.body.total_cents], [a.body.bizum_phone, a.body.total_cents], 'same payment instructions');
    assert.strictEqual(s.orders().length, 1);
    assert.strictEqual(s.stock(), 8);
    assert.strictEqual(await settled(s), 2, 'confirmation + shop notice, once');
  } finally { await s.close(); }
});

test('race: the same checkout sent 5 times at once → one order, stock taken once', async () => {
  const s = await shop();
  try {
    const id = newId();
    const all = await Promise.all(Array.from({ length: 5 }, () => s.place('transfer', { qty: 3, checkout_id: id })));
    assert.ok(all.every(r => r.status === 200), JSON.stringify(all.map(r => r.body)));
    assert.strictEqual(new Set(all.map(r => r.body.ref)).size, 1);
    assert.deepStrictEqual([s.orders().length, s.stock()], [1, 7]);
  } finally { await s.close(); }
});

test('card: "back" from the Stripe page and paying again continues the same order and the same payment page', async () => {
  const s = await shop();
  try {
    const id = newId();
    const first = await s.place('card', { qty: 2, checkout_id: id });
    assert.ok(first.body.redirect, 'sent to Stripe');
    const again = await s.place('card', { qty: 2, checkout_id: id });             // back from Stripe, "pay" again
    assert.deepStrictEqual([again.status, again.body.ref, again.body.redirect], [200, first.body.ref, first.body.redirect]);
    assert.deepStrictEqual([s.stripe.state.creates, s.orders().length, s.stock()], [1, 1, 8], 'one Stripe page, one order, stock once');

    // once paid, a repeat says so instead of sending the customer to pay again
    const sess = Object.values(s.stripe.state.sessions)[0];
    Object.assign(sess, { status: 'complete', payment_status: 'paid' });
    const sid = s.q('SELECT stripe_session FROM orders')[0].stripe_session;
    assert.strictEqual((await s.srv.call('POST', '/api/orders/confirm', { ref: first.body.ref, session_id: sid })).body.paid, true);
    const after = await s.place('card', { qty: 2, checkout_id: id });
    assert.deepStrictEqual([after.status, after.body.ref, after.body.paid, after.body.redirect], [200, first.body.ref, true, undefined]);
    assert.strictEqual(s.orders().length, 1);
  } finally { await s.close(); }
});

test('the same checkout ID with a different cart or e-mail is refused (409), nothing created; a new ID makes a new order', async () => {
  const s = await shop();
  try {
    const id = newId();
    const first = await s.place('bizum', { qty: 1, checkout_id: id });
    for (const changed of [{ qty: 2 }, { email: 'other@example.test' }]) {
      const r = await s.place('bizum', { ...changed, checkout_id: id });
      assert.deepStrictEqual([r.status, r.body.error], [409, 'checkout_changed'], JSON.stringify(changed));
    }
    const r = await s.place('transfer', { qty: 1, checkout_id: id });
    assert.deepStrictEqual([r.status, r.body.error], [409, 'checkout_changed'], 'another payment method');
    assert.deepStrictEqual([s.orders().length, s.stock()], [1, 9]);
    const fresh = await s.place('bizum', { qty: 2, checkout_id: newId() });
    assert.strictEqual(fresh.status, 200);
    assert.notStrictEqual(fresh.body.ref, first.body.ref);
    assert.deepStrictEqual([s.orders().length, s.stock()], [2, 7]);
  } finally { await s.close(); }
});

test('card: an attempt whose order ended (page expired, order cancelled) answers 409 checkout_ended; a new ID works', async () => {
  const s = await shop();
  try {
    const id = newId();
    const first = await s.place('card', { qty: 2, checkout_id: id });
    assert.strictEqual((await s.srv.setOrder(first.body.ref, { status: 'cancelled' })).status, 200);
    const r = await s.place('card', { qty: 2, checkout_id: id });
    assert.deepStrictEqual([r.status, r.body.error], [409, 'checkout_ended']);
    assert.strictEqual(s.stock(), 10, 'nothing taken by the refused repeat');
    const fresh = await s.place('card', { qty: 2, checkout_id: newId() });
    assert.ok(fresh.body.redirect);
    assert.deepStrictEqual([s.orders().length, s.stock()], [2, 8]);
  } finally { await s.close(); }
});

test('card: Stripe fails to open the page → no order is made, no stock taken: trying again goes through', async () => {
  const s = await shop();
  try {
    const id = newId();
    s.stripe.state.failCreate = true;
    const failed = await s.place('card', { qty: 2, checkout_id: id });
    assert.strictEqual(failed.status, 400);
    assert.strictEqual(s.stock(), 10, 'stock given back');
    s.stripe.state.failCreate = false;
    const retry = await s.place('card', { qty: 2, checkout_id: id });           // the page retries with the same attempt
    assert.ok(retry.body.redirect, JSON.stringify(retry.body));
    const rows = s.orders();
    assert.deepStrictEqual(rows.map(o => [o.status, o.checkout_id]), [['pending', id]], 'the failed try left nothing behind');
    assert.strictEqual(s.stock(), 8);
  } finally { await s.close(); }
});

test('card: a repeat while the first request is still opening the Stripe page → 409 checkout_in_progress, never a second order', async () => {
  const s = await shop();
  try {
    const id = newId();
    s.stripe.state.createDelayMs = 700;
    const first = s.place('card', { qty: 1, checkout_id: id });
    await sleep(200);
    const second = await s.place('card', { qty: 1, checkout_id: id });
    assert.deepStrictEqual([second.status, second.body.error], [409, 'checkout_in_progress']);
    const f = await first;
    assert.ok(f.body.redirect);
    s.stripe.state.createDelayMs = 0;
    const third = await s.place('card', { qty: 1, checkout_id: id });
    assert.deepStrictEqual([third.body.ref, third.body.redirect], [f.body.ref, f.body.redirect]);
    assert.deepStrictEqual([s.stripe.state.creates, s.orders().length, s.stock()], [1, 1, 9]);
  } finally { await s.close(); }
});

test('without a (valid) checkout ID the shop works as before; different customers never share an order', async () => {
  const s = await shop();
  try {
    assert.strictEqual((await s.place('bizum', {})).status, 200);
    assert.strictEqual((await s.place('bizum', {})).status, 200, 'old page without the ID: a second order, as before');
    for (const bad of ['short', 'x'.repeat(65), 'has spaces in it here', { id: 'object' }]) {
      assert.strictEqual((await s.place('bizum', { checkout_id: bad })).status, 200, JSON.stringify(bad));
    }
    assert.ok(s.orders().every(o => o.checkout_id === null), 'invalid IDs are ignored');
    const a = await s.place('bizum', { checkout_id: newId() });
    const b = await s.place('bizum', { checkout_id: newId(), email: 'second@example.test' });
    assert.notStrictEqual(a.body.ref, b.body.ref);
    assert.strictEqual(s.orders().length, 8);
  } finally { await s.close(); }
});

// ---------- Codex findings on 6140848 ----------
test('a repeat still finds its order when that order took the last unit, or the product is gone since (P1)', async () => {
  const s = await shop();
  try {
    const one = (sql, ...a) => s.q(sql, ...a);
    const pid = one('SELECT id FROM products ORDER BY id DESC LIMIT 1')[0].id;
    one('SELECT 1');                                                    // (read helper only)
    const d = new (require('node:sqlite').DatabaseSync)(require('node:path').join(s.srv.dataDir, 'store.db'));
    try { d.prepare('UPDATE products SET stock = 3 WHERE id = ?').run(pid); } finally { d.close(); }
    const card = newId(), bizum = newId();
    const a = await s.place('card', { qty: 2, checkout_id: card });
    assert.ok(a.body.redirect, JSON.stringify(a.body));
    const b = await s.place('bizum', { qty: 1, checkout_id: bizum });
    assert.strictEqual(b.status, 200);
    assert.strictEqual(s.stock(), 0, 'the last units are taken');
    // back from Stripe / a retry after a lost answer: the existing order, not "out of stock"
    const a2 = await s.place('card', { qty: 2, checkout_id: card });
    assert.deepStrictEqual([a2.status, a2.body.ref, a2.body.redirect], [200, a.body.ref, a.body.redirect], JSON.stringify(a2.body));
    const b2 = await s.place('bizum', { qty: 1, checkout_id: bizum });
    assert.deepStrictEqual([b2.status, b2.body.ref], [200, b.body.ref], JSON.stringify(b2.body));
    // the product is removed from the shop afterwards: a repeat still finds the order
    assert.strictEqual((await s.srv.admin('DELETE', '/api/admin/products/' + pid)).status, 200);
    const b3 = await s.place('bizum', { qty: 1, checkout_id: bizum });
    assert.deepStrictEqual([b3.status, b3.body.ref], [200, b.body.ref], JSON.stringify(b3.body));
    assert.strictEqual(s.orders().length, 2, 'no new orders');
  } finally { await s.close(); }
});

test('the server stops while Stripe is opening the payment page: after the restart the same checkout goes through (P2)', async () => {
  const fs = require('node:fs');
  const dir = require('./helpers').tempDir();
  const stripe = await fakeStripe();
  try {
    let srv = await startServer({ ...stripe.env }, dir);
    let pid;
    try {
      const cat = (await srv.admin('GET', '/api/admin/categories')).body[0].slug;
      pid = (await srv.admin('POST', '/api/admin/products', { category: cat, name_en: 'Item', name_es: 'Artículo', price_cents: 1000, stock: 5 })).body.id;
      stripe.state.createDelayMs = 3000;                               // Stripe is slow…
      const pending = srv.call('POST', '/api/orders', { ...CUSTOMER, payment_method: 'card', items: [{ id: pid, qty: 2 }], checkout_id: 'restart-test-checkout-0001' }).catch(() => null);
      for (let i = 0; i < 100 && !stripe.state.createsStarted; i++) await sleep(50);
      assert.ok(stripe.state.createsStarted, 'Stripe is being asked');
    } finally { await srv.stop(); }                                    // …and the server stops right then
    stripe.state.createDelayMs = 0;
    srv = await startServer({ ...stripe.env }, dir);
    try {
      const again = await srv.call('POST', '/api/orders', { ...CUSTOMER, payment_method: 'card', items: [{ id: pid, qty: 2 }], checkout_id: 'restart-test-checkout-0001' });
      assert.strictEqual(again.status, 200, JSON.stringify(again.body));
      assert.ok(again.body.redirect, 'sent to a Stripe payment page');
      const d = new (require('node:sqlite').DatabaseSync)(require('node:path').join(dir, 'store.db'));
      try {
        const rows = d.prepare("SELECT status, stripe_session FROM orders WHERE status <> 'cancelled'").all();
        assert.strictEqual(rows.length, 1, 'one live order');
        assert.ok(rows[0].stripe_session, 'with its payment page saved');
        assert.strictEqual(d.prepare('SELECT stock FROM products WHERE id = ?').get(pid).stock, 3, 'stock taken once');
      } finally { d.close(); }
    } finally { await srv.stop(); }
  } finally { await stripe.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
