// test/evo-requests.test.js — made-to-measure EVO mats are a REQUEST, not an order. Which vehicles have a template
// (and what a template covers), what a request must contain, what a vehicle without a template means (measured in
// person, Madrid area only), that nothing is charged / reserved / sent to Stripe, the panel's side, and that the
// homepage no longer has the vehicle finder. Real server, throwaway database, fake SMTP and fake Stripe on
// 127.0.0.1, fake customers: no real payments, data or mail.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { startServer, fakeSmtp, fakeStripe, tempDir, ROOT, CUSTOMER } = require('./helpers');
const evo = require('../evo');

// ---------- what a template covers (rules only, no server) ----------
const TPL = evo.SEED_TEMPLATES.map((t, i) => ({ ...t, id: i + 1 }));
const match = (brand, model, year, veh, x = {}) => evo.matchTemplate(TPL, { brand, model, year, veh, ...x });
const kind = r => [r.kind, r.reasons.join(',')];

test('a template covers exactly what it says: model, year, type of vehicle, and wheelbase / roof / layout where named', () => {
  // the vehicles the owner has templates for
  assert.strictEqual(match('bmw', 'Serie 3 E90', 2007, 'sedan').kind, 'candidate');
  assert.strictEqual(match('BMW', '3 Series (E90)', 2007, 'sedan').kind, 'candidate');
  assert.strictEqual(match('Kia', 'SPORTAGE', 2024, 'suv').kind, 'candidate');
  assert.strictEqual(match('Ford', 'Transit Custom Kombi 310', 2017, 'vanmedium', { wheelbase: 'L2', layout: 'kombi' }).kind, 'candidate');
  assert.strictEqual(match('Ford', 'Tourneo Custom', 2017, 'vanmedium', { wheelbase: 'L2', layout: 'kombi' }).kind, 'candidate');
  assert.strictEqual(match('Fiat', 'Ducato 35', 2023, 'vanlarge', { wheelbase: 'L3', roof: 'H3', layout: 'cargo' }).kind, 'candidate');
  // nothing is assumed to fit another year, body, seating arrangement or wheelbase
  assert.deepStrictEqual(kind(match('BMW', 'E90', 2008, 'sedan')), ['none', 'year']);
  assert.deepStrictEqual(kind(match('BMW', 'E90', 2006, 'sedan')), ['none', 'year']);
  assert.deepStrictEqual(kind(match('BMW', 'E90', 2007, 'wagon')), ['none', 'body']);
  assert.deepStrictEqual(kind(match('Kia', 'Sportage', 2023, 'suv')), ['none', 'year']);
  assert.deepStrictEqual(kind(match('Kia', 'Sportage', 2024, 'suvbig')), ['none', 'body']);
  assert.deepStrictEqual(kind(match('Ford', 'Transit Custom', 2017, 'vanmedium', { wheelbase: 'L1', layout: 'kombi' })), ['none', 'wheelbase']);
  assert.deepStrictEqual(kind(match('Ford', 'Transit Custom', 2017, 'vanmedium', { wheelbase: 'L2', layout: 'cargo' })), ['none', 'layout']);
  assert.deepStrictEqual(kind(match('Ford', 'Transit Custom', 2018, 'vanmedium', { wheelbase: 'L2', layout: 'kombi' })), ['none', 'year']);
  assert.deepStrictEqual(kind(match('Fiat', 'Ducato', 2023, 'vanlarge', { wheelbase: 'L3', roof: 'H2', layout: 'cargo' })), ['none', 'roof']);
  assert.deepStrictEqual(kind(match('Fiat', 'Ducato', 2023, 'vanlarge', { wheelbase: 'L4', roof: 'H3', layout: 'cargo' })), ['none', 'wheelbase']);
  assert.deepStrictEqual(kind(match('Fiat', 'Ducato', 2023, 'vanlarge', { wheelbase: 'unknown', roof: 'unknown', layout: 'cargo' })), ['none', 'wheelbase,roof'],
    '"I do not know" never counts as a match');
  assert.strictEqual(match('Fiat', 'Ducato', 2023, 'vanlarge', { wheelbase: 'L3', roof: 'H3', layout: 'crew' }).kind, 'none', 'a crew-cab Ducato is not the cargo van');
  // the closest template of the model says what differs (the page tells the customer)
  assert.strictEqual(match('BMW', 'E90', 2008, 'sedan').template.brand, 'BMW');
});

test('choosing a generic type of vehicle never counts as having a template; unknown brands and models have none', () => {
  for (const veh of evo.BODIES) {
    assert.strictEqual(match('Seat', 'León', 2019, veh).kind, 'none', `Seat León as ${veh}`);
    assert.strictEqual(match('', '', 2019, veh).kind, 'none', `nothing typed as ${veh}`);
  }
  assert.deepStrictEqual(kind(match('Seat', 'León', 2019, 'hatch')), ['none', 'brand']);
  assert.deepStrictEqual(kind(match('Ford', 'Fiesta', 2019, 'hatch')), ['none', 'model'], 'a brand with a template is not a model with one');
  assert.deepStrictEqual(kind(match('BMW', '320d', 2007, 'sedan')), ['none', 'model'], 'only the names the owner listed match');
  assert.strictEqual(match('Kia', 'Sportage Hybrid', 2024, 'suv').kind, 'candidate', 'a longer name that contains the model still matches');
  assert.strictEqual(match('Kia', 'Sorento', 2024, 'suv').kind, 'none');
});

test('Zeekr: the owner has templates but has not confirmed the models: every Zeekr request is reviewed by hand, none is approved', () => {
  for (const [model, year] of [['001', 2024], ['X', 2025], ['7X', 2025], ['Something', 1999]]) {
    const r = match('Zeekr', model, year, 'suv');
    assert.deepStrictEqual([r.kind, r.template.status], ['pending', 'pending'], model);
  }
  // once the owner confirms a Zeekr model, that model is a template of its own and the others stay pending
  const withModel = [...TPL, { id: 9, brand: 'Zeekr', model: 'X', aliases: ['x'], year_from: 2024, year_to: 2025, body: 'suv', wheelbase: '', roof: '', layout: '', status: 'confirmed' }];
  assert.strictEqual(evo.matchTemplate(withModel, { brand: 'zeekr', model: 'X', year: 2025, veh: 'suv' }).kind, 'candidate');
  assert.strictEqual(evo.matchTemplate(withModel, { brand: 'zeekr', model: '001', year: 2025, veh: 'suv' }).kind, 'pending');
});

test('the vehicle typed by the customer is cleaned and checked; the measuring area is a list of postcode starts', () => {
  const ok = evo.parseVehicle({ brand: '  Seat\n', model: '  León   FR  <b>1.5</b>', year: ' 2019 ' });
  assert.deepStrictEqual(ok, { vehicle: { brand: 'Seat', model: 'León FR b 1.5 /b', year: 2019 } });
  const year = new Date().getFullYear();
  for (const [v, code] of [
    [undefined, 'evo_vehicle'], ['Seat León', 'evo_vehicle'], [{ brand: '', model: 'x', year: 2019 }, 'evo_vehicle'], [{ brand: 'Seat', model: '---', year: 2019 }, 'evo_vehicle'],
    [{ brand: 'x'.repeat(41), model: 'y', year: 2019 }, 'evo_vehicle'], [{ brand: 'x', model: 'y'.repeat(61), year: 2019 }, 'evo_vehicle'],
    [{ brand: 'Seat', model: 'León', year: '19' }, 'evo_year'], [{ brand: 'Seat', model: 'León', year: '20l9' }, 'evo_year'], [{ brand: 'Seat', model: 'León', year: 1949 }, 'evo_year'],
    [{ brand: 'Seat', model: 'León', year: year + 2 }, 'evo_year'],
  ]) assert.deepStrictEqual(evo.parseVehicle(v), { error: code }, JSON.stringify(v));
  assert.strictEqual(evo.parseVehicle({ brand: 'Seat', model: 'León', year: year + 1 }).vehicle.year, year + 1, 'next year is allowed (new models)');
  // Madrid = postcodes starting with 28; the owner can change the list
  assert.deepStrictEqual([evo.inMeasureArea('28001', '28'), evo.inMeasureArea('28991', '28'), evo.inMeasureArea('08001', '28'), evo.inMeasureArea('2800', '28'), evo.inMeasureArea('', '28')], [true, true, false, false, false]);
  assert.deepStrictEqual([evo.inMeasureArea('45001', '28, 45'), evo.inMeasureArea('19001', '28, 45')], [true, false]);
  assert.deepStrictEqual(evo.zipPrefixes(''), ['28'], 'an empty setting falls back to Madrid');
  assert.deepStrictEqual(evo.zipPrefixes('28 ; x1, 450'), ['28', '450']);
});

// ---------- the server ----------
const VEHICLE = { brand: 'BMW', model: '3 Series E90', year: 2007 };
async function shop() {
  const smtp = await fakeSmtp(), stripe = await fakeStripe();
  let srv;
  try { srv = await startServer({ ...smtp.env, ...stripe.env }); } catch (e) { await smtp.close(); await stripe.close(); throw e; }
  await srv.admin('PUT', '/api/admin/settings', { shop_email: 'shop@example.test' });
  let n = 0;
  const ip = () => ({ 'X-Forwarded-For': `198.51.100.${++n}` });
  // a request as the page sends it; each from its own client address (10 requests per address are allowed)
  const base = (over = {}) => ({ product: 'evo-custom-mats', lang: 'es', vehicle: VEHICLE, veh: 'sedan', set: 'set4', mat: 'std',
    name: 'Cliente Prueba', email: 'cliente@example.test', phone: '600 000 000', consent: true, ...over });
  const request = (over, headers) => srv.call('POST', '/api/evo/requests', base(over), headers || ip());
  const rows = async () => (await srv.admin('GET', '/api/admin/evo/requests')).body;
  const mails = () => smtp.messages.map((_, i) => smtp.text(i));
  return { srv, smtp, stripe, base, request, rows, mails, ip, async close() { await srv.stop(); await smtp.close(); await stripe.close(); } };
}

test('a new catalogue has the EVO mats available as a request, and the templates the owner gave', async () => {
  const s = await shop();
  try {
    const p = (await s.srv.call('GET', '/api/products/evo-custom-mats')).body;
    assert.deepStrictEqual([p.status, p.in_stock, p.fitment], ['available', true, 'car'], 'available (not "coming soon"), and not "sold out": it is made to order');
    const t = (await s.srv.call('GET', '/api/evo/templates')).body;
    assert.deepStrictEqual(t.confirmed.map(x => x.label), [
      'BMW · 3 Series (E90) · 2007', 'Fiat · Ducato 35 L3H3 · 2023', 'Ford · Transit Custom / Tourneo Custom Kombi 310 L2 · 2017', 'Kia · Sportage · 2024']);
    assert.deepStrictEqual(t.pending_brands, ['Zeekr']);
    assert.deepStrictEqual(t.confirmed.find(x => x.label.startsWith('Fiat')), { label: 'Fiat · Ducato 35 L3H3 · 2023', body: 'vanlarge', wheelbase: 'L3', roof: 'H3', layout: 'cargo' });
    // the product page data has no offer with a price and stock for search engines: it is a request
    const html = (await s.srv.call('GET', '/p/evo-custom-mats')).text;
    assert.ok(html.includes('"@type":"Product"') && !html.includes('"offers"'), 'no offer in the structured data');
  } finally { await s.close(); }
});

test('the page can ask what a typed vehicle means; the answer comes from the server and is only an explanation', async () => {
  const s = await shop();
  try {
    const chk = body => s.srv.call('POST', '/api/evo/check', body, s.ip());
    let r = (await chk({ vehicle: VEHICLE, veh: 'sedan' })).body;
    assert.deepStrictEqual([r.ok, r.kind, r.label, r.area_ok], [true, 'candidate', 'BMW · 3 Series (E90) · 2007', false]);
    r = (await chk({ vehicle: { ...VEHICLE, year: 2009 }, veh: 'sedan', zip: '28010' })).body;
    assert.deepStrictEqual([r.kind, r.reasons, r.label, r.area_ok], ['measurement', ['year'], 'BMW · 3 Series (E90) · 2007', true]);
    r = (await chk({ vehicle: { brand: 'Zeekr', model: '001', year: 2024 }, veh: 'suv' })).body;
    assert.strictEqual(r.kind, 'pending');
    r = (await chk({ vehicle: { brand: 'Seat', model: 'León', year: 2019 }, veh: 'hatch', zip: '08001' })).body;
    assert.deepStrictEqual([r.kind, r.label, r.area_ok], ['measurement', '', false]);
    assert.deepStrictEqual((await chk({ vehicle: { brand: 'Seat' }, veh: 'hatch' })).body, { ok: false, error: 'evo_vehicle' });
  } finally { await s.close(); }
});

test('a request is kept and answered, and nothing is charged, reserved or sent to Stripe', async () => {
  const s = await shop();
  try {
    const stockBefore = (await s.srv.admin('GET', '/api/admin/products')).body.find(p => p.slug === 'evo-custom-mats').stock;
    const r = await s.request({ message: 'Hola' });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.match(r.body.ref, /^EV-[0-9A-F]{6}$/);
    assert.deepStrictEqual([r.body.kind, r.body.label, r.body.mail], ['candidate', 'BMW · 3 Series (E90) · 2007', true]);
    const [row] = await s.rows();
    assert.deepStrictEqual([row.status, row.kind, row.template, row.brand, row.model, row.year, row.veh, row.set_id, row.mat, row.ref_price_cents],
      ['new', 'candidate', 'BMW · 3 Series (E90) · 2007', 'BMW', '3 Series E90', 2007, 'sedan', 'set4', 'std', 4000]);
    assert.deepStrictEqual([row.name, row.email, row.phone, row.message, row.selection.veh.es, row.selection.set.es], ['Cliente Prueba', 'cliente@example.test', '600 000 000', 'Hola', 'Berlina', 'Juego de 4 piezas']);
    // not an order: no order, no stock taken, nothing for the payment page
    assert.strictEqual((await s.srv.admin('GET', '/api/admin/orders')).body.length, 0);
    const p = (await s.srv.admin('GET', '/api/admin/products')).body.find(x => x.slug === 'evo-custom-mats');
    assert.strictEqual(p.stock, stockBefore, 'no stock reserved');
    assert.deepStrictEqual([s.stripe.state.creates, s.stripe.state.createsStarted || 0], [0, 0], 'nothing sent to Stripe');
    // the customer's e-mail says so; the shop is told too
    await s.smtp.waitFor(2);
    const toCustomer = s.mails().find(m => /^To: cliente@example\.test/m.test(m)), toShop = s.mails().find(m => /^To: shop@example\.test/m.test(m));
    assert.ok(toCustomer && toShop, 'an e-mail to the customer and one to the shop');
    assert.match(toCustomer, /Es una solicitud, no un pedido: no se ha cobrado nada y no hay nada reservado/);
    assert.match(toCustomer, new RegExp(r.body.ref));
    assert.match(toCustomer, /BMW 3 Series E90 · 2007/);
    assert.match(toCustomer, /parece coincidir con una de nuestras plantillas/);
    assert.match(toShop, new RegExp(r.body.ref));
    assert.match(toShop, /Yeni[ _]EVO[ _]talebi/);
    // English
    const en = await s.request({ lang: 'en', email: 'client@example.test' });
    assert.strictEqual(en.status, 200);
    await s.smtp.waitFor(4);
    assert.match(s.mails().find(m => /^To: client@example\.test/m.test(m)), /This is a request, not an order: nothing has been charged and nothing is reserved/);
    // the panel counts new requests for the badge
    assert.strictEqual((await s.srv.admin('GET', '/api/admin/me')).body.evo_new, 2);
  } finally { await s.close(); }
});

test('the reference price of a request is the list price of the chosen set, worked out by the server', async () => {
  const s = await shop();
  try {
    const van = { layout: 'cargo', wheelbase: 'L3', roof: 'H3' };
    for (const [over, euros] of [
      [{ veh: 'sedan', set: 'set4', mat: 'std' }, 40], [{ veh: 'hatch', set: 'pack', mat: 'prem' }, 105],
      [{ veh: 'suvbig', set: 'packr3', mat: 'prem', seats: '7' }, 145], [{ veh: 'mpv', set: 'boot', mat: 'std', seats: '5' }, 60],
      [{ veh: 'vansmall', set: 'cab', mat: 'std', ...van }, 40], [{ veh: 'vanmedium', set: 'cab2', mat: 'prem', layout: 'crew', wheelbase: 'L2', roof: 'H1' }, 90],
    ]) {
      const r = await s.request({ ...over, vehicle: { ...VEHICLE, year: 2007 }, municipality: 'Madrid', zip: '28001', price_cents: 1 });
      assert.strictEqual(r.status, 200, JSON.stringify([over, r.body]));
    }
    assert.deepStrictEqual((await s.rows()).reverse().map(r => r.ref_price_cents / 100), [40, 105, 145, 60, 40, 90]);
  } finally { await s.close(); }
});

test('no template: only a measurement in person, only in the Madrid area; anything else is refused without a promise', async () => {
  const s = await shop();
  try {
    const seat = { vehicle: { brand: 'Seat', model: 'León', year: 2019 }, veh: 'hatch' };
    // needs a municipality and a postcode
    assert.deepStrictEqual((await s.request({ ...seat })).body, { error: 'evo_municipality' });
    assert.deepStrictEqual((await s.request({ ...seat, municipality: 'Getafe' })).body, { error: 'evo_zip' });
    assert.deepStrictEqual((await s.request({ ...seat, municipality: 'Getafe', zip: '2890' })).body, { error: 'evo_zip' });
    // outside the area: refused, nothing kept, nobody e-mailed
    for (const zip of ['08001', '41001', '46001', '29001']) assert.deepStrictEqual((await s.request({ ...seat, municipality: 'Otra', zip })).body, { error: 'evo_out_of_area' }, zip);
    assert.strictEqual((await s.rows()).length, 0);
    assert.strictEqual(s.smtp.messages.length, 0);
    // in the area: a measurement request
    const ok = await s.request({ ...seat, municipality: 'Getafe', zip: '28901' });
    assert.deepStrictEqual([ok.status, ok.body.kind], [200, 'measurement']);
    const [row] = await s.rows();
    assert.deepStrictEqual([row.kind, row.municipality, row.zip, row.template_id], ['measurement', 'Getafe', '28901', null]);
    await s.smtp.waitFor(2);
    const mail = s.mails().find(m => /^To: cliente@example\.test/m.test(m));
    assert.match(mail, /habría que medirlo en persona\. Solo lo hacemos en la zona de Madrid/);
    assert.match(mail, /No podemos prometer la fabricación antes de medir el vehículo/);
    assert.ok(!/plantilla \(/.test(mail), 'no template is claimed');
    // a model with a template but another year / body is a vehicle without a template
    assert.deepStrictEqual((await s.request({ vehicle: { ...VEHICLE, year: 2009 } })).body, { error: 'evo_municipality' });
    assert.deepStrictEqual((await s.request({ vehicle: { ...VEHICLE }, veh: 'wagon', municipality: 'Barcelona', zip: '08001' })).body, { error: 'evo_out_of_area' });
    // a generic body type is not a template, whatever the type
    for (const veh of ['suv', 'suvbig', 'mpv']) {
      const r = await s.request({ vehicle: { brand: 'Seat', model: 'Ateca', year: 2020 }, veh, set: 'set4', seats: '5', municipality: 'Valencia', zip: '46001' });
      assert.deepStrictEqual(r.body, { error: 'evo_out_of_area' }, veh);
    }
    // the owner can widen the area (e.g. 28 and 45)
    await s.srv.admin('PUT', '/api/admin/settings', { evo_measure_zip_prefixes: '28, 45' });
    assert.strictEqual((await s.request({ ...seat, municipality: 'Toledo', zip: '45001' })).status, 200);
    assert.strictEqual((await s.request({ ...seat, municipality: 'Ávila', zip: '05001' })).body.error, 'evo_out_of_area');
  } finally { await s.close(); }
});

test('a template match or a pending brand is accepted from anywhere, and says it is not a promise', async () => {
  const s = await shop();
  try {
    // a vehicle with a template: no measurement, no postcode needed
    const bmw = await s.request({ municipality: 'Sevilla', zip: '41001' });
    assert.deepStrictEqual([bmw.status, bmw.body.kind], [200, 'candidate']);
    const kia = await s.request({ vehicle: { brand: 'Kia', model: 'Sportage', year: 2024 }, veh: 'suv' });
    assert.deepStrictEqual([kia.status, kia.body.kind], [200, 'candidate']);
    const ford = await s.request({ vehicle: { brand: 'Ford', model: 'Transit Custom', year: 2017 }, veh: 'vanmedium', set: 'cab', layout: 'kombi', rows: '2', wheelbase: 'L2', roof: 'H1' });
    assert.deepStrictEqual([ford.status, ford.body.kind], [200, 'candidate']);
    // Zeekr: reviewed by hand, from anywhere
    const zeekr = await s.request({ vehicle: { brand: 'Zeekr', model: '001', year: 2024 }, veh: 'suv', email: 'zeekr@example.test' });
    assert.deepStrictEqual([zeekr.status, zeekr.body.kind], [200, 'pending']);
    await s.smtp.waitFor(8);
    assert.match(s.mails().find(m => /^To: zeekr@example\.test/m.test(m)), /Estamos confirmando de qué modelos Zeekr tenemos plantilla\. Revisaremos el tuyo/);
    // what the browser says about the match is ignored
    const lie = await s.request({ vehicle: { brand: 'Seat', model: 'León', year: 2019 }, veh: 'hatch', kind: 'candidate', template_id: 1, status: 'confirmed', municipality: 'Valencia', zip: '46001' });
    assert.deepStrictEqual(lie.body, { error: 'evo_out_of_area' });
    // the same lies on a request that is valid (in the Madrid area): it is kept for what the server decided, not for what was sent
    const lie2 = await s.request({ vehicle: { brand: 'Seat', model: 'León', year: 2019 }, veh: 'hatch', kind: 'candidate', template_id: 1, status: 'confirmed', municipality: 'Getafe', zip: '28901', email: 'lie@example.test' });
    assert.strictEqual(lie2.body.kind, 'measurement');
    const rows = await s.rows();
    const stored = rows.find(r => r.email === 'lie@example.test');
    assert.deepStrictEqual([stored.kind, stored.template_id, stored.status], ['measurement', null, 'new']);
    assert.ok(rows.every(r => r.status === 'new'), 'every request starts as new, whatever was sent');
  } finally { await s.close(); }
});

test('the configuration is asked where it matters, and incompatible choices are refused', async () => {
  const s = await shop();
  try {
    const fail = async (over, code, why) => assert.deepStrictEqual((await s.request({ municipality: 'Madrid', zip: '28001', ...over })).body, { error: code }, why);
    const van = { veh: 'vanlarge', set: 'cab', layout: 'cargo', wheelbase: 'L3', roof: 'H3' };
    assert.strictEqual((await s.request({ ...van, vehicle: { brand: 'Fiat', model: 'Ducato', year: 2023 } })).body.kind, 'candidate');
    await fail({ ...van, layout: '' }, 'evo_config', 'a van needs its configuration');
    await fail({ ...van, wheelbase: '' }, 'evo_config', 'and its length');
    await fail({ ...van, roof: 'H9' }, 'evo_config', 'and a roof height from the list');
    await fail({ ...van, layout: 'kombi' }, 'evo_config', 'a passenger van needs its rows of seats');
    assert.strictEqual((await s.request({ ...van, layout: 'kombi', rows: '3', municipality: 'Madrid', zip: '28001' })).status, 200);
    await fail({ veh: 'sedan', cargo: true }, 'evo_config', 'a load-area floor is for vans');
    await fail({ veh: 'suvbig', set: 'set4' }, 'evo_config', 'a large SUV needs its seats');
    await fail({ veh: 'suvbig', set: 'packr3', seats: '5' }, 'evo_config', 'a third row needs 7 seats');
    await fail({ veh: 'mpv', set: 'set4', seats: '9' }, 'evo_config');
    await fail({ veh: 'sedan', set: 'cab' }, 'evo_option', 'a cabin set is not for a sedan');
    await fail({ veh: 'suv', set: 'set4r3', seats: '7' }, 'evo_option', 'nor a third row for a 5-seat SUV');
    await fail({ veh: 'vansmall', set: 'boot', ...{ layout: 'cargo', wheelbase: 'L1', roof: 'H1' } }, 'evo_option', 'nor a boot mat for a van');
    await fail({ veh: 'nonsense' }, 'evo_option');
    await fail({ mat: 'gold' }, 'evo_option');
    // a load-area floor is only a request for a quote: it is kept with the request, never priced into it
    const cargo = await s.request({ ...van, cargo: true, vehicle: { brand: 'Fiat', model: 'Ducato', year: 2023 } });
    assert.strictEqual(cargo.status, 200);
    const row = (await s.rows())[0];
    assert.deepStrictEqual([row.cargo, row.ref_price_cents, row.layout, row.wheelbase, row.roof], [1, 5000, 'cargo', 'L3', 'H3'], 'the price is the cabin set only');
  } finally { await s.close(); }
});

test('contact details, consent, a hidden bot field, the request limit, and a product that is not open', async () => {
  const s = await shop();
  try {
    const fail = async (over, code) => assert.deepStrictEqual((await s.request(over)).body, { error: code }, JSON.stringify(over));
    await fail({ name: '' }, 'evo_contact');
    await fail({ email: 'not-an-email' }, 'evo_email');
    await fail({ phone: '12345' }, 'evo_phone');
    await fail({ phone: 'abc def ghi jkl' }, 'evo_phone');
    await fail({ phone: '1'.repeat(16) }, 'evo_phone');
    await fail({ consent: false }, 'evo_consent');
    await fail({ consent: undefined }, 'evo_consent');
    await fail({ zip: '28A01' }, 'evo_zip');
    await fail({ vehicle: { brand: 'BMW', model: 'E90', year: '07' } }, 'evo_year');
    assert.strictEqual((await s.request({ product: 'no-such-product' })).status, 404);
    assert.strictEqual((await s.rows()).length, 0, 'nothing was kept');
    // a bot fills the hidden field: it is told it worked, and nothing is kept or sent
    const bot = await s.request({ website: 'http://spam.example' });
    assert.deepStrictEqual([bot.status, bot.body.ok], [200, true]);
    assert.strictEqual((await s.rows()).length, 0);
    assert.strictEqual(s.smtp.messages.length, 0);
    // the same client can send 10 requests in 30 minutes
    const same = { 'X-Forwarded-For': '203.0.113.7' };
    for (let i = 0; i < 10; i++) assert.strictEqual((await s.request({}, same)).status, 200, 'request ' + (i + 1));
    assert.strictEqual((await s.request({}, same)).status, 429);
    // a product that is not available (e.g. "coming soon") takes no requests
    const evoProduct = (await s.srv.admin('GET', '/api/admin/products')).body.find(p => p.slug === 'evo-custom-mats');
    await s.srv.admin('PUT', '/api/admin/products/' + evoProduct.id, { ...evoProduct, status: 'soon' });
    assert.strictEqual((await s.request({})).status, 404);
  } finally { await s.close(); }
});

test('panel: requests are listed, answered and deleted; templates are managed; messages come in Turkish and Spanish', async () => {
  const s = await shop();
  try {
    const lang = (method, url, body, l = 'es') => s.srv.call(method, url, body, { Cookie: s.srv.cookie, 'X-Admin-Lang': l });
    // not logged in
    for (const [m, u] of [['GET', '/api/admin/evo/requests'], ['GET', '/api/admin/evo/templates'], ['POST', '/api/admin/evo/templates'], ['PUT', '/api/admin/evo/requests/1'], ['DELETE', '/api/admin/evo/requests/1']])
      assert.strictEqual((await s.srv.call(m, u, m === 'GET' || m === 'DELETE' ? undefined : {})).status, 401, `${m} ${u}`);
    const made = await s.request({});
    const [row] = await s.rows();
    assert.strictEqual(row.ref, made.body.ref);
    // status and note
    assert.strictEqual((await s.srv.admin('PUT', '/api/admin/evo/requests/' + row.id, { status: 'contacted', admin_note: ' Llamada hecha ' })).status, 200);
    let now = (await s.rows())[0];
    assert.deepStrictEqual([now.status, now.admin_note], ['contacted', 'Llamada hecha']);
    assert.strictEqual((await s.srv.admin('GET', '/api/admin/me')).body.evo_new, 0, 'answered requests leave the badge');
    const bad = await lang('PUT', '/api/admin/evo/requests/' + row.id, { status: 'deleted' });
    assert.deepStrictEqual([bad.status, bad.body.error], [400, 'Estado no válido']);
    assert.strictEqual((await lang('PUT', '/api/admin/evo/requests/999', { status: 'closed' })).status, 404);
    assert.strictEqual((await s.srv.admin('DELETE', '/api/admin/evo/requests/' + row.id)).status, 200);
    assert.strictEqual((await s.rows()).length, 0, 'the customer\'s details are gone');

    // templates: add one, it is a template from then on; change it, delete it
    const golf = { brand: 'Volkswagen', model: 'Golf', aliases: 'Golf 8, VW Golf', year_from: 2020, year_to: 2022, body: 'hatch', status: 'confirmed', note: 'test' };
    const add = await s.srv.admin('POST', '/api/admin/evo/templates', golf);
    assert.strictEqual(add.status, 200, JSON.stringify(add.body));
    const listed = (await s.srv.admin('GET', '/api/admin/evo/templates')).body.find(t => t.id === add.body.id);
    assert.deepStrictEqual([listed.aliases, listed.year_from, listed.year_to, listed.body], ['golf8, vwgolf', 2020, 2022, 'hatch'], 'aliases are saved normalised');
    const golfReq = { vehicle: { brand: 'volkswagen', model: 'Golf 8 GTI', year: 2021 }, veh: 'hatch' };
    assert.strictEqual((await s.request(golfReq)).body.kind, 'candidate');
    assert.strictEqual((await s.request({ ...golfReq, vehicle: { ...golfReq.vehicle, year: 2023 }, municipality: 'Madrid', zip: '28001' })).body.kind, 'measurement', 'a year outside the range is not covered');
    assert.strictEqual((await s.srv.admin('PUT', '/api/admin/evo/templates/' + add.body.id, { ...golf, year_to: 2021 })).status, 200);
    assert.strictEqual((await s.request({ ...golfReq, vehicle: { ...golfReq.vehicle, year: 2022 }, municipality: 'Madrid', zip: '28001' })).body.kind, 'measurement');
    assert.strictEqual((await s.srv.admin('DELETE', '/api/admin/evo/templates/' + add.body.id)).status, 200);
    assert.deepStrictEqual((await s.request({ ...golfReq, municipality: 'Madrid', zip: '28001' })).body.kind, 'measurement', 'a deleted template covers nothing');
    // checks, in both panel languages
    for (const [over, es, tr] of [
      [{ brand: '' }, 'La marca es obligatoria', 'Marka zorunlu'],
      [{ model: '' }, 'Una plantilla confirmada necesita el modelo', 'Onaylı şablonda model zorunlu'],
      [{ year_from: 2022, year_to: 2020 }, 'Rango de años no válido', 'Geçersiz yıl aralığı'],
      [{ year_from: 1900 }, 'Rango de años no válido', 'Geçersiz yıl aralığı'],
      [{ status: 'maybe' }, 'Estado no válido', 'Geçersiz durum'],
      [{ body: 'tractor' }, 'Opción no válida', 'Geçersiz seçim'],
      [{ wheelbase: 'L9' }, 'Opción no válida', 'Geçersiz seçim'],
    ]) {
      const a = await lang('POST', '/api/admin/evo/templates', { ...golf, ...over }, 'es'), b = await lang('POST', '/api/admin/evo/templates', { ...golf, ...over }, 'tr');
      assert.deepStrictEqual([a.status, a.body.error, b.status, b.body.error], [400, es, 400, tr], JSON.stringify(over));
    }
    assert.strictEqual((await lang('PUT', '/api/admin/evo/templates/999', golf)).status, 404);
    // a pending (brand-level) row needs no model or years
    const pend = await s.srv.admin('POST', '/api/admin/evo/templates', { brand: 'Polestar', status: 'pending' });
    assert.strictEqual(pend.status, 200, JSON.stringify(pend.body));
    assert.strictEqual((await s.request({ vehicle: { brand: 'Polestar', model: '2', year: 2023 }, veh: 'hatch' })).body.kind, 'pending');
  } finally { await s.close(); }
});

test('the templates of the owner are put in once, and never again over the owner\'s changes or deletions', () => {
  const dir = tempDir();
  try {
    const run = code => spawnSync(process.execPath, ['-e', `const { db } = require('./db'); ${code}`], { cwd: ROOT, env: { ...process.env, DATA_DIR: dir, NODE_ENV: 'test' }, encoding: 'utf8' });
    const count = () => Number(run("console.log(db.prepare('SELECT COUNT(*) c FROM evo_templates').get().c)").stdout.trim());
    assert.strictEqual(count(), 5, 'first start: BMW, Kia, Zeekr (pending), Ford, Fiat');
    assert.strictEqual(count(), 5, 'a restart adds nothing');
    run("db.prepare(\"DELETE FROM evo_templates WHERE brand != 'Kia'\").run(); db.prepare(\"UPDATE evo_templates SET note = 'mine' WHERE brand = 'Kia'\").run();");
    const after = run("console.log(JSON.stringify(db.prepare('SELECT brand, note FROM evo_templates').all()))").stdout.trim();
    assert.strictEqual(after, '[{"brand":"Kia","note":"mine"}]', 'deleted rows stay deleted, edits stay');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('an existing shop (from before the EVO requests) gets the tables, the setting and the templates on start, and keeps every product as it was', () => {
  const dir = tempDir();
  try {
    const run = code => spawnSync(process.execPath, ['-e', `const { db } = require('./db'); ${code}`], { cwd: ROOT, env: { ...process.env, DATA_DIR: dir, NODE_ENV: 'test' }, encoding: 'utf8' });
    const snapshot = "console.log(JSON.stringify(db.prepare('SELECT id, slug, name_es, price_cents, stock, status, opts, combos, media, desc_es, fitment FROM products ORDER BY id').all()))";
    const first = run(snapshot).stdout.trim();                       // a catalogue
    assert.ok(JSON.parse(first).length >= 9);
    // make it look like the release before: no EVO tables, no EVO settings, no price-list columns
    const old = run('db.exec("DROP TABLE evo_templates; DROP TABLE evo_requests; DELETE FROM settings WHERE key IN (\'evo_templates_seeded\', \'evo_measure_zip_prefixes\'); ALTER TABLE products DROP COLUMN prices_en; ALTER TABLE products DROP COLUMN prices_es")');
    assert.strictEqual(old.status, 0, old.stderr);
    const out = run(`console.log(JSON.stringify({
      templates: db.prepare('SELECT COUNT(*) c FROM evo_templates').get().c, requests: db.prepare('SELECT COUNT(*) c FROM evo_requests').get().c,
      zip: db.prepare("SELECT value FROM settings WHERE key = 'evo_measure_zip_prefixes'").get().value,
      columns: db.prepare("SELECT name FROM pragma_table_info('products') WHERE name LIKE 'prices_%' ORDER BY name").all().map(c => c.name) }))`);
    assert.deepStrictEqual(JSON.parse(out.stdout.trim()), { templates: 5, requests: 0, zip: '28', columns: ['prices_en', 'prices_es'] }, out.stderr);
    assert.strictEqual(run(snapshot).stdout.trim(), first, 'every product exactly as it was: the update changes no product, price or photo');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---------- the homepage ----------
const app = fs.readFileSync(path.join(ROOT, 'public', 'js', 'app.js'), 'utf8').replace(/\r\n/g, '\n');
const slice = (from, to) => { const a = app.indexOf(from), b = app.indexOf(to, a); assert.ok(a >= 0 && b > a, from); return app.slice(a, b); };

test('the homepage has no vehicle finder; the links it had still lead somewhere that works', () => {
  const home = slice('async function viewHome()', 'async function viewCategory');
  for (const gone of ['finderBox', 'bindCarArea', 'myCarBar', 'carSel', 'mountCarSelect']) assert.ok(!home.includes(gone), `the homepage does not use ${gone}`);
  assert.ok(!app.includes('function myCarBar') && !app.includes('function bindCarArea'), 'the helpers only the homepage used are gone');
  // what is on it instead: a way to the EVO request and one to the products
  assert.match(home, /href="\/p\/\$\{esc\(evoOpen\.slug\)\}" data-link/);
  assert.match(home, /href="\/#products" data-scroll="products"/,'a link that scrolls: a plain #fragment would re-draw the page');
  assert.match(home, /id="products"/, 'the link to the products has somewhere to go');
  // the shop-by-car page (bulb finder) and its menu entry still exist: only the homepage lost the finder
  assert.match(app, /async function viewCar\(\)/);
  assert.match(app, /\['\/car'/.test(app) ? /./ : /href="\/car"|path === '\/car'|'\/car'/, 'the /car route and menu entry are still there');
  assert.match(app, /finderBox\(\{ title: false \}\)/, 'the finder is still on its own page');
  // the made-to-measure page asks for the vehicle in text: brand, model, year; no list
  const evoPage = slice('async function viewEvo(', '/* ================= reviews');
  assert.ok(!evoPage.includes('mountCarSelect') && !evoPage.includes('CARS['));
  for (const id of ['vBrand', 'vModel', 'vYear']) assert.ok(evoPage.includes(`id="${id}"`), id);
});

test('every text the EVO page uses exists in both languages', () => {
  const T = new Function(app.match(/^const T = \{[\s\S]*?^\};$/m)[0] + '\nreturn T;')();
  const evoPage = slice('async function viewEvo(', '/* ================= reviews');
  const keys = new Set([...evoPage.matchAll(/\bt\('([a-z0-9_]+)'\)/g)].map(m => m[1]));
  for (const k of ['evo_layout_cargo', 'evo_layout_kombi', 'evo_layout_crew', 'evo_seats_5', 'evo_seats_7', 'evo_diff_year', 'evo_diff_body', 'evo_diff_wheelbase', 'evo_diff_roof', 'evo_diff_layout']) keys.add(k);
  const missing = [];
  for (const k of keys) for (const l of ['en', 'es']) if (!T[l][k]) missing.push(`${l}.${k}`);
  assert.deepStrictEqual(missing, []);
  // the server's error codes all have a text in both languages
  const codes = fs.readFileSync(path.join(ROOT, 'evo.js'), 'utf8').match(/'evo_[a-z_]+'/g).map(s => 'err_' + s.slice(1, -1));
  for (const c of new Set(codes)) for (const l of ['en', 'es']) assert.ok(T[l][c], `${l}.${c}`);
  // and the two languages say the same things: the same placeholders
  for (const k of Object.keys(T.en).filter(k => k.startsWith('evo_') || k.startsWith('v3d_') || k.startsWith('err_evo'))) {
    const ph = s => (s.match(/\{[a-z]+\}/g) || []).sort().join();
    assert.strictEqual(ph(T.en[k]), ph(T.es[k]), 'placeholders of ' + k);
  }
});

test('the privacy policy says what an EVO request keeps, and the saved car is no longer said to fill in EVO orders', () => {
  const T = new Function(app.match(/^const T = \{[\s\S]*?^\};$/m)[0] + '\nreturn T;')();
  const legal = slice('function legalText(', 'async function viewLegal');
  assert.match(legal, /If you send a request for made-to-measure EVO mats, we also keep what you write in it \(the vehicle, your contact details, your municipality and your message\)/);
  assert.match(legal, /Si envías una solicitud de alfombrillas EVO a medida, guardamos también lo que escribes en ella \(el vehículo, tus datos de contacto, tu municipio y tu mensaje\)/);
  for (const l of ['en', 'es']) assert.ok(!/EVO/.test(T[l].car_saved_hint), l + ': the saved car is only used for the bulbs now');
});
