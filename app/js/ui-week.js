// Week board: the client's 7 days x Morning / Afternoon / Evening, her activities to drag in
// ("My activities"), the "Later this week" tray, energy bars, neutral energy messages,
// "Suggest a lighter week", "Split a task over days", "Copy this week".
//
// Track: A - Interface

import { DAYS, PERIODS, ENERGY } from './config.js';
import { ctx, commit, change } from './context.js';
import { checkDay, suggestBalance, splitChanges, daySignature, resetWeekly } from './rules.js';
import { uid } from './store.js';
import { $, esc, shape, energyLabel, toast, showModal, showPanelModal, closeModal, orderedDays, dateKey, energyPicker, WEEKLY, CARD_ICON, QUIET_ICON } from './ui-kit.js';
import { isAppointment, isQuiet } from './store.js';
import { printWeek } from './print.js';

export function slotId(day, period) { return `slot-${day}-${period}`; }

const svg = (body) => `<svg class="icon period-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const PERIOD_ICON = {
  Morning: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.5M12 19v2.5M4.6 4.6l1.8 1.8M17.6 17.6l1.8 1.8M2.5 12H5M19 12h2.5M4.6 19.4l1.8-1.8M17.6 6.4l1.8-1.8"/>'),
  Afternoon: svg('<path d="M3 17h18"/><path d="M7 17a5 5 0 0 1 10 0"/><path d="M12 6.5V9M5.6 10.6l1.6 1.6M18.4 10.6l-1.6 1.6"/>'),
  Evening: svg('<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>'),
};
const days = () => orderedDays(ctx.state.settings.weekStart);

// First day (Sunday or Monday) of the week shown, `offset` weeks from this week.
export function weekStart(offset = ctx.weekOffset) {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const first = DAYS.indexOf(days()[0]);           // 0 = Monday … 6 = Sunday
  const weekday = (d.getDay() + 6) % 7;            // 0 = Monday … 6 = Sunday
  d.setDate(d.getDate() - ((weekday - first + 7) % 7) + offset * 7);
  return d;
}
export function formatShortDate(d) { return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); }
export function dateForDay(day) { const start = weekStart(); start.setDate(start.getDate() + days().indexOf(day)); return start; }
export function formatLongDate(d) { return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }); }
const fmt = (n) => (Number.isInteger(n) ? String(n) : n === Math.floor(n) + 0.5 ? `${Math.floor(n)}½` : n.toFixed(1));

// Energy bar: "4½ of 5½" (no percentages: the client finds numbers like that hard).
export function budgetHtml(check, { label = true } = {}) {
  const ratio = Math.min(1, check.load / check.limit);
  const cls = check.over ? 'over' : ratio > 0.8 ? 'mid' : '';
  const text = check.load ? `${fmt(check.load)} of ${fmt(check.limit)}` : 'Free';
  return `<div class="budget ${cls}" title="Energy used: ${text}"><div class="budget-bar" aria-hidden="true"><div class="budget-fill" style="width:${Math.round(ratio * 100)}%"></div></div>${label ? `<span>${text}</span>` : ''}</div>`;
}

// One activity card. kind: 'scheduled' (in a day), 'library' (a tile to drag in), 'leftover' (Later this week).
export function renderCard(a, day, period, index, kind = 'scheduled') {
  const energy = ENERGY[a.energy] ? a.energy : 'green';
  const lock = a.fixed && kind !== 'library';
  const draggable = ['library', 'leftover', 'scheduled'].includes(kind); // weekly activities too (moved for this week only)
  const isNew = a.voiceNew ? '<span class="new-mark" title="Added from a voice note">new</span>' : '';
  const label = `${a.name}, ${energyLabel(energy)}${lock ? ', every week' : ''}${lock && a.home ? `, moved this week (usually ${a.home.day} ${a.home.period.toLowerCase()})` : ''}${a.voiceNew ? ', added from a voice note' : ''}`;
  const meta = [a.duration ? `<span class="dur">${a.duration} min</span>` : '', a.steps?.length && kind !== 'library' ? `<span class="dur">☑ ${a.steps.length} steps</span>` : ''].filter(Boolean).join(' ');
  const controls = kind === 'leftover' ? `<div class="activity-controls"><button class="small" data-action="drop-leftover" title="Remove" aria-label="Remove ${esc(a.name)} from later">×</button></div>` : '';
  const pos = kind === 'scheduled' ? `data-day="${day}" data-period="${period}" data-index="${index}"` : '';
  return `<div class="activity-card ${energy}${lock ? ' fixed' : ''}${a.voiceNew ? ' voice-new' : ''}${ctx.placing?.id === a.id ? ' selected' : ''}" tabindex="0" role="button" aria-label="${esc(label)}" draggable="${draggable}" data-card-type="${kind}" data-id="${esc(a.id)}" ${pos}><div class="activity-text"><div class="activity-name"><span class="activity-shape" aria-hidden="true">${shape(energy)}</span> ${esc(a.name)}${lock ? ` <span class="fixed-lock" title="Every week">${WEEKLY}</span>` : ''}${kind !== 'library' && isAppointment(a, ctx.state.library) && (a.questions?.length || a.afterNote) ? ` <span class="fixed-lock" title="Appointment card ready">${CARD_ICON}</span>` : ''}${kind !== 'library' && isQuiet(a, ctx.state.library) ? ` <span class="fixed-lock" title="Quiet time: the device stays silent">${QUIET_ICON}</span>` : ''} ${isNew}</div>${meta ? `<div class="activity-meta">${meta}</div>` : ''}${lock && a.home ? '<div class="moved-note">This week only</div>' : ''}</div>${controls}</div>`;
}

// The calendar is a grid, like her paper calendar: one column per day with a clear line between days,
// and Morning / Afternoon / Evening as rows that line up across the whole week.
export function renderWeek() {
  const { state } = ctx;
  const grid = $('weekGrid');
  const first = weekStart();
  const last = new Date(first);
  last.setDate(last.getDate() + 6);
  $('weekRangeLabel').textContent = `${formatShortDate(first)} – ${first.getMonth() === last.getMonth() ? last.getDate() : formatShortDate(last)}`;
  const todayKey = dateKey(new Date());
  const cols = days().map((day, i) => {
    const date = new Date(first);
    date.setDate(first.getDate() + i);
    const key = dateKey(date);
    return { day, date, key, check: checkDay(state.schedule, day), isToday: key === todayKey, isPast: key < todayKey };
  });
  // Header row: an empty corner over the period column, then one header per day (big date, like a wall calendar).
  const head = '<div class="cal-corner" aria-hidden="true"></div>' + cols.map((c, i) => {
    return `<div class="cal-head${c.isToday ? ' today' : ''}${c.check.over ? ' over' : ''}${i === 6 ? ' col-last' : ''}" role="columnheader"><div class="day-title"><span class="day-name">${c.day}</span><span class="day-num">${c.date.getDate()}</span><span class="day-date">${c.isToday ? '<b class="today-word">Today</b>' : c.date.toLocaleDateString(undefined, { month: 'short' })}</span></div>${budgetHtml(c.check)}</div>`;
  }).join('');
  // One row per time of day: the label on the left, then one box per day.
  const rows = PERIODS.map((period, pi) => `<div class="cal-period${pi === PERIODS.length - 1 ? ' row-last' : ''}" role="rowheader">${PERIOD_ICON[period]}<span>${period}</span></div>` + cols.map((c, i) => {
    const list = state.schedule[c.day][period] || [];
    return `<div class="slot${c.isToday ? ' today' : ''}${i === 6 ? ' col-last' : ''}${pi === PERIODS.length - 1 ? ' row-last' : ''}" id="${slotId(c.day, period)}" data-day="${c.day}" data-period="${period}" role="gridcell" aria-label="${c.day} ${period}: ${list.length} activities. Drop here.">${list.map((a, idx) => renderCard(a, c.day, period, idx, 'scheduled') + (a.energy === 'red' && c.check.restNeeded ? '<div class="rest-hint">then 30 min rest</div>' : '')).join('')}</div>`;
  }).join('')).join('');
  grid.className = 'cal';
  grid.setAttribute('role', 'grid');
  grid.innerHTML = head + rows;
  renderPalette();
  renderTray();
  renderAlerts();
  renderPlaceHint();
}

// ---------- My activities (drag in) ----------

// One row of tiles, always visible above the calendar: fixed routines first, then easy → high, then rest.
function renderPalette() {
  const order = { green: 1, yellow: 2, red: 3, rest: 4 };
  const lib = [...ctx.state.library].sort((x, y) => (y.fixed - x.fixed) || ((order[x.energy] || 9) - (order[y.energy] || 9)));
  $('paletteTiles').innerHTML = lib.map((a) => renderCard(a, null, null, 0, 'library')).join('');
}

function renderTray() {
  const list = ctx.state.leftovers || [];
  $('leftoverTray').innerHTML = list.length ? list.map((a) => renderCard(a, null, null, 0, 'leftover')).join('') : '<div class="slot-hint">Nothing waiting. Drag a day’s activity here to keep it for later.</div>';
}

export function renderPlaceHint() {
  const el = $('placeHint');
  document.body.classList.toggle('placing', !!ctx.placing);
  if (!ctx.placing) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  el.innerHTML = `<span>Now tap a day and time for <b>${esc(ctx.placing.name)}</b>.</span><button type="button" data-cancel-place>Cancel</button>`;
}

export function startPlacing(kind, id) {
  const src = kind === 'library' ? ctx.state.library : ctx.state.leftovers;
  const a = src.find((x) => x.id === id);
  if (!a) return;
  ctx.placing = ctx.placing?.id === id ? null : { kind, id, name: a.name };
  renderWeek();
}
export function cancelPlacing() { ctx.placing = null; renderWeek(); }

// Put a library activity or a leftover into a day (drag & drop, or tap-to-place).
export function placeInto(kind, id, day, period) {
  if (kind === 'leftover') return change({ type: 'place', id, toDay: day, toPeriod: period });
  const a = ctx.state.library.find((x) => x.id === id);
  if (!a) return null;
  return change({ type: 'add', day, period, item: { ...a, id: uid(), activityId: a.id, steps: [...(a.steps || [])] } });
}

// ---------- energy messages ----------

// One calm box for the whole week (not one per day): days over the client's rules first,
// then simple tips. Hidden for this session with "Hide".
// "Keep as it is": for a day she cannot change (a friend visiting today), the note and the suggestions
// leave that day alone until something on it changes.
const keptDays = () => days().filter((d) => ctx.state.kept?.[d] && ctx.state.kept[d] === daySignature(ctx.state.schedule, d));

export function keepDay(day) {
  commit({ ...ctx.state, kept: { ...(ctx.state.kept || {}), [day]: daySignature(ctx.state.schedule, day) } });
  toast(`${day} stays as it is.`);
}

export function renderAlerts() {
  const root = $('overloadAlerts');
  root.innerHTML = '';
  if (!ctx.state.settings.alerts || sessionStorage.getItem('dismiss-alerts')) return;
  const over = [], tips = [];
  const kept = keptDays();
  days().forEach((day) => {
    if (kept.includes(day)) return;
    const c = checkDay(ctx.state.schedule, day);
    if (c.warnings.length) over.push(`<b>${day}</b>: ${esc(c.warnings[0].replace(/\.$/, ''))} (${fmt(c.load)} of ${fmt(c.limit)}). <button type="button" class="small keep-day" data-keep-day="${day}">Keep as it is</button>`);
    else if (c.tips.length) tips.push(`<b>${day}</b>: ${esc(c.tips[0])}`);
  });
  if (!over.length && !tips.length) return;
  const lines = [...over, ...tips].map((l) => `<div>${l}</div>`).join('');
  root.innerHTML = `<div class="alert${over.length ? '' : ' info'}"><div><strong>${over.length ? 'More than your energy rules' : 'A note on this week'}</strong>${lines}</div>${over.length ? '<button data-open-balance>Suggest moves</button>' : ''}<button data-alert-dismiss="alerts">Hide</button></div>`;
}

export function changeWeek(next) {
  ctx.weekSchedules[ctx.weekOffset] = JSON.parse(JSON.stringify(ctx.state.schedule));
  ctx.weekOffset = next;
  if (!ctx.weekSchedules[ctx.weekOffset]) {
    // A week you have not opened yet starts from this one, with weekly activities back in their usual place.
    const copy = resetWeekly(ctx.state.schedule, ctx.state.skipped);
    DAYS.forEach((day) => PERIODS.forEach((period) => copy[day][period].forEach((a) => { a.id = uid(); delete a.voiceNew; })));
    ctx.weekSchedules[ctx.weekOffset] = copy;
  }
  ctx.selectedActivity = null;
  commit({ ...ctx.state, schedule: JSON.parse(JSON.stringify(ctx.weekSchedules[ctx.weekOffset])) });
  const w = ctx.weekOffset;
  toast(w === 0 ? 'Showing this week.' : w < 0 ? `${Math.abs(w)} week${w < -1 ? 's' : ''} ago` : `${w} week${w > 1 ? 's' : ''} ahead`);
}

const applyProposal = (p) => (p.toDay ? change({ type: 'move', id: p.id, toDay: p.toDay, toPeriod: p.toPeriod }) : change({ type: 'park', id: p.id }));

// "Suggest a lighter week": every proposal is shown and can be unticked; nothing changes until "Apply".
export function openBalance() {
  const proposals = suggestBalance(ctx.state.schedule, { keep: keptDays() });
  if (!proposals.length) { toast('Every day is within your energy rules. Nothing to change.'); return; }
  const modal = showPanelModal('Suggest a lighter week', `<p class="muted">These moves keep every day within your rules. Weekly activities are not moved. Untick any you want to keep. If a day cannot change, close this and press “Keep as it is” next to that day.</p><ul class="balance-list">${proposals.map((p, i) => `<li><label><input type="checkbox" data-proposal="${i}" checked><span><b>${shape(p.energy)} ${esc(p.name)}</b>: ${p.fromDay} → ${p.toDay ? `${p.toDay} ${p.toPeriod.toLowerCase()}` : '“Later this week”'}<small>${esc(p.why)}</small></span></label></li>`).join('')}</ul><div class="modal-actions"><button type="button" id="balanceCancel">Cancel</button><button type="button" class="primary" id="balanceApply">Apply the ticked moves</button></div>`);
  $('balanceCancel').onclick = closeModal;
  $('balanceApply').onclick = () => {
    const chosen = [...modal.querySelectorAll('[data-proposal]:checked')].map((x) => proposals[Number(x.dataset.proposal)]);
    closeModal();
    chosen.forEach((p) => applyProposal(p));
    if (chosen.length) toast(`${chosen.length} move${chosen.length > 1 ? 's' : ''} done. Use ↶ Undo to go back.`);
  };
}

// "Split a task over days": e.g. a meal in 3 parts (meat, vegetables, rice) on 3 days in a row.
export function openSplit() {
  const lib = ctx.state.library.filter((a) => !a.fixed);
  showModal('Split a task over days', `<p class="muted">Big tasks are easier in small parts on different days.</p>
    <div class="field"><label for="splitBase">Task</label><select id="splitBase" name="base">${lib.map((a) => `<option value="${esc(a.id)}">${esc(a.name)}</option>`).join('')}</select></div>
    <div class="field" style="margin-top:10px"><label for="splitParts">Parts, one per line</label><textarea id="splitParts" name="parts">meat\nvegetables\nrice or pasta</textarea><span class="hint">2 to 5 parts.</span></div>
    <div class="row" style="margin-top:10px"><div class="field"><label for="splitDay">First day</label><select id="splitDay" name="day">${days().map((d) => `<option>${d}</option>`).join('')}</select></div><div class="field"><label for="splitPeriod">Time of day</label><select id="splitPeriod" name="period">${PERIODS.map((p) => `<option>${p}</option>`).join('')}</select></div></div>`, (fd) => {
    const base = ctx.state.library.find((a) => a.id === fd.get('base'));
    const parts = String(fd.get('parts') || '').split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 5).map((name) => ({ name }));
    if (!base || parts.length < 2) { toast('Write at least 2 parts.'); return false; }
    const changes = splitChanges(base, parts, fd.get('day'), fd.get('period'));
    changes.forEach((c) => change(c, { silent: true }));
    toast(`${base.name.replace(/\s*\(part\)$/i, '')}: ${parts.length} parts added, starting ${fd.get('day')}.`);
  }, { submitLabel: 'Add the parts' });
}

export function repeatLastWeek() {
  if (!confirm('Copy this week to next week? You can still change next week afterwards.')) return;
  const clone = resetWeekly(ctx.state.schedule, ctx.state.skipped);
  DAYS.forEach((d) => PERIODS.forEach((p) => clone[d][p].forEach((a) => { a.id = uid(); delete a.voiceNew; })));
  ctx.weekSchedules[ctx.weekOffset] = JSON.parse(JSON.stringify(ctx.state.schedule));
  ctx.weekSchedules[ctx.weekOffset + 1] = clone;
  changeWeek(ctx.weekOffset + 1);
  toast('Next week starts as a copy of this week.');
}

// "Add for later": a quick form for the tray.
export function openAddLeftover() {
  showModal('Add for later this week', `<div class="field"><label for="leftName">Activity</label><input id="leftName" name="name" maxlength="60" list="leftLib" placeholder="e.g. Wash floors" required><datalist id="leftLib">${ctx.state.library.map((a) => `<option value="${esc(a.name)}">`).join('')}</datalist></div><div style="margin-top:12px">${energyPicker('energy', 'green')}</div>`, (fd) => {
    const name = String(fd.get('name') || '').trim();
    if (!name) { toast('Please write the activity.'); return false; }
    const fromLib = ctx.state.library.find((a) => a.name.toLowerCase() === name.toLowerCase());
    change({ type: 'addLeftover', item: fromLib ? { ...fromLib, id: uid(), activityId: fromLib.id } : { name, energy: fd.get('energy'), duration: 30 } });
  }, { submitLabel: 'Add' });
}

// ---------- extra actions under "More" (W3C COGA: about 5 main choices per screen) ----------

export function openWeekMenu() {
  const modal = showPanelModal('More', `<div class="menu-list">
    <button type="button" data-menu="balance">Suggest a lighter week<small>Moves that keep every day within your rules. Nothing changes until you choose.</small></button>
    <button type="button" data-menu="split">Split a task over days<small>For example a meal in 3 parts on 3 days.</small></button>
    <button type="button" data-menu="copy">Copy this week to next week</button>
    <button type="button" data-menu="new">New activity</button>
    <button type="button" data-menu="print">Print the week</button>
  </div><div class="modal-actions"><button type="button" id="menuClose">Close</button></div>`);
  $('menuClose').onclick = closeModal;
  modal.querySelectorAll('[data-menu]').forEach((b) => (b.onclick = () => {
    closeModal();
    const m = b.dataset.menu;
    if (m === 'balance') openBalance();
    if (m === 'split') openSplit();
    if (m === 'copy') repeatLastWeek();
    if (m === 'print') printWeek();
    if (m === 'new') document.getElementById('weeklyAddActivity').click();
  }));
}
