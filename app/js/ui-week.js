// Weekly board: Monday-Sunday x Morning/Afternoon/Evening, week navigation,
// load alerts (from rules.js), "Use last week".
// Moved from the first-try planner; alerts now use the client's balance rules.
//
// Track: A - Interface

import { DAYS, PERIODS } from './config.js';
import { ctx, commit, change } from './context.js';
import { checkDay } from './rules.js';
import { uid } from './store.js';
import { $, esc, shape, toast } from './ui-kit.js';

export function slotId(day, period) { return `slot-${day}-${period}`; }

export function weekStart(offset = ctx.weekOffset) {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekday = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - weekday + offset * 7);
  return d;
}
export function formatShortDate(d) { return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); }
export function dateForDay(day) { const start = weekStart(); start.setDate(start.getDate() + DAYS.indexOf(day)); return start; }
export function formatLongDate(d) { return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }); }

export function renderCard(a, day, period, index, library = false) {
  const isNew = a.voiceNew ? '<span class="new-mark" title="Added from a voice note">new</span>' : '';
  return `<div class="activity-card ${a.energy}${a.voiceNew ? ' voice-new' : ''}" tabindex="0" role="group" aria-label="${esc(a.name)}${a.fixed ? ', fixed routine' : ''}${a.voiceNew ? ', added from a voice note' : ''}; ${a.duration || 30} minutes" draggable="${!a.fixed && !library}" data-card-type="${library ? 'library' : 'scheduled'}" data-id="${esc(a.id)}" ${library ? '' : 'data-day="' + day + '" data-period="' + period + '" data-index="' + index + '"'}><div class="activity-text"><div class="activity-name">${shape(a.energy)} ${esc(a.name)} ${isNew}</div><div class="activity-meta">${a.duration || 30} min ${a.fixed ? '<span class="fixed-lock"> · 🔒 FIXED</span>' : ''}</div></div>${library ? '' : `<div class="activity-controls"><button class="small" data-action="remove" title="Remove activity" aria-label="Remove ${esc(a.name)}" ${a.fixed ? 'disabled' : ''}>×</button></div>`}</div>`;
}

export function renderWeek() {
  const { state } = ctx;
  const grid = $('weekGrid');
  grid.innerHTML = '';
  const monday = weekStart();
  const sunday = new Date(monday);
  sunday.setDate(sunday.getDate() + 6);
  $('weekRangeLabel').textContent = `${formatShortDate(monday)} – ${formatShortDate(sunday)}${ctx.weekOffset === 0 ? ' · This week' : ''}`;
  DAYS.forEach((day, dayIndex) => {
    const date = new Date(monday);
    date.setDate(monday.getDate() + dayIndex);
    const check = checkDay(state.schedule, day);
    const col = document.createElement('div');
    col.className = 'day-col' + (check.over ? ' day-over' : '');
    const loadText = check.load ? `${fmt(check.load)} of ${fmt(check.limit)} energy` : 'Free day';
    col.innerHTML = `<div class="day-title"><span>${day}</span><span class="day-date"><b>${date.getDate()}</b><small>${date.toLocaleDateString(undefined, { month: 'short' })}</small></span></div><div class="day-load">${loadText}</div>`;
    PERIODS.forEach((period) => {
      const list = state.schedule[day][period] || [];
      const slot = document.createElement('div');
      slot.className = 'slot';
      slot.id = slotId(day, period);
      slot.dataset.day = day;
      slot.dataset.period = period;
      slot.setAttribute('aria-label', `${day} ${period} drop zone`);
      slot.innerHTML = `<div class="slot-label">${period}</div>${list.length ? list.map((a, i) => renderCard(a, day, period, i)).join('') : '<div class="slot-hint">No activities yet</div>'}`;
      col.appendChild(slot);
    });
    grid.appendChild(col);
  });
  renderAlerts();
}
const fmt = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

export function renderAlerts() {
  const root = $('overloadAlerts');
  root.innerHTML = '';
  if (!ctx.state.settings.alerts) return;
  DAYS.forEach((day) => {
    const { warnings, tips } = checkDay(ctx.state.schedule, day);
    const messages = [...warnings, ...tips];
    if (!messages.length || sessionStorage.getItem('dismiss-' + day)) return;
    const box = document.createElement('div');
    box.className = 'alert';
    box.innerHTML = `<span aria-hidden="true">ⓘ</span><p><strong>${day} may be a lot.</strong> ${esc(messages[0])} You could move one activity to a quieter day if that would help.</p>${warnings.length ? `<button data-alert-move="${day}">Suggest a move</button>` : ''}<button data-alert-dismiss="${day}" aria-label="Dismiss ${day} schedule message">Dismiss</button>`;
    root.appendChild(box);
  });
}

export function changeWeek(next) {
  ctx.weekSchedules[ctx.weekOffset] = JSON.parse(JSON.stringify(ctx.state.schedule));
  ctx.weekOffset = next;
  if (!ctx.weekSchedules[ctx.weekOffset]) {
    const copy = JSON.parse(JSON.stringify(ctx.state.schedule));
    DAYS.forEach((day) => PERIODS.forEach((period) => copy[day][period].forEach((a) => (a.id = uid()))));
    ctx.weekSchedules[ctx.weekOffset] = copy;
  }
  ctx.selectedActivity = null;
  commit({ ...ctx.state, schedule: JSON.parse(JSON.stringify(ctx.weekSchedules[ctx.weekOffset])) });
  const w = ctx.weekOffset;
  toast(w === 0 ? 'Showing this week.' : w < 0 ? `${Math.abs(w)} week${w < -1 ? 's' : ''} ago` : `${w} week${w > 1 ? 's' : ''} ahead`);
}

// Offer to move one movable activity from a busy day to the lightest day.
export function suggestMove(day) {
  const { schedule } = ctx.state;
  let candidate = null;
  for (const p of PERIODS) {
    const a = schedule[day][p].find((x) => !x.fixed && x.energy === 'red') || schedule[day][p].find((x) => !x.fixed && x.energy === 'yellow');
    if (a) { candidate = { a, p }; break; }
  }
  if (!candidate) { toast('No movable activity found on this day.'); return; }
  const target = DAYS.filter((d) => d !== day).sort((x, y) => checkDay(schedule, x).load - checkDay(schedule, y).load)[0];
  if (target && confirm(`Move "${candidate.a.name}" from ${day} ${candidate.p} to ${target} ${candidate.p}?`)) {
    change({ type: 'move', id: candidate.a.id, toDay: target, toPeriod: candidate.p });
  }
}

export function repeatLastWeek() {
  if (!confirm('Copy this week as a starting point for next week? This replaces the current board with a copy of the current schedule.')) return;
  const clone = JSON.parse(JSON.stringify(ctx.state.schedule));
  DAYS.forEach((d) => PERIODS.forEach((p) => clone[d][p].forEach((a) => { a.id = uid(); delete a.voiceNew; })));
  commit({ ...ctx.state, previous: JSON.parse(JSON.stringify(ctx.state.schedule)), schedule: clone });
  toast('Schedule copied. Edit it as needed.');
}
