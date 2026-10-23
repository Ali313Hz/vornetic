// test/public-url.test.js — links we send out must use PUBLIC_URL, never a faked Host header.
// Pre-launch audit 2026-10-23: in production without PUBLIC_URL, a password-reset request sent
// with "Host: attacker.example.test" produced an e-mail linking to https://attacker.example.test/…
// Real server, throwaway database, fake SMTP on 127.0.0.1, example.test addresses only.
const { test } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { startServer, fakeSmtp } = require('./helpers');

const SHOP = 'https://shop.example.test';
const ATTACKER = 'attacker.example.test';

// fetch() can't fake the Host header, so use a raw HTTP request
function request(base, path, { method = 'GET', host, body } = {}) {
  const { port } = new URL(base);
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method,
      headers: { 'Content-Type': 'application/json', ...(host && { Host: host }) } }, res => {
      let text = '';
      res.on('data', d => { text += d; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }));
    });
    req.on('error', reject);
    req.end(body && JSON.stringify(body));
  });
}
const links = text => [...text.matchAll(/https?:\/\/[^\s"'<>)]+/g)].map(m => m[0]);

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

test('production: the reset link uses PUBLIC_URL even when the Host header is faked', async () => {
  const { link } = await resetLinkFor({ NODE_ENV: 'production', PUBLIC_URL: SHOP });
  assert.ok(link, 'reset link found');
  assert.strictEqual(new URL(link).origin, SHOP);
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
      const sent = smtp.messages.map((m, i) => smtp.text(i)).join('\n');
      const sentLinks = links(sent).filter(l => !/^https?:\/\/(www\.)?w3\.org/.test(l));
      assert.ok(sentLinks.length > 0, 'e-mails contain links');
      for (const l of sentLinks) assert.ok(!l.includes(ATTACKER), 'link to the faked host: ' + l);
      assert.ok(sentLinks.some(l => l.startsWith(SHOP + '/')), 'links use PUBLIC_URL');

      const sitemap = await request(srv.base, '/sitemap.xml', { host: ATTACKER });
      assert.ok(sitemap.text.includes(`<loc>${SHOP}/</loc>`) && !sitemap.text.includes(ATTACKER));
      const robots = await request(srv.base, '/robots.txt', { host: ATTACKER });
      assert.match(robots.text, new RegExp(`Sitemap: ${SHOP}/sitemap\\.xml`));
      const home = await request(srv.base, '/', { host: ATTACKER });
      assert.ok(home.text.includes(`<link rel="canonical" href="${SHOP}/">`) && !home.text.includes(ATTACKER));
    } finally { await srv.stop(); }
  } finally { await smtp.close(); }
});

test('production: the server refuses to start without a valid https PUBLIC_URL', async () => {
  const bad = [
    [undefined, /PUBLIC_URL is not set/],
    ['', /PUBLIC_URL is not set/],
    ['http://shop.example.test', /is not valid/],
    ['https://shop.example.test/tienda', /is not valid/],
    ['https://shop.example.test/?a=1', /is not valid/],
    ['https://user:pw@shop.example.test', /is not valid/],
    ['shop.example.test', /is not valid/],
    ['javascript:alert(1)', /is not valid/],
  ];
  for (const [value, msg] of bad) {
    // if it does start (the bug), stop it before failing so no server or temp folder is left behind
    const err = await startServer({ NODE_ENV: 'production', PUBLIC_URL: value })
      .then(async srv => { await srv.stop(); return null; }, e => e);
    assert.ok(err, `should not start with PUBLIC_URL=${JSON.stringify(value)}`);
    assert.match(err.message, /server exited \(1\)/, String(value));
    assert.match(err.message, msg, String(value));
    assert.match(err.message, /PUBLIC_URL=https:\/\/vornetic\.com/, 'says how to fix it');
  }
});

test('production sends HSTS; development does not', async () => {
  let srv = await startServer({ NODE_ENV: 'production', PUBLIC_URL: SHOP });
  try {
    const r = await request(srv.base, '/');
    assert.strictEqual(r.headers['strict-transport-security'], 'max-age=31536000');
  } finally { await srv.stop(); }
  srv = await startServer();
  try {
    assert.strictEqual((await request(srv.base, '/')).headers['strict-transport-security'], undefined);
  } finally { await srv.stop(); }
});

test('development without PUBLIC_URL still works and uses the local address', async () => {
  const { link, srv } = await resetLinkFor({});
  // local testing only: the request's own address is used (here the faked Host), as before
  assert.ok(link.startsWith(`http://${ATTACKER}/account/reset?token=`), link);
  assert.ok(srv.startsWith('http://127.0.0.1:'));
});

test('development ignores an invalid PUBLIC_URL with a warning instead of refusing to start', async () => {
  const srv = await startServer({ PUBLIC_URL: 'not a url' });
  try {
    assert.match(srv.log, /PUBLIC_URL "not a url" is not valid; using the address of each request/);
  } finally { await srv.stop(); }
});
