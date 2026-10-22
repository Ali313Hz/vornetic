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

async function startServer(env = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vornetic-test-'));
  const port = await freePort();
  const childEnv = { ...process.env, PORT: String(port), DATA_DIR: dataDir, NODE_ENV: 'test', ...env };
  for (const k of Object.keys(childEnv)) if (childEnv[k] === undefined) delete childEnv[k];
  for (const k of ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'STRIPE_SECRET_KEY']) delete childEnv[k];
  const child = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server did not start:\n' + log)), 15000);
    const onData = d => {
      log += d;
      if (log.includes('Vornetic →')) { clearTimeout(timer); resolve(); }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', code => { clearTimeout(timer); reject(new Error(`server exited (${code}):\n${log}`)); });
  });
  const base = `http://127.0.0.1:${port}`;
  return {
    base,
    get log() { return log; },
    async stop() {
      child.removeAllListeners('exit');
      child.kill();
      await new Promise(r => child.once('close', r));
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

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
