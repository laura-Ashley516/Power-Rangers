// Record a voice note with the iPad (or laptop) microphone, then understand it right away.
// Also lets the user type the same kind of sentence instead.
//
// Track: C - Rules + voice

import { MAX_RECORDING_SECONDS } from '../config.js';
import { $, esc, showPanelModal, closeModal, toast } from '../ui-kit.js';
import { saveNote, processNote, applyText, undoChange } from './notes.js';
import { onStatus, getStatus } from './transcribe.js';

function pickMime() {
  const options = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg'];
  return options.find((m) => window.MediaRecorder?.isTypeSupported?.(m)) || '';
}

export function openVoiceModal() {
  const modal = showPanelModal('Voice note', `
    <p>Say what to change, for example <em>“Add groceries on Tuesday afternoon”</em>, <em>“Move my walk to Friday”</em> or <em>“Cancel laundry”</em>.</p>
    <div class="record-area">
      <button type="button" id="recBtn" class="record-button" aria-pressed="false"><span class="rec-dot" aria-hidden="true"></span><span id="recLabel">Start recording</span></button>
      <div id="recTimer" class="muted" aria-live="polite">Up to ${MAX_RECORDING_SECONDS} seconds.</div>
    </div>
    <div id="recStatus" class="notice" role="status" aria-live="polite">Understood on this device. Nothing is sent online.</div>
    <div id="recResults"></div>
    <details class="type-instead"><summary>Type instead</summary>
      <div class="field"><label for="typedCommand">What should change?</label><textarea id="typedCommand" rows="2" placeholder="e.g. Add laundry on Saturday morning"></textarea></div>
      <div class="modal-actions" style="justify-content:flex-start"><button type="button" id="applyTyped" class="primary">Apply</button></div>
    </details>
    <div class="modal-actions"><button type="button" id="closeVoice">Close</button></div>`);

  const status = $('recStatus');
  let recorder = null, chunks = [], timer = null, startedAt = 0, stream = null;

  const stopTimer = () => { clearInterval(timer); timer = null; };
  const cleanup = () => { stopTimer(); stream?.getTracks().forEach((t) => t.stop()); stream = null; };

  const unsub = onStatus((s) => {
    if (s.state === 'downloading') status.textContent = `Preparing speech understanding (first time only)… ${Math.round((s.progress || 0) * 100)} %`;
  });

  $('closeVoice').onclick = () => { if (recorder?.state === 'recording') recorder.stop(); cleanup(); unsub(); closeModal(); };

  $('recBtn').onclick = async () => {
    if (recorder?.state === 'recording') { recorder.stop(); return; }
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      status.textContent = 'This browser cannot record. Use “Type instead”, or record on the reminder device.';
      return;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    } catch (e) {
      status.textContent = 'Microphone permission was not given. You can allow it in the browser settings, or use “Type instead”.';
      return;
    }
    const mime = pickMime();
    recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    chunks = [];
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    recorder.onstop = async () => {
      cleanup();
      $('recBtn').setAttribute('aria-pressed', 'false');
      $('recBtn').classList.remove('recording');
      $('recLabel').textContent = 'Record another';
      const blob = new Blob(chunks, { type: recorder.mimeType || mime || 'audio/mp4' });
      if (Date.now() - startedAt < 700) { status.textContent = 'That was very short. Press once to start, again to stop.'; return; }
      status.textContent = getStatus().state === 'ready' ? 'Listening to your note…' : 'Preparing speech understanding (first time only)…';
      const note = await saveNote({ source: 'ipad', bytes: await blob.arrayBuffer(), mime: blob.type, recordedAt: startedAt });
      const done = await processNote(note.id);
      showResults(done);
    };
    recorder.start();
    startedAt = Date.now();
    $('recBtn').setAttribute('aria-pressed', 'true');
    $('recBtn').classList.add('recording');
    $('recLabel').textContent = 'Stop';
    status.textContent = 'Recording… press Stop when you are done.';
    timer = setInterval(() => {
      const s = Math.floor((Date.now() - startedAt) / 1000);
      $('recTimer').textContent = `${s} s of ${MAX_RECORDING_SECONDS}`;
      if (s >= MAX_RECORDING_SECONDS && recorder.state === 'recording') recorder.stop();
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
    if (note.status === 'empty') { status.textContent = 'I did not hear any words. Try again a little closer to the microphone.'; return; }
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
