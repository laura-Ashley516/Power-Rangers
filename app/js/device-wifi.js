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

// ---------- End-to-end encryption (protocol v3, docs/protocol.md) ----------
// "Nothing readable is sent online": every line is encrypted here and on the device with AES-256-GCM.
// Key = SHA-256("pwr-e2e-key|" + the 12 code characters). Sealed = 12-byte IV ‖ ciphertext ‖ 16-byte tag,
// with the topic as additional data, sent as base64 text. The broker (even a public test broker) only sees scrambled bytes.
export async function e2eKey(code) {
  const raw = normalizeCode(code).replace(/-/g, '');
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('pwr-e2e-key|' + raw));
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
const b64 = (bytes) => { let s = ''; bytes.forEach((b) => (s += String.fromCharCode(b))); return btoa(s); };
const unb64 = (text) => { try { const s = atob(String(text).trim()); return Uint8Array.from(s, (c) => c.charCodeAt(0)); } catch (e) { return new Uint8Array(0); } };
export async function seal(key, topic, text, iv = crypto.getRandomValues(new Uint8Array(12))) {
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(topic) }, key, new TextEncoder().encode(text)));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv, 0);
  out.set(ct, 12);
  return b64(out);
}
// Returns the line's bytes, or null if the message was not sealed with this key for this topic.
export async function open(key, topic, payload) {
  const bytes = unb64(new TextDecoder().decode(payload));
  if (bytes.length < 12 + 16) return null;
  try {
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.subarray(0, 12), additionalData: new TextEncoder().encode(topic) }, key, bytes.subarray(12)));
  } catch (e) { return null; }
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

// The relay address as typed in Settings: just its host (what the EMQX console shows, e.g.
// "abc123.ala.us-east-1.emqxsl.com"), host:port, or a full wss:// address. The planner uses MQTT over
// secure WebSocket: port 8084 and path /mqtt (EMQX) unless another port or path is given.
export function brokerUrl(text) {
  const t = String(text || '').trim();
  if (!t) return '';
  if (/^wss?:\/\//i.test(t)) return t;
  if (/^(mqtts?|https?):\/\//i.test(t)) return brokerUrl(t.replace(/^[a-z]+:\/\//i, '').replace(/:\d+(?=\/|$)/, ''));
  const m = /^([^/:]+)(?::(\d+))?(\/.*)?$/.exec(t);
  if (!m) return '';
  return `wss://${m[1]}:${m[2] || 8084}${m[3] || '/mqtt'}`;
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
    const { username, password } = this.wifi;
    const broker = brokerUrl(this.wifi.broker);
    const code = normalizeCode(this.wifi.code);
    if (!broker || !code) throw new Error('Wi-Fi is not set up yet: fill in “Wi-Fi setup” below.');
    this.topics = topicsFor(await topicId(code));
    this.key = await e2eKey(code);
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
    // Decrypt in order (a chain), so lines arrive in the order the device sent them.
    let chain = Promise.resolve();
    const incoming = { received: 0, delivered: 0, rejected: 0 };
    client.on('message', (topic, payload) => {
      if (topic === this.topics.toApp) {
        incoming.received++;
        chain = chain.then(async () => {
          const line = await open(this.key, topic, payload);
          if (line) {
            this.onPacket?.(line);
            incoming.delivered++;
          } else {
            incoming.rejected++;
            console.warn('[MQTT] Could not authenticate a device message.', { ...incoming });
          }
        }).catch((error) => {
          incoming.rejected++;
          console.error('[MQTT] Device message handler failed.', { ...incoming }, error.name);
        });
      }
      else if (topic === this.topics.status) { this.deviceOnline = String(payload) === 'online'; this.onStatus?.(this.deviceOnline); }
    });
    client.on('error', (error) => {
      if (this.open) console.warn('[MQTT] Connection error.', { ...incoming }, error.code || error.name);
    });
    client.on('close', () => {
      if (this.open) {
        console.warn('[MQTT] Connection closed.', { ...incoming });
        this.open = false;
        this.onDisconnect?.();
      }
    });
    await client.subscribeAsync([this.topics.toApp, this.topics.status], { qos: 1 });
    this.open = true;
    await new Promise((r) => setTimeout(r, 400)); // the retained "online"/"offline" usually arrives right away
  }

  get connected() { return this.open && !!this.client?.connected; }
  async send(text) { await this.client.publishAsync(this.topics.toDevice, await seal(this.key, this.topics.toDevice, text), { qos: 1 }); }
  disconnect() { this.open = false; this.client?.end(true); }
}

function friendly(err) {
  const m = String(err?.message || err);
  if (/not authorized|bad user|auth/i.test(m)) return 'The broker refused the username or password.';
  if (/timeout/i.test(m)) return 'No answer from the broker. Check the address and the internet connection.';
  return 'Could not reach the broker (' + m + ').';
}
