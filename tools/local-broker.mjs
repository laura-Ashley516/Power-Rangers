// A private MQTT broker on this computer, for testing the Wi-Fi sync without internet.
//   node local-broker.mjs
// Planner (opened from http://localhost): relay address ws://localhost:18884, no username / password.
// Wi-Fi demo device:  PWR_BROKER=mqtt://localhost:18883 node wifi-fake-device.mjs <pairing code>
// A real ESP32 on the same network can use mqtt://<this computer's IP>:18883 (no TLS: testing only).
//
// Track: B - Data + device

import { createServer as netServer } from 'node:net';
import { Aedes } from 'aedes';
import { createServer } from 'aedes-server-factory';

const aedes = await Aedes.createBroker();
netServer(aedes.handle).listen(18883);
createServer(aedes, { ws: true }).listen(18884);
aedes.on('client', (c) => console.log('connected:', c.id));
aedes.on('clientDisconnect', (c) => console.log('disconnected:', c.id));
console.log('Local broker: device mqtt://localhost:18883 · planner ws://localhost:18884 (Ctrl+C to stop)');
