// test/orders.test.js — stock, payment state and refunds for orders.
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

// Starts server.js; always cleans up (child + temp dir) on failure or stop().
async function startServer(env = {}, dataDir) {
  const ownDir = !dataDir;
  if (ownDir) dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vornetic-test-'));
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
  return { state, url: `http://127.0.0.1:${port}`, close: () => new Promise(r => server.close(r)) };
}

// Fake SMTP that accepts everything and counts delivered messages
async function fakeSmtp() {
  const messages = [];
  const server = net.createServer(sock => {
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
    messages,
    env: { SMTP_HOST: '127.0.0.1', SMTP_PORT: String(port), SMTP_USER: 'test@example.test', SMTP_PASS: 'test-only', MAIL_FROM: 'Shop <shop@example.test>' },
    close: () => new Promise(r => server.close(r)),
  };
}

// ---------- 1. Stock is checked against the whole quantity ----------
test('an order larger than the stock is refused and changes nothing', async () => {
  const srv = await startServer();
  try {
    const p = await srv.newProduct(3);
    const r = await srv.order([{ id: p, qty: 10 }]);
    assert.strictEqual(r.status, 400);
    assert.match(r.body.error, /Not enough stock: Test item \(only 3 left, you asked for 10\)/);
    assert.strictEqual(await srv.stock(p), 3);
    assert.strictEqual((await srv.orders()).length, 0, 'no order may be saved');
  } finally { await srv.stop(); }
});

test('the same product on several cart lines is checked as one total', async () => {
  const srv = await startServer();
  try {
    const p = await srv.newProduct(5);
    const tooMany = await srv.order([{ id: p, qty: 4 }, { id: p, qty: 4 }]);
    assert.strictEqual(tooMany.status, 400);
    assert.strictEqual(await srv.stock(p), 5);

    const ok = await srv.order([{ id: p, qty: 2 }, { id: p, qty: 3 }]);
    assert.strictEqual(ok.status, 200);
    assert.strictEqual(await srv.stock(p), 0);
    assert.strictEqual((await srv.order([{ id: p, qty: 1 }])).status, 400);
  } finally { await srv.stop(); }
});

test('a cart with two products takes nothing if one of them is short', async () => {
  const srv = await startServer();
  try {
    const a = await srv.newProduct(5), b = await srv.newProduct(1);
    const r = await srv.order([{ id: a, qty: 2 }, { id: b, qty: 2 }]);
    assert.strictEqual(r.status, 400);
    assert.deepStrictEqual([await srv.stock(a), await srv.stock(b)], [5, 1]);
  } finally { await srv.stop(); }
});

// ---------- 2. Cancelling and un-cancelling ----------
test('cancelling returns exactly the ordered stock; un-cancelling takes it again', async () => {
  const srv = await startServer();
  try {
    const p = await srv.newProduct(5);
    const { body: { ref } } = await srv.order([{ id: p, qty: 3 }]);
    assert.strictEqual(await srv.stock(p), 2);
    assert.strictEqual((await srv.setOrder(ref, { status: 'cancelled' })).status, 200);
    assert.strictEqual(await srv.stock(p), 5);
    assert.strictEqual((await srv.setOrder(ref, { status: 'pending' })).status, 200);
    assert.strictEqual(await srv.stock(p), 2);
  } finally { await srv.stop(); }
});

test('un-cancelling without enough stock is refused and the order stays cancelled', async () => {
  const srv = await startServer();
  try {
    const p = await srv.newProduct(2);
    const { body: { ref } } = await srv.order([{ id: p, qty: 2 }]);
    await srv.setOrder(ref, { status: 'cancelled' });
    await srv.admin('POST', `/api/admin/products/${p}/stock`, { delta: -1 });   // one unit sold elsewhere
    const r = await srv.setOrder(ref, { status: 'paid' });
    assert.strictEqual(r.status, 400);
    assert.match(r.body.error, /Stok yetersiz: Test item \(stokta 1, gereken 2\)/);
    assert.strictEqual((await srv.orderByRef(ref)).status, 'cancelled');
    assert.strictEqual(await srv.stock(p), 1);
  } finally { await srv.stop(); }
});

// ---------- 3. + 4. Card payments with a fake Stripe ----------
test('if Stripe fails, the order is cancelled, stock comes back, and Stripe details stay hidden', async () => {
  const stripe = await fakeStripe();
  stripe.state.failCreate = true;
  const srv = await startServer({ STRIPE_SECRET_KEY: FAKE_STRIPE_KEY, STRIPE_API_URL: stripe.url });
  try {
    const p = await srv.newProduct(4);
    const r = await srv.order([{ id: p, qty: 1 }], { payment_method: 'card' });
    assert.strictEqual(r.status, 400);
    assert.match(r.body.error, /Card payment is not available right now/);
    assert.doesNotMatch(r.body.error, /API Key|sk_test/);
    assert.strictEqual(stripe.state.creates, 1);
    assert.strictEqual(stripe.state.lastAuth, `Bearer ${FAKE_STRIPE_KEY}`);
    const [o] = await srv.orders();
    assert.strictEqual(o.status, 'cancelled');
    assert.strictEqual(o.paid_at, null);
    assert.strictEqual(o.needs_refund, 0);
    assert.strictEqual(await srv.stock(p), 4);
  } finally { await srv.stop(); await stripe.close(); }
});

test('card order: unpaid stays pending; paid is recorded once, with one set of e-mails', async () => {
  const stripe = await fakeStripe(), smtp = await fakeSmtp();
  const srv = await startServer({ STRIPE_SECRET_KEY: FAKE_STRIPE_KEY, STRIPE_API_URL: stripe.url, ...smtp.env });
  try {
    const p = await srv.newProduct(4);
    const r = await srv.order([{ id: p, qty: 1 }], { payment_method: 'card' });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.redirect, 'https://checkout.example.test/pay/1');
    const confirm = () => srv.call('POST', '/api/orders/confirm', { ref: r.body.ref, session_id: 'cs_test_1' });

    stripe.state.paymentStatus = 'unpaid';
    assert.strictEqual((await confirm()).body.status, 'pending');
    assert.strictEqual((await srv.orderByRef(r.body.ref)).paid_at, null);

    // Customer opens the success page twice at once; Stripe answers slowly
    stripe.state.paymentStatus = 'paid';
    stripe.state.getDelayMs = 300;
    const [a, b] = await Promise.all([confirm(), confirm()]);
    assert.deepStrictEqual([a.body.status, b.body.status], ['paid', 'paid']);
    const o = await srv.orderByRef(r.body.ref);
    assert.strictEqual(o.status, 'paid');
    assert.ok(o.paid_at);
    assert.strictEqual(o.paid_at_estimated, 0);

    for (let i = 0; i < 30 && smtp.messages.length < 2; i++) await sleep(100);
    await sleep(500);   // give any duplicate e-mail time to arrive
    assert.strictEqual(smtp.messages.length, 2, 'expected one customer confirmation + one shop notice');

    const gets = stripe.state.gets;
    assert.strictEqual((await confirm()).body.status, 'paid');
    assert.strictEqual(stripe.state.gets, gets, 'an already paid order is not asked about again');
  } finally { await srv.stop(); await stripe.close(); await smtp.close(); }
});

test('card paid after the admin cancelled it: payment is recorded and a refund is flagged', async () => {
  const stripe = await fakeStripe();
  const srv = await startServer({ STRIPE_SECRET_KEY: FAKE_STRIPE_KEY, STRIPE_API_URL: stripe.url });
  try {
    const p = await srv.newProduct(4);
    const r = await srv.order([{ id: p, qty: 1 }], { payment_method: 'card' });
    await srv.setOrder(r.body.ref, { status: 'cancelled' });
    stripe.state.paymentStatus = 'paid';
    const c = await srv.call('POST', '/api/orders/confirm', { ref: r.body.ref, session_id: 'cs_test_1' });
    assert.strictEqual(c.body.status, 'cancelled');
    const o = await srv.orderByRef(r.body.ref);
    assert.ok(o.paid_at);
    assert.strictEqual(o.needs_refund, 1);
    assert.strictEqual((await srv.admin('GET', '/api/admin/stats')).body.needs_refund, 1);
  } finally { await srv.stop(); await stripe.close(); }
});

// ---------- 5. Paid date ----------
test('paid date is set when an order becomes paid, kept through shipping, cleared on pending', async () => {
  const srv = await startServer();
  try {
    const p = await srv.newProduct(5);
    const { body: { ref } } = await srv.order([{ id: p, qty: 1 }]);
    assert.strictEqual((await srv.orderByRef(ref)).paid_at, null);

    await srv.setOrder(ref, { status: 'paid' });
    const paid = await srv.orderByRef(ref);
    assert.match(paid.paid_at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    assert.strictEqual(paid.paid_at_estimated, 0);

    await srv.setOrder(ref, { status: 'shipped' });
    assert.strictEqual((await srv.orderByRef(ref)).paid_at, paid.paid_at);
    await srv.setOrder(ref, { status: 'pending' });
    assert.strictEqual((await srv.orderByRef(ref)).paid_at, null);

    const { body: { ref: ref2 } } = await srv.order([{ id: p, qty: 1 }]);
    await srv.setOrder(ref2, { status: 'delivered' });          // skipping "paid" also counts as paid
    assert.ok((await srv.orderByRef(ref2)).paid_at);
  } finally { await srv.stop(); }
});

test('existing orders get an estimated paid date once, when the column is added', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vornetic-test-'));
  try {
    // An orders table as the previous release created it (no paid_at / refunded_cents)
    const old = new DatabaseSync(path.join(dir, 'store.db'));
    old.exec(`CREATE TABLE orders (id INTEGER PRIMARY KEY AUTOINCREMENT, ref TEXT UNIQUE NOT NULL, user_id INTEGER,
      customer_name TEXT NOT NULL, email TEXT NOT NULL, phone TEXT DEFAULT '', address TEXT NOT NULL, city TEXT NOT NULL,
      zip TEXT NOT NULL, province TEXT DEFAULT '', country TEXT DEFAULT 'ES', notes TEXT DEFAULT '', items TEXT NOT NULL,
      subtotal_cents INTEGER NOT NULL, shipping_cents INTEGER NOT NULL, total_cents INTEGER NOT NULL,
      payment_method TEXT NOT NULL, status TEXT DEFAULT 'pending', tracking TEXT DEFAULT '', lang TEXT DEFAULT 'es',
      stripe_session TEXT, created_at TEXT DEFAULT (datetime('now')))`);
    const add = old.prepare(`INSERT INTO orders (ref, customer_name, email, address, city, zip, items, subtotal_cents,
      shipping_cents, total_cents, payment_method, status, created_at) VALUES (?, 'T', 'old@example.test', 'A', 'M', '28001', '[]', 1000, 395, 1395, 'transfer', ?, ?)`);
    add.run('VN-OLD001', 'delivered', '2026-01-31 10:00:00');
    add.run('VN-OLD002', 'pending', '2026-02-01 10:00:00');
    add.run('VN-OLD003', 'cancelled', '2026-02-02 10:00:00');
    old.close();

    let srv = await startServer({}, dir);
    try {
      const by = Object.fromEntries((await srv.orders()).map(o => [o.ref, o]));
      assert.deepStrictEqual([by['VN-OLD001'].paid_at, by['VN-OLD001'].paid_at_estimated], ['2026-01-31 10:00:00', 1]);
      assert.deepStrictEqual([by['VN-OLD002'].paid_at, by['VN-OLD003'].paid_at], [null, null]);
      assert.deepStrictEqual(Object.values(by).map(o => o.refunded_cents), [0, 0, 0]);
      await srv.setOrder('VN-OLD002', { status: 'paid' });         // a real payment date
    } finally { await srv.stop(); }

    srv = await startServer({}, dir);                               // restart: no second back-fill
    try {
      const o2 = await srv.orderByRef('VN-OLD002');
      assert.notStrictEqual(o2.paid_at, '2026-02-01 10:00:00');
      assert.strictEqual(o2.paid_at_estimated, 0);
      assert.strictEqual((await srv.orderByRef('VN-OLD001')).paid_at_estimated, 1);
    } finally { await srv.stop(); }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---------- 6. + 7. Refunds ----------
test('refund amount: validated, only on paid orders, and clears the "refund missing" warning', async () => {
  const srv = await startServer();
  try {
    const p = await srv.newProduct(5);
    const { body: { ref } } = await srv.order([{ id: p, qty: 1 }]);   // 10.00 + 3.95 shipping
    const total = (await srv.orderByRef(ref)).total_cents;

    let r = await srv.setOrder(ref, { refunded_cents: 100 });
    assert.strictEqual(r.status, 400, 'no refund on an unpaid order');
    assert.match(r.body.error, /Ödenmemiş/);

    await srv.setOrder(ref, { status: 'paid' });
    for (const bad of [-1, total + 1, 1.5, 'abc']) {
      r = await srv.setOrder(ref, { refunded_cents: bad });
      assert.strictEqual(r.status, 400, `refund ${bad}`);
    }
    assert.strictEqual((await srv.setOrder(ref, { refunded_cents: 500 })).status, 200);   // partial, e.g. one item returned
    assert.strictEqual((await srv.orderByRef(ref)).refunded_cents, 500);
    assert.strictEqual((await srv.orderByRef(ref)).needs_refund, 0);

    await srv.setOrder(ref, { status: 'cancelled' });
    let o = await srv.orderByRef(ref);
    assert.ok(o.paid_at, 'a cancelled order keeps its payment date');
    assert.strictEqual(o.needs_refund, 1, 'paid + cancelled + not fully refunded');
    assert.strictEqual((await srv.admin('GET', '/api/admin/stats')).body.needs_refund, 1);

    await srv.setOrder(ref, { refunded_cents: total });
    o = await srv.orderByRef(ref);
    assert.strictEqual(o.needs_refund, 0);
    assert.strictEqual((await srv.admin('GET', '/api/admin/stats')).body.needs_refund, 0);

    r = await srv.setOrder(ref, { status: 'pending' });
    assert.strictEqual(r.status, 400, 'a refunded order cannot go back to "pending"');
  } finally { await srv.stop(); }
});

test('a cancelled order that was never paid needs no refund', async () => {
  const srv = await startServer();
  try {
    const p = await srv.newProduct(5);
    const { body: { ref } } = await srv.order([{ id: p, qty: 1 }]);
    await srv.setOrder(ref, { status: 'cancelled' });
    const o = await srv.orderByRef(ref);
    assert.strictEqual(o.paid_at, null);
    assert.strictEqual(o.needs_refund, 0);
  } finally { await srv.stop(); }
});

test('order changes still require an admin session', async () => {
  const srv = await startServer();
  try {
    const p = await srv.newProduct(5);
    const { body: { ref } } = await srv.order([{ id: p, qty: 1 }]);
    const id = (await srv.orderByRef(ref)).id;
    const r = await srv.call('PUT', '/api/admin/orders/' + id, { status: 'paid', refunded_cents: 0 });
    assert.strictEqual(r.status, 401);
    assert.strictEqual((await srv.orderByRef(ref)).status, 'pending');
  } finally { await srv.stop(); }
});
