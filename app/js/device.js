// The ONLY file that talks to the reminder device. Implements docs/protocol.md (v1, falls back to v0).
//
// Two transports with the same shape { connect, disconnect, send(text), onPacket, onDisconnect, connected, name }:
//   - BleTransport:  the real device over Web Bluetooth (Chrome/Edge on a laptop, Bluefy on iPad)
//   - FakeTransport: a pretend device inside the app, for testing without hardware
// A transport moves raw Bluetooth packets. DeviceLink speaks the protocol on top: it glues
// "+" pieces back together (small packets) and cuts long messages into pieces when needed.
// To move to a native iPad app later, only a new transport is needed.
//
// Track: B - Data + device

export const SERVICE_UUID = '12345678-1234-1234-1234-1234567890ab';
export const RX_UUID = '12345678-1234-1234-1234-1234567890ac';
export const TX_UUID = '12345678-1234-1234-1234-1234567890ad';
export const DEVICE_NAME = 'PWR Reminder';

const enc = new TextEncoder();
const dec = new TextDecoder();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PLUS = 0x2b; // '+': "more pieces follow"

// Cut a message into pieces of at most `max` bytes. Every piece except the last starts with '+'.
// Cuts between characters, never inside one (names may contain é, ç...).
export function splitMessage(text, max) {
  if (!max || enc.encode(text).length <= max) return [text];
  const pieces = [];
  let current = '';
  for (const ch of text) {
    if (enc.encode('+' + current + ch).length > max) { pieces.push('+' + current); current = ''; }
    current += ch;
  }
  pieces.push(current);
  return pieces;
}

// Raw bytes per "D|seq|base64" line that fit in `payload` bytes (seq up to 5 digits). Max 120.
export function noteChunkBytes(payload) {
  const room = Math.min(payload || 180, 180) - 8; // "D|12345|"
  return Math.max(3, Math.min(120, Math.floor(room / 4) * 3));
}

// ---------- Real device ----------

export class BleTransport {
  static supported() { return typeof navigator !== 'undefined' && !!navigator.bluetooth; }

  async connect() {
    // Found by its service number, not its name, so first-try devices (older name) are found too.
    this.device = await navigator.bluetooth.requestDevice({ filters: [{ services: [SERVICE_UUID] }], optionalServices: [SERVICE_UUID] });
    this.device.addEventListener('gattserverdisconnected', () => this.onDisconnect?.());
    const server = await this.device.gatt.connect();
    const service = await server.getPrimaryService(SERVICE_UUID);
    this.rx = await service.getCharacteristic(RX_UUID);
    this.tx = await service.getCharacteristic(TX_UUID);
    await this.tx.startNotifications();
    this.tx.addEventListener('characteristicvaluechanged', (ev) => {
      const v = ev.target.value;
      this.onPacket?.(new Uint8Array(v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength)));
    });
    this.name = this.device.name;
  }

  get connected() { return !!this.device?.gatt?.connected; }
  async send(text) { await this.rx.writeValue(enc.encode(text)); }
  disconnect() { if (this.device?.gatt?.connected) this.device.gatt.disconnect(); }
}

// ---------- Pretend device (for testing) ----------
// Behaves like the v1 firmware: keeps a schedule (saved in this browser) and voice notes (in memory).
// FakeTransport.payload imitates the Bluetooth packet size (20 = the smallest possible).

const FAKE_KEY = 'pwr-demo-device';

export class FakeTransport {
  static notes = []; // { id, time, bytes: Uint8Array }  shared while the page is open
  static nextId = 1;
  static payload = 180;

  constructor() {
    this.name = 'Demo device';
    this.connected = false;
    const saved = JSON.parse(localStorage.getItem(FAKE_KEY) || '{}');
    this.schedule = saved.schedule || [];
    this.partial = '';
  }
  get notes() { return FakeTransport.notes; }

  static addRecording(bytes, time = Math.floor(Date.now() / 1000)) {
    FakeTransport.notes.push({ id: FakeTransport.nextId++, time, bytes: new Uint8Array(bytes) });
  }
  static storedCount() { return (JSON.parse(localStorage.getItem(FAKE_KEY) || '{}').schedule || []).length; }
  static clearSchedule() { localStorage.removeItem(FAKE_KEY); }

  async connect() { await sleep(300); this.connected = true; }
  disconnect() { this.connected = false; this.onDisconnect?.(); }

  // Send lines back as packets no bigger than the payload, like the firmware does.
  reply(...lines) {
    const packets = lines.flatMap((l) => splitMessage(l, FakeTransport.payload)).map((p) => enc.encode(p));
    setTimeout(() => packets.forEach((p) => this.onPacket?.(p)), 15); // all at once: DeviceLink buffers them
  }

  async send(text) {
    if (!this.connected) throw new Error('Demo device not connected');
    if (enc.encode(text).length > FakeTransport.payload) throw new Error('Packet larger than the Bluetooth payload');
    await sleep(2);
    if (text.startsWith('+')) { this.partial += text.slice(1); return; }
    const line = this.partial + text;
    this.partial = '';
    const [cmd, ...args] = line.split('|');
    if (this.receiving && !cmd.startsWith('SCHEDULE_END')) { this.buffer.push(line); return; }
    switch (cmd) {
      case 'HELLO': return this.reply(`HELLO|1|${this.name}|${this.schedule.length}|${this.notes.length}|${FakeTransport.payload}`);
      case 'TIME': return this.reply('OK|TIME');
      case 'SCHEDULE_START': this.receiving = true; this.buffer = []; return;
      case 'SCHEDULE_END': {
        this.receiving = false;
        const n = Number(args[0]);
        if (args.length && n !== this.buffer.length) return this.reply(`ERR|SCHEDULE|${this.buffer.length}`);
        this.schedule = this.buffer;
        localStorage.setItem(FAKE_KEY, JSON.stringify({ schedule: this.schedule }));
        return this.reply(`SCHEDULE_RECEIVED|${this.schedule.length}`);
      }
      case 'BACKUP_GET':
        return this.reply(`BACKUP_START|${this.schedule.length}`, ...this.schedule.map((l) => 'B|' + l), `BACKUP_END|${this.schedule.length}`);
      case 'NOTES_LIST':
        return this.reply(...this.notes.map((n) => `NOTE|${n.id}|${n.time}|${n.bytes.length}`), `NOTES_END|${this.notes.length}`);
      case 'NOTE_GET': {
        const note = this.notes.find((n) => n.id === Number(args[0]));
        if (!note) return this.reply(`ERR|NOTE|${args[0]}`);
        const size = noteChunkBytes(FakeTransport.payload);
        const chunks = Math.ceil(note.bytes.length / size);
        const out = [`DATA_START|${note.id}|${note.bytes.length}|${chunks}`];
        let sum = 0;
        for (let i = 0; i < chunks; i++) {
          const part = note.bytes.subarray(i * size, i * size + size);
          part.forEach((b) => (sum = (sum + b) % 65536));
          out.push(`D|${i}|${toBase64(part)}`);
        }
        out.push(`DATA_END|${note.id}|${sum}`);
        return this.reply(...out);
      }
      case 'NOTE_DEL':
        FakeTransport.notes = FakeTransport.notes.filter((n) => n.id !== Number(args[0]));
        return this.reply(`OK|DEL|${args[0]}`);
      default: return this.reply(`ERR|UNKNOWN|${cmd}`);
    }
  }
}

function toBase64(bytes) {
  let s = '';
  bytes.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s);
}
function fromBase64(text) {
  const s = atob(text);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

// ---------- Protocol ----------

export class DeviceLink {
  constructor(transport) {
    this.t = transport;
    this.lines = [];
    this.waiter = null;
    this.version = null;
    this.payload = null; // largest message the link carries in one packet (from HELLO); null = no limit known
    this.partial = [];   // bytes of a message arriving in "+" pieces
    transport.onPacket = (bytes) => this.receive(bytes);
  }

  // Glue "+" pieces back together, then hand complete lines to read().
  receive(bytes) {
    if (bytes[0] === PLUS) { this.partial.push(bytes.subarray(1)); return; }
    const all = new Uint8Array(this.partial.reduce((n, p) => n + p.length, 0) + bytes.length);
    let o = 0;
    for (const p of this.partial) { all.set(p, o); o += p.length; }
    all.set(bytes, o);
    this.partial = [];
    this.push(dec.decode(all).trim());
  }

  push(line) {
    if (this.waiter) { const w = this.waiter; this.waiter = null; w(line); } else this.lines.push(line);
  }

  // Send one message, cut into pieces if the device said its packets are small (v1 only).
  async send(line) {
    const pieces = this.version >= 1 ? splitMessage(line, this.payload) : [line];
    for (const p of pieces) await this.t.send(p);
  }

  read(timeout = 3000) {
    if (this.lines.length) return Promise.resolve(this.lines.shift());
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.waiter = null; reject(new Error('The device did not answer in time.')); }, timeout);
      this.waiter = (l) => { clearTimeout(timer); resolve(l); };
    });
  }

  // Read lines until one starts with one of the prefixes (or is an error).
  async until(prefixes, timeout = 3000) {
    for (;;) {
      const line = await this.read(timeout);
      if (line.startsWith('ERR|')) throw new Error('Device error: ' + line);
      if (prefixes.some((p) => line.startsWith(p))) return line;
    }
  }

  async command(line, prefixes, timeout) {
    this.lines = [];
    await this.send(line);
    return this.until(prefixes, timeout);
  }

  async hello() {
    try {
      this.lines = [];
      await this.t.send('HELLO|1'); // short enough for any packet size
      const [, v, name, count, notes, payload] = (await this.until(['HELLO|'], 2000)).split('|');
      this.version = Number(v) || 1;
      this.payload = Number(payload) || null;
      return { version: this.version, name, scheduleCount: Number(count) || 0, notesCount: Number(notes) || 0, payload: this.payload };
    } catch (e) {
      this.version = 0; // first-try firmware: no HELLO, no backup, no notes
      return { version: 0, scheduleCount: null, notesCount: 0 };
    }
  }

  async setTime() {
    if (!this.version) return;
    await this.command(`TIME|${Math.floor(Date.now() / 1000)}|${-new Date().getTimezoneOffset()}`, ['OK|TIME']);
  }

  async sendSchedule(lines) {
    this.lines = [];
    if (this.version) {
      await this.send(`SCHEDULE_START|${lines.length}`);
      for (const l of lines) { await this.send(l); await sleep(20); }
      await this.send(`SCHEDULE_END|${lines.length}`);
      const r = await this.until(['SCHEDULE_RECEIVED'], 5000);
      if (Number(r.split('|')[1]) !== lines.length) throw new Error('The device did not receive the whole schedule.');
      return;
    }
    // v0
    await this.t.send('SCHEDULE_START');
    for (const l of lines) { await this.t.send(l); await sleep(120); }
    await this.t.send('SCHEDULE_END');
    try { await this.until(['SCHEDULE_RECEIVED'], 3000); } catch (e) { /* old firmware may not answer */ }
  }

  async getBackup() {
    if (!this.version) return [];
    const start = await this.command('BACKUP_GET', ['BACKUP_START|']);
    const n = Number(start.split('|')[1]);
    const out = [];
    for (;;) {
      const line = await this.read(3000);
      if (line.startsWith('BACKUP_END')) break;
      if (line.startsWith('B|')) out.push(line.slice(2));
    }
    if (out.length !== n) throw new Error('The backup from the device was incomplete.');
    return out;
  }

  async listNotes() {
    if (!this.version) return [];
    this.lines = [];
    await this.send('NOTES_LIST');
    const notes = [];
    for (;;) {
      const line = await this.until(['NOTE|', 'NOTES_END']);
      if (line.startsWith('NOTES_END')) break;
      const [, id, time, bytes] = line.split('|');
      notes.push({ id: Number(id), time: Number(time), bytes: Number(bytes) });
    }
    return notes;
  }

  // Returns the note's bytes after checking size, every piece and the sum. Throws if anything is missing.
  async getNote(id, onProgress) {
    const start = await this.command(`NOTE_GET|${id}`, ['DATA_START|'], 4000);
    const [, , bytesText, chunksText] = start.split('|');
    const total = Number(bytesText), chunks = Number(chunksText);
    const parts = new Array(chunks);
    let endSum = null;
    for (;;) {
      const line = await this.read(4000);
      if (line.startsWith('DATA_END|')) { endSum = Number(line.split('|')[2]); break; }
      if (!line.startsWith('D|')) continue;
      const i = line.indexOf('|', 2);
      const seq = Number(line.slice(2, i));
      parts[seq] = fromBase64(line.slice(i + 1));
      onProgress?.((seq + 1) / chunks);
    }
    if (parts.some((p) => !p) || parts.length !== chunks) throw new Error('Some pieces of the note were missing.');
    const out = new Uint8Array(total);
    let offset = 0, sum = 0;
    for (const p of parts) { out.set(p, offset); offset += p.length; p.forEach((b) => (sum = (sum + b) % 65536)); }
    if (offset !== total || sum !== endSum) throw new Error('The note arrived damaged.');
    return out;
  }

  async deleteNote(id) { await this.command(`NOTE_DEL|${id}`, ['OK|DEL']); }
}
