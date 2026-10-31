// Wi-Fi link to the reminder device, through an MQTT broker on the internet (docs/wifi-plan.md).
// Why a broker: Safari blocks an https page from talking to a plain http device on the home network,
// so the app and the device both connect to the broker and exchange messages there.
//
// MqttTransport has the same shape as BleTransport ({ connect, disconnect, send(text), onPacket,
// onDisconnect, connected, name }). One MQTT message = one protocol line (docs/protocol.md),
// so DeviceLink and the sync code are the same for Bluetooth and Wi-Fi.
//
// Track: B - Data + device

const MQTT_LIB = 'https://cdn.jsdelivr.net/npm/mqtt@5.15.2/dist/mqtt.esm.js';
const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O or 1/I, easy to read and type

// ---------- Pairing code ----------
// 12 characters, shown as ABCD-EFGH-JKLM and typed into the device once (its Wi-Fi setup page).
// The topics use a hash of the code, so the code itself never travels (it can become the encryption key later).

export function newPairingCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const raw = Array.from(bytes, (b) => CODE_LETTERS[b % CODE_LETTERS.length]).join('');
  return raw.match(/.{4}/g).join('-');
}

// Upper case, spaces/dashes removed, grouped by 4. Returns '' if it is not a valid 12-character code.
export function normalizeCode(text) {
  const raw = String(text || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (raw.length !== 12 || [...raw].some((c) => !CODE_LETTERS.includes(c))) return '';
  return raw.match(/.{4}/g).join('-');
}

// First 12 hex characters of SHA-256 of the code without dashes.
export async function topicId(code) {
  const raw = normalizeCode(code).replace(/-/g, '');
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw)));
  return Array.from(hash.slice(0, 6), (b) => b.toString(16).padStart(2, '0')).join('');
}

export const topicsFor = (id) => ({
  toDevice: `pwr/${id}/app`,   // app → device: protocol lines
  toApp: `pwr/${id}/dev`,      // device → app: protocol lines
  status: `pwr/${id}/status`,  // device presence: "online" / "offline" (retained, set by the device)
});

let libPromise = null;
async function mqttConnect() {
  libPromise = libPromise || import(MQTT_LIB);
  const lib = await libPromise;
  return lib.connect || lib.default.connect;
}

export class MqttTransport {
  static supported() { return typeof WebSocket !== 'undefined' && !!globalThis.crypto?.subtle; }

  // wifi = settings.wifi: { broker: 'wss://host:port/mqtt', username, password, code }
  constructor(wifi, connectFn = null) {
    this.wifi = wifi || {};
    this.connectFn = connectFn; // tests pass mqtt's connect directly
    this.name = 'Reminder device (Wi-Fi)';
    this.deviceOnline = null;   // null = the device never said
    this.helloTimeout = 6000;   // the internet adds delay
    this.needsV1 = true;        // the first-try firmware has no Wi-Fi: no silent v0 fallback
    this.open = false;
  }

  async connect() {
    const { broker, username, password } = this.wifi;
    const code = normalizeCode(this.wifi.code);
    if (!broker || !code) throw new Error('Wi-Fi is not set up yet: fill in “Wi-Fi setup” below.');
    if (!/^wss?:\/\//.test(broker)) throw new Error('The broker address must start with wss:// (secure WebSocket).');
    this.topics = topicsFor(await topicId(code));
    const connect = this.connectFn || (await mqttConnect());
    const client = connect(broker, {
      username: username || undefined,
      password: password || undefined,
      clientId: 'pwr-app-' + Math.random().toString(36).slice(2, 10),
      clean: true,
      connectTimeout: 10000,
      reconnectPeriod: 0, // DeviceLink reconnects by running Connect again
    });
    this.client = client;
    await new Promise((resolve, reject) => {
      const fail = (err) => { client.end(true); reject(new Error(friendly(err))); };
      const timer = setTimeout(() => fail(new Error('timeout')), 12000);
      client.once('connect', () => { clearTimeout(timer); resolve(); });
      client.once('error', (err) => { clearTimeout(timer); fail(err); });
    });
    client.on('message', (topic, payload) => {
      if (topic === this.topics.toApp) this.onPacket?.(new Uint8Array(payload));
      else if (topic === this.topics.status) { this.deviceOnline = String(payload) === 'online'; this.onStatus?.(this.deviceOnline); }
    });
    client.on('close', () => { if (this.open) { this.open = false; this.onDisconnect?.(); } });
    await client.subscribeAsync([this.topics.toApp, this.topics.status], { qos: 1 });
    this.open = true;
    await new Promise((r) => setTimeout(r, 400)); // the retained "online"/"offline" usually arrives right away
  }

  get connected() { return this.open && !!this.client?.connected; }
  async send(text) { await this.client.publishAsync(this.topics.toDevice, text, { qos: 1 }); }
  disconnect() { this.open = false; this.client?.end(true); }
}

function friendly(err) {
  const m = String(err?.message || err);
  if (/not authorized|bad user|auth/i.test(m)) return 'The broker refused the username or password.';
  if (/timeout/i.test(m)) return 'No answer from the broker. Check the address and the internet connection.';
  return 'Could not reach the broker (' + m + ').';
}
