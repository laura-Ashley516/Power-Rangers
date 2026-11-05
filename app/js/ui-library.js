// "My activities": the client's reusable activities, and every form that adds or edits one.
// Each activity can carry a short checklist of steps (shown on Today) and a note.
//
// Track: A - Interface

import { DAYS, PERIODS } from './config.js';
import { ctx, commit, change } from './context.js';
import { uid, isAppointment } from './store.js';
import { openAppointmentCard } from './ui-appointment.js';
import { $, esc, shape, energyLabel, toast, showModal, closeModal, energyPicker, orderedDays } from './ui-kit.js';
import { placeInto } from './ui-week.js';

const clone = (x) => JSON.parse(JSON.stringify(x));
const days = () => orderedDays(ctx.state.settings.weekStart);

export function renderLibrary() {
  // Every week or not is set on the week's cards (tap a card); an activity used by a weekly one cannot be deleted.
  const weekly = new Set(Object.values(ctx.state.series || {}).map((x) => x.item.activityId));
  $('libraryList').innerHTML = ctx.state.library.map((a) => `<article class="library-item ${esc(a.energy)}"><span class="chip e-${esc(a.energy)}">${shape(a.energy)} ${energyLabel(a.energy)}</span><h4>${esc(a.name)}</h4><p>${a.duration ? `${a.duration} min` : ''}${weekly.has(a.id) ? ' · in your week every week' : ''}${a.steps?.length ? ` · ${a.steps.length} steps` : ''}${a.note ? `<br>${esc(a.note)}` : ''}</p><div class="row"><button class="small" data-add-to-schedule="${esc(a.id)}">Add to the week</button><button class="small" data-edit-library="${esc(a.id)}">Edit</button>${weekly.has(a.id) ? '' : `<button class="small danger" data-delete-library="${esc(a.id)}">Delete</button>`}</div></article>`).join('') || '<p>No activities yet. Create one to get started.</p>';
}

export function scheduleFromLibrary(activityId, day, period, opts) { placeInto('library', activityId, day, period, opts); }

const whenFields = (day, period) => `<div class="row" style="margin-top:12px"><div class="field"><label for="fDay">Day</label><select id="fDay" name="day">${days().map((d) => `<option ${d === day ? 'selected' : ''}>${d}</option>`).join('')}<option value="">Later this week</option></select></div><div class="field"><label for="fPeriod">Time of day</label><select id="fPeriod" name="period">${PERIODS.map((p) => `<option ${p === period ? 'selected' : ''}>${p}</option>`).join('')}</select></div></div>`;

// "Repeat every week": offered when she puts an activity in a day (new activity, quick add); tapping a card changes it later.
const repeatField = (on) => `<div class="setting-row" style="margin-top:12px"><label for="fFixed"><strong>Repeat every week</strong><p class="muted">It comes back to the same place every week. You can still move it for one week.</p></label><input id="fFixed" name="fixed" type="checkbox" ${on ? 'checked' : ''} style="width:24px;height:24px"></div>`;

const detailFields = (a) => `<div class="row" style="margin-top:12px"><div class="field"><label for="fDuration">About how long (minutes)</label><input id="fDuration" name="duration" type="number" min="5" max="600" step="5" value="${a.duration || 30}"></div></div>
  <div class="field" style="margin-top:12px"><label for="fSteps">Steps to remember (optional, one per line)</label><textarea id="fSteps" name="steps" placeholder="e.g. Health card&#10;List of questions">${esc((a.steps || []).join('\n'))}</textarea><span class="hint">Shown as a checklist on the Today screen.</span></div>
  <div class="field" style="margin-top:12px"><label for="fNote">Note (optional)</label><input id="fNote" name="note" maxlength="120" value="${esc(a.note || '')}"></div>
  <div class="setting-row"><label for="fReminder"><strong>Reminder on the device</strong></label><input id="fReminder" name="reminder" type="checkbox" ${a.reminder !== false ? 'checked' : ''} style="width:24px;height:24px"></div>
  <div class="setting-row"><label for="fAppointment"><strong>Appointment</strong><p class="muted">Adds an appointment card: questions to ask and what to bring.</p></label><input id="fAppointment" name="appointment" type="checkbox" ${a.appointment ? 'checked' : ''} style="width:24px;height:24px"></div>
  <div class="setting-row"><label for="fQuiet"><strong>Quiet time</strong><p class="muted">The device does not vibrate or beep during it; reminders wait until after.</p></label><input id="fQuiet" name="quiet" type="checkbox" ${a.quiet ? 'checked' : ''} style="width:24px;height:24px"></div>`;

const readDetails = (fd) => ({
  duration: Math.max(5, Number(fd.get('duration') || 30)),
  steps: String(fd.get('steps') || '').split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 8),
  note: String(fd.get('note') || '').trim(),
  reminder: fd.has('reminder'),
  appointment: fd.has('appointment'),
  quiet: fd.has('quiet'),
});

export function activityForm(existing = null) {
  const a = existing || { name: '', energy: 'green', duration: 30, fixed: false, reminder: true, steps: [] };
  showModal(existing ? 'Edit activity' : 'New activity', `
    <div class="field"><label for="fName">Name</label><input id="fName" name="name" required maxlength="60" value="${esc(a.name)}" placeholder="e.g. Medical appointment"></div>
    <div style="margin-top:12px">${energyPicker('energy', a.energy)}</div>
    ${detailFields(a)}`, (fd) => {
    const name = String(fd.get('name') || '').trim();
    if (!name) { toast('Please write a name.'); return false; }
    const next = { ...(existing || {}), id: existing?.id || uid(), name, energy: fd.get('energy') || 'green', ...readDetails(fd) };
    const state = clone(ctx.state);
    if (existing) {
      state.library = state.library.map((x) => (x.id === existing.id ? next : x));
      // Copies follow the change (their own part names stay): this week, the weeks planned ahead, the weekly ones.
      const follow = (s) => {
        if (s.activityId !== existing.id) return;
        if (s.name === existing.name) s.name = next.name;
        Object.assign(s, { energy: next.energy, duration: next.duration, reminder: next.reminder, steps: next.steps, note: next.note, appointment: next.appointment, quiet: next.quiet });
      };
      const later = Object.keys(state.weeks || {}).filter((k) => k > (state.shownWeek || ''));
      [state.schedule, ...later.map((k) => state.weeks[k])].forEach((w) => DAYS.forEach((d) => PERIODS.forEach((p) => w[d][p].forEach(follow))));
      Object.values(state.series || {}).forEach((x) => follow(x.item));
    } else state.library.push(next);
    commit(state);
    toast(existing ? 'Activity updated.' : 'Activity added to My activities. Drag it onto a day.');
  });
}

// "New activity" from the week: create it and put it in a day (or in Later this week) in one step.
export function createAndScheduleActivity(day = days()[0], period = 'Morning') {
  showModal('New activity', `
    <div class="field"><label for="fName">Name</label><input id="fName" name="name" required maxlength="60" placeholder="e.g. Water the plants"></div>
    <div style="margin-top:12px">${energyPicker('energy', 'green')}</div>
    ${whenFields(day, period)}
    ${repeatField(false)}
    <details style="margin-top:10px"><summary style="cursor:pointer;font-weight:700;padding:6px 0">More (time, steps, note)</summary>${detailFields({ reminder: true })}</details>`, (fd) => {
    const name = String(fd.get('name') || '').trim();
    if (!name) { toast('Please write a name.'); return false; }
    if (fd.has('fixed') && !fd.get('day')) { toast('Choose a day for an activity that repeats every week.'); return false; }
    // It also goes in "My activities", so she can drag it into another day later.
    const activity = { id: uid(), name, energy: fd.get('energy') || 'green', fixed: false, ...readDetails(fd) };
    const item = { ...activity, id: uid(), activityId: activity.id };
    if (!fd.get('day')) {
      commit({ ...ctx.state, library: [...ctx.state.library, activity] });
      change({ type: 'addLeftover', item });
    } else change({ type: 'add', day: fd.get('day'), period: fd.get('period'), libraryItem: activity, item, everyWeek: fd.has('fixed') });
  }, { submitLabel: 'Add' });
}

// Tap on an empty part of a block: pick one of her activities for it (2 taps).
export function openQuickAdd(day, period) {
  showModal(`Add to ${day} · ${period}`, `<div class="field"><label for="quickActivity">Choose an activity</label><select name="activityId" id="quickActivity" required size="8" style="min-height:280px">${ctx.state.library.map((a, i) => `<option value="${a.id}" ${i === 0 ? 'selected' : ''}>${shape(a.energy)} ${esc(a.name)} — ${energyLabel(a.energy)}</option>`).join('')}</select></div>${repeatField(false)}<p class="muted" style="margin-top:8px;font-size:.85em">Not in the list? <button type="button" class="small" id="quickNew">＋ New activity</button></p>`, (fd) => { scheduleFromLibrary(fd.get('activityId'), day, period, { everyWeek: fd.has('fixed') }); }, { submitLabel: 'Add' });
  $('quickNew').onclick = () => createAndScheduleActivity(day, period);
}

// Tap on a card in the week: change it (the tap alternative to dragging). Client feedback, Nov 4 2026:
// say clearly if it comes every week, change its colour (energy), and make "this week only" or "every week"
// clear when moving or removing a weekly one. Everything is done in one Save, with one Undo.
export function openCardMenu(id) {
  const where = (() => { for (const d of DAYS) for (const p of PERIODS) { const a = ctx.state.schedule[d][p].find((x) => x.id === id); if (a) return { a, d, p }; } return null; })();
  if (!where) return;
  const { a, d, p } = where;
  const usual = a.seriesId ? ctx.state.series?.[a.seriesId] : null;
  const weekly = !!usual;
  const on = (x) => `${x.day} ${x.period.toLowerCase()}`;
  showModal(`${shape(a.energy)} ${esc(a.name)}`, `<p class="muted">${d} · ${p}${weekly && (usual.day !== d || usual.period !== p) ? ` · this week only (usually ${on(usual)})` : ''}</p>${a.steps?.length ? `<p style="margin-top:6px">Steps: ${a.steps.map(esc).join(' · ')}</p>` : ''}
    ${isAppointment(a, ctx.state.library) ? `<button type="button" class="primary" id="openApCard" style="margin:10px 0 4px">Appointment card: questions and what to bring</button>` : ''}
    <div class="setting-row"><label for="fWeekly"><strong>Every week</strong><p class="muted">${weekly ? `On: it comes back every week on ${on(usual)}. Untick to keep it only this week.` : 'Off: only this week. Tick to repeat it every week in this place.'}</p></label><input id="fWeekly" name="weekly" type="checkbox" ${weekly ? 'checked' : ''} style="width:24px;height:24px"></div>
    <div style="margin-top:12px">${energyPicker('energy', a.energy, 'Energy and colour')}</div>
    ${whenFields(d, p)}
    ${weekly ? `<fieldset class="field scope-options"><legend>A new day, time or colour is for</legend><label><input type="radio" name="scope" value="week" checked><span>This week only</span></label><label><input type="radio" name="scope" value="every"><span>Every week from now on</span></label></fieldset>` : ''}
    <div class="row" style="margin-top:16px">${weekly
      ? '<button type="button" id="removeWeek">Remove this week only</button><button type="button" class="danger" id="removeEvery">Remove every week</button>'
      : '<button type="button" class="danger" id="removeCard">Remove from the week</button>'}</div>`, (fd) => {
    const keepWeekly = fd.has('weekly');
    const every = weekly && keepWeekly && fd.get('scope') === 'every';
    const toDay = fd.get('day'), toPeriod = fd.get('period'), energy = fd.get('energy');
    const changes = [];
    if (weekly && !keepWeekly) changes.push({ type: 'setWeekly', id, on: false });
    if (!toDay) changes.push({ type: 'park', id });
    else if (toDay !== d || toPeriod !== p) changes.push({ type: 'move', id, toDay, toPeriod, everyWeek: every });
    // Moved here this week only, and now "every week": this becomes its usual place.
    else if (every && (usual.day !== d || usual.period !== p)) changes.push({ type: 'move', id, toDay: d, toPeriod: p, everyWeek: true });
    if (energy && energy !== a.energy) changes.push({ type: 'update', id, fields: { energy }, everyWeek: every });
    if (!weekly && keepWeekly && toDay) changes.push({ type: 'setWeekly', id, on: true });
    if (!weekly && keepWeekly && !toDay) { toast('Choose a day for an activity that comes every week.'); return false; }
    if (changes.length) change(changes.length === 1 ? changes[0] : { type: 'batch', changes });
  }, { submitLabel: 'Save' });
  const ap = $('openApCard');
  if (ap) ap.onclick = () => { closeModal(); openAppointmentCard(id); };
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
    if (a) showModal(`Add ${esc(a.name)} to the week`, whenFields(days()[0], 'Morning') + repeatField(false), (fd) => {
      if (!fd.get('day')) change({ type: 'addLeftover', item: { ...a, fixed: false, id: uid(), activityId: a.id } });
      else scheduleFromLibrary(a.id, fd.get('day'), fd.get('period'), { everyWeek: fd.has('fixed') });
    }, { submitLabel: 'Add' });
    return true;
  }
  const edit = e.target.closest('[data-edit-library]');
  if (edit) { activityForm(ctx.state.library.find((a) => a.id === edit.dataset.editLibrary)); return true; }
  const del = e.target.closest('[data-delete-library]');
  if (del) {
    const a = ctx.state.library.find((x) => x.id === del.dataset.deleteLibrary);
    if (a && confirm(`Delete "${a.name}" from My activities? It stays in the days where it is already planned.`)) {
      commit({ ...ctx.state, library: ctx.state.library.filter((x) => x.id !== a.id) });
      toast('Activity deleted from My activities.');
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
  toast(on ? `${a.name}: quiet time. Sync the device to send it.` : `${a.name}: reminders as usual.`);
}
