// End-to-end test of the Wi-Fi sync: the app's own code (MqttTransport + DeviceLink) talks to the
// Wi-Fi demo device through an MQTT broker. Run:  cd tools && npm install && node wifi-test.mjs
// By default it starts a broker on this computer (nothing leaves it). To test a real broker:
//   PWR_BROKER=mqtts://host:8883 PWR_APP_BROKER=wss://host:8084/mqtt [PWR_USER=… PWR_PASS=…] node wifi-test.mjs
//
// Track: B - Data + device

import mqtt from 'mqtt';
import { readFileSync } from 'node:fs';
import { createServer as netServer } from 'node:net';
import { startFakeDevice } from './wifi-fake-device.mjs';

const { DeviceLink } = await import('../app/js/device.js');
const { MqttTransport, newPairingCode } = await import('../app/js/device-wifi.js');

let DEVICE_BROKER = process.env.PWR_BROKER;
let APP_BROKER = process.env.PWR_APP_BROKER;
const auth = { username: process.env.PWR_USER, password: process.env.PWR_PASS };
let localBroker = null;
if (!APP_BROKER) {
  // Local broker: the device side uses plain MQTT (TCP), the app side a WebSocket, like the real thing.
  const { Aedes } = await import('aedes');
  const { createServer } = await import('aedes-server-factory');
  const aedes = await Aedes.createBroker();
  const tcp = netServer(aedes.handle);
  const ws = createServer(aedes, { ws: true });
  await new Promise((r) => tcp.listen(18883, r));
  await new Promise((r) => ws.listen(18884, r));
  localBroker = { close: () => { tcp.close(); ws.close(); aedes.close(); } };
  DEVICE_BROKER = 'mqtt://localhost:18883';
  APP_BROKER = 'ws://localhost:18884';
}
console.log(`Device side: ${DEVICE_BROKER}   App side: ${APP_BROKER}`);

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => { if (ok) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); } };

const code = newPairingCode();
const note = readFileSync(new URL('../app/tests/audio/add-groceries.wav', import.meta.url));
console.log(`Pairing code ${code}`);

// 1. Device offline: the app must say so, not fall back to the old protocol.
{
  const t = new MqttTransport({ broker: APP_BROKER, code, ...auth }, mqtt.connect);
  await t.connect();
  check('app reaches the broker', t.connected);
  check('device not seen yet', t.deviceOnline !== true);
  const link = new DeviceLink(t);
  let err = null;
  try { await link.hello(); } catch (e) { err = e; }
  check('no answer → clear "device did not answer" error', /did not answer/.test(err?.message || ''), err?.message);
  t.disconnect();
}

// 2. Device online: full sync like ui-device.js does it.
const dev = await startFakeDevice({ code, broker: DEVICE_BROKER, ...auth, notes: [note], log: () => {} });
const t = new MqttTransport({ broker: APP_BROKER, code, ...auth }, mqtt.connect);
await t.connect();
check('device shows as online (retained status)', t.deviceOnline === true);
const link = new DeviceLink(t);
const hi = await link.hello();
check('HELLO v1 with a Wi-Fi payload', hi.version === 1 && hi.payload === 1024, JSON.stringify(hi));
await link.setTime();
check('clock set', true);
const week = ['Monday|Morning|Physiotherapy|yellow', 'Monday|Afternoon|Walk|green', 'Wednesday|Afternoon|Groceries|red', 'Friday|Evening|Read / relax|green', 'Sunday|Morning|Église|green'];
await link.sendSchedule(week);
check('week received by the device', JSON.stringify(dev.fake.schedule) === JSON.stringify(week));
const backup = await link.getBackup();
check('backup restore returns the same week (accents kept)', JSON.stringify(backup) === JSON.stringify(week));
const notes = await link.listNotes();
check('one voice note waiting', notes.length === 1 && notes[0].bytes === note.length, JSON.stringify(notes));
const t0 = Date.now();
const bytes = await link.getNote(notes[0].id);
check(`voice note copied intact (${note.length} bytes in ${Date.now() - t0} ms)`, Buffer.compare(Buffer.from(bytes), note) === 0);
await link.deleteNote(notes[0].id);
check('note deleted on the device after the check', (await link.listNotes()).length === 0);

// 3. Device switches off: the app sees it.
const offline = new Promise((r) => { t.onStatus = (on) => { if (!on) r(true); }; setTimeout(() => r(false), 5000); });
await dev.stop();
check('device going offline is seen by the app', await offline);
t.disconnect();
localBroker?.close();

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
