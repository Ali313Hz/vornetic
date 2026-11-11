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

  function draw(ctx, w, h, model, yaw, pitch, alpha) {
    ctx.clearRect(0, 0, w, h);
    const ref = (model.L + 5.4) / 2;                            // a common scale, so a van looks bigger than a hatchback
    const D = ref * 2.4, f = 0.8 * w * D / ref, cyc = model.H * 0.42;
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
  }

  // ---------- on the page ----------
  // mount(host, { text: { view3d, viewTop, hint, note } }) → { set({ vehicle, set, label }), destroy() }
  function mount(host, options) {
    const text = Object.assign({ view3d: '3D', viewTop: 'Top', hint: '', note: '' }, options && options.text);
    const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt) e.textContent = txt; return e; };
    const wrap = el('div', 'v3d');
    const canvas = el('canvas', 'v3d-canvas');
    canvas.tabIndex = 0;
    canvas.setAttribute('role', 'img');
    const bar = el('div', 'v3d-bar');
    const b3d = el('button', 'on', text.view3d), btop = el('button', '', text.viewTop);
    for (const b of [b3d, btop]) b.type = 'button';
    bar.append(b3d, btop, el('span', 'v3d-hint', text.hint));
    wrap.append(canvas, bar, el('p', 'v3d-note', text.note));
    host.replaceChildren(wrap);

    const ctx = canvas.getContext('2d');
    const reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    let model = build('sedan'), yaw = -0.6, pitch = PITCH_3D, targetPitch = PITCH_3D, targetYaw = null;
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
      if (alpha < 1) { alpha = Math.min(1, alpha + dt * 5); moving = true; }
      if (!w) size();
      draw(ctx, w, h, model, yaw, pitch, alpha);
      if (moving) wake();
    }
    function touched() { pauseUntil = performance.now() + 4000; targetYaw = null; }
    function view(top) {
      targetPitch = top ? PITCH_TOP : PITCH_3D;
      if (top) { auto = false; targetYaw = 0; } else { auto = !reduce; pauseUntil = 0; }
      b3d.classList.toggle('on', !top); btop.classList.toggle('on', top);
      b3d.setAttribute('aria-pressed', String(!top)); btop.setAttribute('aria-pressed', String(top));
      wake();
    }
    b3d.setAttribute('aria-pressed', 'true'); btop.setAttribute('aria-pressed', 'false');
    b3d.addEventListener('click', () => view(false));
    btop.addEventListener('click', () => view(true));

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

    wake();
    return {
      set({ vehicle, set, label }) {
        model = build(vehicle, set);
        if (label) canvas.setAttribute('aria-label', label);
        alpha = reduce ? 1 : 0;
        wake();
      },
      destroy,
    };
  }

  const api = { SPECS, SETS, VEHICLE_IDS, build, project, mount };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else window.Vehicle3D = api;
})();
