// Run with:  node app/tests/run.js   (Node 18+; no packages needed)
// Checks the energy rules, the parser against tests/sentences.js, and the device backup lines.

import { fresh, sampleWeek, scheduleToLines, linesToSchedule, emptySchedule, migrate, isAppointment, isQuiet, quietLines } from '../js/store.js';
import { checkDay, applyChange, findItem, suggestBalance, splitChanges, daySignature, startNewWeek } from '../js/rules.js';
import { parse } from '../js/voice/parser.js';
import { SENTENCES, NOW } from './sentences.js';
import { CLIENT_SENTENCES } from './sentences-client.js';
import { FakeTransport, DeviceLink, splitMessage } from '../js/device.js';
import { wavInfo, encodeImaAdpcmWav, toPlayableWav } from '../js/voice/wav.js';
import { readFileSync } from 'node:fs';

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
// Weekly activities (fixed) can be changed for one week; a new week puts them back (client feedback, Nov 3).
let r = applyChange(st, { type: 'move', id: 's1', toDay: 'Tuesday', toPeriod: 'Morning' });
check('weekly activity moves for this week, with a "this week only" notice', r.ok && findItem(r.state.schedule, 's1').day === 'Tuesday' && /this week only/.test(r.message) && /Monday morning/.test(r.notice));
let nw = startNewWeek(r.state);
check('new week: a moved weekly activity is back in its usual place', findItem(nw.schedule, 's1')?.day === 'Monday' && findItem(nw.schedule, 's1')?.period === 'Morning' && !findItem(nw.schedule, 's1').item.home);
const twice = applyChange(applyChange(r.state, { type: 'move', id: 's1', toDay: 'Friday', toPeriod: 'Evening' }).state, { type: 'move', id: 's1', toDay: 'Monday', toPeriod: 'Morning' });
check('moving it back to its usual place says so and forgets the move', twice.ok && /usual place/.test(twice.message) && !findItem(twice.state.schedule, 's1').item.home);
check('undo of a weekly move puts it back and forgets the move', !findItem(applyChange(r.state, r.undo).state.schedule, 's1').item.home && findItem(applyChange(r.state, r.undo).state.schedule, 's1').day === 'Monday');
r = applyChange(st, { type: 'remove', id: 's5' });
check('weekly activity can be cancelled for this week', r.ok && !findItem(r.state.schedule, 's5') && /comes back next week/.test(r.message));
nw = startNewWeek(r.state);
check('new week: a cancelled weekly activity comes back, once', nw.schedule.Thursday.Morning.filter((a) => a.name === 'Physiotherapy').length === 1 && !nw.skipped.length);
check('undo of a cancel does not bring it back twice', startNewWeek(applyChange(r.state, r.undo).state).schedule.Thursday.Morning.filter((a) => a.name === 'Physiotherapy').length === 1);
const addW = applyChange(st, { type: 'add', day: 'Sunday', period: 'Evening', item: { id: 'w9', name: 'Choir', energy: 'green', fixed: true } });
check('undoing the add of a weekly activity does not bring it back next week', !startNewWeek(applyChange(addW.state, { ...addW.undo, force: true }).state).schedule.Sunday.Evening.some((a) => a.name === 'Choir'));
const newWeekly = applyChange(st, { type: 'add', day: 'Monday', period: 'Evening', libraryItem: { id: 'lib-yoga', name: 'Yoga', energy: 'green', fixed: true }, item: { id: 'y1', activityId: 'lib-yoga', name: 'Yoga', energy: 'green', fixed: true } });
check('a new activity set to "Repeat every week" says so and is in My activities', newWeekly.ok && /repeats every week/.test(newWeekly.message) && newWeekly.state.library.some((x) => x.id === 'lib-yoga' && x.fixed));
check('it comes back next week in the same place', startNewWeek(newWeekly.state).schedule.Monday.Evening.some((x) => x.name === 'Yoga'));
const oneOff = applyChange(st, { type: 'move', id: 's2', toDay: 'Friday', toPeriod: 'Morning' });
check('new week: one-off activities stay where they are', findItem(startNewWeek(oneOff.state).schedule, 's2').day === 'Friday');
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
check('weekly activity can go to "Later this week", and is back home next week (not also in the tray)', parked.ok && findItem(startNewWeek(parked.state).schedule, walkId)?.day === 'Monday' && !startNewWeek(parked.state).leftovers.some((a) => a.id === walkId));
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
// The appointment is weekly (fixed): it moves at once, for this week only, and the message says so.
const medId = findItem(cw.schedule, cw.schedule.Thursday.Afternoon.find((a) => a.name === 'Medical appointment').id).item.id;
let pm = parse('Move the Thursday medical appointment to Thursday morning because the ABI clinic found me a spot', { library: cw.library, schedule: cw.schedule, now: NOW });
check('voice: a reason after "because" is ignored', pm.length === 1 && pm[0].ok && pm[0].change.id === medId && pm[0].change.toPeriod === 'Morning', JSON.stringify(pm));
const moved = applyChange(cw, pm[0].change);
check('voice: the appointment moves to Thursday morning with no question', moved.ok && findItem(moved.state.schedule, medId)?.period === 'Morning');
check('voice: the notice says it is for this week only', /this week only.*Thursday afternoon/.test(moved.notice));
check('voice: that move can be undone', findItem(applyChange(moved.state, moved.undo).state.schedule, medId)?.period === 'Afternoon');

const parts = splitChanges({ id: 'meal', name: 'Meal prep (part)', energy: 'green' }, [{ name: 'meat' }, { name: 'vegetables' }, { name: 'rice' }], 'Saturday', 'Afternoon');
check('split: 3 parts on 3 days in a row', parts.map((c) => c.day).join() === 'Saturday,Sunday,Monday' && parts[2].item.name === 'Meal prep 3/3: rice');

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
check('update cannot change the name or energy', !applyChange(fw, { type: 'update', id: med.id, fields: { energy: 'red' } }).state.schedule.Thursday.Afternoon[0].energy.includes('red'));
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
check('the week screen opens first', /<section id="weeklyView" class="view"/.test(html) && /<section id="todayView" class="view hidden"/.test(html));
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
check('HELLO answers protocol v1', hi.version === 1, JSON.stringify(hi));
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

// ---------- Voice-note compression (IMA ADPCM, docs/protocol.md) ----------
{
  const fake2 = new FakeTransport(); await fake2.connect(); const link2 = new DeviceLink(fake2); await link2.hello();
  check('quiet times are not sent to a v1 device (no unknown commands)', (await link2.sendQuiet(['Sunday|Morning'])) === false);
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
