// Starts the planner: loads the saved week, draws every screen, wires the buttons,
// drag & drop (mouse and touch), and the offline-first service worker.
//
// Track: shared (keep this file small; put features in their own module)

import { APP_VERSION, DAYS } from './config.js';
import { ctx, commit, change, onRender } from './context.js';
import { load, fresh, requestPersistence, exportBackup, importBackup } from './store.js';
import { $, toast } from './ui-kit.js';
import { renderWeek, renderAlerts, changeWeek, suggestMove, repeatLastWeek } from './ui-week.js';
import { renderDaily } from './ui-daily.js';
import { renderLibrary, activityForm, createAndScheduleActivity, openQuickAdd, handleLibraryClick } from './ui-library.js';
import { printWeek, printDay, renderPrintArea } from './print.js';
import { connect, disconnect, sync, renderDemoPanel } from './ui-device.js';
import { openVoiceModal } from './voice/recorder.js';
import { renderVoiceView, renderBanner, handleVoiceClick, processAll, updateCount, clearNewMarks } from './voice/inbox.js';
import { preload, onStatus } from './voice/transcribe.js';
import { onNotesChanged } from './voice/notes.js';

ctx.state = load();
ctx.weekSchedules = { 0: JSON.parse(JSON.stringify(ctx.state.schedule)) };

// ---------- drawing ----------

function applySettings() {
  const s = ctx.state.settings;
  $('themeSelect').value = s.theme || 'sage';
  document.body.dataset.theme = s.theme || 'sage';
  $('contrastToggle').setAttribute('aria-checked', s.contrast);
  $('textToggle').setAttribute('aria-checked', s.large);
  $('alertsToggle').setAttribute('aria-checked', s.alerts);
  $('smsToggle').setAttribute('aria-checked', s.sms);
  $('demoToggle').setAttribute('aria-checked', !!s.demoDevice);
  $('reminderLead').value = s.lead;
  $('modelSelect').value = s.speechModel;
  document.body.classList.toggle('high-contrast', s.contrast);
  document.body.classList.toggle('large-text', s.large);
}

onRender(renderWeek);
onRender(renderDaily);
onRender(renderLibrary);
onRender(renderBanner);
onRender(applySettings);
onRender(renderPrintArea);
onRender(() => { if (!$('voiceView').classList.contains('hidden')) renderVoiceView(); });

export function showView(name) {
  document.querySelectorAll('.view').forEach((v) => v.classList.add('hidden'));
  $(name + 'View').classList.remove('hidden');
  document.querySelectorAll('.navbtn').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
  if (name === 'daily') renderDaily();
  if (name === 'weekly') renderWeek();
  if (name === 'voice') renderVoiceView();
  if (name === 'device') renderDemoPanel();
}

const setting = (key, value) => commit({ ...ctx.state, settings: { ...ctx.state.settings, [key]: value } });

// ---------- buttons ----------

document.querySelectorAll('.navbtn').forEach((b) => b.addEventListener('click', () => showView(b.dataset.view)));
$('prevWeekBtn').onclick = () => changeWeek(ctx.weekOffset - 1);
$('nextWeekBtn').onclick = () => changeWeek(ctx.weekOffset + 1);
$('todayWeekBtn').onclick = () => changeWeek(0);
$('voiceBtn').onclick = openVoiceModal;
$('voiceRecordBtn2').onclick = openVoiceModal;
$('processNotesBtn').onclick = () => processAll().then(renderVoiceView);
$('dailySelect').addEventListener('change', (e) => { $('dailySelect2').value = e.target.value; showView('daily'); });
$('dailySelect2').addEventListener('change', () => { renderDaily(); renderPrintArea(); });
$('printBtn').addEventListener('click', printWeek);
$('dailyPrint').addEventListener('click', printDay);
$('openAddActivity').onclick = () => activityForm();
$('weeklyAddActivity').onclick = () => createAndScheduleActivity($('dailySelect').value || 'Monday', 'Morning');
$('repeatWeekBtn').onclick = repeatLastWeek;

$('themeSelect').onchange = (e) => { setting('theme', e.target.value); toast('Colour preference saved.'); };
$('contrastToggle').onclick = () => setting('contrast', !ctx.state.settings.contrast);
$('textToggle').onclick = () => setting('large', !ctx.state.settings.large);
$('alertsToggle').onclick = () => setting('alerts', !ctx.state.settings.alerts);
$('smsToggle').onclick = () => { setting('sms', !ctx.state.settings.sms); toast(ctx.state.settings.sms ? 'SMS preference enabled in this interface.' : 'SMS preference disabled.'); };
$('demoToggle').onclick = () => { disconnect(); setting('demoDevice', !ctx.state.settings.demoDevice); renderDemoPanel(); toast(ctx.state.settings.demoDevice ? 'Demo device on.' : 'Demo device off.'); };
$('reminderLead').onchange = (e) => { setting('lead', Number(e.target.value)); toast('Reminder preference saved.'); };
$('modelSelect').onchange = (e) => { setting('speechModel', e.target.value); toast('Speech model saved. It downloads the next time it is needed.'); };
$('preloadModelBtn').onclick = () => preload(ctx.state.settings.speechModel);
$('vibrateBtn').onclick = () => { if ('vibrate' in navigator) { navigator.vibrate(180); toast('Vibration test requested.'); } else toast('Vibration is not supported by this browser/device.'); };
$('resetBtn').onclick = () => { if (confirm('Reset the planner to the original example schedule?')) { sessionStorage.clear(); ctx.selectedActivity = null; commit(fresh()); toast('Planner reset.'); } };
$('exportBtn').onclick = () => { exportBackup(ctx.state); toast('Backup file created.'); };
$('importInput').onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const state = await importBackup(file);
    if (confirm('Replace the planner with this backup?')) { commit(state); toast('Backup loaded.'); }
  } catch (err) { toast(err.message); }
  e.target.value = '';
};
$('connectBtn').onclick = connect;
$('disconnectBtn').onclick = disconnect;
$('syncBtn').onclick = sync;

onStatus((s) => {
  const el = $('modelStatus');
  if (s.state === 'downloading') el.textContent = `Downloading… ${Math.round((s.progress || 0) * 100)} %`;
  if (s.state === 'ready') el.textContent = 'Ready. Works without internet from now on.';
  if (s.state === 'error') el.textContent = 'Could not load: ' + s.error;
});
onNotesChanged(updateCount);

// One click handler for the whole page (cards, alerts, library, voice page).
document.addEventListener('click', (e) => {
  const action = e.target.closest('[data-action]');
  if (action) {
    e.stopPropagation();
    const card = action.closest('.activity-card');
    if (action.dataset.action === 'remove') change({ type: 'remove', id: card.dataset.id });
    return;
  }
  const alertMove = e.target.closest('[data-alert-move]');
  if (alertMove) { suggestMove(alertMove.dataset.alertMove); return; }
  const dismiss = e.target.closest('[data-alert-dismiss]');
  if (dismiss) { sessionStorage.setItem('dismiss-' + dismiss.dataset.alertDismiss, '1'); renderAlerts(); return; }
  if (handleLibraryClick(e)) return;
  if (handleVoiceClick(e, showView)) return;
  const slot = e.target.closest('.slot');
  if (slot && Date.now() - lastDragEnd > 400 && !e.target.closest('.activity-card') && e.target.closest('#weeklyView, #dailyView')) openQuickAdd(slot.dataset.day, slot.dataset.period);
});
document.addEventListener('keydown', (e) => {
  const card = e.target.closest?.('.activity-card');
  if (card && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); card.click(); }
});

// ---------- drag & drop (moved from the first try) ----------

let nativeDrag = null;
let pointerStart = null;
let lastDragEnd = 0; // a drag that ends in the same slot must not open "add"
const clearTargets = () => document.querySelectorAll('.slot.drop-target').forEach((x) => x.classList.remove('drop-target'));
const move = (src, slot) => {
  if (src.day !== slot.dataset.day || src.period !== slot.dataset.period) change({ type: 'move', id: src.id, toDay: slot.dataset.day, toPeriod: slot.dataset.period });
};

document.addEventListener('dragstart', (e) => {
  const card = e.target.closest('.activity-card');
  if (!card || card.dataset.cardType === 'library' || card.getAttribute('draggable') !== 'true') { e.preventDefault(); return; }
  nativeDrag = { id: card.dataset.id, day: card.dataset.day, period: card.dataset.period };
  pointerStart = null;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', card.dataset.id);
  card.classList.add('is-dragging');
});
document.addEventListener('dragover', (e) => {
  const slot = e.target.closest('.slot');
  if (!slot || !nativeDrag) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  clearTargets();
  slot.classList.add('drop-target');
});
document.addEventListener('drop', (e) => {
  const slot = e.target.closest('.slot');
  if (!slot || !nativeDrag) return;
  e.preventDefault();
  const src = nativeDrag;
  nativeDrag = null;
  clearTargets();
  move(src, slot);
});
document.addEventListener('dragend', () => { lastDragEnd = Date.now(); nativeDrag = null; clearTargets(); document.querySelectorAll('.is-dragging').forEach((x) => x.classList.remove('is-dragging')); });

// Pointer drag for touch screens, where native drag-and-drop is unreliable.
document.addEventListener('pointerdown', (e) => {
  const card = e.target.closest('.activity-card');
  if (!card || e.target.closest('button')) return;
  pointerStart = { x: e.clientX, y: e.clientY, card, started: false, source: { type: card.dataset.cardType, id: card.dataset.id, day: card.dataset.day, period: card.dataset.period } };
});
document.addEventListener('pointermove', (e) => {
  if (!pointerStart) return;
  if (!pointerStart.started && Math.hypot(e.clientX - pointerStart.x, e.clientY - pointerStart.y) > 9) {
    pointerStart.started = true;
    document.body.style.cursor = 'grabbing';
    pointerStart.card.classList.add('is-dragging');
  }
  if (pointerStart.started) {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    clearTargets();
    el?.closest('.slot')?.classList.add('drop-target');
  }
});
document.addEventListener('pointerup', (e) => {
  if (!pointerStart) return;
  const p = pointerStart;
  pointerStart = null;
  document.body.style.cursor = '';
  clearTargets();
  if (p.started) {
    const slot = document.elementFromPoint(e.clientX, e.clientY)?.closest('.slot');
    if (slot && p.source.type !== 'library') move(p.source, slot);
    p.card.classList.remove('is-dragging');
    lastDragEnd = Date.now();
  }
});
document.addEventListener('pointercancel', () => { pointerStart = null; document.body.style.cursor = ''; document.querySelectorAll('.slot.drop-target,.is-dragging').forEach((el) => el.classList.remove('drop-target', 'is-dragging')); });

window.addEventListener('online', () => ($('offlineBadge').textContent = '● Online · saved locally'));
window.addEventListener('offline', () => ($('offlineBadge').textContent = '● Offline · saved locally'));

// ---------- start ----------

$('appVersion').textContent = `Version ${APP_VERSION}`;
commit(ctx.state);
updateCount();
requestPersistence().then((r) => {
  $('persistStatus').textContent = r === 'granted' ? 'Kept permanently: the browser will not clear it on its own.'
    : r === 'not granted' ? 'The browser may clear it after a long time without use. Keep the device synced and save a backup now and then.'
      : 'This browser does not say. Keep the device synced and save a backup now and then.';
});

// Offline-first: keep the app's files on this device. Add ?nosw to the address to switch it off while developing.
const noSW = new URLSearchParams(location.search).has('nosw');
if ('serviceWorker' in navigator) {
  if (noSW) navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister()));
  else if (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
    navigator.serviceWorker.register('./sw.js').then((reg) => {
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        w?.addEventListener('statechange', () => {
          if (w.state === 'installed' && navigator.serviceWorker.controller) toast('An update is ready. It will be used the next time you open the planner.', 5000);
        });
      });
    }).catch(() => { /* offline mode unavailable in this browser */ });
  }
}

// Unused here but kept reachable for the console while testing.
window.pwr = { ctx, DAYS, clearNewMarks };
