// Starts the planner: loads the saved week, draws every screen, wires the buttons,
// drag & drop (mouse, touch and tap-to-place), and the offline-first service worker.
//
// Track: shared (keep this file small; put features in their own module)

import { APP_VERSION, PERIODS } from './config.js';
import { ctx, commit, change, undo, onRender } from './context.js';
import { load, save, fresh, requestPersistence, exportBackup, importBackup, keepSafetyCopy, safetyCopies, readSafetyCopy, deviceSignature } from './store.js';
import { $, toast, currentPeriodIndex } from './ui-kit.js';
import { openWeek } from './rules.js';
import { renderWeek, changeWeek, weekKey, openBalance, keepDay, openSplit, openAddLeftover, startPlacing, cancelPlacing, placeInto, openWeekMenu, toggleSuggestions, scheduleFor } from './ui-week.js';
import { renderDaily, addRest, showDay, shownDay, toggleGroup } from './ui-daily.js';
import { renderLibrary, activityForm, createAndScheduleActivity, openQuickAdd, openCardMenu, handleLibraryClick, renderQuietSettings, toggleQuiet } from './ui-library.js';
import { printWeek, printDay, printGuide, renderPrintArea } from './print.js';
import { renderGuide } from './guide.js';
import { openAppointmentCard } from './ui-appointment.js';
import { connect, disconnect, sync, renderDemoPanel, renderConnection, wireConnection, scheduleAutoBackup, startNotePickup } from './ui-device.js';
import { openVoiceModal } from './voice/recorder.js';
import { renderVoiceView, renderBanner, handleVoiceClick, processAll, updateCount, refreshWaiting } from './voice/inbox.js';
import { preload, onStatus } from './voice/transcribe.js';
import { onNotesChanged } from './voice/notes.js';
import { t, tDay, dayInText, setLang, translatePage, fmtDate, fmtTime, tPeriod } from './i18n.js';
import { startReminders, checkReminders, redrawReminder } from './reminders.js';
import { openPhoto } from './photo.js';
import { maybeStartTutorial, openTutorial } from './tutorial.js';
import { isDemo, setDemo, resetDemo } from './store.js';

ctx.state = load();
setLang(ctx.state.settings.lang);
translatePage();

// Always open on the real current week. The week saved on screen is kept under its own date (rules.openWeek):
// before v0.9 it was the week of the last visit (weekOf). A week never opened starts with the weekly activities.
function toThisWeek(state) {
  const key = weekKey(0);
  if (!state.shownWeek) state.shownWeek = state.weekOf || key;
  delete state.weekOf;
  const newWeek = state.shownWeek < key && !state.weeks?.[key];
  const next = openWeek(state, key);
  return { state: next, newWeek };
}
{
  const { state, newWeek } = toThisWeek(ctx.state);
  ctx.state = state;
  save(ctx.state);
  keepSafetyCopy(ctx.state, 'daily copy', { daily: true }); // one a day, before today's changes
  if (newWeek && Object.keys(state.series || {}).length) setTimeout(() => toast(t('A new week: your weekly activities are in their usual places.'), 5000), 800);
}

// ---------- drawing ----------

function applySettings() {
  const s = ctx.state.settings;
  $('themeSelect').value = s.theme || 'sage';
  document.body.dataset.theme = s.theme || 'sage';
  $('contrastToggle').setAttribute('aria-checked', s.contrast);
  $('alertsToggle').setAttribute('aria-checked', s.alerts);
  $('smsToggle').setAttribute('aria-checked', s.sms);
  $('demoToggle').setAttribute('aria-checked', !!s.demoDevice);
  $('reminderLead').value = s.lead;
  $('modelSelect').value = s.speechModel;
  $('weekStartSelect').value = s.weekStart || 'Sunday';
  $('fontSelect').value = s.font || 'system';
  $('spacingSelect').value = s.spacing || 'comfortable';
  document.body.classList.toggle('font-atkinson', s.font === 'atkinson');
  document.body.classList.toggle('font-serif', s.font === 'serif');
  document.documentElement.dataset.size = s.size || 'standard';
  document.querySelectorAll('input[name=textSize]').forEach((r) => (r.checked = r.value === (s.size || 'standard')));
  document.body.classList.toggle('spacious', s.spacing === 'spacious');
  document.body.classList.toggle('high-contrast', s.contrast);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', s.theme === 'dim' ? '#1c1d18' : '#4a5530');
  $('langSelect').value = s.lang;
  $('langBtn').textContent = s.lang === 'fr' ? 'English' : 'Français';
  $('langBtn').setAttribute('lang', s.lang === 'fr' ? 'en' : 'fr');
  $('appRemindToggle').setAttribute('aria-checked', s.appReminders !== false);
  $('demoModeToggle').setAttribute('aria-checked', isDemo());
  $('demoBanner').classList.toggle('hidden', !isDemo());
  renderSaveLine();
  applyLayout();
}

// Week or One day on the main schedule screen (the choice is remembered).
function applyLayout() {
  const day = ctx.state.settings.layout === 'day';
  $('weeklyView').classList.toggle('layout-day', day); // CSS hides the grid and its legend (the grid redraws its own classes)
  $('dayPanel').classList.toggle('hidden', !day);
  document.querySelectorAll('[data-layout]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.layout === (day ? 'day' : 'week'))));
}
function setLayout(layout) {
  if (ctx.state.settings.layout !== layout) commit({ ...ctx.state, settings: { ...ctx.state.settings, layout } });
  applyLayout();
}

// "Saved on this iPad · 10:42 · Device: up to date" (client: she was not sure her changes were kept or sent).
function renderSaveLine() {
  const el = $('offlineBadge');
  if (!el) return;
  const s = ctx.state;
  const saved = ctx.saveFailed ? t('Could not save') : t('Saved on this iPad · {time}', { time: fmtTime(new Date(s.updatedAt || Date.now())) });
  // The device line: when it last got the full copy (v3), else whether it has this week.
  const dev = s.deviceBackup?.at ? t('Copy on the device · {time}', { time: fmtTime(new Date(s.deviceBackup.at)) })
    : s.deviceSync?.at ? (s.deviceSync.sig === deviceSignature({ schedule: scheduleFor(0) }) ? t('Device: up to date') : t('Device: not sent yet')) : '';
  el.textContent = [saved, dev].filter(Boolean).join(' · ');
  el.classList.toggle('warn', !!ctx.saveFailed || (!s.deviceBackup?.at && !!s.deviceSync?.at && s.deviceSync.sig !== deviceSignature({ schedule: scheduleFor(0) })));
}


function updateClock() {
  const now = new Date();
  $('topDate').textContent = fmtDate(now, { weekday: 'long', month: 'long', day: 'numeric' });
  const pi = currentPeriodIndex(now);
  $('topPeriod').textContent = pi >= 0 && pi <= 2 ? tPeriod(PERIODS[pi]) : '';
}

onRender(applySettings);
onRender(renderWeek);
onRender(renderDaily);
onRender(renderLibrary);
onRender(renderQuietSettings);
onRender(renderBanner);
onRender(renderPrintArea);
onRender(scheduleAutoBackup); // a copy on the device a few seconds after each change (v3)
document.addEventListener('pwr-backup', () => renderSaveLine());
onRender(() => { if (!$('voiceView').classList.contains('hidden')) renderVoiceView(); });

export function showView(name) {
  // "One day" is a layout of the main schedule screen, chosen with the switch at the top (team decision, Nov 2026).
  if (name === 'daily') { setLayout('day'); name = 'weekly'; }
  document.querySelectorAll('.view').forEach((v) => v.classList.add('hidden'));
  $(name + 'View').classList.remove('hidden');
  document.querySelectorAll('.navbtn').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
  if (name !== 'weekly' && ctx.placing) cancelPlacing();
  if (name === 'weekly') { renderWeek(); renderDaily(); }
  if (name === 'voice') renderVoiceView();
  if (name === 'device') { renderDemoPanel(); renderConnection(); }
  if (name === 'settings') renderSafety();
  window.scrollTo({ top: 0 });
}

const setting = (key, value) => commit({ ...ctx.state, settings: { ...ctx.state.settings, [key]: value } });

// ---------- buttons ----------

document.querySelectorAll('.navbtn').forEach((b) => b.addEventListener('click', () => showView(b.dataset.view)));
$('prevWeekBtn').onclick = () => changeWeek(ctx.weekOffset - 1);
$('nextWeekBtn').onclick = () => changeWeek(ctx.weekOffset + 1);
$('todayWeekBtn').onclick = () => changeWeek(0);
$('undoBtn').onclick = undo;
$('voiceBtn').onclick = openVoiceModal;
$('voiceRecordBtn2').onclick = openVoiceModal;
$('processNotesBtn').onclick = () => processAll().then(() => { renderVoiceView(); refreshWaiting(); });
$('printBtn').addEventListener('click', printWeek);
$('dailyPrint').addEventListener('click', () => printDay(shownDay()));
$('suggestBtn').onclick = () => toggleSuggestions();
document.querySelectorAll('[data-layout]').forEach((b) => (b.onclick = () => setLayout(b.dataset.layout)));
$('photoBtn').onclick = openPhoto;
const setLanguage = (lang) => {
  setLang(lang);
  translatePage();
  renderGuide();
  setting('lang', lang);
  updateClock();
  updateCount();
  redrawReminder();
  renderSafety();
};
$('langBtn').onclick = () => setLanguage(ctx.state.settings.lang === 'fr' ? 'en' : 'fr');
$('langSelect').onchange = (e) => setLanguage(e.target.value);
$('tutorialBtn').onclick = openTutorial;
$('helpTutorialBtn').onclick = openTutorial;
$('appRemindToggle').onclick = () => { setting('appReminders', ctx.state.settings.appReminders === false); checkReminders(); };
$('demoModeToggle').onclick = () => {
  if (!isDemo() && !confirm(t('Turn on demo mode? Visitors see an example week. Your own planner is kept apart, unchanged, and comes back when demo mode is off.'))) return;
  setDemo(!isDemo());
};
$('demoExit').onclick = () => setDemo(false);
$('demoReset').onclick = () => { if (confirm(t('Start the demo again with the example week?'))) resetDemo(); };
$('printGuideBtn').addEventListener('click', printGuide);
$('openAddActivity').onclick = () => activityForm();
$('weeklyAddActivity').onclick = () => createAndScheduleActivity();
$('openSplit').onclick = () => openSplit();
$('trayAdd').onclick = openAddLeftover;
$('weekMoreBtn').onclick = openWeekMenu;
$('fontSelect').onchange = (e) => { setting('font', e.target.value); toast(t('Font saved.')); };
$('spacingSelect').onchange = (e) => { setting('spacing', e.target.value); toast(t('Spacing saved.')); };

$('themeSelect').onchange = (e) => { setting('theme', e.target.value); toast(t('Colours saved.')); };
$('weekStartSelect').onchange = (e) => {
  setting('weekStart', e.target.value);
  commit({ ...ctx.state, shownWeek: weekKey(ctx.weekOffset) }); // the week on screen keeps its activities under its new first day
  toast(t('The week now starts on {day}.', { day: dayInText(e.target.value) }));
};
$('contrastToggle').onclick = () => setting('contrast', !ctx.state.settings.contrast);
document.addEventListener('change', (e) => { const q = e.target.closest?.('[data-quiet]'); if (q) toggleQuiet(q.dataset.quiet, q.checked); });
document.querySelectorAll('input[name=textSize]').forEach((r) => (r.onchange = () => { setting('size', r.value); }));
$('alertsToggle').onclick = () => setting('alerts', !ctx.state.settings.alerts);
$('smsToggle').onclick = () => { setting('sms', !ctx.state.settings.sms); toast(ctx.state.settings.sms ? t('SMS preference on (an SMS service is still needed).') : t('SMS preference off.')); };
$('demoToggle').onclick = () => { disconnect(); setting('demoDevice', !ctx.state.settings.demoDevice); renderDemoPanel(); renderConnection(); toast(ctx.state.settings.demoDevice ? t('Demo device on.') : t('Demo device off.')); };
$('reminderLead').onchange = (e) => { setting('lead', Number(e.target.value)); toast(t('Reminder time saved.')); };
$('modelSelect').onchange = (e) => { setting('speechModel', e.target.value); toast(t('Speech model saved. It downloads the next time it is needed.')); };
$('preloadModelBtn').onclick = () => preload(ctx.state.settings.speechModel);
$('vibrateBtn').onclick = () => { if ('vibrate' in navigator) { navigator.vibrate(180); toast(t('Vibration test requested.')); } else toast(t('Vibration is not supported by this browser.')); };
$('resetBtn').onclick = () => {
  if (!confirm(t('Start again with the example week? Your current week and activities are replaced. (A safety copy is kept.)'))) return;
  keepSafetyCopy(ctx.state, 'before a reset');
  sessionStorage.clear();
  const keep = ctx.state.settings;
  ctx.weekOffset = 0; ctx.undoStack = []; ctx.placing = null;
  const state = fresh();
  state.settings = { ...state.settings, ...keep };
  state.shownWeek = weekKey(0);
  commit(state);
  toast(t('Planner reset to the example week.'));
};
// Settings → Keep my schedule safe: the safety copies (store.js) and the Home Screen advice.
function renderSafety() {
  const copies = safetyCopies();
  const when = (at) => `${fmtDate(new Date(at), { weekday: 'short', month: 'short', day: 'numeric' })} ${fmtTime(new Date(at))}`;
  $('copyList').innerHTML = copies.length ? copies.map((c) => `<div class="copy-row"><span>${when(c.at)} · ${t(c.reason)}</span><button class="small" data-restore-copy="${c.id}">${t('Restore')}</button></div>`).join('')
    : `<p class="muted">${t('The first copy is made today.')}</p>`;
  // On iPad a Home Screen app has its own storage, separate from Safari: moving there needs a backup file,
  // so this is advice to follow with a helper, never a pop-up (her week would look empty in the new icon).
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = navigator.standalone === true || window.matchMedia?.('(display-mode: standalone)').matches;
  $('homeScreenRow').classList.toggle('hidden', !ios);
  $('homeScreenText').textContent = standalone
    ? t('The planner is open from its Home Screen icon: the iPad keeps your week safely. Always open it from this icon.')
    : t('Safari can clear a website after a long time without use. To keep your week safe, with a helper: 1. Save a backup (above). 2. Tap Share, then “Add to Home Screen”. 3. Open the new icon and Load the backup. Then always use the icon.');
}

$('copyList').addEventListener('click', (e) => {
  const b = e.target.closest('[data-restore-copy]');
  if (!b) return;
  const state = readSafetyCopy(b.dataset.restoreCopy);
  if (!state) { toast(t('This copy could not be opened.')); return; }
  if (!confirm(t('Go back to this copy? What you changed since then is replaced. A copy of the planner as it is now is kept, so you can come back to it.'))) return;
  keepSafetyCopy(ctx.state, 'before a restore');
  ctx.weekOffset = 0; ctx.undoStack = []; ctx.placing = null;
  commit(toThisWeek(state).state);
  renderSafety();
  toast(t('Planner restored from the safety copy.'));
});

$('exportBtn').onclick = () => { exportBackup(ctx.state); toast(t('Backup file created.')); };
$('importInput').onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const state = await importBackup(file);
    if (confirm(t('Replace the planner with this backup?'))) { keepSafetyCopy(ctx.state, 'before loading a backup'); ctx.weekOffset = 0; ctx.undoStack = []; commit(toThisWeek(state).state); toast(t('Backup loaded.')); }
  } catch (err) { toast(t(err.message)); }
  e.target.value = '';
};
$('connectBtn').onclick = connect;
$('disconnectBtn').onclick = disconnect;
$('syncBtn').onclick = sync;
wireConnection();

onStatus((s) => {
  const el = $('modelStatus');
  if (s.state === 'downloading') el.textContent = t('Downloading… {p} %', { p: Math.round((s.progress || 0) * 100) });
  if (s.state === 'ready') el.textContent = t('Ready. Works without internet from now on.');
  if (s.state === 'error') el.textContent = t('Could not load: {error}', { error: s.error });
});
onNotesChanged(updateCount);

// ---------- clicks (one handler for the whole page) ----------

let lastDragEnd = 0; // a drag that ends where it started must not count as a tap

document.addEventListener('click', (e) => {
  if (Date.now() - lastDragEnd < 400) return;
  const t = e.target;
  const action = t.closest('[data-action]');
  if (action) {
    e.stopPropagation();
    const card = action.closest('.activity-card');
    if (action.dataset.action === 'remove') change({ type: 'remove', id: card.dataset.id });
    if (action.dataset.action === 'drop-leftover') change({ type: 'dropLeftover', id: card.dataset.id });
    return;
  }
  if (t.closest('[data-cancel-place]')) { cancelPlacing(); return; }
  const scroll = t.closest('[data-scroll]');
  if (scroll) { $('paletteTiles').scrollBy({ left: Number(scroll.dataset.scroll) * 320 }); return; }
  const apBtn = t.closest('[data-appointment]');
  if (apBtn) { openAppointmentCard(apBtn.dataset.appointment); return; }
  const rest = t.closest('[data-add-rest]');
  if (rest) { addRest(rest.dataset.addRest); return; }
  const grp = t.closest('[data-day-group]');
  if (grp) { toggleGroup(grp.dataset.dayGroup); return; }
  const od = t.closest('[data-open-day]');
  if (od) { showDay(od.dataset.openDay); if (!od.closest('#dayPanel')) setLayout('day'); return; }
  if (t.closest('[data-suggest-hide]')) { toggleSuggestions(false); return; }
  if (t.closest('[data-open-balance]')) { openBalance(); return; }
  const keep = t.closest('[data-keep-day]');
  if (keep) { keepDay(keep.dataset.keepDay); return; }
  if (handleLibraryClick(e)) return;
  if (handleVoiceClick(e, showView)) return;

  const card = t.closest('.activity-card');
  const slot = t.closest('.slot');
  const inBoard = t.closest('#weeklyView');
  // Tap-to-place: an activity is chosen, the next tap on a block puts it there.
  if (ctx.placing && slot && slot.dataset.day) {
    placeInto(ctx.placing.kind, ctx.placing.id, slot.dataset.day, slot.dataset.period);
    ctx.placing = null;
    renderWeek();
    return;
  }
  if (card?.dataset.cardType === 'library' || card?.dataset.cardType === 'leftover') { startPlacing(card.dataset.cardType, card.dataset.id); return; }
  if (card?.dataset.cardType === 'scheduled' && inBoard) { openCardMenu(card.dataset.id); return; }
  if (slot && slot.dataset.day && inBoard && !card) openQuickAdd(slot.dataset.day, slot.dataset.period);
});
document.addEventListener('keydown', (e) => {
  const card = e.target.closest?.('.activity-card');
  if (card && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); card.click(); }
  if (e.key === 'Escape' && ctx.placing) cancelPlacing();
  if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.target.closest('input,textarea')) { e.preventDefault(); undo(); }
});

// ---------- drag & drop ----------
// Sources: a day's activity (moves it), one of "My activities" (adds a copy), a "Later" activity (places it).
// Targets: a block of a day, or the "Later this week" tray.
// One pointer-based drag for mouse, finger and pen, with a floating copy under the pointer:
// mouse starts after a small move; finger / pen after a short press (~0.25 s) so scrolling still works.

const clearTargets = () => document.querySelectorAll('.drop-target').forEach((x) => x.classList.remove('drop-target'));
const targetAt = (x, y) => document.elementFromPoint(x, y)?.closest('.slot[data-day], [data-tray]');

function dropOn(src, target) {
  if (!target) return;
  if (target.dataset.tray) {
    if (src.type === 'scheduled') change({ type: 'park', id: src.id });
    else if (src.type === 'library') {
      const a = ctx.state.library.find((x) => x.id === src.id);
      if (a) change({ type: 'addLeftover', item: { ...a, id: undefined, activityId: a.id, steps: [...(a.steps || [])] } });
    }
    return;
  }
  const { day, period } = target.dataset;
  if (src.type === 'scheduled') { if (src.day !== day || src.period !== period) change({ type: 'move', id: src.id, toDay: day, toPeriod: period }); }
  else placeInto(src.type, src.id, day, period);
  ctx.placing = null;
}

const sourceOf = (card) => ({ type: card.dataset.cardType, id: card.dataset.id, day: card.dataset.day, period: card.dataset.period });
const canDrag = (card) => card && card.getAttribute('draggable') === 'true' && ['scheduled', 'library', 'leftover'].includes(card.dataset.cardType);

// The browser's own drag-and-drop is switched off: it behaves differently on iPad, Bluefy and desktop.
document.addEventListener('dragstart', (e) => { if (e.target.closest?.('.activity-card')) e.preventDefault(); });

let press = null;  // { x, y, card, timer, mouse }
let drag = null;   // { src, card, ghost }
function startDrag() {
  const { card, x, y } = press;
  const ghost = card.cloneNode(true);
  ghost.classList.add('drag-ghost');
  ghost.style.left = x + 'px';
  ghost.style.top = y + 'px';
  document.body.appendChild(ghost);
  card.classList.add('is-dragging');
  document.body.classList.add('dragging');
  drag = { src: sourceOf(card), card, ghost };
  if (!press.mouse) navigator.vibrate?.(12);
}
document.addEventListener('pointerdown', (e) => {
  if (e.button > 0) return;
  const card = e.target.closest('.activity-card');
  if (!canDrag(card) || e.target.closest('button')) return;
  const mouse = e.pointerType === 'mouse';
  press = { x: e.clientX, y: e.clientY, card, mouse, timer: mouse ? null : setTimeout(startDrag, 250) };
});
document.addEventListener('pointermove', (e) => {
  if (press && !drag) {
    const moved = Math.hypot(e.clientX - press.x, e.clientY - press.y);
    if (press.mouse && moved > 6) { press.x = e.clientX; press.y = e.clientY; startDrag(); }
    else if (!press.mouse && moved > 8) { clearTimeout(press.timer); press = null; return; } // a scroll, not a drag
  }
  if (!drag) return;
  drag.ghost.style.left = e.clientX + 'px';
  drag.ghost.style.top = e.clientY + 'px';
  clearTargets();
  targetAt(e.clientX, e.clientY)?.classList.add('drop-target');
});
// While dragging with a finger, the page must not scroll.
document.addEventListener('touchmove', (e) => { if (drag) e.preventDefault(); }, { passive: false });
function endDrag(e, cancelled) {
  if (press) { clearTimeout(press.timer); press = null; }
  if (!drag) return;
  const d = drag;
  drag = null;
  d.ghost.remove();
  d.card.classList.remove('is-dragging');
  document.body.classList.remove('dragging');
  clearTargets();
  lastDragEnd = Date.now();
  if (!cancelled) dropOn(d.src, targetAt(e.clientX, e.clientY));
}
document.addEventListener('pointerup', (e) => endDrag(e, false));
document.addEventListener('pointercancel', (e) => endDrag(e, true));



// ---------- start ----------

$('appVersion').textContent = `${t('Version')} ${APP_VERSION}`;
renderGuide();
commit(ctx.state);
updateClock();
setInterval(() => { updateClock(); renderDaily(); }, 60000); // "Now" moves on through the day
startReminders();
startNotePickup(); // over Wi-Fi: the device's voice notes arrive by themselves
maybeStartTutorial();
updateCount();
refreshWaiting();
requestPersistence().then((r) => {
  $('persistStatus').textContent = r === 'granted' ? t('Kept permanently: the browser will not clear it on its own.')
    : r === 'not granted' ? t('The browser may clear it after a long time without use. Keep the device synced and save a backup now and then.')
      : t('This browser does not say. Keep the device synced and save a backup now and then.');
});

// Offline-first: keep the app's files on this device. Add ?nosw to the address to switch it off while developing.
const noSW = new URLSearchParams(location.search).has('nosw');
if ('serviceWorker' in navigator) {
  if (noSW) navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister()));
  else if (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
    // Updates install in the background and switch over on their own, never in the middle of something:
    //  - when the planner has just been opened (or brought back) and she has not touched it yet, or
    //  - when she leaves the planner (screen hidden),
    // and never while a window (a form, a voice recording) is open. Team decision, Nov 3 2026.
    let reloading = false;
    let touched = false; // has she used the page since it was opened or brought back?
    ['pointerdown', 'keydown'].forEach((t) => document.addEventListener(t, () => { touched = true; }, { capture: true, passive: true }));
    const busy = () => !!$('modalRoot')?.innerHTML;
    const applyUpdate = (reg, force = false) => {
      if (!reg.waiting || !navigator.serviceWorker.controller) return;
      if (!force && busy()) return;
      if (force || !touched || document.visibilityState === 'hidden') {
        sessionStorage.setItem('pwr-updated', '1');
        reg.waiting.postMessage('SKIP_WAITING');
      }
    };
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloading) return;
      reloading = true;
      location.reload();
    });
    if (sessionStorage.getItem('pwr-updated')) {
      sessionStorage.removeItem('pwr-updated');
      setTimeout(() => toast(t('The planner was updated (version {v}).', { v: APP_VERSION })), 600);
    }
    navigator.serviceWorker.register('./sw.js').then((reg) => {
      applyUpdate(reg);
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        w?.addEventListener('statechange', () => { if (w.state === 'installed') applyUpdate(reg); });
      });
      // An iPad keeps the planner open for days: look for a new version each time she comes back to it.
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') { applyUpdate(reg); return; }
        touched = false;
        reg.update().catch(() => { /* offline */ });
      });
      $('checkUpdateBtn').onclick = async () => {
        $('updateStatus').textContent = t('Checking…');
        try { await reg.update(); } catch (e) { /* offline */ }
        setTimeout(() => {
          if (reg.waiting) { $('updateStatus').textContent = t('Updating…'); applyUpdate(reg, true); }
          else $('updateStatus').textContent = reg.installing ? t('A new version is downloading; it will be used the next time you open the planner.') : t('You have the latest version ({v}).', { v: APP_VERSION });
        }, 1500);
      };
    }).catch(() => { /* offline mode unavailable in this browser */ });
  }
}

// Unused here but kept reachable for the console while testing.
window.pwr = { ctx };
