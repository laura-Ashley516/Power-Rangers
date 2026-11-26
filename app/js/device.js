// The ONLY file that talks to the reminder device. Implements docs/protocol.md (v1, falls back to v0).
//
// Transports with the same shape { connect, disconnect, send(text), onPacket, onDisconnect, connected, name }:
//   - BleTransport:  the real device over Web Bluetooth (Chrome/Edge on a laptop, Bluefy on iPad)
//   - MqttTransport: the real device over Wi-Fi through an MQTT broker (device-wifi.js, any browser)
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
  static state = null; // v3: the planner copy kept on the demo device { bytes, at }

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
      // v2 like the firmware (Nov 2026): clock times as a 5th schedule field, quiet times.
      case 'HELLO': return this.reply(`HELLO|3|${this.name}|${this.schedule.length}|${this.notes.length}|${FakeTransport.payload}`);
      // v3: a full copy of the planner, kept as bytes (like the firmware's /state.bin)
      case 'STATE_START': this.stateIn = { bytes: Number(args[0]), chunks: Number(args[1]), at: Number(args[2]), parts: [] }; return;
      case 'S': if (this.stateIn) this.stateIn.parts[Number(args[0])] = fromBase64(args[1]); return;
      case 'STATE_END': {
        const st = this.stateIn;
        this.stateIn = null;
        if (!st || st.parts.length !== st.chunks || st.parts.some((p) => !p)) return this.reply('ERR|STATE|incomplete');
        const all = new Uint8Array(st.bytes);
        let o = 0, sum = 0;
        for (const p of st.parts) { all.set(p, o); o += p.length; p.forEach((b) => (sum = (sum + b) % 65536)); }
        if (o !== st.bytes || sum !== Number(args[0])) return this.reply('ERR|STATE|sum');
        FakeTransport.state = { bytes: all, at: st.at };
        return this.reply(`STATE_SAVED|${all.length}`);
      }
      case 'STATE_GET': {
        const st = FakeTransport.state;
        if (!st) return this.reply('STATE_NONE');
        const size = noteChunkBytes(FakeTransport.payload);
        const chunks = Math.ceil(st.bytes.length / size);
        let sum = 0;
        st.bytes.forEach((b) => (sum = (sum + b) % 65536));
        const out = [`STATE_DATA|${st.bytes.length}|${chunks}|${st.at}`];
        for (let i = 0; i < chunks; i++) out.push(`S|${i}|${toBase64(st.bytes.subarray(i * size, i * size + size))}`);
        out.push(`STATE_DATA_END|${sum}`);
        return this.reply(...out);
      }
      case 'QUIET_START': this.quiet = []; return;
      case 'Q': this.quiet = [...(this.quiet || []), args.join('|')]; return;
      case 'QUIET_END': return Number(args[0]) === (this.quiet || []).length ? this.reply(`QUIET_RECEIVED|${this.quiet.length}`) : this.reply(`ERR|QUIET|${(this.quiet || []).length}`);
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
    this.noteBatches = false;
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
    this.noteBatches = false;
    try {
      this.lines = [];
      await this.t.send('HELLO|1'); // short enough for any packet size
      const [, v, name, count, notes, payload, features] = (await this.until(['HELLO|'], this.t.helloTimeout || 2000)).split('|');
      this.version = Number(v) || 1;
      this.payload = Number(payload) || null;
      this.noteBatches = features?.split(',').includes('NOTE_BATCH') ?? false;
      return { version: this.version, name, scheduleCount: Number(count) || 0, notesCount: Number(notes) || 0, payload: this.payload };
    } catch (e) {
      if (this.t.needsV1) throw new Error('The device did not answer. Check that it is switched on and connected to Wi-Fi.');
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

  // Quiet blocks (protocol v2): the device does not vibrate or beep there; reminders wait until the block ends.
  // Older (v1) devices do not know the command, so it is only sent to v2 devices.
  async sendQuiet(lines) {
    if (!(this.version >= 2)) return false;
    this.lines = [];
    await this.send(`QUIET_START|${lines.length}`);
    for (const l of lines) { await this.send(`Q|${l}`); await sleep(20); }
    await this.send(`QUIET_END|${lines.length}`);
    await this.until(['QUIET_RECEIVED'], 5000);
    return true;
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
    if (this.noteBatches) return this.getNoteInBatches(id, onProgress);
    let start;
    try {
      start = await this.command(`NOTE_GET|${id}`, [`DATA_START|${id}|`], 4000);
    } catch (error) {
      throw new Error(`Note ${id}: waiting for recording to start. ${error.message}`, { cause: error });
    }
    const [, , bytesText, chunksText] = start.split('|');
    const total = Number(bytesText), chunks = Number(chunksText);
    const parts = new Array(chunks).fill(null);
    let received = 0;
    let endSum = null;
    for (;;) {
      let line;
      try {
        line = await this.until(['D|', `DATA_END|${id}|`], 4000);
      } catch (error) {
        throw new Error(`Note ${id}: waiting for audio or end marker (${received}/${chunks} chunks received). ${error.message}`, { cause: error });
      }
      if (line.startsWith('DATA_END|')) { endSum = Number(line.split('|')[2]); break; }
      const i = line.indexOf('|', 2);
      const seq = Number(line.slice(2, i));
      if (i <= 2 || !Number.isInteger(seq) || seq < 0 || seq >= chunks || parts[seq]) continue;
      parts[seq] = fromBase64(line.slice(i + 1));
      received++;
      onProgress?.(received / chunks);
    }
    if (received !== chunks) {
      const missing = [];
      for (let i = 0; i < chunks; i++) {
        if (!parts[i]) missing.push(i);
      }
      console.warn(`[AUDIO] Note ${id} missing chunks:`, missing);
      throw new Error(`Note ${id}: missing ${missing.length} of ${chunks} audio chunks.`);
    }
    const out = new Uint8Array(total);
    let offset = 0, sum = 0;
    for (const p of parts) { out.set(p, offset); offset += p.length; p.forEach((b) => (sum = (sum + b) % 65536)); }
    if (offset !== total || sum !== endSum) throw new Error('The note arrived damaged.');
    return out;
  }

  async getNoteInBatches(id, onProgress) {
    const batchSize = 8;
    let batchPauseMs = 350;
    const parts = [];
    let total, chunks;
    for (let first = 0; chunks === undefined || first < chunks;) {
      let batch;
      for (let attempt = 1; attempt <= 3; attempt++) {
        let stage = 'waiting for DATA_START';
        let receivedCount = 0;
        try {
          const start = await this.command(`NOTE_BATCH|${id}|${first}|${batchSize}`, [`DATA_START|${id}|`], 4000);
          const [, , bytesText, chunksText] = start.split('|');
          const size = Number(bytesText), count = Number(chunksText);
          if (!Number.isSafeInteger(size) || !Number.isSafeInteger(count) || count <= first || size < count ||
              (total !== undefined && (size !== total || count !== chunks))) {
            throw new Error('Invalid recording size.');
          }
          total = size;
          chunks = count;
          const length = Math.min(batchSize, chunks - first);
          const received = new Array(length).fill(null);
          stage = 'waiting for batch audio or DATA_BATCH_END';
          const endPrefix = `DATA_BATCH_END|${id}|${first}|`;
          let expectedSum;
          for (;;) {
            const line = await this.until(['D|', endPrefix], 4000);
            if (line.startsWith(endPrefix)) {
              expectedSum = Number(line.slice(endPrefix.length));
              break;
            }
            const separator = line.indexOf('|', 2);
            const index = Number(line.slice(2, separator)) - first;
            if (separator <= 2 || !Number.isInteger(index) || index < 0 || index >= length || received[index]) continue;
            const bytes = fromBase64(line.slice(separator + 1));
            if (bytes.length) {
              received[index] = bytes;
              receivedCount++;
            }
          }
          stage = 'validating batch';
          const missing = length - receivedCount;
          if (missing) throw new Error(`${missing} of ${length} chunks missing.`);
          let sum = 0;
          for (const part of received) for (const byte of part) sum = (sum + byte) & 0xffff;
          if (sum !== expectedSum) throw new Error('Batch checksum did not match.');
          batch = received;
          break;
        } catch (error) {
          const message = `Note ${id}, batch starting at chunk ${first + 1}, attempt ${attempt}, ${stage} (${receivedCount} chunks received): ${error.message}`;
          if (attempt === 3 || !this.t.connected) throw new Error(message, { cause: error });
          console.warn('[AUDIO]', message);
          batchPauseMs = 500;
          await sleep(1000 * attempt);
        }
      }
      parts.push(...batch);
      first += batch.length;
      onProgress?.(first / chunks);
      if (first < chunks) await sleep(batchPauseMs);
    }
    const size = parts.reduce((sum, part) => sum + part.length, 0);
    if (size !== total) throw new Error(`Note ${id}: received ${size} of ${total} bytes.`);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) {
      out.set(part, offset);
      offset += part.length;
    }
    return out;
  }

  async deleteNote(id) {
    try {
      await this.command(`NOTE_DEL|${id}`, [`OK|DEL|${id}`]);
    } catch (error) {
      throw new Error(`Note ${id}: saved locally, but deletion was not confirmed. ${error.message}`, { cause: error });
    }
  }

  // ---------- v3: a full copy of the planner kept on the device (docs/protocol.md) ----------
  // bytes: the planner, gzip-compressed (store.packState). The device stores them without reading them.
  async sendState(bytes, savedAt = Date.now()) {
    if (!(this.version >= 3)) return false;
    const size = noteChunkBytes(this.payload || 180);
    const chunks = Math.ceil(bytes.length / size);
    let sum = 0;
    bytes.forEach((b) => (sum = (sum + b) % 65536));
    this.lines = [];
    await this.send(`STATE_START|${bytes.length}|${chunks}|${Math.floor(savedAt / 1000)}`);
    for (let i = 0; i < chunks; i++) {
      await this.send(`S|${i}|${toBase64(bytes.subarray(i * size, i * size + size))}`);
      await sleep(this.t.chunkGap ?? 12);
    }
    await this.send(`STATE_END|${sum}`);
    const r = await this.until(['STATE_SAVED|'], 8000);
    if (Number(r.split('|')[1]) !== bytes.length) throw new Error('The device did not keep the whole copy.');
    return true;
  }

  // The copy kept on the device: { bytes, savedAt } or null when it has none.
  async getState() {
    if (!(this.version >= 3)) return null;
    const start = await this.command('STATE_GET', ['STATE_DATA|', 'STATE_NONE'], 5000);
    if (start.startsWith('STATE_NONE')) return null;
    const [, bytesText, chunksText, unix] = start.split('|');
    const total = Number(bytesText), chunks = Number(chunksText);
    const parts = new Array(chunks);
    let endSum = null;
    for (;;) {
      const line = await this.read(5000);
      if (line.startsWith('STATE_DATA_END|')) { endSum = Number(line.split('|')[1]); break; }
      if (!line.startsWith('S|')) continue;
      const i = line.indexOf('|', 2);
      parts[Number(line.slice(2, i))] = fromBase64(line.slice(i + 1));
    }
    if (parts.length !== chunks || parts.some((p) => !p)) throw new Error('Some pieces of the copy were missing.');
    const out = new Uint8Array(total);
    let offset = 0, sum = 0;
    for (const p of parts) { out.set(p, offset); offset += p.length; p.forEach((b) => (sum = (sum + b) % 65536)); }
    if (offset !== total || sum !== endSum) throw new Error('The copy arrived damaged.');
    return { bytes: out, savedAt: Number(unix) * 1000 };
  }
}
