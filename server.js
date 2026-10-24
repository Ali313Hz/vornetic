// server.js — Vornetic online store
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const cookieParser = require('cookie-parser');
const {
  db, today, getSettings,
  hashPassword, checkPassword, loadCars, parseBulbs, backup, backupStatus, DATA_DIR,
} = require('./db');
const mail = require('./mail');
const catalog = require('./catalog');
const stripeConfig = require('./stripe');
const finance = require('./finance');

const app = express();
const PORT = process.env.PORT || 3300;
const DEFAULT_ADMIN_PASSWORD = 'vornetic2026';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || DEFAULT_ADMIN_PASSWORD;
const STRIPE_KEY = process.env.STRIPE_SECRET_KEY || '';
// Signing secret of the Stripe webhook endpoint (whsec_...), see POST /api/stripe/webhook
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
if (STRIPE_KEY && !STRIPE_WEBHOOK_SECRET)
  console.warn('⚠  STRIPE_WEBHOOK_SECRET is not set: card payments are only noticed when the customer returns or by the 15-minute check. Set it before taking live card payments (README).');
const STRIPE_API = stripeConfig.apiBase();
if (stripeConfig.overrideIgnored()) console.warn('⚠  STRIPE_API_URL is ignored: it only works in the automated tests. Remove it from .env.');
const IS_PROD = process.env.NODE_ENV === 'production';

// The shop's address, e.g. https://vornetic.com. Every link we send out — password reset, order
// e-mails, Stripe return pages, sitemap — is built from it. Without it the address would come from
// the request's Host header, which anyone can fake: a password-reset e-mail could then point to
// someone else's site and hand them the reset token. So in production it is required, must be
// https:// and must be just the address (no path). In development it is optional.
//
// The raw text is checked before anything is normalised (a URL parser would quietly "fix"
// values like "https:shop.com", "https:\\shop.com" or "https://shop.com?" into something else).
// Accepted: https://host[:port] with an optional final "/". In development http:// and a
// one-word host such as localhost are fine too.
// Problems are reported by kind only: the value is never printed, because a mistyped value can
// contain a password or token, and server logs are often kept and forwarded.
const HOST_LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;
function checkPublicUrl(value) {
  if (!value) return { problem: 'is not set' };
  if (/[\s\\@\u0000-\u001f\u007f]/.test(value)) return { problem: 'contains a space, backslash, "@" or login details' };
  if (!/^https?:\/\//i.test(value) || (IS_PROD && !/^https:\/\//i.test(value))) return { problem: 'must start with https://' };
  const m = /^(https?):\/\/([^/?#:]+)(?::(\d*))?\/?$/i.exec(value);
  if (!m) return { problem: 'must be only the address: no path, "?", "#" or anything after the host and port' };
  const [, scheme, rawHost, port] = m;
  const host = rawHost.toLowerCase(), labels = host.split('.');
  if (labels.some(l => !HOST_LABEL.test(l)) || (IS_PROD && labels.length < 2)) return { problem: 'has an invalid host name' };
  if (port !== undefined && (!/^[1-9]\d{0,4}$/.test(port) || Number(port) > 65535)) return { problem: 'has an invalid port' };
  const defaultPort = scheme.toLowerCase() === 'https' ? '443' : '80';
  return { url: `${scheme.toLowerCase()}://${host}${port && port !== defaultPort ? ':' + port : ''}` };
}
function publicUrl(raw) {
  const { url, problem } = checkPublicUrl(String(raw ?? '').trim());
  if (url) return url;
  if (IS_PROD) {
    console.error(`✖  PUBLIC_URL ${problem} (value not shown). In production set it in .env to the shop's https address, e.g. PUBLIC_URL=https://vornetic.com`);
    process.exit(1);
  }
  if (problem !== 'is not set') console.warn(`⚠  PUBLIC_URL ${problem} (value not shown); using the address of each request (fine for local testing only).`);
  return '';
}
const PUBLIC_URL = publicUrl(process.env.PUBLIC_URL);

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
// Nginx runs on the same server (README, docs/nginx-vornetic.conf). Only a request coming from this
// machine may tell us via X-Forwarded-Proto / X-Forwarded-For that the visitor used https and what
// their IP is; a request from anywhere else can't fake those headers (they are ignored).
app.set('trust proxy', 'loopback');
// Content-Security-Policy: the browser runs scripts, loads fonts, images and video, and makes requests
// only from this site itself. Nothing on the pages comes from elsewhere (the font is served here),
// so this costs nothing, and HTML slipped into a page (e.g. through a product text) can't load or run
// anything else. The pages use inline style="" attributes, so styles allow 'unsafe-inline'; scripts
// don't (the pages have no inline scripts; JSON-LD is data, not run). Going to the Stripe payment
// page is a normal navigation, which this doesn't restrict.
// CSP_REPORT_ONLY=1: browsers only report (in the console) what they would block — an emergency
// switch if something turns out to be blocked on the live site.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "media-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
  ...(IS_PROD ? ['upgrade-insecure-requests'] : []),
].join('; ');
const CSP_HEADER = process.env.CSP_REPORT_ONLY === '1' ? 'Content-Security-Policy-Report-Only' : 'Content-Security-Policy';
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    [CSP_HEADER]: CSP,
    // In production: browsers must use https for this site for the next year (only this host,
    // not subdomains, so a mail or other subdomain without https keeps working)
    ...(IS_PROD && { 'Strict-Transport-Security': 'max-age=31536000' }),
  });
  next();
});
// Production: customer data only over https. Nginx itself redirects port 80 to https, so normally
// no plain-http request arrives here. If one still does (port 80 proxied by mistake, or the app
// reached directly), pages are redirected to the https address, and everything else — login,
// checkout, admin — is refused without being processed, so it has to be sent again over https.
// "https" is only believed when Nginx on this machine says so (trust proxy above).
if (IS_PROD) app.use((req, res, next) => {
  if (req.secure) return next();
  if (req.method === 'GET' || req.method === 'HEAD') return res.redirect(301, PUBLIC_URL + req.originalUrl);
  res.status(403).json({ error: 'HTTPS required' });
});
// ---------- Stripe webhook ----------
// Stripe tells us at once when a card payment page is paid or closed, even if the customer never
// comes back to the shop. The event is only a signal: its signature is checked (stripe.js), then the
// Checkout Session is fetched from Stripe and handled exactly like the 15-minute check does
// (applyStripeSession: same order, same amount and currency, recorded once). So a replayed or odd
// event can't record anything Stripe doesn't confirm. Stripe resends an event until it gets a 2xx,
// so a temporary failure answers 500; everything done here is safe to repeat.
// Registered before the JSON body parser: the signature is over the exact bytes received.
const WEBHOOK_EVENTS = new Set(['checkout.session.completed', 'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed', 'checkout.session.expired']);
app.post('/api/stripe/webhook', express.raw({ type: 'application/json', limit: '1mb' }), async (req, res) => {
  if (!STRIPE_KEY || !STRIPE_WEBHOOK_SECRET) return res.status(503).json({ error: 'Webhook not configured' });
  let event;
  try { event = stripeConfig.verifyWebhook(req.body, req.get('stripe-signature'), STRIPE_WEBHOOK_SECRET); }
  catch { return res.status(400).json({ error: 'Invalid signature' }); }
  if (!WEBHOOK_EVENTS.has(event && event.type)) return res.json({ received: true });
  const sessionId = event.data && event.data.object && event.data.object.id;
  const o = typeof sessionId === 'string' && sessionId
    ? db.prepare("SELECT * FROM orders WHERE stripe_session = ? AND payment_method = 'card'").get(sessionId) : null;
  if (!o || o.paid_at) return res.json({ received: true });   // not one of ours, or already recorded
  try {
    const result = applyStripeSession(o, await stripeSession(o.stripe_session));
    if (result.paid) flushMails();
    res.json({ received: true });
  } catch (e) {
    console.error(`Stripe webhook for ${o.ref} failed (Stripe will send it again):`, e.message);
    res.status(500).json({ error: 'Try again' });
  }
});

app.use(express.json({ limit: '200kb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public'), { index: false, maxAge: IS_PROD ? '1h' : 0 }));
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '7d' }));

// ---------- Uploads (photos and videos, admin only) ----------
// One file per request, so every upload request has a small, known maximum size: the admin page
// sends a selection of several files one after another. Nginx must accept one full-size video plus
// the form overhead: client_max_body_size 81m in docs/nginx-vornetic.conf (checked by a test).
const MAX_VIDEO_MB = 80, MAX_PHOTO_MB = 12;
const MAX_VIDEO_BYTES = MAX_VIDEO_MB * 1024 * 1024, MAX_PHOTO_BYTES = MAX_PHOTO_MB * 1024 * 1024;
// Multer's own limit is set a little ABOVE the maximum and the exact maximum is checked below on the
// finished file: Multer 2.0–2.2 rejected a file of exactly limits.fileSize bytes (2.3+ accepts it),
// so this way a video of exactly 80 MB is accepted whatever Multer version is installed.
const MULTER_FILE_LIMIT = MAX_VIDEO_BYTES + 1024;
const IMG_EXT = ['.jpg', '.jpeg', '.png', '.webp'];
const VID_EXT = ['.mp4', '.webm'];
const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) =>
      cb(null, crypto.randomBytes(8).toString('hex') + path.extname(file.originalname).toLowerCase()),
  }),
  limits: { fileSize: MULTER_FILE_LIMIT, files: 1 },
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
// Links we send out. In production PUBLIC_URL is always set (see publicUrl above), so the Host
// header is only used in local development.
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

// Run fn as one SQLite transaction: either all of its changes are saved or none are
function inTransaction(fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}

// Total quantity per product id (the same product can be on several cart lines)
function qtyByProduct(items) {
  const need = new Map();
  for (const i of items) need.set(i.id, (need.get(i.id) || 0) + i.qty);
  return need;
}

// Take an order's items out of stock. Throws (taking nothing) if any product hasn't enough.
// Products deleted since the order was placed are skipped: there is no stock left to track.
function takeStock(items, notEnough) {
  const take = db.prepare('UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?');
  for (const [id, qty] of qtyByProduct(items)) {
    if (take.run(qty, id, qty).changes) continue;
    const p = db.prepare('SELECT name_en, name_es, stock FROM products WHERE id = ?').get(id);
    if (p) throw new Error(notEnough(p, qty));
  }
}
function returnStock(items) {
  const put = db.prepare('UPDATE products SET stock = stock + ? WHERE id = ?');
  for (const [id, qty] of qtyByProduct(items)) put.run(qty, id);
}
const PAID_STATUSES = ['paid', 'shipped', 'delivered'];

// Record that the money for an order arrived ("via" = 'stripe' or 'admin'). Only the first call
// for an order changes anything ("AND paid_at IS NULL"), so whoever records the payment first —
// Stripe's return page, the Stripe check or the admin — is the one who queues the card
// confirmation e-mails, once. Call it inside inTransaction, so the payment and its queued e-mails
// are saved together; then flushMails() sends them.
// A pending order becomes "paid"; any other status (e.g. cancelled) is kept.
// "at" is when the money was actually taken (from Stripe, see stripePaidAt); without it, now —
// marked as estimated if the payment may have happened a while ago.
// Returns the updated order if this call recorded the payment, otherwise null.
function recordPayment(orderId, via, { at = null, estimated = false } = {}) {
  const r = db.prepare(`UPDATE orders SET paid_at = COALESCE(?, datetime('now')), paid_at_estimated = ?, paid_via = ?,
      payment_unknown = 0, status = CASE status WHEN 'pending' THEN 'paid' ELSE status END
    WHERE id = ? AND paid_at IS NULL`).run(at, at ? 0 : estimated ? 1 : 0, via, orderId);
  if (!r.changes) return null;
  const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  // Card orders get their confirmation (to the customer) and new-order notice (to the shop) only
  // once paid; other payment methods got them when the order was placed. If the order had been
  // cancelled before the money arrived, both get a "paid, will not ship, refund due" message instead.
  if (o.payment_method === 'card')
    for (const kind of o.status === 'cancelled' ? ['charged_after_cancel', 'shop_charged_after_cancel'] : ['confirmation', 'shop_new_order'])
      queueMail(o.id, kind);
  return o;
}

// ---------- E-mails that must not be lost (table mail_outbox) ----------
// Queued in the same transaction as the change they report, sent right after, retried on every
// 15-minute run if the mail server fails (up to MAIL_TRIES times, then 'failed', shown on the order).
// "still" = what must STILL be true of the order when the e-mail is sent; checked in the same
// statement that claims the e-mail for sending, so an e-mail that has become untrue is dropped.
const MAIL_KINDS = {
  // "paid, order confirmed": never once the payment is undone (or the order cancelled)
  confirmation: { send: (o, s, base) => mail.orderConfirmation(o, s, base), still: "o.status <> 'cancelled' AND o.paid_at IS NOT NULL" },
  shop_new_order: { send: (o, s, base) => mail.shopNewOrder(o, s, base), shop: true, still: "o.status <> 'cancelled' AND o.paid_at IS NOT NULL" },
  // "paid after cancelling, will not ship, refund": never once the order is reinstated
  charged_after_cancel: { send: (o, s) => mail.chargedAfterCancel(o, s), still: "o.status = 'cancelled' AND o.paid_at IS NOT NULL" },
  shop_charged_after_cancel: { send: (o, s, base) => mail.shopChargedAfterCancel(o, s, base), shop: true, still: "o.status = 'cancelled' AND o.paid_at IS NOT NULL" },
  // "payment not received, order cancelled": never once the order is reinstated or paid
  expired: { send: (o, s) => mail.orderExpired(o, s), still: "o.status = 'cancelled' AND o.paid_at IS NULL" },
};
const MAIL_TRIES = 10;
// After a failed attempt the next one waits 15 min, then 30, 60… (at most 12 h): an outage can't use
// up the tries in minutes, whatever else triggers sending. New e-mails don't wait.
const mailRetryMinutes = tries => Math.min(15 * 2 ** (tries - 1), 720);
const MAIL_IN_FLIGHT = '-3 minutes';    // a send claimed longer ago than this has died (mail.js times out well before)

// Queue an e-mail for an order (inside the caller's transaction). With e-mail switched off nothing
// is queued: it would otherwise go out, out of date, once e-mail is set up. Only one per order and
// kind; one that was dropped or had failed is queued again for the new event (e.g. the order was
// reinstated and is now cancelled again).
function queueMail(orderId, kind) {
  if (!mail.enabled) return false;
  db.prepare(`INSERT INTO mail_outbox (order_id, kind) VALUES (?, ?)
    ON CONFLICT (order_id, kind) DO UPDATE SET state = 'due', tries = 0, claimed_at = NULL, next_try_at = NULL
      WHERE state IN ('dropped', 'failed')`).run(orderId, kind);
  return true;
}

// An e-mail can't be taken back once it is on its way. Called (inside the transaction) before a
// change that makes these e-mails untrue: drops them if they haven't left yet (also a failed one, so
// a later event can queue it again), and refuses (409) while one is being sent — try again a few
// seconds later.
const CANCELLED_MAILS = ['expired', 'charged_after_cancel', 'shop_charged_after_cancel'];   // untrue once reinstated
const PAID_MAILS = ['confirmation', 'shop_new_order'];                                       // untrue once the payment is undone or the order cancelled
function dropMails(orderId, kinds) {
  const list = kinds.map(() => '?').join(', ');
  const busy = db.prepare(`SELECT 1 FROM mail_outbox WHERE order_id = ? AND kind IN (${list}) AND state = 'sending'
    AND claimed_at > datetime('now', ?)`).get(orderId, ...kinds, MAIL_IN_FLIGHT);
  if (busy) throw Object.assign(new Error('Bu siparişle ilgili bir e-posta şu an gönderiliyor. Birkaç saniye sonra tekrar dene.'), { status: 409 });
  db.prepare(`UPDATE mail_outbox SET state = 'dropped' WHERE order_id = ? AND kind IN (${list}) AND state IN ('due', 'sending', 'failed')`).run(orderId, ...kinds);
}

// Send what is queued. One sender at a time; e-mails queued while it runs get one more pass right
// after. Each e-mail is tried at most once per run ("tried"): one that just failed waits for the next
// run instead of being retried at once by that extra pass. No database transaction is open while
// waiting for the mail server: each e-mail is first claimed ('sending', one statement that also
// checks "still"), then sent, then marked.
let mailRun = null, mailAgain = false;
function flushMails() {
  if (mailRun) { mailAgain = true; return mailRun; }
  const tried = new Set();
  mailRun = (async () => {
    do { mailAgain = false; await sendQueuedMails(tried); } while (mailAgain);
  })().catch(e => console.error('Queued e-mails failed:', e.message)).finally(() => { mailRun = null; });
  return mailRun;
}
async function sendQueuedMails(tried) {
  if (!mail.enabled) return;
  // a send that never finished (the server stopped mid-send): it didn't count as a try, so try again
  // now — rarely, a duplicate
  db.prepare("UPDATE mail_outbox SET state = 'due', claimed_at = NULL, next_try_at = NULL WHERE state = 'sending' AND claimed_at <= datetime('now', ?)").run(MAIL_IN_FLIGHT);
  const s = getSettings(), base = PUBLIC_URL || `http://localhost:${PORT}`;
  // only those whose retry time has come; least-tried first: new e-mails are never stuck behind ones that keep failing
  for (const m of db.prepare(`SELECT id, kind FROM mail_outbox WHERE state = 'due' AND (next_try_at IS NULL OR next_try_at <= datetime('now'))
      ORDER BY tries, id LIMIT 50`).all()) {
    if (tried.has(m.id)) continue;
    tried.add(m.id);
    const k = MAIL_KINDS[m.kind];
    if (!k) { db.prepare("UPDATE mail_outbox SET state = 'failed' WHERE id = ?").run(m.id); continue; }
    const still = `EXISTS (SELECT 1 FROM orders o WHERE o.id = mail_outbox.order_id AND ${k.still || '1'})`;
    if (!db.prepare(`UPDATE mail_outbox SET state = 'sending', claimed_at = datetime('now') WHERE id = ? AND state = 'due'
        AND (next_try_at IS NULL OR next_try_at <= datetime('now')) AND ${still}`).run(m.id).changes) {
      db.prepare(`UPDATE mail_outbox SET state = 'dropped' WHERE id = ? AND state = 'due' AND NOT ${still}`).run(m.id);
      continue;
    }
    const o = db.prepare('SELECT * FROM orders WHERE id = (SELECT order_id FROM mail_outbox WHERE id = ?)').get(m.id);   // read after the claim
    if (!(k.shop ? s.shop_email : o.email)) { db.prepare("UPDATE mail_outbox SET state = 'skipped' WHERE id = ?").run(m.id); continue; }
    let ok = false;
    try { ok = await k.send(o, s, base); } catch { ok = false; }
    if (ok) db.prepare("UPDATE mail_outbox SET state = 'sent', sent_at = datetime('now') WHERE id = ? AND state = 'sending'").run(m.id);
    else {
      const tries = db.prepare('SELECT tries FROM mail_outbox WHERE id = ?').get(m.id).tries + 1;
      db.prepare(`UPDATE mail_outbox SET tries = ?, claimed_at = NULL, next_try_at = datetime('now', ?),
          state = CASE WHEN ? >= ? THEN 'failed' ELSE 'due' END WHERE id = ? AND state = 'sending'`)
        .run(tries, `+${mailRetryMinutes(tries)} minutes`, tries, MAIL_TRIES, m.id);
    }
  }
}

// ---------- Unpaid orders: release them so their stock is not reserved forever ----------
// The automated tests may shrink the batch and the reply time (NODE_ENV=test only)
const testNumber = (name, normal) => process.env.NODE_ENV === 'test' && Number(process.env[name]) > 0 ? Number(process.env[name]) : normal;
const UNPAID_DAYS = 5;                  // terms of sale: Bizum/transfer orders not paid within 5 days may be cancelled
const CARD_SESSION_MINUTES = 60;        // how long the Stripe payment page stays open (stripeCheckout)
const CARD_CHECK_AFTER_MINUTES = 120;   // ask Stripe about an unpaid card order only once its page has expired
const EXPIRY_BATCH = testNumber('EXPIRY_BATCH', 50);           // at most this many Stripe checks per run
const EXPIRY_RUN_MS = 5 * 60 * 1000;    // a run starts no new Stripe check after 5 minutes; the rest wait for the next run
const EXPIRY_REPLY_MS = testNumber('EXPIRY_REPLY_MS', 20000);  // the admin endpoint answers within this (Nginx gives up at 60 s)

// Cancel an order only if it is STILL pending and unpaid, and give its stock back in the same
// transaction. If the customer paid or the admin cancelled meanwhile, nothing changes, so stock
// is never returned twice. With notify = true the customer's "payment not received" e-mail is
// queued in the same transaction (see flushMails). Returns true if this call cancelled it.
function autoCancel(orderId, reason, { notify = false } = {}) {
  return inTransaction(() => {
    const r = db.prepare(`UPDATE orders SET status = 'cancelled', auto_cancelled_at = datetime('now'), auto_cancel_reason = ?
      WHERE id = ? AND status = 'pending' AND paid_at IS NULL`).run(reason, orderId);
    if (!r.changes) return false;
    returnStock(JSON.parse(db.prepare('SELECT items FROM orders WHERE id = ?').get(orderId).items));
    if (notify) queueMail(orderId, 'expired');
    return true;
  });
}

// Runs when the server starts, every 15 minutes, and on POST /api/admin/orders/expire-unpaid.
// - Bizum / bank transfer: pending, no payment recorded, placed more than 5 days ago
//     → only marked "overdue" (overdue_at). Nothing is cancelled: the app can't see the bank or
//       Bizum, so the admin checks and either marks it paid or confirms the cancellation
//       (POST /api/admin/orders/:id/cancel-unpaid).
// - Card: pending, no payment recorded, placed more than 2 hours ago → Stripe is asked first:
//     paid → the payment is recorded with Stripe's payment time (normal confirmation e-mails); never cancelled
//     payment page expired and unpaid → cancelled, stock returned (no e-mail: payment was never finished)
//     anything else — page still open, payment still processing, Stripe error, timeout, an answer
//     that doesn't match the order → left alone and checked again later.
//   Orders are checked oldest-checked first (stripe_checked_at), so orders that keep being left
//   alone can never block the others.
// An order whose payment can't be checked is never cancelled. Only one run at a time.
// "Contact" orders (no payment method set up) are never touched: the admin arranges those.
// What a Stripe Checkout Session means for its card order: the one decision used by the 15-minute
// check, the webhook and the customer's return page. o = the order row, sess = the session just
// fetched from Stripe. Every action is conditional, so running it twice (or two callers at once)
// changes nothing more. Returns { paid } | { cancelled } | { done } | { already } | { skip: reason }.
function applyStripeSession(o, sess, { estimated = false } = {}) {
  if (!sess || sess.id !== o.stripe_session || sess.client_reference_id !== o.ref) return { skip: 'Stripe answer does not match this order' };
  const stripeDone = () => db.prepare("UPDATE orders SET stripe_done_at = datetime('now') WHERE id = ?").run(o.id);
  if (sess.payment_status === 'paid') {
    // The money taken must be this order's total, in euros. If not, nothing is recorded
    // automatically: the order shows a warning and the admin checks the payment in Stripe.
    if (sess.amount_total !== o.total_cents || String(sess.currency).toLowerCase() !== 'eur') {
      db.prepare('UPDATE orders SET stripe_mismatch = ? WHERE id = ? AND stripe_mismatch IS NULL')
        .run(`Stripe: ${sess.amount_total} ${sess.currency} · sipariş: ${o.total_cents} eur (sent)`, o.id);
      return { skip: 'amount or currency does not match the order' };
    }
    // A cancelled order stays cancelled: it then shows "refund due" and both sides get the
    // "paid after cancelling" e-mail.
    const paid = inTransaction(() => {
      const p = recordPayment(o.id, 'stripe', { at: stripePaidAt(sess), estimated });
      if (p) stripeDone();
      return p;
    });
    return paid ? { paid: true } : { already: true };
  }
  if (sess.status === 'expired' && sess.payment_status === 'unpaid') {
    if (o.status === 'cancelled') { stripeDone(); return { done: true }; }   // can no longer be paid: nothing to watch
    if (autoCancel(o.id, 'card_checkout_expired')) { stripeDone(); return { cancelled: true }; }
    return { skip: 'changed while checking' };
  }
  // cancelled but the payment page is still open: close it (if the customer pays first, Stripe
  // refuses and the next check records the payment)
  if (o.status === 'cancelled' && sess.status === 'open') expireCancelledSession(o.id);   // rechecks: may have been reinstated meanwhile
  return { skip: `Stripe: ${sess.status || 'unknown'} / ${sess.payment_status || 'unknown'}` };
}

let expiryRun = null;
function expireUnpaidOrders() {
  if (!expiryRun) expiryRun = runExpiry().finally(() => { expiryRun = null; });
  return expiryRun;
}
async function runExpiry() {
  const out = { overdue: [], cancelled: [], paid: [], skipped: [], left: 0 };
  const deadline = Date.now() + EXPIRY_RUN_MS;
  db.prepare(`UPDATE orders SET overdue_at = datetime('now') WHERE status = 'pending' AND paid_at IS NULL AND overdue_at IS NULL
      AND payment_method IN ('bizum', 'transfer') AND created_at <= datetime('now', ?)`).run(`-${UNPAID_DAYS} days`);
  out.overdue = db.prepare(`SELECT ref FROM orders WHERE status = 'pending' AND paid_at IS NULL AND overdue_at IS NOT NULL
      AND payment_method IN ('bizum', 'transfer') ORDER BY id`).all().map(o => o.ref);

  // Unpaid card orders: pending ones older than 2 hours, and cancelled ones whose payment page
  // Stripe hasn't closed for good yet (the customer may have paid after the admin cancelled)
  const cards = db.prepare(`SELECT id, ref, status, stripe_session, total_cents FROM orders WHERE paid_at IS NULL AND payment_method = 'card'
      AND ((status = 'pending' AND created_at <= datetime('now', ?))
        OR (status = 'cancelled' AND stripe_session IS NOT NULL AND stripe_done_at IS NULL))
      ORDER BY stripe_checked_at IS NOT NULL, stripe_checked_at, id LIMIT ?`).all(`-${CARD_CHECK_AFTER_MINUTES} minutes`, EXPIRY_BATCH);
  for (const [n, o] of cards.entries()) {
    if (Date.now() > deadline) { out.left = cards.length - n; break; }
    const skip = reason => out.skipped.push({ ref: o.ref, reason });
    db.prepare("UPDATE orders SET stripe_checked_at = datetime('now') WHERE id = ?").run(o.id);
    if (!o.stripe_session) { skip('no Stripe session'); continue; }
    if (!STRIPE_KEY) { skip('Stripe not configured'); continue; }
    let sess;
    try { sess = await stripeSession(o.stripe_session); }
    catch (e) { skip('Stripe check failed: ' + e.message); continue; }
    // without Stripe's payment time, "now" may be hours late: marked as estimated
    const r = applyStripeSession(o, sess, { estimated: true });
    if (r.paid) out.paid.push(o.ref);       // its e-mails are queued (sent below, retried if they fail)
    else if (r.cancelled) out.cancelled.push(o.ref);
    else if (r.skip) skip(r.skip);
  }
  flushMails();
  if (out.cancelled.length || out.paid.length || out.skipped.length || out.overdue.length)
    console.log(`Unpaid orders: cancelled ${out.cancelled.join(', ') || '-'} · paid ${out.paid.join(', ') || '-'} · left ${out.skipped.length + out.left} · overdue (admin to check) ${out.overdue.length}`);
  return out;
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

    // The same checkout attempt again (double click, refresh, a second tab, "back" from Stripe, a
    // retry after a lost answer): answer with the order already made instead of a second order.
    // Checked FIRST, before the catalogue and stock checks meant for new orders: the first request
    // may have taken the last unit, or the product may be gone since; its order still stands.
    // The attempt is bound to everything that was ordered and where it goes (as saved, i.e. trimmed):
    // the same ID with any other delivery detail, note, payment method or cart is refused, never
    // answered with an order that has different details.
    const checkoutId = CHECKOUT_ID.test(String(b.checkout_id || '')) ? b.checkout_id : null;
    const checkoutHash = checkoutId && crypto.createHash('sha256').update(JSON.stringify([email.toLowerCase(), method,
      name, phone, address, city, zip, province, country, str(b.notes, 500),
      b.items.map(i => [i && i.id, i && i.qty, i && i.options, i && i.car])])).digest('hex');
    const again = () => repeatCheckout(db.prepare('SELECT * FROM orders WHERE checkout_id = ?').get(checkoutId), checkoutHash, s, res);
    if (checkoutId && db.prepare('SELECT 1 FROM orders WHERE checkout_id = ?').get(checkoutId)) return await again();
    // this attempt is opening its Stripe payment page right now (a request still running here)
    if (checkoutId && checkoutsOpening.has(checkoutId)) return res.status(409).json({ error: 'checkout_in_progress' });

    if (!availablePayments(s)[method]) throw new Error('Payment method not available');
    const items = b.items.map(cleanLine);
    const subtotal = items.reduce((a, i) => a + i.unit_cents * i.qty, 0);
    const shipping = shippingFor(zone, subtotal, s);
    const total = subtotal + shipping;
    const ref = newRef();

    // Card: the Stripe payment page is made FIRST, and the order is saved together with it below.
    // So a card order never exists without its payment page: if the server stops (or Stripe fails)
    // before the order is saved, nothing is left behind — no stock reserved, and the same checkout
    // simply goes through when tried again. (A page made but not used expires unpaid.)
    let session = null;
    if (method === 'card') {
      if (checkoutId) checkoutsOpening.add(checkoutId);
      try {
        session = await stripeCheckout({ ref, email, lang, items, shipping, base: baseUrl(req) });
      } catch (err) {
        console.error(`Stripe checkout failed for ${ref}:`, err.message);
        throw new Error('Card payment is not available right now. Please try again or choose another payment method.');
      } finally {
        if (checkoutId) checkoutsOpening.delete(checkoutId);
      }
    }

    // Save the order and take its stock together; not enough stock = no order at all
    let info;
    try {
      info = inTransaction(() => {
        // Card: Stripe was asked first (an await), so the cart is checked again here, in the same
        // transaction that takes the stock: a product removed (or changed) meanwhile means no order —
        // never a payable order for something no longer sold, nor one that differs from the page.
        if (session && JSON.stringify(b.items.map(cleanLine)) !== JSON.stringify(items))
          throw new Error('Your cart changed while the payment page was being prepared. Please check it and try again.');
        takeStock(items, (p, qty) => lang === 'es'
          ? `No hay stock suficiente: ${p.name_es} (quedan ${p.stock}, has pedido ${qty})`
          : `Not enough stock: ${p.name_en} (only ${p.stock} left, you asked for ${qty})`);
        return db.prepare(`INSERT INTO orders
          (ref, user_id, customer_name, email, phone, address, city, zip, province, country, notes, items,
           subtotal_cents, shipping_cents, total_cents, payment_method, lang, checkout_id, checkout_hash, stripe_session, stripe_url)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
          .run(ref, user ? user.id : null, name, email, phone, address, city, zip, province, country, str(b.notes, 500),
            JSON.stringify(items), subtotal, shipping, total, method, lang, checkoutId, checkoutHash,
            session ? session.id : null, session ? session.url : null);
      });
    } catch (e) {
      // no order for this payment page after all (stock gone meanwhile, or the same attempt saved
      // meanwhile): close it, so it can't be paid
      if (session) closeStripeSession(session.id);
      // the same attempt was saved meanwhile (unique checkout_id): its stock was taken once, by that one
      if (checkoutId && /UNIQUE/i.test(e.message)) return await again();
      throw e;
    }

    // Remember the address on the customer's account if they have none yet
    if (user && !user.address) {
      db.prepare('UPDATE users SET phone = COALESCE(NULLIF(phone, \'\'), ?), address=?, city=?, zip=?, province=?, country=? WHERE id=?')
        .run(phone, address, city, zip, province, country, user.id);
    }

    if (method === 'card') return res.json({ ok: true, ref, redirect: session.url });   // e-mails are sent once the card payment is confirmed
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(info.lastInsertRowid);
    mail.orderConfirmation(order, s, baseUrl(req));
    mail.shopNewOrder(order, s, baseUrl(req));
    res.json({ ok: true, ref, total_cents: total, payment_method: method, ...paymentInfo(s, method) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// A checkout ID from the shop page: random, 16–64 letters, digits or dashes (crypto.randomUUID)
const CHECKOUT_ID = /^[A-Za-z0-9-]{16,64}$/;
// Checkout attempts whose Stripe payment page is being made by a request running right now. Kept in
// memory on purpose: after a restart no request is running any more, so the attempt can go ahead.
const checkoutsOpening = new Set();
// Close a Stripe payment page no order uses (best effort): see POST /api/orders
function closeStripeSession(id) {
  stripe('POST', `/v1/checkout/sessions/${encodeURIComponent(id)}/expire`)
    .catch(e => console.error('Could not close an unused Stripe payment page:', e.message));
}
// The answer to a repeated checkout attempt, from the order it already made. No e-mails, no stock:
// the first request did that. Refused (409) when the attempt can't be continued, so the shop page
// starts a new one: what was ordered changed ('checkout_changed') or the order ended, e.g. its card
// payment page expired ('checkout_ended'). 'checkout_in_progress': a card order without its payment
// page (only orders saved before pages were made first can look like this), or whose page Stripe
// reports as neither open nor final.
// An unpaid card order's page is checked with Stripe before it is handed back (it may have expired
// after an hour, or been paid meanwhile): the same decision as the webhook and the 15-minute check
// (applyStripeSession), so a payment is recorded once and an expired order released once. If
// Stripe can't be reached, the page is handed back as before.
async function repeatCheckout(o, hash, s, res) {
  if (!o || o.checkout_hash !== hash) return res.status(409).json({ error: 'checkout_changed' });
  if (o.status === 'cancelled') return res.status(409).json({ error: 'checkout_ended' });
  if (o.payment_method === 'card') {
    const paid = x => res.json({ ok: true, ref: x.ref, status: x.status, paid: true, total_cents: x.total_cents, payment_method: 'card' });
    if (o.paid_at) return paid(o);
    if (!o.stripe_url) return res.status(409).json({ error: 'checkout_in_progress' });
    let sess;
    try { sess = await stripeSession(o.stripe_session); }
    catch (e) {
      console.error(`Could not check the Stripe page of ${o.ref}:`, e.message);
      return res.json({ ok: true, ref: o.ref, redirect: o.stripe_url });
    }
    if (applyStripeSession(o, sess).paid) flushMails();
    const now = db.prepare('SELECT * FROM orders WHERE id = ?').get(o.id);
    if (now.paid_at) return paid(now);
    if (now.status === 'cancelled') return res.status(409).json({ error: 'checkout_ended' });
    if (sess.status === 'open') return res.json({ ok: true, ref: o.ref, redirect: o.stripe_url });
    return res.status(409).json({ error: 'checkout_in_progress' });
  }
  res.json({ ok: true, ref: o.ref, total_cents: o.total_cents, payment_method: o.payment_method, ...paymentInfo(s, o.payment_method) });
}

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
    if (!o.paid_at) {
      // same decision as the webhook and the 15-minute check (order, amount and currency must match;
      // a cancelled order stays cancelled, but the payment is recorded so a refund shows as due)
      if (applyStripeSession(o, await stripeSession(o.stripe_session)).paid) flushMails();
    }
    // "paid" (was the money received?) is separate from "status" (what happens to the order):
    // a cancelled order can still have been charged, and the return page must say so.
    const now = db.prepare('SELECT status, paid_at FROM orders WHERE id = ?').get(o.id);
    res.json({ ok: true, ref: o.ref, status: now.status, paid: !!now.paid_at, total_cents: o.total_cents, payment_method: 'card' });
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
  const r = await fetch(STRIPE_API + url, {
    method,
    headers: { Authorization: `Bearer ${STRIPE_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params ? new URLSearchParams(params).toString() : undefined,
    signal: AbortSignal.timeout(15000),     // a hanging Stripe call counts as an error, never as an answer
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error?.message || 'Stripe error');
  return data;
}
// Close the Stripe payment page of a cancelled card order (best effort). Stripe refuses if the
// customer has just paid; the Stripe check then records it. The order's CURRENT state decides, not
// an earlier snapshot: one statement claims it only if it is still cancelled and unpaid AND no other
// close attempt holds a live claim (one attempt at a time); reinstating answers 409 while a claim is
// live (see PUT /api/admin/orders/:id). The claim carries this attempt's token and only this attempt
// can release it. No transaction is open during the Stripe call. A claim older than
// STRIPE_EXPIRE_CLAIM is dead (its Stripe call timed out long ago, or the server stopped) and can
// be taken over; its late release then changes nothing (wrong token).
const STRIPE_EXPIRE_CLAIM = '-1 minutes';   // the Stripe call times out after 15 s
async function expireCancelledSession(orderId) {
  if (!STRIPE_KEY) return false;
  const token = crypto.randomUUID();
  const o = db.prepare(`UPDATE orders SET stripe_expiring_at = datetime('now'), stripe_expiring_token = ?
    WHERE id = ? AND status = 'cancelled' AND paid_at IS NULL AND payment_method = 'card' AND stripe_session IS NOT NULL
      AND (stripe_expiring_at IS NULL OR stripe_expiring_at <= datetime('now', ?))
    RETURNING stripe_session`).get(token, orderId, STRIPE_EXPIRE_CLAIM);
  if (!o) return false;               // not cancelled any more, or another attempt is closing it right now
  try {
    await stripe('POST', `/v1/checkout/sessions/${encodeURIComponent(o.stripe_session)}/expire`);
    return true;
  } catch (e) {
    console.error('Could not close the Stripe payment page:', e.message);
    return false;
  } finally {
    db.prepare('UPDATE orders SET stripe_expiring_at = NULL, stripe_expiring_token = NULL WHERE id = ? AND stripe_expiring_token = ?').run(orderId, token);
  }
}
// A Checkout Session, with its payment and charge, so we know when the money was actually taken
function stripeSession(id) {
  return stripe('GET', `/v1/checkout/sessions/${encodeURIComponent(id)}?expand[]=payment_intent.latest_charge`);
}
// When Stripe took the money: the successful charge's time, as a UTC 'YYYY-MM-DD HH:MM:SS' like
// the other dates in the database (Finance groups payments by it). null if Stripe didn't say.
function stripePaidAt(sess) {
  const ch = sess?.payment_intent?.latest_charge;
  const t = ch?.status === 'succeeded' ? ch.created : null;
  if (!Number.isInteger(t) || t <= 0 || t * 1000 > Date.now() + 5 * 60 * 1000) return null;
  return new Date(t * 1000).toISOString().slice(0, 19).replace('T', ' ');
}
function stripeCheckout({ ref, email, lang, items, shipping, base }) {
  const p = {
    mode: 'payment',
    // Card only: a card payment is finished (paid or not) when the customer leaves the payment page.
    // Delayed methods (bank debits, vouchers…) could fail days later, which this shop can't detect.
    'payment_method_types[0]': 'card',
    customer_email: email,
    client_reference_id: ref,
    locale: lang,
    success_url: `${base}/checkout/success?ref=${ref}&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${base}/checkout?cancelled=1`,
    'metadata[ref]': ref,
    // The payment page closes after 1 hour, so an abandoned order can be released soon after
    // (see expireUnpaidOrders). Stripe accepts 30 minutes to 24 hours.
    expires_at: Math.floor(Date.now() / 1000) + CARD_SESSION_MINUTES * 60,
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
  // in production the panel warns when no backup has been copied off the server for 2 days
  backup: (b => ({ ...b, warn: IS_PROD && b.offsite_stale }))(backupStatus()),
  open_withdrawals: db.prepare('SELECT COUNT(*) c FROM withdrawals WHERE handled = 0').get().c,
  overdue_orders: db.prepare(`SELECT COUNT(*) c FROM orders WHERE ${OVERDUE}`).get().c,
  upload: { photo_mb: MAX_PHOTO_MB, video_mb: MAX_VIDEO_MB, photo_ext: IMG_EXT, video_ext: VID_EXT },
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
  // Money in the last 30 days, from payment and refund records (not from order status):
  // payments counted on the day they were received, refunds on the day they were given back.
  const paid30 = one("SELECT COALESCE(SUM(total_cents), 0) s FROM orders WHERE paid_at >= datetime('now', '-30 day')").s;
  const refunded30 = one("SELECT COALESCE(SUM(amount_cents), 0) s FROM refunds WHERE created_at >= datetime('now', '-30 day')").s;
  res.json({
    pending: one("SELECT COUNT(*) c FROM orders WHERE status = 'pending'").c,
    needs_refund: one(`SELECT COUNT(*) c FROM orders WHERE ${NEEDS_REFUND}`).c,
    payment_unknown: one('SELECT COUNT(*) c FROM orders WHERE payment_unknown = 1').c,
    to_ship: one("SELECT COUNT(*) c FROM orders WHERE status = 'paid'").c,
    orders_30d: one("SELECT COUNT(*) c FROM orders WHERE created_at >= datetime('now','-30 day') AND status != 'cancelled'").c,
    paid_30d: paid30,
    refunded_30d: refunded30,
    revenue_30d: paid30 - refunded30,
    customers: one('SELECT COUNT(*) c FROM users').c,
    views: db.prepare(`SELECT p.id, p.name_en AS name,
        SUM(CASE WHEN v.day >= date('now','-7 day') THEN 1 ELSE 0 END) AS d7,
        SUM(CASE WHEN v.day >= date('now','-30 day') THEN 1 ELSE 0 END) AS d30
      FROM products p LEFT JOIN product_views v ON v.product_id = p.id
      GROUP BY p.id ORDER BY d30 DESC`).all(),
  });
});

// Uploads: returns [{ type, src }]
app.post('/api/admin/upload', requireAdmin, upload.array('files', 1), (req, res) => {
  const out = [];
  for (const f of req.files || []) {
    const isVideo = VID_EXT.includes(path.extname(f.filename));
    // The exact maximum, on the finished file (Multer's limit is a little higher, see MULTER_FILE_LIMIT)
    if (isVideo && f.size > MAX_VIDEO_BYTES) {
      fs.unlinkSync(f.path);
      return res.status(400).json({ error: `File too large — video en fazla ${MAX_VIDEO_MB} MB` });
    }
    if (!isVideo && f.size > MAX_PHOTO_BYTES) { fs.unlinkSync(f.path); continue; }   // photos max 12 MB
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
// Money given back for an order = the sum of its refund rows. A paid order that was cancelled
// should be refunded in full: needs_refund / refund_due_cents say whether and how much is still owed.
const REFUNDED = '(SELECT COALESCE(SUM(r.amount_cents), 0) FROM refunds r WHERE r.order_id = orders.id)';
const NEEDS_REFUND = `(orders.status = 'cancelled' AND orders.paid_at IS NOT NULL AND ${REFUNDED} < orders.total_cents)`;
const ORDER_COLS = `orders.*, (SELECT COUNT(*) FROM withdrawals w WHERE w.order_id = orders.id) AS withdrawals,
  (SELECT json_group_array(json_object('kind', m.kind, 'state', m.state)) FROM mail_outbox m WHERE m.order_id = orders.id) AS mails,
  ${REFUNDED} AS refund_total_cents,
  ${NEEDS_REFUND} AS needs_refund,
  CASE WHEN ${NEEDS_REFUND} THEN orders.total_cents - ${REFUNDED} ELSE 0 END AS refund_due_cents,
  (SELECT json_group_array(json_object('amount_cents', r.amount_cents, 'note', r.note, 'created_at', r.created_at))
     FROM (SELECT * FROM refunds WHERE order_id = orders.id ORDER BY id) r) AS refunds,
  (SELECT json_group_array(json_object('answer', c.answer, 'created_at', c.created_at))
     FROM (SELECT * FROM payment_checks WHERE order_id = orders.id ORDER BY id) c) AS payment_checks`;
// Bizum/transfer orders more than 5 days unpaid, for the admin to check (the Orders tab badge counts these)
const OVERDUE = "status = 'pending' AND paid_at IS NULL AND overdue_at IS NOT NULL";
app.get('/api/admin/orders', requireAdmin, (req, res) => {
  const st = req.query.status;
  // ?status=overdue: every overdue order, oldest first (they are the oldest: the newest 500 may not include them)
  if (st === 'overdue') return res.json(db.prepare(`SELECT ${ORDER_COLS} FROM orders WHERE ${OVERDUE} ORDER BY id LIMIT 500`).all());
  const rows = STATUSES.includes(st)
    ? db.prepare(`SELECT ${ORDER_COLS} FROM orders WHERE status = ? ORDER BY id DESC LIMIT 500`).all(st)
    : db.prepare(`SELECT ${ORDER_COLS} FROM orders ORDER BY id DESC LIMIT 500`).all();
  res.json(rows);
});
// "Was this old cancelled order paid?" (orders flagged payment_unknown by the migration).
// Every answer is saved with its date in payment_checks. A wrong answer can be corrected
// (confirm_correction: true); the correction is a new row, so the history shows both.
// - 'paid' records a payment on the order date (estimated), paid_via = 'check'
// - correcting to 'unpaid' removes only that 'check' payment, and only if nothing was refunded
//   (refunds are permanent); real payments (Stripe, admin, legacy) are never touched here
function answerPaymentCheck(o, b, res) {
  const answer = b.payment_check;
  const fail = msg => res.status(400).json({ error: msg });
  if (!['paid', 'unpaid'].includes(answer)) return fail('Geçersiz ödeme kontrolü');
  const last = db.prepare('SELECT answer FROM payment_checks WHERE order_id = ? ORDER BY id DESC LIMIT 1').get(o.id);
  if (!last && !o.payment_unknown) return fail('Bu siparişte ödeme kontrolü yok');
  if (last && b.confirm_correction !== true) return fail('Önceki cevabı değiştirmek için onay gerekli');
  if (last && last.answer === answer) return fail('Cevap zaten bu');
  if (answer === 'unpaid' && o.paid_at) {
    if (o.paid_via !== 'check') return fail('Bu ödeme kontrolden gelmiyor; buradan silinemez');
    const refunded = db.prepare('SELECT COALESCE(SUM(amount_cents), 0) s FROM refunds WHERE order_id = ?').get(o.id).s;
    if (refunded > 0) return fail('Bu siparişte iade kaydı var; "ödenmemişti" yapılamaz');
  }
  inTransaction(() => {
    db.prepare('INSERT INTO payment_checks (order_id, answer) VALUES (?, ?)').run(o.id, answer);
    db.prepare('UPDATE orders SET payment_unknown = 0 WHERE id = ?').run(o.id);
    if (answer === 'paid' && !o.paid_at)        // real day unknown: use the order date, marked as estimated
      db.prepare("UPDATE orders SET paid_at = created_at, paid_at_estimated = 1, paid_via = 'check' WHERE id = ?").run(o.id);
    if (answer === 'unpaid' && o.paid_at)
      db.prepare('UPDATE orders SET paid_at = NULL, paid_at_estimated = 0, paid_via = NULL WHERE id = ?').run(o.id);
  });
  res.json({ ok: true, mailed: false });
}

app.put('/api/admin/orders/:id', requireAdmin, (req, res) => {
  const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!o) return res.status(404).json({ error: 'Not found' });
  const b = req.body || {};
  if (b.payment_check !== undefined) return answerPaymentCheck(o, b, res);
  const status = STATUSES.includes(b.status) ? b.status : o.status;

  // Refunds are separate, dated records (POST .../refunds); saving the order never changes them
  if (b.refunded_cents !== undefined)
    return res.status(400).json({ error: 'İadeyi "İade ekle" ile kaydet' });

  // The payment record does not follow the status. Going back to "pending" only removes a payment
  // the admin marked by hand (a mistake), and only if nothing was refunded. A payment confirmed by
  // Stripe or from before payment dates were stored is never erased.
  let undoManualPayment = false;
  if (status === 'pending' && o.paid_at) {
    const refunded = db.prepare('SELECT COALESCE(SUM(amount_cents), 0) s FROM refunds WHERE order_id = ?').get(o.id).s;
    if (o.paid_via !== 'admin' || refunded > 0)
      return res.status(400).json({ error: 'Bu siparişin ödemesi kayıtlı; "Ödeme bekliyor" yapılamaz. Para geri verildiyse siparişi iptal edip iade ekle.' });
    undoManualPayment = true;
  }

  let newlyPaid = null;
  try {
    inTransaction(() => {
      // reinstating: "cancelled" e-mails that haven't left yet must not go; undoing a payment: nor "paid" ones
      if (status !== 'cancelled') dropMails(o.id, CANCELLED_MAILS);
      if (undoManualPayment || (status === 'cancelled' && o.status !== 'cancelled')) dropMails(o.id, PAID_MAILS);
      // reinstating a card order whose Stripe payment page is being closed right now: wait for that
      if (status !== 'cancelled' && db.prepare("SELECT 1 FROM orders WHERE id = ? AND stripe_expiring_at > datetime('now', ?)").get(o.id, STRIPE_EXPIRE_CLAIM))
        throw Object.assign(new Error('Stripe ödeme sayfası şu an kapatılıyor. Birkaç saniye sonra tekrar dene.'), { status: 409 });
      // Put stock back when an order is cancelled, take it again if un-cancelled (only if there is enough)
      if (status !== o.status && status === 'cancelled') returnStock(JSON.parse(o.items));
      if (status !== o.status && o.status === 'cancelled')
        takeStock(JSON.parse(o.items), (p, qty) => `Stok yetersiz: ${p.name_en} (stokta ${p.stock}, gereken ${qty})`);
      // un-cancelling an automatically cancelled order also clears the "auto-cancelled" note
      db.prepare(`UPDATE orders SET status = ?, tracking = ?,
          auto_cancelled_at = CASE WHEN ? = 'cancelled' THEN auto_cancelled_at END,
          auto_cancel_reason = CASE WHEN ? = 'cancelled' THEN auto_cancel_reason END WHERE id = ?`)
        .run(status, b.tracking !== undefined ? str(b.tracking, 200) : o.tracking, status, status, o.id);
      if (undoManualPayment)
        db.prepare('UPDATE orders SET paid_at = NULL, paid_at_estimated = 0, paid_via = NULL WHERE id = ?').run(o.id);
      if (PAID_STATUSES.includes(status)) newlyPaid = recordPayment(o.id, 'admin');
    });
  } catch (e) {
    return res.status(e.status || 400).json({ error: e.message });
  }
  if (newlyPaid) flushMails();
  // An unpaid card order was cancelled: close its Stripe payment page so it can't be paid any more.
  // (Not relied on: the Stripe check keeps watching cancelled card orders until Stripe is final.)
  if (status === 'cancelled' && o.status !== 'cancelled' && o.payment_method === 'card' && !o.paid_at) expireCancelledSession(o.id);
  // Tell the customer when the order is paid, shipped or cancelled
  let mailed = false;
  if (status !== o.status && b.notify !== false && ['paid', 'shipped', 'cancelled'].includes(status)) {
    mailed = mail.enabled;
    mail.statusUpdate(db.prepare('SELECT * FROM orders WHERE id = ?').get(o.id), getSettings(), baseUrl(req));
  }
  res.json({ ok: true, mailed });
});

// Check unpaid orders now (it also runs by itself every 15 minutes). Answers within
// EXPIRY_REPLY_MS: with what was done, or — if Stripe is slow — 202 "still running"; the run
// then finishes in the background (one run at a time) and the order list shows the result.
app.post('/api/admin/orders/expire-unpaid', requireAdmin, async (req, res) => {
  const run = expireUnpaidOrders();
  let timer;
  try {
    const r = await Promise.race([run, new Promise(ok => { timer = setTimeout(ok, EXPIRY_REPLY_MS, null); })]);
    if (r) return res.json({ ok: true, done: true, ...r });
    run.catch(e => console.error('Unpaid order check failed:', e.message));
    res.status(202).json({ ok: true, done: false, running: true });
  } catch (e) {
    console.error('Unpaid order check failed:', e.message);
    res.status(500).json({ error: 'Kontrol başarısız' });
  } finally { clearTimeout(timer); }
});

// The admin checked the bank/Bizum: an overdue Bizum/transfer order was NOT paid → cancel it,
// return its stock (same transaction) and e-mail the customer (retried if it fails).
// Only for orders still pending, unpaid and overdue; needs { confirm: true }.
app.post('/api/admin/orders/:id/cancel-unpaid', requireAdmin, (req, res) => {
  const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!o) return res.status(404).json({ error: 'Not found' });
  if ((req.body || {}).confirm !== true) return res.status(400).json({ error: 'Onay gerekli' });
  if (!['bizum', 'transfer'].includes(o.payment_method) || !o.overdue_at)
    return res.status(400).json({ error: 'Bu sipariş 5 günü geçmiş bir Bizum/havale siparişi değil' });
  if (!autoCancel(o.id, 'unpaid_5_days', { notify: true }))
    return res.status(409).json({ error: 'Sipariş artık ödeme bekliyor durumunda değil (ödendi ya da iptal edildi)' });
  flushMails();
  res.json({ ok: true, mail: mail.enabled });
});

// A Bizum/transfer (or "contact") payment that arrived AFTER the order was cancelled — e.g. the
// customer paid on day 6 and the returned stock has been sold since. The payment is recorded on the
// day the money arrived (paid_on, Madrid date; default today), the order STAYS cancelled and no
// stock is taken. The order then shows "refund due" and the refund is added as usual (İade ekle).
// Finance: income on paid_on, refund when it is made. Recorded once only; needs { confirm: true }.
app.post('/api/admin/orders/:id/late-payment', requireAdmin, (req, res) => {
  const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!o) return res.status(404).json({ error: 'Not found' });
  const b = req.body || {};
  if (b.confirm !== true) return res.status(400).json({ error: 'Onay gerekli' });
  if (!['bizum', 'transfer', 'contact'].includes(o.payment_method))
    return res.status(400).json({ error: 'Kart ödemeleri Stripe üzerinden kaydedilir' });
  if (o.payment_unknown) return res.status(400).json({ error: 'Bu eski sipariş için "ödenmiş miydi?" sorusunu cevapla' });
  const today = finance.localDate();
  const paidOn = b.paid_on === undefined || b.paid_on === '' ? today : finance.parseDate(b.paid_on);
  if (!paidOn) return res.status(400).json({ error: 'Geçersiz ödeme tarihi (ör. 2026-10-23)' });
  if (paidOn > today) return res.status(400).json({ error: 'Ödeme tarihi gelecekte olamaz' });
  if (paidOn < finance.utcTextToLocalDate(o.created_at)) return res.status(400).json({ error: 'Ödeme tarihi sipariş tarihinden önce olamaz' });
  let recorded;
  try {
    recorded = inTransaction(() => {
      dropMails(o.id, ['expired']);   // the money arrived: "payment not received" must not go out now
      return db.prepare(`UPDATE orders SET paid_at = ?, paid_at_estimated = 0, paid_via = 'late',
          late_payment_recorded_at = datetime('now') WHERE id = ? AND status = 'cancelled' AND paid_at IS NULL`)
        .run(finance.localDayStartUtc(paidOn), o.id).changes === 1;
    });
  } catch (e) {
    return res.status(e.status || 400).json({ error: e.message });
  }
  if (!recorded) return res.status(409).json({ error: 'Bu sipariş iptal değil ya da ödemesi zaten kayıtlı' });
  res.json({ ok: true, order: db.prepare(`SELECT ${ORDER_COLS} FROM orders WHERE id = ?`).get(o.id) });
});

// Add a refund (money actually given back). Refunds are only added, never edited, so the dated
// history stays complete; several partial refunds are fine up to the order total.
app.post('/api/admin/orders/:id/refunds', requireAdmin, (req, res) => {
  const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!o) return res.status(404).json({ error: 'Not found' });
  const b = req.body || {};
  const amount = b.amount_cents;
  if (!Number.isInteger(amount) || amount <= 0)
    return res.status(400).json({ error: 'İade tutarı 0’dan büyük olmalı (ör. 12,50)' });
  if (!o.paid_at) return res.status(400).json({ error: 'Ödenmemiş siparişte iade olamaz' });
  try {
    inTransaction(() => {
      const done = db.prepare('SELECT COALESCE(SUM(amount_cents), 0) s FROM refunds WHERE order_id = ?').get(o.id).s;
      if (done + amount > o.total_cents)
        throw new Error(`İade, kalan tutarı aşamaz (en fazla ${((o.total_cents - done) / 100).toFixed(2)} €)`);
      db.prepare('INSERT INTO refunds (order_id, amount_cents, note) VALUES (?, ?, ?)').run(o.id, amount, str(b.note, 200));
    });
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
  res.json({ ok: true, order: db.prepare(`SELECT ${ORDER_COLS} FROM orders WHERE id = ?`).get(o.id) });
});

// Customers
app.get('/api/admin/customers', requireAdmin, (req, res) => {
  res.json(db.prepare(`
    SELECT u.id, u.name, u.email, u.phone, u.address, u.city, u.zip, u.province, u.country, u.car, u.created_at,
      COUNT(o.id) AS orders,
      COALESCE(SUM(CASE WHEN o.paid_at IS NOT NULL THEN o.total_cents
        - (SELECT COALESCE(SUM(r.amount_cents), 0) FROM refunds r WHERE r.order_id = o.id) END), 0) AS spent_cents,
      MAX(o.created_at) AS last_order
    FROM users u LEFT JOIN orders o ON o.user_id = u.id
    GROUP BY u.id ORDER BY u.id DESC`).all());
});
app.get('/api/admin/customers/:id', requireAdmin, (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!u) return res.status(404).json({ error: 'Not found' });
  // also show guest orders made with the same email before registering
  const orders = db.prepare(`SELECT ${ORDER_COLS} FROM orders WHERE user_id = ? OR (user_id IS NULL AND lower(email) = ?) ORDER BY id DESC`)
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
// Finance tab (income / expenses); every route there requires an admin session
finance.register(app, { db, requireAdmin });

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

// Database snapshot every hour (data/backups: last 48 hours + one a day for 30 days). Taking them
// off the server, encrypted, is scripts/backup-offsite.sh (cron, README → Yedek).
backup();
setInterval(() => backup(), 3600 * 1000).unref();

// In production listen on this machine only: visitors reach the app through Nginx (https), never
// directly over plain http. HOST can override it (e.g. HOST=0.0.0.0), but read the README first.
const HOST = process.env.HOST || (IS_PROD ? '127.0.0.1' : undefined);
const server = app.listen(PORT, HOST, () => {
  // Only once the port is ours: a start that fails (e.g. EADDRINUSE because another instance
  // is running on the same data) must not log out that instance's admins.
  revokeAdminSessions();
  console.log(`Vornetic → http://localhost:${PORT}   Admin → http://localhost:${PORT}/admin`);
  // Nothing can be mid-send in a server that just started: e-mails left 'sending' by a stopped one
  // are sent again (rarely a duplicate, never lost)
  db.prepare("UPDATE mail_outbox SET state = 'due', claimed_at = NULL, next_try_at = NULL WHERE state = 'sending'").run();
  // Release unpaid orders now and every 15 minutes (see expireUnpaidOrders); it also sends queued e-mails
  const expire = () => expireUnpaidOrders().catch(e => console.error('Unpaid order check failed:', e.message));
  expire();
  setInterval(expire, 15 * 60 * 1000).unref();
});
server.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n✖ Port ${PORT} is already used by another program (maybe another project).`);
    console.error(`  Close it, or start Vornetic on another port:  set PORT=3400 && npm start\n`);
    process.exit(1);
  }
  throw err;
});
