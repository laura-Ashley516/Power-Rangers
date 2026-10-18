// Runs Whisper in a background thread so the page stays responsive.
// The model files are downloaded once from Hugging Face and kept in the browser's cache;
// after that it works offline. Audio never leaves the device.
//
// Messages in:  { type:'load', model }  |  { type:'transcribe', id, audio: Float32Array (16 kHz mono), model }
// Messages out: { type:'progress', ... } | { type:'ready', model } | { type:'result', id, text } | { type:'error', id, message }

import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/transformers.min.js';

env.allowLocalModels = false; // models come from the Hugging Face hub, then the browser cache
env.useBrowserCache = true;

let asr = null;
let loadedModel = null;

async function load(model) {
  if (asr && loadedModel === model) return asr;
  asr = await pipeline('automatic-speech-recognition', model, {
    dtype: 'q8',      // small quantized files: about 40 MB (tiny) / 80 MB (base)
    device: 'wasm',   // runs on the processor, so it does not depend on the iPad's graphics chip
    progress_callback: (p) => self.postMessage({ type: 'progress', ...p }),
  });
  loadedModel = model;
  self.postMessage({ type: 'ready', model });
  return asr;
}

self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'load') await load(data.model);
    if (data.type === 'transcribe') {
      const run = await load(data.model);
      const out = await run(data.audio, { chunk_length_s: 30 });
      self.postMessage({ type: 'result', id: data.id, text: String(out.text || '').trim() });
    }
  } catch (e) {
    self.postMessage({ type: 'error', id: data.id, message: e?.message || String(e) });
  }
};
