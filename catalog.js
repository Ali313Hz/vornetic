// catalog.js — product options, variant combinations, prices and media
//
// A product is stored with three JSON columns:
//   opts   : [{ id, en, es, values: [{ id, en, es, delta, soon, media: [Media] }] }]
//            delta = price difference in cents for this choice, soon = "coming soon" (not sellable yet)
//   combos : { "valueId|valueId": { off, price, media } }   — only combinations that differ from the default
//            off = not sold, price = fixed price in cents (instead of base + deltas), media = own photos/videos
//   media  : [Media]   — general gallery, first item is the main picture
//   Media  = { type: 'image' | 'video', src: '/uploads/…' | '/img/…' }
const crypto = require('crypto');

const uid = () => crypto.randomBytes(4).toString('hex');
const json = (s, d) => { try { return s ? JSON.parse(s) : d; } catch { return d; } };
const str = (v, max = 200) => String(v ?? '').trim().slice(0, max);
const int = v => { const n = Math.round(Number(v)); return Number.isFinite(n) ? n : 0; };
const MAX_COMBOS = 1000;

// ---------- reading ----------
function read(row) {
  return {
    options: json(row.opts, []),
    combos: json(row.combos, {}),
    media: json(row.media, []),
  };
}

// Every combination of value ids, in option order
function allCombos(options) {
  let out = [[]];
  for (const o of options) {
    const next = [];
    for (const prev of out) for (const v of o.values) next.push([...prev, v.id]);
    out = next;
    if (out.length > MAX_COMBOS) return out.slice(0, MAX_COMBOS);
  }
  return options.length ? out : [];
}
const keyOf = ids => ids.join('|');

function priceOf(base, options, combos, ids) {
  const c = combos[keyOf(ids)];
  if (c && Number.isInteger(c.price)) return c.price;
  return base + ids.reduce((a, id, i) => a + (options[i].values.find(v => v.id === id)?.delta || 0), 0);
}
function sellable(options, combos, ids) {
  if (combos[keyOf(ids)]?.off) return false;
  return ids.every((id, i) => !options[i].values.find(v => v.id === id)?.soon);
}

// For the shop: what the customer sees
function publicProduct(row) {
  const { options, combos, media } = read(row);
  const base = row.price_cents;
  let prices = [base];
  if (options.length) {
    prices = allCombos(options).filter(ids => sellable(options, combos, ids)).map(ids => priceOf(base, options, combos, ids));
    if (!prices.length) prices = [base];
  }
  const min = Math.min(...prices), max = Math.max(...prices);
  return {
    id: row.id, slug: row.slug, category: row.category,
    name: { en: row.name_en, es: row.name_es },
    desc: { en: row.desc_en, es: row.desc_es },
    status: row.status || 'available',              // available | soon
    in_stock: row.stock > 0,
    base_cents: base, price_cents: min, from: min !== max,
    old_price_cents: row.old_price_cents,
    media, options, combos,
    image: media.find(m => m.type === 'image')?.src || row.image || '',
    fitment: row.fitment,
    safety: { en: row.safety_en || '', es: row.safety_es || '' },
    manufacturer: row.manufacturer || '', eu_responsible: row.eu_responsible || '',
  };
}

// Check a cart line: sel = { optionId: valueId }
function priceForSelection(row, sel) {
  const { options, combos } = read(row);
  const ids = [], labels = [], labelsEs = [];
  for (const o of options) {
    const v = o.values.find(x => x.id === (sel || {})[o.id]);
    if (!v) throw new Error(`Please choose: ${o.en}`);
    ids.push(v.id);
    labels.push(`${o.en}: ${v.en}`);
    labelsEs.push(`${o.es || o.en}: ${v.es || v.en}`);
  }
  if (options.length && !sellable(options, combos, ids)) throw new Error(`Not available: ${row.name_en} — ${labels.join(', ')}`);
  return { unit: priceOf(row.price_cents, options, combos, ids), labels, labelsEs };
}

// ---------- writing (admin) ----------
const okSrc = s => typeof s === 'string' && /^\/(uploads|img)\/[\w\-./]+$/.test(s) && !s.includes('..');
function cleanMedia(list, max = 30) {
  return (Array.isArray(list) ? list : [])
    .filter(m => m && okSrc(m.src))
    .map(m => ({ type: m.type === 'video' ? 'video' : 'image', src: m.src }))
    .slice(0, max);
}
function cleanOptions(list) {
  const seen = new Set();
  const id = x => { let v = /^[a-z0-9]{1,16}$/.test(x) && !seen.has(x) ? x : uid(); seen.add(v); return v; };
  return (Array.isArray(list) ? list : []).slice(0, 3).map(o => ({
    id: id(o.id),
    en: str(o.en, 60) || str(o.es, 60) || 'Option',
    es: str(o.es, 60) || str(o.en, 60) || 'Opción',
    values: (Array.isArray(o.values) ? o.values : []).slice(0, 50).map(v => ({
      id: id(v.id),
      en: str(v.en, 80) || str(v.es, 80),
      es: str(v.es, 80) || str(v.en, 80),
      delta: int(v.delta),
      soon: !!v.soon,
      media: cleanMedia(v.media, 20),
    })).filter(v => v.en),
  })).filter(o => o.values.length);
}
function cleanCombos(obj, options) {
  const valid = new Set(allCombos(options).map(keyOf));
  const out = {};
  for (const [k, c] of Object.entries(obj && typeof obj === 'object' ? obj : {})) {
    if (!valid.has(k) || !c) continue;
    const e = {};
    if (c.off) e.off = true;
    if (c.price !== undefined && c.price !== null && c.price !== '' && int(c.price) >= 0) e.price = int(c.price);
    const m = cleanMedia(c.media, 20);
    if (m.length) e.media = m;
    if (Object.keys(e).length) out[k] = e;
  }
  return out;
}

// ---------- one-time conversion from the first (text based) format ----------
function migrate(row, { parseOptions, parseVariants, parseVariantImages }) {
  const textOpts = parseOptions(row.options);
  const options = textOpts.map((o, i) => ({
    id: `o${i}`, en: o.en, es: o.es,
    values: o.values.map((v, j) => ({ id: `o${i}v${j}`, en: v.en, es: v.es, delta: v.delta, soon: false, media: [] })),
  }));
  const label = (i, id) => options[i].values.find(v => v.id === id).en.toLowerCase();
  const combos = {};
  let base = row.price_cents;
  const prices = parseVariants(row.variants);
  if (prices && options.length) {
    base = Math.min(...Object.values(prices));
    options.forEach(o => o.values.forEach(v => { v.delta = 0; }));
    // price per value of the first option when it is the same for every combination
    for (const v of options[0].values) {
      const ps = Object.entries(prices).filter(([k]) => k.split('|')[0] === v.en.toLowerCase()).map(e => e[1]);
      if (ps.length && ps.every(p => p === ps[0])) v.delta = ps[0] - base;
    }
    for (const ids of allCombos(options)) {
      const p = prices[ids.map((id, i) => label(i, id)).join('|')];
      if (p == null) combos[keyOf(ids)] = { off: true };
      else if (p !== priceOf(base, options, {}, ids)) combos[keyOf(ids)] = { price: p };
    }
  }
  const vi = parseVariantImages(row.variant_images);
  for (const [k, src] of Object.entries(vi)) {
    const parts = k.split('|');
    const img = { type: 'image', src };
    if (parts.length === 1) {
      for (const o of options) for (const v of o.values) if (v.en.toLowerCase() === parts[0]) v.media.push(img);
    } else if (parts.length === options.length) {
      const ids = parts.map((lab, i) => options[i].values.find(v => v.en.toLowerCase() === lab)?.id);
      if (ids.every(Boolean)) (combos[keyOf(ids)] = combos[keyOf(ids)] || {}).media = [img];
    }
  }
  const media = [...new Set([row.image, ...json(row.gallery, [])].filter(Boolean))].map(src => ({ type: 'image', src }));
  return {
    opts: JSON.stringify(options), combos: JSON.stringify(combos), media: JSON.stringify(media),
    price_cents: base, status: row.active ? 'available' : 'hidden',
  };
}

module.exports = {
  uid, read, allCombos, keyOf, priceOf, sellable, publicProduct, priceForSelection,
  cleanMedia, cleanOptions, cleanCombos, migrate, okSrc,
};
