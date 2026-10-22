// server.js — Vornetic online store
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const cookieParser = require('cookie-parser');
const {
  db, today, getSettings,
  hashPassword, checkPassword, loadCars, parseBulbs, backup, DATA_DIR,
} = require('./db');
const mail = require('./mail');
const catalog = require('./catalog');

const app = express();
const PORT = process.env.PORT || 3300;
const DEFAULT_ADMIN_PASSWORD = 'vornetic2026';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || DEFAULT_ADMIN_PASSWORD;
const STRIPE_KEY = process.env.STRIPE_SECRET_KEY || '';
const PUBLIC_URL = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
const IS_PROD = process.env.NODE_ENV === 'production';

// The default password is public (README, source). In production it never unlocks the panel.
const ADMIN_LOCKED = IS_PROD && ADMIN_PASSWORD === DEFAULT_ADMIN_PASSWORD;
if (ADMIN_LOCKED) console.error('✖  Admin login disabled: set a strong ADMIN_PASSWORD in .env (the default one is not allowed in production).');
else if (ADMIN_PASSWORD === DEFAULT_ADMIN_PASSWORD) console.warn('⚠  Using the default admin password. Set ADMIN_PASSWORD before going live.');

const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const CARS = loadCars();

const categoryExists = slug => !!db.prepare('SELECT 1 FROM categories WHERE slug = ?').get(slug);
const ALL_COUNTRIES = ['ES', 'PT'];
const countries = s => ALL_COUNTRIES.filter(c => c !== 'PT' || s.ship_pt_on !== '0');
const STATUSES = ['pending', 'paid', 'shipped', 'delivered', 'cancelled'];

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
  });
  next();
});
app.use(express.json({ limit: '200kb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public'), { index: false, maxAge: IS_PROD ? '1h' : 0 }));
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '7d' }));

// ---------- Uploads (photos and videos, admin only) ----------
const IMG_EXT = ['.jpg', '.jpeg', '.png', '.webp'];
const VID_EXT = ['.mp4', '.webm'];
const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) =>
      cb(null, crypto.randomBytes(8).toString('hex') + path.extname(file.originalname).toLowerCase()),
  }),
  limits: { fileSize: 80 * 1024 * 1024, files: 20 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const ok = IMG_EXT.includes(ext) || VID_EXT.includes(ext);
    cb(ok ? null : new Error('Sadece JPG, PNG, WEBP fotoğraf veya MP4, WEBM video'), ok);
  },
});

// ---------- Tiny rate limiter ----------
const hits = new Map();
function limit(max, windowMs) {
  return (req, res, next) => {
    // Express routing ignores case and a trailing slash, so the key must too
    const key = (req.path.toLowerCase().replace(/\/+$/, '') || '/') + '|' + req.ip;
    const now = Date.now();
    const arr = (hits.get(key) || []).filter(t => now - t < windowMs);
    if (arr.length >= max) return res.status(429).json({ error: 'Too many requests, try again later' });
    arr.push(now);
    hits.set(key, arr);
    next();
  };
}

// ---------- Helpers ----------
const str = (v, max = 200) => String(v ?? '').trim().slice(0, max);
const newRef = () => 'VN-' + crypto.randomBytes(3).toString('hex').toUpperCase();
const isEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

const publicProduct = catalog.publicProduct;

// Shipping zone from country + postcode: 'es' mainland, 'ib' Balearics, 'pt' Portugal, or null (not served)
function shipZone(country, zip) {
  const z = String(zip || '').replace(/\s/g, '');
  if (country === 'PT') return /^\d{4}-?\d{3}$/.test(z) ? 'pt' : null;
  if (country !== 'ES' || !/^\d{5}$/.test(z)) return null;
  const p = z.slice(0, 2);
  if (['35', '38', '51', '52'].includes(p)) return null;   // Canarias, Ceuta, Melilla
  return p === '07' ? 'ib' : 'es';
}
function shippingFor(zone, subtotal, s) {
  const n = k => Number(s[k]) || 0;
  if (zone === 'es') return n('free_es_cents') && subtotal >= n('free_es_cents') ? 0 : n('ship_es_cents');
  const fee = zone === 'ib' ? n('ship_ib_cents') : n('ship_pt_cents');
  return n('free_far_cents') && subtotal >= n('free_far_cents') ? 0 : fee;
}
const baseUrl = req => PUBLIC_URL || `${req.protocol}://${req.get('host')}`;

// Validate a car chosen in the store against data/cars.txt
function cleanCar(c) {
  if (!c || typeof c !== 'object') return null;
  const brand = str(c.brand, 60), model = str(c.model, 80), gen = str(c.gen, 60);
  const year = parseInt(c.year, 10), engine = str(c.engine, 60);
  const g = (CARS[brand]?.[model] || []).find(x => x.gen === gen);
  if (!g || !(year >= g.from && year <= g.to)) return null;
  if (engine && g.engines.length && !g.engines.includes(engine)) return null;
  return { brand, model, gen, year, engine };
}
const carLabel = c => `${c.brand} ${c.model} ${c.gen} · ${c.year}${c.engine ? ' · ' + c.engine : ''}`;

// ---------- Customer sessions ----------
const userCookie = { httpOnly: true, sameSite: 'lax', secure: IS_PROD, maxAge: 60 * 24 * 3600 * 1000 };
function currentUser(req) {
  const t = req.cookies.vs;
  if (!t) return null;
  const s = db.prepare("SELECT user_id FROM user_sessions WHERE token = ? AND created_at > datetime('now','-60 day')").get(t);
  return s ? db.prepare('SELECT * FROM users WHERE id = ?').get(s.user_id) || null : null;
}
function requireUser(req, res, next) {
  const u = currentUser(req);
  if (!u) return res.status(401).json({ error: 'Please log in' });
  req.user = u;
  next();
}
function startSession(res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO user_sessions (token, user_id) VALUES (?, ?)').run(token, userId);
  res.cookie('vs', token, userCookie);
}
function publicUser(u) {
  let car = null;
  try { car = u.car ? JSON.parse(u.car) : null; } catch {}
  return {
    id: u.id, email: u.email, name: u.name, phone: u.phone, address: u.address, city: u.city,
    zip: u.zip, province: u.province, country: u.country, car, created_at: u.created_at,
  };
}

// ============================================================
// STORE (public)
// ============================================================
app.get('/api/config', (req, res) => {
  const s = getSettings();
  res.json({
    whatsapp: s.whatsapp, email: s.shop_email,
    shipping: {
      es: Number(s.ship_es_cents), free_es: Number(s.free_es_cents),
      ib: Number(s.ship_ib_cents), pt: Number(s.ship_pt_cents), free_far: Number(s.free_far_cents),
    },
    payments: availablePayments(s),
    company: { name: s.company_name, nif: s.company_nif, address: s.company_address },
    countries: countries(s),
    mail: mail.enabled,
  });
});

app.get('/api/cars', (req, res) => res.json(CARS));
app.get('/api/bulbs', (req, res) => res.json(parseBulbs(getSettings().bulbs_text, CARS).map));

const VISIBLE = "status != 'hidden'";
app.get('/api/categories', (req, res) => {
  res.json(db.prepare('SELECT slug, name_en, name_es, desc_en, desc_es, image FROM categories WHERE active = 1 ORDER BY sort, slug').all()
    .map(c => ({ slug: c.slug, name: { en: c.name_en, es: c.name_es }, desc: { en: c.desc_en, es: c.desc_es }, image: c.image })));
});

app.get('/api/products', (req, res) => {
  res.json(db.prepare(`SELECT * FROM products WHERE ${VISIBLE} ORDER BY sort, id`).all().map(publicProduct));
});

app.get('/api/products/:slug', (req, res) => {
  const p = db.prepare(`SELECT * FROM products WHERE slug = ? AND ${VISIBLE}`).get(req.params.slug);
  if (!p) return res.status(404).json({ error: 'Not found' });
  db.prepare('INSERT INTO product_views (product_id, day) VALUES (?, ?)').run(p.id, today());
  res.json(publicProduct(p));
});

// ---------- Customer accounts ----------
app.post('/api/account/register', limit(10, 30 * 60 * 1000), (req, res) => {
  const b = req.body || {};
  const email = str(b.email, 160).toLowerCase(), name = str(b.name, 120), pw = String(b.password || '');
  if (!name) return res.status(400).json({ error: 'name' });
  if (!isEmail(email)) return res.status(400).json({ error: 'email' });
  if (pw.length < 8 || pw.length > 200) return res.status(400).json({ error: 'password_short' });
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) return res.status(409).json({ error: 'email_taken' });
  const info = db.prepare('INSERT INTO users (email, pass_hash, name, lang) VALUES (?, ?, ?, ?)')
    .run(email, hashPassword(pw), name, b.lang === 'en' ? 'en' : 'es');
  startSession(res, info.lastInsertRowid);
  res.json({ ok: true, user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid)) });
});

app.post('/api/account/login', limit(10, 15 * 60 * 1000), (req, res) => {
  const b = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE email = ?').get(str(b.email, 160).toLowerCase());
  if (!u || !checkPassword(b.password || '', u.pass_hash)) return res.status(401).json({ error: 'bad_login' });
  startSession(res, u.id);
  res.json({ ok: true, user: publicUser(u) });
});

app.post('/api/account/logout', (req, res) => {
  if (req.cookies.vs) db.prepare('DELETE FROM user_sessions WHERE token = ?').run(req.cookies.vs);
  res.clearCookie('vs');
  res.json({ ok: true });
});

app.get('/api/account/me', (req, res) => {
  const u = currentUser(req);
  res.json({ user: u ? publicUser(u) : null });
});

app.put('/api/account/me', requireUser, (req, res) => {
  const b = req.body || {};
  const u = req.user;
  const next = {
    name: b.name !== undefined ? str(b.name, 120) || u.name : u.name,
    phone: b.phone !== undefined ? str(b.phone, 40) : u.phone,
    address: b.address !== undefined ? str(b.address, 250) : u.address,
    city: b.city !== undefined ? str(b.city, 100) : u.city,
    zip: b.zip !== undefined ? str(b.zip, 20) : u.zip,
    province: b.province !== undefined ? str(b.province, 100) : u.province,
    country: ALL_COUNTRIES.includes(b.country) ? b.country : u.country,
    car: b.car !== undefined ? (b.car ? JSON.stringify(cleanCar(b.car) || null) : '') : u.car,
  };
  if (next.car === 'null') next.car = '';
  db.prepare('UPDATE users SET name=?, phone=?, address=?, city=?, zip=?, province=?, country=?, car=? WHERE id=?')
    .run(next.name, next.phone, next.address, next.city, next.zip, next.province, next.country, next.car, u.id);
  res.json({ ok: true, user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(u.id)) });
});

app.put('/api/account/password', requireUser, limit(10, 15 * 60 * 1000), (req, res) => {
  const { current, password } = req.body || {};
  if (!checkPassword(current || '', req.user.pass_hash)) return res.status(400).json({ error: 'bad_password' });
  if (String(password || '').length < 8) return res.status(400).json({ error: 'password_short' });
  db.prepare('UPDATE users SET pass_hash = ? WHERE id = ?').run(hashPassword(String(password)), req.user.id);
  // log out other devices
  db.prepare('DELETE FROM user_sessions WHERE user_id = ? AND token != ?').run(req.user.id, req.cookies.vs);
  res.json({ ok: true });
});

// Password reset by e-mail (link valid 1 hour)
const sha = t => crypto.createHash('sha256').update(t).digest('hex');
app.post('/api/account/forgot', limit(5, 30 * 60 * 1000), async (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE email = ?').get(str((req.body || {}).email, 160).toLowerCase());
  if (u && mail.enabled) {
    const token = crypto.randomBytes(32).toString('hex');
    db.prepare("DELETE FROM password_resets WHERE user_id = ? OR expires_at < datetime('now')").run(u.id);
    db.prepare("INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES (?, ?, datetime('now', '+1 hour'))").run(sha(token), u.id);
    await mail.passwordReset(u.email, (req.body || {}).lang || u.lang, `${baseUrl(req)}/account/reset?token=${token}`, getSettings());
  }
  // Same answer whether the account exists or not
  res.json({ ok: true, mail: mail.enabled });
});
app.post('/api/account/reset', limit(10, 30 * 60 * 1000), (req, res) => {
  const { token, password } = req.body || {};
  if (String(password || '').length < 8) return res.status(400).json({ error: 'password_short' });
  const r = db.prepare("SELECT * FROM password_resets WHERE token_hash = ? AND expires_at > datetime('now')").get(sha(String(token || '')));
  if (!r) return res.status(400).json({ error: 'bad_token' });
  db.prepare('UPDATE users SET pass_hash = ? WHERE id = ?').run(hashPassword(String(password)), r.user_id);
  db.prepare('DELETE FROM password_resets WHERE user_id = ?').run(r.user_id);
  db.prepare('DELETE FROM user_sessions WHERE user_id = ?').run(r.user_id);
  startSession(res, r.user_id);
  res.json({ ok: true, user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(r.user_id)) });
});

app.get('/api/account/orders', requireUser, (req, res) => {
  const rows = db.prepare(`SELECT ref, items, subtotal_cents, shipping_cents, total_cents, payment_method, status,
      tracking, created_at, address, city, zip, country FROM orders WHERE user_id = ? ORDER BY id DESC`).all(req.user.id);
  res.json(rows.map(o => ({ ...o, items: JSON.parse(o.items).map(({ options_idx, ...i }) => i) })));
});

// ---------- Orders ----------
// Validate a cart line and return a clean copy with the server-side price
function cleanLine(it) {
  const p = db.prepare("SELECT * FROM products WHERE id = ? AND status = 'available'").get(Number(it.id));
  if (!p) throw new Error('A product in your cart is no longer available');
  if (p.stock <= 0) throw new Error(`Out of stock: ${p.name_en}`);
  const qty = Math.min(10, Math.max(1, parseInt(it.qty, 10) || 1));
  const { unit, labels, labelsEs } = catalog.priceForSelection(p, it.options || {});
  let car = null;
  if (p.fitment === 'car') {
    const c = cleanCar(it.car);
    if (!c) throw new Error('Please choose your car for ' + p.name_en);
    car = carLabel(c);
  }
  return { id: p.id, name: p.name_en, name_es: p.name_es, qty, unit_cents: unit, options: labels, options_es: labelsEs, car };
}

app.post('/api/orders', limit(10, 10 * 60 * 1000), async (req, res) => {
  const b = req.body || {};
  const s = getSettings();
  const user = currentUser(req);
  try {
    const name = str(b.customer_name, 120), email = str(b.email, 160), phone = str(b.phone, 40);
    const address = str(b.address, 250), city = str(b.city, 100), zip = str(b.zip, 20), province = str(b.province, 100);
    const country = countries(s).includes(b.country) ? b.country : 'ES';
    const lang = b.lang === 'en' ? 'en' : 'es';
    if (!name || !address || !city || !zip || !phone) throw new Error('Please fill in all required fields');
    if (!isEmail(email)) throw new Error('Invalid email');
    if (!Array.isArray(b.items) || !b.items.length || b.items.length > 30) throw new Error('Your cart is empty');
    const zone = shipZone(country, zip);
    if (!zone) throw new Error('no_shipping');

    const method = b.payment_method;
    if (!availablePayments(s)[method]) throw new Error('Payment method not available');

    const items = b.items.map(cleanLine);
    const subtotal = items.reduce((a, i) => a + i.unit_cents * i.qty, 0);
    const shipping = shippingFor(zone, subtotal, s);
    const total = subtotal + shipping;
    const ref = newRef();

    const info = db.prepare(`INSERT INTO orders
      (ref, user_id, customer_name, email, phone, address, city, zip, province, country, notes, items,
       subtotal_cents, shipping_cents, total_cents, payment_method, lang)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(ref, user ? user.id : null, name, email, phone, address, city, zip, province, country, str(b.notes, 500),
        JSON.stringify(items), subtotal, shipping, total, method, lang);
    const dec = db.prepare('UPDATE products SET stock = MAX(0, stock - ?) WHERE id = ?');
    for (const i of items) dec.run(i.qty, i.id);

    // Remember the address on the customer's account if they have none yet
    if (user && !user.address) {
      db.prepare('UPDATE users SET phone = COALESCE(NULLIF(phone, \'\'), ?), address=?, city=?, zip=?, province=?, country=? WHERE id=?')
        .run(phone, address, city, zip, province, country, user.id);
    }

    if (method === 'card') {
      const session = await stripeCheckout({ ref, email, lang, items, shipping, base: baseUrl(req) });
      db.prepare('UPDATE orders SET stripe_session = ? WHERE id = ?').run(session.id, info.lastInsertRowid);
      return res.json({ ok: true, ref, redirect: session.url });   // e-mails are sent once the card payment is confirmed
    }
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(info.lastInsertRowid);
    mail.orderConfirmation(order, s, baseUrl(req));
    mail.shopNewOrder(order, s, baseUrl(req));
    res.json({ ok: true, ref, total_cents: total, payment_method: method, ...paymentInfo(s, method) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// 'contact' = no payment set up yet: take the order and arrange payment by email/WhatsApp
function availablePayments(s) {
  const p = { card: !!STRIPE_KEY, bizum: !!s.bizum_phone, transfer: !!s.iban };
  p.contact = !p.card && !p.bizum && !p.transfer;
  return p;
}
function paymentInfo(s, method) {
  if (method === 'bizum') return { bizum_phone: s.bizum_phone };
  if (method === 'transfer') return { iban: s.iban, iban_holder: s.iban_holder };
  return {};
}

// Return page after Stripe: confirm the payment with Stripe and mark the order paid
app.post('/api/orders/confirm', limit(30, 10 * 60 * 1000), async (req, res) => {
  const { ref, session_id } = req.body || {};
  const o = db.prepare('SELECT * FROM orders WHERE ref = ? AND stripe_session = ?').get(str(ref, 20), str(session_id, 200));
  if (!o) return res.status(404).json({ error: 'Order not found' });
  try {
    if (o.status === 'pending') {
      const sess = await stripe('GET', `/v1/checkout/sessions/${encodeURIComponent(o.stripe_session)}`);
      if (sess.payment_status === 'paid') {
        db.prepare("UPDATE orders SET status = 'paid' WHERE id = ?").run(o.id);
        o.status = 'paid';
        const s = getSettings();
        mail.orderConfirmation(o, s, baseUrl(req));
        mail.shopNewOrder(o, s, baseUrl(req));
      }
    }
    res.json({ ok: true, ref: o.ref, status: o.status, total_cents: o.total_cents, payment_method: 'card' });
  } catch (e) {
    res.status(502).json({ error: 'Could not verify payment' });
  }
});

// ---------- Right of withdrawal ("Withdraw from contract here") ----------
app.post('/api/withdraw', limit(10, 30 * 60 * 1000), (req, res) => {
  const b = req.body || {};
  const ref = str(b.ref, 20).toUpperCase(), email = str(b.email, 160).toLowerCase(), name = str(b.name, 120);
  if (!ref || !name || !isEmail(email)) return res.status(400).json({ error: 'withdraw_fields' });
  const o = db.prepare('SELECT * FROM orders WHERE ref = ? AND lower(email) = ?').get(ref, email);
  if (!o) return res.status(404).json({ error: 'withdraw_not_found' });
  const info = db.prepare('INSERT INTO withdrawals (order_id, name, email, message) VALUES (?, ?, ?, ?)')
    .run(o.id, name, email, str(b.message, 1000));
  const w = db.prepare('SELECT * FROM withdrawals WHERE id = ?').get(info.lastInsertRowid);
  const s = getSettings();
  mail.withdrawalAck(w, o, s);
  mail.shopWithdrawal(w, o, s, baseUrl(req));
  res.json({ ok: true, ref: o.ref, at: w.created_at, mail: mail.enabled });
});

// ---------- Stripe (REST, no SDK) ----------
async function stripe(method, url, params) {
  const r = await fetch('https://api.stripe.com' + url, {
    method,
    headers: { Authorization: `Bearer ${STRIPE_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params ? new URLSearchParams(params).toString() : undefined,
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error?.message || 'Stripe error');
  return data;
}
function stripeCheckout({ ref, email, lang, items, shipping, base }) {
  const p = {
    mode: 'payment',
    customer_email: email,
    client_reference_id: ref,
    locale: lang,
    success_url: `${base}/checkout/success?ref=${ref}&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${base}/checkout?cancelled=1`,
    'metadata[ref]': ref,
  };
  const lines = items.map(i => ({
    name: i.name + (i.car ? ` — ${i.car}` : ''),
    desc: i.options.join(' · '),
    amount: i.unit_cents, qty: i.qty,
  }));
  if (shipping) lines.push({ name: lang === 'es' ? 'Envío' : 'Shipping', amount: shipping, qty: 1 });
  lines.forEach((l, n) => {
    p[`line_items[${n}][quantity]`] = l.qty;
    p[`line_items[${n}][price_data][currency]`] = 'eur';
    p[`line_items[${n}][price_data][unit_amount]`] = l.amount;
    p[`line_items[${n}][price_data][product_data][name]`] = l.name;
    if (l.desc) p[`line_items[${n}][price_data][product_data][description]`] = l.desc;
  });
  return stripe('POST', '/v1/checkout/sessions', p);
}

// ============================================================
// ADMIN
// ============================================================
const adminCookie = { httpOnly: true, sameSite: 'strict', secure: IS_PROD, maxAge: 14 * 24 * 3600 * 1000 };

// Every successful start logs all admins out (see app.listen below). A session issued before
// a deploy or under an earlier ADMIN_PASSWORD (e.g. the public default) can never outlive the
// process that issued it, and nothing derived from the password is stored.
const revokeAdminSessions = () => db.exec('DELETE FROM admin_sessions');

function requireAdmin(req, res, next) {
  const t = req.cookies.admin;
  const s = !ADMIN_LOCKED && t && db.prepare(
    "SELECT * FROM admin_sessions WHERE token = ? AND created_at > datetime('now','-14 day')").get(t);
  if (!s) return res.status(401).json({ error: 'Not authorised' });
  next();
}

app.post('/api/admin/login', limit(8, 15 * 60 * 1000), (req, res) => {
  if (ADMIN_LOCKED) return res.status(503).json({ error: 'Admin login disabled: set ADMIN_PASSWORD on the server' });
  // Compare fixed-length digests so the check does not reveal the password length
  const digest = v => crypto.createHash('sha256').update(String(v)).digest();
  if (!crypto.timingSafeEqual(digest((req.body || {}).password || ''), digest(ADMIN_PASSWORD)))
    return res.status(401).json({ error: 'Wrong password' });
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO admin_sessions (token) VALUES (?)').run(token);
  res.cookie('admin', token, adminCookie);
  res.json({ ok: true });
});
app.post('/api/admin/logout', (req, res) => {
  if (req.cookies.admin) db.prepare('DELETE FROM admin_sessions WHERE token = ?').run(req.cookies.admin);
  res.clearCookie('admin');
  res.json({ ok: true });
});
app.get('/api/admin/me', requireAdmin, (req, res) => res.json({
  ok: true, stripe: !!STRIPE_KEY, mail: mail.enabled,
  open_withdrawals: db.prepare('SELECT COUNT(*) c FROM withdrawals WHERE handled = 0').get().c,
}));
app.post('/api/admin/test-mail', requireAdmin, async (req, res) => {
  if (!mail.enabled) return res.status(400).json({ error: 'E-posta ayarlı değil (SMTP_* ortam değişkenleri)' });
  const ok = await mail.test(getSettings());
  ok ? res.json({ ok: true }) : res.status(502).json({ error: 'Gönderilemedi — sunucu kaydına bak' });
});

// Bulb list per car
app.get('/api/admin/bulbs', requireAdmin, (req, res) => {
  const text = getSettings().bulbs_text || '';
  const { map, errors } = parseBulbs(text, CARS);
  res.json({ text, count: Object.keys(map).length, errors });
});
app.put('/api/admin/bulbs', requireAdmin, (req, res) => {
  const text = String((req.body || {}).text || '').slice(0, 200000);
  db.prepare("INSERT INTO settings (key, value) VALUES ('bulbs_text', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(text);
  const { map, errors } = parseBulbs(text, CARS);
  res.json({ ok: true, count: Object.keys(map).length, errors });
});

// Withdrawal requests
app.get('/api/admin/withdrawals', requireAdmin, (req, res) => {
  res.json(db.prepare(`SELECT w.*, o.ref, o.total_cents, o.items, o.status AS order_status, o.phone
    FROM withdrawals w JOIN orders o ON o.id = w.order_id ORDER BY w.handled, w.id DESC LIMIT 300`).all());
});
app.put('/api/admin/withdrawals/:id', requireAdmin, (req, res) => {
  db.prepare('UPDATE withdrawals SET handled = ? WHERE id = ?').run((req.body || {}).handled ? 1 : 0, req.params.id);
  res.json({ ok: true });
});

app.get('/api/admin/stats', requireAdmin, (req, res) => {
  const one = sql => db.prepare(sql).get();
  res.json({
    pending: one("SELECT COUNT(*) c FROM orders WHERE status = 'pending'").c,
    to_ship: one("SELECT COUNT(*) c FROM orders WHERE status = 'paid'").c,
    orders_30d: one("SELECT COUNT(*) c FROM orders WHERE created_at >= datetime('now','-30 day') AND status != 'cancelled'").c,
    revenue_30d: one("SELECT COALESCE(SUM(total_cents),0) s FROM orders WHERE created_at >= datetime('now','-30 day') AND status IN ('paid','shipped','delivered')").s,
    customers: one('SELECT COUNT(*) c FROM users').c,
    views: db.prepare(`SELECT p.id, p.name_en AS name,
        SUM(CASE WHEN v.day >= date('now','-7 day') THEN 1 ELSE 0 END) AS d7,
        SUM(CASE WHEN v.day >= date('now','-30 day') THEN 1 ELSE 0 END) AS d30
      FROM products p LEFT JOIN product_views v ON v.product_id = p.id
      GROUP BY p.id ORDER BY d30 DESC`).all(),
  });
});

// Uploads: returns [{ type, src }]
app.post('/api/admin/upload', requireAdmin, upload.array('files', 20), (req, res) => {
  const out = [];
  for (const f of req.files || []) {
    const isVideo = VID_EXT.includes(path.extname(f.filename));
    if (!isVideo && f.size > 12 * 1024 * 1024) { fs.unlinkSync(f.path); continue; }   // photos max 12 MB
    out.push({ type: isVideo ? 'video' : 'image', src: '/uploads/' + f.filename });
  }
  res.json({ ok: true, media: out });
});

// Categories
app.get('/api/admin/categories', requireAdmin, (req, res) => {
  res.json(db.prepare(`SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.category = c.slug) AS products
    FROM categories c ORDER BY sort, slug`).all());
});
function categoryFields(b) {
  const f = {
    name_en: str(b.name_en, 80), name_es: str(b.name_es, 80),
    desc_en: str(b.desc_en, 600), desc_es: str(b.desc_es, 600),
    image: catalog.okSrc(b.image) ? b.image : '',
    sort: parseInt(b.sort, 10) || 0, active: b.active === false || b.active === 0 ? 0 : 1,
  };
  if (!f.name_en || !f.name_es) throw new Error('İki dilde isim zorunlu');
  return f;
}
app.post('/api/admin/categories', requireAdmin, (req, res) => {
  try {
    const f = categoryFields(req.body || {});
    let slug = slugify(f.name_es), n = 1;
    while (categoryExists(slug)) slug = `${slugify(f.name_es)}-${++n}`;
    db.prepare('INSERT INTO categories (slug, name_en, name_es, desc_en, desc_es, image, sort, active) VALUES (?,?,?,?,?,?,?,?)')
      .run(slug, f.name_en, f.name_es, f.desc_en, f.desc_es, f.image, f.sort, f.active);
    res.json({ ok: true, slug });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.put('/api/admin/categories/:slug', requireAdmin, (req, res) => {
  if (!categoryExists(req.params.slug)) return res.status(404).json({ error: 'Not found' });
  try {
    const f = categoryFields(req.body || {});
    db.prepare('UPDATE categories SET name_en=?, name_es=?, desc_en=?, desc_es=?, image=?, sort=?, active=? WHERE slug=?')
      .run(f.name_en, f.name_es, f.desc_en, f.desc_es, f.image, f.sort, f.active, req.params.slug);
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.delete('/api/admin/categories/:slug', requireAdmin, (req, res) => {
  const n = db.prepare('SELECT COUNT(*) c FROM products WHERE category = ?').get(req.params.slug).c;
  if (n) return res.status(400).json({ error: `Bu kategoride ${n} ürün var. Önce ürünleri başka kategoriye taşı.` });
  db.prepare('DELETE FROM categories WHERE slug = ?').run(req.params.slug);
  res.json({ ok: true });
});

// Products
function adminProduct(row) {
  const { options, combos, media } = catalog.read(row);
  return {
    id: row.id, slug: row.slug, category: row.category, fitment: row.fitment, status: row.status,
    name_en: row.name_en, name_es: row.name_es, desc_en: row.desc_en, desc_es: row.desc_es,
    price_cents: row.price_cents, old_price_cents: row.old_price_cents, stock: row.stock, sort: row.sort,
    options, combos, media,
    manufacturer: row.manufacturer, eu_responsible: row.eu_responsible, safety_en: row.safety_en, safety_es: row.safety_es,
  };
}
app.get('/api/admin/products', requireAdmin, (req, res) => {
  res.json(db.prepare('SELECT * FROM products ORDER BY sort, id').all().map(adminProduct));
});

function productFields(b) {
  const cents = v => (v === '' || v == null ? null : Math.round(Number(v)));
  const options = catalog.cleanOptions(b.options);
  const media = catalog.cleanMedia(b.media);
  const f = {
    category: str(b.category, 80),
    name_en: str(b.name_en, 150), name_es: str(b.name_es, 150),
    desc_en: str(b.desc_en, 6000), desc_es: str(b.desc_es, 6000),
    price_cents: cents(b.price_cents), old_price_cents: cents(b.old_price_cents),
    stock: Math.max(0, parseInt(b.stock, 10) || 0), sort: parseInt(b.sort, 10) || 0,
    status: ['available', 'soon', 'hidden'].includes(b.status) ? b.status : 'available',
    fitment: b.fitment === 'car' ? 'car' : 'universal',
    opts: JSON.stringify(options),
    combos: JSON.stringify(catalog.cleanCombos(b.combos, options)),
    media: JSON.stringify(media),
    image: media.find(m => m.type === 'image')?.src || '',
    manufacturer: str(b.manufacturer, 500), eu_responsible: str(b.eu_responsible, 500),
    safety_en: str(b.safety_en, 2000), safety_es: str(b.safety_es, 2000),
  };
  f.active = f.status === 'hidden' ? 0 : 1;
  if (!categoryExists(f.category)) throw new Error('Kategori seç');
  if (!f.name_en || !f.name_es) throw new Error('İki dilde isim zorunlu');
  if (!Number.isInteger(f.price_cents) || f.price_cents < 0) throw new Error('Fiyat zorunlu');
  if (f.old_price_cents !== null && f.old_price_cents <= f.price_cents) f.old_price_cents = null;
  return f;
}
const slugify = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'item';

app.post('/api/admin/products', requireAdmin, (req, res) => {
  try {
    const f = productFields(req.body || {});
    let slug = slugify(f.name_es), n = 1;
    while (db.prepare('SELECT 1 FROM products WHERE slug = ?').get(slug)) slug = `${slugify(f.name_es)}-${++n}`;
    const cols = Object.keys(f);
    const info = db.prepare(`INSERT INTO products (slug, ${cols.join(',')}) VALUES (?, ${cols.map(() => '?').join(',')})`)
      .run(slug, ...cols.map(c => f[c]));
    res.json({ ok: true, id: info.lastInsertRowid, slug });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.put('/api/admin/products/:id', requireAdmin, (req, res) => {
  const old = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!old) return res.status(404).json({ error: 'Not found' });
  try {
    const f = productFields(req.body || {});
    const cols = Object.keys(f);
    db.prepare(`UPDATE products SET ${cols.map(c => c + ' = ?').join(', ')} WHERE id = ?`).run(...cols.map(c => f[c]), old.id);
    res.json({ ok: true, slug: old.slug });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Quick stock change from the product list (e.g. after a sale on Amazon / Wallapop)
app.post('/api/admin/products/:id/stock', requireAdmin, (req, res) => {
  const d = parseInt((req.body || {}).delta, 10) || 0;
  db.prepare('UPDATE products SET stock = MAX(0, stock + ?) WHERE id = ?').run(d, req.params.id);
  res.json({ ok: true, stock: db.prepare('SELECT stock FROM products WHERE id = ?').get(req.params.id)?.stock });
});

app.delete('/api/admin/products/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM products WHERE id = ?').run(req.params.id);
  db.prepare('DELETE FROM product_views WHERE product_id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Orders
const ORDER_COLS = '*, (SELECT COUNT(*) FROM withdrawals w WHERE w.order_id = orders.id) AS withdrawals';
app.get('/api/admin/orders', requireAdmin, (req, res) => {
  const st = req.query.status;
  const rows = STATUSES.includes(st)
    ? db.prepare(`SELECT ${ORDER_COLS} FROM orders WHERE status = ? ORDER BY id DESC LIMIT 500`).all(st)
    : db.prepare(`SELECT ${ORDER_COLS} FROM orders ORDER BY id DESC LIMIT 500`).all();
  res.json(rows);
});
app.put('/api/admin/orders/:id', requireAdmin, (req, res) => {
  const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!o) return res.status(404).json({ error: 'Not found' });
  const b = req.body || {};
  const status = STATUSES.includes(b.status) ? b.status : o.status;
  // Put stock back when an order is cancelled (and take it again if un-cancelled)
  if (status !== o.status && (status === 'cancelled' || o.status === 'cancelled')) {
    const sign = status === 'cancelled' ? 1 : -1;
    const upd = db.prepare('UPDATE products SET stock = MAX(0, stock + ?) WHERE id = ?');
    for (const i of JSON.parse(o.items)) upd.run(sign * i.qty, i.id);
  }
  db.prepare('UPDATE orders SET status = ?, tracking = ? WHERE id = ?')
    .run(status, b.tracking !== undefined ? str(b.tracking, 200) : o.tracking, o.id);
  // Tell the customer when the order is paid, shipped or cancelled
  let mailed = false;
  if (status !== o.status && b.notify !== false && ['paid', 'shipped', 'cancelled'].includes(status)) {
    mailed = mail.enabled;
    mail.statusUpdate(db.prepare('SELECT * FROM orders WHERE id = ?').get(o.id), getSettings(), baseUrl(req));
  }
  res.json({ ok: true, mailed });
});

// Customers
app.get('/api/admin/customers', requireAdmin, (req, res) => {
  res.json(db.prepare(`
    SELECT u.id, u.name, u.email, u.phone, u.address, u.city, u.zip, u.province, u.country, u.car, u.created_at,
      COUNT(o.id) AS orders,
      COALESCE(SUM(CASE WHEN o.status IN ('paid','shipped','delivered') THEN o.total_cents END), 0) AS spent_cents,
      MAX(o.created_at) AS last_order
    FROM users u LEFT JOIN orders o ON o.user_id = u.id
    GROUP BY u.id ORDER BY u.id DESC`).all());
});
app.get('/api/admin/customers/:id', requireAdmin, (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!u) return res.status(404).json({ error: 'Not found' });
  // also show guest orders made with the same email before registering
  const orders = db.prepare('SELECT * FROM orders WHERE user_id = ? OR (user_id IS NULL AND lower(email) = ?) ORDER BY id DESC')
    .all(u.id, u.email);
  res.json({ user: publicUser(u), orders });
});
app.put('/api/admin/customers/:id/password', requireAdmin, (req, res) => {
  const pw = String((req.body || {}).password || '');
  if (pw.length < 8) return res.status(400).json({ error: 'En az 8 karakter' });
  db.prepare('UPDATE users SET pass_hash = ? WHERE id = ?').run(hashPassword(pw), req.params.id);
  db.prepare('DELETE FROM user_sessions WHERE user_id = ?').run(req.params.id);
  res.json({ ok: true });
});
app.delete('/api/admin/customers/:id', requireAdmin, (req, res) => {
  // Orders are kept for accounting; only the account is removed
  db.prepare('UPDATE orders SET user_id = NULL WHERE user_id = ?').run(req.params.id);
  db.prepare('DELETE FROM user_sessions WHERE user_id = ?').run(req.params.id);
  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Settings
app.get('/api/admin/settings', requireAdmin, (req, res) => res.json(getSettings()));
app.put('/api/admin/settings', requireAdmin, (req, res) => {
  const cur = getSettings();
  const upd = db.prepare('UPDATE settings SET value = ? WHERE key = ?');
  for (const [k, v] of Object.entries(req.body || {})) if (k in cur) upd.run(str(v, 300), k);
  res.json({ ok: true });
});

// ---------- Errors & pages ----------
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, req, res, next) => {
  console.error(err.message);
  res.status(400).json({ error: err.message || 'Error' });
});
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

// ---------- SEO: robots, sitemap and per-page titles for search engines ----------
app.get('/robots.txt', (req, res) => {
  res.type('text/plain').send(`User-agent: *
Disallow: /admin
Disallow: /api/
Disallow: /account
Disallow: /cart
Disallow: /checkout
Disallow: /order/
Sitemap: ${baseUrl(req)}/sitemap.xml
`);
});
app.get('/sitemap.xml', (req, res) => {
  const base = baseUrl(req);
  const paths = ['/', '/car',
    ...db.prepare('SELECT slug FROM categories WHERE active = 1 ORDER BY sort').all().map(c => `/c/${c.slug}`),
    ...db.prepare(`SELECT slug FROM products WHERE ${VISIBLE} ORDER BY sort`).all().map(p => `/p/${p.slug}`),
    '/info/shipping', '/info/returns', '/info/terms', '/info/privacy', '/info/legal'];
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${paths.map(p => `  <url><loc>${base}${p}</loc></url>`).join('\n')}
</urlset>`);
});

const INDEX_FILE = path.join(__dirname, 'public', 'index.html');
let indexCache = null;
const indexHtml = () => (IS_PROD && indexCache) || (indexCache = fs.readFileSync(INDEX_FILE, 'utf8'));
const attr = v => String(v ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const PAGE_META = {
  '/': ['Vornetic — Bombillas xenón, LED y alfombrillas para coche', 'Bombillas xenón D1S, D2S, D3S y LED H7, H4, H1, H11. Alfombrillas universales y alfombrillas EVO a medida para tu coche. Envío desde España.'],
  '/car': ['Buscar por coche — Vornetic', 'Elige marca, modelo, generación y año y encuentra las bombillas y alfombrillas para tu coche.'],
};
function metaFor(urlPath) {
  if (PAGE_META[urlPath]) return PAGE_META[urlPath];
  const m = urlPath.match(/^\/c\/([\w-]+)$/);
  const c = m && db.prepare('SELECT * FROM categories WHERE slug = ? AND active = 1').get(m[1]);
  return c ? [`${c.name_es} — Vornetic`, c.desc_es || c.name_es] : [null, null];
}
function pageHtml(req) {
  const base = baseUrl(req);
  const urlPath = req.path.replace(/\/+$/, '') || '/';
  let [title, desc] = metaFor(urlPath);
  let extra = `<link rel="canonical" href="${attr(base + urlPath)}">`;
  let status = 200;
  const m = urlPath.match(/^\/p\/([\w-]+)$/);
  if (m) {
    const p = db.prepare(`SELECT * FROM products WHERE slug = ? AND ${VISIBLE}`).get(m[1]);
    if (!p) status = 404;
    else {
      const pp = publicProduct(p);
      title = `${p.name_es} — Vornetic`;
      desc = p.desc_es.replace(/\s+/g, ' ').slice(0, 155);
      const img = /^https?:/.test(pp.image) ? pp.image : base + pp.image;
      extra += `<meta property="og:type" content="product"><meta property="og:title" content="${attr(p.name_es)}">
<meta property="og:description" content="${attr(desc)}"><meta property="og:image" content="${attr(img)}">
<script type="application/ld+json">${JSON.stringify({
        '@context': 'https://schema.org', '@type': 'Product', name: p.name_es, description: desc, image: img,
        sku: p.slug, brand: { '@type': 'Brand', name: 'Vornetic' },
        offers: { '@type': 'Offer', priceCurrency: 'EUR', price: (pp.price_cents / 100).toFixed(2), url: base + urlPath,
          availability: pp.status === 'soon' ? 'https://schema.org/PreOrder' : p.stock > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock' },
      }).replace(/</g, '\u003c')}</script>`;
    }
  }
  if (/^\/(account|cart|checkout|order)/.test(urlPath)) extra += '<meta name="robots" content="noindex">';
  let html = indexHtml().replace('</head>', extra + '\n</head>');
  if (title) html = html.replace(/<title>[\s\S]*?<\/title>/, `<title>${attr(title)}</title>`)
    .replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${attr(desc)}">`);
  return { html, status };
}
app.get(/^\/(?!api|uploads).*/, (req, res) => {
  const { html, status } = pageHtml(req);
  res.status(status).type('html').send(html);
});

// Daily database backup (data/backups, last 14 days)
backup();
setInterval(backup, 6 * 3600 * 1000).unref();

const server = app.listen(PORT, () => {
  // Only once the port is ours: a start that fails (e.g. EADDRINUSE because another instance
  // is running on the same data) must not log out that instance's admins.
  revokeAdminSessions();
  console.log(`Vornetic → http://localhost:${PORT}   Admin → http://localhost:${PORT}/admin`);
});
server.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n✖ Port ${PORT} is already used by another program (maybe another project).`);
    console.error(`  Close it, or start Vornetic on another port:  set PORT=3400 && npm start\n`);
    process.exit(1);
  }
  throw err;
});
