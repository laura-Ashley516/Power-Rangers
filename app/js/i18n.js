// French and English (client feedback, Nov 2026: everything in both languages).
//
// - The English text is the key: t('Saved on this iPad') gives the French text when the planner is in French,
//   or the English text itself. A missing French text never breaks anything: the English one shows.
// - {name} in a text is filled from the second argument: t('{name} added.', { name }).
// - Days and times of day are stored in English inside the planner (Monday, Morning) and only shown in French.
// - The page's fixed text (index.html) is translated by translatePage(), which remembers the English original.
// Works without a page too (the tests run in Node, in English).

import { FR } from './i18n-fr.js';

let lang = defaultLang(); // until the saved choice is read (main.js)

export const getLang = () => lang;
export const isFr = () => lang === 'fr';

export function setLang(l) {
  lang = l === 'fr' ? 'fr' : 'en';
  if (typeof document !== 'undefined') document.documentElement.lang = lang;
}

// The language to start in, before she has chosen: the iPad's own language.
export function defaultLang() {
  const nav = typeof navigator !== 'undefined' ? navigator.language || '' : '';
  return /^fr\b/i.test(nav) ? 'fr' : 'en';
}

export function t(en, vars) {
  let s = lang === 'fr' && FR[en] ? FR[en] : en;
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : m));
  return s;
}

const FR_DAYS = { Monday: 'Lundi', Tuesday: 'Mardi', Wednesday: 'Mercredi', Thursday: 'Jeudi', Friday: 'Vendredi', Saturday: 'Samedi', Sunday: 'Dimanche' };
const FR_PERIODS = { Morning: 'Matin', Afternoon: 'Après-midi', Evening: 'Soir' };

export const tDay = (d) => (lang === 'fr' ? FR_DAYS[d] || d : d);
// A day inside a sentence: "Monday" / "lundi" (French days take no capital in a sentence).
export const dayInText = (d) => (lang === 'fr' ? (FR_DAYS[d] || d).toLowerCase() : d);
export const tPeriod = (p) => (lang === 'fr' ? FR_PERIODS[p] || p : p);
// "Monday morning" / "lundi matin"
export const where = (day, period) => (lang === 'fr'
  ? `${tDay(day).toLowerCase()} ${tPeriod(period).toLowerCase()}`
  : `${day} ${String(period).toLowerCase()}`);
// "this morning" / "ce matin" (used on the One day view)
export const thisPeriod = (p) => (lang === 'fr' ? { Morning: 'ce matin', Afternoon: 'cet après-midi', Evening: 'ce soir' }[p] : `this ${p.toLowerCase()}`);

// Dates in the planner's language (the iPad may be set to another one).
export const locale = () => (lang === 'fr' ? 'fr-CA' : 'en-CA');
export const fmtDate = (d, opts) => d.toLocaleDateString(locale(), opts);
export const fmtTime = (d) => d.toLocaleTimeString(locale(), { hour: 'numeric', minute: '2-digit' });

// "10:30" → "10:30 am" in English, "10 h 30" in French.
export function clock(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ''));
  if (!m) return '';
  const h = Number(m[1]), min = m[2];
  if (lang === 'fr') return `${h} h ${min === '00' ? '' : min}`.trim();
  const h12 = h % 12 || 12;
  return `${h12}${min === '00' ? '' : ':' + min} ${h < 12 ? 'am' : 'pm'}`;
}

// ---------- the page's fixed text ----------
// Every text node and label in index.html, remembered in English the first time, then shown in the chosen language.
const ATTRS = ['placeholder', 'aria-label', 'title'];
const remembered = []; // [node, attr | null, english]

export function translatePage(root) {
  if (typeof document === 'undefined') return;
  if (!remembered.length) {
    const walker = document.createTreeWalker(root || document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = n.nodeValue.trim();
      if (text && FR[text] !== undefined) remembered.push([n, null, n.nodeValue]);
    }
    (root || document.body).querySelectorAll(ATTRS.map((a) => `[${a}]`).join(',')).forEach((el) => {
      ATTRS.forEach((a) => { const v = el.getAttribute(a); if (v && FR[v.trim()] !== undefined) remembered.push([el, a, v]); });
    });
    document.querySelectorAll('title').forEach((el) => remembered.push([el.firstChild, null, el.textContent]));
  }
  for (const [node, attr, en] of remembered) {
    if (!node) continue;
    const text = lang === 'fr' ? en.replace(en.trim(), FR[en.trim()] || en.trim()) : en;
    if (attr) node.setAttribute(attr, text); else node.nodeValue = text;
  }
}
