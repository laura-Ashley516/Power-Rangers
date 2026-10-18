// Record a voice note with the iPad (or laptop) microphone, then understand it right away.
// Also lets the user type the same kind of sentence instead.
//
// Track: C - Rules + voice

import { MAX_RECORDING_SECONDS } from '../config.js';
import { $, esc, showPanelModal, closeModal, toast } from '../ui-kit.js';
import { saveNote, processNote, applyText, undoChange } from './notes.js';
import { onStatus, getStatus, decodeTo16k, measure } from './transcribe.js';
import { pcmWav } from './wav.js';

// Records with TWO methods at the same time and keeps whichever actually heard something:
//  1. raw sound through the Web Audio API (we build a plain WAV ourselves, works everywhere);
//  2. the browser's own MediaRecorder (backup if the first one receives silence).
// Either way, the note is saved as a plain 16 kHz WAV, like the device's notes.
// stop() also returns a short diagnosis, shown when nothing was heard.
const MR_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];

function floatToWav(samples, rate = 16000) {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) out[i] = Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767)));
  return pcmWav(out, rate);
}

class PcmRecorder {
  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    const track = this.stream.getAudioTracks()[0];
    this.trackInfo = { label: track?.label || 'unknown', mutedAtStart: !!track?.muted };

    // Method 1: raw sound.
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    try { await this.ctx.resume(); } catch (e) { /* reported in the diagnosis */ }
    this.source = this.ctx.createMediaStreamSource(this.stream);
    this.node = this.ctx.createScriptProcessor(4096, 1, 1);
    this.chunks = [];
    this.calls = 0;
    this.level = 0;     // loudness of the last ~0.1 s, for the volume bar
    this.maxLevel = 0;  // loudest moment of the whole recording
    this.node.onaudioprocess = (e) => {
      const data = e.inputBuffer.getChannelData(0);
      this.calls++;
      this.chunks.push(new Float32Array(data));
      let sum = 0;
      for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
      this.level = Math.sqrt(sum / data.length);
      this.maxLevel = Math.max(this.maxLevel, this.level);
    };
    this.source.connect(this.node);
    this.node.connect(this.ctx.destination); // needed for the browser to run it; the output stays silent

    // Method 2: the browser's recorder, as a backup.
    this.mrChunks = [];
    try {
      const type = MR_TYPES.find((t) => window.MediaRecorder?.isTypeSupported?.(t));
      this.mr = new MediaRecorder(this.stream, type ? { mimeType: type } : undefined);
      this.mr.ondataavailable = (e) => e.data.size && this.mrChunks.push(e.data);
      this.mr.start(250);
    } catch (e) { this.mr = null; }
    this.recording = true;
  }

  // Returns { wav: ArrayBuffer | null, diag: text }.
  async stop() {
    this.recording = false;
    const track = this.stream.getAudioTracks()[0];
    const diag = {
      mic: this.trackInfo.label, mutedNow: !!track?.muted, ctx: this.ctx.state, calls: this.calls,
      level: this.maxLevel.toFixed(4), backup: this.mr ? this.mr.mimeType || 'yes' : 'none',
    };
    const mrDone = this.mr && this.mr.state !== 'inactive'
      ? new Promise((resolve) => { this.mr.onstop = resolve; this.mr.stop(); }) : Promise.resolve();
    await mrDone;
    this.node.disconnect();
    this.source.disconnect();
    this.stream.getTracks().forEach((t) => t.stop());
    const rate = this.ctx.sampleRate;
    await this.ctx.close?.();

    // 1. Raw sound, if it heard something.
    if (this.maxLevel > 0) {
      const length = this.chunks.reduce((n, c) => n + c.length, 0);
      const all = new Float32Array(length);
      let o = 0;
      for (const c of this.chunks) { all.set(c, o); o += c.length; }
      const offline = new OfflineAudioContext(1, Math.max(1, Math.ceil((length * 16000) / rate)), 16000);
      const buffer = offline.createBuffer(1, Math.max(1, length), rate);
      buffer.getChannelData(0).set(all);
      const src = offline.createBufferSource();
      src.buffer = buffer;
      src.connect(offline.destination);
      src.start();
      diag.used = 'raw';
      return { wav: floatToWav((await offline.startRendering()).getChannelData(0)), diag };
    }

    // 2. Backup recorder.
    const blob = new Blob(this.mrChunks, { type: this.mr?.mimeType || '' });
    diag.backupBytes = blob.size;
    if (blob.size > 0) {
      try {
        const samples = await decodeTo16k(await blob.arrayBuffer());
        diag.backupLevel = measure(samples).loudest.toFixed(4);
        if (measure(samples).peak > 0) { diag.used = 'backup'; return { wav: floatToWav(samples), diag }; }
      } catch (e) { diag.backupError = e.message || String(e); }
    }
    diag.used = 'none';
    return { wav: null, diag };
  }

  cancel() {
    if (!this.recording) return;
    this.recording = false;
    try { if (this.mr?.state !== 'inactive') this.mr?.stop(); } catch (e) { /* ignore */ }
    try { this.node.disconnect(); this.source.disconnect(); } catch (e) { /* already stopped */ }
    this.stream?.getTracks().forEach((t) => t.stop());
    this.ctx?.close?.();
  }
}

const diagText = (d) => Object.entries(d).map(([k, v]) => `${k}: ${v}`).join(' · ');

function micHelp(e) {
  const mac = /Mac/.test(navigator.platform || '') && !/iPad|iPhone/.test(navigator.userAgent) && navigator.maxTouchPoints < 2;
  if (e?.name === 'NotAllowedError' || e?.name === 'SecurityError') {
    return mac
      ? 'The microphone is blocked. Allow it in the browser (lock icon next to the address), and on a Mac also in System Settings → Privacy & Security → Microphone → turn on your browser, then reopen it.'
      : 'The microphone is blocked. Allow it in the browser settings, or use “Type instead”.';
  }
  if (e?.name === 'NotFoundError') return 'No microphone was found on this device. Use “Type instead”.';
  if (e?.name === 'NotReadableError') return 'The microphone is busy or blocked by the system. Close other apps using it, and on a Mac check System Settings → Privacy & Security → Microphone.';
  return 'The microphone could not start (' + (e?.message || e) + '). Use “Type instead”, or record on the reminder device.';
}

function noSoundHelp() {
  const mac = /Mac/.test(navigator.platform || '') && navigator.maxTouchPoints < 2;
  return mac
    ? 'The microphone sent no sound. On a Mac: System Settings → Privacy & Security → Microphone → turn on your browser, then quit and reopen it. Also check System Settings → Sound → Input: the right microphone is selected and its level moves when you speak.'
    : 'The microphone sent no sound. Check that the browser is allowed to use the microphone and that the right microphone is selected.';
}

export function openVoiceModal() {
  const modal = showPanelModal('Voice note', `
    <p>Say what to change, for example <em>“Add groceries on Tuesday afternoon”</em>, <em>“Move my walk to Friday”</em> or <em>“Cancel laundry”</em>.</p>
    <div class="record-area">
      <button type="button" id="recBtn" class="record-button" aria-pressed="false"><span class="rec-dot" aria-hidden="true"></span><span id="recLabel">Start recording</span></button>
      <div class="level-meter" aria-hidden="true"><div id="recLevel" class="level-fill"></div></div>
      <div id="recTimer" class="muted" aria-live="polite">Up to ${MAX_RECORDING_SECONDS} seconds. The green bar moves when the microphone hears you.</div>
    </div>
    <div id="recStatus" class="notice" role="status" aria-live="polite">Understood on this device. Nothing is sent online.</div>
    <div id="recResults"></div>
    <details class="type-instead"><summary>Type instead</summary>
      <div class="field"><label for="typedCommand">What should change?</label><textarea id="typedCommand" rows="2" placeholder="e.g. Add laundry on Saturday morning"></textarea></div>
      <div class="modal-actions" style="justify-content:flex-start"><button type="button" id="applyTyped" class="primary">Apply</button></div>
    </details>
    <div class="modal-actions"><button type="button" id="closeVoice">Close</button></div>`);

  const status = $('recStatus');
  let recorder = null, timer = null, startedAt = 0, lastMaxLevel = 0;

  const unsub = onStatus((s) => {
    if (s.state === 'downloading') status.textContent = `Preparing speech understanding (first time only)… ${Math.round((s.progress || 0) * 100)} %`;
  });

  const setRecordingLook = (on) => {
    $('recBtn').setAttribute('aria-pressed', String(on));
    $('recBtn').classList.toggle('recording', on);
    $('recLabel').textContent = on ? 'Stop' : 'Record another';
  };

  async function finish() {
    clearInterval(timer);
    setRecordingLook(false);
    const r = recorder;
    recorder = null;
    const { wav, diag } = await r.stop();
    $('recLevel').style.width = '0%';
    if (Date.now() - startedAt < 700) { status.textContent = 'That was very short. Press once to start, again to stop.'; return; }
    if (!wav) {
      status.innerHTML = `${esc(noSoundHelp())}<br><small class="diag">Details for the team: ${esc(diagText(diag))}</small>`;
      return;
    }
    lastMaxLevel = diag.used === 'raw' ? r.maxLevel : 1;
    status.textContent = getStatus().state === 'ready' ? 'Listening to your note…' : 'Preparing speech understanding (first time only)…';
    const note = await saveNote({ source: 'ipad', bytes: wav, mime: 'audio/wav', recordedAt: startedAt });
    showResults(await processNote(note.id));
  }

  $('closeVoice').onclick = () => { clearInterval(timer); recorder?.cancel(); unsub(); closeModal(); };

  $('recBtn').onclick = async () => {
    if (recorder?.recording) { finish(); return; }
    if (!navigator.mediaDevices?.getUserMedia || !(window.AudioContext || window.webkitAudioContext)) {
      status.textContent = 'This browser cannot record. Use “Type instead”, or record on the reminder device.';
      return;
    }
    recorder = new PcmRecorder();
    try {
      await recorder.start();
    } catch (e) {
      recorder = null;
      status.textContent = micHelp(e);
      return;
    }
    startedAt = Date.now();
    setRecordingLook(true);
    status.textContent = 'Recording… press Stop when you are done.';
    timer = setInterval(() => {
      // Volume bar: speech is usually 0.02-0.2, so the scale is stretched for quiet microphones.
      if (recorder) $('recLevel').style.width = Math.min(100, Math.round(Math.sqrt(recorder.level) * 220)) + '%';
      const s = Math.floor((Date.now() - startedAt) / 1000);
      $('recTimer').textContent = `${s} s of ${MAX_RECORDING_SECONDS}`;
      if (s >= MAX_RECORDING_SECONDS && recorder?.recording) finish();
    }, 250);
  };

  $('applyTyped').onclick = () => {
    const text = $('typedCommand').value.trim();
    if (!text) { status.textContent = 'Type what should change first.'; return; }
    showResults({ status: 'typed', transcript: text, results: applyText(text) });
  };

  function showResults(note) {
    if (!note) return;
    if (note.status === 'error') { status.textContent = `Speech understanding could not run: ${note.error}. The note is saved in Voice notes; try again later.`; return; }
    if (note.status === 'empty') {
      status.textContent = lastMaxLevel < 0.004
        ? 'The recording was almost silent. ' + noSoundHelp()
        : 'I did not hear any words. Try again a little closer to the microphone, speaking clearly.';
      return;
    }
    status.innerHTML = `I heard: <strong>“${esc(note.transcript)}”</strong>`;
    $('recResults').innerHTML = renderResults(note.results);
    $('recResults').querySelectorAll('[data-undo]').forEach((b) => (b.onclick = () => {
      const r = undoChange(b.dataset.undo);
      toast(r.message);
      if (r.ok) { b.disabled = true; b.textContent = 'Undone'; }
    }));
  }
}

export function renderResults(results = []) {
  return `<ul class="result-list">${results.map((r) => r.ok
    ? `<li class="ok">✓ ${esc(r.summary)}${r.warnings?.length ? `<br><small>Note: ${esc(r.warnings[0])}</small>` : ''} <button type="button" class="small" data-undo="${r.changeId}">Undo</button></li>`
    : `<li class="todo">… Kept aside: ${esc(r.reason)}${r.text ? ` <small>(“${esc(r.text)}”)</small>` : ''}</li>`).join('')}</ul>`;
}
