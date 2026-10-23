// finance.js — the admin "Finans" tab (issue #5): a simple income / expense tracker.
//
// - Website money is never stored here. It is read from orders (by payment date) and refunds
//   (by refund date), so it can't be entered or imported twice.
// - Everything else (Amazon, Wallapop, Vinted, wholesale, storage, gestor, taxes…) is entered by
//   hand or imported from a CSV file, into the finance_entries table.
// - Amounts are EUR cents. This is a management estimate, not accounting or a tax return.

// ---------- Categories ----------
// For income the category is where the money came from; "website" is deliberately not one.
const CATEGORIES = {
  income: {
    amazon: 'Amazon', wallapop: 'Wallapop', vinted: 'Vinted',
    wholesale: 'Toptan / doğrudan müşteri', other: 'Diğer gelir',
  },
  expense: {
    storage: 'Depo / kira', stock: 'Stok / mal alımı', shipping: 'Kargo / lojistik', customs: 'Gümrük / ithalat',
    taxes: 'Vergi (IVA vb.)', gestor: 'Gestor / muhasebeci', platform_fees: 'Platform komisyonu',
    packaging: 'Ambalaj', advertising: 'Reklam', subscriptions: 'Abonelikler', other: 'Diğer gider',
  },
};
// Extra words accepted for each category when importing a CSV (Turkish, Spanish, English)
const CATEGORY_WORDS = {
  income: {
    amazon: ['amazon'], wallapop: ['wallapop'], vinted: ['vinted'],
    wholesale: ['toptan', 'wholesale', 'mayorista', 'b2b', 'dogrudan', 'direct', 'toptan / dogrudan musteri'],
    other: ['diger', 'diger gelir', 'other', 'otro', 'otros'],
  },
  expense: {
    storage: ['depo', 'kira', 'storage', 'warehouse', 'almacen', 'alquiler', 'depo / kira'],
    stock: ['stok', 'mal alimi', 'stock', 'inventory', 'purchase', 'purchases', 'compras', 'stok / mal alimi'],
    shipping: ['kargo', 'lojistik', 'shipping', 'logistics', 'envio', 'envios', 'kargo / lojistik'],
    customs: ['gumruk', 'ithalat', 'customs', 'import', 'aduana', 'gumruk / ithalat'],
    taxes: ['vergi', 'iva', 'tax', 'taxes', 'impuesto', 'impuestos', 'vergi (iva vb.)'],
    gestor: ['gestor', 'muhasebeci', 'accountant', 'gestoria', 'gestor / muhasebeci'],
    platform_fees: ['komisyon', 'platform komisyonu', 'fees', 'platform fees', 'comision', 'comisiones'],
    packaging: ['ambalaj', 'packaging', 'embalaje'],
    advertising: ['reklam', 'advertising', 'ads', 'publicidad', 'marketing'],
    subscriptions: ['abonelik', 'abonelikler', 'subscription', 'subscriptions', 'suscripcion', 'suscripciones'],
    other: ['diger', 'diger gider', 'other', 'otro', 'otros'],
  },
};
const KIND_WORDS = {
  income: ['income', 'gelir', 'ingreso', 'ingresos', 'sale', 'sales', 'satis', 'venta'],
  expense: ['expense', 'gider', 'gasto', 'gastos', 'cost', 'masraf'],
};
// Rows describing website orders (e.g. from our own export) are skipped on import:
// website money always comes from the orders themselves.
const WEB_WORDS = ['web', 'website', 'web_sale', 'web_refund', 'web satis', 'web iade', 'vornetic', 'vornetic.com', 'web sitesi', 'tienda online'];

// Lower-case, no accents, Turkish dotless i → i, single spaces (for matching words)
const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/ı/g, 'i').replace(/İ/g, 'i').toLowerCase().replace(/\s+/g, ' ').trim();

function categoryFromText(kind, text) {
  const t = norm(text);
  if (!t) return null;
  for (const [key, label] of Object.entries(CATEGORIES[kind])) {
    if (t === key || t === norm(label) || CATEGORY_WORDS[kind][key].includes(t)) return key;
  }
  return null;
}
function kindFromText(text) {
  const t = norm(text);
  return Object.keys(KIND_WORDS).find(k => KIND_WORDS[k].includes(t)) || null;
}

// ---------- Values ----------
// Amount text → cents. Accepted: "12", "12,5", "12.50", "1.234,56" (Spain/Turkey), "1,234.56",
// with or without "€"/"EUR". Anything else returns null — including "1.234", which could mean
// 1234 € or 1,234 €, so it is refused rather than guessed.
function parseAmount(text) {
  const s = String(text ?? '').replace(/€|eur/gi, '').replace(/[\s ]/g, '');
  const cents = (whole, frac = '') => Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  let m;
  if ((m = /^(\d{1,9})(?:[.,](\d{1,2}))?$/.exec(s))) return cents(m[1], m[2]);
  if ((m = /^(\d{1,3}(?:\.\d{3}){1,2}),(\d{1,2})$/.exec(s))) return cents(m[1].replace(/\./g, ''), m[2]);
  if ((m = /^(\d{1,3}(?:,\d{3}){1,2})\.(\d{1,2})$/.exec(s))) return cents(m[1].replace(/,/g, ''), m[2]);
  return null;
}

// "2026-10-23", "23/10/2026", "23.10.2026", "23-10-2026" → "2026-10-23" (a real date, 2000–2100) or null
function parseDate(text) {
  const s = String(text ?? '').trim();
  let y, m, d, r;
  if ((r = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s))) [, y, m, d] = r;
  else if ((r = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s))) [, d, m, y] = r;
  else return null;
  const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const dt = new Date(iso + 'T00:00:00Z');
  if (Number.isNaN(dt.getTime()) || dt.toISOString().slice(0, 10) !== iso) return null;
  if (+y < 2000 || +y > 2100) return null;
  return iso;
}

const MAX_CENTS = 100000000;     // 1,000,000 €: anything bigger is surely a typo
const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);

// Validate one entry from the admin form (amount already in cents). Throws a Turkish message.
function cleanEntry(b) {
  const kind = b.kind;
  if (!CATEGORIES[kind]) throw new Error('Tür "income" ya da "expense" olmalı');
  const date = parseDate(b.date);
  if (!date) throw new Error('Geçerli bir tarih gir (YYYY-AA-GG)');
  const amount = b.amount_cents;
  if (!Number.isInteger(amount) || amount <= 0 || amount > MAX_CENTS) throw new Error('Tutar 0,01 € ile 1.000.000 € arasında olmalı');
  if (!CATEGORIES[kind][b.category]) throw new Error('Kategori seç');
  const country = clean(b.country, 20).toUpperCase();      // checked before shortening: "ESP" is an error, not "ES"
  if (country && !/^[A-Z]{2}$/.test(country)) throw new Error('Ülke 2 harf olmalı (ör. ES, PT, FR)');
  return {
    kind, date, amount_cents: amount, category: b.category, country,
    note: clean(b.note, 300), party: clean(b.party, 120), reference: clean(b.reference, 60),
  };
}

// ---------- CSV ----------
// Our files use ";" (what Excel expects in Spain/Turkey), a UTF-8 BOM so Excel shows accents,
// and comma decimals. Text that starts like a formula gets a leading ' so Excel shows it as text.
const FORMULA_START = /^[=+\-@\t\r]/;
function csvCell(v) {
  let s = String(v ?? '');
  if (FORMULA_START.test(s)) s = "'" + s;
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const csvAmount = cents => (cents / 100).toFixed(2).replace('.', ',');
function toCsv(rows) {
  return '﻿' + rows.map(r => r.map(csvCell).join(';')).join('\r\n') + '\r\n';
}

// Reads CSV text with ";" "," or tab separators (whichever the header line uses) and "quotes"
function parseCsv(text) {
  const src = String(text ?? '').replace(/^﻿/, '');
  const firstLine = src.split(/\r?\n/, 1)[0];
  const count = ch => firstLine.split(ch).length - 1;
  const sep = [';', '\t', ','].sort((a, b) => count(b) - count(a))[0];
  const rows = [];
  let row = [], cell = '', quoted = false, line = 1, rowLine = 1;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else { if (c === '\n') line++; cell += c; }
    } else if (c === '"' && cell === '') quoted = true;
    else if (c === sep) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(cell); rows.push({ line: rowLine, cells: row });
      row = []; cell = ''; line++; rowLine = line;
    } else cell += c;
  }
  if (quoted) throw new Error('CSV bozuk: kapanmamış tırnak (")');
  if (cell !== '' || row.length) { row.push(cell); rows.push({ line: rowLine, cells: row }); }
  return rows;
}

// Column names we understand (Turkish, Spanish, English); anything else is ignored with a warning
const COLUMNS = {
  id: ['id'],
  kind: ['type', 'kind', 'tur', 'tip', 'islem', 'islem turu', 'gelir/gider', 'tipo'],
  date: ['date', 'tarih', 'fecha'],
  amount: ['amount', 'amount_eur', 'amount (eur)', 'tutar', 'tutar_eur', 'tutar (eur)', 'tutar eur', 'importe', 'eur', 'total'],
  currency: ['currency', 'para birimi', 'doviz', 'moneda'],
  category: ['category', 'kategori', 'categoria'],
  source: ['source', 'kaynak', 'kanal', 'channel', 'origen', 'canal', 'platform'],
  note: ['note', 'not', 'notes', 'description', 'aciklama', 'descripcion', 'concepto'],
  country: ['country', 'ulke', 'pais'],
  party: ['party', 'karsi taraf', 'buyer', 'alici', 'supplier', 'tedarikci', 'customer', 'musteri', 'firma', 'cliente', 'proveedor'],
  reference: ['reference', 'ref', 'referans', 'referencia', 'invoice', 'fatura', 'factura'],
};
const MAX_IMPORT_ROWS = 500;

// Turns uploaded CSV text into entries. Nothing is trusted: every row is validated, formula-like
// text is refused, website rows are skipped, and likely duplicates (same type, date, amount and
// category — unless both have different references) are skipped instead of counted twice.
// isDuplicate(entry) checks the database; rows earlier in the same file are checked here.
function readImport(text, isDuplicate) {
  const out = { add: [], duplicates: [], errors: [], ignored: [], warnings: [] };
  const rows = parseCsv(text).filter(r => r.cells.some(c => c.trim() !== ''));
  if (!rows.length) { out.errors.push({ line: 1, msg: 'Dosya boş' }); return out; }
  const header = rows.shift();
  const col = {};
  header.cells.forEach((h, i) => {
    const key = Object.keys(COLUMNS).find(k => COLUMNS[k].includes(norm(h)));
    if (key && col[key] === undefined) col[key] = i;
    else if (norm(h)) out.warnings.push(`"${clean(h, 40)}" sütunu tanınmadı, yok sayıldı`);
  });
  const missing = ['kind', 'date', 'amount'].filter(k => col[k] === undefined);
  if (col.category === undefined && col.source === undefined) missing.push('category');
  if (missing.length) {
    out.errors.push({ line: header.line, msg: `Eksik sütun: ${missing.join(', ')} (gerekli: type, date, amount, category)` });
    return out;
  }
  if (rows.length > MAX_IMPORT_ROWS) {
    out.errors.push({ line: header.line, msg: `En fazla ${MAX_IMPORT_ROWS} satır; dosyayı böl` });
    return out;
  }
  const seen = [];
  for (const { line, cells } of rows) {
    const get = k => (col[k] === undefined ? '' : String(cells[col[k]] ?? '').trim());
    const fail = msg => out.errors.push({ line, msg });
    const rawKind = get('kind');
    if (WEB_WORDS.includes(norm(rawKind)) || WEB_WORDS.includes(norm(get('source'))) || WEB_WORDS.includes(norm(get('category')))) {
      out.ignored.push({ line, reason: 'Web sitesi satırı: web satışları siparişlerden otomatik gelir' });
      continue;
    }
    const texts = ['note', 'party', 'reference', 'country', 'category', 'source'].map(get);
    if (texts.some(t => /^[=+\-@]/.test(t))) { fail('Formül gibi başlayan metin (=, +, -, @) kabul edilmez'); continue; }
    const kind = kindFromText(rawKind);
    if (!kind) { fail(`Tür anlaşılmadı: "${clean(rawKind, 30)}" (gelir / gider)`); continue; }
    const date = parseDate(get('date'));
    if (!date) { fail(`Tarih anlaşılmadı: "${clean(get('date'), 30)}" (YYYY-AA-GG veya GG/AA/YYYY)`); continue; }
    const amount = parseAmount(get('amount'));
    if (amount === null || amount <= 0 || amount > MAX_CENTS) { fail(`Tutar anlaşılmadı: "${clean(get('amount'), 30)}" (ör. 12,50)`); continue; }
    const cur = norm(get('currency'));
    if (cur && cur !== 'eur' && cur !== '€') { fail(`Sadece EUR destekleniyor (${clean(get('currency'), 10)})`); continue; }
    const catText = kind === 'income' && get('source') ? get('source') : (get('category') || get('source'));
    const category = categoryFromText(kind, catText);
    if (!category) { fail(`Kategori anlaşılmadı: "${clean(catText, 40)}"`); continue; }
    let entry;
    try {
      entry = cleanEntry({ kind, date, amount_cents: amount, category,
        note: get('note'), party: get('party'), reference: get('reference'), country: get('country') });
    } catch (e) { fail(e.message); continue; }
    const sameAs = e => e.kind === entry.kind && e.date === entry.date && e.amount_cents === entry.amount_cents
      && e.category === entry.category && !(e.reference && entry.reference && e.reference !== entry.reference);
    if (isDuplicate(entry) || seen.some(sameAs)) {
      out.duplicates.push({ line, reason: 'Aynı tür, tarih, tutar ve kategoride kayıt zaten var' });
      continue;
    }
    seen.push(entry);
    out.add.push({ line, ...entry });
  }
  return out;
}

// ---------- Months ----------
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const nextMonth = m => { const [y, mm] = m.split('-').map(Number); return mm === 12 ? `${y + 1}-01` : `${y}-${String(mm + 1).padStart(2, '0')}`; };
const prevMonth = m => { const [y, mm] = m.split('-').map(Number); return mm === 1 ? `${y - 1}-12` : `${y}-${String(mm - 1).padStart(2, '0')}`; };
const thisMonth = () => new Date().toISOString().slice(0, 7);

// ---------- Routes ----------
function register(app, { db, requireAdmin }) {
  const fin = '/api/admin/finance';
  const ENTRY_COLS = 'id, kind, date, amount_cents, category, note, party, reference, country, created_at, updated_at';

  // Money for one month ("YYYY-MM") or for everything (null). Website: payments by payment date,
  // refunds by refund date (a refund in October of a January sale lowers October).
  function totals(month) {
    const from = month ? month + '-01' : '0000-01-01', to = month ? nextMonth(month) + '-01' : '9999-12-31';
    const web = db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(total_cents), 0) total, COALESCE(SUM(shipping_cents), 0) shipping,
        COALESCE(SUM(paid_at_estimated), 0) estimated
      FROM orders WHERE paid_at >= ? AND paid_at < ?`).get(from, to);
    const refunds = db.prepare('SELECT COUNT(*) n, COALESCE(SUM(amount_cents), 0) total FROM refunds WHERE created_at >= ? AND created_at < ?').get(from, to);
    const manual = db.prepare(`SELECT kind, category, COUNT(*) n, SUM(amount_cents) total FROM finance_entries
      WHERE date >= ? AND date < ? GROUP BY kind, category ORDER BY total DESC`).all(from, to);
    const sum = kind => manual.filter(r => r.kind === kind).reduce((a, r) => a + r.total, 0);
    const webNet = web.total - refunds.total;
    const income = webNet + sum('income'), expenses = sum('expense');
    return {
      web: { orders: web.n, payments_cents: web.total, shipping_cents: web.shipping, refunds_cents: refunds.total,
        refunds: refunds.n, net_cents: webNet, estimated_dates: web.estimated },
      manual_income: manual.filter(r => r.kind === 'income').map(({ category, n, total }) => ({ category, n, total_cents: total })),
      expenses: manual.filter(r => r.kind === 'expense').map(({ category, n, total }) => ({ category, n, total_cents: total })),
      income_cents: income, expense_cents: expenses, balance_cents: income - expenses,
    };
  }

  app.get(fin, requireAdmin, (req, res) => {
    const month = MONTH_RE.test(req.query.month || '') ? req.query.month : thisMonth();
    const months = [];
    for (let m = month, i = 0; i < 12; i++, m = prevMonth(m)) {
      const t = totals(m);
      months.push({ month: m, income_cents: t.income_cents, expense_cents: t.expense_cents, balance_cents: t.balance_cents });
    }
    const one = sql => db.prepare(sql).get().c;
    res.json({
      month, categories: CATEGORIES, ...totals(month), months,
      entries: db.prepare(`SELECT ${ENTRY_COLS} FROM finance_entries WHERE date >= ? AND date < ? ORDER BY date DESC, id DESC`)
        .all(month + '-01', nextMonth(month) + '-01'),
      warnings: {
        payment_unknown: one('SELECT COUNT(*) c FROM orders WHERE payment_unknown = 1'),
        needs_refund: one(`SELECT COUNT(*) c FROM orders WHERE status = 'cancelled' AND paid_at IS NOT NULL
          AND (SELECT COALESCE(SUM(amount_cents), 0) FROM refunds r WHERE r.order_id = orders.id) < total_cents`),
      },
    });
  });

  // Same type, date, amount and category already saved (and not told apart by different references)
  const findDuplicate = (e, exceptId = 0) => db.prepare(`SELECT id FROM finance_entries
      WHERE kind = ? AND date = ? AND amount_cents = ? AND category = ? AND id != ?
        AND NOT (reference != '' AND ? != '' AND reference != ?) LIMIT 1`)
    .get(e.kind, e.date, e.amount_cents, e.category, exceptId, e.reference, e.reference);

  const save = (fn) => (req, res) => {
    try { fn(req, res); } catch (e) { res.status(400).json({ error: e.message }); }
  };
  const cols = ['kind', 'date', 'amount_cents', 'category', 'note', 'party', 'reference', 'country'];

  // possible_duplicate is only a warning on the form: two identical sales on one day can be real
  app.post(fin + '/entries', requireAdmin, save((req, res) => {
    const e = cleanEntry(req.body || {});
    const dup = findDuplicate(e);
    const info = db.prepare(`INSERT INTO finance_entries (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
      .run(...cols.map(c => e[c]));
    res.json({ ok: true, id: info.lastInsertRowid, possible_duplicate: !!dup });
  }));
  app.put(fin + '/entries/:id', requireAdmin, save((req, res) => {
    const old = db.prepare('SELECT id FROM finance_entries WHERE id = ?').get(req.params.id);
    if (!old) return res.status(404).json({ error: 'Not found' });
    const e = cleanEntry(req.body || {});
    db.prepare(`UPDATE finance_entries SET ${cols.map(c => c + ' = ?').join(', ')}, updated_at = datetime('now') WHERE id = ?`)
      .run(...cols.map(c => e[c]), old.id);
    res.json({ ok: true, possible_duplicate: !!findDuplicate(e, old.id) });
  }));
  app.delete(fin + '/entries/:id', requireAdmin, (req, res) => {
    const r = db.prepare('DELETE FROM finance_entries WHERE id = ?').run(req.params.id);
    if (!r.changes) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  });

  // CSV for Excel: manual entries plus website payments/refunds (marked web_sale / web_refund,
  // which the importer skips, so re-importing this file never doubles anything).
  app.get(fin + '/export.csv', requireAdmin, (req, res) => {
    const month = MONTH_RE.test(req.query.month || '') ? req.query.month : null;
    const from = month ? month + '-01' : '0000-01-01', to = month ? nextMonth(month) + '-01' : '9999-12-31';
    const label = (kind, cat) => CATEGORIES[kind]?.[cat] || cat;
    const rows = [['id', 'type', 'date', 'amount_eur', 'category', 'note', 'country', 'party', 'reference']];
    const list = [
      ...db.prepare(`SELECT ${ENTRY_COLS} FROM finance_entries WHERE date >= ? AND date < ?`).all(from, to)
        .map(e => ({ sort: e.date, row: [e.id, e.kind === 'income' ? 'gelir' : 'gider', e.date, csvAmount(e.amount_cents),
          label(e.kind, e.category), e.note, e.country, e.party, e.reference] })),
      ...db.prepare('SELECT ref, paid_at, total_cents, country FROM orders WHERE paid_at >= ? AND paid_at < ?').all(from, to)
        .map(o => ({ sort: o.paid_at.slice(0, 10), row: ['', 'web_sale', o.paid_at.slice(0, 10), csvAmount(o.total_cents),
          'web', 'Web sitesi siparişi', o.country, '', o.ref] })),
      ...db.prepare(`SELECT r.created_at, r.amount_cents, o.ref, o.country FROM refunds r JOIN orders o ON o.id = r.order_id
          WHERE r.created_at >= ? AND r.created_at < ?`).all(from, to)
        .map(r => ({ sort: r.created_at.slice(0, 10), row: ['', 'web_refund', r.created_at.slice(0, 10), csvAmount(r.amount_cents),
          'web', 'Web sitesi iadesi', r.country, '', r.ref] })),
    ].sort((a, b) => a.sort.localeCompare(b.sort));
    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="vornetic-finans-${month || 'tumu'}.csv"`,
      'Cache-Control': 'no-store',
    });
    res.send(toCsv(rows.concat(list.map(x => x.row))));
  });

  // Import: { csv: "...", dry_run: true } shows what would happen (nothing saved). Without
  // dry_run the rows are saved — but only if the whole file has no errors (all or nothing).
  app.post(fin + '/import', requireAdmin, (req, res) => {
    const b = req.body || {};
    if (typeof b.csv !== 'string' || !b.csv.trim()) return res.status(400).json({ error: 'CSV dosyası boş' });
    let result;
    try { result = readImport(b.csv, e => !!findDuplicate(e)); }
    catch (e) { return res.status(400).json({ error: e.message }); }
    const summary = { ...result, add_count: result.add.length };
    if (b.dry_run || result.errors.length) return res.status(result.errors.length && !b.dry_run ? 400 : 200).json({ ok: !result.errors.length, saved: 0, ...summary });
    const ins = db.prepare(`INSERT INTO finance_entries (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`);
    db.exec('BEGIN IMMEDIATE');
    try { for (const e of result.add) ins.run(...cols.map(c => e[c])); db.exec('COMMIT'); }
    catch (e) { db.exec('ROLLBACK'); return res.status(500).json({ error: 'İçe aktarma başarısız; hiçbir satır kaydedilmedi' }); }
    res.json({ ok: true, saved: result.add.length, ...summary });
  });
}

module.exports = { CATEGORIES, parseAmount, parseDate, cleanEntry, parseCsv, toCsv, csvCell, readImport, register, MAX_IMPORT_ROWS };
