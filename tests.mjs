// tests.mjs — non-regression tests for the smith-core engine.
// Run with:  node tests.mjs        (Node >= 18, no dependency)
//
// The engine is NOT duplicated here: the <script id="smith-core"> block is read
// out of index.html and evaluated in a bare VM context (no page objects, no
// console). What is tested is exactly what ships.
//
// Independent paths. The engine propagates a homogeneous (V, I) pair. The
// reference implementations below deliberately work differently: plain complex
// impedances reduced in series/parallel, the closed-form tanh line equation,
// and explicit ABCD matrices cascaded from the input towards the load.
//
// Tolerances. Course and Smith V3.10 values: relative error 1e-3, measured on
// the complex modulus |actual - expected| / |expected|. Engine vs independent
// reference: 1e-9. Values that a screenshot shows rounded to n decimals and
// that are too coarse for 1e-3 are checked to half a unit of the last digit.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, 'index.html'), 'utf8');
const grab = (id) => {
  const found = new RegExp(`<script id="${id}">([\\s\\S]*?)<\\/script>`).exec(html);
  if (!found) {
    console.error(`Block <script id="${id}"> not found in index.html`);
    process.exit(2);
  }
  return found[1];
};
const coreSource = grab('smith-core');
const chartSource = grab('smith-chart');     // pure geometry, depends on smith-core only
const { SmithCore: Core, SmithChart: Chart } = vm.runInNewContext(
  `${coreSource}\n${chartSource}\n;({ SmithCore, SmithChart });`, {}, { filename: 'index.html' },
);
const { cx: K, rf, eng, net } = Core;

/* ------------------------------------------------------------------ harness */

let passed = 0;
const failures = [];
const group = (title) => console.log(`\n${title}`);
const test = (name, fn) => {
  try {
    fn();
    passed += 1;
    console.log(`  ok    ${name}`);
  } catch (err) {
    failures.push(name);
    console.log(`  FAIL  ${name}\n        ${err.message}`);
  }
};

const TOL = 1e-3;      // course / screenshot values
const EXACT = 1e-9;    // engine vs independent reference

const isC = (x) => x !== null && typeof x === 'object' && 're' in x;
const show = (x) => (isC(x) ? `${x.re} ${x.im < 0 ? '-' : '+'} j${Math.abs(x.im)}` : String(x));
const relErr = (a, e) => {
  const d = isC(e) ? Math.hypot(a.re - e.re, a.im - e.im) : Math.abs(a - e);
  const m = isC(e) ? Math.hypot(e.re, e.im) : Math.abs(e);
  return m > 0 ? d / m : d;
};
const close = (actual, expected, tol = TOL, label = '') => {
  const err = relErr(actual, expected);
  if (!(err <= tol)) {
    throw new Error(`${label} expected ${show(expected)}, got ${show(actual)} (relative error ${err.toExponential(2)} > ${tol})`);
  }
};
/** Value shown rounded to `decimals` on a screenshot: half a unit of the last digit. */
const shown = (actual, displayed, decimals, label = '') => {
  const tol = 0.5 * 10 ** -decimals * (1 + 1e-9);
  if (!(Math.abs(actual - displayed) <= tol)) {
    throw new Error(`${label} displayed ${displayed}, got ${actual} (outside ±${tol})`);
  }
};
const ok = (cond, msg) => { if (!cond) throw new Error(msg); };
const same = (actual, expected, label = '') => {
  if (!Object.is(actual, expected) && actual !== expected) throw new Error(`${label} expected ${expected}, got ${actual}`);
};
/** No NaN anywhere in a read-out (null means "undefined on purpose"). */
const noNaN = (obj, path = 'metrics') => {
  if (typeof obj === 'number') ok(!Number.isNaN(obj), `NaN in ${path}`);
  else if (obj && typeof obj === 'object') for (const k of Object.keys(obj)) noNaN(obj[k], `${path}.${k}`);
};

/* ------------------------------------------------ independent reference math */

const c = (re, im = 0) => ({ re, im });
const cadd = (a, b) => c(a.re + b.re, a.im + b.im);
const csub = (a, b) => c(a.re - b.re, a.im - b.im);
const cmul = (a, b) => c(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
const cdiv = (a, b) => {
  const d = b.re * b.re + b.im * b.im;
  return c((a.re * b.re + a.im * b.im) / d, (a.im * b.re - a.re * b.im) / d);
};
const cinv = (a) => cdiv(c(1), a);
const cscale = (a, k) => c(a.re * k, a.im * k);
const w = (f) => 2 * Math.PI * f;
const zInd = (f, l, esr = 0) => c(esr, w(f) * l);
const zCap = (f, cap, esr = 0) => c(esr, -1 / (w(f) * cap));
const serZ = (z, ze) => cadd(z, ze);
const parZ = (z, ze) => cinv(cadd(cinv(z), cinv(ze)));

// ABCD matrices [A, B, C, D]
const mMul = (m, n) => [
  cadd(cmul(m[0], n[0]), cmul(m[1], n[2])), cadd(cmul(m[0], n[1]), cmul(m[1], n[3])),
  cadd(cmul(m[2], n[0]), cmul(m[3], n[2])), cadd(cmul(m[2], n[1]), cmul(m[3], n[3])),
];
const mSeries = (z) => [c(1), z, c(0), c(1)];
const mShunt = (z) => [c(1), c(0), cinv(z), c(1)];
const mZin = (m, zl) => cdiv(cadd(cmul(m[0], zl), m[1]), cadd(cmul(m[2], zl), m[3]));
/** Line matrix from cosh/sinh of gamma·l = a + jb (radians, nepers). */
const mLine = (zc, a, b) => {
  const ch = c(Math.cosh(a) * Math.cos(b), Math.sinh(a) * Math.sin(b));
  const sh = c(Math.sinh(a) * Math.cos(b), Math.cosh(a) * Math.sin(b));
  return [ch, cscale(sh, zc), cscale(sh, 1 / zc), ch];
};
/** tanh(a + jb) through exponentials. */
const ctanh = (a, b) => {
  const e = c(Math.exp(-2 * a) * Math.cos(2 * b), -Math.exp(-2 * a) * Math.sin(2 * b));
  return cdiv(csub(c(1), e), cadd(c(1), e));
};
/** Closed-form input impedance of a line. */
const lineZin = (zl, zc, a, b) => {
  const t = ctanh(a, b);
  return cscale(cdiv(cadd(zl, cscale(t, zc)), cadd(c(zc), cmul(zl, t))), zc);
};
const NEPER = Math.LN10 / 20;
const LIGHT = 299792458;

/* ------------------------------------------------------------------ builders */

const project = (z0, f0, load, elements = []) => ({
  z0, f0, elements,
  load: 'kind' in load ? load : { kind: 'z', z: load },
});
const R = (conn, value) => ({ kind: 'R', conn, value });
const L = (conn, value, loss) => ({ kind: 'L', conn, value, ...(loss ? { loss } : {}) });
const C = (conn, value, loss) => ({ kind: 'C', conn, value, ...(loss ? { loss } : {}) });
const TL = (zc, deg, fref, extra = {}) => ({ kind: 'TL', zc, deg, fref, ...extra });
const STUB = (term, zc, deg, fref, extra = {}) => ({ kind: 'STUB', term, zc, deg, fref, ...extra });
const zin = (p, f = p.f0) => net.inputAt(p, f).z;

// Small deterministic generator, so a failure can be reproduced.
const prng = (seed) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const between = (rnd, lo, hi) => lo + (hi - lo) * rnd();
const logBetween = (rnd, lo, hi) => lo * (hi / lo) ** rnd();

/* ========================================================================== */
group('0. Engine extraction');

test('smith-core and smith-chart run in a bare context (no page, no console)', () => {
  ok(Core && typeof Core.VERSION === 'string', 'SmithCore not exposed');
  ok(Chart && typeof Chart.grid === 'function', 'SmithChart not exposed');
});
test('neither the engine nor the geometry references a page object', () => {
  for (const [name, source] of [['smith-core', coreSource], ['smith-chart', chartSource]]) {
    const hit = /\b(document|window|navigator|localStorage|console|fetch|alert)\b/.exec(source);
    ok(!hit, `forbidden identifier in ${name}: ${hit && hit[0]}`);
  }
});

/* ========================================================================== */
group('1. Complex numbers');

test('division, inverse, root', () => {
  close(K.div(c(1, 2), c(3, -4)), c(-0.2, 0.4), EXACT);
  close(K.inv(c(0, 2)), c(0, -0.5), EXACT);
  close(K.sqrt(c(-4, 0)), c(0, 2), EXACT);
  close(K.sqrt(c(3, 4)), c(2, 1), EXACT);
  close(K.sqrt(c(3, -4)), c(2, -1), EXACT);
});
test('sin/cos exact at multiples of 90°', () => {
  same(K.sind(180), 0); same(K.sind(360), 0); same(K.cosd(90), 0); same(K.cosd(270), 0);
  same(K.sind(90), 1); same(K.sind(-90), -1); same(K.cosd(180), -1); same(K.cosd(0), 1);
  close(K.sind(30), 0.5, EXACT);
});

/* ========================================================================== */
group('2. Course vectors (slides 6 to 17)');

test('V1  z = 0.6 + j0.8 ↔ Z = 30 + j40 Ω; z = 1 ↔ centre', () => {
  const m = net.solve(project(50, 1e9, c(30, 40)))[0];
  close(m.zn, c(0.6, 0.8));
  close(rf.gammaToZ(rf.zToGamma(c(0.6, 0.8), 1), 50), c(30, 40));
  close(m.gamma, c(0, 0.5), EXACT, 'Γ');
  const centre = rf.zToGamma(c(50, 0), 50);
  same(centre.re, 0); same(centre.im, 0);
});
test('V1  configurable Z0: 75 Ω at the centre of a 75 Ω chart', () => {
  const g = rf.zToGamma(c(75, 0), 75);
  same(g.re, 0); same(g.im, 0);
  close(rf.zToGamma(c(50, 0), 75), c(-0.2, 0), EXACT);
});
test('V1  the point lies on the circle r = 0.6 and the arc x = 0.8', () => {
  const g = rf.zToGamma(c(0.6, 0.8), 1);
  for (const circle of [rf.rCircle(0.6), rf.xArc(0.8)]) {
    close(Math.hypot(g.re - circle.cx, g.im - circle.cy), circle.rad, EXACT);
  }
});
test('V2  z = 0.6 + j1.4 → y = 0.259 − j0.603, symmetric about the centre', () => {
  const y = rf.invZ(c(0.6, 1.4));
  close(y, c(0.259, -0.603));
  close(y, cinv(c(0.6, 1.4)), EXACT);
  close(net.solve(project(50, 1e9, c(30, 70)))[0].yn, c(0.259, -0.603));
  close(rf.zToGamma(y, 1), K.neg(rf.zToGamma(c(0.6, 1.4), 1)), EXACT, 'symmetry');
});
test('V3  z = 1.2 − j1.4 → y = 0.353 + j0.412', () => {
  const y = rf.invZ(c(1.2, -1.4));
  close(y, c(0.353, 0.412));
  close(y, cinv(c(1.2, -1.4)), EXACT);
  close(rf.zToGamma(y, 1), K.neg(rf.zToGamma(c(1.2, -1.4), 1)), EXACT, 'symmetry');
});
test('V4  series C, Δx = −j1.1: 0.6 + j0.8 → 0.6 − j0.3 (circle r, downwards)', () => {
  const f = 1e9;
  const cap = rf.componentForReactance(-1.1 * 50, f);
  same(cap.kind, 'C');
  const p = project(50, f, c(30, 40), [C('series', cap.value)]);
  const [a, b] = net.solve(p);
  close(b.zn, c(0.6, -0.3));
  const info = net.stepInfo(p, 0);
  same(info.locus.type, 'r');
  close(info.locus.value, 0.6); close(info.locus.delta, -1.1);
  ok(b.gamma.im < a.gamma.im, 'a series C must move down on the chart');
});
test('V5  series L, Δx = +j1.8: 1.2 − j1.4 → 1.2 + j0.4 (circle r, upwards)', () => {
  const f = 1e9;
  const ind = rf.componentForReactance(1.8 * 50, f);
  same(ind.kind, 'L');
  const p = project(50, f, c(60, -70), [L('series', ind.value)]);
  const [a, b] = net.solve(p);
  close(b.zn, c(1.2, 0.4));
  const info = net.stepInfo(p, 0);
  same(info.locus.type, 'r');
  close(info.locus.value, 1.2); close(info.locus.delta, 1.8);
  ok(b.gamma.im > a.gamma.im, 'a series L must move up on the chart');
});
test('V6  shunt C, Δb = +j1.4: y = 1.2 − j0.4 → 1.2 + j1.0 (circle g)', () => {
  const f = 1e9;
  const cap = rf.componentForSusceptance(1.4 / 50, f);
  same(cap.kind, 'C');
  const p = project(50, f, cscale(cinv(c(1.2, -0.4)), 50), [C('shunt', cap.value)]);
  const [a, b] = net.solve(p);
  close(a.yn, c(1.2, -0.4)); close(b.yn, c(1.2, 1.0));
  const info = net.stepInfo(p, 0);
  same(info.locus.type, 'g');
  close(info.locus.value, 1.2); close(info.locus.delta, 1.4);
});
test('V6b shunt L, Δb = −j1.4: y = 1.2 + j1.0 → 1.2 − j0.4 (slide 14)', () => {
  const f = 1e9;
  const ind = rf.componentForSusceptance(-1.4 / 50, f);
  same(ind.kind, 'L');
  const p = project(50, f, cscale(cinv(c(1.2, 1.0)), 50), [L('shunt', ind.value)]);
  close(net.solve(p)[1].yn, c(1.2, -0.4));
  close(net.stepInfo(p, 0).locus.delta, -1.4);
});
test('V7  series RLC 30 Ω / 5.5 nH / 6.11 pF: Q = 1, resonance ≈ 868 MHz', () => {
  const res = rf.rlcResonance({ r: 30, l: 5.5e-9, c: 6.11e-12, topology: 'series' });
  close(res.q, 1); close(res.f0, 868e6);
  close(res.f0, 1 / (2 * Math.PI * Math.sqrt(5.5e-9 * 6.11e-12)), EXACT);
  const load = { kind: 'rlc', topology: 'series', r: 30, l: 5.5e-9, c: 6.11e-12 };
  const m = net.solve(project(50, res.f0, load))[0];
  close(m.zn.re, 0.6);
  ok(Math.abs(m.z.im) < 1e-6, `non-zero reactance at resonance: ${m.z.im}`);
  close(w(res.f0) * 5.5e-9 / 50, 0.6);                              // z_L = +j0.6
  close(net.solve(project(50, res.f0, { ...load, c: null }))[0].q, 1);   // Q of the R + L node
});

const F869 = 869e6;
const ladder = [C('shunt', 22e-12), L('series', 15e-9), C('shunt', 3.9e-12), C('series', 6.8e-12)];
/** Slide 16/17 ladder, reduced by hand from the load towards the input. */
const ladderReduction = (zLoad) => {
  const pts = [zLoad];
  pts.push(parZ(pts[0], zCap(F869, 22e-12)));
  pts.push(serZ(pts[1], zInd(F869, 15e-9)));
  pts.push(parZ(pts[2], zCap(F869, 3.9e-12)));
  pts.push(serZ(pts[3], zCap(F869, 6.8e-12)));
  return pts;
};
/** Same ladder as an ABCD cascade from the input towards the load. */
const ladderAbcd = (zLoad) => {
  let m = mSeries(zCap(F869, 6.8e-12));
  m = mMul(m, mShunt(zCap(F869, 3.9e-12)));
  m = mMul(m, mSeries(zInd(F869, 15e-9)));
  m = mMul(m, mShunt(zCap(F869, 22e-12)));
  return mZin(m, zLoad);
};

test('V8  slide 16 at 869 MHz (load 92 nH + 2 Ω): Zin ≈ 0.0018 − j157.19 Ω', () => {
  const load = { kind: 'rlc', topology: 'series', r: 2, l: 92e-9, c: null };
  const z = zin(project(50, F869, load, ladder));
  const zLoad = zInd(F869, 92e-9, 2);
  close(z, c(0.0018, -157.19), TOL, 'reference given');
  close(z, ladderReduction(zLoad)[4], EXACT, 'series/parallel reduction');
  close(z, ladderAbcd(zLoad), EXACT, 'ABCD cascade');
  // same circuit, with the 92 nH as the first element of the network instead of part of the load
  close(zin(project(50, F869, c(2, 0), [L('series', 92e-9), ...ladder])), z, EXACT, 'load 2 Ω + series L');
});
test('V9  slide 17 (Smith V3.10, load 2 + j10 Ω): the 5 points and their Q', () => {
  const nodes = net.solve(project(50, F869, c(2, 10), ladder));
  const displayed = [
    [c(2.000, 10.000), 5.000], [c(20.365, -25.382), 1.246], [c(20.365, 56.519), 2.775],
    [c(88.740, -88.611), 0.999], [c(88.740, -115.544), 1.302],
  ];
  const reference = ladderReduction(c(2, 10));
  displayed.forEach(([z, q], k) => {
    close(nodes[k].z, z, TOL, `point ${k + 1}`);
    close(nodes[k].q, q, TOL, `Q of point ${k + 1}`);
    close(nodes[k].z, reference[k], EXACT, `point ${k + 1} (reduction)`);
  });
  close(nodes[4].z, ladderAbcd(c(2, 10)), EXACT, 'ABCD cascade');
});
test('V9  slide 17, Cursor panel for Z = 33.22 − j42.08 Ω', () => {
  const m = rf.metrics(rf.stFromZ(c(33.22, -42.08)), 50, F869);
  close(m.mag, 0.486, TOL, '|Γ|');
  close(m.ang, -84.920, TOL, 'arg Γ');
  close(m.rl, 6.27, TOL, 'return loss');
  close(m.vswr, 2.89, TOL, 'VSWR');
  shown(m.q, 1.27, 2, 'Q');
  close(m.y, c(11.56e-3, 14.64e-3), TOL, 'Y');
});
test('V10 Dellsperger ex. 1: 10 + j7 Ω at 150 MHz, series C 39.2 pF then shunt L 26.6 nH', () => {
  const nodes = net.solve(project(50, 150e6, c(10, 7), [C('series', 39.2e-12), L('shunt', 26.6e-9)]));
  close(nodes[1].z, c(10.000, -20.067));
  close(nodes[2].z, c(50.269, -0.078));
  close(nodes[1].q, 2.007);
});
test('Plausibility (3 %): Dellsperger ex. 4, 9 and 10 (rounded schematic values)', () => {
  const ex4 = net.solve(project(50, 500e6, c(100, -50), [C('shunt', 1.9e-12), L('series', 19.4e-9)]));
  close(ex4[1].z, c(49.914, -61.220), 0.03); close(ex4[2].z, c(49.914, -0.273), 0.03);
  const f = 430e6;
  const line = TL(50, 0.208 * 360, f);
  const ex9 = net.solve(project(50, f, c(30, -40), [line, STUB('open', 50, 0.138 * 360, f)]));
  close(ex9[1].z, c(21.398, 24.666), 0.03); close(ex9[2].z, c(49.831, 0), 0.03);
  const ex10 = net.solve(project(50, f, c(30, -40), [line, STUB('short', 50, 0.388 * 360, f)]));
  close(ex10[2].z, c(49.831, 0.029), 0.03);
});

/* ========================================================================== */
group('3. Independent path: (V, I) engine against series/parallel reduction');

test('300 random R/L/C ladder networks', () => {
  const rnd = prng(12345);
  for (let n = 0; n < 300; n += 1) {
    const f = logBetween(rnd, 10e6, 3e9);
    const zl = c(between(rnd, 5, 500), between(rnd, -300, 300));
    const elements = [];
    let ref = zl;
    const count = 1 + Math.floor(rnd() * 6);
    for (let k = 0; k < count; k += 1) {
      const conn = rnd() < 0.5 ? 'series' : 'shunt';
      const pick = rnd();
      let ze;
      if (pick < 0.2) { const v = logBetween(rnd, 5, 500); elements.push(R(conn, v)); ze = c(v); }
      else if (pick < 0.6) { const v = logBetween(rnd, 0.5e-9, 100e-9); elements.push(L(conn, v)); ze = zInd(f, v); }
      else { const v = logBetween(rnd, 0.5e-12, 100e-12); elements.push(C(conn, v)); ze = zCap(f, v); }
      ref = conn === 'series' ? serZ(ref, ze) : parZ(ref, ze);
    }
    close(zin(project(50, f, zl, elements), f), ref, EXACT, `network #${n}`);
  }
});
test('finite-Q components: given ESR, or Q at a frequency', () => {
  const f = 400e6;
  const fq = 100e6;
  const zl = c(25, -15);
  const lv = 22e-9;
  const cv = 8.2e-12;
  const esrL = w(fq) * lv / 40;
  const esrC = 1 / (w(fq) * cv * 200);
  const elements = [
    L('series', lv, { mode: 'q', q: 40, f: fq }),
    C('shunt', cv, { mode: 'q', q: 200, f: fq }),
    L('shunt', lv, { mode: 'esr', esr: 0.7 }),
    C('series', cv, { mode: 'esr', esr: 0.3 }),
  ];
  let ref = serZ(zl, zInd(f, lv, esrL));
  ref = parZ(ref, zCap(f, cv, esrC));
  ref = parZ(ref, zInd(f, lv, 0.7));
  ref = serZ(ref, zCap(f, cv, 0.3));
  close(zin(project(50, f, zl, elements)), ref, EXACT);
  // a lossy component does not stay on the circle r
  same(net.stepInfo(project(50, f, zl, elements), 0).locus, null);
});
test('compound R-L-C elements, in series and in parallel', () => {
  const f = 500e6;
  const zl = c(40, 30);
  const zs = cadd(c(33), cadd(zInd(f, 22e-9), zCap(f, 18e-12)));                       // series R-L-C
  const zp = cinv(cadd(cinv(c(330)), cadd(cinv(zInd(f, 12e-9)), cinv(zCap(f, 4.7e-12)))));  // parallel R-L-C
  const elements = [
    { kind: 'RLC', conn: 'shunt', topology: 'series', r: 33, l: 22e-9, c: 18e-12 },
    { kind: 'RLC', conn: 'series', topology: 'parallel', r: 330, l: 12e-9, c: 4.7e-12 },
    { kind: 'RLC', conn: 'series', topology: 'series', r: null, l: 22e-9, c: 18e-12 },
    { kind: 'RLC', conn: 'shunt', topology: 'parallel', r: 330, l: null, c: 4.7e-12 },
  ];
  let ref = parZ(zl, zs);
  ref = serZ(ref, zp);
  ref = serZ(ref, cadd(zInd(f, 22e-9), zCap(f, 18e-12)));
  ref = parZ(ref, parZ(c(330), zCap(f, 4.7e-12)));
  close(zin(project(50, f, zl, elements)), ref, EXACT);
});
test('ideal transformer: Zin = n²·Z', () => {
  close(zin(project(50, 1e8, c(12.5, 5), [{ kind: 'XFMR', n: 2 }])), c(50, 20), EXACT);
  close(zin(project(50, 1e8, c(200, -80), [{ kind: 'XFMR', n: 0.5 }])), c(50, -20), EXACT);
});

/* ========================================================================== */
group('4. Transmission lines');

test('λ/2 line = identity, whatever Zc', () => {
  for (const zc of [20, 50, 93]) close(zin(project(50, 1e9, c(30, -40), [TL(zc, 180, 1e9)])), c(30, -40), 1e-12);
});
test('λ/4 line = inverter: Zin = Zc²/Z', () => {
  close(zin(project(50, 1e9, c(100, 0), [TL(70.7107, 90, 1e9)])), c(50, 0), 1e-6);
  close(zin(project(50, 1e9, c(30, -40), [TL(75, 90, 1e9)])), cdiv(c(75 * 75), c(30, -40)), EXACT);
});
test('lossless line with Zc = Z0: |Γ| preserved, Γ rotates by −2θ', () => {
  const p = project(50, 1e9, c(30, -40), [TL(50, 37, 1e9)]);
  const [a, b] = net.solve(p);
  close(b.mag, a.mag, EXACT);
  close(b.gamma, cmul(a.gamma, c(Math.cos(-74 * Math.PI / 180), Math.sin(-74 * Math.PI / 180))), EXACT);
  const info = net.stepInfo(p, 0);
  same(info.locus.type, 'gamma');
});
test('200 random lines (with and without loss): closed-form tanh and ABCD matrix', () => {
  const rnd = prng(777);
  for (let n = 0; n < 200; n += 1) {
    const fref = logBetween(rnd, 50e6, 5e9);
    const f = fref * between(rnd, 0.4, 2.5);
    const zc = between(rnd, 20, 120);
    const deg = between(rnd, 1, 700);
    const er = between(rnd, 1, 10);
    const alpha = n % 3 === 0 ? 0 : between(rnd, 0.1, 30);
    const alphaLaw = rnd() < 0.5 ? 'sqrt' : 'const';
    const zl = c(between(rnd, 5, 300), between(rnd, -200, 200));
    const phys = (deg / 360) * LIGHT / fref / Math.sqrt(er);
    const a = alpha * phys * NEPER * (alphaLaw === 'sqrt' ? Math.sqrt(f / fref) : 1);
    const b = deg * (f / fref) * Math.PI / 180;
    const z = zin(project(50, fref, zl, [TL(zc, deg, fref, { er, alpha, alphaLaw })]), f);
    close(z, lineZin(zl, zc, a, b), 1e-8, `line #${n} (tanh)`);
    close(z, mZin(mLine(zc, a, b), zl), 1e-8, `line #${n} (ABCD)`);
  }
});
test('shorted lossy line: return loss = 2 × attenuation (ex. 15: 2 dB/m, 2 λ, 500 MHz)', () => {
  const f = 500e6;
  const line = TL(50, 720, f, { alpha: 2 });
  const lengths = rf.lineLengths(line);
  close(lengths.phys, 2 * LIGHT / f, EXACT);
  const oneWay = 2 * lengths.phys;                                   // dB
  close(net.inputAt(project(50, f, c(0, 0), [line])).rl, 2 * oneWay, EXACT);
  // sqrt(f) law: loss doubled at 4·f; constant law: unchanged
  close(net.inputAt(project(50, f, c(0, 0), [line]), 4 * f).rl, 4 * oneWay, EXACT);
  close(net.inputAt(project(50, f, c(0, 0), [{ ...line, alphaLaw: 'const' }]), 4 * f).rl, 2 * oneWay, EXACT);
});
test('very lossy line: Zin → Zc, without numerical overflow', () => {
  const m = net.inputAt(project(50, 1e9, c(3, 400), [TL(75, 3600, 1e9, { alpha: 5000 })]));
  noNaN(m);
  close(m.z, c(75, 0), 1e-9);
});
test('the physical length is fixed: 90° at f_ref = 180° at 2·f_ref', () => {
  const p = project(50, 1e9, c(30, -40), [TL(75, 90, 1e9)]);
  close(zin(p, 2e9), c(30, -40), 1e-12);
});
test('lengths: λ, electrical, physical, velocity factor', () => {
  const air = rf.lineLengths(TL(50, 0.208 * 360, 430e6));
  close(air.lambda, 0.208, EXACT);
  close(air.elec, 0.1451, TOL, 'electrical length shown by Smith (145.1 mm)');
  close(air.phys, air.elec, EXACT);
  const fr4 = rf.lineLengths(TL(50, 90, 1e9, { er: 4 }));
  close(fr4.phys, LIGHT / 1e9 / 4 / 2, EXACT);
  close(fr4.vf, 0.5, EXACT);
  close(fr4.delay, 0.25e-9, EXACT);
});
test('changing the reference frequency describes the same line', () => {
  const zl = c(18, 33);
  for (const alphaLaw of ['sqrt', 'const']) {
    const line = TL(62, 131, 700e6, { er: 3.2, alpha: 4, alphaLaw });
    const moved = rf.rereferenceLine(line, 1.9e9);
    close(rf.lineLengths(moved).phys, rf.lineLengths(line).phys, EXACT);
    for (const f of [300e6, 700e6, 1.9e9, 2.4e9]) {
      close(zin(project(50, 1e9, zl, [moved]), f), zin(project(50, 1e9, zl, [line]), f), EXACT, `${alphaLaw} at ${f} Hz`);
    }
  }
});

/* ========================================================================== */
group('5. Stubs');

test('shorted λ/4 stub = open circuit (no effect on the node)', () => {
  const h = net.branchOf(STUB('short', 50, 90, 1e9), 1e9);
  ok(K.isZero(h.d), 'the branch should be exactly an open circuit');
  close(zin(project(50, 1e9, c(30, -40), [STUB('short', 50, 90, 1e9)])), c(30, -40), 1e-12);
});
test('open λ/4 stub = short circuit', () => {
  const m = net.inputAt(project(50, 1e9, c(30, -40), [STUB('open', 50, 90, 1e9)]));
  same(m.z.re, 0); same(m.z.im, 0);
  close(m.gamma, c(-1, 0), EXACT);
});
test('λ/8 stub: open = −jZc, shorted = +jZc', () => {
  const z = (term) => { const h = net.branchOf(STUB(term, 75, 45, 1e9), 1e9); return K.div(h.n, h.d); };
  close(z('open'), c(0, -75), EXACT);
  close(z('short'), c(0, 75), EXACT);
});
test('lossless stubs: Y = j·tan(βl)/Zc (open), −j·cot(βl)/Zc (shorted)', () => {
  const rnd = prng(99);
  for (let n = 0; n < 100; n += 1) {
    const zc = between(rnd, 20, 120);
    const deg = between(rnd, 2, 178);
    const zl = c(between(rnd, 5, 300), between(rnd, -200, 200));
    const t = Math.tan(deg * Math.PI / 180);
    close(zin(project(50, 1e9, zl, [STUB('open', zc, deg, 1e9)])), cinv(cadd(cinv(zl), c(0, t / zc))), EXACT);
    close(zin(project(50, 1e9, zl, [STUB('short', zc, deg, 1e9)])), cinv(cadd(cinv(zl), c(0, -1 / (t * zc)))), EXACT);
    same(net.stepInfo(project(50, 1e9, zl, [STUB('open', zc, deg, 1e9)]), 0).locus.type, 'g');
  }
});
test('lossy stubs: Zc·coth(γl) and Zc·tanh(γl)', () => {
  const stub = (term) => STUB(term, 60, 70, 1e9, { er: 2.2, alpha: 12 });
  const phys = rf.lineLengths(stub('open')).phys;
  const t = ctanh(12 * phys * NEPER, 70 * Math.PI / 180);
  const zl = c(80, 25);
  close(zin(project(50, 1e9, zl, [stub('short')])), parZ(zl, cscale(t, 60)), EXACT);
  close(zin(project(50, 1e9, zl, [stub('open')])), parZ(zl, cscale(cinv(t), 60)), EXACT);
});
test('zero-length stub: open has no effect, shorted = short circuit', () => {
  close(zin(project(50, 1e9, c(30, -40), [STUB('open', 50, 0, 1e9)])), c(30, -40), 1e-12);
  const m = net.inputAt(project(50, 1e9, c(30, -40), [STUB('short', 50, 0, 1e9)]));
  same(m.z.re, 0); same(m.z.im, 0);
});

/* ========================================================================== */
group('6. Chart geometry');

const angles = [20, 75, 130, 200, 260, 325];
test('circles r = const and arcs x = const', () => {
  for (const r of [0, 0.2, 0.6, 1, 5]) {
    for (const a of angles) close(rf.gammaToZ(rf.circlePoint(rf.rCircle(r), a), 1).re, r, 1e-9, `r = ${r}`);
  }
  for (const x of [-5, -1, -0.3, 0.3, 0.8, 2]) {
    for (const a of angles) close(rf.gammaToZ(rf.circlePoint(rf.xArc(x), a), 1).im, x, 1e-9, `x = ${x}`);
  }
});
test('slide 4: the circle r crosses the real axis at (r − 1)/(r + 1) and at 1', () => {
  for (const r of [0.2, 0.5, 1, 2]) {
    const circle = rf.rCircle(r);
    close(circle.cx - circle.rad, (r - 1) / (r + 1), EXACT);
    close(circle.cx + circle.rad, 1, EXACT);
    close(circle.rad, 1 / (r + 1), EXACT);
  }
  const arc = rf.xArc(0.5);
  same(arc.cx, 1); close(arc.cy, 2, EXACT); close(arc.rad, 2, EXACT);
});
test('circles g = const and arcs b = const; Y chart = Z chart rotated by 180°', () => {
  for (const g of [0, 0.35, 1.2, 4]) {
    for (const a of angles) close(rf.gammaToY(rf.circlePoint(rf.gCircle(g), a), 1).re, g, 1e-9, `g = ${g}`);
    close(rf.gCircle(g).cx, -rf.rCircle(g).cx, EXACT);
  }
  for (const b of [-3, -0.6, 0.412, 1.4]) {
    for (const a of angles) close(rf.gammaToY(rf.circlePoint(rf.bArc(b), a), 1).im, b, 1e-9, `b = ${b}`);
    close(rf.bArc(b).cx, -rf.xArc(b).cx, EXACT); close(rf.bArc(b).cy, -rf.xArc(b).cy, EXACT);
  }
});
test('constant-Q loci: |x|/r = Q, pass through Γ = ±1 (slide 9)', () => {
  for (const q of [0.5, 1, 3]) {
    for (const upper of [true, false]) {
      const arc = rf.qArc(q, upper);
      close(Math.hypot(1 - arc.cx, 0 - arc.cy), arc.rad, EXACT);
      close(Math.hypot(-1 - arc.cx, 0 - arc.cy), arc.rad, EXACT);
      let inside = 0;
      for (let a = 0; a < 360; a += 7) {
        const g = rf.circlePoint(arc, a);
        if (Math.hypot(g.re, g.im) >= 0.999) continue;
        inside += 1;
        const z = rf.gammaToZ(g, 1);
        close(Math.abs(z.im) / z.re, q, 1e-9, `Q = ${q}`);
        ok(upper ? z.im > 0 : z.im < 0, 'wrong half-plane');
      }
      ok(inside > 5, 'no point of the locus inside the disc');
    }
  }
  // the series RLC points of slide 9 (r = 0.6, x = ±0.6) lie on the Q = 1 locus
  for (const x of [0.6, -0.6]) {
    const arc = rf.qArc(1, x > 0);
    const g = rf.zToGamma(c(0.6, x), 1);
    close(Math.hypot(g.re - arc.cx, g.im - arc.cy), arc.rad, EXACT);
  }
});
test('VSWR circles', () => {
  for (const s of [1.2, 2, 2.89, 10]) {
    for (const a of angles) close(rf.metrics(rf.stFromGamma(rf.circlePoint(rf.vswrCircle(s), a), 50), 50).vswr, s, 1e-9);
  }
});

/* ========================================================================== */
group('7. Trajectories and sweep');

test('element trajectory: endpoints, circle followed, maximum step', () => {
  const p = project(50, F869, c(2, 10), ladder);
  const nodes = net.solve(p);
  ladder.forEach((el, k) => {
    const path = net.trajectory(p, k);
    close(path[0].gamma, nodes[k].gamma, EXACT, `start of element ${k}`);
    close(path[path.length - 1].gamma, nodes[k + 1].gamma, EXACT, `end of element ${k}`);
    let longest = 0;
    for (let i = 1; i < path.length; i += 1) {
      ok(path[i].t > path[i - 1].t, 'non-increasing parameter');
      longest = Math.max(longest, Math.hypot(path[i].gamma.re - path[i - 1].gamma.re, path[i].gamma.im - path[i - 1].gamma.im));
      const value = el.conn === 'series' ? rf.gammaToZ(path[i].gamma, 1).re : rf.gammaToY(path[i].gamma, 1).re;
      const expected = el.conn === 'series' ? nodes[k].zn.re : nodes[k].yn.re;
      close(value, expected, 1e-7, `element ${k} off its circle`);
    }
    ok(longest <= 0.0201, `step of ${longest} > 0.02`);
  });
});
test('trajectory of a one-wavelength line: two full turns', () => {
  const p = project(50, 1e9, c(100, 0), [TL(50, 360, 1e9)]);
  const path = net.trajectory(p, 0);
  let length = 0;
  for (let i = 1; i < path.length; i += 1) {
    length += Math.hypot(path[i].gamma.re - path[i - 1].gamma.re, path[i].gamma.im - path[i - 1].gamma.im);
    close(Math.hypot(path[i].gamma.re, path[i].gamma.im), 1 / 3, 1e-9);
  }
  close(length, 2 * (2 * Math.PI / 3), 1e-3);
});
test('linear and logarithmic frequency lists', () => {
  const lin = net.frequencyList({ start: 300e6, stop: 800e6, points: 6 });
  same(lin.length, 6); same(lin[0], 300e6); same(lin[5], 800e6); close(lin[1], 400e6, EXACT);
  const log = net.frequencyList({ start: 1e6, stop: 1e9, points: 4, scale: 'log' });
  close(log[1], 1e7, EXACT); close(log[2], 1e8, EXACT); same(log[3], 1e9);
  same(net.frequencyList({ start: 5, stop: 5, points: 10 }).length, 1);
});
test('sweep: same values as the point-by-point computation', () => {
  const p = project(50, F869, { kind: 'rlc', topology: 'series', r: 2, l: 92e-9, c: null }, ladder);
  const spec = { start: 700e6, stop: 1000e6, points: 31 };
  const trace = net.sweep(p, spec);
  same(trace.length, 31);
  net.frequencyList(spec).forEach((f, k) => {
    same(trace[k].f, f);
    close(trace[k].gamma, net.inputAt(p, f).gamma, EXACT);
  });
  close(net.sweep(p, spec, 2)[7].z, net.solve(p, trace[7].f)[2].z, EXACT, 'intermediate node');
});
test('slide 15: increasing f makes z(f) and y(f) rotate clockwise', () => {
  const clockwise = (trace, centre) => {
    for (let k = 1; k < trace.length; k += 1) {
      const a = csub(trace[k - 1].gamma, centre);
      const b = csub(trace[k].gamma, centre);
      ok(a.re * b.im - a.im * b.re < 0, `counter-clockwise rotation at point ${k}`);
    }
  };
  const spec = { start: 200e6, stop: 3e9, points: 40 };
  // z = 0.5 + j·f(ω): series R-L-C, on the circle r = 0.5
  const zTrace = net.sweep(project(50, 1e9, { kind: 'rlc', topology: 'series', r: 25, l: 8e-9, c: 3e-12 }), spec);
  zTrace.forEach((m) => close(m.zn.re, 0.5, 1e-9));
  clockwise(zTrace, c(rf.rCircle(0.5).cx, 0));
  // y = 0.6 + j·g(ω): parallel R-L-C, on the circle g = 0.6
  const yTrace = net.sweep(project(50, 1e9, { kind: 'rlc', topology: 'parallel', r: 50 / 0.6, l: 8e-9, c: 3e-12 }), spec);
  yTrace.forEach((m) => close(m.yn.re, 0.6, 1e-9));
  clockwise(yTrace, c(rf.gCircle(0.6).cx, 0));
});

/* ========================================================================== */
group('8. Edge cases');

const OPEN = c(Infinity, 0);
const zero = (z) => z.re === 0 && z.im === 0;
const infinite = (z) => !Number.isFinite(z.re);

test('open circuit and short circuit as load', () => {
  const open = net.solve(project(50, 1e9, OPEN))[0];
  noNaN(open);
  ok(infinite(open.z) && zero(open.y), 'open circuit wrongly represented');
  close(open.gamma, c(1, 0), EXACT); same(open.vswr, Infinity); same(open.q, null); same(open.active, false);
  const short = net.solve(project(50, 1e9, c(0, 0)))[0];
  noNaN(short);
  ok(zero(short.z) && infinite(short.y), 'short circuit wrongly represented');
  close(short.gamma, c(-1, 0), EXACT); same(short.vswr, Infinity); same(short.rl, 0);
});
test('1/z without NaN: 1/0 = ∞ and 1/∞ = 0', () => {
  ok(infinite(rf.invZ(c(0, 0))), '1/0');
  ok(zero(rf.invZ(OPEN)), '1/∞');
  ok(infinite(rf.gammaToZ(c(1, 0), 50)) && zero(rf.gammaToZ(c(-1, 0), 50)), 'Γ = ±1');
});
test('elements on an open circuit or a short circuit', () => {
  const f = 1e9;
  const x50 = 50 / w(f);                       // inductance of +j50 Ω
  const b50 = 1 / (50 * w(f));                 // capacitance of −j50 Ω
  ok(infinite(zin(project(50, f, OPEN, [L('series', x50)]))), 'open + series L');
  close(zin(project(50, f, OPEN, [C('shunt', b50)])), c(0, -50), EXACT);
  ok(zero(zin(project(50, f, c(0, 0), [C('shunt', b50)]))), 'short circuit + shunt C');
  close(zin(project(50, f, c(0, 0), [L('series', x50)])), c(0, 50), EXACT);
  close(zin(project(50, f, OPEN, [TL(50, 90, f)])), c(0, 0), EXACT, 'open seen through λ/4');
  ok(infinite(zin(project(50, f, c(0, 0), [TL(50, 90, f)]))), 'short circuit seen through λ/4');
  net.solve(project(50, f, OPEN, [L('series', x50), C('shunt', b50), TL(75, 33, f)])).forEach((m) => noNaN(m));
});
test('zero frequency', () => {
  const zl = c(30, 0);
  const at0 = (el) => net.inputAt(project(50, 1e9, zl, [el]), 0);
  close(at0(L('series', 10e-9)).z, zl, EXACT);
  ok(infinite(at0(C('series', 10e-12)).z), 'series C at DC = open circuit');
  ok(zero(at0(L('shunt', 10e-9)).z), 'shunt L at DC = short circuit');
  close(at0(C('shunt', 10e-12)).z, zl, EXACT);
  close(at0(TL(75, 90, 1e9, { alpha: 3 })).z, zl, EXACT);
  close(at0(STUB('open', 75, 90, 1e9)).z, zl, EXACT);
  ok(zero(at0(STUB('short', 75, 90, 1e9)).z), 'shorted stub at DC');
  for (const el of [L('series', 1e-9), C('series', 1e-12), L('shunt', 1e-9), C('shunt', 1e-12), TL(75, 90, 1e9)]) noNaN(at0(el));
  noNaN(net.inputAt(project(50, 1e9, { kind: 'rlc', topology: 'series', r: 10, l: 1e-9, c: 1e-12 }), 0));
});
test('zero or infinite values', () => {
  const zl = c(30, -40);
  const z = (el) => zin(project(50, 1e9, zl, [el]));
  close(z(L('series', 0)), zl, EXACT); close(z(C('shunt', 0)), zl, EXACT);
  close(z(R('series', 0)), zl, EXACT); close(z(R('shunt', Infinity)), zl, EXACT);
  ok(infinite(z(C('series', 0))), 'zero series C'); ok(infinite(z(R('series', Infinity))), 'infinite series R');
  ok(infinite(z(L('series', Infinity))), 'infinite series L');
  ok(zero(z(L('shunt', 0))), 'zero shunt L'); ok(zero(z(R('shunt', 0))), 'zero shunt R');
  close(z(C('series', Infinity)), zl, EXACT);
  for (const el of [L('series', 0), C('series', 0), L('shunt', 0), C('shunt', 0), R('shunt', 0), R('series', Infinity)]) {
    noNaN(net.inputAt(project(50, 1e9, zl, [el])));
  }
  noNaN(net.inputAt(project(50, 1e9, zl, [C('series', 0, { mode: 'q', q: 100, f: 1e9 })])));
});
test('|Γ| = 1: purely reactive load', () => {
  const p = project(50, 1e9, c(0, 50), [L('series', 3e-9), C('shunt', 2e-12), TL(50, 77, 1e9), C('series', 5e-12)]);
  for (const m of net.solve(p)) {
    noNaN(m);
    same(m.mag, 1); same(m.vswr, Infinity); same(m.ml, Infinity); same(m.rl, 0); same(m.active, false);
  }
  same(net.solve(p)[0].q, Infinity);
});
test('r < 0: point outside the disc, flagged active', () => {
  const m = net.solve(project(50, 1e9, c(-25, 10)))[0];
  noNaN(m);
  ok(m.mag > 1 && m.active, 'not flagged active');
  same(m.vswr, null); same(m.ml, null);
  ok(m.rl < 0, 'return loss should be negative');
  close(m.zn, c(-0.5, 0.2), EXACT);
});
test('Z = −Z0: infinite Γ, without NaN', () => {
  const m = net.solve(project(50, 1e9, c(-50, 0)))[0];
  noNaN(m);
  same(m.mag, Infinity); same(m.vswr, null); same(m.active, true); same(m.ang, null);
});
test('tabulated load: exact at the points, interpolated on Γ, frozen outside the range', () => {
  const load = { kind: 'table', points: [
    { f: 140e6, z: c(100.8, 24.2) }, { f: 145e6, z: c(106.9, 41.7) }, { f: 150e6, z: c(121.2, 60) },
  ] };
  const p = project(50, 145e6, load);
  load.points.forEach((pt) => close(net.solve(p, pt.f)[0].z, pt.z, EXACT));
  const mid = cscale(cadd(rf.zToGamma(c(100.8, 24.2), 50), rf.zToGamma(c(106.9, 41.7), 50)), 0.5);
  close(net.solve(p, 142.5e6)[0].gamma, mid, EXACT);
  close(net.solve(p, 100e6)[0].z, c(100.8, 24.2), EXACT);
  close(net.solve(p, 900e6)[0].z, c(121.2, 60), EXACT);
  same(net.loadCovers(load, 142e6), true); same(net.loadCovers(load, 151e6), false);
  noNaN(net.solve(project(50, 1e9, { kind: 'table', points: [{ f: 1e9, z: OPEN }, { f: 2e9, z: c(0, 0) }] }), 1.5e9)[0]);
});
test('disabled element (off): ignored', () => {
  const p = project(50, 1e9, c(30, -40), [{ ...L('series', 10e-9), off: true }, C('shunt', 1e-12)]);
  close(net.solve(p)[1].z, c(30, -40), EXACT);
  close(zin(p), zin(project(50, 1e9, c(30, -40), [C('shunt', 1e-12)])), EXACT);
});

/* ========================================================================== */
group('9. Engineering notation');

test('free input', () => {
  const cases = [
    ['6.8p', '', 6.8e-12], ['15n', '', 15e-9], ['869M', '', 869e6],
    ['6,8 pF', 'F', 6.8e-12], ['15nH', 'H', 15e-9], ['869MHz', 'Hz', 869e6], ['869 mhz', 'Hz', NaN],
    ['2k2', '', 2200], ['4n7', '', 4.7e-9], ['4R7', '', 4.7], ['1e-9', '', 1e-9], ['2.5E3', '', 2500],
    ['50', 'Ω', 50], ['50Ω', 'Ω', 50], ['50 ohm', 'Ω', 50], ['1.5k', 'Ω', 1500],
    ['10mm', 'm', 0.01], ['10m', 'm', 10], ['5m', '', 5e-3], ['1meg', '', 1e6], ['3.3u', '', 3.3e-6], ['3.3µ', '', 3.3e-6],
    ['-12.5', '', -12.5], ['.5n', '', 0.5e-9], ['10fF', 'F', 10e-15], ['90°', '°', 90], ['90deg', '°', 90],
    ['inf', '', Infinity], ['abc', '', NaN], ['', '', NaN], ['1.2.3', '', NaN], ['p', '', NaN],
  ];
  for (const [text, unit, expected] of cases) {
    const got = eng.parse(text, unit);
    if (Number.isNaN(expected)) ok(Number.isNaN(got), `"${text}" should be rejected, got ${got}`);
    else if (!Number.isFinite(expected)) same(got, expected, `"${text}"`);
    else close(got, expected, 1e-12, `"${text}"`);
  }
  same(eng.parse(42), 42);
});
test('display', () => {
  const cases = [
    [6.8e-12, 'F', '6.8 pF'], [15e-9, 'H', '15 nH'], [869e6, 'Hz', '869 MHz'], [50, 'Ω', '50 Ω'],
    [0.02, 'm', '20 mm'], [0, 'Ω', '0 Ω'], [999.96e3, 'Hz', '1 MHz'], [1234.5, 'Ω', '1.234 kΩ'],
    [-3.3e-6, 'F', '-3.3 µF'], [Infinity, 'Ω', '∞ Ω'], [NaN, 'Ω', '-'], [12.5, '', '12.5'],
  ];
  for (const [value, unit, expected] of cases) same(eng.format(value, unit), expected);
  same(eng.formatCx(c(0.6, 0.8)), '0.6 + j0.8');
  same(eng.formatCx(c(1.2, -1.4)), '1.2 - j1.4');
  same(eng.formatCx(c(Infinity, 0)), '∞');
});
test('round trip display → input', () => {
  const rnd = prng(4242);
  for (let n = 0; n < 200; n += 1) {
    const value = logBetween(rnd, 1e-14, 1e11);
    close(eng.parse(eng.format(value, 'F', 9), 'F'), value, 1e-8);
  }
});

/* ========================================================================== */
group('10. SVG chart geometry (smith-chart)');

const ARC = /^M(-?[\d.]+) (-?[\d.]+)A(-?[\d.]+) (-?[\d.]+) 0 ([01]) ([01]) (-?[\d.]+) (-?[\d.]+)$/;
/** Centre and swept angle of an SVG arc, from its endpoint form (SVG 1.1, F.6.5). */
const svgArc = (d) => {
  const m = ARC.exec(d);
  ok(m, `unexpected path: ${d}`);
  const [x1, y1, r, , large, sweep, x2, y2] = m.slice(1).map(Number);
  const hx = (x1 - x2) / 2;
  const hy = (y1 - y2) / 2;
  const coef = (large !== sweep ? 1 : -1) * Math.sqrt(Math.max(0, (r * r - hx * hx - hy * hy) / (hx * hx + hy * hy)));
  const cxp = coef * hy;
  const cyp = -coef * hx;
  const centre = { x: cxp + (x1 + x2) / 2, y: cyp + (y1 + y2) / 2 };
  const t1 = Math.atan2(hy - cyp, hx - cxp);
  let dt = Math.atan2(-hy - cyp, -hx - cxp) - t1;
  if (sweep && dt < 0) dt += 2 * Math.PI;
  if (!sweep && dt > 0) dt -= 2 * Math.PI;
  return { centre, r, t1, dt, chord: 2 * Math.hypot(hx, hy) };
};
/** True when pixel point p lies on the arc (within tol pixels). */
const onArc = (arc, p, tol = 0.6) => {
  if (Math.abs(Math.hypot(p.x - arc.centre.x, p.y - arc.centre.y) - arc.r) > tol) return false;
  let t = Math.atan2(p.y - arc.centre.y, p.x - arc.centre.x) - arc.t1;
  if (arc.dt >= 0) { while (t < -1e-6) t += 2 * Math.PI; return t <= arc.dt + 1e-6; }
  while (t > 1e-6) t -= 2 * Math.PI;
  return t >= arc.dt - 1e-6;
};
const view600 = Chart.makeView(600, 600, 262);

test('screen frame ↔ Γ plane', () => {
  const v = Chart.makeView(800, 500, 200, 410, 240);
  const p = Chart.toPx(v, c(0.25, 0.5));
  close(p.x, 460, EXACT); close(p.y, 140, EXACT);            // Im(Γ) upwards = screen y downwards
  close(Chart.toGamma(v, p.x, p.y), c(0.25, 0.5), EXACT);
});
test('arcs r = const: the SVG path goes through the right points, on both planes', () => {
  const rnd = prng(2024);
  let checked = 0;
  for (let n = 0; n < 400; n += 1) {
    const sign = n % 2 ? 1 : -1;
    const r = logBetween(rnd, 0.03, 8);
    const xa = between(rnd, -8, 6);
    const xb = xa + logBetween(rnd, 0.05, 12);
    const arc = svgArc(Chart.rSeg(view600, r, xa, xb, sign));
    if (arc.chord < 12) continue;
    checked += 1;
    for (const u of [0.1, 0.35, 0.5, 0.8]) {
      const x = Math.tan(Math.atan(xa) + (Math.atan(xb) - Math.atan(xa)) * u);
      ok(onArc(arc, Chart.toPx(view600, Chart.planePoint(r, x, sign))), `r = ${r}, x from ${xa} to ${xb}, plane ${sign}: point off the arc`);
    }
    // and not beyond: a point of the same curve outside the interval is not on the arc
    const beyond = Chart.toPx(view600, Chart.planePoint(r, Math.tan(Math.atan(xb) + (Math.PI / 2 - Math.atan(xb)) * 0.5), sign));
    const end = Chart.toPx(view600, Chart.planePoint(r, xb, sign));
    if (Math.hypot(beyond.x - end.x, beyond.y - end.y) > 3) ok(!onArc(arc, beyond, 0.3), 'the arc overshoots its end');
  }
  ok(checked > 200, `too few cases checked (${checked})`);
});
test('arcs x = const: the SVG path goes through the right points, on both planes', () => {
  const rnd = prng(31337);
  let checked = 0;
  for (let n = 0; n < 400; n += 1) {
    const sign = n % 2 ? 1 : -1;
    const x = (rnd() < 0.5 ? -1 : 1) * logBetween(rnd, 0.05, 8);
    const ra = between(rnd, 0, 3);
    const rb = rnd() < 0.2 ? Infinity : ra + logBetween(rnd, 0.05, 20);
    const arc = svgArc(Chart.xSeg(view600, x, ra, rb, sign));
    if (arc.chord < 12) continue;
    checked += 1;
    for (const u of [0.1, 0.5, 0.9]) {
      const r = Math.tan(Math.atan(ra) + (Math.atan(rb) - Math.atan(ra)) * u);
      ok(onArc(arc, Chart.toPx(view600, Chart.planePoint(r, x, sign))), `x = ${x}, r from ${ra} to ${rb}, plane ${sign}: point off the arc`);
    }
  }
  ok(checked > 200, `too few cases checked (${checked})`);
});
test('real axis, full circle and Q loci', () => {
  same(Chart.xSeg(view600, 0, 0, Infinity, 1), 'M38 300L562 300');
  const full = /^M(-?[\d.]+) (-?[\d.]+)a/.exec(Chart.rSeg(view600, 1, -Infinity, Infinity, 1));
  close(Number(full[1]), 300, EXACT); close(Number(full[2]), 300, EXACT);    // circle r = 1: starts at the centre
  for (const q of [0.5, 1, 4]) {
    for (const upper of [true, false]) {
      const arc = svgArc(Chart.qArcD(view600, q, upper));
      const circle = rf.qArc(q, upper);
      const centre = Chart.toPx(view600, c(circle.cx, circle.cy));
      ok(Math.hypot(arc.centre.x - centre.x, arc.centre.y - centre.y) < 0.6, `centre of the Q = ${q} locus`);
      for (const x of [0.3, 1, 5]) {
        const g = rf.zToGamma(c(x / q, upper ? x : -x), 1);     // |x| / r = Q
        ok(onArc(arc, Chart.toPx(view600, g)), `point Q = ${q} off the locus`);
      }
    }
  }
});
test('visible range: overview and zoomed view around z = 1', () => {
  const whole = Chart.visibleRange(view600, 1);
  same(whole.rMin, 0); same(whole.rMax, Infinity); same(whole.pole, true); same(whole.modMin, 0);
  const near = Chart.visibleRange(Chart.makeView(600, 600, 3000), 1);       // half-width 0.1 in Γ
  // extremes reached on the frame edge: corners Γ = ±0.1 ± j0.1 and middle of the right edge Γ = 0.1
  close(near.rMin, 0.98 / 1.22, EXACT); close(near.rMax, 1.1 / 0.9, EXACT);
  close(near.xMax, 0.2 / 0.82, EXACT); close(near.xMin, -0.2 / 0.82, EXACT);
  same(near.pole, false);
  same(Chart.visibleRange(Chart.makeView(600, 600, 3000, -9000, 300), 1), null);   // disc outside the view
});
test('adaptive grid: line count bounded at every zoom, labels without overlap', () => {
  const rnd = prng(8);
  const views = [view600, Chart.makeView(300, 300, 112), Chart.makeView(1400, 900, 410), Chart.makeView(600, 600, 80)];
  for (let n = 0; n < 60; n += 1) {
    const k = 262 * logBetween(rnd, 1.5, 600);
    const a = between(rnd, 0, 2 * Math.PI);
    const rho = n % 6 === 0 ? 1 : n % 6 === 1 ? 0.999 : Math.sqrt(rnd());       // stresses the edge and the poles
    const g = n % 12 === 0 ? c(1, 0) : n % 12 === 7 ? c(-1, 0) : c(rho * Math.cos(a), rho * Math.sin(a));
    views.push(Chart.makeView(600, 600, k, 300 - g.re * k, 300 + g.im * k));
  }
  views.forEach((v, n) => {
    const placed = [];
    for (const sign of [1, -1]) {
      for (const units of ['norm', 'abs']) {
        const g = Chart.grid(v, sign, { units, z0: 50, placed: units === 'norm' ? placed : [] });
        const all = g.d.maj + g.d.med + g.d.min;
        ok(!/NaN|Infinity|undefined/.test(all), `view ${n}: invalid path`);
        ok(g.count <= 400, `view ${n}: ${g.count} lines`);
        ok(g.count >= 6, `view ${n} (k = ${v.k.toFixed(0)}): only ${g.count} lines`);
        for (const l of g.labels) {
          ok(l.box.x0 >= 0 && l.box.x1 <= v.w && l.box.y0 >= 0 && l.box.y1 <= v.h, `view ${n}: label "${l.text}" outside the frame`);
          ok(!/NaN|undefined/.test(l.text), `view ${n}: label "${l.text}"`);
        }
      }
    }
    for (let i = 0; i < placed.length; i += 1) {
      for (let j = i + 1; j < placed.length; j += 1) {
        const a = placed[i];
        const b = placed[j];
        ok(!(a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0), `view ${n}: two labels overlap`);
      }
    }
  });
});
test('overview: classic graduations, same lines on the Z and Y planes', () => {
  const z = Chart.grid(view600, 1, { units: 'norm', z0: 50 });
  const y = Chart.grid(view600, -1, { units: 'norm', z0: 50 });
  same(z.count, y.count);
  const texts = new Set(z.labels.map((l) => l.text));
  for (const t of ['0.2', '0.5', '1', '2', '5', '−1', '−2', '−0.5']) ok(texts.has(t), `graduation ${t} missing`);
  // graduations in ohms and siemens, as in Smith V3.10: 50 Ω and 20 mS at the centre
  const zAbs = new Set(Chart.grid(view600, 1, { units: 'abs', z0: 50 }).labels.map((l) => l.text));
  const yAbs = new Set(Chart.grid(view600, -1, { units: 'abs', z0: 50 }).labels.map((l) => l.text));
  for (const t of ['50', '25', '100', '250']) ok(zAbs.has(t), `graduation ${t} Ω missing`);
  for (const t of ['20m', '10m', '40m', '4m']) ok(yAbs.has(t), `graduation ${t}S missing`);
});
test('polylines and arrows', () => {
  same(Chart.polyD(view600, [c(0, 0), c(0.5, 0), c(NaN, 0), c(0.5, 0.5), c(1, 0.5)]), 'M300 300L431 300M431 169L562 169');
  const at = Chart.pointAlong(view600, [c(0, 0), c(1, 0)], 0.25);
  close(at.x, 365.5, EXACT); close(at.y, 300, EXACT); close(at.dx, 1, EXACT); close(at.length, 262, EXACT);
  same(Chart.pointAlong(view600, [c(0.2, 0.2)], 0.5), null);
  ok(/^M[\d. -]+L[\d. -]+L[\d. -]+Z$/.test(Chart.arrowD(at)), 'malformed arrow');
});

/* ========================================================================== */
group('11. Network editing');

const { io } = Core;

test('default elements: reactances of ±Z0 at f₀, 45° line and stub at Z0', () => {
  const p = project(75, 433e6, c(75, 0));
  const z = (el) => { const h = net.branchOf(el, p.f0); return K.div(h.n, h.d); };
  close(z(net.defaultElement('L', 'series', p)), c(0, 75), EXACT);
  close(z(net.defaultElement('C', 'shunt', p)), c(0, -75), EXACT);
  close(z(net.defaultElement('R', 'series', p)), c(75, 0), EXACT);
  close(z(net.defaultElement('RLC', 'shunt', p)), c(75, 0), 1e-9);      // series R-L-C at resonance
  close(z(net.defaultElement('RLC', 'series', p)), c(75, 0), 1e-9);     // parallel R-L-C at resonance
  same(net.defaultElement('RLC', 'shunt', p).topology, 'series');
  same(net.defaultElement('RLC', 'series', p).topology, 'parallel');
  const line = net.defaultElement('TL', 'series', p);
  same(line.zc, 75); same(line.deg, 45); same(line.fref, 433e6);
  same(net.defaultElement('STUB', 'short', p).term, 'short');
  same(net.defaultElement('STUB', 'open', p).term, 'open');
  for (const [kind, variant] of [['R', 'series'], ['L', 'shunt'], ['C', 'series'], ['RLC', 'series'], ['RLC', 'shunt'], ['TL', 'series'], ['STUB', 'open'], ['STUB', 'short'], ['XFMR', 'series']]) {
    const m = net.inputAt({ ...p, load: { kind: 'z', z: c(20, 35) }, elements: [net.defaultElement(kind, variant, p)] });
    noNaN(m);
    ok(m.valid, `${kind} ${variant}: invalid result`);
  }
});
test('dragging a point: the recovered value brings the point back onto the target', () => {
  const f = 869e6;
  const cases = [
    [L('series', 15e-9), 'value'], [C('series', 6.8e-12), 'value'], [R('series', 33), 'value'],
    [L('shunt', 12e-9), 'value'], [C('shunt', 3.9e-12), 'value'], [R('shunt', 180), 'value'],
    [TL(50, 67, f), 'deg'], [TL(75, 112, 500e6, { er: 3.4, alpha: 3 }), 'deg'],
    [STUB('open', 50, 49.7, f), 'deg'], [STUB('short', 80, 139.7, f), 'deg'], [{ kind: 'XFMR', n: 1.7 }, 'n'],
  ];
  for (const [el, key] of cases) {
    const before = [C('shunt', 2e-12), L('series', 4e-9)];
    const truth = project(50, f, c(20, 35), [...before, el]);
    const target = net.inputAt(truth).gamma;
    // R, L, C, n: start from a very different value, the search does not depend on the starting point.
    // Lines and stubs: the search stays within half a wavelength of the current length, so that
    // a line longer than λ/2 (here 112° at 500 MHz, i.e. 195° at 869 MHz) keeps its turns.
    const start = project(50, f, c(20, 35), [...before, { ...el, [key]: key === 'deg' ? el.deg * 0.8 : el[key] * 37 }]);
    same(net.primaryKey(el), key);
    const found = net.tuneToward(start, 2, target);
    const landed = net.inputAt(project(50, f, c(20, 35), [...before, { ...el, [key]: found }])).gamma;
    ok(Math.hypot(landed.re - target.re, landed.im - target.im) < 1e-7, `${el.kind} ${el.conn || el.term || ''} : target missed (${found} instead of ${el[key]})`);
  }
});
test('dragging off the locus: we get the locus point closest to the target', () => {
  const f = 869e6;
  const p = project(50, f, c(20.365, -25.382), [L('series', 15e-9)]);
  const target = c(0.05, 0.35);                              // not on the circle r = 0.407
  const best = net.tuneToward(p, 0, target);
  const dist = (v) => { const g = net.inputAt(project(50, f, c(20.365, -25.382), [L('series', v)])).gamma; return Math.hypot(g.re - target.re, g.im - target.im); };
  for (const k of [0.9, 0.99, 1.01, 1.1, 3, 0.2]) ok(dist(best) <= dist(best * k) + 1e-12, `an inductance ${k} times larger is closer`);
  close(net.inputAt(project(50, f, c(20.365, -25.382), [L('series', best)])).zn.re, 20.365 / 50, EXACT);   // stays on its circle r
  same(net.tuneToward(project(50, f, c(50, 0), [{ kind: 'RLC', conn: 'series', topology: 'series', r: 1, l: 1e-9, c: 1e-12 }]), 0, target), null);
});
test('serialisation: a project with an open circuit survives the round trip', () => {
  const p = project(50, 869e6, OPEN, [L('series', 15e-9), TL(50, 90, 869e6)]);
  const back = io.parse(io.stringify(p));
  same(back.load.z.re, Infinity); same(back.load.z.im, 0);
  same(io.stringify(back), io.stringify(p));
  close(net.inputAt(back).gamma, net.inputAt(p).gamma, EXACT);
  const odd = io.parse(io.stringify({ a: -Infinity, b: NaN, c: [1, Infinity], d: { $num: 'x', other: 1 }, e: 'Infinity' }));
  same(odd.a, -Infinity); ok(Number.isNaN(odd.b), 'NaN lost'); same(odd.c[1], Infinity); same(odd.d.other, 1); same(odd.e, 'Infinity');
});
test('typographic minus sign accepted on input; chart graduations', () => {
  close(eng.parse('−12.5'), -12.5, EXACT);
  close(eng.parse('−j'.slice(0, 1) + '3n'), -3e-9, EXACT);
  same(JSON.stringify(Chart.ticks(700e6, 1000e6, 4)), JSON.stringify([700e6, 800e6, 900e6, 1000e6]));
  same(JSON.stringify(Chart.ticks(-40, 0, 4)), JSON.stringify([-40, -30, -20, -10, 0]));
  same(JSON.stringify(Chart.ticks(1, 6, 4)), JSON.stringify([2, 4, 6]));
  same(JSON.stringify(Chart.ticks(5, 5)), JSON.stringify([5]));
});

/* ========================================================================== */
group('12. Matching network synthesis');

const { match, eseries } = Core;
const Z50 = c(50, 0);
/** Every solution is put back into the direct engine: Zin must be the target. */
const verify = (res, zl, zt, f, label, tol = 1e-7) => {
  ok(res.solutions.length > 0, `${label}: no solution (${res.reason || ''})`);
  res.solutions.forEach((s, k) => close(zin(project(50, f, zl, s.elements)), zt, tol, `${label}, solution ${k + 1}`));
};

test('L network: all solutions match, 300 random loads', () => {
  const rnd = prng(606);
  for (let n = 0; n < 300; n += 1) {
    const f = logBetween(rnd, 50e6, 5e9);
    const zl = c(logBetween(rnd, 2, 800), between(rnd, -400, 400));
    const zt = n % 3 === 0 ? c(logBetween(rnd, 5, 300), between(rnd, -100, 100)) : Z50;
    const res = match.synthesize('L', { zl, zt, f });
    verify(res, zl, zt, f, `L #${n}`);
    ok(res.solutions.length === 2 || res.solutions.length === 4, `L #${n}: ${res.solutions.length} solutions`);
    res.solutions.forEach((s) => ok(s.elements.length <= 2, 'an L network has at most two elements'));
  }
});
test('L network: 2 solutions inside the circle r = 1 or g = 1, 4 elsewhere', () => {
  const count = (zl) => match.synthesize('L', { zl, zt: Z50, f: 1e9 }).solutions.length;
  same(count(c(100, -50)), 2);     // r > 1: inside the circle r = 1
  same(count(c(10, 7)), 2);        // g > 1: inside the circle g = 1
  same(count(c(20, 60)), 4);       // outside both circles
  same(count(c(20, -60)), 4);
  const already = match.synthesize('L', { zl: Z50, zt: Z50, f: 1e9 });
  same(already.solutions.length, 0);
  ok(/Already matched/.test(already.reason), 'already matched load not reported');
  same(match.synthesize('L', { zl: c(0, 0), zt: Z50, f: 1e9 }).solutions.length, 0);
  same(match.synthesize('L', { zl: c(Infinity, 0), zt: Z50, f: 1e9 }).solutions.length, 0);
});
test('L network: finds Dellsperger examples 1 and 4 (within 3 %)', () => {
  const has = (res, a, b) => res.solutions.some((s) => s.elements.length === 2 && a(s.elements[0]) && b(s.elements[1]));
  const near = (v, ref) => Math.abs(v / ref - 1) < 0.03;
  // ex. 1, high-pass: series C 39.2 pF then shunt L 26.6 nH
  const ex1 = match.synthesize('L', { zl: c(10, 7), zt: Z50, f: 150e6 });
  ok(has(ex1, (e) => e.kind === 'C' && e.conn === 'series' && near(e.value, 39.2e-12), (e) => e.kind === 'L' && e.conn === 'shunt' && near(e.value, 26.6e-9)), 'solution of example 1 missing');
  // ex. 4, low-pass: shunt C 1.9 pF then series L 19.4 nH
  const ex4 = match.synthesize('L', { zl: c(100, -50), zt: Z50, f: 500e6 });
  ok(has(ex4, (e) => e.kind === 'C' && e.conn === 'shunt' && near(e.value, 1.9e-12), (e) => e.kind === 'L' && e.conn === 'series' && near(e.value, 19.4e-9)), 'solution of example 4 missing');
  same(match.character(ex4.solutions.find((s) => s.elements[0].kind === 'C').elements), 'lowpass');
});
test('π and T networks: they match, and the node Q equals the requested Q', () => {
  const rnd = prng(31);
  for (let n = 0; n < 120; n += 1) {
    const f = logBetween(rnd, 50e6, 3e9);
    const zl = c(logBetween(rnd, 5, 500), n % 2 ? between(rnd, -150, 150) : 0);
    const zt = n % 5 === 0 ? c(logBetween(rnd, 10, 200), between(rnd, -40, 40)) : Z50;
    for (const family of ['pi', 'T']) {
      const probe = match.synthesize(family, { zl, zt, f, q: 0.01 });
      same(probe.solutions.length, 0);
      ok(probe.qMin >= 0, `${family}: minimum Q missing`);
      const q = probe.qMin + between(rnd, 0.3, 8);
      const res = match.synthesize(family, { zl, zt, f, q });
      verify(res, zl, zt, f, `${family} #${n}`, 1e-6);
      same(res.solutions.length, 2);
      for (const s of res.solutions) {
        same(s.elements.length, 3);
        ok(family === 'pi' ? s.elements[0].conn === 'shunt' && s.elements[1].conn === 'series' : s.elements[0].conn === 'series' && s.elements[1].conn === 'shunt', `${family}: wrong topology`);
        close(match.assess(project(50, f, zl), s.elements, { zt }).qMax, q, 1e-6, `${family} #${n}: node Q`);
      }
    }
  }
});
test('π and T: minimum Q = that of the L network', () => {
  const pi = match.synthesize('pi', { zl: c(200, 0), zt: Z50, f: 1e9, q: 1 });
  same(pi.solutions.length, 0);
  close(pi.qMin, Math.sqrt(3), EXACT);
  ok(/Q too low/.test(pi.reason), 'reason missing');
  close(match.synthesize('T', { zl: c(5, 0), zt: Z50, f: 1e9, q: 1 }).qMin, 3, EXACT);
  // low-pass and high-pass
  const kinds = match.synthesize('pi', { zl: c(200, 0), zt: Z50, f: 1e9, q: 4 }).solutions.map((s) => match.character(s.elements)).sort();
  same(kinds.join(), 'highpass,lowpass');
});
test('single stub: 4 solutions, including those of Dellsperger examples 9 and 10', () => {
  const f = 430e6;
  const zl = c(30, -40);
  const res = match.synthesize('stub', { zl, zt: Z50, f, zcLine: 50, zcStub: 50 });
  verify(res, zl, Z50, f, 'stub');
  same(res.solutions.length, 4);
  const pick = (term, line, stub) => res.solutions.some((s) => s.elements[1].term === term && Math.abs(s.elements[0].deg - line) < 1.5 && Math.abs(s.elements[1].deg - stub) < 1.5);
  ok(pick('open', 0.208 * 360, 0.138 * 360), 'example 9 (0.208 λ then open stub 0.138 λ) missing');
  ok(pick('short', 0.208 * 360, 0.388 * 360), 'example 10 (shorted stub 0.388 λ) missing');
  // Line of arbitrary impedance: the load describes a circle |Γ| = ρ on the line's chart.
  // It crosses the target conductance circle (g' = Gt·Zc) if and only if ρ ≥ |1 − g'| / (1 + g').
  const rnd = prng(5);
  let none = 0;
  for (let n = 0; n < 200; n += 1) {
    const z = c(logBetween(rnd, 3, 600), between(rnd, -300, 300));
    const zt = n % 4 === 0 ? c(between(rnd, 20, 120), between(rnd, -30, 30)) : Z50;
    const zcLine = n % 3 === 0 ? 50 : between(rnd, 30, 100);
    const res = match.synthesize('stub', { zl: z, zt, f, zcLine, zcStub: between(rnd, 30, 100) });
    const gn = cinv(zt).re * zcLine;
    const rho = Math.hypot(...Object.values(cdiv(csub(z, c(zcLine)), cadd(z, c(zcLine)))));
    const reachable = rho >= Math.abs(1 - gn) / (1 + gn);
    if (reachable) { verify(res, z, zt, f, `stub #${n}`); same(res.solutions.length, 4); }
    else { none += 1; same(res.solutions.length, 0); ok(/No line length/.test(res.reason), 'absence of solution not explained'); }
  }
  ok(none >= 1, 'the no-solution case was not exercised');
  // no-solution case built on purpose: 70 Ω behind a 75 Ω line, target 50 Ω (ρ = 0.034 < 0.2)
  const far = match.synthesize('stub', { zl: c(70, 0), zt: Z50, f, zcLine: 75, zcStub: 50 });
  same(far.solutions.length, 0);
  ok(/No line length/.test(far.reason), 'absence of solution not explained');
});
test('double stub: solutions of example 11, forbidden region reported', () => {
  const f = 430e6;
  const spacing = 80e-3 / (LIGHT / f) * 360;                  // 80 mm in air
  const zl = c(30, -40);
  const res = match.synthesize('stub2', { zl, zt: Z50, f, zcLine: 50, zcStub: 50, spacing });
  verify(res, zl, Z50, f, 'double stub');
  same(res.solutions.length, 4);
  res.solutions.forEach((s) => { same(s.elements.length, 3); close(s.elements[1].deg, spacing, EXACT); });
  // λ/8 spacing: forbidden as soon as g > 1/sin²(45°) = 2
  const blocked = match.synthesize('stub2', { zl: c(10, 0), zt: Z50, f, zcLine: 50, zcStub: 50, spacing: 45 });
  same(blocked.solutions.length, 0);
  ok(/Forbidden region/.test(blocked.reason), 'forbidden region not reported');
  verify(match.synthesize('stub2', { zl: c(30, 0), zt: Z50, f, zcLine: 50, zcStub: 50, spacing: 45 }), c(30, 0), Z50, f, 'g = 1.67 < 2');
});
test('quarter-wave transformer, single line, line + reactance', () => {
  const f = 2.4e9;
  const real = match.synthesize('quarter', { zl: c(100, 0), zt: Z50, f, zcLine: 50 });
  same(real.solutions.length, 1);
  close(real.solutions[0].elements[0].zc, Math.sqrt(5000), EXACT); same(real.solutions[0].elements[0].deg, 90);
  verify(real, c(100, 0), Z50, f, 'real λ/4');
  const zl = c(30, 20);
  const res = match.synthesize('quarter', { zl, zt: Z50, f, zcLine: 50 });
  verify(res, zl, Z50, f, 'complex λ/4');
  same(res.solutions.filter((s) => s.type === 'quarter').length, 2);
  const single = res.solutions.find((s) => s.type === 'line');
  ok(single && single.elements.length === 1, 'single line missing');
  close(single.elements[0].zc, Math.sqrt(500), 1e-9);          // Zc² = 50·30 − 50·20²/(50 − 30)
  ok(/real target/.test(match.synthesize('quarter', { zl, zt: c(50, 10), f, zcLine: 50 }).reason), 'complex target wrongly accepted');
  const both = match.synthesize('line', { zl: c(10, -12), zt: Z50, f, zcLine: 50 });
  verify(both, c(10, -12), Z50, f, 'line + reactance');
  same(both.solutions.filter((s) => s.type === 'line+shunt').length, 2);
  same(both.solutions.filter((s) => s.type === 'line+series').length, 2);
});
test('bandwidth: edges at the requested limit, a higher Q narrows the band', () => {
  const f = 1e9;
  const p = project(50, f, c(10, 0));
  const lNet = match.synthesize('L', { zl: c(10, 0), zt: Z50, f }).solutions;
  same(lNet.length, 2);
  const limit = 10 ** (-10 / 20);
  for (const s of lNet) {
    const a = match.assess(p, s.elements, { rlMin: 10 });
    ok(a.error < 1e-9, 'network not matched at f0');
    ok(a.fLow < f && a.fHigh > f && a.bw > 0, 'empty band');
    for (const edge of [a.fLow, a.fHigh]) close(net.inputAt({ ...p, elements: s.elements }, edge).mag, limit, 1e-6, 'band edge');
    close(a.qMax, 2, EXACT, 'Q of the L network: sqrt(50/10 − 1)');
  }
  const bwL = Math.max(...lNet.map((s) => match.assess(p, s.elements).fbw));
  const bwPi = Math.max(...match.synthesize('pi', { zl: c(10, 0), zt: Z50, f, q: 10 }).solutions.map((s) => match.assess(p, s.elements).fbw));
  ok(bwPi < bwL / 2, `π at Q = 10: band ${bwPi} not reduced against the L (${bwL})`);
  // stricter threshold, narrower band
  ok(match.assess(p, lNet[0].elements, { rlMin: 20 }).bw < match.assess(p, lNet[0].elements, { rlMin: 10 }).bw, '20 dB threshold');
  // transparent network: no cut-off within the explored range
  const flat = match.assess(project(50, f, Z50), [TL(50, 30, f)]);
  ok(flat.openLow && flat.openHigh, 'open band not reported');
  same(match.character([TL(50, 30, f)]), 'lines');
});

/* ========================================================================== */
group('13. Standard series');

test('E12, E24, E96 series', () => {
  same(eseries.values('E12').join(), '1,1.2,1.5,1.8,2.2,2.7,3.3,3.9,4.7,5.6,6.8,8.2');
  same(eseries.values('E24').length, 24);
  const e96 = eseries.values('E96');
  same(e96.length, 96);
  same(e96.slice(0, 12).join(), '1,1.02,1.05,1.07,1.1,1.13,1.15,1.18,1.21,1.24,1.27,1.3');
  same(e96.slice(-4).join(), '9.09,9.31,9.53,9.76');
  for (const v of [4.99, 1.5, 2.21, 3.32, 6.81, 8.25]) ok(e96.includes(v), `${v} missing from E96`);
  for (const v of eseries.values('E12')) ok(eseries.values('E24').includes(v), `${v} of E12 missing from E24`);
});
test('rounding to the nearest value, as a ratio', () => {
  close(eseries.snap(6.6e-12, 'E12'), 6.8e-12, EXACT);
  close(eseries.snap(9.6e-9, 'E12'), 10e-9, EXACT);            // moves to the next decade
  close(eseries.snap(39.3e-12, 'E24'), 39e-12, EXACT);
  close(eseries.snap(26.5e-9, 'E24'), 27e-9, EXACT);
  close(eseries.snap(19.4e-9, 'E96'), 19.6e-9, EXACT);
  const mid = Math.sqrt(1.0 * 1.2);                           // geometric midpoint
  close(eseries.snap(mid * 0.999, 'E12'), 1.0, EXACT); close(eseries.snap(mid * 1.001, 'E12'), 1.2, EXACT);
  same(eseries.snap(0, 'E12'), 0); same(eseries.snap(Infinity, 'E12'), Infinity);
  for (const s of ['E12', 'E24', 'E96']) for (const v of eseries.values(s)) close(eseries.snap(v * 1e-9, s), v * 1e-9, EXACT);
});
test('network rounding: R, L, C and R-L-C touched, lines untouched', () => {
  const elements = [C('series', 39.3e-12), L('shunt', 26.5e-9), TL(51.3, 44.2, 1e9), R('series', 47), { kind: 'RLC', conn: 'shunt', topology: 'series', r: 31, l: null, c: 5.4e-12 }];
  const { elements: out, changes } = eseries.snapElements(elements, 'E12');
  close(out[0].value, 39e-12, EXACT); close(out[1].value, 27e-9, EXACT);
  same(out[2].zc, 51.3); same(out[2].deg, 44.2);
  same(out[3].value, 47); close(out[4].r, 33, EXACT); same(out[4].l, null); close(out[4].c, 5.6e-12, EXACT);
  same(changes.length, 4);
  same(elements[0].value, 39.3e-12);                          // the original is not modified
});

/* ========================================================================== */
group('14. Touchstone and impedance tables');

/** S parameters of a two-port from its ABCD matrix (independent reference). */
const abcdToS = (m, z0) => {
  const [A, B, Cc, D] = m;
  const bz = cscale(B, 1 / z0);
  const cz = cscale(Cc, z0);
  const den = cadd(cadd(A, bz), cadd(cz, D));
  return {
    s11: cdiv(csub(cadd(A, bz), cadd(cz, D)), den),
    s12: cdiv(cscale(csub(cmul(A, D), cmul(B, Cc)), 2), den),
    s21: cdiv(c(2), den),
    s22: cdiv(cadd(csub(bz, A), csub(D, cz)), den),
  };
};
/** Zin of a two-port given by S parameters, through its ABCD matrix (independent reference). */
const sToZin = (s, z0, zl) => {
  const two = cscale(s.s21, 2);
  const A = cdiv(cadd(cmul(cadd(c(1), s.s11), csub(c(1), s.s22)), cmul(s.s12, s.s21)), two);
  const B = cscale(cdiv(csub(cmul(cadd(c(1), s.s11), cadd(c(1), s.s22)), cmul(s.s12, s.s21)), two), z0);
  const Cc = cscale(cdiv(csub(cmul(csub(c(1), s.s11), csub(c(1), s.s22)), cmul(s.s12, s.s21)), two), 1 / z0);
  const D = cdiv(cadd(cmul(csub(c(1), s.s11), cadd(c(1), s.s22)), cmul(s.s12, s.s21)), two);
  return mZin([A, B, Cc, D], zl);
};
const twoPortFreqs = [400e6, 700e6, 1e9, 1.6e9, 2.5e9];
/** Port 1 — series 10 nH — shunt 3 pF — port 2. */
const twoPort = (f, z0) => abcdToS(mMul(mSeries(zInd(f, 10e-9)), mShunt(zCap(f, 3e-12))), z0);
const fmtPair = (z, format) => {
  if (format === 'RI') return `${z.re} ${z.im}`;
  const mag = Math.hypot(z.re, z.im);
  return `${format === 'DB' ? 20 * Math.log10(mag) : mag} ${Math.atan2(z.im, z.re) * 180 / Math.PI}`;
};
const s2pText = (format, unitName, unit, z0) => [
  '! test file', `# ${unitName} S ${format} R ${z0}`, '! f  S11  S21  S12  S22',
  ...twoPortFreqs.map((f) => { const s = twoPort(f, z0); return `${f / unit} ${fmtPair(s.s11, format)} ${fmtPair(s.s21, format)} ${fmtPair(s.s12, format)} ${fmtPair(s.s22, format)}  ! comment`; }),
].join('\r\n');

test('.s2p in MA, DB and RI, all units, reference 50 or 75 Ω', () => {
  for (const [format, unitName, unit, z0] of [['MA', 'GHz', 1e9, 50], ['DB', 'mhz', 1e6, 50], ['RI', 'Hz', 1, 75], ['ma', 'kHz', 1e3, 50]]) {
    const ts = io.parseTouchstone(s2pText(format.toUpperCase(), unitName, unit, z0));
    same(ts.ports, 2); same(ts.z0, z0); same(ts.points.length, twoPortFreqs.length);
    ts.points.forEach((pt, k) => {
      close(pt.f, twoPortFreqs[k], 1e-12);
      const s = twoPort(twoPortFreqs[k], z0);
      for (const key of ['s11', 's21', 's12', 's22']) close(pt.s[key], s[key], 1e-9, `${format} ${key}`);
    });
  }
});
test('loaded .s2p: formula S11 + S12·S21·ΓL/(1 − S22·ΓL), ABCD matrix and engine', () => {
  const ts = io.parseTouchstone(s2pText('MA', 'GHz', 1e9, 50));
  const zLoad = c(20, 35);
  const table = io.touchstoneToTable(ts, { port: 1, zOther: zLoad });
  table.forEach((pt, k) => {
    const f = twoPortFreqs[k];
    close(pt.z, sToZin(ts.points[k].s, 50, zLoad), 1e-9, 'ABCD');
    close(pt.z, zin(project(50, f, zLoad, [C('shunt', 3e-12), L('series', 10e-9)]), f), 1e-9, 'engine');
  });
  // port 2 closed on Z0: Γin = S11; seen from port 2: S22
  io.touchstoneToTable(ts).forEach((pt, k) => close(rf.zToGamma(pt.z, 50), ts.points[k].s.s11, 1e-9));
  io.touchstoneToTable(ts, { port: 2 }).forEach((pt, k) => close(rf.zToGamma(pt.z, 50), ts.points[k].s.s22, 1e-9));
  const back = io.touchstoneToTable(ts, { port: 2, zOther: zLoad });
  close(back[2].z, zin(project(50, 1e9, zLoad, [L('series', 10e-9), C('shunt', 3e-12)]), 1e9), 1e-9, 'seen from port 2');
});
test('.s1p: S, Z and Y parameters; default values; noise in a .s2p', () => {
  const s1 = io.parseTouchstone('# MHz S MA R 50\n100 0.5 90\n200 0.25 -45\n');
  same(s1.ports, 1); close(s1.points[0].s, c(0, 0.5), 1e-12);
  close(io.touchstoneToTable(s1)[0].z, rf.gammaToZ(c(0, 0.5), 50), EXACT);
  const zf = io.parseTouchstone('# Hz Z RI R 50\n1e9 0.6 0.8\n');           // Z normalised to R
  close(io.touchstoneToTable(zf)[0].z, c(30, 40), 1e-12);
  const yf = io.parseTouchstone('# Hz Y RI R 50\n1e9 1.2 -0.4\n');
  close(io.touchstoneToTable(yf)[0].z, cscale(cinv(c(1.2, -0.4)), 50), 1e-12);
  const bare = io.parseTouchstone('1.5 0.3 10\n');                          // no options line: GHz S MA R 50
  close(bare.points[0].f, 1.5e9, EXACT); same(bare.z0, 50);
  const noisy = io.parseTouchstone(`${s2pText('MA', 'GHz', 1e9, 50)}\n! NOISE\n0.9 1.60 0.63 26 0.98\n1.8 1.90 0.52 51 0.72\n`);
  same(noisy.points.length, 5); same(noisy.noise.length, 2);
  close(noisy.noise[0].f, 0.9e9, EXACT); same(noisy.noise[0].nfmin, 1.6); same(noisy.noise[1].rn, 0.72);
  close(K.abs(noisy.noise[1].gopt), 0.52, 1e-12);
});
test('files rejected with a clear message', () => {
  const refused = (text, pattern) => {
    let message = '';
    try { io.parseTouchstone(text); } catch (err) { message = err.message; }
    ok(pattern.test(message), `unexpected message: "${message}"`);
  };
  refused('[Version] 2.0\n# GHz S MA R 50\n', /2\.0/);
  refused('# GHz S MA R 50\n1 0.1 0 0.2 0 0.3 0\n', /1-port and 2-port/);
  refused('# GHz H MA R 50\n1 0.1 0 0.2 0 0.3 0 0.4 0\n', /not supported/);
  refused('# GHz S MA R 50\n1 abc 0\n', /Unreadable/);
  refused('! nothing\n', /No data/);
});
test('"frequency, R, X" tables: EZNEC, unit header, bare values', () => {
  const eznec = '"EZNEC+ ver. 5.0"\n"Vert13m h=2,5m 4xRad6m Hut4x7m","10.09.2008 12:48:36"\n"Alt Z0: ",75\n"Freq MHz","Src #","R","X","SWR (50 ohms)","SWR (alt. Z0)"\n3.4,1,30.0344,-104.4704,9.427082,7.611355\n3.45,1,31.09572,-87.45639,7.006533,5.937705\n';
  const a = io.parseImpedanceTable(eznec);
  same(a.points.length, 2); close(a.points[0].f, 3.4e6, EXACT); close(a.points[0].z, c(30.0344, -104.4704), EXACT);
  const b = io.parseImpedanceTable('f (GHz); R; X\n1.9; 42; -13\n1.7; 38; -21\n');
  close(b.points[0].f, 1.7e9, EXACT); close(b.points[1].z, c(42, -13), EXACT);      // sorted by frequency
  close(io.parseImpedanceTable('869e6\t2\t10\n').points[0].f, 869e6, EXACT);          // value ≥ 1e5: hertz
  close(io.parseImpedanceTable('140 100.8 24.2\n145 106.9 41.7\n').points[1].f, 145e6, EXACT);   // no unit: MHz
  let message = '';
  try { io.parseImpedanceTable('hello\n'); } catch (err) { message = err.message; }
  ok(/No "frequency, R, X" line/.test(message), 'empty table accepted');
});

/* ========================================================================== */
group('15. Netlists');

/** Small AC circuit solver (modified nodal analysis) for the element types the
 *  LTspice export writes: R, L, C (with Rser), T, V, E, F. Independent of the engine. */
const solveCir = (text, f) => {
  const nodeIds = new Map([['0', -1]]);
  const id = (n) => { if (!nodeIds.has(n)) nodeIds.set(n, nodeIds.size - 1); return nodeIds.get(n); };
  const parts = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line[0] === '*' || line[0] === '.') continue;
    const tok = line.split(/\s+/);
    const opt = Object.fromEntries(tok.filter((t) => t.includes('=')).map((t) => { const [k, v] = t.split('='); return [k.toLowerCase(), Number(v)]; }));
    parts.push({ name: tok[0], type: tok[0][0].toUpperCase(), tok, opt });
    for (const n of tok.slice(1, tok[0][0].toUpperCase() === 'T' || tok[0][0].toUpperCase() === 'E' ? 5 : 3)) id(n);
  }
  const branches = parts.filter((p) => p.type === 'V' || p.type === 'E');
  const N = nodeIds.size - 1;
  const size = N + branches.length;
  const M = Array.from({ length: size }, () => Array.from({ length: size + 1 }, () => c(0)));
  const stamp = (r, col, v) => { if (r >= 0 && col >= 0) M[r][col] = cadd(M[r][col], v); };
  const admit = (a, b, y) => { stamp(a, a, y); stamp(b, b, y); stamp(a, b, cscale(y, -1)); stamp(b, a, cscale(y, -1)); };
  const omega = 2 * Math.PI * f;
  for (const p of parts) {
    const t = p.tok;
    if (p.type === 'R') admit(id(t[1]), id(t[2]), c(1 / Number(t[3])));
    else if (p.type === 'L') admit(id(t[1]), id(t[2]), cinv(c(p.opt.rser || 0, omega * Number(t[3]))));
    else if (p.type === 'C') admit(id(t[1]), id(t[2]), cinv(c(p.opt.rser || 0, -1 / (omega * Number(t[3])))));
    else if (p.type === 'T') {
      ok(t[2] === '0' && t[4] === '0', 'line without return to ground');
      const theta = omega * p.opt.td;
      const y11 = cinv(c(0, p.opt.z0 * Math.tan(theta)));
      const y12 = cscale(cinv(c(0, p.opt.z0 * Math.sin(theta))), -1);
      const a = id(t[1]); const b = id(t[3]);
      stamp(a, a, y11); stamp(b, b, y11); stamp(a, b, y12); stamp(b, a, y12);
    }
  }
  branches.forEach((p, k) => {
    const row = N + k;
    const a = id(p.tok[1]); const b = id(p.tok[2]);
    stamp(a, row, c(1)); stamp(b, row, c(-1));              // the branch current leaves a and enters b
    stamp(row, a, c(1)); stamp(row, b, c(-1));
    if (p.type === 'V') M[row][size] = c(p.tok.includes('AC') ? Number(p.tok[p.tok.indexOf('AC') + 1]) : Number(p.tok[3]));
    else { const gain = Number(p.tok[5]); stamp(row, id(p.tok[3]), c(-gain)); stamp(row, id(p.tok[4]), c(gain)); }
  });
  for (const p of parts.filter((q) => q.type === 'F')) {
    const col = N + branches.findIndex((b) => b.name === p.tok[3]);
    ok(col >= N, `control source ${p.tok[3]} not found`);
    const gain = Number(p.tok[4]);
    stamp(id(p.tok[1]), col, c(gain)); stamp(id(p.tok[2]), col, c(-gain));
  }
  for (let i = 0; i < size; i += 1) {                         // Gauss elimination with partial pivoting
    let piv = i;
    for (let r = i + 1; r < size; r += 1) if (Math.hypot(M[r][i].re, M[r][i].im) > Math.hypot(M[piv][i].re, M[piv][i].im)) piv = r;
    [M[i], M[piv]] = [M[piv], M[i]];
    for (let r = 0; r < size; r += 1) {
      if (r === i) continue;
      const k = cdiv(M[r][i], M[i][i]);
      for (let col = i; col <= size; col += 1) M[r][col] = csub(M[r][col], cmul(k, M[i][col]));
    }
  }
  const volt = (n) => (id(n) < 0 ? c(0) : cdiv(M[id(n)][size], M[id(n)][id(n)]));
  const rs = Number(parts.find((p) => p.name === 'Rs').tok[3]);
  return cdiv(volt('in'), cscale(csub(volt('src'), volt('in')), 1 / rs));       // Zin = V(in) / I(Rs)
};

test('LTspice netlist: re-read by an independent nodal solver, identical Zin', () => {
  const load = { kind: 'rlc', topology: 'series', r: 2, l: 92e-9, c: null };
  const elements = [
    C('shunt', 22e-12), L('series', 15e-9, { mode: 'q', q: 40, f: 869e6 }), C('shunt', 3.9e-12, { mode: 'esr', esr: 0.4 }),
    TL(62, 57, 869e6), STUB('open', 50, 33, 869e6), { kind: 'XFMR', n: 1.6 }, STUB('short', 75, 71, 869e6),
    { kind: 'RLC', conn: 'shunt', topology: 'series', r: 33, l: 22e-9, c: 18e-12 },
    { kind: 'RLC', conn: 'series', topology: 'parallel', r: 330, l: 12e-9, c: 4.7e-12 },
    { ...R('shunt', 10), off: true }, C('series', 6.8e-12),
  ];
  const p = { ...project(50, 869e6, load, elements), sweep: { on: true, start: 700e6, stop: 1e9, points: 101, scale: 'lin' } };
  const cir = io.toCir(p);
  ok(/^\.ac lin 101 700000000 1000000000$/m.test(cir), '.ac directive missing');
  ok(/\.end\s*$/.test(cir), '.end missing');
  ok(!/[^\x00-\x7f]/.test(cir), 'non-ASCII character in the netlist');
  for (const f of [700e6, 869e6, 1.1e9]) close(solveCir(cir, f), zin(p, f), 1e-7, `Zin at ${f} Hz`);
});
test('LTspice netlist: fixed load = series equivalent at f0, open or shorted', () => {
  const p = project(50, 869e6, c(2, 10), ladder);
  close(solveCir(io.toCir(p), 869e6), c(88.740, -115.544), TOL);
  close(solveCir(io.toCir(project(50, 1e9, c(30, -40), [L('series', 5e-9)])), 1e9), zin(project(50, 1e9, c(30, -40), [L('series', 5e-9)])), 1e-9);
  close(solveCir(io.toCir(project(50, 1e9, OPEN, [C('shunt', 2e-12), L('series', 5e-9)])), 1e9), zin(project(50, 1e9, OPEN, [C('shunt', 2e-12), L('series', 5e-9)])), 1e-6);
  ok(/\.ac lin 201/.test(io.toCir(p)), 'default sweep missing');
});
test('LTspice netlist: lossy line in a consistent LTRA model', () => {
  const line = TL(60, 200, 500e6, { er: 2.5, alpha: 2 });
  const cir = io.toCir(project(50, 500e6, c(50, 0), [line]));
  const m = /LTRA\(len=(\S+) R=(\S+) L=(\S+) C=(\S+)\)/.exec(cir);
  ok(m, 'LTRA model missing');
  const [len, r, l, cap] = m.slice(1).map(Number);
  close(len, rf.lineLengths(line).phys, 1e-8);
  close(Math.sqrt(l / cap), 60, 1e-8);                                  // Zc
  close(1 / Math.sqrt(l * cap), LIGHT / Math.sqrt(2.5), 1e-8);          // phase velocity
  close(r / (2 * 60), 2 * NEPER, 1e-8);                                 // alpha = R / (2·Zc), in Np/m
});
test('Smith-format netlist (.ckt): re-read, identical Zin', () => {
  const elements = [C('shunt', 22e-12), L('series', 15e-9), TL(62, 57, 869e6, { er: 2.2 }), STUB('open', 50, 33, 869e6), STUB('short', 75, 71, 869e6), R('series', 4.7), { kind: 'RLC', conn: 'shunt', topology: 'series', r: 33, l: 22e-9, c: 18e-12 }, { kind: 'RLC', conn: 'series', topology: 'parallel', r: 330, l: 12e-9, c: 4.7e-12 }, C('series', 6.8e-12)];
  const p = project(50, 869e6, c(2, 10), elements);
  const ckt = io.toCkt(p);
  const f = 869e6;
  let z = c(2, 10);
  let node = 1;
  for (const raw of ckt.split('\n')) {
    const t = raw.trim().split(/\s+/);
    const o = Object.fromEntries(t.filter((s) => s.includes('=')).map((s) => { const [k, v] = s.split('='); return [k, Number(v)]; }));
    let ze = null;
    if (t[0] === 'RES') ze = c(o.R);
    else if (t[0] === 'IND') ze = zInd(f, o.L * 1e-9);
    else if (t[0] === 'CAP') ze = zCap(f, o.C * 1e-12);
    else if (t[0] === 'SRLC') ze = cadd(c(o.R), cadd(zInd(f, o.L * 1e-9), zCap(f, o.C * 1e-12)));
    else if (t[0] === 'PRLC') ze = cinv(cadd(cinv(c(o.R)), cadd(cinv(zInd(f, o.L * 1e-9)), cinv(zCap(f, o.C * 1e-12)))));
    else if (t[0] === 'TLINP') {
      const theta = 2 * Math.PI * (o.L * 1e-3) / (LIGHT / f);            // electrical length in mm
      if (t[2] === '99') ze = c(0, -o.Z / Math.tan(theta));              // open stub
      else if (t[2] === '0') ze = c(0, o.Z * Math.tan(theta));           // shorted stub
      else { same(Number(t[1]), node); z = lineZin(z, o.Z, 0, theta); node += 1; continue; }
    } else if (t[0] === 'DEF2P') { same(Number(t[2]), node); continue; } else continue;
    same(Number(t[1]), node);
    if (t[2] === '0' || t[2] === '99') z = parZ(z, ze); else { z = serZ(z, ze); node += 1; }
  }
  close(z, zin(p), 1e-7);
  ok(/^DIM FREQ=1e6 RES=1e0 IND=1e-9 CAP=1e-12 LNG=1e-3$/m.test(ckt) && /^FIXED 869$/m.test(ckt), 'header or frequency missing');
});

/* ========================================================================== */
group('16. Project and shareable link');

const fullProject = () => ({
  ...project(50, 869e6, { kind: 'rlc', topology: 'series', r: 2, l: 92e-9, c: null }, [...ladder, TL(50, 45, 869e6, { er: 1, alpha: 0, alphaLaw: 'sqrt' })]),
  markers: [{ label: 'z = 1.2 − j1.4 “µ ß” Ω', z: c(60, -70) }],
  circles: { vswr: [2], q: [1, 3] },
  sweep: { on: true, start: 700e6, stop: 1e9, points: 201, scale: 'lin' },
});

test('project file: lossless round trip', () => {
  const p = fullProject();
  const back = io.importProject(io.exportProject(p));
  same(io.stringify(back), io.stringify(io.normalizeProject(p)));
  close(net.inputAt(back).z, net.inputAt(p).z, EXACT);
  same(back.markers[0].label, 'z = 1.2 − j1.4 “µ ß” Ω');
  const open = io.importProject(io.exportProject({ ...p, load: { kind: 'z', z: OPEN } }));
  same(open.load.z.re, Infinity);
});
test('project file: doubtful content cleaned, foreign content rejected', () => {
  const messy = io.normalizeProject({
    z0: -5, f0: 'abc', load: { kind: 'z', z: { re: 'x', im: 0 } },
    elements: [{ kind: 'C', conn: 'bogus', value: 1e-12 }, { kind: 'EVIL', run: 'alert(1)' }, null, { kind: 'TL', zc: -1, deg: NaN, fref: 0, er: 0.2, alpha: -3 }, { kind: 'L', value: 1e-9, loss: { mode: 'q', q: -1, f: 0 }, extra: '<script>' }],
    markers: [{ label: { toString: () => 'x'.repeat(500) }, z: c(1, 2) }, { label: 'no z' }],
    circles: { vswr: [0.5, 2, 'a', Infinity], q: [-1, 3] },
    sweep: { on: 1, start: 9e9, stop: 1e9, points: 1e9, scale: 'cubic' },
  });
  same(messy.z0, 50); same(messy.f0, 1e9);
  same(io.stringify(messy.load), io.stringify({ kind: 'z', z: c(50, 0) }));
  same(messy.elements.length, 3);
  same(messy.elements[0].conn, 'series');
  same(io.stringify(messy.elements[1]), io.stringify({ kind: 'TL', zc: 50, deg: 45, fref: 1e9, er: 1, alpha: 0, alphaLaw: 'sqrt' }));
  same(Object.keys(messy.elements[2]).join(), 'kind,conn,value,loss');
  same(messy.elements[2].loss.q, 100);
  same(messy.markers.length, 1); same(messy.markers[0].label.length, 60);
  same(messy.circles.vswr.join(), '2'); same(messy.circles.q.join(), '3');
  same(messy.sweep.start, 1e9); same(messy.sweep.stop, 9e9); same(messy.sweep.points, 2001); same(messy.sweep.scale, 'lin'); same(messy.sweep.on, true);
  net.solve(messy).forEach((m) => noNaN(m));
  for (const bad of ['[1, 2]', '"text"', 'null', '{not json']) {
    let message = '';
    try { io.importProject(bad); } catch (err) { message = err.message; }
    ok(message.length > 0, `content wrongly accepted: ${bad}`);
  }
});
test('link: round trip, URL-safe characters, damaged link rejected', () => {
  const p = fullProject();
  const link = io.encodeLink(p);
  ok(/^p1\.[A-Za-z0-9_-]+$/.test(link), 'unsafe characters in the link');
  same(io.stringify(io.decodeLink(link)), io.stringify(io.normalizeProject(p)));
  same(io.stringify(io.decodeLink(`#${link}`)), io.stringify(io.normalizeProject(p)));
  same(io.decodeLink(io.encodeLink({ ...p, load: { kind: 'z', z: OPEN } })).load.z.re, Infinity);
  for (const bad of ['', 'p1.', 'p2.abcd', `${link.slice(0, 40)}`, 'p1.@@@@']) {
    let message = '';
    try { io.decodeLink(bad); } catch (err) { message = err.message; }
    ok(/unreadable|project/i.test(message), `link wrongly accepted: "${bad}"`);
  }
});

/* ========================================================================== */
group('17. Amplifier: stability, gain, noise');

const { amp } = Core;
const polarC = (mag, deg) => c(mag * Math.cos(deg * Math.PI / 180), mag * Math.sin(deg * Math.PI / 180));
const mod2 = (z) => z.re * z.re + z.im * z.im;
const cconj = (z) => c(z.re, -z.im);
// reflection seen at one port when the other is closed on a reflection coefficient (independent reference)
const gammaIn = (s, gl) => cadd(s.s11, cdiv(cmul(cmul(s.s12, s.s21), gl), csub(c(1), cmul(s.s22, gl))));
const gammaOut = (s, gs) => cadd(s.s22, cdiv(cmul(cmul(s.s12, s.s21), gs), csub(c(1), cmul(s.s11, gs))));
const onCircle = (circle, deg) => c(circle.cx + circle.rad * Math.cos(deg * Math.PI / 180), circle.cy + circle.rad * Math.sin(deg * Math.PI / 180));
const randomDevice = (rnd) => ({
  s11: polarC(between(rnd, 0.05, 0.95), between(rnd, -180, 180)), s12: polarC(logBetween(rnd, 0.01, 0.3), between(rnd, -180, 180)),
  s21: polarC(logBetween(rnd, 0.5, 6), between(rnd, -180, 180)), s22: polarC(between(rnd, 0.05, 0.95), between(rnd, -180, 180)),
});
// BFG33G at 2 GHz, Dellsperger example 13
const BFG = { s11: polarC(0.121, -149), s12: polarC(0.108, 59.4), s21: polarC(3.756, 78.9), s22: polarC(0.41, -54.5) };
const BFG_NOISE = { nfmin: 3.6, gopt: polarC(0.42, 39.1), rn: 0.98 };

test('Dellsperger example 13 (BFG33G, 2 GHz): K, maximum gain, output for Zs = 50 + j30 Ω', () => {
  const fig = amp.figures(BFG);
  shown(fig.k, 1.17, 2, 'K');
  shown(fig.magDb, 12.94, 2, 'Gmax');
  same(fig.unconditional, true);
  const gs = rf.zToGamma(c(50, 30), 50);
  close(gs, c(0.083, 0.275), 4e-3, 'ΓS');
  const g2 = amp.powerGains(BFG, gs, c(0, 0)).gout;
  shown(g2.re, 0.136, 3, 'Re Γ2'); shown(g2.im, -0.392, 3, 'Im Γ2');
  close(g2, gammaOut(BFG, gs), EXACT);
  close(rf.gammaToZ(g2, 50), c(45.987, -43.54), TOL, 'Z2');
});
test('example 13: available gain ≈ 12 dB and NF ≈ 3.85 dB for Zs = 50 + j30 Ω (ADS values from the document)', () => {
  const gs = rf.zToGamma(c(50, 30), 50);
  const gl = cconj(gammaOut(BFG, gs));                       // output conjugate-matched
  const g = amp.powerGains(BFG, gs, gl);
  close(10 * Math.log10(g.ga), 12.005, 2e-3, 'available gain');
  close(g.gt, g.ga, EXACT, 'matched output: GT = GA');
  close(amp.noiseFigure(BFG_NOISE, gs), 3.852, 2e-3, 'noise figure');
});
test('stability circles: |Γ| = 1 at the other port, correct stable side', () => {
  const rnd = prng(1313);
  for (let n = 0; n < 200; n += 1) {
    const s = randomDevice(rnd);
    for (const plane of ['source', 'load']) {
      const circle = amp.stabilityCircle(s, plane);
      const seen = (g) => Math.hypot(...Object.values(plane === 'load' ? gammaIn(s, g) : gammaOut(s, g)));
      for (const a of [10, 100, 190, 280]) close(seen(onCircle(circle, a)), 1, 1e-8, `plane ${plane}`);
      const centreSeen = seen(c(circle.cx, circle.cy));
      if (Number.isFinite(centreSeen)) same(circle.stableInside, centreSeen < 1);
    }
  }
});
test('K > 1 and |Δ| < 1 is equivalent to μ > 1 (Edwards and Sinsky)', () => {
  const rnd = prng(77);
  let stable = 0;
  for (let n = 0; n < 500; n += 1) {
    const fig = amp.figures(randomDevice(rnd));
    same(fig.unconditional, fig.muLoad > 1);
    same(fig.muLoad > 1, fig.muSource > 1);
    if (fig.unconditional) stable += 1;
  }
  ok(stable > 20 && stable < 480, `unbalanced sample (${stable} stable)`);
});
test('gain circles: the gain computed on the circle is the requested gain', () => {
  const rnd = prng(2718);
  const devices = [BFG];
  while (devices.length < 60) { const s = randomDevice(rnd); if (amp.figures(s).unconditional) devices.push(s); }
  for (const s of devices) {
    const fig = amp.figures(s);
    for (const back of [0.3, 1, 3]) {
      const db = fig.magDb - back;
      const g = 10 ** (db / 10);
      const op = amp.gainCircle(s, 'operating', db);
      const av = amp.gainCircle(s, 'available', db);
      for (const a of [20, 140, 260]) {
        const gl = onCircle(op, a);
        close(mod2(s.s21) * (1 - mod2(gl)) / ((1 - mod2(gammaIn(s, gl))) * mod2(csub(c(1), cmul(s.s22, gl)))), g, 1e-8, 'operating gain');
        const gs = onCircle(av, a);
        close(mod2(s.s21) * (1 - mod2(gs)) / (mod2(csub(c(1), cmul(s.s11, gs))) * (1 - mod2(gammaOut(s, gs)))), g, 1e-8, 'available gain');
      }
    }
    same(amp.gainCircle(s, 'operating', fig.magDb + 0.5), null);
    close(amp.gainCircle(s, 'available', fig.magDb).rad, 0, 1e-5, 'at maximum gain the circle shrinks to a point');
    for (const [kind, sii] of [['unilateral-source', s.s11], ['unilateral-load', s.s22]]) {
      const maxDb = -10 * Math.log10(1 - mod2(sii));
      const circle = amp.gainCircle(s, kind, maxDb - 1);
      for (const a of [45, 200]) { const gm = onCircle(circle, a); close((1 - mod2(gm)) / mod2(csub(c(1), cmul(sii, gm))), 10 ** ((maxDb - 1) / 10), 1e-8, kind); }
      same(amp.gainCircle(s, kind, maxDb + 0.2), null);
    }
  }
});
test('simultaneous conjugate match: Γin = ΓS*, Γout = ΓL*, gain = MAG', () => {
  const rnd = prng(4);
  let done = 0;
  while (done < 60) {
    const s = done === 0 ? BFG : randomDevice(rnd);
    const fig = amp.figures(s);
    const m = amp.conjugateMatch(s);
    if (!fig.unconditional) { same(m, null); continue; }
    done += 1;
    ok(Math.hypot(m.gs.re, m.gs.im) < 1 && Math.hypot(m.gl.re, m.gl.im) < 1, 'termination outside the disc');
    close(gammaIn(s, m.gl), cconj(m.gs), 1e-7); close(gammaOut(s, m.gs), cconj(m.gl), 1e-7);
    const g = amp.powerGains(s, m.gs, m.gl);
    close(g.gt, fig.mag, 1e-7, 'GT = MAG'); close(g.ga, fig.mag, 1e-7); close(g.gp, fig.mag, 1e-7);
  }
});
test('noise figure circles', () => {
  const fmin = 10 ** (BFG_NOISE.nfmin / 10);
  for (const nf of [3.7, 3.8, 3.9, 4.0, 6]) {
    const circle = amp.noiseCircle(BFG_NOISE, nf);
    for (const a of [0, 95, 190, 300]) {
      const gs = onCircle(circle, a);
      const f = fmin + 4 * BFG_NOISE.rn * mod2(csub(gs, BFG_NOISE.gopt)) / ((1 - mod2(gs)) * mod2(cadd(c(1), BFG_NOISE.gopt)));
      close(10 * Math.log10(f), nf, 1e-9, `NF = ${nf} dB`);
      close(amp.noiseFigure(BFG_NOISE, gs), nf, 1e-9);
    }
  }
  const least = amp.noiseCircle(BFG_NOISE, 3.6);
  close(c(least.cx, least.cy), BFG_NOISE.gopt, EXACT); close(least.rad, 0, 1e-6);
  same(amp.noiseCircle(BFG_NOISE, 3.5), null);
  close(amp.noiseFigure(BFG_NOISE, BFG_NOISE.gopt), 3.6, EXACT);
});
test('S parameters interpolated from a .s2p, and saved in the project', () => {
  const ts = io.parseTouchstone(`${s2pText('MA', 'GHz', 1e9, 50)}\n0.9 1.60 0.63 26 0.98\n1.8 1.90 0.52 51 0.72\n`);
  const at = amp.deviceAt(ts, 850e6);
  const a = twoPort(700e6, 50);
  const b = twoPort(1e9, 50);
  close(at.s.s21, cadd(cscale(a.s21, 0.5), cscale(b.s21, 0.5)), 1e-9);
  close(amp.deviceAt(ts, 1e9).s.s11, b.s11, 1e-9);
  close(amp.deviceAt(ts, 9e9).s.s22, twoPort(2.5e9, 50).s22, 1e-9);          // frozen outside the range
  close(amp.deviceAt(ts, 1.35e9).noise.nfmin, 1.75, EXACT);
  same(amp.deviceAt(io.parseTouchstone(s2pText('MA', 'GHz', 1e9, 50)), 1e9).noise, null);
  const p = { ...fullProject(), amp: { s: BFG, noise: BFG_NOISE, stab: { source: true }, gains: [{ kind: 'available', db: 12 }, { kind: 'bogus', db: 1 }], nfs: [3.8, 'x'] } };
  const back = io.decodeLink(io.encodeLink(p)).amp;
  close(back.s.s21, BFG.s21, EXACT); close(back.noise.gopt, BFG_NOISE.gopt, EXACT);
  same(back.stab.source, true); same(back.stab.load, false); same(back.gains.length, 1); same(back.nfs.join(), '3.8');
  same(io.normalizeProject({ amp: { s: { s11: c(0, 0) } } }).amp, null);
  same(io.normalizeProject(fullProject()).amp, null);
});
test('per-frequency gain table of an .s2p: K, μ, MAG, MSG and return loss (independent forms)', () => {
  const rnd = prng(2026);
  const devices = [BFG];
  while (devices.length < 40) devices.push(randomDevice(rnd));
  const pm = (z) => `${Math.sqrt(mod2(z))} ${Math.atan2(z.im, z.re) * 180 / Math.PI}`;
  const text = ['# GHz S MA R 50', ...devices.map((s, i) => `${i + 1} ${pm(s.s11)} ${pm(s.s21)} ${pm(s.s12)} ${pm(s.s22)}`)].join('\n');
  const rows = amp.table(io.parseTouchstone(text));
  same(rows.length, devices.length);
  close(rows[0].k, 1.17, 5e-3, 'K of the BFG33G (ex. 13)');
  close(rows[0].magDb, 12.94, 2e-3, 'Gmax of the BFG33G (ex. 13)');
  let conditional = 0;
  rows.forEach((row, i) => {
    const s = devices[i];
    close(row.f, (i + 1) * 1e9, 1e-12);
    const m = (z) => Math.sqrt(mod2(z));
    const delta = csub(cmul(s.s11, s.s22), cmul(s.s12, s.s21));
    const k = (1 - mod2(s.s11) - mod2(s.s22) + mod2(delta)) / (2 * m(s.s12) * m(s.s21));
    close(row.k, k, 1e-9, 'K');
    close(row.msgDb, 10 * Math.log10(m(s.s21)) - 10 * Math.log10(m(s.s12)), 1e-9, 'MSG');   // power ratio |S21| / |S12|
    if (k >= 1) close(row.magDb, 10 * Math.log10(m(s.s21) / m(s.s12) / (k + Math.sqrt(k * k - 1))), 1e-9, 'MAG');
    else { same(row.magDb, null); conditional += 1; }
    close(row.s21Db, 20 * Math.log10(m(s.s21)), 1e-9); close(row.s12Db, 20 * Math.log10(m(s.s12)), 1e-9);
    close(row.rl11, -20 * Math.log10(m(s.s11)), 1e-9); close(row.rl22, -20 * Math.log10(m(s.s22)), 1e-9);
    // μ is the distance from the centre of the chart to the load-plane stability circle
    const circle = amp.stabilityCircle(s, 'load');
    close(row.mu, Math.abs(Math.hypot(circle.cx, circle.cy) - circle.rad) * (circle.stableInside === (Math.hypot(circle.cx, circle.cy) < circle.rad) ? 1 : -1), 1e-9, 'μ');
  });
  ok(conditional > 3 && conditional < 37, `unbalanced sample (${conditional} conditional)`);
});
test('circles CSV export: every row read back gives a circle with the announced property', () => {
  const p = { ...fullProject(), circles: { vswr: [2, 5], q: [0.5, 3] }, amp: { s: BFG, noise: BFG_NOISE, stab: { source: true, load: true }, gains: [{ kind: 'available', db: 11 }, { kind: 'operating', db: 12 }, { kind: 'unilateral-source', db: -0.01 }], nfs: [3.9] } };
  const lines = io.circlesCsv(p, ',').trim().split('\n');
  same(lines[0], 'type,value,plane,center_re,center_im,radius,note');
  const rows = lines.slice(1).map((line) => { const f = line.split(','); return { kind: f[0], value: Number(f[1]), plane: f[2], circle: { cx: Number(f[3]), cy: Number(f[4]), rad: Number(f[5]) }, note: f[6] }; });
  same(rows.length, 2 + 4 + 2 + 3 + 1);
  const zOf = (g) => cdiv(cadd(c(1), g), csub(c(1), g));
  for (const row of rows) {
    for (const deg of [20, 140, 255]) {
      const g = onCircle(row.circle, deg);
      const m = Math.sqrt(mod2(g));
      if (row.kind === 'VSWR') close((1 + m) / (1 - m), row.value, 1e-7, 'VSWR');
      else if (row.kind === 'Q') {
        if (m >= 1) continue;                                   // only the part of the arc inside the chart
        const z = zOf(g);
        if ((z.im > 0) === row.note.includes('> 0')) close(Math.abs(z.im) / z.re, row.value, 1e-6, 'Q');
      } else if (row.kind === 'stability') close(Math.sqrt(mod2(row.plane === 'source' ? gammaOut(BFG, g) : gammaIn(BFG, g))), 1, 1e-6, 'stability boundary');
      else if (row.kind === 'noise') close(amp.noiseFigure(BFG_NOISE, g), row.value, 1e-6, 'NF');
      else if (row.kind === 'gain available') close(10 * Math.log10(amp.powerGains(BFG, g, c(0, 0)).ga), row.value, 1e-6, 'GA');
      else if (row.kind === 'gain operating') close(10 * Math.log10(amp.powerGains(BFG, c(0, 0), g).gp), row.value, 1e-6, 'GP');
      else if (row.kind === 'gain unilateral-source') close(10 * Math.log10((1 - mod2(g)) / mod2(csub(c(1), cmul(BFG.s11, g)))), row.value, 1e-6, 'GS');
      else throw new Error(`unexpected type: ${row.kind}`);
    }
  }
  same(io.circlesCsv(fullProject()).trim().split('\n').length >= 1, true);
  same(io.circlesCsv({ ...fullProject(), circles: { vswr: [], q: [] }, amp: null }).trim(), 'type;value;plane;center_re;center_im;radius;note');
});
test('CITI file: same content as the equivalent .s2p, in MAGANGLE, DBANGLE and RI, with noise', () => {
  const ref = io.parseTouchstone(s2pText('RI', 'Hz', 1, 75));
  const block = (rows) => `BEGIN\r\n${rows.join('\r\n')}\r\nEND`;
  for (const fmt of ['MAGANGLE', 'DBANGLE', 'RI']) {
    const pair = (z) => fmtPair(z, fmt === 'MAGANGLE' ? 'MA' : fmt === 'DBANGLE' ? 'DB' : 'RI').replace(' ', ', ');
    const col = (key) => block(twoPortFreqs.map((f) => pair(twoPort(f, 75)[key])));
    const text = ['# Created for the tests', '', 'CITIFILE A.01.00', 'NAME DATA', `VAR freq MAG ${twoPortFreqs.length}`,
      `DATA S[1,1] ${fmt}`, `DATA S[1,2] ${fmt}`, `DATA S[2,1] ${fmt}`, `DATA S[2,2] ${fmt}`, 'DATA PortZ[1] MAGANGLE',
      'VAR_LIST_BEGIN', ...twoPortFreqs.map((f) => `   ${f}`), 'VAR_LIST_END',
      col('s11'), col('s12'), col('s21'), col('s22'), block(twoPortFreqs.map(() => '75, 0')),
      '', 'CITIFILE A.01.00', 'NAME OTHER', 'VAR freq MAG 1', 'DATA k MAG', 'VAR_LIST_BEGIN', '1', 'VAR_LIST_END', 'BEGIN', '9', 'END'].join('\r\n');
    const ts = io.parseCiti(text);
    same(ts.ports, 2); same(ts.z0, 75); same(ts.points.length, ref.points.length); same(ts.noise.length, 0);
    ts.points.forEach((pt, k) => {
      close(pt.f, ref.points[k].f, 1e-12);
      for (const key of ['s11', 's21', 's12', 's22']) close(pt.s[key], ref.points[k].s[key], 1e-9, `${fmt} ${key}`);
    });
  }
  // BFG33G : the first two frequencies of the CITI example shipped with Smith, against the manufacturer .s2p lines
  const bfg = io.parseCiti(['CITIFILE A.01.00', 'NAME SP1.SP', 'VAR freq MAG 2',
    'DATA S[1,1] MAGANGLE', 'DATA S[1,2] MAGANGLE', 'DATA S[2,1] MAGANGLE', 'DATA S[2,2] MAGANGLE', 'DATA PortZ[1] MAGANGLE', 'DATA Sopt MAGANGLE', 'DATA Rn MAG', 'DATA NFmin MAG',
    'VAR_LIST_BEGIN', '1e+008', '2e+008', 'VAR_LIST_END',
    'BEGIN', '0.813, -11.9', '0.752, -23.5', 'END', 'BEGIN', '0.012, 79.3', '0.022, 72', 'END',
    'BEGIN', '12.673, 164.5', '12.218, 151.5', 'END', 'BEGIN', '0.941, -11.5', '0.867, -21.3', 'END',
    'BEGIN', '50, 0', '50, 0', 'END', 'BEGIN', '0.528, 5.3', '0.528, 5.3', 'END', 'BEGIN', '59', '59', 'END', 'BEGIN', '3.1', '3.1', 'END'].join('\n'));
  const s2p = io.parseTouchstone('# MHz S MA R 50\n100 .813 -11.9 12.673 164.5 .012 79.3 .941 -11.5\n200 .752 -23.5 12.218 151.5 .022 72.0 .867 -21.3\n! Noise data:\n500 3.10 .528 5.30 1.18\n');
  bfg.points.forEach((pt, k) => { close(pt.f, s2p.points[k].f, 1e-12); for (const key of ['s11', 's21', 's12', 's22']) close(pt.s[key], s2p.points[k].s[key], 1e-12, key); });
  same(bfg.noise.length, 2);
  close(bfg.noise[0].nfmin, 3.1, EXACT); close(bfg.noise[0].gopt, s2p.noise[0].gopt, 1e-12); close(bfg.noise[0].rn, s2p.noise[0].rn, 1e-12, 'Rn in ohms scaled to rn');
  close(amp.table(bfg)[0].k, amp.table(s2p)[0].k, 1e-12);
  // one port, SEG_LIST, and errors
  const one = io.parseCiti('CITIFILE A.01.01\nNAME MEMORY\nVAR FREQ MAG 3\nDATA S[1,1] RI\nSEG_LIST_BEGIN\nSEG 1e9 2e9 3\nSEG_LIST_END\nBEGIN\n0.5,0\n0,0.5\n-0.25,0\nEND\n');
  same(one.ports, 1); same(one.z0, 50); close(one.points[1].f, 1.5e9, 1e-12); close(one.points[1].s, c(0, 0.5), EXACT);
  for (const [text, word] of [['# nothing', 'CITIFILE'], ['CITIFILE A.01.00\nDATA S[1,1] RI\nVAR_LIST_BEGIN\n1\n2\nVAR_LIST_END\nBEGIN\n1,0\nEND', 'frequencies'], ['CITIFILE A.01.00\nDATA S[2,1] RI\nVAR_LIST_BEGIN\n1\nVAR_LIST_END\nBEGIN\n1,0\nEND', 'S[1,1]']]) {
    let message = '';
    try { io.parseCiti(text); } catch (err) { message = err.message; }
    ok(message.includes(word), `expected a message containing "${word}", got "${message}"`);
  }
});
test('thinned polyline: faithful to half a pixel, bounded in size, and clipped outside the view', () => {
  // distance from a point to the drawn path, by walking its segments (independent of the generator)
  const segments = (d) => {
    const out = [];
    let cur = null;
    for (const m of d.matchAll(/([ML])(-?[\d.]+) (-?[\d.]+)/g)) {
      const p = { x: Number(m[2]), y: Number(m[3]) };
      if (m[1] === 'L' && cur) out.push([cur, p]);
      cur = p;
    }
    return out;
  };
  const distance = (p, segs) => Math.min(...segs.map(([a, b]) => {
    const dx = b.x - a.x; const dy = b.y - a.y;
    const len = dx * dx + dy * dy;
    const u = len ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len)) : 0;
    return Math.hypot(p.x - a.x - u * dx, p.y - a.y - u * dy);
  }));
  // 50 000 points on a spiral that fits in the chart
  const spiral = [];
  for (let i = 0; i < 50000; i += 1) { const u = i / 49999; spiral.push(c(0.9 * u * Math.cos(40 * u), 0.9 * u * Math.sin(40 * u))); }
  const d = Chart.polyD(view600, spiral);
  const segs = segments(d);
  ok(segs.length < 12000, `${segs.length} segments for a spiral about 5000 px long`);
  ok(segs.length > 2000, `only ${segs.length} segments: the curve would look angular`);
  for (let i = 0; i < spiral.length; i += 97) {
    const p = { x: 300 + spiral[i].re * 262, y: 300 - spiral[i].im * 262 };
    ok(distance(p, segs) < 0.9, `point ${i} at ${distance(p, segs).toFixed(2)} px from the path`);
  }
  const end = { x: 300 + spiral[49999].re * 262, y: 300 - spiral[49999].im * 262 };
  ok(distance(end, segs) < 0.02, 'the last end point must be drawn exactly');
  // strongly zoomed view: what lies outside is dropped, what is visible is kept
  const cross = 0.9 * (6 * Math.PI / 40);                                       // the spiral crosses the real axis here (third turn)
  const zoomed = Chart.makeView(600, 600, 20000, 300 - cross * 20000, 300);     // centred on that crossing
  const dz = Chart.polyD(zoomed, spiral);
  const segz = segments(dz);
  ok(segz.length > 0 && dz.length < d.length, 'the zoomed path must be shorter than the full path');
  let visible = 0;
  for (let i = 0; i < spiral.length; i += 1) {
    const p = { x: zoomed.ox + spiral[i].re * zoomed.k, y: zoomed.oy - spiral[i].im * zoomed.k };
    if (p.x < 0 || p.x > 600 || p.y < 0 || p.y > 600) continue;
    visible += 1;
    if (visible % 7 === 0) ok(distance(p, segz) < 0.9, `visible point ${i} at ${distance(p, segz).toFixed(2)} px from the zoomed path`);
  }
  ok(visible > 50, `too few visible points to conclude (${visible})`);
  for (const [a, b] of segz) ok(Math.max(Math.abs(a.x), Math.abs(a.y), Math.abs(b.x), Math.abs(b.y)) < 40000, 'segment far outside the view was kept');
  // a curve entirely outside the view gives nothing; breaks are still honoured
  same(Chart.polyD(zoomed, [c(-0.5, 0), c(-0.6, 0.1), c(-0.7, 0)]), '');
  same(Chart.polyD(view600, [c(0, 0), c(0.0001, 0), c(0.0002, 0)]), 'M300 300L300.05 300');
});
test('trajectory of an element pushed to an extreme value: no jump and no sharp angle', () => {
  // an element with a huge or tiny value travels to the edge of the chart: the path must stay a smooth curve
  let checked = 0;
  for (const load of [c(2, 10), c(50, 0), c(20, -30), c(150, 80)]) {
    for (const conn of ['series', 'shunt']) {
      for (const [kind, unit] of [['C', 1e-12], ['L', 1e-9], ['R', 1]]) {
        for (const v of [1e-6, 1e-3, 0.1, 1, 10, 1e3, 1e5, 1e9]) {
          const p = { ...fullProject(), z0: 50, f0: 869e6, load: { kind: 'z', z: load }, elements: [{ kind, conn, value: v * unit }] };
          const path = net.trajectory(p, 0).map((s) => s.gamma);
          const tag = `${conn} ${kind} ${v * unit} on ${load.re}+j${load.im}`;
          ok(path.length < 600, `${path.length} points: ${tag}`);
          close(path[path.length - 1], net.inputAt(p).gamma, 1e-9, `end of the path: ${tag}`);
          for (let i = 1; i < path.length; i += 1) {
            const a = path[i - 1]; const b = path[i];
            ok(Math.hypot(b.re - a.re, b.im - a.im) < 0.03, `jump of ${Math.hypot(b.re - a.re, b.im - a.im).toFixed(3)}: ${tag}`);
            if (i < 2) continue;
            const z = path[i - 2];
            const u = [a.re - z.re, a.im - z.im]; const w = [b.re - a.re, b.im - a.im];
            if (Math.hypot(...u) < 1e-6 || Math.hypot(...w) < 1e-6) continue;
            const turn = Math.abs(Math.atan2(u[0] * w[1] - u[1] * w[0], u[0] * w[0] + u[1] * w[1])) * 180 / Math.PI;
            ok(turn < 12, `angle of ${turn.toFixed(0)}°: ${tag}`);
          }
          checked += 1;
        }
      }
    }
  }
  same(checked, 4 * 2 * 3 * 8);
});
test('settings: defaults, valid fields kept, doubtful values discarded', () => {
  const d = io.normalizePrefs(null);
  same(JSON.stringify(d), JSON.stringify({ z0: 50, f0: 1e9, colors: { z: null, y: null, sweep: null, traj: null, ring: null }, widths: { grid: 1, traj: 1, ring: 1, sweep: 1 }, slider: 0, eseries: 'E24', mode: 'zy', units: 'norm', labels: { dp: true, tp: true, rings: true }, schemVertical: false, extended: false, shuntWord: null, plots: ['logmag', 'vswr', 'phase'], hidden: [] }));
  same(JSON.stringify(io.normalizePrefs('x')), JSON.stringify(d));
  same(JSON.stringify(io.normalizePrefs({ colors: 3, widths: null, labels: 'no' })), JSON.stringify(d));
  const good = { z0: 75, f0: 2.4e9, colors: { z: '#AA0011', y: '#0011aa', sweep: null, traj: '#123456', ring: '#abcdef' }, widths: { grid: 0.5, traj: 3, ring: 1.5, sweep: 2 }, slider: 10, eseries: 'E96', mode: 'y', units: 'abs', labels: { dp: false, tp: true, rings: false }, schemVertical: true, extended: true, shuntWord: 'shunt', plots: ['gd', 'zre', 'rl'], hidden: ['plots', 'card-amp'] };
  const kept = io.normalizePrefs(JSON.parse(JSON.stringify(good)));
  same(JSON.stringify(kept), JSON.stringify({ ...good, colors: { ...good.colors, z: '#aa0011' } }));
  same(JSON.stringify(io.normalizePrefs(kept)), JSON.stringify(kept));                       // idempotent
  const bad = io.normalizePrefs({ z0: -5, f0: 'abc', colors: { z: 'red', y: '#12345', sweep: 'url(x)', traj: '#12345g', ring: 7 }, widths: { grid: 0, traj: 99, ring: NaN, sweep: '2' }, slider: 3, eseries: 'E48', mode: 'both', units: 'ohm', labels: { dp: 0 }, schemVertical: 'yes', extended: 1, shuntWord: 'both', plots: ['smith', 7], hidden: 'plots', extra: { evil: true } });
  same(JSON.stringify(bad), JSON.stringify(d));
  // hidden panels: unknown names and repeats dropped, kept in the order of PANELS
  same(JSON.stringify(io.normalizePrefs({ hidden: ['card-amp', 'chart', 'plots', 'plots', 7] }).hidden), JSON.stringify(['plots', 'card-amp']));
});
test('extended chart: the outer grid stays between |Γ| = 1 and the limit, on r < 0 circles or x arcs', () => {
  const view = Chart.makeView(800, 800, 150);                        // |gamma| = 2 fits in the view
  for (const sign of [1, -1]) {
    const g = Chart.outerGrid(view, sign, { limit: 2 });
    ok(g.d.length > 2000, 'outer grid is empty');
    same(g.labels.map((l) => l.text).join(' '), '−0.2 −0.5 −1 −2 −5');
    let onR = 0; let onX = 0;
    for (const m of g.d.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)) {
      const gamma = Chart.toGamma(view, Number(m[1]), Number(m[2]));
      const mod = Math.hypot(gamma.re, gamma.im);
      ok(mod > 0.999 && mod < 2.01, `point at |Γ| = ${mod.toFixed(3)}`);
      // back to the plane it belongs to (impedance, or admittance for sign < 0), by the textbook formula
      const p = sign > 0 ? gamma : c(-gamma.re, -gamma.im);
      // every circle passes through gamma = 1, where z is infinitely sensitive to the 0.01 px rounding of the path
      if (Math.hypot(p.re - 1, p.im) < 0.08) continue;
      const z = cdiv(cadd(c(1), p), csub(c(1), p));
      const near = (v, list) => list.some((t) => Math.abs(v - t) < 0.02 * Math.max(1, Math.abs(t)));
      if (near(z.re, [-0.2, -0.5, -1, -2, -5])) onR += 1;
      else if (near(Math.abs(z.im), [0.2, 0.5, 1, 2, 5])) onX += 1;
      else throw new Error(`point off the grid: z = ${z.re.toFixed(3)} + j${z.im.toFixed(3)}`);
      ok(z.re < 0.02, `positive resistance outside the disc: ${z.re}`);
    }
    ok(onR > 200 && onX > 200, `unexpected split: ${onR} points on r, ${onX} on x`);
  }
  same(Chart.outerGrid(view, 1, { limit: 2, units: 'abs', z0: 50 }).labels.map((l) => l.text).join(' '), '−10 −25 −50 −100 −250');
});

/* ========================================================================== */
group('18. Multi-band matching');

/** |gamma| at the input of a cascade of series / shunt impedances and lines,
 *  by ABCD matrices from the input towards the load (independent of the engine). */
const gammaAbcd = (z0, zl, blocks) => {
  let m = [c(1), c(0), c(0), c(1)];
  for (const b of blocks) m = mMul(m, b);
  const z = mZin(m, zl);
  return Math.hypot(...Object.values(cdiv(csub(z, c(z0)), cadd(z, c(z0)))));
};
/** Lossless line of impedance zc, `deg` degrees at fref, seen at f, as an ABCD block. */
const lineBlock = (zc, deg, fref, f) => mLine(zc, 0, (deg * Math.PI / 180) * (f / fref));

test('worst reflection per band: engine against an ABCD cascade, sample by sample', () => {
  const zl = c(20, -30);
  const els = [L('series', 6e-9), C('shunt', 2.2e-12), TL(70, 40, 1e9)];
  const p = project(50, 1e9, zl, els);
  const bands = [{ start: 0.8e9, stop: 0.9e9 }, { start: 2.3e9, stop: 2.5e9 }, { start: 1.5e9, stop: 1.5e9 }];
  const report = net.bandReport(p, bands, 41);
  bands.forEach((b, k) => {
    let worst = -1; let fWorst = 0;
    const n = b.stop > b.start ? 41 : 1;
    for (let i = 0; i < n; i += 1) {
      const f = n === 1 ? b.start : b.start + (b.stop - b.start) * i / (n - 1);
      // ABCD runs from the input: the last element (nearest the source) comes first
      const g = gammaAbcd(50, zl, [lineBlock(70, 40, 1e9, f), mShunt(zCap(f, 2.2e-12)), mSeries(zInd(f, 6e-9))]);
      if (g > worst) { worst = g; fWorst = f; }
    }
    close(report[k].gammaMax, worst, EXACT, `band ${k + 1} max |Γ|`);
    close(report[k].fWorst, fWorst, EXACT, `band ${k + 1} worst frequency`);
    close(report[k].rlMin, -20 * Math.log10(worst), EXACT, `band ${k + 1} RL`);
    close(report[k].vswrMax, (1 + worst) / (1 - worst), EXACT, `band ${k + 1} VSWR`);
  });
});

test('one narrow band: the optimizer finds the closed-form L network', () => {
  // zl = 10 + j15, series X then shunt B into 50 ohm:
  // G = 10 / (10² + (15 + X)²) = 1/50  ->  15 + X = 20, X = 5 ohm ; B = 20 / 500 = 0.04 S
  const f = 1e9;
  const w0 = 2 * Math.PI * f;
  const p = project(50, f, c(10, 15), [{ ...L('series', 5e-9), opt: true }, { ...C('shunt', 2e-12), opt: true }]);
  const r = net.optimize(p, { bands: [{ start: f * 0.9999, stop: f * 1.0001 }], indices: [0, 1] });
  close(r.elements[0].value, 5 / w0, 1e-3, 'L');
  close(r.elements[1].value, 0.04 / w0, 1e-3, 'C');
  ok(r.after[0].rlMin > 40, `RL ${r.after[0].rlMin} dB`);
});

test('two bands: two-section dual-frequency transformer (Monzon), checked by ABCD', () => {
  // Closed form (Monzon 2003): sections of equal length theta = pi / (1 + f2/f1) at f1,
  // Z1 Z2 = Z0 RL. First check the formula itself through ABCD, then that the optimiser,
  // started far from it, finds a network of that family matched at both frequencies.
  const z0 = 50; const rl = 150; const f1 = 1e9; const f2 = 2.5e9;
  const th = Math.PI / (1 + f2 / f1);
  const a = z0 * (rl - z0) / (2 * Math.tan(th) ** 2);
  const zSrc = Math.sqrt(a + Math.sqrt(a * a + z0 ** 3 * rl));     // section on the source side
  const zLoad = z0 * rl / zSrc;
  const deg = th * 180 / Math.PI;
  for (const f of [f1, f2]) {
    const g = gammaAbcd(z0, c(rl), [lineBlock(zSrc, deg, f1, f), lineBlock(zLoad, deg, f1, f)]);
    ok(g < 1e-9, `closed form: |Γ| = ${g} at ${f} Hz`);
  }
  const p = project(z0, f1, c(rl), [{ ...TL(50, 45, f1), opt: true }, { ...TL(50, 45, f1), opt: true }]);
  const r = net.optimize(p, { bands: [{ start: f1 * 0.999, stop: f1 * 1.001 }, { start: f2 * 0.999, stop: f2 * 1.001 }], indices: [0, 1] });
  const [e0, e1] = r.elements;
  for (const f of [f1, f2]) {
    const g = gammaAbcd(z0, c(rl), [lineBlock(e1.zc, e1.deg, f1, f), lineBlock(e0.zc, e0.deg, f1, f)]);
    ok(-20 * Math.log10(g) > 35, `optimizer: RL ${(-20 * Math.log10(g)).toFixed(1)} dB at ${f} Hz`);
  }
  close(e0.zc * e1.zc, z0 * rl, 0.02, 'Z1·Z2 = Z0·RL');
});

test('the optimizer only changes the elements asked for, stays in range and repeats itself', () => {
  const els = [{ ...L('series', 8e-9), opt: true }, C('shunt', 3e-12), { ...L('series', 4e-9), off: true, opt: true }, { ...C('shunt', 1e-12), opt: true }];
  const p = project(50, 868e6, c(20, -30), els);
  const bands = [{ start: 863e6, stop: 870e6 }, { start: 2.4e9, stop: 2.4835e9 }];
  const r1 = net.optimize(p, { bands, indices: [0, 2, 3], starts: 4 });
  const r2 = net.optimize(p, { bands, indices: [0, 2, 3], starts: 4 });
  same(JSON.stringify(r1.elements), JSON.stringify(r2.elements), 'same seed, same result');
  same(r1.elements[1].value, 3e-12, 'unchecked element');
  same(r1.elements[2].value, 4e-9, 'disabled element');
  ok(r1.changes.every((ch) => ch.index === 0 || ch.index === 3), 'change outside the list');
  same(p.elements[0].value, 8e-9, 'original project changed');
  for (const ch of r1.changes) {
    const range = net.optParams(p.elements[ch.index], p).find((q) => q.key === ch.key);
    ok(ch.to >= range.lo && ch.to <= range.hi, `${ch.key} out of range: ${ch.to}`);
  }
  const worst = (rep) => Math.min(...rep.map((x) => x.rlMin));
  ok(worst(r1.after) >= worst(r1.before), 'result worse than the start');
  // the report of the result is the engine's own read-out of the returned network
  const again = net.bandReport({ ...p, elements: r1.elements }, bands);
  same(JSON.stringify(again), JSON.stringify(r1.after), 'report after');
});

test('optimizer without a band or an element: network unchanged, with a reason', () => {
  const p = project(50, 1e9, c(20, 10), [C('shunt', 1e-12)]);
  const a = net.optimize(p, { bands: [], indices: [0] });
  ok(a.reason && a.elements === p.elements, 'no band');
  const b = net.optimize(p, { bands: [{ start: 1e9, stop: 1.1e9 }], indices: [] });
  ok(b.reason && b.elements === p.elements && b.changes.length === 0, 'no element');
  same(net.optParams({ kind: 'RLC', conn: 'series', topology: 'series', r: 1, l: 1e-9, c: 1e-12 }, p).length, 0, 'RLC');
  same(net.optParams({ ...C('shunt', 1e-12), off: true }, p).length, 0, 'disabled');
});

test('project: bands and "Optimize" flags kept, bad values dropped', () => {
  const raw = {
    z0: 50, f0: 1e9, load: { kind: 'z', z: { re: 30, im: 0 } },
    elements: [{ kind: 'C', conn: 'shunt', value: 1e-12, opt: true }, { kind: 'L', conn: 'series', value: 1e-9, opt: 'yes' }],
    bands: { on: true, rlGoal: 15, list: [{ start: 2e9, stop: 1e9 }, { start: -1, stop: 5 }, null, { start: 3e9, stop: 3.1e9 }] },
  };
  const n = io.normalizeProject(raw);
  same(n.elements[0].opt, true, 'opt');
  same('opt' in n.elements[1], false, 'non-boolean opt');
  same(JSON.stringify(n.bands), JSON.stringify({ on: true, rlGoal: 15, list: [{ start: 1e9, stop: 2e9 }, { start: 3e9, stop: 3.1e9 }] }));
  same(JSON.stringify(io.normalizeProject({ z0: 50, f0: 1e9 }).bands), JSON.stringify({ on: false, rlGoal: 10, list: [] }), 'older project');
  same(io.normalizeProject({ bands: { on: true, list: [] } }).bands.on, false, 'on without a band');
  same(JSON.stringify(io.decodeLink(io.encodeLink(n)).bands), JSON.stringify(n.bands), 'link');
});

group('19. Plot formats (group delay)');

test('group delay: short-circuited line = 2·l / v, flat over frequency', () => {
  // gamma = -exp(-j 2 beta l): tau = 2 * (deg / 360) / fref, here 90 deg at 1 GHz -> 0.5 ns
  const p = project(50, 1e9, c(0), [TL(50, 90, 1e9)]);
  const sw = net.sweep(p, { start: 0.5e9, stop: 3e9, points: 101, scale: 'lin' });
  const tau = net.groupDelay(sw.map((m) => m.f), sw.map((m) => m.gamma));
  for (const t of tau) close(t, 0.5e-9, 1e-9, "tau");
});

test('group delay: L-C cell, against the derivative of the phase computed by ABCD', () => {
  const zl = c(20, -30);
  const p = project(50, 1e9, zl, [L('series', 6e-9), C('shunt', 2.2e-12)]);
  const fs = [0.9e9, 1e9, 1.1e9];
  const gammas = fs.map((f) => {
    let m = [c(1), c(0), c(0), c(1)];
    for (const b of [mShunt(zCap(f, 2.2e-12)), mSeries(zInd(f, 6e-9))]) m = mMul(m, b);
    const z = mZin(m, zl);
    return cdiv(csub(z, c(50)), cadd(z, c(50)));
  });
  const tau = net.groupDelay(fs, gammas);
  // independent: finite difference of the ABCD phase over a tiny step at 1 GHz
  const ph = (f) => {
    let m = [c(1), c(0), c(0), c(1)];
    for (const b of [mShunt(zCap(f, 2.2e-12)), mSeries(zInd(f, 6e-9))]) m = mMul(m, b);
    const z = mZin(m, zl);
    const g = cdiv(csub(z, c(50)), cadd(z, c(50)));
    return Math.atan2(g.im, g.re);
  };
  const exact = -(ph(1e9 + 1e3) - ph(1e9 - 1e3)) / (2 * Math.PI * 2e3);
  ok(Math.abs(tau[1] - exact) < 0.05 * Math.abs(exact), `centre ${tau[1]} against ${exact}`);
  ok(Number.isFinite(tau[0]) && Number.isFinite(tau[2]), 'ends');
  const sw = net.sweep(p, { start: 0.9e9, stop: 1.1e9, points: 3, scale: 'lin' });
  const viaEngine = net.groupDelay(sw.map((m) => m.f), sw.map((m) => m.gamma));
  viaEngine.forEach((t, i) => close(t, tau[i], 1e-9, "engine"));
});

test('group delay: a zero or infinite Γ gives NaN without breaking its neighbours', () => {
  const t = net.groupDelay([1, 2, 3, 4], [c(0.5), c(0), c(0.5, 0.1), c(0.5, 0.2)]);
  ok(Number.isNaN(t[0]) && Number.isNaN(t[1]), 'gap');
  ok(Number.isFinite(t[2]) && Number.isFinite(t[3]), 'resumes');
  same(net.groupDelay([1], [c(0.5)]).length, 1);
  ok(Number.isNaN(net.groupDelay([1], [c(0.5)])[0]), 'single point');
});

/* ========================================================================== */
const total = passed + failures.length;
console.log(`\n${total} tests: ${passed} passed, ${failures.length} failed`);
if (failures.length) {
  failures.forEach((name) => console.log(`  - ${name}`));
  process.exit(1);
}
