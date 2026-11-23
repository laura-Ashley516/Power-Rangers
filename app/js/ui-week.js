// Week board: the client's 7 days x Morning / Afternoon / Evening, her activities to drag in
// ("My activities"), the "Later this week" tray, energy bars, the Suggestions panel,
// "Suggest a lighter week", "Split a task", "Copy this week".
//
// Track: A - Interface

import { DAYS, PERIODS, ENERGY } from './config.js';
import { ctx, commit, change, undo } from './context.js';
import { checkDay, suggestBalance, splitChanges, daySignature, openWeek, weekFromSeries, sortByTime } from './rules.js';
import { uid } from './store.js';
import { $, esc, shape, energyLabel, toast, showModal, showPanelModal, closeModal, orderedDays, dateKey, energyPicker, WEEKLY, CARD_ICON, QUIET_ICON } from './ui-kit.js';
import { isAppointment, isQuiet } from './store.js';
import { printWeek } from './print.js';
import { t, tDay, tPeriod, where, fmtDate, clock, dayInText } from './i18n.js';

export function slotId(day, period) { return `slot-${day}-${period}`; }

const svg = (body) => `<svg class="icon period-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
export const PERIOD_ICON = {
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
export function formatShortDate(d) { return fmtDate(d, { month: 'short', day: 'numeric' }); }
export function dateForDay(day) { const start = weekStart(); start.setDate(start.getDate() + days().indexOf(day)); return start; }
export function formatLongDate(d) { return fmtDate(d, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }); }

// Energy bar, without numbers (client feedback, Nov 2026: "get rid of the number but keep the bar").
// It fills like a traffic light: green while the day is light, yellow when it is getting full, red past her rules.
// The word (Light / Getting full / Full / More than your rules) is there for screen readers and on a long press.
export function dayWord(check) {
  if (!check.load) return t('Free');
  if (check.over) return t('More than your rules');
  const ratio = check.load / check.limit;
  return ratio <= 0.6 ? t('Light day') : ratio < 1 ? t('Getting full') : t('Full day');
}
export function budgetHtml(check, { word = false } = {}) {
  const ratio = Math.min(1, check.load / check.limit);
  const cls = check.over ? 'over' : ratio > 0.6 ? 'mid' : '';
  const text = dayWord(check);
  return `<div class="budget ${cls}" role="img" aria-label="${esc(t('Energy: {word}', { word: text }))}" title="${esc(text)}"><div class="budget-bar" aria-hidden="true"><div class="budget-fill" style="width:${Math.max(check.load ? 6 : 0, Math.round(ratio * 100))}%"></div></div>${word ? `<span>${esc(text)}</span>` : ''}</div>`;
}

// One activity card. kind: 'scheduled' (in a day), 'library' (a tile to drag in), 'leftover' (Later this week).
export function renderCard(a, day, period, index, kind = 'scheduled') {
  const energy = ENERGY[a.energy] ? a.energy : 'green';
  const lock = kind !== 'library' && !!(a.seriesId && ctx.state.series?.[a.seriesId]); // a weekly card
  const draggable = ['library', 'leftover', 'scheduled'].includes(kind); // weekly activities too (moved for this week only)
  const isNew = a.voiceNew ? `<span class="new-mark" title="${esc(t('Added from a voice note'))}">${t('new')}</span>` : '';
  // A weekly card somewhere else than its usual place has been moved for this week only.
  const usual = lock && a.seriesId ? ctx.state.series?.[a.seriesId] : null;
  const movedThisWeek = kind === 'scheduled' && usual && (usual.day !== day || usual.period !== period);
  const time = a.time && kind !== 'library' ? clock(a.time) : '';
  const label = [time, a.name, energyLabel(energy), lock ? t('every week') : '', movedThisWeek ? t('moved this week (usually {where})', { where: where(usual.day, usual.period) }) : '', a.voiceNew ? t('added from a voice note') : ''].filter(Boolean).join(', ');
  const meta = [a.duration ? `<span class="dur">${a.duration} min</span>` : '', a.steps?.length && kind !== 'library' ? `<span class="dur">☑ ${t('{n} steps', { n: a.steps.length })}</span>` : ''].filter(Boolean).join(' ');
  const controls = kind === 'leftover' ? `<div class="activity-controls"><button class="small" data-action="drop-leftover" title="${esc(t('Remove'))}" aria-label="${esc(t('Remove {name} from later', { name: a.name }))}">×</button></div>` : '';
  const pos = kind === 'scheduled' ? `data-day="${day}" data-period="${period}" data-index="${index}"` : '';
  const icons = (lock ? ` <span class="fixed-lock" title="${esc(t('Every week'))}">${WEEKLY}</span>` : '')
    + (kind !== 'library' && isAppointment(a, ctx.state.library) && (a.questions?.length || a.afterNote) ? ` <span class="fixed-lock" title="${esc(t('Appointment card ready'))}">${CARD_ICON}</span>` : '')
    + (kind !== 'library' && isQuiet(a, ctx.state.library) ? ` <span class="fixed-lock" title="${esc(t('Quiet time: the device stays silent'))}">${QUIET_ICON}</span>` : '');
  return `<div class="activity-card ${energy}${lock ? ' fixed' : ''}${a.voiceNew ? ' voice-new' : ''}${ctx.placing?.id === a.id ? ' selected' : ''}" tabindex="0" role="button" aria-label="${esc(label)}" draggable="${draggable}" data-card-type="${kind}" data-id="${esc(a.id)}" ${pos}><div class="activity-text"><div class="activity-name"><span class="activity-shape" aria-hidden="true">${shape(energy)}</span> ${time ? `<b class="card-time">${esc(time)}</b> ` : ''}${esc(a.name)}${icons} ${isNew}</div>${meta ? `<div class="activity-meta">${meta}</div>` : ''}${movedThisWeek ? `<div class="moved-note">${t('This week only')}</div>` : ''}</div>${controls}</div>`;
}

// The legend under the week: shape + word, and the logic behind the shapes (client feedback, Nov 2026).
export function renderKey() {
  const el = $('energyKey');
  if (!el) return;
  el.innerHTML = ['green', 'yellow', 'red', 'rest'].map((e) => `<span class="key-item">${shape(e)} ${energyLabel(e)}</span>`).join('')
    + `<span class="key-logic">${t('More points = more energy. The black star is a high-energy activity.')}</span>`;
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
  // Tapping a day's header opens it in "One day" below.
  const head = '<div class="cal-corner" aria-hidden="true"></div>' + cols.map((c, i) => `<div class="cal-head${c.isToday ? ' today' : ''}${c.check.over ? ' over' : ''}${i === 6 ? ' col-last' : ''}" role="columnheader"><button type="button" class="day-title" data-open-day="${c.day}" aria-label="${esc(t('Open {day} below', { day: tDay(c.day) }))}"><span class="day-name">${tDay(c.day)}</span><span class="day-num">${c.date.getDate()}</span><span class="day-date">${c.isToday ? `<b class="today-word">${t('Today')}</b>` : fmtDate(c.date, { month: 'short' })}</span></button>${budgetHtml(c.check)}</div>`).join('');
  // One row per time of day: the label on the left, then one box per day.
  const rows = PERIODS.map((period, pi) => `<div class="cal-period${pi === PERIODS.length - 1 ? ' row-last' : ''}" role="rowheader">${PERIOD_ICON[period]}<span>${tPeriod(period)}</span></div>` + cols.map((c, i) => {
    const list = sortByTime(state.schedule[c.day][period] || []);
    return `<div class="slot${c.isToday ? ' today' : ''}${i === 6 ? ' col-last' : ''}${pi === PERIODS.length - 1 ? ' row-last' : ''}" id="${slotId(c.day, period)}" data-day="${c.day}" data-period="${period}" role="gridcell" aria-label="${esc(t('{day} {period}: {n} activities. Drop here.', { day: tDay(c.day), period: tPeriod(period), n: list.length }))}">${list.map((a, idx) => renderCard(a, c.day, period, idx, 'scheduled') + (a.energy === 'red' && c.check.restNeeded ? `<div class="rest-hint">${t('then 30 min rest')}</div>` : '')).join('')}</div>`;
  }).join('')).join('');
  grid.className = 'cal';
  grid.setAttribute('role', 'grid');
  grid.innerHTML = head + rows;
  renderPalette();
  renderTray();
  renderAlerts();
  renderPlaceHint();
  renderKey();
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
  $('leftoverTray').innerHTML = list.length ? list.map((a) => renderCard(a, null, null, 0, 'leftover')).join('') : `<div class="slot-hint">${t('Nothing waiting. Drag a day’s activity here to keep it for later.')}</div>`;
}

export function renderPlaceHint() {
  const el = $('placeHint');
  document.body.classList.toggle('placing', !!ctx.placing);
  if (!ctx.placing) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  el.innerHTML = `<span>${t('Now tap a day and time for {name}.', { name: `<b>${esc(ctx.placing.name)}</b>` })}</span><button type="button" data-cancel-place>${t('Cancel')}</button>`;
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
export function placeInto(kind, id, day, period, { everyWeek = false, time } = {}) {
  if (kind === 'leftover') return change({ type: 'place', id, toDay: day, toPeriod: period });
  const a = ctx.state.library.find((x) => x.id === id);
  if (!a) return null;
  // From "My activities": only this week, unless she ticks "Repeat every week" (quick add) or taps the card later.
  return change({ type: 'add', day, period, everyWeek, item: { ...a, fixed: false, id: uid(), activityId: a.id, steps: [...(a.steps || [])], time: time || undefined } });
}

// ---------- Suggestions (energy notes) ----------

// The notes and tips sit behind the "Suggestions" button, next to "New activity" (client feedback, Nov 2026):
// she opens them when she wants, and hides them so they do not overwhelm her. The button shows how many there are.
// "Keep as it is": for a day she cannot change (a friend visiting today), the note and the suggestions
// leave that day alone until something on it changes.
const keptDays = () => days().filter((d) => ctx.state.kept?.[d] && ctx.state.kept[d] === daySignature(ctx.state.schedule, d));

export function keepDay(day) {
  commit({ ...ctx.state, kept: { ...(ctx.state.kept || {}), [day]: daySignature(ctx.state.schedule, day) } });
  toast(t('{day} stays as it is.', { day: tDay(day) }));
}

function notes() {
  const over = [], tips = [];
  const kept = keptDays();
  days().forEach((day) => {
    if (kept.includes(day)) return;
    const c = checkDay(ctx.state.schedule, day);
    if (c.warnings.length) over.push(`<b>${tDay(day)}</b>: ${esc(c.warnings[0].replace(/\.$/, ''))}. <button type="button" class="small keep-day" data-keep-day="${day}">${t('Keep as it is')}</button>`);
    else c.tips.forEach((tip) => tips.push(`<b>${tDay(day)}</b>: ${esc(tip)}`));
  });
  return { over, tips };
}

export function toggleSuggestions(open = !ctx.state.settings.suggestionsOpen) {
  commit({ ...ctx.state, settings: { ...ctx.state.settings, suggestionsOpen: open } });
}

export function renderAlerts() {
  const root = $('overloadAlerts');
  const btn = $('suggestBtn');
  const { over, tips } = ctx.state.settings.alerts ? notes() : { over: [], tips: [] };
  const n = over.length + tips.length;
  const open = !!ctx.state.settings.suggestionsOpen;
  if (btn) {
    btn.innerHTML = `${t(open ? 'Hide suggestions' : 'Suggestions')}${n ? ` <span class="nav-count${over.length ? ' warn' : ''}">${n}</span>` : ''}`;
    btn.setAttribute('aria-expanded', String(open));
    btn.classList.toggle('has-notes', over.length > 0);
  }
  root.classList.toggle('hidden', !open);
  if (!open) { root.innerHTML = ''; return; }
  const lines = [...over, ...tips].map((l) => `<div>${l}</div>`).join('');
  root.innerHTML = n
    ? `<div class="alert${over.length ? '' : ' info'}"><div><strong>${over.length ? t('More than your energy rules') : t('A note on this week')}</strong>${lines}</div>${over.length ? `<button type="button" data-open-balance>${t('Suggest moves')}</button>` : ''}<button type="button" data-suggest-hide>${t('Hide')}</button></div>`
    : `<div class="alert info"><div><strong>${t('No suggestions')}</strong><div>${t('Every day is within your energy rules.')}</div></div><button type="button" data-suggest-hide>${t('Hide')}</button></div>`;
}

// The key of a week: the date of its first day (Sunday or Monday, from Settings).
export const weekKey = (offset = ctx.weekOffset) => dateKey(weekStart(offset));

// Any week's schedule, without opening it: saved, on screen, or (never opened) its weekly activities.
export function scheduleFor(offset) {
  const key = weekKey(offset);
  if (key === ctx.state.shownWeek) return ctx.state.schedule;
  return ctx.state.weeks?.[key] || weekFromSeries(ctx.state.series);
}

// Every week is saved on its own (rules.openWeek); a week never opened starts with the weekly activities only.
export function changeWeek(next) {
  ctx.weekOffset = next;
  ctx.selectedActivity = null;
  ctx.dayShown = null;
  ctx.undoStack = []; // Undo stays inside the week it was done in
  commit(openWeek(ctx.state, weekKey(next)));
  const w = ctx.weekOffset;
  toast(w === 0 ? t('Showing this week.') : w < 0 ? t(w < -1 ? '{n} weeks ago' : '{n} week ago', { n: Math.abs(w) }) : t(w > 1 ? '{n} weeks ahead' : '{n} week ahead', { n: w }));
}

// "Suggest a lighter week": every proposal is shown and can be unticked; nothing changes until "Apply".
export function openBalance() {
  const proposals = suggestBalance(ctx.state.schedule, { keep: keptDays() });
  if (!proposals.length) { toast(t('Every day is within your energy rules. Nothing to change.')); return; }
  const modal = showPanelModal(t('Suggest a lighter week'), `<p class="muted">${t('These moves keep every day within your rules. Weekly activities are not moved. Untick any you want to keep. If a day cannot change, close this and press “Keep as it is” next to that day.')}</p><ul class="balance-list">${proposals.map((p, i) => `<li><label><input type="checkbox" data-proposal="${i}" checked><span><b>${shape(p.energy)} ${esc(p.name)}</b>: ${tDay(p.fromDay)} → ${p.toDay ? where(p.toDay, p.toPeriod) : t('“Later this week”')}<small>${esc(t(p.why))}</small></span></label></li>`).join('')}</ul><div class="modal-actions"><button type="button" id="balanceCancel">${t('Cancel')}</button><button type="button" class="primary" id="balanceApply">${t('Apply the ticked moves')}</button></div>`);
  $('balanceCancel').onclick = closeModal;
  $('balanceApply').onclick = () => {
    const chosen = [...modal.querySelectorAll('[data-proposal]:checked')].map((x) => proposals[Number(x.dataset.proposal)]);
    closeModal();
    if (!chosen.length) return;
    // All the moves as one change, so one Undo puts them all back.
    const changes = chosen.map((p) => (p.toDay ? { type: 'move', id: p.id, toDay: p.toDay, toPeriod: p.toPeriod } : { type: 'park', id: p.id }));
    const r = change(changes.length === 1 ? changes[0] : { type: 'batch', changes }, { silent: true });
    if (r?.ok) toast(t(chosen.length > 1 ? '{n} moves done.' : '{n} move done.', { n: chosen.length }), 8000, { label: t('Undo'), run: undo });
  };
}

// "Split a task": a big task in small parts on different days (e.g. a meal: meat, vegetables, rice).
// Client feedback, Nov 2026: make splitting easy to find. It is in the card menu ("Split into parts"),
// on each of "My activities", and under "More". fromCard: { id } of a card in the week (it is replaced by the parts).
export function openSplit(opts = {}) {
  const card = opts.cardId ? (() => { for (const d of DAYS) for (const p of PERIODS) { const a = ctx.state.schedule[d][p].find((x) => x.id === opts.cardId); if (a) return { a, d, p }; } return null; })() : null;
  const lib = ctx.state.library.filter((a) => a.energy !== 'rest');
  const baseId = card ? (card.a.activityId || '') : opts.activityId || lib[0]?.id;
  const baseName = card ? card.a.name.replace(/\s*\d+\/\d+.*$/, '').replace(/\s*\(part\)$/i, '') : '';
  const meal = /meal|repas/i.test(card?.a.name || ctx.state.library.find((a) => a.id === baseId)?.name || '');
  const select = card ? `<p><b>${shape(card.a.energy)} ${esc(card.a.name)}</b> · ${where(card.d, card.p)}</p>`
    : `<div class="field"><label for="splitBase">${t('Task')}</label><select id="splitBase" name="base">${lib.map((a) => `<option value="${esc(a.id)}" ${a.id === baseId ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select></div>`;
  showModal(t('Split into parts'), `<p class="muted">${t('Big tasks are easier in small parts on different days. Each part gets its own card.')}</p>
    ${select}
    <div class="field" style="margin-top:10px"><label for="splitParts">${t('Parts, one per line')}</label><textarea id="splitParts" name="parts" rows="4" placeholder="${esc(t('e.g. Part 1\nPart 2'))}">${meal ? esc(t('meat\nvegetables\nrice or pasta')) : ''}</textarea><span class="hint">${t('2 to 5 parts. Leave empty for 2 parts with no name.')}</span></div>
    <div class="row" style="margin-top:10px"><div class="field"><label for="splitDay">${t('First day')}</label><select id="splitDay" name="day">${days().map((d) => `<option value="${d}" ${d === (card?.d) ? 'selected' : ''}>${tDay(d)}</option>`).join('')}</select></div><div class="field"><label for="splitPeriod">${t('Time of day')}</label><select id="splitPeriod" name="period">${PERIODS.map((p) => `<option value="${p}" ${p === (card?.p) ? 'selected' : ''}>${tPeriod(p)}</option>`).join('')}</select></div></div>
    <div class="field" style="margin-top:10px"><label for="splitGap">${t('Parts go')}</label><select id="splitGap" name="gap"><option value="1">${t('on the days after each other')}</option><option value="0">${t('all on the same day')}</option><option value="2">${t('every second day')}</option></select></div>`, (fd) => {
    const base = card ? { ...card.a, id: card.a.activityId || card.a.id, name: baseName || card.a.name } : ctx.state.library.find((a) => a.id === fd.get('base'));
    let parts = String(fd.get('parts') || '').split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 5).map((name) => ({ name }));
    if (!parts.length) parts = [{ name: '' }, { name: '' }];
    if (!base || parts.length < 2) { toast(t('Write at least 2 parts.')); return false; }
    const changes = splitChanges(base, parts, fd.get('day'), fd.get('period'), Number(fd.get('gap') ?? 1), days());
    if (card) changes.unshift({ type: 'remove', id: card.a.id });
    const r = change({ type: 'batch', changes }, { silent: true });
    if (r.ok) toast(t('{name}: {n} parts added, starting {day}.', { name: base.name.replace(/\s*\(part\)$/i, ''), n: parts.length, day: dayInText(fd.get('day')) }), 8000, { label: t('Undo'), run: undo });
    else toast(r.message);
  }, { submitLabel: t('Add the parts') });
}

export function repeatLastWeek() {
  if (!confirm(t('Copy this week to next week, one-time activities too? What is planned next week now is replaced. You can still change it afterwards.'))) return;
  const copy = JSON.parse(JSON.stringify(ctx.state.schedule));
  DAYS.forEach((d) => PERIODS.forEach((p) => copy[d][p].forEach((a) => { a.id = uid(); delete a.voiceNew; })));
  commit({ ...ctx.state, weeks: { ...(ctx.state.weeks || {}), [weekKey(ctx.weekOffset + 1)]: copy } });
  changeWeek(ctx.weekOffset + 1);
  toast(t('Next week starts as a copy of this week.'));
}

// "Add for later": a quick form for the tray.
export function openAddLeftover() {
  showModal(t('Add for later this week'), `<div class="field"><label for="leftName">${t('Activity')}</label><input id="leftName" name="name" maxlength="60" list="leftLib" placeholder="${esc(t('e.g. Wash floors'))}" required><datalist id="leftLib">${ctx.state.library.map((a) => `<option value="${esc(a.name)}">`).join('')}</datalist></div><div style="margin-top:12px">${energyPicker('energy', 'green')}</div>`, (fd) => {
    const name = String(fd.get('name') || '').trim();
    if (!name) { toast(t('Please write the activity.')); return false; }
    const fromLib = ctx.state.library.find((a) => a.name.toLowerCase() === name.toLowerCase());
    change({ type: 'addLeftover', item: fromLib ? { ...fromLib, id: uid(), activityId: fromLib.id } : { name, energy: fd.get('energy'), duration: 30 } });
  }, { submitLabel: t('Add') });
}

// ---------- extra actions under "More" (W3C COGA: about 5 main choices per screen) ----------

export function openWeekMenu() {
  const modal = showPanelModal(t('More'), `<div class="menu-list">
    <button type="button" data-menu="balance">${t('Suggest a lighter week')}<small>${t('Moves that keep every day within your rules. Nothing changes until you choose.')}</small></button>
    <button type="button" data-menu="split">${t('Split a task into parts')}<small>${t('For example a meal in 3 parts on 3 days. You can also tap a card and choose “Split into parts”.')}</small></button>
    <button type="button" data-menu="photo">${t('Add from a photo')}<small>${t('Take a picture of a paper schedule or a note; the planner reads it.')}</small></button>
    <button type="button" data-menu="copy">${t('Copy this week to next week')}</button>
    <button type="button" data-menu="print">${t('Print the week')}</button>
  </div><div class="modal-actions"><button type="button" id="menuClose">${t('Close')}</button></div>`);
  $('menuClose').onclick = closeModal;
  modal.querySelectorAll('[data-menu]').forEach((b) => (b.onclick = () => {
    closeModal();
    const m = b.dataset.menu;
    if (m === 'balance') openBalance();
    if (m === 'split') openSplit();
    if (m === 'copy') repeatLastWeek();
    if (m === 'print') printWeek();
    if (m === 'photo') document.getElementById('photoBtn').click();
  }));
}
