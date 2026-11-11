// evo-prices.js — the made-to-measure EVO mats as sold in the shop: options, prices and texts.
// Source: the shop's own price list "Catálogo de alfombrillas a medida 2026–2027".
// Used by seed.js for a new catalogue. An existing catalogue is never changed by the code:
// the owner edits the product in /admin (options, prices and the extra price list are all there).
//
// The customer picks the type of vehicle, the set and the material; each combination has its own
// price. The vehicle itself (brand, model, year) is typed by the customer, not chosen from a list.
// The type of vehicle also decides the 3D picture on the product page (public/js/vehicle3d.js:
// the ids below are the ones that file draws). Cars and vans are priced by size class.
// The load-area floor of vans is not bought online: the list itself says its price is confirmed
// with the exact model and length, so it is in the extra price list, ordered by message.

// id → price class. Compact, saloon, estate and SUV have the same price (the list says so).
const VEHICLES = [
  { id: 'sedan', cls: 'car5', en: 'Sedan', es: 'Berlina' },
  { id: 'hatch', cls: 'car5', en: 'Compact / hatchback', es: 'Compacto' },
  { id: 'wagon', cls: 'car5', en: 'Estate', es: 'Familiar' },
  { id: 'suv', cls: 'car5', en: 'SUV · 5 seats', es: 'SUV · 5 plazas' },
  { id: 'suvbig', cls: 'big', en: 'Large SUV', es: 'SUV grande' },
  { id: 'mpv', cls: 'big', en: 'MPV / minivan', es: 'Monovolumen' },
  { id: 'vansmall', cls: 'vanS', en: 'Small van · Berlingo, Caddy, Kangoo…', es: 'Furgoneta pequeña · Berlingo, Caddy, Kangoo…' },
  { id: 'vanmedium', cls: 'vanM', en: 'Medium van · Vito, Trafic, Transit Custom…', es: 'Furgoneta mediana · Vito, Trafic, Transit Custom…' },
  { id: 'vanlarge', cls: 'vanL', en: 'Large van · Sprinter, Ducato, Crafter…', es: 'Furgón grande · Sprinter, Ducato, Crafter…' },
];
const SETS = [
  { id: 'set4', en: '4-piece set', es: 'Juego de 4 piezas' },
  { id: 'boot', en: 'Boot mat', es: 'Alfombra de maletero' },
  { id: 'pack', en: 'Pack · 4-piece set + boot mat', es: 'Pack · juego de 4 piezas + maletero' },
  { id: 'set4r3', en: '4-piece set + third row (7 seats)', es: 'Juego de 4 piezas + tercera fila (7 plazas)' },
  { id: 'packr3', en: 'Pack + third row (7 seats)', es: 'Pack + tercera fila (7 plazas)' },
  { id: 'cab', en: 'Cabin set', es: 'Juego de cabina' },
  { id: 'cab2', en: 'Cabin set + second row (crew cab)', es: 'Juego de cabina + segunda fila (doble cabina)' },
];
const MATERIALS = [
  { id: 'std', en: 'Standard', es: 'Estándar' },
  { id: 'prem', en: 'Premium', es: 'Premium' },
];

// Euros, [Standard, Premium], by price class. A set that is missing for a class is not sold for it.
// Pack = set + boot mat with 5 € off. Third row = the list's supplement (+15 € / +20 €) added to
// the set or the pack; only for the large size (5-seat cars have no third row). Second row of a
// crew-cab van = the list's +25 € / +30 € added to the cabin set.
const PRICES = {
  car5: { set4: [40, 50], boot: [50, 60], pack: [85, 105] },
  big: { set4: [50, 60], boot: [60, 70], pack: [105, 125], set4r3: [65, 80], packr3: [120, 145] },
  vanS: { cab: [40, 50], cab2: [65, 80] },
  vanM: { cab: [50, 60], cab2: [75, 90] },
  vanL: { cab: [50, 60], cab2: [75, 90] },
};

const value = v => ({ id: v.id, en: v.en, es: v.es, delta: 0, soon: false, out: false, media: [] });
const options = [
  { id: 'veh', en: 'Type of vehicle', es: 'Tipo de vehículo', values: VEHICLES.map(value) },
  { id: 'set', en: 'Set', es: 'Juego', values: SETS.map(value) },
  { id: 'mat', en: 'Material', es: 'Material', values: MATERIALS.map(value) },
];
const combos = {};
for (const v of VEHICLES) for (const s of SETS) MATERIALS.forEach((m, i) => {
  const p = PRICES[v.cls][s.id];
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

Elige el tipo de vehículo, el juego y el material, y escribe la marca, el modelo y el año de tu vehículo. Se envía como solicitud: comprobamos que tenemos plantilla para tu vehículo (si no, habría que medirlo en persona, solo en la zona de Madrid) y te respondemos. No se cobra nada hasta que lo confirmemos. La imagen 3D es solo ilustrativa.

Cada juego se fabrica bajo pedido. El plazo de fabricación y de envío te lo confirmamos al responder tu solicitud.`;

const desc_en = `Mats cut to the exact size of your vehicle: brand, model and year. They cover the floor with no gaps or folds.

• Full 4-piece set: 2 front and 2 rear mats
• Honeycomb cells that hold water, mud and sand
• Waterproof: cleaned in seconds with water
• Bound edge all around
• Fixing for your vehicle's original anchor points
• Black, suits any interior

Two materials with the same made-to-measure cut. Standard: the budget option, full floor protection for everyday use. Premium: a higher-quality material with a better finish that stands up to heavy use.

Choose the type of vehicle, the set and the material, and write your vehicle's brand, model and year. It is sent as a request: we check that we have a template for your vehicle (if not, it would have to be measured in person, in the Madrid area only) and answer you. Nothing is charged until we have confirmed it. The 3D picture is only an illustration.

Each set is made to order. We confirm the production and delivery time when we answer your request.`;

// Extra price list (text format of the "Prices" tab: "# Title | column | column", then "Row | price | price").
// The cabin sets of vans are options above, so the tab shows them already; only the load-area floors are here.
const prices_es = `# Furgonetas · suelo de la zona de carga | Estándar | Premium
Furgoneta pequeña · Berlingo, Caddy, Kangoo, Partner, Combo, Doblò | 90 € | 110 €
Furgoneta mediana · batalla corta L1 | 130 € | 160 €
Furgoneta mediana · batalla larga L2 | 150 € | 180 €
Furgón grande · medio L2 | 180 € | 220 €
Furgón grande · largo L3 | 210 € | 250 €
Furgón grande · extralargo L4 | 240 € | 290 €

El suelo de la zona de carga se pide por mensaje: dinos marca, modelo, año y longitud, y confirmamos el precio.
Pack de cabina y zona de carga: 10 € de descuento.
Los modelos indicados son ejemplos de cada tamaño: fabricamos para cualquier marca y modelo.`;

const prices_en = `# Vans · load-area floor | Standard | Premium
Small van · Berlingo, Caddy, Kangoo, Partner, Combo, Doblò | €90 | €110
Medium van · short wheelbase L1 | €130 | €160
Medium van · long wheelbase L2 | €150 | €180
Large van · medium L2 | €180 | €220
Large van · long L3 | €210 | €250
Large van · extra long L4 | €240 | €290

The load-area floor is ordered by message: tell us the brand, model, year and length, and we confirm the price.
Cabin set + load-area floor pack: €10 off.
The models are examples of each size: we make mats for any brand and model.`;

module.exports = {
  VEHICLES, SETS, MATERIALS, PRICES,
  product: {
    name_en: 'EVO Custom-Fit Car Mats', name_es: 'Alfombrillas EVO a medida',
    price_cents: 4000, options, combos, desc_en, desc_es, prices_en, prices_es,
  },
};
