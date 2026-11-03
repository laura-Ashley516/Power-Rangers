// The client's energy rules, and the ONE place where schedule changes are applied.
//
// Every change (drag & drop, buttons, voice notes, undo) goes through applyChange(),
// so all inputs follow the same rules. Pure logic: no page, no storage. Tested in app/tests.
//
// Track: C - Rules + voice

import { DAYS, PERIODS, ENERGY, DAY_LOAD_LIMIT, REST_AFTER_RED_MIN } from './config.js';
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
  const tips = reds && neighbourRed ? ['High-energy activities on two days in a row; a quieter day in between can help.'] : [];
  if (list.length > 3) tips.push(`${list.length} activities: a day is easier to follow with 3 or fewer.`);
  // The client's rule: a red is followed by 30 minutes of rest. Shown as a reminder, never added for her.
  const red = list.find((a) => a.energy === 'red');
  const restNeeded = !!red && !list.some((a) => a.energy === 'rest');
  return { load, limit: DAY_LOAD_LIMIT, over: warnings.length > 0, warnings, tips, restNeeded, redName: red?.name || null, count: list.length };
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

// Weekly activities (fixed: true) come back to their usual place every week, but she can change one week
// freely (drag, menu or voice), with no question asked: the message says it is for this week only.
//   item.home     = its usual { day, period }, kept while it is moved somewhere else this week
//   state.skipped = weekly activities cancelled (or set aside) this week: [{ item, day, period }]
// startNewWeek() puts everything back. Client feedback, Nov 3 2026.
const usual = (item, day, period) => item.home || { day, period };
const forget = (next, id) => { next.skipped = (next.skipped || []).filter((x) => x.item.id !== id); };
const skip = (next, item, day, period) => {
  const h = usual(item, day, period);
  const copy = { ...item };
  delete copy.home;
  next.skipped = [...(next.skipped || []).filter((x) => x.item.id !== item.id), { item: copy, day: h.day, period: h.period }];
  return h;
};

// change:
//   { type:'add', day, period, item:{name, energy, duration, fixed, reminder, activityId?, id?}, libraryItem? }
//   { type:'move', id, toDay, toPeriod }
//   { type:'remove', id }
//   { type:'park', id }                      scheduled activity → leftovers tray ("later this week")
//   { type:'place', id, toDay, toPeriod }    leftover → a day
//   { type:'addLeftover', item }  /  { type:'dropLeftover', id }
//   { type:'update', id, fields }            change details of one scheduled activity (questions, notes, quiet…)
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
    forget(next, item.id);
    return done(next, `${item.name} added to ${where(day, period)}.`, [day], { type: 'remove', id: item.id, force: true }, item.id,
      item.fixed && change.libraryItem ? 'It repeats every week.' : '');
  }

  if (change.type === 'move') {
    const found = findItem(s, change.id);
    if (!found) return fail(state, 'That activity is no longer in the schedule.');
    const { day, period, item } = found;
    if (!DAYS.includes(change.toDay) || !PERIODS.includes(change.toPeriod)) return fail(state, 'I need a day and a time of day.');
    if (day === change.toDay && period === change.toPeriod) return fail(state, `${item.name} is already on ${where(day, period)}.`);
    s[day][period] = s[day][period].filter((x) => x.id !== item.id);
    let notice = '';
    if (item.fixed) {
      const h = usual(item, day, period);
      if (h.day === change.toDay && h.period === change.toPeriod) { delete item.home; notice = 'It is back in its usual place.'; }
      else { item.home = h; notice = `For this week only: next week it is back on ${where(h.day, h.period)}.`; }
    }
    s[change.toDay][change.toPeriod].push(item);
    return done(next, `Moved ${item.name} to ${where(change.toDay, change.toPeriod)}.`, [change.toDay],
      { type: 'move', id: item.id, toDay: day, toPeriod: period }, item.id, notice);
  }

  if (change.type === 'remove') {
    const found = findItem(s, change.id);
    if (!found) return fail(state, 'That activity is no longer in the schedule.');
    const { day, period, item } = found;
    s[day][period] = s[day][period].filter((x) => x.id !== item.id);
    if (item.fixed && !change.force) { // force = undoing an "add": nothing to bring back next week
      skip(next, item, day, period);
      return done(next, `${item.name} cancelled on ${where(day, period)}.`, [], { type: 'add', day, period, item: { ...item } }, item.id, 'For this week only: it comes back next week.');
    }
    return done(next, `${item.name} removed from ${where(day, period)}.`, [],
      { type: 'add', day, period, item: { ...item } }, item.id);
  }

  if (change.type === 'update') {
    const found = findItem(s, change.id);
    if (!found) return fail(state, 'That activity is no longer in the schedule.');
    const { day, period, item } = found;
    const allowed = ['questions', 'steps', 'afterNote', 'quiet', 'appointment', 'note'];
    const before = {};
    for (const k of Object.keys(change.fields || {})) {
      if (!allowed.includes(k)) continue;
      before[k] = item[k] === undefined ? null : clone(item[k]);
      item[k] = change.fields[k] === null ? undefined : clone(change.fields[k]);
    }
    s[day][period] = s[day][period].map((x) => (x.id === item.id ? JSON.parse(JSON.stringify(item)) : x));
    return done(next, `${item.name}: saved.`, [], { type: 'update', id: item.id, fields: before }, item.id);
  }

  if (change.type === 'park') {
    const found = findItem(s, change.id);
    if (!found) return fail(state, 'That activity is no longer in the schedule.');
    const { day, period, item } = found;
    s[day][period] = s[day][period].filter((x) => x.id !== item.id);
    next.leftovers = [...(next.leftovers || []), item];
    if (item.fixed) skip(next, item, day, period);
    return done(next, `${item.name} moved to “Later this week”.`, [], { type: 'place', id: item.id, toDay: day, toPeriod: period }, item.id,
      item.fixed ? 'Next week it is back in its usual place.' : '');
  }

  if (change.type === 'place') {
    const item = (next.leftovers || []).find((x) => x.id === change.id);
    if (!item) return fail(state, 'That activity is no longer in “Later this week”.');
    if (!DAYS.includes(change.toDay) || !PERIODS.includes(change.toPeriod)) return fail(state, 'I need a day and a time of day.');
    next.leftovers = next.leftovers.filter((x) => x.id !== item.id);
    if (item.fixed) {
      const h = (state.skipped || []).find((x) => x.item.id === item.id);
      forget(next, item.id);
      if (h && (h.day !== change.toDay || h.period !== change.toPeriod)) item.home = { day: h.day, period: h.period };
    }
    s[change.toDay][change.toPeriod].push(item);
    return done(next, `${item.name} added to ${where(change.toDay, change.toPeriod)}.`, [change.toDay], { type: 'park', id: item.id, force: true }, item.id);
  }

  if (change.type === 'addLeftover') {
    const item = { duration: 30, fixed: false, reminder: true, energy: 'green', ...change.item, id: change.item.id || uid() };
    next.leftovers = [...(next.leftovers || []), item];
    return done(next, `${item.name} added to “Later this week”.`, [], { type: 'dropLeftover', id: item.id }, item.id);
  }

  if (change.type === 'dropLeftover') {
    const item = (next.leftovers || []).find((x) => x.id === change.id);
    if (!item) return fail(state, 'That activity is no longer in “Later this week”.');
    next.leftovers = next.leftovers.filter((x) => x.id !== item.id);
    return done(next, `${item.name} removed from “Later this week”.`, [], { type: 'addLeftover', item: { ...item } }, item.id);
  }

  return fail(state, 'Unknown change.');
}

// ---------- "Suggest a lighter week" ----------
// For every day over the client's limits, propose moving ONE activity (red first, then yellow; weekly ones are not suggested)
// to the same time of day on the day where it fits best: the day stays within the rules, no red next
// to another red, at most 3 cards, and the lightest such day wins. If no day fits, it proposes
// "Later this week" (toDay = null). Days in `keep` are left alone. Pure: returns proposals, changes nothing.
// Returns [{ id, name, energy, fromDay, fromPeriod, toDay, toPeriod, why }]
export function suggestBalance(schedule, { keep = [] } = {}) {
  let s = clone(schedule);
  const out = [];
  for (const day of DAYS) {
    if (keep.includes(day)) continue; // a day she cannot change (e.g. a friend visiting): left as it is
    let guard = 0;
    while (checkDay(s, day).over && guard++ < 3) {
      const before = checkDay(s, day);
      const movable = PERIODS.flatMap((p) => (s[day][p] || []).filter((a) => !a.fixed && a.energy !== 'rest').map((a) => ({ a, p })))
        .sort((x, y) => (ENERGY[y.a.energy]?.load || 0) - (ENERGY[x.a.energy]?.load || 0));
      // Only moves that really help the busy day count (moving a green does not fix "red + yellow").
      const helps = (trial) => { const after = checkDay(trial, day); return after.warnings.length < before.warnings.length || (!after.over); };
      let best = null;
      for (const { a, p } of movable) {
        const without = clone(s);
        without[day][p] = without[day][p].filter((x) => x.id !== a.id);
        if (!helps(without)) continue;
        for (const target of DAYS) {
          if (target === day) continue;
          const trial = clone(without);
          trial[target][p].push(a);
          const t = checkDay(trial, target);
          if (t.over || t.tips.some((x) => x.startsWith('High-energy')) || t.count > 3) continue;
          if (!best || t.load < best.load) best = { a, p, target, load: t.load, trial };
        }
        if (best) break;
        // Nowhere fits this week: offer "Later this week" instead.
        best = { a, p, target: null, trial: without };
        break;
      }
      if (!best) break;
      out.push({ id: best.a.id, name: best.a.name, energy: best.a.energy, fromDay: day, fromPeriod: best.p, toDay: best.target, toPeriod: best.target ? best.p : null,
        why: before.warnings[0] || 'Too much for one day.' });
      s = best.trial;
    }
  }
  return out;
}

// Split one activity into parts on consecutive days (e.g. meal prep over 3 days: meat, vegetables, rice).
// Returns a list of 'add' changes. parts: [{ name }] ; startDay: first day ; period: time of day.
export function splitChanges(base, parts, startDay, period) {
  const start = DAYS.indexOf(startDay);
  return parts.map((part, i) => ({
    type: 'add', day: DAYS[(start + i) % 7], period,
    item: { ...base, id: undefined, name: `${base.name.replace(/\s*\(part\)$/i, '')} ${i + 1}/${parts.length}${part.name ? ': ' + part.name : ''}`, activityId: base.id },
  }));
}

export const restMinutes = REST_AFTER_RED_MIN;

// notice: what to tell her about a weekly activity ("for this week only…"), also part of message.
function done(state, message, daysToCheck, undo, itemId, notice = '') {
  const warnings = daysToCheck.flatMap((d) => checkDay(state.schedule, d).warnings.map((w) => `${d}: ${w}`));
  return { ok: true, state, message: notice ? `${message} ${notice}` : message, warnings, undo, itemId, notice };
}

// ---------- a new week ----------
// Weekly activities go back to their usual place, and the ones cancelled this week come back
// (only if that place does not already have the same activity). One-off activities stay as they are.
const sameActivity = (a, b) => (a.activityId && a.activityId === b.activityId) || a.name === b.name;

export function resetWeekly(schedule, skipped = []) {
  const s = clone(schedule);
  for (const day of DAYS) for (const period of PERIODS) {
    for (const item of [...(s[day][period] || [])]) {
      if (!item.fixed || !item.home) continue;
      const h = item.home;
      delete item.home;
      if (!DAYS.includes(h.day) || !PERIODS.includes(h.period)) continue;
      s[day][period] = s[day][period].filter((x) => x.id !== item.id);
      s[h.day][h.period].push(item);
    }
  }
  for (const { item, day, period } of skipped) {
    if (!s[day]?.[period] || s[day][period].some((x) => sameActivity(x, item))) continue;
    s[day][period].push(clone(item));
  }
  return s;
}

// The whole state on the first day of a new week.
export function startNewWeek(state) {
  const next = clone(state);
  const skipped = next.skipped || [];
  next.schedule = resetWeekly(next.schedule, skipped);
  const back = new Set(skipped.map((x) => x.item.id));
  next.leftovers = (next.leftovers || []).filter((x) => !back.has(x.id));
  next.skipped = [];
  next.kept = {};
  return next;
}

// A day's content in one string: "Keep this day as it is" stays valid only while the day is unchanged
// (and a different week has different ids, so a kept day never carries over).
export function daySignature(schedule, day) {
  return items(schedule, day).map((a) => a.id).sort().join(',');
}
