// test/reviews.test.js — product reviews: only customers whose account order with the product was
// shipped can write one (one per product, editable); the shop can reply or hide, never write or edit.
// Real server, throwaway data, test-only accounts.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, CUSTOMER } = require('./helpers');

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);

async function setup() {
  const srv = await startServer();
  let ip = 10;
  // a customer account: its cookie and helpers that act as that customer
  srv.customer = async (name, email) => {
    const r = await srv.call('POST', '/api/account/register', { email, password: 'test-only-pass-123', name });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    const cookie = r.headers.get('set-cookie').split(';')[0];
    const as = (method, url, body) => srv.call(method, url, body, { Cookie: cookie });
    return {
      cookie, as,
      order: items => srv.call('POST', '/api/orders', { ...CUSTOMER, email, payment_method: 'contact', items },
        { Cookie: cookie, 'X-Forwarded-For': `198.51.100.${ip++}` }),
      // the review form as the browser sends it (multipart, optional photo)
      async review(slug, fields, photo) {
        const fd = new FormData();
        for (const [k, v] of Object.entries(fields)) fd.append(k, String(v));
        if (photo) fd.append('photo', new Blob([photo.data]), photo.name);
        const res = await fetch(`${srv.base}/api/products/${slug}/review`, {
          method: 'POST', body: fd, headers: { Cookie: cookie, 'X-Forwarded-Proto': 'https' } });
        return { status: res.status, body: await res.json() };
      },
    };
  };
  srv.product = async (name_es = 'Artículo test') => {
    const cat = (await srv.admin('GET', '/api/admin/categories')).body[0].slug;
    const r = await srv.admin('POST', '/api/admin/products', { category: cat, name_en: 'Test item', name_es, price_cents: 1000, stock: 50 });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    return r.body;
  };
  srv.reviews = (slug, cookie) => srv.call('GET', `/api/products/${slug}/reviews`, undefined, cookie ? { Cookie: cookie } : {});
  return srv;
}

test('only a customer whose account order with the product was shipped can review it', async () => {
  const srv = await setup();
  try {
    const p = await srv.product();
    const other = await srv.product('Otro artículo');
    // not logged in
    assert.deepStrictEqual((await srv.reviews(p.slug)).body, { count: 0, avg: null, reviews: [], me: null });
    assert.strictEqual((await srv.call('POST', `/api/products/${p.slug}/review`, { rating: 5 })).status, 401);

    const ana = await srv.customer('Ana García López', 'ana@example.test');
    const o = await ana.order([{ id: p.id, qty: 1 }]);
    assert.strictEqual(o.status, 200, JSON.stringify(o.body));
    // order not shipped yet
    assert.strictEqual((await srv.reviews(p.slug, ana.cookie)).body.me.can_review, false);
    assert.deepStrictEqual(await ana.review(p.slug, { rating: 5 }), { status: 403, body: { error: 'review_not_buyer' } });
    // a guest order (no account) with someone's e-mail does not count either
    const ben = await srv.customer('Ben', 'ben@example.test');
    const guest = await srv.call('POST', '/api/orders', { ...CUSTOMER, email: 'ben@example.test', payment_method: 'contact', items: [{ id: p.id, qty: 1 }] },
      { 'X-Forwarded-For': '198.51.100.99' });
    assert.strictEqual((await srv.setOrder(guest.body.ref, { status: 'shipped' })).status, 200);
    assert.deepStrictEqual(await ben.review(p.slug, { rating: 1 }), { status: 403, body: { error: 'review_not_buyer' } });

    // shipped: Ana can review this product, not another one
    assert.strictEqual((await srv.setOrder(o.body.ref, { status: 'shipped' })).status, 200);
    assert.strictEqual((await srv.reviews(p.slug, ana.cookie)).body.me.can_review, true);
    assert.strictEqual((await ana.review(other.slug, { rating: 5 })).status, 403);
    assert.deepStrictEqual(await ana.review(p.slug, { rating: 6 }), { status: 400, body: { error: 'review_rating' } });
    assert.deepStrictEqual(await ana.review(p.slug, { rating: 4, text: 'x'.repeat(2001) }), { status: 400, body: { error: 'review_text_long' } });
    assert.deepStrictEqual(await ana.review(p.slug, { rating: 5, text: '  Muy buena luz.  ', lang: 'es' }), { status: 200, body: { ok: true } });

    const pub = (await srv.reviews(p.slug)).body;
    assert.deepStrictEqual([pub.count, pub.avg], [1, 5]);
    const r = pub.reviews[0];
    assert.deepStrictEqual([r.name, r.rating, r.text, r.verified, r.photo, r.reply], ['Ana G.', 5, 'Muy buena luz.', true, '', '']);
    assert.ok(!JSON.stringify(pub).includes('ana@example.test'), 'no e-mail in public reviews');
    assert.ok(!JSON.stringify(pub).includes('López'), 'no full name in public reviews');

    // writing again edits the same review (one per product and customer)
    assert.strictEqual((await ana.review(p.slug, { rating: 3, text: 'Cambio de opinión' })).status, 200);
    const pub2 = (await srv.reviews(p.slug)).body;
    assert.deepStrictEqual([pub2.count, pub2.avg, pub2.reviews[0].text], [1, 3, 'Cambio de opinión']);
    assert.deepStrictEqual((await srv.reviews(p.slug, ana.cookie)).body.me.mine, { rating: 3, text: 'Cambio de opinión', photo: '', status: 'visible' });
  } finally { await srv.stop(); }
});

test('review photo: real JPG/PNG/WEBP only, max 5 MB, old photo removed', async () => {
  const srv = await setup();
  try {
    const p = await srv.product();
    const c = await srv.customer('Carla Ruiz', 'carla@example.test');
    const o = await c.order([{ id: p.id, qty: 1 }]);
    await srv.setOrder(o.body.ref, { status: 'delivered' });
    // a text file named .jpg is refused (the first bytes decide, not the name)
    assert.deepStrictEqual(await c.review(p.slug, { rating: 5 }, { data: Buffer.from('<svg onload=alert(1)>'), name: 'x.jpg' }),
      { status: 400, body: { error: 'review_photo_type' } });
    assert.deepStrictEqual(await c.review(p.slug, { rating: 5 }, { data: Buffer.alloc(5 * 1024 * 1024 + 10, 0xff), name: 'big.jpg' }),
      { status: 400, body: { error: 'review_photo_big' } });
    assert.strictEqual((await srv.reviews(p.slug)).body.count, 0, 'nothing saved');

    assert.strictEqual((await c.review(p.slug, { rating: 5 }, { data: PNG, name: 'IMG_1.HEIC' })).status, 200);
    const photo = (await srv.reviews(p.slug)).body.reviews[0].photo;
    assert.match(photo, /^\/uploads\/r-[0-9a-f]{16}\.png$/, 'stored with the real type');
    const file = path.join(srv.dataDir, 'uploads', path.basename(photo));
    assert.ok(fs.existsSync(file));
    assert.strictEqual((await fetch(srv.base + photo)).status, 200);

    // removing the photo deletes the file; editing without a photo keeps it
    assert.strictEqual((await c.review(p.slug, { rating: 4 })).status, 200);
    assert.strictEqual((await srv.reviews(p.slug)).body.reviews[0].photo, photo);
    assert.strictEqual((await c.review(p.slug, { rating: 4, remove_photo: '1' })).status, 200);
    assert.strictEqual((await srv.reviews(p.slug)).body.reviews[0].photo, '');
    assert.strictEqual(fs.existsSync(file), false, 'old photo file deleted');
  } finally { await srv.stop(); }
});

test('admin: reply and hide only; hidden reviews leave the page, the average and the JSON-LD', async () => {
  const srv = await setup();
  try {
    const p = await srv.product();
    const d = await srv.customer('Diego', 'diego@example.test');
    const o = await d.order([{ id: p.id, qty: 1 }]);
    await srv.setOrder(o.body.ref, { status: 'shipped' });
    await d.review(p.slug, { rating: 2, text: 'Llegó tarde' }, { data: PNG, name: 'a.png' });
    let page = (await srv.call('GET', '/p/' + p.slug)).text;
    assert.match(page, /"aggregateRating":\{"@type":"AggregateRating","ratingValue":2,"reviewCount":1/);

    const list = (await srv.admin('GET', '/api/admin/reviews')).body;
    assert.strictEqual(list.length, 1);
    assert.deepStrictEqual([list[0].user_email, list[0].order_ref, list[0].product_name], ['diego@example.test', o.body.ref, 'Artículo test']);
    const id = list[0].id;
    // the shop cannot change what the customer wrote
    assert.strictEqual((await srv.admin('PUT', '/api/admin/reviews/' + id, { rating: 5, text: 'Perfecto' })).status, 200);
    let pub = (await srv.reviews(p.slug)).body.reviews[0];
    assert.deepStrictEqual([pub.rating, pub.text], [2, 'Llegó tarde']);
    // reply
    assert.strictEqual((await srv.admin('PUT', '/api/admin/reviews/' + id, { reply: 'Sentimos el retraso.' })).status, 200);
    pub = (await srv.reviews(p.slug)).body.reviews[0];
    assert.strictEqual(pub.reply, 'Sentimos el retraso.');
    assert.ok(pub.reply_at);
    const tooLong = await srv.call('PUT', '/api/admin/reviews/' + id, { reply: 'x'.repeat(1001) }, { Cookie: srv.cookie, 'X-Admin-Lang': 'es' });
    assert.deepStrictEqual([tooLong.status, tooLong.body.error], [400, 'La respuesta puede tener como máximo 1000 caracteres']);
    const bad = await srv.call('PUT', '/api/admin/reviews/' + id, { status: 'deleted' }, { Cookie: srv.cookie, 'X-Admin-Lang': 'es' });
    assert.deepStrictEqual([bad.status, bad.body.error], [400, 'Estado no válido']);
    // hide
    assert.strictEqual((await srv.admin('PUT', '/api/admin/reviews/' + id, { status: 'hidden' })).status, 200);
    assert.deepStrictEqual((await srv.reviews(p.slug)).body, { count: 0, avg: null, reviews: [], me: null });
    assert.strictEqual((await srv.reviews(p.slug, d.cookie)).body.me.mine.status, 'hidden', 'the customer is told');
    page = (await srv.call('GET', '/p/' + p.slug)).text;
    assert.ok(!page.includes('aggregateRating'));
    // editing keeps it hidden (the shop's decision) and keeps the reply
    await d.review(p.slug, { rating: 3, text: 'Llegó tarde pero funciona' });
    assert.strictEqual((await srv.reviews(p.slug)).body.count, 0);
    assert.strictEqual((await srv.admin('GET', '/api/admin/reviews?status=hidden')).body[0].reply, 'Sentimos el retraso.');
    assert.strictEqual((await srv.admin('PUT', '/api/admin/reviews/' + id, { status: 'visible' })).status, 200);
    assert.strictEqual((await srv.reviews(p.slug)).body.count, 1);
    // not logged in as admin
    assert.strictEqual((await srv.call('GET', '/api/admin/reviews')).status, 401);
  } finally { await srv.stop(); }
});

test('a customer can delete their review; deleting the account deletes its reviews and photos', async () => {
  const srv = await setup();
  try {
    const p = await srv.product();
    const e = await srv.customer('Eva Mora', 'eva@example.test');
    const o = await e.order([{ id: p.id, qty: 1 }]);
    await srv.setOrder(o.body.ref, { status: 'shipped' });
    await e.review(p.slug, { rating: 5 }, { data: PNG, name: 'a.png' });
    let photo = (await srv.reviews(p.slug)).body.reviews[0].photo;
    const file = () => path.join(srv.dataDir, 'uploads', path.basename(photo));
    assert.ok(fs.existsSync(file()));
    assert.strictEqual((await e.as('DELETE', `/api/products/${p.slug}/review`)).status, 200);
    assert.strictEqual((await srv.reviews(p.slug)).body.count, 0);
    assert.strictEqual(fs.existsSync(file()), false);

    await e.review(p.slug, { rating: 4 }, { data: PNG, name: 'b.png' });
    photo = (await srv.reviews(p.slug)).body.reviews[0].photo;
    const user = (await srv.admin('GET', '/api/admin/customers')).body.find(u => u.email === 'eva@example.test');
    assert.strictEqual((await srv.admin('DELETE', '/api/admin/customers/' + user.id)).status, 200);
    assert.strictEqual((await srv.reviews(p.slug)).body.count, 0);
    assert.strictEqual((await srv.admin('GET', '/api/admin/reviews')).body.length, 0);
    assert.strictEqual(fs.existsSync(file()), false);
  } finally { await srv.stop(); }
});

test('product page and admin panel have the review texts in both languages', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'public/js/app.js'), 'utf8');
  for (const s of ['Compra verificada', 'Verified purchase', 'Todas las opiniones son de clientes que han comprado']) assert.ok(app.includes(s), s);
  for (const code of ['review_rating', 'review_text_long', 'review_photo_type', 'review_photo_big', 'review_not_buyer', 'review_bad']) {
    assert.strictEqual(app.split(`err_${code}:`).length, 3, `err_${code} in en and es`);
  }
  const admin = fs.readFileSync(path.join(__dirname, '..', 'public/js/admin.js'), 'utf8');
  assert.ok(admin.includes("reviews: 'Yorumlar'") && admin.includes("reviews: 'Opiniones'"));
});
