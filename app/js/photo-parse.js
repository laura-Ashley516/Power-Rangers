// Photo text -> calendar changes (client feedback, Nov 2026: "upload a picture into the app, turn the image
// into text, then add it to the schedule").
//
// Input: the text read from a photo (photo.js, or tools/photo_to_schedule.py), for example a paper schedule:
//     Monday                      Lundi
//     10:00 Physio                10 h 30 Physio
//     Afternoon: groceries        Après-midi : épicerie
//     Tuesday 2 pm dentist        Mardi soir cours de musique
// or a note with sentences ("Add laundry on Saturday morning"), which go to the voice parser.
//
// The algorithm, line by line:
//  1. Clean the reading errors photos often have (| _ — ~ bullets, several spaces).
//  2. A line that is only a day ("Monday", "LUNDI", "Mon.") starts that day; a line that is only a time of day
//     ("Morning", "Matin") starts that time of day. Next lines belong to them, like a paper calendar.
//  3. A line with a verb (add, move, cancel / ajoute, déplace, annule) is a sentence: the voice parser reads it.
//  4. Otherwise the line is an activity: its day (on the line or the current day), clock time ("10:30",
//     "10h30", "2 pm"), time of day (from the time, the words, or the current one), and the words left
//     are the activity. It is matched to "My activities" (same similarity as voice); else a new activity.
// Nothing is changed here: the result is a list of proposals that she ticks before anything is added.
// Pure logic (no page), tested in app/tests/run.js.
//
// Track: C - Rules + voice

import { DAYS, PERIODS, periodOfTime } from './config.js';
import { normalize, similarity, parse } from './voice/parser.js';
import { t, where } from './i18n.js';

const EN = DAYS.map((d) => d.toLowerCase());
const FR = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
const SHORT_EN = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const SHORT_FR = ['lun', 'mar', 'mer', 'jeu', 'ven', 'sam', 'dim'];
const PERIOD_WORDS = {
  Morning: ['morning', 'matin', 'matinee', 'am'],
  Afternoon: ['afternoon', 'apresmidi', 'pm', 'midi', 'noon'],
  Evening: ['evening', 'soir', 'soiree', 'night', 'nuit', 'tonight'],
};
const FILLER = new Set(['at', 'a', 'on', 'le', 'la', 'les', 'from', 'to', 'de', 'du', 'au', 'vers', 'h', 'and', 'et', 'the', 'in', 'en', 'pour', 'for']);
const VERB = /\b(add|put|schedule|book|move|reschedule|cancel|remove|delete|ajoute|ajouter|mets|deplace|deplacer|annule|annuler|supprime|enleve|retire|reporte)\b/;

function dayOf(token, alone) {
  let i = EN.indexOf(token);
  if (i < 0) i = FR.indexOf(token);
  if (i < 0 && alone) { i = SHORT_EN.indexOf(token); if (i < 0) i = SHORT_FR.indexOf(token); }
  if (i < 0 && /s$/.test(token)) { i = EN.indexOf(token.slice(0, -1)); if (i < 0) i = FR.indexOf(token.slice(0, -1)); }
  return i >= 0 ? DAYS[i] : null;
}
const periodWord = (token) => PERIODS.find((p) => PERIOD_WORDS[p].includes(token)) || null;

// "10:30", "10", with "am"/"pm" after it → "10:30" (24 h) or null.
function clockOf(tokens, i) {
  const m = /^(\d{1,2})(?::(\d{2}))?$/.exec(tokens[i] || '');
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] || '00';
  const ampm = tokens[i + 1];
  const hasColon = !!m[2];
  if (ampm === 'pm' && h < 12) h += 12;
  if (ampm === 'am' && h === 12) h = 0;
  if (!hasColon && ampm !== 'am' && ampm !== 'pm') return null; // a lone number is not a time ("3 parts")
  if (h > 23 || Number(min) > 59) return null;
  return `${String(h).padStart(2, '0')}:${min}`;
}

const cleanLine = (line) => String(line).replace(/([^\d\s]):/g, '$1 ').replace(/[|_~•·►▪●○■□\t]+/g, ' ').replace(/[—–]+/g, ' - ').replace(/\s+/g, ' ').trim();
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function bestMatch(phrase, library) {
  let best = null;
  for (const a of library) {
    const score = similarity(phrase, a.name);
    if (score >= 0.6 && (!best || score > best.score)) best = { a, score };
  }
  return best?.a || null;
}

// ctx: { library, schedule, now, newId }. Returns [{ line, ok, change?, summary?, reason? }].
export function parsePhotoText(text, ctx) {
  const newId = ctx.newId || (() => 'p' + Math.random().toString(36).slice(2, 9));
  const out = [];
  let day = null, period = null;
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = cleanLine(raw);
    if (!line || !/[a-zà-ÿ]{2}/i.test(line)) continue;
    const norm = normalize(line);
    const tokens = norm.split(' ').filter(Boolean);
    if (!tokens.length) continue;

    // A sentence with a verb: the voice parser (it knows add / move / cancel and "every week").
    if (VERB.test(norm)) {
      parse(line, ctx).forEach((r) => out.push({ line, ...r }));
      continue;
    }
    // Headers: a day alone, a time of day alone (or both: "Monday morning").
    const words = tokens.filter((w) => !FILLER.has(w));
    const lineDay = words.map((w) => dayOf(w, words.length <= 2)).find(Boolean) || null;
    const linePeriod = words.map(periodWord).find(Boolean) || null;
    const rest = [];
    let time = null;
    // The activity's words, taken from the line as written (accents and capitals kept).
    const rawWords = line.replace(/[:,;]/g, ' ').split(/\s+/).filter(Boolean);
    for (let i = 0; i < tokens.length; i++) {
      const w = tokens[i];
      const c = clockOf(tokens, i);
      if (c) { time = time || c; if (['am', 'pm'].includes(tokens[i + 1])) i++; continue; }
      if (dayOf(w, words.length <= 2) || periodWord(w) || FILLER.has(w) || /^\d+$/.test(w) || w === '-') continue;
      rest.push(w);
    }
    const restRaw = rawWords.filter((rw) => {
      const n = normalize(rw);
      return n && rest.includes(n.split(' ')[0]) && !/^\d/.test(n);
    });
    if (!rest.length) { // a header line
      if (lineDay) { day = lineDay; period = linePeriod; }
      else if (linePeriod) period = linePeriod;
      continue;
    }
    const d = lineDay || day;
    const p = periodOfTime(time) || linePeriod || period;
    if (!d) { out.push({ line, ok: false, reason: t('No day found for this line.') }); continue; }
    const usePeriod = p || 'Morning';
    const phrase = rest.join(' ');
    const match = bestMatch(phrase, ctx.library);
    const name = match ? match.name : cap(restRaw.join(' ') || phrase);
    const extra = time ? { time } : {};
    if (match) {
      out.push({ line, ok: true, change: { type: 'add', day: d, period: usePeriod, item: { ...match, fixed: false, id: newId(), activityId: match.id, ...extra } },
        summary: t('Add {name} to {where}', { name, where: where(d, usePeriod) }) + (time ? ` (${time})` : '') });
    } else {
      const libraryItem = { id: newId(), name, energy: 'green', duration: 30, fixed: false, reminder: true };
      out.push({ line, ok: true, change: { type: 'add', day: d, period: usePeriod, libraryItem, item: { ...libraryItem, id: newId(), activityId: libraryItem.id, ...extra } },
        summary: t('Add {name} (new) to {where}', { name, where: where(d, usePeriod) }) + (time ? ` (${time})` : '') });
    }
  }
  return out;
}
