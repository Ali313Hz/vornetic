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
