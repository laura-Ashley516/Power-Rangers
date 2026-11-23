// One day, at the bottom of the week page (client feedback, Nov 2026: no separate "Today" screen; keep
// "One day", show the current tasks, put it at the end of the main page, and make it simple, with less
// information and a picture for each task).
//
// Layout (like a phone day planner): the day's name in large letters, a strip of the 7 days to tap,
// then Morning / Afternoon / Evening as groups that open and close, each activity as one simple card:
// picture, name, time ("10:00 → 11:00") and its energy shape WITH its word ("★ High"): team decision (item 13 A),
// so the shape never has to be guessed; the legend stays under the week and on paper.
// - On today, the current time of day is marked "Now" and opened; times of day already over are closed.
// - Tapping a card opens the same menu as in the week (move, split, every week, remove).
// - Every group is a drop zone and can be tapped to add, like the week.
// - No tracking: nothing is ticked or saved about what she did (decision 30).
// Research: people with memory loss after a brain injury hold 1–3 items at once (W3C COGA); pictures with
// words help recognition; one item that stands out ("Now") is found quickly.
//
// Track: A - Interface

import { PERIODS, ENERGY } from './config.js';
import { ctx, change } from './context.js';
import { checkDay, sortByTime } from './rules.js';
import { uid } from './store.js';
import { $, esc, shape, energyLabel, dayName, dateKey, currentPeriodIndex, orderedDays } from './ui-kit.js';
import { dateForDay, budgetHtml, PERIOD_ICON } from './ui-week.js';
import { iconFor } from './icons.js';
import { t, tDay, tPeriod, fmtDate, clock } from './i18n.js';

const days = () => orderedDays(ctx.state.settings.weekStart);

// The day shown: chosen in the strip, else today (this week) or the first day (another week).
export function shownDay() {
  if (ctx.dayShown && days().includes(ctx.dayShown)) return ctx.dayShown;
  return ctx.weekOffset === 0 ? dayName(new Date()) : days()[0];
}
export function showDay(day) { ctx.dayShown = day; ctx.dayOpen = null; renderDaily(); }
export function stepDay(step) {
  const list = days();
  showDay(list[(list.indexOf(shownDay()) + step + 7) % 7]);
}

// "10:00 → 11:00" (start + duration), or just the length when there is no clock time.
function timeText(a) {
  if (!a.time) return a.duration ? `${a.duration} min` : '';
  const [h, m] = a.time.split(':').map(Number);
  const end = new Date(2000, 0, 1, h, m + (a.duration || 0));
  const endTxt = `${String(end.getHours()).padStart(2, '0')}:${String(end.getMinutes()).padStart(2, '0')}`;
  return a.duration ? `${clock(a.time)} → ${clock(endTxt)}` : clock(a.time);
}

function card(a, day, period, i) {
  const e = ENERGY[a.energy] ? a.energy : 'green';
  const when = timeText(a);
  const label = [a.name, when, energyLabel(e), a.fixed ? t('every week') : ''].filter(Boolean).join(', ');
  return `<div class="activity-card day-card ${e}" tabindex="0" role="button" draggable="true" aria-label="${esc(label)}" data-card-type="scheduled" data-id="${esc(a.id)}" data-day="${day}" data-period="${period}" data-index="${i}">
    <span class="day-icon e-${e}" aria-hidden="true">${iconFor(a)}</span>
    <span class="day-text"><span class="day-name-line">${esc(a.name)}</span>${when ? `<span class="day-when">${esc(when)}</span>` : ''}</span>
    <span class="day-shape e-word-${e}">${shape(e)}<span class="day-energy">${esc(energyLabel(e))}</span></span></div>`;
}

export function toggleGroup(period) {
  const open = ctx.dayOpen || {};
  ctx.dayOpen = { ...open, [period]: !isOpen(period) };
  renderDaily();
}
let nowIndex = null;
function isOpen(period) {
  if (ctx.dayOpen && period in ctx.dayOpen) return ctx.dayOpen[period];
  // Today: the times of day already over start closed.
  return nowIndex === null || PERIODS.indexOf(period) >= Math.min(nowIndex, 2);
}

export function renderDaily() {
  const root = $('dayPanel');
  if (!root) return;
  const day = shownDay();
  const date = dateForDay(day);
  const todayKey = dateKey(new Date());
  const isToday = dateKey(date) === todayKey;
  const pi = isToday ? currentPeriodIndex(new Date()) : null; // -1 before the morning, 3 after the evening
  nowIndex = pi === null ? null : Math.max(0, pi);
  const check = checkDay(ctx.state.schedule, day);

  $('dayTitle').textContent = tDay(day);
  $('dayDate').textContent = (isToday ? `${t('Today')} · ` : '') + fmtDate(date, { month: 'long', day: 'numeric' });
  // The strip of days: letter + date number, the chosen day in a soft box, today underlined.
  $('dayStrip').innerHTML = days().map((d) => {
    const dt = dateForDay(d);
    const letter = tDay(d).slice(0, 1);
    return `<button type="button" class="strip-day${d === day ? ' chosen' : ''}${dateKey(dt) === todayKey ? ' is-today' : ''}" data-open-day="${d}" aria-pressed="${d === day}" aria-label="${esc(tDay(d) + ' ' + fmtDate(dt, { month: 'long', day: 'numeric' }))}"><span class="strip-letter">${esc(letter)}</span><span class="strip-num">${dt.getDate()}</span></button>`;
  }).join('');
  $('dayBudget').innerHTML = budgetHtml(check, { word: true });

  let html = '';
  if (check.restNeeded) html += `<div class="tip"><p>${t('After {name}, your rule is 30 minutes of rest.', { name: esc(check.redName) })}</p><button type="button" data-add-rest="${day}">${t('Add a rest')}</button></div>`;
  if (isToday && pi > 2) html += `<p class="day-over">${t('This day is done. Tap tomorrow in the strip above.')}</p>`;
  html += PERIODS.map((period, i) => {
    const list = sortByTime(ctx.state.schedule[day][period] || []);
    const now = isToday && i === Math.max(0, pi) && pi <= 2;
    const open = isOpen(period);
    const chip = `<button type="button" class="period-chip p-${period.toLowerCase()}${now ? ' now' : ''}" data-day-group="${period}" aria-expanded="${open}">${PERIOD_ICON[period]} ${esc(tPeriod(period).toUpperCase())} (${list.length})${now ? ` <b class="now-tag">${t('Now')}</b>` : ''} <span class="chev" aria-hidden="true">${open ? '▾' : '▸'}</span></button>`;
    const body = list.length ? list.map((a, idx) => card(a, day, period, idx)).join('') : `<div class="slot-hint">${t('Free. Tap to add an activity.')}</div>`;
    return `<section class="day-group${now ? ' now' : ''}" aria-label="${esc(tPeriod(period))}">${chip}${open ? `<div class="slot day-slot" data-day="${day}" data-period="${period}">${body}</div>` : ''}</section>`;
  }).join('');
  $('daySlots').innerHTML = html;
}

// Her rule: a red is followed by 30 minutes of rest. Only added when she taps the button.
export function addRest(day) {
  const sched = ctx.state.schedule;
  const redP = PERIODS.find((p) => (sched[day][p] || []).some((a) => a.energy === 'red')) || 'Afternoon';
  const after = PERIODS[Math.min(2, PERIODS.indexOf(redP) + 1)];
  const rest = ctx.state.library.find((a) => a.energy === 'rest') || { id: 'rest', name: t('Rest'), energy: 'rest', duration: 30 };
  change({ type: 'add', day, period: (sched[day][after] || []).length >= 3 ? redP : after, item: { ...rest, id: uid(), activityId: rest.id, duration: 30, reminder: false, time: undefined } });
}
