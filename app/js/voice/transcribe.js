// Speech -> text with a small Whisper model running locally (see whisper-worker.js).
// Loaded only when needed. No audio leaves the device.
//
// Track: C - Rules + voice

// A clip is treated as silent when even its loudest 50 ms stays below this level
// (Whisper invents words from silence, so silent clips are not sent to it).
const SILENCE_WINDOW_RMS = 0.004;

let worker = null;
let nextId = 1;
const pending = new Map();
const listeners = new Set();
let status = { state: 'idle', model: null, progress: 0 };

export function onStatus(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function getStatus() { return status; }
function setStatus(s) { status = { ...status, ...s }; listeners.forEach((fn) => fn(status)); }

function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./whisper-worker.js', import.meta.url), { type: 'module' });
  const files = {};
  worker.onmessage = ({ data }) => {
    if (data.type === 'progress') {
      if (data.status === 'progress' && data.file) {
        files[data.file] = { loaded: data.loaded || 0, total: data.total || 0 };
        const all = Object.values(files);
        const total = all.reduce((n, f) => n + f.total, 0);
        const loaded = all.reduce((n, f) => n + f.loaded, 0);
        setStatus({ state: 'downloading', progress: total ? loaded / total : 0 });
      }
    } else if (data.type === 'ready') {
      setStatus({ state: 'ready', model: data.model, progress: 1 });
    } else if (data.type === 'result' || data.type === 'error') {
      const p = pending.get(data.id);
      if (data.type === 'error') setStatus({ state: 'error', error: data.message });
      if (!p) return;
      pending.delete(data.id);
      data.type === 'result' ? p.resolve(data.text) : p.reject(new Error(data.message));
    }
  };
  worker.onerror = (e) => {
    setStatus({ state: 'error', error: e.message || 'The speech model could not start in this browser.' });
    pending.forEach((p) => p.reject(new Error(status.error)));
    pending.clear();
    worker.terminate();
    worker = null; // a new worker is created on the next try
  };
  return worker;
}

export function preload(model) {
  setStatus({ state: 'downloading', model, progress: 0 });
  getWorker().postMessage({ type: 'load', model });
}

// Decode any recording (iPad .m4a/.mp4, Chrome .webm, device .wav) to 16 kHz mono samples.
export async function decodeTo16k(arrayBuffer) {
  const AC = window.AudioContext || window.webkitAudioContext;
  const ac = new AC();
  const decoded = await new Promise((resolve, reject) => {
    const p = ac.decodeAudioData(arrayBuffer.slice(0), resolve, reject); // callback form for older Safari
    if (p?.then) p.then(resolve, reject);
  });
  ac.close?.();
  const length = Math.max(1, Math.ceil(decoded.duration * 16000));
  const offline = new OfflineAudioContext(1, length, 16000);
  const src = offline.createBufferSource();
  src.buffer = decoded;
  src.connect(offline.destination);
  src.start();
  const rendered = await offline.startRendering();
  return rendered.getChannelData(0);
}

// Loudest 50 ms of the clip (16 kHz samples), and the highest single sample.
export function measure(samples) {
  const win = 800;
  let loudest = 0, peak = 0;
  for (let start = 0; start < samples.length; start += win) {
    let sum = 0;
    const end = Math.min(samples.length, start + win);
    for (let i = start; i < end; i++) {
      const v = samples[i];
      sum += v * v;
      if (Math.abs(v) > peak) peak = Math.abs(v);
    }
    loudest = Math.max(loudest, Math.sqrt(sum / Math.max(1, end - start)));
  }
  return { loudest, peak };
}

export const isSilent = (samples) => measure(samples).loudest < SILENCE_WINDOW_RMS;

// Quiet microphones: raise the volume so the loudest sound reaches about 90 % (at most x20).
function normalize(samples) {
  const { peak } = measure(samples);
  if (peak <= 0 || peak >= 0.5) return samples;
  const gain = Math.min(0.9 / peak, 20);
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) out[i] = samples[i] * gain;
  return out;
}

// Returns the words heard ('' if the clip is silent).
export async function transcribe(arrayBuffer, model) {
  const decoded = await decodeTo16k(arrayBuffer);
  if (isSilent(decoded)) return '';
  const audio = normalize(decoded);
  if (status.state !== 'ready') setStatus({ state: status.state === 'idle' ? 'downloading' : status.state, model });
  const id = nextId++;
  const result = new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
  const copy = new Float32Array(audio); // own copy, so it can be handed to the worker
  getWorker().postMessage({ type: 'transcribe', id, audio: copy, model }, [copy.buffer]);
  return result;
}
