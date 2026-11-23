// "My activities": the client's reusable activities, and every form that adds or edits one.
// Each activity can carry a short checklist of steps, a note, a picture and an optional clock time.
//
// Track: A - Interface

import { DAYS, PERIODS, periodOfTime } from './config.js';
import { ctx, commit, change, snapshotUndo, undo } from './context.js';
import { uid, isAppointment } from './store.js';
import { openAppointmentCard } from './ui-appointment.js';
import { $, esc, shape, shapeText, energyLabel, toast, showModal, closeModal, energyPicker, orderedDays } from './ui-kit.js';
import { placeInto, openSplit } from './ui-week.js';
import { iconFor, ICON_CHOICES, drawing } from './icons.js';
import { t, tDay, tPeriod, where, clock } from './i18n.js';

const clone = (x) => JSON.parse(JSON.stringify(x));
const days = () => orderedDays(ctx.state.settings.weekStart);
const box = 'style="width:24px;height:24px"';

export function renderLibrary() {
  // Every week or not is set on the week's cards (tap a card); an activity used by a weekly one cannot be deleted.
  const weekly = new Set(Object.values(ctx.state.series || {}).map((x) => x.item.activityId));
  $('libraryList').innerHTML = ctx.state.library.map((a) => `<article class="library-item ${esc(a.energy)}"><span class="lib-icon e-${esc(a.energy)}" aria-hidden="true">${iconFor(a)}</span><span class="chip e-${esc(a.energy)}">${shape(a.energy)} ${energyLabel(a.energy)}</span><h4>${esc(a.name)}</h4><p>${a.duration ? `${a.duration} min` : ''}${weekly.has(a.id) ? ` · ${t('in your week every week')}` : ''}${a.steps?.length ? ` · ${t('{n} steps', { n: a.steps.length })}` : ''}${a.note ? `<br>${esc(a.note)}` : ''}</p><div class="row"><button class="small" data-add-to-schedule="${esc(a.id)}">${t('Add to the week')}</button><button class="small" data-split-library="${esc(a.id)}">${t('Split into parts')}</button><button class="small" data-edit-library="${esc(a.id)}">${t('Edit')}</button>${weekly.has(a.id) ? '' : `<button class="small danger" data-delete-library="${esc(a.id)}">${t('Delete')}</button>`}</div></article>`).join('') || `<p>${t('No activities yet. Create one to get started.')}</p>`;
}

export function scheduleFromLibrary(activityId, day, period, opts) { placeInto('library', activityId, day, period, opts); }

// Day + time of day, and an optional clock time (client feedback, Nov 2026: "add an hour when adding an activity").
// When a time is typed, the time of day follows it (10:30 → Morning).
const whenFields = (day, period, time = '') => `<div class="row" style="margin-top:12px"><div class="field"><label for="fDay">${t('Day')}</label><select id="fDay" name="day">${days().map((d) => `<option value="${d}" ${d === day ? 'selected' : ''}>${tDay(d)}</option>`).join('')}<option value="">${t('Later this week')}</option></select></div><div class="field"><label for="fPeriod">${t('Time of day')}</label><select id="fPeriod" name="period">${PERIODS.map((p) => `<option value="${p}" ${p === period ? 'selected' : ''}>${tPeriod(p)}</option>`).join('')}</select></div><div class="field"><label for="fTime">${t('At (optional)')}</label><input id="fTime" name="time" type="time" step="300" value="${esc(time || '')}"></div></div>`;
// Typing a time picks the matching time of day.
function wireTime() {
  const ti = $('fTime'), pe = $('fPeriod');
  if (ti && pe) ti.addEventListener('change', () => { const p = periodOfTime(ti.value); if (p) pe.value = p; });
}
const readTime = (fd) => (/^\d{1,2}:\d{2}$/.test(String(fd.get('time') || '')) ? String(fd.get('time')) : '');
// The time of day to use: the one that matches the clock time, else the one chosen.
const periodFor = (fd) => periodOfTime(readTime(fd)) || fd.get('period');

// "Repeat every week": offered when she puts an activity in a day (new activity, quick add); tapping a card changes it later.
const repeatField = (on) => `<div class="setting-row" style="margin-top:12px"><label for="fFixed"><strong>${t('Repeat every week')}</strong><p class="muted">${t('It comes back to the same place every week. You can still move it for one week.')}</p></label><input id="fFixed" name="fixed" type="checkbox" ${on ? 'checked' : ''} ${box}></div>`;

// A picture for the activity: chosen from the name, or one she taps.
const iconField = (a) => {
  const current = a.icon || '';
  return `<fieldset class="field icon-field"><legend>${t('Picture')}</legend><div class="icon-options"><label title="${esc(t('Chosen from the name'))}"><input type="radio" name="icon" value="" ${current ? '' : 'checked'}><span class="icon-auto">${t('Auto')}</span></label>${ICON_CHOICES.map((i) => `<label><input type="radio" name="icon" value="${i}" ${current === i ? 'checked' : ''} aria-label="${i}"><span>${drawing(i)}</span></label>`).join('')}</div></fieldset>`;
};

const detailFields = (a) => `<div class="row" style="margin-top:12px"><div class="field"><label for="fDuration">${t('About how long (minutes)')}</label><input id="fDuration" name="duration" type="number" min="5" max="600" step="5" value="${a.duration || 30}"></div></div>
  <div class="field" style="margin-top:12px"><label for="fSteps">${t('Steps to remember (optional, one per line)')}</label><textarea id="fSteps" name="steps" placeholder="${esc(t('e.g. Health card\nList of questions'))}">${esc((a.steps || []).join('\n'))}</textarea><span class="hint">${t('Shown under the activity in One day.')}</span></div>
  <div class="field" style="margin-top:12px"><label for="fNote">${t('Note (optional)')}</label><input id="fNote" name="note" maxlength="120" value="${esc(a.note || '')}"></div>
  <div style="margin-top:12px">${iconField(a)}</div>
  <div class="setting-row"><label for="fReminder"><strong>${t('Reminder on the device')}</strong></label><input id="fReminder" name="reminder" type="checkbox" ${a.reminder !== false ? 'checked' : ''} ${box}></div>
  <div class="setting-row"><label for="fAppointment"><strong>${t('Appointment')}</strong><p class="muted">${t('Adds an appointment card: questions to ask and what to bring.')}</p></label><input id="fAppointment" name="appointment" type="checkbox" ${a.appointment ? 'checked' : ''} ${box}></div>
  <div class="setting-row"><label for="fQuiet"><strong>${t('Quiet time')}</strong><p class="muted">${t('The device does not vibrate or beep during it; reminders wait until after.')}</p></label><input id="fQuiet" name="quiet" type="checkbox" ${a.quiet ? 'checked' : ''} ${box}></div>`;

const readDetails = (fd) => ({
  duration: Math.max(5, Number(fd.get('duration') || 30)),
  steps: String(fd.get('steps') || '').split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 8),
  note: String(fd.get('note') || '').trim(),
  reminder: fd.has('reminder'),
  appointment: fd.has('appointment'),
  quiet: fd.has('quiet'),
  icon: String(fd.get('icon') || ''),
});

export function activityForm(existing = null) {
  const a = existing || { name: '', energy: 'green', duration: 30, fixed: false, reminder: true, steps: [] };
  showModal(existing ? t('Edit activity') : t('New activity'), `
    <div class="field"><label for="fName">${t('Name')}</label><input id="fName" name="name" required maxlength="60" value="${esc(a.name)}" placeholder="${esc(t('e.g. Medical appointment'))}"></div>
    <div style="margin-top:12px">${energyPicker('energy', a.energy)}</div>
    ${detailFields(a)}`, (fd) => {
    const name = String(fd.get('name') || '').trim();
    if (!name) { toast(t('Please write a name.')); return false; }
    const next = { ...(existing || {}), id: existing?.id || uid(), name, energy: fd.get('energy') || 'green', ...readDetails(fd) };
    const state = clone(ctx.state);
    if (existing) {
      state.library = state.library.map((x) => (x.id === existing.id ? next : x));
      // Copies follow the change (their own part names stay): this week, the weeks planned ahead, the weekly ones.
      const follow = (s) => {
        if (s.activityId !== existing.id) return;
        if (s.name === existing.name) s.name = next.name;
        Object.assign(s, { energy: next.energy, duration: next.duration, reminder: next.reminder, steps: next.steps, note: next.note, appointment: next.appointment, quiet: next.quiet, icon: next.icon });
      };
      const later = Object.keys(state.weeks || {}).filter((k) => k > (state.shownWeek || ''));
      [state.schedule, ...later.map((k) => state.weeks[k])].forEach((w) => DAYS.forEach((d) => PERIODS.forEach((p) => w[d][p].forEach(follow))));
      Object.values(state.series || {}).forEach((x) => follow(x.item));
    } else state.library.push(next);
    snapshotUndo();
    commit(state);
    toast(existing ? t('Activity updated.') : t('Activity added to My activities. Drag it onto a day.'), 8000, { label: t('Undo'), run: undo });
  });
}

// "New activity" from the week: create it and put it in a day (or in Later this week) in one step.
export function createAndScheduleActivity(day = days()[0], period = 'Morning') {
  showModal(t('New activity'), `
    <div class="field"><label for="fName">${t('Name')}</label><input id="fName" name="name" required maxlength="60" placeholder="${esc(t('e.g. Water the plants'))}"></div>
    <div style="margin-top:12px">${energyPicker('energy', 'green')}</div>
    ${whenFields(day, period)}
    ${repeatField(false)}
    <details style="margin-top:10px"><summary style="cursor:pointer;font-weight:700;padding:6px 0">${t('More (length, steps, picture, note)')}</summary>${detailFields({ reminder: true })}</details>`, (fd) => {
    const name = String(fd.get('name') || '').trim();
    if (!name) { toast(t('Please write a name.')); return false; }
    if (fd.has('fixed') && !fd.get('day')) { toast(t('Choose a day for an activity that repeats every week.')); return false; }
    // It also goes in "My activities", so she can drag it into another day later.
    const activity = { id: uid(), name, energy: fd.get('energy') || 'green', fixed: false, ...readDetails(fd) };
    const time = readTime(fd);
    const item = { ...activity, id: uid(), activityId: activity.id, ...(time ? { time } : {}) };
    if (!fd.get('day')) {
      commit({ ...ctx.state, library: [...ctx.state.library, activity] });
      change({ type: 'addLeftover', item });
    } else change({ type: 'add', day: fd.get('day'), period: periodFor(fd), libraryItem: activity, item, everyWeek: fd.has('fixed') });
  }, { submitLabel: t('Add') });
  wireTime();
}

// Tap on an empty part of a block: pick one of her activities for it (2 taps), with an optional time.
export function openQuickAdd(day, period) {
  showModal(t('Add to {day} · {period}', { day: tDay(day), period: tPeriod(period) }), `<div class="field"><label for="quickActivity">${t('Choose an activity')}</label><select name="activityId" id="quickActivity" required size="8" style="min-height:280px">${ctx.state.library.map((a, i) => `<option value="${a.id}" ${i === 0 ? 'selected' : ''}>${shapeText(a.energy)} ${esc(a.name)} — ${energyLabel(a.energy)}</option>`).join('')}</select></div>
    <div class="row" style="margin-top:12px"><div class="field"><label for="fTime">${t('At (optional)')}</label><input id="fTime" name="time" type="time" step="300"></div></div>
    ${repeatField(false)}<p class="muted" style="margin-top:8px;font-size:.85em">${t('Not in the list?')} <button type="button" class="small" id="quickNew">＋ ${t('New activity')}</button></p>`, (fd) => {
    const time = readTime(fd);
    scheduleFromLibrary(fd.get('activityId'), day, periodOfTime(time) || period, { everyWeek: fd.has('fixed'), time });
  }, { submitLabel: t('Add') });
  $('quickNew').onclick = () => createAndScheduleActivity(day, period);
}

// Tap on a card in the week: change it (the tap alternative to dragging). Client feedback, Nov 4 2026:
// say clearly if it comes every week, change its colour (energy), and make "this week only" or "every week"
// clear when moving or removing a weekly one. Everything is done in one Save, with one Undo.
// Nov 2026: a clock time, and "Split into parts" right here (splitting easy to find).
export function openCardMenu(id) {
  const found = (() => { for (const d of DAYS) for (const p of PERIODS) { const a = ctx.state.schedule[d][p].find((x) => x.id === id); if (a) return { a, d, p }; } return null; })();
  if (!found) return;
  const { a, d, p } = found;
  const usual = a.seriesId ? ctx.state.series?.[a.seriesId] : null;
  const weekly = !!usual;
  showModal(`<span class="title-icon e-${esc(a.energy)}" aria-hidden="true">${iconFor(a)}</span> ${shape(a.energy)} ${esc(a.name)}`, `<p class="muted">${esc(where(d, p))}${a.time ? ` · ${esc(clock(a.time))}` : ''}${weekly && (usual.day !== d || usual.period !== p) ? ` · ${t('this week only (usually {where})', { where: where(usual.day, usual.period) })}` : ''}</p>${a.steps?.length ? `<p style="margin-top:6px">${t('Steps')}: ${a.steps.map(esc).join(' · ')}</p>` : ''}
    <div class="row" style="margin:10px 0 4px">${isAppointment(a, ctx.state.library) ? `<button type="button" class="primary" id="openApCard">${t('Appointment card: questions and what to bring')}</button>` : ''}<button type="button" id="splitCard">${t('Split into parts')}</button></div>
    <div class="setting-row"><label for="fWeekly"><strong>${t('Every week')}</strong><p class="muted">${weekly ? t('On: it comes back every week on {where}. Untick to keep it only this week.', { where: where(usual.day, usual.period) }) : t('Off: only this week. Tick to repeat it every week in this place.')}</p></label><input id="fWeekly" name="weekly" type="checkbox" ${weekly ? 'checked' : ''} ${box}></div>
    <div style="margin-top:12px">${energyPicker('energy', a.energy, t('Energy and colour'))}</div>
    ${whenFields(d, p, a.time)}
    ${weekly ? `<fieldset class="field scope-options"><legend>${t('A new day, time or colour is for')}</legend><label><input type="radio" name="scope" value="week" checked><span>${t('This week only')}</span></label><label><input type="radio" name="scope" value="every"><span>${t('Every week from now on')}</span></label></fieldset>` : ''}
    <div class="row" style="margin-top:16px">${weekly
      ? `<button type="button" id="removeWeek">${t('Remove this week only')}</button><button type="button" class="danger" id="removeEvery">${t('Remove every week')}</button>`
      : `<button type="button" class="danger" id="removeCard">${t('Remove from the week')}</button>`}</div>`, (fd) => {
    const keepWeekly = fd.has('weekly');
    const every = weekly && keepWeekly && fd.get('scope') === 'every';
    const time = readTime(fd);
    const toDay = fd.get('day'), toPeriod = periodFor(fd), energy = fd.get('energy');
    const changes = [];
    if (weekly && !keepWeekly) changes.push({ type: 'setWeekly', id, on: false });
    if (!toDay) changes.push({ type: 'park', id });
    else if (toDay !== d || toPeriod !== p) changes.push({ type: 'move', id, toDay, toPeriod, everyWeek: every, time });
    // Moved here this week only, and now "every week": this becomes its usual place.
    else if (every && (usual.day !== d || usual.period !== p)) changes.push({ type: 'move', id, toDay: d, toPeriod: p, everyWeek: true });
    if (energy && energy !== a.energy) changes.push({ type: 'update', id, fields: { energy }, everyWeek: every });
    if (toDay && (toDay === d && toPeriod === p) && time !== (a.time || '')) changes.push({ type: 'update', id, fields: { time: time || null }, everyWeek: every });
    if (!weekly && keepWeekly && toDay) changes.push({ type: 'setWeekly', id, on: true });
    if (!weekly && keepWeekly && !toDay) { toast(t('Choose a day for an activity that comes every week.')); return false; }
    if (changes.length) change(changes.length === 1 ? changes[0] : { type: 'batch', changes });
  }, { submitLabel: t('Save') });
  wireTime();
  const ap = $('openApCard');
  if (ap) ap.onclick = () => { closeModal(); openAppointmentCard(id); };
  $('splitCard').onclick = () => { closeModal(); openSplit({ cardId: id }); };
  const rc = $('removeCard');
  if (rc) rc.onclick = () => { closeModal(); change({ type: 'remove', id }); };
  const rw = $('removeWeek');
  if (rw) rw.onclick = () => { closeModal(); change({ type: 'remove', id }); };
  const re = $('removeEvery');
  if (re) re.onclick = () => { closeModal(); change({ type: 'remove', id, everyWeek: true }); };
}

// Clicks inside the library list. Returns true when handled.
export function handleLibraryClick(e) {
  const add = e.target.closest('[data-add-to-schedule]');
  if (add) {
    const a = ctx.state.library.find((x) => x.id === add.dataset.addToSchedule);
    if (a) {
      showModal(t('Add {name} to the week', { name: esc(a.name) }), whenFields(days()[0], 'Morning') + repeatField(false), (fd) => {
        if (!fd.get('day')) change({ type: 'addLeftover', item: { ...a, fixed: false, id: uid(), activityId: a.id } });
        else scheduleFromLibrary(a.id, fd.get('day'), periodFor(fd), { everyWeek: fd.has('fixed'), time: readTime(fd) });
      }, { submitLabel: t('Add') });
      wireTime();
    }
    return true;
  }
  const split = e.target.closest('[data-split-library]');
  if (split) { openSplit({ activityId: split.dataset.splitLibrary }); return true; }
  const edit = e.target.closest('[data-edit-library]');
  if (edit) { activityForm(ctx.state.library.find((a) => a.id === edit.dataset.editLibrary)); return true; }
  const del = e.target.closest('[data-delete-library]');
  if (del) {
    const a = ctx.state.library.find((x) => x.id === del.dataset.deleteLibrary);
    if (a && confirm(t('Delete “{name}” from My activities? It stays in the days where it is already planned.', { name: a.name }))) {
      snapshotUndo();
      commit({ ...ctx.state, library: ctx.state.library.filter((x) => x.id !== a.id) });
      toast(t('Activity deleted from My activities.'), 8000, { label: t('Undo'), run: undo });
    }
    return true;
  }
  return false;
}

// Settings → Quiet times: one switch per activity (church, music lesson… by default).
export function renderQuietSettings() {
  const el = $('quietList');
  if (!el) return;
  el.innerHTML = ctx.state.library.filter((a) => a.energy !== 'rest').map((a) => `<label class="quiet-row"><input type="checkbox" data-quiet="${esc(a.id)}" ${a.quiet ? 'checked' : ''}><span>${shape(a.energy)} ${esc(a.name)}</span></label>`).join('');
}

export function toggleQuiet(id, on) {
  const state = clone(ctx.state);
  state.library = state.library.map((a) => (a.id === id ? { ...a, quiet: on } : a));
  // Activities already in the week follow the library unless they were changed one by one.
  DAYS.forEach((d) => PERIODS.forEach((p) => state.schedule[d][p].forEach((s) => { if (s.activityId === id) s.quiet = on; })));
  commit(state);
  const a = state.library.find((x) => x.id === id);
  toast(on ? t('{name}: quiet time. Sync the device to send it.', { name: a.name }) : t('{name}: reminders as usual.', { name: a.name }));
}
