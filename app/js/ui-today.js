// Today: what is now, what is next, what to remember for each activity, and a look at tomorrow.
// No tracking of her energy or symptoms: she asked for a planner that helps her schedule, nothing more.
//
// Why (research, docs/research-features.md): people with memory loss after a brain injury hold
// 1–3 items at once (W3C COGA), so this screen shows only Now and Next in large type; step lists
// help with complex tasks (INCOG 2.0).
// The client asked for no reassurance messages and no percentages: the text stays plain and factual.
//
// Track: A - Interface

import { PERIODS, ENERGY } from './config.js';
import { ctx, commit, change } from './context.js';
import { checkDay } from './rules.js';
import { uid, isAppointment, isQuiet } from './store.js';
import { appointmentToday } from './ui-appointment.js';
import { $, esc, shape, energyLabel, toast, dayName, dateKey, currentPeriodIndex, orderedDays } from './ui-kit.js';
import { budgetHtml, renderCard } from './ui-week.js';

// Today always uses THIS week, even while the week board shows another week.
const thisWeek = () => (ctx.weekOffset === 0 ? ctx.state.schedule : ctx.weekSchedules[0] || ctx.state.schedule);
const clone = (x) => JSON.parse(JSON.stringify(x));

// Steps are a plain "remember" list: nothing is ticked or saved (no tracking, decision 30).
function bigActivity(a, key, { steps = true } = {}) {
  const e = ENERGY[a.energy] ? a.energy : 'green';
  const stepList = steps && a.steps?.length ? `<div class="remember"><strong>Remember</strong><ul class="steps">${a.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ul></div>` : '';
  return `<div class="big-act e-${e}"><span class="activity-shape" aria-hidden="true">${shape(e)}</span><div style="flex:1;min-width:0"><h3>${esc(a.name)}</h3><div class="meta">${energyLabel(e)}${a.duration ? ` · ${a.duration} min` : ''}${a.fixed ? ' · fixed' : ''}</div>${a.note ? `<div class="meta">${esc(a.note)}</div>` : ''}${isQuiet(a, ctx.state.library) ? '<div class="meta">Quiet time: the device stays silent.</div>' : ''}${stepList}${steps && isAppointment(a, ctx.state.library) ? appointmentToday(a) : ''}</div></div>`;
}

export function renderToday() {
  if (!$('todayView')) return;
  const now = new Date();
  const day = dayName(now);
  const key = dateKey(now);
  const sched = thisWeek();
  const check = checkDay(sched, day);
  const pi = currentPeriodIndex(now);
  const list = (p) => sched[day][p] || [];

  $('todayTitle').textContent = now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  $('todaySub').textContent = pi < 0 ? 'The day has not started yet.' : pi > 2 ? 'Evening is over. Time to look at tomorrow.' : `It is the ${PERIODS[pi].toLowerCase()}.`;
  $('todayBudget').innerHTML = `<strong>Energy planned today</strong>${budgetHtml(check)}${check.over ? `<p class="muted" style="font-size:.85em;margin-top:4px">${esc(check.warnings[0])}</p>` : ''}`;

  // ---- main column: Now (the one strong element), then the rest of today in a quiet list ----
  // Research: after a brain injury, finding one item among look-alikes stays slow; a single item that stands
  // out is found normally (Schmitter-Edgecombe & Robertson 2015). So only "Now" is large and framed.
  let main = '';
  if (check.restNeeded) {
    main += `<div class="tip"><p>After ${esc(check.redName)}, your rule is 30 minutes of rest.</p><button data-add-rest="${day}">Add a rest</button></div>`;
  }
  const nowP = pi < 0 ? 0 : pi;
  if (pi <= 2) {
    const items = list(PERIODS[nowP]);
    main += `<section class="now-card" aria-label="Now"><span class="now-label">${pi < 0 ? 'First, this morning' : `Now, this ${PERIODS[nowP].toLowerCase()}`}</span>${items.length ? items.map((a) => bigActivity(a, key)).join('') : `<div class="free-block">Nothing planned this ${PERIODS[nowP].toLowerCase()}.</div>`}</section>`;
    const later = PERIODS.slice(nowP + 1);
    if (later.length) {
      main += `<section aria-labelledby="laterTitle"><h3 id="laterTitle" style="margin-bottom:var(--gap)">Later today</h3><div class="later-list">${later.map((p) => {
        const items = list(p);
        return `<div class="later-period"><h4>${p}</h4>${items.map((a, idx) => renderCard(a, day, p, idx, 'today')).join('') || '<span class="muted" style="font-size:.85em">Free</span>'}</div>`;
      }).join('')}</div></section>`;
    }
  } else {
    main += `<section class="now-card"><span class="now-label">Today is done</span><p>Tomorrow is ${tomorrowName(now)}. It is on the right.</p></section>`;
  }
  $('todayMain').innerHTML = main;

  // ---- side column: tomorrow ----
  const tomorrowDate = new Date(now);
  tomorrowDate.setDate(now.getDate() + 1);
  const tDay = dayName(tomorrowDate);
  // Tomorrow may be in next week's board when today is the last day of the week.
  const lastDay = orderedDays(ctx.state.settings.weekStart)[6];
  const tSched = day === lastDay ? (ctx.weekSchedules[1] || sched) : sched;
  const tItems = PERIODS.flatMap((p) => (tSched[tDay][p] || []).map((a) => ({ a, p })));
  const tomorrow = `<section class="panel" aria-labelledby="tmTitle"><h3 id="tmTitle">Tomorrow, ${tDay}</h3>${tItems.length ? `<ul class="tomorrow-list">${tItems.map(({ a, p }) => `<li><span class="when">${p}</span><span>${shape(a.energy)} ${esc(a.name)}</span></li>`).join('')}</ul>` : '<p class="muted">Nothing planned yet.</p>'}<div class="row" style="margin-top:var(--gap)"><button class="small" data-print-tomorrow="${tDay}">Print tomorrow</button><button class="small" data-open-day="${tDay}">Change tomorrow</button></div></section>`;
  $('todaySide').innerHTML = tomorrow;
}

const tomorrowName = (now) => { const d = new Date(now); d.setDate(d.getDate() + 1); return dayName(d); };

// ---------- actions ----------

// Her rule: a red is followed by 30 minutes of rest. Only added when she taps the button.
export function addRest(day) {
  const sched = thisWeek();
  const redP = PERIODS.find((p) => (sched[day][p] || []).some((a) => a.energy === 'red')) || 'Afternoon';
  const after = PERIODS[Math.min(2, PERIODS.indexOf(redP) + 1)];
  const rest = ctx.state.library.find((a) => a.energy === 'rest') || { id: 'rest', name: 'Rest', energy: 'rest', duration: 30 };
  change({ type: 'add', day, period: (sched[day][after] || []).length >= 3 ? redP : after, item: { ...rest, id: uid(), activityId: rest.id, duration: 30, reminder: false } });
}
