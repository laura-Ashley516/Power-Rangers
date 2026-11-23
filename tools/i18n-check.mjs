// Lists every English text that has no French text yet (app/js/i18n-fr.js).
// Usage: node tools/i18n-check.mjs [--json]
// Texts come from t('…') in app/js and from the fixed text of app/index.html.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const app = join(dirname(fileURLToPath(import.meta.url)), '..', 'app');
const { FR } = await import(join(app, 'js', 'i18n-fr.js'));
const keys = new Set();
const walk = (d) => readdirSync(d).forEach((f) => { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (p.endsWith('.js') && !p.endsWith('i18n-fr.js')) scan(readFileSync(p, 'utf8')); });
function scan(src) {
  for (const m of src.matchAll(/\bt\(\s*'((?:[^'\\]|\\.)*)'/g)) keys.add(m[1].replace(/\\n/g, '\n').replace(/\\'/g, "'"));
  for (const m of src.matchAll(/\bt\(\s*(\w+) [?>]=? [^?]*\? '((?:[^'\\]|\\.)*)' : '((?:[^'\\]|\\.)*)'/g)) { keys.add(m[2]); keys.add(m[3]); }
}
walk(join(app, 'js'));
// index.html: text between tags and the placeholder / aria-label / title attributes.
const html = readFileSync(join(app, 'index.html'), 'utf8').replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '');
for (const m of html.matchAll(/>([^<>]+)</g)) { const s = m[1].trim(); if (/[A-Za-z]{2}/.test(s) && !/^[\w.-]+$/.test(s) || /^[A-Z][a-z]+$/.test(s)) keys.add(s.replace(/\s+/g, ' ')); }
for (const m of html.matchAll(/(?:placeholder|aria-label|title)="([^"]+)"/g)) if (/[A-Za-z]{3}/.test(m[1])) keys.add(m[1]);
// Plural pairs written as t(n > 1 ? 'a' : 'b')
const missing = [...keys].filter((k) => FR[k] === undefined && /[A-Za-z]/.test(k));
if (process.argv.includes('--json')) console.log(JSON.stringify(missing, null, 1));
else { console.log(`${keys.size} texts, ${missing.length} without French`); missing.forEach((k) => console.log('  ' + JSON.stringify(k))); }
process.exitCode = missing.length ? 1 : 0;
