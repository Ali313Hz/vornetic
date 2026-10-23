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
const until = async (fn, ms = 5000) => { for (let t = 0; t < ms && !fn(); t += 50) await sleep(50); return fn(); };

// A server with card (fake Stripe), Bizum and transfer switched on, plus one product
async function shop({ stripeOn = true, dataDir, env = {} } = {}) {
  const smtp = await fakeSmtp();
  const stripe = await fakeStripe();
  let srv;
  try {
    srv = await startServer({ ...smtp.env, ...(stripeOn ? stripe.env : {}), ...env }, dataDir);
  } catch (e) { await smtp.close(); await stripe.close(); throw e; }
  await srv.admin('PUT', '/api/admin/settings', { bizum_phone: '600000000', iban: 'ES00 0000 0000 0000 0000 0000', shop_email: 'shop@example.test' });
  const cat = (await srv.admin('GET', '/api/admin/categories')).body[0].slug;
  const product = (await srv.admin('POST', '/api/admin/products', { category: cat, name_en: 'Test item', name_es: 'Artículo test', price_cents: 1000, stock: 10 })).body.id;
  const db = () => new DatabaseSync(path.join(srv.dataDir, 'store.db'));
  const sql = (q, ...a) => { const d = db(); try { return d.prepare(q).run(...a); } finally { d.close(); } };
  const one = (q, ...a) => { const d = db(); try { return d.prepare(q).get(...a); } finally { d.close(); } };
  const ctx = {
    srv, smtp, stripe, product, sql,
    stock: () => one('SELECT stock FROM products WHERE id = ?', product).stock,
    order: async (payment_method, qty = 1) => {
      const r = await srv.call('POST', '/api/orders', { ...CUSTOMER, payment_method, items: [{ id: product, qty }] });
      assert.strictEqual(r.status, 200, JSON.stringify(r.body));
      return r.body.ref;
    },
    get: ref => one('SELECT * FROM orders WHERE ref = ?', ref),
    // the queued e-mail of this kind for the order (mail_outbox row), or undefined
    mail: (ref, kind) => one('SELECT m.* FROM mail_outbox m JOIN orders o ON o.id = m.order_id WHERE o.ref = ? AND m.kind = ?', ref, kind),
    // admin view of the order (with needs_refund, refund_due_cents, mails…)
    view: ref => srv.orderByRef(ref),
    age: (ref, sqliteOffset) => sql(`UPDATE orders SET created_at = datetime('now', ?) WHERE ref = ?`, sqliteOffset, ref),
    expire: async () => { const r = await srv.admin('POST', EXPIRE); assert.strictEqual(r.status, 200, JSON.stringify(r.body)); return r.body; },
    // the owner checked the bank/Bizum: not paid → cancel
    cancelUnpaid: (ref, body = { confirm: true }) => srv.admin('POST', `/api/admin/orders/${one('SELECT id FROM orders WHERE ref = ?', ref).id}/cancel-unpaid`, body),
    sessionOf: ref => stripe.state.sessions[one('SELECT stripe_session FROM orders WHERE ref = ?', ref).stripe_session],
    async close() { await srv.stop(); await smtp.close(); await stripe.close(); },
  };
  await smtp.waitFor(0);
  return ctx;
}
// wait until the e-mails sent in the background when orders were placed have all arrived
// change an order the way the admin does: a 409 ("that order's e-mail is being sent right now")
// means try again a moment later
async function setOrderSoon(s, ref, changes) {
  for (let i = 0; ; i++) { const r = await s.srv.setOrder(ref, changes); if (r.status !== 409 || i >= 40) return r; await sleep(100); }
}
async function settled(s) { let n; do { n = s.smtp.messages.length; await sleep(400); } while (s.smtp.messages.length !== n); return n; }

// ---------- Bizum / bank transfer: after 5 days the OWNER decides (Codex P1: reconcile first) ----------
test('Bizum/transfer unpaid after 5 days: flagged for the owner, never cancelled automatically', async () => {
  const s = await shop();
  try {
    const bizum = await s.order('bizum', 2), transfer = await s.order('transfer', 3);
    const young = await s.order('bizum', 1);
    s.age(bizum, '-7201 minutes');                                      // 5 days + 1 minute
    s.age(transfer, '-30 days');
    s.age(young, '-7199 minutes');                                      // 1 minute short of 5 days
    const before = await settled(s);

    const r = await s.expire();
    assert.deepStrictEqual(r.overdue.sort(), [bizum, transfer].sort());
    assert.deepStrictEqual(r.cancelled, []);
    await s.expire();                                                   // and again: still nothing cancelled
    assert.strictEqual(s.stock(), 10 - 6, 'no stock released without the owner');
    for (const ref of [bizum, transfer]) {
      const o = s.get(ref);
      assert.deepStrictEqual([o.status, o.auto_cancel_reason, o.paid_at, s.mail(ref, 'expired')], ['pending', null, null, undefined]);
      assert.match(o.overdue_at, /^\d{4}-\d{2}-\d{2} /);
    }
    assert.strictEqual(s.get(young).overdue_at, null);
    assert.strictEqual((await s.srv.admin('GET', '/api/admin/me')).body.overdue_orders, 2, 'count shown on the Orders tab');
    await sleep(300);
    assert.strictEqual(s.smtp.messages.length, before, 'customer not told anything yet');
  } finally { await s.close(); }
});

test('owner confirms "not paid": cancelled, stock returned once, customer e-mailed once; refused otherwise', async () => {
  const s = await shop();
  try {
    const due = await s.order('bizum', 2), young = await s.order('transfer', 1), paid = await s.order('transfer', 1);
    s.age(due, '-6 days'); s.age(paid, '-6 days');
    await s.expire();
    await s.srv.setOrder(paid, { status: 'paid' });                     // owner found this one's payment
    const before = await settled(s);

    assert.strictEqual((await s.cancelUnpaid(due, {})).status, 400, 'needs explicit confirmation');
    assert.strictEqual((await s.cancelUnpaid(young)).status, 400, 'not overdue');
    assert.strictEqual((await s.cancelUnpaid(paid)).status, 409, 'already paid: never cancelled');
    assert.strictEqual(s.get(paid).status, 'paid');
    assert.strictEqual(s.stock(), 10 - 4);

    const [a, b] = await Promise.all([s.cancelUnpaid(due), s.cancelUnpaid(due)]);   // double click
    assert.deepStrictEqual([a.status, b.status].sort(), [200, 409]);
    assert.strictEqual(s.stock(), 10 - 2, 'stock of the cancelled order returned once');
    const o = s.get(due);
    assert.deepStrictEqual([o.status, o.auto_cancel_reason, o.paid_at], ['cancelled', 'unpaid_5_days', null]);
    assert.ok(await until(() => s.mail(due, 'expired')?.state === 'sent'));
    await sleep(300);
    assert.strictEqual(s.smtp.messages.length, before + 1, 'one e-mail');
    const t = s.smtp.text(before);
    assert.match(t, /^To: buyer@example\.test\r?$/m);
    assert.match(t, /no hemos recibido el pago en 5 d.as/);
    assert.strictEqual((await s.srv.admin('GET', '/api/admin/me')).body.overdue_orders, 0);
    assert.strictEqual((await s.srv.admin('GET', '/api/admin/finance')).body.web.payments_cents, s.get(paid).total_cents, 'only the paid order is income');
  } finally { await s.close(); }
});

test('paid, shipped, already cancelled and "contact" orders are never flagged', async () => {
  const s = await shop({ stripeOn: false });
  try {
    const paid = await s.order('bizum'), shipped = await s.order('transfer'), cancelled = await s.order('bizum');
    const contact = await s.order('bizum');
    await s.srv.setOrder(paid, { status: 'paid' });
    await s.srv.setOrder(shipped, { status: 'shipped' });
    await s.srv.setOrder(cancelled, { status: 'cancelled' });          // admin already returned its stock
    s.sql("UPDATE orders SET payment_method = 'contact' WHERE ref = ?", contact);
    for (const ref of [paid, shipped, cancelled, contact]) s.age(ref, '-30 days');
    const stockBefore = s.stock();
    const r = await s.expire();
    assert.deepStrictEqual([r.cancelled, r.overdue], [[], []]);
    assert.strictEqual(s.stock(), stockBefore);
    for (const ref of [paid, shipped, cancelled, contact]) assert.strictEqual(s.get(ref).overdue_at, null);
    assert.strictEqual((await s.cancelUnpaid(contact)).status, 400);
    assert.strictEqual((await s.cancelUnpaid(cancelled)).status, 400);
    assert.strictEqual(s.stock(), stockBefore, 'no stock returned twice');
  } finally { await s.close(); }
});

test('admin can still un-cancel (customer paid late): note cleared, stock taken again', async () => {
  const s = await shop();
  try {
    const ref = await s.order('bizum', 2);
    s.age(ref, '-6 days');
    await s.expire();
    assert.strictEqual((await s.cancelUnpaid(ref)).status, 200);
    assert.strictEqual(s.stock(), 10);
    assert.ok(await until(() => s.mail(ref, 'expired').state === 'sent'));   // (while it is being sent, reinstating waits: see the race test)
    assert.strictEqual((await setOrderSoon(s, ref, { status: 'paid' })).status, 200);
    const o = s.get(ref);
    assert.deepStrictEqual([o.status, o.auto_cancel_reason, o.auto_cancelled_at], ['paid', null, null]);
    assert.ok(o.paid_at);
    assert.strictEqual(s.stock(), 8, 'stock taken again');
    assert.deepStrictEqual((await s.expire()).overdue, [], 'a paid order is never overdue');
  } finally { await s.close(); }
});

// ---------- The "payment not received" e-mail is stored and retried (Codex P2) ----------
test('a failed cancellation e-mail is kept and sent on a later run; un-cancel stops it; gives up after 10 tries', async () => {
  const s = await shop();
  try {
    const a = await s.order('bizum'), b = await s.order('transfer'), c = await s.order('bizum');
    for (const ref of [a, b, c]) s.age(ref, '-6 days');
    await s.expire();
    const before = await settled(s);
    s.smtp.ctl.reject = /buyer@example\.test/;                         // the mail server refuses for now
    for (const ref of [a, b]) assert.strictEqual((await s.cancelUnpaid(ref)).status, 200);
    assert.ok(await until(() => s.mail(a, 'expired').tries >= 1 && s.mail(b, 'expired').tries >= 1), 'both tried once');
    assert.deepStrictEqual([s.mail(a, 'expired').state, s.mail(b, 'expired').state], ['due', 'due'], 'kept for a retry');
    assert.strictEqual(s.smtp.messages.length, before);

    assert.strictEqual((await setOrderSoon(s, b, { status: 'pending' })).status, 200);   // owner reinstates b: its e-mail must not go
    assert.strictEqual(s.mail(b, 'expired').state, 'dropped');
    s.smtp.ctl.reject = null;                                           // mail server is back
    await s.expire();                                                   // the 15-minute run retries
    assert.ok(await until(() => s.mail(a, 'expired').state === 'sent'));
    await sleep(300);
    assert.strictEqual(s.smtp.messages.length, before + 1, 'only a, once');
    assert.strictEqual(s.mail(b, 'expired').state, 'dropped');

    s.smtp.ctl.reject = /buyer@example\.test/;
    assert.strictEqual((await s.cancelUnpaid(c)).status, 200);
    assert.ok(await until(() => s.mail(c, 'expired').tries >= 1));
    s.sql('UPDATE mail_outbox SET tries = 9 WHERE id = ?', s.mail(c, 'expired').id);   // as if it failed 9 times already
    await s.expire();
    assert.ok(await until(() => s.mail(c, 'expired').state === 'failed'), 'gives up');
    assert.match(JSON.stringify((await s.view(c)).mails), /failed/, 'the admin sees it on the order');
    s.smtp.ctl.reject = null;
    await s.expire();
    await sleep(300);
    assert.strictEqual(s.mail(c, 'expired').state, 'failed');
    assert.strictEqual(s.smtp.messages.length, before + 1, 'not retried forever');
  } finally { await s.close(); }
});

// ---------- No misleading "cancelled" e-mail during concurrent changes (Codex P2) ----------
test('race: an order reinstated while another cancellation e-mail is in flight never gets its e-mail; the in-flight one blocks reinstating', async () => {
  const s = await shop();
  try {
    const a = await s.order('bizum', 1), b = await s.order('transfer', 2);
    for (const ref of [a, b]) s.age(ref, '-6 days');
    await s.expire();
    const before = await settled(s);
    s.smtp.ctl.delayMs = 1500;                                          // the mail server is slow: a's e-mail stays in flight
    assert.strictEqual((await s.cancelUnpaid(a)).status, 200);
    assert.strictEqual((await s.cancelUnpaid(b)).status, 200);          // queued while a's send is running
    assert.ok(await until(() => s.smtp.ctl.inFlight === 1), 'a is being sent');
    assert.strictEqual(s.mail(a, 'expired').state, 'sending');
    assert.strictEqual(s.mail(b, 'expired').state, 'due');

    // b is not on its way yet: reinstating it drops its e-mail for good
    assert.strictEqual((await s.srv.setOrder(b, { status: 'pending' })).status, 200);
    // a is on its way: it can't be unsent, so reinstating or recording a payment must wait
    const blocked = await s.srv.setOrder(a, { status: 'paid' });
    assert.strictEqual(blocked.status, 409, JSON.stringify(blocked.body));
    assert.match(blocked.body.error, /gönderiliyor/);
    assert.strictEqual((await s.srv.admin('POST', `/api/admin/orders/${s.get(a).id}/late-payment`, { confirm: true })).status, 409);
    assert.deepStrictEqual([s.get(a).status, s.get(a).paid_at], ['cancelled', null], 'nothing changed under the e-mail');

    assert.ok(await until(() => s.mail(a, 'expired').state === 'sent'));
    await sleep(500);
    assert.strictEqual(s.smtp.messages.length, before + 1, 'only a was told');
    assert.strictEqual(s.mail(b, 'expired').state, 'dropped');
    assert.deepStrictEqual([s.get(b).status, s.stock()], ['pending', 10 - 2], 'b reinstated with its stock');
    s.smtp.ctl.delayMs = 0;
    assert.strictEqual((await s.srv.setOrder(a, { status: 'paid' })).status, 200, 'after the send the admin can go on');
  } finally { await s.close(); }
});

// ---------- A payment that arrives after the cancellation (Codex P1) ----------
test('late Bizum payment after cancellation: recorded, order stays cancelled, no stock taken, refund due, in Finance', async () => {
  const s = await shop();
  try {
    const late = await s.order('bizum', 3);
    s.age(late, '-6 days');
    await s.expire();
    s.smtp.ctl.reject = /buyer@example\.test/;                         // its "payment not received" e-mail hasn't gone yet
    assert.strictEqual((await s.cancelUnpaid(late)).status, 200);
    assert.strictEqual(s.stock(), 10);
    // its first send attempt has failed and it waits for a retry (while a send is in flight, the
    // order can't be changed: see the race test)
    assert.ok(await until(() => s.mail(late, 'expired').tries >= 1 && s.mail(late, 'expired').state === 'due'));
    await s.order('transfer', 10);                                      // the returned stock is sold to someone else
    assert.strictEqual(s.stock(), 0);
    const id = s.get(late).id, LATE = `/api/admin/orders/${id}/late-payment`;
    const total = s.get(late).total_cents;

    // the only old way — "paid" — needs the stock back, and there is none
    const paidTry = await s.srv.setOrder(late, { status: 'paid' });
    assert.strictEqual(paidTry.status, 400);
    assert.match(paidTry.body.error, /Stok yetersiz/);
    assert.deepStrictEqual([s.get(late).status, s.get(late).paid_at, s.stock()], ['cancelled', null, 0]);
    // and a refund needs a recorded payment
    assert.strictEqual((await s.srv.refund(late, total)).status, 400);

    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' });
    const future = new Date(Date.now() + 3 * 86400e3).toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' });
    assert.strictEqual((await s.srv.admin('POST', LATE, { paid_on: today })).status, 400, 'needs confirmation');
    assert.strictEqual((await s.srv.admin('POST', LATE, { confirm: true, paid_on: future })).status, 400, 'not in the future');
    assert.strictEqual((await s.srv.admin('POST', LATE, { confirm: true, paid_on: '2020-01-01' })).status, 400, 'not before the order');
    assert.strictEqual((await s.srv.admin('POST', LATE, { confirm: true, paid_on: '31/02/2026' })).status, 400, 'a real date');

    // recorded once, even with a double click
    const [r1, r2] = await Promise.all([s.srv.admin('POST', LATE, { confirm: true, paid_on: today }), s.srv.admin('POST', LATE, { confirm: true, paid_on: today })]);
    assert.deepStrictEqual([r1.status, r2.status].sort(), [200, 409]);
    assert.strictEqual((await s.srv.admin('POST', LATE, { confirm: true })).status, 409, 'never twice');
    const o = s.get(late);
    assert.deepStrictEqual([o.status, o.paid_via, o.paid_at_estimated, o.auto_cancel_reason], ['cancelled', 'late', 0, 'unpaid_5_days']);
    assert.ok(o.paid_at && o.late_payment_recorded_at, 'both dates stored');
    assert.strictEqual(s.stock(), 0, 'no stock taken');
    assert.strictEqual(s.mail(late, 'expired').state, 'dropped', '"payment not received" must not go out now');
    const v = await s.view(late);
    assert.deepStrictEqual([v.needs_refund, v.refund_due_cents], [1, total], 'refund due');

    // Finance: income when the money arrived, refund when it is given back
    const fin = async () => (await s.srv.admin('GET', '/api/admin/finance')).body.web;
    assert.strictEqual((await fin()).payments_cents, total);
    assert.strictEqual((await s.srv.refund(late, total)).status, 200);
    const after = await fin();
    assert.deepStrictEqual([after.payments_cents, after.refunds_cents], [total, total]);
    assert.strictEqual((await s.view(late)).needs_refund, 0);
    // a late-paid order can't be put back to "pending" (the payment stays on record)
    assert.strictEqual((await s.srv.setOrder(late, { status: 'pending' })).status, 400);
    s.smtp.ctl.reject = null;
    await s.expire();
    await sleep(300);
    assert.strictEqual(s.mail(late, 'expired').state, 'dropped');
  } finally { await s.close(); }
});

test('late payment: dated on the day the money arrived (Madrid), only for cancelled Bizum/transfer orders', async () => {
  const s = await shop();
  try {
    const jan = await s.order('transfer', 1), open = await s.order('bizum', 1), card = await s.order('card', 1);
    await s.srv.setOrder(jan, { status: 'cancelled' });
    s.sql("UPDATE orders SET created_at = '2026-01-20 10:00:00' WHERE ref = ?", jan);
    const late = id => s.srv.admin('POST', `/api/admin/orders/${id}/late-payment`, { confirm: true, paid_on: '31/01/2026' });
    assert.strictEqual((await late(s.get(jan).id)).status, 200);
    assert.strictEqual(s.get(jan).paid_at, '2026-01-30 23:00:00', '31 January 00:00 in Madrid');
    const fin = async m => (await s.srv.admin('GET', '/api/admin/finance?month=' + m)).body.web.payments_cents;
    assert.strictEqual(await fin('2026-01'), s.get(jan).total_cents);
    assert.strictEqual(await fin('2026-02'), 0);

    s.sql("UPDATE orders SET created_at = '2026-01-20 10:00:00' WHERE ref IN (?, ?)", open, card);
    assert.strictEqual((await late(s.get(open).id)).status, 409, 'not cancelled: use "Ödeme geldi"');
    s.sql("UPDATE orders SET status = 'cancelled' WHERE ref = ?", card);
    assert.strictEqual((await late(s.get(card).id)).status, 400, 'card payments come from Stripe');
    assert.strictEqual((await s.srv.call('POST', `/api/admin/orders/${s.get(jan).id}/late-payment`, { confirm: true })).status, 401, 'admin only');
  } finally { await s.close(); }
});

// ---------- Card payment e-mails are kept and retried (Codex P2) ----------
test('card: payment found by the check while the mail server fails → payment kept, e-mails retried once each', async () => {
  const s = await shop();
  try {
    const found = await s.order('card', 2), back = await s.order('card', 1);
    s.age(found, '-3 hours');
    Object.assign(s.sessionOf(found), { status: 'complete', payment_status: 'paid' });
    Object.assign(s.sessionOf(back), { status: 'complete', payment_status: 'paid' });
    const before = await settled(s);
    s.smtp.ctl.reject = /./;                                            // mail server refuses everything
    const r = await s.expire();
    assert.deepStrictEqual(r.paid, [found]);
    const c = await s.srv.call('POST', '/api/orders/confirm', { ref: back, session_id: s.get(back).stripe_session });
    assert.strictEqual(c.body.paid, true, 'the customer returning from Stripe is unaffected');
    for (const ref of [found, back]) {
      assert.ok(await until(() => s.mail(ref, 'confirmation')?.tries >= 1 && s.mail(ref, 'shop_new_order')?.tries >= 1), ref);
      assert.deepStrictEqual([s.mail(ref, 'confirmation').state, s.mail(ref, 'shop_new_order').state], ['due', 'due']);
      assert.deepStrictEqual([s.get(ref).status, s.get(ref).paid_via], ['paid', 'stripe'], 'payment kept');
    }
    assert.strictEqual(s.smtp.messages.length, before);

    s.smtp.ctl.reject = null;                                           // mail server back
    await s.expire();
    assert.ok(await until(() => [found, back].every(ref => s.mail(ref, 'confirmation').state === 'sent' && s.mail(ref, 'shop_new_order').state === 'sent')));
    await sleep(300);
    assert.strictEqual(s.smtp.messages.length, before + 4, 'customer + shop, for each order, once');
    const sent = s.smtp.messages.slice(before).map((m, i) => s.smtp.text(before + i));
    assert.strictEqual(sent.filter(t => /^To: shop@example\.test\r?$/m.test(t)).length, 2);
    await s.expire();
    await sleep(300);
    assert.strictEqual(s.smtp.messages.length, before + 4, 'no second set');
  } finally { await s.close(); }
});

test('an e-mail left "sending" by a stopped server is sent after the restart', async () => {
  const dir = tempDir();
  try {
    let s = await shop({ dataDir: dir });
    const ref = await s.order('card');
    s.age(ref, '-3 hours');
    Object.assign(s.sessionOf(ref), { status: 'complete', payment_status: 'paid' });
    s.smtp.ctl.reject = /./;
    await s.expire();
    assert.ok(await until(() => s.mail(ref, 'confirmation')?.tries >= 1 && s.mail(ref, 'shop_new_order')?.tries >= 1));
    await s.close();
    const d = new DatabaseSync(path.join(dir, 'store.db'));
    d.prepare("UPDATE mail_outbox SET state = 'sending', claimed_at = datetime('now')").run();   // as if stopped mid-send
    d.close();
    s = await shop({ dataDir: dir });
    try {
      assert.ok(await until(() => s.mail(ref, 'confirmation').state === 'sent' && s.mail(ref, 'shop_new_order').state === 'sent'));
    } finally { await s.close(); }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---------- Card: always ask Stripe first ----------
test('card orders: Stripe page is card-only (no delayed payment methods) and expires after 1 hour', async () => {
  const s = await shop();
  try {
    const t0 = Math.floor(Date.now() / 1000);
    const ref = await s.order('card');
    const p = s.sessionOf(ref).params;
    const exp = Number(p.expires_at);
    assert.ok(exp >= t0 + 3600 - 5 && exp <= t0 + 3600 + 60, `expires_at ${exp - t0}s from now`);
    assert.deepStrictEqual(Object.entries(p).filter(([k]) => k.startsWith('payment_method_types')), [['payment_method_types[0]', 'card']]);
  } finally { await s.close(); }
});

test('card: paid at Stripe → payment recorded with confirmation e-mails, never cancelled', async () => {
  const s = await shop();
  try {
    const ref = await s.order('card', 2);
    s.age(ref, '-3 hours');
    Object.assign(s.sessionOf(ref), { status: 'complete', payment_status: 'paid' });   // Stripe gives no charge time here
    const before = s.smtp.messages.length;
    const r = await s.expire();
    assert.deepStrictEqual([r.paid, r.cancelled], [[ref], []]);
    const o = s.get(ref);
    assert.deepStrictEqual([o.status, o.paid_via, o.auto_cancel_reason, o.paid_at_estimated], ['paid', 'stripe', null, 1]);
    assert.strictEqual(s.stock(), 8, 'stock stays with the paid order');
    assert.strictEqual(await s.smtp.waitFor(before + 2), before + 2, 'customer confirmation + shop notice');
    await sleep(300);
    assert.strictEqual(s.smtp.messages.length, before + 2);
    assert.strictEqual((await s.srv.admin('GET', '/api/admin/finance')).body.web.payments_cents, o.total_cents, 'counted as income');
    await s.expire();
    assert.strictEqual(s.smtp.messages.length, before + 2, 'no second set of e-mails');
  } finally { await s.close(); }
});

// ---------- Stripe's payment time, not the time we noticed (Codex P2) ----------
test('card: a payment found later is dated when Stripe took the money, in the right Finance month', async () => {
  const s = await shop();
  try {
    const late = await s.order('card', 2), back = await s.order('card', 1);
    // paid on 31 January 2026 at 23:30 Madrid (22:30 UTC); our check only notices it now
    s.sql("UPDATE orders SET created_at = '2026-01-31 20:00:00' WHERE ref = ?", late);
    Object.assign(s.sessionOf(late), { status: 'complete', payment_status: 'paid', chargeCreated: Date.UTC(2026, 0, 31, 22, 30) / 1000 });
    const r = await s.expire();
    assert.deepStrictEqual(r.paid, [late]);
    assert.ok(s.stripe.state.getUrls.every(u => /[?&]expand(\[\]|%5B%5D)=payment_intent\.latest_charge/.test(u)), s.stripe.state.getUrls.join());
    const o = s.get(late);
    assert.deepStrictEqual([o.paid_at, o.paid_at_estimated, o.paid_via], ['2026-01-31 22:30:00', 0, 'stripe']);
    const fin = async m => (await s.srv.admin('GET', '/api/admin/finance?month=' + m)).body.web.payments_cents;
    assert.strictEqual(await fin('2026-01'), o.total_cents, 'January (Madrid time)');
    assert.strictEqual(await fin('2026-02'), 0);

    // the customer's return page uses Stripe's time too
    const charged = Math.floor(Date.now() / 1000) - 90;
    Object.assign(s.sessionOf(back), { status: 'complete', payment_status: 'paid', chargeCreated: charged });
    const c = await s.srv.call('POST', '/api/orders/confirm', { ref: back, session_id: s.get(back).stripe_session });
    assert.strictEqual(c.body.paid, true);
    assert.deepStrictEqual([s.get(back).paid_at, s.get(back).paid_at_estimated],
      [new Date(charged * 1000).toISOString().slice(0, 19).replace('T', ' '), 0]);
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
    assert.deepStrictEqual([s.get(ref).status, s.get(ref).auto_cancel_reason, s.get(ref).paid_at, s.mail(ref, 'expired')], ['cancelled', 'card_checkout_expired', null, undefined]);
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
      processing: { status: 'complete', payment_status: 'unpaid' },               // should not happen with card-only
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

// ---------- Orders that keep being skipped can't block the rest (Codex P1) ----------
test('card: orders that are always skipped do not starve later ones', async () => {
  const s = await shop({ env: { EXPIRY_BATCH: '2' } });                 // 2 Stripe checks per run in this test
  try {
    const stuck1 = await s.order('card'), stuck2 = await s.order('card'), later = await s.order('card', 3);
    for (const ref of [stuck1, stuck2, later]) s.age(ref, '-3 hours');
    Object.assign(s.sessionOf(stuck1), { status: 'expired', payment_status: 'unpaid', fail: 500 });  // Stripe keeps failing
    s.sql('UPDATE orders SET stripe_session = NULL WHERE ref = ?', stuck2);                          // can never be checked
    Object.assign(s.sessionOf(later), { status: 'expired', payment_status: 'unpaid' });
    const r1 = await s.expire();
    assert.deepStrictEqual(r1.skipped.map(x => x.ref).sort(), [stuck1, stuck2].sort(), 'oldest first');
    assert.strictEqual(s.get(later).status, 'pending');
    const r2 = await s.expire();
    assert.deepStrictEqual(r2.cancelled, [later], 'the next run reaches the later order');
    assert.strictEqual(s.stock(), 10 - 2);
    const r3 = await s.expire();                                         // and the stuck ones keep their turn
    assert.deepStrictEqual(r3.skipped.map(x => x.ref).sort(), [stuck1, stuck2].sort());
    assert.deepStrictEqual([s.get(stuck1).status, s.get(stuck2).status], ['pending', 'pending']);
  } finally { await s.close(); }
});

// ---------- The manual endpoint answers in time (Codex P2) ----------
test('manual check answers within its time limit while Stripe is slow; the run finishes in the background', async () => {
  const s = await shop({ env: { EXPIRY_REPLY_MS: '300' } });            // 20 s in production
  try {
    const ref = await s.order('card', 2);
    s.age(ref, '-3 hours');
    Object.assign(s.sessionOf(ref), { status: 'expired', payment_status: 'unpaid', delayMs: 1500 });
    const t0 = Date.now();
    const r = await s.srv.admin('POST', EXPIRE);
    assert.ok(Date.now() - t0 < 1200, `answered after ${Date.now() - t0} ms`);
    assert.deepStrictEqual([r.status, r.body.done, r.body.running], [202, false, true]);
    const again = await s.srv.admin('POST', EXPIRE);                    // joins the same run, never a second one
    assert.strictEqual(again.status, 202);
    assert.ok(await until(() => s.get(ref).status === 'cancelled'), 'finished in the background');
    assert.strictEqual(s.stock(), 10, 'stock returned once');
    await sleep(300);
    assert.strictEqual(s.stripe.state.gets, 1, 'Stripe asked once');
    const done = await s.srv.admin('POST', EXPIRE);
    assert.deepStrictEqual([done.status, done.body.done], [200, true]);
  } finally { await s.close(); }
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
test('the check also runs when the server starts (flags, never cancels)', async () => {
  const dir = tempDir();
  try {
    let s = await shop({ dataDir: dir });
    const ref = await s.order('bizum', 5), product = s.product;
    await s.close();
    const d = new DatabaseSync(path.join(dir, 'store.db'));
    d.prepare("UPDATE orders SET created_at = datetime('now', '-6 days') WHERE ref = ?").run(ref);
    d.close();
    s = await shop({ dataDir: dir });
    try {
      assert.ok(await until(() => s.get(ref).overdue_at !== null), 'flagged at startup');
      assert.deepStrictEqual([s.get(ref).status, s.get(ref).auto_cancel_reason], ['pending', null]);
      const d2 = new DatabaseSync(path.join(dir, 'store.db'));
      try { assert.strictEqual(d2.prepare('SELECT stock FROM products WHERE id = ?').get(product).stock, 10 - 5, 'stock still reserved'); }
      finally { d2.close(); }
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
    assert.strictEqual((await s.cancelUnpaid(ref)).status, 400);
    const after = s.get(ref);
    assert.deepStrictEqual([after.paid_at, after.status, after.auto_cancel_reason], [before.paid_at, 'cancelled', null]);
    assert.strictEqual(JSON.parse((await s.srv.orderByRef(ref)).refunds).length, 1);
    const finAfter = (await s.srv.admin('GET', '/api/admin/finance')).body;
    assert.deepStrictEqual([finAfter.web.payments_cents, finAfter.web.refunds_cents], [finBefore.web.payments_cents, finBefore.web.refunds_cents]);
  } finally { await s.close(); }
});

test('the check and the cancel endpoints are admin-only', async () => {
  const s = await shop();
  try {
    const ref = await s.order('bizum');
    s.age(ref, '-6 days');
    await s.expire();
    const id = s.get(ref).id;
    assert.strictEqual((await s.srv.call('POST', EXPIRE)).status, 401);
    assert.strictEqual((await s.srv.call('POST', `/api/admin/orders/${id}/cancel-unpaid`, { confirm: true })).status, 401);
    assert.strictEqual(s.get(ref).status, 'pending', 'nothing done without an admin session');
    assert.strictEqual(s.stock(), 9);
  } finally { await s.close(); }
});

// ---------- Mail outbox: fair retries, and e-mails that became untrue (Codex P2 ×4) ----------
test('outbox: e-mails that keep failing do not hold back a new one (least-tried first)', async () => {
  const s = await shop();
  try {
    const failing = await s.order('bizum'), fresh = await s.order('transfer');
    for (const ref of [failing, fresh]) await s.srv.setOrder(ref, { status: 'cancelled' });
    await settled(s);
    const d = new DatabaseSync(path.join(s.srv.dataDir, 'store.db'));
    try {
      // 55 cancelled orders whose "payment not received" e-mail keeps being refused (more than one batch of 50)
      const cols = d.prepare('PRAGMA table_info(orders)').all().map(c => c.name).filter(c => c !== 'id' && c !== 'ref').join(', ');
      const id = ref => d.prepare('SELECT id FROM orders WHERE ref = ?').get(ref).id;
      for (let i = 0; i < 55; i++) {
        d.prepare(`INSERT INTO orders (ref, ${cols}) SELECT ?, ${cols} FROM orders WHERE ref = ?`).run(`VN-FAIL${i}`, failing);
        d.prepare("INSERT INTO mail_outbox (order_id, kind, tries) VALUES (?, 'expired', 1)").run(id(`VN-FAIL${i}`));
      }
      // then a new one, to an address that works
      d.prepare("UPDATE orders SET email = 'fresh@example.test' WHERE ref = ?").run(fresh);
      d.prepare("INSERT INTO mail_outbox (order_id, kind) VALUES (?, 'expired')").run(id(fresh));
    } finally { d.close(); }
    s.smtp.ctl.reject = /buyer@example\.test/;
    await s.expire();                                                   // the 15-minute run sends the queue
    assert.ok(await until(() => s.mail(fresh, 'expired').state === 'sent'), 'the new e-mail went out on the first run');
    assert.strictEqual(s.smtp.messages.map((m, i) => s.smtp.text(i)).filter(t => /^To: fresh@example\.test\r?$/m.test(t)).length, 1);
  } finally { await s.close(); }
});

test('outbox: "paid after cancelling, refund" e-mails are dropped when the order is reinstated; in flight → 409', async () => {
  const s = await shop();
  try {
    // a card order cancelled by the admin, then paid at Stripe anyway
    const chargedLater = async () => {
      const ref = await s.order('card');
      await s.srv.setOrder(ref, { status: 'cancelled' });
      Object.assign(s.sessionOf(ref), { status: 'complete', payment_status: 'paid' });
      const c = await s.srv.call('POST', '/api/orders/confirm', { ref, session_id: s.get(ref).stripe_session });
      assert.deepStrictEqual([c.body.status, c.body.paid], ['cancelled', true]);
      return ref;
    };
    await settled(s);
    s.smtp.ctl.reject = /./;                                            // the mail server refuses: both wait for a retry
    const a = await chargedLater();
    assert.ok(await until(() => s.mail(a, 'charged_after_cancel')?.tries >= 1 && s.mail(a, 'shop_charged_after_cancel')?.tries >= 1));
    assert.strictEqual((await setOrderSoon(s, a, { status: 'paid' })).status, 200);   // the admin ships it after all
    assert.deepStrictEqual([s.mail(a, 'charged_after_cancel').state, s.mail(a, 'shop_charged_after_cancel').state], ['dropped', 'dropped']);
    s.smtp.ctl.reject = null;
    const before = await settled(s);                                    // (the "paid" status e-mail)
    await s.expire();
    await sleep(500);
    assert.strictEqual(s.smtp.messages.length, before, 'no "will not ship, refund" after reinstating');
    assert.strictEqual(s.mail(a, 'charged_after_cancel').state, 'dropped');

    s.smtp.ctl.delayMs = 1500;                                          // now the mail server is slow
    const b = await chargedLater();
    assert.ok(await until(() => s.mail(b, 'charged_after_cancel')?.state === 'sending'));
    const r = await s.srv.setOrder(b, { status: 'paid' });
    assert.strictEqual(r.status, 409, 'that e-mail is on its way: reinstating waits');
    assert.strictEqual(s.get(b).status, 'cancelled');
    s.smtp.ctl.delayMs = 0;
  } finally { await s.close(); }
});

test('outbox: undoing an admin-recorded payment drops its confirmation e-mails; in flight → 409', async () => {
  const s = await shop();
  try {
    const a = await s.order('card'), b = await s.order('card');
    await settled(s);
    s.smtp.ctl.reject = /./;
    assert.strictEqual((await s.srv.setOrder(a, { status: 'paid' })).status, 200);   // admin marks it paid…
    assert.ok(await until(() => s.mail(a, 'confirmation')?.tries >= 1 && s.mail(a, 'shop_new_order')?.tries >= 1));
    assert.strictEqual((await setOrderSoon(s, a, { status: 'pending' })).status, 200); // …by mistake: undone
    assert.deepStrictEqual([s.get(a).paid_at, s.mail(a, 'confirmation').state, s.mail(a, 'shop_new_order').state], [null, 'dropped', 'dropped']);
    s.smtp.ctl.reject = null;
    const before = await settled(s);
    await s.expire();
    await sleep(500);
    assert.strictEqual(s.smtp.messages.length, before, 'no "payment received" for an unpaid order');

    s.smtp.ctl.delayMs = 1500;
    assert.strictEqual((await s.srv.setOrder(b, { status: 'paid' })).status, 200);
    assert.ok(await until(() => s.mail(b, 'confirmation')?.state === 'sending'));
    const r = await s.srv.setOrder(b, { status: 'pending' });
    assert.strictEqual(r.status, 409, 'the confirmation is on its way: undoing waits');
    assert.deepStrictEqual([s.get(b).status, !!s.get(b).paid_at], ['paid', true]);
    s.smtp.ctl.delayMs = 0;
  } finally { await s.close(); }
});

test('outbox: a cancellation e-mail that failed is sent for a new cancellation after reinstating', async () => {
  const s = await shop();
  try {
    const ref = await s.order('bizum');
    s.age(ref, '-6 days');
    await s.expire();
    await settled(s);
    s.smtp.ctl.reject = /buyer@example\.test/;
    assert.strictEqual((await s.cancelUnpaid(ref)).status, 200);
    assert.ok(await until(() => s.mail(ref, 'expired').tries >= 1 && s.mail(ref, 'expired').state === 'due'));
    s.sql('UPDATE mail_outbox SET tries = 9 WHERE id = ?', s.mail(ref, 'expired').id);
    await s.expire();
    assert.ok(await until(() => s.mail(ref, 'expired').state === 'failed'), 'gave up');

    assert.strictEqual((await setOrderSoon(s, ref, { status: 'pending' })).status, 200);   // reinstated
    assert.notStrictEqual(s.mail(ref, 'expired').state, 'failed', 'no "e-mail failed" warning on a reinstated order');
    s.smtp.ctl.reject = null;
    const before = await settled(s);
    await s.expire();                                                   // still overdue
    assert.strictEqual((await s.cancelUnpaid(ref)).status, 200);        // still not paid: cancelled again
    assert.ok(await until(() => s.mail(ref, 'expired').state === 'sent'), 'the new cancellation is told');
    await sleep(300);
    assert.strictEqual(s.smtp.messages.length, before + 1);
    assert.match(s.smtp.text(before), /no hemos recibido el pago/);
  } finally { await s.close(); }
});
