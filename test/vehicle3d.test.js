// test/vehicle3d.test.js — the 3D picture of the chosen type of vehicle (public/js/vehicle3d.js): its shapes, the mats of each
// set, and the rear area (a luggage area is not a van's load floor). The picture is an illustration, not a scan.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const EVO = require('../evo-prices');
const Vehicle3D = require('../public/js/vehicle3d.js');

test('3D picture: every type of vehicle of the price list has a shape, and every set draws its mats', () => {
  assert.deepStrictEqual([...Vehicle3D.VEHICLE_IDS].sort(), EVO.VEHICLES.map(v => v.id).sort(), 'the shapes are the vehicle types of the list');
  assert.deepStrictEqual(Object.keys(Vehicle3D.SETS).sort(), EVO.SETS.map(s => s.id).sort(), 'every set of the list');
  const count = { front: 2, rear: 2, second: 1, third: 1, boot: 1 };
  for (const v of EVO.VEHICLES) for (const s of EVO.SETS) {
    if (!EVO.PRICES[v.cls][s.id]) continue;                         // a set the vehicle does not have is never shown
    const m = Vehicle3D.build(v.id, s.id);
    assert.ok(m.faces.length > 100, `${v.id}|${s.id} has a body`);
    assert.ok(m.faces.every(f => f.pts.every(p => p.every(Number.isFinite)) && Number.isFinite(f.shade)), `${v.id}|${s.id}: finite numbers`);
    assert.deepStrictEqual([...m.mats].sort(), Vehicle3D.SETS[s.id].flatMap(part => Array(count[part]).fill(part)).sort(), `${v.id}|${s.id}: the mats of the set`);
  }
  // nothing chosen yet: the mats are only shown faintly, none as chosen; an unknown type falls back to a sedan
  assert.deepStrictEqual(Vehicle3D.build('suv').mats, []);
  assert.strictEqual(Vehicle3D.build('nonsense', 'set4').faces.length, Vehicle3D.build('sedan', 'set4').faces.length);
});

test('3D picture: vans are taller and longer than cars, and a large van is the largest; the view turns and looks down', () => {
  const S = Vehicle3D.SPECS, top = id => Math.max(...(S[id].cabin || S[id].shell).map(p => p[1]));
  assert.ok(S.vanmedium.L > S.suv.L && S.vanlarge.L > S.vanmedium.L && S.vanlarge.L > S.suvbig.L, 'lengths');
  assert.ok(top('vanlarge') > top('vanmedium') && top('vanmedium') > top('vansmall') && top('vansmall') > top('suv') && top('suv') > top('sedan'), 'heights');
  assert.ok(S.hatch.L < S.sedan.L, 'a compact car is shorter than a sedan');
  const close = (a, b) => Math.abs(a - b) < 1e-9;
  const front = Vehicle3D.project([2, 0.5, 0], 0, 0, 0.5);                   // seen from the side: the front of the car is on the right
  assert.ok(close(front[0], 2) && close(front[1], 0) && close(front[2], 0));
  const turned = Vehicle3D.project([2, 0.5, 0], Math.PI / 2, 0, 0.5);        // turned a quarter: the front points away from or at the viewer
  assert.ok(close(turned[0], 0) && Math.abs(Math.abs(turned[2]) - 2) < 1e-9);
  const down = Vehicle3D.project([0, 1, 0], 0, Math.PI / 2, 0);              // from straight above: height becomes depth, nearer the camera
  assert.ok(close(down[1], 0) && close(down[2], -1));
});

test('3D picture: the page loads it, and it needs nothing from outside', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  assert.ok(html.indexOf('/js/vehicle3d.js') > 0 && html.indexOf('/js/vehicle3d.js') < html.indexOf('/js/app.js'), 'loaded before app.js');
  const code = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'vehicle3d.js'), 'utf8');
  assert.doesNotMatch(code, /https?:\/\/|\bimport\b|\brequire\(|\bfetch\(|XMLHttpRequest|eval\(|new Function|innerHTML/, 'no outside requests, no dynamic code, no HTML injection');
  assert.match(code, /prefers-reduced-motion/, 'it respects reduced motion');
});

// ---------- the rear area: a luggage area is not a van's load floor ----------
test('rear area: a compact van, a medium van and a large van have visibly different proportions and load-floor lengths', () => {
  const rear = (v, cfg) => Vehicle3D.rearSpec(v, cfg);
  const compact = rear('vansmall', { layout: 'cargo' }), medium = rear('vanmedium', { layout: 'cargo', wheelbase: 'L2', roof: 'H2' }), large = rear('vanlarge', { layout: 'cargo', wheelbase: 'L3', roof: 'H3' });
  assert.ok(compact.floorLen < medium.floorLen && medium.floorLen < large.floorLen, 'load floors get longer');
  assert.ok(compact.H < medium.H && medium.H < large.H && compact.W < medium.W && medium.W < large.W, 'and taller and wider');
  assert.ok(large.floorLen >= 1.8 * compact.floorLen, 'a large van\'s floor is much longer than a compact van\'s');
  // the length and the roof follow what the customer chose, not only the size class
  const len = w => rear('vanlarge', { layout: 'cargo', wheelbase: w, roof: 'H2' }).floorLen;
  assert.ok(len('L2') < len('L3') && len('L3') < len('L4'), 'L2 < L3 < L4');
  const high = r => rear('vanmedium', { layout: 'cargo', wheelbase: 'L2', roof: r }).H;
  assert.ok(high('H1') < high('H2') && high('H2') < high('H3'), 'H1 < H2 < H3');
  // a passenger vehicle's luggage area is small, low and has no bulkhead
  for (const v of ['sedan', 'hatch', 'wagon', 'suv', 'suvbig', 'mpv']) {
    const r = rear(v, {});
    assert.deepStrictEqual([r.type, r.kind, r.bulkhead], ['luggage', 'luggage', undefined], v);
    assert.ok(r.floorLen < compact.floorLen && r.H < compact.H, `${v}: smaller than a compact van's load area`);
  }
  assert.ok(rear('sedan', {}).H < rear('suv', {}).H, 'a sedan\'s boot is under the parcel shelf');
});

test('rear area: seats, rows and a third row take length from the floor; an empty commercial van has a bulkhead instead', () => {
  const rear = (v, cfg) => Vehicle3D.rearSpec(v, cfg);
  assert.ok(rear('suvbig', { seats: '7' }).floorLen < 0.5 * rear('suvbig', { seats: '5' }).floorLen, 'seven seats: only a short floor behind the third row');
  assert.ok(rear('mpv', { seats: '7' }).floorLen < rear('mpv', { seats: '5' }).floorLen);
  assert.strictEqual(rear('sedan', { seats: '7' }).floorLen, rear('sedan', {}).floorLen, 'seats only matter for large SUVs and MPVs');
  const van = (layout, rows) => rear('vanmedium', { layout, rows, wheelbase: 'L2', roof: 'H2' });
  assert.ok(van('crew').floorLen < van('cargo').floorLen && van('kombi', '2').floorLen < van('cargo').floorLen, 'rows of seats shorten the floor');
  assert.ok(van('kombi', '3').floorLen < van('kombi', '2').floorLen, 'a third row shortens it more');
  assert.deepStrictEqual([van('cargo').bulkhead, van('kombi', '2').bulkhead, van('crew').bulkhead], [true, false, false]);
  assert.ok(van('kombi', '3').floorLen >= 0.45, 'there is always some floor');
  // an unknown layout is treated as an empty van, an unknown length / roof as an average one
  assert.strictEqual(rear('vanlarge', { layout: 'weird' }).kind, 'cargo');
  assert.ok(rear('vanlarge', { layout: 'cargo', wheelbase: 'unknown', roof: 'unknown' }).floorLen > rear('vanlarge', { layout: 'cargo', wheelbase: 'L2' }).floorLen - 1);
});

test('rear area: the covering is dark only when it was chosen; a load-area floor is a preview until a quote is asked for', () => {
  const m = (v, set, cfg) => Vehicle3D.buildRear(v, set, cfg);
  // a passenger vehicle: the boot mat is in the sets that have one
  assert.deepStrictEqual([m('sedan', 'pack').coverage, m('sedan', 'pack').mats], ['selected', ['floor']]);
  assert.deepStrictEqual([m('suv', 'boot').coverage, m('mpv', 'packr3', { seats: '7' }).coverage], ['selected', 'selected']);
  assert.deepStrictEqual([m('sedan', 'set4').coverage, m('sedan', 'set4').mats], ['preview', []], 'no boot mat in the set: only a faint outline');
  assert.strictEqual(m('sedan').coverage, 'preview');
  // a van: only when the load-area floor is asked for; a cabin set alone never turns it on
  for (const set of ['cab', 'cab2', undefined]) assert.strictEqual(m('vanlarge', set, { layout: 'cargo', wheelbase: 'L3', roof: 'H3' }).coverage, 'preview', String(set));
  assert.strictEqual(m('vanlarge', 'cab', { layout: 'cargo', wheelbase: 'L3', roof: 'H3', cargo: true }).coverage, 'selected');
  assert.strictEqual(m('vanlarge', 'cab', { layout: 'cargo', cargo: 'yes' }).coverage, 'preview', 'only an explicit true');
  // the covering stays on the floor: every point of it is at floor level, inside the walls, behind the seats / bulkhead
  for (const [v, cfg] of [['sedan', {}], ['suvbig', { seats: '7' }], ['vansmall', { layout: 'cargo' }], ['vanmedium', { layout: 'kombi', rows: '3', wheelbase: 'L2', roof: 'H2' }], ['vanlarge', { layout: 'crew', wheelbase: 'L4', roof: 'H3' }]]) {
    const model = m(v, 'pack', { ...cfg, cargo: true }), spec = Vehicle3D.rearSpec(v, cfg);
    const cover = model.faces.find(f => f.pts.length === 12);
    assert.ok(cover, `${v}: the covering has its wheel-arch notches`);
    assert.ok(cover.pts.every(p => p[1] < 0.01 && Math.abs(p[2]) <= spec.W / 2 && p[0] >= -spec.Lt / 2 && p[0] <= spec.Lt / 2 - (spec.type === 'van' ? spec.rows * 0.85 : 0.2)), `${v}: on the floor, inside the area`);
    const widths = [...new Set(cover.pts.map(p => Math.abs(p[2]).toFixed(3)))];
    assert.strictEqual(widths.length, 2, `${v}: narrower at the wheel arches`);
  }
});

test('rear area: every vehicle and configuration builds a valid picture, with labels, and a van cannot be bought through it', () => {
  const cfgs = [{}, { layout: 'cargo' }, { layout: 'kombi', rows: '2' }, { layout: 'kombi', rows: '3' }, { layout: 'crew' }, { seats: '7' }, { cargo: true, layout: 'cargo' }];
  for (const v of Vehicle3D.VEHICLE_IDS) for (const cfg of cfgs) for (const wheelbase of [undefined, 'L1', 'L4', 'unknown']) {
    const m = Vehicle3D.buildRear(v, 'set4', { ...cfg, wheelbase, roof: 'H3' });
    assert.ok(m.faces.length > 25, `${v} has faces`);
    assert.ok(m.faces.every(f => f.pts.every(p => p.every(Number.isFinite)) && Number.isFinite(f.shade)), `${v}: finite numbers`);
    assert.ok(Number.isFinite(m.ref) && m.ref > 0 && Number.isFinite(m.yc), `${v}: a camera scale`);
    assert.deepStrictEqual(m.labels.map(l => l.key), ['rear', m.rear.type === 'van' && m.rear.bulkhead ? 'bulkhead' : 'seats', 'coverage']);
  }
  // showing a load-area floor adds nothing to the product's options or prices: there is no cargo-floor choice to buy
  const EVO = require('../evo-prices');
  assert.ok(!EVO.SETS.some(s => /cargo|load|carga/i.test(s.id + s.en + s.es)), 'no set is a load-area floor');
  assert.ok(!Object.keys(EVO.product.combos).some(k => /cargo/.test(k)));
  assert.ok(!Object.keys(Vehicle3D.SETS).some(k => /cargo/.test(k)));
});

test('the 3D picture has a rear / top view for the rear area, a text for what it shows, and says it is an illustration', () => {
  const code = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'vehicle3d.js'), 'utf8');
  assert.match(code, /rear: \{ pitch: 0\.3, yaw: -Math\.PI \/ 2/, 'a view from behind, looking in');
  assert.match(code, /top: \{ pitch: PITCH_TOP/, 'a view from above');
  assert.match(code, /aria-live/, 'the caption is announced');
  assert.match(code, /setAttribute\('aria-label'/, 'the picture has a text alternative');
  assert.match(code, /aria-pressed/, 'the view buttons say which one is on');
  const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app.js'), 'utf8').replace(/\r\n/g, '\n');
  const T = new Function(app.match(/^const T = \{[\s\S]*?^\};$/m)[0] + '\nreturn T;')();
  for (const l of ['en', 'es']) {
    assert.match(T[l].v3d_note, l === 'en' ? /not a scan/i : /No es un escaneo/i, `${l}: the picture is an illustration, not a scan`);
    assert.match(T[l].v3d_cap_preview_van, l === 'en' ? /cannot be ordered online/ : /no se pide online/, `${l}: a load floor cannot be ordered online`);
  }
});
