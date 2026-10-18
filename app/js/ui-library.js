// Activity library: reusable activities, the "add activity" forms.
// Moved from the first-try planner; scheduling now goes through rules.js.
//
// Track: A - Interface

import { DAYS, PERIODS } from './config.js';
import { ctx, commit, change } from './context.js';
import { uid } from './store.js';
import { $, esc, shape, energyLabel, toast, showModal } from './ui-kit.js';

const clone = (x) => JSON.parse(JSON.stringify(x));

export function renderLibrary() {
  $('libraryList').innerHTML = ctx.state.library.map((a) => `<article class="library-item"><h4>${shape(a.energy)} ${esc(a.name)} ${a.fixed ? '<span class="fixed-lock">🔒 FIXED</span>' : ''}</h4><p>${energyLabel(a.energy)} energy · ${a.duration} min · ${a.reminder ? 'Reminder on' : 'No reminder'}</p><div class="row"><button class="primary small" data-add-to-schedule="${esc(a.id)}">Add to schedule</button><button class="small" data-edit-library="${esc(a.id)}">Edit</button>${a.fixed ? '' : `<button class="small danger" data-delete-library="${esc(a.id)}">Delete</button>`}</div></article>`).join('') || '<p>No activities yet. Create one to get started.</p>';
}

export function scheduleFromLibrary(activityId, day, period) {
  const a = ctx.state.library.find((x) => x.id === activityId);
  if (!a) return;
  change({ type: 'add', day, period, item: { ...a, id: uid(), activityId: a.id } });
}

export function activityForm(existing = null) {
  const a = existing || { name: '', energy: 'green', duration: 30, fixed: false, reminder: true };
  showModal(existing ? 'Edit activity' : 'Create activity', `
 <div class="field"><label for="actName">Activity name</label><input id="actName" name="name" required maxlength="60" value="${esc(a.name)}" placeholder="e.g. Water plants"></div>
 <div class="row" style="margin-top:12px"><div class="field"><label for="actEnergy">Energy level</label><select id="actEnergy" name="energy"><option value="green" ${a.energy === 'green' ? 'selected' : ''}>□ Easy</option><option value="yellow" ${a.energy === 'yellow' ? 'selected' : ''}>● Moderate</option><option value="red" ${a.energy === 'red' ? 'selected' : ''}>◇ High</option></select></div><div class="field"><label for="actDuration">Duration (minutes)</label><input id="actDuration" name="duration" type="number" min="5" max="600" step="5" value="${a.duration}"></div></div>
 <div class="setting-row"><label for="actReminder"><strong>Reminder enabled</strong></label><input id="actReminder" name="reminder" type="checkbox" ${a.reminder ? 'checked' : ''} style="width:22px;height:22px"></div>
 ${a.fixed ? '<p class="notice">This is a fixed routine and cannot be changed to movable.</p>' : '<div class="setting-row"><label for="actFixed"><strong>Make this a fixed routine</strong><p class="muted">Fixed activities cannot be moved or removed once scheduled.</p></label><input id="actFixed" name="fixed" type="checkbox" style="width:22px;height:22px"></div>'}`, (fd) => {
    const name = String(fd.get('name') || '').trim();
    if (!name) { toast('Please enter an activity name.'); return false; }
    const next = { ...(existing || {}), id: existing?.id || uid(), name, energy: fd.get('energy'), duration: Math.max(5, Number(fd.get('duration') || 30)), fixed: existing?.fixed || fd.has('fixed'), reminder: fd.has('reminder') };
    const state = clone(ctx.state);
    if (existing) {
      state.library = state.library.map((x) => (x.id === existing.id ? next : x));
      DAYS.forEach((d) => PERIODS.forEach((p) => state.schedule[d][p].forEach((s) => {
        if (s.activityId === existing.id) { s.name = next.name; s.energy = next.energy; s.duration = next.duration; s.reminder = next.reminder; }
      })));
    } else state.library.push(next);
    commit(state);
    toast(existing ? 'Activity updated.' : 'Activity added to library.');
  });
}

export function createAndScheduleActivity(day = 'Monday', period = 'Morning') {
  showModal('Add a new activity to your week', `<p class="muted">Create it here and it will be added to your activity library for reuse.</p><div class="field"><label for="newActName">Activity name</label><input id="newActName" name="name" required maxlength="60" placeholder="e.g. Water the plants"></div><div class="row" style="margin-top:12px"><div class="field"><label for="newActDay">Day</label><select id="newActDay" name="day">${DAYS.map((d) => `<option ${d === day ? 'selected' : ''}>${d}</option>`).join('')}</select></div><div class="field"><label for="newActPeriod">Time of day</label><select id="newActPeriod" name="period">${PERIODS.map((p) => `<option ${p === period ? 'selected' : ''}>${p}</option>`).join('')}</select></div></div><div class="row" style="margin-top:12px"><div class="field"><label for="newActEnergy">Energy level</label><select id="newActEnergy" name="energy"><option value="green">□ Easy</option><option value="yellow">○ Moderate</option><option value="red">◇ High</option></select></div><div class="field"><label for="newActDuration">Duration (minutes)</label><input id="newActDuration" name="duration" type="number" min="5" max="600" step="5" value="30"></div></div><div class="setting-row"><label for="newActReminder"><strong>Reminder enabled</strong></label><input id="newActReminder" name="reminder" type="checkbox" checked style="width:22px;height:22px"></div>`, (fd) => {
    const name = String(fd.get('name') || '').trim();
    if (!name) { toast('Please enter an activity name.'); return false; }
    const activity = { id: uid(), name, energy: fd.get('energy'), duration: Math.max(5, Number(fd.get('duration') || 30)), fixed: false, reminder: fd.has('reminder') };
    change({ type: 'add', day: fd.get('day'), period: fd.get('period'), libraryItem: activity, item: { ...activity, id: uid(), activityId: activity.id } });
  });
}

export function openQuickAdd(day, period) {
  showModal(`Add to ${day} · ${period}`, `<div class="field"><label for="quickActivity">Choose an activity</label><select name="activityId" id="quickActivity" required>${ctx.state.library.map((a) => `<option value="${a.id}">${esc(a.name)} — ${energyLabel(a.energy)}${a.fixed ? ' (fixed)' : ''}</option>`).join('')}</select></div>`, (fd) => { scheduleFromLibrary(fd.get('activityId'), day, period); });
}

// Clicks inside the library list. Returns true when handled.
export function handleLibraryClick(e) {
  const add = e.target.closest('[data-add-to-schedule]');
  if (add) {
    const a = ctx.state.library.find((x) => x.id === add.dataset.addToSchedule);
    if (a) showModal(`Add ${esc(a.name)} to your week`, `<div class="field"><label for="libAddDay">Day</label><select name="day" id="libAddDay">${DAYS.map((d) => `<option>${d}</option>`).join('')}</select></div><div class="field" style="margin-top:12px"><label for="libAddPeriod">Time of day</label><select name="period" id="libAddPeriod">${PERIODS.map((p) => `<option>${p}</option>`).join('')}</select></div>`, (fd) => scheduleFromLibrary(a.id, fd.get('day'), fd.get('period')));
    return true;
  }
  const edit = e.target.closest('[data-edit-library]');
  if (edit) { activityForm(ctx.state.library.find((a) => a.id === edit.dataset.editLibrary)); return true; }
  const del = e.target.closest('[data-delete-library]');
  if (del) {
    const a = ctx.state.library.find((x) => x.id === del.dataset.deleteLibrary);
    if (a && confirm(`Delete "${a.name}" from your activity library? Scheduled copies remain.`)) {
      commit({ ...ctx.state, library: ctx.state.library.filter((x) => x.id !== a.id) });
      toast('Activity deleted from library.');
    }
    return true;
  }
  return false;
}
