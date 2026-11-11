// vehicle3d.js — a small 3D picture of the chosen type of vehicle, with the mats of the chosen set inside.
// Used on the EVO (made-to-measure mats) page. No library: the shapes are flat-shaded polygons drawn on a
// 2D canvas (painter's algorithm), so nothing is loaded from outside and the page's CSP stays as it is.
// It illustrates a body type (sedan, SUV, van…), not a make or model: the customer types the real vehicle.
// The ids (sedan, hatch, wagon, suv, suvbig, mpv, vansmall, vanmedium, vanlarge) are the ones of evo-prices.js.
(function () {
  'use strict';

  // ---------- shapes (metres; x = forward, the front of the vehicle is +x; y = up; z = to the right) ----------
  // Cars: the side outline of the lower body and of the glass cabin. Vans: one outline for the whole shell
  // plus the side windows. rows = x of the hip point of each seat row (front, second, third).
  const CAR = (L, W, wb, wr, floor, bootFloor, rows, body, cabin) => ({ kind: 'car', L, W, wb, wr, floor, bootFloor, rows, body, cabin });
  const VAN = (L, W, wb, wr, floor, rows, shell, windows) => ({ kind: 'van', L, W, wb, wr, floor, rows, shell, windows });
  const SPECS = {
    sedan: CAR(4.7, 1.82, 2.8, 0.34, 0.34, 0.62, [0.0, -1.0],
      [[-2.35, 0.30], [2.35, 0.30], [2.35, 0.62], [2.22, 0.80], [1.12, 0.94], [-1.38, 0.97], [-2.26, 0.94], [-2.35, 0.74]],
      [[1.12, 0.94], [0.42, 1.45], [-0.72, 1.45], [-1.42, 0.97]]),
    hatch: CAR(4.1, 1.78, 2.55, 0.32, 0.33, 0.62, [-0.05, -0.95],
      [[-2.05, 0.30], [2.05, 0.30], [2.05, 0.60], [1.92, 0.78], [0.98, 0.90], [-1.90, 0.95], [-2.05, 0.80]],
      [[0.98, 0.90], [0.32, 1.46], [-1.10, 1.46], [-1.92, 0.95]]),
    wagon: CAR(4.75, 1.82, 2.85, 0.34, 0.34, 0.62, [0.1, -0.85],
      [[-2.375, 0.30], [2.375, 0.30], [2.375, 0.62], [2.24, 0.80], [1.18, 0.94], [-2.30, 0.98], [-2.375, 0.82]],
      [[1.18, 0.94], [0.50, 1.47], [-1.75, 1.47], [-2.28, 0.98]]),
    suv: CAR(4.6, 1.86, 2.75, 0.38, 0.42, 0.72, [0.1, -0.9],
      [[-2.3, 0.40], [2.3, 0.40], [2.3, 0.80], [2.16, 1.02], [1.10, 1.12], [-2.22, 1.15], [-2.3, 1.0]],
      [[1.10, 1.12], [0.45, 1.68], [-1.70, 1.68], [-2.22, 1.15]]),
    suvbig: CAR(5.0, 1.96, 3.0, 0.42, 0.45, 0.78, [0.25, -0.75, -1.55],
      [[-2.5, 0.42], [2.5, 0.42], [2.5, 0.88], [2.34, 1.10], [1.30, 1.20], [-2.42, 1.22], [-2.5, 1.05]],
      [[1.30, 1.20], [0.62, 1.85], [-1.90, 1.85], [-2.42, 1.22]]),
    mpv: CAR(4.7, 1.86, 2.85, 0.36, 0.36, 0.66, [0.2, -0.8, -1.6],
      [[-2.35, 0.32], [2.35, 0.32], [2.35, 0.66], [2.20, 0.86], [1.35, 0.98], [-2.28, 1.02], [-2.35, 0.90]],
      [[1.35, 0.98], [0.60, 1.78], [-1.95, 1.78], [-2.30, 1.02]]),
    vansmall: VAN(4.4, 1.85, 2.75, 0.37, 0.38, [0.45, -0.55],
      [[-2.2, 0.32], [2.2, 0.32], [2.2, 0.66], [2.08, 0.86], [1.35, 0.98], [0.72, 1.86], [-2.15, 1.86], [-2.2, 1.70]],
      [[1.15, 1.15], [0.78, 1.74], [-0.28, 1.74], [-0.28, 1.15]]),
    vanmedium: VAN(5.0, 1.96, 3.1, 0.38, 0.40, [0.7, -0.3],
      [[-2.5, 0.34], [2.5, 0.34], [2.5, 0.70], [2.36, 0.92], [1.55, 1.04], [0.95, 1.95], [-2.45, 1.95], [-2.5, 1.80]],
      [[1.35, 1.22], [1.02, 1.84], [0.0, 1.84], [0.0, 1.22]]),
    vanlarge: VAN(5.9, 2.0, 3.8, 0.41, 0.42, [1.0, 0.0],
      [[-2.95, 0.40], [2.95, 0.40], [2.95, 0.80], [2.82, 1.05], [2.10, 1.20], [1.55, 2.50], [-2.9, 2.50], [-2.95, 2.30]],
      [[1.95, 1.45], [1.62, 2.30], [0.55, 2.30], [0.55, 1.45]]),
  };
  const VEHICLE_IDS = Object.keys(SPECS);

  // which mats each set of evo-prices.js has: front (2 pieces), rear = second row of a car (2 pieces),
  // second = second row of a crew-cab van (1 piece), third = third row (1 piece), boot (1 piece)
  const SETS = {
    set4: ['front', 'rear'], boot: ['boot'], pack: ['front', 'rear', 'boot'],
    set4r3: ['front', 'rear', 'third'], packr3: ['front', 'rear', 'third', 'boot'],
    cab: ['front'], cab2: ['front', 'second'],
  };

  const PAINT = [214, 216, 220], GLASS = [96, 126, 156], TYRE = [40, 40, 44], HUB = [176, 178, 184], SEAT = [150, 152, 160];
  const MAT_ON = [28, 28, 30], MAT_OFF = [176, 176, 172], LAMP = [250, 236, 170], TAIL = [200, 52, 52];
  const LINE = 'rgba(70,74,84,0.5)';

  // ---------- geometry ----------
  const LIGHT = (v => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; })([0.35, 0.8, 0.45]);
  function normalOf(pts) {                                    // Newell's method: works for any flat polygon
    let nx = 0, ny = 0, nz = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      nx += (a[1] - b[1]) * (a[2] + b[2]); ny += (a[2] - b[2]) * (a[0] + b[0]); nz += (a[0] - b[0]) * (a[1] + b[1]);
    }
    const l = Math.hypot(nx, ny, nz) || 1;
    return [nx / l, ny / l, nz / l];
  }
  function face(pts, rgb, a, extra) {
    const n = normalOf(pts);
    const shade = 0.62 + 0.38 * Math.abs(n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2]);
    return Object.assign({ pts, rgb, a, shade, stroke: LINE, dash: false, bias: 0, layer: 1, fill: true }, extra);
  }
  // a flat outline [x, y] pushed out between z0 and z1: two caps and one quad per edge
  function prism(faces, poly, z0, z1, o) {
    const cap = z => poly.map(p => [p[0], p[1], z]);
    faces.push(face(cap(z0), o.cap, o.capA), face(cap(z1), o.cap, o.capA));
    poly.forEach((a, i) => {
      if (o.skip && o.skip.includes(i)) return;
      const b = poly[(i + 1) % poly.length];
      const glass = o.glass && o.glass.includes(i);
      faces.push(face([[a[0], a[1], z0], [b[0], b[1], z0], [b[0], b[1], z1], [a[0], a[1], z1]],
        glass ? GLASS : o.cap, glass ? 0.32 : o.capA));
    });
  }
  function box(faces, x0, x1, y0, y1, z0, z1, rgb, a) {
    const P = (x, y, z) => [x, y, z];
    [[P(x0, y0, z0), P(x1, y0, z0), P(x1, y1, z0), P(x0, y1, z0)], [P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1)],
      [P(x0, y0, z0), P(x0, y0, z1), P(x0, y1, z1), P(x0, y1, z0)], [P(x1, y0, z0), P(x1, y0, z1), P(x1, y1, z1), P(x1, y1, z0)],
      [P(x0, y1, z0), P(x1, y1, z0), P(x1, y1, z1), P(x0, y1, z1)]].forEach(pts => faces.push(face(pts, rgb, a)));
  }
  const circle = (cx, cy, r, n) => Array.from({ length: n }, (_, i) => [cx + r * Math.cos(i / n * 2 * Math.PI), cy + r * Math.sin(i / n * 2 * Math.PI)]);
  function wheel(faces, cx, cy, cz, r) {
    const side = cz > 0 ? 1 : -1, w = 0.12, ring = circle(cx, cy, r, 14);
    const at = (pts, z) => pts.map(p => [p[0], p[1], z]);
    const outer = cz + side * w, inner = cz - side * w;
    ring.forEach((a, i) => {
      const b = ring[(i + 1) % ring.length];
      faces.push(face([[a[0], a[1], inner], [b[0], b[1], inner], [b[0], b[1], outer], [a[0], a[1], outer]], TYRE, 0.95, { stroke: null }));
    });
    faces.push(face(at(ring, inner), TYRE, 0.95, { stroke: null }), face(at(ring, outer), TYRE, 0.95, { stroke: null }));
    faces.push(face(at(circle(cx, cy, r * 0.5, 8), outer + side * 0.004), HUB, 0.95, { stroke: null, bias: 0.05 }));
  }
  const matPoly = (x0, x1, z0, z1, y) => { const c = 0.10; return [[x0, y, z0], [x1 - c, y, z0], [x1, y, z0 + c], [x1, y, z1 - c], [x1 - c, y, z1], [x0, y, z1]]; };

  // The faces of one vehicle with one set. setId unknown / missing: the mats a car or van has, none chosen yet.
  function build(vehicleId, setId) {
    const spec = SPECS[vehicleId] || SPECS.sedan;
    const faces = [];
    const { L, W, wb, wr, floor, rows } = spec;
    const chosen = SETS[setId] || null;
    const parts = chosen || (spec.kind === 'van' ? ['front'] : ['front', 'rear']);
    const has = p => parts.includes(p);

    // ground shadow
    faces.push(face(circle(0, 0, 1, 28).map(p => [p[0] * L * 0.56, 0, p[1] * W * 0.66]), [0, 0, 0], 0.08, { layer: 0, stroke: null }));

    // body, cabin, windows and lamps
    if (spec.kind === 'car') {
      prism(faces, spec.body, -W / 2, W / 2, { cap: PAINT, capA: 0.30, skip: [0] });
      prism(faces, spec.cabin, -W / 2 + 0.12, W / 2 - 0.12, { cap: GLASS, capA: 0.30, glass: [0, 2], skip: [3] });
    } else {
      prism(faces, spec.shell, -W / 2, W / 2, { cap: PAINT, capA: 0.30, glass: [4], skip: [0] });
      for (const z of [-W / 2 - 0.004, W / 2 + 0.004]) faces.push(face(spec.windows.map(p => [p[0], p[1], z]), GLASS, 0.38, { bias: 0.05 }));
    }
    const outline = spec.kind === 'car' ? spec.body : spec.shell;
    const lampY = outline[2][1], tailY = outline[outline.length - 1][1];
    for (const s of [-1, 1]) {
      faces.push(face([[L / 2 + 0.004, lampY - 0.13, s * 0.55], [L / 2 + 0.004, lampY - 0.13, s * 0.86], [L / 2 + 0.004, lampY - 0.03, s * 0.86], [L / 2 + 0.004, lampY - 0.03, s * 0.55]], LAMP, 0.95, { stroke: null, bias: 0.05 }));
      faces.push(face([[-L / 2 - 0.004, tailY - 0.14, s * 0.55], [-L / 2 - 0.004, tailY - 0.14, s * 0.86], [-L / 2 - 0.004, tailY - 0.04, s * 0.86], [-L / 2 - 0.004, tailY - 0.04, s * 0.55]], TAIL, 0.95, { stroke: null, bias: 0.05 }));
    }

    // wheels
    for (const x of [wb / 2, -wb / 2]) for (const z of [-(W / 2 - 0.1), W / 2 - 0.1]) wheel(faces, x, wr, z, wr);

    // seats: front row, second row, third row (only when the set has a piece for it)
    const rowsShown = [0, has('rear') || has('second') ? 1 : -1, has('third') ? 2 : -1].filter(i => i >= 0 && rows[i] !== undefined);
    for (const i of rowsShown) {
      const h = rows[i];
      for (const zc of i === 2 ? [-0.40, 0.40] : [-0.40, 0.40]) {
        box(faces, h - 0.26, h + 0.26, floor + 0.02, floor + 0.26, zc - 0.24, zc + 0.24, SEAT, 0.42);
        box(faces, h - 0.36, h - 0.22, floor + 0.26, floor + 0.82, zc - 0.24, zc + 0.24, SEAT, 0.42);
      }
    }

    // mats: the ones of the chosen set are dark with a stitched line, the others only a faint shape
    const mats = [];
    const y = floor + 0.012, y2 = y + 0.001;
    const pieces = [];                                          // [part, x0, x1, [z0, z1] ...]
    const two = [[-0.70, -0.10], [0.10, 0.70]];
    pieces.push(['front', rows[0] + 0.18, rows[0] + 1.12, two]);
    if (spec.kind === 'car') pieces.push(['rear', rows[1] + 0.12, rows[1] + 0.80, two]);
    else pieces.push(['second', rows[1] + 0.12, rows[1] + 0.80, [[-0.78, 0.78]]]);
    if (spec.kind === 'car' && rows[2] !== undefined) pieces.push(['third', rows[2] + 0.10, rows[2] + 0.65, [[-0.70, 0.70]]]);
    if (spec.kind === 'car') {
      const last = has('third') && rows[2] !== undefined ? rows[2] : rows[1];
      pieces.push(['boot', -L / 2 + 0.12, last - 0.38, [[-0.60, 0.60]], spec.bootFloor + 0.012]);
    }
    for (const [part, x0, x1, zs, my] of pieces) {
      const on = chosen ? has(part) : false;
      if (!on && part === 'third') continue;                    // only drawn when it is part of the set
      for (const [z0, z1] of zs) {
        const poly = matPoly(x0, x1, z0, z1, my || y);
        faces.push(face(poly, on ? MAT_ON : MAT_OFF, on ? 0.96 : 0.28, { stroke: on ? null : 'rgba(120,120,116,0.5)', bias: 0.02 }));
        if (on) {
          const c = poly.reduce((a, p) => [a[0] + p[0] / poly.length, a[1] + p[1] / poly.length, a[2] + p[2] / poly.length], [0, 0, 0]);
          faces.push(face(poly.map(p => [c[0] + (p[0] - c[0]) * 0.84, (my || y2) + 0.001, c[2] + (p[2] - c[2]) * 0.84]),
            [255, 255, 255], 0, { fill: false, stroke: 'rgba(255,255,255,0.75)', dash: true, bias: 0.06 }));
          mats.push(part);
        }
      }
    }
    return { faces, L, W, H: Math.max(...outline.map(p => p[1]), ...(spec.cabin || []).map(p => p[1])), mats };
  }

  // ---------- rear area: the luggage area of a passenger vehicle, the load floor of a van ----------
  // An illustration of the space behind the front seats: floor, walls, wheel arches, what stands in front of it
  // (rear seat backs, a bulkhead, rows of seats) and the floor covering proposed for it. The sizes are illustrative
  // proportions (a compact van's area is short and low, a large van's long and tall), NOT the measurements of any
  // vehicle: the shop measures the real one. A luggage area is shown with seat backs and a tailgate sill; an empty
  // commercial van's load floor with a bulkhead behind the cab, a ribbed floor and a rear door frame.
  const ROW_LEN = 0.85;                                           // the length one row of seats takes in a van
  const CARGO_LEN = { vansmall: { any: 1.8 }, vanmedium: { L1: 2.5, L2: 2.9, any: 2.6 }, vanlarge: { L2: 3.1, L3: 3.7, L4: 4.1, any: 3.4 } };
  const CARGO_H = { vansmall: { any: 1.25 }, vanmedium: { H1: 1.35, H2: 1.65, H3: 1.9, any: 1.5 }, vanlarge: { H1: 1.65, H2: 1.95, H3: 2.15, any: 1.95 } };
  const CARGO_W = { vansmall: 1.25, vanmedium: 1.6, vanlarge: 1.75 };
  const LUGGAGE = {                                               // floor length (seats up), inner width, height (a sedan: under the parcel shelf)
    sedan: [0.95, 1.05, 0.50], hatch: [0.80, 1.00, 0.75], wagon: [1.05, 1.05, 0.80], suv: [1.00, 1.10, 0.85], suvbig: [1.10, 1.15, 0.90], mpv: [1.05, 1.10, 0.95],
  };
  const WALL = [190, 196, 206], FLOOR = [120, 124, 132], ARCH = [96, 100, 110], BULK = [150, 155, 165], DARK = [50, 50, 56];

  // cfg = { layout: cargo | kombi | crew, rows: '2' | '3', wheelbase: L1..L4, roof: H1..H3, seats: '5' | '7', cargo: bool }
  function rearSpec(vehicleId, cfg) {
    cfg = cfg || {};
    const spec = SPECS[vehicleId] || SPECS.sedan;
    if (spec.kind === 'car') {
      const id = LUGGAGE[vehicleId] ? vehicleId : 'sedan';
      let [len, W, H] = LUGGAGE[id];
      const seven = (id === 'suvbig' || id === 'mpv') && cfg.seats === '7';
      if (seven) len = 0.45;                                      // third row up: only a short floor behind it
      return { type: 'luggage', kind: 'luggage', Lt: len + 0.2, W, H, rows: 0, floorLen: len, parcel: id === 'sedan', seven };
    }
    const layout = ['cargo', 'kombi', 'crew'].includes(cfg.layout) ? cfg.layout : 'cargo';
    const lengths = CARGO_LEN[vehicleId], heights = CARGO_H[vehicleId];
    const rows = layout === 'kombi' ? (cfg.rows === '3' ? 2 : 1) : layout === 'crew' ? 1 : 0;    // rows of seats behind the front one
    const Lt = Math.max(lengths[cfg.wheelbase] || lengths.any, rows * ROW_LEN + 0.45);
    return { type: 'van', kind: layout, Lt, W: CARGO_W[vehicleId], H: heights[cfg.roof] || heights.any, rows, floorLen: Lt - rows * ROW_LEN, bulkhead: layout === 'cargo' };
  }

  // The faces of the rear area of one vehicle. The covering is drawn dark when it is part of what was chosen (the boot mat of a
  // passenger vehicle's set; a van's load-area floor when it is requested), otherwise only as a faint outline: a preview.
  function buildRear(vehicleId, setId, cfg) {
    cfg = cfg || {};
    const r = rearSpec(vehicleId, cfg), faces = [];
    const { Lt, W, H } = r, xf = Lt / 2, xr = -Lt / 2, van = r.type === 'van';
    const xFloor = van ? xf - r.rows * ROW_LEN : xf - 0.2;        // where the floor ends in front
    const on = van ? cfg.cargo === true : !!(SETS[setId] && SETS[setId].includes('boot'));

    faces.push(face(circle(0, 0, 1, 28).map(p => [p[0] * Lt * 0.7, -0.06, p[1] * W * 0.85]), [0, 0, 0], 0.07, { layer: 0, stroke: null }));
    box(faces, xr, xf, -0.05, 0, -W / 2, W / 2, FLOOR, 0.5);                                   // floor
    for (const z of [-W / 2, W / 2]) faces.push(face([[xr, 0, z], [xf, 0, z], [xf, H, z], [xr, H, z]], WALL, 0.10));   // walls
    faces.push(face([[xr, H, -W / 2], [xf, H, -W / 2], [xf, H, W / 2], [xr, H, W / 2]], WALL, r.parcel ? 0.45 : 0.08)); // roof (a sedan: parcel shelf)

    // wheel arches (never longer than the floor they are on: a short floor behind a third row has short arches)
    const al = Math.min(van ? 0.62 : 0.5, (xFloor - xr) * 0.55), aw = van ? W * 0.14 : 0.16, ah = van ? 0.28 : 0.2;
    const xa = clamp(xr + Lt * 0.33, xr + al / 2 + 0.03, xFloor - al / 2 - 0.03);
    box(faces, xa - al / 2, xa + al / 2, 0, ah, -W / 2, -W / 2 + aw, ARCH, 0.6);
    box(faces, xa - al / 2, xa + al / 2, 0, ah, W / 2 - aw, W / 2, ARCH, 0.6);

    // what stands in front of the floor
    if (!van) {                                                   // rear seat backs (seats up), with head restraints when there is room
      const top = Math.min(H * 0.92, 0.62);
      for (const [z0, z1] of [[-W / 2, -0.02], [0.02, W / 2]]) box(faces, xf - 0.2, xf, 0, top, z0, z1, SEAT, 0.5);
      if (H > 0.7) for (const zc of [-W / 4, W / 4]) box(faces, xf - 0.14, xf - 0.06, top, top + 0.16, zc - 0.08, zc + 0.08, SEAT, 0.5);
    } else if (r.bulkhead) {                                      // empty load floor: a bulkhead behind the cab
      faces.push(face([[xf, 0, -W / 2], [xf, H, -W / 2], [xf, H, W / 2], [xf, 0, W / 2]], BULK, 0.55));
    } else {                                                      // rows of seats take the front part of the area
      for (let i = 0; i < r.rows; i++) {
        const xc = xf - ROW_LEN * (i + 0.5);
        for (const [z0, z1] of [[-W / 2 + 0.03, -0.02], [0.02, W / 2 - 0.03]]) {
          box(faces, xc - 0.22, xc + 0.22, 0, 0.28, z0, z1, SEAT, 0.5);
          box(faces, xc - 0.30, xc - 0.18, 0.28, 0.85, z0, z1, SEAT, 0.5);
        }
      }
      for (const z of [-W / 2 - 0.004, W / 2 + 0.004]) faces.push(face([[xf - 0.1, H * 0.55, z], [xf - 0.1, H * 0.85, z], [xFloor + 0.1, H * 0.85, z], [xFloor + 0.1, H * 0.55, z]], GLASS, 0.3, { bias: 0.05 }));
    }
    if (van) for (let k = -3; k <= 3; k++)                         // ribbed commercial floor
      faces.push(face([[xr + 0.05, 0.002, k * W / 8], [xFloor - 0.05, 0.002, k * W / 8]], [0, 0, 0], 0, { fill: false, stroke: 'rgba(90,90,100,0.35)' }));

    // rear opening: door / tailgate frame and sill
    faces.push(face([[xr, 0, -W / 2], [xr, H, -W / 2], [xr, H, W / 2], [xr, 0, W / 2]], [0, 0, 0], 0, { fill: false, stroke: 'rgba(40,40,46,0.85)', bias: -0.05 }));
    box(faces, xr - 0.05, xr, -0.05, 0.03, -W / 2, W / 2, DARK, 0.7);

    // the covering proposed for the floor, with a notch round each wheel arch
    const w = W / 2 - 0.04, xm0 = xr + 0.03, xm1 = xFloor - 0.02, a0 = xa - al / 2, a1 = xa + al / 2, y = 0.006;
    const poly = [[xm0, y, -w], [a0, y, -w], [a0, y, -(w - aw)], [a1, y, -(w - aw)], [a1, y, -w], [xm1, y, -w],
      [xm1, y, w], [a1, y, w], [a1, y, w - aw], [a0, y, w - aw], [a0, y, w], [xm0, y, w]];
    faces.push(face(poly, on ? MAT_ON : MAT_OFF, on ? 0.96 : 0.28, { stroke: on ? null : 'rgba(120,120,116,0.6)', dash: !on, bias: 0.02 }));
    if (on) {
      const c = [(xm0 + xm1) / 2, 0];
      faces.push(face(poly.map(p => [c[0] + (p[0] - c[0]) * 0.9, y + 0.001, p[2] * 0.88]), [255, 255, 255], 0, { fill: false, stroke: 'rgba(255,255,255,0.75)', dash: true, bias: 0.06 }));
    }
    return {
      faces, L: Lt, W, H, ref: Math.max(Lt * 0.95, W * 2.0, H * 2.1), yc: H * 0.3,
      labels: [{ p: [xr - 0.02, H * 0.6, 0], key: 'rear' }, { p: [xf - 0.02, H * 0.45, 0], key: van && r.bulkhead ? 'bulkhead' : 'seats' }, { p: [(xm0 + xm1) / 2, 0.01, 0], key: 'coverage' }],
      mats: on ? ['floor'] : [], coverage: on ? 'selected' : 'preview', rear: r,
    };
  }

  // ---------- view ----------
  // world point → [x, y, depth] for a camera that turns by yaw around the vehicle and looks down by pitch
  function project(p, yaw, pitch, cy0) {
    const sy = Math.sin(yaw), cy = Math.cos(yaw);
    const x1 = p[0] * cy + p[2] * sy, z1 = -p[0] * sy + p[2] * cy, y0 = p[1] - cy0;
    const sp = Math.sin(pitch), cp = Math.cos(pitch);
    return [x1, y0 * cp + z1 * sp, z1 * cp - y0 * sp];
  }
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const PITCH_3D = 0.42, PITCH_TOP = 1.5;
  // camera presets: yaw null = the vehicle keeps turning by itself
  const VIEWS = {
    vehicle: { '3d': { pitch: PITCH_3D, yaw: null, auto: true, zoom: 1 }, top: { pitch: PITCH_TOP, yaw: 0, auto: false, zoom: 1 } },
    rear: {
      '3d': { pitch: 0.5, yaw: -2.1, auto: false, zoom: 1 },
      rear: { pitch: 0.3, yaw: -Math.PI / 2, auto: false, zoom: 1.2 },     // looking in from behind
      top: { pitch: PITCH_TOP, yaw: 0, auto: false, zoom: 1 },
    },
  };

  function draw(ctx, w, h, model, yaw, pitch, alpha, zoom, text) {
    ctx.clearRect(0, 0, w, h);
    const ref = model.ref || (model.L + 5.4) / 2;                  // a common scale, so a van looks bigger than a hatchback
    const D = ref * 2.4, f = 0.8 * w * D / ref * (zoom || 1), cyc = model.yc === undefined ? model.H * 0.42 : model.yc;
    const at = p => { const q = project(p, yaw, pitch, cyc); return { q, s: [w / 2 + f * q[0] / (D + q[2]), h * 0.52 - f * q[1] / (D + q[2])] }; };
    const rows = [];
    for (const fc of model.faces) {
      const q = fc.pts.map(p => project(p, yaw, pitch, cyc));
      if (q.some(v => D + v[2] < 0.5)) continue;
      const depth = q.reduce((a, v) => a + v[2], 0) / q.length - fc.bias;
      rows.push({ fc, depth, pts: q.map(v => [w / 2 + f * v[0] / (D + v[2]), h * 0.52 - f * v[1] / (D + v[2])]) });
    }
    rows.sort((a, b) => a.fc.layer - b.fc.layer || b.depth - a.depth);        // ground first, then far to near
    for (const { fc, pts } of rows) {
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
      ctx.closePath();
      if (fc.fill) {
        const k = fc.shade;
        ctx.fillStyle = `rgba(${Math.round(fc.rgb[0] * k)},${Math.round(fc.rgb[1] * k)},${Math.round(fc.rgb[2] * k)},${(fc.a * alpha).toFixed(3)})`;
        ctx.fill();
      }
      if (fc.stroke) {
        ctx.strokeStyle = fc.stroke; ctx.lineWidth = 1;
        ctx.setLineDash(fc.dash ? [4, 3] : []);
        ctx.globalAlpha = alpha;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
    ctx.setLineDash([]);
    if (model.labels && text) {                                    // short labels (rear / seats / coverage), drawn on top with a light halo
      ctx.font = '600 11px Inter, Arial, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
      for (const lb of model.labels) {
        const s = text['lbl_' + lb.key];
        if (!s) continue;
        const { s: [x, y] } = at(lb.p);
        ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.strokeText(s, x, y);
        ctx.fillStyle = 'rgba(28,28,30,0.9)'; ctx.fillText(s, x, y);
      }
    }
  }

  // ---------- on the page ----------
  // mount(host, { text }) → { set({ vehicle, set, label, config }), setMode('vehicle' | 'rear'), destroy() }
  // config = { layout, rows, wheelbase, roof, seats, cargo } — see rearSpec. text: the page's words (view3d, viewRear, viewTop, hint, note,
  // modeVehicle, modeLuggage, modeLoad, cap_luggage / cap_cargo / cap_kombi / cap_crew, capSelected, capPreviewCar, capPreviewVan, lbl_rear / lbl_seats / lbl_bulkhead / lbl_coverage)
  function mount(host, options) {
    const text = Object.assign({ view3d: '3D', viewRear: 'Rear view', viewTop: 'Top view', hint: '', note: '', modeVehicle: 'Vehicle', modeLuggage: 'Luggage area', modeLoad: 'Load area' }, options && options.text);
    const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt) e.textContent = txt; return e; };
    const btn = (label, onClick) => { const b = el('button', '', label); b.type = 'button'; b.addEventListener('click', onClick); return b; };
    const wrap = el('div', 'v3d');
    const modes = el('div', 'v3d-modes');
    modes.setAttribute('role', 'group');
    const canvas = el('canvas', 'v3d-canvas');
    canvas.tabIndex = 0;
    canvas.setAttribute('role', 'img');
    const bar = el('div', 'v3d-bar');
    const cap = el('p', 'v3d-cap');
    cap.setAttribute('aria-live', 'polite');
    const bMode = { vehicle: btn(text.modeVehicle, () => setMode('vehicle')), rear: btn(text.modeLoad, () => setMode('rear')) };
    const bCam = { '3d': btn(text.view3d, () => cam('3d')), rear: btn(text.viewRear, () => cam('rear')), top: btn(text.viewTop, () => cam('top')) };
    modes.append(bMode.vehicle, bMode.rear);
    bar.append(bCam['3d'], bCam.rear, bCam.top, el('span', 'v3d-hint', text.hint));
    wrap.append(modes, canvas, bar, cap, el('p', 'v3d-note', text.note));
    host.replaceChildren(wrap);

    const ctx = canvas.getContext('2d');
    const reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    let state = { vehicle: undefined, set: undefined, label: '', config: {} };
    let mode = 'vehicle', camName = '3d', model = build('sedan');
    let yaw = -0.6, pitch = PITCH_3D, zoom = 1, targetPitch = PITCH_3D, targetYaw = null, targetZoom = 1;
    let auto = !reduce, pauseUntil = 0, alpha = 1, last = 0, raf = 0, visible = true, dead = false, dragging = false, lx = 0, ly = 0;
    let w = 0, h = 0;

    function size() {
      const r = canvas.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      w = Math.max(1, Math.round(r.width)); h = Math.max(1, Math.round(r.height));
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    function wake() { if (!raf && !dead && visible) raf = requestAnimationFrame(tick); }
    function tick(ts) {
      raf = 0;
      if (dead) return;
      if (!canvas.isConnected) return destroy();                // the page was replaced
      const dt = Math.min(0.05, last ? (ts - last) / 1000 : 0.016);
      last = ts;
      let moving = false;
      if (targetYaw !== null) {
        const d = Math.atan2(Math.sin(targetYaw - yaw), Math.cos(targetYaw - yaw));
        if (Math.abs(d) < 0.01) { yaw = targetYaw; targetYaw = null; } else { yaw += d * Math.min(1, dt * 6); moving = true; }
      } else if (auto && ts > pauseUntil) { yaw += dt * 0.35; moving = true; }
      if (Math.abs(targetPitch - pitch) > 0.002) { pitch += (targetPitch - pitch) * Math.min(1, dt * 6); moving = true; } else pitch = targetPitch;
      if (Math.abs(targetZoom - zoom) > 0.002) { zoom += (targetZoom - zoom) * Math.min(1, dt * 6); moving = true; } else zoom = targetZoom;
      if (alpha < 1) { alpha = Math.min(1, alpha + dt * 5); moving = true; }
      if (!w) size();
      draw(ctx, w, h, model, yaw, pitch, alpha, zoom, text);
      if (moving) wake();
    }
    function touched() { pauseUntil = performance.now() + 4000; targetYaw = null; }

    // what the picture says, in words (for screen readers and for everyone): the view, the vehicle and what is shown
    function describe() {
      let s = '';
      if (mode === 'rear') {
        s = text['cap_' + model.rear.kind] || '';
        s += ' ' + (model.coverage === 'selected' ? text.capSelected : model.rear.type === 'van' ? text.capPreviewVan : text.capPreviewCar);
      }
      cap.textContent = s.trim();
      canvas.setAttribute('aria-label', [state.label, s.trim()].filter(Boolean).join(' — '));
    }
    function refreshButtons() {
      const van = SPECS[state.vehicle] && SPECS[state.vehicle].kind === 'van';
      bMode.rear.textContent = van ? text.modeLoad : text.modeLuggage;
      modes.setAttribute('aria-label', text.modes || '');
      for (const [k, b] of Object.entries(bMode)) { b.classList.toggle('on', k === mode); b.setAttribute('aria-pressed', String(k === mode)); }
      bCam.rear.hidden = mode !== 'rear';
      for (const [k, b] of Object.entries(bCam)) { b.classList.toggle('on', k === camName); b.setAttribute('aria-pressed', String(k === camName)); }
    }
    function rebuild() {
      model = mode === 'rear' ? buildRear(state.vehicle, state.set, state.config) : build(state.vehicle, state.set);
      describe(); refreshButtons();
    }
    function cam(name) {
      const v = VIEWS[mode][name] || VIEWS[mode]['3d'];
      camName = VIEWS[mode][name] ? name : '3d';
      targetPitch = v.pitch; targetZoom = v.zoom; auto = v.auto && !reduce; pauseUntil = 0;
      targetYaw = v.yaw;
      refreshButtons(); wake();
    }
    function setMode(m) {
      if (m === mode) return;
      mode = m; alpha = reduce ? 1 : 0;
      rebuild(); cam('3d');
    }

    canvas.addEventListener('pointerdown', e => { dragging = true; lx = e.clientX; ly = e.clientY; canvas.setPointerCapture(e.pointerId); touched(); });
    canvas.addEventListener('pointermove', e => {
      if (!dragging) return;
      yaw -= (e.clientX - lx) * 0.009;
      targetPitch = pitch = clamp(pitch + (e.clientY - ly) * 0.006, 0.08, PITCH_TOP);
      lx = e.clientX; ly = e.clientY;
      touched(); wake();
    });
    const up = () => { dragging = false; };
    canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('keydown', e => {
      const k = { ArrowLeft: [0.2, 0], ArrowRight: [-0.2, 0], ArrowUp: [0, -0.1], ArrowDown: [0, 0.1] }[e.key];
      if (!k) return;
      e.preventDefault();
      yaw += k[0]; targetPitch = clamp(targetPitch + k[1], 0.08, PITCH_TOP);
      touched(); wake();
    });

    const ro = window.ResizeObserver ? new ResizeObserver(() => { size(); wake(); }) : null;
    if (ro) ro.observe(canvas);
    const io = window.IntersectionObserver ? new IntersectionObserver(entries => { visible = entries[entries.length - 1].isIntersecting; if (visible) wake(); }) : null;
    if (io) io.observe(canvas);
    function destroy() { dead = true; if (raf) cancelAnimationFrame(raf); if (ro) ro.disconnect(); if (io) io.disconnect(); }

    refreshButtons();
    wake();
    return {
      set({ vehicle, set, label, config }) {
        state = { vehicle, set, label: label || '', config: config || {} };
        rebuild();
        alpha = reduce ? 1 : 0;
        wake();
      },
      setMode,
      destroy,
    };
  }

  const api = { SPECS, SETS, VEHICLE_IDS, build, rearSpec, buildRear, project, mount };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else window.Vehicle3D = api;
})();
