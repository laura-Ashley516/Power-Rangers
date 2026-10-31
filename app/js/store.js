// Saving and loading the planner.
//
// - Data carries a version number; older saves are converted (migrate), never deleted.
// - The app asks the browser to keep its data permanently (requestPersistence).
// - Backup file save / load, and conversion to / from the device's backup lines.
//
// Track: B - Data + device

import { DAYS, PERIODS } from './config.js';

export const STATE_VERSION = 4;
const KEY = 'pwr-planner';
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

const lib = (id) => seedLibrary.find((a) => a.id === id);
const put = (schedule, day, period, id, extra = {}) => {
  const a = lib(id);
  schedule[day][period].push({ ...a, ...extra, id: uid(), activityId: a.id });
};

export const defaultSettings = () => ({
  contrast: false, large: false, alerts: true, sms: false, lead: 60, theme: 'sage',
  speechModel: 'Xenova/whisper-tiny.en', demoDevice: false,
  connection: 'bluetooth', // 'bluetooth' or 'wifi' (docs/wifi-plan.md)
  wifi: { broker: '', username: '', password: '', code: '' },
  weekStart: 'Sunday',     // her kitchen calendar starts on Sunday
  font: 'system',          // 'system', 'atkinson' or 'serif' (docs/design-evidence.md: let her choose)
  size: 'standard',        // 'small' 15 px · 'standard' 17 px · 'large' 19 px · 'xlarge' 22 px
  spacing: 'comfortable',  // or 'spacious' (W3C COGA: let users adjust white space)
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

export function fresh() {
  return {
    version: STATE_VERSION,
    library: seedLibrary.map((x) => ({ ...x, steps: [...x.steps] })),
    schedule: clientWeek(),
    leftovers: clientLeftovers(),
    previous: null,
    settings: defaultSettings(),
    changeLog: [],
    updatedAt: Date.now(),
  };
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
  return { ...fresh(), library, schedule, leftovers: [] };
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
  // Make sure every day/period exists.
  DAYS.forEach((d) => {
    s.schedule[d] = s.schedule[d] || {};
    PERIODS.forEach((p) => (s.schedule[d][p] = Array.isArray(s.schedule[d][p]) ? s.schedule[d][p] : []));
  });
  s.settings = { ...defaultSettings(), ...(s.settings || {}) };
  if (s.settings.large && !raw.settings?.size) s.settings.size = 'large'; // old "Larger text" switch
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
  try {
    const current = migrate(JSON.parse(localStorage.getItem(KEY)));
    if (current) return current;
    for (const k of LEGACY_KEYS) {
      const old = migrate(JSON.parse(localStorage.getItem(k)));
      if (old) return old; // the legacy copy is left in place
    }
  } catch (e) { /* fall through to fresh */ }
  return fresh();
}

export function save(state) {
  try {
    state.updatedAt = Date.now();
    localStorage.setItem(KEY, JSON.stringify(state));
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

// ---------- Device backup lines (docs/protocol.md) ----------

const clean = (s) => String(s).replace(/\|/g, '/').trim();

export function scheduleToLines(schedule) {
  const lines = [];
  DAYS.forEach((day) => PERIODS.forEach((period) => (schedule[day][period] || []).forEach((a) => {
    lines.push(`${day}|${period}|${clean(a.name)}|${a.energy === 'rest' ? 'green' : a.energy}`); // the device knows green / yellow / red
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
    const [d, p, name, energy] = line.split('|');
    const day = DAYS.find((x) => x.toLowerCase() === String(d).toLowerCase());
    const period = PERIODS.find((x) => x.toLowerCase() === String(p).toLowerCase()) || 'Morning';
    if (!day || !name) continue;
    const e = ['green', 'yellow', 'red'].includes(energy) ? energy : 'green';
    let item = lib.find((a) => a.name.toLowerCase() === name.toLowerCase());
    if (!item) {
      item = { id: uid(), name: titleCase(name), energy: e, duration: 30, fixed: false, reminder: true };
      lib.push(item);
    }
    schedule[day][period].push({ ...item, id: uid(), activityId: item.id, energy: item.energy === 'rest' ? 'rest' : e });
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
