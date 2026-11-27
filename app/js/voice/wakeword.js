// "Hey Cal": say it and the voice-note window opens and starts recording (team decision, Nov 2026).
//
// - Off until she turns it on (Settings → Voice understanding → "Listen for Hey Cal").
// - Runs on this iPad only (wakeword-core.js, openWakeWord models in app/models/wake): nothing is sent online.
// - Listens only while the planner is open and on screen: iPadOS stops the microphone otherwise. A small
//   "Listening for Hey Cal" label at the top shows when it is on; tapping it turns listening off.
// - Paused while the voice-note window is open, so her note itself never re-triggers it.
// - Until the "Hey Cal" model is trained (docs/hey-cal-training.md), the free test word "Hey Jarvis" is used,
//   and Settings says so. Dropping app/models/wake/hey_cal.onnx in the folder switches to "Hey Cal".
//
// Track: C - Rules + voice

import { ctx, commit } from '../context.js';
import { $, toast } from '../ui-kit.js';
import { t } from '../i18n.js';
import { WakeWordDetector, CHUNK, to16k } from './wakeword-core.js';

const ORT = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/';
const MODELS = 'models/wake/';
// Which word: app/models/wake/word.json (kept offline like every app file). Until "Hey Cal" is trained it names
// the free test word "Hey Jarvis"; after training: { "file": "hey_cal.onnx", "label": "Hey Cal", "test": false }.
const FALLBACK = { file: 'hey_jarvis_v0.1.onnx', label: 'Hey Jarvis', test: true };
const COOLDOWN_MS = 3000;

let detector = null, word = null, loading = null;
let audio = null;       // { stream, ctx, node, source }
let buffer = new Float32Array(0), busy = false, paused = false, lastHit = 0;
let onWake = () => {};
let needsTap = false;   // the iPad holds sound until a tap
let blocked = false;    // the microphone is not allowed for the planner

export const wakeWordLabel = () => (word ? word.label : 'Hey Cal');
export const wakeWordIsTest = () => !!word?.test;
export const isListening = () => !!audio && !paused;

async function pickWord() {
  try {
    const w = await (await fetch(MODELS + 'word.json')).json();
    if (w?.file && w?.label) return w;
  } catch (e) { /* first time offline: the test word */ }
  return FALLBACK;
}

async function loadDetector() {
  if (detector) return detector;
  loading = loading || (async () => {
    word = await pickWord();
    const ort = await import(`${ORT}ort.wasm.min.mjs`);
    ort.env.wasm.wasmPaths = ORT;
    ort.env.wasm.numThreads = 1; // no special server headers needed (GitHub Pages)
    const d = new WakeWordDetector(ort, { mel: MODELS + 'melspectrogram.onnx', embedding: MODELS + 'embedding_model.onnx', word: MODELS + word.file });
    await d.load();
    detector = d;
    return d;
  })();
  try { return await loading; } finally { loading = null; }
}

async function feed(samples16k) {
  const all = new Float32Array(buffer.length + samples16k.length);
  all.set(buffer);
  all.set(samples16k, buffer.length);
  buffer = all;
  if (busy) return;           // still working on the last step: the sound waits in the buffer
  busy = true;
  try {
    while (buffer.length >= CHUNK && !paused) {
      const chunk = buffer.slice(0, CHUNK);
      buffer = buffer.slice(CHUNK);
      const score = await detector.process(chunk);
      if (score >= detector.threshold && Date.now() - lastHit > COOLDOWN_MS) {
        lastHit = Date.now();
        buffer = new Float32Array(0);
        onWake();
        break;
      }
    }
    if (buffer.length > CHUNK * 25) buffer = buffer.slice(-CHUNK * 2); // fell behind (slow iPad): skip ahead
  } catch (e) {
    console.warn('Hey Cal listening stopped:', e.message);
    stopListening();
  } finally { busy = false; }
}

async function startAudio() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
  const AC = window.AudioContext || window.webkitAudioContext;
  const ac = new AC();
  await ac.resume();
  if (ac.state !== 'running') { // iPad without a tap yet: sound is held, so nothing would be heard
    stream.getTracks().forEach((tr) => tr.stop());
    ac.close?.();
    throw Object.assign(new Error('needs a tap'), { name: 'NeedsTap' });
  }
  const source = ac.createMediaStreamSource(stream);
  const node = ac.createScriptProcessor(4096, 1, 1); // same method as the voice recorder (works on every iPad browser)
  node.onaudioprocess = (e) => { if (!paused && detector) feed(to16k(e.inputBuffer.getChannelData(0), ac.sampleRate)); };
  source.connect(node);
  node.connect(ac.destination); // silent output; needed for the browser to run it
  audio = { stream, ctx: ac, node, source };
}

let starting = null;
export function startListening() {
  starting = starting || startListening_().finally(() => { starting = null; });
  return starting;
}
async function startListening_() {
  if (audio) { paused = false; renderIndicator(); return true; }
  if (!navigator.mediaDevices?.getUserMedia) { toast(t('This browser cannot listen for the wake word.')); return false; }
  try {
    renderIndicator(t('Getting ready…'));
    await loadDetector();
    await startAudio();
    paused = false;
    needsTap = false;
    blocked = false;
    renderIndicator();
    return true;
  } catch (e) {
    stopListening();
    // iPad: sound can only start after a tap; the label then says "Tap to listen".
    needsTap = e?.name === 'NeedsTap' && ctx.state.settings.wakeWord;
    blocked = e?.name === 'NotAllowedError' || e?.name === 'SecurityError';
    if (blocked) toast(t('The microphone is blocked for the planner. On iPad: Settings → Safari → Microphone → Allow (or Ask), then tap the “Hey Cal” label at the top.'), 9000);
    else if (!needsTap) toast(t('Listening for the wake word could not start: {error}', { error: e.message || e.name }));
    renderIndicator();
    return false;
  }
}

export function stopListening() {
  if (audio) {
    try { audio.node.disconnect(); audio.source.disconnect(); } catch (e) { /* already stopped */ }
    audio.stream.getTracks().forEach((tr) => tr.stop());
    audio.ctx.close?.();
  }
  audio = null;
  buffer = new Float32Array(0);
  renderIndicator();
}

// While the voice-note window is open, the wake word is not listened for (and its sound is thrown away).
export function pauseListening(on) {
  paused = on;
  buffer = new Float32Array(0);
  if (!on && detector) detector.reset();
  renderIndicator();
}

function renderIndicator(text) {
  const el = $('wakeIndicator');
  if (!el) return;
  const on = !!ctx.state?.settings.wakeWord;
  el.classList.toggle('hidden', !on);
  if (!on) return;
  el.textContent = text || (blocked && !audio ? t('Microphone blocked: tap for help')
    : needsTap && !audio ? t('Tap to listen for “{word}”', { word: wakeWordLabel() })
    : audio && !paused ? t('Listening for “{word}”', { word: wakeWordLabel() }) : t('“{word}” paused', { word: wakeWordLabel() }));
  el.classList.toggle('on', !!audio && !paused);
}

export async function setWakeWord(on) {
  commit({ ...ctx.state, settings: { ...ctx.state.settings, wakeWord: on } });
  if (on) {
    const ok = await startListening();
    if (ok) toast(wakeWordIsTest() ? t('Listening for “{word}” (test word until “Hey Cal” is trained).', { word: wakeWordLabel() }) : t('Listening for “{word}”.', { word: wakeWordLabel() }));
  } else stopListening();
}

// Start (if she turned it on), follow the screen (off when hidden, back when shown), and the label's tap.
export function initWakeWord(whenHeard) {
  onWake = whenHeard;
  const tryStart = () => { if (ctx.state.settings.wakeWord && !audio && document.visibilityState === 'visible') startListening(); };
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') stopListening(); else tryStart(); });
  // iPad: sound may only start after a tap. The first tap anywhere starts listening if it is on.
  document.addEventListener('pointerdown', () => { if (needsTap) { needsTap = false; tryStart(); } }, { capture: true });
  // The label: while listening, a tap turns it off; otherwise a tap starts it (the tap iPad needs).
  $('wakeIndicator')?.addEventListener('click', () => { if (audio && !starting) setWakeWord(false); else tryStart(); });
  // Any open window (voice note, a form…) pauses listening: her note never re-triggers it, and a window
  // never opens on top of another. Listening comes back when the window closes.
  const root = $('modalRoot');
  if (root) new MutationObserver(() => { const open = !!root.innerHTML.trim(); if (open !== paused && audio) pauseListening(open); }).observe(root, { childList: true });
  renderIndicator();
  tryStart();
}
