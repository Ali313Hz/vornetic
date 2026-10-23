// test/nginx-config.test.js — checks docs/nginx-vornetic.conf without Nginx installed.
// Not a replacement for `nginx -t` on the server: it guards the rules this project relies on,
// so the file keeps working on the Nginx versions of the documented Ubuntu/Debian installs (1.18+)
// and stays in step with the app (port, forwarded headers, upload size).
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const conf = fs.readFileSync(path.join(ROOT, 'docs', 'nginx-vornetic.conf'), 'utf8');
const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const code = conf.split(/\r?\n/).map(l => l.replace(/#.*$/, '').trim()).filter(Boolean);   // without comments

// The server { … } blocks, as lists of directive lines
function serverBlocks() {
  const blocks = [];
  let depth = 0, current = null;
  for (const line of code) {
    if (/^server\s*\{$/.test(line) && depth === 0) { current = []; blocks.push(current); depth = 1; continue; }
    depth += (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
    if (depth === 0) { current = null; continue; }
    current.push(line);
  }
  return blocks;
}

test('nginx config: well formed (balanced braces, every directive ends with ";")', () => {
  let depth = 0;
  for (const line of code) {
    depth += (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
    assert.ok(depth >= 0, 'unbalanced } at: ' + line);
    assert.match(line, /(;|\{|\})$/, 'directive without ";": ' + line);
  }
  assert.strictEqual(depth, 0, 'unbalanced braces');
  assert.strictEqual(serverBlocks().length, 4);
});

// Codex P1 (PR #14): "http2 on;" needs Nginx 1.25.1, Debian 12 ships 1.22, Ubuntu 22.04 1.18
test('nginx config: only directives available in Nginx 1.18 (Ubuntu 20.04+, Debian 11+)', () => {
  assert.ok(!code.some(l => /^http2\s/.test(l)), '"http2 on;" needs nginx 1.25.1+');
  assert.ok(!code.some(l => /^ssl_reject_handshake\s/.test(l)), 'ssl_reject_handshake needs nginx 1.19.4+');
  assert.ok(!code.some(l => /^(quic|http3)\b/.test(l) || /\bquic\b/.test(l)), 'HTTP/3 needs nginx 1.25+');
  const tls = code.filter(l => /^listen\s+(\[::\]:)?443\b/.test(l));
  assert.strictEqual(tls.length, 6, 'three https server blocks, IPv4 + IPv6');
  for (const l of tls) assert.match(l, /^listen\s+(\[::\]:)?443 ssl http2( default_server)?;$/, l);
  assert.match(conf, /Nginx 1\.18 or newer/, 'the minimum version is documented');
});

test('nginx config: every https block has a certificate; port 80 only redirects or closes', () => {
  for (const block of serverBlocks()) {
    const https = block.some(l => /^listen\s+(\[::\]:)?443\b/.test(l));
    if (https) {
      assert.ok(block.some(l => /^ssl_certificate\s+\/etc\/letsencrypt\/live\/[^/]+\/fullchain\.pem;$/.test(l)), 'certificate missing: ' + block.join(' '));
      assert.ok(block.some(l => /^ssl_certificate_key\s+\/etc\/letsencrypt\/live\/[^/]+\/privkey\.pem;$/.test(l)), 'key missing: ' + block.join(' '));
    }
    const plain = block.some(l => /^listen\s+(\[::\]:)?80\b/.test(l));
    if (plain) assert.ok(block.some(l => /^return (301 https:\/\/|444;)/.test(l)), 'port 80 must redirect to https or close: ' + block.join(' '));
    if (plain) assert.ok(!block.some(l => /^proxy_pass\b/.test(l)), 'nothing goes to the app over http');
  }
  const catchAll = serverBlocks().find(b => b.includes('server_name _;'));
  assert.ok(catchAll.some(l => /default_server;$/.test(l)) && catchAll.includes('return 444;'), 'unknown hosts are closed');
});

test('nginx config: proxies to the app on 127.0.0.1 and overwrites the forwarded headers', () => {
  const port = Number(/const PORT = process\.env\.PORT \|\| (\d+);/.exec(server)[1]);
  const shop = serverBlocks().find(b => b.some(l => /^proxy_pass\b/.test(l)));
  assert.ok(shop.includes(`proxy_pass http://127.0.0.1:${port};`), 'proxy_pass must match the default PORT ' + port);
  assert.ok(shop.includes('proxy_set_header X-Forwarded-Proto $scheme;'));
  assert.ok(shop.includes('proxy_set_header X-Forwarded-For $remote_addr;'), 'overwrite, never append ($proxy_add_x_forwarded_for)');
  assert.ok(shop.includes('proxy_set_header Host $host;'));
  assert.ok(!code.some(l => l.includes('$proxy_add_x_forwarded_for')));
});

// Codex P2 (PR #14): the body limit must fit the largest request the app accepts — and no more
test('nginx config: upload limit = one maximum-size video plus form overhead, matching server.js', () => {
  const videoMb = Number(/const MAX_VIDEO_MB = (\d+)/.exec(server)[1]);
  assert.match(server, /limits: \{ fileSize: MAX_VIDEO_MB \* 1024 \* 1024, files: 1 \}/, 'one file per request');
  assert.match(server, /upload\.array\('files', 1\)/);
  const limits = code.filter(l => /^client_max_body_size\s/.test(l));
  assert.strictEqual(limits.length, 1);
  const mb = Number(/^client_max_body_size (\d+)m;$/.exec(limits[0])[1]);
  assert.ok(mb >= videoMb + 1, `client_max_body_size ${mb}m is too small for one ${videoMb} MB video plus form overhead`);
  assert.ok(mb <= videoMb + 5, `client_max_body_size ${mb}m is much larger than any request the app accepts`);
});

test('the admin page uploads one file per request and skips files over the limits first', () => {
  const admin = fs.readFileSync(path.join(ROOT, 'public', 'js', 'admin.js'), 'utf8');
  const fn = admin.match(/^function planUploads[\s\S]*?^\}\r?$/m);
  assert.ok(fn, 'planUploads not found in admin.js');
  const planUploads = new Function(fn[0] + '\nreturn planUploads;')();
  const MB = 1024 * 1024;
  const limits = { photo_mb: 12, video_mb: 80, photo_ext: ['.jpg', '.jpeg', '.png', '.webp'], video_ext: ['.mp4', '.webm'] };
  const files = [
    { name: 'a.mp4', size: 60 * MB }, { name: 'b.MP4', size: 60 * MB }, { name: 'c.webm', size: 80 * MB },
    { name: 'd.mp4', size: 80 * MB + 1 }, { name: 'e.jpg', size: 5 * MB }, { name: 'f.png', size: 12 * MB + 1 },
    { name: 'g.gif', size: 10 }, { name: 'noext', size: 10 },
  ];
  const { send, skipped } = planUploads(files, limits);
  assert.deepStrictEqual(send.map(f => f.name), ['a.mp4', 'b.MP4', 'c.webm', 'e.jpg'], 'two 60 MB videos are both sent (one request each)');
  assert.strictEqual(skipped.length, 4);
  assert.match(skipped.join('\n'), /d\.mp4: video en fazla 80 MB/);
  assert.match(skipped.join('\n'), /f\.png: fotoğraf en fazla 12 MB/);
  // uploadFiles: a new FormData with one file for each request
  const up = admin.match(/^async function uploadFiles[\s\S]*?^\}\r?$/m)[0];
  assert.match(up, /for \(const \[i, f\] of send\.entries\(\)\) \{[\s\S]*const fd = new FormData\(\);\s*fd\.append\('files', await shrinkImage\(f\)\);\s*const r = await api\('\/api\/admin\/upload'/);
  assert.strictEqual((up.match(/fd\.append\(/g) || []).length, 1, 'exactly one file appended per request');
});
