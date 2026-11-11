// evo.js — made-to-measure EVO mats are not bought like the other products. The customer sends a REQUEST
// (type of vehicle, set, the vehicle typed in, contact details); the shop checks it and answers. Nothing is
// charged, no stock is reserved and nothing goes to Stripe until the shop has confirmed that the mats fit.
//
// Which vehicles the shop can make mats for depends on templates the shop owns (table evo_templates, edited in
// the panel). A template covers exactly what it says: one model, one year (or range), one body type, and the
// wheelbase / roof / layout where those are given. Nothing is assumed to fit another year, body, seating
// arrangement or wheelbase, and choosing "SUV" or "large van" never counts as having a template.
//
// This file holds the rules: what a template covers, what a request must contain, and what it means when
// there is no template (the vehicle has to be measured in person, which the shop only does in the Madrid area).

const THIS_YEAR = () => new Date().getFullYear();
const MIN_YEAR = 1950;

// "Seat León" / "SEAT  leon" / "seat-león" are the same: lower case, no accents, letters and digits only
const norm = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '');

const BODIES = ['sedan', 'hatch', 'wagon', 'suv', 'suvbig', 'mpv', 'vansmall', 'vanmedium', 'vanlarge'];   // ids of the type-of-vehicle option
const isVan = body => /^van/.test(body || '');
const LAYOUTS = ['cargo', 'kombi', 'crew'];          // van: empty load floor / passenger van with rear seats / crew cab
const WHEELBASES = ['L1', 'L2', 'L3', 'L4', 'unknown'];
const ROOFS = ['H1', 'H2', 'H3', 'unknown'];
const THIRD_ROW_SETS = ['set4r3', 'packr3'];

// ---------- the vehicle typed by the customer ----------
// Free text, so it is cleaned: no control characters or < >, one line, limited length, a real year.
function text(v, max) {
  const s = String(v ?? '').replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim();
  return s.length <= max && /[\p{L}\p{N}]/u.test(s) ? s : '';       // too long, or no letter or number: not valid
}
// { vehicle: { brand, model, year } } or { error: 'evo_vehicle' | 'evo_year' }
function parseVehicle(c) {
  if (!c || typeof c !== 'object') return { error: 'evo_vehicle' };
  const brand = text(c.brand, 40), model = text(c.model, 60);
  if (!brand || !model) return { error: 'evo_vehicle' };
  const y = String(c.year ?? '').trim();
  const year = /^\d{4}$/.test(y) ? Number(y) : 0;
  if (year < MIN_YEAR || year > THIS_YEAR() + 1) return { error: 'evo_year' };
  return { vehicle: { brand, model, year } };
}

// ---------- templates ----------
// A template row as the code uses it: aliases is a list of normalised model names
function templateRow(r) {
  let aliases = [];
  try { aliases = JSON.parse(r.aliases || '[]'); } catch { /* none */ }
  return { ...r, aliases: aliases.map(norm).filter(Boolean) };
}
// What the owner told us (see the PR): confirmed templates for these vehicles only, and Zeekr templates whose model list is
// still to be confirmed by the owner (status pending: such a request is reviewed, never approved by itself).
// The body types of the BMW E90 (sedan) and the Kia Sportage (SUV) follow from the models; the owner can change them in the panel.
const SEED_TEMPLATES = [
  { brand: 'BMW', model: '3 Series (E90)', aliases: ['e90', '3series', 'serie3', '3er'], year_from: 2007, year_to: 2007, body: 'sedan', wheelbase: '', roof: '', layout: '', status: 'confirmed', note: 'BMW E90, 2007' },
  { brand: 'Kia', model: 'Sportage', aliases: ['sportage'], year_from: 2024, year_to: 2024, body: 'suv', wheelbase: '', roof: '', layout: '', status: 'confirmed', note: 'Kia Sportage, 2024' },
  { brand: 'Zeekr', model: '', aliases: [], year_from: 0, year_to: 0, body: '', wheelbase: '', roof: '', layout: '', status: 'pending', note: 'Templates exist; the models sold in Spain are still to be confirmed by the owner' },
  { brand: 'Ford', model: 'Transit Custom / Tourneo Custom Kombi 310 L2', aliases: ['transitcustom', 'tourneocustom'], year_from: 2017, year_to: 2017, body: 'vanmedium', wheelbase: 'L2', roof: '', layout: 'kombi', status: 'confirmed', note: 'Ford Transit/Tourneo Custom Kombi 310 L2, 2017' },
  { brand: 'Fiat', model: 'Ducato 35 L3H3', aliases: ['ducato'], year_from: 2023, year_to: 2023, body: 'vanlarge', wheelbase: 'L3', roof: 'H3', layout: 'cargo', status: 'confirmed', note: 'Fiat Ducato 35 L3H3, 2023' },
];

// { kind, template, reasons }
//   candidate: brand, model, year, body type (and wheelbase / roof / layout where the template names them) all match a confirmed
//              template. The shop still confirms it before making anything.
//   pending:   the brand has templates whose model list is not confirmed yet: reviewed by hand, not promised.
//   none:      no template covers this vehicle: it would have to be measured in person. reasons says what differs from the closest
//              template of the same model (year, body, wheelbase, roof, layout), or why there is none (brand, model).
function matchTemplate(templates, v) {
  const brand = norm(v.brand), model = norm(v.model);
  const sameBrand = templates.filter(t => norm(t.brand) === brand);
  if (!brand || !sameBrand.length) return { kind: 'none', template: null, reasons: ['brand'] };
  const named = sameBrand.filter(t => t.status === 'confirmed' && t.model && t.aliases.some(a => model.includes(a)));
  let closest = null;
  for (const t of named) {
    const diff = [];
    if (!(v.year >= t.year_from && v.year <= t.year_to)) diff.push('year');
    if (t.body && t.body !== v.veh) diff.push('body');
    if (t.wheelbase && t.wheelbase !== v.wheelbase) diff.push('wheelbase');
    if (t.roof && t.roof !== v.roof) diff.push('roof');
    if (t.layout && t.layout !== v.layout) diff.push('layout');
    if (!diff.length) return { kind: 'candidate', template: t, reasons: [] };
    if (!closest || diff.length < closest.reasons.length) closest = { kind: 'none', template: t, reasons: diff };
  }
  if (closest) return closest;
  const pending = sameBrand.find(t => t.status === 'pending');
  if (pending) return { kind: 'pending', template: pending, reasons: [] };
  return { kind: 'none', template: null, reasons: ['model'] };
}
const templateLabel = t => t ? [t.brand, t.model, t.year_from ? (t.year_from === t.year_to ? t.year_from : `${t.year_from}–${t.year_to}`) : ''].filter(Boolean).join(' · ') : '';

// ---------- where the shop measures ----------
// Postcodes start with the province: 28 = Madrid. The shop can change the list in the panel (setting evo_measure_zip_prefixes).
const zipPrefixes = setting => String(setting || '28').split(/[\s,;]+/).filter(p => /^\d{1,5}$/.test(p));
const inMeasureArea = (zip, setting) => /^\d{5}$/.test(String(zip || '')) && zipPrefixes(setting).some(p => String(zip).startsWith(p));

// ---------- a request ----------
const pick = (v, list) => (list.includes(v) ? v : '');
// ctx = { templates, settings, product (row), catalog, isEmail }
// → { error } (a code the page turns into a text), { bot: true } or { clean }
function validateRequest(b, ctx) {
  b = b && typeof b === 'object' ? b : {};
  if (b.website) return { bot: true };                                // hidden field only a bot fills in
  const pv = parseVehicle(b.vehicle);
  if (pv.error) return { error: pv.error };

  // the choices, checked against the product's own options and price list
  const { options } = ctx.catalog.read(ctx.product);
  const veh = String(b.veh || ''), set = String(b.set || ''), mat = String(b.mat || '');
  let price;
  try { price = ctx.catalog.priceForSelection(ctx.product, { veh, set, mat }); } catch { return { error: 'evo_option' }; }
  if (!BODIES.includes(veh)) return { error: 'evo_option' };

  // seating / cargo configuration, asked where it matters
  const van = isVan(veh);
  let layout = '', rows = '', wheelbase = '', roof = '', seats = '', cargo = false;
  if (van) {
    layout = pick(b.layout, LAYOUTS); wheelbase = pick(b.wheelbase, WHEELBASES); roof = pick(b.roof, ROOFS);
    if (!layout || !wheelbase || !roof) return { error: 'evo_config' };
    rows = layout === 'kombi' ? pick(String(b.rows), ['2', '3']) : layout === 'crew' ? '2' : '';
    if (layout === 'kombi' && !rows) return { error: 'evo_config' };
    cargo = b.cargo === true || b.cargo === 'true' || b.cargo === 1 || b.cargo === '1';
  } else {
    if (b.cargo === true || b.cargo === 'true') return { error: 'evo_config' };       // a load-area floor is for vans
    if (veh === 'suvbig' || veh === 'mpv') {
      seats = pick(String(b.seats), ['5', '7']);
      if (!seats || (THIRD_ROW_SETS.includes(set) && seats !== '7')) return { error: 'evo_config' };
    }
  }

  // contact
  const name = text(b.name, 120), email = String(b.email ?? '').trim().toLowerCase().slice(0, 160);
  const phone = String(b.phone ?? '').trim().slice(0, 25), digits = phone.replace(/\D/g, '');
  if (!name) return { error: 'evo_contact' };
  if (!ctx.isEmail(email)) return { error: 'evo_email' };
  if (!/^[+()\d\s.-]{9,25}$/.test(phone) || digits.length < 9 || digits.length > 15) return { error: 'evo_phone' };
  if (!(b.consent === true || b.consent === 'true' || b.consent === 1 || b.consent === '1')) return { error: 'evo_consent' };

  // does a template cover it? The server decides, never the page
  const match = matchTemplate(ctx.templates, { ...pv.vehicle, veh, layout, wheelbase, roof });
  const municipality = text(b.municipality, 80), zip = String(b.zip ?? '').trim();
  if (zip && !/^\d{5}$/.test(zip)) return { error: 'evo_zip' };
  if (match.kind === 'none') {
    // no template: only a measurement in person can settle it, and only in the shop's area
    if (!municipality) return { error: 'evo_municipality' };
    if (!zip) return { error: 'evo_zip' };
    if (!inMeasureArea(zip, ctx.settings.evo_measure_zip_prefixes)) return { error: 'evo_out_of_area' };
  }
  const label = k => { const o = options.find(x => x.id === k[0]); const v = o && o.values.find(x => x.id === k[1]); return v ? { en: v.en, es: v.es || v.en } : { en: '', es: '' }; };
  return {
    clean: {
      kind: match.kind === 'none' ? 'measurement' : match.kind,
      template_id: match.template ? match.template.id : null, reasons: match.reasons,
      ...pv.vehicle, veh, set, mat, cargo, layout, rows, wheelbase, roof, seats,
      selection: { veh: label(['veh', veh]), set: label(['set', set]), mat: label(['mat', mat]) },
      ref_price_cents: price.unit,
      name, email, phone, municipality, zip, message: String(b.message ?? '').replace(/\r\n?/g, '\n').trim().slice(0, 1000),
      lang: b.lang === 'en' ? 'en' : 'es',
    },
  };
}

// A template as the panel saves it. Throws a (Turkish, translated in admin-i18n.js) message when something is wrong.
function cleanTemplate(b) {
  const brand = text(b.brand, 40);
  if (!brand) throw new Error('Marka zorunlu');
  const status = b.status === 'pending' ? 'pending' : b.status === 'confirmed' ? 'confirmed' : '';
  if (!status) throw new Error('Geçersiz durum');
  const model = text(b.model, 80);
  if (status === 'confirmed' && !model) throw new Error('Onaylı şablonda model zorunlu');
  const aliases = [...new Set((Array.isArray(b.aliases) ? b.aliases : String(b.aliases ?? '').split(',')).map(norm).filter(Boolean))].slice(0, 20);
  if (status === 'confirmed' && !aliases.length) aliases.push(norm(model));
  const yf = Math.round(Number(b.year_from) || 0), yt = Math.round(Number(b.year_to) || 0);
  if (status === 'confirmed' && (yf < MIN_YEAR || yt < yf || yt > THIS_YEAR() + 1)) throw new Error('Geçersiz yıl aralığı');
  const one = (v, list) => { const s = String(v ?? ''); if (s && !list.includes(s)) throw new Error('Geçersiz seçim'); return s; };
  return {
    brand, model, aliases, year_from: status === 'confirmed' ? yf : 0, year_to: status === 'confirmed' ? yt : 0,
    body: one(b.body, BODIES), wheelbase: one(b.wheelbase, WHEELBASES.slice(0, 4)), roof: one(b.roof, ROOFS.slice(0, 3)), layout: one(b.layout, LAYOUTS),
    status, note: text(b.note, 200) || '',
  };
}

module.exports = {
  cleanTemplate,
  norm, BODIES, isVan, LAYOUTS, WHEELBASES, ROOFS, THIRD_ROW_SETS, MIN_YEAR,
  parseVehicle, templateRow, SEED_TEMPLATES, matchTemplate, templateLabel, zipPrefixes, inMeasureArea, validateRequest,
};
