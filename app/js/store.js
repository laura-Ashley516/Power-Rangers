// Saving and loading the planner.
//
// - Data carries a version number; older saves are converted (migrate), never deleted.
// - The app asks the browser to keep its data permanently (requestPersistence).
// - Backup file save / load, and conversion to / from the device's backup lines.
//
// Track: B - Data + device

import { DAYS, PERIODS, APP_VERSION, DEFAULT_SPEECH_MODEL } from './config.js';
import { defaultLang, getLang } from './i18n.js';

export const STATE_VERSION = 5;
// Demo mode (Design Day): visitors use a separate example planner; her own planner is never touched.
const DEMO_FLAG = 'pwr-demo-mode';
export const isDemo = () => { try { return localStorage.getItem(DEMO_FLAG) === '1'; } catch (e) { return false; } };
const KEY_REAL = 'pwr-planner';
const KEY_DEMO = 'pwr-planner-demo';
const keyNow = () => (isDemo() ? KEY_DEMO : KEY_REAL);
// Switching reloads the page, so every screen starts again from the right planner.
export function setDemo(on) {
  try {
    if (on) { localStorage.setItem(DEMO_FLAG, '1'); localStorage.removeItem(KEY_DEMO); } else localStorage.removeItem(DEMO_FLAG);
  } catch (e) { /* storage unavailable */ }
  location.reload();
}
export function resetDemo() { try { localStorage.removeItem(KEY_DEMO); } catch (e) { /* */ } location.reload(); }
const LEGACY_KEYS = ['my-week-my-way-v2']; // first-try planner

export function uid() {
  return 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// The client's own activities (client meetings 1 and 2; see docs/client-needs.md).
// Generic names on purpose: the client wants others in the brain-injury community to be able to use it.
// Energy as she rated them; "(check)" ones were not rated by her yet and are a first guess.
// steps = a short checklist shown on the Today screen (memory aid).
const A = (id, name, energy, duration, extra = {}) => ({ id, name, energy, duration, fixed: false, reminder: true, steps: [], ...extra });
const seedLibrary = [
  A('walk', 'Walk + small groceries', 'green', 60, { fixed: true, note: 'Daily, non-negotiable. Recharges.', steps: ['Shopping bag', 'Keys and phone', 'Pen and note'] }),
  A('physio', 'Physiotherapy', 'yellow', 120, { fixed: true, appointment: true, note: 'Friday morning. Harder with a new exercise.', steps: ['Exercise sheet', 'Water bottle'] }),
  A('church', 'Church', 'yellow', 120, { fixed: true, quiet: true, note: 'Sunday morning.' }),
  A('exercise', 'Exercise class', 'yellow', 60, { fixed: true, note: 'Wednesday morning (energy to check).' }),
  A('music', 'Music lesson', 'yellow', 30, { fixed: true, quiet: true, note: 'Tuesday evening (energy to check).', steps: ['Instrument', 'Music book'] }),
  A('medical', 'Medical appointment', 'yellow', 60, { fixed: true, appointment: true, note: 'Best on Tuesday or Thursday.', steps: ['Health card', 'List of questions'] }),
  A('meal', 'Meal prep (part)', 'green', 30, { note: 'One meal over 3 days: meat, then vegetables, then rice or pasta.', steps: ['Set the stove timer'] }),
  A('dishes', 'Unload dishwasher (part)', 'green', 15, { note: 'Over 3 days: cutlery, plates, cups.' }),
  A('laundry', 'Laundry in washer / dryer', 'green', 20),
  A('hang', 'Hang laundry', 'yellow', 30, { note: 'Between green and yellow.' }),
  A('bed', 'Change bed and towels', 'red', 60, { note: 'Saturday. Rest on the couch after.' }),
  A('vacuum', 'Vacuum', 'yellow', 45, { note: 'A different day than washing floors (energy to check).' }),
  A('floors', 'Wash floors', 'yellow', 45, { note: 'After vacuuming, on another day (energy to check).' }),
  A('friend', 'Lunch with a friend', 'yellow', 120, { note: 'Every few weeks.' }),
  A('hobby', 'Hobby', 'green', 30),
  A('rest', 'Rest', 'rest', 30, { reminder: false, note: 'Only when you want it.' }),
];

// The same example activities in French (client feedback, Nov 2026). Used when the planner starts in French.
const FR_SEED = {
  walk: ['Marche + petites courses', 'Tous les jours. Ça recharge.', ['Sac', 'Clés et téléphone', 'Crayon et note']],
  physio: ['Physiothérapie', 'Vendredi matin. Plus dur avec un nouvel exercice.', ['Feuille d’exercices', 'Bouteille d’eau']],
  church: ['Église', 'Dimanche matin.'],
  exercise: ['Cours d’exercice', 'Mercredi matin (énergie à vérifier).'],
  music: ['Cours de musique', 'Mardi soir (énergie à vérifier).', ['Instrument', 'Cahier de musique']],
  medical: ['Rendez-vous médical', 'Mieux le mardi ou le jeudi.', ['Carte santé', 'Liste de questions']],
  meal: ['Préparer un repas (partie)', 'Un repas en 3 jours : viande, légumes, riz ou pâtes.', ['Mettre la minuterie du four']],
  dishes: ['Vider le lave-vaisselle (partie)', 'En 3 jours : ustensiles, assiettes, tasses.'],
  laundry: ['Lessive (laveuse / sécheuse)'],
  hang: ['Étendre le linge', 'Entre vert et jaune.'],
  bed: ['Changer les draps et les serviettes', 'Samedi. Repos sur le divan après.'],
  vacuum: ['Aspirateur', 'Pas le même jour que les planchers (énergie à vérifier).'],
  floors: ['Laver les planchers', 'Après l’aspirateur, un autre jour (énergie à vérifier).'],
  friend: ['Dîner avec une amie', 'Toutes les quelques semaines.'],
  hobby: ['Loisir'],
  rest: ['Repos', 'Seulement quand vous le voulez.'],
};
const FR_PARTS = { 'Meal prep 1/3: meat': 'Repas 1/3 : viande', 'Meal prep 2/3: vegetables': 'Repas 2/3 : légumes', 'Meal prep 3/3: rice or pasta': 'Repas 3/3 : riz ou pâtes',
  'Unload dishwasher 1/3: cutlery': 'Lave-vaisselle 1/3 : ustensiles', 'Unload dishwasher 2/3: plates': 'Lave-vaisselle 2/3 : assiettes', 'Unload dishwasher 3/3: cups': 'Lave-vaisselle 3/3 : tasses',
  'Short walk': 'Petite marche' };
function inFrench(a) {
  const fr = FR_SEED[a.activityId || a.id];
  if (!fr) return a;
  const out = { ...a, name: FR_PARTS[a.name] || (a.name === seedLibrary.find((x) => x.id === (a.activityId || a.id))?.name ? fr[0] : a.name) };
  if (fr[1] !== undefined) out.note = fr[1];
  if (fr[2]) out.steps = [...fr[2]];
  return out;
}

const lib = (id) => seedLibrary.find((a) => a.id === id);
const put = (schedule, day, period, id, extra = {}) => {
  const a = lib(id);
  schedule[day][period].push({ ...a, ...extra, id: uid(), activityId: a.id });
};

export const defaultSettings = () => ({
  contrast: false, large: false, alerts: true, sms: false, lead: 60, theme: 'sage',
  speechModel: DEFAULT_SPEECH_MODEL, demoDevice: false,
  connection: 'bluetooth', // 'bluetooth' or 'wifi' (docs/wifi-plan.md)
  wifi: { broker: '', username: '', password: '', code: '' },
  weekStart: 'Sunday',     // her kitchen calendar starts on Sunday
  startView: 'weekly',     // page to open: 'weekly' (Week) or 'day' (One day, on today)
  font: 'system',          // 'system', 'atkinson' or 'serif' (docs/design-evidence.md: let her choose)
  size: 'standard',        // 'small' 15 px · 'standard' 17 px · 'large' 19 px · 'xlarge' 22 px
  spacing: 'comfortable',  // or 'spacious' (W3C COGA: let users adjust white space)
  lang: defaultLang(),     // 'en' or 'fr' (client feedback, Nov 2026)
  appReminders: null,      // iPad reminders: null = automatic (on until a device is synced, then the device reminds alone); true / false = her choice
  wakeWord: false,         // listen for "Hey Cal" (voice/wakeword.js); off until she turns it on
  suggestionsOpen: false,  // the Suggestions panel is closed until she opens it
  layout: 'week',          // main screen: 'week' or 'day' (One day), switch at the top
  tutorialDone: false,     // the first-use tutorial was seen (or skipped)
});

export function emptySchedule() {
  const schedule = {};
  DAYS.forEach((d) => (schedule[d] = { Morning: [], Afternoon: [], Evening: [] }));
  return schedule;
}

// A realistic week built from what the client told us. At most 3 cards a day (target spec),
// every day within her energy rules, the red on Saturday followed by an easy evening.
export function clientWeek() {
  const s = emptySchedule();
  put(s, 'Sunday', 'Morning', 'church');
  put(s, 'Sunday', 'Afternoon', 'walk');
  ['Monday', 'Tuesday', 'Thursday', 'Saturday'].forEach((d) => put(s, d, 'Morning', 'walk'));
  put(s, 'Monday', 'Afternoon', 'meal', { name: 'Meal prep 1/3: meat' });
  put(s, 'Monday', 'Evening', 'vacuum');
  put(s, 'Tuesday', 'Afternoon', 'meal', { name: 'Meal prep 2/3: vegetables' });
  put(s, 'Tuesday', 'Evening', 'music');
  put(s, 'Wednesday', 'Morning', 'exercise');
  put(s, 'Wednesday', 'Morning', 'walk', { name: 'Short walk', duration: 30 });
  put(s, 'Wednesday', 'Afternoon', 'meal', { name: 'Meal prep 3/3: rice or pasta' });
  put(s, 'Thursday', 'Afternoon', 'medical');
  put(s, 'Thursday', 'Evening', 'dishes', { name: 'Unload dishwasher 1/3: cutlery' });
  put(s, 'Friday', 'Morning', 'physio');
  put(s, 'Friday', 'Afternoon', 'dishes', { name: 'Unload dishwasher 2/3: plates' });
  put(s, 'Saturday', 'Afternoon', 'bed');
  put(s, 'Saturday', 'Evening', 'laundry');
  return s;
}

// "Leftover" activities: to do this week when there is energy (her occupational therapist's
// paper calendars kept them at the bottom). Drag them into a day when ready.
export function clientLeftovers() {
  return [
    { ...lib('dishes'), id: uid(), activityId: 'dishes', name: 'Unload dishwasher 3/3: cups' },
    { ...lib('hang'), id: uid(), activityId: 'hang' },
    { ...lib('floors'), id: uid(), activityId: 'floors' },
    { ...lib('friend'), id: uid(), activityId: 'friend' },
  ];
}

// A weekly activity's details, without what belongs to one week (its id, where it is, voice marks).
const TEMPLATE_KEYS = ['name', 'energy', 'duration', 'reminder', 'steps', 'note', 'appointment', 'quiet', 'activityId', 'questions', 'time'];
export function seriesTemplate(item) {
  const t = {};
  TEMPLATE_KEYS.forEach((k) => { if (item[k] !== undefined) t[k] = JSON.parse(JSON.stringify(item[k])); });
  return t;
}

// Weekly activities become series (v5): one per weekly card, at its usual place (where it was before a
// "this week only" move). Weekly ones cancelled this week (state.skipped) become series too.
function toSeries(s) {
  s.series = {};
  DAYS.forEach((d) => PERIODS.forEach((p) => s.schedule[d][p].forEach((item) => {
    if (!item.fixed) return;
    const sid = uid();
    const home = item.home && DAYS.includes(item.home.day) && PERIODS.includes(item.home.period) ? item.home : { day: d, period: p };
    s.series[sid] = { item: seriesTemplate(item), day: home.day, period: home.period };
    item.seriesId = sid;
    delete item.home;
  })));
  (s.skipped || []).forEach((x) => {
    if (!x?.item || !DAYS.includes(x.day) || !PERIODS.includes(x.period)) return;
    s.series[uid()] = { item: seriesTemplate(x.item), day: x.day, period: x.period };
  });
  delete s.skipped;
}

export function fresh() {
  const state = {
    version: STATE_VERSION,
    library: seedLibrary.map((x) => ({ ...x, steps: [...x.steps] })),
    schedule: clientWeek(),
    leftovers: clientLeftovers(),
    previous: null,
    series: {},
    weeks: {},
    settings: defaultSettings(),
    changeLog: [],
    touched: false, // a new example planner: may be replaced by her planner kept on the device (v3)
    updatedAt: Date.now(),
  };
  if (getLang() === 'fr') {
    state.library = state.library.map(inFrench);
    DAYS.forEach((d) => PERIODS.forEach((p) => (state.schedule[d][p] = state.schedule[d][p].map(inFrench))));
    state.leftovers = state.leftovers.map(inFrench);
  }
  state.settings.lang = getLang();
  toSeries(state); // the example week's weekly activities (walk, church, physio…) become series
  return state;
}

// The first example week (v0.5 and before). Kept for the voice parser tests, whose sentences use it.
export function sampleWeek() {
  const B = (id, name, energy, duration, fixed = false) => ({ id, name, energy, duration, fixed, reminder: true, steps: [] });
  const library = [
    B('walk', 'Walk', 'green', 30), B('laundry', 'Laundry', 'yellow', 45), B('meal', 'Prepare a meal', 'yellow', 40),
    B('read', 'Read / relax', 'green', 30), B('physio', 'Physiotherapy', 'yellow', 30, true), B('church', 'Church', 'green', 90, true),
    B('shopping', 'Groceries', 'red', 60), B('call', 'Call family', 'green', 15),
  ];
  const schedule = emptySchedule();
  const add = (day, period, sid, aid) => schedule[day][period].push({ ...library.find((a) => a.id === aid), id: sid, activityId: aid });
  add('Monday', 'Morning', 's1', 'physio'); add('Monday', 'Afternoon', 's2', 'walk'); add('Tuesday', 'Morning', 's3', 'laundry');
  add('Wednesday', 'Afternoon', 's4', 'shopping'); add('Thursday', 'Morning', 's5', 'physio'); add('Friday', 'Evening', 's6', 'read');
  add('Sunday', 'Morning', 's7', 'church');
  const state = { ...fresh(), library, schedule, leftovers: [] };
  toSeries(state);
  return state;
}

// Bring any older save up to the current version. Never throws away activities.
export function migrate(raw) {
  if (!raw || typeof raw !== 'object' || !raw.library || !raw.schedule) return null;
  const s = { ...raw };
  if (!s.version || s.version < 3) {
    // v2 (first try): same shape, no version, no change log.
    s.changeLog = [];
    s.version = 3;
  }
  if (s.version < 4) {
    // v4: leftovers tray, steps. Existing weeks are kept as they are.
    s.version = 4;
  }
  // Make sure every day/period exists (before the weekly activities are read below).
  DAYS.forEach((d) => {
    s.schedule[d] = s.schedule[d] || {};
    PERIODS.forEach((p) => (s.schedule[d][p] = Array.isArray(s.schedule[d][p]) ? s.schedule[d][p] : []));
  });
  if (s.version < 5 || !s.series) {
    // v5: each week saved on its own (weeks) and weekly activities as series. The week saved so far is kept.
    toSeries(s);
    s.weeks = s.weeks && typeof s.weeks === 'object' ? s.weeks : {};
    s.version = 5;
  }
  s.settings = { ...defaultSettings(), ...(s.settings || {}) };
  // A saved planner from before v0.10 is her real planner: "touched" (so it is copied to the device and never
  // offered a "put back" from it). Only a brand-new example planner (fresh(): touched false) is untouched.
  if (s.touched === undefined) s.touched = true;
  // v0.10.2: "on" was only the default before, never her choice: iPad reminders become automatic (no double reminders).
  if (!s.settings.remindersAuto) { if (s.settings.appReminders === true) s.settings.appReminders = null; s.settings.remindersAuto = true; }
  // 'today' (v0.9.1, before One day replaced the Today screen) now opens One day.
  s.settings.startView = ['day', 'today'].includes(s.settings.startView) ? 'day' : 'weekly';
  if (s.settings.large && !raw.settings?.size) s.settings.size = 'large'; // old "Larger text" switch
  // v0.10: the more accurate speech model becomes the default once (she can still choose the small one).
  if (!s.settings.modelV10) { s.settings.speechModel = DEFAULT_SPEECH_MODEL; s.settings.modelV10 = true; }
  s.changeLog = Array.isArray(s.changeLog) ? s.changeLog : [];
  s.leftovers = Array.isArray(s.leftovers) ? s.leftovers : [];
  // v0.8.1: no energy tracking. Check-ins from older versions are deleted, not kept.
  delete s.checkins;
  delete s.loads;
  delete s.done;      // "Mark done" removed too: nothing about what she did is kept
  s.library = s.library.map((a) => ({ steps: [], ...a }));
  // v0.8: appointment cards and quiet times. Older saves get the flags for the usual activities.
  s.library = s.library.map((a) => ({
    ...a,
    appointment: a.appointment ?? ['medical', 'physio'].includes(a.id),
    quiet: a.quiet ?? ['church', 'music'].includes(a.id),
  }));
  return s;
}

export function load() {
  let raw = null;
  try { raw = localStorage.getItem(keyNow()); } catch (e) { /* storage unavailable */ }
  try {
    const saved = raw && JSON.parse(raw);
    // Before an update changes how things are saved: keep a copy of the save exactly as it was.
    if (saved && saved.appVersion !== APP_VERSION && !isDemo()) keepSafetyCopy(raw, 'before an update');
    const current = migrate(saved);
    if (current) { current.appVersion = APP_VERSION; return current; }
    if (isDemo()) return fresh(); // the demo always starts from the example week
    for (const k of LEGACY_KEYS) {
      const old = migrate(JSON.parse(localStorage.getItem(k)));
      if (old) return old; // the legacy copy is left in place
    }
  } catch (e) {
    // Never lose a save that could not be opened: it is kept as a safety copy (Settings → Restore).
    if (raw && !isDemo()) keepSafetyCopy(raw, 'could not be opened');
  }
  return fresh();
}

// ---------- safety copies ----------
// Copies of everything on this iPad: one a day (last 7 days), one before each update, one before each restore.
// A mistake or a bug never costs her the week: Settings → Keep my schedule safe → Restore.
// (They live in the same browser storage, so a backup file is still the way to move to another device.)
const COPIES_KEY = 'pwr-planner-copies';
const MAX_DAILY = 7, MAX_OTHER = 4;
const today = () => { const d = new Date(); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };

export function safetyCopies() {
  try { return JSON.parse(localStorage.getItem(COPIES_KEY)) || []; } catch (e) { return []; }
}

// data: the state, or the saved text exactly as it was. Returns true when a copy was kept.
export function keepSafetyCopy(data, reason, { daily = false } = {}) {
  if (isDemo()) return false; // demo changes are not her data
  try {
    let copies = safetyCopies();
    if (daily && copies.some((c) => c.daily && c.day === today())) return false;
    copies.unshift({ id: uid(), at: Date.now(), day: today(), daily, reason, data: typeof data === 'string' ? data : JSON.stringify(data) });
    copies = [...copies.filter((c) => c.daily).slice(0, MAX_DAILY), ...copies.filter((c) => !c.daily).slice(0, MAX_OTHER)].sort((a, b) => b.at - a.at);
    // Storage full: drop the oldest copies until it fits (the planner itself always comes first).
    while (copies.length) {
      try { localStorage.setItem(COPIES_KEY, JSON.stringify(copies)); return true; } catch (e) { copies.pop(); }
    }
  } catch (e) { /* storage unavailable */ }
  return false;
}

// A copy back as a state (brought up to date like any older save), or null.
export function readSafetyCopy(id) {
  const c = safetyCopies().find((x) => x.id === id);
  try { return c ? migrate(JSON.parse(c.data)) : null; } catch (e) { return null; }
}

export function save(state) {
  try {
    state.updatedAt = Date.now();
    localStorage.setItem(keyNow(), JSON.stringify(state));
    return true;
  } catch (e) {
    return false;
  }
}

// Ask the browser not to clear our data automatically. Returns 'granted', 'not granted' or 'unsupported'.
export async function requestPersistence() {
  if (!navigator.storage?.persist) return 'unsupported';
  try {
    if (await navigator.storage.persisted()) return 'granted';
    return (await navigator.storage.persist()) ? 'granted' : 'not granted';
  } catch (e) {
    return 'unsupported';
  }
}

export function countScheduled(schedule) {
  return DAYS.reduce((n, d) => n + PERIODS.reduce((m, p) => m + (schedule[d]?.[p]?.length || 0), 0), 0);
}

export const isScheduleEmpty = (schedule) => countScheduled(schedule) === 0;

// What is worth a new copy on the device: her activities, weeks and settings (not the save time).
export function backupSig(state) {
  const text = JSON.stringify([state.schedule, state.weeks, state.library, state.series, state.leftovers, state.settings, state.kept]);
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return `${text.length}-${(h >>> 0).toString(36)}`;
}

// ---------- The planner as compact bytes (v3: the automatic copy kept on the device) ----------
// gzip of the JSON (typically 5–30 KB). CompressionStream exists in Safari 16.4+, Chrome and Node 18+.
async function streamBytes(stream) { return new Uint8Array(await new Response(stream).arrayBuffer()); }
export async function packState(state) {
  const json = new TextEncoder().encode(JSON.stringify({ app: 'pwr-planner', savedAt: Date.now(), state }));
  return streamBytes(new Blob([json]).stream().pipeThrough(new CompressionStream('gzip')));
}
export async function unpackState(bytes) {
  const json = await streamBytes(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')));
  const data = JSON.parse(new TextDecoder().decode(json));
  const state = migrate(data?.state || data);
  if (!state) throw new Error('This file is not a planner backup.');
  return state;
}

// ---------- Backup file ----------

export function exportBackup(state) {
  const blob = new Blob([JSON.stringify({ app: 'pwr-planner', exportedAt: new Date().toISOString(), state }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `planner-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

export async function importBackup(file) {
  const data = JSON.parse(await file.text());
  const state = migrate(data?.state || data);
  if (!state) throw new Error('This file is not a planner backup.');
  return state;
}

// What the device should have: this week's lines and quiet times. Compared with the last sync to say
// "Device: up to date" or "not sent yet" in the top bar.
export function deviceSignature(state) {
  return state ? JSON.stringify(scheduleToLines(state.schedule, { times: true })) : '';
}

// ---------- Device backup lines (docs/protocol.md) ----------

const clean = (s) => String(s).replace(/\|/g, '/').trim();

// times: add the clock time as a 5th field ("…|green|10:30"). Only for firmware that says it understands it
// (protocol v2, HELLO|2); older firmware would read the time as the energy.
export function scheduleToLines(schedule, { times = false } = {}) {
  const lines = [];
  // Within a time of day, activities with a clock time come first, in time order (as on screen).
  const byTime = (list) => [...list].sort((a, b) => (a.time ? 0 : 1) - (b.time ? 0 : 1) || (a.time && b.time ? a.time.localeCompare(b.time) : 0));
  DAYS.forEach((day) => PERIODS.forEach((period) => byTime(schedule[day][period] || []).forEach((a) => {
    const base = `${day}|${period}|${clean(a.name)}|${a.energy === 'rest' ? 'green' : a.energy}`; // the device knows green / yellow / red
    lines.push(times && a.time ? `${base}|${a.time}` : base);
  })));
  return lines;
}

// Rebuild a schedule from `day|period|name|energy` lines. Library entries are matched by name,
// and created if missing, so the restored week stays editable.
export function linesToSchedule(lines, library) {
  const schedule = emptySchedule();
  const lib = library.map((x) => ({ ...x }));
  const titleCase = (s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  for (const line of lines) {
    const [d, p, name, energy, time] = line.split('|');
    const day = DAYS.find((x) => x.toLowerCase() === String(d).toLowerCase());
    const period = PERIODS.find((x) => x.toLowerCase() === String(p).toLowerCase()) || 'Morning';
    if (!day || !name) continue;
    const e = ['green', 'yellow', 'red'].includes(energy) ? energy : 'green';
    let item = lib.find((a) => a.name.toLowerCase() === name.toLowerCase());
    if (!item) {
      item = { id: uid(), name: titleCase(name), energy: e, duration: 30, fixed: false, reminder: true };
      lib.push(item);
    }
    schedule[day][period].push({ ...item, id: uid(), activityId: item.id, energy: item.energy === 'rest' ? 'rest' : e, ...(/^\d{1,2}:\d\d$/.test(time || '') ? { time } : {}) });
  }
  return { schedule, library: lib };
}

// ---------- Appointment cards and quiet times (v0.8) ----------

// A scheduled activity follows its library entry for these flags unless it has its own value.
const fromLibrary = (a, library, key) => a[key] ?? library.find((x) => x.id === a.activityId)?.[key] ?? false;
export const isAppointment = (a, library) => !!fromLibrary(a, library, 'appointment');
export const isQuiet = (a, library) => !!fromLibrary(a, library, 'quiet');

// Blocks where the device must not vibrate or beep: "day|period" lines (docs/protocol.md, QUIET).
export function quietLines(schedule, library) {
  const out = [];
  DAYS.forEach((day) => PERIODS.forEach((period) => {
    if ((schedule[day][period] || []).some((a) => isQuiet(a, library))) out.push(`${day}|${period}`);
  }));
  return out;
}

// Questions people often find useful to ask (question lists help patients ask more: Sansoni et al. 2015).
export const SUGGESTED_QUESTIONS = [
  'Is this normal for my recovery?',
  'What should I do more of, or less of?',
  'When should I come back?',
  'Can you write that down for me?',
  'Who do I call if it gets worse?',
];
