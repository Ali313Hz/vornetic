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
  'STRIPE_SECRET_KEY', 'STRIPE_API_URL'];
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
async function fakeSmtp() {
  const messages = [], sockets = new Set();
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
        else if (/^QUIT/i.test(line)) sock.end('221 bye\r\n');
        else sock.write('250 ok\r\n');
      }
    });
    sock.on('error', () => {});
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const qp = s => Buffer.from(s.replace(/=\r\n/g, '').replace(/=([0-9A-F]{2})/g, (m, h) => String.fromCharCode(parseInt(h, 16))), 'latin1').toString('utf8');
  return {
    messages, server, text: i => qp(messages[i]),
    env: { SMTP_HOST: '127.0.0.1', SMTP_PORT: String(server.address().port), SMTP_USER: 'test@example.test', SMTP_PASS: 'test-only', MAIL_FROM: 'Shop <shop@example.test>' },
    async waitFor(n) { for (let i = 0; i < 50 && messages.length < n; i++) await new Promise(r => setTimeout(r, 100)); return messages.length; },
    close: () => new Promise(r => { for (const s of sockets) s.destroy(); server.close(r); }),
  };
}

module.exports = { ROOT, ADMIN_PASSWORD, CUSTOMER, tempDir, startServer, oldDatabase, fakeSmtp, INHERITED_SETTINGS, VIA_PROXY };
