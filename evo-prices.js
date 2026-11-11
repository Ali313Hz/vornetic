// evo-prices.js — the made-to-measure EVO mats as sold in the shop: options, prices and texts.
// Source: the shop's own price list "Catálogo de alfombrillas a medida 2026–2027".
// Used by seed.js for a new catalogue. An existing catalogue is never changed by the code:
// the owner edits the product in /admin (options, prices and the extra price list are all there).
//
// Cars are bought online: vehicle size × set × material, each combination with its own price.
// Vans (cabin sets, load-area floors) are in the extra price list of the "Prices" tab and are
// ordered by message: the load-area price is confirmed with the exact model and length.

const VEHICLES = [
  { id: 'car5', en: 'Car or SUV · 5 seats', es: 'Turismo o SUV · 5 plazas' },
  { id: 'big', en: 'Large SUV or MPV', es: 'SUV grande o monovolumen' },
];
const SETS = [
  { id: 'set4', en: '4-piece set', es: 'Juego de 4 piezas' },
  { id: 'boot', en: 'Boot mat', es: 'Alfombra de maletero' },
  { id: 'pack', en: 'Pack · 4-piece set + boot mat', es: 'Pack · juego de 4 piezas + maletero' },
  { id: 'set4r3', en: '4-piece set + third row (7 seats)', es: 'Juego de 4 piezas + tercera fila (7 plazas)' },
  { id: 'packr3', en: 'Pack + third row (7 seats)', es: 'Pack + tercera fila (7 plazas)' },
];
const MATERIALS = [
  { id: 'std', en: 'Standard', es: 'Estándar' },
  { id: 'prem', en: 'Premium', es: 'Premium' },
];

// Euros, [Standard, Premium]. A set that is missing for a vehicle size is not sold for it.
// Pack = set + boot mat with 5 € off. Third row = the list's supplement (+15 € / +20 €) added to
// the set or the pack; only for the large size (5-seat cars have no third row).
const PRICES = {
  car5: { set4: [40, 50], boot: [50, 60], pack: [85, 105] },
  big: { set4: [50, 60], boot: [60, 70], pack: [105, 125], set4r3: [65, 80], packr3: [120, 145] },
};

const value = v => ({ id: v.id, en: v.en, es: v.es, delta: 0, soon: false, out: false, media: [] });
const options = [
  { id: 'veh', en: 'Vehicle', es: 'Vehículo', values: VEHICLES.map(value) },
  { id: 'set', en: 'Set', es: 'Juego', values: SETS.map(value) },
  { id: 'mat', en: 'Material', es: 'Material', values: MATERIALS.map(value) },
];
const combos = {};
for (const v of VEHICLES) for (const s of SETS) MATERIALS.forEach((m, i) => {
  const p = PRICES[v.id][s.id];
  combos[`${v.id}|${s.id}|${m.id}`] = p ? { price: p[i] * 100 } : { off: true };
});

const desc_es = `Alfombrillas cortadas a la medida exacta de tu vehículo: marca, modelo y año. Cubren el suelo sin huecos ni pliegues.

• Juego completo de 4 piezas: 2 delanteras y 2 traseras
• Celdas en forma de panal que retienen el agua, el barro y la arena
• Impermeables: se limpian en segundos con agua
• Borde ribeteado en todo el contorno
• Fijación para los anclajes originales del vehículo
• Color negro, válido para cualquier interior

Dos materiales con el mismo corte a medida. Estándar: la opción económica, protección completa del suelo para el uso diario. Premium: material de mayor calidad, con mejor acabado y más resistente al uso intensivo.

Cada juego se fabrica bajo pedido y se envía en 3–5 días laborables.`;

const desc_en = `Mats cut to the exact size of your vehicle: brand, model and year. They cover the floor with no gaps or folds.

• Full 4-piece set: 2 front and 2 rear mats
• Honeycomb cells that hold water, mud and sand
• Waterproof: cleaned in seconds with water
• Bound edge all around
• Fixing for your vehicle's original anchor points
• Black, suits any interior

Two materials with the same made-to-measure cut. Standard: the budget option, full floor protection for everyday use. Premium: a higher-quality material with a better finish that stands up to heavy use.

Each set is made to order and ships in 3–5 working days.`;

// Extra price list (text format of the "Prices" tab: "# Title | column | column", then "Row | price | price")
const prices_es = `# Furgonetas · juego de cabina | Estándar | Premium
Furgoneta pequeña · Berlingo, Partner, Caddy, Kangoo, Combo, Doblò | 40 € | 50 €
Furgoneta mediana · Vito, Trafic, Transit Custom, Transporter, Expert, Jumpy | 50 € | 60 €
Furgón grande · Sprinter, Ducato, Master, Crafter, Boxer, Jumper, Transit | 50 € | 60 €
Segunda fila · combi y doble cabina (pieza adicional) | +25 € | +30 €

# Furgonetas · suelo de la zona de carga | Estándar | Premium
Furgoneta pequeña · Berlingo, Caddy, Kangoo, Partner, Combo, Doblò | 90 € | 110 €
Furgoneta mediana · batalla corta L1 | 130 € | 160 €
Furgoneta mediana · batalla larga L2 | 150 € | 180 €
Furgón grande · medio L2 | 180 € | 220 €
Furgón grande · largo L3 | 210 € | 250 €
Furgón grande · extralargo L4 | 240 € | 290 €

Pack de cabina y zona de carga: 10 € de descuento.
Los modelos indicados son ejemplos de cada tamaño: fabricamos para cualquier marca y modelo. El precio de la zona de carga se confirma con el modelo y la longitud exactos.
Las furgonetas se piden por mensaje: dinos marca, modelo y año.`;

const prices_en = `# Vans · cabin set | Standard | Premium
Small van · Berlingo, Partner, Caddy, Kangoo, Combo, Doblò | €40 | €50
Medium van · Vito, Trafic, Transit Custom, Transporter, Expert, Jumpy | €50 | €60
Large van · Sprinter, Ducato, Master, Crafter, Boxer, Jumper, Transit | €50 | €60
Second row · crew cab (extra piece) | +€25 | +€30

# Vans · load-area floor | Standard | Premium
Small van · Berlingo, Caddy, Kangoo, Partner, Combo, Doblò | €90 | €110
Medium van · short wheelbase L1 | €130 | €160
Medium van · long wheelbase L2 | €150 | €180
Large van · medium L2 | €180 | €220
Large van · long L3 | €210 | €250
Large van · extra long L4 | €240 | €290

Cabin set + load-area floor pack: €10 off.
The models are examples of each size: we make mats for any brand and model. The load-area price is confirmed with the exact model and length.
Vans are ordered by message: tell us the brand, model and year.`;

module.exports = {
  VEHICLES, SETS, MATERIALS, PRICES,
  product: {
    name_en: 'EVO Custom-Fit Car Mats', name_es: 'Alfombrillas EVO a medida',
    price_cents: 4000, options, combos, desc_en, desc_es, prices_en, prices_es,
  },
};
