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
    console.error(`Bloc <script id="${id}"> introuvable dans index.html`);
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
    console.log(`  ÉCHEC ${name}\n        ${err.message}`);
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
    throw new Error(`${label} attendu ${show(expected)}, obtenu ${show(actual)} (écart relatif ${err.toExponential(2)} > ${tol})`);
  }
};
/** Value shown rounded to `decimals` on a screenshot: half a unit of the last digit. */
const shown = (actual, displayed, decimals, label = '') => {
  const tol = 0.5 * 10 ** -decimals * (1 + 1e-9);
  if (!(Math.abs(actual - displayed) <= tol)) {
    throw new Error(`${label} affiché ${displayed}, obtenu ${actual} (hors de ±${tol})`);
  }
};
const ok = (cond, msg) => { if (!cond) throw new Error(msg); };
const same = (actual, expected, label = '') => {
  if (!Object.is(actual, expected) && actual !== expected) throw new Error(`${label} attendu ${expected}, obtenu ${actual}`);
};
/** No NaN anywhere in a read-out (null means "undefined on purpose"). */
const noNaN = (obj, path = 'metrics') => {
  if (typeof obj === 'number') ok(!Number.isNaN(obj), `NaN dans ${path}`);
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
group('0. Extraction du moteur');

test('smith-core et smith-chart s\'exécutent dans un contexte nu (sans page ni console)', () => {
  ok(Core && typeof Core.VERSION === 'string', 'SmithCore non exposé');
  ok(Chart && typeof Chart.grid === 'function', 'SmithChart non exposé');
});
test('ni le moteur ni la géométrie ne référencent un objet de la page', () => {
  for (const [name, source] of [['smith-core', coreSource], ['smith-chart', chartSource]]) {
    const hit = /\b(document|window|navigator|localStorage|console|fetch|alert)\b/.exec(source);
    ok(!hit, `identifiant interdit dans ${name} : ${hit && hit[0]}`);
  }
});

/* ========================================================================== */
group('1. Nombres complexes');

test('division, inverse, racine', () => {
  close(K.div(c(1, 2), c(3, -4)), c(-0.2, 0.4), EXACT);
  close(K.inv(c(0, 2)), c(0, -0.5), EXACT);
  close(K.sqrt(c(-4, 0)), c(0, 2), EXACT);
  close(K.sqrt(c(3, 4)), c(2, 1), EXACT);
  close(K.sqrt(c(3, -4)), c(2, -1), EXACT);
});
test('sin/cos exacts aux multiples de 90°', () => {
  same(K.sind(180), 0); same(K.sind(360), 0); same(K.cosd(90), 0); same(K.cosd(270), 0);
  same(K.sind(90), 1); same(K.sind(-90), -1); same(K.cosd(180), -1); same(K.cosd(0), 1);
  close(K.sind(30), 0.5, EXACT);
});

/* ========================================================================== */
group('2. Vecteurs du cours (slides 6 à 17)');

test('V1  z = 0,6 + j0,8 ↔ Z = 30 + j40 Ω ; z = 1 ↔ centre', () => {
  const m = net.solve(project(50, 1e9, c(30, 40)))[0];
  close(m.zn, c(0.6, 0.8));
  close(rf.gammaToZ(rf.zToGamma(c(0.6, 0.8), 1), 50), c(30, 40));
  close(m.gamma, c(0, 0.5), EXACT, 'Γ');
  const centre = rf.zToGamma(c(50, 0), 50);
  same(centre.re, 0); same(centre.im, 0);
});
test('V1  Z0 configurable : 75 Ω au centre d\'un abaque 75 Ω', () => {
  const g = rf.zToGamma(c(75, 0), 75);
  same(g.re, 0); same(g.im, 0);
  close(rf.zToGamma(c(50, 0), 75), c(-0.2, 0), EXACT);
});
test('V1  le point est sur le cercle r = 0,6 et l\'arc x = 0,8', () => {
  const g = rf.zToGamma(c(0.6, 0.8), 1);
  for (const circle of [rf.rCircle(0.6), rf.xArc(0.8)]) {
    close(Math.hypot(g.re - circle.cx, g.im - circle.cy), circle.rad, EXACT);
  }
});
test('V2  z = 0,6 + j1,4 → y = 0,259 − j0,603, symétrique par rapport au centre', () => {
  const y = rf.invZ(c(0.6, 1.4));
  close(y, c(0.259, -0.603));
  close(y, cinv(c(0.6, 1.4)), EXACT);
  close(net.solve(project(50, 1e9, c(30, 70)))[0].yn, c(0.259, -0.603));
  close(rf.zToGamma(y, 1), K.neg(rf.zToGamma(c(0.6, 1.4), 1)), EXACT, 'symétrie');
});
test('V3  z = 1,2 − j1,4 → y = 0,353 + j0,412', () => {
  const y = rf.invZ(c(1.2, -1.4));
  close(y, c(0.353, 0.412));
  close(y, cinv(c(1.2, -1.4)), EXACT);
  close(rf.zToGamma(y, 1), K.neg(rf.zToGamma(c(1.2, -1.4), 1)), EXACT, 'symétrie');
});
test('V4  C série, Δx = −j1,1 : 0,6 + j0,8 → 0,6 − j0,3 (cercle r, vers le bas)', () => {
  const f = 1e9;
  const cap = rf.componentForReactance(-1.1 * 50, f);
  same(cap.kind, 'C');
  const p = project(50, f, c(30, 40), [C('series', cap.value)]);
  const [a, b] = net.solve(p);
  close(b.zn, c(0.6, -0.3));
  const info = net.stepInfo(p, 0);
  same(info.locus.type, 'r');
  close(info.locus.value, 0.6); close(info.locus.delta, -1.1);
  ok(b.gamma.im < a.gamma.im, 'un C série doit descendre sur l\'abaque');
});
test('V5  L série, Δx = +j1,8 : 1,2 − j1,4 → 1,2 + j0,4 (cercle r, vers le haut)', () => {
  const f = 1e9;
  const ind = rf.componentForReactance(1.8 * 50, f);
  same(ind.kind, 'L');
  const p = project(50, f, c(60, -70), [L('series', ind.value)]);
  const [a, b] = net.solve(p);
  close(b.zn, c(1.2, 0.4));
  const info = net.stepInfo(p, 0);
  same(info.locus.type, 'r');
  close(info.locus.value, 1.2); close(info.locus.delta, 1.8);
  ok(b.gamma.im > a.gamma.im, 'une L série doit monter sur l\'abaque');
});
test('V6  C parallèle, Δb = +j1,4 : y = 1,2 − j0,4 → 1,2 + j1,0 (cercle g)', () => {
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
test('V6b L parallèle, Δb = −j1,4 : y = 1,2 + j1,0 → 1,2 − j0,4 (slide 14)', () => {
  const f = 1e9;
  const ind = rf.componentForSusceptance(-1.4 / 50, f);
  same(ind.kind, 'L');
  const p = project(50, f, cscale(cinv(c(1.2, 1.0)), 50), [L('shunt', ind.value)]);
  close(net.solve(p)[1].yn, c(1.2, -0.4));
  close(net.stepInfo(p, 0).locus.delta, -1.4);
});
test('V7  RLC série 30 Ω / 5,5 nH / 6,11 pF : Q = 1, résonance ≈ 868 MHz', () => {
  const res = rf.rlcResonance({ r: 30, l: 5.5e-9, c: 6.11e-12, topology: 'series' });
  close(res.q, 1); close(res.f0, 868e6);
  close(res.f0, 1 / (2 * Math.PI * Math.sqrt(5.5e-9 * 6.11e-12)), EXACT);
  const load = { kind: 'rlc', topology: 'series', r: 30, l: 5.5e-9, c: 6.11e-12 };
  const m = net.solve(project(50, res.f0, load))[0];
  close(m.zn.re, 0.6);
  ok(Math.abs(m.z.im) < 1e-6, `réactance non nulle à la résonance : ${m.z.im}`);
  close(w(res.f0) * 5.5e-9 / 50, 0.6);                              // z_L = +j0,6
  close(net.solve(project(50, res.f0, { ...load, c: null }))[0].q, 1);   // Q du nœud R + L
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

test('V8  slide 16 à 869 MHz (charge 92 nH + 2 Ω) : Zin ≈ 0,0018 − j157,19 Ω', () => {
  const load = { kind: 'rlc', topology: 'series', r: 2, l: 92e-9, c: null };
  const z = zin(project(50, F869, load, ladder));
  const zLoad = zInd(F869, 92e-9, 2);
  close(z, c(0.0018, -157.19), TOL, 'référence fournie');
  close(z, ladderReduction(zLoad)[4], EXACT, 'réduction série/parallèle');
  close(z, ladderAbcd(zLoad), EXACT, 'cascade ABCD');
  // même circuit, la 92 nH étant le premier élément du réseau au lieu de faire partie de la charge
  close(zin(project(50, F869, c(2, 0), [L('series', 92e-9), ...ladder])), z, EXACT, 'charge 2 Ω + L série');
});
test('V9  slide 17 (Smith V3.10, charge 2 + j10 Ω) : les 5 points et leur Q', () => {
  const nodes = net.solve(project(50, F869, c(2, 10), ladder));
  const displayed = [
    [c(2.000, 10.000), 5.000], [c(20.365, -25.382), 1.246], [c(20.365, 56.519), 2.775],
    [c(88.740, -88.611), 0.999], [c(88.740, -115.544), 1.302],
  ];
  const reference = ladderReduction(c(2, 10));
  displayed.forEach(([z, q], k) => {
    close(nodes[k].z, z, TOL, `point ${k + 1}`);
    close(nodes[k].q, q, TOL, `Q du point ${k + 1}`);
    close(nodes[k].z, reference[k], EXACT, `point ${k + 1} (réduction)`);
  });
  close(nodes[4].z, ladderAbcd(c(2, 10)), EXACT, 'cascade ABCD');
});
test('V9  slide 17, panneau Cursor pour Z = 33,22 − j42,08 Ω', () => {
  const m = rf.metrics(rf.stFromZ(c(33.22, -42.08)), 50, F869);
  close(m.mag, 0.486, TOL, '|Γ|');
  close(m.ang, -84.920, TOL, 'arg Γ');
  close(m.rl, 6.27, TOL, 'return loss');
  close(m.vswr, 2.89, TOL, 'VSWR');
  shown(m.q, 1.27, 2, 'Q');
  close(m.y, c(11.56e-3, 14.64e-3), TOL, 'Y');
});
test('V10 Dellsperger ex. 1 : 10 + j7 Ω à 150 MHz, C série 39,2 pF puis L // 26,6 nH', () => {
  const nodes = net.solve(project(50, 150e6, c(10, 7), [C('series', 39.2e-12), L('shunt', 26.6e-9)]));
  close(nodes[1].z, c(10.000, -20.067));
  close(nodes[2].z, c(50.269, -0.078));
  close(nodes[1].q, 2.007);
});
test('Plausibilité (3 %) : Dellsperger ex. 4, 9 et 10 (valeurs de schéma arrondies)', () => {
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
group('3. Voie indépendante : moteur (V, I) contre réduction série/parallèle');

test('300 réseaux R/L/C aléatoires en échelle', () => {
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
    close(zin(project(50, f, zl, elements), f), ref, EXACT, `réseau n° ${n}`);
  }
});
test('composants à Q fini : ESR donnée, ou Q à une fréquence', () => {
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
  // un composant à pertes ne reste pas sur le cercle r
  same(net.stepInfo(project(50, f, zl, elements), 0).locus, null);
});
test('éléments R-L-C composés, en série et en parallèle', () => {
  const f = 500e6;
  const zl = c(40, 30);
  const zs = cadd(c(33), cadd(zInd(f, 22e-9), zCap(f, 18e-12)));                       // R-L-C série
  const zp = cinv(cadd(cinv(c(330)), cadd(cinv(zInd(f, 12e-9)), cinv(zCap(f, 4.7e-12)))));  // R-L-C parallèle
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
test('transformateur idéal : Zin = n²·Z', () => {
  close(zin(project(50, 1e8, c(12.5, 5), [{ kind: 'XFMR', n: 2 }])), c(50, 20), EXACT);
  close(zin(project(50, 1e8, c(200, -80), [{ kind: 'XFMR', n: 0.5 }])), c(50, -20), EXACT);
});

/* ========================================================================== */
group('4. Lignes de transmission');

test('ligne λ/2 = identité, quelle que soit Zc', () => {
  for (const zc of [20, 50, 93]) close(zin(project(50, 1e9, c(30, -40), [TL(zc, 180, 1e9)])), c(30, -40), 1e-12);
});
test('ligne λ/4 = inverseur : Zin = Zc²/Z', () => {
  close(zin(project(50, 1e9, c(100, 0), [TL(70.7107, 90, 1e9)])), c(50, 0), 1e-6);
  close(zin(project(50, 1e9, c(30, -40), [TL(75, 90, 1e9)])), cdiv(c(75 * 75), c(30, -40)), EXACT);
});
test('ligne sans pertes de Zc = Z0 : |Γ| conservé, Γ tourne de −2θ', () => {
  const p = project(50, 1e9, c(30, -40), [TL(50, 37, 1e9)]);
  const [a, b] = net.solve(p);
  close(b.mag, a.mag, EXACT);
  close(b.gamma, cmul(a.gamma, c(Math.cos(-74 * Math.PI / 180), Math.sin(-74 * Math.PI / 180))), EXACT);
  const info = net.stepInfo(p, 0);
  same(info.locus.type, 'gamma');
});
test('200 lignes aléatoires (avec et sans pertes) : tanh fermée et matrice ABCD', () => {
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
    close(z, lineZin(zl, zc, a, b), 1e-8, `ligne n° ${n} (tanh)`);
    close(z, mZin(mLine(zc, a, b), zl), 1e-8, `ligne n° ${n} (ABCD)`);
  }
});
test('ligne à pertes court-circuitée : return loss = 2 × atténuation (ex. 15 : 2 dB/m, 2 λ, 500 MHz)', () => {
  const f = 500e6;
  const line = TL(50, 720, f, { alpha: 2 });
  const lengths = rf.lineLengths(line);
  close(lengths.phys, 2 * LIGHT / f, EXACT);
  const oneWay = 2 * lengths.phys;                                   // dB
  close(net.inputAt(project(50, f, c(0, 0), [line])).rl, 2 * oneWay, EXACT);
  // loi en racine de f : pertes doublées à 4·f ; loi constante : inchangées
  close(net.inputAt(project(50, f, c(0, 0), [line]), 4 * f).rl, 4 * oneWay, EXACT);
  close(net.inputAt(project(50, f, c(0, 0), [{ ...line, alphaLaw: 'const' }]), 4 * f).rl, 2 * oneWay, EXACT);
});
test('ligne à très fortes pertes : Zin → Zc, sans dépassement numérique', () => {
  const m = net.inputAt(project(50, 1e9, c(3, 400), [TL(75, 3600, 1e9, { alpha: 5000 })]));
  noNaN(m);
  close(m.z, c(75, 0), 1e-9);
});
test('la longueur physique est fixe : 90° à f_ref = 180° à 2·f_ref', () => {
  const p = project(50, 1e9, c(30, -40), [TL(75, 90, 1e9)]);
  close(zin(p, 2e9), c(30, -40), 1e-12);
});
test('longueurs : λ, électrique, physique, facteur de vélocité', () => {
  const air = rf.lineLengths(TL(50, 0.208 * 360, 430e6));
  close(air.lambda, 0.208, EXACT);
  close(air.elec, 0.1451, TOL, 'longueur électrique affichée par Smith (145,1 mm)');
  close(air.phys, air.elec, EXACT);
  const fr4 = rf.lineLengths(TL(50, 90, 1e9, { er: 4 }));
  close(fr4.phys, LIGHT / 1e9 / 4 / 2, EXACT);
  close(fr4.vf, 0.5, EXACT);
  close(fr4.delay, 0.25e-9, EXACT);
});
test('changer la fréquence de référence décrit la même ligne', () => {
  const zl = c(18, 33);
  for (const alphaLaw of ['sqrt', 'const']) {
    const line = TL(62, 131, 700e6, { er: 3.2, alpha: 4, alphaLaw });
    const moved = rf.rereferenceLine(line, 1.9e9);
    close(rf.lineLengths(moved).phys, rf.lineLengths(line).phys, EXACT);
    for (const f of [300e6, 700e6, 1.9e9, 2.4e9]) {
      close(zin(project(50, 1e9, zl, [moved]), f), zin(project(50, 1e9, zl, [line]), f), EXACT, `${alphaLaw} à ${f} Hz`);
    }
  }
});

/* ========================================================================== */
group('5. Stubs');

test('stub court-circuité λ/4 = circuit ouvert (sans effet sur le nœud)', () => {
  const h = net.branchOf(STUB('short', 50, 90, 1e9), 1e9);
  ok(K.isZero(h.d), 'la branche devrait être exactement un circuit ouvert');
  close(zin(project(50, 1e9, c(30, -40), [STUB('short', 50, 90, 1e9)])), c(30, -40), 1e-12);
});
test('stub ouvert λ/4 = court-circuit', () => {
  const m = net.inputAt(project(50, 1e9, c(30, -40), [STUB('open', 50, 90, 1e9)]));
  same(m.z.re, 0); same(m.z.im, 0);
  close(m.gamma, c(-1, 0), EXACT);
});
test('stub λ/8 : ouvert = −jZc, court-circuité = +jZc', () => {
  const z = (term) => { const h = net.branchOf(STUB(term, 75, 45, 1e9), 1e9); return K.div(h.n, h.d); };
  close(z('open'), c(0, -75), EXACT);
  close(z('short'), c(0, 75), EXACT);
});
test('stubs sans pertes : Y = j·tan(βl)/Zc (ouvert), −j·cot(βl)/Zc (court-circuité)', () => {
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
test('stubs à pertes : Zc·coth(γl) et Zc·tanh(γl)', () => {
  const stub = (term) => STUB(term, 60, 70, 1e9, { er: 2.2, alpha: 12 });
  const phys = rf.lineLengths(stub('open')).phys;
  const t = ctanh(12 * phys * NEPER, 70 * Math.PI / 180);
  const zl = c(80, 25);
  close(zin(project(50, 1e9, zl, [stub('short')])), parZ(zl, cscale(t, 60)), EXACT);
  close(zin(project(50, 1e9, zl, [stub('open')])), parZ(zl, cscale(cinv(t), 60)), EXACT);
});
test('stub de longueur nulle : ouvert sans effet, court-circuité = court-circuit', () => {
  close(zin(project(50, 1e9, c(30, -40), [STUB('open', 50, 0, 1e9)])), c(30, -40), 1e-12);
  const m = net.inputAt(project(50, 1e9, c(30, -40), [STUB('short', 50, 0, 1e9)]));
  same(m.z.re, 0); same(m.z.im, 0);
});

/* ========================================================================== */
group('6. Géométrie de l\'abaque');

const angles = [20, 75, 130, 200, 260, 325];
test('cercles r = cste et arcs x = cste', () => {
  for (const r of [0, 0.2, 0.6, 1, 5]) {
    for (const a of angles) close(rf.gammaToZ(rf.circlePoint(rf.rCircle(r), a), 1).re, r, 1e-9, `r = ${r}`);
  }
  for (const x of [-5, -1, -0.3, 0.3, 0.8, 2]) {
    for (const a of angles) close(rf.gammaToZ(rf.circlePoint(rf.xArc(x), a), 1).im, x, 1e-9, `x = ${x}`);
  }
});
test('slide 4 : le cercle r coupe l\'axe réel en (r − 1)/(r + 1) et en 1', () => {
  for (const r of [0.2, 0.5, 1, 2]) {
    const circle = rf.rCircle(r);
    close(circle.cx - circle.rad, (r - 1) / (r + 1), EXACT);
    close(circle.cx + circle.rad, 1, EXACT);
    close(circle.rad, 1 / (r + 1), EXACT);
  }
  const arc = rf.xArc(0.5);
  same(arc.cx, 1); close(arc.cy, 2, EXACT); close(arc.rad, 2, EXACT);
});
test('cercles g = cste et arcs b = cste ; abaque Y = abaque Z tourné de 180°', () => {
  for (const g of [0, 0.35, 1.2, 4]) {
    for (const a of angles) close(rf.gammaToY(rf.circlePoint(rf.gCircle(g), a), 1).re, g, 1e-9, `g = ${g}`);
    close(rf.gCircle(g).cx, -rf.rCircle(g).cx, EXACT);
  }
  for (const b of [-3, -0.6, 0.412, 1.4]) {
    for (const a of angles) close(rf.gammaToY(rf.circlePoint(rf.bArc(b), a), 1).im, b, 1e-9, `b = ${b}`);
    close(rf.bArc(b).cx, -rf.xArc(b).cx, EXACT); close(rf.bArc(b).cy, -rf.xArc(b).cy, EXACT);
  }
});
test('lieux à Q constant : |x|/r = Q, passent par Γ = ±1 (slide 9)', () => {
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
        ok(upper ? z.im > 0 : z.im < 0, 'mauvais demi-plan');
      }
      ok(inside > 5, 'aucun point du lieu dans le disque');
    }
  }
  // les points du RLC série de la slide 9 (r = 0,6, x = ±0,6) sont sur le lieu Q = 1
  for (const x of [0.6, -0.6]) {
    const arc = rf.qArc(1, x > 0);
    const g = rf.zToGamma(c(0.6, x), 1);
    close(Math.hypot(g.re - arc.cx, g.im - arc.cy), arc.rad, EXACT);
  }
});
test('cercles VSWR', () => {
  for (const s of [1.2, 2, 2.89, 10]) {
    for (const a of angles) close(rf.metrics(rf.stFromGamma(rf.circlePoint(rf.vswrCircle(s), a), 50), 50).vswr, s, 1e-9);
  }
});

/* ========================================================================== */
group('7. Trajectoires et sweep');

test('trajectoire d\'un élément : extrémités, cercle suivi, pas maximal', () => {
  const p = project(50, F869, c(2, 10), ladder);
  const nodes = net.solve(p);
  ladder.forEach((el, k) => {
    const path = net.trajectory(p, k);
    close(path[0].gamma, nodes[k].gamma, EXACT, `départ de l'élément ${k}`);
    close(path[path.length - 1].gamma, nodes[k + 1].gamma, EXACT, `arrivée de l'élément ${k}`);
    let longest = 0;
    for (let i = 1; i < path.length; i += 1) {
      ok(path[i].t > path[i - 1].t, 'paramètre non croissant');
      longest = Math.max(longest, Math.hypot(path[i].gamma.re - path[i - 1].gamma.re, path[i].gamma.im - path[i - 1].gamma.im));
      const value = el.conn === 'series' ? rf.gammaToZ(path[i].gamma, 1).re : rf.gammaToY(path[i].gamma, 1).re;
      const expected = el.conn === 'series' ? nodes[k].zn.re : nodes[k].yn.re;
      close(value, expected, 1e-7, `élément ${k} hors de son cercle`);
    }
    ok(longest <= 0.0201, `pas de ${longest} > 0,02`);
  });
});
test('trajectoire d\'une ligne d\'une longueur d\'onde : deux tours complets', () => {
  const p = project(50, 1e9, c(100, 0), [TL(50, 360, 1e9)]);
  const path = net.trajectory(p, 0);
  let length = 0;
  for (let i = 1; i < path.length; i += 1) {
    length += Math.hypot(path[i].gamma.re - path[i - 1].gamma.re, path[i].gamma.im - path[i - 1].gamma.im);
    close(Math.hypot(path[i].gamma.re, path[i].gamma.im), 1 / 3, 1e-9);
  }
  close(length, 2 * (2 * Math.PI / 3), 1e-3);
});
test('liste de fréquences linéaire et logarithmique', () => {
  const lin = net.frequencyList({ start: 300e6, stop: 800e6, points: 6 });
  same(lin.length, 6); same(lin[0], 300e6); same(lin[5], 800e6); close(lin[1], 400e6, EXACT);
  const log = net.frequencyList({ start: 1e6, stop: 1e9, points: 4, scale: 'log' });
  close(log[1], 1e7, EXACT); close(log[2], 1e8, EXACT); same(log[3], 1e9);
  same(net.frequencyList({ start: 5, stop: 5, points: 10 }).length, 1);
});
test('sweep : mêmes valeurs que le calcul point par point', () => {
  const p = project(50, F869, { kind: 'rlc', topology: 'series', r: 2, l: 92e-9, c: null }, ladder);
  const spec = { start: 700e6, stop: 1000e6, points: 31 };
  const trace = net.sweep(p, spec);
  same(trace.length, 31);
  net.frequencyList(spec).forEach((f, k) => {
    same(trace[k].f, f);
    close(trace[k].gamma, net.inputAt(p, f).gamma, EXACT);
  });
  close(net.sweep(p, spec, 2)[7].z, net.solve(p, trace[7].f)[2].z, EXACT, 'nœud intermédiaire');
});
test('slide 15 : f croissant fait tourner z(f) et y(f) dans le sens horaire', () => {
  const clockwise = (trace, centre) => {
    for (let k = 1; k < trace.length; k += 1) {
      const a = csub(trace[k - 1].gamma, centre);
      const b = csub(trace[k].gamma, centre);
      ok(a.re * b.im - a.im * b.re < 0, `rotation anti-horaire au point ${k}`);
    }
  };
  const spec = { start: 200e6, stop: 3e9, points: 40 };
  // z = 0,5 + j·f(ω) : R-L-C série, sur le cercle r = 0,5
  const zTrace = net.sweep(project(50, 1e9, { kind: 'rlc', topology: 'series', r: 25, l: 8e-9, c: 3e-12 }), spec);
  zTrace.forEach((m) => close(m.zn.re, 0.5, 1e-9));
  clockwise(zTrace, c(rf.rCircle(0.5).cx, 0));
  // y = 0,6 + j·g(ω) : R-L-C parallèle, sur le cercle g = 0,6
  const yTrace = net.sweep(project(50, 1e9, { kind: 'rlc', topology: 'parallel', r: 50 / 0.6, l: 8e-9, c: 3e-12 }), spec);
  yTrace.forEach((m) => close(m.yn.re, 0.6, 1e-9));
  clockwise(yTrace, c(rf.gCircle(0.6).cx, 0));
});

/* ========================================================================== */
group('8. Cas limites');

const OPEN = c(Infinity, 0);
const zero = (z) => z.re === 0 && z.im === 0;
const infinite = (z) => !Number.isFinite(z.re);

test('circuit ouvert et court-circuit comme charge', () => {
  const open = net.solve(project(50, 1e9, OPEN))[0];
  noNaN(open);
  ok(infinite(open.z) && zero(open.y), 'circuit ouvert mal représenté');
  close(open.gamma, c(1, 0), EXACT); same(open.vswr, Infinity); same(open.q, null); same(open.active, false);
  const short = net.solve(project(50, 1e9, c(0, 0)))[0];
  noNaN(short);
  ok(zero(short.z) && infinite(short.y), 'court-circuit mal représenté');
  close(short.gamma, c(-1, 0), EXACT); same(short.vswr, Infinity); same(short.rl, 0);
});
test('1/z sans NaN : 1/0 = ∞ et 1/∞ = 0', () => {
  ok(infinite(rf.invZ(c(0, 0))), '1/0');
  ok(zero(rf.invZ(OPEN)), '1/∞');
  ok(infinite(rf.gammaToZ(c(1, 0), 50)) && zero(rf.gammaToZ(c(-1, 0), 50)), 'Γ = ±1');
});
test('éléments sur un circuit ouvert ou un court-circuit', () => {
  const f = 1e9;
  const x50 = 50 / w(f);                       // inductance de +j50 Ω
  const b50 = 1 / (50 * w(f));                 // capacité de −j50 Ω
  ok(infinite(zin(project(50, f, OPEN, [L('series', x50)]))), 'ouvert + L série');
  close(zin(project(50, f, OPEN, [C('shunt', b50)])), c(0, -50), EXACT);
  ok(zero(zin(project(50, f, c(0, 0), [C('shunt', b50)]))), 'court-circuit + C //');
  close(zin(project(50, f, c(0, 0), [L('series', x50)])), c(0, 50), EXACT);
  close(zin(project(50, f, OPEN, [TL(50, 90, f)])), c(0, 0), EXACT, 'ouvert vu à travers λ/4');
  ok(infinite(zin(project(50, f, c(0, 0), [TL(50, 90, f)]))), 'court-circuit vu à travers λ/4');
  net.solve(project(50, f, OPEN, [L('series', x50), C('shunt', b50), TL(75, 33, f)])).forEach((m) => noNaN(m));
});
test('fréquence nulle', () => {
  const zl = c(30, 0);
  const at0 = (el) => net.inputAt(project(50, 1e9, zl, [el]), 0);
  close(at0(L('series', 10e-9)).z, zl, EXACT);
  ok(infinite(at0(C('series', 10e-12)).z), 'C série au DC = circuit ouvert');
  ok(zero(at0(L('shunt', 10e-9)).z), 'L // au DC = court-circuit');
  close(at0(C('shunt', 10e-12)).z, zl, EXACT);
  close(at0(TL(75, 90, 1e9, { alpha: 3 })).z, zl, EXACT);
  close(at0(STUB('open', 75, 90, 1e9)).z, zl, EXACT);
  ok(zero(at0(STUB('short', 75, 90, 1e9)).z), 'stub court-circuité au DC');
  for (const el of [L('series', 1e-9), C('series', 1e-12), L('shunt', 1e-9), C('shunt', 1e-12), TL(75, 90, 1e9)]) noNaN(at0(el));
  noNaN(net.inputAt(project(50, 1e9, { kind: 'rlc', topology: 'series', r: 10, l: 1e-9, c: 1e-12 }), 0));
});
test('valeurs nulles ou infinies', () => {
  const zl = c(30, -40);
  const z = (el) => zin(project(50, 1e9, zl, [el]));
  close(z(L('series', 0)), zl, EXACT); close(z(C('shunt', 0)), zl, EXACT);
  close(z(R('series', 0)), zl, EXACT); close(z(R('shunt', Infinity)), zl, EXACT);
  ok(infinite(z(C('series', 0))), 'C série nulle'); ok(infinite(z(R('series', Infinity))), 'R série infinie');
  ok(infinite(z(L('series', Infinity))), 'L série infinie');
  ok(zero(z(L('shunt', 0))), 'L // nulle'); ok(zero(z(R('shunt', 0))), 'R // nulle');
  close(z(C('series', Infinity)), zl, EXACT);
  for (const el of [L('series', 0), C('series', 0), L('shunt', 0), C('shunt', 0), R('shunt', 0), R('series', Infinity)]) {
    noNaN(net.inputAt(project(50, 1e9, zl, [el])));
  }
  noNaN(net.inputAt(project(50, 1e9, zl, [C('series', 0, { mode: 'q', q: 100, f: 1e9 })])));
});
test('|Γ| = 1 : charge purement réactive', () => {
  const p = project(50, 1e9, c(0, 50), [L('series', 3e-9), C('shunt', 2e-12), TL(50, 77, 1e9), C('series', 5e-12)]);
  for (const m of net.solve(p)) {
    noNaN(m);
    same(m.mag, 1); same(m.vswr, Infinity); same(m.ml, Infinity); same(m.rl, 0); same(m.active, false);
  }
  same(net.solve(p)[0].q, Infinity);
});
test('r < 0 : point hors du disque, signalé actif', () => {
  const m = net.solve(project(50, 1e9, c(-25, 10)))[0];
  noNaN(m);
  ok(m.mag > 1 && m.active, 'non signalé actif');
  same(m.vswr, null); same(m.ml, null);
  ok(m.rl < 0, 'return loss devrait être négatif');
  close(m.zn, c(-0.5, 0.2), EXACT);
});
test('Z = −Z0 : Γ infini, sans NaN', () => {
  const m = net.solve(project(50, 1e9, c(-50, 0)))[0];
  noNaN(m);
  same(m.mag, Infinity); same(m.vswr, null); same(m.active, true); same(m.ang, null);
});
test('charge tabulée : exacte aux points, interpolée sur Γ, figée hors plage', () => {
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
test('élément désactivé (off) : ignoré', () => {
  const p = project(50, 1e9, c(30, -40), [{ ...L('series', 10e-9), off: true }, C('shunt', 1e-12)]);
  close(net.solve(p)[1].z, c(30, -40), EXACT);
  close(zin(p), zin(project(50, 1e9, c(30, -40), [C('shunt', 1e-12)])), EXACT);
});

/* ========================================================================== */
group('9. Notation ingénieur');

test('saisie libre', () => {
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
    if (Number.isNaN(expected)) ok(Number.isNaN(got), `« ${text} » devrait être refusé, obtenu ${got}`);
    else if (!Number.isFinite(expected)) same(got, expected, `« ${text} »`);
    else close(got, expected, 1e-12, `« ${text} »`);
  }
  same(eng.parse(42), 42);
});
test('affichage', () => {
  const cases = [
    [6.8e-12, 'F', '6.8 pF'], [15e-9, 'H', '15 nH'], [869e6, 'Hz', '869 MHz'], [50, 'Ω', '50 Ω'],
    [0.02, 'm', '20 mm'], [0, 'Ω', '0 Ω'], [999.96e3, 'Hz', '1 MHz'], [1234.5, 'Ω', '1.234 kΩ'],
    [-3.3e-6, 'F', '-3.3 µF'], [Infinity, 'Ω', '∞ Ω'], [NaN, 'Ω', '—'], [12.5, '', '12.5'],
  ];
  for (const [value, unit, expected] of cases) same(eng.format(value, unit), expected);
  same(eng.formatCx(c(0.6, 0.8)), '0.6 + j0.8');
  same(eng.formatCx(c(1.2, -1.4)), '1.2 - j1.4');
  same(eng.formatCx(c(Infinity, 0)), '∞');
});
test('aller-retour affichage → saisie', () => {
  const rnd = prng(4242);
  for (let n = 0; n < 200; n += 1) {
    const value = logBetween(rnd, 1e-14, 1e11);
    close(eng.parse(eng.format(value, 'F', 9), 'F'), value, 1e-8);
  }
});

/* ========================================================================== */
group('10. Géométrie SVG de l\'abaque (smith-chart)');

const ARC = /^M(-?[\d.]+) (-?[\d.]+)A(-?[\d.]+) (-?[\d.]+) 0 ([01]) ([01]) (-?[\d.]+) (-?[\d.]+)$/;
/** Centre and swept angle of an SVG arc, from its endpoint form (SVG 1.1, F.6.5). */
const svgArc = (d) => {
  const m = ARC.exec(d);
  ok(m, `chemin inattendu : ${d}`);
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

test('repère écran ↔ plan Γ', () => {
  const v = Chart.makeView(800, 500, 200, 410, 240);
  const p = Chart.toPx(v, c(0.25, 0.5));
  close(p.x, 460, EXACT); close(p.y, 140, EXACT);            // Im(Γ) vers le haut = y écran vers le bas
  close(Chart.toGamma(v, p.x, p.y), c(0.25, 0.5), EXACT);
});
test('arcs r = cste : le chemin SVG passe par les bons points, sur les deux plans', () => {
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
      ok(onArc(arc, Chart.toPx(view600, Chart.planePoint(r, x, sign))), `r = ${r}, x de ${xa} à ${xb}, plan ${sign} : point hors de l'arc`);
    }
    // et pas au-delà : un point de la même courbe hors de l'intervalle n'est pas sur l'arc
    const beyond = Chart.toPx(view600, Chart.planePoint(r, Math.tan(Math.atan(xb) + (Math.PI / 2 - Math.atan(xb)) * 0.5), sign));
    const end = Chart.toPx(view600, Chart.planePoint(r, xb, sign));
    if (Math.hypot(beyond.x - end.x, beyond.y - end.y) > 3) ok(!onArc(arc, beyond, 0.3), 'l\'arc dépasse son extrémité');
  }
  ok(checked > 200, `trop peu de cas vérifiés (${checked})`);
});
test('arcs x = cste : le chemin SVG passe par les bons points, sur les deux plans', () => {
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
      ok(onArc(arc, Chart.toPx(view600, Chart.planePoint(r, x, sign))), `x = ${x}, r de ${ra} à ${rb}, plan ${sign} : point hors de l'arc`);
    }
  }
  ok(checked > 200, `trop peu de cas vérifiés (${checked})`);
});
test('axe réel, cercle complet et lieux Q', () => {
  same(Chart.xSeg(view600, 0, 0, Infinity, 1), 'M38 300L562 300');
  const full = /^M(-?[\d.]+) (-?[\d.]+)a/.exec(Chart.rSeg(view600, 1, -Infinity, Infinity, 1));
  close(Number(full[1]), 300, EXACT); close(Number(full[2]), 300, EXACT);    // cercle r = 1 : part du centre
  for (const q of [0.5, 1, 4]) {
    for (const upper of [true, false]) {
      const arc = svgArc(Chart.qArcD(view600, q, upper));
      const circle = rf.qArc(q, upper);
      const centre = Chart.toPx(view600, c(circle.cx, circle.cy));
      ok(Math.hypot(arc.centre.x - centre.x, arc.centre.y - centre.y) < 0.6, `centre du lieu Q = ${q}`);
      for (const x of [0.3, 1, 5]) {
        const g = rf.zToGamma(c(x / q, upper ? x : -x), 1);     // |x| / r = Q
        ok(onArc(arc, Chart.toPx(view600, g)), `point Q = ${q} hors du lieu`);
      }
    }
  }
});
test('plage visible : vue d\'ensemble et vue zoomée autour de z = 1', () => {
  const whole = Chart.visibleRange(view600, 1);
  same(whole.rMin, 0); same(whole.rMax, Infinity); same(whole.pole, true); same(whole.modMin, 0);
  const near = Chart.visibleRange(Chart.makeView(600, 600, 3000), 1);       // demi-largeur 0,1 en Γ
  // extrêmes atteints sur le bord du cadre : coins Γ = ±0,1 ± j0,1 et milieu du bord droit Γ = 0,1
  close(near.rMin, 0.98 / 1.22, EXACT); close(near.rMax, 1.1 / 0.9, EXACT);
  close(near.xMax, 0.2 / 0.82, EXACT); close(near.xMin, -0.2 / 0.82, EXACT);
  same(near.pole, false);
  same(Chart.visibleRange(Chart.makeView(600, 600, 3000, -9000, 300), 1), null);   // disque hors de la vue
});
test('grille adaptative : nombre de lignes borné à tous les zooms, étiquettes sans chevauchement', () => {
  const rnd = prng(8);
  const views = [view600, Chart.makeView(300, 300, 112), Chart.makeView(1400, 900, 410), Chart.makeView(600, 600, 80)];
  for (let n = 0; n < 60; n += 1) {
    const k = 262 * logBetween(rnd, 1.5, 600);
    const a = between(rnd, 0, 2 * Math.PI);
    const rho = n % 6 === 0 ? 1 : n % 6 === 1 ? 0.999 : Math.sqrt(rnd());       // insiste sur le bord et les pôles
    const g = n % 12 === 0 ? c(1, 0) : n % 12 === 7 ? c(-1, 0) : c(rho * Math.cos(a), rho * Math.sin(a));
    views.push(Chart.makeView(600, 600, k, 300 - g.re * k, 300 + g.im * k));
  }
  views.forEach((v, n) => {
    const placed = [];
    for (const sign of [1, -1]) {
      for (const units of ['norm', 'abs']) {
        const g = Chart.grid(v, sign, { units, z0: 50, placed: units === 'norm' ? placed : [] });
        const all = g.d.maj + g.d.med + g.d.min;
        ok(!/NaN|Infinity|undefined/.test(all), `vue ${n} : chemin invalide`);
        ok(g.count <= 400, `vue ${n} : ${g.count} lignes`);
        ok(g.count >= 6, `vue ${n} (k = ${v.k.toFixed(0)}) : seulement ${g.count} lignes`);
        for (const l of g.labels) {
          ok(l.box.x0 >= 0 && l.box.x1 <= v.w && l.box.y0 >= 0 && l.box.y1 <= v.h, `vue ${n} : étiquette « ${l.text} » hors cadre`);
          ok(!/NaN|undefined/.test(l.text), `vue ${n} : étiquette « ${l.text} »`);
        }
      }
    }
    for (let i = 0; i < placed.length; i += 1) {
      for (let j = i + 1; j < placed.length; j += 1) {
        const a = placed[i];
        const b = placed[j];
        ok(!(a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0), `vue ${n} : deux étiquettes se chevauchent`);
      }
    }
  });
});
test('vue d\'ensemble : graduations classiques, mêmes lignes sur les plans Z et Y', () => {
  const z = Chart.grid(view600, 1, { units: 'norm', z0: 50 });
  const y = Chart.grid(view600, -1, { units: 'norm', z0: 50 });
  same(z.count, y.count);
  const texts = new Set(z.labels.map((l) => l.text));
  for (const t of ['0.2', '0.5', '1', '2', '5', '−1', '−2', '−0.5']) ok(texts.has(t), `graduation ${t} absente`);
  // graduations en ohms et en siemens, comme Smith V3.10 : 50 Ω et 20 mS au centre
  const zAbs = new Set(Chart.grid(view600, 1, { units: 'abs', z0: 50 }).labels.map((l) => l.text));
  const yAbs = new Set(Chart.grid(view600, -1, { units: 'abs', z0: 50 }).labels.map((l) => l.text));
  for (const t of ['50', '25', '100', '250']) ok(zAbs.has(t), `graduation ${t} Ω absente`);
  for (const t of ['20m', '10m', '40m', '4m']) ok(yAbs.has(t), `graduation ${t}S absente`);
});
test('polylignes et flèches', () => {
  same(Chart.polyD(view600, [c(0, 0), c(0.5, 0), c(NaN, 0), c(0.5, 0.5), c(1, 0.5)]), 'M300 300L431 300M431 169L562 169');
  const at = Chart.pointAlong(view600, [c(0, 0), c(1, 0)], 0.25);
  close(at.x, 365.5, EXACT); close(at.y, 300, EXACT); close(at.dx, 1, EXACT); close(at.length, 262, EXACT);
  same(Chart.pointAlong(view600, [c(0.2, 0.2)], 0.5), null);
  ok(/^M[\d. -]+L[\d. -]+L[\d. -]+Z$/.test(Chart.arrowD(at)), 'flèche mal formée');
});

/* ========================================================================== */
const total = passed + failures.length;
console.log(`\n${total} tests : ${passed} réussis, ${failures.length} en échec`);
if (failures.length) {
  failures.forEach((name) => console.log(`  - ${name}`));
  process.exit(1);
}
