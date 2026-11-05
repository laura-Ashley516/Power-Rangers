// The client's energy rules, and the ONE place where schedule changes are applied.
//
// Every change (drag & drop, buttons, voice notes, undo) goes through applyChange(),
// so all inputs follow the same rules. Pure logic: no page, no storage. Tested in app/tests.
//
// Track: C - Rules + voice

import { DAYS, PERIODS, ENERGY, DAY_LOAD_LIMIT, REST_AFTER_RED_MIN } from './config.js';
import { uid, emptySchedule, seriesTemplate } from './store.js';

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

// ---------- weekly activities ("every week") ----------
// Every week is saved on its own: state.schedule is the week on screen (state.shownWeek = the date of its first
// day), state.weeks holds the others. A weekly activity is a series: state.series[sid] = { item, day, period },
// its usual place. Each week holds its own copy (card.seriesId, card.fixed = true), so:
//   - "this week only" (the default for drag, menu and voice) changes one week;
//   - "every week" changes the series and the weeks already planned after this one;
//   - a week opened for the first time starts with the weekly activities only.
// No question is asked; the message says which it was. Client feedback, Nov 3 and Nov 4 2026.
const isWeekly = (next, item) => !!(item?.seriesId && next.series?.[item.seriesId]);
const laterWeeks = (next) => Object.keys(next.weeks || {}).filter((k) => k > (next.shownWeek || '')).sort();
const findSeriesCard = (schedule, sid, day, period) => {
  for (const d of day ? [day] : DAYS) for (const p of period ? [period] : PERIODS) {
    const item = (schedule[d]?.[p] || []).find((x) => x.seriesId === sid);
    if (item) return { day: d, period: p, item };
  }
  return null;
};
const pull = (schedule, day, period, id) => { schedule[day][period] = schedule[day][period].filter((x) => x.id !== id); };

// Start a series from a card; the weeks already planned after this one get it too. A one-time copy of the same
// activity already in that place there becomes the weekly one (no second card: she often added it by hand first).
const sameActivity = (a, b) => (a.activityId && a.activityId === b.activityId) || a.name === b.name;
function startSeries(next, item, day, period, sid = uid()) {
  next.series = { ...(next.series || {}), [sid]: { item: seriesTemplate(item), day, period } };
  item.seriesId = sid;
  item.fixed = true;
  for (const k of laterWeeks(next)) {
    if (findSeriesCard(next.weeks[k], sid)) continue;
    const slot = next.weeks[k][day][period];
    const oneTime = slot.find((x) => !x.seriesId && sameActivity(x, item));
    if (oneTime) Object.assign(oneTime, { seriesId: sid, fixed: true, adopted: true });
    else slot.push({ ...seriesTemplate(item), id: uid(), seriesId: sid, fixed: true });
  }
  return sid;
}

// End a series: the cards of the weeks after this one go too. Returns them, so it can be undone.
function endSeries(next, sid) {
  const removed = [];
  for (const k of laterWeeks(next)) {
    const f = findSeriesCard(next.weeks[k], sid);
    if (f?.item.adopted) { delete f.item.seriesId; delete f.item.adopted; f.item.fixed = false; removed.push({ week: k, ...f, adopted: true }); }
    else if (f) { pull(next.weeks[k], f.day, f.period, f.item.id); removed.push({ week: k, ...f }); }
  }
  next.series = { ...next.series };
  delete next.series[sid];
  return removed;
}

// A new usual place: the weeks after this one move their card if it was still in the old usual place.
function moveSeries(next, sid, day, period) {
  const old = next.series[sid];
  for (const k of laterWeeks(next)) {
    const f = findSeriesCard(next.weeks[k], sid, old.day, old.period);
    if (f) { pull(next.weeks[k], f.day, f.period, f.item.id); next.weeks[k][day][period].push(f.item); }
  }
  next.series = { ...next.series, [sid]: { ...old, day, period } };
}

// A week that was never opened: its weekly activities, each in its usual place.
export function weekFromSeries(series = {}) {
  const s = emptySchedule();
  Object.entries(series).forEach(([sid, x]) => {
    if (s[x.day]?.[x.period]) s[x.day][x.period].push({ ...clone(x.item), id: uid(), seriesId: sid, fixed: true });
  });
  return s;
}

// Show the week that starts on `key`: the week on screen is saved in state.weeks first.
export function openWeek(state, key) {
  if (state.shownWeek === key) return state;
  const next = clone(state);
  next.weeks = next.weeks || {};
  if (next.shownWeek) next.weeks[next.shownWeek] = next.schedule;
  next.schedule = next.weeks[key] || weekFromSeries(next.series);
  delete next.weeks[key];
  next.shownWeek = key;
  return next;
}

// change:
//   { type:'add', day, period, item:{name, energy, duration, fixed, reminder, activityId?, id?}, libraryItem? }
//   { type:'move', id, toDay, toPeriod }
//   { type:'remove', id }
//   { type:'park', id }                      scheduled activity → leftovers tray ("later this week")
//   { type:'place', id, toDay, toPeriod }    leftover → a day
//   { type:'addLeftover', item }  /  { type:'dropLeftover', id }
//   { type:'update', id, fields }            change details of one scheduled activity (questions, notes, energy…)
//   { type:'setWeekly', id, on }             make a card weekly in its place, or stop it coming back
//   { type:'batch', changes:[…] }            several changes as one (one Undo)
//   everyWeek: true on add / move / remove / update = for every week from now on (see "weekly activities")
// Returns { ok, state (new object), message, warnings, undo (a change that reverses this one), itemId }
export function applyChange(state, change) {
  const next = clone(state);
  const s = next.schedule;

  if (change.type === 'add') {
    const { day, period } = change;
    if (!DAYS.includes(day) || !PERIODS.includes(period)) return fail(state, 'I need a day and a time of day.');
    if (change.libraryItem && !next.library.some((a) => a.id === change.libraryItem.id)) next.library.push({ ...change.libraryItem });
    const item = { duration: 30, fixed: false, reminder: true, energy: 'green', ...change.item, id: change.item.id || uid() };
    // A copy of a weekly activity stays weekly (e.g. undoing "remove for this week"); anything else starts as one-time.
    if (!isWeekly(next, item)) { item.fixed = false; delete item.seriesId; }
    s[day][period].push(item);
    if (change.everyWeek && !item.seriesId) {
      startSeries(next, item, day, period);
      return done(next, `${item.name} added to ${where(day, period)}.`, [day], { type: 'remove', id: item.id, everyWeek: true }, item.id,
        `It comes back every week on ${where(day, period)}.`);
    }
    return done(next, `${item.name} added to ${where(day, period)}.`, [day], { type: 'remove', id: item.id, force: true }, item.id,
      item.seriesId || change.silentNotice ? '' : 'Only this week. To repeat it every week, tap it.');
  }

  if (change.type === 'move') {
    const found = findItem(s, change.id);
    if (!found) return fail(state, 'That activity is no longer in the schedule.');
    const { day, period, item } = found;
    if (!DAYS.includes(change.toDay) || !PERIODS.includes(change.toPeriod)) return fail(state, 'I need a day and a time of day.');
    const to = { day: change.toDay, period: change.toPeriod };
    const same = day === to.day && period === to.period;
    // Already there this week, but "every week" can still make it the usual place (e.g. moved there last time).
    const usualElsewhere = isWeekly(next, item) && (next.series[item.seriesId].day !== to.day || next.series[item.seriesId].period !== to.period);
    if (same && !(change.everyWeek && usualElsewhere)) return fail(state, `${item.name} is already on ${where(day, period)}.`);
    if (!same) {
      s[day][period] = s[day][period].filter((x) => x.id !== item.id);
      s[to.day][to.period].push(item);
    }
    const moved = same ? `${item.name} stays on ${where(to.day, to.period)}.` : `Moved ${item.name} to ${where(to.day, to.period)}.`;
    if (!isWeekly(next, item)) return done(next, moved, [to.day], { type: 'move', id: item.id, toDay: day, toPeriod: period }, item.id);
    const usual = next.series[item.seriesId];
    if (change.everyWeek) {
      const back = change.usual || to; // undo passes the old usual place
      const before = { day: usual.day, period: usual.period };
      moveSeries(next, item.seriesId, back.day, back.period);
      return done(next, moved, [to.day], { type: 'move', id: item.id, toDay: day, toPeriod: period, everyWeek: true, usual: before }, item.id,
        `Every week from now on: ${where(back.day, back.period)}.`);
    }
    const notice = usual.day === to.day && usual.period === to.period ? 'It is back in its usual place.'
      : `For this week only: every other week it stays on ${where(usual.day, usual.period)}.`;
    return done(next, moved, [to.day], { type: 'move', id: item.id, toDay: day, toPeriod: period }, item.id, notice);
  }

  if (change.type === 'remove') {
    const found = findItem(s, change.id);
    if (!found) return fail(state, 'That activity is no longer in the schedule.');
    const { day, period, item } = found;
    s[day][period] = s[day][period].filter((x) => x.id !== item.id);
    if (isWeekly(next, item) && change.everyWeek) {
      const sid = item.seriesId;
      const series = clone(next.series[sid]);
      const later = endSeries(next, sid);
      return done(next, `${item.name} removed from every week.`, [], { type: 'restoreSeries', sid, series, card: { day, period, item: clone(item) }, later }, item.id,
        'It will not come back.');
    }
    if (isWeekly(next, item)) {
      return done(next, `${item.name} removed from ${where(day, period)}.`, [], { type: 'add', day, period, item: { ...item } }, item.id,
        'For this week only: it comes back next week.');
    }
    return done(next, `${item.name} removed from ${where(day, period)}.`, [],
      { type: 'add', day, period, item: { ...item } }, item.id);
  }

  if (change.type === 'update') {
    const found = findItem(s, change.id);
    if (!found) return fail(state, 'That activity is no longer in the schedule.');
    const { day, period, item } = found;
    const allowed = ['questions', 'steps', 'afterNote', 'quiet', 'appointment', 'note', 'energy'];
    if (change.fields?.energy !== undefined && !ENERGY[change.fields.energy]) return fail(state, 'Unknown energy level.');
    const before = {};
    const set = (target) => {
      for (const k of Object.keys(change.fields || {})) {
        if (!allowed.includes(k)) continue;
        target[k] = change.fields[k] === null ? undefined : clone(change.fields[k]);
      }
    };
    for (const k of Object.keys(change.fields || {})) if (allowed.includes(k)) before[k] = item[k] === undefined ? null : clone(item[k]);
    set(item);
    s[day][period] = s[day][period].map((x) => (x.id === item.id ? JSON.parse(JSON.stringify(item)) : x));
    const every = change.everyWeek && isWeekly(next, item);
    if (every) {
      // The usual details and the weeks already planned after this one.
      const sid = item.seriesId;
      next.series = { ...next.series, [sid]: { ...next.series[sid], item: { ...next.series[sid].item } } };
      set(next.series[sid].item);
      for (const k of laterWeeks(next)) { const f = findSeriesCard(next.weeks[k], sid); if (f) set(f.item); }
    }
    return done(next, `${item.name}: saved.`, [day], { type: 'update', id: item.id, fields: before, everyWeek: every }, item.id,
      every ? 'Saved for every week.' : '');
  }

  if (change.type === 'park') {
    const found = findItem(s, change.id);
    if (!found) return fail(state, 'That activity is no longer in the schedule.');
    const { day, period, item } = found;
    s[day][period] = s[day][period].filter((x) => x.id !== item.id);
    next.leftovers = [...(next.leftovers || []), item];
    return done(next, `${item.name} moved to “Later this week”.`, [], { type: 'place', id: item.id, toDay: day, toPeriod: period }, item.id,
      isWeekly(next, item) ? 'For this week only: next week it is back in its usual place.' : '');
  }

  if (change.type === 'place') {
    const item = (next.leftovers || []).find((x) => x.id === change.id);
    if (!item) return fail(state, 'That activity is no longer in “Later this week”.');
    if (!DAYS.includes(change.toDay) || !PERIODS.includes(change.toPeriod)) return fail(state, 'I need a day and a time of day.');
    next.leftovers = next.leftovers.filter((x) => x.id !== item.id);
    if (!isWeekly(next, item)) { item.fixed = false; delete item.seriesId; }
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

  if (change.type === 'setWeekly') {
    const found = findItem(s, change.id);
    if (!found) return fail(state, 'That activity is no longer in the schedule.');
    const { day, period, item } = found;
    if (change.on) {
      if (isWeekly(next, item)) return fail(state, `${item.name} already comes back every week.`);
      const at = change.usual || { day, period };
      startSeries(next, item, at.day, at.period, change.sid);
      return done(next, `${item.name} now comes back every week.`, [], { type: 'setWeekly', id: item.id, on: false }, item.id,
        `Every week on ${where(at.day, at.period)}.`);
    }
    if (!isWeekly(next, item)) return fail(state, `${item.name} is already only this week.`);
    const sid = item.seriesId;
    const series = clone(next.series[sid]);
    const later = endSeries(next, sid);
    item.fixed = false;
    delete item.seriesId;
    return done(next, `${item.name} is now only this week.`, [], { type: 'restoreSeries', sid, series, card: { day, period, item: { ...clone(item), seriesId: sid, fixed: true } }, later }, item.id,
      'It will not come back next week.');
  }

  // Undo of "remove every week" and "stop every week": the series, this week's card, the later weeks' cards.
  if (change.type === 'restoreSeries') {
    const { sid, series, card, later = [] } = change;
    next.series = { ...(next.series || {}), [sid]: clone(series) };
    const here = findItem(s, card.item.id);
    if (here) Object.assign(here.item, { seriesId: sid, fixed: true });
    else s[card.day][card.period].push({ ...clone(card.item), seriesId: sid, fixed: true });
    for (const x of later) {
      const w = next.weeks?.[x.week];
      if (!w || findSeriesCard(w, sid)) continue;
      const kept = x.adopted && findItem(w, x.item.id);
      if (kept) Object.assign(kept.item, { seriesId: sid, fixed: true, adopted: true });
      else w[x.day][x.period].push(clone(x.item));
    }
    return done(next, `${card.item.name} comes back every week again.`, [card.day], { type: 'remove', id: card.item.id, everyWeek: true }, card.item.id);
  }

  if (change.type === 'batch') {
    let cur = state;
    const undos = [], messages = [], warnings = [], notices = [];
    let itemId = null;
    for (const c of change.changes || []) {
      const r = applyChange(cur, c);
      if (!r.ok) return r;
      cur = r.state;
      undos.unshift(r.undo);
      messages.push(r.message.replace(r.notice ? ` ${r.notice}` : '', ''));
      if (r.notice) notices.push(r.notice);
      warnings.push(...r.warnings);
      itemId = r.itemId || itemId;
    }
    const notice = notices[notices.length - 1] || '';
    return { ok: true, state: cur, message: [...messages, notice].filter(Boolean).join(' '), warnings: [...new Set(warnings)], notice,
      undo: { type: 'batch', changes: undos }, itemId };
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

// A day's content in one string: "Keep this day as it is" stays valid only while the day is unchanged
// (and a different week has different ids, so a kept day never carries over).
export function daySignature(schedule, day) {
  return items(schedule, day).map((a) => a.id).sort().join(',');
}
