// test/finance.test.js — the admin "Finans" tab (issue #5).
// Real server, throwaway database, fake data only (example.test, made-up amounts).
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { startServer, tempDir, oldDatabase } = require('./helpers');
const finance = require('../finance');

const thisMonth = () => new Date().toISOString().slice(0, 7);
const today = () => new Date().toISOString().slice(0, 10);
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

test('import: duplicates inside the file and against saved entries; references tell entries apart', async () => {
  const srv = await startServer();
  try {
    await srv.admin('POST', FIN + '/entries', { kind: 'income', amount_cents: 32000, category: 'wholesale', date: '2026-10-07', reference: 'F-1' });
    const csv = [
      'type;date;amount;source;reference',
      'gelir;2026-10-07;320;toptan;F-1',      // same as the saved one
      'gelir;2026-10-07;320;toptan;F-2',      // different invoice: a real second sale
      'gelir;2026-10-08;50;amazon;',
      'gelir;2026-10-08;50;amazon;',          // repeated line in the same file
    ].join('\n');
    const r = await srv.admin('POST', FIN + '/import', { csv });
    assert.deepStrictEqual([r.status, r.body.saved], [200, 2]);
    assert.deepStrictEqual(r.body.duplicates.map(d => d.line), [2, 5]);
    assert.deepStrictEqual(r.body.add.map(a => a.reference), ['F-2', '']);
  } finally { await srv.stop(); }
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
