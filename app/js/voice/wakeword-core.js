// Wake word ("Hey Cal") detection with openWakeWord models, run on this device (nothing is sent online).
// Team decision, Nov 2026: openWakeWord (open source, Apache 2.0), in the planner only (the reminder device's
// chip is too small to listen for a wake word).
//
// openWakeWord is three small neural networks in a row, run every 80 ms on the microphone sound:
//   1. melspectrogram.onnx  sound (16 kHz)            → 32 frequency bands every 10 ms
//   2. embedding_model.onnx the last 76 band frames   → 96 numbers describing the last ~0.8 s of sound
//   3. <word>.onnx           the last 16 descriptions  → a score from 0 to 1: "did someone just say the word?"
// Models 1 and 2 are shared by every wake word; only model 3 is trained for "Hey Cal" (docs/hey-cal-training.md).
// This file follows openWakeWord's own Python streaming code (openwakeword/utils.py, AudioFeatures) step by step.
// Pure: no page, no microphone. `ort` (onnxruntime-web) is passed in. Used by wakeword.js and app/tests.
//
// Track: C - Rules + voice

export const SAMPLE_RATE = 16000;
export const CHUNK = 1280;            // 80 ms of sound per step
const MEL_CONTEXT = 160 * 3;          // extra samples so the band frames join up between steps
const EMB_WINDOW = 76;                // band frames per description
const EMB_STEP = 8;                   // band frames per 80 ms step
const WORD_INPUT = 16;                // descriptions the word model looks at (~1.3 s)
const MEL_KEEP = 970, EMB_KEEP = 120; // how much history is kept

export class WakeWordDetector {
  // urls: { mel, embedding, word }; ort: the onnxruntime-web module
  constructor(ort, urls, { threshold = 0.5 } = {}) {
    this.ort = ort;
    this.urls = urls;
    this.threshold = threshold;
  }

  async load() {
    const opts = { executionProviders: ['wasm'] };
    [this.mel, this.emb, this.word] = await Promise.all([
      this.ort.InferenceSession.create(this.urls.mel, opts),
      this.ort.InferenceSession.create(this.urls.embedding, opts),
      this.ort.InferenceSession.create(this.urls.word, opts),
    ]);
    await this.reset();
  }

  // Start fresh (e.g. after a voice note): the history is filled like openWakeWord does, so the first
  // second of sound cannot trigger by itself.
  async reset() {
    this.raw = new Float32Array(0);
    this.melFrames = Array.from({ length: EMB_WINDOW }, () => new Float32Array(32).fill(1));
    this.features = [];
    this.steps = 0;
    // openWakeWord starts its description history from 4 s of quiet noise.
    const noise = new Float32Array(SAMPLE_RATE * 4);
    for (let i = 0; i < noise.length; i++) noise[i] = Math.round((Math.random() * 2 - 1) * 1000);
    for (let o = 0; o + CHUNK <= noise.length; o += CHUNK) await this.features_(noise.subarray(o, o + CHUNK));
    this.steps = 0;
  }

  async run_(session, data, dims) {
    const out = await session.run({ [session.inputNames[0]]: new this.ort.Tensor('float32', data, dims) });
    return out[session.outputNames[0]];
  }

  // One 80 ms step: new band frames and one new description.
  async features_(chunk) {
    const raw = new Float32Array(this.raw.length + chunk.length);
    raw.set(this.raw);
    raw.set(chunk, this.raw.length);
    this.raw = raw.subarray(Math.max(0, raw.length - (CHUNK + MEL_CONTEXT)));
    const melIn = this.raw.slice(Math.max(0, this.raw.length - CHUNK - MEL_CONTEXT));
    const mel = await this.run_(this.mel, melIn, [1, melIn.length]);
    const frames = mel.dims[mel.dims.length - 2];
    for (let f = 0; f < frames; f++) {
      const row = new Float32Array(32);
      for (let b = 0; b < 32; b++) row[b] = mel.data[f * 32 + b] / 10 + 2; // same scaling as openWakeWord
      this.melFrames.push(row);
    }
    if (this.melFrames.length > MEL_KEEP) this.melFrames.splice(0, this.melFrames.length - MEL_KEEP);
    if (this.melFrames.length < EMB_WINDOW) return;
    const win = new Float32Array(EMB_WINDOW * 32);
    this.melFrames.slice(-EMB_WINDOW).forEach((row, i) => win.set(row, i * 32));
    const emb = await this.run_(this.emb, win, [1, EMB_WINDOW, 32, 1]);
    this.features.push(Float32Array.from(emb.data));
    if (this.features.length > EMB_KEEP) this.features.splice(0, this.features.length - EMB_KEEP);
  }

  // chunk: CHUNK samples at 16 kHz, in the int16 range (-32768 … 32767). Returns the word's score (0–1).
  async process(chunk) {
    await this.features_(chunk);
    this.steps++;
    if (this.features.length < WORD_INPUT) return 0;
    const input = new Float32Array(WORD_INPUT * 96);
    this.features.slice(-WORD_INPUT).forEach((f, i) => input.set(f, i * 96));
    const out = await this.run_(this.word, input, [1, WORD_INPUT, 96]);
    // Like openWakeWord, the first 5 steps never count (the history is still settling).
    return this.steps < 5 ? 0 : out.data[0];
  }
}

// Float sound (-1 … 1) at any rate → int16-range samples at 16 kHz (simple linear resampling).
export function to16k(samples, rate) {
  if (rate === SAMPLE_RATE) return Float32Array.from(samples, (v) => Math.max(-32768, Math.min(32767, v * 32767)));
  const ratio = rate / SAMPLE_RATE;
  const out = new Float32Array(Math.floor(samples.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const x = i * ratio, i0 = Math.floor(x), t = x - i0;
    const v = (samples[i0] || 0) * (1 - t) + (samples[i0 + 1] ?? samples[i0] ?? 0) * t;
    out[i] = Math.max(-32768, Math.min(32767, v * 32767));
  }
  return out;
}
