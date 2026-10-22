// seed.js — first catalogue, inserted only when the products table is empty.
// After the first start, edit everything from /admin.

const P = '/img/products';
const TEMPS = ['4300K', '6000K', '8000K'];

// Build "SOCKET, TEMP = price" lines
function variantLines(rows) {
  const out = [];
  for (const [sockets, temps, price] of rows)
    for (const s of sockets) for (const t of temps) out.push(`${s}, ${t} = ${price}`);
  return out.join('\n');
}
// Build "SOCKET, TEMP = image" lines; file(s, t) returns the file name or null
function imageLines(dir, sockets, file) {
  const out = [];
  for (const s of sockets) for (const t of TEMPS) {
    const f = file(s, t);
    if (f) out.push(`${s}, ${t} = ${P}/${dir}/${f}`);
  }
  return out.join('\n');
}
const k = t => t.replace('K', '');

const XENON_OPTS = (sockets) =>
  `Socket | Casquillo: ${sockets.join(', ')}\nColour temperature | Temperatura de color: 4300K, 6000K, 8000K`;

const XENON_DESC_EN = (extra) => `Replacement xenon bulb for factory HID headlights. Same socket as your original bulb: unplug the old one and plug in the new one.

• 35W · 12V
• 4300K: warm white, like the original · 6000K: pure white · 8000K: cool white with a blue tint
${extra}
Price per bulb. To replace both headlights, choose quantity 2.

Not sure which socket you need? The code (D1S, D2S, D3S…) is printed on your current bulb, or send us your car on WhatsApp.`;

const XENON_DESC_ES = (extra) => `Bombilla xenón de recambio para faros HID de serie. Mismo casquillo que la original: quitas la vieja y pones la nueva.

• 35W · 12V
• 4300K: blanco cálido, como la original · 6000K: blanco puro · 8000K: blanco frío con tono azulado
${extra}
Precio por bombilla. Para cambiar los dos faros, elige cantidad 2.

¿No sabes qué casquillo necesitas? El código (D1S, D2S, D3S…) viene impreso en tu bombilla actual, o mándanos tu coche por WhatsApp.`;

// Safety information shown on each product page (EU General Product Safety Regulation)
const XENON_SAFETY = {
  en: 'Xenon bulbs work at high voltage when they light up. Switch off the lights and the ignition before fitting. Do not touch the glass with bare hands. Let a hot bulb cool down before removing it. If in doubt, have it fitted by a professional. Keep out of reach of children. Recycle at a lamp collection point, not with household waste.',
  es: 'Las bombillas xenón funcionan a alta tensión al encenderse. Apaga las luces y el contacto antes de instalarlas. No toques el cristal con las manos. Deja enfriar la bombilla antes de quitarla. Si tienes dudas, que la instale un profesional. Mantener fuera del alcance de los niños. Recíclala en un punto de recogida de lámparas, no con la basura doméstica.',
};
const MAT_SAFETY = {
  en: 'Place the mat so that it does not interfere with the pedals and fix it with your car\'s clips where available. Never put one mat on top of another. Check the position regularly.',
  es: 'Coloca la alfombrilla de forma que no interfiera con los pedales y fíjala con los anclajes de tu coche si los tiene. No pongas nunca una alfombrilla encima de otra. Revisa su posición de vez en cuando.',
};
const SAFETY = {
  'xenon-basic': XENON_SAFETY, 'xenon-plus': XENON_SAFETY, 'xenon-pro': XENON_SAFETY, 'xenon-ultra': XENON_SAFETY,
  'led-ake-f9a': {
    en: 'Switch off the lights before fitting. The base gets hot during use: let it cool down before touching it. Do not cover the fan. Check that the bulb fits your headlight and the local rules for use on public roads. Keep out of reach of children. Recycle as electronic waste.',
    es: 'Apaga las luces antes de instalarla. La base se calienta durante el uso: déjala enfriar antes de tocarla. No tapes el ventilador. Comprueba que encaja en tu faro y la normativa local para su uso en vías públicas. Mantener fuera del alcance de los niños. Recíclala como residuo electrónico.',
  },
  'evo-custom-mats': MAT_SAFETY, 'universal-mats-carpet': MAT_SAFETY, 'universal-mats-rubber': MAT_SAFETY, 'universal-mats-heavy-duty': MAT_SAFETY,
};

module.exports = function seed(db) {
  const ins = db.prepare(`INSERT INTO products
    (slug, category, name_en, name_es, desc_en, desc_es, price_cents, old_price_cents, image, gallery,
     options, variants, variant_images, fitment, sort, safety_en, safety_es)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const add = p => ins.run(p.slug, p.category, p.name_en, p.name_es, p.desc_en, p.desc_es,
    p.price, p.old || null, p.image, JSON.stringify(p.gallery || []),
    p.options || '', p.variants || '', p.variant_images || '', p.fitment || 'universal', p.sort,
    SAFETY[p.slug]?.en || '', SAFETY[p.slug]?.es || '');

  // ---------------- EVO custom mats ----------------
  add({
    slug: 'evo-custom-mats', category: 'mats', sort: 0, fitment: 'car',
    name_en: 'EVO Custom-Fit Car Mats', name_es: 'Alfombrillas EVO a medida',
    desc_en: `Made to measure for your exact car: brand, model, generation and year. Honeycomb EVO material with stitched edges, waterproof and easy to clean. Original fixing clips included where your car has them.

Each set is made to order and ships in 3–5 working days.`,
    desc_es: `Hechas a medida para tu coche exacto: marca, modelo, generación y año. Material EVO en panal con bordes cosidos, impermeable y fácil de limpiar. Incluye anclajes originales si tu coche los tiene.

Cada juego se fabrica bajo pedido y se envía en 3–5 días laborables.`,
    price: 5990, image: '/img/p-mat-evo.svg',
    options: `Set | Juego: Front (2 pcs) / Delanteras (2 uds), Full set (4 pcs) / Juego completo (4 uds) +15, Full set + boot / Juego completo + maletero +35
Mat colour | Color de alfombrilla: Black / Negro, Grey / Gris, Beige / Beige, Brown / Marrón, Blue / Azul, Red / Rojo
Stitching colour | Color de costura: Black / Negro, Red / Rojo, Blue / Azul, Grey / Gris, Beige / Beige`,
  });

  // ---------------- Xenon (4 quality levels) ----------------
  add({
    slug: 'xenon-basic', category: 'xenon', sort: 10,
    name_en: 'Xenon Bulb Basic', name_es: 'Bombilla Xenón Basic',
    desc_en: XENON_DESC_EN('• Good value replacement for everyday use\n'),
    desc_es: XENON_DESC_ES('• Recambio económico para el día a día\n'),
    price: 900, image: `${P}/xenon-basic/main.jpg`,
    gallery: [`${P}/xenon-basic/g1.jpg`, `${P}/xenon-basic/d2.jpg`, `${P}/xenon-basic/temps.jpg`, `${P}/xenon-basic/d1-vs-d3.jpg`],
    options: XENON_OPTS(['D1S', 'D1R', 'D2S', 'D2R', 'D3S', 'D3R']),
    variants: variantLines([
      [['D1S', 'D1R', 'D3S', 'D3R'], ['4300K', '6000K'], 25],
      [['D2S'], TEMPS, 9],
      [['D2R'], ['4300K', '6000K'], 9],
    ]),
    variant_images: [
      `D1S = ${P}/xenon-basic/main.jpg`, `D1R = ${P}/xenon-basic/g1.jpg`,
      `D3S = ${P}/xenon-basic/d3s.jpg`, `D3R = ${P}/xenon-basic/d3s.jpg`,
      `D2S = ${P}/xenon-basic/d2.jpg`, `D2R = ${P}/xenon-basic/d2.jpg`,
    ].join('\n'),
  });

  add({
    slug: 'xenon-plus', category: 'xenon', sort: 11,
    name_en: 'Xenon Bulb Plus', name_es: 'Bombilla Xenón Plus',
    desc_en: XENON_DESC_EN('• High-intensity light with quartz glass\n• Available in 4300K, 6000K and 8000K\n'),
    desc_es: XENON_DESC_ES('• Luz de alta intensidad con cristal de cuarzo\n• Disponible en 4300K, 6000K y 8000K\n'),
    price: 1300, image: `${P}/xenon-plus/main.jpg`,
    gallery: [`${P}/xenon-plus/temps.jpg`, `${P}/xenon-plus/d2s-6000.jpg`, `${P}/xenon-plus/d2-fit.jpg`, `${P}/xenon-plus/ip68.jpg`],
    options: XENON_OPTS(['D1S', 'D1R', 'D2S', 'D2R', 'D3S', 'D3R']),
    variants: variantLines([
      [['D1S', 'D1R', 'D3S', 'D3R'], TEMPS, 30],
      [['D2S'], TEMPS, 13],
      [['D2R'], ['4300K', '6000K'], 13],
    ]),
    variant_images: imageLines('xenon-plus', ['D1S', 'D1R', 'D3R', 'D3S', 'D2S', 'D2R'], (s, t) => {
      if (s === 'D1S') return `d1s-${k(t)}.jpg`;
      if (s === 'D1R' || s === 'D3R') return `dr-${k(t)}.jpg`;
      if (s === 'D3S') return `d3s-${k(t)}.jpg`;
      if (s === 'D2S') return `d2s-${k(t)}.jpg`;
      if (s === 'D2R' && t !== '8000K') return `d2r-${k(t)}.jpg`;
      return null;
    }),
  });

  add({
    slug: 'xenon-pro', category: 'xenon', sort: 12,
    name_en: 'Xenon Bulb Pro', name_es: 'Bombilla Xenón Pro',
    desc_en: XENON_DESC_EN('• Brighter, more focused beam for projector headlights\n• UV-filtered quartz glass and metal base\n'),
    desc_es: XENON_DESC_ES('• Haz más potente y concentrado para faros de proyector\n• Cristal de cuarzo con filtro UV y base metálica\n'),
    price: 1800, image: `${P}/xenon-pro/main.jpg`,
    gallery: [`${P}/xenon-pro/g1.jpg`, `${P}/xenon-pro/temps.jpg`, `${P}/xenon-pro/beam.jpg`, `${P}/xenon-pro/why.jpg`, `${P}/xenon-pro/d2.jpg`],
    options: XENON_OPTS(['D1S', 'D1R', 'D2S', 'D2R', 'D3S', 'D3R']),
    variants: variantLines([
      [['D1S', 'D1R', 'D3S', 'D3R'], TEMPS, 40],
      [['D2S'], TEMPS, 18],
      [['D2R'], ['4300K', '6000K'], 18],
    ]),
    variant_images: imageLines('xenon-pro', ['D1S', 'D3S', 'D1R', 'D3R', 'D2S', 'D2R'], (s, t) => {
      if (s === 'D1S' || s === 'D3S') return `ds-${k(t)}.jpg`;
      if (s === 'D1R' || s === 'D3R') return `dr-${k(t)}.jpg`;
      if (s === 'D2S') return `d2s-${k(t)}.jpg`;
      if (s === 'D2R' && t !== '8000K') return `d2r-${k(t)}.jpg`;
      return null;
    }),
  });

  add({
    slug: 'xenon-ultra', category: 'xenon', sort: 13,
    name_en: 'Xenon Bulb Ultra', name_es: 'Bombilla Xenón Ultra',
    desc_en: XENON_DESC_EN('• Our brightest xenon: intense, crisp light\n• Premium quartz glass for a long, stable life\n'),
    desc_es: XENON_DESC_ES('• Nuestro xenón más potente: luz intensa y nítida\n• Cristal de cuarzo premium para una vida larga y estable\n'),
    price: 2100, image: `${P}/xenon-ultra/main.jpg`,
    gallery: [`${P}/xenon-ultra/d1s-6000.jpg`, `${P}/xenon-ultra/temps.jpg`, `${P}/xenon-ultra/pair.jpg`, `${P}/xenon-ultra/d2s.jpg`],
    options: XENON_OPTS(['D1S', 'D2S', 'D3S']),
    variants: variantLines([
      [['D1S', 'D3S'], TEMPS, 50],
      [['D2S'], TEMPS, 21],
    ]),
    variant_images: imageLines('xenon-ultra', ['D1S', 'D2S', 'D3S'], (s, t) => `${s.toLowerCase()}-${k(t)}.jpg`),
  });

  // ---------------- LED ----------------
  add({
    slug: 'led-ake-f9a', category: 'led', sort: 20,
    name_en: 'AKE F9A LED Headlight Bulbs (pair)', name_es: 'Bombillas LED AKE F9A (pareja)',
    desc_en: `High-output LED bulbs to replace halogen bulbs. Same size as the original bulb, with a silent cooling fan.

• 50W · 5000 lm per bulb · 6000K pure white
• 6-chip LED with 360° adjustable base for a correct beam
• IP68 waterproof · works from −40 °C to +85 °C
• Up to 30,000 h lifetime
• Sold as a pair (2 bulbs)

Check the rules in your country before using LED retrofit bulbs on public roads.`,
    desc_es: `Bombillas LED de alta potencia para sustituir las halógenas. Mismo tamaño que la bombilla original, con ventilador silencioso.

• 50W · 5000 lm por bombilla · 6000K blanco puro
• LED de 6 chips con base ajustable 360° para un haz correcto
• Resistente al agua IP68 · funciona de −40 °C a +85 °C
• Hasta 30.000 h de vida útil
• Se venden por parejas (2 bombillas)

Consulta la normativa de tu país antes de usar bombillas LED de sustitución en vías públicas.`,
    price: 4000, image: `${P}/led-ake/main.jpg`,
    gallery: [`${P}/led-ake/specs.jpg`, `${P}/led-ake/types.jpg`, `${P}/led-ake/same-size.jpg`, `${P}/led-ake/adjustable.jpg`, `${P}/led-ake/distance.jpg`, `${P}/led-ake/fan.jpg`, `${P}/led-ake/waterproof.jpg`],
    options: 'Bulb type | Tipo de bombilla: H1, H4, H7, H11, 9005 (HB3), 9006 (HB4)',
    variant_images: [
      `H1 = ${P}/led-ake/h1.jpg`, `H4 = ${P}/led-ake/h4.jpg`, `H7 = ${P}/led-ake/h7.jpg`,
      `H11 = ${P}/led-ake/h11.jpg`, `9005 (HB3) = ${P}/led-ake/9005.jpg`, `9006 (HB4) = ${P}/led-ake/9006.jpg`,
    ].join('\n'),
  });

  // ---------------- Universal mats ----------------
  add({
    slug: 'universal-mats-carpet', category: 'mats', sort: 30,
    name_en: 'Universal Carpet Car Mats (4 pcs)', name_es: 'Alfombrillas universales de moqueta (4 uds)',
    desc_en: `BESTFOOT carpet mats with a reinforced heel pad and anti-slip base. Soft, quiet and fits most cars.

• 2 front + 2 rear mats
• Rubber heel pad on the driver's mat
• Anti-slip backing that stays in place`,
    desc_es: `Alfombrillas BESTFOOT de moqueta con talonera reforzada y base antideslizante. Suaves, silenciosas y válidas para la mayoría de coches.

• 2 delanteras + 2 traseras
• Talonera de goma en la alfombrilla del conductor
• Base antideslizante que no se mueve`,
    price: 2490, image: `${P}/mat-carpet/main.jpg`,
    gallery: [`${P}/mat-carpet/set.jpg`, `${P}/mat-carpet/car.jpg`, `${P}/mat-carpet/premium.jpg`, `${P}/mat-carpet/info.jpg`],
    options: 'Colour | Color: Black / Negro, Grey / Gris',
    variant_images: `Black = ${P}/mat-carpet/main.jpg\nGrey = ${P}/mat-carpet/grey.jpg`,
  });

  add({
    slug: 'universal-mats-rubber', category: 'mats', sort: 31,
    name_en: 'Universal Rubber Car Mats (4 pcs)', name_es: 'Alfombrillas universales de goma (4 uds)',
    desc_en: `BESTFOOT all-weather rubber mats. Waterproof, easy to clean with water and with a grip pattern that holds dirt.

• 2 front + 2 rear mats
• Front: approx. 72 × 46 cm · Rear: approx. 37 × 46 cm
• Flexible, odourless rubber`,
    desc_es: `Alfombrillas BESTFOOT de goma para todo tiempo. Impermeables, se limpian con agua y su dibujo retiene la suciedad.

• 2 delanteras + 2 traseras
• Delanteras: aprox. 72 × 46 cm · Traseras: aprox. 37 × 46 cm
• Goma flexible y sin olor`,
    price: 2790, image: `${P}/mat-rubber/main.jpg`,
    gallery: [`${P}/mat-rubber/set.jpg`, `${P}/mat-rubber/car.jpg`, `${P}/mat-rubber/water.jpg`, `${P}/mat-rubber/size-front.jpg`, `${P}/mat-rubber/size-rear.jpg`, `${P}/mat-rubber/info.jpg`],
  });

  add({
    slug: 'universal-mats-heavy-duty', category: 'mats', sort: 32,
    name_en: 'Universal 3D Heavy-Duty Car Mats (4 pcs)', name_es: 'Alfombrillas universales 3D reforzadas (4 uds)',
    desc_en: `BESTFOOT heavy-duty mats with raised edges that keep water, mud and sand inside the mat. Trim lines let you adjust them to your car.

• 2 front + 2 rear mats
• Deep channels and raised edges
• Anti-slip base · easy to wash`,
    desc_es: `Alfombrillas BESTFOOT reforzadas con bordes elevados que retienen el agua, el barro y la arena. Con líneas de corte para ajustarlas a tu coche.

• 2 delanteras + 2 traseras
• Canales profundos y bordes elevados
• Base antideslizante · fáciles de lavar`,
    price: 3490, image: `${P}/mat-heavy/main.jpg`,
    gallery: [`${P}/mat-heavy/set.jpg`, `${P}/mat-heavy/features.jpg`, `${P}/mat-heavy/front.jpg`, `${P}/mat-heavy/pair.jpg`],
  });
};
module.exports.SAFETY = SAFETY;
