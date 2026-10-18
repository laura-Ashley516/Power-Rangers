// Speech -> text with a small Whisper model running locally (see whisper-worker.js).
// Loaded only when needed. No audio leaves the device.
//
// Track: C - Rules + voice

const SILENCE_RMS = 0.006; // below this a clip is treated as silent (Whisper invents text on silence)

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

export function isSilent(samples) {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / Math.max(1, samples.length)) < SILENCE_RMS;
}

// Returns the words heard ('' if the clip is silent).
export async function transcribe(arrayBuffer, model) {
  const audio = await decodeTo16k(arrayBuffer);
  if (isSilent(audio)) return '';
  if (status.state !== 'ready') setStatus({ state: status.state === 'idle' ? 'downloading' : status.state, model });
  const id = nextId++;
  const result = new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
  const copy = new Float32Array(audio); // own copy, so it can be handed to the worker
  getWorker().postMessage({ type: 'transcribe', id, audio: copy, model }, [copy.buffer]);
  return result;
}
