// test/public-url.test.js — links we send out must use PUBLIC_URL, never a faked Host header,
// and in production customer requests are only served over https.
// Pre-launch audit 2026-10-23: in production without PUBLIC_URL, a password-reset request sent
// with "Host: attacker.example.test" produced an e-mail linking to https://attacker.example.test/…
// Real server, throwaway database, fake SMTP on 127.0.0.1, example.test addresses, fake secrets.
const { test } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, fakeSmtp, VIA_PROXY } = require('./helpers');

const SHOP = 'https://shop.example.test';
const ATTACKER = 'attacker.example.test';

// fetch() can't fake the Host header, so use a raw HTTP request. By default it arrives "through
// Nginx" (X-Forwarded-Proto: https); proxy: false sends a plain-http request as a visitor would.
function request(base, urlPath, { method = 'GET', host, body, proxy = true, headers = {}, address } = {}) {
  const { port } = new URL(base);
  return new Promise((resolve, reject) => {
    const req = http.request({ host: address || '127.0.0.1', port, path: urlPath, method,
      headers: { 'Content-Type': 'application/json', ...(proxy && VIA_PROXY), ...(host && { Host: host }), ...headers } }, res => {
      let text = '';
      res.on('data', d => { text += d; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }));
    });
    req.on('error', reject);
    req.end(body && JSON.stringify(body));
  });
}
const links = text => [...text.matchAll(/https?:\/\/[^\s"'<>)]+/g)].map(m => m[0]);
// An address of this computer that is not 127.0.0.1 (e.g. the LAN or CI network address), if any
const otherAddress = () => Object.values(os.networkInterfaces()).flat()
  .find(i => i && i.family === 'IPv4' && !i.internal)?.address;

// checkPublicUrl() from server.js itself, for the full table of values (server.js can't be required)
function loadCheck(isProd) {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const label = src.match(/^const HOST_LABEL = .*$/m);
  const fn = src.match(/^function checkPublicUrl[\s\S]*?^\}\r?$/m);
  assert.ok(label && fn, 'checkPublicUrl not found in server.js');
  return new Function('IS_PROD', `${label[0]}\n${fn[0]}\nreturn checkPublicUrl;`)(isProd);
}

async function resetLinkFor(env) {
  const smtp = await fakeSmtp();
  try {
    const srv = await startServer({ ...env, ...smtp.env });
    try {
      await srv.call('POST', '/api/account/register', { email: 'victim@example.test', password: 'victim-test-pass-1', name: 'Test Customer' });
      const r = await request(srv.base, '/api/account/forgot', { method: 'POST', host: ATTACKER, body: { email: 'victim@example.test' } });
      assert.strictEqual(r.status, 200);
      assert.strictEqual(await smtp.waitFor(1), 1, 'one reset e-mail');
      return { link: links(smtp.text(0)).find(l => l.includes('/account/reset?token=')), srv: srv.base };
    } finally { await srv.stop(); }
  } finally { await smtp.close(); }
}

// ---------- links come from PUBLIC_URL ----------
test('production: the reset link uses PUBLIC_URL even when the Host header is faked', async () => {
  const { link } = await resetLinkFor({ NODE_ENV: 'production', PUBLIC_URL: SHOP });
  assert.ok(link, 'reset link found');
  assert.match(link, /^https:\/\/shop\.example\.test\/account\/reset\?token=[0-9a-f]{64}$/);
});

test('production: a trailing slash in PUBLIC_URL is fine (no double slash in links)', async () => {
  const { link } = await resetLinkFor({ NODE_ENV: 'production', PUBLIC_URL: SHOP + '/' });
  assert.match(link, /^https:\/\/shop\.example\.test\/account\/reset\?token=/);
});

test('production: order e-mails, sitemap and robots.txt ignore a faked Host header', async () => {
  const smtp = await fakeSmtp();
  try {
    const srv = await startServer({ NODE_ENV: 'production', PUBLIC_URL: SHOP, ...smtp.env });
    try {
      const cat = (await srv.admin('GET', '/api/admin/categories')).body[0].slug;
      const p = (await srv.admin('POST', '/api/admin/products', { category: cat, name_en: 'Test item', name_es: 'Artículo test', price_cents: 1000, stock: 5 })).body.id;
      const order = await request(srv.base, '/api/orders', { method: 'POST', host: ATTACKER, body: {
        customer_name: 'Test Customer', email: 'buyer@example.test', phone: '600000000', address: 'Calle Falsa 1',
        city: 'Madrid', zip: '28001', country: 'ES', lang: 'es', payment_method: 'contact', items: [{ id: p, qty: 1 }] } });
      assert.strictEqual(order.status, 200, order.text);
      assert.strictEqual(await smtp.waitFor(2), 2, 'customer confirmation + shop notice');
      const sentLinks = links(smtp.messages.map((m, i) => smtp.text(i)).join('\n')).filter(l => !/^https?:\/\/(www\.)?w3\.org/.test(l));
      assert.ok(sentLinks.length > 0, 'e-mails contain links');
      for (const l of sentLinks) assert.ok(!l.includes(ATTACKER), 'link to the faked host: ' + l);
      assert.ok(sentLinks.some(l => l.startsWith(SHOP + '/')), 'links use PUBLIC_URL');

      const sitemap = await request(srv.base, '/sitemap.xml', { host: ATTACKER });
      assert.ok(sitemap.text.includes(`<loc>${SHOP}/</loc>`) && !sitemap.text.includes(ATTACKER));
      assert.match((await request(srv.base, '/robots.txt', { host: ATTACKER })).text, new RegExp(`Sitemap: ${SHOP}/sitemap\\.xml`));
      const home = await request(srv.base, '/', { host: ATTACKER });
      assert.ok(home.text.includes(`<link rel="canonical" href="${SHOP}/">`) && !home.text.includes(ATTACKER));
    } finally { await srv.stop(); }
  } finally { await smtp.close(); }
});

// ---------- Codex P2: the raw PUBLIC_URL text is validated before any normalisation ----------
test('PUBLIC_URL: exact shape, host and port are checked on the raw text', () => {
  const prod = loadCheck(true), dev = loadCheck(false);
  const accepted = {
    'https://shop.example.test': SHOP, 'https://shop.example.test/': SHOP, 'HTTPS://Shop.Example.TEST': SHOP,
    'https://shop.example.test:443': SHOP, 'https://shop.example.test:8443': SHOP + ':8443',
    'https://sub.shop-2.example.test': 'https://sub.shop-2.example.test', 'https://1.2.3.4': 'https://1.2.3.4',
  };
  for (const [value, url] of Object.entries(accepted)) assert.deepStrictEqual(prod(value), { url }, value);
  const refused = {
    '': 'is not set',
    'https:shop.example.test': 'must start with https://', 'https:/shop.example.test': 'must start with https://',
    'http://shop.example.test': 'must start with https://', 'ftp://shop.example.test': 'must start with https://',
    'javascript:alert(1)': 'must start with https://', 'shop.example.test': 'must start with https://',
    'https:\\\\shop.example.test': 'contains a space, backslash, "@" or login details',
    'https://shop.example.test\\x': 'contains a space, backslash, "@" or login details',
    'https://user:pw@shop.example.test': 'contains a space, backslash, "@" or login details',
    'https://shop.example.test /': 'contains a space, backslash, "@" or login details',
    'https://shop.example.test?': 'must be only the address: no path, "?", "#" or anything after the host and port',
    'https://shop.example.test#': 'must be only the address: no path, "?", "#" or anything after the host and port',
    'https://shop.example.test/?a=1': 'must be only the address: no path, "?", "#" or anything after the host and port',
    'https://shop.example.test/./': 'must be only the address: no path, "?", "#" or anything after the host and port',
    'https://shop.example.test/..': 'must be only the address: no path, "?", "#" or anything after the host and port',
    'https://shop.example.test/tienda': 'must be only the address: no path, "?", "#" or anything after the host and port',
    'https://shop.example.test//': 'must be only the address: no path, "?", "#" or anything after the host and port',
    'https:///shop.example.test': 'must be only the address: no path, "?", "#" or anything after the host and port',
    'https://.': 'has an invalid host name', 'https://shop..example.test': 'has an invalid host name',
    'https://.shop.example.test': 'has an invalid host name', 'https://shop.example.test.': 'has an invalid host name',
    'https://-shop.example.test': 'has an invalid host name', 'https://shop-.example.test': 'has an invalid host name',
    'https://shop_1.example.test': 'has an invalid host name', 'https://tiendä.example.test': 'has an invalid host name',
    'https://localhost': 'has an invalid host name', [`https://${'a'.repeat(64)}.example.test`]: 'has an invalid host name',
    'https://shop.example.test:': 'has an invalid port', 'https://shop.example.test:0': 'has an invalid port',
    'https://shop.example.test:65536': 'has an invalid port', 'https://shop.example.test:08443': 'has an invalid port',
    'https://shop.example.test:443443': 'has an invalid port', 'https://shop.example.test:abc': 'must be only the address: no path, "?", "#" or anything after the host and port',
  };
  for (const [value, problem] of Object.entries(refused)) assert.deepStrictEqual(prod(value), { problem }, JSON.stringify(value));
  // development also allows http:// and a one-word host, but not the malformed values
  assert.deepStrictEqual(dev('http://localhost:3300'), { url: 'http://localhost:3300' });
  assert.deepStrictEqual(dev('http://localhost:80/'), { url: 'http://localhost' });
  for (const value of ['https:shop.example.test', 'http://shop.example.test?', 'https://.', 'http://localhost:0'])
    assert.ok(dev(value).problem, JSON.stringify(value));
});

test('production: the server refuses to start with a malformed PUBLIC_URL (startup check)', async () => {
  const bad = [undefined, '', 'http://shop.example.test', 'https:shop.example.test', 'https:\\\\shop.example.test',
    'https://shop.example.test?', 'https://shop.example.test#', 'https://shop.example.test/./', 'https://.', 'https://shop.example.test:0'];
  for (const value of bad) {
    // if it does start (the bug), stop it before failing so no server or temp folder is left behind
    const err = await startServer({ NODE_ENV: 'production', PUBLIC_URL: value })
      .then(async srv => { await srv.stop(); return null; }, e => e);
    assert.ok(err, `should not start with PUBLIC_URL=${JSON.stringify(value)}`);
    assert.match(err.message, /server exited \(1\)/, String(value));
    assert.match(err.message, /PUBLIC_URL (is not set|must|contains|has an invalid)/, String(value));
    assert.match(err.message, /PUBLIC_URL=https:\/\/vornetic\.com/, 'says how to fix it');
  }
});

// ---------- Codex P2: the supplied value is never written to the logs ----------
test('PUBLIC_URL values are never printed: passwords and tokens stay out of the logs', async () => {
  const secrets = {
    'https://admin:S3cret-Passw0rd-x1@shop.example.test': 'S3cret-Passw0rd-x1',
    'https://shop.example.test/?token=tok_SECRET_9f8e7d': 'tok_SECRET_9f8e7d',
    'https://shop.example.test/#key=FRAG_SECRET_42': 'FRAG_SECRET_42',
    'https://shop.example.test/api-key-ZZ99SECRET': 'ZZ99SECRET',
  };
  for (const [value, secret] of Object.entries(secrets)) {
    const err = await startServer({ NODE_ENV: 'production', PUBLIC_URL: value })
      .then(async srv => { await srv.stop(); return null; }, e => e);
    assert.ok(err, 'must not start');
    assert.ok(!err.message.includes(secret), 'secret printed: ' + secret);
    assert.ok(!err.message.includes(value), 'value printed');
    assert.match(err.message, /\(value not shown\)/);
  }
  // development only warns, and also without the value
  const srv = await startServer({ PUBLIC_URL: 'http://dev:DevS3cret-77@localhost:3300' });
  try {
    assert.match(srv.log, /PUBLIC_URL contains a space, backslash, "@" or login details \(value not shown\); using the address of each request/);
    assert.ok(!srv.log.includes('DevS3cret-77'));
  } finally { await srv.stop(); }
});

// ---------- Codex P1: production serves customer requests over https only ----------
test('production: plain-http pages are redirected to https, other requests are refused unprocessed', async () => {
  const srv = await startServer({ NODE_ENV: 'production', PUBLIC_URL: SHOP });
  try {
    const page = await request(srv.base, '/p/test-item?ref=abc', { proxy: false, host: ATTACKER });
    assert.strictEqual(page.status, 301);
    assert.strictEqual(page.headers.location, SHOP + '/p/test-item?ref=abc', 'redirect goes to PUBLIC_URL, not the faked host');
    assert.strictEqual((await request(srv.base, '/admin', { proxy: false })).headers.location, SHOP + '/admin');
    assert.strictEqual((await request(srv.base, '/', { method: 'HEAD', proxy: false })).status, 301);

    const login = await request(srv.base, '/api/admin/login', { method: 'POST', proxy: false, body: { password: 'test-only-admin-password-123' } });
    assert.deepStrictEqual([login.status, JSON.parse(login.text)], [403, { error: 'HTTPS required' }]);
    assert.strictEqual(login.headers['set-cookie'], undefined, 'no session given over http');
    const reg = await request(srv.base, '/api/account/register', { method: 'POST', proxy: false,
      body: { email: 'http-user@example.test', password: 'test-pass-123', name: 'Over Http' } });
    assert.strictEqual(reg.status, 403);
    const forgot = await request(srv.base, '/api/account/forgot', { method: 'POST', proxy: false, body: { email: 'x@example.test' } });
    assert.strictEqual(forgot.status, 403);
    const order = await request(srv.base, '/api/orders', { method: 'POST', proxy: false, body: { items: [] } });
    assert.strictEqual(order.status, 403);
    // nothing was processed: the http account doesn't exist
    const viaHttps = await request(srv.base, '/api/account/login', { method: 'POST', body: { email: 'http-user@example.test', password: 'test-pass-123' } });
    assert.strictEqual(viaHttps.status, 401);
    // the same requests through Nginx (https) work
    assert.strictEqual((await request(srv.base, '/p/test-item')).status, 404, 'served (unknown product page), not redirected');
    assert.strictEqual(srv.log.includes('HTTPS required'), false);
  } finally { await srv.stop(); }
});

test('production: X-Forwarded-Proto is believed only from this machine (Nginx), not from outside', async (t) => {
  const lan = otherAddress();
  if (!lan) return t.skip('no non-loopback network address on this machine');
  // HOST=0.0.0.0 makes the app reachable from the network address, to send a request "from outside"
  const srv = await startServer({ NODE_ENV: 'production', PUBLIC_URL: SHOP, HOST: '0.0.0.0' });
  try {
    const spoofed = await request(srv.base, '/api/admin/login', { method: 'POST', address: lan,
      headers: { 'X-Forwarded-Proto': 'https', 'X-Forwarded-For': '127.0.0.1' }, body: { password: 'test-only-admin-password-123' } });
    assert.strictEqual(spoofed.status, 403, 'a faked "https" from another address is ignored');
    const page = await request(srv.base, '/', { address: lan, headers: { 'X-Forwarded-Proto': 'https' } });
    assert.strictEqual(page.status, 301);
    const local = await request(srv.base, '/api/admin/login', { method: 'POST', body: { password: 'test-only-admin-password-123' } });
    assert.strictEqual(local.status, 200, 'the same header from 127.0.0.1 (Nginx) is believed');
  } finally { await srv.stop(); }
});

test('production listens on 127.0.0.1 only by default, so it is reachable only through Nginx', async (t) => {
  const lan = otherAddress();
  if (!lan) return t.skip('no non-loopback network address on this machine');
  const srv = await startServer({ NODE_ENV: 'production', PUBLIC_URL: SHOP });
  try {
    const err = await request(srv.base, '/', { address: lan }).then(() => null, e => e);
    assert.ok(err && ['ECONNREFUSED', 'ECONNRESET', 'EHOSTUNREACH'].includes(err.code), 'reachable from the network: ' + (err && err.code));
    assert.strictEqual((await request(srv.base, '/')).status, 200, 'reachable on 127.0.0.1');
  } finally { await srv.stop(); }
});

test('production sends HSTS; development does not and serves plain http as before', async () => {
  let srv = await startServer({ NODE_ENV: 'production', PUBLIC_URL: SHOP });
  try {
    assert.strictEqual((await request(srv.base, '/')).headers['strict-transport-security'], 'max-age=31536000');
  } finally { await srv.stop(); }
  srv = await startServer();
  try {
    const r = await request(srv.base, '/', { proxy: false });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.headers['strict-transport-security'], undefined);
    assert.strictEqual((await request(srv.base, '/api/config', { proxy: false })).status, 200);
  } finally { await srv.stop(); }
});

// ---------- Codex P2: a PUBLIC_URL from the shell or CI must not leak into tests ----------
test('development without PUBLIC_URL uses the local address, even if the shell has one set', async () => {
  const saved = process.env.PUBLIC_URL;
  process.env.PUBLIC_URL = 'https://inherited.example.test';   // as if set in the developer's shell or CI
  try {
    const { link } = await resetLinkFor({ PUBLIC_URL: undefined });
    // development fallback: the request's own address (here the test's Host header), not the shell's value
    assert.strictEqual(new URL(link).host, ATTACKER, 'local fallback expected, got ' + link);
    const { link: link2 } = await resetLinkFor({});
    assert.ok(!link2.includes('inherited.example.test'), 'the helper itself never passes the shell value on');
  } finally {
    if (saved === undefined) delete process.env.PUBLIC_URL; else process.env.PUBLIC_URL = saved;
  }
});
