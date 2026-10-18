// Text -> calendar changes (the "smart parser").
//
// Input: what Whisper heard, e.g. "add groceries on tuesday afternoon and cancel physio tomorrow".
// Output: one result per command found:
//   { ok: true,  change: <a change for rules.applyChange>, summary: 'Add Groceries to Tuesday afternoon' }
//   { ok: false, text: 'call my sister', reason: 'I did not hear a day.' }
//
// It only knows the client's world: their activity library, the days of the week, Morning / Afternoon /
// Evening, energy words, and a few verbs (add / move / cancel). That keeps it predictable and testable
// (see app/tests/sentences.js). Pure logic: no page, no storage.
//
// Track: C - Rules + voice

import { DAYS, PERIODS } from '../config.js';

const WEEKDAYS = DAYS.map((d) => d.toLowerCase());

// Words that mean the same activity. Left side = what the user might say, right side = a word in the library name.
const ALIASES = {
  physio: 'physiotherapy', therapy: 'physiotherapy', grocery: 'groceries', shopping: 'groceries', supermarket: 'groceries',
  mass: 'church', service: 'church', walking: 'walk', stroll: 'walk', washing: 'laundry', wash: 'laundry', clothes: 'laundry',
  cook: 'meal', cooking: 'meal', dinner: 'meal', lunch: 'meal', supper: 'meal', reading: 'read', relaxing: 'relax', rest: 'relax',
  phone: 'call', calling: 'call',
};

const ENERGY_WORDS = {
  green: ['easy', 'green', 'light', 'low', 'simple', 'gentle'],
  yellow: ['moderate', 'medium', 'yellow', 'normal', 'average'],
  red: ['hard', 'high', 'heavy', 'red', 'difficult', 'demanding', 'tiring', 'big'],
};

const STOP = new Set(('i me my mine the a an to on for at in from of with please can could would you also and then so just that this these it its ' +
  'um uh uhm er ah oh okay ok well is are be will ill id lets let us we our some energy level activity thing stuff ' +
  'next coming week day o clock oclock time around about by until till into back over there here really maybe ' +
  'need want have got going gonna remember remind').split(' '));

const REMOVE = /\b(cancel|cancelled|canceled|remove|delete|drop|skip|scrap|clear|get rid of|take off|no longer|not going|dont need|do not need|not doing|wont)\b/;
const MOVE = /\b(move|moved|reschedule|rescheduled|change|push|pushed|shift|switch|bring|postpone|put off|delay|instead)\b/;
const ADD = /\b(add|put|schedule|book|plan|i have|ive got|i got|theres|there is|need to|want to|going to|im going|remind me|new)\b/;
const VERB_START = /^(add|put|schedule|book|plan|move|reschedule|change|push|shift|cancel|remove|delete|drop|skip|i have|ive got|i need|i want|remind)\b/;

export function normalize(text) {
  return String(text || '').toLowerCase()
    .replace(/[’']/g, '')
    .replace(/(\d)\s*([ap])\.?\s*m\b\.?/g, '$1 $2m')   // 3pm, 3 p.m. -> 3 pm
    .replace(/[^a-z0-9:\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const stem = (w) => (ALIASES[w] || w).replace(/(ies)$/, 'y').replace(/s$/, '');

// ---------- similarity between what the user said and an activity name ----------

function lev(a, b) {
  const m = a.length, n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return d[m][n];
}

function sameWord(a, b) {
  if (a === b) return true;
  if (a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a))) return true; // physio ~ physiotherapy
  const longest = Math.max(a.length, b.length);
  return longest >= 5 && lev(a, b) / longest <= 0.25;                                     // small spelling slips
}

const words = (s) => normalize(s).split(' ').filter((w) => w && !STOP.has(w)).map(stem);

export function similarity(phrase, name) {
  const p = [...new Set(words(phrase))], n = [...new Set(words(name))];
  if (!p.length || !n.length) return 0;
  const matched = n.filter((w) => p.some((x) => sameWord(x, w))).length;
  return (2 * matched) / (p.length + n.length);
}

const MATCH = 0.6;

function bestLibraryMatch(phrase, library) {
  let best = null;
  for (const a of library) {
    const score = similarity(phrase, a.name);
    if (score >= MATCH && (!best || score > best.score)) best = { item: a, score };
  }
  return best?.item || null;
}

// ---------- days, periods, times ----------

function dayOffset(days, now) {
  const today = (now.getDay() + 6) % 7; // Monday = 0
  return WEEKDAYS[(today + days) % 7];
}

// Returns mentions with token positions: { kind:'day'|'period', value, pos, from }
function findMentions(tokens, now) {
  const out = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i], prev = tokens[i - 1], prev2 = tokens[i - 2];
    const from = prev === 'from' || (prev2 === 'from' && (prev === 'this' || prev === 'next' || prev === 'on'));
    const wd = WEEKDAYS.findIndex((d) => t === d || t === d + 's');
    if (wd >= 0) out.push({ kind: 'day', value: DAYS[wd], pos: i, from });
    else if (t === 'today') out.push({ kind: 'day', value: cap(dayOffset(0, now)), pos: i, from });
    else if (t === 'tonight') { out.push({ kind: 'day', value: cap(dayOffset(0, now)), pos: i, from }); out.push({ kind: 'period', value: 'Evening', pos: i }); }
    else if (t === 'tomorrow') {
      const after = prev === 'after' && prev2 === 'day';
      out.push({ kind: 'day', value: cap(dayOffset(after ? 2 : 1, now)), pos: i, from });
    } else if (['morning', 'mornings', 'breakfast'].includes(t)) out.push({ kind: 'period', value: 'Morning', pos: i });
    else if (['afternoon', 'afternoons', 'noon', 'lunchtime'].includes(t)) out.push({ kind: 'period', value: 'Afternoon', pos: i });
    else if (['evening', 'evenings', 'night', 'tonight'].includes(t)) out.push({ kind: 'period', value: 'Evening', pos: i });
    else if (/^\d{1,2}(:\d\d)?$/.test(t) && (['am', 'pm'].includes(tokens[i + 1]) || prev === 'at')) {
      let h = parseInt(t, 10);
      const ampm = tokens[i + 1];
      if (ampm === 'pm' && h < 12) h += 12;
      if (ampm !== 'am' && ampm !== 'pm' && h >= 1 && h <= 6) h += 12; // "at 3" = 3 pm
      out.push({ kind: 'period', value: h < 12 ? 'Morning' : h < 17 ? 'Afternoon' : 'Evening', pos: i, time: true });
    }
  }
  return out;
}

const TIME_TOKENS = new Set(['today', 'tonight', 'tomorrow', 'morning', 'mornings', 'afternoon', 'afternoons', 'evening', 'evenings',
  'night', 'noon', 'lunchtime', 'breakfast', 'am', 'pm', 'after', ...WEEKDAYS, ...WEEKDAYS.map((d) => d + 's')]);
const VERB_TOKENS = new Set(['add', 'put', 'schedule', 'book', 'booked', 'plan', 'move', 'moved', 'reschedule', 'rescheduled', 'change', 'push', 'pushed',
  'shift', 'switch', 'bring', 'postpone', 'delay', 'cancel', 'cancelled', 'canceled', 'remove', 'delete', 'drop', 'skip', 'scrap', 'clear',
  'off', 'rid', 'take', 'get', 'not', 'dont', 'do', 'wont', 'longer', 'doing', 'instead', 'theres', 'ive', 'im', 'new']);
const ENERGY_TOKENS = new Set(Object.values(ENERGY_WORDS).flat());

function activityPhrase(tokens) {
  return tokens.filter((t, i) => !TIME_TOKENS.has(t) && !VERB_TOKENS.has(t) && !ENERGY_TOKENS.has(t) && !STOP.has(t)
    && !(/^\d{1,2}(:\d\d)?$/.test(t))).join(' ').trim();
}

function spokenEnergy(tokens) {
  for (const [energy, list] of Object.entries(ENERGY_WORDS)) if (tokens.some((t) => list.includes(t))) return energy;
  return null;
}

// Attach each period to the day mention right before it (or right after), else leave it free.
function pairPeriods(mentions) {
  const days = mentions.filter((m) => m.kind === 'day');
  return mentions.filter((m) => m.kind === 'period').map((p) => {
    const before = days.filter((d) => d.pos <= p.pos && p.pos - d.pos <= 2).pop();
    const after = days.find((d) => d.pos > p.pos && d.pos - p.pos <= 2);
    return { ...p, day: before || after || null };
  });
}

// ---------- main ----------

function splitCommands(text) {
  const parts = [];
  for (const sentence of String(text || '').split(/[.!?;]+/)) {
    const tokens = normalize(sentence).split(' ').filter(Boolean);
    let current = [];
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      const rest = tokens.slice(i + 1).join(' ');
      if ((t === 'and' || t === 'then' || t === 'also') && current.length && VERB_START.test(rest.replace(/^(then|also) /, ''))) {
        parts.push(current); current = []; continue;
      }
      current.push(t);
    }
    if (current.length) parts.push(current);
  }
  return parts.filter((p) => p.length);
}

function leastBusyPeriod(schedule, day) {
  return PERIODS.reduce((best, p) => ((schedule[day]?.[p]?.length || 0) < (schedule[day]?.[best]?.length || 0) ? p : best), 'Morning');
}

function scheduledItems(schedule) {
  const out = [];
  DAYS.forEach((day) => PERIODS.forEach((period) => (schedule[day]?.[period] || []).forEach((item) => out.push({ day, period, item }))));
  return out;
}

function findScheduled(phrase, schedule, day, period) {
  const scored = scheduledItems(schedule)
    .filter((x) => (!day || x.day === day) && (!period || x.period === period))
    .map((x) => ({ ...x, score: similarity(phrase, x.item.name) }))
    .filter((x) => x.score >= MATCH);
  if (!scored.length) return { none: true };
  const top = Math.max(...scored.map((x) => x.score));
  const best = scored.filter((x) => x.score === top);
  return best.length === 1 ? { found: best[0] } : { many: best };
}

const where = (day, period) => `${day} ${period.toLowerCase()}`;

// ctx: { library, schedule, now: Date (when the note was recorded), newId: () => string }
export function parse(text, ctx) {
  const now = ctx.now || new Date();
  const newId = ctx.newId || (() => 'v' + Math.random().toString(36).slice(2, 9));
  const commands = splitCommands(text);
  if (!commands.length) return [{ ok: false, text: '', reason: 'I did not hear any words.' }];
  return commands.map((tokens) => parseOne(tokens, ctx, now, newId));
}

function parseOne(tokens, ctx, now, newId) {
  const text = tokens.join(' ');
  const mentions = findMentions(tokens, now);
  const dayMentions = mentions.filter((m) => m.kind === 'day');
  const periods = pairPeriods(mentions);
  const phrase = activityPhrase(tokens);
  const energy = spokenEnergy(tokens);
  const intent = REMOVE.test(text) ? 'remove' : MOVE.test(text) ? 'move' : ADD.test(text) ? 'add' : dayMentions.length ? 'add' : null;

  if (!intent) return { ok: false, text, reason: 'I did not hear what to do (add, move or cancel) or a day.' };
  if (!phrase) return { ok: false, text, reason: 'I did not hear which activity.' };

  if (intent === 'remove') {
    const day = dayMentions[0]?.value || null;
    const period = periods[0]?.value || null;
    const r = findScheduled(phrase, ctx.schedule, day, period);
    if (r.none) return { ok: false, text, reason: `I could not find “${phrase}”${day ? ' on ' + day : ''} in the calendar.` };
    if (r.many) return { ok: false, text, reason: `I found “${r.many[0].item.name}” more than once (${r.many.map((x) => x.day).join(', ')}). Please say which day.` };
    const { item, day: d, period: p } = r.found;
    return { ok: true, change: { type: 'remove', id: item.id }, summary: `Cancel ${item.name} on ${where(d, p)}` };
  }

  if (intent === 'move') {
    const sourceDay = dayMentions.find((m) => m.from)?.value || null;
    const targetDayMention = dayMentions.find((m) => !m.from) || null;
    const sourcePeriod = periods.find((p) => p.day && p.day.from)?.value || null;
    const targetPeriod = (periods.find((p) => p.day && !p.day.from) || periods.find((p) => !p.day))?.value || null;
    const r = findScheduled(phrase, ctx.schedule, sourceDay, sourcePeriod);
    if (r.none) return { ok: false, text, reason: `I could not find “${phrase}”${sourceDay ? ' on ' + sourceDay : ''} in the calendar.` };
    if (r.many) return { ok: false, text, reason: `I found “${r.many[0].item.name}” more than once (${r.many.map((x) => x.day).join(', ')}). Please say which day to move it from.` };
    const { item, day, period } = r.found;
    const toDay = targetDayMention?.value || day;
    const toPeriod = targetPeriod || (targetDayMention ? period : null);
    if (!targetDayMention && !targetPeriod) return { ok: false, text, reason: `I heard to move ${item.name}, but not where to.` };
    return { ok: true, change: { type: 'move', id: item.id, toDay, toPeriod }, summary: `Move ${item.name} to ${where(toDay, toPeriod)}` };
  }

  // add
  const day = dayMentions[0]?.value || null;
  if (!day) return { ok: false, text, reason: 'I did not hear a day.' };
  let period = (periods.find((p) => p.day && p.day.value === day) || periods[0])?.value || null;
  let note = '';
  if (!period) { period = leastBusyPeriod(ctx.schedule, day); note = ` (no time of day said; placed in the ${period.toLowerCase()})`; }
  const match = bestLibraryMatch(phrase, ctx.library);
  if (match) {
    const item = { ...match, id: newId(), activityId: match.id, energy: energy || match.energy };
    return { ok: true, change: { type: 'add', day, period, item }, summary: `Add ${match.name} to ${where(day, period)}${note}` };
  }
  const libraryItem = { id: newId(), name: cap(phrase), energy: energy || 'green', duration: 30, fixed: false, reminder: true };
  const item = { ...libraryItem, id: newId(), activityId: libraryItem.id };
  const energyNote = energy ? '' : ' (energy not said; set to Easy, you can change it)';
  return { ok: true, change: { type: 'add', day, period, item, libraryItem }, summary: `Add ${libraryItem.name} (new) to ${where(day, period)}${note}${energyNote}` };
}
