// db.js — SQLite database (built-in node:sqlite, no native dependencies)
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(path.join(DATA_DIR, 'store.db'));

db.exec(`
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE NOT NULL,
  category TEXT NOT NULL,              -- 'xenon' | 'led' | 'mats'
  name_en TEXT NOT NULL,
  name_es TEXT NOT NULL,
  desc_en TEXT DEFAULT '',
  desc_es TEXT DEFAULT '',
  price_cents INTEGER NOT NULL,
  old_price_cents INTEGER,
  image TEXT DEFAULT '',
  gallery TEXT DEFAULT '[]',           -- JSON array of extra image paths
  options TEXT DEFAULT '',             -- one option per line, see parseOptions()
  variants TEXT DEFAULT '',            -- optional price list per combination, see parseVariants()
  variant_images TEXT DEFAULT '',      -- optional photo per option value, see parseVariantImages()
  fitment TEXT DEFAULT 'universal',    -- 'universal' | 'car' (made for a specific car)
  stock INTEGER DEFAULT 50,
  active INTEGER DEFAULT 1,
  sort INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  pass_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  phone TEXT DEFAULT '',
  address TEXT DEFAULT '',
  city TEXT DEFAULT '',
  zip TEXT DEFAULT '',
  province TEXT DEFAULT '',
  country TEXT DEFAULT 'ES',
  car TEXT DEFAULT '',                 -- JSON {brand, model, gen, year, engine}
  lang TEXT DEFAULT 'es',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS user_sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ref TEXT UNIQUE NOT NULL,
  user_id INTEGER,
  customer_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT DEFAULT '',
  address TEXT NOT NULL,
  city TEXT NOT NULL,
  zip TEXT NOT NULL,
  province TEXT DEFAULT '',
  country TEXT DEFAULT 'ES',
  notes TEXT DEFAULT '',
  items TEXT NOT NULL,                 -- JSON [{id,name,qty,unit_cents,options,car}]
  subtotal_cents INTEGER NOT NULL,
  shipping_cents INTEGER NOT NULL,
  total_cents INTEGER NOT NULL,
  payment_method TEXT NOT NULL,        -- 'card' | 'bizum' | 'transfer' | 'contact'
  status TEXT DEFAULT 'pending',       -- pending | paid | shipped | delivered | cancelled
  tracking TEXT DEFAULT '',
  lang TEXT DEFAULT 'es',
  stripe_session TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_sessions (
  token TEXT PRIMARY KEY,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS product_views (
  product_id INTEGER NOT NULL,
  day TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_views ON product_views(product_id, day);

-- Right of withdrawal ("desistir del contrato aquí")
CREATE TABLE IF NOT EXISTS withdrawals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  message TEXT DEFAULT '',
  handled INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS password_resets (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  expires_at TEXT NOT NULL
);
`);

// Columns added after the first version (safe to run on every start)
for (const sql of [
  'ALTER TABLE orders ADD COLUMN user_id INTEGER',
  "ALTER TABLE products ADD COLUMN variants TEXT DEFAULT ''",
  "ALTER TABLE products ADD COLUMN variant_images TEXT DEFAULT ''",
  // Product safety information (EU General Product Safety Regulation)
  "ALTER TABLE products ADD COLUMN manufacturer TEXT DEFAULT ''",
  "ALTER TABLE products ADD COLUMN eu_responsible TEXT DEFAULT ''",
  "ALTER TABLE products ADD COLUMN safety_en TEXT DEFAULT ''",
  "ALTER TABLE products ADD COLUMN safety_es TEXT DEFAULT ''",
  // v2: structured options, variant photos/videos, coming-soon status (see catalog.js)
  "ALTER TABLE products ADD COLUMN opts TEXT DEFAULT ''",
  "ALTER TABLE products ADD COLUMN combos TEXT DEFAULT ''",
  "ALTER TABLE products ADD COLUMN media TEXT DEFAULT ''",
  "ALTER TABLE products ADD COLUMN status TEXT DEFAULT 'available'",
]) { try { db.exec(sql); } catch { /* already there */ } }
db.exec('CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id)');

// ---------- Default settings (editable from /admin → Settings) ----------
const DEFAULT_SETTINGS = {
  shop_email: 'info@vornetic.com',
  whatsapp: '34624619541',
  // Shipping: mainland Spain, Balearic Islands, Portugal (Canarias / Ceuta / Melilla are not served)
  ship_es_cents: '395',
  free_es_cents: '4000',     // free in mainland Spain from this subtotal (0 = never free)
  ship_ib_cents: '795',
  ship_pt_cents: '795',
  free_far_cents: '8000',    // free to Balearics / Portugal from this subtotal (0 = never free)
  ship_pt_on: '1',           // '0' = do not ship to Portugal
  bizum_phone: '',
  iban: '',
  iban_holder: '',
  company_name: 'Vornetic',
  company_nif: '',
  company_address: 'Madrid, España',
};
const insSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');

// One-time upgrade of shops created with the first shipping model (ES free / rest of EU 12.90)
const oldShip = db.prepare("SELECT value FROM settings WHERE key = 'ship_eu_cents'").get();
if (oldShip) {
  db.exec("DELETE FROM settings WHERE key IN ('ship_eu_cents', 'free_over_cents')");
  db.prepare("UPDATE settings SET value = '395' WHERE key = 'ship_es_cents' AND value = '0'").run();
}
for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) insSetting.run(k, v);
// Bulb list per car: first version comes from data/bulbs.txt, then it is edited in the admin panel
try { insSetting.run('bulbs_text', fs.readFileSync(path.join(__dirname, 'data', 'bulbs.txt'), 'utf8')); } catch {}

function getSettings() {
  const out = {};
  for (const r of db.prepare('SELECT key, value FROM settings').all()) out[r.key] = r.value;
  return out;
}

// ---------- Seed products (only on first run) ----------
const seed = require('./seed');
if (db.prepare('SELECT COUNT(*) AS c FROM products').get().c === 0) seed(db);

// Upgrades for catalogues created by an earlier version of seed.js
// (the EVO "old price" was an example value, not a real previous price — not allowed under EU rules)
db.prepare("UPDATE products SET old_price_cents = NULL WHERE slug = 'evo-custom-mats' AND old_price_cents = 6990").run();
for (const [slug, s] of Object.entries(seed.SAFETY)) {
  db.prepare("UPDATE products SET safety_en = ?, safety_es = ? WHERE slug = ? AND safety_en = '' AND safety_es = ''")
    .run(s.en, s.es, slug);
}

// Convert products from the first, text-based format (options / variants / variant_images / gallery)
{
  const { migrate } = require('./catalog');
  const legacy = { parseOptions, parseVariants, parseVariantImages };
  const upd = db.prepare('UPDATE products SET opts = ?, combos = ?, media = ?, price_cents = ?, status = ? WHERE id = ?');
  for (const row of db.prepare("SELECT * FROM products WHERE opts IS NULL OR opts = ''").all()) {
    const m = migrate(row, legacy);
    upd.run(m.opts, m.combos, m.media, m.price_cents, m.status, row.id);
  }
}

// ---------- Categories (managed in the admin panel) ----------
db.exec(`CREATE TABLE IF NOT EXISTS categories (
  slug TEXT PRIMARY KEY,
  name_en TEXT NOT NULL,
  name_es TEXT NOT NULL,
  desc_en TEXT DEFAULT '',
  desc_es TEXT DEFAULT '',
  image TEXT DEFAULT '',
  sort INTEGER DEFAULT 0,
  active INTEGER DEFAULT 1
)`);
if (db.prepare('SELECT COUNT(*) c FROM categories').get().c === 0) {
  const ins = db.prepare('INSERT INTO categories (slug, name_en, name_es, desc_en, desc_es, image, sort) VALUES (?,?,?,?,?,?,?)');
  ins.run('xenon', 'Xenon bulbs', 'Bombillas xenón',
    'D1S, D2S, D3S and more · 4 quality levels. The code is printed on your current bulb.',
    'D1S, D2S, D3S y más · 4 niveles de calidad. El código viene impreso en tu bombilla actual.',
    '/img/products/xenon-pro/g1.jpg', 1);
  ins.run('led', 'LED bulbs', 'Bombillas LED',
    'H1, H4, H7, H11, 9005, 9006 · 6000K pure white.', 'H1, H4, H7, H11, 9005, 9006 · 6000K blanco puro.',
    '/img/products/led-ake/main.jpg', 2);
  ins.run('mats', 'Car mats', 'Alfombrillas',
    'Universal mats and EVO mats made to measure for your car.', 'Alfombrillas universales y alfombrillas EVO a medida para tu coche.',
    '/img/products/mat-carpet/main.jpg', 3);
}

/**
 * Options text (one option per line):
 *   English name | Nombre español: value1, value2 +10, English / Español +5
 * "+N" adds N euros. "English / Español" gives a translated label.
 */
function parseOptions(text) {
  const out = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    const colon = line.indexOf(':');
    if (!line || colon < 1) continue;
    const [nameEn, nameEs] = splitLang(line.slice(0, colon), '|');
    const values = line.slice(colon + 1).split(',').map(v => v.trim()).filter(Boolean).map(v => {
      let delta = 0;
      const m = v.match(/\s\+\s?(\d+(?:[.,]\d{1,2})?)$/);
      if (m) { delta = Math.round(parseFloat(m[1].replace(',', '.')) * 100); v = v.slice(0, m.index).trim(); }
      const [en, es] = splitLang(v, ' / ');
      return { en, es, delta };
    });
    if (values.length) out.push({ en: nameEn, es: nameEs, values });
  }
  return out;
}
function splitLang(s, sep) {
  const i = s.indexOf(sep);
  if (i < 0) return [s.trim(), s.trim()];
  return [s.slice(0, i).trim(), s.slice(i + sep.length).trim()];
}

/**
 * Variants text: one sellable combination per line with its price.
 *   D1S, 4300K = 25
 *   D2S, 8000K = 9
 * Values are given in option order (English labels). Combinations that are not
 * listed cannot be bought. Returns { "D1S|4300K": 2500, ... } or null when empty.
 */
function parseVariants(text) {
  const map = {};
  let any = false;
  for (const raw of String(text || '').split(/\r?\n/)) {
    const m = raw.match(/^(.+?)=\s*(\d+(?:[.,]\d{1,2})?)\s*$/);
    if (!m) continue;
    const key = m[1].split(',').map(s => s.trim().toLowerCase()).filter(Boolean).join('|');
    map[key] = Math.round(parseFloat(m[2].replace(',', '.')) * 100);
    any = true;
  }
  return any ? map : null;
}

/**
 * Variant images: one per line, from the most general to the most specific.
 *   D2S = /img/products/xenon-plus/d2s-6000.jpg
 *   D2S, 8000K = /img/products/xenon-plus/d2s-8000.jpg
 */
function parseVariantImages(text) {
  const map = {};
  for (const raw of String(text || '').split(/\r?\n/)) {
    const i = raw.lastIndexOf('=');
    if (i < 1) continue;
    const key = raw.slice(0, i).split(',').map(s => s.trim().toLowerCase()).filter(Boolean).join('|');
    const img = raw.slice(i + 1).trim();
    if (key && img) map[key] = img;
  }
  return map;
}

// ---------- Passwords (scrypt, built into Node) ----------
function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  return salt + ':' + crypto.scryptSync(pw, salt, 64).toString('hex');
}
function checkPassword(pw, stored) {
  const [salt, hash] = String(stored || '').split(':');
  if (!salt || !hash) return false;
  const a = Buffer.from(hash, 'hex');
  const b = crypto.scryptSync(String(pw), salt, 64);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ---------- Car list (data/cars.txt) ----------
function loadCars() {
  const cars = {};
  let brand = null;
  const txt = fs.readFileSync(path.join(__dirname, 'data', 'cars.txt'), 'utf8');
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('# ')) { brand = line.slice(2).trim(); cars[brand] = cars[brand] || {}; continue; }
    if (line.startsWith('#') || !brand) continue;
    const [model, gen, years, engines = ''] = line.split('|').map(s => s.trim());
    const ym = (years || '').match(/^(\d{4})\s*-\s*(\d{4})$/);
    if (!model || !gen || !ym) continue;
    (cars[brand][model] = cars[brand][model] || []).push({
      gen, from: +ym[1], to: +ym[2],
      engines: engines.split(',').map(s => s.trim()).filter(Boolean),
    });
  }
  for (const b of Object.keys(cars)) if (!Object.keys(cars[b]).length) delete cars[b];
  return cars;
}

/**
 * Bulb list:  Brand | Model | Generation | low=H7, high=H1, fog=H11, xenon=D1S
 * Returns { map: { "Brand|Model|Gen": { low, high, fog, xenon } }, errors: [lineNumber, line, reason][] }
 * When `cars` is given, lines whose car is not in the car list are reported.
 */
const BULB_KEYS = ['low', 'high', 'fog', 'xenon'];
function parseBulbs(text, cars) {
  const map = {}, errors = [];
  String(text || '').split(/\r?\n/).forEach((raw, n) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    const parts = line.split('|').map(s => s.trim());
    if (parts.length !== 4) return errors.push([n + 1, line, 'format']);
    const [brand, model, gen, spec] = parts;
    if (cars && !(cars[brand]?.[model] || []).some(g => g.gen === gen)) return errors.push([n + 1, line, 'car']);
    const b = {};
    for (const kv of spec.split(',')) {
      const [k, v] = kv.split('=').map(s => (s || '').trim());
      if (!BULB_KEYS.includes(k.toLowerCase()) || !v) return errors.push([n + 1, line, 'key']);
      b[k.toLowerCase()] = v.toUpperCase();
    }
    map[`${brand}|${model}|${gen}`] = b;
  });
  return { map, errors };
}

const today = () => new Date().toISOString().slice(0, 10);

// ---------- Daily backup: data/backups/store-YYYY-MM-DD.db, keeps the last 14 ----------
function backup() {
  try {
    const dir = path.join(DATA_DIR, 'backups');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `store-${today()}.db`);
    if (!fs.existsSync(file)) db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
    const old = fs.readdirSync(dir).filter(f => /^store-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort().slice(0, -14);
    for (const f of old) fs.unlinkSync(path.join(dir, f));
  } catch (e) { console.error('Backup failed:', e.message); }
}

module.exports = {
  db, today, getSettings, parseOptions, parseVariants, parseVariantImages,
  hashPassword, checkPassword, loadCars, parseBulbs, backup, DATA_DIR,
};
