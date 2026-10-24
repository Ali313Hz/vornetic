// test/webhook.test.js — Stripe webhook (pre-launch PR 3).
// Real server, throwaway database, fake Stripe and fake SMTP on 127.0.0.1, events signed in the test
// with a test-only secret exactly the way Stripe signs them. No real Stripe, no real payments.
const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { startServer, fakeSmtp, fakeStripe, CUSTOMER, VIA_PROXY } = require('./helpers');
const { verifyWebhook } = require('../stripe');

const SECRET = 'whsec_test_only_not_a_real_secret';
const HOOK = '/api/stripe/webhook';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (fn, ms = 5000) => { for (let t = 0; t < ms && !fn(); t += 50) await sleep(50); return fn(); };

// Sign like Stripe: "t=<unix>,v1=<hex HMAC-SHA256 of "<t>.<body>">"
const sign = (body, { secret = SECRET, t = Math.floor(Date.now() / 1000) } = {}) =>
  `t=${t},v1=${crypto.createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;
const event = (type, session, extra = {}) => JSON.stringify({ id: 'evt_' + crypto.randomUUID(), type, data: { object: { id: session, object: 'checkout.session', ...extra } } });

// A server with card payments (fake Stripe), the webhook secret (null = not set) and one product
async function shop({ webhookSecret = SECRET } = {}) {
  const smtp = await fakeSmtp();
  const stripe = await fakeStripe();
  let srv;
  try {
    srv = await startServer({ ...smtp.env, ...stripe.env, STRIPE_WEBHOOK_SECRET: webhookSecret ?? undefined });
  } catch (e) { await smtp.close(); await stripe.close(); throw e; }
  await srv.admin('PUT', '/api/admin/settings', { shop_email: 'shop@example.test' });
  const cat = (await srv.admin('GET', '/api/admin/categories')).body[0].slug;
  const product = (await srv.admin('POST', '/api/admin/products', { category: cat, name_en: 'Test item', name_es: 'Artículo test', price_cents: 1000, stock: 10 })).body.id;
  const one = (q, ...a) => { const d = new DatabaseSync(path.join(srv.dataDir, 'store.db')); try { return d.prepare(q).get(...a); } finally { d.close(); } };
  const ctx = {
    srv, smtp, stripe,
    stock: () => one('SELECT stock FROM products WHERE id = ?', product).stock,
    order: async (qty = 1) => {
      const r = await srv.call('POST', '/api/orders', { ...CUSTOMER, payment_method: 'card', items: [{ id: product, qty }] });
      assert.strictEqual(r.status, 200, JSON.stringify(r.body));
      return r.body.ref;
    },
    get: ref => one('SELECT * FROM orders WHERE ref = ?', ref),
    session: ref => one('SELECT stripe_session FROM orders WHERE ref = ?', ref).stripe_session,
    sessionOf: ref => stripe.state.sessions[ctx.session(ref)],
    mail: (ref, kind) => one('SELECT m.* FROM mail_outbox m JOIN orders o ON o.id = m.order_id WHERE o.ref = ? AND m.kind = ?', ref, kind),
    // POST raw bytes to the webhook, as Stripe does (signature header optional)
    hook: async (body, signature) => {
      const r = await fetch(srv.base + HOOK, { method: 'POST', body,
        headers: { 'Content-Type': 'application/json; charset=utf-8', ...VIA_PROXY, ...(signature && { 'Stripe-Signature': signature }) } });
      return { status: r.status, body: await r.json().catch(() => null) };
    },
    async close() { await srv.stop(); await smtp.close(); await stripe.close(); },
  };
  await smtp.waitFor(0);
  return ctx;
}
async function settled(s) { let n; do { n = s.smtp.messages.length; await sleep(400); } while (s.smtp.messages.length !== n); return n; }

// ---------- The signature check itself ----------
test('signature check: Stripe-format signature accepted; wrong secret, tampering, old or future timestamp, junk refused', () => {
  const body = Buffer.from(event('checkout.session.completed', 'cs_x'));
  const now = Math.floor(Date.now() / 1000);
  assert.strictEqual(verifyWebhook(body, sign(body), SECRET).type, 'checkout.session.completed');
  // several v1 signatures (secret being rotated): any one matching is enough
  assert.ok(verifyWebhook(body, `t=${now},v1=${'0'.repeat(64)},${sign(body).split(',')[1]}`, SECRET));
  const refused = [
    [body, sign(body, { secret: 'whsec_other' })],
    [Buffer.from(body.toString().replace('cs_x', 'cs_y')), sign(body)],
    [body, sign(body, { t: now - 301 })],
    [body, sign(body, { t: now + 301 })],
    [body, `t=${now}`], [body, 'v1=abc'], [body, ''], [body, undefined],
    [body.toString(), sign(body)],                                       // not the raw bytes
  ];
  for (const [b, h] of refused) assert.throws(() => verifyWebhook(b, h, SECRET), undefined, String(h));
  assert.throws(() => verifyWebhook(body, sign(body), ''), /secret/);
});

// ---------- Paid: recorded at once, even if the customer never comes back ----------
test('checkout.session.completed: payment recorded at Stripe\'s time, e-mails once; a replayed event changes nothing', async () => {
  const s = await shop();
  try {
    const ref = await s.order(2);
    const charged = Math.floor(Date.now() / 1000) - 30;
    Object.assign(s.sessionOf(ref), { status: 'complete', payment_status: 'paid', chargeCreated: charged });
    const before = await settled(s);
    const body = event('checkout.session.completed', s.session(ref));
    const sig = sign(body);
    const r = await s.hook(body, sig);
    assert.strictEqual(r.status, 200);
    const o = s.get(ref);
    assert.deepStrictEqual([o.status, o.paid_via, o.paid_at, o.paid_at_estimated, !!o.stripe_done_at],
      ['paid', 'stripe', new Date(charged * 1000).toISOString().slice(0, 19).replace('T', ' '), 0, true]);
    assert.ok(await until(() => s.mail(ref, 'confirmation')?.state === 'sent' && s.mail(ref, 'shop_new_order')?.state === 'sent'));
    assert.strictEqual(s.stock(), 8);

    const gets = s.stripe.state.gets;
    assert.strictEqual((await s.hook(body, sig)).status, 200, 'Stripe sends events more than once: always 2xx');
    await sleep(400);
    assert.strictEqual(s.smtp.messages.length, before + 2, 'customer + shop, once');
    assert.strictEqual(s.stripe.state.gets, gets, 'an already recorded order is not even looked up again');
    const fin = (await s.srv.admin('GET', '/api/admin/finance')).body.web.payments_cents;
    assert.strictEqual(fin, o.total_cents, 'in Finance once');
  } finally { await s.close(); }
});

test('the event is only a signal: Stripe is asked, and an event that says "paid" for an unpaid session records nothing', async () => {
  const s = await shop();
  try {
    const ref = await s.order();
    // a correctly signed event whose payload claims more than Stripe confirms
    const body = event('checkout.session.completed', s.session(ref), { payment_status: 'paid', amount_total: 1 });
    assert.strictEqual((await s.hook(body, sign(body))).status, 200);
    assert.ok(s.stripe.state.getUrls.some(u => u.startsWith(`/v1/checkout/sessions/${s.session(ref)}`)), 'asked Stripe');
    assert.deepStrictEqual([s.get(ref).status, s.get(ref).paid_at], ['pending', null], 'Stripe says open / unpaid: nothing recorded');
  } finally { await s.close(); }
});

// ---------- Refused and ignored requests ----------
test('unsigned, wrongly signed, tampered or old requests are refused (400) and change nothing', async () => {
  const s = await shop();
  try {
    const ref = await s.order();
    Object.assign(s.sessionOf(ref), { status: 'complete', payment_status: 'paid' });
    const body = event('checkout.session.completed', s.session(ref));
    const cases = {
      'no signature': [body, undefined],
      'wrong secret': [body, sign(body, { secret: 'whsec_attacker' })],
      'tampered body': [body.replace('checkout.session.completed', 'checkout.session.expired'), sign(body)],
      'six minutes old': [body, sign(body, { t: Math.floor(Date.now() / 1000) - 360 })],
      'not JSON content': [body, sign(body)],
    };
    for (const [name, [b, sig]] of Object.entries(cases)) {
      const r = name === 'not JSON content'
        ? await fetch(s.srv.base + HOOK, { method: 'POST', body: b, headers: { 'Content-Type': 'text/plain', 'Stripe-Signature': sig, ...VIA_PROXY } }).then(x => ({ status: x.status }))
        : await s.hook(b, sig);
      assert.strictEqual(r.status, 400, name);
    }
    assert.strictEqual(s.stripe.state.gets, 0, 'Stripe not even asked');
    assert.deepStrictEqual([s.get(ref).status, s.get(ref).paid_at], ['pending', null]);
  } finally { await s.close(); }
});

test('without STRIPE_WEBHOOK_SECRET the webhook answers 503 and does nothing; the server warns at start', async () => {
  const s = await shop({ webhookSecret: null });
  try {
    const ref = await s.order();
    Object.assign(s.sessionOf(ref), { status: 'complete', payment_status: 'paid' });
    const body = event('checkout.session.completed', s.session(ref));
    assert.strictEqual((await s.hook(body, sign(body))).status, 503);
    assert.strictEqual(s.get(ref).paid_at, null);
    assert.match(s.srv.log, /STRIPE_WEBHOOK_SECRET is not set/);
  } finally { await s.close(); }
});

test('events for other sessions or of other types are acknowledged (200) and ignored', async () => {
  const s = await shop();
  try {
    const ref = await s.order();
    for (const body of [event('checkout.session.completed', 'cs_someone_else'), event('payment_intent.succeeded', s.session(ref)),
      JSON.stringify({ id: 'evt_x', type: 'checkout.session.completed', data: {} })]) {
      assert.strictEqual((await s.hook(body, sign(body))).status, 200);
    }
    assert.strictEqual(s.stripe.state.gets, 0);
    assert.strictEqual(s.get(ref).status, 'pending');
  } finally { await s.close(); }
});

// ---------- Amount, expiry, failures, races ----------
test('paid, but not this order\'s total or not in euros: not recorded, the order shows a warning', async () => {
  const s = await shop();
  try {
    const a = await s.order(), b = await s.order();
    Object.assign(s.sessionOf(a), { status: 'complete', payment_status: 'paid', amountTotal: 100 });
    Object.assign(s.sessionOf(b), { status: 'complete', payment_status: 'paid', currency: 'usd' });
    for (const ref of [a, b]) {
      const body = event('checkout.session.completed', s.session(ref));
      assert.strictEqual((await s.hook(body, sign(body))).status, 200);
      assert.deepStrictEqual([s.get(ref).status, s.get(ref).paid_at], ['pending', null]);
      assert.ok(s.get(ref).stripe_mismatch, 'warning stored');
      assert.strictEqual(s.mail(ref, 'confirmation'), undefined, 'no confirmation e-mail');
    }
    assert.match(s.get(a).stripe_mismatch, /100 eur/);
    assert.match(s.get(b).stripe_mismatch, /usd/);
    const v = (await s.srv.admin('GET', '/api/admin/orders')).body.find(o => o.ref === a);
    assert.ok(v.stripe_mismatch, 'the admin sees it');
    // the customer's return page and the 15-minute check don't record it either
    const c = await s.srv.call('POST', '/api/orders/confirm', { ref: a, session_id: s.session(a) });
    assert.strictEqual(c.body.paid, false);
    assert.strictEqual((await s.srv.admin('GET', '/api/admin/finance')).body.web.payments_cents, 0);
  } finally { await s.close(); }
});

test('checkout.session.expired: an unpaid pending order is cancelled and its stock returned; a paid one is untouched', async () => {
  const s = await shop();
  try {
    const open = await s.order(3), paid = await s.order(1);
    assert.strictEqual(s.stock(), 6);
    Object.assign(s.sessionOf(open), { status: 'expired', payment_status: 'unpaid' });
    Object.assign(s.sessionOf(paid), { status: 'complete', payment_status: 'paid' });
    for (const ref of [open, paid]) {
      const body = event('checkout.session.expired', s.session(ref));
      assert.strictEqual((await s.hook(body, sign(body))).status, 200);
    }
    assert.deepStrictEqual([s.get(open).status, s.get(open).auto_cancel_reason, !!s.get(open).stripe_done_at], ['cancelled', 'card_checkout_expired', true]);
    assert.strictEqual(s.get(paid).status, 'paid', 'Stripe says paid: recorded, never cancelled');
    assert.strictEqual(s.stock(), 9, 'only the expired order\'s stock returned');
    const again = event('checkout.session.expired', s.session(open));
    await s.hook(again, sign(again));
    assert.strictEqual(s.stock(), 9, 'a repeated event returns nothing twice');
  } finally { await s.close(); }
});

test('Stripe unreachable while handling the event → 500 (Stripe sends it again); the resent event records the payment', async () => {
  const s = await shop();
  try {
    const ref = await s.order();
    Object.assign(s.sessionOf(ref), { status: 'complete', payment_status: 'paid', fail: 500 });
    const body = event('checkout.session.completed', s.session(ref));
    assert.strictEqual((await s.hook(body, sign(body))).status, 500);
    assert.strictEqual(s.get(ref).paid_at, null);
    s.sessionOf(ref).fail = null;
    assert.strictEqual((await s.hook(body, sign(body))).status, 200, 'the resend (Stripe signs it again)');
    assert.strictEqual(s.get(ref).status, 'paid');
  } finally { await s.close(); }
});

test('race: webhook and the customer returning from Stripe at the same time → paid once, e-mails once', async () => {
  const s = await shop();
  try {
    const ref = await s.order();
    Object.assign(s.sessionOf(ref), { status: 'complete', payment_status: 'paid', delayMs: 400 });
    const before = await settled(s);
    const body = event('checkout.session.completed', s.session(ref));
    const [h, c] = await Promise.all([s.hook(body, sign(body)), s.srv.call('POST', '/api/orders/confirm', { ref, session_id: s.session(ref) })]);
    assert.deepStrictEqual([h.status, c.body.paid], [200, true]);
    assert.ok(await until(() => s.mail(ref, 'confirmation')?.state === 'sent' && s.mail(ref, 'shop_new_order')?.state === 'sent'));
    await sleep(400);
    assert.strictEqual(s.smtp.messages.length, before + 2);
  } finally { await s.close(); }
});

test('webhook after the admin cancelled: payment recorded on the still-cancelled order, refund due', async () => {
  const s = await shop();
  try {
    const ref = await s.order(2);
    assert.strictEqual((await s.srv.setOrder(ref, { status: 'cancelled' })).status, 200);
    Object.assign(s.sessionOf(ref), { status: 'complete', payment_status: 'paid' });
    const body = event('checkout.session.completed', s.session(ref));
    assert.strictEqual((await s.hook(body, sign(body))).status, 200);
    const o = s.get(ref);
    assert.deepStrictEqual([o.status, !!o.paid_at, s.stock()], ['cancelled', true, 10]);
    assert.strictEqual((await s.srv.orderByRef(ref)).needs_refund, 1);
    assert.ok(await until(() => s.mail(ref, 'charged_after_cancel')?.state === 'sent'));
  } finally { await s.close(); }
});
