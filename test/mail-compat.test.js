// test/mail-compat.test.js — mail.js against the installed Nodemailer, end to end over SMTP.
// A tiny fake SMTP server runs on 127.0.0.1; nothing leaves this machine and no real
// credentials or addresses are used (example.test is a reserved, non-routable domain).
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const net = require('node:net');

const SMTP_USER = 'test-user@example.test';
const SMTP_PASS = 'test-only-smtp-password';
const received = [];   // { auth, from, to, data }

// Minimal SMTP: EHLO, AUTH PLAIN/LOGIN, MAIL, RCPT, DATA, RSET, QUIT.
// RCPT to reject@example.test gets 550; any password other than SMTP_PASS gets 535.
const smtp = net.createServer(sock => {
  let buf = '', msg = null, auth = null, mode = 'cmd', loginUser = null;
  const say = line => sock.write(line + '\r\n');
  const checkAuth = (user, pass) => {
    if (user === SMTP_USER && pass === SMTP_PASS) { auth = { user, pass }; say('235 2.7.0 Authenticated'); }
    else say('535 5.7.8 Authentication failed');
  };
  say('220 fake.example.test ESMTP test');
  sock.on('data', chunk => {
    buf += chunk.toString('latin1');
    let i;
    while (mode === 'data' ? (i = buf.indexOf('\r\n.\r\n')) !== -1 : (i = buf.indexOf('\r\n')) !== -1) {
      if (mode === 'data') {
        msg.data = buf.slice(0, i).replace(/^\.\./gm, '.');
        buf = buf.slice(i + 5);
        received.push(msg);
        mode = 'cmd';
        say('250 2.0.0 queued');
        continue;
      }
      const line = buf.slice(0, i);
      buf = buf.slice(i + 2);
      if (mode === 'login-user') { loginUser = Buffer.from(line, 'base64').toString(); mode = 'login-pass'; say('334 UGFzc3dvcmQ6'); continue; }
      if (mode === 'login-pass') { mode = 'cmd'; checkAuth(loginUser, Buffer.from(line, 'base64').toString()); continue; }
      if (mode === 'plain') { mode = 'cmd'; const [, u, p] = Buffer.from(line, 'base64').toString().split('\0'); checkAuth(u, p); continue; }
      const cmd = line.slice(0, 4).toUpperCase();
      if (cmd === 'EHLO' || cmd === 'HELO') sock.write('250-fake.example.test\r\n250-AUTH PLAIN LOGIN\r\n250 8BITMIME\r\n');
      else if (/^AUTH PLAIN/i.test(line)) {
        const arg = line.split(' ')[2];
        if (arg) { const [, u, p] = Buffer.from(arg, 'base64').toString().split('\0'); checkAuth(u, p); }
        else { mode = 'plain'; say('334 '); }
      } else if (/^AUTH LOGIN/i.test(line)) { mode = 'login-user'; say('334 VXNlcm5hbWU6'); }
      else if (cmd === 'MAIL') {
        if (!auth) { say('530 5.7.0 Authentication required'); continue; }
        msg = { auth, from: /<([^>]*)>/.exec(line)[1], to: [] }; say('250 OK');
      } else if (cmd === 'RCPT') {
        const to = /<([^>]*)>/.exec(line)[1];
        if (to === 'reject@example.test') say('550 5.1.1 No such user');
        else { msg.to.push(to); say('250 OK'); }
      } else if (cmd === 'DATA') { mode = 'data'; say('354 End data with <CR><LF>.<CR><LF>'); }
      else if (cmd === 'RSET') { msg = null; say('250 OK'); }
      else if (cmd === 'QUIT') { say('221 Bye'); sock.end(); }
      else say('250 OK');
    }
  });
  sock.on('error', () => {});
});

let mail;
const settings = { shop_email: 'shop@example.test', company_name: 'Vornetic Test', company_nif: '', company_address: '' };

before(async () => {
  await new Promise(r => smtp.listen(0, '127.0.0.1', r));
  // mail.js reads its configuration when it is first required
  Object.assign(process.env, {
    SMTP_HOST: '127.0.0.1', SMTP_PORT: String(smtp.address().port),
    SMTP_USER, SMTP_PASS, MAIL_FROM: 'Vornetic Test <noreply@example.test>',
  });
  mail = require('../mail');
});
after(() => new Promise(r => smtp.close(r)));

// Decode quoted-printable bodies so assertions can look for plain text
const qp = s => Buffer.from(s.replace(/=\r\n/g, '').replace(/=([0-9A-F]{2})/g, (m, h) => String.fromCharCode(parseInt(h, 16))), 'latin1').toString('utf8');

test('installed nodemailer is the audited major version', () => {
  assert.strictEqual(require('nodemailer/package.json').version.split('.')[0], '10');
});

test('mail.js sends through SMTP with createTransport/sendMail (password reset)', async () => {
  received.length = 0;
  const link = 'https://shop.example.test/account/reset?token=abc123';
  assert.strictEqual(mail.enabled, true);
  assert.strictEqual(await mail.passwordReset('customer@example.test', 'en', link, settings), true);

  assert.strictEqual(received.length, 1);
  const m = received[0];
  assert.deepStrictEqual(m.auth, { user: SMTP_USER, pass: SMTP_PASS });
  assert.strictEqual(m.from, 'noreply@example.test');
  assert.deepStrictEqual(m.to, ['customer@example.test']);
  assert.match(m.data, /^From: Vornetic Test <noreply@example\.test>\r?$/m);
  assert.match(m.data, /^To: customer@example\.test\r?$/m);
  assert.match(m.data, /^Subject: /m);
  assert.match(m.data, /multipart\/alternative/);           // html + generated text part
  const body = qp(m.data);
  assert.ok(body.includes(link), 'reset link missing from message');
  assert.ok(body.includes('valid for 1 hour'));
});

test('admin test e-mail goes to the shop address', async () => {
  received.length = 0;
  assert.strictEqual(await mail.test(settings), true);
  assert.deepStrictEqual(received.map(m => m.to), [['shop@example.test']]);
});

test('a rejected recipient makes send() return false without throwing', async () => {
  received.length = 0;
  assert.strictEqual(await mail.passwordReset('reject@example.test', 'es', 'https://x.example.test', settings), false);
  assert.strictEqual(received.length, 0);
});

test('no recipient means nothing is sent', async () => {
  received.length = 0;
  assert.strictEqual(await mail.passwordReset('', 'en', 'https://x.example.test', settings), false);
  assert.strictEqual(received.length, 0);
});
