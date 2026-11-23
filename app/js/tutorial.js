// First-use tutorial (client feedback, Nov 2026: "she wants an app" and "maybe add a tutorial").
// A real App Store app is not possible for now, so the tutorial shows how to put the planner on the
// Home Screen: it then opens full screen from its own icon, like an app, and works without internet.
//
// - Opens by itself the first time; "Skip" closes it for good; Help and Settings show it again.
// - One idea per page, a picture, two or three short sentences, big Back / Next buttons, dots for where
//   she is (W3C COGA: clear steps, no time limit, easy to go back). The language is chosen on page 1.
// - The Home Screen page is only shown on an iPad / iPhone browser (not when already opened from the icon).
//   A Home Screen app keeps its own storage, separate from Safari: so the planner is saved in a file first,
//   and the icon offers to load it on its first opening (the week is never lost in the move).
//
// Track: A - Interface

import { ctx, commit } from './context.js';
import { exportBackup, importBackup, keepSafetyCopy } from './store.js';
import { $, shape, showPanelModal, closeModal, toast } from './ui-kit.js';
import { t, setLang, translatePage } from './i18n.js';

const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => navigator.standalone === true || window.matchMedia?.('(display-mode: standalone)').matches;

const SHARE_ICON = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align:-4px"><path d="M12 3v12M8 7l4-4 4 4"/><path d="M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1"/></svg>';

function pages() {
  const list = [
    { pic: '👋', title: t('Welcome to My Week, My Way'), body: `<p>${t('A planner that helps you spread your energy over the week.')}</p><p>${t('Choose your language:')}</p><div class="row tut-lang"><button type="button" data-tut-lang="en" lang="en">English</button><button type="button" data-tut-lang="fr" lang="fr">Français</button></div>` },
    { pic: '🗓️', title: t('Your week'), body: `<p>${t('Each day is a column. Morning, Afternoon and Evening are the rows.')}</p><p>${t('The bar under each day fills up as the day gets busy: green, then yellow, then red.')}</p>` },
    { pic: `<span class="tut-shapes">${shape('green')}${shape('yellow')}${shape('red')}${shape('rest')}</span>`, title: t('The shapes'), body: `<p>${t('More points = more energy.')}</p><ul class="tut-list"><li>${shape('green')} ${t('Circle: Easy')}</li><li>${shape('yellow')} ${t('Triangle: Moderate')}</li><li>${shape('red')} ${t('Black star: High energy')}</li><li>${shape('rest')} ${t('Pause: Rest')}</li></ul>` },
    { pic: '➕', title: t('Add an activity'), body: `<p>${t('Press “New activity”. Write its name, choose its energy and a day. You can add a time if you want.')}</p><p>${t('Or drag one of “My activities” into a day.')}</p>` },
    { pic: '✋', title: t('Change, split, undo'), body: `<p>${t('Tap an activity to move it, change it, or split it into smaller parts.')}</p><p>${t('Made a mistake? Press “Undo” at the top.')}</p>` },
    { pic: '☀️', title: t('One day'), body: `<p>${t('At the bottom of the page, “One day” shows today simply, with a picture for each activity. “Now” shows what is happening now.')}</p>` },
    { pic: '🎙️', title: t('Voice, photo and paper'), body: `<p>${t('“Voice note”: say what to change. “Add from a photo”: take a picture of a paper schedule. “Print”: your week on paper.')}</p>` },
  ];
  if (isIos() && !isStandalone()) {
    list.push({ pic: '📲', title: t('Put the planner on your Home Screen'), body: `<p>${t('Then it opens from its own icon, full screen, like an app, and works without internet.')}</p>
      <ol class="tut-steps"><li>${t('Press “Save my planner” below (it keeps your week in a file).')} <button type="button" class="small" id="tutSave">${t('Save my planner')}</button></li>
      <li>${t('At the top of Safari, tap Share {icon}.', { icon: SHARE_ICON })}</li>
      <li>${t('Choose “Add to Home Screen”, then “Add”.')}</li>
      <li>${t('Open the new icon. It offers to load your planner from the file.')}</li></ol>` });
  }
  list.push({ pic: '✅', title: t('You are ready'), body: `<p>${t('You can see this tour again any time: Help → “Show the tutorial”.')}</p>` });
  return list;
}

export function openTutorial(start = 0) {
  let i = start;
  const draw = () => {
    const list = pages();
    i = Math.max(0, Math.min(i, list.length - 1));
    const p = list[i];
    const modal = showPanelModal(p.title, `<div class="tut"><div class="tut-pic" aria-hidden="true">${p.pic}</div><div class="tut-body">${p.body}</div>
      <div class="tut-dots" aria-label="${t('Page {n} of {total}', { n: i + 1, total: list.length })}">${list.map((_, k) => `<span class="${k === i ? 'on' : ''}"></span>`).join('')}</div></div>
      <div class="modal-actions"><button type="button" id="tutSkip">${i === list.length - 1 ? t('Close') : t('Skip')}</button>${i > 0 ? `<button type="button" id="tutBack">${t('Back')}</button>` : ''}${i < list.length - 1 ? `<button type="button" class="primary" id="tutNext">${t('Next')}</button>` : `<button type="button" class="primary" id="tutDone">${t('Start')}</button>`}</div>`);
    const finish = () => { closeModal(); commit({ ...ctx.state, settings: { ...ctx.state.settings, tutorialDone: true } }); };
    $('tutSkip').onclick = finish;
    $('tutBack')?.addEventListener('click', () => { i--; draw(); });
    $('tutNext')?.addEventListener('click', () => { i++; draw(); });
    $('tutDone')?.addEventListener('click', finish);
    $('tutSave')?.addEventListener('click', () => { exportBackup(ctx.state); toast(t('Your planner is saved in a file (Files app, Downloads).')); });
    modal.querySelectorAll('[data-tut-lang]').forEach((b) => (b.onclick = () => {
      setLang(b.dataset.tutLang);
      translatePage();
      commit({ ...ctx.state, settings: { ...ctx.state.settings, lang: b.dataset.tutLang } });
      draw();
    }));
  };
  draw();
}

// On the first opening from the Home Screen icon: offer to load the planner saved from Safari.
function offerLoad() {
  const modal = showPanelModal(t('Load your planner'), `<p>${t('This is the planner’s own icon. If you saved your planner in Safari, load it here so your week is the same.')}</p>
    <div class="row" style="margin-top:12px"><label class="file-button primary-file"><input id="tutLoad" type="file" accept="application/json,.json"><span>${t('Load my planner')}</span></label></div>
    <div class="modal-actions"><button type="button" id="tutLoadSkip">${t('Not now')}</button></div>`);
  void modal;
  $('tutLoadSkip').onclick = () => { closeModal(); commit({ ...ctx.state, settings: { ...ctx.state.settings, tutorialDone: true, iconLoadOffered: true } }); };
  $('tutLoad').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const state = await importBackup(file);
      keepSafetyCopy(ctx.state, 'before loading a backup');
      state.settings = { ...state.settings, tutorialDone: true, iconLoadOffered: true };
      closeModal();
      commit(state);
      toast(t('Your planner is loaded. Always open it from this icon now.'), 6000);
    } catch (err) { toast(t(err.message)); }
  };
}

export function maybeStartTutorial() {
  if (isStandalone() && isIos() && !ctx.state.settings.iconLoadOffered) { setTimeout(offerLoad, 400); return; }
  if (!ctx.state.settings.tutorialDone) setTimeout(() => openTutorial(0), 400);
}
