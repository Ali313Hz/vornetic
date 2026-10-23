// test/helpers.js — shared helpers for tests (not a test file itself: npm test runs *.test.js).
// startServer runs the real server.js with a throwaway DATA_DIR and a test-only admin password,
// and always cleans up (child process + temp dir), also when startup fails.
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.join(__dirname, '..');
const ADMIN_PASSWORD = 'test-only-admin-password-123';
const CUSTOMER = {
  customer_name: 'Test Customer', email: 'buyer@example.test', phone: '600000000',
  address: 'Calle Falsa 1', city: 'Madrid', zip: '28001', country: 'ES', lang: 'es',
};

const freePort = () => new Promise((resolve, reject) => {
  const s = net.createServer().listen(0, '127.0.0.1', () => {
    const { port } = s.address();
    s.close(() => resolve(port));
  }).on('error', reject);
});
const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'vornetic-test-'));
// Server settings a test must never inherit from the environment it runs in
const INHERITED_SETTINGS = ['PUBLIC_URL', 'HOST', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'MAIL_FROM',
  'STRIPE_SECRET_KEY', 'STRIPE_API_URL', 'EXPIRY_BATCH', 'EXPIRY_REPLY_MS'];
// In production the app only serves https requests, as reported by Nginx on the same machine.
// Test requests come from 127.0.0.1 too, so they send the header Nginx would add.
const VIA_PROXY = { 'X-Forwarded-Proto': 'https' };

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
    // Settings inherited from the developer's shell or CI must not leak into a test: every test
    // starts from none of them and sets only what it needs (undefined = make sure it is unset)
    for (const k of INHERITED_SETTINGS) delete childEnv[k];
    for (const [k, v] of Object.entries(env)) if (v === undefined) delete childEnv[k]; else childEnv[k] = v;
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
      method: 'POST', headers: { 'Content-Type': 'application/json', ...VIA_PROXY }, body: JSON.stringify({ password: ADMIN_PASSWORD }),
    });
    assert.strictEqual(res.status, 200);
    const cookie = res.headers.get('set-cookie').split(';')[0];
    const call = async (method, url, body, headers = {}) => {
      const r = await fetch(base + url, {
        method, headers: { 'Content-Type': 'application/json', ...VIA_PROXY, ...headers }, body: body && JSON.stringify(body),
      });
      const text = Buffer.from(await r.arrayBuffer()).toString('utf8');   // keeps a BOM, unlike r.text()
      let json = null;
      try { json = JSON.parse(text); } catch { /* not JSON (e.g. CSV) */ }
      return { status: r.status, body: json, text, headers: r.headers };
    };
    const admin = (method, url, body) => call(method, url, body, { Cookie: cookie });
    const srv = {
      base, dataDir, cookie, stop: cleanup, get log() { return log; }, call, admin,
      order: (items, extra = {}) => call('POST', '/api/orders', { ...CUSTOMER, payment_method: 'contact', ...extra, items }),
      async newProduct(stock, price_cents = 1000) {
        const cat = (await admin('GET', '/api/admin/categories')).body[0].slug;
        const r = await admin('POST', '/api/admin/products', { category: cat, name_en: 'Test item', name_es: 'Artículo test', price_cents, stock });
        assert.strictEqual(r.status, 200, JSON.stringify(r.body));
        return r.body.id;
      },
      orderByRef: async ref => (await admin('GET', '/api/admin/orders')).body.find(o => o.ref === ref),
      async setOrder(ref, changes) {
        const o = await srv.orderByRef(ref);
        return admin('PUT', '/api/admin/orders/' + o.id, { notify: false, ...changes });
      },
      async refund(ref, amount_cents) {
        const o = await srv.orderByRef(ref);
        return admin('POST', `/api/admin/orders/${o.id}/refunds`, { amount_cents });
      },
    };
    return srv;
  } catch (err) {
    await cleanup();
    throw err;
  }
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
    shipping_cents, total_cents, payment_method, status, created_at) VALUES (?, 'T', 'old@example.test', 'A', 'M', '28001', '[]', ?, ?, ?, 'transfer', ?, ?)`);
  for (const o of orders) add.run(o.ref, o.total - (o.shipping || 0), o.shipping || 0, o.total, o.status, o.created_at);
  db.close();
}

// Fake SMTP server on 127.0.0.1 that accepts everything and keeps the messages.
// env: the SMTP_* settings to give startServer. text(i): message i, quoted-printable decoded.
// ctl.reject = /regex/ makes it refuse recipients whose RCPT TO line matches, like a failing mail server.
// ctl.delayMs keeps each message "in flight" that long before accepting it (ctl.inFlight counts them).
async function fakeSmtp() {
  const messages = [], sockets = new Set(), ctl = { reject: null, delayMs: 0, inFlight: 0 };
  const server = net.createServer(sock => {
    sockets.add(sock);
    sock.on('close', () => sockets.delete(sock));
    let buf = '', inData = false, login = 0, rejected = false;
    sock.write('220 fake.example.test ESMTP\r\n');
    sock.on('data', d => {
      buf += d;
      let i;
      while ((i = buf.indexOf(inData ? '\r\n.\r\n' : '\r\n')) !== -1) {
        if (inData) {
          const msg = buf.slice(0, i); buf = buf.slice(i + 5); inData = false;
          const accept = () => { messages.push(msg); sock.write('250 queued\r\n'); };
          if (ctl.delayMs) { ctl.inFlight++; setTimeout(() => { ctl.inFlight--; accept(); }, ctl.delayMs); } else accept();
          continue;
        }
        const line = buf.slice(0, i); buf = buf.slice(i + 2);
        if (/^RCPT TO/i.test(line) && ctl.reject && ctl.reject.test(line)) { rejected = true; sock.write('550 fake rejection\r\n'); continue; }
        if (/^DATA/i.test(line) && rejected) { rejected = false; sock.write('554 no valid recipients\r\n'); continue; }
        if (login) { login--; sock.write(login ? '334 UGFzc3dvcmQ6\r\n' : '235 ok\r\n'); }
        else if (/^EHLO/i.test(line)) sock.write('250-fake.example.test\r\n250 AUTH PLAIN LOGIN\r\n');
        else if (/^AUTH LOGIN/i.test(line)) { login = 2; sock.write('334 VXNlcm5hbWU6\r\n'); }
        else if (/^AUTH/i.test(line)) sock.write('235 ok\r\n');
        else if (/^DATA/i.test(line)) { inData = true; sock.write('354 go\r\n'); }
        else if (/^QUIT/i.test(line)) sock.end('221 bye\r\n');
        else sock.write('250 ok\r\n');
      }
    });
    sock.on('error', () => {});
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const qp = s => Buffer.from(s.replace(/=\r\n/g, '').replace(/=([0-9A-F]{2})/g, (m, h) => String.fromCharCode(parseInt(h, 16))), 'latin1').toString('utf8');
  return {
    messages, server, ctl, text: i => qp(messages[i]),
    env: { SMTP_HOST: '127.0.0.1', SMTP_PORT: String(server.address().port), SMTP_USER: 'test@example.test', SMTP_PASS: 'test-only', MAIL_FROM: 'Shop <shop@example.test>' },
    async waitFor(n) { for (let i = 0; i < 50 && messages.length < n; i++) await new Promise(r => setTimeout(r, 100)); return messages.length; },
    close: () => new Promise(r => { for (const s of sockets) s.destroy(); server.close(r); }),
  };
}

// Fake Stripe (Checkout Sessions) on 127.0.0.1. Each created session can be steered:
//   sessions[id] = { ref, params, status: 'open'|'expired'|'complete', payment_status: 'unpaid'|'paid',
//                    fail: 500|401|'badjson'|null, delayMs, answerId, answerRef, chargeCreated }
// answerId / answerRef let a test make Stripe answer with a different session or order.
// chargeCreated (Unix seconds) = when Stripe took the money: returned as the successful charge
// when the request expands payment_intent.latest_charge. state.getUrls lists every GET URL.
// POST .../expire closes an open, unpaid page (state.expires counts the calls); it is refused
// otherwise, or always when the session has expireFail set; expireDelayMs makes it slow.
async function fakeStripe() {
  const http = require('node:http');
  const state = { sessions: {}, creates: 0, gets: 0, getUrls: [], expires: 0 };
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', d => { body += d; });
    req.on('end', async () => {
      const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
      if (req.method === 'POST' && req.url === '/v1/checkout/sessions') {
        const params = Object.fromEntries(new URLSearchParams(body));
        const id = 'cs_test_' + (++state.creates);
        state.sessions[id] = { ref: params.client_reference_id, params, status: 'open', payment_status: 'unpaid' };
        return send(200, { id, url: 'https://checkout.example.test/pay/' + id });
      }
      const x = req.url.match(/^\/v1\/checkout\/sessions\/(\w+)\/expire$/);
      if (req.method === 'POST' && x) {
        state.expires++;
        const s = state.sessions[x[1]];
        if (!s) return send(404, { error: { message: 'No such checkout session' } });
        if (s.expireDelayMs) await new Promise(r => setTimeout(r, s.expireDelayMs));
        if (s.expireFail) return send(500, { error: { message: 'fake Stripe error on expire' } });
        if (s.status !== 'open' || s.payment_status !== 'unpaid') return send(400, { error: { message: 'Only open sessions can be expired' } });
        s.status = 'expired';
        return send(200, { id: x[1], status: 'expired', payment_status: 'unpaid' });
      }
      const m = req.url.match(/^\/v1\/checkout\/sessions\/(\w+)(\?.*)?$/);
      if (req.method === 'GET' && m) {
        state.gets++;
        state.getUrls.push(req.url);
        const expand = new URLSearchParams(m[2] || '').getAll('expand[]');
        const s = state.sessions[m[1]];
        if (!s) return send(404, { error: { message: 'No such checkout session' } });
        if (s.delayMs) await new Promise(r => setTimeout(r, s.delayMs));
        if (s.fail === 'badjson') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('{not json'); }
        if (s.fail) return send(s.fail, { error: { message: 'fake Stripe error ' + s.fail } });
        const pi = !s.chargeCreated ? null : !expand.includes('payment_intent.latest_charge') ? 'pi_' + m[1]
          : { id: 'pi_' + m[1], status: 'succeeded', latest_charge: { id: 'ch_' + m[1], status: 'succeeded', paid: true, created: s.chargeCreated } };
        return send(200, { id: s.answerId || m[1], client_reference_id: s.answerRef || s.ref, status: s.status, payment_status: s.payment_status, payment_intent: pi });
      }
      send(404, { error: { message: 'not found' } });
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return {
    state, server, url: `http://127.0.0.1:${server.address().port}`,
    env: { STRIPE_SECRET_KEY: 'sk_test_fake_key_for_automated_tests', STRIPE_API_URL: `http://127.0.0.1:${server.address().port}` },
    close: () => new Promise(r => { server.closeAllConnections(); server.close(r); }),
  };
}

module.exports = { ROOT, ADMIN_PASSWORD, CUSTOMER, tempDir, startServer, oldDatabase, fakeSmtp, fakeStripe, INHERITED_SETTINGS, VIA_PROXY };
