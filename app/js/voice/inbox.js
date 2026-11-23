// Voice notes page: recent changes (with undo), notes to sort (replay, fix the words, delete),
// all notes; plus the calm banner on the weekly board and the count in the menu.
// How the client is told about changes is still to be decided with them: this is a first version.
//
// Track: C - Rules + voice

import { DAYS, PERIODS } from '../config.js';
import { ctx, commit } from '../context.js';
import { $, esc, toast } from '../ui-kit.js';
import { allNotes, deleteNote, processNote, processWaiting, retryWithText, undoChange, pendingCount } from './notes.js';
import { renderResults } from './recorder.js';
import { t, fmtDate, fmtTime } from '../i18n.js';

const STATUS_TEXT = {
  new: 'Waiting', transcribing: 'Not finished', applied: 'Added to calendar', partly: 'Partly added', 'to-sort': 'To sort', empty: 'No words heard', error: 'Could not process',
};
const when = (at) => `${fmtDate(new Date(at), { weekday: 'short' })} ${fmtTime(new Date(at))}`;
const statusText = (st) => t(STATUS_TEXT[st] || st);

function audioUrl(note) {
  return URL.createObjectURL(new Blob([note.bytes], { type: note.mime || 'audio/wav' }));
}

export async function renderVoiceView() {
  renderChangeLog();
  const notes = await allNotes();
  const toSort = notes.filter((n) => ['to-sort', 'partly', 'error', 'transcribing'].includes(n.status));
  $('toSortList').innerHTML = toSort.length ? toSort.map((n) => `
    <article class="note-card">
      <div class="note-head"><strong>${n.source === 'device' ? t('From the device') : t('Recorded on the iPad')} · ${when(n.recordedAt)}</strong><span class="badge">${statusText(n.status)}</span></div>
      <audio controls preload="none" src="${audioUrl(n)}"></audio>
      ${n.error ? `<p class="muted">${esc(n.error)}</p>` : ''}
      ${renderResults((n.results || []).filter((r) => !r.ok))}
      <div class="field"><label for="fix-${n.id}">${t('Words (fix them if needed)')}</label><input id="fix-${n.id}" value="${esc(n.transcript || '')}" placeholder="${esc(t('e.g. Add dentist on Friday morning'))}"></div>
      <div class="row" style="margin-top:8px"><button class="primary small" data-retry="${n.id}">${t('Try again')}</button>${n.status === 'error' || n.status === 'transcribing' ? `<button class="small" data-reprocess="${n.id}">${t('Listen again')}</button>` : ''}<button class="small danger" data-delete-note="${n.id}">${t('Delete')}</button></div>
    </article>`).join('') : `<p class="empty-state">${t('Nothing to sort.')}</p>`;

  $('notesList').innerHTML = notes.length ? notes.map((n) => `
    <article class="note-row">
      <div><strong>${n.source === 'device' ? t('From the device') : t('Recorded on the iPad')} · ${when(n.recordedAt)}</strong> <span class="badge">${statusText(n.status)}</span>
      <p class="muted">${n.transcript ? '“' + esc(n.transcript) + '”' : t('No words yet.')}</p></div>
      <div class="row"><audio controls preload="none" src="${audioUrl(n)}"></audio>${['new', 'error', 'transcribing'].includes(n.status) ? `<button class="small" data-reprocess="${n.id}">${t('Process')}</button>` : ''}<button class="small danger" data-delete-note="${n.id}">${t('Delete')}</button></div>
    </article>`).join('') : `<p class="empty-state">${t('No voice notes yet. Use “Voice note” at the top, or record on the reminder device.')}</p>`;
  updateCount();
}

function renderChangeLog() {
  const log = ctx.state.changeLog || [];
  $('changeLog').innerHTML = log.length ? `<ul class="result-list">${log.slice(0, 15).map((e) => `
    <li class="${e.undone ? 'undone' : 'ok'}">${e.undone ? '↺' : '✓'} ${esc(e.summary)} <small class="muted">${when(e.at)}${e.heard ? ` · ${t('heard')} “${esc(e.heard)}”` : ''}</small>
    ${e.undone ? `<small> (${t('undone')})</small>` : `<button type="button" class="small" data-undo="${e.id}">${t('Undo')}</button>`}</li>`).join('')}</ul>` : `<p class="empty-state">${t('No changes from voice yet.')}</p>`;
}

export async function updateCount() {
  try {
    const n = await pendingCount();
    $('voiceCount').textContent = n;
    $('voiceCount').classList.toggle('hidden', !n);
  } catch (e) { /* storage unavailable */ }
}

// Calm banner on the weekly board when voice notes changed the calendar.
export function renderBanner() {
  let count = 0;
  DAYS.forEach((d) => PERIODS.forEach((p) => ctx.state.schedule[d][p].forEach((a) => a.voiceNew && count++)));
  $('voiceBanner').innerHTML = count ? `<div class="voice-banner"><p><strong>${t('From your voice notes:')}</strong> ${t(count === 1 ? '{n} activity was added or moved. It is marked “new”.' : '{n} activities were added or moved. They are marked “new”.', { n: count })}</p><button data-view-voice>${t('See changes')}</button><button data-clear-new>${t('Got it')}</button></div>` : '';
}

export function clearNewMarks() {
  const state = JSON.parse(JSON.stringify(ctx.state));
  DAYS.forEach((d) => PERIODS.forEach((p) => state.schedule[d][p].forEach((a) => delete a.voiceNew)));
  commit(state);
}

export async function processAll() {
  const box = $('voiceProgress');
  box.classList.remove('hidden');
  const done = await processWaiting((n, i, total) => { box.textContent = t('Listening to note {i} of {n}…', { i: i + 1, n: total }); });
  box.textContent = done.length ? t(done.length > 1 ? '{n} notes processed.' : '{n} note processed.', { n: done.length }) : t('No waiting notes.');
  setTimeout(() => box.classList.add('hidden'), 4000);
  return done;
}

// Clicks on the voice page and banner. Returns true when handled.
export function handleVoiceClick(e, showView) {
  const undo = e.target.closest('[data-undo]');
  if (undo && undo.closest('#voiceView')) { const r = undoChange(undo.dataset.undo); toast(r.message); renderVoiceView(); return true; }
  const retry = e.target.closest('[data-retry]');
  if (retry) {
    const text = $('fix-' + retry.dataset.retry).value.trim();
    if (!text) { toast(t('Type the words first.')); return true; }
    retryWithText(retry.dataset.retry, text).then((n) => { toast(n.status === 'applied' ? t('Added to the calendar.') : t('Still not sure; check the message.')); renderVoiceView(); });
    return true;
  }
  const re = e.target.closest('[data-reprocess]');
  if (re) { re.disabled = true; re.textContent = t('Listening…'); processNote(re.dataset.reprocess).then(() => renderVoiceView()); return true; }
  const del = e.target.closest('[data-delete-note]');
  if (del) { if (confirm(t('Delete this voice note?'))) deleteNote(del.dataset.deleteNote).then(renderVoiceView); return true; }
  if (e.target.closest('[data-view-voice]')) { showView('voice'); return true; }
  if (e.target.closest('[data-clear-new]')) { clearNewMarks(); return true; }
  return false;
}
