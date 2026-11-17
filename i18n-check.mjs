// i18n-check.mjs — translation completeness checks for index.html.
// Run with:  node i18n-check.mjs        (Node >= 18, no dependency)
//
// English is the source language of the page. This script:
//   (a) collects every translatable key: t() / tr() literals in smith-core and
//       smith-app, and the static HTML (text nodes and the
//       title / aria-label / placeholder attributes, outside data-i18n-skip subtrees);
//   (b) loads smith-i18n + smith-i18n-data in a VM and checks, for fr / de / it / es:
//       an entry for every key, no extra key, identical {n} placeholders and HTML tags,
//       no empty value;
//   (c) checks that no French is left outside the data script (accented letters and
//       common unaccented words), comments and the native language names excepted.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, 'index.html'), 'utf8');
const grab = (id) => {
  const found = new RegExp(`<script id="${id}">([\\s\\S]*?)<\\/script>`).exec(html);
  if (!found) { console.error(`Block <script id="${id}"> not found in index.html`); process.exit(2); }
  return found[1];
};
const LANGS = ['fr', 'de', 'it', 'es'];
// Static texts that are symbols, units or node names: the same in every language, no entry needed.
const NEUTRAL = new Set(['Z', '0', 'f', 'Y', 'Z + Y', 'z, y', 'Ω, mS', 'R', 'L', 'C', 'RLC', '+', '−', 'Z (Ω)', 'Q', 'VSWR', '1', '2']);

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
const lines = (list, max = 12) => list.slice(0, max).join('\n        ') + (list.length > max ? `\n        … and ${list.length - max} more` : '');
const must = (list, what) => { if (list.length) throw new Error(`${what} (${list.length}):\n        ${lines(list)}`); };

/* ------------------------------------------------------------------ (a) keys */

const literal = (src) => new Function(`return ${src};`)();
const stripScriptComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/(^|[;{},)]\s+|^\s*)\/\/\s.*$/gm, '$1');

const keyUsage = new Map();      // key -> where first seen
const dynamic = [];              // t()/tr() calls whose key is not a plain literal
const note = (key, where) => { if (!keyUsage.has(key)) keyUsage.set(key, where); };
const lineOf = (src, index) => src.slice(0, index).split('\n').length;

for (const id of ['smith-core', 'smith-app']) {
  const src = stripScriptComments(grab(id));
  const call = /(?<![\w$.])(?:t|tr)\(\s*/g;
  let m;
  while ((m = call.exec(src))) {
    const rest = src.slice(call.lastIndex);
    const lit = /^('(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\$]|\\.)*`)\s*[,)]/.exec(rest);
    const where = `${id}:${lineOf(src, m.index)}`;
    if (lit) note(literal(lit[1]), where);
    else if (!/^p\.name\)/.test(rest)) dynamic.push(`${where}  ${rest.slice(0, 50).replace(/\n/g, ' ')}`);
  }
}

/** Static HTML of <body>, up to the first script: text nodes and translatable attributes. */
const staticKeys = () => {
  const start = html.indexOf('<body>');
  const body = html.slice(start, html.indexOf('<script', start));
  const VOID = new Set(['input', 'br', 'hr', 'img', 'meta', 'link', 'col', 'wbr']);
  const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
  const tok = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>|([^<]+)/g;
  const stack = [];
  let skip = -1;
  let m;
  while ((m = tok.exec(body))) {
    const where = `body:${lineOf(html, start + m.index)}`;
    if (m[4] !== undefined) {
      if (skip >= 0) continue;
      const key = decode(m[4]).trim();
      if (!key) continue;
      if (/\n/.test(key)) throw new Error(`${where}: text with a line break cannot be a key: "${key.slice(0, 40)}"`);
      note(key, where);
    } else if (m[2]) {
      const name = m[2].toLowerCase();
      if (m[1]) {
        const at = stack.lastIndexOf(name);
        if (at >= 0) { stack.length = at; if (skip >= at) skip = -1; }
        continue;
      }
      const attrs = m[3];
      if (skip < 0) {
        if (/\sdata-i18n-skip(\s|=|\/|$)/.test(` ${attrs}`)) skip = stack.length;
        else for (const a of attrs.matchAll(/\s(title|aria-label|placeholder)\s*=\s*"([^"]*)"/g)) note(decode(a[2]), where);
      }
      if (!VOID.has(name) && !/\/\s*$/.test(attrs)) stack.push(name);
      else if (skip === stack.length && /data-i18n-skip/.test(attrs)) skip = -1;
    }
  }
};
staticKeys();

const keys = [...keyUsage.keys()].filter((k) => !NEUTRAL.has(k));

/* ------------------------------------------------------------------ (b) dictionaries */

const ctx = vm.createContext({});
vm.runInContext(`${grab('smith-i18n')}\n;globalThis.SmithI18n = SmithI18n;`, ctx, { filename: 'smith-i18n' });
vm.runInContext(grab('smith-i18n-data'), ctx, { filename: 'smith-i18n-data' });
const dicts = ctx.SmithI18n.dicts;
const placeholders = (s) => (s.match(/\{\d+\}/g) || []).sort().join(' ');
const tags = (s) => (s.match(/<\/?[a-z]+>/gi) || []).sort().join(' ');

group('Keys');
test(`${keys.length} translatable keys found`, () => { if (keys.length < 100) throw new Error('suspiciously few keys'); });
test('t() / tr() always called with a plain string literal', () => must(dynamic, 'non-literal keys'));
test('SmithI18n.LANGS lists en + the four registered languages', () => {
  const codes = ctx.SmithI18n.LANGS.map((l) => l[0]).join();
  if (codes !== ['en', ...LANGS].join()) throw new Error(`LANGS is ${codes}`);
});

for (const lang of LANGS) {
  group(`Dictionary ${lang}`);
  const dict = dicts[lang] || {};
  test(`${lang}: an entry for every key`, () => must(keys.filter((k) => !(k in dict)).map((k) => `${keyUsage.get(k)}  ${k}`), 'missing entries'));
  test(`${lang}: no extra key`, () => must(Object.keys(dict).filter((k) => !keyUsage.has(k) || NEUTRAL.has(k)), 'keys not used by the page'));
  test(`${lang}: no empty value`, () => must(Object.keys(dict).filter((k) => typeof dict[k] !== 'string' || !dict[k].trim()), 'empty values'));
  test(`${lang}: same {n} placeholders as the English key`, () => must(Object.keys(dict).filter((k) => placeholders(k) !== placeholders(String(dict[k]))).map((k) => `${k}  ->  ${dict[k]}`), 'placeholder mismatch'));
  test(`${lang}: same inline tags as the English key`, () => must(Object.keys(dict).filter((k) => tags(k) !== tags(String(dict[k]))).map((k) => `${k}  ->  ${dict[k]}`), 'tag mismatch'));
}

/* ------------------------------------------------------------------ (c) leftover French */

group('No French left in the code');
const withoutData = html.replace(/<script id="smith-i18n-data">[\s\S]*?<\/script>/, (m) => m.replace(/[^\n]/g, ' '));
const code = withoutData
  .replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '))
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  .replace(/(^|[;{},)]\s+|^\s*)\/\/\s.*$/gm, '$1')
  .replace(/sans-serif/g, '')                                          // CSS font family
  .replace(/FILE_TAG = 'abaque-smith'/, "FILE_TAG = ''")               // saved-file identifier, kept for compatibility
  .replace(/\['(en|fr|de|it|es)', '[^']*'\]/g, '[]');                  // LANGS: native language names
const ACCENTS = /[àâäçéèêëîïôöùûüÿœÀÂÇÉÈÊËÎÏÔÙÛÜŒ«»]/;
const WORDS = new RegExp(`\\b(?:${[
  'lien', 'liens', 'fichier', 'fichiers', 'valeur', 'valeurs', 'charge', 'charges', 'erreur', 'erreurs',
  'ligne', 'lignes', 'reseau', 'projet', 'projets', 'abaque', 'entree', 'sortie', 'enregistre', 'enregistree',
  'ouvert', 'ouverte', 'aucun', 'aucune', 'depuis', 'dans', 'avec', 'sans', 'pour', 'cette', 'sont',
  'tous', 'toutes', 'pertes', 'parallele', 'montage', 'ecartement', 'saisie', 'reglage', 'longueur',
  'bande', 'cercle', 'cercles', 'bruit', 'echelle', 'debut', 'plage', 'courbe', 'illisible', 'inconnue',
  'transformateur', 'quadripole', 'gain', 'idealement',
].filter((w) => w !== 'gain').join('|')})\\b`, 'i');
const scan = (re) => code.split('\n').map((l, i) => [i + 1, l]).filter(([, l]) => re.test(l)).map(([n, l]) => `index.html:${n}  ${l.trim().slice(0, 100)}`);
test('no accented French letter outside the data script', () => must(scan(ACCENTS), 'accented letters'));
test('no common unaccented French word outside the data script', () => must(scan(WORDS), 'French words'));

/* ========================================================================== */
const total = passed + failures.length;
console.log(`\n${total} checks: ${passed} passed, ${failures.length} failed`);
if (failures.length) {
  failures.forEach((name) => console.log(`  - ${name}`));
  process.exit(1);
}
