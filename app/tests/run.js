// Run with:  node app/tests/run.js   (Node 18+; no packages needed)
// Checks the energy rules, the parser against tests/sentences.js, and the device backup lines.

import { DAYS, PERIODS } from '../js/config.js';
import { fresh, sampleWeek, scheduleToLines, linesToSchedule, emptySchedule, migrate, isAppointment, isQuiet, quietLines, load, save, safetyCopies, keepSafetyCopy, readSafetyCopy } from '../js/store.js';
import { APP_VERSION } from '../js/config.js';
import { checkDay, applyChange, findItem, suggestBalance, splitChanges, daySignature, openWeek, weekFromSeries } from '../js/rules.js';
import { parse } from '../js/voice/parser.js';
import { SENTENCES, NOW } from './sentences.js';
import { CLIENT_SENTENCES } from './sentences-client.js';
import { FakeTransport, DeviceLink, splitMessage } from '../js/device.js';
import { wavInfo, encodeImaAdpcmWav, toPlayableWav } from '../js/voice/wav.js';
import { readFileSync } from 'node:fs';
import { setLang } from '../js/i18n.js';
setLang('en'); // the checks read the English messages

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) pass++; else { fail++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
};

// ---------- Rules (the client's balance rules, PD D client feedback) ----------
console.log('Rules');
const day = (list) => {
  const s = emptySchedule();
  list.forEach((e, i) => s.Monday.Morning.push({ id: 'x' + i, name: e, energy: e }));
  return checkDay(s, 'Monday');
};
const G = 'green', Y = 'yellow', R = 'red';
const dayLoad = (list) => day(list).load;
check('5 greens is fine', !day([G, G, G, G, G]).over);
check('6 greens is too much', day([G, G, G, G, G, G]).over);
check('1 yellow + 3 greens is fine', !day([Y, G, G, G]).over);
check('1 yellow + 4 greens is too much', day([Y, G, G, G, G]).over);
check('1 red + 2 greens is fine', !day([R, G, G]).over);
check('1 red + 3 greens is too much', day([R, G, G, G]).over);
check('red + yellow on the same day is flagged', day([R, Y]).over);
check('2 reds is flagged', day([R, R]).over);

const st = sampleWeek();
// Weekly activities and saved weeks (client feedback, Nov 3 and Nov 4 2026). sampleWeek: physio Monday and
// Thursday morning and church Sunday morning are weekly (series); the others are one-time.
const W1 = '2026-11-01', W2 = '2026-11-08', W3 = '2026-11-15';
st.shownWeek = W1;
const names = (sched, d, p) => sched[d][p].map((a) => a.name);
const usualOf = (state, id) => state.series[findItem(state.schedule, id).item.seriesId];
check('the example weekly activities are series', Object.keys(st.series).length === 3 && findItem(st.schedule, 's1').item.seriesId && !findItem(st.schedule, 's2').item.seriesId);

// Saving each week
let wk = openWeek(st, W2);
check('a week never opened starts with the weekly activities only', wk.shownWeek === W2 && names(wk.schedule, 'Monday', 'Morning').join() === 'Physiotherapy' && !names(wk.schedule, 'Monday', 'Afternoon').length && wk.weeks[W1]);
wk = applyChange(wk, { type: 'add', day: 'Sunday', period: 'Evening', item: { id: 'cb', name: 'Clean Bathroom', energy: 'green' } }).state;
const backW1 = openWeek(wk, W1);
check('each week is saved on its own: going back shows this week as it was', !names(backW1.schedule, 'Sunday', 'Evening').length && names(backW1.weeks[W2], 'Sunday', 'Evening').join() === 'Clean Bathroom');
check('and the other week is still there when it is opened again', names(openWeek(backW1, W2).schedule, 'Sunday', 'Evening').join() === 'Clean Bathroom');

// This week only (the default)
let r = applyChange(st, { type: 'move', id: 's1', toDay: 'Tuesday', toPeriod: 'Morning' });
check('moving a weekly activity is for this week only, and the message says so', r.ok && findItem(r.state.schedule, 's1').day === 'Tuesday' && /this week only/.test(r.message) && /Monday morning/.test(r.notice) && usualOf(r.state, 's1').day === 'Monday');
check('next week it is in its usual place', names(weekFromSeries(r.state.series), 'Monday', 'Morning').join() === 'Physiotherapy');
check('the card shows it is moved for this week (usual place differs)', usualOf(r.state, 's1').day !== findItem(r.state.schedule, 's1').day);
const twice = applyChange(r.state, { type: 'move', id: 's1', toDay: 'Monday', toPeriod: 'Morning' });
check('moving it back to its usual place says so', twice.ok && /usual place/.test(twice.message));
r = applyChange(st, { type: 'remove', id: 's5' });
check('removing a weekly activity is for this week only, and it comes back next week', r.ok && !findItem(r.state.schedule, 's5') && /comes back next week/.test(r.message) && names(weekFromSeries(r.state.series), 'Thursday', 'Morning').join() === 'Physiotherapy');
check('undo of "remove this week only" brings the weekly card back', !!findItem(applyChange(r.state, r.undo).state.schedule, 's5')?.item.seriesId);

// Every week
r = applyChange(st, { type: 'remove', id: 's7', everyWeek: true });
check('"Remove every week" removes it and it does not come back', r.ok && !findItem(r.state.schedule, 's7') && !Object.values(r.state.series).some((x) => x.item.name === 'Church') && !names(weekFromSeries(r.state.series), 'Sunday', 'Morning').length);
const un = applyChange(r.state, r.undo);
check('undo of "remove every week" brings back the card and the series', un.ok && findItem(un.state.schedule, 's7') && Object.values(un.state.series).some((x) => x.item.name === 'Church' && x.day === 'Sunday'));
// A week already planned ahead follows "every week" changes
let ahead = openWeek(openWeek(st, W2), W1); // W2 now saved, back on W1
r = applyChange(ahead, { type: 'move', id: 's5', toDay: 'Thursday', toPeriod: 'Afternoon', everyWeek: true });
check('"Every week" move changes the usual place', r.ok && usualOf(r.state, 's5').period === 'Afternoon' && /Every week from now on/.test(r.notice));
check('...and the week already planned ahead', names(r.state.weeks[W2], 'Thursday', 'Afternoon').join() === 'Physiotherapy' && !names(r.state.weeks[W2], 'Thursday', 'Morning').length);
check('...and a week never opened', names(weekFromSeries(r.state.series), 'Thursday', 'Afternoon').join() === 'Physiotherapy');
const unmove = applyChange(r.state, r.undo);
check('undo of an "every week" move puts everything back', usualOf(unmove.state, 's5').period === 'Morning' && names(unmove.state.weeks[W2], 'Thursday', 'Morning').join() === 'Physiotherapy');
const pastWeek = openWeek(openWeek(st, '2026-10-25'), W1);
r = applyChange(pastWeek, { type: 'remove', id: 's7', everyWeek: true });
check('"every week" never changes past weeks', names(r.state.weeks['2026-10-25'], 'Sunday', 'Morning').join() === 'Church');
// Make a one-time card weekly, and stop a weekly one
r = applyChange(ahead, { type: 'setWeekly', id: 's2', on: true });
check('"Every week" on: a one-time card comes back every week in its place', r.ok && findItem(r.state.schedule, 's2').item.seriesId && names(weekFromSeries(r.state.series), 'Monday', 'Afternoon').join() === 'Walk' && names(r.state.weeks[W2], 'Monday', 'Afternoon').join() === 'Walk');
check('undo of "every week" on', !findItem(applyChange(r.state, r.undo).state.schedule, 's2').item.seriesId && !names(applyChange(r.state, r.undo).state.weeks[W2], 'Monday', 'Afternoon').length);
r = applyChange(ahead, { type: 'setWeekly', id: 's7', on: false });
check('"Every week" off: it stays this week, not the next weeks', r.ok && findItem(r.state.schedule, 's7') && !findItem(r.state.schedule, 's7').item.seriesId && !names(r.state.weeks[W2], 'Sunday', 'Morning').length);
check('undo of "every week" off', !!findItem(applyChange(r.state, r.undo).state.schedule, 's7').item.seriesId && names(applyChange(r.state, r.undo).state.weeks[W2], 'Sunday', 'Morning').join() === 'Church');
// Colour (energy)
r = applyChange(ahead, { type: 'update', id: 's7', fields: { energy: 'red' } });
check('colour change, this week only', findItem(r.state.schedule, 's7').item.energy === 'red' && usualOf(r.state, 's7').item.energy === 'green');
r = applyChange(ahead, { type: 'update', id: 's7', fields: { energy: 'red' }, everyWeek: true });
check('colour change, every week (usual and weeks ahead)', usualOf(r.state, 's7').item.energy === 'red' && r.state.weeks[W2].Sunday.Morning[0].energy === 'red');
// Adding
const addOne = applyChange(st, { type: 'add', day: 'Sunday', period: 'Evening', libraryItem: { id: 'lib-cb', name: 'Clean Bathroom', energy: 'green' }, item: { id: 'cb1', activityId: 'lib-cb', name: 'Clean Bathroom', energy: 'green', fixed: true } });
check('a new activity goes in "My activities" so it can be dragged again later', addOne.state.library.some((x) => x.id === 'lib-cb'));
check('added from "My activities": only this week (even if the activity was weekly before), and the message says so', !findItem(addOne.state.schedule, 'cb1').item.seriesId && /Only this week/.test(addOne.message));
const addEvery = applyChange(st, { type: 'add', day: 'Sunday', period: 'Evening', everyWeek: true, item: { id: 'cb2', name: 'Clean Bathroom', energy: 'green' } });
check('added with "Repeat every week": a series, and the message says so', !!findItem(addEvery.state.schedule, 'cb2').item.seriesId && /every week on Sunday evening/.test(addEvery.message));
check('undo of an every-week add removes the series too', !Object.values(applyChange(addEvery.state, addEvery.undo).state.series).some((x) => x.item.name === 'Clean Bathroom'));
// She added it by hand on two Sundays, then made one weekly: no second card next week.
let twoSundays = openWeek(applyChange(openWeek(st, W2), { type: 'add', day: 'Sunday', period: 'Evening', item: { id: 'h2', activityId: 'lib-h', name: 'Clean Bathroom', energy: 'green' } }).state, W1);
twoSundays = applyChange(twoSundays, { type: 'add', day: 'Sunday', period: 'Evening', item: { id: 'h1', activityId: 'lib-h', name: 'Clean Bathroom', energy: 'green' } }).state;
r = applyChange(twoSundays, { type: 'setWeekly', id: 'h1', on: true });
check('making it weekly reuses the one already planned next week (no duplicate)', names(r.state.weeks[W2], 'Sunday', 'Evening').join() === 'Clean Bathroom' && r.state.weeks[W2].Sunday.Evening[0].seriesId);
const stop = applyChange(r.state, { type: 'setWeekly', id: 'h1', on: false });
check('...and stopping it keeps the one she added by hand next week', names(stop.state.weeks[W2], 'Sunday', 'Evening').join() === 'Clean Bathroom' && !stop.state.weeks[W2].Sunday.Evening[0].seriesId);
check('...and undo of the stop makes it weekly again, still one card', names(applyChange(stop.state, stop.undo).state.weeks[W2], 'Sunday', 'Evening').join() === 'Clean Bathroom' && applyChange(stop.state, stop.undo).state.weeks[W2].Sunday.Evening[0].seriesId);

// Safety copies (a stand-in for the iPad's storage)
const store = {};
globalThis.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
const oldSave = { ...JSON.parse(JSON.stringify(st)), version: 4, appVersion: '0.8.5' };
delete oldSave.series; delete oldSave.weeks; delete oldSave.touched; // as saved before v0.10
store['pwr-planner'] = JSON.stringify(oldSave);
const loadedSave = load();
check('an update keeps a safety copy of the save exactly as it was', safetyCopies().length === 1 && /before an update/.test(safetyCopies()[0].reason) && safetyCopies()[0].data === JSON.stringify(oldSave));
check('the save opens normally after the update', loadedSave.version === 5 && loadedSave.appVersion === APP_VERSION && !!findItem(loadedSave.schedule, 's1'));
check('a new planner opens on Week by default', fresh().settings.startView === 'weekly');
check('a planner saved before v0.10 counts as hers (copied to the device, never replaced from it)', loadedSave.touched === true);
check('a brand-new example planner stays untouched, even once saved', fresh().touched === false && migrate(JSON.parse(JSON.stringify(fresh()))).touched === false);
check('an older saved planner opens on Week by default', loadedSave.settings.startView === 'weekly');
save({ ...loadedSave, settings: { ...loadedSave.settings, startView: 'day' } });
check('the One day opening preference is saved and reloaded', load().settings.startView === 'day');
check('an older "Today" opening preference opens One day', migrate({ ...loadedSave, settings: { ...loadedSave.settings, startView: 'today' } }).settings.startView === 'day');
check('an invalid opening preference falls back to Week', migrate({ ...loadedSave, settings: { ...loadedSave.settings, startView: 'invalid' } }).settings.startView === 'weekly');
save(loadedSave);
load();
check('no second "before update" copy once updated', safetyCopies().length === 1);
check('one daily copy per day only', keepSafetyCopy(loadedSave, 'daily copy', { daily: true }) && !keepSafetyCopy(loadedSave, 'daily copy', { daily: true }));
const restoredCopy = readSafetyCopy(safetyCopies().find((c) => /before an update/.test(c.reason)).id);
check('a safety copy can be restored (brought up to date)', restoredCopy && restoredCopy.version === 5 && !!findItem(restoredCopy.schedule, 's1'));
store['pwr-planner'] = '{ not readable';
const unreadableSave = load();
check('a save that cannot be opened is never lost: it is kept as a safety copy', safetyCopies().some((c) => c.reason === 'could not be opened' && c.data === '{ not readable') && !!unreadableSave.library);
for (let i = 0; i < 12; i++) keepSafetyCopy(loadedSave, 'before a restore');
check('safety copies are capped (7 daily + 4 others)', safetyCopies().filter((c) => !c.daily).length === 4 && safetyCopies().filter((c) => c.daily).length <= 7);
delete globalThis.localStorage;

// One Save, several changes, one Undo
r = applyChange(st, { type: 'batch', changes: [{ type: 'move', id: 's2', toDay: 'Friday', toPeriod: 'Evening' }, { type: 'setWeekly', id: 's2', on: true }] });
check('several changes in one Save, undone at once', r.ok && usualOf(r.state, 's2').day === 'Friday' && findItem(applyChange(r.state, r.undo).state.schedule, 's2').day === 'Monday' && !findItem(applyChange(r.state, r.undo).state.schedule, 's2').item.seriesId);

// Older saves (v4): weekly cards become series at their usual place; cancelled ones too. Nothing is lost.
const v4 = { version: 4, library: st.library, schedule: JSON.parse(JSON.stringify(sampleWeek().schedule)), leftovers: [], settings: {}, changeLog: [] };
DAYS.forEach((d) => PERIODS.forEach((p) => v4.schedule[d][p].forEach((a) => { delete a.seriesId; })));
v4.schedule.Tuesday.Evening.push({ ...v4.schedule.Monday.Morning[0], id: 'mv', home: { day: 'Monday', period: 'Evening' } });
v4.skipped = [{ item: { name: 'Choir', energy: 'green', fixed: true }, day: 'Wednesday', period: 'Evening' }];
const m5 = migrate(JSON.parse(JSON.stringify(v4)));
const cards = (sched) => DAYS.flatMap((d) => PERIODS.flatMap((p) => sched[d][p])).length;
check('v4 save: every activity is kept', cards(m5.schedule) === cards(v4.schedule) && m5.version === 5 && !m5.skipped);
check('v4 save: a weekly card moved "this week only" keeps its usual place', m5.series[findItem(m5.schedule, 'mv').item.seriesId].period === 'Evening' && !findItem(m5.schedule, 'mv').item.home);
check('v4 save: a weekly activity cancelled this week comes back next week', Object.values(m5.series).some((x) => x.item.name === 'Choir' && x.day === 'Wednesday'));

r = applyChange(st, { type: 'move', id: 's2', toDay: 'Friday', toPeriod: 'Morning' });
check('movable activity moves', r.ok && findItem(r.state.schedule, 's2').day === 'Friday');
check('original state untouched', findItem(st.schedule, 's2').day === 'Monday');
const undone = applyChange(r.state, r.undo);
check('undo puts it back', undone.ok && findItem(undone.state.schedule, 's2').day === 'Monday');
r = applyChange(st, { type: 'add', day: 'Wednesday', period: 'Morning', item: { name: 'Laundry', energy: 'yellow' } });
check('adding a yellow next to a red warns', r.ok && r.warnings.length > 0);

// ---------- v0.6: the client's example week, rest, later-this-week, lighter week, split ----------
console.log('Client week and planning help');
const cw = fresh();
const allDays = Object.keys(cw.schedule);
check('example week: every day within her rules', allDays.every((d) => !checkDay(cw.schedule, d).over));
check('example week: at most 3 activities a day (target spec)', allDays.every((d) => checkDay(cw.schedule, d).count <= 3));
check('example week: never two reds', allDays.every((d) => checkDay(cw.schedule, d).warnings.length === 0));
check('rest costs no energy', day([R, G, G]).load === dayLoad([R, G, G, 'rest']));
check('a red without rest gives a rest reminder (her rule)', checkDay(cw.schedule, 'Saturday').restNeeded === true);
const satId = cw.schedule.Saturday.Afternoon[0].id;
r = applyChange(cw, { type: 'park', id: satId });
check('park: moves a day activity to "Later this week"', r.ok && r.state.leftovers.some((a) => a.id === satId) && !findItem(r.state.schedule, satId));
const unpark = applyChange(r.state, r.undo);
check("park can be undone", unpark.ok && findItem(unpark.state.schedule, satId)?.day === "Saturday");
const leftId = cw.leftovers[0].id;
r = applyChange(cw, { type: 'place', id: leftId, toDay: 'Sunday', toPeriod: 'Evening' });
check('place: a later activity goes into a day', r.ok && findItem(r.state.schedule, leftId)?.day === 'Sunday' && !r.state.leftovers.some((a) => a.id === leftId));
const walkId = cw.schedule.Monday.Morning[0].id;
const parked = applyChange(cw, { type: 'park', id: walkId });
check('a weekly activity can go to "Later this week" for this week only', parked.ok && /this week only/.test(parked.message) && parked.state.leftovers.some((a) => a.id === walkId) && Object.values(parked.state.series).some((x) => x.item.name === 'Walk + small groceries' && x.day === 'Monday'));
check('lighter week: nothing to change in a balanced week', suggestBalance(cw.schedule).length === 0);
const busy = JSON.parse(JSON.stringify(cw.schedule));
busy.Monday.Evening = [{ id: 'big', name: 'Big shopping', energy: 'red' }];
busy.Monday.Afternoon.push({ id: 'y2', name: 'Visit', energy: 'yellow' });
const props = suggestBalance(busy);
let fixedOk = props.length > 0;
props.forEach((p) => { const f = findItem(busy, p.id); if (!f || f.item.fixed) fixedOk = false; });
check('lighter week: proposes moves, never moves a fixed routine', fixedOk);
const after = JSON.parse(JSON.stringify(busy));
props.forEach((p) => { const f = findItem(after, p.id); after[f.day][f.period] = after[f.day][f.period].filter((x) => x.id !== p.id); if (p.toDay) after[p.toDay][p.toPeriod].push(f.item); });
check('lighter week: after the moves every day is within the rules', allDays.every((d) => !checkDay(after, d).over));
check('lighter week: a day kept "as it is" is left alone', suggestBalance(busy, { keep: ['Monday'] }).every((p) => p.fromDay !== 'Monday'));
const sigBefore = daySignature(busy, 'Monday');
const busy2 = JSON.parse(JSON.stringify(busy)); busy2.Monday.Morning.push({ id: 'extra', name: 'Extra', energy: 'green' });
check('"Keep as it is" ends when something on that day changes', sigBefore === daySignature(busy, 'Monday') && sigBefore !== daySignature(busy2, 'Monday'));

// Client feedback (Nov 3): "Move the Thursday medical appointment to Thursday morning" did nothing visible.
// The appointment is weekly: it moves at once, for this week only, and the message says so.
const medId = findItem(cw.schedule, cw.schedule.Thursday.Afternoon.find((a) => a.name === 'Medical appointment').id).item.id;
let pm = parse('Move the Thursday medical appointment to Thursday morning because the ABI clinic found me a spot', { library: cw.library, schedule: cw.schedule, now: NOW });
check('voice: a reason after "because" is ignored', pm.length === 1 && pm[0].ok && pm[0].change.id === medId && pm[0].change.toPeriod === 'Morning', JSON.stringify(pm));
const moved = applyChange(cw, pm[0].change);
check('voice: the appointment moves to Thursday morning with no question', moved.ok && findItem(moved.state.schedule, medId)?.period === 'Morning');
check('voice: the notice says it is for this week only', /this week only.*Thursday afternoon/.test(moved.notice));

// Client feedback (Nov 4): her three "every week" requests, by voice.
let vs = JSON.parse(JSON.stringify(cw));
vs.shownWeek = W1;
vs.library.push({ id: 'lib-cb', name: 'Clean Bathroom', energy: 'green', duration: 30 });
vs.schedule.Sunday.Evening.push({ id: 'cbv', activityId: 'lib-cb', name: 'Clean Bathroom', energy: 'green', fixed: false });
const say = (text) => { for (const x of parse(text, { library: vs.library, schedule: vs.schedule, now: NOW })) { const res = x.ok && applyChange(vs, x.change); if (res?.ok) vs = res.state; else return x.reason || res?.message; } return 'ok'; };
const nextWk = () => weekFromSeries(vs.series);
check('voice: "Make clean bathroom a weekly task on Sunday evening"', say('Make clean bathroom a weekly task on Sunday evening') === 'ok' && names(nextWk(), 'Sunday', 'Evening').join() === 'Clean Bathroom' && names(vs.schedule, 'Sunday', 'Evening').filter((n) => n === 'Clean Bathroom').length === 1);
check('voice: "Add walk and small groceries every Friday afternoon"', say('Add walk and small groceries every Friday afternoon') === 'ok' && names(nextWk(), 'Friday', 'Afternoon').includes('Walk + small groceries'));
check('voice: "Move my medical appointment to Thursday morning every week"', say('Move my medical appointment to Thursday morning every week') === 'ok' && names(nextWk(), 'Thursday', 'Morning').includes('Medical appointment') && !names(nextWk(), 'Thursday', 'Afternoon').includes('Medical appointment'));
check('voice: "every week" words never become part of a new activity name', !vs.library.some((x) => /weekly|every|task/i.test(x.name)));
check('voice: without "every week", a move stays this week only', say('Move church to Sunday afternoon') === 'ok' && names(nextWk(), 'Sunday', 'Morning').includes('Church'));
check('voice: that move can be undone', findItem(applyChange(moved.state, moved.undo).state.schedule, medId)?.period === 'Afternoon');

const parts = splitChanges({ id: 'meal', name: 'Meal prep (part)', energy: 'green' }, [{ name: 'meat' }, { name: 'vegetables' }, { name: 'rice' }], 'Saturday', 'Afternoon');
check('split: parts on the days in a row, the ones after the last day go to "Later this week"', parts.map((c) => c.day || c.type).join() === 'Saturday,Sunday,addLeftover' && parts[2].item.name === 'Meal prep 3/3: rice');
const sundayWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
check('split: in a week that starts on Sunday, Thursday + 3 parts every second day', splitChanges({ id: 'm', name: 'Meal' }, [{ name: 'a' }, { name: 'b' }, { name: 'c' }], 'Wednesday', 'Morning', 2, sundayWeek).map((c) => c.day || c.type).join() === 'Wednesday,Friday,addLeftover');
check('split: all on the same day', splitChanges({ id: 'm', name: 'Meal' }, [{ name: 'a' }, { name: 'b' }], 'Monday', 'Evening', 0).every((c) => c.day === 'Monday'));

// ---------- Appointment card and quiet times (v0.8) ----------
console.log('Appointment card and quiet times');
const fw = fresh();
const med = findItem(fw.schedule, fw.schedule.Thursday.Afternoon[0].id).item;
check('medical appointment and physio have an appointment card', isAppointment(med, fw.library) && isAppointment(fw.schedule.Friday.Morning[0], fw.library));
check('church and music lesson are quiet times', isQuiet(fw.schedule.Sunday.Morning[0], fw.library) && isQuiet(fw.schedule.Tuesday.Evening[0], fw.library));
check('quiet blocks for the device: Sunday morning, Tuesday evening', quietLines(fw.schedule, fw.library).join() === 'Tuesday|Evening,Sunday|Morning');
r = applyChange(fw, { type: 'update', id: med.id, fields: { questions: ['Is this normal for my recovery?'], afterNote: 'Come back in 2 weeks' } });
const upd = findItem(r.state.schedule, med.id).item;
check('appointment questions and note are saved', r.ok && upd.questions.length === 1 && upd.afterNote === 'Come back in 2 weeks');
const back3 = applyChange(r.state, r.undo);
check('saving the card can be undone', back3.ok && !findItem(back3.state.schedule, med.id).item.questions && !findItem(back3.state.schedule, med.id).item.afterNote);
check('update cannot change the name', applyChange(fw, { type: 'update', id: med.id, fields: { name: 'Other' } }).state.schedule.Thursday.Afternoon[0].name === 'Medical appointment');
check('update can change the colour (energy), not to an unknown level', applyChange(fw, { type: 'update', id: med.id, fields: { energy: 'red' } }).state.schedule.Thursday.Afternoon[0].energy === 'red' && !applyChange(fw, { type: 'update', id: med.id, fields: { energy: 'purple' } }).ok);
const old = JSON.parse(JSON.stringify(fw)); old.library.forEach((a) => { delete a.appointment; delete a.quiet; }); old.version = 3;
const mig = migrate(old);
check('older saves get the appointment and quiet flags', mig.library.find((a) => a.id === 'medical').appointment === true && mig.library.find((a) => a.id === 'church').quiet === true);

// ---------- No tracking (client: help her schedule, do not track her) ----------
console.log('No tracking');
check('a new planner keeps no energy check-ins and no done marks', !('checkins' in fresh()) && !('loads' in fresh()) && !('done' in fresh()));
const tracked = { ...fresh(), checkins: { '2026-10-30': 'tired' }, loads: { '2026-10-30': 5 }, done: { '2026-10-30': { x: true } } };
const cleaned = migrate(JSON.parse(JSON.stringify(tracked)));
check('check-ins and done marks saved by older versions are deleted', !('checkins' in cleaned) && !('loads' in cleaned) && !('done' in cleaned));

// ---------- Client requirement: drag from the "My activities" box into the calendar (decision 27) ----------
// Must never be removed. These checks fail if the box is hidden or the drag code disappears.
console.log('Drag and drop (required)');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const mainJs = readFileSync(new URL('../js/main.js', import.meta.url), 'utf8');
const weekJs = readFileSync(new URL('../js/ui-week.js', import.meta.url), 'utf8');
const box = html.match(/<aside[^>]*id="palette"[^>]*>/)?.[0] || '';
check('the "My activities" box is in the week screen', !!box && html.includes('id="paletteTiles"'));
check('the box is always visible (not hidden)', !!box && !/class="[^"]*\bhidden\b/.test(box));
check('the week screen opens first', /<section id="weeklyView" class="view"/.test(html) && !html.includes('id="todayView"'));
check('One day is a layout of the main schedule screen, chosen at the top (no Today screen)', html.includes('data-layout="day"') && html.indexOf('id="dayPanel"') > html.indexOf('id="weekGrid"') && html.indexOf('id="dayPanel"') < html.indexOf('id="activitiesView"'));
check('Settings offers Week and One day as opening pages', /<select id="startViewSelect"><option value="weekly">Week<\/option><option value="day">One day<\/option><\/select>/.test(html));
check('startup opens the saved page', mainJs.includes("ctx.state.settings.layout = ctx.state.settings.startView === 'day' ? 'day' : 'week';"));
check('drag code is present (mouse, finger, pen)', mainJs.includes("addEventListener('pointerdown'") && mainJs.includes('function dropOn') && mainJs.includes('startDrag'));
check('tap-then-tap alternative is present', mainJs.includes('placeInto(ctx.placing.kind') && weekJs.includes('export function startPlacing'));
const libJs = readFileSync(new URL('../js/ui-library.js', import.meta.url), 'utf8');
const newForm = libJs.slice(libJs.indexOf('export function createAndScheduleActivity'), libJs.indexOf('export function openQuickAdd'));
check('"New activity" on the week offers "Repeat every week", unticked', newForm.includes('${repeatField(false)}'));
check('updates switch over on their own (no bar), never while a window is open', mainJs.includes("reg.waiting.postMessage('SKIP_WAITING')") && mainJs.includes('const busy = () =>') && !html.includes('updateBar'));
check('library tiles, leftovers and week cards (weekly ones too) can be dragged', weekJs.includes("const draggable = ['library', 'leftover', 'scheduled'].includes(kind);"));

// ---------- Parser ----------
console.log('Parser');
let ids = 0;
function runSentences(list, week) {
  let ids = 0;
  const ctx = { library: week.library, schedule: week.schedule, now: NOW, newId: () => 'n' + ids++ };
  const nameOf = (result) => {
    const c = result.change;
    if (c.type === 'add') return c.item.name;
    return findItem(week.schedule, c.id)?.item.name;
  };
  let ok = 0;
  for (const [text, expected] of list) {
    const results = parse(text, ctx);
    const exp = Array.isArray(expected) ? expected : [expected];
    let good = results.length === exp.length;
    const why = [];
    exp.forEach((e, i) => {
      const got = results[i];
      if (!got) { good = false; return; }
      if (e.fail) { if (got.ok) { good = false; why.push('should be kept aside, got: ' + got.summary); } return; }
      if (!got.ok) { good = false; why.push('not understood: ' + got.reason); return; }
      const c = got.change, kind = e.add ? 'add' : e.move ? 'move' : 'remove';
      if (c.type !== kind) { good = false; why.push(`expected ${kind}, got ${c.type}`); return; }
      const name = nameOf(got);
      const want = e.add || e.move || e.remove;
      if (name !== want) { good = false; why.push(`activity "${name}" instead of "${want}"`); }
      const d = c.day || c.toDay, p = c.period || c.toPeriod;
      if (e.day && d !== e.day) { good = false; why.push(`day ${d} instead of ${e.day}`); }
      if (e.period && p !== e.period) { good = false; why.push(`period ${p} instead of ${e.period}`); }
      if (e.energy && c.item?.energy !== e.energy) { good = false; why.push(`energy ${c.item?.energy} instead of ${e.energy}`); }
    });
    if (good) ok++;
    check(`"${text}"`, good, why.join('; '));
  }
  return ok;
}
const sentencesOk = runSentences(SENTENCES, st);
const rate = Math.round((100 * sentencesOk) / SENTENCES.length);
console.log(`  ${sentencesOk}/${SENTENCES.length} sentences understood correctly (${rate} %, target ≥ 90 %)`);
const clientOk = runSentences(CLIENT_SENTENCES, fresh());
console.log(`  ${clientOk}/${CLIENT_SENTENCES.length} sentences about the client's own activities (${Math.round((100 * clientOk) / CLIENT_SENTENCES.length)} %)`);

// ---------- Device backup lines ----------
console.log('Device backup');
const lines = scheduleToLines(st.schedule);
check('7 activities become 7 lines', lines.length === 7, lines.length);
check('line format day|period|name|energy', lines[0] === 'Monday|Morning|Physiotherapy|yellow', lines[0]);
const back = linesToSchedule(lines, st.library);
check('restore gives the same week', JSON.stringify(scheduleToLines(back.schedule)) === JSON.stringify(lines));
const restoredNew = linesToSchedule(['Friday|Evening|Bingo|green'], st.library);
check('unknown names are added to the library', restoredNew.library.some((a) => a.name === 'Bingo'));

// ---------- Bluetooth protocol (docs/protocol.md) against the demo device ----------
console.log('Device protocol');
const mem = {};
globalThis.localStorage = { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => (mem[k] = String(v)), removeItem: (k) => delete mem[k] };
const transport = new FakeTransport();
await transport.connect();
const link = new DeviceLink(transport);
const hi = await link.hello();
check('HELLO answers protocol v3 (times, quiet times, planner copy)', hi.version === 3, JSON.stringify(hi));
await link.setTime();
await link.sendSchedule(lines);
check('schedule is stored on the device', JSON.parse(mem['pwr-demo-device']).schedule.length === lines.length);
const backup = await link.getBackup();
check('backup comes back identical', JSON.stringify(backup) === JSON.stringify(lines));
const wav = readFileSync(new URL('./audio/add-groceries.wav', import.meta.url));
FakeTransport.addRecording(wav);
const notes = await link.listNotes();
check('the waiting note is listed', notes.length === 1 && notes[0].bytes === wav.length, JSON.stringify(notes));
const got = await link.getNote(notes[0].id);
check('the note arrives complete and checked', got.length === wav.length && Buffer.from(got).equals(wav));
await link.deleteNote(notes[0].id);
check('the note is deleted only after the check', (await link.listNotes()).length === 0);

// ---------- v0.10: photo, reminders, French, pictures (client feedback, Nov 2026) ----------
console.log('Photo, reminders, French');
{
  const { parsePhotoText } = await import('../js/photo-parse.js');
  const { remindersFor } = await import('../js/rules.js');
  const { iconFor, iconId } = await import('../js/icons.js');
  const { t, setLang: lang } = await import('../js/i18n.js');
  const wk = fresh();
  const photo = parsePhotoText('MONDAY\n10:30 Physio\nAfternoon: haircut\nMardi soir cours de musique\nJeudi 14h dentiste\nAdd vacuum on Friday morning', { library: wk.library, schedule: wk.schedule, now: NOW });
  const adds = photo.filter((r) => r.ok && r.change.type === 'add').map((r) => [r.change.day, r.change.period, r.change.item.name, r.change.item.time || ''].join(' '));
  check('photo: a day header applies to the next lines, with the clock time', adds.includes('Monday Morning Physiotherapy 10:30'));
  check('photo: "Afternoon:" sets the time of day, a new activity is created', adds.includes('Monday Afternoon Haircut '));
  check('photo: French day, time of day and activity', adds.includes('Tuesday Evening Music lesson '));
  check('photo: French "14h" is 14:00 in the afternoon', adds.includes('Thursday Afternoon Medical appointment 14:00'));
  check('photo: a sentence goes to the voice parser', adds.includes('Friday Morning Vacuum '));
  check('photo: a line without any day is not used', parsePhotoText('10:30 Physio', { library: wk.library, schedule: wk.schedule, now: NOW }).every((r) => !r.ok));

  // French voice commands
  const fr = (text) => parse(text, { library: wk.library, schedule: wk.schedule, now: NOW, newId: () => 'f' });
  const add = fr('Ajoute la physio vendredi à 10h30')[0];
  check('voice (French): add with a day and a clock time', add.ok && add.change.day === 'Friday' && add.change.item.time === '10:30' && add.change.period === 'Morning');
  const mv = fr('Déplace la marche de lundi à mercredi matin')[0];
  check('voice (French): move from one day to another', mv.ok && mv.change.type === 'move' && mv.change.toDay === 'Wednesday' && mv.change.toPeriod === 'Morning');
  const rm = fr('Annule l\'aspirateur lundi')[0];
  check('voice (French): cancel', rm.ok && rm.change.type === 'remove');
  check('voice (French): "demain" is tomorrow', fr('Ajoute la vaisselle demain après-midi')[0].change?.day === 'Thursday');
  check('voice (English): "at 2 pm" keeps the clock time', parse('Add physio on Friday at 2 pm', { library: wk.library, schedule: wk.schedule, now: NOW })[0].change?.item.time === '14:00');

  // In-app reminders follow the device rule: a block reminder 60 min before, and one per timed activity.
  const rs = { ...emptySchedule() };
  rs.Monday = { Morning: [{ id: 'a', name: 'Walk', energy: 'green' }, { id: 'b', name: 'Physio', energy: 'yellow', time: '10:30' }], Afternoon: [{ id: 'c', name: 'Rest', energy: 'rest' }], Evening: [{ id: 'd', name: 'Music', energy: 'yellow', reminder: false }] };
  const rem = remindersFor ? remindersFor(rs, 'Monday', [], 60) : [];
  check('reminders: the morning block 60 min before 9:00, and Physio 60 min before 10:30', rem.length === 2 && rem[0].at === 8 * 60 && rem[0].items.length === 1 && rem[1].at === 9 * 60 + 30);
  check('reminders: rest and "no reminder" activities are left out', !rem.some((r) => r.items.some((a) => a.id === 'c' || a.id === 'd')));

  // Pictures and French texts
  check('pictures: chosen from the name, whole words only', iconId({ name: 'Change bed and towels' }) === 'bed' && iconId({ name: 'Hang laundry' }) === 'laundry' && iconId({ name: 'Rendez-vous médical' }) === 'medical' && iconId({ name: 'Lunch with a friend' }) === 'coffee');
  check('pictures: her own choice wins; an unknown one falls back to the name', iconId({ name: 'Walk', icon: 'pet' }) === 'pet' && iconId({ name: 'Walk', icon: '🐕' }) === 'walk');
  check('pictures: they are drawings (SVG), not emoji', iconFor({ name: 'Walk' }).startsWith('<svg'));
  lang('fr');
  check('French: a message with a name and a place', t('{name} added to {where}.', { name: 'Physio', where: 'lundi matin' }) === 'Physio ajouté lundi matin.');
  check('French: the energy rules speak French', checkDay({ ...emptySchedule(), Monday: { Morning: [{ energy: 'red' }, { energy: 'red' }], Afternoon: [], Evening: [] } }, 'Monday').warnings[0].startsWith('Plus d’une'));
  lang('en');
  const { spawnSync } = await import('node:child_process');
  const missing = spawnSync('node', [new URL('../../tools/i18n-check.mjs', import.meta.url).pathname, '--json']).stdout.toString() || '[]';
  check('French: every English text has a French text', JSON.parse(missing).length === 0, missing.slice(0, 200));
}

// ---------- Voice-note compression (IMA ADPCM, docs/protocol.md) ----------
{
  const fake2 = new FakeTransport(); await fake2.connect(); const link2 = new DeviceLink(fake2); await link2.hello();
  check('quiet times are sent to a v2 device and confirmed', (await link2.sendQuiet(['Sunday|Morning', 'Tuesday|Evening'])) === true);
  link2.version = 1; // a v1 device (first firmware) never receives them
  check('quiet times are not sent to a v1 device (no unknown commands)', (await link2.sendQuiet(['Sunday|Morning'])) === false);
  const timed = scheduleToLines({ ...emptySchedule(), Monday: { Morning: [{ name: 'Walk', energy: 'green' }, { name: 'Physio', energy: 'yellow', time: '10:30' }], Afternoon: [], Evening: [] } }, { times: true });
  check('v2 lines: clock time as a 5th field, timed activities first', timed.join() === 'Monday|Morning|Physio|yellow|10:30,Monday|Morning|Walk|green');
  check('v1 lines never carry a time', scheduleToLines({ ...emptySchedule(), Monday: { Morning: [{ name: 'Physio', energy: 'yellow', time: '10:30' }], Afternoon: [], Evening: [] } }).join() === 'Monday|Morning|Physio|yellow');
  check('a backup line with a time comes back with its time', linesToSchedule(['Monday|Morning|Physio|yellow|10:30'], []).schedule.Monday.Morning[0].time === '10:30');
}
// ---------- v3: automatic copy of the planner on the device, end-to-end encryption ----------
console.log('Planner copy on the device, encryption');
{
  const { packState, unpackState, backupSig } = await import('../js/store.js');
  const { e2eKey, seal, open, topicId } = await import('../js/device-wifi.js');
  const st0 = fresh();
  st0.schedule.Monday.Morning.push({ id: 'zz', name: 'Unique test activity', energy: 'red', time: '10:30' });
  const packed = await packState(st0);
  check('the planner packs small (gzip)', packed.length < JSON.stringify(st0).length / 3, `${packed.length} bytes`);
  const back = await unpackState(packed);
  check('and comes back identical', back.schedule.Monday.Morning.some((a) => a.name === 'Unique test activity' && a.time === '10:30') && back.library.length === st0.library.length);
  check('a new copy is only needed when something changed', backupSig(st0) === backupSig({ ...st0, updatedAt: 1 }) && backupSig(st0) !== backupSig(back.schedule === st0.schedule ? st0 : { ...st0, kept: { Monday: 'x' } }));
  const fk = new FakeTransport(); await fk.connect(); const lk = new DeviceLink(fk); await lk.hello();
  check('no copy on a new device', (await lk.getState()) === null);
  check('the device keeps the copy (sizes and sum checked)', (await lk.sendState(packed, Date.UTC(2026, 10, 23))) === true);
  const got = await lk.getState();
  check('and gives it back exactly', got && got.bytes.length === packed.length && got.bytes.every((b, i) => b === packed[i]) && got.savedAt === Date.UTC(2026, 10, 23));
  lk.version = 2;
  check('a v2 device is never sent the copy', (await lk.sendState(packed)) === false);

  // Same test vector as docs/protocol.md (the firmware checks the same one at boot).
  const id = await topicId('ABCD-EFGH-JKLM');
  const key = await e2eKey('ABCD-EFGH-JKLM');
  const iv = new Uint8Array(12).map((_, i) => i);
  const sealed = await seal(key, `pwr/${id}/app`, 'HELLO|3', iv);
  check('encryption: the protocol.md test vector', id === '3f63d25fcb89' && sealed === 'AAECAwQFBgcICQoL1KionQPm27sRx/m9qjYxu82Jhas9Q8k=', sealed);
  const opened = await open(key, `pwr/${id}/app`, new TextEncoder().encode(sealed));
  check('decryption gives the line back', opened && new TextDecoder().decode(opened) === 'HELLO|3');
  check('a message for the other topic is refused', (await open(key, `pwr/${id}/dev`, new TextEncoder().encode(sealed))) === null);
  const { brokerUrl } = await import('../js/device-wifi.js');
  check('relay address: a host alone becomes the EMQX secure WebSocket address', brokerUrl('abc.ala.us-east-1.emqxsl.com') === 'wss://abc.ala.us-east-1.emqxsl.com:8084/mqtt' && brokerUrl('h.example:8884') === 'wss://h.example:8884/mqtt' && brokerUrl('wss://x:1/y') === 'wss://x:1/y' && brokerUrl('mqtts://h.example:8883') === 'wss://h.example:8084/mqtt');
  check('another pairing code cannot read it', (await open(await e2eKey('BCDE-FGHJ-KLMN'), `pwr/${id}/app`, new TextEncoder().encode(sealed))) === null);
}
console.log('Compression');
const pcm = readFileSync(new URL('./audio/move-walk.wav', import.meta.url));
const pcmBuf = pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.length);
const pinfo = wavInfo(pcmBuf);
const original = new Int16Array(pcmBuf, pinfo.data.offset, pinfo.data.size >> 1);
const packed = encodeImaAdpcmWav(original, pinfo.sampleRate);
check('compressed note is about 4x smaller', packed.byteLength < pcmBuf.byteLength / 3.5, `${pcmBuf.byteLength} -> ${packed.byteLength}`);
const unpacked = toPlayableWav(packed);
const uinfo = wavInfo(unpacked.buffer);
const restored = new Int16Array(unpacked.buffer, uinfo.data.offset, uinfo.data.size >> 1);
check('unpacked note has the same length and rate', restored.length === original.length && uinfo.sampleRate === 8000, `${restored.length} vs ${original.length}`);
let sig = 0, err = 0;
for (let i = 0; i < original.length; i++) { sig += original[i] ** 2; err += (original[i] - restored[i]) ** 2; }
const snr = 10 * Math.log10(sig / Math.max(1, err));
check('unpacked audio is close to the original (signal-to-noise > 15 dB, normal for 4-bit speech audio)', snr > 15, snr.toFixed(1) + ' dB');
console.log(`  ${pcmBuf.byteLength} bytes -> ${packed.byteLength} bytes, quality ${snr.toFixed(1)} dB`);

// ---------- Smallest Bluetooth packets (20 bytes) ----------
console.log('Small packets');
check('long messages are cut into "+" pieces of at most 20 bytes',
  splitMessage('Wednesday|Afternoon|Prepare a meal|yellow', 20).every((p) => new TextEncoder().encode(p).length <= 20));
check('pieces never cut a character in half', splitMessage('Thursday|Morning|Café avec Élodie|green', 20).slice(-1)[0].length > 0
  && splitMessage('Thursday|Morning|Café avec Élodie|green', 20).map((p, i, a) => (i < a.length - 1 ? p.slice(1) : p)).join('') === 'Thursday|Morning|Café avec Élodie|green');
FakeTransport.payload = 20;
FakeTransport.clearSchedule();
const t2 = new FakeTransport();
await t2.connect();
const small = new DeviceLink(t2);
const hi2 = await small.hello();
check('device reports its packet size in HELLO', hi2.payload === 20, JSON.stringify(hi2));
const accents = [...lines, 'Thursday|Morning|Café avec Élodie|green'];
await small.sendSchedule(accents);
const back2 = await small.getBackup();
check('schedule round trip works with 20-byte packets (accents included)', JSON.stringify(back2) === JSON.stringify(accents));
FakeTransport.addRecording(new Uint8Array(packed));
const n2 = await small.listNotes();
const got2 = await small.getNote(n2[0].id);
check('compressed note arrives complete with 20-byte packets', got2.length === packed.byteLength && Buffer.from(got2).equals(Buffer.from(packed)));
FakeTransport.payload = 180;

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
