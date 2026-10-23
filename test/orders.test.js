// test/orders.test.js — stock, payment state, refunds and revenue for orders.
// Every test starts the real server with a throwaway DATA_DIR. Card payments talk to a fake
// Stripe and e-mails go to a fake SMTP server, both on 127.0.0.1: no real payments, keys,
// mail or customer data (example.test is a reserved, non-routable domain).
const { test } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const http = require('node:http');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.join(__dirname, '..');
const ADMIN_PASSWORD = 'test-only-admin-password-123';
const FAKE_STRIPE_KEY = 'sk_test_fake_key_for_automated_tests';
const CUSTOMER = {
  customer_name: 'Test Customer', email: 'buyer@example.test', phone: '600000000',
  address: 'Calle Falsa 1', city: 'Madrid', zip: '28001', country: 'ES', lang: 'es',
};

// ---------- helpers ----------
const freePort = () => new Promise((resolve, reject) => {
  const s = net.createServer().listen(0, '127.0.0.1', () => {
    const { port } = s.address();
    s.close(() => resolve(port));
  }).on('error', reject);
});
const listen = server => new Promise(r => server.listen(0, '127.0.0.1', () => r(server.address().port)));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'vornetic-test-'));

// Starts server.js; always cleans up (child + its own temp dir) on failure or stop().
async function startServer(env = {}, dataDir) {
  const ownDir = !dataDir;
  if (ownDir) dataDir = tempDir();
  let child, closed, log = '';
  const cleanup = async () => {
    if (child) {
      if (child.exitCode === null && child.signalCode === null) child.kill();
      await closed;
    }
    if (ownDir) fs.rmSync(dataDir, { recursive: true, force: true });
  };
  try {
    const port = await freePort();
    const childEnv = { ...process.env, PORT: String(port), DATA_DIR: dataDir, NODE_ENV: 'test', ADMIN_PASSWORD };
    for (const k of ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'MAIL_FROM', 'STRIPE_SECRET_KEY', 'STRIPE_API_URL']) delete childEnv[k];
    Object.assign(childEnv, env);
    child = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });
    closed = new Promise(r => child.once('close', r));
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('server did not start:\n' + log)), 15000);
      const onData = d => { log += d; if (log.includes('Vornetic →')) { clearTimeout(timer); resolve(); } };
      child.stdout.on('data', onData);
      child.stderr.on('data', onData);
      child.once('exit', code => { clearTimeout(timer); reject(new Error(`server exited (${code}):\n${log}`)); });
    });
    const base = `http://127.0.0.1:${port}`;
    const res = await fetch(base + '/api/admin/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: ADMIN_PASSWORD }),
    });
    assert.strictEqual(res.status, 200);
    const cookie = res.headers.get('set-cookie').split(';')[0];
    const call = async (method, url, body, headers = {}) => {
      const r = await fetch(base + url, {
        method, headers: { 'Content-Type': 'application/json', ...headers }, body: body && JSON.stringify(body),
      });
      return { status: r.status, body: await r.json() };
    };
    const admin = (method, url, body) => call(method, url, body, { Cookie: cookie });
    const srv = {
      base, dataDir, stop: cleanup, get log() { return log; }, call, admin,
      order: (items, extra = {}) => call('POST', '/api/orders', { ...CUSTOMER, payment_method: 'contact', ...extra, items }),
      async newProduct(stock, price_cents = 1000) {
        const cat = (await admin('GET', '/api/admin/categories')).body[0].slug;
        const r = await admin('POST', '/api/admin/products', { category: cat, name_en: 'Test item', name_es: 'Artículo test', price_cents, stock });
        assert.strictEqual(r.status, 200, JSON.stringify(r.body));
        return r.body.id;
      },
      stock: async id => (await admin('GET', '/api/admin/products')).body.find(p => p.id === id).stock,
      orders: async () => (await admin('GET', '/api/admin/orders')).body,
      orderByRef: async ref => (await admin('GET', '/api/admin/orders')).body.find(o => o.ref === ref),
      async setOrder(ref, changes) {
        const o = await srv.orderByRef(ref);
        return admin('PUT', '/api/admin/orders/' + o.id, { notify: false, ...changes });
      },
      async refund(ref, amount_cents, note) {
        const o = await srv.orderByRef(ref);
        return admin('POST', `/api/admin/orders/${o.id}/refunds`, { amount_cents, note });
      },
      confirm: (ref, session_id) => call('POST', '/api/orders/confirm', { ref, session_id }),
      stats: async () => (await admin('GET', '/api/admin/stats')).body,
    };
    return srv;
  } catch (err) {
    await cleanup();
    throw err;
  }
}

// Fake Stripe: POST /v1/checkout/sessions, GET /v1/checkout/sessions/:id
async function fakeStripe() {
  const state = { failCreate: false, paymentStatus: 'unpaid', getDelayMs: 0, creates: 0, gets: 0, lastAuth: null };
  const server = http.createServer((req, res) => {
    state.lastAuth = req.headers.authorization;
    const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
    req.resume();
    req.on('end', async () => {
      if (req.method === 'POST' && req.url === '/v1/checkout/sessions') {
        state.creates++;
        if (state.failCreate) return send(401, { error: { message: 'Invalid API Key provided: sk_test_****tests' } });
        return send(200, { id: 'cs_test_' + state.creates, url: 'https://checkout.example.test/pay/' + state.creates });
      }
      const m = req.url.match(/^\/v1\/checkout\/sessions\/([\w]+)$/);
      if (req.method === 'GET' && m) {
        state.gets++;
        await sleep(state.getDelayMs);
        return send(200, { id: m[1], payment_status: state.paymentStatus });
      }
      send(404, { error: { message: 'not found' } });
    });
  });
  const port = await listen(server);
  return {
    state, server, url: `http://127.0.0.1:${port}`,
    close: () => new Promise(r => { server.closeAllConnections(); server.close(r); }),
  };
}

// Fake SMTP that accepts everything and keeps the delivered messages
async function fakeSmtp() {
  const messages = [];
  const sockets = new Set();
  const server = net.createServer(sock => {
    sockets.add(sock);
    sock.on('close', () => sockets.delete(sock));
    let buf = '', inData = false, login = 0;
    sock.write('220 fake.example.test ESMTP\r\n');
    sock.on('data', d => {
      buf += d;
      let i;
      while ((i = buf.indexOf(inData ? '\r\n.\r\n' : '\r\n')) !== -1) {
        if (inData) { messages.push(buf.slice(0, i)); buf = buf.slice(i + 5); inData = false; sock.write('250 queued\r\n'); continue; }
        const line = buf.slice(0, i); buf = buf.slice(i + 2);
        if (login) { login--; sock.write(login ? '334 UGFzc3dvcmQ6\r\n' : '235 ok\r\n'); }
        else if (/^EHLO/i.test(line)) sock.write('250-fake.example.test\r\n250 AUTH PLAIN LOGIN\r\n');
        else if (/^AUTH LOGIN/i.test(line)) { login = 2; sock.write('334 VXNlcm5hbWU6\r\n'); }
        else if (/^AUTH/i.test(line)) sock.write('235 ok\r\n');
        else if (/^DATA/i.test(line)) { inData = true; sock.write('354 go\r\n'); }
        else if (/^QUIT/i.test(line)) { sock.end('221 bye\r\n'); }
        else sock.write('250 ok\r\n');
      }
    });
    sock.on('error', () => {});
  });
  const port = await listen(server);
  return {
    messages, server,
    env: { SMTP_HOST: '127.0.0.1', SMTP_PORT: String(port), SMTP_USER: 'test@example.test', SMTP_PASS: 'test-only', MAIL_FROM: 'Shop <shop@example.test>' },
    close: () => new Promise(r => { for (const s of sockets) s.destroy(); server.close(r); }),
  };
}

// Starts the fake services a test asks for, then the server. If any step fails, everything that
// was already started is closed before the error is thrown (err.services shows what was opened),
// so a failed start never leaves a listener behind that keeps `node --test` from exiting.
async function setup({ stripe = false, smtp = false, env = {}, dataDir } = {}) {
  const ctx = {}, closers = [];
  const close = async () => { while (closers.length) await closers.pop()(); };
  try {
    if (stripe) { ctx.stripe = await fakeStripe(); closers.push(ctx.stripe.close); }
    if (smtp) { ctx.smtp = await fakeSmtp(); closers.push(ctx.smtp.close); }
    ctx.srv = await startServer({
      ...(stripe && { STRIPE_SECRET_KEY: FAKE_STRIPE_KEY, STRIPE_API_URL: ctx.stripe.url }),
      ...(smtp && ctx.smtp.env),
      ...env,
    }, dataDir);
    closers.push(ctx.srv.stop);
    ctx.close = close;
    return ctx;
  } catch (err) {
    await close();
    err.services = ctx;
    throw err;
  }
}

// Quoted-printable mail body → readable text (for checking what a message says)
const qp = s => Buffer.from(s.replace(/=\r\n/g, '').replace(/=([0-9A-F]{2})/g, (m, h) => String.fromCharCode(parseInt(h, 16))), 'latin1').toString('utf8');

// Waits until the fake SMTP has `n` messages, then a little longer to catch any duplicates
async function settledMail(smtp, n) {
  for (let i = 0; i < 40 && smtp.messages.length < n; i++) await sleep(100);
  await sleep(500);
  return smtp.messages.length;
}

// An orders table as the release before payment dates created it, with the given orders
function oldDatabase(dir, orders) {
  const db = new DatabaseSync(path.join(dir, 'store.db'));
  db.exec(`CREATE TABLE orders (id INTEGER PRIMARY KEY AUTOINCREMENT, ref TEXT UNIQUE NOT NULL, user_id INTEGER,
    customer_name TEXT NOT NULL, email TEXT NOT NULL, phone TEXT DEFAULT '', address TEXT NOT NULL, city TEXT NOT NULL,
    zip TEXT NOT NULL, province TEXT DEFAULT '', country TEXT DEFAULT 'ES', notes TEXT DEFAULT '', items TEXT NOT NULL,
    subtotal_cents INTEGER NOT NULL, shipping_cents INTEGER NOT NULL, total_cents INTEGER NOT NULL,
    payment_method TEXT NOT NULL, status TEXT DEFAULT 'pending', tracking TEXT DEFAULT '', lang TEXT DEFAULT 'es',
    stripe_session TEXT, created_at TEXT DEFAULT (datetime('now')))`);
  const add = db.prepare(`INSERT INTO orders (ref, customer_name, email, address, city, zip, items, subtotal_cents,
    shipping_cents, total_cents, payment_method, status, created_at) VALUES (?, 'T', 'old@example.test', 'A', 'M', '28001', '[]', ?, 0, ?, 'transfer', ?, ?)`);
  for (const o of orders) add.run(o.ref, o.total, o.total, o.status, o.created_at);
  db.close();
}
const daysAgo = n => new Date(Date.now() - n * 86400000).toISOString().slice(0, 19).replace('T', ' ');

// The admin page helpers (browser code) loaded straight from public/js/admin.js
function adminHelpers() {
  const src = fs.readFileSync(path.join(ROOT, 'public', 'js', 'admin.js'), 'utf8');
  const grab = re => { const m = src.match(re); assert.ok(m, 'not found in admin.js: ' + re); return m[0]; };
  const code = [grab(/^const eur = .*$/m), grab(/^function parseEuro[\s\S]*?^\}\r?$/m), grab(/^function refundWarning[\s\S]*?^\}\r?$/m)];
  return new Function(code.join('\n') + '\nreturn { eur, parseEuro, refundWarning };')();
}

// ---------- Stock is checked against the whole quantity ----------
test('an order larger than the stock is refused and changes nothing', async () => {
  const { srv, close } = await setup();
  try {
    const p = await srv.newProduct(3);
    const r = await srv.order([{ id: p, qty: 10 }]);
    assert.strictEqual(r.status, 400);
    assert.match(r.body.error, /Not enough stock: Test item \(only 3 left, you asked for 10\)/);
    assert.strictEqual(await srv.stock(p), 3);
    assert.strictEqual((await srv.orders()).length, 0, 'no order may be saved');
  } finally { await close(); }
});

test('the same product on several cart lines is checked as one total', async () => {
  const { srv, close } = await setup();
  try {
    const p = await srv.newProduct(5);
    assert.strictEqual((await srv.order([{ id: p, qty: 4 }, { id: p, qty: 4 }])).status, 400);
    assert.strictEqual(await srv.stock(p), 5);
    assert.strictEqual((await srv.order([{ id: p, qty: 2 }, { id: p, qty: 3 }])).status, 200);
    assert.strictEqual(await srv.stock(p), 0);
    assert.strictEqual((await srv.order([{ id: p, qty: 1 }])).status, 400);
  } finally { await close(); }
});

test('a cart with two products takes nothing if one of them is short', async () => {
  const { srv, close } = await setup();
  try {
    const a = await srv.newProduct(5), b = await srv.newProduct(1);
    assert.strictEqual((await srv.order([{ id: a, qty: 2 }, { id: b, qty: 2 }])).status, 400);
    assert.deepStrictEqual([await srv.stock(a), await srv.stock(b)], [5, 1]);
  } finally { await close(); }
});

test('cancelling returns exactly the ordered stock; un-cancelling takes it again', async () => {
  const { srv, close } = await setup();
  try {
    const p = await srv.newProduct(5);
    const { body: { ref } } = await srv.order([{ id: p, qty: 3 }]);
    assert.strictEqual(await srv.stock(p), 2);
    assert.strictEqual((await srv.setOrder(ref, { status: 'cancelled' })).status, 200);
    assert.strictEqual(await srv.stock(p), 5);
    assert.strictEqual((await srv.setOrder(ref, { status: 'pending' })).status, 200);
    assert.strictEqual(await srv.stock(p), 2);
  } finally { await close(); }
});

test('un-cancelling without enough stock is refused and the order stays cancelled', async () => {
  const { srv, close } = await setup();
  try {
    const p = await srv.newProduct(2);
    const { body: { ref } } = await srv.order([{ id: p, qty: 2 }]);
    await srv.setOrder(ref, { status: 'cancelled' });
    await srv.admin('POST', `/api/admin/products/${p}/stock`, { delta: -1 });   // one unit sold elsewhere
    const r = await srv.setOrder(ref, { status: 'paid' });
    assert.strictEqual(r.status, 400);
    assert.match(r.body.error, /Stok yetersiz: Test item \(stokta 1, gereken 2\)/);
    const o = await srv.orderByRef(ref);
    assert.deepStrictEqual([o.status, o.paid_at], ['cancelled', null], 'a refused change records nothing');
    assert.strictEqual(await srv.stock(p), 1);
  } finally { await close(); }
});

// ---------- Card payments (fake Stripe) ----------
test('if Stripe fails, the order is cancelled, stock comes back, and Stripe details stay hidden', async () => {
  const { srv, stripe, close } = await setup({ stripe: true });
  try {
    stripe.state.failCreate = true;
    const p = await srv.newProduct(4);
    const r = await srv.order([{ id: p, qty: 1 }], { payment_method: 'card' });
    assert.strictEqual(r.status, 400);
    assert.match(r.body.error, /Card payment is not available right now/);
    assert.doesNotMatch(r.body.error, /API Key|sk_test/);
    assert.strictEqual(stripe.state.creates, 1);
    assert.strictEqual(stripe.state.lastAuth, `Bearer ${FAKE_STRIPE_KEY}`);
    const [o] = await srv.orders();
    assert.deepStrictEqual([o.status, o.paid_at, o.needs_refund], ['cancelled', null, 0]);
    assert.strictEqual(await srv.stock(p), 4);
  } finally { await close(); }
});

test('card order: unpaid stays pending; paid is recorded once, with one set of e-mails', async () => {
  const { srv, stripe, smtp, close } = await setup({ stripe: true, smtp: true });
  try {
    const p = await srv.newProduct(4);
    const r = await srv.order([{ id: p, qty: 1 }], { payment_method: 'card' });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.redirect, 'https://checkout.example.test/pay/1');

    assert.strictEqual((await srv.confirm(r.body.ref, 'cs_test_1')).body.status, 'pending');
    assert.strictEqual((await srv.orderByRef(r.body.ref)).paid_at, null);

    // Customer opens the success page twice at once; Stripe answers slowly
    stripe.state.paymentStatus = 'paid';
    stripe.state.getDelayMs = 300;
    const [a, b] = await Promise.all([srv.confirm(r.body.ref, 'cs_test_1'), srv.confirm(r.body.ref, 'cs_test_1')]);
    assert.deepStrictEqual([a.body.status, b.body.status], ['paid', 'paid']);
    const o = await srv.orderByRef(r.body.ref);
    assert.deepStrictEqual([o.status, o.paid_via, o.paid_at_estimated], ['paid', 'stripe', 0]);
    assert.strictEqual(await settledMail(smtp, 2), 2, 'one customer confirmation + one shop notice');

    const gets = stripe.state.gets;
    assert.strictEqual((await srv.confirm(r.body.ref, 'cs_test_1')).body.status, 'paid');
    assert.strictEqual(stripe.state.gets, gets, 'an already paid order is not asked about again');
  } finally { await close(); }
});

// Codex P1: admin marks a card order paid while Stripe's answer is still on its way
test('card payment recorded by the admin during a slow confirmation still sends the e-mails once', async () => {
  const { srv, stripe, smtp, close } = await setup({ stripe: true, smtp: true });
  try {
    const p = await srv.newProduct(4);
    const r = await srv.order([{ id: p, qty: 1 }], { payment_method: 'card' });
    stripe.state.paymentStatus = 'paid';
    stripe.state.getDelayMs = 800;
    const confirming = srv.confirm(r.body.ref, 'cs_test_1');
    await sleep(200);                                               // confirmation is waiting on Stripe
    assert.strictEqual((await srv.setOrder(r.body.ref, { status: 'paid' })).status, 200);
    assert.strictEqual((await confirming).body.status, 'paid');

    assert.strictEqual(await settledMail(smtp, 2), 2, 'confirmation + shop notice, not 0 and not 4');
    assert.ok(smtp.messages.every(m => m.includes(r.body.ref)));
    assert.strictEqual((await srv.orderByRef(r.body.ref)).paid_via, 'admin');

    await srv.setOrder(r.body.ref, { status: 'shipped' });          // later changes add no confirmations
    assert.strictEqual(await settledMail(smtp, 2), 2);
  } finally { await close(); }
});

// Codex P1 (14c64b2): a cancelled checkout that gets charged must be reported as paid, and both
// the customer and the shop must hear about it — once.
test('card paid after the admin cancelled it: recorded, reported as paid, customer and shop told once', async () => {
  const { srv, stripe, smtp, close } = await setup({ stripe: true, smtp: true });
  try {
    await srv.admin('PUT', '/api/admin/settings', { shop_email: 'shop-inbox@example.test' });
    const p = await srv.newProduct(4);
    const r = await srv.order([{ id: p, qty: 1 }], { payment_method: 'card' });
    await srv.setOrder(r.body.ref, { status: 'cancelled' });
    stripe.state.paymentStatus = 'paid';
    stripe.state.getDelayMs = 300;
    // The customer's return page is opened twice at the same time
    const [a, b] = await Promise.all([srv.confirm(r.body.ref, 'cs_test_1'), srv.confirm(r.body.ref, 'cs_test_1')]);
    for (const c of [a, b]) assert.deepStrictEqual([c.body.status, c.body.paid], ['cancelled', true]);

    const o = await srv.orderByRef(r.body.ref);
    assert.deepStrictEqual([!!o.paid_at, o.paid_via, o.needs_refund, o.refund_due_cents], [true, 'stripe', 1, o.total_cents]);
    assert.strictEqual((await srv.stats()).needs_refund, 1);

    assert.strictEqual(await settledMail(smtp, 2), 2, 'one to the customer, one to the shop — not 0, not 4');
    const text = smtp.messages.map(qp);
    const toCustomer = text.find(m => /^To: buyer@example\.test\r?$/m.test(m));
    const toShop = text.find(m => /^To: shop-inbox@example\.test\r?$/m.test(m));
    assert.ok(toCustomer && toShop, 'expected one message to each address');
    assert.match(toCustomer, /ya estaba cancelado/);           // order language is Spanish
    assert.match(toCustomer, /devolveremos el importe completo/);
    assert.doesNotMatch(toCustomer, /Te avisaremos por email cuando salga|Gracias por tu pedido/);
    assert.match(toShop, /iptal edilmişti ama kartla/);
    for (const m of text) assert.ok(m.includes(r.body.ref));
  } finally { await close(); }
});

test('the card return page separates "paid" from "cancelled"', () => {
  const src = fs.readFileSync(path.join(ROOT, 'public', 'js', 'app.js'), 'utf8');
  const fn = src.match(/^function cardResultKey[\s\S]*?^\}\r?$/m);
  assert.ok(fn, 'cardResultKey not found in app.js');
  const cardResultKey = new Function(fn[0] + '\nreturn cardResultKey;')();
  assert.strictEqual(cardResultKey({ status: 'paid', paid: true }), 'paid_ok');
  assert.strictEqual(cardResultKey({ status: 'cancelled', paid: true }), 'paid_cancelled');
  assert.strictEqual(cardResultKey({ status: 'pending', paid: false }), 'pay_pending');
  assert.strictEqual(cardResultKey({ status: 'cancelled', paid: false }), 'pay_pending');
  assert.strictEqual(cardResultKey({ status: 'paid' }), 'paid_ok', 'older stored responses without "paid"');
  assert.match(src, /paid_cancelled: 'We received your payment[^']*will refund the full amount/, 'English text');
  assert.match(src, /paid_cancelled: 'Hemos recibido tu pago[^']*devolveremos el importe completo/, 'Spanish text');
});

// ---------- Codex P1: the fake Stripe address can never be used outside tests ----------
test('STRIPE_API_URL is honoured only in tests and only for a local address', () => {
  const { apiBase, overrideIgnored, LIVE_API } = require('../stripe');
  assert.strictEqual(LIVE_API, 'https://api.stripe.com');
  const cases = [
    [{}, LIVE_API],
    [{ NODE_ENV: 'production', STRIPE_API_URL: 'http://127.0.0.1:9999' }, LIVE_API],
    [{ STRIPE_API_URL: 'http://127.0.0.1:9999' }, LIVE_API],
    [{ NODE_ENV: 'development', STRIPE_API_URL: 'http://localhost:9999' }, LIVE_API],
    [{ NODE_ENV: 'test', STRIPE_API_URL: 'https://attacker.example.test' }, LIVE_API],
    [{ NODE_ENV: 'test', STRIPE_API_URL: 'http://127.0.0.1.attacker.example.test:80' }, LIVE_API],
    [{ NODE_ENV: 'test', STRIPE_API_URL: 'http://user@attacker.example.test:80' }, LIVE_API],
    [{ NODE_ENV: 'test', STRIPE_API_URL: 'http://127.0.0.1:9999/' }, 'http://127.0.0.1:9999'],
    [{ NODE_ENV: 'test', STRIPE_API_URL: 'http://localhost:9999' }, 'http://localhost:9999'],
  ];
  for (const [env, want] of cases) assert.strictEqual(apiBase(env), want, JSON.stringify(env));
  assert.strictEqual(overrideIgnored({ NODE_ENV: 'production', STRIPE_API_URL: 'http://127.0.0.1:9' }), true);
  assert.strictEqual(overrideIgnored({ NODE_ENV: 'test', STRIPE_API_URL: 'http://127.0.0.1:9' }), false);
});

test('a production server warns that STRIPE_API_URL is ignored', async () => {
  // No STRIPE_SECRET_KEY, so this server cannot call any Stripe at all
  const { srv, stripe, close } = await setup({ stripe: true, env: { NODE_ENV: 'production', STRIPE_SECRET_KEY: '' } });
  try {
    assert.match(srv.log, /STRIPE_API_URL is ignored/);
    assert.strictEqual(stripe.state.creates + stripe.state.gets, 0);
  } finally { await close(); }
});

// ---------- Codex P1: payment records survive status changes ----------
test('a Stripe payment is never erased by a status change', async () => {
  const { srv, stripe, close } = await setup({ stripe: true });
  try {
    const p = await srv.newProduct(4);
    const r = await srv.order([{ id: p, qty: 1 }], { payment_method: 'card' });
    stripe.state.paymentStatus = 'paid';
    await srv.confirm(r.body.ref, 'cs_test_1');
    const paid = await srv.orderByRef(r.body.ref);

    const back = await srv.setOrder(r.body.ref, { status: 'pending' });
    assert.strictEqual(back.status, 400);
    assert.match(back.body.error, /ödemesi kayıtlı/);
    for (const status of ['shipped', 'cancelled', 'paid']) {
      assert.strictEqual((await srv.setOrder(r.body.ref, { status })).status, 200, status);
      const o = await srv.orderByRef(r.body.ref);
      assert.deepStrictEqual([o.paid_at, o.paid_via], [paid.paid_at, 'stripe'], `after ${status}`);
    }
  } finally { await close(); }
});

test('a payment marked by hand can be undone only while nothing was refunded', async () => {
  const { srv, close } = await setup();
  try {
    const p = await srv.newProduct(5);
    const { body: { ref } } = await srv.order([{ id: p, qty: 1 }]);
    await srv.setOrder(ref, { status: 'paid' });
    let o = await srv.orderByRef(ref);
    assert.deepStrictEqual([o.paid_via, o.paid_at_estimated], ['admin', 0]);
    assert.match(o.paid_at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);

    await srv.setOrder(ref, { status: 'shipped' });
    assert.strictEqual((await srv.orderByRef(ref)).paid_at, o.paid_at, 'shipping keeps the payment date');
    assert.strictEqual((await srv.setOrder(ref, { status: 'pending' })).status, 200, 'mistaken manual mark');
    o = await srv.orderByRef(ref);
    assert.deepStrictEqual([o.paid_at, o.paid_via], [null, null]);

    await srv.setOrder(ref, { status: 'paid' });
    assert.strictEqual((await srv.refund(ref, 100)).status, 200);
    assert.strictEqual((await srv.setOrder(ref, { status: 'pending' })).status, 400);
    assert.ok((await srv.orderByRef(ref)).paid_at);

    const { body: { ref: ref2 } } = await srv.order([{ id: p, qty: 1 }]);
    await srv.setOrder(ref2, { status: 'delivered' });                 // skipping "paid" also records it
    assert.strictEqual((await srv.orderByRef(ref2)).paid_via, 'admin');
  } finally { await close(); }
});

// ---------- Codex P1: dated refund history, partial refunds ----------
test('refunds are dated records; several partial refunds add up and cannot exceed the total', async () => {
  const { srv, close } = await setup();
  try {
    const p = await srv.newProduct(5);
    const { body: { ref } } = await srv.order([{ id: p, qty: 1 }]);   // 10.00 + 3.95 shipping
    assert.strictEqual((await srv.refund(ref, 100)).status, 400, 'no refund on an unpaid order');
    await srv.setOrder(ref, { status: 'paid' });
    const total = (await srv.orderByRef(ref)).total_cents;

    assert.strictEqual((await srv.refund(ref, 300, 'broken bulb')).status, 200);
    assert.strictEqual((await srv.refund(ref, 200)).status, 200);
    const over = await srv.refund(ref, total - 500 + 1);
    assert.strictEqual(over.status, 400);
    assert.match(over.body.error, /kalan tutarı aşamaz \(en fazla 8\.95 €\)/);

    const o = await srv.orderByRef(ref);
    const history = JSON.parse(o.refunds);
    assert.deepStrictEqual(history.map(h => [h.amount_cents, h.note]), [[300, 'broken bulb'], [200, '']]);
    for (const h of history) assert.match(h.created_at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    assert.strictEqual(o.refund_total_cents, 500);

    // History cannot be edited or deleted through the API
    assert.strictEqual((await srv.admin('DELETE', `/api/admin/orders/${o.id}/refunds`)).status, 404);
    assert.strictEqual((await srv.admin('PUT', `/api/admin/orders/${o.id}/refunds`, { amount_cents: 0 })).status, 404);
    assert.strictEqual((await srv.refund(ref, total - 500)).status, 200, 'the rest can still be refunded');
    assert.strictEqual((await srv.orderByRef(ref)).refund_total_cents, total);
  } finally { await close(); }
});

// ---------- Codex P2: refund input is validated, never silently 0 ----------
test('invalid refund amounts are rejected and saving the order never changes refunds', async () => {
  const { srv, close } = await setup();
  try {
    const p = await srv.newProduct(5);
    const { body: { ref } } = await srv.order([{ id: p, qty: 1 }]);
    await srv.setOrder(ref, { status: 'paid' });
    await srv.refund(ref, 500);
    for (const bad of ['abc', '500', 0, -100, 12.5, null, undefined]) {
      const r = await srv.refund(ref, bad);
      assert.strictEqual(r.status, 400, `amount ${JSON.stringify(bad)}`);
    }
    const old = await srv.setOrder(ref, { refunded_cents: 0 });        // the previous API: refused, not applied
    assert.strictEqual(old.status, 400);
    assert.strictEqual((await srv.setOrder(ref, { status: 'shipped', tracking: 'TRK1' })).status, 200);
    assert.strictEqual((await srv.orderByRef(ref)).refund_total_cents, 500);
  } finally { await close(); }
});

test('the admin page reads euro amounts strictly (typos are errors, not 0)', () => {
  const { parseEuro } = adminHelpers();
  // Same formats as the finance CSV import (manual test 2026-10-23: "1.250,00" was refused by the form)
  const ok = { '12,50': 1250, '12.5': 1250, '12': 1200, ' 7,05 ': 705, '0,99': 99, '1234567': 123456700,
    '1.250,00': 125000, '1.234,50': 123450, '1,250.00': 125000, '12 €': 1200, '€ 12,50': 1250, '1.250.000,00': 125000000 };
  for (const [text, cents] of Object.entries(ok)) assert.strictEqual(parseEuro(text), cents, text);
  for (const bad of ['abc', '', ' ', '12,505', '-5', '1.250', '1,250', '12,', ',5', '1e3', '1.25,00', '12.345.6', null, undefined])
    assert.strictEqual(parseEuro(bad), null, JSON.stringify(bad));
});

// ---------- Codex P2: warning shows what is still owed ----------
test('a partly refunded cancelled order shows the remaining amount, not "no refund"', async () => {
  const { srv, close } = await setup();
  try {
    const p = await srv.newProduct(5);
    const { body: { ref } } = await srv.order([{ id: p, qty: 1 }]);
    await srv.setOrder(ref, { status: 'paid' });
    await srv.setOrder(ref, { status: 'cancelled' });
    let o = await srv.orderByRef(ref);
    const { eur, refundWarning } = adminHelpers();
    assert.deepStrictEqual([o.needs_refund, o.refund_due_cents], [1, o.total_cents]);
    assert.strictEqual(refundWarning(o), `⚠ Ödendi ama iptal: ${eur(o.total_cents)} iade edilmeli`);

    await srv.refund(ref, 500);
    o = await srv.orderByRef(ref);
    assert.deepStrictEqual([o.needs_refund, o.refund_due_cents], [1, o.total_cents - 500]);
    assert.strictEqual(refundWarning(o), `⚠ İade eksik: ${eur(o.total_cents - 500)} kaldı (${eur(500)} iade edildi)`);

    await srv.refund(ref, o.total_cents - 500);
    o = await srv.orderByRef(ref);
    assert.deepStrictEqual([o.needs_refund, o.refund_due_cents], [0, 0]);
    assert.strictEqual(refundWarning(o), null);
  } finally { await close(); }
});

test('a cancelled order that was never paid needs no refund', async () => {
  const { srv, close } = await setup();
  try {
    const p = await srv.newProduct(5);
    const { body: { ref } } = await srv.order([{ id: p, qty: 1 }]);
    await srv.setOrder(ref, { status: 'cancelled' });
    const o = await srv.orderByRef(ref);
    assert.deepStrictEqual([o.paid_at, o.needs_refund, o.payment_unknown], [null, 0, 0]);
  } finally { await close(); }
});

// ---------- Codex P1: legacy orders ----------
test('old orders: paid ones get an estimated date, cancelled ones are flagged "payment unknown"', async () => {
  const dir = tempDir();
  try {
    oldDatabase(dir, [
      { ref: 'VN-OLD001', status: 'delivered', total: 1395, created_at: '2026-01-31 10:00:00' },
      { ref: 'VN-OLD002', status: 'pending', total: 1395, created_at: '2026-02-01 10:00:00' },
      { ref: 'VN-OLD003', status: 'cancelled', total: 2000, created_at: '2026-02-02 10:00:00' },
      { ref: 'VN-OLD004', status: 'cancelled', total: 3000, created_at: '2026-02-03 10:00:00' },
    ]);
    let ctx = await setup({ dataDir: dir });
    try {
      const { srv } = ctx;
      const by = Object.fromEntries((await srv.orders()).map(o => [o.ref, o]));
      assert.deepStrictEqual([by['VN-OLD001'].paid_at, by['VN-OLD001'].paid_at_estimated, by['VN-OLD001'].paid_via],
        ['2026-01-31 10:00:00', 1, 'legacy']);
      assert.deepStrictEqual([by['VN-OLD002'].paid_at, by['VN-OLD002'].payment_unknown], [null, 0]);
      assert.deepStrictEqual([by['VN-OLD003'].payment_unknown, by['VN-OLD004'].payment_unknown], [1, 1]);
      assert.strictEqual((await srv.stats()).payment_unknown, 2);

      // Admin checks the old cancelled orders: one was paid (refund owed), one was not
      assert.strictEqual((await srv.setOrder('VN-OLD003', { payment_check: 'paid' })).status, 200);
      assert.strictEqual((await srv.setOrder('VN-OLD004', { payment_check: 'unpaid' })).status, 200);
      const o3 = await srv.orderByRef('VN-OLD003'), o4 = await srv.orderByRef('VN-OLD004');
      assert.deepStrictEqual([o3.paid_at, o3.paid_at_estimated, o3.needs_refund, o3.refund_due_cents, o3.payment_unknown],
        ['2026-02-02 10:00:00', 1, 1, 2000, 0]);
      assert.deepStrictEqual([o4.paid_at, o4.needs_refund, o4.payment_unknown], [null, 0, 0]);
      const st = await srv.stats();
      assert.deepStrictEqual([st.payment_unknown, st.needs_refund], [0, 1]);
      assert.strictEqual((await srv.setOrder('VN-OLD001', { payment_check: 'paid' })).status, 400, 'only for flagged orders');
      assert.strictEqual((await srv.setOrder('VN-OLD001', { status: 'pending' })).status, 400, 'an old payment is never erased');
      await srv.setOrder('VN-OLD002', { status: 'paid' });             // a real payment date
    } finally { await ctx.close(); }

    ctx = await setup({ dataDir: dir });                               // restart: no second back-fill
    try {
      const o2 = await ctx.srv.orderByRef('VN-OLD002'), o4 = await ctx.srv.orderByRef('VN-OLD004');
      assert.deepStrictEqual([o2.paid_at_estimated, o2.paid_via], [0, 'admin']);
      assert.strictEqual(o4.payment_unknown, 0);
    } finally { await ctx.close(); }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// Codex P2 (14c64b2): a wrong answer to "was this old order paid?" can be corrected, with history
test('legacy payment answers can be corrected with confirmation, and every answer is kept', async () => {
  const dir = tempDir();
  try {
    oldDatabase(dir, [
      { ref: 'VN-OLD010', status: 'cancelled', total: 2500, created_at: '2026-03-01 09:00:00' },
      { ref: 'VN-OLD011', status: 'cancelled', total: 1800, created_at: '2026-03-02 09:00:00' },
      { ref: 'VN-OLD012', status: 'delivered', total: 1200, created_at: '2026-03-03 09:00:00' },
    ]);
    const { srv, close } = await setup({ dataDir: dir });
    try {
      const history = async ref => JSON.parse((await srv.orderByRef(ref)).payment_checks).map(c => c.answer);
      const state = async ref => { const o = await srv.orderByRef(ref); return [o.paid_at, o.paid_via, o.needs_refund]; };

      // Wrongly answered "unpaid" → corrected to "paid"
      assert.strictEqual((await srv.setOrder('VN-OLD010', { payment_check: 'unpaid' })).status, 200);
      assert.deepStrictEqual(await state('VN-OLD010'), [null, null, 0]);
      let r = await srv.setOrder('VN-OLD010', { payment_check: 'paid' });
      assert.strictEqual(r.status, 400, 'a correction needs explicit confirmation');
      assert.match(r.body.error, /onay gerekli/);
      assert.strictEqual((await srv.setOrder('VN-OLD010', { payment_check: 'unpaid', confirm_correction: true })).status, 400, 'same answer again');
      assert.strictEqual((await srv.setOrder('VN-OLD010', { payment_check: 'paid', confirm_correction: true })).status, 200);
      assert.deepStrictEqual(await state('VN-OLD010'), ['2026-03-01 09:00:00', 'check', 1]);
      assert.deepStrictEqual(await history('VN-OLD010'), ['unpaid', 'paid']);
      for (const c of JSON.parse((await srv.orderByRef('VN-OLD010')).payment_checks)) assert.match(c.created_at, /^\d{4}-\d{2}-\d{2} /);

      // Wrongly answered "paid" → corrected to "unpaid" (the payment it created is removed)
      await srv.setOrder('VN-OLD011', { payment_check: 'paid' });
      assert.deepStrictEqual(await state('VN-OLD011'), ['2026-03-02 09:00:00', 'check', 1]);
      assert.strictEqual((await srv.setOrder('VN-OLD011', { payment_check: 'unpaid', confirm_correction: true })).status, 200);
      assert.deepStrictEqual(await state('VN-OLD011'), [null, null, 0]);
      assert.deepStrictEqual(await history('VN-OLD011'), ['paid', 'unpaid']);
      assert.strictEqual((await srv.orderByRef('VN-OLD011')).payment_unknown, 0);

      // Once money was refunded on it, "paid" can no longer be turned into "unpaid"
      assert.strictEqual((await srv.refund('VN-OLD010', 1000)).status, 200);
      r = await srv.setOrder('VN-OLD010', { payment_check: 'unpaid', confirm_correction: true });
      assert.strictEqual(r.status, 400);
      assert.match(r.body.error, /iade kaydı var/);
      assert.deepStrictEqual(await state('VN-OLD010'), ['2026-03-01 09:00:00', 'check', 1]);
      assert.strictEqual(JSON.parse((await srv.orderByRef('VN-OLD010')).refunds).length, 1, 'refund history kept');
      assert.deepStrictEqual(await history('VN-OLD010'), ['unpaid', 'paid'], 'a refused correction adds nothing');

      // The check cannot touch real payments: an old delivered order never had a question
      r = await srv.setOrder('VN-OLD012', { payment_check: 'unpaid', confirm_correction: true });
      assert.strictEqual(r.status, 400);
      assert.deepStrictEqual(await state('VN-OLD012'), ['2026-03-03 09:00:00', 'legacy', 0]);
      assert.deepStrictEqual(await history('VN-OLD012'), []);

      // Revenue follows the corrected answers: 2500 counted (by its estimated date), 1800 not
      const db = new DatabaseSync(path.join(dir, 'store.db'));
      try {
        const paid = db.prepare("SELECT ref FROM orders WHERE paid_at IS NOT NULL ORDER BY ref").all().map(x => x.ref);
        assert.deepStrictEqual(paid, ['VN-OLD010', 'VN-OLD012']);
        assert.strictEqual(db.prepare('SELECT COUNT(*) c FROM payment_checks').get().c, 4);
      } finally { db.close(); }

      // Only admins can answer
      const id = (await srv.orderByRef('VN-OLD011')).id;
      assert.strictEqual((await srv.call('PUT', '/api/admin/orders/' + id, { payment_check: 'paid', confirm_correction: true })).status, 401);
    } finally { await close(); }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---------- Codex P1: revenue from payment and refund records ----------
test('30-day revenue = payments received in the period minus refunds made in the period', async () => {
  const dir = tempDir();
  try {
    oldDatabase(dir, [
      { ref: 'VN-LATE01', status: 'pending', total: 2000, created_at: daysAgo(40) },     // ordered long ago, paid now
      { ref: 'VN-OLDPAY', status: 'delivered', total: 3000, created_at: daysAgo(40) },   // paid long ago, refunded now
    ]);
    const { srv, stripe, close } = await setup({ stripe: true, dataDir: dir });
    try {
      assert.deepStrictEqual(await srv.stats().then(s => [s.paid_30d, s.refunded_30d, s.revenue_30d]), [0, 0, 0]);
      await srv.setOrder('VN-LATE01', { status: 'paid' });
      await srv.refund('VN-OLDPAY', 500);                                              // e.g. October refund of a January sale

      stripe.state.paymentStatus = 'paid';
      const p = await srv.newProduct(5);
      const c = await srv.order([{ id: p, qty: 1 }], { payment_method: 'card' });      // cancelled, then paid anyway
      await srv.setOrder(c.body.ref, { status: 'cancelled' });
      await srv.confirm(c.body.ref, 'cs_test_1');
      const d = await srv.order([{ id: p, qty: 2 }], { payment_method: 'card' });      // paid, partly refunded
      await srv.confirm(d.body.ref, 'cs_test_2');
      await srv.refund(d.body.ref, 300);
      // A card order that is never paid is not counted ("contact" is not offered when card payment is on)
      const pending = await srv.order([{ id: p, qty: 1 }], { payment_method: 'card' });
      assert.strictEqual(pending.status, 200);

      const cTotal = (await srv.orderByRef(c.body.ref)).total_cents, dTotal = (await srv.orderByRef(d.body.ref)).total_cents;
      const s = await srv.stats();
      assert.strictEqual(s.paid_30d, 2000 + cTotal + dTotal);
      assert.strictEqual(s.refunded_30d, 500 + 300);
      assert.strictEqual(s.revenue_30d, 2000 + cTotal + dTotal - 800);
    } finally { await close(); }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---------- Codex P2: fake services are closed when startup fails ----------
test('test setup closes fake Stripe and SMTP when the server fails to start', async () => {
  // DATA_DIR pointing at a file makes db.js fail, so the server exits during startup
  const blocker = path.join(os.tmpdir(), `vornetic-test-file-${process.pid}-${Date.now()}`);
  fs.writeFileSync(blocker, '');
  try {
    const err = await setup({ stripe: true, smtp: true, env: { DATA_DIR: blocker } })
      .then(() => assert.fail('setup should have failed'), e => e);
    assert.match(err.message, /server exited/);
    assert.strictEqual(err.services.stripe.server.listening, false, 'fake Stripe still open');
    assert.strictEqual(err.services.smtp.server.listening, false, 'fake SMTP still open');
  } finally { fs.rmSync(blocker, { force: true }); }
});

test('order and refund changes require an admin session', async () => {
  const { srv, close } = await setup();
  try {
    const p = await srv.newProduct(5);
    const { body: { ref } } = await srv.order([{ id: p, qty: 1 }]);
    const id = (await srv.orderByRef(ref)).id;
    assert.strictEqual((await srv.call('PUT', '/api/admin/orders/' + id, { status: 'paid' })).status, 401);
    assert.strictEqual((await srv.call('POST', `/api/admin/orders/${id}/refunds`, { amount_cents: 100 })).status, 401);
    const o = await srv.orderByRef(ref);
    assert.deepStrictEqual([o.status, o.refund_total_cents], ['pending', 0]);
  } finally { await close(); }
});
