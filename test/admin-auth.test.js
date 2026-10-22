// test/admin-auth.test.js — admin login / session tests.
// Each test starts the real server as a child process with a throwaway DATA_DIR,
// so no real store data, customers or credentials are touched.
const { test } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');

const ROOT = path.join(__dirname, '..');
const TEST_PASSWORD = 'test-only-admin-password-123';

const freePort = () => new Promise((resolve, reject) => {
  const s = net.createServer().listen(0, '127.0.0.1', () => {
    const { port } = s.address();
    s.close(() => resolve(port));
  }).on('error', reject);
});

const tempDataDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'vornetic-test-'));

// Pass `dataDir` to reuse a database across restarts; the caller then removes it.
// `readyText` / `timeoutMs` exist so the failure path itself can be tested.
async function startServer(env = {}, dataDir, { readyText = 'Vornetic →', timeoutMs = 15000 } = {}) {
  const ownDir = !dataDir;
  if (ownDir) dataDir = tempDataDir();
  let child, closed, log = '';
  // Kill the child (if still running), wait for it and its pipes to close, remove our temp dir
  const cleanup = async () => {
    if (child) {
      child.removeAllListeners('exit');
      if (child.exitCode === null && child.signalCode === null) child.kill();
      await closed;
    }
    if (ownDir) fs.rmSync(dataDir, { recursive: true, force: true });
  };
  try {
    const port = await freePort();
    const childEnv = { ...process.env, PORT: String(port), DATA_DIR: dataDir, NODE_ENV: 'test', ...env };
    for (const k of Object.keys(childEnv)) if (childEnv[k] === undefined) delete childEnv[k];
    for (const k of ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'STRIPE_SECRET_KEY']) delete childEnv[k];
    child = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });
    // Listen for 'close' from the start: it may fire before cleanup runs (e.g. the server crashed)
    closed = new Promise(r => child.once('close', r));
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('server did not start:\n' + log)), timeoutMs);
      const onData = d => {
        log += d;
        if (log.includes(readyText)) { clearTimeout(timer); resolve(); }
      };
      child.stdout.on('data', onData);
      child.stderr.on('data', onData);
      child.on('error', err => { clearTimeout(timer); reject(err); });
      child.on('exit', code => { clearTimeout(timer); reject(new Error(`server exited (${code}):\n${log}`)); });
    });
    return {
      base: `http://127.0.0.1:${port}`,
      pid: child.pid,
      get log() { return log; },
      stop: cleanup,
    };
  } catch (err) {
    await cleanup();
    err.pid = child && child.pid;
    err.dataDir = dataDir;
    throw err;
  }
}

const isRunning = pid => {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
};

const login = (base, password, urlPath = '/api/admin/login') => fetch(base + urlPath, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ password }),
});
const cookieOf = res => (res.headers.get('set-cookie') || '').split(';')[0];

test('correct password logs in, session works, logout ends it', async () => {
  const srv = await startServer({ ADMIN_PASSWORD: TEST_PASSWORD });
  try {
    const res = await login(srv.base, TEST_PASSWORD);
    assert.strictEqual(res.status, 200);
    const cookie = cookieOf(res);
    assert.match(cookie, /^admin=[0-9a-f]{64}$/);

    const me = await fetch(srv.base + '/api/admin/me', { headers: { Cookie: cookie } });
    assert.strictEqual(me.status, 200);

    const out = await fetch(srv.base + '/api/admin/logout', { method: 'POST', headers: { Cookie: cookie } });
    assert.strictEqual(out.status, 200);
    const after = await fetch(srv.base + '/api/admin/me', { headers: { Cookie: cookie } });
    assert.strictEqual(after.status, 401);
  } finally { await srv.stop(); }
});

test('wrong, empty, longer or shorter passwords are rejected', async () => {
  const srv = await startServer({ ADMIN_PASSWORD: TEST_PASSWORD });
  try {
    for (const pw of ['wrong', '', TEST_PASSWORD + 'x', TEST_PASSWORD.slice(0, -1)]) {
      const res = await login(srv.base, pw);
      assert.strictEqual(res.status, 401, `password ${JSON.stringify(pw)}`);
      assert.strictEqual(res.headers.get('set-cookie'), null);
    }
  } finally { await srv.stop(); }
});

test('admin API requires a valid session', async () => {
  const srv = await startServer({ ADMIN_PASSWORD: TEST_PASSWORD });
  try {
    assert.strictEqual((await fetch(srv.base + '/api/admin/me')).status, 401);
    const forged = await fetch(srv.base + '/api/admin/orders', { headers: { Cookie: 'admin=' + 'a'.repeat(64) } });
    assert.strictEqual(forged.status, 401);
  } finally { await srv.stop(); }
});

test('login rate limit cannot be bypassed by changing URL case or adding a trailing slash', async () => {
  const srv = await startServer({ ADMIN_PASSWORD: TEST_PASSWORD });
  try {
    for (let i = 0; i < 8; i++) assert.strictEqual((await login(srv.base, 'wrong')).status, 401);
    assert.strictEqual((await login(srv.base, 'wrong')).status, 429);
    for (const variant of ['/api/admin/login/', '/API/admin/login', '/api/Admin/Login/']) {
      const res = await login(srv.base, 'wrong', variant);
      assert.strictEqual(res.status, 429, `variant ${variant} should share the limit`);
    }
  } finally { await srv.stop(); }
});

test('in production the built-in default password never works', async () => {
  const srv = await startServer({ NODE_ENV: 'production', ADMIN_PASSWORD: undefined });
  try {
    const res = await login(srv.base, 'vornetic2026');
    assert.strictEqual(res.status, 503);
    assert.strictEqual(res.headers.get('set-cookie'), null);
    assert.match(srv.log, /ADMIN_PASSWORD/);
  } finally { await srv.stop(); }
});

test('in production an explicitly configured default password is also refused', async () => {
  const srv = await startServer({ NODE_ENV: 'production', ADMIN_PASSWORD: 'vornetic2026' });
  try {
    assert.strictEqual((await login(srv.base, 'vornetic2026')).status, 503);
  } finally { await srv.stop(); }
});

test('in development the default password still works (local setup unchanged)', async () => {
  const srv = await startServer({ ADMIN_PASSWORD: undefined });
  try {
    assert.strictEqual((await login(srv.base, 'vornetic2026')).status, 200);
  } finally { await srv.stop(); }
});

// ---------- Sessions issued before an upgrade or under another password (Codex review, PR #4) ----------
const { DatabaseSync } = require('node:sqlite');
const me = (base, cookie) => fetch(base + '/api/admin/me', { headers: { Cookie: cookie } });

// A database as the previous release left it, holding a live admin token
// (e.g. one obtained with the public default password).
function seedPreUpgradeSession(dataDir) {
  const token = 'b'.repeat(64);
  const db = new DatabaseSync(path.join(dataDir, 'store.db'));
  db.exec("CREATE TABLE admin_sessions (token TEXT PRIMARY KEY, created_at TEXT DEFAULT (datetime('now')))");
  db.prepare('INSERT INTO admin_sessions (token) VALUES (?)').run(token);
  db.close();
  return 'admin=' + token;
}

test('pre-upgrade admin session is rejected when a strong password is configured', async () => {
  const dir = tempDataDir();
  try {
    const cookie = seedPreUpgradeSession(dir);
    const srv = await startServer({ NODE_ENV: 'production', ADMIN_PASSWORD: TEST_PASSWORD }, dir);
    try {
      assert.strictEqual((await me(srv.base, cookie)).status, 401);
      const orders = await fetch(srv.base + '/api/admin/orders', { headers: { Cookie: cookie } });
      assert.strictEqual(orders.status, 401);
      // the stale row is removed at startup, not only ignored
      const db = new DatabaseSync(path.join(dir, 'store.db'));
      try {
        const row = db.prepare('SELECT 1 FROM admin_sessions WHERE token = ?').get(cookie.slice('admin='.length));
        assert.strictEqual(row, undefined);
      } finally { db.close(); }
      // a fresh login with the real password still works
      const res = await login(srv.base, TEST_PASSWORD);
      assert.strictEqual(res.status, 200);
      assert.strictEqual((await me(srv.base, cookieOf(res))).status, 200);
    } finally { await srv.stop(); }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('pre-upgrade admin session is rejected while production is locked (default password)', async () => {
  const dir = tempDataDir();
  try {
    const cookie = seedPreUpgradeSession(dir);
    const srv = await startServer({ NODE_ENV: 'production', ADMIN_PASSWORD: undefined }, dir);
    try {
      assert.notStrictEqual((await me(srv.base, cookie)).status, 200);
      const s = await fetch(srv.base + '/api/admin/settings', { headers: { Cookie: cookie } });
      assert.notStrictEqual(s.status, 200);
    } finally { await srv.stop(); }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('session made with the default password stops working once a strong password is set', async () => {
  const dir = tempDataDir();
  try {
    let cookie;
    const dev = await startServer({ ADMIN_PASSWORD: undefined }, dir);
    try {
      const res = await login(dev.base, 'vornetic2026');
      assert.strictEqual(res.status, 200);
      cookie = cookieOf(res);
      assert.strictEqual((await me(dev.base, cookie)).status, 200);
    } finally { await dev.stop(); }

    const prod = await startServer({ NODE_ENV: 'production', ADMIN_PASSWORD: TEST_PASSWORD }, dir);
    try {
      assert.strictEqual((await me(prod.base, cookie)).status, 401);
    } finally { await prod.stop(); }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('restarting the server logs admins out, even with the same password', async () => {
  const dir = tempDataDir();
  try {
    let cookie;
    const first = await startServer({ ADMIN_PASSWORD: TEST_PASSWORD }, dir);
    try {
      cookie = cookieOf(await login(first.base, TEST_PASSWORD));
      assert.strictEqual((await me(first.base, cookie)).status, 200);
    } finally { await first.stop(); }

    const same = await startServer({ ADMIN_PASSWORD: TEST_PASSWORD }, dir);
    try {
      assert.strictEqual((await me(same.base, cookie)).status, 401);
      // logging in again works as usual
      assert.strictEqual((await me(same.base, cookieOf(await login(same.base, TEST_PASSWORD)))).status, 200);
    } finally { await same.stop(); }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// Codex review P2: no offline-guessable password verifier may be written to the database
test('nothing derived from ADMIN_PASSWORD is stored with admin sessions', async () => {
  const dir = tempDataDir();
  try {
    // simulate a database left behind by the earlier pw_tag pre-release
    const pre = new DatabaseSync(path.join(dir, 'store.db'));
    pre.exec("CREATE TABLE admin_sessions (token TEXT PRIMARY KEY, created_at TEXT DEFAULT (datetime('now')), pw_tag TEXT)");
    pre.prepare('INSERT INTO admin_sessions (token, pw_tag) VALUES (?, ?)').run('c'.repeat(64), 'd'.repeat(64));
    pre.close();

    const srv = await startServer({ ADMIN_PASSWORD: TEST_PASSWORD }, dir);
    try {
      assert.strictEqual((await login(srv.base, TEST_PASSWORD)).status, 200);
      const db = new DatabaseSync(path.join(dir, 'store.db'));
      try {
        const cols = db.prepare('PRAGMA table_info(admin_sessions)').all().map(c => c.name);
        assert.deepStrictEqual(cols.sort(), ['created_at', 'token']);
        const rows = db.prepare('SELECT * FROM admin_sessions').all();
        assert.strictEqual(rows.length, 1);
        assert.ok(!JSON.stringify(rows).includes('d'.repeat(64)));
        assert.ok(!JSON.stringify(rows).includes(TEST_PASSWORD));
      } finally { db.close(); }
    } finally { await srv.stop(); }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// Codex review P2: a failed start must not leave the server process or temp data behind
test('test helper kills the child and removes its temp dir when startup times out', async () => {
  const err = await startServer({ ADMIN_PASSWORD: TEST_PASSWORD }, undefined,
    { readyText: 'this banner never appears', timeoutMs: 3000 }).then(
    () => assert.fail('startServer should have rejected'), e => e);
  assert.match(err.message, /did not start/);
  assert.ok(err.pid > 0);
  assert.strictEqual(isRunning(err.pid), false, 'child process still running');
  assert.strictEqual(fs.existsSync(err.dataDir), false, 'temp DATA_DIR not removed');
});

test('test helper cleans up when the server exits during startup', async () => {
  // DATA_DIR pointing at a file makes db.js fail at mkdir, so the server exits right away
  const blocker = path.join(os.tmpdir(), `vornetic-test-file-${process.pid}-${Date.now()}`);
  fs.writeFileSync(blocker, '');
  try {
    const err = await startServer({ ADMIN_PASSWORD: TEST_PASSWORD, DATA_DIR: blocker }, undefined, { timeoutMs: 15000 })
      .then(() => assert.fail('startServer should have rejected'), e => e);
    assert.match(err.message, /server exited/);
    assert.strictEqual(isRunning(err.pid), false);
    assert.strictEqual(fs.existsSync(err.dataDir), false, 'helper temp dir not removed');
  } finally { fs.rmSync(blocker, { force: true }); }
});
