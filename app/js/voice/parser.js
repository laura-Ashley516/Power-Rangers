// Text -> calendar changes (the "smart parser").
//
// Input: what Whisper heard, e.g. "add groceries on tuesday afternoon and cancel physio tomorrow".
// Output: one result per command found:
//   { ok: true,  change: <a change for rules.applyChange>, summary: 'Add Groceries to Tuesday afternoon' }
//   { ok: false, text: 'call my sister', reason: t('I did not hear a day.') }
//
// It only knows the client's world: their activity library, the days of the week, Morning / Afternoon /
// Evening, energy words, and a few verbs (add / move / cancel). That keeps it predictable and testable
// (see app/tests/sentences.js). Pure logic: no page, no storage.
//
// Track: C - Rules + voice

import { DAYS, PERIODS } from '../config.js';
import { t, tPeriod, dayInText, where as whereT } from '../i18n.js';

const WEEKDAYS = DAYS.map((d) => d.toLowerCase());
// French (client feedback, Nov 2026: the planner in French and English). Accents are removed by normalize().
const FR_WEEKDAYS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];

// Words that mean the same activity. Left side = what the user might say, right side = a word in the library name.
const ALIASES = {
  physio: 'physiotherapy', therapy: 'physiotherapy', grocery: 'groceries', shopping: 'groceries', supermarket: 'groceries',
  mass: 'church', service: 'church', walking: 'walk', stroll: 'walk', washing: 'laundry', wash: 'laundry', clothes: 'laundry',
  cook: 'meal', cooking: 'meal', dinner: 'meal', supper: 'meal', reading: 'read', relaxing: 'relax',
  phone: 'call', calling: 'call',
  // The client's own activities (store.js): words she is likely to say for them.
  doctor: 'medical', dentist: 'medical', appointment: 'medical', clinic: 'medical', checkup: 'medical', hospital: 'medical',
  clarinet: 'music', lesson: 'music', bedding: 'bed', sheets: 'bed', towels: 'bed',
  dishes: 'dishwasher', dish: 'dishwasher', mop: 'floor', mopping: 'floor', floor: 'floor', vacuuming: 'vacuum', hoover: 'vacuum',
  nap: 'rest', couch: 'rest', break: 'rest', hanging: 'hang', exercises: 'exercise', gym: 'exercise', friends: 'friend', prep: 'prep',
  // French words for the same activities (both the French names and the English names stem to the same word).
  marche: 'walk', promenade: 'walk', marcher: 'walk', epicerie: 'groceries', courses: 'groceries', magasin: 'groceries', emplettes: 'groceries',
  physiotherapie: 'physiotherapy', kine: 'physiotherapy', eglise: 'church', messe: 'church', musique: 'music', cours: 'music',
  medecin: 'medical', docteur: 'medical', dentiste: 'medical', rendezvous: 'medical', rdv: 'medical', clinique: 'medical', hopital: 'medical', medical: 'medical',
  repas: 'meal', cuisine: 'meal', cuisiner: 'meal', souper: 'meal', vaisselle: 'dishwasher', lavevaisselle: 'dishwasher',
  lessive: 'laundry', linge: 'laundry', laveuse: 'laundry', secheuse: 'laundry', etendre: 'hang', lit: 'bed', draps: 'bed', serviettes: 'bed',
  aspirateur: 'vacuum', plancher: 'floor', planchers: 'floor', sol: 'floor', ami: 'friend', amie: 'friend', amis: 'friend',
  loisir: 'hobby', repos: 'rest', sieste: 'rest', divan: 'rest', pause: 'rest', exercice: 'exercise', appel: 'call', appeler: 'call', telephoner: 'call',
  lecture: 'read', lire: 'read', preparation: 'prep',
};

const ENERGY_WORDS = {
  green: ['easy', 'green', 'light', 'low', 'simple', 'gentle', 'facile', 'vert', 'leger', 'legere', 'doux'],
  yellow: ['moderate', 'medium', 'yellow', 'normal', 'average', 'moyen', 'moyenne', 'modere', 'moderee', 'jaune'],
  red: ['hard', 'high', 'heavy', 'red', 'difficult', 'demanding', 'tiring', 'big', 'difficile', 'dur', 'dure', 'intense', 'fatigant', 'lourd', 'rouge'],
};

const STOP = new Set(('i me my mine the a an to on for at in from of with please can could would you also and then so just that this these it its ' +
  'um uh uhm er ah oh okay ok well is are be will ill id lets let us we our some energy level activity thing stuff ' +
  'next coming week day o clock oclock time around about by until till into back over there here really maybe ' +
  'need want have got going gonna remember remind go for do ' +
  'every each weekly task tasks event events ' +
  // French
  'le la les un une des du de d l au aux et puis pour avec mon ma mes ton ta sur en ce cette cet est je j me m moi on nous vous s se il elle ca ' +
  'euh ben bon alors aussi plait stp svp semaine jour prochain prochaine heure heures vers chaque toutes tous hebdomadaire hebdo faire fais').split(' '));

const REMOVE = /\b(cancel|cancelled|canceled|remove|delete|drop|skip|scrap|clear|get rid of|take off|no longer|not going|dont need|do not need|not doing|wont|annule|annuler|supprime|supprimer|enleve|enlever|retire|retirer|efface|effacer)\b/;
const MOVE = /\b(move|moved|reschedule|rescheduled|change|push|pushed|shift|switch|bring|postpone|put off|delay|instead|deplace|deplacer|change|changer|reporte|reporter|decale|decaler|bouge|bouger|plutot)\b/;
const ADD = /\b(add|put|schedule|book|plan|i have|ive got|i got|theres|there is|need to|want to|going to|im going|remind me|new|ajoute|ajouter|mets|mettre|planifie|planifier|prevois|prevoir|jai|il y a|rappelle moi|nouveau|nouvelle|je vais|je dois)\b/;
// "every week", "weekly", "every Sunday", "each Friday": for every week from now on (rules: series).
const WEEKLY = /\b(every|each|weekly|chaque|toutes les semaines|hebdomadaire|hebdo)\b/;
const MAKE = /\b(make|turn|set|rends|rendre)\b/;
const VERB_START = /^(add|put|schedule|book|plan|move|reschedule|change|push|shift|cancel|remove|delete|drop|skip|i have|ive got|i need|i want|remind|ajoute|ajouter|mets|deplace|deplacer|annule|annuler|supprime|enleve|retire|reporte|jai)\b/;

export function normalize(text) {
  return String(text || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')              // é -> e (French)
    .replace(/\b(\d{1,2})\s*h\s*(\d{2})\b/g, '$1:$2')              // 15h30, 15 h 30 -> 15:30
    .replace(/\b(\d{1,2})\s*h\b/g, '$1:00')                       // 15h -> 15:00
    .replace(/\bapres[\s-]?midi\b/g, 'apresmidi')
    .replace(/\bapres[\s-]?demain\b/g, 'apresdemain')
    .replace(/\brendez[\s-]?vous\b/g, 'rendezvous')
    .replace(/\blave[\s-]?vaisselle\b/g, 'lavevaisselle')
    .replace(/\bce soir\b/g, 'tonight')
    .replace(/\b(l|d|m|n|s|c|qu)[’']/g, '$1 ')                      // l'église -> l eglise (j'ai -> jai below)
    .replace(/\bchang(er|e|es) (les )?(draps|lit)( et (les )?serviettes)?\b/g, 'bedding')
    .replace(/[’']/g, '')
    .replace(/\bchang(e|es|ing) (the |my )?(bed|sheets|bedding)( and (the )?towels)?\b/g, 'bedding') // "change the bed" is a chore, not a move
    .replace(/\bafter (lunch|noon)\b/g, 'afternoon')
    .replace(/\bafter (dinner|supper)\b/g, 'evening')
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
  const dice = (2 * matched) / (p.length + n.length);
  // Short names for long activities: "walk" for "Walk + small groceries", "dishes" for "Unload dishwasher (part)".
  // Everything said is in the name: count it as a match, scored by how much of the name was said.
  const contained = p.every((x) => n.some((w) => sameWord(x, w)));
  return contained ? Math.max(dice, 0.6 + 0.3 * (p.length / n.length)) : dice;
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
    const from = prev === 'from' || prev === 'de' || prev === 'du' || (prev2 === 'from' && (prev === 'this' || prev === 'next' || prev === 'on'));
    let wd = WEEKDAYS.findIndex((d) => t === d || t === d + 's');
    if (wd < 0) wd = FR_WEEKDAYS.findIndex((d) => t === d || t === d + 's');
    if (wd >= 0) out.push({ kind: 'day', value: DAYS[wd], pos: i, from });
    else if (t === 'today' || t === 'aujourdhui') out.push({ kind: 'day', value: cap(dayOffset(0, now)), pos: i, from });
    else if (t === 'demain') out.push({ kind: 'day', value: cap(dayOffset(1, now)), pos: i, from });
    else if (t === 'apresdemain') out.push({ kind: 'day', value: cap(dayOffset(2, now)), pos: i, from });
    else if (t === 'tonight') { out.push({ kind: 'day', value: cap(dayOffset(0, now)), pos: i, from }); out.push({ kind: 'period', value: 'Evening', pos: i }); }
    else if (t === 'tomorrow') {
      const after = prev === 'after' && prev2 === 'day';
      out.push({ kind: 'day', value: cap(dayOffset(after ? 2 : 1, now)), pos: i, from });
    } else if (['morning', 'mornings', 'breakfast', 'matin', 'matinee'].includes(t)) out.push({ kind: 'period', value: 'Morning', pos: i });
    else if (['afternoon', 'afternoons', 'noon', 'lunchtime', 'apresmidi', 'midi'].includes(t)) out.push({ kind: 'period', value: 'Afternoon', pos: i });
    else if (['evening', 'evenings', 'night', 'tonight', 'soir', 'soiree', 'nuit'].includes(t)) out.push({ kind: 'period', value: 'Evening', pos: i });
    else if (/^\d{1,2}(:\d\d)?$/.test(t) && (['am', 'pm'].includes(tokens[i + 1]) || ['at', 'a', 'vers'].includes(prev) || t.includes(':'))) {
      let h = parseInt(t, 10);
      const min = t.includes(':') ? t.split(':')[1] : '00';
      const ampm = tokens[i + 1];
      if (ampm === 'pm' && h < 12) h += 12;
      if (ampm === 'am' && h === 12) h = 0;
      if (ampm !== 'am' && ampm !== 'pm' && h >= 1 && h <= 6) h += 12; // "at 3" = 3 pm
      if (h > 23) continue;
      // The clock time is kept too (client feedback, Nov 2026: activities can have an hour).
      out.push({ kind: 'period', value: h < 13 ? 'Morning' : h < 18 ? 'Afternoon' : 'Evening', pos: i, time: `${String(h).padStart(2, '0')}:${min}` });
    }
  }
  return out;
}

const TIME_TOKENS = new Set(['today', 'tonight', 'tomorrow', 'morning', 'mornings', 'afternoon', 'afternoons', 'evening', 'evenings',
  'night', 'noon', 'lunchtime', 'breakfast', 'am', 'pm', 'after', ...WEEKDAYS, ...WEEKDAYS.map((d) => d + 's'),
  'aujourdhui', 'demain', 'apresdemain', 'matin', 'matinee', 'apresmidi', 'midi', 'soir', 'soiree', 'nuit', 'vers', ...FR_WEEKDAYS, ...FR_WEEKDAYS.map((d) => d + 's')]);
const VERB_TOKENS = new Set(['make', 'turn', 'set', 'add', 'put', 'schedule', 'book', 'booked', 'plan', 'move', 'moved', 'reschedule', 'rescheduled', 'change', 'push', 'pushed',
  'shift', 'switch', 'bring', 'postpone', 'delay', 'cancel', 'cancelled', 'canceled', 'remove', 'delete', 'drop', 'skip', 'scrap', 'clear',
  'off', 'rid', 'take', 'get', 'not', 'dont', 'do', 'wont', 'longer', 'doing', 'instead', 'theres', 'ive', 'im', 'new',
  'ajoute', 'ajouter', 'mets', 'mettre', 'planifie', 'planifier', 'prevois', 'prevoir', 'jai', 'nouveau', 'nouvelle', 'vais', 'dois', 'rappelle',
  'deplace', 'deplacer', 'changer', 'reporte', 'reporter', 'decale', 'decaler', 'bouge', 'bouger', 'plutot',
  'annule', 'annuler', 'supprime', 'supprimer', 'enleve', 'enlever', 'retire', 'retirer', 'efface', 'effacer', 'rends', 'rendre', 'y', 'a']);
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

// "Move the appointment to Thursday morning because the clinic found me a spot": the reason is not
// part of the command (its words would be read as part of the activity name), so it is dropped.
const REASON = new Set(['because', 'cause', 'cuz', 'since']);
function dropReason(tokens) {
  const i = tokens.findIndex((t, k) => k > 0 && (REASON.has(t) || (t === 'so' && ['i', 'that', 'we', 'my'].includes(tokens[k + 1]))));
  return i > 0 ? tokens.slice(0, i) : tokens;
}

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
  return parts.map(dropReason).filter((p) => p.length);
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

const where = whereT;
const dayList = (many) => many.map((x) => dayInText(x.day)).join(', ');

// ctx: { library, schedule, now: Date (when the note was recorded), newId: () => string }
export function parse(text, ctx) {
  const now = ctx.now || new Date();
  const newId = ctx.newId || (() => 'v' + Math.random().toString(36).slice(2, 9));
  const commands = splitCommands(text);
  if (!commands.length) return [{ ok: false, text: '', reason: t('I did not hear any words.') }];
  return commands.map((tokens) => parseOne(tokens, ctx, now, newId));
}

function parseOne(tokens, ctx, now, newId) {
  const text = tokens.join(' ');
  const mentions = findMentions(tokens, now);
  const dayMentions = mentions.filter((m) => m.kind === 'day');
  const periods = pairPeriods(mentions);
  const phrase = activityPhrase(tokens);
  const energy = spokenEnergy(tokens);
  const everyWeek = WEEKLY.test(text);
  const intent = REMOVE.test(text) ? 'remove' : MOVE.test(text) ? 'move' : everyWeek && MAKE.test(text) ? 'weekly'
    : ADD.test(text) ? 'add' : dayMentions.length ? 'add' : null;
  const weeklyCard = (item) => !!(item.fixed && item.seriesId);
  const ew = everyWeek ? t(', every week') : '';

  if (!intent) return { ok: false, text, reason: t('I did not hear what to do (add, move or cancel) or a day.') };
  if (!phrase) return { ok: false, text, reason: t('I did not hear which activity.') };

  // "Make clean bathroom weekly (on Sunday evening)": the card there (or the only one this week) comes every week.
  if (intent === 'weekly') {
    const day = dayMentions[0]?.value || null;
    const period = (periods.find((p) => p.day && p.day.value === day) || periods[0])?.value || null;
    const r = findScheduled(phrase, ctx.schedule, day, period);
    if (r.found) {
      const { item, day: d, period: p } = r.found;
      if (weeklyCard(item)) return { ok: true, change: { type: 'move', id: item.id, toDay: d, toPeriod: p, everyWeek: true }, summary: t('Keep {name} on {where}, every week', { name: item.name, where: where(d, p) }) };
      return { ok: true, change: { type: 'setWeekly', id: item.id, on: true }, summary: t('Make {name} come every week on {where}', { name: item.name, where: where(d, p) }) };
    }
    if (r.many) return { ok: false, text, reason: t('I found “{name}” more than once ({days}). Please say which day.', { name: r.many[0].item.name, days: dayList(r.many) }) };
    if (!day) return { ok: false, text, reason: t('I could not find “{name}” this week. Please say the day.', { name: phrase }) };
    // Not in that place yet: add it there, every week.
  }

  if (intent === 'add' && everyWeek) {
    // Already there this week: make that one weekly instead of adding a second one.
    const day = dayMentions[0]?.value || null;
    const period = (periods.find((p) => p.day && p.day.value === day) || periods[0])?.value || null;
    if (day && period) {
      const r = findScheduled(phrase, ctx.schedule, day, period);
      if (r.found && !weeklyCard(r.found.item)) return { ok: true, change: { type: 'setWeekly', id: r.found.item.id, on: true }, summary: t('Make {name} come every week on {where}', { name: r.found.item.name, where: where(day, period) }) };
      if (r.found) return { ok: false, text, reason: t('{name} already comes every week on {where}.', { name: r.found.item.name, where: where(day, period) }) };
    }
  }

  if (intent === 'remove') {
    const day = dayMentions[0]?.value || null;
    const period = periods[0]?.value || null;
    const r = findScheduled(phrase, ctx.schedule, day, period);
    if (r.none) return { ok: false, text, reason: day ? t('I could not find “{name}” on {day} in the calendar.', { name: phrase, day: dayInText(day) }) : t('I could not find “{name}” in the calendar.', { name: phrase }) };
    if (r.many) return { ok: false, text, reason: t('I found “{name}” more than once ({days}). Please say which day.', { name: r.many[0].item.name, days: dayList(r.many) }) };
    const { item, day: d, period: p } = r.found;
    if (everyWeek && weeklyCard(item)) return { ok: true, change: { type: 'remove', id: item.id, everyWeek: true }, summary: t('Remove {name} from every week', { name: item.name }) };
    return { ok: true, change: { type: 'remove', id: item.id }, summary: t('Cancel {name} on {where}', { name: item.name, where: where(d, p) }) };
  }

  if (intent === 'move') {
    const sourceDay = dayMentions.find((m) => m.from)?.value || null;
    const targetDayMention = dayMentions.find((m) => !m.from) || null;
    const sourcePeriod = periods.find((p) => p.day && p.day.from)?.value || null;
    const targetPeriod = (periods.find((p) => p.day && !p.day.from) || periods.find((p) => !p.day))?.value || null;
    const r = findScheduled(phrase, ctx.schedule, sourceDay, sourcePeriod);
    if (r.none) return { ok: false, text, reason: sourceDay ? t('I could not find “{name}” on {day} in the calendar.', { name: phrase, day: dayInText(sourceDay) }) : t('I could not find “{name}” in the calendar.', { name: phrase }) };
    if (r.many) return { ok: false, text, reason: t('I found “{name}” more than once ({days}). Please say which day to move it from.', { name: r.many[0].item.name, days: dayList(r.many) }) };
    const { item, day, period } = r.found;
    const toDay = targetDayMention?.value || day;
    const toPeriod = targetPeriod || (targetDayMention ? period : null);
    if (!targetDayMention && !targetPeriod) return { ok: false, text, reason: t('I heard to move {name}, but not where to.', { name: item.name }) };
    if (everyWeek && !weeklyCard(item)) {
      const steps = day === toDay && period === toPeriod ? [] : [{ type: 'move', id: item.id, toDay, toPeriod }];
      return { ok: true, change: { type: 'batch', changes: [...steps, { type: 'setWeekly', id: item.id, on: true }] }, summary: t('Move {name} to {where}, every week', { name: item.name, where: where(toDay, toPeriod) }) };
    }
    return { ok: true, change: { type: 'move', id: item.id, toDay, toPeriod, everyWeek: everyWeek || undefined }, summary: t('Move {name} to {where}', { name: item.name, where: where(toDay, toPeriod) }) + ew };
  }

  // add
  const day = dayMentions[0]?.value || null;
  if (!day) return { ok: false, text, reason: t('I did not hear a day.') };
  const periodHit = periods.find((p) => p.day && p.day.value === day) || periods[0];
  let period = periodHit?.value || null;
  const time = periods.find((p) => p.time)?.time;
  let note = '';
  if (!period) { period = leastBusyPeriod(ctx.schedule, day); note = ' ' + t('(no time of day said; placed in the {period})', { period: tPeriod(period).toLowerCase() }); }
  const match = bestLibraryMatch(phrase, ctx.library);
  if (match) {
    const item = { ...match, fixed: false, id: newId(), activityId: match.id, energy: energy || match.energy, ...(time ? { time } : {}) };
    return { ok: true, change: { type: 'add', day, period, item, everyWeek: everyWeek || undefined }, summary: t('Add {name} to {where}', { name: match.name, where: where(day, period) }) + (time ? ` (${time})` : '') + ew + note };
  }
  const libraryItem = { id: newId(), name: cap(phrase), energy: energy || 'green', duration: 30, fixed: false, reminder: true };
  const item = { ...libraryItem, id: newId(), activityId: libraryItem.id, ...(time ? { time } : {}) };
  const energyNote = energy ? '' : ' ' + t('(energy not said; set to Easy, you can change it)');
  return { ok: true, change: { type: 'add', day, period, item, libraryItem, everyWeek: everyWeek || undefined }, summary: t('Add {name} (new) to {where}', { name: libraryItem.name, where: where(day, period) }) + (time ? ` (${time})` : '') + ew + note + energyNote };
}
