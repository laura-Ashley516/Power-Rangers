// Record a voice note with the iPad (or laptop) microphone, then understand it right away.
// Also lets the user type the same kind of sentence instead.
//
// Track: C - Rules + voice

import { MAX_RECORDING_SECONDS, SILENCE_STOP_SECONDS } from '../config.js';
import { t } from '../i18n.js';
import { $, esc, showPanelModal, closeModal, toast } from '../ui-kit.js';
import { saveNote, processNote, planText, applyPlan, confirmNote, undoChange } from './notes.js';
import { onStatus, getStatus, decodeTo16k, measure } from './transcribe.js';
import { pcmWav } from './wav.js';
import { refreshWaiting } from './inbox.js';

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
      ? t('The microphone is blocked. Allow it in the browser (lock icon next to the address), and on a Mac also in System Settings → Privacy & Security → Microphone → turn on your browser, then reopen it.')
      : t('The microphone is blocked. Allow it in the browser settings, or use “Type instead”.');
  }
  if (e?.name === 'NotFoundError') return t('No microphone was found on this device. Use “Type instead”.');
  if (e?.name === 'NotReadableError') return t('The microphone is busy or blocked by the system. Close other apps using it, and on a Mac check System Settings → Privacy & Security → Microphone.');
  return t('The microphone could not start ({error}). Use “Type instead”, or record on the reminder device.', { error: e?.message || e });
}

function noSoundHelp() {
  const mac = /Mac/.test(navigator.platform || '') && navigator.maxTouchPoints < 2;
  return mac
    ? t('The microphone sent no sound. On a Mac: System Settings → Privacy & Security → Microphone → turn on your browser, then quit and reopen it. Also check System Settings → Sound → Input: the right microphone is selected and its level moves when you speak.')
    : t('The microphone sent no sound. Check that the browser is allowed to use the microphone and that the right microphone is selected.');
}

// opts.autoStart: opened by the wake word ("Hey Cal"), so recording starts at once (it stops by itself after silence).
// (As a button handler it receives a click event: that is not autoStart.)
export function openVoiceModal(opts) {
  const autoStart = opts?.autoStart === true;
  const modal = showPanelModal(t('Voice note'), `
    <p>${t('Say what to change, for example:')} <em>${t('“Add a doctor appointment on Thursday at 2 pm”')}</em>, <em>${t('“Move the vacuuming to Friday”')}</em> ${t('or')} <em>${t('“Cancel hang laundry”')}</em>.</p>
    <div class="record-area">
      <button type="button" id="recBtn" class="record-button" aria-pressed="false"><span class="rec-dot" aria-hidden="true"></span><span id="recLabel">${t('Start recording')}</span></button>
      <div class="level-meter" aria-hidden="true"><div id="recLevel" class="level-fill"></div></div>
      <div id="recTimer" class="muted" aria-live="polite">${t('Up to {n} seconds. It stops by itself when you stop talking. The green bar moves when the microphone hears you.', { n: MAX_RECORDING_SECONDS })}</div>
    </div>
    <div id="recStatus" class="notice" role="status" aria-live="polite">${t('Understood on this device. Nothing is sent online.')}</div>
    <div id="recResults"></div>
    <details class="type-instead"><summary>${t('Type instead')}</summary>
      <div class="field"><label for="typedCommand">${t('What should change?')}</label><textarea id="typedCommand" rows="2" placeholder="${esc(t('e.g. Add laundry on Saturday morning'))}"></textarea></div>
      <div class="modal-actions" style="justify-content:flex-start"><button type="button" id="applyTyped" class="primary">${t('Apply')}</button></div>
    </details>
    <div class="modal-actions"><button type="button" id="closeVoice">${t('Close')}</button></div>`);

  const status = $('recStatus');
  let recorder = null, timer = null, startedAt = 0, lastMaxLevel = 0;

  const unsub = onStatus((s) => {
    if (s.state === 'downloading') status.textContent = t('Preparing speech understanding (first time only)… {p} %', { p: Math.round((s.progress || 0) * 100) });
  });

  const setRecordingLook = (on) => {
    $('recBtn').setAttribute('aria-pressed', String(on));
    $('recBtn').classList.toggle('recording', on);
    $('recLabel').textContent = on ? t('Stop') : t('Record another');
  };

  async function finish() {
    clearInterval(timer);
    setRecordingLook(false);
    const r = recorder;
    recorder = null;
    const { wav, diag } = await r.stop();
    $('recLevel').style.width = '0%';
    if (Date.now() - startedAt < 700) { status.textContent = t('That was very short. Press once to start, again to stop.'); return; }
    if (!wav) {
      status.innerHTML = `${esc(noSoundHelp())}<br><small class="diag">${t('Details for the team:')} ${esc(diagText(diag))}</small>`;
      return;
    }
    lastMaxLevel = diag.used === 'raw' ? r.maxLevel : 1;
    status.textContent = getStatus().state === 'ready' ? t('Listening to your note…') : t('Preparing speech understanding (first time only)…');
    const note = await saveNote({ source: 'ipad', bytes: wav, mime: 'audio/wav', recordedAt: startedAt });
    // Never leave her waiting without a word: after 20 s, say it is still working and that the note is safe.
    const slow = setTimeout(() => { status.textContent = t('Still listening… The first time can take a minute. Your note is saved: you can close this and find it in Voice notes.'); }, 20000);
    const done = await processNote(note.id);
    clearTimeout(slow);
    showResults(done);
  }

  $('closeVoice').onclick = () => { clearInterval(timer); recorder?.cancel(); unsub(); closeModal(); refreshWaiting(); };

  $('recBtn').onclick = async () => {
    if (recorder?.recording) { finish(); return; }
    if (!navigator.mediaDevices?.getUserMedia || !(window.AudioContext || window.webkitAudioContext)) {
      status.textContent = t('This browser cannot record. Use “Type instead”, or record on the reminder device.');
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
    let floor = 1;
    setRecordingLook(true);
    status.textContent = t('Recording… it stops by itself when you stop talking (or press Stop).');
    let heard = false, quietSince = 0;
    timer = setInterval(() => {
      // Volume bar: speech is usually 0.02-0.2, so the scale is stretched for quiet microphones.
      if (recorder) $('recLevel').style.width = Math.min(100, Math.round(Math.sqrt(recorder.level) * 220)) + '%';
      const s = Math.floor((Date.now() - startedAt) / 1000);
      $('recTimer').textContent = t('{s} s of {n}', { s, n: MAX_RECORDING_SECONDS });
      if (s >= MAX_RECORDING_SECONDS && recorder?.recording) { finish(); return; }
      // Stops by itself after a short silence once she has started speaking (client feedback, Nov 2026).
      // "Speaking" = louder than 3x the quietest level heard so far, so it adapts to quiet microphones and rooms.
      if (!recorder) return;
      const lvl = recorder.level;
      floor = Math.min(floor, Math.max(lvl, 0.0005));
      const speaking = lvl > Math.max(0.01, floor * 3);
      if (speaking) { heard = true; quietSince = 0; } else if (heard) {
        quietSince = quietSince || Date.now();
        if (Date.now() - quietSince > SILENCE_STOP_SECONDS * 1000 && recorder.recording) finish();
      }
    }, 250);
  };

  if (autoStart) setTimeout(() => $('recBtn')?.click(), 150);

  $('applyTyped').onclick = () => {
    const text = $('typedCommand').value.trim();
    if (!text) { status.textContent = t('Type what should change first.'); return; }
    showResults({ status: 'typed', transcript: text, plan: planText(text) });
  };

  function showResults(note) {
    if (!note) return;
    if (note.status === 'error') { status.textContent = t('Speech understanding could not run: {error}. The note is saved in Voice notes; try again later.', { error: note.error }); return; }
    if (note.status === 'empty') {
      status.textContent = lastMaxLevel < 0.004
        ? t('The recording was almost silent.') + ' ' + noSoundHelp()
        : t('I did not hear any words. Try again a little closer to the microphone, speaking clearly.');
      return;
    }
    status.innerHTML = `${t('I heard:')} <strong>“${esc(note.transcript)}”</strong>`;
    // Nothing changes yet: what was understood is shown, and ONE button does it all (client decision, Nov 2026).
    const plan = note.plan || [];
    const todo = plan.filter((p) => p.ok);
    const notUnderstood = [...plan.filter((p) => !p.ok), ...(note.results || []).filter((r) => !r.ok && !plan.includes(r))];
    if (!todo.length) { $('recResults').innerHTML = renderResults(notUnderstood); return; }
    $('recResults').innerHTML = `<div class="confirm-box"><strong>${t('Should I do this?')}</strong><ul class="result-list">${todo.map((p) => `<li class="ok">${esc(p.summary)}${p.warnings?.length ? `<br><small>${t('Note:')} ${esc(p.warnings[0])}</small>` : ''}</li>`).join('')}</ul>
      <div class="modal-actions" style="justify-content:flex-start"><button type="button" class="primary big-yes" id="voiceYes">${t('Yes, do it')}</button><button type="button" id="voiceNo">${t('No')}</button></div></div>${notUnderstood.length ? renderResults(notUnderstood) : ''}`;
    $('voiceYes').focus();
    $('voiceNo').onclick = () => { $('recResults').innerHTML = ''; status.textContent = t('Nothing was changed.'); };
    $('voiceYes').onclick = async () => {
      const done = note.id ? (await confirmNote(note.id))?.results || [] : applyPlan(plan, { heard: note.transcript });
      const draw = () => {
        $('recResults').innerHTML = renderResults(done.filter((r) => r.ok || !notUnderstood.includes(r))) + (done.some((r) => r.ok) ? `<div class="modal-actions" style="justify-content:flex-start"><button type="button" class="primary" id="seeWeek">${t('See it in the week')}</button></div>` : '');
        $('recResults').querySelectorAll('[data-undo]').forEach((b) => (b.onclick = () => {
          const r = undoChange(b.dataset.undo);
          toast(r.message);
          if (r.ok) { b.disabled = true; b.textContent = t('Undone'); }
        }));
        $('seeWeek')?.addEventListener('click', () => { clearInterval(timer); unsub(); closeModal(); document.querySelector('[data-view="weekly"]')?.click(); });
      };
      draw();
      status.textContent = t('Done.');
    };
  }
}

// One line per command: done (with Undo, and "for this week only" for a weekly activity), or not done and why.
export function renderResults(results = []) {
  return `<ul class="result-list">${results.map((r) => {
    if (r.ok) return `<li class="ok"><strong>✓ ${t('Done:')} ${esc(r.summary)}.</strong>${r.notice ? `<br>${esc(r.notice)}` : ''}${r.warnings?.length ? `<br><small>${t('Note:')} ${esc(r.warnings[0])}</small>` : ''} <button type="button" class="small" data-undo="${r.changeId}">${t('Undo')}</button></li>`;
    return `<li class="todo"><strong>${t('Not changed:')}</strong> ${esc(r.reason)}${r.text ? ` <small>(“${esc(r.text)}”)</small>` : ''}</li>`;
  }).join('')}</ul>`;
}
