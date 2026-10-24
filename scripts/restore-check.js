#!/usr/bin/env node
// scripts/restore-check.js — can this database backup be restored?
//   npm run restore-check -- path/to/store-2026-10-24T13.db
// Opens the file read-only (it is never changed), runs SQLite's integrity check, checks that the
// shop's tables are there and prints what it holds. Exit code 0 = usable, 1 = not usable, 2 = usage.
// Used by scripts/backup-offsite.sh before a backup leaves the server, and in the restore drill
// (README → Yedek).
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const REQUIRED = ['settings', 'categories', 'products', 'orders', 'refunds', 'users', 'withdrawals', 'finance_entries'];

function check(file) {
  if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) return { ok: false, problems: ['file not found: ' + (file || '(none given)')] };
  let db;
  try {
    db = new DatabaseSync(file, { readOnly: true });
    const integrity = db.prepare('PRAGMA integrity_check').all().map(r => Object.values(r)[0]);
    if (integrity.length !== 1 || integrity[0] !== 'ok') return { ok: false, problems: ['integrity check: ' + integrity.slice(0, 5).join('; ')] };
    const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(r => r.name));
    const missing = REQUIRED.filter(t => !tables.has(t));
    if (missing.length) return { ok: false, problems: ['missing tables: ' + missing.join(', ')] };
    const count = t => db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c;
    const last = db.prepare('SELECT MAX(created_at) t FROM orders').get().t;
    return { ok: true, problems: [], counts: { products: count('products'), orders: count('orders'), refunds: count('refunds'), users: count('users') }, last_order_at: last };
  } catch (e) {
    return { ok: false, problems: ['cannot read it as a database: ' + e.message] };
  } finally {
    try { db && db.close(); } catch { /* already closed */ }
  }
}

if (require.main === module) {
  const file = process.argv[2];
  if (!file) { console.error('Usage: npm run restore-check -- <backup .db file>'); process.exit(2); }
  const r = check(file);
  if (!r.ok) { console.error(`NOT USABLE: ${file}\n  ${r.problems.join('\n  ')}`); process.exit(1); }
  console.log(`OK: ${file}\n  products ${r.counts.products} · orders ${r.counts.orders} · refunds ${r.counts.refunds} · customers ${r.counts.users}` +
    `\n  newest order: ${r.last_order_at || '(none)'} (UTC)`);
}

module.exports = { check, REQUIRED };
