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
      const text = Buffer.from(await r.arrayBuffer()).toString('utf8');   // keeps a BOM, unlike r.text()
      let json = null;
      try { json = JSON.parse(text); } catch { /* not JSON (e.g. CSV) */ }
      return { status: r.status, body: json, text, headers: r.headers };
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

module.exports = { ROOT, ADMIN_PASSWORD, CUSTOMER, tempDir, startServer, oldDatabase };
