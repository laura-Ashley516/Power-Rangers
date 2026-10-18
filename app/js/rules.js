// The client's energy rules, and the ONE place where schedule changes are applied.
//
// Every change (drag & drop, buttons, voice notes, undo) goes through applyChange(),
// so all inputs follow the same rules. Pure logic: no page, no storage. Tested in app/tests.
//
// Track: C - Rules + voice

import { DAYS, PERIODS, ENERGY, DAY_LOAD_LIMIT } from './config.js';
import { uid } from './store.js';

const clone = (x) => JSON.parse(JSON.stringify(x));
const items = (schedule, day) => PERIODS.flatMap((p) => schedule[day]?.[p] || []);

export function dayLoad(schedule, day) {
  return items(schedule, day).reduce((n, a) => n + (ENERGY[a.energy] || ENERGY.green).load, 0);
}

// Neutral, non-blocking advice for one day. The client asked for warnings, not hard blocks.
export function checkDay(schedule, day) {
  const list = items(schedule, day);
  const count = (e) => list.filter((a) => a.energy === e).length;
  const reds = count('red'), yellows = count('yellow');
  const load = dayLoad(schedule, day);
  const warnings = [];
  if (reds > 1) warnings.push('More than one high-energy activity.');
  if (reds && yellows) warnings.push('A high and a moderate activity on the same day.');
  if (load > DAY_LOAD_LIMIT && !(reds > 1) && !(reds && yellows)) warnings.push('More than a full day of energy.');
  const i = DAYS.indexOf(day);
  const neighbourRed = [DAYS[i - 1], DAYS[i + 1]].some((d) => d && items(schedule, d).some((a) => a.energy === 'red'));
  const tips = reds && neighbourRed ? ['High-energy activities on two days in a row; a rest day in between can help.'] : [];
  return { load, limit: DAY_LOAD_LIMIT, over: warnings.length > 0, warnings, tips };
}

export function findItem(schedule, id) {
  for (const day of DAYS) for (const period of PERIODS) {
    const index = (schedule[day]?.[period] || []).findIndex((x) => x.id === id);
    if (index >= 0) return { day, period, index, item: schedule[day][period][index] };
  }
  return null;
}

const where = (day, period) => `${day} ${period.toLowerCase()}`;
const fail = (state, message) => ({ ok: false, state, message, warnings: [] });

// change:
//   { type:'add', day, period, item:{name, energy, duration, fixed, reminder, activityId?, id?}, libraryItem? }
//   { type:'move', id, toDay, toPeriod }
//   { type:'remove', id }
// Returns { ok, state (new object), message, warnings, undo (a change that reverses this one), itemId }
export function applyChange(state, change) {
  const next = clone(state);
  const s = next.schedule;

  if (change.type === 'add') {
    const { day, period } = change;
    if (!DAYS.includes(day) || !PERIODS.includes(period)) return fail(state, 'I need a day and a time of day.');
    if (change.libraryItem && !next.library.some((a) => a.id === change.libraryItem.id)) next.library.push({ ...change.libraryItem });
    const item = { duration: 30, fixed: false, reminder: true, energy: 'green', ...change.item, id: change.item.id || uid() };
    s[day][period].push(item);
    return done(next, `${item.name} added to ${where(day, period)}.`, [day], { type: 'remove', id: item.id, force: true }, item.id);
  }

  if (change.type === 'move') {
    const found = findItem(s, change.id);
    if (!found) return fail(state, 'That activity is no longer in the schedule.');
    const { day, period, item } = found;
    if (item.fixed && !change.force) return fail(state, `${item.name} is a fixed routine, so it cannot be moved.`);
    if (!DAYS.includes(change.toDay) || !PERIODS.includes(change.toPeriod)) return fail(state, 'I need a day and a time of day.');
    if (day === change.toDay && period === change.toPeriod) return fail(state, `${item.name} is already on ${where(day, period)}.`);
    s[day][period] = s[day][period].filter((x) => x.id !== item.id);
    s[change.toDay][change.toPeriod].push(item);
    return done(next, `Moved ${item.name} to ${where(change.toDay, change.toPeriod)}.`, [change.toDay],
      { type: 'move', id: item.id, toDay: day, toPeriod: period, force: true }, item.id);
  }

  if (change.type === 'remove') {
    const found = findItem(s, change.id);
    if (!found) return fail(state, 'That activity is no longer in the schedule.');
    const { day, period, item } = found;
    if (item.fixed && !change.force) return fail(state, `${item.name} is a fixed routine, so it cannot be removed.`);
    s[day][period] = s[day][period].filter((x) => x.id !== item.id);
    return done(next, `${item.name} removed from ${where(day, period)}.`, [],
      { type: 'add', day, period, item: { ...item } }, item.id);
  }

  return fail(state, 'Unknown change.');
}

function done(state, message, daysToCheck, undo, itemId) {
  const warnings = daysToCheck.flatMap((d) => checkDay(state.schedule, d).warnings.map((w) => `${d}: ${w}`));
  return { ok: true, state, message, warnings, undo, itemId };
}
