// A pretend reminder device that answers over Wi-Fi (MQTT), exactly like the firmware should.
// It reuses the app's demo device (FakeTransport), so its answers follow docs/protocol.md.
// Use it to test the planner's Wi-Fi sync without the hardware, and as a reference for the firmware.
//
//   cd tools && npm install
//   node wifi-fake-device.mjs ABCD-EFGH-JKLM [--note ../app/tests/audio/add-groceries.wav]
//
// Broker: PWR_BROKER (default mqtts://broker.emqx.io:8883, a PUBLIC test broker: demo data only),
// PWR_USER and PWR_PASS if the broker needs them. In the planner, use the same broker's wss:// address.
//
// Track: B - Data + device

import mqtt from 'mqtt';
import { readFileSync } from 'node:fs';

// The demo device keeps its week in localStorage; in Node it lives in memory.
const memory = new Map();
globalThis.localStorage ??= { getItem: (k) => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, String(v)), removeItem: (k) => memory.delete(k) };

const { FakeTransport } = await import('../app/js/device.js');
const { normalizeCode, topicId, topicsFor } = await import('../app/js/device-wifi.js');

export async function startFakeDevice({ code, broker, username, password, notes = [], log = console.log }) {
  const topics = topicsFor(await topicId(code));
  FakeTransport.payload = 1024; // over Wi-Fi the device reports a big payload: no "+" pieces
  notes.forEach((bytes) => FakeTransport.addRecording(bytes));
  const fake = new FakeTransport();
  fake.name = 'Wi-Fi demo device';
  fake.connected = true;

  const client = mqtt.connect(broker, {
    username, password,
    clientId: 'pwr-dev-' + Math.random().toString(36).slice(2, 10),
    will: { topic: topics.status, payload: 'offline', retain: true, qos: 1 },
  });
  fake.onPacket = (bytes) => client.publish(topics.toApp, Buffer.from(bytes), { qos: 1 });
  client.on('message', (topic, payload) => {
    const line = payload.toString();
    log('app →', line.length > 60 ? line.slice(0, 60) + '…' : line);
    fake.send(line).catch((e) => log('error:', e.message));
  });
  await new Promise((resolve, reject) => { client.once('connect', resolve); client.once('error', reject); });
  await client.subscribeAsync(topics.toDevice, { qos: 1 });
  await client.publishAsync(topics.status, 'online', { retain: true, qos: 1 });
  return {
    topics, fake,
    async stop() { await client.publishAsync(topics.status, 'offline', { retain: true, qos: 1 }); await client.endAsync(); },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const code = normalizeCode(args[0]);
  if (!code) { console.error('Usage: node wifi-fake-device.mjs <pairing code, e.g. ABCD-EFGH-JKLM> [--note file.wav]'); process.exit(1); }
  const noteAt = args.indexOf('--note');
  const broker = process.env.PWR_BROKER || 'mqtts://broker.emqx.io:8883';
  const notes = noteAt > 0 ? [readFileSync(args[noteAt + 1])] : [];
  const dev = await startFakeDevice({ code, broker, username: process.env.PWR_USER, password: process.env.PWR_PASS, notes });
  console.log(`Wi-Fi demo device online. Pairing code ${code} → topics pwr/${dev.topics.toApp.split('/')[1]}/… on ${broker}`);
  console.log(`${notes.length} voice note(s) waiting. Press Ctrl+C to switch it off.`);
  process.on('SIGINT', async () => { await dev.stop(); console.log('\nDevice offline.'); process.exit(0); });
}
