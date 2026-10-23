// test/expiry.test.js — unpaid orders are released safely (pre-launch PR 2).
// Real server, throwaway database, fake Stripe and fake SMTP on 127.0.0.1, fake customers.
// Orders are made "old" by changing created_at in the test database.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');
const { startServer, fakeSmtp, fakeStripe, tempDir, CUSTOMER } = require('./helpers');

const EXPIRE = '/api/admin/orders/expire-unpaid';
const sleep = ms => new Promise(r => setTimeout(r, ms));

// A server with card (fake Stripe), Bizum and transfer switched on, plus one product
async function shop({ stripeOn = true, dataDir } = {}) {
  const smtp = await fakeSmtp();
  const stripe = await fakeStripe();
  let srv;
  try {
    srv = await startServer({ ...smtp.env, ...(stripeOn ? stripe.env : {}) }, dataDir);
  } catch (e) { await smtp.close(); await stripe.close(); throw e; }
  await srv.admin('PUT', '/api/admin/settings', { bizum_phone: '600000000', iban: 'ES00 0000 0000 0000 0000 0000', shop_email: 'shop@example.test' });
  const cat = (await srv.admin('GET', '/api/admin/categories')).body[0].slug;
  const product = (await srv.admin('POST', '/api/admin/products', { category: cat, name_en: 'Test item', name_es: 'Artículo test', price_cents: 1000, stock: 10 })).body.id;
  const db = () => new DatabaseSync(path.join(srv.dataDir, 'store.db'));
  const sql = (q, ...a) => { const d = db(); try { return d.prepare(q).run(...a); } finally { d.close(); } };
  const one = (q, ...a) => { const d = db(); try { return d.prepare(q).get(...a); } finally { d.close(); } };
  const ctx = {
    srv, smtp, stripe, product,
    stock: () => one('SELECT stock FROM products WHERE id = ?', product).stock,
    order: async (payment_method, qty = 1) => {
      const r = await srv.call('POST', '/api/orders', { ...CUSTOMER, payment_method, items: [{ id: product, qty }] });
      assert.strictEqual(r.status, 200, JSON.stringify(r.body));
      return r.body.ref;
    },
    get: ref => one('SELECT * FROM orders WHERE ref = ?', ref),
    age: (ref, sqliteOffset) => sql(`UPDATE orders SET created_at = datetime('now', ?) WHERE ref = ?`, sqliteOffset, ref),
    expire: async () => { const r = await srv.admin('POST', EXPIRE); assert.strictEqual(r.status, 200, JSON.stringify(r.body)); return r.body; },
    sessionOf: ref => stripe.state.sessions[one('SELECT stripe_session FROM orders WHERE ref = ?', ref).stripe_session],
    async close() { await srv.stop(); await smtp.close(); await stripe.close(); },
  };
  await smtp.waitFor(0);
  return ctx;
}
const mailsTo = (smtp, addr) => smtp.messages.map((m, i) => smtp.text(i)).filter(t => new RegExp(`^To: ${addr.replace('.', '\\.')}\\r?$`, 'm').test(t));

// ---------- Bizum / bank transfer: 5 days, as the terms of sale say ----------
test('Bizum and transfer orders unpaid after 5 days are cancelled, stock returned, customer told', async () => {
  const s = await shop();
  try {
    const bizum = await s.order('bizum', 2), transfer = await s.order('transfer', 3);
    const young = await s.order('bizum', 1);
    assert.strictEqual(s.stock(), 10 - 6);
    s.age(bizum, '-7201 minutes');                                      // 5 days + 1 minute
    s.age(transfer, '-6 days');
    s.age(young, '-7199 minutes');                                      // 1 minute short of 5 days
    // the 3 orders' own confirmation e-mails (customer + shop) are sent in the background: let them arrive
    await s.smtp.waitFor(6);
    await sleep(300);
    const before = s.smtp.messages.length;

    const r = await s.expire();
    assert.deepStrictEqual(r.cancelled.sort(), [bizum, transfer].sort());
    assert.strictEqual(s.stock(), 10 - 1, 'stock of both expired orders returned');
    for (const ref of [bizum, transfer]) {
      const o = s.get(ref);
      assert.deepStrictEqual([o.status, o.auto_cancel_reason, o.paid_at], ['cancelled', 'unpaid_5_days', null]);
      assert.match(o.auto_cancelled_at, /^\d{4}-\d{2}-\d{2} /);
    }
    assert.deepStrictEqual([s.get(young).status, s.get(young).auto_cancel_reason], ['pending', null]);

    await s.smtp.waitFor(before + 2);
    await sleep(300);
    const sent = s.smtp.messages.slice(before).map((m, i) => s.smtp.text(before + i));
    assert.strictEqual(sent.length, 2, 'one e-mail per expired order');
    for (const t of sent) {
      assert.match(t, /^To: buyer@example\.test\r?$/m);
      assert.match(t, /no hemos recibido el pago en 5 d.as/);
    }
    // Finance: never paid, so never income
    const fin = (await s.srv.admin('GET', '/api/admin/finance')).body;
    assert.strictEqual(fin.web.payments_cents, 0);
  } finally { await s.close(); }
});

test('paid, shipped, already cancelled and "contact" orders are never touched by the 5-day rule', async () => {
  const s = await shop({ stripeOn: false });
  try {
    const paid = await s.order('bizum'), shipped = await s.order('transfer'), cancelled = await s.order('bizum');
    const contact = await s.order('bizum');
    await s.srv.setOrder(paid, { status: 'paid' });
    await s.srv.setOrder(shipped, { status: 'shipped' });
    await s.srv.setOrder(cancelled, { status: 'cancelled' });          // admin already returned its stock
    // a "contact" order (taken while no payment method was set up): payment is arranged by the admin
    const d = new DatabaseSync(path.join(s.srv.dataDir, 'store.db'));
    d.prepare("UPDATE orders SET payment_method = 'contact' WHERE ref = ?").run(contact);
    d.close();
    for (const ref of [paid, shipped, cancelled, contact]) s.age(ref, '-30 days');
    const stockBefore = s.stock();
    const r = await s.expire();
    assert.deepStrictEqual(r.cancelled, []);
    assert.strictEqual(s.stock(), stockBefore, 'no stock returned twice');
    assert.deepStrictEqual([s.get(paid).status, s.get(shipped).status, s.get(cancelled).status, s.get(contact).status],
      ['paid', 'shipped', 'cancelled', 'pending']);
    assert.strictEqual(s.get(cancelled).auto_cancel_reason, null);
  } finally { await s.close(); }
});

test('running the check twice, or twice at the same time, returns stock only once', async () => {
  const s = await shop();
  try {
    const ref = await s.order('transfer', 4);
    s.age(ref, '-6 days');
    const [a, b] = await Promise.all([s.expire(), s.expire()]);       // two runs at (nearly) the same time
    assert.ok([a, b].some(x => x.cancelled.includes(ref)), 'cancelled by one of them');
    assert.strictEqual(s.stock(), 10, 'stock returned once, not twice');
    const c = await s.expire();
    assert.deepStrictEqual(c.cancelled, []);
    assert.strictEqual(s.stock(), 10, 'still returned once');
  } finally { await s.close(); }
});

test('admin can still un-cancel an auto-cancelled order (customer paid late); the note is cleared', async () => {
  const s = await shop();
  try {
    const ref = await s.order('bizum', 2);
    s.age(ref, '-6 days');
    await s.expire();
    assert.strictEqual(s.stock(), 10);
    assert.strictEqual((await s.srv.setOrder(ref, { status: 'paid' })).status, 200);
    const o = s.get(ref);
    assert.deepStrictEqual([o.status, o.auto_cancel_reason, o.auto_cancelled_at], ['paid', null, null]);
    assert.ok(o.paid_at);
    assert.strictEqual(s.stock(), 8, 'stock taken again');
    assert.deepStrictEqual((await s.expire()).cancelled, [], 'a paid order is never expired');
  } finally { await s.close(); }
});

// ---------- Card: always ask Stripe first ----------
test('card orders: the Stripe payment page is created to expire after 1 hour', async () => {
  const s = await shop();
  try {
    const t0 = Math.floor(Date.now() / 1000);
    const ref = await s.order('card');
    const exp = Number(s.sessionOf(ref).params.expires_at);
    assert.ok(exp >= t0 + 3600 - 5 && exp <= t0 + 3600 + 60, `expires_at ${exp - t0}s from now`);
  } finally { await s.close(); }
});

test('card: paid at Stripe → payment recorded with confirmation e-mails, never cancelled', async () => {
  const s = await shop();
  try {
    const ref = await s.order('card', 2);
    s.age(ref, '-3 hours');
    Object.assign(s.sessionOf(ref), { status: 'complete', payment_status: 'paid' });
    const before = s.smtp.messages.length;
    const r = await s.expire();
    assert.deepStrictEqual([r.paid, r.cancelled], [[ref], []]);
    const o = s.get(ref);
    assert.deepStrictEqual([o.status, o.paid_via, o.auto_cancel_reason], ['paid', 'stripe', null]);
    assert.strictEqual(s.stock(), 8, 'stock stays with the paid order');
    assert.strictEqual(await s.smtp.waitFor(before + 2), before + 2, 'customer confirmation + shop notice');
    await sleep(300);
    assert.strictEqual(s.smtp.messages.length, before + 2);
    assert.strictEqual((await s.srv.admin('GET', '/api/admin/finance')).body.web.payments_cents, o.total_cents, 'counted as income');
    await s.expire();
    assert.strictEqual(s.smtp.messages.length, before + 2, 'no second set of e-mails');
  } finally { await s.close(); }
});

test('card: page expired unpaid → cancelled and stock returned, without e-mail', async () => {
  const s = await shop();
  try {
    const ref = await s.order('card', 3);
    s.age(ref, '-3 hours');
    Object.assign(s.sessionOf(ref), { status: 'expired', payment_status: 'unpaid' });
    const before = s.smtp.messages.length;
    const r = await s.expire();
    assert.deepStrictEqual(r.cancelled, [ref]);
    assert.deepStrictEqual([s.get(ref).status, s.get(ref).auto_cancel_reason, s.get(ref).paid_at], ['cancelled', 'card_checkout_expired', null]);
    assert.strictEqual(s.stock(), 10);
    await sleep(400);
    assert.strictEqual(s.smtp.messages.length, before, 'customer never finished paying: no e-mail');
  } finally { await s.close(); }
});

test('card: an order younger than 2 hours is not even checked', async () => {
  const s = await shop();
  try {
    const ref = await s.order('card');
    s.age(ref, '-119 minutes');
    Object.assign(s.sessionOf(ref), { status: 'expired' });
    const gets = s.stripe.state.gets;
    const r = await s.expire();
    assert.deepStrictEqual(r.cancelled, []);
    assert.strictEqual(s.stripe.state.gets, gets);
    assert.strictEqual(s.get(ref).status, 'pending');
  } finally { await s.close(); }
});

test('card: never cancelled when Stripe fails, is unclear, or the payment is still in progress', async () => {
  const s = await shop();
  try {
    const cases = {
      open: { status: 'open', payment_status: 'unpaid' },                         // page still open
      processing: { status: 'complete', payment_status: 'unpaid' },               // delayed payment method
      error500: { status: 'expired', payment_status: 'unpaid', fail: 500 },
      error401: { status: 'expired', payment_status: 'unpaid', fail: 401 },
      badjson: { status: 'expired', payment_status: 'unpaid', fail: 'badjson' },
      otherSession: { status: 'expired', payment_status: 'unpaid', answerId: 'cs_test_someone_else' },
      otherOrder: { status: 'expired', payment_status: 'unpaid', answerRef: 'VN-OTHER' },
      unknown: { status: 'weird', payment_status: 'weird' },
    };
    const refs = {};
    for (const [name, steer] of Object.entries(cases)) {
      refs[name] = await s.order('card');
      s.age(refs[name], '-3 hours');
      Object.assign(s.sessionOf(refs[name]), steer);
    }
    const stockBefore = s.stock();
    const r = await s.expire();
    assert.deepStrictEqual([r.cancelled, r.paid], [[], []]);
    assert.strictEqual(r.skipped.length, Object.keys(cases).length);
    const reason = name => r.skipped.find(x => x.ref === refs[name]).reason;
    assert.match(reason('open'), /Stripe: open \/ unpaid/);
    assert.match(reason('processing'), /Stripe: complete \/ unpaid/);
    assert.match(reason('error500'), /Stripe check failed/);
    assert.match(reason('error401'), /Stripe check failed/);
    assert.match(reason('badjson'), /Stripe check failed/);
    assert.match(reason('otherSession'), /does not match/);
    assert.match(reason('otherOrder'), /does not match/);
    for (const ref of Object.values(refs)) assert.strictEqual(s.get(ref).status, 'pending');
    assert.strictEqual(s.stock(), stockBefore, 'no stock released');
  } finally { await s.close(); }
});

test('card: Stripe unreachable or switched off → orders are left alone', async () => {
  const dir = tempDir();
  try {
    let s = await shop({ dataDir: dir }), ref, r;
    try {
      ref = await s.order('card');
      s.age(ref, '-3 hours');
      Object.assign(s.sessionOf(ref), { status: 'expired', payment_status: 'unpaid' });
      await s.stripe.close();                                            // Stripe down: connection refused
      r = await s.expire();
      assert.match(r.skipped.find(x => x.ref === ref).reason, /Stripe check failed/);
      assert.strictEqual(s.get(ref).status, 'pending');
    } finally { await s.close(); }                                      // (closing the closed fake Stripe again is harmless)

    s = await shop({ dataDir: dir, stripeOn: false });                   // card payments switched off later
    try {
      r = await s.expire();
      assert.match(r.skipped.find(x => x.ref === ref).reason, /Stripe not configured/);
      assert.strictEqual(s.get(ref).status, 'pending');
    } finally { await s.close(); }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---------- Races ----------
test('race: the admin cancels while Stripe is being asked → stock returned once', async () => {
  const s = await shop();
  try {
    const ref = await s.order('card', 4);
    s.age(ref, '-3 hours');
    Object.assign(s.sessionOf(ref), { status: 'expired', payment_status: 'unpaid', delayMs: 700 });
    const running = s.expire();
    await sleep(200);
    assert.strictEqual((await s.srv.setOrder(ref, { status: 'cancelled' })).status, 200);
    const r = await running;
    assert.deepStrictEqual(r.cancelled, []);
    assert.match(r.skipped.find(x => x.ref === ref).reason, /changed while checking/);
    assert.strictEqual(s.stock(), 10, 'returned by the admin cancel only, not twice');
    assert.strictEqual(s.get(ref).auto_cancel_reason, null);
  } finally { await s.close(); }
});

test('race: the admin records the payment while Stripe is being asked → never cancelled', async () => {
  const s = await shop();
  try {
    const ref = await s.order('card', 2);
    s.age(ref, '-3 hours');
    Object.assign(s.sessionOf(ref), { status: 'expired', payment_status: 'unpaid', delayMs: 700 });
    const running = s.expire();
    await sleep(200);
    await s.srv.setOrder(ref, { status: 'paid' });
    const r = await running;
    assert.deepStrictEqual(r.cancelled, []);
    assert.deepStrictEqual([s.get(ref).status, !!s.get(ref).paid_at], ['paid', true]);
    assert.strictEqual(s.stock(), 8, 'stock stays with the paid order');
  } finally { await s.close(); }
});

test('race: the customer returns from Stripe while the check runs → paid once, e-mails once', async () => {
  const s = await shop();
  try {
    const ref = await s.order('card');
    s.age(ref, '-3 hours');
    const sess = s.sessionOf(ref);
    Object.assign(sess, { status: 'complete', payment_status: 'paid', delayMs: 500 });
    const before = s.smtp.messages.length;
    const sid = s.get(ref).stripe_session;
    const [r, confirm] = await Promise.all([s.expire(), s.srv.call('POST', '/api/orders/confirm', { ref, session_id: sid })]);
    assert.strictEqual(confirm.body.status, 'paid');
    assert.strictEqual(r.cancelled.length, 0);
    assert.strictEqual(s.get(ref).status, 'paid');
    await s.smtp.waitFor(before + 2);
    await sleep(500);
    assert.strictEqual(s.smtp.messages.length, before + 2, 'one confirmation + one shop notice, not four');
  } finally { await s.close(); }
});

// ---------- Startup, history and access ----------
test('the check also runs when the server starts', async () => {
  const dir = tempDir();
  try {
    let s = await shop({ dataDir: dir });
    const ref = await s.order('bizum', 5);
    await s.close();
    const d = new DatabaseSync(path.join(dir, 'store.db'));
    d.prepare("UPDATE orders SET created_at = datetime('now', '-6 days') WHERE ref = ?").run(ref);
    d.close();
    s = await shop({ dataDir: dir });
    try {
      for (let i = 0; i < 30 && s.get(ref).status === 'pending'; i++) await sleep(100);
      assert.deepStrictEqual([s.get(ref).status, s.get(ref).auto_cancel_reason], ['cancelled', 'unpaid_5_days']);
    } finally { await s.close(); }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('payments and refunds already recorded are untouched by the check', async () => {
  const s = await shop();
  try {
    const ref = await s.order('transfer', 2);
    await s.srv.setOrder(ref, { status: 'paid' });
    await s.srv.refund(ref, 500);
    await s.srv.setOrder(ref, { status: 'cancelled' });               // paid, partly refunded, then cancelled
    s.age(ref, '-10 days');
    const before = s.get(ref);
    const finBefore = (await s.srv.admin('GET', '/api/admin/finance')).body;
    await s.expire();
    const after = s.get(ref);
    assert.deepStrictEqual([after.paid_at, after.status, after.auto_cancel_reason], [before.paid_at, 'cancelled', null]);
    assert.strictEqual(JSON.parse((await s.srv.orderByRef(ref)).refunds).length, 1);
    const finAfter = (await s.srv.admin('GET', '/api/admin/finance')).body;
    assert.deepStrictEqual([finAfter.web.payments_cents, finAfter.web.refunds_cents], [finBefore.web.payments_cents, finBefore.web.refunds_cents]);
  } finally { await s.close(); }
});

test('the manual check endpoint is admin-only', async () => {
  const s = await shop();
  try {
    const ref = await s.order('bizum');
    s.age(ref, '-6 days');
    assert.strictEqual((await s.srv.call('POST', EXPIRE)).status, 401);
    assert.strictEqual(s.get(ref).status, 'pending', 'nothing done without an admin session');
  } finally { await s.close(); }
});
