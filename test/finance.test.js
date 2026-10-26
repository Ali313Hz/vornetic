// test/finance.test.js — the admin "Finans" tab (issue #5).
// Real server, throwaway database, fake data only (example.test, made-up amounts).
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { startServer, tempDir, oldDatabase } = require('./helpers');
const finance = require('../finance');

// The shop's calendar is Madrid's (the server groups by it), so "today" here is Madrid's too
const today = () => finance.localDate();
const thisMonth = () => today().slice(0, 7);
const FIN = '/api/admin/finance';
const entry = (over = {}) => ({ kind: 'expense', date: today(), amount_cents: 15000, category: 'storage', ...over });

// Everything the shop itself owns: finance actions must never change any of it
function shopSnapshot(dir) {
  const db = new DatabaseSync(path.join(dir, 'store.db'));
  try {
    return JSON.stringify(['orders', 'products', 'refunds', 'payment_checks', 'users']
      .map(t => db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()));
  } finally { db.close(); }
}

// ---------- helpers (no server) ----------
test('amounts: common formats are read, unclear ones are refused', () => {
  const ok = { '12': 1200, '12,5': 1250, '12.50': 1250, '1.234,56': 123456, '1,234.56': 123456, '€ 12,50': 1250, '12,50 EUR': 1250, '0,99': 99, '1.234.567,89': 123456789 };
  for (const [t, c] of Object.entries(ok)) assert.strictEqual(finance.parseAmount(t), c, t);
  for (const bad of ['1.234', '12,505', '-5', 'abc', '', '12.', '1,2,3', '1e3', null]) assert.strictEqual(finance.parseAmount(bad), null, String(bad));
});

test('dates: ISO and day/month/year, only real dates', () => {
  assert.strictEqual(finance.parseDate('2026-10-23'), '2026-10-23');
  assert.strictEqual(finance.parseDate('23/10/2026'), '2026-10-23');
  assert.strictEqual(finance.parseDate('5.1.2026'), '2026-01-05');
  for (const bad of ['2026-02-30', '31/04/2026', '1999-12-31', '10/23/2026', '45231', '', 'ayer']) assert.strictEqual(finance.parseDate(bad), null, bad);
});

test('CSV: quotes and separators are read; formula-like text is neutralised on export', () => {
  const rows = finance.parseCsv('﻿a;b\r\n"x;y";"q""z"\n1;2');
  assert.deepStrictEqual(rows.map(r => r.cells), [['a', 'b'], ['x;y', 'q"z'], ['1', '2']]);
  assert.deepStrictEqual(finance.parseCsv('a,b\n1,2').map(r => r.cells), [['a', 'b'], ['1', '2']]);
  assert.throws(() => finance.parseCsv('a;b\n"open;2'), /kapanmamış/);
  for (const f of ['=1+2', '+SUM(A1)', '-2+3', '@cmd', '\tx']) assert.ok(finance.csvCell(f).startsWith("'") || finance.csvCell(f).startsWith('"\''), f);
  assert.strictEqual(finance.csvCell('a;b'), '"a;b"');
  assert.ok(finance.toCsv([['x']]).startsWith('﻿'));
});

// ---------- security ----------
test('every finance route requires an admin session', async () => {
  const srv = await startServer();
  try {
    const id = (await srv.admin('POST', FIN + '/entries', entry())).body.id;
    const before = shopSnapshot(srv.dataDir) + JSON.stringify((await srv.admin('GET', FIN)).body.entries);
    const routes = [['GET', FIN], ['GET', FIN + '?month=2026-01'], ['POST', FIN + '/entries', entry()], ['PUT', FIN + '/entries/' + id, entry({ amount_cents: 1 })],
      ['DELETE', FIN + '/entries/' + id], ['GET', FIN + '/export.csv'], ['POST', FIN + '/import', { csv: 'type;date;amount;category\ngider;2026-10-01;5;depo' }]];
    for (const [m, url, body] of routes) {
      const r = await srv.call(m, url, body);
      assert.strictEqual(r.status, 401, `${m} ${url}`);
      const forged = await srv.call(m, url, body, { Cookie: 'admin=' + 'f'.repeat(64) });
      assert.strictEqual(forged.status, 401, `${m} ${url} with a fake cookie`);
    }
    assert.strictEqual(shopSnapshot(srv.dataDir) + JSON.stringify((await srv.admin('GET', FIN)).body.entries), before, 'nothing changed');
  } finally { await srv.stop(); }
});

// ---------- quick entry ----------
test('adding, editing and deleting entries needs only type, amount, category and date', async () => {
  const srv = await startServer();
  try {
    let r = await srv.admin('POST', FIN + '/entries', { kind: 'income', amount_cents: 4590, category: 'wallapop', date: today() });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.possible_duplicate, false);
    const id = r.body.id;
    await srv.admin('POST', FIN + '/entries', entry({ amount_cents: 6050, category: 'gestor', note: 'Ekim', party: 'Gestoría Test', country: 'es' }));

    let d = (await srv.admin('GET', FIN)).body;
    assert.strictEqual(d.month, thisMonth());
    assert.deepStrictEqual([d.income_cents, d.expense_cents, d.balance_cents], [4590, 6050, 4590 - 6050]);
    assert.deepStrictEqual(d.manual_income, [{ category: 'wallapop', n: 1, total_cents: 4590 }]);
    const g = d.entries.find(e => e.category === 'gestor');
    assert.deepStrictEqual([g.note, g.party, g.country], ['Ekim', 'Gestoría Test', 'ES']);
    assert.ok(d.categories.income.amazon && d.categories.expense.taxes);
    assert.strictEqual(d.categories.income.web, undefined, 'website is never a manual category');

    // identical entry: saved (could be two real sales), but flagged
    r = await srv.admin('POST', FIN + '/entries', { kind: 'income', amount_cents: 4590, category: 'wallapop', date: today() });
    assert.deepStrictEqual([r.status, r.body.possible_duplicate], [200, true]);

    r = await srv.admin('PUT', FIN + '/entries/' + id, { kind: 'income', amount_cents: 5000, category: 'vinted', date: today(), note: 'düzeltildi' });
    assert.strictEqual(r.status, 200);
    d = (await srv.admin('GET', FIN)).body;
    assert.deepStrictEqual(d.entries.find(e => e.id === id).amount_cents, 5000);
    assert.strictEqual(d.income_cents, 5000 + 4590);

    assert.strictEqual((await srv.admin('DELETE', FIN + '/entries/' + id)).status, 200);
    assert.strictEqual((await srv.admin('DELETE', FIN + '/entries/' + id)).status, 404);
    assert.strictEqual((await srv.admin('PUT', FIN + '/entries/999999', entry())).status, 404);
    assert.strictEqual((await srv.admin('GET', FIN)).body.income_cents, 4590);
  } finally { await srv.stop(); }
});

test('invalid entries are refused with a clear message', async () => {
  const srv = await startServer();
  try {
    const bad = [
      [{ kind: 'profit' }, /Tür/], [{ category: 'web' }, /Kategori/], [{ kind: 'income', category: 'storage' }, /Kategori/],
      [{ date: '2026-02-30' }, /tarih/], [{ date: '' }, /tarih/], [{ amount_cents: 0 }, /Tutar/], [{ amount_cents: -100 }, /Tutar/],
      [{ amount_cents: 12.5 }, /Tutar/], [{ amount_cents: '1500' }, /Tutar/], [{ amount_cents: 100000001 }, /Tutar/],
      [{ country: 'ESP' }, /Ülke/], [{ country: '1A' }, /Ülke/],
    ];
    for (const [over, msg] of bad) {
      const r = await srv.admin('POST', FIN + '/entries', entry(over));
      assert.strictEqual(r.status, 400, JSON.stringify(over));
      assert.match(r.body.error, msg, JSON.stringify(over));
    }
    assert.strictEqual((await srv.admin('GET', FIN)).body.entries.length, 0);
    const long = await srv.admin('POST', FIN + '/entries', entry({ note: 'x'.repeat(1000) }));
    assert.strictEqual(long.status, 200);
    assert.strictEqual((await srv.admin('GET', FIN)).body.entries[0].note.length, 300);
  } finally { await srv.stop(); }
});

// ---------- website money: automatic, by payment / refund date, never twice ----------
test('website payments and refunds are counted automatically, in the right month, once', async () => {
  const dir = tempDir();
  try {
    oldDatabase(dir, [
      { ref: 'VN-MAR001', status: 'delivered', total: 5000, shipping: 395, created_at: '2026-03-10 12:00:00' },   // paid (date estimated)
      { ref: 'VN-MAR002', status: 'pending', total: 7000, created_at: '2026-03-11 12:00:00' },                     // never paid
      { ref: 'VN-MAR003', status: 'cancelled', total: 9000, created_at: '2026-03-12 12:00:00' },                   // payment unknown
    ]);
    const srv = await startServer({}, dir);
    try {
      let mar = (await srv.admin('GET', FIN + '?month=2026-03')).body;
      assert.deepStrictEqual([mar.web.orders, mar.web.payments_cents, mar.web.shipping_cents, mar.web.estimated_dates], [1, 5000, 395, 1]);
      assert.strictEqual(mar.income_cents, 5000, 'pending and unknown-payment orders are not income');
      assert.strictEqual(mar.warnings.payment_unknown, 1);

      // A new web order paid now, and a refund now of the March sale
      const p = await srv.newProduct(5);
      const { body: { ref } } = await srv.order([{ id: p, qty: 2 }]);
      await srv.setOrder(ref, { status: 'paid' });
      const total = (await srv.orderByRef(ref)).total_cents;
      assert.strictEqual((await srv.refund('VN-MAR001', 1500)).status, 200);
      await srv.admin('POST', FIN + '/entries', entry({ amount_cents: 2000, category: 'advertising' }));

      const now = (await srv.admin('GET', FIN)).body;
      assert.deepStrictEqual([now.web.orders, now.web.payments_cents, now.web.refunds_cents, now.web.net_cents], [1, total, 1500, total - 1500]);
      assert.deepStrictEqual([now.income_cents, now.expense_cents, now.balance_cents], [total - 1500, 2000, total - 1500 - 2000]);
      mar = (await srv.admin('GET', FIN + '?month=2026-03')).body;
      assert.strictEqual(mar.income_cents, 5000, 'a refund made now does not change March');

      // The legacy order is answered "paid": it now counts, in its own (estimated) month
      await srv.setOrder('VN-MAR003', { payment_check: 'paid' });
      mar = (await srv.admin('GET', FIN + '?month=2026-03')).body;
      assert.deepStrictEqual([mar.income_cents, mar.warnings.payment_unknown, mar.warnings.needs_refund], [14000, 0, 1]);

      // 12-month overview: newest first, current month included
      assert.strictEqual(now.months.length, 12);
      assert.deepStrictEqual(now.months[0], { month: thisMonth(), income_cents: now.income_cents, expense_cents: 2000, balance_cents: now.balance_cents });
    } finally { await srv.stop(); }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('finance entries and imports never change orders, refunds, stock or customers', async () => {
  const srv = await startServer();
  try {
    const p = await srv.newProduct(5);
    const { body: { ref } } = await srv.order([{ id: p, qty: 1 }]);
    await srv.setOrder(ref, { status: 'paid' });
    await srv.refund(ref, 300);
    const before = shopSnapshot(srv.dataDir);

    const r = await srv.admin('POST', FIN + '/entries', { kind: 'income', amount_cents: 32000, category: 'wholesale', date: today(), party: 'Auto Test SL' });
    await srv.admin('PUT', FIN + '/entries/' + r.body.id, { kind: 'income', amount_cents: 33000, category: 'wholesale', date: today() });
    await srv.admin('POST', FIN + '/entries', entry({ category: 'stock', amount_cents: 99000 }));
    await srv.admin('POST', FIN + '/import', { csv: `type;date;amount;category\ngelir;${today()};10;amazon\ngider;${today()};5;kargo` });
    await srv.admin('DELETE', FIN + '/entries/' + r.body.id);
    await srv.admin('GET', FIN + '/export.csv');

    assert.strictEqual(shopSnapshot(srv.dataDir), before);
  } finally { await srv.stop(); }
});

// ---------- CSV export ----------
test('CSV export: Excel-friendly, web rows marked, formulas neutralised, month filter', async () => {
  const srv = await startServer();
  try {
    const p = await srv.newProduct(5);
    const { body: { ref } } = await srv.order([{ id: p, qty: 1 }]);
    await srv.setOrder(ref, { status: 'paid' });
    await srv.refund(ref, 250);
    const total = (await srv.orderByRef(ref)).total_cents;
    await srv.admin('POST', FIN + '/entries', entry({ amount_cents: 123456, category: 'taxes', note: '=HYPERLINK("http://x.example.test")', party: 'A;B' }));
    await srv.admin('POST', FIN + '/entries', { kind: 'income', amount_cents: 4590, category: 'wallapop', date: '2026-01-15' });

    const r = await srv.admin('GET', FIN + '/export.csv?month=' + thisMonth());
    assert.strictEqual(r.status, 200);
    assert.match(r.headers.get('content-type'), /^text\/csv/);
    assert.match(r.headers.get('content-disposition'), new RegExp(`attachment; filename="vornetic-finans-${thisMonth()}\\.csv"`));
    assert.ok(r.text.startsWith('﻿'), 'UTF-8 BOM for Excel');
    const lines = r.text.replace(/^﻿/, '').trim().split('\r\n');
    assert.strictEqual(lines[0], 'id;type;date;amount_eur;category;note;country;party;reference');
    const eur = c => (c / 100).toFixed(2).replace('.', ',');
    assert.ok(lines.some(l => l.includes(`web_sale;${today()};${eur(total)};web;`) && l.endsWith(ref)), 'web sale row');
    assert.ok(lines.some(l => l.includes(`web_refund;${today()};2,50;web;`)), 'web refund row');
    const tax = lines.find(l => l.includes('Vergi'));
    assert.ok(tax.includes(';gider;') && tax.includes(';1234,56;'), tax);
    assert.ok(tax.includes(`"'=HYPERLINK(""http://x.example.test"")"`), 'formula neutralised: ' + tax);
    assert.ok(tax.includes('"A;B"'));
    assert.ok(!r.text.includes('Wallapop'), 'January entry is not in this month');
    assert.ok((await srv.admin('GET', FIN + '/export.csv')).text.includes('Wallapop'), 'full export has everything');
  } finally { await srv.stop(); }
});

// ---------- CSV import ----------
test('import: preview saves nothing; import saves; the same file again adds nothing', async () => {
  const srv = await startServer();
  try {
    const csv = [
      'Tür;Tarih;Tutar (EUR);Kategori;Kaynak;Açıklama;Ülke;Alıcı;Referans;Para birimi;Renk',
      'gelir;05/10/2026;45,90;;Wallapop;Xenon D1S;ES;;;EUR;mavi',
      'gelir;07/10/2026;"1.320,00";;Toptan;10 set LED;PT;Auto Lisboa Test;F-12;EUR;',
      'gider;2026-10-01;150;Depo / kira;;Ekim kirası;ES;;;;',
      'Gider;10.10.2026;60,50;gestoría;;;ES;Gestoría Test;;€;',
      'web_sale;2026-10-03;99,00;web;;Web sitesi siparişi;ES;;VN-ABC123;;',
      '',
    ].join('\r\n');
    let r = await srv.admin('POST', FIN + '/import', { csv, dry_run: true });
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual([r.body.add_count, r.body.duplicates.length, r.body.ignored.length, r.body.errors.length, r.body.saved], [4, 0, 1, 0, 0]);
    assert.match(r.body.warnings.join(), /Renk/);
    assert.deepStrictEqual(r.body.add.map(a => [a.kind, a.date, a.amount_cents, a.category]), [
      ['income', '2026-10-05', 4590, 'wallapop'], ['income', '2026-10-07', 132000, 'wholesale'],
      ['expense', '2026-10-01', 15000, 'storage'], ['expense', '2026-10-10', 6050, 'gestor']]);
    assert.strictEqual((await srv.admin('GET', FIN + '?month=2026-10')).body.entries.length, 0, 'preview saved nothing');

    r = await srv.admin('POST', FIN + '/import', { csv });
    assert.deepStrictEqual([r.status, r.body.saved], [200, 4]);
    const oct = (await srv.admin('GET', FIN + '?month=2026-10')).body;
    assert.deepStrictEqual([oct.income_cents, oct.expense_cents], [4590 + 132000, 15000 + 6050]);
    const w = oct.entries.find(e => e.category === 'wholesale');
    assert.deepStrictEqual([w.party, w.reference, w.country, w.note], ['Auto Lisboa Test', 'F-12', 'PT', '10 set LED']);

    r = await srv.admin('POST', FIN + '/import', { csv });
    assert.deepStrictEqual([r.status, r.body.saved, r.body.duplicates.length], [200, 0, 4], 'same file twice: nothing doubled');

    // Our own export, imported back: manual rows are duplicates, web rows are skipped
    const exported = (await srv.admin('GET', FIN + '/export.csv')).text;
    r = await srv.admin('POST', FIN + '/import', { csv: exported });
    assert.deepStrictEqual([r.body.saved, r.body.duplicates.length], [0, 4]);
    assert.strictEqual((await srv.admin('GET', FIN + '?month=2026-10')).body.entries.length, 4);
  } finally { await srv.stop(); }
});

test('import: one bad row means nothing is saved, and each error names its line', async () => {
  const srv = await startServer();
  try {
    const csv = [
      'type;date;amount;category;note;currency',
      'gelir;2026-10-05;10,00;amazon;ok;EUR',
      'gelir;2026-13-05;10,00;amazon;bad date;',
      'gelir;2026-10-05;1.234;amazon;ambiguous amount;',
      'gelir;2026-10-05;-10;amazon;negative;',
      'gider;2026-10-05;10;uzay gemisi;unknown category;',
      'kâr;2026-10-05;10;amazon;unknown type;',
      'gelir;2026-10-06;10;amazon;=cmd|"/c calc"!A1;',
      'gelir;2026-10-06;10;amazon;dollars;USD',
      'gider;2026-10-06;10;depo;;',
    ].join('\n');
    const r = await srv.admin('POST', FIN + '/import', { csv });
    assert.strictEqual(r.status, 400);
    assert.strictEqual(r.body.saved, 0);
    assert.deepStrictEqual(r.body.errors.map(e => e.line), [3, 4, 5, 6, 7, 8, 9]);
    const msgs = r.body.errors.map(e => e.msg).join('\n');
    for (const m of [/Tarih/, /Tutar/, /Kategori/, /Tür/, /Formül/, /EUR/]) assert.match(msgs, m);
    assert.strictEqual((await srv.admin('GET', FIN + '?month=2026-10')).body.entries.length, 0);
  } finally { await srv.stop(); }
});

// Codex P1 (c4e78af): same type, date, amount and category is not enough to call a row a duplicate
test('import: two real same-amount sales are both kept; importing the file again adds nothing', async () => {
  const srv = await startServer();
  try {
    const csv = [
      'type;date;amount;source;note;party;reference',
      'gelir;2026-10-08;45,90;Wallapop;Xenon D1S;Buyer One;',      // two different Wallapop sales,
      'gelir;2026-10-08;45,90;Wallapop;Xenon D2S;Buyer Two;',      // same day and amount, no reference
      'gelir;2026-10-09;320;toptan;10 set;Garage Test;F-1',
      'gelir;2026-10-09;320;toptan;10 set;Garage Test;F-2',       // different invoice = different sale
      'gelir;2026-10-10;50;amazon;;;',
      'gelir;2026-10-10;50;amazon;;;',                            // fully identical lines: kept, but flagged
    ].join('\n');
    let r = await srv.admin('POST', FIN + '/import', { csv });
    assert.deepStrictEqual([r.status, r.body.saved, r.body.duplicates.length], [200, 6, 0]);
    assert.ok(r.body.warnings.some(w => /Satır 6, 7 birebir aynı/.test(w)), r.body.warnings.join('\n'));
    let oct = (await srv.admin('GET', FIN + '?month=2026-10')).body;
    assert.deepStrictEqual([oct.entries.length, oct.income_cents], [6, 2 * 4590 + 2 * 32000 + 2 * 5000]);

    r = await srv.admin('POST', FIN + '/import', { csv });           // the same file again
    assert.deepStrictEqual([r.status, r.body.saved, r.body.duplicates.length], [200, 0, 6]);
    assert.match(r.body.duplicates.find(d => d.line === 4).reason, /referansla \(F-1\)/);
    assert.match(r.body.duplicates.find(d => d.line === 2).reason, /Tüm alanları aynı/);
    oct = (await srv.admin('GET', FIN + '?month=2026-10')).body;
    assert.deepStrictEqual([oct.entries.length, oct.income_cents], [6, 2 * 4590 + 2 * 32000 + 2 * 5000]);

    // A file with one more of the identical Amazon lines adds just that one
    r = await srv.admin('POST', FIN + '/import', { csv: csv + '\ngelir;2026-10-10;50;amazon;;;' });
    assert.deepStrictEqual([r.body.saved, r.body.duplicates.length], [1, 6]);
  } finally { await srv.stop(); }
});

test('import: a reference identifies a record even if its note changed; blank vs reference only warns', async () => {
  const srv = await startServer();
  try {
    await srv.admin('POST', FIN + '/entries', { kind: 'income', amount_cents: 32000, category: 'wholesale', date: '2026-10-07', reference: 'F-9', note: 'old note' });
    await srv.admin('POST', FIN + '/entries', { kind: 'expense', amount_cents: 6050, category: 'gestor', date: '2026-10-10' });
    const csv = [
      'type;date;amount;category;note;reference',
      'gelir;2026-10-07;320;toptan;note edited in Excel;F-9',     // same invoice → already saved
      'gider;2026-10-10;60,50;gestor;;FAC-55',                     // saved one has no reference → maybe same
    ].join('\n');
    const r = await srv.admin('POST', FIN + '/import', { csv, dry_run: true });
    assert.deepStrictEqual(r.body.duplicates.map(d => d.line), [2]);
    assert.deepStrictEqual(r.body.add.map(a => a.line), [3]);
    assert.ok(r.body.warnings.some(w => /^Satır 3: aynı gün, tutar ve kategoride kayıtlı bir işlem var/.test(w)), r.body.warnings.join('\n'));
  } finally { await srv.stop(); }
});

// ---------- Codex P2 (c4e78af): website money by the Madrid calendar ----------
test('Madrid calendar: day starts across winter, summer and clock changes', () => {
  const starts = {
    '2026-02-01': '2026-01-31 23:00:00',   // winter: UTC+1
    '2026-03-29': '2026-03-28 23:00:00',   // clocks go forward at 02:00 that day
    '2026-03-30': '2026-03-29 22:00:00',   // summer: UTC+2
    '2026-04-01': '2026-03-31 22:00:00',
    '2026-09-01': '2026-08-31 22:00:00',
    '2026-10-25': '2026-10-24 22:00:00',   // clocks go back at 03:00 that day
    '2026-11-01': '2026-10-31 23:00:00',
    '2027-01-01': '2026-12-31 23:00:00',
  };
  for (const [day, utc] of Object.entries(starts)) assert.strictEqual(finance.localDayStartUtc(day), utc, day);
  assert.strictEqual(finance.utcTextToLocalDate('2026-03-31 22:00:00'), '2026-04-01');
  assert.strictEqual(finance.utcTextToLocalDate('2026-03-31 21:59:59'), '2026-03-31');
  assert.strictEqual(finance.localDate(Date.parse('2026-07-31T22:30:00Z')), '2026-08-01');
  assert.strictEqual(finance.localDate(Date.parse('2026-01-31T22:30:00Z')), '2026-01-31');
  assert.strictEqual(finance.BUSINESS_TZ, 'Europe/Madrid');
});

test('website payments and refunds fall in the Madrid month, in winter and in summer', async () => {
  const dir = tempDir();
  try {
    // paid_at of old paid orders = their order time (UTC), as stored by SQLite
    oldDatabase(dir, [
      { ref: 'VN-W1', status: 'delivered', total: 1000, created_at: '2026-01-31 22:59:59' },   // 31 Jan 23:59:59 Madrid → January
      { ref: 'VN-W2', status: 'delivered', total: 2000, created_at: '2026-01-31 23:30:00' },   // 1 Feb 00:30 Madrid → February
      { ref: 'VN-S1', status: 'delivered', total: 4000, created_at: '2026-03-31 21:59:59' },   // 31 Mar 23:59:59 Madrid → March
      { ref: 'VN-S2', status: 'delivered', total: 8000, created_at: '2026-03-31 22:30:00' },   // 1 Apr 00:30 Madrid → April
      { ref: 'VN-S3', status: 'delivered', total: 16000, created_at: '2026-08-31 22:10:00' },  // 1 Sep 00:10 Madrid → September
      { ref: 'VN-O1', status: 'delivered', total: 32000, created_at: '2026-10-31 22:30:00' },  // 31 Oct 23:30 Madrid (winter again) → October
    ]);
    let srv = await startServer({}, dir);
    await srv.stop();                                    // creates the refunds table
    const db = new DatabaseSync(path.join(dir, 'store.db'));
    const id = ref => db.prepare('SELECT id FROM orders WHERE ref = ?').get(ref).id;
    const refund = db.prepare('INSERT INTO refunds (order_id, amount_cents, created_at) VALUES (?, ?, ?)');
    refund.run(id('VN-W1'), 100, '2026-02-28 23:30:00');   // 1 Mar 00:30 Madrid → March
    refund.run(id('VN-S3'), 300, '2026-08-31 21:30:00');   // 31 Aug 23:30 Madrid → August
    db.close();

    srv = await startServer({}, dir);
    try {
      const month = async m => (await srv.admin('GET', FIN + '?month=' + m)).body.web;
      const pay = async m => (await month(m)).payments_cents, ref = async m => (await month(m)).refunds_cents;
      assert.deepStrictEqual([await pay('2026-01'), await pay('2026-02'), await pay('2026-03'), await pay('2026-04')], [1000, 2000, 4000, 8000]);
      assert.deepStrictEqual([await pay('2026-08'), await pay('2026-09'), await pay('2026-10'), await pay('2026-11')], [0, 16000, 32000, 0]);
      assert.deepStrictEqual([await ref('2026-02'), await ref('2026-03'), await ref('2026-08'), await ref('2026-09')], [0, 100, 300, 0]);

      // The CSV export shows the Madrid date and month too
      const apr = (await srv.admin('GET', FIN + '/export.csv?month=2026-04')).text;
      assert.ok(apr.includes('web_sale;2026-04-01;80,00;web;') && !apr.includes('VN-S1'), apr);
      const mar = (await srv.admin('GET', FIN + '/export.csv?month=2026-03')).text;
      assert.ok(mar.includes('web_refund;2026-03-01;1,00;') && mar.includes('web_sale;2026-03-31;40,00;'), mar);
    } finally { await srv.stop(); }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---------- Codex P2 (c4e78af): new and repeated entries default to the Madrid date ----------
test('the admin form defaults to today in Madrid, not the UTC day', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'admin.js'), 'utf8');
  const fn = src.match(/^function shopToday[\s\S]*?^\}\r?$/m);
  assert.ok(fn, 'shopToday not found in admin.js');
  const shopToday = new Function(fn[0] + '\nreturn shopToday;')();
  assert.strictEqual(shopToday(new Date('2026-07-31T22:30:00Z')), '2026-08-01', 'summer, 00:30 in Madrid');
  assert.strictEqual(shopToday(new Date('2026-07-31T21:59:59Z')), '2026-07-31');
  assert.strictEqual(shopToday(new Date('2026-01-31T23:30:00Z')), '2026-02-01', 'winter, 00:30 in Madrid');
  assert.strictEqual(shopToday(new Date('2026-01-31T22:59:59Z')), '2026-01-31');
  // The form, the copy action and the starting month all use it; no UTC day is left in the finance code
  const financeUi = src.slice(src.indexOf('/* ---------- Finans ---------- */'), src.indexOf('async function viewStats'));
  assert.doesNotMatch(financeUi, /\.toISOString\(\)/);
  assert.match(financeUi, /date: shopToday\(\)/);
  assert.match(financeUi, /value="\$\{esc\(e\.date \|\| shopToday\(\)\)\}"/);
  assert.match(financeUi, /let finMonth = shopToday\(\)\.slice\(0, 7\)/);
});

// Codex P2 (28fce02): formula-like text must survive export → import unchanged and not double
test('export → import round trip keeps formula-like text exactly and adds nothing', async () => {
  const srv = await startServer();
  try {
    const tricky = [
      { note: '=SUM(A1:A9)', party: '', reference: '' },
      { note: '-10% descuento', party: '+34 600 000 000', reference: '' },
      { note: '@tienda', party: '', reference: '=REF-1' },
      { note: "'ya entre comillas", party: "''dos", reference: '' },
      { note: 'normal', party: '', reference: '-F-77' },
    ];
    for (const [i, t] of tricky.entries())
      assert.strictEqual((await srv.admin('POST', FIN + '/entries', { kind: 'income', amount_cents: 1000 + i, category: 'amazon', date: '2026-10-11', ...t })).status, 200);
    const before = (await srv.admin('GET', FIN + '?month=2026-10')).body.entries;

    const csv = (await srv.admin('GET', FIN + '/export.csv?month=2026-10')).text;
    // still protected for spreadsheets: no cell starts with a formula character
    for (const line of csv.replace(/^﻿/, '').trim().split('\r\n').slice(1))
      for (const cell of line.split(';')) assert.doesNotMatch(cell.replace(/^"/, ''), /^[=+\-@]/, `unsafe cell in: ${line}`);
    assert.ok(csv.includes("'=SUM(A1:A9)") && csv.includes("'+34 600 000 000") && csv.includes("'=REF-1") && csv.includes("''ya entre comillas"));

    let r = await srv.admin('POST', FIN + '/import', { csv, dry_run: true });
    assert.deepStrictEqual([r.body.errors.length, r.body.add_count, r.body.duplicates.length], [0, 0, 5], JSON.stringify(r.body));
    r = await srv.admin('POST', FIN + '/import', { csv });
    assert.deepStrictEqual([r.status, r.body.saved], [200, 0]);
    assert.deepStrictEqual((await srv.admin('GET', FIN + '?month=2026-10')).body.entries, before, 'entries unchanged');

    // What the importer reads back is the original text
    const parsed = finance.readImport(csv, () => 0);
    assert.deepStrictEqual(parsed.add.map(a => [a.note, a.party, a.reference]).sort(), tricky.map(t => [t.note, t.party, t.reference]).sort());
  } finally { await srv.stop(); }
});

test('import: a leading apostrophe marks text; formulas without it are still refused', () => {
  const head = 'type;date;amount;category;note;reference\n';
  const ok = finance.readImport(head + "gelir;2026-10-01;5;amazon;'=1+2;'@ref", () => 0);
  assert.deepStrictEqual(ok.errors, []);
  assert.deepStrictEqual([ok.add[0].note, ok.add[0].reference], ['=1+2', '@ref']);
  for (const cell of ['=1+2', '+1', '-1+1', '@SUM(A1)', '=HYPERLINK("http://x.example.test")']) {
    const bad = finance.readImport(head + `gelir;2026-10-01;5;amazon;"${cell.replace(/"/g, '""')}";`, () => 0);
    assert.strictEqual(bad.errors.length, 1, cell);
    assert.match(bad.errors[0].msg, /Formül/);
  }
});

// Codex P2 (28fce02): "|" inside a field must not make two different rows look the same
test('duplicate keys are unambiguous when fields contain the old separator', async () => {
  const k = e => finance.entryKey({ kind: 'income', date: '2026-10-01', amount_cents: 500, category: 'amazon', country: '', reference: '', ...e });
  assert.notStrictEqual(k({ note: 'a|b', party: 'c' }), k({ note: 'a', party: 'b|c' }));
  assert.notStrictEqual(k({ note: 'a', party: '' }), k({ note: '', party: 'a' }));
  assert.strictEqual(k({ note: 'Xenon  D1S', party: 'ANA' }), k({ note: 'xenon d1s', party: 'ana' }), 'spaces/capitals still ignored');

  const srv = await startServer();
  try {
    await srv.admin('POST', FIN + '/entries', { kind: 'income', amount_cents: 500, category: 'amazon', date: '2026-10-01', note: 'a|b', party: 'c' });
    const r = await srv.admin('POST', FIN + '/import', { csv: 'type;date;amount;category;note;party\ngelir;2026-10-01;5;amazon;a;b|c' });
    assert.deepStrictEqual([r.status, r.body.saved, r.body.duplicates.length], [200, 1, 0]);
  } finally { await srv.stop(); }
});

// Codex P2 (28fce02): the monthly queries can use an index instead of scanning all history
test('orders.paid_at and refunds.created_at are indexed and used by the monthly report', async () => {
  const srv = await startServer();
  try {
    const db = new DatabaseSync(path.join(srv.dataDir, 'store.db'));
    try {
      const idx = db.prepare("SELECT name, tbl_name FROM sqlite_master WHERE type = 'index' AND name IN ('idx_orders_paid_at', 'idx_refunds_created') ORDER BY name").all();
      assert.deepStrictEqual(idx.map(i => [i.name, i.tbl_name]), [['idx_orders_paid_at', 'orders'], ['idx_refunds_created', 'refunds']]);
      const plan = sql => db.prepare('EXPLAIN QUERY PLAN ' + sql).all('2026-03-31 22:00:00', '2026-04-30 22:00:00').map(r => r.detail).join(' / ');
      assert.match(plan('SELECT COUNT(*), SUM(total_cents) FROM orders WHERE paid_at >= ? AND paid_at < ?'), /idx_orders_paid_at/);
      assert.match(plan('SELECT COUNT(*), SUM(amount_cents) FROM refunds WHERE created_at >= ? AND created_at < ?'), /idx_refunds_created/);
    } finally { db.close(); }
  } finally { await srv.stop(); }
});

// Gemini (PR #10) asked about sorting by the Madrid date in the CSV. Checked here: rows are ordered
// by the date the file shows (Madrid), so a payment at 00:30 on 1 April sits with the April rows.
test('CSV rows are in order of the Madrid date shown in the file', async () => {
  const dir = tempDir();
  try {
    oldDatabase(dir, [
      { ref: 'VN-APR1', status: 'delivered', total: 8000, created_at: '2026-03-31 22:30:00' },   // 1 Apr 00:30 Madrid
      { ref: 'VN-MAR31', status: 'delivered', total: 4000, created_at: '2026-03-31 21:00:00' },  // 31 Mar 23:00 Madrid
    ]);
    const srv = await startServer({}, dir);
    try {
      await srv.admin('POST', FIN + '/entries', entry({ date: '2026-04-01', category: 'gestor', amount_cents: 100 }));
      await srv.admin('POST', FIN + '/entries', entry({ date: '2026-03-31', category: 'storage', amount_cents: 200 }));
      await srv.admin('POST', FIN + '/entries', entry({ date: '2026-04-02', category: 'packaging', amount_cents: 300 }));
      const lines = (await srv.admin('GET', FIN + '/export.csv')).text.replace(/^﻿/, '').trim().split('\r\n').slice(1);
      const dates = lines.map(l => l.split(';')[2]);
      assert.deepStrictEqual(dates, [...dates].sort(), 'dates out of order: ' + dates.join(', '));
      const at = ref => lines.findIndex(l => l.endsWith(ref));
      assert.strictEqual(lines[at('VN-APR1')].split(';')[2], '2026-04-01');
      assert.ok(at('VN-MAR31') < at('VN-APR1'));
      assert.ok(lines.findIndex(l => l.includes('Depo')) < at('VN-APR1'), 'the 31 March expense comes before the 1 April payment');
      assert.ok(at('VN-APR1') < lines.findIndex(l => l.includes('Ambalaj')), 'and the 2 April expense after it');
    } finally { await srv.stop(); }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---------- Excel (.xlsx) export (manual test 2026-10-23: the ";" CSV opens in one column in English Excel) ----------
// Reads a stored (uncompressed) ZIP like the ones xlsx.js writes, checking each file's CRC
function unzipStored(buf) {
  const files = {};
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(end > 0, 'no ZIP end record');
  let p = buf.readUInt32LE(end + 16);
  for (let i = 0; i < buf.readUInt16LE(end + 10); i++) {
    assert.strictEqual(buf.readUInt32LE(p), 0x02014b50, 'central directory entry');
    const size = buf.readUInt32LE(p + 20), nameLen = buf.readUInt16LE(p + 28), off = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nameLen).toString('utf8');
    assert.strictEqual(buf.readUInt32LE(off), 0x04034b50, 'local header for ' + name);
    const start = off + 30 + buf.readUInt16LE(off + 26) + buf.readUInt16LE(off + 28);
    const data = buf.slice(start, start + size);
    assert.strictEqual(require('zlib').crc32(data), buf.readUInt32LE(p + 16), 'CRC of ' + name);
    files[name] = data.toString('utf8');
    p += 46 + nameLen + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
  }
  return files;
}

test('Excel export: a real .xlsx with numbers as numbers and text that can never be a formula', async () => {
  const dir = tempDir();
  try {
    oldDatabase(dir, [{ ref: 'VN-XL001', status: 'delivered', total: 4385, created_at: '2026-09-30 22:30:00' }]);   // 1 Oct 00:30 Madrid
    const srv = await startServer({}, dir);
    try {
      assert.strictEqual((await srv.call('GET', FIN + '/export.xlsx')).status, 401, 'admin only');
      await srv.admin('POST', FIN + '/entries', { kind: 'income', amount_cents: 125000, category: 'wholesale', date: '2026-10-07',
        note: 'Ekim — müşteri García & <Hijos>', party: 'Garage Test SARL', reference: 'F-1', country: 'FR' });
      await srv.admin('POST', FIN + '/entries', entry({ date: '2026-10-15', category: 'advertising', amount_cents: 2999, note: '=SUM(A1:A3)', party: '+34 Test' }));
      await srv.admin('POST', FIN + '/entries', entry({ date: '2026-11-02', amount_cents: 100 }));   // other month

      const r = await fetch(srv.base + FIN + '/export.xlsx?month=2026-10', { headers: { Cookie: srv.cookie } });
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.headers.get('content-type'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      assert.match(r.headers.get('content-disposition'), /filename="vornetic-finans-2026-10\.xlsx"/);
      const files = unzipStored(Buffer.from(await r.arrayBuffer()));
      assert.deepStrictEqual(Object.keys(files).sort(), ['[Content_Types].xml', '_rels/.rels', 'xl/_rels/workbook.xml.rels',
        'xl/styles.xml', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml']);
      const sheet = files['xl/worksheets/sheet1.xml'];
      assert.doesNotMatch(sheet, /<f[ >]/, 'no formulas anywhere');
      assert.match(sheet, /<c r="D2" s="1"><v>43\.85<\/v><\/c>/, 'web sale on 1 Oct (Madrid) as a number');
      assert.match(sheet, /<c r="D3" s="1"><v>1250<\/v><\/c>/, 'wholesale amount as a number');
      assert.match(sheet, /<t xml:space="preserve">2026-10-01<\/t>/, 'Madrid date as text');
      assert.match(sheet, /Ekim — müşteri García &amp; &lt;Hijos&gt;/, 'accents kept, XML escaped');
      assert.match(sheet, />'=SUM\(A1:A3\)</, 'formula-like note marked as text, same as the CSV');
      assert.match(sheet, />'\+34 Test</);
      assert.ok(!sheet.includes('2026-11-02'), 'only the chosen month');
      for (const h of ['id', 'type', 'date', 'amount_eur', 'category', 'note', 'country', 'party', 'reference'])
        assert.match(sheet, new RegExp(`<c r="[A-I]1" t="inlineStr" s="2"><is><t xml:space="preserve">${h}</t>`), 'header ' + h);
      assert.match(files['xl/workbook.xml'], /<sheet name="Finans 2026-10"/);
    } finally { await srv.stop(); }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a sheet saved from Excel as CSV (English or Spanish settings) imports without duplicates', async () => {
  const srv = await startServer();
  try {
    await srv.admin('POST', FIN + '/entries', { kind: 'income', amount_cents: 125000, category: 'wholesale', date: '2026-10-07', party: 'Garage Test SARL', reference: 'F-1', country: 'FR' });
    await srv.admin('POST', FIN + '/entries', entry({ date: '2026-10-15', category: 'advertising', amount_cents: 2999, note: '=SUM(A1:A3)' }));
    // What Excel writes for our .xlsx: English → "," and "1,250.00"; Spanish → ";" and "1.250,00"
    const english = 'id,type,date,amount_eur,category,note,country,party,reference\r\n'
      + '1,gelir,2026-10-07,"1,250.00",Toptan / doğrudan müşteri,,FR,Garage Test SARL,F-1\r\n'
      + "2,gider,2026-10-15,29.99,Reklam,'=SUM(A1:A3),,,\r\n,web_sale,2026-10-01,43.85,web,Web sitesi siparişi,ES,,VN-XL001\r\n";
    const spanish = 'id;type;date;amount_eur;category;note;country;party;reference\r\n'
      + '1;gelir;2026-10-07;1.250,00;Toptan / doğrudan müşteri;;FR;Garage Test SARL;F-1\r\n'
      + "2;gider;2026-10-15;29,99;Reklam;'=SUM(A1:A3);;;\r\n";
    for (const csv of [english, spanish]) {
      const r = await srv.admin('POST', FIN + '/import', { csv, dry_run: true });
      assert.deepStrictEqual([r.body.errors.length, r.body.add_count, r.body.duplicates.length], [0, 0, 2], JSON.stringify(r.body));
    }
  } finally { await srv.stop(); }
});

// Manual test 2026-10-23: Excel's plain "CSV (Comma delimited)" is Windows-1252, not UTF-8. Read as
// UTF-8 its accents became "�", the rows no longer matched the saved entries, and the preview
// offered to add 5 entries a second time. Fixtures are the files real Excel 16 saved (fake data).
const fixture = name => fs.readFileSync(path.join(__dirname, 'fixtures', name));

test('a CSV saved in the old Windows encoding is refused, so nothing is added twice', async () => {
  const ansi = fixture('excel-saved-ansi.csv');
  assert.notDeepStrictEqual([...ansi.slice(0, 3)], [0xef, 0xbb, 0xbf], 'fixture is the non-UTF-8 file');
  // The browser now refuses it before upload
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'admin.js'), 'utf8');
  const fn = src.match(/^function readUtf8[\s\S]*?^\}\r?$/m);
  assert.ok(fn, 'readUtf8 not found in admin.js');
  const readUtf8 = new Function(fn[0] + '\nreturn readUtf8;')();
  assert.strictEqual(readUtf8(ansi), null);
  assert.match(readUtf8(fixture('excel-saved-utf8.csv')), /müşteri García/);
  assert.match(src, /const csv = readUtf8\(await file\.arrayBuffer\(\)\);\s+if \(csv === null\)/);

  // And the server refuses text that was decoded with replacement characters
  const srv = await startServer();
  try {
    const r = await srv.admin('POST', FIN + '/import', { csv: ansi.toString('utf8') });
    assert.strictEqual(r.status, 400);
    assert.match(r.body.errors[0].msg, /UTF-8 değil.*CSV UTF-8/);
    assert.deepStrictEqual([r.body.saved, r.body.add_count], [0, 0]);
    const ok = await srv.admin('POST', FIN + '/import', { csv: fixture('excel-saved-utf8.csv').toString('utf8'), dry_run: true });
    assert.deepStrictEqual([ok.body.errors.length, ok.body.add_count, ok.body.ignored.length], [0, 9, 2]);
  } finally { await srv.stop(); }
});

test('a "?" inside a word (letters lost by Excel) gets a warning', () => {
  const r = finance.readImport('type;date;amount;category;note\ngider;2026-10-01;150;depo;Ekim depo kiras?\ngelir;2026-10-01;5;toptan;do?rudan\ngelir;2026-10-02;6;amazon;normal note', () => 0);
  assert.strictEqual(r.errors.length, 0);
  assert.strictEqual(r.add.length, 3);
  assert.ok(r.warnings.some(w => /^Satır 2, 3: kelime içinde "\?" var/.test(w)), r.warnings.join('\n'));
});

test('the admin page offers the Excel download and shows buyer and reference in the import preview', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'admin.js'), 'utf8');
  assert.match(src, /href="\/api\/admin\/finance\/export\.xlsx\?month=\$\{d\.month\}" download>\$\{L\('Excel indir \(bu ay\)', 'Descargar Excel \(este mes\)'\)\}/);
  assert.match(src, /<th>\$\{L\('Kişi \/ firma', 'Persona \/ empresa'\)\}<\/th><th>Ref<\/th>/);
  assert.match(src, /<td>\$\{esc\(x\.party\)\}<\/td><td>\$\{esc\(x\.reference\)\}<\/td>/);
});

test('import: missing columns, empty files and oversized batches are refused', async () => {
  const srv = await startServer();
  try {
    let r = await srv.admin('POST', FIN + '/import', { csv: 'date;amount;note\n2026-10-01;5;x' });
    assert.strictEqual(r.status, 400);
    assert.match(r.body.errors[0].msg, /Eksik sütun: kind, category/);
    r = await srv.admin('POST', FIN + '/import', { csv: '   ' });
    assert.strictEqual(r.status, 400);
    r = await srv.admin('POST', FIN + '/import', { csv: 'a;b\n"broken;1' });
    assert.strictEqual(r.status, 400);
    const many = ['type;date;amount;category', ...Array.from({ length: finance.MAX_IMPORT_ROWS + 1 }, (_, i) => `gider;2026-10-01;${i + 1};depo`)].join('\n');
    r = await srv.admin('POST', FIN + '/import', { csv: many });
    assert.strictEqual(r.status, 400);
    assert.match(r.body.errors[0].msg, /En fazla 500 satır/);
    assert.strictEqual((await srv.admin('GET', FIN + '?month=2026-10')).body.entries.length, 0);
  } finally { await srv.stop(); }
});
