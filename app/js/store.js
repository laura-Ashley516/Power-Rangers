// Saving and loading the planner.
//
// - Data carries a version number; older saves are converted (migrate), never deleted.
// - The app asks the browser to keep its data permanently (requestPersistence).
// - Backup file save / load, and conversion to / from the device's backup lines.
//
// Track: B - Data + device

import { DAYS, PERIODS } from './config.js';

export const STATE_VERSION = 3;
const KEY = 'pwr-planner';
const LEGACY_KEYS = ['my-week-my-way-v2']; // first-try planner

export function uid() {
  return 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

const seedLibrary = [
  { id: 'walk', name: 'Walk', energy: 'green', duration: 30, fixed: false, reminder: true },
  { id: 'laundry', name: 'Laundry', energy: 'yellow', duration: 45, fixed: false, reminder: true },
  { id: 'meal', name: 'Prepare a meal', energy: 'yellow', duration: 40, fixed: false, reminder: true },
  { id: 'read', name: 'Read / relax', energy: 'green', duration: 30, fixed: false, reminder: false },
  { id: 'physio', name: 'Physiotherapy', energy: 'yellow', duration: 30, fixed: true, reminder: true },
  { id: 'church', name: 'Church', energy: 'green', duration: 90, fixed: true, reminder: true },
  { id: 'shopping', name: 'Groceries', energy: 'red', duration: 60, fixed: false, reminder: true },
  { id: 'call', name: 'Call family', energy: 'green', duration: 15, fixed: false, reminder: true },
];

export const defaultSettings = () => ({
  contrast: false, large: false, alerts: true, sms: false, lead: 60, theme: 'sage',
  speechModel: 'Xenova/whisper-tiny.en', demoDevice: false,
});

export function emptySchedule() {
  const schedule = {};
  DAYS.forEach((d) => (schedule[d] = { Morning: [], Afternoon: [], Evening: [] }));
  return schedule;
}

export function fresh() {
  const schedule = emptySchedule();
  schedule.Monday.Morning.push({ id: 's1', activityId: 'physio', name: 'Physiotherapy', energy: 'yellow', duration: 30, fixed: true, reminder: true });
  schedule.Monday.Afternoon.push({ id: 's2', activityId: 'walk', name: 'Walk', energy: 'green', duration: 30, fixed: false, reminder: true });
  schedule.Tuesday.Morning.push({ id: 's3', activityId: 'laundry', name: 'Laundry', energy: 'yellow', duration: 45, fixed: false, reminder: true });
  schedule.Wednesday.Afternoon.push({ id: 's4', activityId: 'shopping', name: 'Groceries', energy: 'red', duration: 60, fixed: false, reminder: true });
  schedule.Thursday.Morning.push({ id: 's5', activityId: 'physio', name: 'Physiotherapy', energy: 'yellow', duration: 30, fixed: true, reminder: true });
  schedule.Friday.Evening.push({ id: 's6', activityId: 'read', name: 'Read / relax', energy: 'green', duration: 30, fixed: false, reminder: false });
  schedule.Sunday.Morning.push({ id: 's7', activityId: 'church', name: 'Church', energy: 'green', duration: 90, fixed: true, reminder: true });
  return {
    version: STATE_VERSION,
    library: seedLibrary.map((x) => ({ ...x })),
    schedule,
    previous: null,
    settings: defaultSettings(),
    changeLog: [],
    updatedAt: Date.now(),
  };
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
  // Make sure every day/period exists.
  DAYS.forEach((d) => {
    s.schedule[d] = s.schedule[d] || {};
    PERIODS.forEach((p) => (s.schedule[d][p] = Array.isArray(s.schedule[d][p]) ? s.schedule[d][p] : []));
  });
  s.settings = { ...defaultSettings(), ...(s.settings || {}) };
  s.changeLog = Array.isArray(s.changeLog) ? s.changeLog : [];
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
    lines.push(`${day}|${period}|${clean(a.name)}|${a.energy}`);
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
    schedule[day][period].push({ ...item, id: uid(), activityId: item.id, energy: e });
  }
  return { schedule, library: lib };
}
