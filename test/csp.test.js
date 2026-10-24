// test/csp.test.js — Content-Security-Policy header (pre-launch PR 7).
// The browser may run scripts, load fonts, images and video, and make requests only from this site.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, VIA_PROXY } = require('./helpers');

const ROOT = path.join(__dirname, '..');
const EXPECTED = ["default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data:",
  "font-src 'self'", "media-src 'self'", "connect-src 'self'", "object-src 'none'", "base-uri 'self'",
  "form-action 'self'", "frame-ancestors 'self'"];
const directives = h => (h || '').split(';').map(d => d.trim()).filter(Boolean);

test('every response carries the policy: pages, product pages, API, static files', async () => {
  const srv = await startServer();
  try {
    for (const url of ['/', '/p/xenon-basic', '/checkout', '/admin', '/api/products', '/css/styles.css', '/fonts/inter-latin-wght-normal.woff2', '/no-such-api-route']) {
      const r = await fetch(srv.base + url, { headers: VIA_PROXY });
      const h = r.headers.get('content-security-policy');
      assert.deepStrictEqual(directives(h), EXPECTED, url);
      assert.strictEqual(r.headers.get('content-security-policy-report-only'), null, url);
    }
  } finally { await srv.stop(); }
});

test('scripts are strict: no inline, no eval, nothing from other sites; upgrade-insecure-requests only in production', async () => {
  const script = EXPECTED.find(d => d.startsWith('script-src'));
  assert.doesNotMatch(script, /unsafe-inline|unsafe-eval|https?:|\*/);
  const dev = await startServer();
  try {
    const h = (await fetch(dev.base + '/', { headers: VIA_PROXY })).headers.get('content-security-policy');
    assert.doesNotMatch(h, /upgrade-insecure-requests/, 'not in development (http://localhost)');
  } finally { await dev.stop(); }
  const prod = await startServer({ NODE_ENV: 'production', PUBLIC_URL: 'https://shop.example.test' });
  try {
    const h = (await fetch(prod.base + '/', { headers: VIA_PROXY })).headers.get('content-security-policy');
    assert.deepStrictEqual(directives(h), [...EXPECTED, 'upgrade-insecure-requests']);
  } finally { await prod.stop(); }
});

test('CSP_REPORT_ONLY=1: the same policy, only reported (emergency switch)', async () => {
  const srv = await startServer({ CSP_REPORT_ONLY: '1' });
  try {
    const r = await fetch(srv.base + '/', { headers: VIA_PROXY });
    assert.strictEqual(r.headers.get('content-security-policy'), null);
    assert.deepStrictEqual(directives(r.headers.get('content-security-policy-report-only')), EXPECTED);
  } finally { await srv.stop(); }
});

test('the pages stay compatible: no inline scripts, inline event handlers or javascript: links', () => {
  const files = ['public/index.html', 'public/admin.html', 'public/js/app.js', 'public/js/admin.js', 'server.js'];
  for (const f of files) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    // <script> without src= is only allowed for JSON-LD data (not run by the browser)
    for (const m of src.matchAll(/<script\b([^>]*)>/gi)) {
      const attrs = m[1];
      assert.ok(/\bsrc\s*=/.test(attrs) || /type="application\/ld\+json"/.test(attrs), `${f}: inline <script${attrs}>`);
    }
    assert.doesNotMatch(src, /<[a-z][^>]*\son(click|load|error|submit|change|input|mouse\w+|key\w+)\s*=/i, `${f}: inline event handler`);
    assert.doesNotMatch(src, /href\s*=\s*["']javascript:/i, `${f}: javascript: link`);
  }
  for (const f of ['public/js/app.js', 'public/js/admin.js']) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert.doesNotMatch(src, /\beval\(|new Function\(|set(Timeout|Interval)\(\s*['"`]/, `${f}: code from strings`);
  }
});
