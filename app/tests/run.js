// Run with:  node app/tests/run.js   (Node 18+; no packages needed)
// Checks the energy rules, the parser against tests/sentences.js, and the device backup lines.

import { fresh, scheduleToLines, linesToSchedule, emptySchedule } from '../js/store.js';
import { checkDay, applyChange, findItem } from '../js/rules.js';
import { parse } from '../js/voice/parser.js';
import { SENTENCES, NOW } from './sentences.js';
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
check('5 greens is fine', !day([G, G, G, G, G]).over);
check('6 greens is too much', day([G, G, G, G, G, G]).over);
check('1 yellow + 3 greens is fine', !day([Y, G, G, G]).over);
check('1 yellow + 4 greens is too much', day([Y, G, G, G, G]).over);
check('1 red + 2 greens is fine', !day([R, G, G]).over);
check('1 red + 3 greens is too much', day([R, G, G, G]).over);
check('red + yellow on the same day is flagged', day([R, Y]).over);
check('2 reds is flagged', day([R, R]).over);

const st = fresh();
let r = applyChange(st, { type: 'move', id: 's1', toDay: 'Tuesday', toPeriod: 'Morning' });
check('fixed routine cannot be moved', !r.ok);
r = applyChange(st, { type: 'remove', id: 's5' });
check('fixed routine cannot be removed', !r.ok);
r = applyChange(st, { type: 'move', id: 's2', toDay: 'Friday', toPeriod: 'Morning' });
check('movable activity moves', r.ok && findItem(r.state.schedule, 's2').day === 'Friday');
check('original state untouched', findItem(st.schedule, 's2').day === 'Monday');
const undone = applyChange(r.state, r.undo);
check('undo puts it back', undone.ok && findItem(undone.state.schedule, 's2').day === 'Monday');
r = applyChange(st, { type: 'add', day: 'Wednesday', period: 'Morning', item: { name: 'Laundry', energy: 'yellow' } });
check('adding a yellow next to a red warns', r.ok && r.warnings.length > 0);

// ---------- Parser ----------
console.log('Parser');
let ids = 0;
const ctx = { library: st.library, schedule: st.schedule, now: NOW, newId: () => 'n' + ids++ };
const nameOf = (result) => {
  const c = result.change;
  if (c.type === 'add') return c.item.name;
  return findItem(st.schedule, c.id)?.item.name;
};
let sentencesOk = 0;
for (const [text, expected] of SENTENCES) {
  const results = parse(text, ctx);
  const exp = Array.isArray(expected) ? expected : [expected];
  let ok = results.length === exp.length;
  const why = [];
  exp.forEach((e, i) => {
    const got = results[i];
    if (!got) { ok = false; return; }
    if (e.fail) { if (got.ok) { ok = false; why.push('should be kept aside, got: ' + got.summary); } return; }
    if (!got.ok) { ok = false; why.push('not understood: ' + got.reason); return; }
    const c = got.change, kind = e.add ? 'add' : e.move ? 'move' : 'remove';
    if (c.type !== kind) { ok = false; why.push(`expected ${kind}, got ${c.type}`); return; }
    const name = nameOf(got);
    const want = e.add || e.move || e.remove;
    if (name !== want) { ok = false; why.push(`activity "${name}" instead of "${want}"`); }
    const d = c.day || c.toDay, p = c.period || c.toPeriod;
    if (e.day && d !== e.day) { ok = false; why.push(`day ${d} instead of ${e.day}`); }
    if (e.period && p !== e.period) { ok = false; why.push(`period ${p} instead of ${e.period}`); }
    if (e.energy && c.item?.energy !== e.energy) { ok = false; why.push(`energy ${c.item?.energy} instead of ${e.energy}`); }
  });
  if (ok) sentencesOk++;
  check(`"${text}"`, ok, why.join('; '));
}
const rate = Math.round((100 * sentencesOk) / SENTENCES.length);
console.log(`  ${sentencesOk}/${SENTENCES.length} sentences understood correctly (${rate} %, target ≥ 90 %)`);

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
