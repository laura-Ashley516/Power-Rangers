// WAV files from the reminder device.
//
// The device saves voice notes compressed with IMA ADPCM (a standard WAV format, 4 bits per sample
// instead of 16, so 4x smaller and 4x faster to send over Bluetooth). Safari cannot play that
// format by itself, so toPlayableWav() unpacks it into a normal 16-bit WAV that every browser
// (and Whisper) understands. Plain 16-bit WAV files are returned unchanged.
//
// encodeImaAdpcmWav() does the reverse; it is used by the tests and the demo device to imitate
// the real device. Both follow the standard IMA ADPCM WAV layout (format 0x11):
// blocks of 256 bytes = 4-byte header (first sample, step index) + 252 bytes = 505 samples.
//
// Track: C - Rules + voice

const STEPS = [
  7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45, 50, 55, 60, 66, 73, 80, 88, 97, 107, 118,
  130, 143, 157, 173, 190, 209, 230, 253, 279, 307, 337, 371, 408, 449, 494, 544, 598, 658, 724, 796, 876, 963, 1060,
  1166, 1282, 1411, 1552, 1707, 1878, 2066, 2272, 2499, 2749, 3024, 3327, 3660, 4026, 4428, 4871, 5358, 5894, 6484,
  7132, 7845, 8630, 9493, 10442, 11487, 12635, 13899, 15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794, 32767,
];
const INDEX_ADJUST = [-1, -1, -1, -1, 2, 4, 6, 8];
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export const BLOCK_ALIGN = 256;
export const SAMPLES_PER_BLOCK = (BLOCK_ALIGN - 4) * 2 + 1; // 505

// One 4-bit code -> next sample. Shared by encoder and decoder so both stay identical.
function step(state, code) {
  const s = STEPS[state.index];
  let diff = s >> 3;
  if (code & 4) diff += s;
  if (code & 2) diff += s >> 1;
  if (code & 1) diff += s >> 2;
  state.sample = clamp(state.sample + (code & 8 ? -diff : diff), -32768, 32767);
  state.index = clamp(state.index + INDEX_ADJUST[code & 7], 0, 88);
  return state.sample;
}

function encodeSample(state, sample) {
  let diff = sample - state.sample;
  let code = 0;
  if (diff < 0) { code = 8; diff = -diff; }
  let s = STEPS[state.index];
  if (diff >= s) { code |= 4; diff -= s; }
  s >>= 1;
  if (diff >= s) { code |= 2; diff -= s; }
  s >>= 1;
  if (diff >= s) code |= 1;
  step(state, code);
  return code;
}

// ---------- reading WAV files ----------

function chunks(view) {
  const out = {};
  let p = 12;
  while (p + 8 <= view.byteLength) {
    const id = String.fromCharCode(view.getUint8(p), view.getUint8(p + 1), view.getUint8(p + 2), view.getUint8(p + 3));
    const size = view.getUint32(p + 4, true);
    out[id] = { offset: p + 8, size: Math.min(size, view.byteLength - p - 8) };
    p += 8 + size + (size & 1);
  }
  return out;
}

export function wavInfo(buffer) {
  const view = new DataView(buffer);
  if (view.byteLength < 12 || view.getUint32(0, false) !== 0x52494646 /* RIFF */) return null;
  const c = chunks(view);
  if (!c['fmt '] || !c.data) return null;
  const f = c['fmt '].offset;
  return {
    format: view.getUint16(f, true),
    channels: view.getUint16(f + 2, true),
    sampleRate: view.getUint32(f + 4, true),
    blockAlign: view.getUint16(f + 12, true),
    samplesPerBlock: c['fmt '].size >= 20 ? view.getUint16(f + 18, true) : 0,
    totalSamples: c.fact ? view.getUint32(c.fact.offset, true) : 0,
    data: c.data,
  };
}

export function decodeImaAdpcm(buffer, info = wavInfo(buffer)) {
  const bytes = new Uint8Array(buffer, info.data.offset, info.data.size);
  const spb = info.samplesPerBlock || (info.blockAlign - 4) * 2 + 1;
  const blocks = Math.floor(bytes.length / info.blockAlign);
  const total = info.totalSamples || blocks * spb;
  const out = new Int16Array(total);
  let n = 0;
  for (let b = 0; b < blocks && n < total; b++) {
    const base = b * info.blockAlign;
    const first = (bytes[base] | (bytes[base + 1] << 8)) << 16 >> 16;
    const state = { sample: first, index: clamp(bytes[base + 2], 0, 88) };
    out[n++] = first;
    for (let i = base + 4; i < base + info.blockAlign && n < total; i++) {
      out[n++] = step(state, bytes[i] & 0x0f);
      if (n < total) out[n++] = step(state, bytes[i] >> 4);
    }
  }
  return out;
}

export function pcmWav(samples, sampleRate) {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const str = (o, s) => [...s].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)));
  str(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, samples.length * 2, true);
  new Int16Array(buf, 44).set(samples);
  return buf;
}

// Returns { buffer, mime } ready to store, play and transcribe.
export function toPlayableWav(buffer) {
  const info = wavInfo(buffer);
  if (info && info.format === 0x11 && info.channels === 1) {
    return { buffer: pcmWav(decodeImaAdpcm(buffer, info), info.sampleRate), mime: 'audio/wav', unpacked: true };
  }
  return { buffer, mime: 'audio/wav', unpacked: false };
}

// ---------- writing (tests and demo device) ----------

export function encodeImaAdpcmWav(samples, sampleRate) {
  const blocks = Math.ceil(samples.length / SAMPLES_PER_BLOCK);
  const dataBytes = blocks * BLOCK_ALIGN;
  const buf = new ArrayBuffer(60 + dataBytes);
  const v = new DataView(buf);
  const str = (o, s) => [...s].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)));
  str(0, 'RIFF'); v.setUint32(4, 52 + dataBytes, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 20, true);
  v.setUint16(20, 0x11, true); v.setUint16(22, 1, true); v.setUint32(24, sampleRate, true);
  v.setUint32(28, Math.round((sampleRate * BLOCK_ALIGN) / SAMPLES_PER_BLOCK), true);
  v.setUint16(32, BLOCK_ALIGN, true); v.setUint16(34, 4, true); v.setUint16(36, 2, true); v.setUint16(38, SAMPLES_PER_BLOCK, true);
  str(40, 'fact'); v.setUint32(44, 4, true); v.setUint32(48, samples.length, true);
  str(52, 'data'); v.setUint32(56, dataBytes, true);
  const out = new Uint8Array(buf, 60);
  let carryIndex = 0; // the step index carries over from one block to the next
  for (let b = 0; b < blocks; b++) {
    const start = b * SAMPLES_PER_BLOCK;
    const at = (i) => (start + i < samples.length ? samples[start + i] : 0); // last block padded with silence
    const base = b * BLOCK_ALIGN;
    const state = { sample: at(0), index: carryIndex };
    out[base] = state.sample & 0xff; out[base + 1] = (state.sample >> 8) & 0xff; out[base + 2] = state.index; out[base + 3] = 0;
    for (let i = 0; i < BLOCK_ALIGN - 4; i++) {
      const lo = encodeSample(state, at(1 + 2 * i));
      const hi = encodeSample(state, at(2 + 2 * i));
      out[base + 4 + i] = lo | (hi << 4);
    }
    carryIndex = state.index;
  }
  return buf;
}
